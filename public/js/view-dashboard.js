// 看板：大盘 → 股池等权指数（K 线 + 均线判断）→ 行情与技术点位表 → 股池新闻
(function () {
  const { h, $, fmt, pct, sign, api } = PF;
  const D = { ov: null, idx: null, news: null, intra: { secid: '1.000001', date: null, data: null, err: null }, range: 120, offset: 0, ruler: { on: false, a: null, b: null }, indicators: { ma: false, ema: false, bbi: false, boll: false, supertrend: true, donchian: true }, newsFilter: 'all', filter: 'all', sort: 'chg', dir: -1, q: '', root: null };

  const COLS = [
    ['code', '代码', 'l'], ['name', '名称', 'l'], ['sector', '板块', 'l'], ['px', '现价'], ['chg', '涨跌%'], ['speed', '涨速%'], ['volumeRatio', '量比'], ['amount', '成交额(亿)'], ['volDiff', '较昨日同时(亿)'],
    ['trend', '趋势', 'l'], ['flowSlope', '量能趋势(20日)', 'l'], ['macdState', 'MACD', 'l'], ['rsi', 'RSI14'],
    ['r20', '近20日%'], ['rs20', 'RS20 vs 沪深300'], ['ytd', '年内%'], ['usChg', '对标美股'], ['pe', 'PE(TTM)']
  ];
  // 较昨日同一时刻的成交额：多了/少了多少亿；休市后对比的是整天
  const hm = (t) => t.slice(0, 2) + ':' + t.slice(2);
  const md = (d) => d.slice(4, 6) + '-' + d.slice(6);
  function volTip(v) { return `${md(v.date)} ${hm(v.time)} 累计 ${v.today.toFixed(1)} 亿；${md(v.prevDate)} 同一时刻 ${v.prev.toFixed(1)} 亿`; }
  const volAmt = (v) => `${v.diff >= 0 ? '+' : '-'}${Math.abs(v.diff).toFixed(Math.abs(v.diff) >= 100 ? 0 : 1)}亿`;
  const volPct = (v) => (v.pct == null ? '' : `（${v.pct > 0 ? '+' : ''}${v.pct.toFixed(1)}%）`);
  function volLine(v) {
    if (!v) return h('span', { class: 'k' }, '较昨日同时 —');
    return h('span', { class: 'k vol', title: volTip(v) }, '较昨日同时 ', h('b', { class: sign(v.diff) }, (v.diff >= 0 ? '多 ' : '少 ') + Math.abs(v.diff).toFixed(Math.abs(v.diff) >= 100 ? 0 : 1) + ' 亿'), volPct(v));
  }

  const TEXT = ['code', 'name', 'sector', 'trend', 'macdState'];

  const VERDICT = {
    空头排列: '指数在主要均线下方，5、10、20、60 日线自上而下空头排列，趋势偏弱。先看能否站回 5 日、10 日线止跌，再看能否收复 20 日线；重新站上 60 日线之前，中期仍按调整对待。',
    多头排列: '指数站在主要均线上方，5、10、20、60 日线自下而上多头排列，趋势偏强。回踩 20 日线不破可视为强势延续，跌破 20 日线再看 60 日线。',
    均线交织: '均线交织在一起，指数处于震荡。可以把 20 日线和 60 日线当作上下边界，等指数放量突破其中一边再判断方向。'
  };

  function skeleton() {
    return h('div', { class: 'stack' },
      h('section', { class: 'tiles', id: 'market', 'aria-label': '大盘指数' }),
      h('section', { class: 'card', id: 'intraday' },
        h('div', { class: 'card-head' }, h('h2', null, '大盘分时'), h('span', { class: 'muted small', id: 'ix-note' })),
        h('div', { class: 'i-head' },
          h('label', { class: 'i-date', title: '只能选最近几个交易日' }, h('input', { type: 'date', id: 'ix-date', 'aria-label': '选择交易日' })),
          h('span', { class: 'i-clock', id: 'ix-clock' }),
          h('div', { class: 'range', id: 'ix-sel' }, [['1.000001', '上证指数'], ['0.399001', '深证成指'], ['0.399006', '创业板指'], ['1.000300', '沪深300'], ['1.000688', '科创50']]
            .map(([k, t]) => h('button', { type: 'button', class: 'chip', 'data-secid': k, 'aria-pressed': String(D.intra.secid === k) }, t)))),
        h('div', { class: 'i-readout', id: 'ix-readout' }),
        h('div', { class: 'kbox', id: 'ix-chart' }),
        h('p', { class: 'fine' }, '横轴 9:30–15:00，纵轴以前收盘价为中轴上下对称；下方柱子是每分钟成交额（比上一分钟价格高为红、低为绿）。图上优先显示财联社看盘的全市场题材锚点（如白酒、证券、人形机器人）；红色为拉升、绿色为下杀、灰色为中性。财联社数据暂不可用时，才回退为股池板块异动。鼠标停在标签上可查看来源。')),
      h('section', { class: 'card', id: 'pool-index' },
        h('div', { class: 'card-head' }, h('h2', null, '股池等权指数'), h('span', { class: 'muted small', id: 'i-day' })),
        h('div', { class: 'istat', id: 'istat' }),
        h('div', { class: 'istat', id: 'ibreadth', 'aria-label': '股池涨跌停与涨跌家数' }),
        h('p', { class: 'lede', id: 'i-verdict' }),
        h('p', { class: 'lede', id: 'i-flow' }),
        h('div', { class: 'range', id: 'i-range' }, h('span', { class: 'muted small' }, '显示'),
          [60, 120, 250].map((n) => h('button', { type: 'button', class: 'chip', 'data-range': n, 'aria-pressed': String(n === D.range) }, n + ' 天'))),
        h('div', { class: 'range', id: 'i-indicators', 'aria-label': '股池指数K线指标' },
          h('span', { class: 'muted small' }, '指标'),
          [['ma', 'MA（5/10/20/60/120/250）'], ['ema', 'EMA（13/34/55）'], ['bbi', 'BBI'], ['boll', 'BOLL（20,2）'], ['supertrend', 'Supertrend（10,3）'], ['donchian', 'Donchian（20）']]
            .map(([key, label]) => h('label', { class: 'indicator-toggle' }, h('input', { type: 'checkbox', 'data-indicator': key, checked: D.indicators[key] }), ' ' + label))),
        h('div', { class: 'kbox', id: 'index-chart' }),
        h('p', { class: 'fine', id: 'i-fine' })),
      h('section', { class: 'card', id: 'table-card' },
        h('div', { class: 'card-head' }, h('h2', null, '行情与技术点位'), h('span', { class: 'muted small', id: 'tbl-count' })),
        h('p', { class: 'fine' }, '点表头排序，点任意一行弹出这只股票的 K 线（均线、成交额、MACD）、点位和新闻。趋势：现价、20 日线、60 日线依次向上为多头，依次向下为空头，其余为震荡。量能趋势：看成交额，而不是价格——用近 10 日成交额除以近一年常态（单日暴量封顶），判断这一阶段量能是稳步放大还是萎缩；红色表示放量时价格稳住或上涨，绿色表示放量下跌，灰色表示缩量或走平；另标出堆量、疑似吸筹、放量下跌。鼠标停在上面可看斜率和量能倍数，仅供参考。'),
        h('div', { class: 'bar' },
          h('input', { id: 'q', type: 'search', placeholder: '搜代码、名称或板块', 'aria-label': '搜代码、名称或板块', value: D.q }),
          [['all', '全部'], ['多头', '多头'], ['震荡', '震荡'], ['空头', '空头'], ['超买', 'RSI 超买'], ['超卖', 'RSI 超卖'], ['量能放大', '量能放大'], ['量能萎缩', '量能萎缩'], ['堆量吸筹', '堆量/吸筹'], ['放量下跌', '放量下跌']]
            .map(([k, t]) => h('button', { type: 'button', class: 'chip', 'data-filter': k, 'aria-pressed': String(D.filter === k) }, t))),
        h('div', { class: 'scroll' }, h('table', { id: 'tbl' }, h('thead', null, h('tr')), h('tbody')))),
      h('section', { class: 'card', id: 'news-card' },
        h('div', { class: 'card-head' }, h('h2', null, '股池最新新闻'), h('span', { class: 'muted small', id: 'news-status' }, '加载中…')),
        h('div', { class: 'bar', id: 'news-filter' },
          [['all', '全部'], ['bear', '利空'], ['bull', '利好'], ['neutral', '中性']]
            .map(([k, t]) => h('button', { type: 'button', class: 'chip', 'data-nf': k, 'aria-pressed': String(D.newsFilter === k) }, t))),
        h('p', { class: 'fine' }, '利好/利空/中性由系统按标题措辞（业绩同比增减、回购增持、监管处罚、股价大幅涨跌等）自动判断，只看标题、不看正文，鼠标停在标签上可看到依据，仅供参考。'),
        h('div', { class: 'news', id: 'news' })));
  }

  // 大盘分时：图 + 日期 + 实时时钟
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  function tickClock() {
    const c = $('#ix-clock'); if (!c) return;
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    c.textContent = `星期${WEEK[d.getDay()]} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  }
  const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  function renderIntraday() {
    const box = $('#ix-chart'); if (!box) return;
    const I = D.intra, dt = I.data;
    document.querySelectorAll('#ix-sel [data-secid]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.secid === I.secid)));
    if (!dt) { box.textContent = I.err || '分时数据加载中…'; $('#ix-readout').textContent = ''; return; }
    const inp = $('#ix-date');
    inp.min = ymd(dt.dates[dt.dates.length - 1]); inp.max = ymd(dt.dates[0]); inp.value = ymd(dt.date);
    const show = (r) => {
      const ro = $('#ix-readout'); if (!ro) return;
      if (!r) return show(D.intra.last);
      ro.replaceChildren(`${hm(r.t)}　`, h('b', null, r.px.toFixed(2)), '　', h('b', { class: sign(r.chg) }, `${r.chg > 0 ? '+' : ''}${r.chg.toFixed(2)}　${r.pct > 0 ? '+' : ''}${r.pct.toFixed(2)}%`), `　成交额 ${r.amt.toFixed(1)} 亿/分钟，累计 ${r.cum.toFixed(0)} 亿`, `　${dt.name}`);
    };
    I.last = IChart.draw(box, dt, { onHover: show });
    show(I.last);
    $('#ix-note').textContent = dt.live ? '实时（约每 15 秒更新）' : '历史分时';
  }
  async function loadIntraday() {
    const I = D.intra;
    try { I.data = await api('GET', `/intraday?secid=${I.secid}` + (I.date ? '&date=' + I.date : '')); I.err = null; } catch (e) { I.data = null; I.err = e.message; }
    renderIntraday();
  }

  function renderMarket() {
    const box = $('#market'); box.replaceChildren();
    D.ov.market.forEach((m) => box.append(h('div', { class: 'tile' }, h('span', { class: 'k' }, m.name), h('b', { class: 'big' }, m.price != null ? m.price.toFixed(2) : '—'), h('b', { class: 'chg ' + sign(m.chg) }, pct(m.chg)), volLine(m.vol))));
    const b = D.ov.breadth;
    box.append(h('div', { class: 'tile' }, h('span', { class: 'k' }, '股池涨 / 跌'), h('b', { class: 'big' }, `${b.up} / ${b.down}`), h('span', { class: 'k' }, `共 ${b.total} 只`)));
  }

  // 涨停/跌停、涨跌家数、平均涨跌幅、最强最弱、成交额
  function renderBreadth() {
    const box = $('#ibreadth'); box.replaceChildren();
    const b = D.ov.breadth; if (!b) return;
    const tags = (a) => h('span', { class: 'k' }, a.length ? a.map((x) => h('button', { class: 'stock-tag', type: 'button', onclick: () => PF.openStock(x.code) }, x.name)) : '无');
    const one = (x) => (x ? h('span', { class: 'k' }, h('button', { class: 'stock-tag', type: 'button', onclick: () => PF.openStock(x.code) }, x.name)) : '—');
    const cell = (k, big, cls, sub) => h('div', null, h('span', { class: 'k' }, k), h('b', { class: 'big ' + (cls || '') }, big), sub);
    box.append(
      cell('涨停', `${b.limitUp.length} 只`, b.limitUp.length ? 'up' : '', tags(b.limitUp)),
      cell('跌停', `${b.limitDown.length} 只`, b.limitDown.length ? 'dn' : '', tags(b.limitDown)),
      cell('上涨 / 下跌 / 平盘', `${b.up} / ${b.down} / ${b.flat}`, '', h('span', { class: 'k' }, `共 ${b.total} 只`)),
      cell('平均涨跌幅', b.avg == null ? '—' : pct(b.avg), b.avg == null ? '' : sign(b.avg), h('span', { class: 'k' }, `成交额合计 ${b.amount.toFixed(0)} 亿`, h('br'), volLine(b.vol))),
      cell('涨幅最大', b.best ? pct(b.best.chg) : '—', b.best ? sign(b.best.chg) : '', one(b.best)),
      cell('跌幅最大', b.worst ? pct(b.worst.chg) : '—', b.worst ? sign(b.worst.chg) : '', one(b.worst)));
  }

  function renderIndex() {
    const st = D.ov.index;
    const box = $('#istat'); box.replaceChildren();
    if (!st) { box.append(h('p', { class: 'muted' }, '历史数据还在下载，稍等片刻后点「刷新行情」')); $('#index-chart').replaceChildren(); $('#i-verdict').textContent = ''; return; }
    const cell = (k, big, bigCls, sub) => h('div', null, h('span', { class: 'k' }, k), h('b', { class: 'big ' + (bigCls || '') }, big), sub);
    const list = (a) => a.map((r) => `${r[1]} ${r[0].toFixed(1)}`).join('，');
    box.append(
      cell('最新点位', st.close.toFixed(1), '', h('b', { class: 'chg ' + sign(st.chg) }, pct(st.chg))),
      cell('均线排列', st.align, '', h('span', { class: 'k' }, `站上 ${st.nAbove} 条均线（共 6 条）`)),
      cell('短期 · 20 日线', fmt(st.ma[20]), '', h('span', { class: 'k' }, `指数在其${st.short[0]}，均线${st.short[1]}`)),
      cell('中期 · 60 日线', fmt(st.ma[60]), '', h('span', { class: 'k' }, `指数在其${st.mid[0]}，均线${st.mid[1]}`)),
      cell('长期 · 年线', fmt(st.ma[250]), '', h('span', { class: 'k' }, `指数在其${st.long[0]}，均线${st.long[1]}`)),
      cell('最近压力', st.res[0] ? st.res[0][0].toFixed(1) : '—', '', h('span', { class: 'k' }, list(st.res) || '上方无均线压力')),
      cell('最近支撑', st.sup[0] ? st.sup[0][0].toFixed(1) : '—', '', h('span', { class: 'k' }, list(st.sup) || '—')),
      cell('距一年高点', pct(st.ddHigh, 1), sign(st.ddHigh), h('span', { class: 'k' }, '年内 ' + pct(st.ytd, 1))));
    $('#i-day').textContent = st.day + (st.n ? `，${st.n} 只成分股参与计算` : '');
    $('#i-verdict').textContent = VERDICT[st.align] || '';
    const fs = D.idx && IND.flowStatus(D.idx.bars, IND.flowTrend(D.idx.bars));
    $('#i-flow').textContent = fs ? '股池' + fs.text + '（成交额按成分股合计，见下方「量能趋势线」）' : '';
    $('#i-fine').textContent = `股池全部股票等权编制：每天按成分股的平均涨跌幅推算，${D.idx ? D.idx.baseDate : ''} = ${D.idx ? D.idx.base : 1000} 点；停牌或未上市的股票当天不计入。没有指数的分时数据，算不出真实的日内高低点（用成分股高低点平均会让影线虚长），所以这张图只画开盘到收盘的实体，不画上下影线。今天的 K 线由实时报价生成。均线判断：价格在 20 日线上方且 20 日线向上，短期偏强；在 60 日线上方，中期偏强；年线是牛熊分界。5、10、20、60 日线自下而上排列是多头排列，反过来是空头排列。`;
    drawIndexChart();
  }

  // 指数 K 线：滚轮缩放、按住左键左右拖动（只重画图，不动上面的统计）
  function drawIndexChart() {
    if (!D.idx) return;
    const sync = () => $('#i-range').querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.range) === D.range)));
    D.offset = Math.max(0, Math.min(D.offset, D.idx.bars.length - D.range));
    KChart.drawK($('#index-chart'), D.idx.bars, {
      mas: D.indicators.ma ? [5, 10, 20, 60, 120, 250] : [], emaPeriods: D.indicators.ema ? [13, 34, 55] : [],
      bbi: D.indicators.bbi, boll: D.indicators.boll, supertrend: D.indicators.supertrend, donchian: D.indicators.donchian, range: D.range, offset: D.offset, noWick: true, ruler: D.ruler,
      onRange: (n) => { D.range = n; sync(); drawIndexChart(); },
      onPan: (off) => { D.offset = off; drawIndexChart(); }
    });
  }

  function renderTable() {
    const thead = $('#tbl thead tr');
    if (!thead.children.length) {
      COLS.forEach(([k, label, cls]) => {
        const b = h('button', { type: 'button', onclick: () => {
          if (D.sort === k) D.dir = -D.dir; else { D.sort = k; D.dir = TEXT.includes(k) ? 1 : -1; }
          renderTable();
        } }, label);
        thead.append(h('th', { class: cls || '', 'data-k': k }, b));
      });
    }
    thead.querySelectorAll('th').forEach((th) => th.setAttribute('aria-sort', th.dataset.k === D.sort ? (D.dir > 0 ? 'ascending' : 'descending') : 'none'));
    const q = D.q.trim().toLowerCase();
    const rows = D.ov.rows.map((r) => ({ ...r, usChg: r.us ? r.us.chg : null, volDiff: r.vol ? r.vol.diff : null, flowSlope: r.flow ? r.flow.slope : null })).filter((r) => {
      if (q && !(r.code + r.name + r.sector).toLowerCase().includes(q)) return false;
      if (D.filter === 'all') return true;
      if (D.filter === '超买' || D.filter === '超卖') return r.rsiState === D.filter;
      if (D.filter === '量能放大') return r.flow && r.flow.state.includes('放量');
      if (D.filter === '量能萎缩') return r.flow && r.flow.state.includes('缩量');
      if (D.filter === '堆量吸筹') return r.flow && r.flow.flags.some((f) => f === '堆量' || f === '疑似吸筹');
      if (D.filter === '放量下跌') return r.flow && r.flow.flags.some((f) => f.startsWith('放量下跌'));
      return r.trend === D.filter;
    });
    rows.sort((a, b) => {
      const x = a[D.sort], y = b[D.sort];
      if (TEXT.includes(D.sort)) return String(x).localeCompare(String(y), 'zh') * D.dir;
      return ((x == null ? -Infinity : x) - (y == null ? -Infinity : y)) * D.dir;
    });
    const tableCodes = rows.map((r) => r.code);
    const tb = $('#tbl tbody'); tb.replaceChildren();
    rows.forEach((r) => {
      const td = (t, cls) => h('td', { class: cls || '' }, t);
      const tr = h('tr', { tabindex: '0', onclick: () => PF.openStock(r.code, tableCodes), onkeydown: (e) => { if (e.key === 'Enter') PF.openStock(r.code, tableCodes); } },
        td(r.code, 'l mono'), td(r.name, 'l strong'), td(r.sector, 'l muted'),
        td(fmt(r.px)), td(pct(r.chg), sign(r.chg)), h('td', { class: sign(r.speed), title: '行情源短周期涨跌幅，单位 %' }, pct(r.speed)), h('td', { title: '行情源量比，单位：倍' }, r.volumeRatio == null ? '—' : fmt(r.volumeRatio, 2) + '倍'), td(r.amount != null ? r.amount.toFixed(1) : '—'),
        r.vol ? h('td', { class: sign(r.vol.diff), title: volTip(r.vol) }, volAmt(r.vol) + volPct(r.vol)) : td('—', 'muted'),
        td(r.trend || '—', 'l ' + (r.trend === '多头' ? 'up' : r.trend === '空头' ? 'dn' : 'muted')),
        r.flow ? h('td', { class: 'l ' + (r.flow.bias === 'bull' ? 'up' : r.flow.bias === 'bear' ? 'dn' : 'muted'), title: `量能线近 20 日斜率 ${r.flow.slope.toFixed(3)}/天；当前为近一年常态量能的 ${r.flow.level.toFixed(2)} 倍` }, r.flow.state + (r.flow.flags.length ? ' · ' + r.flow.flags.map((f) => f.split('（')[0]).join('、') : '')) : td('—', 'l muted'),
        td(r.macdState || '—', 'l ' + (String(r.macdState).startsWith('金叉') ? 'up' : 'dn')),
        td(r.rsi != null ? r.rsi.toFixed(1) : '—', r.rsiState === '超买' ? 'up' : r.rsiState === '超卖' ? 'dn' : ''),
        td(pct(r.r20), sign(r.r20)), td(pct(r.rs20), sign(r.rs20)), td(pct(r.ytd), sign(r.ytd)),
        td(r.us ? `${r.us.symbol} ${pct(r.us.chg)}` : '—', r.us ? sign(r.us.chg) : 'muted'),
        td(r.pe == null ? '—' : (r.pe < 0 ? '亏损' : r.pe.toFixed(1)), 'muted'));
      tb.append(tr);
    });
    $('#tbl-count').textContent = `${rows.length} 只`;
  }

  function renderNews() {
    const box = $('#news'); box.replaceChildren();
    if (!D.news) return;
    const names = Object.fromEntries(D.ov.rows.map((r) => [r.code, r]));
    const all = [];
    Object.entries(D.news.data).forEach(([code, arr]) => (arr || []).forEach((n) => names[code] && all.push([code, n])));
    all.sort((a, b) => (a[1].time < b[1].time ? 1 : -1));
    const none = D.ov.rows.filter((r) => D.news.data[r.code] && !D.news.data[r.code].length).map((r) => r.name);
    const cnt = { bull: 0, bear: 0, neutral: 0 };
    const lab = (n) => (n.sentiment && n.sentiment.label) || 'neutral';
    all.forEach(([, n]) => { cnt[lab(n)]++; });
    document.querySelectorAll('#news-filter [data-nf]').forEach((b) => {
      const k = b.dataset.nf;
      b.textContent = (k === 'all' ? '全部' : PF.SENTI[k]) + ` ${k === 'all' ? all.length : cnt[k]}`;
      b.setAttribute('aria-pressed', String(D.newsFilter === k));
    });
    const shown = D.newsFilter === 'all' ? all : all.filter(([, n]) => lab(n) === D.newsFilter);
    shown.slice(0, 120).forEach(([code, n]) => box.append(PF.newsLine(n, names[code])));
    if (!shown.length) box.append(h('p', { class: 'muted' }, '这个类别下暂时没有新闻'));
    $('#news-status').textContent = D.news.at ? `共 ${all.length} 条` + (none.length ? `；没有个股新闻：${none.join('、')}` : '') : '新闻还在获取，稍后刷新';
  }

  function paint() {
    if (!D.ov || !$('#market')) return;
    renderMarket(); renderBreadth(); renderIndex(); renderTable(); renderNews();
  }

  async function load() {
    const [ov, idx, news] = await Promise.all([api('GET', '/overview'), api('GET', '/index'), api('GET', '/news'), loadIntraday()]);
    Object.assign(D, { ov, idx, news });
    paint();
    return ov;
  }

  PF.views.dashboard = {
    async render(root) {
      D.root = root;
      root.replaceChildren(skeleton());
      $('#ix-sel').addEventListener('click', (e) => {
        const b = e.target.closest('[data-secid]'); if (!b) return;
        D.intra.secid = b.dataset.secid; loadIntraday();
      });
      $('#ix-date').addEventListener('change', (e) => {
        const v = e.target.value.replace(/-/g, '');
        if (D.intra.data && !D.intra.data.dates.includes(v)) { PF.toast('这一天没有分时数据（只有最近几个交易日，周末和节假日不开市）'); e.target.value = ymd(D.intra.data.date); return; }
        D.intra.date = v; loadIntraday();
      });
      tickClock(); clearInterval(D.clock); D.clock = setInterval(tickClock, 1000);
      $('#q').addEventListener('input', (e) => { D.q = e.target.value; renderTable(); });
      root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
        D.filter = b.dataset.filter;
        root.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        renderTable();
      }));
      root.querySelectorAll('[data-nf]').forEach((b) => b.addEventListener('click', () => { D.newsFilter = b.dataset.nf; renderNews(); }));
      $('#i-range').addEventListener('click', (e) => {
        const b = e.target.closest('[data-range]'); if (!b) return;
        D.range = Number(b.dataset.range); D.offset = 0;
        $('#i-range').querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        drawIndexChart();
      });
      $('#i-indicators').addEventListener('change', (e) => {
        const input = e.target.closest('[data-indicator]'); if (!input) return;
        D.indicators[input.dataset.indicator] = input.checked;
        drawIndexChart();
      });
      await load();
    },
    update: () => load().then(() => PF.refreshStockDialog()),
    resize() { if (D.ov && $('#index-chart')) { renderIndex(); PF.repaintStockDialog(); } }
  };
})();
