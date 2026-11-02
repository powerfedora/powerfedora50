// 股池管理：增删股票、改板块、维护对标美股。"只在股池里选股"的名单就在这里。
(function () {
  const { h, $, api } = PF;
  const TARGET = 50;
  const P = { items: [], editing: null };

  function usCells(it) { return it.us ? `${it.us.symbol} ${it.us.name}` : '—'; }

  function form(it) {
    const isNew = !it;
    const v = it || { code: '', name: '', sector: '', us: null };
    const inp = (name, val, attrs) => h('input', { name, value: val || '', ...attrs });
    // ETF 是独立类别，但仍允许输入自定义行业/主题，避免把已有股池分类锁死。
    const categories = [...new Set([...P.items.map((x) => x.sector), 'ETF'])];
    const sectors = h('datalist', { id: 'sector-list' }, categories.map((s) => h('option', { value: s })));
    const f = h('form', { class: 'form-grid', onsubmit: PF.guard(async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      const body = { name: d.name, sector: d.sector, us: d.symbol ? { symbol: d.symbol, name: d.usName, reason: d.reason } : null };
      if (isNew) { body.code = d.code.trim(); const r = await api('POST', '/pool', body); PF.toast(`已加入 ${r.item.name}，现在共 ${r.count} 只`); }
      else { await api('PUT', '/pool/' + it.code, body); PF.toast('已保存'); }
      P.editing = null; await load();
    }) },
      PF.field('证券代码', isNew ? inp('code', '', { required: true, pattern: '\\d{6}', placeholder: '6 位数字', inputmode: 'numeric' }) : h('input', { value: v.code, disabled: true })),
      PF.field('名称', inp('name', v.name, { placeholder: isNew ? '留空则自动查询' : '', required: !isNew, maxlength: 20 })),
      PF.field('类别', inp('sector', v.sector, { required: true, list: 'sector-list', maxlength: 12, placeholder: '选择或输入类别，例如 ETF' })),
      PF.field('对标美股代码', inp('symbol', v.us && v.us.symbol, { placeholder: '例如 NVDA，可留空', style: 'text-transform:uppercase' })),
      PF.field('美股名称', inp('usName', v.us && v.us.name, { maxlength: 30 })),
      PF.field('对标理由', inp('reason', v.us && v.us.reason, { maxlength: 60 })),
      sectors,
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn primary' }, isNew ? '加入股池' : '保存'),
        isNew ? null : h('button', { type: 'button', class: 'btn', onclick: () => { P.editing = null; render(); } }, '取消')));
    return f;
  }

  function render() {
    const root = $('#pool-root'); if (!root) return;
    const n = P.items.length, gap = TARGET - n;
    root.replaceChildren(
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, '股池'), h('span', { class: gap === 0 ? 'muted small' : 'small warn-text' },
          `当前 ${n} 只，目标 ${TARGET} 只` + (gap > 0 ? `，还差 ${gap} 只` : gap < 0 ? `，超出 ${-gap} 只` : ''))),
        h('p', { class: 'fine' }, '这里的名单就是系统的选股范围：看板、股池指数、晨报都按它计算，提醒和交易日志只接受池内证券。新增 ETF 时填写代码、名称、类别并选择“ETF”即可；对标美股信息可留空。增删后指数会自动重算。'),
        h('div', { class: 'scroll' }, h('table', null,
          h('thead', null, h('tr', null, ['代码', '名称', '类别', '对标美股', '对标理由', ''].map((t) => h('th', { class: 'l' }, t)))),
          h('tbody', null, P.items.map((it) => h('tr', { class: 'static' },
            h('td', { class: 'l mono' }, it.code), h('td', { class: 'l strong' }, it.name), h('td', { class: 'l muted' }, it.sector),
            h('td', { class: 'l' }, usCells(it)), h('td', { class: 'l muted' }, it.us ? it.us.reason : ''),
            h('td', { class: 'l nowrap' },
              h('button', { type: 'button', class: 'btn sm', onclick: () => PF.openStock(it.code) }, 'K 线'), ' ',
              h('button', { type: 'button', class: 'btn sm', onclick: () => { P.editing = it.code; render(); $('#pool-edit').scrollIntoView({ block: 'center' }); } }, '编辑'), ' ',
              h('button', { type: 'button', class: 'btn sm danger', onclick: PF.guard(async () => {
                if (!confirm(`把 ${it.name} 移出股池？\n移出后它不再参与指数和晨报，该股票的提醒会被停用，交易日志会保留。`)) return;
                const r = await api('DELETE', '/pool/' + it.code);
                PF.toast(`已移出 ${it.name}，现在共 ${r.count} 只`); (r.warnings || []).forEach((w) => PF.toast(w)); await load();
              }) }, '移出')))))))),
      h('section', { class: 'card', id: 'pool-edit' },
        h('h2', null, P.editing ? `编辑 ${(P.items.find((x) => x.code === P.editing) || {}).name || ''}` : '新增股票'),
        P.editing ? form(P.items.find((x) => x.code === P.editing)) : form(null)));
  }

  async function load() { P.items = (await api('GET', '/pool')).items; render(); }

  PF.views.pool = {
    async render(root) { root.replaceChildren(h('div', { class: 'stack', id: 'pool-root' })); await load(); },
    update: () => {}
  };
})();
