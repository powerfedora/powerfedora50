// 组合数据源：主源（东方财富）失败时，沪深行情和日线改用备用源（腾讯）。
// 新闻、美股行情只有主源有，失败就照常报错。主源失败后 COOLDOWN 内直接走备用源，避免每次都等超时。
const COOLDOWN = 60 * 1000;

function create(primary, backup) {
  const downUntil = { quotes: 0, kline: 0 };

  async function withBackup(method, args, canBackup) {
    if (Date.now() >= downUntil[method] || !canBackup) {
      try { return await primary[method](...args); } catch (e) {
        if (!canBackup) throw e;
        downUntil[method] = Date.now() + COOLDOWN;
      }
    }
    return backup[method](...args);
  }

  return {
    name: `${primary.name}+${backup.name}`, mock: !!primary.mock,
    news: (...a) => primary.news(...a),
    // 混合请求（含美股等）先试主源；失败后只把沪深部分交给备用源，其余丢弃
    async quotes(secids) {
      const cn = secids.filter(backup.supports);
      if (Date.now() >= downUntil.quotes || !cn.length) {
        try { return await primary.quotes(secids); } catch (e) {
          if (!cn.length) throw e;
          downUntil.quotes = Date.now() + COOLDOWN;
        }
      }
      return backup.quotes(cn);
    },
    // 分时成交额只有备用源（腾讯）有
    intraday: (secid) => backup.intraday(secid),
    kline: (secid, limit) => withBackup('kline', [secid, limit], backup.supports(secid))
  };
}

module.exports = { create };
