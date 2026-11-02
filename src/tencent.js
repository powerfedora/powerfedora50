// 腾讯财经数据提供方（东方财富不可用时的备用源，只支持沪深行情和日线）
// 接口和 em.js 一致：quotes(secids) / kline(secid, limit)，secid 形如 1.600519（1=沪 0=深）。
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  Referer: 'https://gu.qq.com/'
};

const num = (v) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));

// 1.600519 -> sh600519；只认沪深（0/1）市场
function symbolOf(secid) {
  const m = /^([01])\.(\d{6})$/.exec(secid);
  return m ? (m[1] === '1' ? 'sh' : 'sz') + m[2] : null;
}
const supports = (secid) => symbolOf(secid) !== null;

async function get(url, timeoutMs, decoder) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ac.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return new TextDecoder(decoder || 'utf-8').decode(await res.arrayBuffer());
  } finally { clearTimeout(timer); }
}

// 20261030102645 -> 毫秒时间戳（北京时间）
function parseTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s || '');
  return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`) : null;
}

function parseQuotes(text) {
  const out = [];
  for (const line of text.split(';')) {
    const m = /v_(sh|sz)(\d{6})="([^"]*)"/.exec(line);
    if (!m || !m[3]) continue;
    const f = m[3].split('~');
    out.push({
      secid: (m[1] === 'sh' ? '1.' : '0.') + m[2], code: m[2], name: String(f[1] || '').replace(/\s/g, ''),
      price: num(f[3]), chg: num(f[32]), chgAmt: num(f[31]), vol: num(f[6]), amount: num(f[37]) == null ? null : num(f[37]) * 1e4,
      turnover: num(f[38]), pe: num(f[39]), high: num(f[33]), low: num(f[34]), open: num(f[5]), prevClose: num(f[4]),
      mcap: num(f[45]) == null ? null : num(f[45]) * 1e8, pb: num(f[46]), time: parseTime(f[30])
    });
  }
  return out;
}

async function quotes(secids) {
  const syms = secids.map(symbolOf).filter(Boolean);
  const out = [];
  for (let i = 0; i < syms.length; i += 60) {
    const text = await get('https://qt.gtimg.cn/q=' + syms.slice(i, i + 60).join(','), 10000, 'gbk');
    out.push(...parseQuotes(text));
  }
  return out;
}

// 腾讯日线没有成交额：个股按 成交量(手)×100×均价 估算，指数记 0
function parseKline(sym, body, limit) {
  const d = body && body.data && body.data[sym];
  const rows = (d && (d.qfqday || d.day)) || [];
  const isIdx = /^(sh000|sz399)/.test(sym);
  return rows.slice(-limit).map((p) => {
    const open = +p[1], close = +p[2], high = +p[3], low = +p[4], vol = +p[5];
    return { day: p[0], open, close, high, low, amount: isIdx ? 0 : +((vol * 100 * (open + close + high + low) / 4) / 1e8).toFixed(3) };
  });
}

async function kline(secid, limit) {
  const sym = symbolOf(secid);
  if (!sym) throw new Error('腾讯源不支持 ' + secid);
  const text = await get(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,${limit},qfq`, 20000);
  return parseKline(sym, JSON.parse(text), limit);
}

// 分时数据：最近 5 个交易日 [{date, pts:[[HHMM, 累计成交额(元), 价格], ...]}]，最新的一天在前
async function intraday(secid) {
  const sym = symbolOf(secid);
  if (!sym) throw new Error('腾讯源不支持 ' + secid);
  const body = JSON.parse(await get('https://web.ifzq.gtimg.cn/appstock/app/day/query?code=' + sym, 15000));
  const days = (body && body.data && body.data[sym] && body.data[sym].data) || [];
  return days.slice(0, 5).map((d) => ({
    date: d.date,
    pts: (d.data || []).map((l) => l.split(' ')).filter((p) => p.length >= 4).map((p) => [p[0], Number(p[3]), Number(p[1])])
  }));
}

module.exports = { name: 'tencent', mock: false, quotes, kline, intraday, supports, parseQuotes, parseKline };
