const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal DOM harness: distinguish refreshing live data from replacing the editor.
class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag; Object.assign(this, attrs);
    this.text = children.flat(Infinity).filter(x => typeof x === 'string').join('');
    this.children = children.flat(Infinity).filter(x => x && typeof x === 'object');
    if (tag === 'select') this.value = this.children[0]?.value || '';
  }
  replaceChildren(...children) { this.children = children.flat(Infinity).filter(x => x && typeof x === 'object'); }
  append(...children) { this.children.push(...children.filter(x => x && typeof x === 'object')); }
  querySelector(selector) {
    const match = e => selector.startsWith('#') ? e.id === selector.slice(1) : e.tag === selector;
    for (const child of this.children) { if (match(child)) return child; const found = child.querySelector(selector); if (found) return found; }
    return null;
  }
}

test('alerts live refresh preserves the editor while updating rule and event data', async () => {
  const root = new Element('main'); let hits = 0;
  const h = (tag, attrs, ...children) => new Element(tag, attrs || {}, children);
  const PF = { views: {}, state: {}, h, $: s => root.querySelector(s),
    field: (label, input) => h('label', {}, input), stockSelect: () => h('select', {}, h('option', { value: '600519' })),
    guard: fn => fn, api: async (method, url) => url === '/pool' ? { items: [{ code: '600519' }] } : {
      types: { price_above: '价格涨到' }, mas: [20], events: [],
      rules: [{ label: '测试提醒', hits, active: true, inPool: true }]
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/view-alerts.js'), 'utf8'), { PF, window: {} });
  await PF.views.alerts.render(root);
  const editor = root.querySelector('form');
  const input = editor.querySelector('input'); input.value = '123.45';
  hits = 3;
  await PF.views.alerts.update();
  assert.equal(root.querySelector('form'), editor, 'background refresh must retain the original form');
  assert.equal(input.value, '123.45');
  assert.ok(JSON.stringify(root).includes('测试提醒'));
  assert.ok(JSON.stringify(root.querySelector('#alerts-live')).includes('"text":"3"'), 'live hit count must refresh');
});
