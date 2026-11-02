// 设置
(function () {
  const { h, $, api } = PF;
  const FIELDS = [
    ['reportTime', '晨报生成时间', 'time', '北京时间，每天到点自动生成；电脑当时没开机则开机后补生成'],
    ['quotePollSec', '交易时段行情刷新间隔（秒）', 'number', '5–600'],
    ['offHoursPollMin', '非交易时段行情刷新间隔（分钟）', 'number', '1–240'],
    ['newsPollMin', '新闻刷新间隔（分钟）', 'number', '5–240'],
    ['newsDays', '新闻保留天数', 'number', '1–14'],
    ['indexBase', '股池指数基点', 'number', '默认 1000'],
    ['indexBaseDate', '基点日期', 'date', '这一天的指数等于基点；需要有这一天之前的日线'],
    ['historyDays', '下载日线根数', 'number', '300–2000；改大后点「全量更新」生效']
  ];

  PF.views.settings = {
    async render(root) {
      const s = await api('GET', '/settings');
      const f = h('form', { class: 'form-grid', onsubmit: PF.guard(async (e) => {
        e.preventDefault();
        const d = new FormData(f), patch = {};
        for (const [k, , type] of FIELDS) patch[k] = type === 'number' ? Number(d.get(k)) : d.get(k);
        patch.notifyMac = f.elements.notifyMac.checked;
        await api('PUT', '/settings', patch);
        PF.toast('设置已保存');
      }) },
        FIELDS.map(([k, label, type, hint]) => PF.field(label, h('input', { name: k, type, value: s[k], required: true, step: type === 'number' ? 'any' : null }), hint)),
        h('label', { class: 'field check' }, h('input', { type: 'checkbox', name: 'notifyMac', checked: s.notifyMac }), h('span', null, '提醒触发时同时弹 macOS 系统通知（只在 Mac 上有效）')),
        h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, '保存设置')));
      root.replaceChildren(h('section', { class: 'card' }, h('h2', null, '设置'), f));
    },
    update: () => {}
  };
})();
