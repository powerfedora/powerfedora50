const test=require('node:test');
const assert=require('node:assert/strict');
const em=require('../src/em');
const {Service}=require('../src/service');
const {SectorService}=require('../src/sectors');

test('Eastmoney requests speed and volume ratio, preserving zeros and missing data',async()=>{
  const previous=global.fetch;
  global.fetch=async url=>{
    const fields=new URL(url).searchParams.get('fields').split(',');
    assert.ok(fields.includes('f22'));assert.ok(fields.includes('f10'));
    return {ok:true,text:async()=>JSON.stringify({data:{diff:[{f12:'600519',f13:1,f22:0,f10:1.25},{f12:'000001',f13:0,f22:'-',f10:'-'}]}})};
  };
  try {
    const rows=await em.quotes(['1.600519','0.000001']);
    assert.equal(rows[0].speed,0);assert.equal(rows[0].volumeRatio,1.25);
    assert.equal(rows[1].speed,null);assert.equal(rows[1].volumeRatio,null);
  }finally{global.fetch=previous;}
});

test('stock table row exposes raw quote speed and volume ratio',()=>{
  const ctx={quotes:{'600519':{speed:-0.32,volumeRatio:2.1}},an:{},rs:{},vol:{},news:{data:{}},usView:()=>null};
  const row=Service.prototype.row.call(ctx,{code:'600519',name:'贵州茅台',sector:'食品饮料'});
  assert.equal(row.speed,-0.32);assert.equal(row.volumeRatio,2.1);
});

test('sector table row exposes speed and volume ratio without substituting other metrics',async()=>{
  const service={pool:{list:()=>[{sector:'食品饮料'}]},provider:{mock:false},benchmarkLive:[]};
  const sectors=new SectorService({store:{read:(n,d)=>d,write(){}},service,source:{
    catalog:async()=>[{f12:'BK0438',f14:'食品饮料',f22:-0.12,f10:0}],members:async()=>[],kline:async()=>[]
  }});
  const row=(await sectors.get(true)).rows[0];
  assert.equal(row.speed,-0.12);assert.equal(row.volumeRatio,0);
});

test('history outage does not disable healthy primary quotes and their live metrics',async()=>{
  const {create}=require('../src/fallback');
  const provider=create({name:'primary',kline:async()=>{throw Error('历史离线');},quotes:async()=>[{speed:0.12,volumeRatio:1.5}]},{name:'backup',supports:()=>true,kline:async()=>[],quotes:async()=>[{speed:null}]});
  await provider.kline('1.600519',300);
  assert.equal((await provider.quotes(['1.600519']))[0].volumeRatio,1.5);
});
