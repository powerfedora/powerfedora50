// 晨报：隔夜美股大盘 + 对标美股涨跌 + 股池新闻（前一天 8:00 到现在）+ 股池指数位置
const { sh, addDays, isDate } = require('./time');
const { annotate } = require('./sentiment');

const SENTI = { bull: '利好', bear: '利空', neutral: '中性' };

const fmtPct = (v) => (v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%');
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

async function generate(service, { now = new Date(), refresh = true } = {}) {
  const warnings = [];
  if (refresh) {
    for (const [name, fn] of [['美股行情', () => service.refreshUs()], ['A 股行情', () => service.refreshQuotes()], ['新闻', () => service.refreshNews()]]) {
      try { await fn(); } catch (e) { warnings.push(`${name}更新失败：${e.message}，使用的是上一次的数据`); }
    }
  }
  const t = sh(now);
  const from = `${addDays(t.date, -1)} 08:00`;
  const items = service.pool.list();

  const usIndices = service.usIdx.map((m) => ({ name: m.name, price: m.q && m.q.price, chg: m.q && m.q.chg, time: m.q && m.q.time }));
  const bench = items.filter((p) => p.us).map((p) => {
    const u = service.usView(p), q = service.quotes[p.code];
    return { code: p.code, name: p.name, sector: p.sector, cnChg: q ? q.chg : null, us: u };
  });
  const withUs = bench.filter((b) => b.us.chg != null);
  // 美股和 A 股行情都完全没有时不出报告：否则一份空晨报会占掉当天的名额，真正的晨报就不再生成了
  if (refresh && !withUs.length && !usIndices.some((m) => m.price != null)) {
    throw new Error('行情数据源暂时不可用（' + (warnings[0] || '没有取到美股行情') + '），晨报没有生成，稍后会自动重试');
  }
  if (items.some((p) => p.us) && !withUs.length) warnings.push('没有取到对标美股的行情');
  const newest = Math.max(0, ...service.usIdx.map((m) => (m.q && m.q.time) || 0));
  if (newest && now.getTime() - newest > 4 * 864e5) warnings.push('美股行情时间比较旧，可能遇到长假或数据延迟');

  const news = [];
  for (const p of items) {
    const arr = (service.news.data[p.code] || []).filter((n) => n.time >= from);
    if (arr.length) news.push({ code: p.code, name: p.name, sector: p.sector, items: annotate(arr) });
  }
  news.sort((a, b) => b.items[0].time.localeCompare(a.items[0].time));

  // 要点
  const hl = [];
  const idxLine = usIndices.filter((m) => m.chg != null).map((m) => `${m.name} ${fmtPct(m.chg)}`).join('，');
  if (idxLine) hl.push(`隔夜美股：${idxLine}。`);
  const uniq = new Map();
  withUs.forEach((b) => { if (!uniq.has(b.us.symbol)) uniq.set(b.us.symbol, { ...b.us, names: [] }); uniq.get(b.us.symbol).names.push(b.name); });
  const movers = [...uniq.values()].sort((a, b) => b.chg - a.chg);
  const fmtMover = (m) => `${m.symbol} ${fmtPct(m.chg)}（${m.names.join('、')}）`;
  if (movers.length) {
    hl.push(`对标美股涨幅居前：${movers.slice(0, 3).map(fmtMover).join('；')}。`);
    hl.push(`对标美股跌幅居前：${movers.slice(-3).reverse().map(fmtMover).join('；')}。`);
  }
  const bySector = {};
  withUs.forEach((b) => { (bySector[b.sector] = bySector[b.sector] || []).push(b.us.chg); });
  const secs = Object.entries(bySector).map(([s, a]) => [s, avg(a)]).sort((a, b) => b[1] - a[1]);
  if (secs.length > 1) hl.push(`按板块平均，对标美股最强的是${secs[0][0]}（${fmtPct(secs[0][1])}），最弱的是${secs[secs.length - 1][0]}（${fmtPct(secs[secs.length - 1][1])}）。`);
  const watch = withUs.filter((b) => Math.abs(b.us.chg) >= 3);
  if (watch.length) hl.push(`对标美股单日波动超过 3%，开盘留意：${watch.map((b) => `${b.name}（${b.us.symbol} ${fmtPct(b.us.chg)}）`).join('、')}。`);
  const all = news.flatMap((n) => n.items.map((i) => ({ ...i, stock: n.name })));
  const cnt = (k) => all.filter((i) => i.sentiment.label === k).length;
  hl.push(news.length ? `${from} 以来，股池里有 ${news.length} 只股票出现个股新闻，共 ${all.length} 条（利好 ${cnt('bull')}、利空 ${cnt('bear')}、中性 ${cnt('neutral')}，按标题措辞自动判断）。` : `${from} 以来，股池股票没有出现新的个股新闻。`);
  const bearNames = [...new Set(all.filter((i) => i.sentiment.label === 'bear').map((i) => i.stock))];
  if (bearNames.length) hl.push(`出现利空新闻的股票：${bearNames.join('、')}。`);
  const st = service.indexStatus;
  if (st) {
    hl.push(`股池等权指数 ${st.close.toFixed(1)}（${fmtPct(st.chg)}），${st.align}，站上 ${st.nAbove}/6 条均线；` +
      `${st.res[0] ? '最近压力 ' + st.res[0][1] + ' ' + st.res[0][0].toFixed(1) : '上方无均线压力'}，${st.sup[0] ? '最近支撑 ' + st.sup[0][1] + ' ' + st.sup[0][0].toFixed(1) : '下方无支撑'}。`);
  }

  return {
    date: t.date, generatedAt: t.str, window: { from, to: t.str.slice(0, 16) }, mock: !!service.provider.mock,
    highlights: hl, usIndices,
    bench: bench.sort((a, b) => (b.us.chg ?? -Infinity) - (a.us.chg ?? -Infinity)),
    news,
    poolIndex: st ? { close: st.close, chg: st.chg, day: st.day, align: st.align, nAbove: st.nAbove, sup: st.sup, res: st.res, ddHigh: st.ddHigh } : null,
    warnings,
    disclaimer: '本报告由系统根据公开行情和新闻自动整理，点位和涨跌仅供复盘参考，不构成投资建议。'
  };
}

function toMarkdown(r) {
  const L = [`# PowerFedora50 晨报 ${r.date}`, '', `生成时间 ${r.generatedAt}${r.mock ? '（模拟数据）' : ''}　新闻窗口 ${r.window.from} → ${r.window.to}`, ''];
  if (r.warnings.length) L.push(...r.warnings.map((w) => `> ⚠ ${w}`), '');
  L.push('## 要点', ...r.highlights.map((h) => `- ${h}`), '');
  L.push('## 隔夜美股大盘', '| 指数 | 点位 | 涨跌 |', '|---|---|---|', ...r.usIndices.map((m) => `| ${m.name} | ${m.price ?? '—'} | ${fmtPct(m.chg)} |`), '');
  L.push('## 对标美股', '| 股池股票 | 对标美股 | 美股涨跌 | A 股上一交易日 | 对标理由 |', '|---|---|---|---|---|',
    ...r.bench.map((b) => `| ${b.name} ${b.code} | ${b.us.symbol} ${b.us.name} | ${fmtPct(b.us.chg)} | ${fmtPct(b.cnChg)} | ${b.us.reason} |`), '');
  L.push('## 股池新闻');
  if (!r.news.length) L.push('暂无。');
  r.news.forEach((n) => { L.push(`### ${n.name} ${n.code}`); n.items.forEach((i) => L.push(`- ${i.time.slice(5, 16)} 【${SENTI[(i.sentiment || {}).label] || '中性'}】${i.title}${i.media ? '（' + i.media + '）' : ''}`)); });
  L.push('', `_${r.disclaimer}_`);
  return L.join('\n');
}

class Reports {
  constructor(store) { this.store = store; }
  has(date) { return isDate(date) && this.store.read(`reports/${date}.json`, null) != null; }
  // 旧晨报没有利好/利空标记，读出来时补上
  get(date) {
    const r = isDate(date) ? this.store.read(`reports/${date}.json`, null) : null;
    if (r) for (const n of r.news || []) n.items = annotate(n.items);
    return r;
  }
  save(r) { this.store.write(`reports/${r.date}.json`, r); }
  dates() { return this.store.list('reports').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort().reverse(); }
  latest() { const d = this.dates()[0]; return d ? this.get(d) : null; }
}

module.exports = { generate, toMarkdown, Reports };
