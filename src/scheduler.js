// 调度器：每 5 秒检查一次有哪些任务到点了
//   行情     交易时段每 quotePollSec 秒，其余时间每 offHoursPollMin 分钟
//   日线     每天第一次启动、收盘后（15:10）各更新一次
//   成交额对比 交易时段每 1 分钟，其余每 10 分钟
//   指数分时 交易时段每 15 秒，其余每 10 分钟
//   美股     每 10 分钟
//   新闻     每 newsPollMin 分钟
//   晨报     每天 reportTime 到点生成；电脑当时没开机的话，开机后补生成一份
const { sh, isTradingTime, hmToMin } = require('./time');
const { generate, Reports } = require('./report');

const log = (...a) => console.log(`[${sh().str}]`, ...a);

class Scheduler {
  constructor({ service, reports, clock = () => new Date(), sectors, intelligence }) {
    Object.assign(this, { service, reports, clock, sectors, intelligence });
    this.last = {};
    this.timer = null;
    this.running = new Set();
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 5000);
    this.timer.unref && this.timer.unref();
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  due(name, everyMs, now) { return !this.last[name] || now - this.last[name] >= everyMs; }

  async run(name, fn) {
    if (this.running.has(name)) return;
    this.running.add(name);
    this.last[name] = this.clock().getTime();
    try { await fn(); } catch (e) { log(`任务 ${name} 失败：${e.message}`); } finally { this.running.delete(name); }
  }

  async makeReport(late) {
    const r = await generate(this.service, { now: this.clock() });
    if (late) r.warnings.unshift('这份晨报是开机后补生成的，不是准点生成');
    this.reports.save(r);
    this.service.emit('report', { date: r.date });
    log(`晨报已生成 ${r.date}`);
    return r;
  }

  tick() {
    const d = this.clock(), now = d.getTime(), s = this.service.settings.get(), t = sh(d);
    const quoteEvery = (isTradingTime(d) ? s.quotePollSec * 1000 : s.offHoursPollMin * 60000);
    if (this.running.has('history')) { /* 日线下载中，行情先等一等 */ }
    else if (this.due('quotes', quoteEvery, now)) this.run('quotes', () => this.service.refreshQuotes());
    if (this.due('history', 300000, now)) this.run('history', () => this.service.refreshHistory());
    if (this.due('volume', isTradingTime(d) ? 60000 : 600000, now)) this.run('volume', () => this.service.refreshVolume());
    if (this.due('idxmin', isTradingTime(d) ? 15000 : 600000, now)) this.run('idxmin', () => this.service.refreshIndexMinutes());
    if (this.due('hotspots', isTradingTime(d) ? 15000 : 600000, now)) this.run('hotspots', () => this.service.refreshHotspots(t.date));
    if (this.due('us', 600000, now)) this.run('us', () => this.service.refreshUs());
    if (this.due('news', s.newsPollMin * 60000, now)) this.run('news', () => this.service.refreshNews());

    // Persist daily sector rotation even when its page is closed.
    if (this.sectors && this.due('sectors', 60000, now)) this.run('sectors', () => this.sectors.get());

    if (this.intelligence && !this.service.provider.mock && this.due('intelligence', 20000, now)) this.run('intelligence', () => this.intelligence.refresh());

    const rm = hmToMin(s.reportTime);
    if (rm != null && t.min >= rm && !this.reports.has(t.date) && !this.running.has('report') && this.due('report', 600000, now)) {
      this.run('report', () => this.makeReport(t.min > rm + 30));
    }
  }
}

module.exports = { Scheduler };
