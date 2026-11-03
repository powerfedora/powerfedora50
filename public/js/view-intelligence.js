(function(){
  const {h,$,api}=PF;
  const S={data:null,q:'',sentiment:'all',related:false,pending:null,closeTimer:null};
  const labels={bull:'利好',bear:'利空',neutral:'中性'};
  function paint(){
    const body=$('#intel-table tbody');if(!body)return;
    const d=S.data || {items:[]};
    $('#intel-status').textContent=`每 20 秒采集 · ${d.at?'最近成功 '+new Date(d.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'等待首次采集'}`;
    $('#intel-error').textContent=d.error?'采集失败：'+d.error+'。保留上次内容，下一轮自动重试。':d.membershipReady===false?'板块成分数据正在准备，板块内的股池股票关联会自动补齐。':'';
    const q=S.q.trim().toLowerCase();
    const items=d.items.filter(n=>(S.sentiment==='all'||n.sentiment.label===S.sentiment)&&(!S.related||n.stocks.length)&&(!q||(n.title+n.sectors.map(x=>x.name).join('')+n.stocks.map(x=>x.name+x.code).join('')).toLowerCase().includes(q)));
    $('#intel-count').textContent=`${items.length} / ${d.items.length} 条`;
    const focus=document.activeElement?.closest?.('#intel-table button, #intel-table a');
    // Do not replace a focused stock button while someone is using the keyboard.
    if(focus)return;
    body.replaceChildren();
    for(const n of items){
      const codes=n.stocks.map(p=>p.code);
      body.append(h('tr',{class:'static'},
        h('td',{class:'l muted intel-time'},n.time.slice(5)),
        h('td',{class:'l intel-title'},n.important?h('span',{class:'tag up'},'重要'):null,' ',h('a',{href:n.url,target:'_blank',rel:'noopener',class:'intel-headline','aria-haspopup':'dialog','aria-controls':'intel-preview',onmouseenter:e=>preview(e.currentTarget,n),onfocus:e=>preview(e.currentTarget,n),onmouseleave:scheduleClose},n.title),n.locked?h('span',{class:'muted small'},' · 金十VIP标题'):null),
        h('td',{class:'l'},h('span',{class:'senti '+n.sentiment.label,title:'标题规则：'+n.sentiment.why},labels[n.sentiment.label])),
        h('td',{class:'l intel-related'},n.sectors.length?n.sectors.map(s=>h('span',{class:'tag',title:'关键词关联：'+s.why},s.name)):h('span',{class:'muted'},'未明确匹配')),
        h('td',{class:'l intel-related'},n.stocks.length?n.stocks.map(p=>h('button',{type:'button',class:'stock-tag',title:p.why,onclick:PF.guard(()=>PF.openStock(p.code,codes))},p.name,' ',h('span',{class:'muted small'},p.code))):h('span',{class:'muted'},'暂无关联股池股票'))));
    }
    if(!items.length)body.append(h('tr',{class:'static'},h('td',{colspan:5,class:'l muted'},d.items.length?'没有符合筛选条件的快讯。':'暂未取得快讯；服务运行期间每 20 秒自动采集。')));
  }
  function closePreview(){clearTimeout(S.closeTimer);const box=$('#intel-preview');if(box)box.hidden=true;}
  function scheduleClose(){
    clearTimeout(S.closeTimer);S.closeTimer=setTimeout(()=>{
      const box=$('#intel-preview');if(box && !box.matches(':hover') && !box.contains(document.activeElement))closePreview();
    },250);
  }
  function preview(anchor,n){
    const box=$('#intel-preview');if(!box)return;clearTimeout(S.closeTimer);
    box.replaceChildren(h('div',{class:'card-head'},h('strong',null,'快讯正文'),h('button',{class:'btn sm',type:'button',onclick:closePreview},'关闭')),
      h('h3',null,n.title),h('p',{class:'fine'},n.time+' · 金十数据'),
      h('div',{class:'intel-preview-content'},n.content || (n.locked?'此条为金十 VIP 快讯，公开接口仅提供标题，请前往原文查看。':'此条快讯暂未提供正文，请前往原文查看。')),
      h('a',{href:n.url,target:'_blank',rel:'noopener'},'查看金十原文'));
    box.hidden=false;
    const rect=anchor.getBoundingClientRect(),height=box.offsetHeight;
    box.style.left=Math.max(8,Math.min(rect.left,innerWidth-box.offsetWidth-8))+'px';
    box.style.top=Math.max(8,Math.min(rect.bottom+6,innerHeight-height-8))+'px';
  }
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#intel-preview, .intel-headline'))closePreview();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closePreview();});
  window.addEventListener('resize',closePreview);
  async function load(force=false){
    if(S.pending)return S.pending;
    const button=$('#intel-refresh');if(button)button.disabled=true;
    S.pending=(async()=>{
      try{S.data=await api(force?'POST':'GET',force?'/intelligence/refresh':'/intelligence',force?{}:undefined);}
      catch(e){S.data={...(S.data || {items:[]}),error:e.message};}
      finally{S.pending=null;if(button)button.disabled=false;paint();}
    })();return S.pending;
  }
  PF.views.intelligence={
    async render(root){
      root.replaceChildren(h('section',{class:'card'},
        h('div',{class:'card-head'},h('h2',null,'股市情报站'),h('span',{id:'intel-count',class:'muted small'})),
        h('p',{class:'fine'},'来源：金十数据「市场快讯」。服务运行期间每 20 秒自动采集、去重并保存，鼠标悬停标题可查看快讯正文，点击可跳转原文。情绪按标题措辞判断，板块按快讯文字关键词关联；关联板块内的当前股池股票可点击查看 K 线。'),
        h('div',{class:'bar'},h('input',{type:'search','aria-label':'搜索新闻、板块或股池股票',placeholder:'搜索新闻、板块或股池股票',value:S.q,oninput:e=>{S.q=e.target.value;paint();}}),
          h('select',{'aria-label':'新闻情绪',onchange:e=>{S.sentiment=e.target.value;paint();}},[['all','全部情绪'],['bull','利好'],['bear','利空'],['neutral','中性']].map(([v,t])=>h('option',{value:v,selected:S.sentiment===v},t))),
          h('label',{class:'check'},h('input',{type:'checkbox',checked:S.related,onchange:e=>{S.related=e.target.checked;paint();}}),' 只看涉及股池'),
          h('button',{id:'intel-refresh',type:'button',class:'btn',onclick:()=>load(true)},'立即采集')),
        h('p',{id:'intel-status',class:'fine',role:'status'}),h('p',{id:'intel-error',class:'fine',role:'status'}),
        h('div',{class:'scroll intel-scroll'},h('table',{id:'intel-table'},h('thead',null,h('tr',null,['发布时间','市场快讯标题','情绪','涉及板块（规则关联）','当前股池股票'].map(t=>h('th',{class:'l',scope:'col'},t)))),h('tbody'))),
        h('p',{class:'fine'},'鼠标停在情绪标签、板块和股票上可查看识别依据。关键词关联不代表已确认的影响方向或受益关系；未匹配的快讯仍会保留。')));
      root.append(h('div',{id:'intel-preview',class:'intel-preview',role:'dialog','aria-label':'快讯正文',hidden:true,onmouseenter:()=>clearTimeout(S.closeTimer),onmouseleave:scheduleClose}));
      paint();await load();
    },update:()=>load().then(()=>PF.refreshStockDialog())
  };
})();
