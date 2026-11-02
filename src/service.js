// 行情服务：定时取数 → 计算技术指标和股池指数 → 提供给接口和晨报、提醒使用
const { EventEmitter } = require('events');
const IND = require('../public/js/indicators');
const { sh } = require('./time');
const { secidOf } = require('./pool');
const { annotate } = require('./sentiment');
const { reasonsOn } = require('./limit-reason');
const { compare } = require('./volume');
const { sectorEvents } = require('./movers');
const { US_INDICES, CN_INDICES } = require('./seed-pool');

const JUNK = /大宗交易|融资融券|融资余额|融券|股东户数|调研快报|净值增长率|ETF|好仓|持股比例|资金净流|主力资金|龙虎榜|机构风向标|董事会.*决议|担保|这些股|只股|家公司/;
const US_MARKETS = ['105', '106', '107']; // 纳斯达克、纽交所、NYSE Arca

async function inBatches(items, size, fn) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(async (it, j) => {
      try { out[i + j] = await fn(it); } catch (e) { out[i + j] = null; }
    }));
  }
  return out;
}

class Service extends EventEmitter {
  constructor({ store, provider, hotspotSource, pool, settings }) {
    super();
    Object.assign(this, { store, provider, hotspotSource, pool, settings });
    this.quotes = {};      // 股池股票实时报价，key = 代码
    this.cnIdx = [];       // A 股大盘指数报价
    this.us = {};          // 美股报价，key = 代码（如 NVDA）；指数用 'SPX' 等
    this.usIdx = [];
    this.usSecids = store.read('us-secids.json', {});
    this.bars = {};        // 历史日线（不含今日实时），key = 代码
    this.barsAt = {};      // 日线下载时间
    this.live = {};        // 历史 + 今日实时
    this.an = {};          // 技术分析
    this.minutes = {};     // secid -> 最近 5 个交易日的分时 [{date, pts:[[HHMM, 累计成交额, 价格]]}]
    this.vol = {};         // secid -> 较上一交易日同一时刻的成交额对比
    this.hotspots = { date: null, events: [], at: null }; // 财联社全市场题材锚点
    this.index = [];       // 股池等权指数日线
    this.indexStatus = null;
    this.news = store.read('news.json', { at: 0, data: {} }); // {at, data:{code:[...]}}
    this.limitReasonDays = new Map(); // date -> Map(code, {reason, source})，按需加载
    this.status = { quotesAt: null, usAt: null, historyAt: null, newsAt: null, errors: {} };
    this.alerts = null;
    this.busy = {};
    for (const code of pool.codes()) this.loadBarsFromDisk(code);
    this.compute();
  }

  // ---------- 日线 ----------
  loadBarsFromDisk(code) {
    const d = this.store.read(`kline/${code}.json`, null);
    if (d && Array.isArray(d.bars)) { this.bars[code] = d.bars; this.barsAt[code] = d.fetchedAt || 0; }
  }

  barsStale(code, now = Date.now()) {
    const at = this.barsAt[code];
    if (!at || !(this.bars[code] || []).length) return true;
    const today = sh(new Date(now));
    if (sh(new Date(at)).date !== today.date) return true;
    const close = Date.parse(`${today.date}T15:10:00+08:00`);
    return today.wd >= 1 && today.wd <= 5 && now >= close && at < close;
  }

  async refreshHistory(force = false) {
    if (this.busy.history) return;
    this.busy.history = true;
    try {
      const codes = this.pool.codes().filter((c) => force || this.barsStale(c));
      const limit = this.settings.get().historyDays;
      let fail = 0;
      await inBatches(codes, 5, async (code) => {
        try {
          const bars = await this.provider.kline(secidOf(code), limit);
          if (!bars.length) throw new Error('空数据');
          this.bars[code] = bars; this.barsAt[code] = Date.now();
          this.store.write(`kline/${code}.json`, { fetchedAt: this.barsAt[code], bars });
        } catch (e) { fail++; this.status.errors['kline:' + code] = e.message; }
      });
      if (codes.length) this.status.historyAt = Date.now();
      if (!fail) for (const k of Object.keys(this.status.errors)) if (k.startsWith('kline:')) delete this.status.errors[k];
      this.compute();
    } finally { this.busy.history = false; }
  }

  // ---------- 行情 ----------
  async refreshQuotes() {
    if (this.busy.quotes) return;
    this.busy.quotes = true;
    try {
      const items = this.pool.list();
      const secids = items.map((p) => secidOf(p.code)).concat(CN_INDICES.map((m) => m.secid));
      const list = await this.provider.quotes(secids);
      const bySecid = new Map(list.map((q) => [q.secid, q]));
      this.quotes = {};
      for (const p of items) { const q = bySecid.get(secidOf(p.code)); if (q) this.quotes[p.code] = q; }
      this.cnIdx = CN_INDICES.map((m) => ({ name: m.name, q: bySecid.get(m.secid) || null }));
      this.status.quotesAt = Date.now();
      delete this.status.errors.quotes;
      this.compute();
      if (this.alerts) this.alerts.evaluate(this);
      this.emit('update', { at: this.status.quotesAt });
    } catch (e) {
      this.status.errors.quotes = e.message;
      throw e;
    } finally { this.busy.quotes = false; }
  }

  // 美股：先用 105/106/107 三个候选市场一起查，记住哪个市场有这只股票
  async resolveUs(symbols) {
    const need = symbols.filter((s) => !this.usSecids[s]);
    if (need.length) {
      const cands = need.flatMap((s) => US_MARKETS.map((m) => `${m}.${s}`));
      const list = await this.provider.quotes(cands);
      for (const q of list) {
        const sym = q.secid.split('.')[1];
        if (q.price != null && !this.usSecids[sym]) this.usSecids[sym] = q.secid;
      }
      this.store.write('us-secids.json', this.usSecids);
    }
  }

  async refreshUs() {
    if (this.busy.us) return;
    this.busy.us = true;
    try {
      const symbols = [...new Set(this.pool.list().map((p) => p.us && p.us.symbol).filter(Boolean))];
      await this.resolveUs(symbols);
      const secids = symbols.map((s) => this.usSecids[s]).filter(Boolean).concat(US_INDICES.map((i) => i.secid));
      const list = await this.provider.quotes(secids);
      const bySecid = new Map(list.map((q) => [q.secid, q]));
      this.us = {};
      for (const s of symbols) { const q = bySecid.get(this.usSecids[s]); if (q && q.price != null) this.us[s] = q; }
      this.usIdx = US_INDICES.map((i) => ({ name: i.name, q: bySecid.get(i.secid) || null }));
      this.status.usAt = Date.now();
      delete this.status.errors.us;
    } catch (e) {
      this.status.errors.us = e.message;
      throw e;
    } finally { this.busy.us = false; }
  }

  // ---------- 成交额对比（较昨日同一时刻） ----------
  async refreshVolume() {
    if (this.busy.volume || !this.provider.intraday) return;
    this.busy.volume = true;
    try {
      const secids = this.pool.list().map((p) => secidOf(p.code)).concat(CN_INDICES.map((m) => m.secid));
      let ok = 0, lastErr = null;
      await inBatches(secids, 6, async (id) => {
        try { const days = await this.provider.intraday(id); this.minutes[id] = days; const c = compare(days); if (c) { this.vol[id] = c; ok++; } } catch (e) { lastErr = e; }
      });
      if (ok) { delete this.status.errors.volume; this.emit('update', { at: Date.now() }); }
      else if (lastErr) { this.status.errors.volume = lastErr.message; throw lastErr; }
    } finally { this.busy.volume = false; }
  }

  // 大盘五个指数的分时更频繁地刷新（图要看着走）
  async refreshIndexMinutes() {
    if (this.busy.idxmin || !this.provider.intraday) return;
    this.busy.idxmin = true;
    try {
      await inBatches(CN_INDICES.map((m) => m.secid), 5, async (id) => {
        try { const days = await this.provider.intraday(id); this.minutes[id] = days; const c = compare(days); if (c) this.vol[id] = c; } catch (e) { /* 下次再试 */ }
      });
      this.emit('update', { at: Date.now() });
    } finally { this.busy.idxmin = false; }
  }

  // 财联社看盘的「盘中锚点」：全市场题材，不受自选股池限制。
  async refreshHotspots(date = sh().date) {
    if (this.busy.hotspots || !this.hotspotSource || !this.hotspotSource.anchors) return;
    this.busy.hotspots = true;
    try {
      const events = await this.hotspotSource.anchors(date);
      this.hotspots = { date, events, at: Date.now() };
      delete this.status.errors.hotspots;
      this.emit('update', { at: this.hotspots.at });
    } catch (e) {
      this.status.errors.hotspots = e.message;
      throw e;
    } finally { this.busy.hotspots = false; }
  }

  // 大盘分时：某个交易日的指数分时 + 当天的板块异动点。date 形如 20261030，不给就取最新一天
  intraday(secid, date) {
    const days = this.minutes[secid];
    const meta = CN_INDICES.find((m) => m.secid === secid);
    if (!meta) return { error: '只支持大盘五个指数' };
    if (!days || !days.length) return { error: '分时数据还没有取到，稍等片刻（模拟数据没有分时）' };
    // 前收 = 前一个交易日的最后一个价格，所以最老的一天算不出涨跌幅，不提供
    const dates = days.slice(0, -1).map((d) => d.date);
    const d = date && dates.includes(date) ? date : dates[0];
    const k = days.findIndex((x) => x.date === d), day = days[k], prev = days[k + 1];
    // [HHMM, 价格, 当分钟成交额(亿), 累计成交额(亿)]；累计额是整天连续累加的，相邻两点相减就是这一分钟的成交额
    const pts = day.pts.map(([t, cum, px], i) => [t, px, (cum - (i ? day.pts[i - 1][1] : 0)) / 1e8, cum / 1e8]);
    const prevClose = prev.pts[prev.pts.length - 1][2];
    const stocks = [];
    for (const p of this.pool.list()) {
      const sd = this.minutes[secidOf(p.code)];
      const a = sd && sd.find((x) => x.date === d), b = sd && sd[sd.findIndex((x) => x.date === d) + 1];
      if (!a || !b || !b.pts.length) continue;
      stocks.push({ sector: p.sector, prev: b.pts[b.pts.length - 1][2], px: new Map(a.pts.map(([t, , px]) => [t, px])) });
    }
    const priceAt = new Map(day.pts.map((x) => [x[0], x[2]]));
    const clsDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
    const clsEvents = this.hotspots.date === clsDate
      ? this.hotspots.events.filter((e) => priceAt.has(e.t)).map((e) => ({ ...e, price: priceAt.get(e.t) }))
      : [];
    // 有财联社的全市场题材时优先显示；接口临时不可用时保留原有股池异动作为后备。
    const poolEvents = sectorEvents(stocks, day.pts.map((x) => x[0])).map((e) => ({ ...e, source: 'pool', price: priceAt.get(e.t) }));
    const events = clsEvents.length ? clsEvents : poolEvents;
    return { secid, name: meta.name, date: d, dates, prevClose, pts, events, eventSource: clsEvents.length ? 'cls' : 'pool', live: k === 0 };
  }

  // ---------- 新闻 ----------
  async refreshNews() {
    if (this.busy.news) return;
    this.busy.news = true;
    try {
      const days = this.settings.get().newsDays;
      const since = sh(new Date(Date.now() - days * 864e5)).str;
      const data = {};
      await inBatches(this.pool.list(), 3, async (p) => {
        const arr = await this.provider.news(p.name, 30);
        const seen = new Set();
        data[p.code] = arr
          .filter((a) => a.time >= since && a.title.includes(p.name) && !JUNK.test(a.title))
          .filter((a) => { const k = a.title.replace(/[^一-龥]/g, '').slice(0, 12); if (seen.has(k)) return false; seen.add(k); return true; })
          .slice(0, 8);
      });
      // 个别股票这次取失败时，保留旧新闻
      for (const p of this.pool.list()) if (!data[p.code] && this.news.data[p.code]) data[p.code] = this.news.data[p.code];
      this.news = { at: Date.now(), data };
      this.store.write('news.json', this.news);
      this.status.newsAt = this.news.at;
      this.emit('news', { at: this.news.at });
    } finally { this.busy.news = false; }
  }

  // 新增股票后立即补齐它的数据
  async refreshStock(code) {
    this.loadBarsFromDisk(code);
    const limit = this.settings.get().historyDays;
    if (this.barsStale(code)) {
      const bars = await this.provider.kline(secidOf(code), limit);
      if (bars.length) {
        this.bars[code] = bars; this.barsAt[code] = Date.now();
        this.store.write(`kline/${code}.json`, { fetchedAt: this.barsAt[code], bars });
      }
    }
    await this.refreshQuotes().catch(() => {});
    this.compute();
    // 新股票的对标美股、新闻、成交额对比不等下一轮调度，马上补上
    for (const f of [() => this.refreshUs(), () => this.refreshNews(), () => this.refreshVolume()]) f().catch(() => {});
  }

  forget(code) {
    delete this.bars[code]; delete this.barsAt[code]; delete this.quotes[code]; delete this.news.data[code];
    this.compute();
  }

  // ---------- 计算 ----------
  withLive(code) {
    const base = (this.bars[code] || []).slice();
    const q = this.quotes[code];
    if (!q || !q.price || !q.open || !q.time) return base;
    const day = sh(new Date(q.time)).date;
    while (base.length && base[base.length - 1].day >= day) base.pop();
    base.push({ day, open: q.open, high: q.high, low: q.low, close: q.price, amount: (q.amount || 0) / 1e8 });
    return base;
  }

  compute() {
    const live = {}; this.an = {}; this.flow = {};
    for (const code of this.pool.codes()) {
      live[code] = this.withLive(code); this.an[code] = IND.analyze(live[code]);
      this.flow[code] = IND.flowStatus(live[code], IND.flowTrend(live[code])); // 量能趋势（成交额），见 indicators.js
    }
    this.live = live;
    const s = this.settings.get();
    this.index = IND.poolIndex(live, s.indexBase, s.indexBaseDate);
    this.indexStatus = this.index.length > 60 ? IND.indexStatus(this.index) : null;
  }

  // ---------- 对外视图 ----------
  usView(p) {
    if (!p.us) return null;
    const q = this.us[p.us.symbol];
    return { ...p.us, price: q ? q.price : null, chg: q ? q.chg : null, time: q ? q.time : null };
  }

  row(p) {
    const q = this.quotes[p.code] || {}, a = this.an[p.code] || {};
    return {
      code: p.code, name: p.name, sector: p.sector,
      px: q.price ?? null, chg: q.chg ?? null, amount: q.amount != null ? q.amount / 1e8 : null, pe: q.pe ?? null,
      trend: a.trend, macdState: a.macdState, rsi: a.rsi, rsiState: a.rsiState,
      s1: a.s1, s2: a.s2, r1: a.r1, r2: a.r2, r20: a.r20, ytd: a.ytd,
      ma20: a.ma ? a.ma[20] : null, ma60: a.ma ? a.ma[60] : null,
      flow: (this.flow && this.flow[p.code]) ? { state: this.flow[p.code].state, slope: this.flow[p.code].slope, level: this.flow[p.code].level, bias: this.flow[p.code].bias, flags: this.flow[p.code].flags.map((f) => f.split('（')[0]) } : null,
      vol: this.vol[secidOf(p.code)] || null, us: this.usView(p), newsCount: (this.news.data[p.code] || []).length
    };
  }

  // 涨跌停价：前收 ×(1±幅度) 四舍五入到分。幅度：创业板/科创板 20%，ST 5%，北交所 30%，其余 10%
  limitPct(p) {
    if (/^(300|301|688)/.test(p.code)) return 20;
    if (/^(8|4|920)/.test(p.code)) return 30;
    return /ST/i.test(p.name) ? 5 : 10;
  }

  // 股池合计：只统计有对比数据且日期一致的股票
  volSum(rows) {
    const vs = rows.map((r) => r.vol).filter(Boolean);
    if (!vs.length) return null;
    const date = vs[0].date, use = vs.filter((v) => v.date === date);
    const today = use.reduce((t, v) => t + v.today, 0), prev = use.reduce((t, v) => t + v.prev, 0);
    return { date, prevDate: use[0].prevDate, time: use[0].time, today, prev, diff: today - prev, pct: prev > 0 ? (today / prev - 1) * 100 : null, n: use.length };
  }

  // 股池里的涨停/跌停、涨跌家数、平均涨跌幅、最强最弱
  breadth(rows) {
    const live = rows.filter((r) => r.chg != null);
    const hit = { up: [], down: [] };
    for (const r of live) {
      const q = this.quotes[r.code], L = this.limitPct(r);
      if (!q || q.prevClose == null || q.price == null) continue;
      const pr = (k) => Math.round(q.prevClose * (1 + k * L / 100) * 100) / 100;
      if (q.price >= pr(1) - 1e-6) hit.up.push({ code: r.code, name: r.name, chg: r.chg });
      else if (q.price <= pr(-1) + 1e-6) hit.down.push({ code: r.code, name: r.name, chg: r.chg });
    }
    const by = [...live].sort((a, b) => b.chg - a.chg);
    const pick = (r) => (r ? { code: r.code, name: r.name, chg: r.chg } : null);
    return {
      up: live.filter((r) => r.chg > 0).length, down: live.filter((r) => r.chg < 0).length,
      flat: live.filter((r) => r.chg === 0).length, total: rows.length,
      limitUp: hit.up, limitDown: hit.down,
      avg: live.length ? live.reduce((t, r) => t + r.chg, 0) / live.length : null,
      best: pick(by[0]), worst: pick(by[by.length - 1]),
      amount: live.reduce((t, r) => t + (r.amount || 0), 0),
      vol: this.volSum(rows)
    };
  }

  overview() {
    const rows = this.pool.list().map((p) => this.row(p));
    const last = this.index[this.index.length - 1];
    return {
      mock: !!this.provider.mock, provider: this.provider.name,
      status: { ...this.status },
      market: this.cnIdx.map((m, i) => ({ name: m.name, price: m.q && m.q.price, chg: m.q && m.q.chg, vol: this.vol[CN_INDICES[i].secid] || null })),
      breadth: this.breadth(rows),
      index: this.indexStatus ? { ...this.indexStatus, n: last ? last.n : 0 } : null,
      rows
    };
  }

  stock(code) {
    const p = this.pool.get(code);
    if (!p) return null;
    return {
      item: p, quote: this.quotes[code] || null, analysis: this.an[code] || null, bars: this.live[code] || [],
      news: this.news.data[code] ? annotate(this.news.data[code]) : null, us: this.usView(p)
    };
  }

  // 在线选股：每只股票仅展示最近一组“双金叉启动”信号。
  doubleGoldenCross() {
    const out = [];
    for (const p of this.pool.list()) {
      const bars = this.live[p.code] || [];
      // “启动”只看最近 10 个交易日完成的信号，避免历史交叉长期留在候选里。
      const pair = IND.doubleGoldenCross(bars).filter((x) => x.signalIndex >= bars.length - 10).at(-1);
      const trend = IND.bullishAboveBBI(bars);
      if (!pair || !trend.ok) continue;
      const q = this.quotes[p.code] || {}, a = this.an[p.code] || {};
      out.push({
        code: p.code, name: p.name, sector: p.sector, px: q.price ?? null, chg: q.chg ?? null,
        macdDay: bars[pair.macdIndex].day, flowDay: bars[pair.flowIndex].day,
        signalDay: bars[pair.signalIndex].day, gap: Math.abs(pair.macdIndex - pair.flowIndex),
        macd: a.macdState || null, flow: this.flow[p.code] ? this.flow[p.code].state : null,
        bbi: trend.bbi
      });
    }
    return out.sort((a, b) => b.signalDay.localeCompare(a.signalDay) || (b.chg || -Infinity) - (a.chg || -Infinity));
  }

  // 查询指定日期的涨停复盘原因。数据按日期整包缓存，多个个股悬停不会重复联网。
  async limitReason(code, day) {
    if (!this.pool.has(code)) return null;
    if (!this.limitReasonDays.has(day)) this.limitReasonDays.set(day, reasonsOn(day).catch((e) => ({ error: e.message })));
    const dayData = await this.limitReasonDays.get(day);
    if (dayData && dayData.error) return { reason: null, source: '同花顺涨停复盘', error: dayData.error };
    const hit = dayData.get(code);
    return hit ? { ...hit, date: day } : { reason: null, source: '同花顺涨停复盘', date: day };
  }

  // 带利好/利空/中性标记的新闻（按标题判断，现算，不写盘）
  newsView() {
    const data = {};
    for (const [code, arr] of Object.entries(this.news.data)) data[code] = annotate(arr);
    return { at: this.news.at, data };
  }
}

module.exports = { Service, inBatches, JUNK };
