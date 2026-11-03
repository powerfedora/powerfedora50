// 路由、顶部状态、实时推送（SSE）
(function () {
  const { h, $, api } = PF;
  const view = $('#view');
  let ov = null, es = null, timer = null;

  function setStatus(text, err) { const s = $('#status'); s.textContent = text; s.classList.toggle('err', !!err); }

  function paintStatus(o) {
    ov = o;
    const st = o.status, errs = Object.entries(st.errors || {}).filter(([k]) => !k.startsWith('kline:'));
    const kerr = Object.keys(st.errors || {}).filter((k) => k.startsWith('kline:')).length;
    const parts = [`行情更新 ${PF.time(st.quotesAt)}`, `美股 ${PF.time(st.usAt)}`, `新闻 ${PF.time(st.newsAt)}`];
    if (errs.length) parts.push('有数据源失败：' + errs.map(([k, v]) => `${k} ${v}`).join('；'));
    if (kerr) parts.push(`${kerr} 只日线下载失败`);
    setStatus(parts.join('　'), errs.length || kerr);
    const b = $('#banner');
    b.hidden = !o.mock;
    if (o.mock) b.textContent = '当前是模拟数据（演示模式），行情和新闻都不是真实的。用 npm start 启动才会连接东方财富。';
  }

  async function route() {
    const name = (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0];
    const v = PF.views[name] || PF.views.dashboard;
    const key = PF.views[name] ? name : 'dashboard';
    PF.state.route = key;
    document.querySelectorAll('#nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.route === key ? 'page' : 'false'));
    document.title = 'PowerFedora50';
    view.replaceChildren(h('p', { class: 'muted' }, '加载中…'));
    try { await v.render(view); } catch (e) { view.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'up' }, '加载失败：' + e.message))); }
    PF.state.params = {};
  }

  function onServerUpdate() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const o = await api('GET', '/overview'); paintStatus(o);
        const v = PF.views[PF.state.route]; if (v && v.update && document.visibilityState !== 'hidden') await v.update();
      } catch (e) { /* 下次再试 */ }
    }, 300);
  }

  function connect() {
    es = new EventSource('/api/events');
    es.addEventListener('update', onServerUpdate);
    es.addEventListener('news', onServerUpdate);
    es.addEventListener('intelligence', onServerUpdate);
    es.addEventListener('report', () => { PF.toast('新的晨报已生成'); if (PF.state.route === 'report') route(); });
    es.addEventListener('alert', (e) => {
      const ev = JSON.parse(e.data);
      PF.toast('提醒：' + ev.message, 'alert');
      if ('Notification' in window && Notification.permission === 'granted') new Notification('PowerFedora50 提醒', { body: ev.message });
      if (PF.state.route === 'alerts') onServerUpdate();
    });
    es.onerror = () => setStatus('与本地服务的连接断开，正在重连…', true);
    es.onopen = () => onServerUpdate();
  }

  $('#btn-refresh').onclick = PF.guard(async () => { setStatus('正在刷新…'); await api('POST', '/refresh', {}); onServerUpdate(); });
  $('#btn-full').onclick = PF.guard(async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { setStatus('正在重新下载全部日线和新闻，约十几秒…'); await api('POST', '/refresh', { full: true }); onServerUpdate(); } finally { b.disabled = false; }
  });

  // 每 10 秒自动刷新一次页面数据（标签页在后台时跳过，切回来立即补一次）
  setInterval(() => { if (document.visibilityState !== 'hidden') onServerUpdate(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onServerUpdate(); });

  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { const v = PF.views[PF.state.route]; if (v && v.resize) v.resize(); }, 200); });
  window.addEventListener('hashchange', route);
  route();
  connect();
})();
