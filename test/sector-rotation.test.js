const test = require('node:test');
const assert = require('node:assert/strict');
const { rankDay, updateRotation } = require('../src/sector-rotation');

test('rotation ranks RS20, preserves zero, excludes missing, and breaks ties by code', () => {
  const rows=Array.from({length:21},(_,i)=>({code:String(i).padStart(2,'0'),name:'板块'+i,rs20:i-10}));
  rows.push({code:'bad',name:'缺失',rs20:null},{code:'nan',rs20:NaN});
  const d=rankDay(rows,'2026-11-03',1,'live');
  assert.deepEqual(d.top.map(r=>r.rs20),[10,9,8,7,6,5,4,3,2,1]);
  assert.deepEqual(d.bottom.map(r=>r.rs20),[-10,-9,-8,-7,-6,-5,-4,-3,-2,-1]);
  assert.equal(d.coverage,21);
  assert.equal(rankDay([{code:'b',rs20:0},{code:'a',rs20:0}],'2026-11-03',1).top[0].code,'a');
  assert.equal(rankDay([{code:'bad',rs20:null}],'2026-11-03',1),null);
});

test('rotation backfills ten actual benchmark sessions and persists past snapshots', () => {
  const benchmark=Array.from({length:40},(_,i)=>({day:new Date(Date.UTC(2026,8,i+1)).toISOString().slice(0,10),close:100+i}));
  const history={A:{bars:benchmark.map((b,i)=>({...b,close:100+2*i}))}};
  const rows=[{code:'A',name:'甲',rs20:5,rsDay:'2026-11-03',historyDay:'2026-11-03'}];
  let days=updateRotation([],history,benchmark,rows,new Date('2026-11-03T02:00:00Z'));
  assert.equal(days.length,10);assert.equal(days.at(-1).date,'2026-11-03');
  assert.equal(days.at(-1).top[0].rs20,5);
  const original=days[0];
  rows[0].rs20=8;
  days=updateRotation(days,history,benchmark,rows,new Date('2026-11-03T03:00:00Z'));
  assert.equal(days.at(-1).top[0].rs20,8);
  assert.deepEqual(days[0],original);
  days=updateRotation(days,{},[],[{code:'A',rs20:null}],new Date('2026-11-03T04:00:00Z'));
  assert.equal(days.at(-1).top[0].rs20,8,'missing data must not erase saved rankings');
});

test('rotation does not backfill a sector with a missing session or use stale live values', () => {
  const rows=[{code:'A',rs20:5,historyDay:'2026-11-02',rsDay:'2026-11-02'}];
  assert.deepEqual(updateRotation([],{},[],rows,new Date('2026-11-03T02:00:00Z')),[]);
});
