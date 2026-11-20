
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCase, makeReport, resolveCorrection } from './analysis.mjs';
import { makeStore } from './case-store.mjs';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sample = {
  id: 'test-a', scene: '采购业务', stance: '买方', stage: '签约前',
  sources: [
    {id:'C1', kind:'正文', locator:'第4条', text:'合同签订后支付30%货款，货到且发票到后30天支付70%货款。'},
    {id:'C2', kind:'正文', locator:'第5条', text:'货到后十日内办理验收。'},
    {id:'C3', kind:'正文', locator:'第6条', text:'以买方下达的内向交货单所载日期为准。'},
    {id:'F1', kind:'表单', locator:'结算字段', text:'银行转账'}
  ]
};
test('joint gates condition the final installment without silently adding acceptance', () => {
  const result=analyzeCase(sample);
  assert.deepEqual(result.installments.map(x=>x.gates), [['signature'],['receipt','invoice']]);
  assert.equal(result.installments.at(-1).conclusion,'conditional');
  assert.ok(result.findings.some(x=>x.id==='acceptance-unlinked'));
  assert.ok(result.findings.find(x=>x.id==='acceptance-unlinked').refs.includes('C2'));
});
test('off mode keeps the same sources and rules and suppresses relation-derived conclusions', () => {
  const on=analyzeCase(sample);
  const off=analyzeCase(sample,{ontology:false});
  assert.deepEqual(on.sources,off.sources);
  assert.deepEqual(on.policy,off.policy);
  assert.equal(off.findings.some(x=>x.id==='acceptance-unlinked'),false);
});
test('an unsupported spoken correction becomes an explicit hypothetical', () => {
  const diff=resolveCorrection(sample,{type:'fact',field:'invoice',value:true,reason:'发票已收到'});
  assert.equal(diff.state,'hypothetical');
  assert.equal(diff.updated.confirmedFacts?.invoice,undefined);
  assert.equal(diff.proposed.confirmedFacts.invoice,true);
});
test('candidate version requires approval and stays scoped, with existing case version pinned',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'civil-case-test-'));
  const store=makeStore(root);
  const before=store.open('test-session',sample);
  assert.equal(before.version,'v1');
  const proposed=store.stage({id:'test-fix',rule:'schedule-document-priority',scope:{scene:'采购业务',stance:'买方'},observation:'本案以交货单为准',reason:'存在合同明确优先条款',evidence:{support:[{id:'a',pass:true}],counter:[{id:'b',pass:true}],regression:[{id:'c',pass:true}]}});
  assert.equal(proposed.state,'awaiting-user');
  assert.throws(()=>store.publish(proposed.id,'unconfirmed'),/确认/);
  assert.equal(store.open('next-session',{...sample,id:'test-b'}).version,'v1');
  const version=store.publish(proposed.id,proposed.confirmation);
  assert.equal(store.open('test-session',sample).version,'v1');
  assert.equal(store.open('third-session',{...sample,id:'test-c'}).version,version);
  assert.equal(store.open('sales-session',{...sample,id:'sales-test',scene:'销售业务'}).version,'v1');
});
test('case report follows the same findings and escapes source content',()=>{
  const r=analyzeCase({...sample,sources:[...sample.sources,{id:'A1',kind:'附件',locator:'附件1',text:'<script>window.invalid=true</script>'}]});
  const report=makeReport(r);
  assert.match(report.markdown,/事实与证据/);
  assert.match(report.markdown,/方法与技能/);
  assert.match(report.markdown,/判断与取舍/);
  assert.match(report.html,/acceptance-unlinked/);
  assert.ok(!report.html.includes('<script>window.invalid=true</script>'));
});


test('going back to an earlier case resumes the evidence and version',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'civil-case-test-'));
  const store=makeStore(root);
  const first=store.open('same-session',sample);
  store.put('same-session',{...first,revision:2});
  store.open('same-session',{...sample,id:'second'});
  assert.equal(store.open('same-session',sample).revision,2);
});
test('a supported method correction modifies the current case rule selection',()=>{
  const correction=resolveCorrection(sample,{
    type:'method',rule:'schedule-document-priority',sourceId:'C3',
    quote:'以买方下达的内向交货单所载日期为准。',reason:'交货日期应从合同明确指定的材料确认'
  });
  assert.equal(correction.state,'applied-to-case');
  assert.deepEqual(correction.additionalRules,['schedule-document-priority']);
  assert.ok(analyzeCase(correction.updated,{useRules:correction.additionalRules}).findings.some(f=>f.id==='schedule-priority'));
});
test('mixed conjunctive and alternative gates remain unresolved',()=>{
  const packet={...sample,sources:[{id:'C1',kind:'正文',locator:'第4条',text:'货到且初验合格或卖方另行提交材料后支付70%货款。'}]};
  const r=analyzeCase(packet);
  assert.equal(r.installments[0].connectors,'unresolved');
  assert.equal(r.installments[0].conclusion,'pending');
  assert.ok(r.findings.some(x=>x.id==='payment-conditions-unclear-1'));
});


test('the report separates process from deliverable and links decisions to exact evidence',()=>{
  const r=analyzeCase({...sample,businessKind:'事业部物料采购合同'});
  const report=makeReport(r);
  assert.equal(r.process.some(step=>step.id==='claims'),true);
  assert.ok(r.process.find(step=>step.id==='reasoning').items.some(item=>item.refs.includes('C1')));
  assert.match(report.html,/id="process-view"/);
  assert.match(report.html,/id="deliverable-view"/);
  assert.match(report.html,/href="#source-C1"/);
  assert.match(report.html,/事业部物料采购合同/);
  assert.match(report.markdown,/## 分析过程/);
  assert.match(report.markdown,/## 审查成果/);
});

import { validateAgentRecord } from './agent-record.mjs';

test('agent judgment records need exact evidence and cover the complete review path',()=>{
  const r=analyzeCase(sample);
  const kinds=['intake','knowledge','claims','reasoning','choices'];
  const steps=kinds.map(kind=>({
    kind,title:'复核 '+kind,decision:'保留待核条件',reason:'正文显示付款受条件限制',
    evidence:[{sourceId:'C1',quote:'合同签订后支付30%货款'}],alternatives:['核对全文中是否有其他约定']
  }));
  const record=validateAgentRecord(r,steps);
  assert.deepEqual(record.steps.map(x=>x.kind),kinds);
  assert.match(makeReport({...r,agentRecord:record}).html,/Agent 提交的判断记录/);
  assert.throws(()=>validateAgentRecord(r,steps.slice(0,4)),/分析阶段/);
  assert.throws(()=>validateAgentRecord(r,steps.map(x=>({...x,evidence:[{sourceId:'C1',quote:'材料没有这句话'}]}))),/原文/);
});


import { buildQuestionDossier } from './question-model.mjs';

test('a contract starts with one decision question and drills down into linked case questions',()=>{
  const result=analyzeCase({...sample,businessKind:'事业部物料采购合同'});
  const dossier=buildQuestionDossier(result);
  assert.match(dossier.question,/付款|交货/);
  assert.deepEqual(dossier.cases.map(x=>x.id),['payment','delivery']);
  for(const topic of dossier.cases){
    assert.ok(topic.question.endsWith('？'));
    assert.ok(topic.answer.length>15);
    assert.ok(topic.questions.length>=2);
    for(const question of topic.questions){
      for(const part of ['question','answer','business','law','choice','needed']) assert.ok(question[part],part);
      assert.ok(question.refs.every(id=>result.sources.some(s=>s.id===id)));
    }
  }
  const report=makeReport(result);
  assert.match(report.html,/data-topic="payment"/);
  assert.match(report.html,/data-topic="delivery"/);
  assert.match(report.html,/class="question-canvas"/);
  assert.match(report.html,/href="#topic-payment"/);
  assert.match(report.markdown,/合同主问题/);
  assert.match(report.markdown,/专题答案/);
});

