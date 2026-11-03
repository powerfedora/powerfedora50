// Market sector indices: pool categories map to published Eastmoney industry indices.
const em = require('./em');
const { updateRotation } = require('./sector-rotation');
const IND = require('../public/js/indicators');
const { sh } = require('./time');
const MAPPING = {
  食品饮料: ['食品饮料'], 家电家居: ['家用电器', '家居用品'],
  其他消费: ['摩托车及其他', '游戏Ⅱ', '纺织服饰', '美容护理'],
  医药: ['医药生物'], 电子: ['电子'], 通信计算机: ['通信', '计算机'],
  电力设备: ['电力设备'], 机械: ['机械设备'], 汽车: ['汽车'],
  资源: ['有色金属', '贵金属'], 化工材料: ['包装印刷', '造纸'],
  公用交运: ['燃气Ⅱ', '电力'], 服务: ['专业服务']
};
const mappingFor = sector => MAPPING[sector] || [];
const num = v => v == null || v === '-' || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
async function list(params, allPages=false) {
  const url = new URL('https://push2.eastmoney.com/api/qt/clist/get');
  url.search = new URLSearchParams({pn:'1',pz:'600',fltt:'2',invt:'2',...params});
  const r = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0',Referer:'https://quote.eastmoney.com/'}, signal:AbortSignal.timeout(12000)});
  if (!r.ok) throw Error('东方财富 HTTP ' + r.status);
  const d = await r.json();
  if (!d.data?.diff) throw Error('东方财富未返回板块数据');
  const rows=Object.values(d.data.diff);
  if(allPages) for(let page=2;page<=Math.ceil(d.data.total/100);page++) {
    rows.push(...await list({...params,pn:String(page),pz:'100'}));
  }
  return rows;
}
const source = {
  catalog: () => list({fs:'m:90+t:2',pz:'100',fields:'f12,f14,f2,f3,f22,f10,f6,f9,f15,f16,f17,f18,f124,f128,f140,f141'},true),
  members: code => list({fs:'b:'+code,fid:'f20',po:'1',pz:'30',fields:'f12,f13,f14,f20,f3'}),
  constituents: code => list({fs:'b:'+code,pz:'100',fields:'f12,f14'},true),
  kline: (secid,limit) => em.kline(secid,limit)
};
function leaderRows(items) {
  return items.filter(x=>/^(?:[03648]\d{5}|920\d{3})$/.test(x.f12) && [0,1].includes(Number(x.f13)) && num(x.f20)>0)
    .sort((a,b)=>b.f20-a.f20).slice(0,3).map(x=>({code:x.f12,name:x.f14.replace(/\s/g,''),mcap:num(x.f20),chg:num(x.f3)}));
}
class SectorService {
  constructor({store,service,source:provider=source,fallbackStore=null}) {
    Object.assign(this,{store,service,source:provider});
    this.cache=store.read('sectors/cache.json',{at:0,rows:[],warnings:[]});
    this.histories=store.read('sectors/history.json',{});
    this.rotation=store.read('sectors/rotation.json',[]);
    this.membersByBoard=store.read('sectors/members.json',{});
    // 端口/数据目录切换后，新目录可能还没有板块日线；此时只读使用项目本地已有缓存。
    // 下一次正常刷新会写回当前目录，外部数据始终优先于这份本地回退。
    const hasHistory=Object.values(this.histories).some(history=>Array.isArray(history?.bars) && history.bars.length);
    if (!hasHistory && fallbackStore) {
      const cache=fallbackStore.read('sectors/cache.json',null);
      if (cache && Array.isArray(cache.rows) && cache.rows.length) {
        this.cache=cache;
        this.histories=fallbackStore.read('sectors/history.json',this.histories);
        this.rotation=fallbackStore.read('sectors/rotation.json',this.rotation);
        this.membersByBoard=fallbackStore.read('sectors/members.json',this.membersByBoard);
        this.usingLocalFallback=true;
      }
    }
    this.pending=null;
  }
  withRotation(data) {
    if(!data.stale && data.rows.length) {
      const next=updateRotation(this.rotation,this.histories,this.service.benchmarkLive || [],data.rows,new Date(data.at || Date.now()));
      if(JSON.stringify(next)!==JSON.stringify(this.rotation)) {this.rotation=next;this.store.write('sectors/rotation.json',next);}
    }
    const pool=this.service.pool.list();
    const rows=data.rows.map(row=>{
      const membership=this.membersByBoard[row.code];
      const codes=membership?new Set(membership.codes):null;
      return {...row,poolMembers:codes?pool.filter(p=>codes.has(p.code)).map(p=>({code:p.code,name:p.name})):null,membersAt:membership?.at || null};
    });
    return {...data,rows,rotation:this.rotation};
  }
  async get(force=false) {
    if(this.pending) return this.pending;
    if(!force && this.cache.at && Date.now()-this.cache.at<60000) return this.withRotation(this.cache);
    this.pending=this.refresh().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async refresh() {
    if(this.service.provider.mock) return {at:0,rows:[],warnings:['模拟模式不请求真实板块数据']};
    let catalog;
    try {catalog=await this.source.catalog();} catch(e) {
      const fallbackNote=this.usingLocalFallback?'显示本地缓存':'显示上次缓存';
      return this.withRotation({...this.cache,warnings:['板块行情更新失败：'+e.message+'；'+fallbackNote],stale:true});
    }
    const requested=new Map(), warnings=[];
    for(const sector of new Set(this.service.pool.list().map(p=>p.sector))) {
      const names=mappingFor(sector);
      if(!names.length) warnings.push('尚未配置分类映射：'+sector);
      for(const name of names) {
        const q=catalog.find(x=>x.f14===name);
        if(!q) {warnings.push('数据源未找到板块：'+name);continue;}
        if(!requested.has(q.f12)) requested.set(q.f12,{q,sectors:[]});
        requested.get(q.f12).sectors.push(sector);
      }
    }
    const rows=[]; const entries=[...requested.values()];
    for(let i=0;i<entries.length;i+=5) {
      rows.push(...await Promise.all(entries.slice(i,i+5).map(async ({q,sectors})=>{
        const code=q.f12, old=this.cache.rows.find(r=>r.code===code), issues=[];
        let history=this.histories[code], leaders=old?.leaders || [], leadersAt=old?.leadersAt || null;
        const today=sh().date;
        const tasks=[];
        if(!history?.bars?.length || sh(new Date(history.at)).date!==today) tasks.push((async()=>{
          try {const bars=await this.source.kline('90.'+code,500);if(!bars.length)throw Error('空日线');history={at:Date.now(),bars};this.histories[code]=history;}
          catch(e){issues.push('历史日线不可用：'+e.message);}
        })());
        if(!leadersAt || Date.now()-leadersAt>600000) tasks.push((async()=>{
          try {leaders=leaderRows(await this.source.members(code));leadersAt=Date.now();if(!leaders.length)issues.push('暂无可用龙头成分股');}
          catch(e){issues.push('龙头成分更新失败：'+e.message);}
        })());
        const membership=this.membersByBoard[code];
        if(this.source.constituents && (!membership || sh(new Date(membership.at)).date!==today)) tasks.push((async()=>{
          try {const members=await this.source.constituents(code);this.membersByBoard[code]={at:Date.now(),codes:members.map(p=>String(p.f12))};}
          catch(e){issues.push('板块成分获取失败：'+e.message);}
        })());
        await Promise.all(tasks);
        const bars=(history?.bars || []).slice();
        const px=num(q.f2),time=num(q.f124)?Number(q.f124)*1000:null;
        if(px!=null && time && num(q.f17)>0 && bars.length) {
          const day=sh(new Date(time)).date;
          while(bars.length && bars[bars.length-1].day>=day) bars.pop();
          bars.push({day,open:num(q.f17),high:num(q.f15),low:num(q.f16),close:px,amount:num(q.f6)/1e8});
        }
        const a=IND.analyze(bars), flow=bars.length?IND.flowStatus(bars,IND.flowTrend(bars)):null;
        const rs=IND.relativeStrength(bars,this.service.benchmarkLive || [],20);
        return {code,name:q.f14,sector:sectors.join('、'),px,chg:num(q.f3),speed:num(q.f22),volumeRatio:num(q.f10),amount:num(q.f6)==null?null:num(q.f6)/1e8,pe:num(q.f9),time,
          trend:a?.trend,macdState:a?.macdState,rsi:a?.rsi,rsiState:a?.rsiState,r20:a?.r20,rs20:rs?.value,rsDay:rs?.end,ytd:a?.ytd,
          flow,vol:null,us:null,leaders,leadersAt,leading:q.f140?{code:q.f140,name:q.f128}:null,
          historyDay:bars.at(-1)?.day || null,warnings:issues,
          source:'https://data.eastmoney.com/bkzj/'+code+'.html'};
      })));
    }
    this.cache={at:Date.now(),rows,warnings,stale:false};
    this.store.write('sectors/members.json',this.membersByBoard);
    this.store.write('sectors/cache.json',this.cache);this.store.write('sectors/history.json',this.histories);
    return this.withRotation(this.cache);
  }
}
module.exports={SectorService,mappingFor,leaderRows};
