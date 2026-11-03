// 在线选股：条件互斥，结果仅从当前股池中计算。
(function () {
  const { h, fmt, pct, sign, api } = PF;
  const S = { condition: 'double-golden-cross', data: null, root: null };
  const CONDITIONS = [{ id: 'double-golden-cross', name: '双金叉启动', note: 'MACD DIF 上穿 DEA，且量能趋势快线上穿慢线并形成红箭头；两次金叉同日或相隔不超过 2 个交易日。当前还须均线多头向上、收盘价站上 BBI，并满足 +DI > -DI、ADX > 20 且上升。' }];

  function skeleton() {
    const choices = h('div', { class: 'screener-options', id: 'screener-options', role: 'radiogroup', 'aria-label': '选股条件' });
    CONDITIONS.forEach((c) => choices.append(h('label', { class: 'screener-option' },
      h('input', { type: 'radio', name: 'screener-condition', value: c.id, checked: c.id === S.condition }),
      h('span', null, h('b', null, c.name), h('small', null, c.note)))));
    const conditions = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, '在线选股'), h('span', { class: 'muted small' }, '仅在当前股池内筛选')),
      h('p', { class: 'fine' }, '选择一个条件后，系统会用已下载的日线实时计算；“启动”类信号只保留最近 10 个交易日内完成的结果，并按信号日期排序。'), choices);
    const headers = ['代码', '名称', '板块', '现价', '涨跌%', '多头向上', 'BBI', '+DI', '-DI', 'ADX', 'MACD 金叉', '量能红箭头金叉', '间隔', '双金叉确认日'];
    const table = h('table', { id: 'screener-table' }, h('thead', null, h('tr', null, headers.map((x, i) => h('th', { class: i < 3 ? 'l' : '' }, x)))), h('tbody'));
    const results = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, '符合条件的股票'), h('span', { class: 'muted small', id: 'screener-count' }, '计算中…')),
      h('div', { class: 'scroll' }, table),
      h('p', { class: 'fine' }, '“红箭头量能金叉”要求交叉当日价格较 10 个交易日前不跌，且后续最多 3 根 K 线未重新死叉；用于排除量能短暂反复。技术筛选仅供复盘参考，不构成投资建议。'));
    return h('div', { class: 'stack' }, conditions, results);
  }

  function renderRows() {
    const tbody = S.root.querySelector('#screener-table tbody'), count = S.root.querySelector('#screener-count');
    tbody.replaceChildren();
    const rows = S.data ? S.data.items : [];
    count.textContent = `符合 ${rows.length} 只`;
    if (!rows.length) { tbody.append(h('tr', null, h('td', { colspan: 14, class: 'l muted' }, '当前可用日线中没有符合该条件的股票。'))); return; }
    const codes = rows.map((r) => r.code);
    rows.forEach((r) => tbody.append(h('tr', { tabindex: 0, onclick: () => PF.openStock(r.code, codes), onkeydown: (e) => { if (e.key === 'Enter') PF.openStock(r.code, codes); } },
      h('td', { class: 'l' }, r.code), h('td', { class: 'l strong' }, r.name), h('td', { class: 'l' }, r.sector), h('td', null, fmt(r.px)), h('td', { class: sign(r.chg) }, pct(r.chg)), h('td', { class: 'up' }, '是'), h('td', null, fmt(r.bbi)),
      h('td', { class: 'up' }, r.plusDI.toFixed(1)), h('td', null, r.minusDI.toFixed(1)), h('td', { class: 'up' }, r.adx.toFixed(1)),
      h('td', null, r.macdDay), h('td', null, r.flowDay), h('td', null, r.gap === 0 ? '同日' : r.gap + ' 个交易日'), h('td', null, r.signalDay))));
  }

  async function load() {
    S.data = null; renderRows();
    try { S.data = await api('GET', '/screener/' + S.condition); } catch (e) { S.data = { items: [] }; PF.toast(e.message, 'err'); }
    renderRows();
  }

  PF.views.screener = {
    async render(root) {
      S.root = root; root.replaceChildren(skeleton());
      root.querySelector('#screener-options').addEventListener('change', (e) => { if (e.target.matches('input[name="screener-condition"]')) { S.condition = e.target.value; load(); } });
      await load();
    },
    update: () => load()
  };
})();
