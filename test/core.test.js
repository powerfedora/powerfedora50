const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const IND = require('../public/js/indicators');
const mock = require('../src/mock');
const { build, createServer } = require('../src/app');
const { generate, toMarkdown } = require('../src/report');
const { Scheduler } = require('../src/scheduler');
const { addDays, hmToMin, isTradingTime, sh } = require('../src/time');
const { sign, parseAnchor } = require('../src/cls');
const { secidOf } = require('../src/pool');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-test-'));
const mkCtx = () => build({ dataDir: tmp(), provider: (pool) => mock.create({ names: Object.fromEntries(pool.list().map((p) => [p.code, p.name])) }) });

test('时间：北京时间交易时段判断', () => {
  assert.equal(addDays('2026-10-30', 1), '2026-10-31');
  assert.equal(hmToMin('08:00'), 480);
  assert.equal(hmToMin('25x'), null);
  assert.ok(isTradingTime(new Date('2026-10-30T02:00:00Z')));   // 周五 10:00 北京
  assert.ok(!isTradingTime(new Date('2026-10-30T04:30:00Z')));  // 12:30 午休
  assert.ok(!isTradingTime(new Date('2026-10-31T02:00:00Z')));  // 周六
  assert.equal(sh(new Date('2026-10-29T16:30:00Z')).date, '2026-10-30'); // 跨日按北京时间
});

test('财联社题材锚点：签名与盘中时间格式', () => {
  assert.equal(sign({ app: 'CailianpressWeb', cdate: '2026-11-02', os: 'web', sv: '8.7.9' }), 'b439fc9c03979a42d7f812bd6656d693abce963b');
  assert.deepEqual(parseAnchor({ c_time: '2026-11-02 09:38:30', symbol_name: '人形机器人', symbol_code: 'cls82064', float: 'down' }), {
    t: '0938', sector: '人形机器人', dir: 'down', source: 'cls', symbolCode: 'cls82064'
  });
  assert.equal(parseAnchor({ c_time: '时间未知', symbol_name: '证券' }), null);
});

test('指标：均线、MACD、等权指数和基点日期', () => {
  assert.deepEqual(IND.sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const bbi = IND.bbi(Array.from({ length: 24 }, (_, i) => i + 1));
  assert.equal(bbi[22], null);
  assert.equal(bbi[23], (23 + 21.5 + 18.5 + 12.5) / 4);
  const boll = IND.boll(Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(boll.mid[18], null);
  assert.ok(Math.abs(boll.mid[19] - 10.5) < 1e-10);
  assert.ok(Math.abs((boll.upper[19] + boll.lower[19]) / 2 - boll.mid[19]) < 1e-10);
  const bars = (start) => Array.from({ length: 80 }, (_, i) => { const c = start + i; return { day: `2026-01-${String(i + 1).padStart(2, '0')}`, open: c, close: c, high: c + 1, low: c - 1, amount: 1 }; });
  const idx = IND.poolIndex({ a: bars(10), b: bars(20) }, 1000);
  assert.equal(idx[0].close, 1000);
  assert.ok(idx[10].close > 1000);
  const rebased = IND.poolIndex({ a: bars(10) }, 1000, idx[5].day);
  assert.ok(Math.abs(rebased.find((b) => b.day === idx[5].day).close - 1000) < 1e-9);
  const an = IND.analyze(bars(10));
  assert.equal(an.trend, '多头');
  assert.ok(an.s1 < an.px && an.r1 >= an.px);
  assert.deepEqual(IND.doubleGoldenCross(bars(10)), []);
  assert.equal(IND.bullishAboveBBI(bars(10)).ok, true);
});

test('股池：初始 49 只、增删改和校验', () => {
  const { pool } = mkCtx();
  assert.equal(pool.items.length, 49);
  assert.ok(pool.has('600519') && !pool.has('000001'));
  assert.throws(() => pool.add({ code: '12345', name: 'x', sector: 'y' }), /6 位数字/);
  assert.throws(() => pool.add({ code: '600519', name: 'x', sector: 'y' }), /已经在股池里/);
  pool.add({ code: '000858', name: '五粮液', sector: '食品饮料', us: { symbol: 'deo', name: '帝亚吉欧' } });
  assert.equal(pool.get('000858').us.symbol, 'DEO');
  assert.throws(() => pool.update('000858', { us: { symbol: 'bad symbol!' } }), /美股代码/);
  pool.remove('000858');
  assert.ok(!pool.has('000858'));
  assert.equal(secidOf('510300'), '1.510300'); // 沪市 ETF
  assert.equal(secidOf('159915'), '0.159915'); // 深市 ETF
});

test('提醒：只对股池内股票；按穿越触发，不重复响', async () => {
  const c = mkCtx();
  assert.throws(() => c.alerts.add({ code: '000001', type: 'price_above', value: 10 }), /不在股池里/);
  await c.service.refreshHistory(); await c.service.refreshQuotes();
  const px = c.service.quotes['600519'].price;
  const above = c.alerts.add({ code: '600519', type: 'price_above', value: px + 1 });
  const below = c.alerts.add({ code: '600519', type: 'price_below', value: px + 5 }); // 已经成立 → 不应立即触发
  assert.equal(c.alerts.evaluate(c.service).length, 0); // 第一次只记录状态
  c.service.quotes['600519'].price = px + 2;
  const fired = c.alerts.evaluate(c.service);
  assert.deepEqual(fired.map((e) => e.ruleId), [above.id]);
  assert.equal(c.alerts.evaluate(c.service).length, 0);  // 条件持续成立，不重复
  assert.equal(c.alerts.rules.find((r) => r.id === above.id).active, false); // 一次性规则触发后停用
  assert.ok(below.active);
  assert.throws(() => c.alerts.add({ code: '600519', type: 'chg_below', value: 5 }), /负数/);
});

test('交易日志：成本、盈亏、超卖拦截、池外拦截', async () => {
  const c = mkCtx();
  const d = sh().date;
  assert.throws(() => c.journal.add({ code: '000001', side: 'buy', price: 10, qty: 100 }), /不在股池里/);
  c.journal.add({ code: '600519', side: 'buy', price: 60, qty: 200, fee: 5, date: d });
  assert.throws(() => c.journal.add({ code: '600519', side: 'sell', price: 70, qty: 300, date: d }), /只持有 200 股/);
  c.journal.add({ code: '600519', side: 'sell', price: 70, qty: 100, fee: 5, date: d });
  const s = c.journal.summary(null);
  assert.equal(s.holdings[0].qty, 100);
  assert.equal(s.totals.realized, 992.5); // (70 - 60.025) * 100 - 5
  assert.equal(s.stats.winRate, 100);
  const buy = c.journal.entries.find((e) => e.side === 'buy');
  assert.throws(() => c.journal.remove(buy.id), /超过持仓/); // 删买入会让卖出变成无本之木
});

test('晨报：生成内容、要点、Markdown，调度补生成', async () => {
  const c = mkCtx();
  await c.service.refreshHistory();
  const r = await generate(c.service, { now: new Date() });
  assert.equal(r.bench.length, 49);
  assert.equal(r.usIndices.length, 4);
  assert.ok(r.highlights.some((h) => h.startsWith('隔夜美股')));
  assert.match(toMarkdown(r), /PowerFedora50 晨报/);
  const sch = new Scheduler({ service: c.service, reports: c.reports, clock: () => new Date('2026-10-30T03:00:00Z') }); // 11:00，晚于 8:00
  c.settings.update({ reportTime: '08:00' });
  await sch.makeReport(true);
  assert.ok(c.reports.has(sh().date));
  assert.ok(c.reports.latest().warnings[0].includes('补生成'));
});

test('设置：拒绝非法值', () => {
  const { settings } = mkCtx();
  assert.throws(() => settings.update({ reportTime: '99' }), /不合法/);
  assert.throws(() => settings.update({ nope: 1 }), /未知设置项/);
  assert.equal(settings.update({ quotePollSec: 30 }).quotePollSec, 30);
});

test('接口：端到端、跨站拦截、路径穿越', async (t) => {
  const c = mkCtx();
  await c.service.refreshHistory(); await c.service.refreshQuotes();
  const server = createServer(c);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, body, headers = {}) => {
    const res = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const ov = await call('GET', '/api/overview');
  assert.equal(ov.status, 200); assert.equal(ov.body.rows.length, 49); assert.ok(ov.body.index);
  assert.equal((await call('GET', '/api/stock/600519')).status, 200);
  assert.equal((await call('GET', '/api/stock/000001')).status, 404);
  assert.equal((await call('POST', '/api/journal', { code: '000001', side: 'buy', price: 1, qty: 1 })).status, 400);
  assert.equal((await call('POST', '/api/alerts', { code: '600519', type: 'ma_up', ma: 20 })).status, 200);
  assert.equal((await call('POST', '/api/pool', { code: '600519', sector: 'x' })).status, 409);
  const add = await call('POST', '/api/pool', { code: '000858', sector: '食品饮料' });
  assert.equal(add.status, 200); assert.equal(add.body.count, 50);
  const del = await call('DELETE', '/api/pool/000858');
  assert.equal(del.status, 200); assert.equal(del.body.count, 49);
  assert.equal((await call('GET', '/api/overview', null, { Origin: 'http://evil.example' })).status, 403);
  const trav = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: server.address().port, path: '/..%2f..%2fpackage.json' }, (res) => resolve(res.statusCode)));
  assert.ok(trav === 403 || trav === 404);
  const html = await fetch(base + '/'); assert.match(await html.text(), /PowerFedora50/);
});

test('腾讯备用源：解析行情和日线，主源失败时自动切换', async () => {
  const tencent = require('../src/tencent');
  const fallback = require('../src/fallback');
  const f = new Array(50).fill('');
  Object.assign(f, { 1: '贵州茅台', 3: '1371.94', 4: '1354.00', 5: '1363.00', 6: '21035', 30: '20261030102601', 31: '17.94', 32: '1.32', 33: '1376.00', 34: '1352.98', 37: '287580', 45: '17150.37' });
  const [q] = tencent.parseQuotes(`v_sh600519="${f.join('~')}";`);
  assert.equal(q.secid, '1.600519');
  assert.equal(q.chg, 1.32);
  assert.equal(q.amount, 287580 * 1e4);
  assert.equal(q.time, Date.parse('2026-10-30T10:26:01+08:00'));
  const bars = tencent.parseKline('sh600519', { data: { sh600519: { qfqday: [['2026-10-29', '10', '11', '12', '9', '100000']] } } }, 5);
  assert.deepEqual(bars[0], { day: '2026-10-29', open: 10, close: 11, high: 12, low: 9, amount: 1.05 });
  assert.equal(tencent.supports('105.AAPL'), false);

  const bad = { name: 'p', async quotes() { throw new Error('x'); }, async kline() { throw new Error('x'); }, async news() { return []; } };
  const bk = { name: 'b', supports: tencent.supports, async quotes(s) { return s.map((x) => ({ secid: x })); }, async kline() { return [1]; } };
  const p = fallback.create(bad, bk);
  assert.deepEqual(await p.kline('1.600519', 5), [1]);
  assert.deepEqual(await p.quotes(['1.600519', '105.AAPL']), [{ secid: '1.600519' }]);
  await assert.rejects(p.quotes(['105.AAPL']));
});

test('新闻利好/利空/中性：按标题措辞判断', () => {
  const { classify } = require('../src/sentiment');
  const c = (t) => classify(t).label;
  assert.equal(c('扬杰科技：前三季度净利润12.33亿元，同比增长26.67%'), 'bull');
  assert.equal(c('金诚信：拟3.00亿元至4.00亿元回购公司股份'), 'bull');
  assert.equal(c('海尔智家：前三季度净利润同比减少13.67%'), 'bear');
  assert.equal(c('盐津铺子前三季度增收不增利'), 'bear');
  assert.equal(c('CPO板块低开 天孚通信、新易盛均低开超10%'), 'bear');
  assert.equal(c('宏发股份：关于召开2026年第三季度业绩说明会的公告'), 'neutral');
  assert.equal(c('Q3业绩表现不及部分券商预期 青岛啤酒控股股东小幅增持'), 'neutral');
  assert.equal(c('某公司扭亏为盈'), 'bull');
});

test('股池涨停/跌停：按各板块涨跌停幅度判断', () => {
  const { Service } = require('../src/service');
  const svc = Object.create(Service.prototype);
  svc.quotes = {
    '600000': { price: 11.0, prevClose: 10.0 }, '300001': { price: 12.0, prevClose: 10.0 },
    '300002': { price: 10.9, prevClose: 10.0 }, '600003': { price: 9.0, prevClose: 10.0 }
  };
  svc.limitPct = Service.prototype.limitPct;
  const rows = [['600000', 10], ['300001', 20], ['300002', 9], ['600003', -10]].map(([code, chg]) => ({ code, name: code, chg, amount: 1 }));
  const b = svc.breadth(rows);
  assert.deepEqual(b.limitUp.map((x) => x.code), ['600000', '300001']);
  assert.deepEqual(b.limitDown.map((x) => x.code), ['600003']);
  assert.equal(b.up, 3);
});

test('涨停复盘原因：解析同花顺按日返回的题材标签', async () => {
  const { reasonsOn } = require('../src/limit-reason');
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ errocode: 0, data: [{ code: '000001', reason: '银行+金融科技' }] }) });
  try {
    const rows = await reasonsOn('2025-02-27');
    assert.deepEqual(rows.get('000001'), { reason: '银行+金融科技', source: '同花顺涨停复盘' });
  } finally { global.fetch = oldFetch; }
});

test('成交额对比：今天到现在 vs 上一交易日同一时刻', () => {
  const { compare } = require('../src/volume');
  const days = [
    { date: '20261030', pts: [['0930', 1e8], ['0931', 3e8], ['0932', 5e8]] },
    { date: '20261029', pts: [['0930', 2e8], ['0931', 3e8], ['0932', 4e8], ['0933', 9e8]] }
  ];
  const c = compare(days);
  assert.equal(c.time, '0932');
  assert.equal(c.prev, 4);
  assert.equal(c.today, 5);
  assert.equal(c.diff, 1);
  assert.equal(c.pct, 25);
  assert.equal(compare([{ date: '1', pts: [] }, days[1]]), null);
});

test('量能趋势线：只看成交额，稳步放量/缩量能分开，单日暴量不算趋势', () => {
  const mk = (n, f) => Array.from({ length: n }, (_, i) => { const o = f(i); return { day: String(i), open: o.open, close: o.close, high: o.high, low: o.low, amount: o.amount }; });
  const bar = (p, amount, up = true) => ({ open: p, close: up ? p + 0.03 : p - 0.03, high: p + 0.05, low: p - 0.05, amount });
  // 价格横盘，成交额从 5 稳步增到 12（堆量）
  const rise = mk(120, (i) => bar(10 + (i % 2) * 0.01, 5 + Math.max(0, i - 60) * 0.12, i % 3 !== 0));
  const sR = IND.flowStatus(rise, IND.flowTrend(rise));
  assert.equal(sR.state, '稳步放量');
  assert.ok(sR.flags.includes('堆量') || sR.flags.includes('疑似吸筹'), JSON.stringify(sR.flags));
  // 价格不变、成交额稳步萎缩
  const shrink = mk(120, (i) => bar(10, Math.max(1.5, 12 - Math.max(0, i - 40) * 0.12), i % 2 === 0));
  assert.equal(IND.flowStatus(shrink, IND.flowTrend(shrink)).state, '稳步缩量');
  // 成交额平稳，只有一天 20 倍暴量：封顶后不应判成放量趋势
  const spike = mk(120, (i) => bar(10, i === 100 ? 100 : 5, i % 2 === 0));
  assert.ok(/走平|震荡/.test(IND.flowStatus(spike, IND.flowTrend(spike)).state), IND.flowStatus(spike, IND.flowTrend(spike)).state);
  // 放量下跌要单独标出
  const crash = mk(120, (i) => (i < 100 ? bar(10, 5, i % 2 === 0) : { open: 10 - (i - 100) * 0.1, close: 10 - (i - 100) * 0.1 - 0.1, high: 10.1 - (i - 100) * 0.1, low: 9.85 - (i - 100) * 0.1, amount: 5 + (i - 100) * 0.5 }));
  const sC = IND.flowStatus(crash, IND.flowTrend(crash));
  assert.ok(sC.flags.some((f) => f.startsWith('放量下跌')) && sC.bias === 'bear', JSON.stringify(sC));
  // 放量下跌：价格 20 日跌 8%，阴阳线成交额差不多、量在放大，也要标出
  const fall = mk(120, (i) => (i < 100 ? bar(10, 5, i % 2 === 0) : { open: 10 - (i - 100) * 0.04 + 0.02, close: 10 - (i - 100) * 0.04 - 0.02 + (i % 2 ? 0.05 : 0), high: 10.1 - (i - 100) * 0.04, low: 9.9 - (i - 100) * 0.04, amount: 5 + (i - 100) * 0.4 }));
  const sF = IND.flowStatus(fall, IND.flowTrend(fall));
  assert.ok(sF.flags.some((f) => f.startsWith('放量下跌')), JSON.stringify(sF));
  assert.equal(IND.flowStatus(rise.slice(0, 30), IND.flowTrend(rise.slice(0, 30))), null);
});

test('板块异动：5 分钟内板块平均涨幅超过阈值才标记，成员太少的板块不算', () => {
  const { sectorEvents } = require('../src/movers');
  const times = Array.from({ length: 40 }, (_, i) => '09' + String(30 + (i % 30)).padStart(2, '0')).map((t, i) => (i < 30 ? t : '10' + String(i - 30).padStart(2, '0')));
  const flat = new Map(times.map((t) => [t, 10]));
  const jump = new Map(times.map((t, i) => [t, i >= 20 ? 10.3 : 10])); // 第 20 分钟起 +3%
  const stocks = [
    { sector: 'A', prev: 10, px: jump }, { sector: 'A', prev: 10, px: jump },
    { sector: 'B', prev: 10, px: flat }, { sector: 'B', prev: 10, px: flat },
    { sector: 'C', prev: 10, px: jump } // 只有 1 只，不算
  ];
  const ev = sectorEvents(stocks, times);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].sector, 'A');
  assert.equal(ev[0].dir, 'up');
});
