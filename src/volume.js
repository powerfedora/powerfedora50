// 成交额对比：今天到现在的累计成交额，和上一个交易日同一时刻的累计成交额比
// days: [{date, pts:[[HHMM, 累计成交额(元)]]}]，最新一天在前（见 tencent.intraday）
// 收盘后/休市时，"今天"是最近一个交易日，对比的是整天。金额单位：亿元
function compare(days) {
  const [t, p] = days || [];
  if (!t || !t.pts.length || !p) return null;
  const [time, cum] = t.pts[t.pts.length - 1];
  let before = 0;
  for (const [m, v] of p.pts) { if (m <= time) before = v; else break; }
  const today = cum / 1e8, prev = before / 1e8;
  return { date: t.date, prevDate: p.date, time, today, prev, diff: today - prev, pct: prev > 0 ? (today / prev - 1) * 100 : null };
}

module.exports = { compare };
