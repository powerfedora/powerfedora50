// 股池管理：整个系统"只在股池里选股"的唯一依据。
// 提醒、交易日志都用 pool.has(code) 校验，池外的股票一律拒绝。
const { seedPool } = require('./seed-pool');

const CODE_RE = /^\d{6}$/;
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

// 沪市股票与 ETF 常见代码以 5/6/9 开头；其余 6 位 A 股、ETF 代码按深市处理。
const secidOf = (code) => (['5', '6', '9'].includes(String(code)[0]) ? '1.' : '0.') + code;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

class Pool {
  constructor(store) {
    this.store = store;
    this.items = store.read('pool.json', null);
    if (!Array.isArray(this.items) || !this.items.length) { this.items = seedPool(); this.save(); }
  }

  save() { this.store.write('pool.json', this.items); }
  list() { return this.items.map((x) => ({ ...x, us: x.us ? { ...x.us } : null })); }
  get(code) { return this.items.find((x) => x.code === code) || null; }
  has(code) { return this.items.some((x) => x.code === code); }
  codes() { return this.items.map((x) => x.code); }
  sectors() { return [...new Set(this.items.map((x) => x.sector))]; }

  clean(body, partial) {
    const out = {};
    if (!partial || body.name !== undefined) {
      const name = String(body.name || '').trim();
      if (!name || name.length > 20) throw new HttpError(400, '名称不能为空且不超过 20 个字');
      out.name = name;
    }
    if (!partial || body.sector !== undefined) {
      const sector = String(body.sector || '').trim();
      if (!sector || sector.length > 12) throw new HttpError(400, '板块不能为空且不超过 12 个字');
      out.sector = sector;
    }
    if (body.us !== undefined) {
      if (body.us === null || body.us.symbol === '' || body.us.symbol === undefined) out.us = null;
      else {
        const symbol = String(body.us.symbol).trim().toUpperCase();
        if (!SYMBOL_RE.test(symbol)) throw new HttpError(400, '美股代码格式不对，例如 NVDA');
        out.us = { symbol, name: String(body.us.name || '').trim().slice(0, 30), reason: String(body.us.reason || '').trim().slice(0, 60) };
      }
    }
    return out;
  }

  add(body) {
    const code = String(body.code || '').trim();
    if (!CODE_RE.test(code)) throw new HttpError(400, '股票代码必须是 6 位数字');
    if (this.has(code)) throw new HttpError(409, `${code} 已经在股池里`);
    const item = { code, ...this.clean(body, false) };
    if (item.us === undefined) item.us = null;
    this.items.push(item);
    this.save();
    return item;
  }

  update(code, body) {
    const it = this.get(code);
    if (!it) throw new HttpError(404, `${code} 不在股池里`);
    Object.assign(it, this.clean(body, true));
    this.save();
    return it;
  }

  remove(code) {
    const i = this.items.findIndex((x) => x.code === code);
    if (i < 0) throw new HttpError(404, `${code} 不在股池里`);
    const [it] = this.items.splice(i, 1);
    this.save();
    return it;
  }
}

module.exports = { Pool, HttpError, secidOf, CODE_RE };
