// 交易日志与复盘：记录买卖和理由，自动算持仓成本、已实现 / 未实现盈亏、胜率；每笔卖出可以写复盘笔记。
(function () {
  const { h, $, api, fmt, pct, sign, money } = PF;
  const J = { data: null, pool: [], sideNote: null };

  function form(preCode) {
    const stock = PF.stockSelect(J.pool, preCode); stock.name = 'code';
    const f = h('form', { class: 'form-grid', onsubmit: PF.guard(async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      await api('POST', '/journal', { code: d.code, side: d.side, price: d.price, qty: d.qty, fee: d.fee, date: d.date, reason: d.reason });
      PF.toast('已记录'); await load();
    }) },
      PF.field('股票', stock),
      PF.field('方向', h('select', { name: 'side' }, h('option', { value: 'buy' }, '买入'), h('option', { value: 'sell' }, '卖出'))),
      PF.field('成交价', h('input', { name: 'price', type: 'number', step: 'any', min: '0', required: true })),
      PF.field('数量（股）', h('input', { name: 'qty', type: 'number', step: '1', min: '1', required: true })),
      PF.field('手续费', h('input', { name: 'fee', type: 'number', step: 'any', min: '0', placeholder: '0' })),
      PF.field('日期', h('input', { name: 'date', type: 'date', value: PF.today(), max: PF.today(), required: true })),
      PF.field('理由', h('input', { name: 'reason', maxlength: 500, placeholder: '为什么买 / 卖：均线位置、基本面、计划…' })),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, '记一笔')));
    return f;
  }

  const tile = (k, v, cls, sub) => h('div', { class: 'tile' }, h('span', { class: 'k' }, k), h('b', { class: 'big ' + (cls || '') }, v), sub ? h('span', { class: 'k' }, sub) : null);

  function render() {
    const root = $('#journal-root'); if (!root || !J.data) return;
    const d = J.data, t = d.totals, s = d.stats;
    const pre = (PF.state.params || {}).code;
    const note = (c) => {
      const ta = h('textarea', { rows: '2', maxlength: '1000', placeholder: '复盘：这笔做对了什么、错在哪、下次怎么做', onblur: PF.guard(async () => { if (ta.value !== (c.review || '')) { await api('PATCH', '/journal/' + c.id, { review: ta.value }); c.review = ta.value; PF.toast('复盘笔记已保存'); } }) });
      ta.value = c.review || ''; return ta;
    };
    root.replaceChildren(
      h('section', { class: 'tiles' },
        tile('已实现盈亏', money(t.realized), sign(t.realized)), tile('未实现盈亏', money(t.unrealized), sign(t.unrealized)),
        tile('累计盈亏', money(t.total), sign(t.total)), tile('持仓市值', t.marketValue.toLocaleString('zh-CN')),
        tile('胜率', s.winRate == null ? '—' : s.winRate + '%', '', `${s.closedTrades} 笔已平仓`),
        tile('盈亏比', s.profitFactor == null ? '—' : String(s.profitFactor), '', s.avgWin != null ? `平均盈 ${money(s.avgWin)} / 亏 ${money(s.avgLoss)}` : '')),
      h('section', { class: 'card' }, h('h2', null, '记一笔'),
        h('p', { class: 'fine' }, '只能记录股池内的股票。成本用移动加权平均法，买入手续费计入成本，卖出手续费从收入里扣；不允许卖出超过持仓。'),
        J.pool.length ? form(pre) : h('p', { class: 'muted' }, '股池是空的')),
      h('section', { class: 'card' }, h('h2', null, '当前持仓'),
        d.holdings.filter((x) => x.qty > 0).length ? h('div', { class: 'scroll' }, h('table', null,
          h('thead', null, h('tr', null, ['股票', '数量', '成本价', '现价', '市值', '浮动盈亏', '浮盈%', '建仓日'].map((x, i) => h('th', { class: i === 0 ? 'l' : '' }, x)))),
          h('tbody', null, d.holdings.filter((x) => x.qty > 0).map((x) => h('tr', { onclick: () => x.inPool && PF.openStock(x.code) },
            h('td', { class: 'l strong' }, `${x.name} ${x.code}`, x.inPool ? null : h('span', { class: 'muted' }, '（已移出股池）')),
            h('td', null, String(x.qty)), h('td', null, fmt(x.avgCost)), h('td', null, fmt(x.last)), h('td', null, x.value == null ? '—' : x.value.toLocaleString('zh-CN')),
            h('td', { class: sign(x.unrealized) }, money(x.unrealized)), h('td', { class: sign(x.unrealizedPct) }, pct(x.unrealizedPct)), h('td', { class: 'muted' }, x.since || '—'))))))
          : h('p', { class: 'muted' }, '目前没有持仓。')),
      h('section', { class: 'card' }, h('h2', null, '已平仓与复盘'),
        d.closed.length ? h('div', { class: 'stack' }, d.closed.map((c) => h('div', { class: 'review' },
          h('div', { class: 'review-head' }, h('b', null, `${c.name} ${c.code}`), h('span', { class: 'muted mono' }, c.date),
            h('span', null, `卖出 ${c.qty} 股，成本 ${fmt(c.buyAvg)} → 卖价 ${fmt(c.sellPrice)}`), h('b', { class: sign(c.pnl) }, `${money(c.pnl)}（${pct(c.pct)}）`)),
          c.reason ? h('p', { class: 'fine' }, '卖出理由：' + c.reason) : null, note(c))))
          : h('p', { class: 'muted' }, '还没有平仓记录。')),
      h('section', { class: 'card' }, h('h2', null, '全部流水'),
        d.entries.length ? h('div', { class: 'scroll' }, h('table', null,
          h('thead', null, h('tr', null, ['日期', '股票', '方向', '价格', '数量', '手续费', '理由', ''].map((x, i) => h('th', { class: i === 0 || i === 1 || i === 2 || i === 6 ? 'l' : '' }, x)))),
          h('tbody', null, d.entries.map((e) => h('tr', { class: 'static' },
            h('td', { class: 'l mono' }, e.date), h('td', { class: 'l strong' }, `${e.name} ${e.code}`), h('td', { class: 'l ' + (e.side === 'buy' ? 'up' : 'dn') }, e.side === 'buy' ? '买入' : '卖出'),
            h('td', null, fmt(e.price)), h('td', null, String(e.qty)), h('td', null, fmt(e.fee)), h('td', { class: 'l muted breakable' }, e.reason),
            h('td', { class: 'l' }, h('button', { type: 'button', class: 'btn sm danger', onclick: PF.guard(async () => { if (!confirm('删除这条记录？')) return; await api('DELETE', '/journal/' + e.id); await load(); }) }, '删除')))))))
          : h('p', { class: 'muted' }, '还没有记录。')));
  }

  async function load() {
    const [j, p] = await Promise.all([api('GET', '/journal'), api('GET', '/pool')]);
    J.data = j; J.pool = p.items; render();
  }

  PF.views.journal = {
    async render(root) { root.replaceChildren(h('div', { class: 'stack', id: 'journal-root' })); await load(); },
    update: () => { /* 不在输入时刷新，避免打断表单；价格变化在下次进入页面时更新 */ }
  };
})();
