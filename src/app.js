// 应用装配 + HTTP 接口。零依赖：只用 Node 自带的 http / fs。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const { Pool, HttpError, CODE_RE, secidOf } = require('./pool');
const { Settings } = require('./settings');
const { Service } = require('./service');
const { Alerts, TYPES, MA_LIST } = require('./alerts');
const { Journal } = require('./journal');
const { Reports, toMarkdown } = require('./report');
const { Scheduler } = require('./scheduler');
const { isDate } = require('./time');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png'
};

function build({ dataDir, provider, clock, hotspotSource }) {
  const store = new Store(dataDir);
  const pool = new Pool(store);
  const settings = new Settings(store);
  const service = new Service({ store, provider: typeof provider === 'function' ? provider(pool) : provider, hotspotSource, pool, settings });
  const alerts = new Alerts({ store, pool, settings });
  service.alerts = alerts;
  const journal = new Journal({ store, pool });
  const reports = new Reports(store);
  const scheduler = new Scheduler({ service, reports, clock });
  return { store, pool, settings, service, alerts, journal, reports, scheduler };
}

const send = (res, status, body, headers = {}) => {
  const isStr = typeof body === 'string';
  res.writeHead(status, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, '请求太大')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); } catch (e) { reject(new HttpError(400, 'JSON 格式不对')); }
    });
    req.on('error', reject);
  });
}

function createServer(ctx) {
  const { pool, settings, service, alerts, journal, reports, scheduler } = ctx;
  const sse = new Set();
  const push = (event, data) => { const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const r of sse) r.write(msg); };
  service.on('update', (d) => push('update', d));
  service.on('news', (d) => push('news', d));
  service.on('alert', (d) => push('alert', d));
  service.on('report', (d) => push('report', d));

  const needCode = (code) => { if (!CODE_RE.test(code) || !pool.has(code)) throw new HttpError(404, `${code} 不在股池里`); return code; };

  // [方法, 路径正则, 处理函数(match, body, url) => 结果 | Promise]
  const routes = [
    ['GET', /^\/api\/overview$/, () => service.overview()],
    ['GET', /^\/api\/index$/, () => ({ bars: service.index, status: service.indexStatus, base: settings.get().indexBase, baseDate: settings.get().indexBaseDate })],
    ['GET', /^\/api\/stock\/(\d{6})$/, (m) => { needCode(m[1]); return service.stock(m[1]); }],
    ['GET', /^\/api\/stock\/(\d{6})\/limit-reason$/, async (m, b, url) => {
      needCode(m[1]);
      const day = url.searchParams.get('date') || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'date 必须为 YYYY-MM-DD');
      return service.limitReason(m[1], day);
    }],

    ['GET', /^\/api\/pool$/, () => ({ items: pool.list(), sectors: pool.sectors(), count: pool.items.length })],
    ['POST', /^\/api\/pool$/, async (m, body) => {
      const item = pool.add({ ...body, name: body.name || String(body.code || '') });
      // 用行情校验代码是否真实存在，同时自动补全名称
      try {
        const [q] = await service.provider.quotes([secidOf(item.code)]);
        if (!q || q.price == null) throw new Error('无行情');
        if (!body.name) { item.name = q.name || item.name; pool.save(); }
      } catch (e) {
        pool.remove(item.code);
        throw new HttpError(400, `${item.code} 没有查到行情，请确认代码是否正确`);
      }
      service.refreshStock(item.code).catch(() => {});
      return { item, count: pool.items.length };
    }],
    ['PUT', /^\/api\/pool\/(\d{6})$/, (m, body) => { const it = pool.update(m[1], body); service.compute(); return { item: it }; }],
    ['DELETE', /^\/api\/pool\/(\d{6})$/, (m) => {
      const it = pool.remove(m[1]);
      const rules = alerts.rules.filter((r) => r.code === m[1]);
      rules.forEach((r) => { r.active = false; }); alerts.save();
      service.forget(m[1]);
      const held = journal.summary(service).holdings.find((h) => h.code === m[1] && h.qty > 0);
      return { removed: it, count: pool.items.length, warnings: [
        rules.length ? `已停用 ${rules.length} 条该股票的提醒` : null,
        held ? `交易日志里还有 ${held.name} 的持仓 ${held.qty} 股，日志仍会保留，但不能再新增买入` : null
      ].filter(Boolean) };
    }],

    ['GET', /^\/api\/intraday$/, (m, b, url) => {
      const r = service.intraday(url.searchParams.get('secid') || '1.000001', (url.searchParams.get('date') || '').replace(/-/g, ''));
      if (r.error) throw new HttpError(404, r.error);
      return r;
    }],
    ['GET', /^\/api\/news$/, () => service.newsView()],
    ['GET', /^\/api\/screener\/double-golden-cross$/, () => ({ condition: 'double-golden-cross', items: service.doubleGoldenCross() })],

    ['GET', /^\/api\/reports$/, () => ({ dates: reports.dates() })],
    ['GET', /^\/api\/reports\/latest$/, () => reports.latest()],
    ['GET', /^\/api\/reports\/(\d{4}-\d{2}-\d{2})$/, (m) => { const r = reports.get(m[1]); if (!r) throw new HttpError(404, '没有这一天的晨报'); return r; }],
    ['POST', /^\/api\/reports\/run$/, async () => {
      const r = await scheduler.makeReport(false);
      return r;
    }],

    ['GET', /^\/api\/alerts$/, () => ({ rules: alerts.list(), events: alerts.events(100), types: TYPES, mas: MA_LIST })],
    ['POST', /^\/api\/alerts$/, (m, body) => ({ rule: alerts.add(body) })],
    ['PATCH', /^\/api\/alerts\/([\w-]+)$/, (m, body) => ({ rule: alerts.setActive(m[1], body.active) })],
    ['DELETE', /^\/api\/alerts\/([\w-]+)$/, (m) => { alerts.remove(m[1]); return { ok: true }; }],

    ['GET', /^\/api\/journal$/, () => ({ entries: journal.list(), ...journal.summary(service) })],
    ['POST', /^\/api\/journal$/, (m, body) => ({ entry: journal.add(body) })],
    ['PATCH', /^\/api\/journal\/([\w-]+)$/, (m, body) => ({ entry: journal.update(m[1], body) })],
    ['DELETE', /^\/api\/journal\/([\w-]+)$/, (m) => { journal.remove(m[1]); return { ok: true }; }],

    ['GET', /^\/api\/settings$/, () => settings.get()],
    ['PUT', /^\/api\/settings$/, (m, body) => settings.update(body)],

    ['POST', /^\/api\/refresh$/, async (m, body) => {
      if (body.full) await service.refreshHistory(true);
      await service.refreshQuotes();
      service.refreshUs().catch(() => {});
      service.refreshHotspots().catch(() => {});
      if (body.full) service.refreshNews().catch(() => {});
      return service.overview().status;
    }]
  ];

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(PUBLIC, '.' + rel);
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, '禁止访问');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, '没有这个页面');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (!p.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '不支持');
        return serveStatic(req, res, p);
      }
      // 只允许本机页面访问接口：拦截其他网站对 localhost 的跨站请求
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: '不允许跨站访问' });

      if (p === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        sse.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(ping); sse.delete(res); });
        return;
      }
      const mdMatch = /^\/api\/reports\/(\d{4}-\d{2}-\d{2}|latest)\.md$/.exec(p);
      if (mdMatch) {
        const r = mdMatch[1] === 'latest' ? reports.latest() : reports.get(mdMatch[1]);
        if (!r) throw new HttpError(404, '没有这一天的晨报');
        return send(res, 200, toMarkdown(r), { 'Content-Type': 'text/markdown; charset=utf-8' });
      }

      for (const [method, re, fn] of routes) {
        if (method !== req.method) continue;
        const m = re.exec(p);
        if (!m) continue;
        const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
        const out = await fn(m, body, url);
        return send(res, 200, out == null ? { ok: true } : out);
      }
      if (routes.some(([, re]) => re.test(p))) return send(res, 405, { error: '不支持这个方法' });
      send(res, 404, { error: '没有这个接口' });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: '服务内部错误：' + e.message });
    }
  });
  server.on('close', () => { for (const r of sse) r.end(); });
  return server;
}

module.exports = { build, createServer, isDate };
