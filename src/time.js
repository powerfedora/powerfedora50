// 北京时间工具：所有"今天""几点"都按 Asia/Shanghai 计算，和服务器所在时区无关
const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});

function sh(d = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const hh = Number(p.hour) % 24;
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${String(hh).padStart(2, '0')}:${p.minute}:${p.second}`;
  return {
    date, time, str: `${date} ${time}`,
    min: hh * 60 + Number(p.minute),
    wd: new Date(date + 'T00:00:00Z').getUTCDay() // 0=周日
  };
}

// A 股交易时段：9:15–11:32、13:00–15:02（周一到周五；法定节假日由行情时间判断，见 service）
function isTradingTime(d = new Date()) {
  const t = sh(d);
  return t.wd >= 1 && t.wd <= 5 && ((t.min >= 555 && t.min <= 692) || (t.min >= 780 && t.min <= 902));
}

function addDays(date, n) {
  const x = new Date(date + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const hmToMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

module.exports = { sh, isTradingTime, addDays, isDate, hmToMin };
