// 东方财富数据提供方（服务端直接请求，没有浏览器跨域限制）
// 对外接口（mock.js 保持同样接口）：
//   quotes(secids)        -> [{secid, code, name, price, chg, ..., time(ms)}]
//   kline(secid, limit)   -> [{day, open, close, high, low, amount(亿)}]
//   news(keyword, size)   -> [{time, title, media, url}]
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
  Accept: '*/*'
};

const num = (v) => (v === '-' || v === undefined || v === null || v === '' ? null : Number(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 兼容 JSON 和 JSONP（jQuery123({...});）
function parseBody(text) {
  const t = text.trim();
  if (t[0] === '{' || t[0] === '[') return JSON.parse(t);
  const m = /^[^({\[]*\(([\s\S]*)\)\s*;?\s*$/.exec(t);
  if (!m) throw new Error('无法解析返回内容');
  return JSON.parse(m[1]);
}

async function getJSON(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ac.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return parseBody(await res.text());
  } finally { clearTimeout(timer); }
}

async function retry(fn, times = 3) {
  let err;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) { err = e; if (i < times - 1) await sleep(500 * (i + 1)); }
  }
  throw err;
}

const QFIELDS = 'f2,f3,f4,f5,f6,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f23,f124';

async function quotes(secids) {
  const out = [];
  for (let i = 0; i < secids.length; i += 60) {
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=' + QFIELDS + '&secids=' + secids.slice(i, i + 60).join(',') + '&_=' + Date.now();
    const d = await retry(() => getJSON(url));
    const raw = d && d.data && d.data.diff;
    const list = Array.isArray(raw) ? raw : Object.values(raw || {});
    for (const x of list) {
      out.push({
        secid: x.f13 + '.' + x.f12, code: String(x.f12), name: String(x.f14 || '').replace(/\s/g, ''),
        price: num(x.f2), chg: num(x.f3), chgAmt: num(x.f4), vol: num(x.f5), amount: num(x.f6),
        turnover: num(x.f8), pe: num(x.f9), high: num(x.f15), low: num(x.f16), open: num(x.f17), prevClose: num(x.f18),
        mcap: num(x.f20), pb: num(x.f23), time: x.f124 ? Number(x.f124) * 1000 : null
      });
    }
  }
  return out;
}

async function kline(secid, limit) {
  const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
    '&klt=101&fqt=1&lmt=' + limit + '&end=20500101&fields1=f1&fields2=f51,f52,f53,f54,f55,f57&_=' + Date.now();
  const d = await retry(() => getJSON(url, 20000));
  const ks = (d && d.data && d.data.klines) || [];
  return ks.map((s) => {
    const p = s.split(',');
    return { day: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], amount: +p[5] / 1e8 };
  });
}

async function news(keyword, size = 30) {
  const param = {
    uid: '', keyword, type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr',
    param: { cmsArticleWebOld: { searchScope: 'default', sort: 'time', pageIndex: 1, pageSize: size, preTag: '', postTag: '' } }
  };
  const url = 'https://search-api-web.eastmoney.com/search/jsonp?cb=pf&param=' + encodeURIComponent(JSON.stringify(param));
  const d = await retry(() => getJSON(url), 2);
  const arr = (d && d.result && d.result.cmsArticleWebOld) || [];
  return arr.map((a) => ({
    time: a.date, title: String(a.title || '').replace(/<[^>]+>/g, ''), media: a.mediaName || '',
    url: String(a.url || '').replace(/^http:\/\//, 'https://')
  }));
}

module.exports = { name: 'eastmoney', mock: false, quotes, kline, news, parseBody };
