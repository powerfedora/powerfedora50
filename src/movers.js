// 板块异动：用股池里各板块成员的分时价，算出每个板块的平均涨跌幅曲线，
// 某板块 5 分钟内平均涨幅（或跌幅）超过阈值，就在大盘分时图上标一个异动点。
// 注意：只统计股池里的股票，板块是股池的分类，不是财联社那种全市场题材。
// stocks: [{sector, prev(前收), px: Map(HHMM -> 价格)}]；times: 当天分钟列表（升序）
function sectorEvents(stocks, times, { win = 5, th = 0.8, gap = 20, max = 12, skip = 10 } = {}) {
  const by = {};
  for (const s of stocks) if (s.prev > 0 && s.px.size) (by[s.sector] = by[s.sector] || []).push(s);
  const out = [];
  for (const [sector, list] of Object.entries(by)) {
    if (list.length < 2) continue; // 只有 1 只的板块噪声太大
    const ser = times.map(() => null);
    const last = list.map(() => null);
    times.forEach((t, i) => {
      let sum = 0, n = 0;
      list.forEach((s, k) => { if (s.px.has(t)) last[k] = s.px.get(t); if (last[k] != null) { sum += (last[k] / s.prev - 1) * 100; n++; } });
      ser[i] = n >= Math.ceil(list.length / 2) ? sum / n : null;
    });
    let lastIdx = -1e9;
    for (let i = Math.max(win, skip); i < times.length; i++) { // 开盘前 10 分钟集合竞价后价格跳动大，不算异动
      if (ser[i] == null || ser[i - win] == null) continue;
      if ((times[i] <= '1130') !== (times[i - win] <= '1130')) continue; // 窗口跨过午休不算
      const d = ser[i] - ser[i - win];
      if (Math.abs(d) >= th && i - lastIdx >= gap) { out.push({ t: times[i], sector, delta: d, dir: d > 0 ? 'up' : 'down', n: list.length }); lastIdx = i; }
    }
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, max).sort((a, b) => (a.t < b.t ? -1 : 1));
}

module.exports = { sectorEvents };
