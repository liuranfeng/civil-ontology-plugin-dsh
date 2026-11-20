import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {makeStore,taskModeOf} from './case-store.mjs';
import {approvedForCase,confirmCatalogReview,prepareCatalogReview} from './catalog-review.mjs';

const title='所有权转移与验收、价款支付';
const terms=['买方付清价款后转移所有权。','全部余款结清后所有权转移。','交货时货物所有权转给买方。'];
const roles=['原案','相似案','反例'];
const scope={scene:'采购业务',stance:'买方',stage:'签约前',businessKind:'设备采购'};
function testStore(t){
  const base=path.resolve(os.tmpdir());
  const home=fs.mkdtempSync(path.join(base,'civil-scope-'));
  t.after(()=>{
    if(path.dirname(home)===base&&path.basename(home).startsWith('civil-scope-'))fs.rmSync(home,{recursive:true});
  });
  return makeStore(home);
}
function packet(id,quote,mode){
  return {id,...scope,...(mode?{taskMode:mode}:{}),sources:[{id:'C1',kind:'正文',locator:'权属约定',text:quote}]};
}

test('同编号续办沿用任务类别，同材料可为另一类独立委托另立案',t=>{
  const store=testStore(t);
  const first=store.open('a',packet('咨询一',terms[0],'consult'));
  store.put('a',{...first,methodReviews:[{title}]});
  assert.throws(()=>store.open('a',packet('咨询一',terms[0],'contract')),/其他法律任务/);
  assert.throws(()=>store.put('a',{...first,packet:packet('咨询一',terms[0],'research')}),/其他法律任务/);
  assert.throws(()=>store.open('a',packet('咨询二',terms[0],'consult')),/原案件编号/);
  assert.equal(taskModeOf(store.open('a',packet('合同一',terms[0])).packet),'contract');
  const supplement=packet('咨询一',terms[0]);
  supplement.sources.push({id:'C2',kind:'附件',locator:'交货安排',text:'双方另以清单结算。'});
  assert.equal(store.open('a',supplement).packet.taskMode,'consult');
  assert.equal(store.open('a',supplement,{refresh:true}).packet.taskMode,'consult');
  const existing=store.get('a');
  assert.equal(store.put('a',{...existing,packet:supplement}).packet.taskMode,'consult');
});

test('采购合同专项规则不会用于同业务立场的咨询或类案检索',t=>{
  const store=testStore(t);
  const candidate={id:'取货',rule:'schedule-document-priority',scope,observation:'交货条款指明凭证。',reason:'交货日期有特别约定。',
    evidence:{support:[{id:'a',pass:true}],counter:[{id:'b',pass:true}],regression:[{id:'c',pass:true}]}};
  assert.throws(()=>store.stage({...candidate,scope:{...scope,taskMode:'consult'}}),/采购合同/);
  const staged=store.stage(candidate);
  store.publish(staged.id,staged.confirmation);
  assert.deepEqual(store.open('a',packet('旧合同',terms[0])).rules,[candidate.rule]);
  for(const mode of ['consult','research']){
    assert.deepEqual(store.open('a',packet(mode,terms[0],mode)).rules,[]);
  }
});

test('三种任务分别积累经验，反例可跨业务子类，四项范围的旧合同回执仍可确认',t=>{
  const store=testStore(t);
  function addExamples(mode){
    return roles.map((role,i)=>{
      const id=mode+i;
      const p=packet(id,terms[i],mode);
      if(role==='反例')p.businessKind='物料采购';
      const row=store.open(id,p);
      if(role==='原案')store.put(id,{...row,corrections:[{state:'recorded',sourceId:'C1',quote:terms[i],reason:'依双方明示约定确定所有权转移。'}]});
      return {role,caseId:id,sourceId:'C1',quote:terms[i],before:'原意见按交付确定。',after:'分别适用各案约定。',reason:'两份交易的权属条件不同。'};
    });
  }
  const sets=Object.fromEntries(['contract','consult','research'].map(mode=>[mode,addExamples(mode)]));
  for(const [mode,examples] of Object.entries(sets)){
    const current=store.get(mode+'0');
    const other=sets[mode==='consult'?'research':'consult'];
    for(let i=0;i<roles.length;i++){
      const mixed=[...examples];
      mixed[i]=other[i];
      assert.throws(()=>prepareCatalogReview(store,current,{title,examples:mixed}),/同一业务方向/);
    }
    assert.deepEqual(approvedForCase(store,current.packet),[]);
    const prepared=prepareCatalogReview(store,current,{title,examples});
    if(mode==='contract'){
      const receipt=JSON.parse(fs.readFileSync(path.join(store.home,'catalog-review',prepared.id+'.json')));
      assert.deepEqual(receipt.scope,[scope.scene,scope.stance,scope.stage,scope.businessKind]);
      const originalBody={scope:receipt.scope,guidance:receipt.guidance,evidence:receipt.evidence};
      assert.equal(createHash('sha256').update(JSON.stringify(originalBody)).digest('hex').slice(0,16),prepared.id);
    }
    assert.equal(confirmCatalogReview(store,prepared.id),title);
    assert.equal(approvedForCase(store,current.packet).length,1);
  }
  assert.equal(approvedForCase(store,packet('旧案',terms[0])).length,1);
  for(const mode of ['contract','consult','research']){
    assert.equal(approvedForCase(store,store.get(mode+'0').packet).length,1);
  }
});
