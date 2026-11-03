// Published sector indices corresponding to the pool's custom categories.
(function () {
  const {h,$,api,fmt,pct,sign}=PF;
  const S={data:null,sort:'chg',dir:-1,q:'',sector:'all',loading:null,rotationSelected:null,rotationPopoverKey:null,rotationCloseTimer:null,suppressRotationFocus:false};
  const cols=[['code','代码'],['name','板块指数'],['sector','股池分类'],['px','点位'],['chg','涨跌%'],['amount','成交额(亿)'],['trend','趋势'],['flow','量能趋势(20日)'],['macdState','MACD'],['rsi','RSI14'],['r20','近20日%'],['rs20','RS20 vs 沪深300'],['ytd','年内%'],['us','对标美股'],['pe','PE(TTM)'],['leaders','龙头股（市值前三）'],['leading','当日领涨股'],['speed','涨速%'],['volumeRatio','量比']];
  const order=[0,1,2,3,4,17,18,5,15,16,6,7,8,9,10,11,12,13,14];
  const textCols=['code','name','sector','trend','macdState','leaders','leading'];
  const stockLink = p => h('a',{href:'https://quote.eastmoney.com/'+(/^(4|8|920)/.test(p.code)?'bj':/^[569]/.test(p.code)?'sh':'sz')+p.code+'.html',target:'_blank',rel:'noopener'},p.name+' '+p.code);
  function paint() {
    if(!$('#sector-table'))return;
    const data=S.data || {rows:[],warnings:[]};
    $('#sector-status').textContent=S.loading?'正在查询板块数据…':data.at?`更新于 ${new Date(data.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}${data.stale?'（缓存）':''}`:'暂未获取数据';
    const issues=data.rows.filter(r=>r.warnings?.length);
    $('#sector-warnings').textContent=[...(data.warnings || []), issues.length?`${issues.length} 个板块历史日线或成分数据暂不可用，相关技术指标显示“—”；具体原因见板块名称提示。`:''].filter(Boolean).join('；');
    const categories=[...new Set(data.rows.flatMap(r=>r.sector.split('、')))];
    const sel=$('#sector-category');
    if([...sel.options].map(o=>o.value).join('|')!==['all',...categories].join('|')) {
      sel.replaceChildren(h('option',{value:'all'},'全部分类'),...categories.map(x=>h('option',{value:x},x)));
      sel.value=categories.includes(S.sector)?S.sector:'all'; S.sector=sel.value;
    }
    const value=(r,k)=>k==='flow'?r.flow?.slope:k==='leaders'?r.leaders.map(x=>x.name).join(''):k==='leading'?r.leading?.name:r[k];
    const rows=data.rows.filter(r=>(S.sector==='all'||r.sector.split('、').includes(S.sector))&&(!S.q||(r.code+r.name+r.sector+r.leaders.map(x=>x.name+x.code).join('')).toLowerCase().includes(S.q.toLowerCase())));
    rows.sort((a,b)=>{const x=value(a,S.sort),y=value(b,S.sort); if(x==null)return y==null?0:1;if(y==null)return -1;return (textCols.includes(S.sort)?String(x).localeCompare(String(y),'zh'):Number(x)-Number(y))*S.dir;});
    $('#sector-count').textContent=`${rows.length} 个指数`;
    $('#sector-table thead').replaceChildren(h('tr',null,order.map(i=>cols[i]).map(([key,label])=>h('th',{'aria-sort':S.sort===key?(S.dir>0?'ascending':'descending'):'none',class:textCols.includes(key)?'l':''},h('button',{type:'button',disabled:key==='us',onclick:()=>{S.dir=S.sort===key?-S.dir:-1;S.sort=key;paint();}},label)))));
    const tb=$('#sector-table tbody');tb.replaceChildren();
    rows.forEach(r=>{
      const td=(v,cls='',title)=>h('td',{class:cls,title},v);
      const cells=[td(r.code,'l mono',r.warnings?.join('；')),
        td(h('button',{type:'button',class:'sector-name-trigger','data-rotation-key':'index:'+r.code,
          'aria-haspopup':'dialog','aria-controls':'rotation-stock-popover',
          'aria-expanded':String(S.rotationPopoverKey==='index:'+r.code && !$('#rotation-stock-popover')?.hidden),
          onmouseenter:e=>showRotationStocks(e.currentTarget,r,{date:'最新行情'}),
          onfocus:e=>{if(!S.suppressRotationFocus)showRotationStocks(e.currentTarget,r,{date:'最新行情'});},
          onmouseleave:scheduleRotationClose,
          onclick:e=>{showRotationStocks(e.currentTarget,r,{date:'最新行情'});$('#rotation-stock-popover button.stock-tag')?.focus();}
        },r.name),'l strong'),td(r.sector,'l muted'),td(fmt(r.px)),td(pct(r.chg),sign(r.chg)),td(fmt(r.amount,1)),
        td(r.trend || '—','l'),td(r.flow?r.flow.state:'—','l',r.flow?`斜率 ${r.flow.slope.toFixed(3)}/天；常态量能 ${r.flow.level.toFixed(2)} 倍`:'缺少历史成交额'),
        td(r.macdState || '—','l '+(r.macdState?.startsWith('金叉')?'up':r.macdState?'dn':'')),td(fmt(r.rsi,1),r.rsiState==='超买'?'up':r.rsiState==='超卖'?'dn':''),
        td(pct(r.r20),sign(r.r20)),td(pct(r.rs20),sign(r.rs20)),td(pct(r.ytd),sign(r.ytd)),td('—','muted','板块指数未设置对标美股'),td(fmt(r.pe,1)),
        td(r.leaders.length?r.leaders.map((p,i)=>h('div',null,`${i+1}. `,stockLink(p),h('span',{class:'muted small'},` 市值 ${(p.mcap/1e8).toFixed(0)}亿`))):'—','l nowrap',r.leadersAt?'成分股更新时间 '+new Date(r.leadersAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'暂不可用'),
        td(r.leading?stockLink(r.leading):'—','l nowrap'),td(pct(r.speed),sign(r.speed),'行情源短周期涨跌幅，单位 %'),td(r.volumeRatio==null?'—':fmt(r.volumeRatio,2)+'倍','','行情源量比，单位：倍')];
      tb.append(h('tr',{class:'static'},order.map(i=>cells[i])));
    });
    paintRotation();
    if(!rows.length)tb.append(h('tr',null,h('td',{colspan:cols.length,class:'l muted'},S.loading?'正在查询…':'暂无匹配的板块指数；可尝试重新获取。')));
  }
  function rotationSection() {
    return h('section',{class:'card',id:'sector-rotation'},
      h('div',{class:'card-head'},h('h2',null,'板块轮动'),h('span',{id:'rotation-count',class:'muted small'})),
      h('p',{class:'fine'},'最近 10 个有数据的交易日，每天一列，日期从左到右。上半区为 RS20 相对沪深300最高的 10 个板块，下半区为最低的 10 个板块（由强到弱），不是当日涨跌幅排名。数值单位为百分点。'),
      h('p',{class:'fine'},'按当前关注板块回看历史日线；今日排名随行情更新并保存在本地，历史列保留收盘回算或当日最后保存的数据。鼠标移到板块名称可查看当前股池股票，点击浮层内的股票可打开 K 线；点击板块可跨日期高亮。'),
      h('div',{class:'rotation-scroll'},h('table',{id:'rotation-table','aria-label':'最近十个交易日板块RS20轮动排名'})),
      h('p',{class:'fine',id:'rotation-note',role:'status'}),
      h('div',{id:'rotation-stock-popover',class:'rotation-stock-popover',role:'dialog','aria-label':'板块对应的股池股票',hidden:true,
        onmouseenter:()=>clearTimeout(S.rotationCloseTimer),onmouseleave:scheduleRotationClose,onfocusout:scheduleRotationClose}));
  }
  function paintRotation() {
    const table=$('#rotation-table'); if(!table)return;
    const days=S.data?.rotation || [];
    $('#rotation-count').textContent=`已记录 ${days.length} / 10 天`;
    if(!days.length) {
      table.replaceChildren();
      $('#rotation-note').textContent='暂无有效排名。取得板块与沪深300同一交易日的 RS20 数据后，会自动开始记录。';return;
    }
    const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
    const head=h('thead',null,h('tr',null,days.map(d=>h('th',{scope:'col',class:d.date===today?'rotation-today':'',title:d.date+' · '+(d.kind==='historical'?'历史日线回算':'本地保存快照')+` · 有效板块 ${d.coverage}/${d.total}`},d.date.slice(5),d.date===today?' · 今日':'')),h('th',{scope:'col',class:'rotation-rank'},'排名')));
    const body=h('tbody');
    for(const [key,label] of [['top','RS20 前10 · 相对最强'],['bottom','RS20 后10 · 相对最弱（由强到弱）']]) {
      body.append(h('tr',{class:'rotation-divider'},h('th',{colspan:days.length+1,scope:'rowgroup'},label)));
      for(let i=0;i<10;i++)body.append(h('tr',{class:'static'},days.map(d=>{
        const ranked=key==='bottom'?[...d.bottom].sort((a,b)=>b.rs20-a.rs20 || a.code.localeCompare(b.code)):d.top;
        const p=ranked[i];
        return h('td',{class:p?.code===S.rotationSelected?'rotation-selected':''},p?h('button',{
          type:'button',class:'rotation-cell','data-rotation-key':`${key}:${d.date}:${p.code}`,
          'aria-pressed':String(p.code===S.rotationSelected),'aria-haspopup':'dialog','aria-controls':'rotation-stock-popover',
          'aria-expanded':String(S.rotationPopoverKey===`${key}:${d.date}:${p.code}` && !$('#rotation-stock-popover')?.hidden),
          onmouseenter:e=>showRotationStocks(e.currentTarget,p,d),
          onfocus:e=>{if(!S.suppressRotationFocus)showRotationStocks(e.currentTarget,p,d);},
          onmouseleave:scheduleRotationClose,
          onclick:e=>{showRotationStocks(e.currentTarget,p,d);S.rotationSelected=S.rotationSelected===p.code?null:p.code;paintRotation();$('#rotation-stock-popover button.stock-tag')?.focus();}
        },h('span',{class:'rotation-name'},p.name),h('span',{class:'rotation-value '+sign(p.rs20)},`${p.rs20>0?'+':''}${p.rs20.toFixed(2)}`)):'—');
      }),h('th',{scope:'row',class:'rotation-rank'},String(i+1))));
    }
    table.replaceChildren(head,body);
    $('#rotation-note').textContent='未取得 RS20 的板块不参与排序；某日不足 10 个时留空。此表按全部关注板块排名，不随上方列表的筛选条件改变。';
  }
  function hideRotationStocks(restoreFocus=false) {
    clearTimeout(S.rotationCloseTimer);
    const popup=$('#rotation-stock-popover');if(!popup || popup.hidden)return;
    popup.hidden=true;
    const anchors=[...document.querySelectorAll('#rotation-table .rotation-cell, .sector-name-trigger')];
    anchors.forEach(b=>b.setAttribute('aria-expanded','false'));
    if(restoreFocus) {
      S.suppressRotationFocus=true;
      anchors.find(b=>b.dataset.rotationKey===S.rotationPopoverKey)?.focus();
      S.suppressRotationFocus=false;
    }
    S.rotationPopoverKey=null;
  }
  function scheduleRotationClose() {
    clearTimeout(S.rotationCloseTimer);
    S.rotationCloseTimer=setTimeout(()=>{
      const popup=$('#rotation-stock-popover');
      if(popup && !popup.matches(':hover') && !popup.contains(document.activeElement))hideRotationStocks();
    },250);
  }
  function showRotationStocks(anchor,p,day) {
    const popup=$('#rotation-stock-popover');if(!popup)return;
    clearTimeout(S.rotationCloseTimer);
    // Keep this floating editor outside the periodically rebuilt table.
    if(!popup.hidden && S.rotationPopoverKey===anchor.dataset.rotationKey)return;
    S.rotationPopoverKey=anchor.dataset.rotationKey;
    document.querySelectorAll('#rotation-table .rotation-cell, .sector-name-trigger').forEach(b=>b.setAttribute('aria-expanded',String(b===anchor)));
    const board=(S.data?.rows || []).find(r=>r.code===p.code);
    const members=board?.poolMembers;
    popup.replaceChildren(
      h('div',{class:'card-head'},h('strong',null,p.name+' · 股池股票'),h('button',{type:'button',class:'btn sm',onclick:()=>hideRotationStocks(true)},'关闭')),
      h('p',{class:'fine'},`${day.date} · ${Number.isFinite(p.rs20)?'RS20 '+(p.rs20>0?'+':'')+p.rs20.toFixed(2)+' 个百分点':'暂无 RS20 数据'}`),
      members?.length?h('div',{class:'rotation-stock-list'},members.map(stock=>h('button',{type:'button',class:'stock-tag',onclick:PF.guard(async()=>{
        hideRotationStocks();await PF.openStock(stock.code,members.map(x=>x.code));
      })},stock.name,h('span',{class:'muted small'},stock.code)))):
        h('p',{class:'muted'},members==null?'板块成分数据暂不可用，稍后重试。':'当前股池暂无该板块股票。'),
      members?.length?h('p',{class:'fine'},`当前股池共 ${members.length} 只，点击股票查看 K 线。`):null,
      board?.source?h('a',{href:board.source,target:'_blank',rel:'noopener',class:'fine'},'查看板块行情'):null);
    popup.hidden=false;
    const rect=anchor.getBoundingClientRect(),height=popup.getBoundingClientRect().height;
    popup.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-popup.offsetWidth-8))+'px';
    popup.style.top=Math.max(8,rect.bottom+height+8>window.innerHeight?rect.top-height-6:rect.bottom+6)+'px';
  }
  document.addEventListener('pointerdown',e=>{
    if(!e.target.closest('#rotation-stock-popover, .rotation-cell, .sector-name-trigger'))hideRotationStocks();
  });
  document.addEventListener('keydown',e=>{
    const popup=$('#rotation-stock-popover');
    if(e.key==='Escape' && popup && !popup.hidden){hideRotationStocks(true);e.preventDefault();}
  });
  document.addEventListener('scroll',e=>{
    if(!e.target.closest?.('#rotation-stock-popover'))hideRotationStocks();
  },true);
  window.addEventListener('resize',()=>hideRotationStocks());
  async function load(force=false) {
    if(S.loading)return S.loading;
    S.loading=(async()=>{
      try{S.data=await api(force?'POST':'GET',force?'/sectors/refresh':'/sectors',force?{}:undefined);}
      catch(e){S.data={...(S.data || {rows:[]}),warnings:['板块更新失败：'+e.message],stale:true};}
      finally{S.loading=null;paint();}
    })();paint();return S.loading;
  }
  PF.views.sectors={
    async render(root){
      root.replaceChildren(h('section',{class:'card'},
        h('div',{class:'card-head'},h('h2',null,'板块指数'),h('span',{id:'sector-count',class:'muted small'})),
        h('p',{class:'fine'},'按当前股池分类映射东方财富行业板块。合并分类展开为多个实际指数，指数成分覆盖全市场。龙头股按成分 A 股总市值前三展示，每 10 分钟更新；当日领涨股来自行情源，不代表长期龙头。悬停板块指数名称可查看股池股票，点击浮层内的股票打开 K 线；龙头股名称链接至来源行情。'),
        h('div',{class:'bar'},h('input',{type:'search',id:'sector-search','aria-label':'搜索板块或龙头股',placeholder:'搜索板块、代码或龙头股',value:S.q,oninput:e=>{S.q=e.target.value;paint();}}),
          h('select',{id:'sector-category','aria-label':'股池分类',onchange:e=>{S.sector=e.target.value;paint();}}),
          h('button',{type:'button',class:'btn',onclick:()=>load(true)},'重新获取'),h('span',{id:'sector-status',class:'muted small',role:'status'})),
        h('p',{id:'sector-warnings',class:'fine',role:'status'}),
        h('div',{class:'scroll'},h('table',{id:'sector-table'},h('thead'),h('tbody'))),
        h('p',{class:'fine'},'技术指标沿用个股计算口径。日线缺失时相关指标显示“—”；“对标美股”尚无对应数据，显示“—”。PE 使用行情源板块估值口径。市值排名与技术信号仅用于研究。')));
      root.append(rotationSection());
      paint();await load();
    },update:()=>load()
  };
})();
