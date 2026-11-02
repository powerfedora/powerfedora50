// 提醒：价格 / 涨跌幅 / 均线穿越。触发时页面弹提示，可选浏览器通知和 macOS 系统通知（在设置里开）。
(function () {
  const { h, $, api, pct } = PF;
  const A = { rules: [], events: [], types: {}, mas: [], pool: [] };

  const needsMa = (t) => t === 'ma_up' || t === 'ma_down';

  function form(preCode) {
    const typeSel = h('select', { name: 'type', onchange: sync }, Object.entries(A.types).map(([k, v]) => h('option', { value: k }, v)));
    const stock = PF.stockSelect(A.pool, preCode); stock.name = 'code';
    const value = h('input', { name: 'value', type: 'number', step: 'any', placeholder: '价格' });
    const ma = h('select', { name: 'ma' }, A.mas.map((m) => h('option', { value: m, selected: m === 20 }, m + ' 日线')));
    const valueField = PF.field('数值', value), maField = PF.field('均线', ma);
    function sync() {
      const t = typeSel.value;
      maField.hidden = !needsMa(t); valueField.hidden = needsMa(t);
      value.placeholder = t.startsWith('price') ? '价格（元）' : t === 'chg_above' ? '涨幅 %，例如 5' : '跌幅 %，例如 -5';
      value.required = !needsMa(t);
    }
    const f = h('form', { class: 'form-grid', onsubmit: PF.guard(async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      await api('POST', '/alerts', { code: d.code, type: d.type, value: d.value, ma: d.ma, repeat: !!d.repeat, note: d.note });
      PF.toast('提醒已添加'); await load();
    }) },
      PF.field('股票', stock), PF.field('条件', typeSel), valueField, maField,
      PF.field('备注', h('input', { name: 'note', maxlength: 80, placeholder: '可选，例如：回踩加仓位' })),
      h('label', { class: 'field check' }, h('input', { type: 'checkbox', name: 'repeat' }), h('span', null, '可重复触发（回到条件之外再次进入时再提醒）')),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, '添加提醒')));
    sync();
    return f;
  }

  function notifyBtn() {
    if (!('Notification' in window)) return null;
    const st = Notification.permission;
    return h('button', { type: 'button', class: 'btn', disabled: st === 'granted', onclick: async () => { await Notification.requestPermission(); render(); } },
      st === 'granted' ? '浏览器通知已开启' : st === 'denied' ? '浏览器通知被禁止（请在浏览器设置里允许）' : '开启浏览器通知');
  }

  function render() {
    const root = $('#alerts-root'); if (!root) return;
    const pre = (PF.state.params || {}).code;
    root.replaceChildren(
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '新增提醒'), notifyBtn()),
        h('p', { class: 'fine' }, '每条提醒只在条件「从不成立变成成立」的那一刻响一次，不会因为一直满足而反复打扰。只能对股池内的股票设置。'),
        A.pool.length ? form(pre) : h('p', { class: 'muted' }, '股池是空的')),
      h('section', { class: 'card' }, h('h2', null, '我的提醒'),
        A.rules.length ? h('div', { class: 'scroll' }, h('table', null,
          h('thead', null, h('tr', null, ['提醒', '备注', '状态', '触发次数', ''].map((t) => h('th', { class: 'l' }, t)))),
          h('tbody', null, A.rules.map((r) => h('tr', { class: 'static' },
            h('td', { class: 'l strong' }, r.label), h('td', { class: 'l muted' }, r.note || ''),
            h('td', { class: 'l' }, !r.inPool ? '已停用（股票已移出股池）' : r.active ? (r.repeat ? '监控中（可重复）' : '监控中（触发一次后停用）') : '已停用'),
            h('td', { class: 'l' }, String(r.hits)),
            h('td', { class: 'l nowrap' },
              r.inPool ? h('button', { type: 'button', class: 'btn sm', onclick: PF.guard(async () => { await api('PATCH', '/alerts/' + r.id, { active: !r.active }); await load(); }) }, r.active ? '停用' : '启用') : null, ' ',
              h('button', { type: 'button', class: 'btn sm danger', onclick: PF.guard(async () => { await api('DELETE', '/alerts/' + r.id); await load(); }) }, '删除')))))))
          : h('p', { class: 'muted' }, '还没有提醒。')),
      h('section', { class: 'card' }, h('h2', null, '触发记录'),
        A.events.length ? h('div', { class: 'news' }, A.events.map((e) => h('div', { class: 'news-line' },
          h('span', { class: 'muted mono' }, e.atStr.slice(5, 16)), h('button', { class: 'stock-tag', type: 'button', onclick: () => PF.openStock(e.code) }, e.name),
          h('span', { class: 'news-title' }, e.message), e.note ? h('span', { class: 'muted' }, e.note) : null)))
          : h('p', { class: 'muted' }, '还没有触发过。')));
  }

  async function load() {
    const [a, p] = await Promise.all([api('GET', '/alerts'), api('GET', '/pool')]);
    Object.assign(A, { rules: a.rules, events: a.events, types: a.types, mas: a.mas, pool: p.items });
    render();
  }

  PF.views.alerts = {
    async render(root) { root.replaceChildren(h('div', { class: 'stack', id: 'alerts-root' })); await load(); },
    update: () => { if ($('#alerts-root')) return load(); }
  };
})();
