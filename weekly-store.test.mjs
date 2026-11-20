import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {makeWeeklyStore,prepareWeeklyCard,weeklyPeriod} from './weekly-store.mjs';
import {registerWeekly,renderWeekly} from './weekly-service.mjs';

const scope={organization:'测试组织',scene:'采购',stance:'买方',stage:'签前',businessKind:'买卖',taskMode:'contract'};
function source(role,i){
  const quote='来源原句 '+i;
  return {role,sessionId:'session-'+i,caseId:'case-'+i,materialFingerprint:'doc-'+i,verified:true,corrected:role==='original',independent:role!=='original',
    title:role,quote,turns:[{who:'用户',text:quote}],setting:'测试',detail:'归纳'};
}
const legal=()=>({id:'tracked-id',kind:'legal',title:'审查条件',relation:'付款条件',summary:'逐期核对',change:'补充核对条款',scope,
  sources:['original','similar','counter'].map(source)});
function isolated(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'civil-weekly-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return home;
}
test('classification gates require source-checked quotes, distinct materials, explicit scope and a counterexample',()=>{
  const p=legal();assert.equal(prepareWeeklyCard(p).ready,true);
  assert.equal(prepareWeeklyCard({...p,ready:true,sources:p.sources.slice(0,2)}).ready,false);
  assert.equal(prepareWeeklyCard({...p,scope:{...scope,organization:''}}).ready,false);
  p.sources[2].materialFingerprint=p.sources[0].materialFingerprint;assert.equal(prepareWeeklyCard(p).ready,false);
  p.sources[2].materialFingerprint='other';p.sources[2].quote='没有这句话';assert.equal(prepareWeeklyCard(p).ready,false);
  assert.equal(prepareWeeklyCard({...legal(),conflict:true}).ready,false);
});
test('frozen review accepts only its current version; approval, evidence and scope persist as one record',t=>{
  let p=legal();const store=makeWeeklyStore(isolated(t),()=>[p]),snap=store.freeze({}),[c]=snap.cards;
  const request={snapshotId:snap.id,id:c.id,version:c.version,action:'accepted',actor:'trusted command session'};
  p={...p,summary:'变化'};assert.throws(()=>store.decide(request),/变化/);
  p=legal();assert.deepEqual(store.decide(request),store.decide(request));assert.throws(()=>store.decide({...request,action:'declined'}),/已有/);
  assert.equal(store.guidanceFor(scope,'x').length,1);
  for(const k of Object.keys(scope))assert.equal(store.guidanceFor({...scope,[k]:'other'},'x').length,0);
  assert.equal(store.publicView(snap).candidates[0].decision.action,'accepted');
});
test('case facts stay in their case/session; presentation approvals limit audience and deliverable',t=>{
  const proposals=[{...legal(),id:'f',kind:'fact',scope:{caseId:'case-0',sessionId:'session-0'},sources:[source('material',0)]},
    {...legal(),id:'p',kind:'presentation',scope:{...scope,deliverable:'签约意见',audience:'法务'},sources:[source('recognition',1)]}];
  const store=makeWeeklyStore(isolated(t),()=>proposals),snap=store.freeze({});
  for(const c of snap.cards)store.decide({snapshotId:snap.id,id:c.id,version:c.version,action:'accepted',actor:'本人'});
  assert.deepEqual(store.guidanceFor({id:'case-0'},'session-0').map(x=>x.kind),['fact']);
  assert.deepEqual(store.guidanceFor({id:'case-0'},'other'),[]);
  assert.deepEqual(store.guidanceFor({...scope,deliverable:'签约意见',audience:'法务'},'other').map(x=>x.kind),['presentation']);
  assert.deepEqual(store.guidanceFor(scope,'other'),[]);
});
test('freeze deduplicates the same batch and omits unchanged material in the following week',t=>{
  const p=legal(),store=makeWeeklyStore(isolated(t),()=>[p]);
  const now='2026-11-20T10:00:00Z';assert.equal(store.freeze({now}).id,store.freeze({now}).id);
  assert.equal(store.freeze({now:'2026-11-27T10:00:00Z'}).cards.length,0);
  p.summary='补充纠正';assert.equal(store.freeze({now:'2026-11-27T10:01:00Z'}).cards.length,1);
  assert.equal(weeklyPeriod('2021-01-01T00:01:00+08:00').number,53);
});
test('experience evidence outside the review contains only controlled labels, not source titles or client material',t=>{
  const p=legal();
  p.title='企业甲的草稿';p.sources[0].title='企业甲合同材料 https://invalid.example';
  p.sources[0].turns[0].text+=' 个人会话原文';p.scope.organization='企业甲';
  const store=makeWeeklyStore(isolated(t),()=>[p]),snap=store.freeze({}),c=snap.cards[0];
  store.decide({snapshotId:snap.id,id:c.id,version:c.version,action:'accepted',actor:'本人'});
  const evidence=store.guidanceFor(p.scope,'other')[0].evidenceView;
  assert.deepEqual(evidence.sources.map(x=>x.role),['原案纠正','独立相似案','反例']);
  assert.deepEqual(Object.keys(evidence.sources[0]),['role','title']);assert.equal(evidence.sources[0].title,'原案纠正记录 · 合同');
  assert.doesNotMatch(JSON.stringify(evidence),/企业甲|个人会话|来源原句|https:|case-|session-/);
  assert.deepEqual(store.guidanceFor({...p.scope,stance:'卖方'},'other'),[]);
});
test('Friday catch-up excludes later submissions; Saturday manual previews do not consume the next scheduled issue',t=>{
  const friday='2026-11-20T10:00:00.000Z',saturday='2026-11-21T01:00:00.000Z',next='2026-11-27T10:00:00.000Z';
  const before=legal(),after={...legal(),id:'weekend-revision',title:'周六才提交的材料'};
  const store=makeWeeklyStore(isolated(t),({asOf})=>[before,...(!asOf||asOf>=saturday?[after]:[])]);
  const preview=store.freeze({now:saturday});
  assert.equal(preview.cards.length,2);
  const missed=store.freeze({now:friday,scheduled:true});
  assert.deepEqual(missed.cards.map(c=>c.title),[before.title]);assert.equal(missed.cutoff,friday);
  assert.equal(store.freeze({now:friday,scheduled:true}).id,missed.id);
  const following=store.freeze({now:next,scheduled:true});
  assert.deepEqual(following.cards.map(c=>c.title),[after.title]);
});
test('HTML archives escape source text, retain zero-state template and contain no browser approval credential',t=>{
  const home=isolated(t),p=legal();p.summary='付款</script>正文';
  const surface=registerWeekly({},{home,listProposals:()=>[p]});
  const result=surface.open({sessionId:'a'});assert.equal(result.url,undefined);
  const html=fs.readFileSync(result.file,'utf8');
  assert.ok(!html.includes('付款</script>正文'));assert.ok(html.includes('付款\\u003c/script\\u003e正文'));
  assert.ok(html.includes('"interactive":false'));assert.ok(!html.includes('localStorage'));
  const empty=renderWeekly({period:weeklyPeriod(),candidates:[],generated:new Date().toISOString()});
  assert.ok(empty.includes('本期没有新增或更新的提案'));
});
