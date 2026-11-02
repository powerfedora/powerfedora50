// K 线图（原生 SVG，无第三方库）：蜡烛 + 均线 + 成交额 + MACD，鼠标悬停显示当日数据
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const MA_COLORS = ['var(--ma1)', 'var(--ma2)', 'var(--ma3)', 'var(--ma4)', 'var(--ma5)', 'var(--ma6)'];
  const f2 = (v) => (v == null || isNaN(v) ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(2)));
  const niceTicks = (lo, hi, count) => {
    const span = hi - lo || 1, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  };

  // container: 放图的元素；bars: [{day,open,high,low,close,amount}]；opts: {mas:[5,10,...], range: 120, precomputed: {5:[...]}}
  function drawK(container, bars, opts) {
    container.replaceChildren();
    if (!bars || bars.length < 2) { container.textContent = '暂无数据'; return; }
    const mas = opts.mas || [5, 10, 20, 60], emaPeriods = opts.emaPeriods || [];
    const C = bars.map((b) => b.close), N = bars.length;
    const maArr = {}; mas.forEach((n) => { maArr[n] = IND.sma(C, n); });
    const emaArr = {}; emaPeriods.forEach((n) => { emaArr[n] = IND.ema(C, n); });
    const bbi = opts.bbi ? IND.bbi(C) : null;
    const boll = opts.boll ? IND.boll(C) : null;
    const { dif, dea, hist } = IND.macd(C);
    const end = N - Math.max(0, Math.min(opts.offset || 0, N - 2)), from = Math.max(0, end - (opts.range || 120)), idx = []; for (let i = from; i < end; i++) idx.push(i);

    const W = Math.max(320, container.clientWidth || 800), ml = 4, mr = 56;
    const hP = W < 600 ? 220 : 280, hV = 64, hM = 86, hF = opts.flow === false ? 0 : 86, gap = 18, top = 6;
    const yP0 = top, yV0 = yP0 + hP + gap, yM0 = yV0 + hV + gap, yF0 = yM0 + hM + gap, H = (hF ? yF0 + hF : yM0 + hM) + 22;
    const FT = hF ? IND.flowTrend(bars) : null; // 量能趋势线（成交额），见 indicators.js
    const plotW = W - ml - mr, slot = plotW / idx.length, bw = Math.max(1, slot * 0.7);
    const xc = (k) => ml + slot * k + slot / 2;

    let lo = Infinity, hi = -Infinity, vMax = 0, mMax = 0, fLo = Infinity, fHi = -Infinity;
    idx.forEach((i) => {
      lo = Math.min(lo, opts.noWick ? Math.min(bars[i].open, bars[i].close) : bars[i].low); hi = Math.max(hi, opts.noWick ? Math.max(bars[i].open, bars[i].close) : bars[i].high);
      mas.forEach((n) => { const v = maArr[n][i]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
      emaPeriods.forEach((n) => { const v = emaArr[n][i]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
      if (bbi && bbi[i] != null) { lo = Math.min(lo, bbi[i]); hi = Math.max(hi, bbi[i]); }
      if (boll) [boll.upper[i], boll.mid[i], boll.lower[i]].forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
      vMax = Math.max(vMax, bars[i].amount || 0);
      if (FT) [FT.line[i], FT.sig[i]].forEach((v) => { if (v != null) { fLo = Math.min(fLo, v); fHi = Math.max(fHi, v); } });
      mMax = Math.max(mMax, Math.abs(hist[i]), Math.abs(dif[i]), Math.abs(dea[i]));
    });
    const pad = (hi - lo) * 0.04; lo -= pad; hi += pad;
    const yP = (v) => yP0 + hP - (v - lo) / (hi - lo) * hP;
    const yV = (v) => yV0 + hV - (v / (vMax || 1)) * hV;
    if (FT) { fLo = Math.min(fLo, 1); fHi = Math.max(fHi, 1); } // 1.0 = 近一年常态量能，作为基准线
    const fPad = (fHi - fLo) * 0.08 || 0.1;
    const yF = (v) => yF0 + hF - (v - (fLo - fPad)) / ((fHi - fLo) + 2 * fPad) * hF;
    const yM = (v) => yM0 + hM / 2 - (v / (mMax || 1)) * (hM / 2);

    const legend = document.createElement('div'); legend.className = 'k-legend';
    const svg = el('svg', { width: '100%', viewBox: `0 0 ${W} ${H}`, class: 'k-svg', role: 'img', 'aria-label': 'K线图' });

    const grid = (ticks, y, fmt) => ticks.forEach((t) => {
      el('line', { x1: ml, x2: W - mr, y1: y(t), y2: y(t), class: 'k-grid' }, svg);
      const tx = el('text', { x: W - mr + 6, y: y(t), dy: '0.32em', class: 'k-tick' }, svg); tx.textContent = fmt(t);
    });
    grid(niceTicks(lo, hi, 5).filter((t) => t >= lo && t <= hi), yP, (t) => (Math.abs(t) >= 1000 ? t.toFixed(0) : (+t.toFixed(2)).toString()));
    grid(niceTicks(0, vMax || 1, 2).filter((t) => t > 0 && t <= vMax), yV, (t) => (+t.toFixed(1)).toString());
    el('line', { x1: ml, x2: W - mr, y1: yM(0), y2: yM(0), class: 'k-axis' }, svg);
    const lab = (y, t) => { const e = el('text', { x: ml + 2, y: y + 11, class: 'k-tick' }, svg); e.textContent = t; };
    lab(yV0, '成交额（亿元）'); lab(yM0, 'MACD (12,26,9)');
    let setFlowReadout = () => {};
    if (FT) {
      // 量能读数直接放在子图左上角；show(i) 会随鼠标吸附到的 K 线同步更新。
      const flowReadout = el('text', { x: ml + 2, y: yF0 + 11, class: 'k-tick' }, svg);
      setFlowReadout = (i) => {
        const fast = FT.line[i], slow = FT.sig[i];
        flowReadout.replaceChildren();
        const add = (text, color) => { const t = el('tspan', color ? { fill: color } : {}, flowReadout); t.textContent = text; };
        add(`量能趋势线　${bars[i].day}　`);
        if (fast == null || slow == null) return add('数据不足');
        add(`快线(10) ${fast.toFixed(2)}　`, 'var(--accent)');
        add(`慢线(30) ${slow.toFixed(2)}　`, 'var(--ma2)');
        add(`相对常态 ${fast.toFixed(2)}×　`, fast >= 1 ? 'var(--up)' : 'var(--dn)');
        add(fast > slow ? '量能增强' : fast < slow ? '量能转弱' : '量能持平');
      };
      el('line', { x1: ml, x2: W - mr, y1: yF(1), y2: yF(1), class: 'k-axis', 'stroke-dasharray': '4 3' }, svg);
      grid(niceTicks(fLo - fPad, fHi + fPad, 3).filter((t) => t >= fLo - fPad && t <= fHi + fPad), yF, (t) => (+t.toFixed(2)).toString());
    }

    const gC = el('g', {}, svg);
    idx.forEach((i, k) => {
      const b = bars[i], up = b.close >= b.open, cls = up ? 'up' : 'dn', x = xc(k);
      if (!opts.noWick) el('line', { x1: x, x2: x, y1: yP(b.high), y2: yP(b.low), class: 'k-wick ' + cls }, gC);
      const y1 = yP(Math.max(b.open, b.close)), y2 = yP(Math.min(b.open, b.close));
      el('rect', { x: x - bw / 2, width: bw, y: y1, height: Math.max(1, y2 - y1), class: 'k-body ' + cls }, gC);
      el('rect', { x: x - bw / 2, width: bw, y: yV(b.amount || 0), height: Math.max(0, yV0 + hV - yV(b.amount || 0)), class: 'k-vol ' + cls }, gC);
      const hy = yM(hist[i]);
      el('rect', { x: x - bw / 2, width: bw, y: Math.min(hy, yM(0)), height: Math.max(1, Math.abs(hy - yM(0))), class: 'k-hist ' + (hist[i] >= 0 ? 'up' : 'dn') }, gC);
    });
    const path = (arr, y, cls, color) => {
      let d = '', pen = false;
      idx.forEach((i, k) => { const v = arr[i]; if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + xc(k).toFixed(1) + ',' + y(v).toFixed(1); pen = true; });
      if (d) el('path', { d, class: cls, style: color ? 'stroke:' + color : '' }, svg);
    };
    mas.forEach((n, j) => path(maArr[n], yP, 'k-line', MA_COLORS[j % MA_COLORS.length]));
    emaPeriods.forEach((n, j) => path(emaArr[n], yP, 'k-line k-ema', MA_COLORS[(j + 3) % MA_COLORS.length]));
    if (bbi) path(bbi, yP, 'k-line k-bbi', 'var(--bbi)');
    if (boll) {
      path(boll.mid, yP, 'k-line k-boll-mid', 'var(--boll)');
      path(boll.upper, yP, 'k-line k-boll', 'var(--boll)');
      path(boll.lower, yP, 'k-line k-boll', 'var(--boll)');
    }
    path(dif, yM, 'k-line', 'var(--dif)'); path(dea, yM, 'k-line', 'var(--dea)');
    if (FT) { path(FT.sig, yF, 'k-line', 'var(--ma2)'); path(FT.line, yF, 'k-line', 'var(--accent)'); }
    // 量能金叉/死叉标记：金叉（快线上穿慢线 = 量能开始放大）按同期价格着色——红：价稳或上涨（放量上涨/堆量），绿：价格下跌（放量下跌）；死叉（量能转弱）灰色。
    // 交叉后 3 根内又穿回去的算没站稳，不标
    if (FT) {
      idx.forEach((i, k) => {
        if (i < 1 || [FT.line[i], FT.sig[i], FT.line[i - 1], FT.sig[i - 1]].some((v) => v == null)) return;
        const d0 = FT.line[i - 1] - FT.sig[i - 1], d1 = FT.line[i] - FT.sig[i];
        if (!((d0 <= 0 && d1 > 0) || (d0 >= 0 && d1 < 0))) return;
        const j = Math.min(N - 1, i + 3), dj = FT.line[j] - FT.sig[j];
        if (j > i && (d1 > 0 ? dj <= 0.003 : dj >= -0.003)) return;
        const gold = d1 > 0, chg = (bars[i].close / bars[Math.max(0, i - 10)].close - 1) * 100;
        const x0 = xc(k), y0 = yF(FT.line[i]), dy = gold ? 9 : -9, r = 5;
        const col = !gold ? 'var(--muted)' : (chg >= 0 ? 'var(--up)' : 'var(--dn)');
        const tri = el('polygon', { points: gold ? `${x0},${y0 + dy - r} ${x0 - r},${y0 + dy + r - 1} ${x0 + r},${y0 + dy + r - 1}` : `${x0},${y0 + dy + r} ${x0 - r},${y0 + dy - r + 1} ${x0 + r},${y0 + dy - r + 1}`, fill: col, opacity: 0.9 }, svg);
        el('title', {}, tri).textContent = gold
          ? `${bars[i].day} 量能金叉：量能开始放大；前 10 日价格 ${chg > 0 ? '+' : ''}${chg.toFixed(1)}%，${chg >= 0 ? '价稳/上涨（放量上涨）' : '价格下跌（放量下跌，不是买入信号）'}`
          : `${bars[i].day} 量能死叉：量能转弱`;
      });
      const cap = el('text', { x: W - mr - 4, y: yF0 + 11, class: 'k-tick', 'text-anchor': 'end' }, svg);
      cap.textContent = '▲红 放量+价稳/涨　▲绿 放量+价跌　▼灰 量能转弱';
    }

    const step = Math.max(1, Math.ceil(idx.length / Math.max(2, Math.floor(plotW / 92))));
    idx.forEach((i, k) => {
      if (k % step) return;
      const t = el('text', { x: xc(k), y: H - 5, class: 'k-tick', 'text-anchor': k === 0 ? 'start' : 'middle' }, svg);
      t.textContent = bars[i].day.slice(2);
    });

    const cross = el('line', { y1: top, y2: H - 20, class: 'k-cross', opacity: 0 }, svg);
    // 横线：鼠标所在那根 K 线的收盘价，价格标在右侧价格轴上
    const hLine = el('line', { x1: ml, x2: W - mr, class: 'k-cross', opacity: 0 }, svg);
    const hBg = el('rect', { x: W - mr + 1, width: mr - 2, height: 16, rx: 3, class: 'k-pxtag', opacity: 0 }, svg);
    const hTx = el('text', { x: W - mr + 6, dy: '0.32em', class: 'k-pxtag-tx', opacity: 0 }, svg);
    const setH = (on, b, y) => {
      [hLine, hBg, hTx].forEach((e) => e.setAttribute('opacity', on ? 1 : 0));
      if (!on) return;
      hLine.setAttribute('y1', y); hLine.setAttribute('y2', y);
      hBg.setAttribute('y', y - 8); hBg.setAttribute('class', 'k-pxtag ' + (b.close >= b.open ? 'up' : 'dn'));
      hTx.setAttribute('y', y); hTx.textContent = f2(b.close);
    };
    const show = (i) => {
      const b = bars[i], pc = i ? bars[i - 1].close : b.open, ch = (b.close / pc - 1) * 100;
      setFlowReadout(i);
      const items = [['日期', b.day], ['开', f2(b.open)], ...(opts.noWick ? [] : [['高', f2(b.high)], ['低', f2(b.low)]]), ['收', f2(b.close), ch],
        ['涨跌', (ch > 0 ? '+' : '') + ch.toFixed(2) + '%', ch], ['额', (b.amount || 0).toFixed(1) + '亿']];
      mas.forEach((n, j) => items.push(['MA' + n, f2(maArr[n][i]), null, MA_COLORS[j % MA_COLORS.length]]));
      emaPeriods.forEach((n, j) => items.push(['EMA' + n, f2(emaArr[n][i]), null, MA_COLORS[(j + 3) % MA_COLORS.length]]));
      if (bbi) items.push(['BBI', f2(bbi[i]), null, 'var(--bbi)']);
      if (boll) items.push(['BOLL中', f2(boll.mid[i]), null, 'var(--boll)'], ['BOLL上', f2(boll.upper[i]), null, 'var(--boll)'], ['BOLL下', f2(boll.lower[i]), null, 'var(--boll)']);
      if (opts.isLimitUp && opts.isLimitUp(bars, i)) {
        const detail = opts.limitReasons && opts.limitReasons[b.day];
        const text = detail ? (detail.reason || '当日复盘暂未给出题材原因') : '正在查询当日涨停原因…';
        items.push(['涨停原因', text, null, detail && detail.reason ? 'var(--up)' : 'var(--muted)']);
        if (!detail && opts.onLimitUpHover) opts.onLimitUpHover(b.day);
      }
      if (FT && FT.line[i] != null) {
        const fast = FT.line[i], slow = FT.sig[i];
        const relation = fast > slow ? '增强' : fast < slow ? '转弱' : '持平';
        items.push(
          ['量能快线(10日)', fast.toFixed(2), null, 'var(--accent)'],
          ['量能慢线(30日)', slow.toFixed(2), null, 'var(--ma2)'],
          ['相对常态', `${fast.toFixed(2)}×`, fast >= 1 ? 1 : -1],
          ['快慢关系', relation, fast > slow ? 1 : fast < slow ? -1 : 0]
        );
      }
      items.push(['DIF', dif[i].toFixed(2), null, 'var(--dif)'], ['DEA', dea[i].toFixed(2), null, 'var(--dea)'], ['MACD', hist[i].toFixed(2), hist[i]]);
      legend.replaceChildren(...items.map(([k, v, sign, color]) => {
        const s = document.createElement('span');
        if (color) s.style.color = color;
        if (k) s.append(k + ' ');
        const bb = document.createElement('b'); bb.textContent = v;
        if (sign != null) bb.className = sign > 0 ? 'up' : sign < 0 ? 'dn' : 'flat';
        s.append(bb); return s;
      }));
    };
    // ---- 标尺：点两根 K 线（自动吸附到最近的开/高/低/收），看区间涨跌幅。状态放在 opts.ruler 里，重绘（平移/缩放/自动刷新）后保留 ----
    const R = opts.ruler || (opts.ruler = { on: false, a: null, b: null });
    const gR = el('g', { 'pointer-events': 'none' }, svg);
    const tools = document.createElement('div'); tools.className = 'k-tools';
    const rBtn = document.createElement('button'); rBtn.type = 'button'; rBtn.className = 'chip'; rBtn.textContent = '标尺';
    const rClr = document.createElement('button'); rClr.type = 'button'; rClr.className = 'chip'; rClr.textContent = '清除';
    const rHint = document.createElement('span'); rHint.className = 'muted small';
    tools.append(rBtn, rClr, rHint);
    const rInfo = document.createElement('div'); rInfo.className = 'k-ruler';
    const dayIdx = (d) => bars.findIndex((b) => b.day === d);
    const vis = (i) => i >= from && i < end;
    const num2 = (v) => (Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(2));
    const sg = (v) => (v > 0 ? '+' : '') + v.toFixed(2);
    function paintRuler() {
      gR.replaceChildren(); rInfo.replaceChildren(); rInfo.hidden = true;
      rBtn.setAttribute('aria-pressed', String(R.on)); svg.style.cursor = R.on ? 'crosshair' : '';
      rClr.hidden = !(R.a || R.b);
      rHint.textContent = !R.on ? '' : (R.b ? '已测量，再点一下重新选起点' : (R.a ? '再点一根 K 线选终点' : '点一根 K 线选起点'));
      const pts = [R.a, R.b].filter(Boolean).map((p) => ({ ...p, i: dayIdx(p.day) })).filter((p) => p.i >= 0);
      const col = 'var(--accent)';
      const shown = pts.filter((p) => vis(p.i) && p.price >= lo && p.price <= hi);
      shown.forEach((p) => {
        const x = xc(p.i - from), y = yP(p.price);
        el('line', { x1: x, x2: x, y1: yP0, y2: yP0 + hP, stroke: col, 'stroke-dasharray': '2 3', opacity: 0.5 }, gR);
        el('circle', { cx: x, cy: y, r: 4, fill: col, stroke: 'var(--bg)', 'stroke-width': 1.5 }, gR);
      });
      if (pts.length < 2) return;
      const [a, b] = pts, ch = b.price - a.price, pc = ch / a.price * 100;
      if (shown.length === 2) {
        const c = ch >= 0 ? 'var(--up)' : 'var(--dn)';
        el('line', { x1: xc(a.i - from), y1: yP(a.price), x2: xc(b.i - from), y2: yP(b.price), stroke: c, 'stroke-width': 2, 'stroke-dasharray': '6 4' }, gR);
        el('line', { x1: ml, x2: W - mr, y1: yP(a.price), y2: yP(a.price), stroke: col, 'stroke-dasharray': '2 4', opacity: 0.5 }, gR);
        el('line', { x1: ml, x2: W - mr, y1: yP(b.price), y2: yP(b.price), stroke: col, 'stroke-dasharray': '2 4', opacity: 0.5 }, gR);
      }
      const i0 = Math.min(a.i, b.i), i1 = Math.max(a.i, b.i);
      let hiP = -Infinity, loP = Infinity, amt = 0;
      for (let i = i0; i <= i1; i++) {
        hiP = Math.max(hiP, opts.noWick ? Math.max(bars[i].open, bars[i].close) : bars[i].high);
        loP = Math.min(loP, opts.noWick ? Math.min(bars[i].open, bars[i].close) : bars[i].low);
        amt += bars[i].amount || 0;
      }
      const n = i1 - i0 + 1, cell = (k, v, cls) => { const sp = document.createElement('span'); sp.append(k + ' '); const bb = document.createElement('b'); bb.textContent = v; if (cls) bb.className = cls; sp.append(bb); return sp; };
      rInfo.hidden = false;
      rInfo.append(
        cell('区间', `${a.day} → ${b.day}`), cell('K 线', `${n - 1} 根（含首尾 ${n} 根）`),
        cell('价格', `${num2(a.price)} → ${num2(b.price)}`), cell('涨跌', `${sg(ch)}（${sg(pc)}%）`, ch >= 0 ? 'up' : 'dn'),
        cell('区间最高', num2(hiP) + `（距起点 ${sg((hiP / a.price - 1) * 100)}%）`), cell('区间最低', num2(loP) + `（距起点 ${sg((loP / a.price - 1) * 100)}%）`),
        cell('最大振幅', ((hiP / loP - 1) * 100).toFixed(2) + '%'), ...(amt > 0 ? [cell('成交额合计', amt.toFixed(1) + '亿')] : []));
    }
    rBtn.onclick = () => { R.on = !R.on; if (!R.on) { R.a = null; R.b = null; } paintRuler(); };
    rClr.onclick = () => { R.a = null; R.b = null; paintRuler(); };
    // 在 (clientX, clientY) 处选点：x 吸附到 K 线，y 吸附到该根 K 线最近的开/高/低/收；点在价格区以外就取收盘价
    function pick(ev) {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width), py = (ev.clientY - r.top) * (H / r.height);
      const k = Math.max(0, Math.min(idx.length - 1, Math.floor((px - ml) / slot))), bar = bars[idx[k]];
      let price = bar.close;
      if (py >= yP0 && py <= yP0 + hP) {
        const cands = opts.noWick ? [bar.open, bar.close] : [bar.open, bar.high, bar.low, bar.close];
        price = cands.reduce((m, v) => (Math.abs(yP(v) - py) < Math.abs(yP(m) - py) ? v : m), cands[0]);
      }
      const p = { day: bar.day, price };
      if (!R.a || R.b) { R.a = p; R.b = null; } else R.b = p;
      paintRuler();
    }
    const hit = el('rect', { x: ml, y: top, width: plotW, height: H - top - 20, fill: 'transparent' }, svg);
    const onMove = (ev) => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width);
      const k = Math.max(0, Math.min(idx.length - 1, Math.floor((px - ml) / slot)));
      cross.setAttribute('x1', xc(k)); cross.setAttribute('x2', xc(k)); cross.setAttribute('opacity', 1);
      setH(true, bars[idx[k]], yP(bars[idx[k]].close));
      show(idx[k]);
    };
    hit.addEventListener('pointermove', onMove);
    // 按住左键左右拖动：向右拖看更早的 K 线，向左拖回到最新；重绘会换掉 SVG，所以监听挂在 window 上
    hit.addEventListener('pointerdown', (ev) => {
      onMove(ev);
      if (ev.button !== 0 || !(opts.onPan || R.on)) return;
      const x0 = ev.clientX, off0 = opts.offset || 0, scale = W / svg.getBoundingClientRect().width;
      let dragging = false, raf = 0, last = off0;
      const move = (e) => {
        if (!opts.onPan || (!dragging && Math.abs(e.clientX - x0) < 4)) return;
        dragging = true; cross.setAttribute('opacity', 0); setH(false);
        const off = Math.max(0, Math.min(N - idx.length, off0 + Math.round((e.clientX - x0) * scale / slot)));
        if (off === last || raf) return;
        last = off;
        raf = requestAnimationFrame(() => { raf = 0; opts.onPan(off); });
      };
      const up = (e) => {
        if (R.on && !dragging && e.type === 'pointerup') pick(e);
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
    // 滚轮缩放：向上滚放大（显示的根数变少），向下滚缩小；右端始终是最新一天
    hit.addEventListener('wheel', (ev) => {
      if (!opts.onRange) return;
      ev.preventDefault();
      const cur = idx.length, next = Math.round(cur * (ev.deltaY < 0 ? 0.8 : 1.25));
      const n = Math.max(20, Math.min(N, next === cur ? cur + (ev.deltaY < 0 ? -1 : 1) : next));
      if (n !== cur) opts.onRange(n);
    }, { passive: false });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); setH(false); show(idx[idx.length - 1]); });
    show(idx[idx.length - 1]);
    paintRuler();
    container.append(tools, rInfo, legend, svg);
  }

  window.KChart = { drawK };
})();
