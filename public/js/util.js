// 公共工具：DOM 小助手、接口调用、格式化、提示
(function () {
  const PF = window.PF = { views: {}, state: {} };

  // h('div', {class:'x', onclick: fn}, '文字', 子元素, [数组])；文字一律用 textContent，不会把数据当 HTML 解析
  PF.h = function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k.startsWith('on') && typeof v === 'function') e[k] = v;
        else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    } else if (attrs != null) kids.unshift(attrs);
    const add = (k) => {
      if (k == null || k === false) return;
      if (Array.isArray(k)) k.forEach(add);
      else e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    };
    kids.forEach(add);
    return e;
  };
  PF.$ = (sel, root = document) => root.querySelector(sel);

  PF.fmt = (v, d) => (v == null || isNaN(v) ? '—' : (d != null ? Number(v).toFixed(d) : (Math.abs(v) >= 1000 ? Number(v).toFixed(1) : Number(v).toFixed(2))));
  PF.pct = (v, d = 2) => (v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d) + '%');
  PF.sign = (v) => (v > 0 ? 'up' : (v < 0 ? 'dn' : 'flat'));
  PF.money = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));
  PF.time = (ms) => (ms ? new Date(ms).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—');
  PF.today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

  PF.api = async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON */ }
    if (!res.ok) throw new Error((data && data.error) || `请求失败（${res.status}）`);
    return data;
  };

  PF.toast = function toast(text, kind) {
    const t = PF.h('div', { class: 'toast ' + (kind || '') }, text);
    PF.$('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'err' ? 7000 : 4000);
  };

  // 表单里统一的"出错就提示"包装
  PF.guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { PF.toast(e.message, 'err'); } };

  PF.field = (label, input, hint) => PF.h('label', { class: 'field' }, PF.h('span', { class: 'k' }, label), input, hint ? PF.h('span', { class: 'fine' }, hint) : null);

  PF.stockSelect = (pool, value) => PF.h('select', { required: true },
    pool.map((p) => PF.h('option', { value: p.code, selected: p.code === value }, `${p.name} ${p.code}`)));

  PF.nav = (route, params) => { PF.state.params = params || {}; location.hash = '#/' + route; if (PF.state.route === route) window.dispatchEvent(new HashChangeEvent('hashchange')); };
})();
