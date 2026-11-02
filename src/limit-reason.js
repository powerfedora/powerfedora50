// 同花顺公开涨停复盘：按交易日返回涨停股及编辑整理的题材原因。
// 只在用户悬停到涨停 K 线时调用；结果由 Service 缓存，避免反复请求同一天。
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  Referer: 'http://stock.10jqka.com.cn/'
};

async function reasonsOn(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('日期格式不正确');
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 12000);
  try {
    const url = `http://zx.10jqka.com.cn/event/api/getharden/date/${day}/orderby/date/orderway/desc/charset/GBK/`;
    const res = await fetch(url, { headers: HEADERS, signal: ac.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = JSON.parse(await res.text());
    if (body.errocode !== 0 || !Array.isArray(body.data)) throw new Error(body.errormsg || '涨停复盘数据不可用');
    const out = new Map();
    body.data.forEach((x) => {
      const code = String(x.code || '').padStart(6, '0');
      const reason = String(x.reason || '').trim();
      if (/^\d{6}$/.test(code) && reason) out.set(code, { reason, source: '同花顺涨停复盘' });
    });
    return out;
  } finally { clearTimeout(timer); }
}

module.exports = { reasonsOn };
