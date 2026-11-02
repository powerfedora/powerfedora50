// 模拟数据提供方：不联网，用确定性的随机游走生成行情，供演示和测试。
// 用 `npm run demo` 启动；页面顶部会显示"模拟数据"提示，避免和真实行情混淆。
const { sh, addDays } = require('./time');

function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }

function lastWeekday(date) {
  let d = date;
  for (;;) { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); if (wd !== 0 && wd !== 6) return d; d = addDays(d, -1); }
}

function makeBars(secid, limit, endDay) {
  const r = rng(hash(secid));
  const isIdx = secid.startsWith('100.') || /^[01]\.(0003|3990|0006)/.test(secid);
  let px = isIdx ? 2000 + r() * 6000 : 8 + r() * 180;
  const vol = isIdx ? 0.009 : 0.02, drift = 0.0002;
  const days = []; let d = lastWeekday(endDay);
  while (days.length < limit) { days.push(d); d = lastWeekday(addDays(d, -1)); }
  days.reverse();
  return days.map((day) => {
    const open = px * (1 + gauss(r) * vol * 0.4);
    const close = open * (1 + drift + gauss(r) * vol);
    const high = Math.max(open, close) * (1 + r() * vol * 0.6), low = Math.min(open, close) * (1 - r() * vol * 0.6);
    px = close;
    return { day, open: +open.toFixed(2), close: +close.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), amount: +(px * (3e6 + r() * 6e6) / 1e8).toFixed(2) };
  });
}

function create({ names = {} } = {}) {
  const cache = new Map();
  const bars = (secid, limit = 760) => {
    const key = secid + ':' + limit;
    if (!cache.has(key)) cache.set(key, makeBars(secid, limit, sh().date));
    return cache.get(key);
  };
  return {
    name: 'mock', mock: true,
    async quotes(secids) {
      return secids.map((secid) => {
        const b = bars(secid), t = b[b.length - 1], p = b[b.length - 2];
        const code = secid.split('.')[1], r = rng(hash(secid + 'q'));
        const day = t.day, ts = Date.parse(day + 'T07:00:00Z'); // 15:00 北京时间
        return {
          secid, code, name: names[secid] || names[code] || code,
          price: t.close, chg: +((t.close / p.close - 1) * 100).toFixed(2), chgAmt: +(t.close - p.close).toFixed(2),
          vol: Math.round(r() * 1e6), amount: t.amount * 1e8, turnover: +(r() * 5).toFixed(2), pe: +(10 + r() * 40).toFixed(1),
          high: t.high, low: t.low, open: t.open, prevClose: p.close, mcap: 1e10 + r() * 1e12, pb: +(1 + r() * 8).toFixed(2), time: ts
        };
      });
    },
    async kline(secid, limit) { return bars(secid, limit).slice(-limit); },
    async news(keyword) {
      const r = rng(hash(keyword)), n = Math.floor(r() * 4);
      const topics = ['发布三季度业绩预告', '获机构上调目标价', '签订重大销售合同', '回应市场关注的产能问题', '披露最新调研纪要'];
      const now = Date.now();
      return Array.from({ length: n }, (_, i) => ({
        time: sh(new Date(now - (i * 11 + 2 + r() * 9) * 3600e3)).str.slice(0, 16),
        title: `【模拟数据】${keyword}${topics[Math.floor(r() * topics.length)]}`,
        media: '模拟', url: ''
      }));
    }
  };
}

module.exports = { create };
