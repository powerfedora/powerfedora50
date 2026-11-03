const test=require('node:test');
const assert=require('node:assert/strict');
const {parseFlash,matchFlash,Intelligence}=require('../src/intelligence');

test('Jin10 headlines strip markup and use official per-flash links',()=>{
  const n=parseFlash({id:'20261103110000000001',time:'2026-11-03 11:00:00',type:0,data:{content:'<b>【光伏行业订单大增】</b>正文<script>bad()</script>'}});
  assert.equal(n.title,'光伏行业订单大增');assert.equal(n.url,'https://flash.jin10.com/detail/20261103110000000001');
  assert.equal(parseFlash({id:'x',extras:{ad:true},data:{title:'广告'}}),null);
});

test('news association uses real membership and direct company mentions, excluding nonpool stocks',()=>{
  const pool=[{code:'300750',name:'宁德时代'},{code:'600519',name:'贵州茅台'}];
  const boards=[{name:'电力设备',codes:['300750','000001']},{name:'食品饮料',codes:['600519']}];
  const a=matchFlash({title:'电池产业订单大增',text:''},pool,boards);
  assert.ok(a.sectors.some(x=>x.name==='电力设备'));assert.deepEqual(a.stocks.map(x=>x.code),['300750']);assert.equal(a.sentiment.label,'bull');
  const b=matchFlash({title:'贵州茅台发布公告',text:''},pool,boards);
  assert.deepEqual(b.stocks.map(x=>x.code),['600519']);
  const c=matchFlash({title:'美元兑日元报150',text:''},pool,boards);
  assert.equal(matchFlash({title:'标题',text:'完整快讯正文'},pool,boards).content,'完整快讯正文');
  assert.equal(c.stocks.length,0);assert.equal(c.sentiment.label,'neutral');
  assert.equal(matchFlash({title:'现货白银日内跌1.27%'},pool,boards).sentiment.label,'bear');
});

test('polling deduplicates items, persists cache, and preserves news on failures',async()=>{
  let fail=false;const disk={};
  const news={id:'20261103110000000001',time:'2026-11-03 11:00:00',data:{content:'【市场快讯】测试'}};
  const intel=new Intelligence({store:{read:(n,d)=>disk[n]||d,write:(n,v)=>{disk[n]=v;}},pool:{list:()=>[]},sectors:{cache:{rows:[]},membersByBoard:{}},source:async()=>{if(fail)throw Error('连接失败');return [news,news];}});
  await intel.refresh();assert.equal(intel.view().items.length,1);
  await intel.refresh();assert.equal(intel.view().items.length,1);
  fail=true;await intel.refresh();assert.equal(intel.view().items.length,1);assert.match(intel.view().error,/连接失败/);
  assert.ok(Object.keys(disk).length);
});

test('intelligence scheduler collects once per 20 seconds',()=>{
  const {Scheduler}=require('../src/scheduler');let now=100000,calls=0;
  const service={provider:{mock:false},settings:{get:()=>({quotePollSec:20,offHoursPollMin:10,newsPollMin:15,reportTime:'08:00'})}};
  for(const k of ['refreshQuotes','refreshHistory','refreshVolume','refreshIndexMinutes','refreshHotspots','refreshUs','refreshNews'])service[k]=async()=>{};
  const scheduler=new Scheduler({service,reports:{has:()=>true},clock:()=>new Date(now),intelligence:{refresh:async()=>{calls++;}}});
  scheduler.tick();assert.equal(calls,1);
  // Completion clears the scheduler's in-flight guard on the next microtask.
  return new Promise(resolve=>setImmediate(resolve)).then(()=>{now+=19999;scheduler.tick();assert.equal(calls,1);now++;scheduler.tick();assert.equal(calls,2);});
});
