// 大盘分时图（原生 SVG）：价格线 + 浅色面积、以前收为中轴的 ± 涨跌幅刻度、板块异动标签，鼠标悬停看分钟价
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const f2 = (v) => v.toFixed(2);
  // HHMM -> 0..240 的格子：9:30–11:30 占前 120 格，13:00–15:00 占后 120 格（11:30 和 13:00 在同一位置）
  const slotOf = (t) => { const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(2)); return m <= 690 ? m - 570 : m - 660; };
  const hm = (t) => t.slice(0, 2) + ':' + t.slice(2);

  // container: 放图的元素；data: /api/intraday 的返回；opts.onHover(readout|null)
  function draw(container, data, opts = {}) {
    container.replaceChildren();
    const pts = (data && data.pts || []).filter((p) => p[1] > 0);
    if (!pts.length) { container.textContent = '暂无分时数据'; return; }
    const W = Math.max(320, container.clientWidth || 900), ml = 8, mr = 8, top = 12, bot = 26, gap = 12;
    const plotW = W - ml - mr, plotH = W < 600 ? 190 : 250, hV = W < 600 ? 60 : 80, prev = data.prevClose;
    const yV0 = top + plotH + gap, H = yV0 + hV + bot; // 上面价格，下面成交额，共用横轴
    let dev = 0; pts.forEach((p) => { dev = Math.max(dev, Math.abs(p[1] - prev)); });
    const half = Math.max(dev, prev * 0.001) * 1.08, hiV = prev + half, loV = prev - half;
    const x = (t) => ml + slotOf(t) / 240 * plotW, y = (v) => top + (hiV - v) / (hiV - loV) * plotH;
    const svg = el('svg', { width: '100%', viewBox: `0 0 ${W} ${H}`, class: 'i-svg', role: 'img', 'aria-label': data.name + '分时图' });

    // 网格：横 4 格，竖在 10:30、11:30/13:00、14:00
    for (let i = 0; i <= 4; i++) el('line', { x1: ml, x2: W - mr, y1: top + plotH * i / 4, y2: top + plotH * i / 4, class: 'k-grid' }, svg);
    [60, 120, 180].forEach((s) => { const gx = ml + s / 240 * plotW; el('line', { x1: gx, x2: gx, y1: top, y2: top + plotH, class: 'k-grid' }, svg); el('line', { x1: gx, x2: gx, y1: yV0, y2: yV0 + hV, class: 'k-grid' }, svg); });
    el('line', { x1: ml, x2: W - mr, y1: yV0 + hV, y2: yV0 + hV, class: 'k-grid' }, svg);
    [[0, '09:30', 'start'], [60, '10:30', 'middle'], [120, '11:30/13:00', 'middle'], [180, '14:00', 'middle'], [240, '15:00', 'end']].forEach(([s, t, a]) => {
      el('text', { x: ml + s / 240 * plotW, y: H - 8, class: 'k-tick', 'text-anchor': a }, svg).textContent = t;
    });

    // 成交额柱（亿元/分钟）：比上一分钟价格高红、低绿，和价格同一横轴
    const vMax = Math.max(0.0001, ...pts.map((p) => p[2] || 0)), bw = Math.max(1, plotW / 240 * 0.75);
    pts.forEach((p, i) => {
      const hh = (p[2] || 0) / vMax * (hV - 14), up = i ? p[1] >= pts[i - 1][1] : p[1] >= prev;
      el('rect', { x: x(p[0]) - bw / 2, y: yV0 + hV - hh, width: bw, height: Math.max(0, hh), class: 'i-vol ' + (up ? 'up' : 'dn') }, svg);
    });
    el('text', { x: ml + 2, y: yV0 + 12, class: 'i-corner' }, svg).textContent = '成交额（亿元/分钟） 最大 ' + vMax.toFixed(vMax >= 10 ? 1 : 2);

    // 前收中轴 + 面积 + 价格线
    el('line', { x1: ml, x2: W - mr, y1: y(prev), y2: y(prev), class: 'i-prev' }, svg);
    let d = '';
    pts.forEach((p, i) => { d += (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1); });
    const last = pts[pts.length - 1];
    el('path', { d: d + `L${x(last[0]).toFixed(1)},${top + plotH}L${x(pts[0][0]).toFixed(1)},${top + plotH}Z`, class: 'i-area' }, svg);
    el('path', { d, class: 'i-line' }, svg);

    // 四角刻度：左侧价格，右侧涨跌幅
    const pctTop = half / prev * 100;
    const corner = (txt, xx, yy, anchor, cls) => { const t = el('text', { x: xx, y: yy, class: 'i-corner ' + (cls || ''), 'text-anchor': anchor }, svg); t.textContent = txt; };
    corner(f2(hiV), ml + 2, top + 13, 'start'); corner(f2(loV), ml + 2, top + plotH - 5, 'start'); corner(f2(prev), ml + 2, y(prev) - 4, 'start');
    corner('+' + pctTop.toFixed(2) + '%', W - mr - 2, top + 13, 'end', 'up'); corner('-' + pctTop.toFixed(2) + '%', W - mr - 2, top + plotH - 5, 'end', 'dn');

    // 板块异动：红=拉升，绿=下杀，灰=中性；优先向上、放不下时向下排列。
    const placed = [], evs = [];
    (data.events || []).forEach((e) => {
      const p = pts.find((q) => q[0] === e.t); if (!p) return;
      const px = x(e.t), py = y(p[1]), w = e.sector.length * 14 + 14, h = 24;
      const tone = e.dir === 'up' ? 'up' : e.dir === 'down' ? 'dn' : 'neutral';
      const right = px + w > W - mr; // 靠右边放不下就向左展开
      const x0 = right ? px - w : px;
      let ly = 0, ok = false;
      for (let lane = 0; lane < 8; lane++) {
        const candidates = [py - 16 - h - lane * (h + 4), py + 16 + lane * (h + 4)];
        for (const candidate of candidates) {
          if (candidate < top || candidate + h > top + plotH) continue;
          if (!placed.some((r) => x0 < r.x + r.w + 2 && x0 + w + 2 > r.x && candidate < r.y + r.h + 2 && candidate + h + 2 > r.y)) { ly = candidate; ok = true; break; }
        }
        if (ok) break;
      }
      if (!ok) return;
      placed.push({ x: x0, y: ly, w, h });
      evs.push({ px, py, x0, ly, w, h, tone, e });
    });
    // 先画所有竖线，再画标签（带不透明底），这样竖线不会穿过别的标签文字
    evs.forEach((v) => el('line', { x1: v.px, x2: v.px, y1: v.ly, y2: v.py, class: 'i-ev ' + v.tone + ' i-ev-line' }, svg));
    evs.forEach(({ px, py, x0, ly, w, h, tone, e }) => {
      const g = el('g', { class: 'i-ev ' + tone }, svg);
      const title = e.source === 'cls'
        ? `${e.sector}：财联社盘中锚点（${hm(e.t)}）`
        : `${e.sector}：${hm(e.t)} 前 5 分钟平均${e.dir === 'up' ? '上涨' : '下跌'} ${Math.abs(e.delta).toFixed(2)}%（股池内 ${e.n} 只）`;
      el('title', {}, g).textContent = title;
      el('rect', { x: x0, y: ly, width: w, height: h, class: 'i-ev-bg0' }, g);
      el('rect', { x: x0, y: ly, width: w, height: h, class: 'i-ev-bg' }, g);
      el('text', { x: x0 + 7, y: ly + h / 2, dy: '0.35em', class: 'i-ev-tx' }, g).textContent = e.sector;
      el('circle', { cx: px, cy: py, r: 3.5, class: 'i-ev-dot' }, g);
    });

    // 最新一点 + 悬停十字线
    el('circle', { cx: x(last[0]), cy: y(last[1]), r: 3, class: 'i-last' }, svg);
    const cross = el('g', { opacity: 0 }, svg);
    const cv = el('line', { y1: top, y2: yV0 + hV, class: 'k-cross' }, cross), ch = el('line', { x1: ml, x2: W - mr, class: 'k-cross' }, cross), cd = el('circle', { r: 4, class: 'i-last' }, cross);
    const bySlot = new Map(pts.map((p) => [slotOf(p[0]), p]));
    const hit = el('rect', { x: ml, y: top, width: plotW, height: yV0 + hV - top, fill: 'transparent' }, svg);
    const slotAt = (ev) => { const r = svg.getBoundingClientRect(); return Math.max(0, Math.min(240, Math.round(((ev.clientX - r.left) * (W / r.width) - ml) / plotW * 240))); };
    const readout = (p) => ({ t: p[0], px: p[1], chg: p[1] - prev, pct: (p[1] / prev - 1) * 100, amt: p[2], cum: p[3] });
    hit.addEventListener('pointermove', (ev) => {
      let s = slotAt(ev), p = bySlot.get(s);
      for (let k = 1; !p && k < 4; k++) p = bySlot.get(s - k) || bySlot.get(s + k);
      if (!p) return;
      cross.setAttribute('opacity', 1);
      cv.setAttribute('x1', x(p[0])); cv.setAttribute('x2', x(p[0])); ch.setAttribute('y1', y(p[1])); ch.setAttribute('y2', y(p[1]));
      cd.setAttribute('cx', x(p[0])); cd.setAttribute('cy', y(p[1]));
      if (opts.onHover) opts.onHover(readout(p));
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); if (opts.onHover) opts.onHover(null); });
    container.append(svg);
    return readout(last);
  }

  window.IChart = { draw };
})();
