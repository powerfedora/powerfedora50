// Jin10 market flashes, with transparent keyword associations to the current pool.
const {classify}=require('./sentiment');
const TOPICS=[
  ['食品饮料',/食品|饮料|白酒|啤酒|乳制品|乳业/],['家用电器',/家电|空调|冰箱|洗衣机/],['家居用品',/家居|厨柜|橱柜|卫浴|家具/],
  ['摩托车及其他',/摩托车|全地形车/],['游戏Ⅱ',/游戏|版号|电竞/],['纺织服饰',/纺织|服装|服饰|辅料/],['美容护理',/化妆品|护肤|美容|医美/],
  ['医药生物',/医药|医疗|创新药|中药|生物制药|医保|临床|药品|ADC|GLP-1/i],['电子',/半导体|芯片|集成电路|PCB|消费电子|存储|光刻|红外/i],
  ['通信',/通信|光模块|光通信|CPO|算力|数据中心|服务器|5G|6G/i],['计算机',/软件|计算机|人工智能|大模型|云计算|AI\b|网络安全|信创/i],
  ['电力设备',/电池|锂电|光伏|风电|储能|逆变器|电网|特高压|充电桩|新能源/],['机械设备',/机械|机器人|自动化|工业母机|液压|机床|高端装备/],
  ['汽车',/汽车|整车|轮胎|智能驾驶|自动驾驶|新能源车|汽配/],['有色金属',/有色|铜价|铜矿|铝价|锌价|稀土|矿业|金属/],['贵金属',/黄金|白银|金价|银价|贵金属/],
  ['包装印刷',/包装|印刷/],['造纸',/造纸|纸浆|纸价/],['燃气Ⅱ',/天然气|液化气|燃气|LNG/i],['电力',/电力|电价|发电|水电|核电|火电/],['专业服务',/检测|检验|认证/],
  ['银行',/银行股|银行业|商业银行/],['证券',/券商|证券业|证券板块/],['房地产',/房地产|楼市|商品房|房企/],['石油石化',/原油|油价|石油|炼油/],['煤炭',/煤炭|煤价|焦煤|动力煤/]
];
function plain(text) {
  return String(text || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]+>/g,'')
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/g,"'")
    .replace(/&#(\d{1,6});/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'').replace(/\s+/g,' ').trim();
}
function parseFlash(raw) {
  if(!raw || raw.extras?.ad || !/^\d{12,30}$/.test(String(raw.id)))return null;
  const d=raw.data || {},text=plain(d.content).slice(0,5000);
  const heading=/[【〖]([^】〗]+)[】〗]/.exec(text);
  const title=(plain(d.title || d.vip_title) || heading?.[1] || text.split(/[。\n]/)[0]).slice(0,180);
  if(!title || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw.time || ''))return null;
  return {id:String(raw.id),time:raw.time,title,text,locked:!!d.lock,important:!!raw.important,url:'https://flash.jin10.com/detail/'+raw.id};
}
async function latest() {
  const r=await fetch('https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1',{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://www.jin10.com/','x-app-id':'bVBF4FyRTn5NJF5n','x-version':'1.0.0'},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('金十接口 HTTP '+r.status);
  const d=await r.json();if(d.status!==200 || !Array.isArray(d.data))throw Error(d.message || '金十市场快讯数据格式异常');
  return d.data;
}
function matchFlash(item,pool,boards) {
  const text=item.title+' '+(item.text || '');
  const hits=new Map(),stocks=new Map();
  for(const [name,re] of TOPICS) {
    const m=re.exec(text);if(!m)continue;
    hits.set(name,{name,why:'文字包含“'+m[0]+'”'});
    const board=boards.find(b=>b.name===name),codes=new Set(board?.codes || []);
    for(const p of pool)if(codes.has(p.code))stocks.set(p.code,{code:p.code,name:p.name,why:'关联板块：'+name});
  }
  for(const p of pool)if(text.includes(p.name) || new RegExp('(^|\\D)'+p.code+'(\\D|$)').test(text)) {
    stocks.set(p.code,{code:p.code,name:p.name,why:'快讯直接提及公司名称或代码'});
    for(const b of boards)if(b.codes.includes(p.code) && !hits.has(b.name))hits.set(b.name,{name:b.name,why:'直接提及成分股：'+p.name});
  }
  let c=classify(item.title);
  if(c.label==='neutral') {
    const down=/(?:日内|股市|指数|板块)[^。；]{0,12}(?:跌幅|下跌|跌)[^。；]{0,8}\d|跌幅扩大至\d/.test(item.title);
    const up=/(?:日内|股市|指数|板块)[^。；]{0,12}(?:涨幅|上涨|涨)[^。；]{0,8}\d|涨幅扩大至\d/.test(item.title);
    if(down!==up)c={label:down?'bear':'bull',why:[down?'标题明确报告市场下跌':'标题明确报告市场上涨']};
  }
  return {...item,content:item.text || '',text:undefined,sentiment:{label:c.label,why:c.why.join('、') || '标题未发现明确的方向性措辞'},sectors:[...hits.values()],stocks:[...stocks.values()]};
}
class Intelligence {
  constructor({store,pool,sectors,source=latest,onUpdate=()=>{}}) {
    Object.assign(this,{store,pool,sectors,source,onUpdate});
    this.cache=store.read('intelligence/jin10.json',{at:0,attemptAt:0,error:null,items:[]});this.pending=null;
  }
  refresh() {
    if(this.pending)return this.pending;
    this.pending=(async()=>{
      this.cache.attemptAt=Date.now();
      try {
        const raw=await this.source(),items=raw.map(parseFlash).filter(Boolean);
        if(raw.length && !items.length)throw Error('返回内容中没有可解析的快讯标题');
        const merged=new Map(this.cache.items.map(x=>[x.id,x]));items.forEach(x=>merged.set(x.id,x));
        this.cache={at:Date.now(),attemptAt:this.cache.attemptAt,error:null,items:[...merged.values()].sort((a,b)=>b.time.localeCompare(a.time)||b.id.localeCompare(a.id)).slice(0,500)};
      }catch(e){this.cache.error=e.message;}
      this.store.write('intelligence/jin10.json',this.cache);this.onUpdate({at:this.cache.at});
      return this.view();
    })().finally(()=>{this.pending=null;});return this.pending;
  }
  view() {
    const boards=(this.sectors.cache?.rows || []).map(b=>({name:b.name,codes:this.sectors.membersByBoard?.[b.code]?.codes || []}));
    return {...this.cache,intervalSec:20,source:'https://www.jin10.com/',items:this.cache.items.map(n=>matchFlash(n,this.pool.list(),boards)),membershipReady:boards.some(b=>b.codes.length)};
  }
}
module.exports={parseFlash,matchFlash,Intelligence,latest};
