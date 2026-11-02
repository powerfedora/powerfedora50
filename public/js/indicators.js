// 技术指标与股池指数计算（服务端和浏览器共用同一份代码）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IND = factory();
})(this, function () {
  const sma = (arr, n) => {
    const out = new Array(arr.length).fill(null); let s = 0;
    for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= n) s -= arr[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  };
  const ema = (arr, n) => { const k = 2 / (n + 1); let e = arr[0]; return arr.map((x, i) => (e = i ? x * k + e * (1 - k) : x)); };

  // BBI = 3、6、12、24 日简单均线的平均值；不足 24 个交易日不绘制。
  function bbi(closes) {
    const m3 = sma(closes, 3), m6 = sma(closes, 6), m12 = sma(closes, 12), m24 = sma(closes, 24);
    return closes.map((_, i) => [m3[i], m6[i], m12[i], m24[i]].some((v) => v == null) ? null : (m3[i] + m6[i] + m12[i] + m24[i]) / 4);
  }

  // 布林带：中轨为 N 日均线，上下轨为中轨 ± K 倍标准差（默认 20, 2）。
  function boll(closes, n = 20, k = 2) {
    const mid = sma(closes, n), upper = new Array(closes.length).fill(null), lower = new Array(closes.length).fill(null);
    for (let i = n - 1; i < closes.length; i++) {
      const mean = mid[i]; let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += (closes[j] - mean) ** 2;
      const sd = Math.sqrt(sum / n);
      upper[i] = mean + k * sd; lower[i] = mean - k * sd;
    }
    return { mid, upper, lower };
  }

  function macd(closes) {
    const e12 = ema(closes, 12), e26 = ema(closes, 26);
    const dif = closes.map((_, i) => e12[i] - e26[i]);
    const dea = ema(dif, 9);
    return { dif, dea, hist: dif.map((d, i) => 2 * (d - dea[i])) };
  }

  function rsi(closes, n = 14) {
    const i0 = closes.length - 1; if (i0 < n) return null;
    let g = 0, l = 0;
    for (let i = i0 - n + 1; i <= i0; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }

  function atr(bars, n = 14) {
    const i0 = bars.length - 1; if (i0 < n) return null;
    let s = 0;
    for (let i = i0 - n + 1; i <= i0; i++) {
      const b = bars[i], pc = bars[i - 1].close;
      s += Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    }
    return s / n;
  }

  const last = (a) => a[a.length - 1];

  // 单只股票的技术面摘要
  function analyze(bars) {
    if (!bars || bars.length < 30) return null;
    const C = bars.map((b) => b.close), n = bars.length - 1, px = C[n];
    const ma = {}; [5, 10, 20, 60, 120, 250].forEach((k) => { ma[k] = last(sma(C, k)); });
    const m = macd(C), r = rsi(C), a = atr(bars);
    const win = (k) => bars.slice(-k);
    const lo20 = Math.min(...win(20).map((b) => b.low)), hi20 = Math.max(...win(20).map((b) => b.high));
    const lo60 = Math.min(...win(60).map((b) => b.low)), hi60 = Math.max(...win(60).map((b) => b.high));
    const hi250 = Math.max(...win(250).map((b) => b.high)), lo250 = Math.min(...win(250).map((b) => b.low));
    const below = [ma[20], ma[60], ma[120], ma[250], lo20, lo60].filter((x) => x != null && x < px).sort((x, y) => y - x);
    const above = [ma[20], ma[60], ma[120], ma[250], hi20, hi60].filter((x) => x != null && x > px).sort((x, y) => x - y);
    let s1 = below[0], s2 = below[1], estimated = false;
    if (s1 == null || s1 < px * 0.85) { s1 = px - a; s2 = px - 2 * a; estimated = true; }
    if (s2 == null) s2 = Math.min(s1, lo250);
    const r1 = above[0] ?? hi250, r2 = above[1] ?? r1;
    let trend = '震荡';
    if (ma[20] != null && ma[60] != null) {
      if (px > ma[20] && ma[20] > ma[60]) trend = '多头';
      else if (px < ma[20] && ma[20] < ma[60]) trend = '空头';
    }
    const dn = m.dif[n], de = m.dea[n], h = m.hist[n], hp = m.hist[n - 1];
    const macdState = dn > de ? ('金叉·红柱' + (h > hp ? '放大' : '缩短')) : ('死叉·绿柱' + (h > hp ? '缩短' : '放大'));
    const rsiState = r >= 70 ? '超买' : (r <= 30 ? '超卖' : '中性');
    const pct = (k) => (C[n - k] ? (px / C[n - k] - 1) * 100 : null);
    const yr = bars[n].day.slice(0, 4), iy = bars.findIndex((b) => b.day >= yr + '-01-01');
    const yPrev = iy > 0 ? bars[iy - 1] : null;
    return {
      px, ma, rsi: r, atr: a, dif: dn, dea: de, macd: h, macdState, rsiState, trend,
      s1, s2, r1, r2, estimated, hi250, lo250, stop: s1 - a,
      r5: pct(5), r20: pct(20), r60: pct(60), ytd: yPrev ? (px / yPrev.close - 1) * 100 : null
    };
  }

  // 股池等权指数：每天按成分股平均涨跌幅链式推算，开高低用各股相对昨收的平均近似。
  // baseDate：指定哪一天等于 base 点（之前的历史按同一比例缩放，方便计算均线）
  function poolIndex(barsByCode, base, baseDate) {
    const maps = {}, days = new Set();
    Object.entries(barsByCode).forEach(([c, bars]) => {
      if (!bars) return; maps[c] = new Map(); bars.forEach((b) => { maps[c].set(b.day, b); days.add(b.day); });
    });
    const D = [...days].sort();
    const out = []; let prev = base;
    for (let t = 0; t < D.length; t++) {
      if (t === 0) { out.push({ day: D[0], open: base, high: base, low: base, close: base, amount: 0, n: 0 }); continue; }
      let so = 0, sh = 0, sl = 0, sc = 0, k = 0, amt = 0;
      for (const c in maps) {
        const b = maps[c].get(D[t]), p = maps[c].get(D[t - 1]);
        if (!b || !p || !p.close) continue;
        so += b.open / p.close; sh += b.high / p.close; sl += b.low / p.close; sc += b.close / p.close; k++; amt += b.amount;
      }
      if (!k) continue;
      const o = prev * so / k, c = prev * sc / k;
      out.push({ day: D[t], open: o, high: Math.max(prev * sh / k, o, c), low: Math.min(prev * sl / k, o, c), close: c, amount: amt, n: k });
      prev = c;
    }
    if (baseDate) {
      const ref = out.find((b) => b.day >= baseDate);
      if (ref && ref.close) {
        const f = base / ref.close;
        out.forEach((b) => { b.open *= f; b.high *= f; b.low *= f; b.close *= f; });
      }
    }
    return out;
  }

  // 指数均线位置判断
  function indexStatus(bars) {
    const C = bars.map((b) => b.close), n = C.length - 1, c = C[n];
    const names = { 5: '5日线', 10: '10日线', 20: '20日线', 60: '60日线', 120: '120日线', 250: '年线' };
    const ma = {}, maPrev = {};
    Object.keys(names).forEach((k) => { const s = sma(C, +k); ma[k] = s[n]; maPrev[k] = s[n - 5]; });
    const slope = (k) => (ma[k] && maPrev[k] ? (ma[k] / maPrev[k] - 1) * 100 : 0);
    const dir = (k) => (slope(k) > 0.3 ? '向上' : (slope(k) < -0.3 ? '向下' : '走平'));
    const pos = (k) => (ma[k] == null ? '—' : (c >= ma[k] ? '上方' : '下方'));
    let align = '均线交织';
    if (ma[5] > ma[10] && ma[10] > ma[20] && ma[20] > ma[60]) align = '多头排列';
    else if (ma[5] < ma[10] && ma[10] < ma[20] && ma[20] < ma[60]) align = '空头排列';
    const hi60 = Math.max(...bars.slice(-60).map((b) => b.high)), lo60 = Math.min(...bars.slice(-60).map((b) => b.low));
    const hi250 = Math.max(...bars.slice(-250).map((b) => b.high));
    const sup = Object.keys(names).filter((k) => ma[k] != null && ma[k] < c).map((k) => [ma[k], names[k]]);
    sup.push([lo60, '60日低点']); sup.sort((a, b) => b[0] - a[0]);
    const res = Object.keys(names).filter((k) => ma[k] != null && ma[k] > c).map((k) => [ma[k], names[k]]);
    res.push([hi60, '60日高点']); res.sort((a, b) => a[0] - b[0]);
    const yr = bars[n].day.slice(0, 4);
    const yPrev = [...bars].reverse().find((b) => b.day < yr + '-01-01');
    return {
      close: c, chg: n ? (c / C[n - 1] - 1) * 100 : 0, day: bars[n].day, ma, align,
      nAbove: Object.keys(names).filter((k) => ma[k] != null && c >= ma[k]).length,
      short: [pos(20), dir(20)], mid: [pos(60), dir(60)], long: [pos(250), dir(250)],
      sup: sup.filter((x) => x[0] < c).slice(0, 2), res: res.filter((x) => x[0] > c).slice(0, 2),
      ddHigh: (c / hi250 - 1) * 100, ytd: yPrev ? (c / yPrev.close - 1) * 100 : null
    };
  }

  // ---------- 量能趋势线（量价）----------
  // 目的：看这一阶段成交量是在稳步放大还是萎缩，同时看放的量是"价稳量增（堆量/吸筹）"还是"放量下跌"。
  // 线本身只由成交额决定，不掺涨跌幅，所以不会和 MACD 这类价格指标重复：
  //  1) 压暴量：单日成交额最多按 50 日均额的 2 倍计（参考 Katsanos 的 VFI），再取 5 日中位数滤掉 1～2 天的尖峰
  //  2) 量能线 = 封顶成交额的 10 日 EMA ÷ 近 250 日均值（基准取得慢，量能持续放大时线会持续上行，不会因基准追上来而走平）；1.0 = 近一年常态，>1 放量，<1 缩量
  //  3) 慢线 = 同样的比值，用 30 日 EMA，用来对比快慢（快线在慢线上方且都在上行 = 量能在持续放大）
  // 价格只用来解释量的性质（阳线/阴线成交额占比、阶段涨跌），不进入线本身
  function flowTrend(bars) {
    const N = bars.length;
    const amt = bars.map((b) => b.amount || 0);
    const avg50 = amt.map((_, i) => { if (i < 9) return null; let s = 0, n = 0; for (let j = Math.max(0, i - 49); j <= i; j++) { s += amt[j]; n++; } return s / n; });
    const cap = amt.map((a, i) => (avg50[i] ? Math.min(a, 2 * avg50[i]) : a));
    const base = cap.map((_, i) => { if (i < 59) return null; let s = 0, n = 0; for (let j = Math.max(0, i - 249); j <= i; j++) { s += cap[j]; n++; } return s / n; });
    // 5 日中位数：滤掉 1～2 天的尖峰（连续多天的真放量不受影响），再做 EMA
    const med = cap.map((_, i) => { const w = cap.slice(Math.max(0, i - 4), i + 1).sort((a, b) => a - b); return w[Math.floor(w.length / 2)]; });
    const fast = ema(med, 10), slow = ema(med, 30);
    const line = fast.map((v, i) => (base[i] ? v / base[i] : null)), sig = slow.map((v, i) => (base[i] ? v / base[i] : null));
    return { line, sig, avg: avg50, cap, base };
  }

  // 最近 n 日的量能趋势判断：方向（线性回归的斜率和拟合度）、价量性质、堆量/吸筹/放量下跌
  function flowStatus(bars, ft, n = 20) {
    const N = bars.length;
    if (N < 100 || !ft || ft.line[N - 1] == null) return null;
    const ys = ft.line.slice(N - n), mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    ys.forEach((y, k) => { sxy += (k - mx) * (y - my); sxx += (k - mx) * (k - mx); syy += (y - my) * (y - my); });
    const slope = sxy / sxx, r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
    const TH = 0.005, level = ft.line[N - 1];
    const state = Math.abs(slope) < TH ? '量能走平' : (slope > 0 ? (r2 >= 0.5 ? '稳步放量' : '震荡放量') : (r2 >= 0.5 ? '稳步缩量' : '震荡缩量'));
    const c = bars.map((b) => b.close), win = bars.slice(N - n);
    const chgN = (c[N - 1] / c[N - 1 - n] - 1) * 100;
    const hi = Math.max(...win.map((b) => b.close)), lo = Math.min(...win.map((b) => b.close)), mean = win.reduce((a, b) => a + b.close, 0) / n;
    let up = 0, dn = 0; win.forEach((b) => { if (b.close >= b.open) up += b.amount || 0; else dn += b.amount || 0; });
    const upShare = up + dn > 0 ? up / (up + dn) : 0.5;
    const rising = slope >= TH, flags = [];
    if (rising && level >= 1.05 && chgN >= -3 && chgN <= 15 && upShare >= 0.55) flags.push('堆量');
    const above = ft.line.slice(N - n).filter((v) => v >= 1).length / n;
    if (above >= 0.7 && slope > -TH && (hi - lo) / mean < 0.12 && chgN >= -4 && chgN <= 8 && up >= 1.2 * dn) flags.push('疑似吸筹');
    if (rising && chgN <= -5) flags.push('放量下跌（抛压/派发）'); // 量在放大、价格 20 日跌超 5%：不要求阴线占优，避免漏标
    // 偏多/偏空：放量且价稳上涨偏多；放量下跌偏空；缩量不下结论
    const bias = flags.some((f) => f.startsWith('放量下跌')) ? 'bear' : (rising && chgN >= -3 ? 'bull' : (rising ? 'bear' : 'neutral'));
    return { state, slope, r2, level, flags, chgN, upShare, bias, text: `近 ${n} 日量能趋势：${state}（量能为近一年常态的 ${level.toFixed(2)} 倍，阳线成交额占 ${(upShare * 100).toFixed(0)}%）` + (flags.length ? '；' + flags.join('、') : '') };
  }

  // MACD DIF 上穿 DEA，且量能快线上穿慢线并构成图中定义的红箭头。
  // 返回相隔不超过 maxGap 个交易日的全部配对，调用方取最后一组即为最近信号。
  function doubleGoldenCross(bars, maxGap = 2) {
    if (!bars || bars.length < 60) return [];
    const closes = bars.map((b) => b.close), m = macd(closes), ft = flowTrend(bars);
    const macdDays = [], flowDays = [];
    for (let i = 1; i < bars.length; i++) {
      if (m.dif[i - 1] <= m.dea[i - 1] && m.dif[i] > m.dea[i]) macdDays.push(i);
      if ([ft.line[i - 1], ft.sig[i - 1], ft.line[i], ft.sig[i]].some((v) => v == null)) continue;
      if (!(ft.line[i - 1] <= ft.sig[i - 1] && ft.line[i] > ft.sig[i])) continue;
      const j = Math.min(bars.length - 1, i + 3);
      const stable = j === i || ft.line[j] - ft.sig[j] > 0.003;
      const priceStable = bars[i].close >= bars[Math.max(0, i - 10)].close;
      if (stable && priceStable) flowDays.push(i);
    }
    const pairs = [];
    macdDays.forEach((mi) => flowDays.forEach((fi) => {
      if (Math.abs(mi - fi) <= maxGap) pairs.push({ macdIndex: mi, flowIndex: fi, signalIndex: Math.max(mi, fi) });
    }));
    return pairs.sort((a, b) => a.signalIndex - b.signalIndex);
  }

  // 当前趋势确认：5/10/20/60 日线多头排列，且四条线相对 5 个交易日前均向上；收盘价站上 BBI。
  function bullishAboveBBI(bars) {
    if (!bars || bars.length < 65) return { ok: false, bbi: null };
    const closes = bars.map((b) => b.close), n = closes.length - 1, prev = n - 5;
    const ma = [5, 10, 20, 60].map((p) => sma(closes, p));
    const bbiNow = bbi(closes)[n];
    const aligned = ma[0][n] > ma[1][n] && ma[1][n] > ma[2][n] && ma[2][n] > ma[3][n];
    const rising = ma.every((line) => line[n] != null && line[prev] != null && line[n] > line[prev]);
    const aboveBBI = bbiNow != null && closes[n] > bbiNow;
    return { ok: aligned && rising && aboveBBI, bbi: bbiNow, aboveBBI, aligned, rising };
  }

  return { sma, ema, bbi, boll, macd, rsi, atr, analyze, poolIndex, indexStatus, flowTrend, flowStatus, doubleGoldenCross, bullishAboveBBI };
});
