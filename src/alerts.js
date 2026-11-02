// 价格 / 涨跌幅 / 均线提醒。只允许对股池内的股票设置。
// 所有规则都按"穿越"触发：条件从不成立变成成立的那一刻才提醒，已经成立的条件不会立刻响。
const crypto = require('crypto');
const { execFile } = require('child_process');
const { HttpError } = require('./pool');
const { sh } = require('./time');

const MA_LIST = [5, 10, 20, 60, 120, 250];
const TYPES = {
  price_above: '股价涨到',
  price_below: '股价跌到',
  chg_above: '当日涨幅达到',
  chg_below: '当日跌幅达到',
  ma_up: '股价站上均线',
  ma_down: '股价跌破均线'
};

function describe(rule, name) {
  const who = name || rule.code;
  switch (rule.type) {
    case 'price_above': return `${who} 涨到 ${rule.value} 元以上`;
    case 'price_below': return `${who} 跌到 ${rule.value} 元以下`;
    case 'chg_above': return `${who} 当日涨幅达到 ${rule.value}%`;
    case 'chg_below': return `${who} 当日跌幅达到 ${rule.value}%`;
    case 'ma_up': return `${who} 站上 ${rule.ma} 日线`;
    case 'ma_down': return `${who} 跌破 ${rule.ma} 日线`;
    default: return who;
  }
}

class Alerts {
  constructor({ store, pool, settings }) {
    Object.assign(this, { store, pool, settings });
    this.rules = store.read('alerts.json', []);
    this.log = store.read('alert-events.json', []);
  }

  save() { this.store.write('alerts.json', this.rules); }

  list() { return this.rules.map((r) => ({ ...r, label: describe(r, (this.pool.get(r.code) || {}).name), inPool: this.pool.has(r.code) })); }
  events(limit = 100) { return this.log.slice(-limit).reverse(); }

  add(body) {
    const code = String(body.code || '').trim();
    if (!this.pool.has(code)) throw new HttpError(400, `${code || '该代码'} 不在股池里。系统只允许对股池内的股票设提醒`);
    const type = body.type;
    if (!(type in TYPES)) throw new HttpError(400, '提醒类型不对');
    const rule = { id: crypto.randomUUID(), code, type, active: true, repeat: !!body.repeat, note: String(body.note || '').slice(0, 80), createdAt: Date.now(), hits: 0 };
    if (type === 'ma_up' || type === 'ma_down') {
      rule.ma = Number(body.ma);
      if (!MA_LIST.includes(rule.ma)) throw new HttpError(400, `均线只能是 ${MA_LIST.join('、')} 日`);
    } else {
      rule.value = Number(body.value);
      if (!Number.isFinite(rule.value)) throw new HttpError(400, '请填写数值');
      if (type.startsWith('price') && rule.value <= 0) throw new HttpError(400, '价格必须大于 0');
      if (type === 'chg_above' && rule.value <= 0) throw new HttpError(400, '涨幅要填正数，例如 5');
      if (type === 'chg_below' && rule.value >= 0) throw new HttpError(400, '跌幅要填负数，例如 -5');
    }
    this.rules.push(rule);
    this.save();
    return rule;
  }

  remove(id) {
    const i = this.rules.findIndex((r) => r.id === id);
    if (i < 0) throw new HttpError(404, '没有这条提醒');
    this.rules.splice(i, 1);
    this.save();
  }

  setActive(id, active) {
    const r = this.rules.find((x) => x.id === id);
    if (!r) throw new HttpError(404, '没有这条提醒');
    r.active = !!active; delete r.last; // 重新启用后，从下一次行情开始重新判断
    this.save();
    return r;
  }

  cond(rule, q, a) {
    switch (rule.type) {
      case 'price_above': return q.price >= rule.value;
      case 'price_below': return q.price <= rule.value;
      case 'chg_above': return q.chg != null && q.chg >= rule.value;
      case 'chg_below': return q.chg != null && q.chg <= rule.value;
      case 'ma_up': { const m = a && a.ma && a.ma[rule.ma]; return m != null && q.price >= m; }
      case 'ma_down': { const m = a && a.ma && a.ma[rule.ma]; return m != null && q.price < m; }
      default: return false;
    }
  }

  // 每次行情刷新后调用，返回这次触发的事件
  evaluate(service) {
    const fired = [];
    let dirty = false;
    for (const rule of this.rules) {
      if (!rule.active) continue;
      const q = service.quotes[rule.code], a = service.an[rule.code];
      if (!q || q.price == null) continue;
      const now = this.cond(rule, q, a);
      if (rule.last === undefined) { rule.last = now; dirty = true; continue; }
      if (now && !rule.last) {
        const p = this.pool.get(rule.code);
        const ev = {
          id: crypto.randomUUID(), ruleId: rule.id, at: Date.now(), atStr: sh().str, code: rule.code, name: p ? p.name : rule.code,
          type: rule.type, price: q.price, chg: q.chg, message: `${describe(rule, p && p.name)}（现价 ${q.price}，${q.chg > 0 ? '+' : ''}${q.chg}%）`, note: rule.note
        };
        this.log.push(ev); fired.push(ev);
        rule.hits++; rule.lastHitAt = ev.at;
        if (!rule.repeat) rule.active = false;
      }
      if (rule.last !== now) dirty = true;
      rule.last = now;
    }
    if (fired.length) {
      this.log = this.log.slice(-500);
      this.store.write('alert-events.json', this.log);
      for (const ev of fired) { service.emit('alert', ev); if (this.settings.get().notifyMac) notifyMac(ev); }
    }
    if (dirty || fired.length) this.save();
    return fired;
  }
}

function notifyMac(ev) {
  if (process.platform !== 'darwin') return;
  const text = String(ev.message).replace(/[\r\n"\\]/g, ' ');
  execFile('osascript', ['-e', `display notification "${text}" with title "PowerFedora50 提醒"`], () => {});
}

module.exports = { Alerts, describe, TYPES, MA_LIST };
