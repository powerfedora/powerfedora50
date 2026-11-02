// 晨报：隔夜美股 + 对标美股 + 股池新闻。每天自动生成，可翻看历史，也可以手动生成。
(function () {
  const { h, $, fmt, pct, sign, api } = PF;
  const R = { dates: [], date: null, root: null, nf: 'all', r: null };

  async function show(date) {
    const box = $('#rpt-body');
    box.replaceChildren(h('p', { class: 'muted' }, '加载中…'));
    let r = null;
    try { r = date ? await api('GET', '/reports/' + date) : await api('GET', '/reports/latest'); } catch (e) { r = null; }
    box.replaceChildren();
    if (!r || !r.date) { $('#rpt-md').hidden = true; box.append(h('div', { class: 'card' }, h('p', null, (date ? '没有这一天的晨报。' : '还没有晨报。') + '系统每天按设置的时间自动生成，也可以点上面的「立即生成」。'))); return; }
    R.date = r.date;
    $('#rpt-md').href = `/api/reports/${r.date}.md`;
    $('#rpt-md').hidden = false;
    $('#rpt-sel').value = r.date;

    box.append(
      h('p', { class: 'fine' }, `${r.date}　生成于 ${r.generatedAt}　新闻窗口 ${r.window.from} → ${r.window.to}` + (r.mock ? '　（模拟数据）' : '')),
      ...r.warnings.map((w) => h('div', { class: 'banner warn' }, w)),
      h('section', { class: 'card' }, h('h2', null, '要点'), h('ul', { class: 'bullets' }, r.highlights.map((t) => h('li', null, t)))),
      h('section', { class: 'card' }, h('h2', null, '隔夜美股大盘'),
        h('div', { class: 'tiles' }, r.usIndices.map((m) => h('div', { class: 'tile' }, h('span', { class: 'k' }, m.name), h('b', { class: 'big' }, m.price != null ? m.price.toFixed(2) : '—'), h('b', { class: 'chg ' + sign(m.chg) }, pct(m.chg)))))),
      h('section', { class: 'card' }, h('h2', null, '对标美股涨跌'),
        h('p', { class: 'fine' }, '每只股池股票对应一只业务或产业链最接近的美股，按美股涨跌从高到低排。对标关系可以在「股池管理」里改。'),
        h('div', { class: 'scroll' }, h('table', null,
          h('thead', null, h('tr', null, ['股池股票', '对标美股', '美股涨跌', 'A 股上一交易日', '对标理由'].map((t, i) => h('th', { class: i === 0 || i === 1 || i === 4 ? 'l' : '' }, t)))),
          h('tbody', null, r.bench.map((b) => h('tr', { onclick: () => PF.openStock(b.code) },
            h('td', { class: 'l strong' }, `${b.name} ${b.code}`), h('td', { class: 'l' }, `${b.us.symbol} ${b.us.name}`),
            h('td', { class: sign(b.us.chg) }, pct(b.us.chg)), h('td', { class: sign(b.cnChg) }, pct(b.cnChg)), h('td', { class: 'l muted' }, b.us.reason))))))),
      h('section', { class: 'card', id: 'rpt-news' }),
      h('p', { class: 'fine' }, r.disclaimer));
    R.r = r;
    paintNews();
  }

  // 股池新闻：按利好/利空/中性筛选（按标题措辞自动判断，鼠标停在标签上看依据）
  function paintNews() {
    const r = R.r, box = $('#rpt-news'); if (!box || !r) return;
    const lab = (i) => (i.sentiment && i.sentiment.label) || 'neutral';
    const all = r.news.flatMap((n) => n.items);
    const cnt = (k) => all.filter((i) => lab(i) === k).length;
    const groups = r.news.map((n) => ({ ...n, items: n.items.filter((i) => R.nf === 'all' || lab(i) === R.nf) })).filter((n) => n.items.length);
    box.replaceChildren(h('h2', null, '股池新闻'),
      h('div', { class: 'bar' }, [['all', '全部', all.length], ['bear', '利空', cnt('bear')], ['bull', '利好', cnt('bull')], ['neutral', '中性', cnt('neutral')]]
        .map(([k, t, n]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(R.nf === k), onclick: () => { R.nf = k; paintNews(); } }, `${t} ${n}`))),
      h('p', { class: 'fine' }, '利好/利空/中性由系统按标题措辞自动判断，只看标题、不看正文，仅供参考。'),
      ...(groups.length ? groups.map((n) => h('div', { class: 'news-group' },
        h('h3', null, h('button', { type: 'button', class: 'stock-tag', onclick: () => PF.openStock(n.code) }, `${n.name} ${n.code}`)),
        h('div', { class: 'news' }, n.items.map((i) => PF.newsLine(i))))) : [h('p', { class: 'muted' }, r.news.length ? '这个类别下暂时没有新闻。' : '窗口内没有新的个股新闻。')]));
  }

  async function loadDates(select) {
    R.dates = (await api('GET', '/reports')).dates;
    const sel = $('#rpt-sel'); sel.replaceChildren(...R.dates.map((d) => h('option', { value: d }, d)));
    await show(select === undefined ? null : select);
  }

  PF.views.report = {
    async render(root) {
      root.replaceChildren(h('div', { class: 'stack' },
        h('div', { class: 'card-head' }, h('h2', null, '晨报'),
          h('div', { class: 'actions' },
            h('select', { id: 'rpt-sel', 'aria-label': '选择日期', onchange: (e) => show(e.target.value) }),
            h('button', { type: 'button', class: 'btn primary', id: 'rpt-run', onclick: PF.guard(async (e) => {
              const b = e.currentTarget; b.disabled = true; b.textContent = '正在生成…';
              try { const r = await api('POST', '/reports/run'); PF.toast('晨报已生成'); await loadDates(r.date); } finally { b.disabled = false; b.textContent = '立即生成'; }
            }) }, '立即生成'),
            h('a', { id: 'rpt-md', class: 'btn', hidden: true, target: '_blank', rel: 'noopener' }, '下载 Markdown'))),
        h('div', { id: 'rpt-body', class: 'stack' })));
      await loadDates();
    },
    update: () => {}
  };
})();
