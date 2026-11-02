// 系统设置：存在 data/settings.json，网页「设置」里可改
const { HttpError } = require('./pool');
const { hmToMin } = require('./time');

const DEFAULTS = {
  reportTime: '08:00',        // 每天自动生成晨报的时间（北京时间）
  quotePollSec: 20,           // 交易时段行情刷新间隔（秒）
  offHoursPollMin: 10,        // 非交易时段行情刷新间隔（分钟）
  newsPollMin: 15,            // 新闻刷新间隔（分钟）
  newsDays: 3,                // 新闻保留最近几天
  indexBase: 1000,            // 股池指数基点
  indexBaseDate: '2024-09-02',// 这一天等于基点
  historyDays: 760,           // 下载的日线根数
  notifyMac: false            // 提醒触发时同时弹 macOS 系统通知
};

const RULES = {
  reportTime: (v) => hmToMin(v) != null,
  quotePollSec: (v) => Number.isInteger(v) && v >= 5 && v <= 600,
  offHoursPollMin: (v) => Number.isInteger(v) && v >= 1 && v <= 240,
  newsPollMin: (v) => Number.isInteger(v) && v >= 5 && v <= 240,
  newsDays: (v) => Number.isInteger(v) && v >= 1 && v <= 14,
  indexBase: (v) => typeof v === 'number' && v > 0 && v <= 1e6,
  indexBaseDate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
  historyDays: (v) => Number.isInteger(v) && v >= 300 && v <= 2000,
  notifyMac: (v) => typeof v === 'boolean'
};

class Settings {
  constructor(store) { this.store = store; this.values = { ...DEFAULTS, ...store.read('settings.json', {}) }; }
  get() { return { ...this.values }; }
  update(patch) {
    for (const k of Object.keys(patch)) {
      if (!(k in RULES)) throw new HttpError(400, `未知设置项：${k}`);
      if (!RULES[k](patch[k])) throw new HttpError(400, `设置项 ${k} 的值不合法`);
    }
    Object.assign(this.values, patch);
    this.store.write('settings.json', this.values);
    return this.get();
  }
}

module.exports = { Settings, DEFAULTS };
