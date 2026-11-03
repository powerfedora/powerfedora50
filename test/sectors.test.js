const test = require('node:test');
const assert = require('node:assert/strict');
const { mappingFor, leaderRows, SectorService } = require('../src/sectors');

test('sector mapping covers every current pool category without inventing indices', () => {
  for (const sector of ['食品饮料','家电家居','其他消费','医药','电子','通信计算机','电力设备','机械','汽车','资源','化工材料','公用交运','服务']) assert.ok(mappingFor(sector).length, sector);
  assert.deepEqual(mappingFor('未配置的新分类'), []);
  assert.ok(mappingFor('通信计算机').length > 1);
});

test('leaders use A-share market capitalization rather than daily return', () => {
  const rows = leaderRows([{ f12:'600519',f14:'甲',f20:900,f3:-2,f13:1 },{f12:'900001',f14:'B股',f20:9999,f3:10,f13:1},{f12:'000001',f14:'乙',f20:100,f3:9,f13:0}]);
  assert.equal(rows[0].code,'600519'); assert.equal(rows.length,2);
  assert.equal(leaderRows([{f12:'920180',f14:'北交所',f20:100,f3:1,f13:0}])[0].code,'920180');
});

test('sector refresh retains failures and uses real history for technical indicators', async () => {
  const catalog = [{f12:'BK0438',f14:'食品饮料',f2:200,f3:1,f6:3e8,f124:1793660000}];
  const store = { read: (n,d)=>d, write(){} };
  const service = { pool:{list:()=>[{sector:'食品饮料'}]}, provider:{mock:false}, benchmarkLive:[] };
  let historyFail = false;
  const bars = Array.from({length:300},(_,i)=>({day:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:100+i,close:101+i,high:102+i,low:99+i,amount:3}));
  const sectors = new SectorService({store,service, source:{ catalog:async()=>catalog, members:async()=>[], kline:async()=>{if(historyFail) throw Error('离线'); return bars;} }});
  let r = await sectors.get(true);
  assert.equal(r.rows[0].name,'食品饮料'); assert.ok(r.rows[0].rsi != null);
  historyFail = true; sectors.histories.BK0438.at = 0; r = await sectors.get(true);
  assert.ok(r.rows[0].warnings.some(w=>w.includes('离线')));
  assert.ok(r.rows[0].rsi != null, 'retain available cached history');
});

test('sector service exposes unavailable data explicitly and preserves cached rows on outage', async () => {
  const service = {pool:{list:()=>[{sector:'食品饮料'}]},provider:{mock:false},benchmarkLive:[]};
  const store={read:(n,d)=>d,write(){}};
  const source={catalog:async()=>[{f12:'BK0438',f14:'食品饮料',f2:200,f3:1}],members:async()=>{throw Error('成分离线');},kline:async()=>{throw Error('日线离线');}};
  const sectors=new SectorService({store,service,source});
  const r=await sectors.get(true);
  assert.equal(r.rows[0].rsi,undefined);
  assert.equal(r.rows[0].warnings.length,2);
  source.catalog=async()=>{throw Error('行情离线');};
  const cached=await sectors.get(true);
  assert.equal(cached.stale,true);
  assert.equal(cached.rows[0].px,200);
  assert.match(cached.warnings[0],/行情离线/);
});

test('sector service uses the local sector cache when its own data directory is empty and the source is offline', async () => {
  const bars = Array.from({ length: 25 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, close: 100 + i, open: 100 + i, high: 101 + i, low: 99 + i, amount: 1 }));
  const fallback = {
    read(name, def) {
      const files = {
        'sectors/cache.json': { at: Date.parse('2026-11-03T15:22:50+08:00'), rows: [{ code: 'BK0438', name: '食品饮料', rs20: 12, historyDay: '2026-11-03', rsDay: '2026-11-03' }], warnings: [] },
        'sectors/history.json': { BK0438: { at: Date.parse('2026-11-03T15:22:50+08:00'), bars } },
        'sectors/rotation.json': [{ date: '2026-11-03', top: [{ code: 'BK0438', name: '食品饮料', rs20: 12 }], bottom: [] }],
        'sectors/members.json': {}
      };
      return files[name] || def;
    }
  };
  const service = { pool: { list: () => [{ sector: '食品饮料' }] }, provider: { mock: false }, benchmarkLive: [] };
  const primary = {
    'sectors/cache.json': { at: Date.parse('2026-11-03T16:34:13+08:00'), rows: [{ code: 'BK0438', name: '食品饮料', historyDay: null }], warnings: [] },
    'sectors/history.json': {}
  };
  const sectors = new SectorService({ store: { read: (name, def) => primary[name] || def, write() {} }, fallbackStore: fallback, service, source: { catalog: async () => { throw Error('数据源离线'); } } });
  const result = await sectors.get(true);
  assert.equal(result.rows[0].name, '食品饮料');
  assert.equal(result.rotation.length, 1);
  assert.equal(result.stale, true);
  assert.match(result.warnings[0], /显示本地缓存/);
});

test('rotation hover members intersect the full sector membership with the current pool',async()=>{
  let pool=[{code:'600001',name:'股池甲',sector:'食品饮料'},{code:'600051',name:'股池乙',sector:'食品饮料'},{code:'600099',name:'同类但不在板块',sector:'食品饮料'}];
  const sectors=new SectorService({store:{read:(n,d)=>d,write(){}},service:{pool:{list:()=>pool},provider:{mock:false},benchmarkLive:[]},source:{
    catalog:async()=>[{f12:'BK0438',f14:'食品饮料'}],members:async()=>[],kline:async()=>[],
    constituents:async()=>Array.from({length:51},(_,i)=>({f12:'600'+String(i+1).padStart(3,'0')}))
  }});
  let r=await sectors.get(true);
  assert.deepEqual(r.rows[0].poolMembers.map(p=>p.name),['股池甲','股池乙']);
  pool=pool.slice(1);
  r=await sectors.get();
  assert.deepEqual(r.rows[0].poolMembers.map(p=>p.name),['股池乙'],'pool changes apply even with cached sector data');
});
