const IND = require('../public/js/indicators');
const { sh } = require('./time');

function rankDay(rows, date, at, kind='historical') {
  const valid=rows.filter(r=>Number.isFinite(r.rs20)).map(r=>({code:r.code,name:r.name,rs20:r.rs20}));
  if(!valid.length)return null;
  const tie=(a,b)=>a.code.localeCompare(b.code);
  return {date,at,kind,coverage:valid.length,total:rows.length,
    top:[...valid].sort((a,b)=>b.rs20-a.rs20 || tie(a,b)).slice(0,10),
    bottom:[...valid].sort((a,b)=>a.rs20-b.rs20 || tie(a,b)).slice(0,10)};
}

function updateRotation(saved, histories, benchmark, rows, now=new Date()) {
  const today=sh(now).date, at=now.getTime();
  const days=new Map(saved.filter(d=>d.date<=today).map(d=>[d.date,d]));
  // Only published benchmark sessions qualify for historical columns; no calendar-day placeholders.
  const dates=[...new Set(benchmark.map(b=>b.day).filter(d=>d<today))].sort().slice(-10);
  for(const date of dates) {
    if(days.has(date))continue;
    const bench=benchmark.filter(b=>b.day<=date);
    const values=rows.map(r=>{
      const bars=(histories[r.code]?.bars || []).filter(b=>b.day<=date);
      const rs=bars.at(-1)?.day===date?IND.relativeStrength(bars,bench,20):null;
      return {...r,rs20:rs?.end===date?rs.value:null};
    });
    const snapshot=rankDay(values,date,at);
    if(snapshot)days.set(date,snapshot);
  }
  const current=rankDay(rows.map(r=>({...r,rs20:(r.rsDay || r.historyDay)===today?r.rs20:null})),today,at,'live');
  if(current && (!days.has(today) || current.coverage>=days.get(today).coverage))days.set(today,current);
  return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-10);
}
module.exports={rankDay,updateRotation};
