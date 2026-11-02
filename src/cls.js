// 财联社「看盘」公开页面的盘中锚点。页面本身也使用相同的查询参数和 SHA-1 签名。
// 返回的是全市场题材（如白酒、证券、人形机器人），不是本项目股池里的行业分类。
const crypto = require('crypto');

const BASE = 'https://www.cls.cn';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  Referer: 'https://www.cls.cn/finance',
  Accept: 'application/json, text/plain, */*'
};

const order = (a, b) => String(a).toUpperCase() > String(b).toUpperCase() ? 1 : String(a).toUpperCase() === String(b).toUpperCase() ? 0 : -1;

function sign(params) {
  const source = Object.keys(params).sort(order).map((key) => `${key}=${params[key]}`).join('&');
  return crypto.createHash('sha1').update(source).digest('hex');
}

function parseAnchor(item) {
  const m = /(?:^|\s)(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(item && item.c_time || ''));
  const sector = String(item && item.symbol_name || '').trim();
  if (!m || !sector) return null;
  const float = item.float === 'up' || item.float === 'down' ? item.float : 'neutral';
  return { t: m[1] + m[2], sector, dir: float, source: 'cls', symbolCode: String(item.symbol_code || '') };
}

async function anchors(date, { fetcher = fetch } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('财联社日期格式不正确');
  const params = { app: 'CailianpressWeb', cdate: date, os: 'web', sv: '8.7.9' };
  params.sign = sign(params);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetcher(`${BASE}/v3/transaction/anchor?${new URLSearchParams(params)}`, { headers: HEADERS, signal: ac.signal });
    if (!res.ok) throw new Error('财联社 HTTP ' + res.status);
    const body = await res.json();
    if (body.errno !== 0 || !Array.isArray(body.data)) throw new Error(body.msg || '财联社盘中锚点暂不可用');
    const seen = new Set();
    return body.data.map(parseAnchor).filter((x) => {
      if (!x || seen.has(x.t + x.sector)) return false;
      seen.add(x.t + x.sector);
      return true;
    });
  } finally { clearTimeout(timer); }
}

module.exports = { anchors, sign, parseAnchor };
