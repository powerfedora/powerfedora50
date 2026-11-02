// 交易日志与复盘：只记录股池内股票的买卖。持仓成本用移动加权平均法，手续费计入成本/扣减收入。
const crypto = require('crypto');
const { HttpError } = require('./pool');
const { sh, isDate } = require('./time');

const r2 = (v) => Math.round(v * 100) / 100;

class Journal {
  constructor({ store, pool }) {
    Object.assign(this, { store, pool });
    this.entries = store.read('journal.json', []);
  }

  save() { this.store.write('journal.json', this.entries); }

  sorted(list = this.entries) {
    return [...list].sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  }

  // 按时间顺序回放，返回每只股票的持仓；卖出超过持仓时抛错
  replay(list) {
    const pos = {};
    const closed = [];
    for (const e of this.sorted(list)) {
      const p = pos[e.code] || (pos[e.code] = { code: e.code, name: e.name, qty: 0, cost: 0, realized: 0, buys: 0, sells: 0, fees: 0, firstBuy: null });
      p.fees += e.fee;
      if (e.side === 'buy') {
        p.cost += e.price * e.qty + e.fee; p.qty += e.qty; p.buys++;
        if (!p.firstBuy) p.firstBuy = e.date;
      } else {
        if (e.qty > p.qty) throw new HttpError(400, `${e.name} ${e.date} 卖出 ${e.qty} 股，但当时只持有 ${p.qty} 股`);
        const avg = p.cost / p.qty;
        const pnl = (e.price - avg) * e.qty - e.fee;
        closed.push({ id: e.id, code: e.code, name: e.name, date: e.date, qty: e.qty, buyAvg: r2(avg), sellPrice: e.price, pnl: r2(pnl), pct: r2((e.price / avg - 1) * 100), reason: e.reason, review: e.review });
        p.realized += pnl; p.cost -= avg * e.qty; p.qty -= e.qty; p.sells++;
        if (p.qty === 0) { p.cost = 0; p.firstBuy = null; }
      }
    }
    return { pos, closed };
  }

  add(body) {
    const code = String(body.code || '').trim();
    const item = this.pool.get(code);
    if (!item) throw new HttpError(400, `${code || '该代码'} 不在股池里。交易日志只记录股池内的股票`);
    const side = body.side;
    if (side !== 'buy' && side !== 'sell') throw new HttpError(400, '方向必须是 buy 或 sell');
    const price = Number(body.price), qty = Number(body.qty), fee = body.fee === undefined || body.fee === '' ? 0 : Number(body.fee);
    if (!(price > 0)) throw new HttpError(400, '成交价必须大于 0');
    if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, '数量必须是正整数（股）');
    if (!(fee >= 0)) throw new HttpError(400, '手续费不能为负');
    const date = body.date || sh().date;
    if (!isDate(date)) throw new HttpError(400, '日期格式 YYYY-MM-DD');
    if (date > sh().date) throw new HttpError(400, '日期不能晚于今天');
    const e = {
      id: crypto.randomUUID(), code, name: item.name, sector: item.sector, side, price, qty, fee, date,
      reason: String(body.reason || '').trim().slice(0, 500), review: '', createdAt: Date.now()
    };
    this.replay([...this.entries, e]); // 校验卖出不超过持仓
    this.entries.push(e);
    this.save();
    return e;
  }

  update(id, body) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) throw new HttpError(404, '没有这条记录');
    if (body.reason !== undefined) e.reason = String(body.reason).trim().slice(0, 500);
    if (body.review !== undefined) e.review = String(body.review).trim().slice(0, 1000);
    this.save();
    return e;
  }

  remove(id) {
    const rest = this.entries.filter((x) => x.id !== id);
    if (rest.length === this.entries.length) throw new HttpError(404, '没有这条记录');
    try { this.replay(rest); } catch (e) { throw new HttpError(409, '删除后后面的卖出会超过持仓，请先删除后面的记录。' + e.message); }
    this.entries = rest;
    this.save();
  }

  list() { return this.sorted().reverse(); }

  // 持仓 + 已实现 / 未实现盈亏 + 复盘统计
  summary(service) {
    const { pos, closed } = this.replay(this.entries);
    const holdings = [];
    let realized = 0, unrealized = 0, mv = 0;
    for (const p of Object.values(pos)) {
      realized += p.realized;
      const q = service && service.quotes[p.code];
      const bars = service && service.live[p.code];
      const last = q && q.price != null ? q.price : (bars && bars.length ? bars[bars.length - 1].close : null);
      const row = { code: p.code, name: p.name, inPool: this.pool.has(p.code), qty: p.qty, realized: r2(p.realized), last };
      if (p.qty > 0) {
        row.avgCost = r2(p.cost / p.qty);
        row.cost = r2(p.cost);
        if (last != null) {
          row.value = r2(last * p.qty); row.unrealized = r2(last * p.qty - p.cost); row.unrealizedPct = r2((last * p.qty / p.cost - 1) * 100);
          unrealized += row.unrealized; mv += row.value;
        }
        row.since = p.firstBuy;
      }
      if (p.qty > 0 || p.sells) holdings.push(row);
    }
    holdings.sort((a, b) => (b.value || 0) - (a.value || 0));
    const wins = closed.filter((c) => c.pnl > 0), losses = closed.filter((c) => c.pnl <= 0);
    const sum = (a) => a.reduce((s, c) => s + c.pnl, 0);
    const stats = {
      trades: this.entries.length, closedTrades: closed.length,
      winRate: closed.length ? r2(wins.length / closed.length * 100) : null,
      avgWin: wins.length ? r2(sum(wins) / wins.length) : null,
      avgLoss: losses.length ? r2(sum(losses) / losses.length) : null,
      profitFactor: losses.length && sum(losses) !== 0 ? r2(sum(wins) / Math.abs(sum(losses))) : null,
      best: closed.length ? [...closed].sort((a, b) => b.pnl - a.pnl)[0] : null,
      worst: closed.length ? [...closed].sort((a, b) => a.pnl - b.pnl)[0] : null
    };
    return {
      holdings, closed: closed.reverse(), stats,
      totals: { realized: r2(realized), unrealized: r2(unrealized), marketValue: r2(mv), total: r2(realized + unrealized) }
    };
  }
}

module.exports = { Journal };
