// 个股弹窗：K 线（均线、成交额、MACD）、点位、对标美股、新闻
(function () {
  const { h, $, fmt, pct, sign } = PF;
  const S = { code: null, navCodes: [], range: 120, offset: 0, data: null, ruler: { on: false, a: null, b: null }, indicators: { ma: false, ema: false, bbi: true, boll: true }, limitReasons: {}, pendingReasons: new Set() };

  function limitPct(p) {
    if (/^(300|301|688)/.test(p.code)) return 20;
    if (/^(8|4|920)/.test(p.code)) return 30;
    return /ST/i.test(p.name) ? 5 : 10;
  }
  function isLimitUp(bars, i, p) {
    if (i < 1 || !bars[i - 1].close || !bars[i].close) return false;
    // 前复权数据相邻两日的涨幅不变；留出极小误差给报价的小数精度。
    return bars[i].close / bars[i - 1].close >= 1 + limitPct(p) / 100 - 0.0015;
  }
  async function loadLimitReason(day) {
    if (S.limitReasons[day] || S.pendingReasons.has(day) || !S.code) return;
    const code = S.code; S.pendingReasons.add(day);
    try {
      const result = await PF.api('GET', `/stock/${code}/limit-reason?date=${encodeURIComponent(day)}`);
      if (S.code !== code) return;
      S.limitReasons[day] = result;
    } catch (e) {
      if (S.code === code) S.limitReasons[day] = { reason: null, error: e.message };
    } finally {
      S.pendingReasons.delete(day);
      if (S.code === code && $('#stock-dlg').open) paint();
    }
  }

  function note(a) {
    if (!a) return '';
    const parts = [];
    parts.push((a.px >= a.ma[20] ? '站上' : '跌破') + `20日线(${fmt(a.ma[20])})`);
    if (a.ma[250]) parts.push((a.px >= a.ma[250] ? '年线上方' : '年线下方') + `(${pct((a.px / a.ma[250] - 1) * 100, 1)})`);
    if (a.px >= a.hi250 * 0.99) parts.push('处于一年新高附近'); else if (a.px <= a.lo250 * 1.02) parts.push('贴近一年低点');
    const sp = a.estimated ? `近期没有下方支撑，按波幅估算支撑在 ${fmt(a.s1)} / ${fmt(a.s2)}` : `跌破 ${fmt(a.s1)} 看 ${fmt(a.s2)}`;
    const rp = Math.abs(a.r1 - a.r2) < 1e-9 ? `上方 ${fmt(a.r1)} 为近期高点` : `有效突破 ${fmt(a.r1)} 再看 ${fmt(a.r2)}`;
    parts.push(sp + '，' + rp, `日均波幅约 ${fmt(a.atr)}`);
    return parts.join('；');
  }

  const SENTI = { bull: '利好', bear: '利空', neutral: '中性' };
  PF.SENTI = SENTI;

  PF.newsLine = function newsLine(n, stock) {
    const row = h('div', { class: 'news-line' }, h('span', { class: 'muted mono' }, n.time.slice(5, 16)));
    if (stock) row.append(h('button', { class: 'stock-tag', type: 'button', onclick: () => PF.openStock(stock.code) }, stock.name));
    const ok = /^https:\/\/[a-z0-9.-]+\.eastmoney\.com\//.test(n.url || '');
    const sd = n.sentiment;
    if (sd) row.insertBefore(h('span', { class: 'senti ' + sd.label, title: sd.why || '标题里没有明确的利好或利空措辞' }, SENTI[sd.label]), row.children[1] || null);
    row.append(ok ? h('a', { href: n.url, target: '_blank', rel: 'noopener' }, n.title) : h('span', { class: 'news-title' }, n.title), h('span', { class: 'muted' }, n.media));
    return row;
  };

  function paint() {
    const d = S.data; if (!d) return;
    const p = d.item, q = d.quote || {}, a = d.analysis;
    $('#d-name').textContent = `${p.name} ${p.code}`;
    $('#d-sector').textContent = p.sector;
    $('#d-px').textContent = fmt(q.price);
    const c = $('#d-chg'); c.textContent = pct(q.chg); c.className = 'chg ' + sign(q.chg);
    $('#d-link').href = `https://quote.eastmoney.com/${['5', '6', '9'].includes(p.code[0]) ? 'sh' : 'sz'}${p.code}.html`;
    const nav = S.navCodes, at = nav.indexOf(S.code), canNav = nav.length > 1 && at >= 0;
    const prev = $('#d-prev'), next = $('#d-next');
    prev.disabled = !canNav; next.disabled = !canNav;
    if (canNav) {
      prev.title = `上一只：${nav[(at - 1 + nav.length) % nav.length]}`;
      next.title = `下一只：${nav[(at + 1) % nav.length]}`;
    } else { prev.title = '从行情表打开个股后可切换上一只'; next.title = '从行情表打开个股后可切换下一只'; }
    const tags = $('#d-tags'), lv = $('#d-levels'); tags.replaceChildren(); lv.replaceChildren();
    if (a) {
      const tag = (cls, t) => tags.append(h('span', { class: 'tag ' + cls }, t));
      tag(a.trend === '多头' ? 'up' : a.trend === '空头' ? 'dn' : 'muted', a.trend);
      tag(a.macdState.startsWith('金叉') ? 'up' : 'dn', 'MACD ' + a.macdState);
      tag(a.rsiState === '超买' ? 'up' : a.rsiState === '超卖' ? 'dn' : 'muted', `RSI ${a.rsi.toFixed(0)} ${a.rsiState}`);
      const fs = IND.flowStatus(d.bars, IND.flowTrend(d.bars));
      if (fs) {
        tag(fs.bias === 'bull' ? 'up' : fs.bias === 'bear' ? 'dn' : 'muted', '量能 ' + fs.state);
        fs.flags.forEach((f) => tag(f.startsWith('放量下跌') ? 'dn' : 'up', f.split('（')[0]));
      }
      [['支撑2', a.s2], ['支撑1', a.s1], ['压力1', a.r1], ['压力2', a.r2], ['MA20', a.ma[20]], ['MA60', a.ma[60]], ['年线', a.ma[250]], ['止损参考', a.stop]]
        .forEach(([k, v]) => lv.append(h('div', null, h('span', { class: 'k' }, k), h('b', null, fmt(v)))));
    }
    $('#d-note').textContent = note(a);
    $('#d-us').textContent = d.us ? `对标美股 ${d.us.symbol} ${d.us.name}（${d.us.reason}）：${d.us.price != null ? fmt(d.us.price) + '，' + pct(d.us.chg) : '暂无行情'}` : '';
    S.offset = Math.max(0, Math.min(S.offset, d.bars.length - S.range));
    $('#d-indicators').querySelectorAll('[data-indicator]').forEach((x) => { x.checked = !!S.indicators[x.dataset.indicator]; });
    KChart.drawK($('#d-chart'), d.bars, {
      mas: S.indicators.ma ? [5, 10, 20, 60] : [], emaPeriods: S.indicators.ema ? [13, 34, 55] : [],
      bbi: S.indicators.bbi, boll: S.indicators.boll, range: S.range, offset: S.offset, ruler: S.ruler,
      isLimitUp: (bars, i) => isLimitUp(bars, i, p), limitReasons: S.limitReasons, onLimitUpHover: loadLimitReason,
      onPan: (off) => { S.offset = off; paint(); },
      onRange: (n) => {
        S.range = n;
        $('#d-range').querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.range) === n)));
        paint();
      }
    });
    const nl = $('#d-news'); nl.replaceChildren();
    const items = d.news || [];
    if (!items.length) nl.append(h('p', { class: 'muted' }, d.news ? '最近几天没有找到这只股票的个股新闻' : '新闻加载中…'));
    items.forEach((n) => nl.append(PF.newsLine(n)));
  }

  PF.openStock = async function openStock(code, navCodes) {
    if (S.code !== code) { S.offset = 0; S.ruler = { on: S.ruler.on, a: null, b: null }; S.limitReasons = {}; S.pendingReasons = new Set(); }
    S.navCodes = Array.isArray(navCodes) && navCodes.length ? [...new Set(navCodes)] : [code];
    S.code = code;
    const dlg = $('#stock-dlg');
    if (!dlg.open) dlg.showModal();
    await PF.refreshStockDialog();
  };

  PF.refreshStockDialog = async function () {
    if (!S.code || !$('#stock-dlg').open) return;
    const code = S.code;
    try {
      const data = await PF.api('GET', '/stock/' + code);
      if (S.code !== code) return; // 快速切换时忽略较早请求的返回
      S.data = data; paint();
    } catch (e) { PF.toast(e.message, 'err'); }
  };

  PF.isStockDialogOpen = () => $('#stock-dlg').open;
  PF.repaintStockDialog = () => { if ($('#stock-dlg').open) paint(); };

  $('#d-close').onclick = () => $('#stock-dlg').close();
  const moveStock = (delta) => {
    const codes = S.navCodes, at = codes.indexOf(S.code);
    if (codes.length < 2 || at < 0) return;
    PF.openStock(codes[(at + delta + codes.length) % codes.length], codes);
  };
  $('#d-prev').onclick = () => moveStock(-1);
  $('#d-next').onclick = () => moveStock(1);
  $('#stock-dlg').addEventListener('click', (e) => { if (e.target.id === 'stock-dlg') e.target.close(); });
  $('#d-alert').onclick = () => { $('#stock-dlg').close(); PF.nav('alerts', { code: S.code }); };
  $('#d-trade').onclick = () => { $('#stock-dlg').close(); PF.nav('journal', { code: S.code }); };
  $('#d-range').addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]'); if (!b) return;
    S.range = Number(b.dataset.range); S.offset = 0;
    $('#d-range').querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    paint();
  });
  $('#d-indicators').addEventListener('change', (e) => {
    const input = e.target.closest('[data-indicator]'); if (!input) return;
    S.indicators[input.dataset.indicator] = input.checked;
    paint();
  });
})();
