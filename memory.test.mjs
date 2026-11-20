import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {makeStore} from './case-store.mjs';
import {makeMemory,saveJSON} from './memory-store.mjs';
import {captureText,registerMemory} from './memory-plugin.mjs';
import {collectProposals,verifiedProposal} from './memory-digest.mjs';
import {prepareWeeklyCard} from './weekly-store.mjs';
const packet=(id='case-a')=>({id,scene:'设备采购',businessKind:'设备买卖',stance:'买方',stage:'签约前',organization:'演示组织',taskMode:'contract',audience:'法务',deliverable:'审查报告',sources:[{id:'p1',kind:'合同',locator:'第五条',text:id+'的设备已经交付，终验后付尾款。'}]});
function setup(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'civil-v101-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const memory=makeMemory(home),store=makeStore(home),hooks=new Map(),tools=new Map(),commands=new Map();
  const ctx={tools:{register:d=>tools.set(d.name,d)},on:(key,fn)=>hooks.set(key,fn),inject(ds,fn){if(ds[0]==='commands')fn({commands:{register:d=>commands.set(d.name,d)}});}};
  const api=registerMemory(ctx,{home,memory,store,tool:(name,desc,props,required,run)=>({name,run}),session:e=>e.agent.id});
  let tick=0;const base=Date.now()-1e6;
  const say=(sid,turn,text)=>hooks.get('agent/inbox/claimed')({agent:{id:sid},turn,message:{id:sid+turn,source:{kind:'user'},content:text,time:base+(++tick)*1000}});
  const event=(sid,type,data)=>hooks.get('session/event')({id:sid},{seq:++tick,type,data,time:base+tick*1000});
  const answer=(sid,turn,text)=>event(sid,'assistant/message',{turn,message:{content:[{type:'reasoning',text:'不得保留私人推理'},{type:'text',text}]}});
  return {home,memory,store,api,say,event,answer,tools,commands,hooks};
}
test('民事入口只采相关片段，关联真实答复、纠正和报告版本；拒绝模型批准',t=>{
  const {memory,store,api,say,event,answer,tools,commands}=setup(t);
  const sid='one',p=packet();
  say(sid,1,'周六的跑步路线怎么安排？');assert.equal(api.isCivilContext(sid),false);
  say(sid,2,'审一下这份买卖合同，再推荐一条跑步路线。');assert.equal(api.isCivilContext(sid),true);
  store.open(sid,p);api.bindCase(sid,p);
  answer(sid,2,'1. 付款条款要求收货后付款。\n2. 签收即可认定验收。');
  say(sid,3,'请解释签收和验收。');answer(sid,3,'1. 买方负责接货。\n2. 签收即验收。');
  event(sid,'deliverables/presented',{turn:3,files:[{path:'C:/demo/审查报告第一版.docx'}]});
  say(sid,4,'第二项要改，表格保留。');
  const rows=memory.turns(sid);assert.ok(rows.every(r=>!r.text.includes('跑步')&&!r.text.includes('私人推理')));
  assert.equal(rows[0].caseId,p.id);
  const corrected=rows.find(r=>r.tags.action==='纠正');assert.match(corrected.targetQuote,/2\. 签收即验收/);assert.ok(!corrected.targetQuote.includes('买方负责'));
  const style=rows.find(r=>r.tags.action==='认可');assert.equal(style.targetQuote,'审查报告第一版.docx');
  const cards=collectProposals(memory).map(prepareWeeklyCard);assert.ok(cards.some(c=>c.kind==='legal'&&!c.ready));
  assert.ok(cards.some(c=>c.kind==='presentation'&&c.ready));assert.ok(!tools.has('civil_memory_apply'));
  assert.ok(commands.has('civil-digest'));
  say(sid,5,'帮我写小说对白。');answer(sid,5,'新的小说片段。');assert.equal(api.isCivilContext(sid),false);assert.equal(memory.turns(sid).length,rows.length);
  say(sid,6,'打开本体关系图');assert.equal(api.isCivilContext(sid),true);
});
test('模型笔记必须有该会话真实原句，历史宽松确认不会进入后案',t=>{
  const {memory,api,tools,home,say}=setup(t),sid='s1';
  say(sid,1,'我们签约前需要审查付款条款。');const exec={agent:{id:sid}};
  assert.throws(()=>tools.get('civil_memory_note').run({tag:'技能',text:'新判断',quote:'模型自报原文'},exec),/原句/);
  const args={tag:'技能',text:'按每期价款列付款凭据。',quote:'需要审查付款条款'};
  assert.equal(tools.get('civil_memory_note').run(args,exec).id,tools.get('civil_memory_note').run(args,exec).id);
  saveJSON(path.join(home,'memory','ledger.json'),{items:[{id:'m-old',sessionId:sid,caseId:'old-case',scene:'采购',text:'既有一条确认记录。',status:'confirmed',at:new Date().toISOString()}]});
  assert.ok(collectProposals(memory).map(prepareWeeklyCard).some(c=>c.title.startsWith('历史记录待复核')&&!c.ready));
  assert.deepEqual(api.guidanceFor(packet(),sid),[]);assert.equal(captureText({source:{kind:'schedule'},content:'后台指令'}),'');
});
test('同一合同不同会话不能伪装成独立验证，只有真实原句及按案认可的复测能通过',t=>{
  const {memory,store,home,say,answer,api}=setup(t),examples=[];
  const opinions=['本案尾款在终验后到期。','本期付款须终验记录。','本期到货款凭签收即可。'];
  for(const [i,role] of ['原案','相似案','反例'].entries()){
    const sid='s'+i,p=packet('case-'+i),src=p.sources[0];
    store.open(sid,p);say(sid,1,'我想咨询付款条件。');answer(sid,1,opinions[i]);say(sid,2,'我认可上一版的付款判断。');
    if(!i){const r=store.get(sid);store.put(sid,{...r,corrections:[{sourceId:'p1',quote:src.text,reason:'需要核对终验记录。'}]});}
    examples.push({role,caseId:p.id,sessionId:sid,sourceId:src.id,quote:src.text,before:'按到货时间计算付款期。',after:opinions[i],reason:'对照本案条款和原有意见。'});
  }
  const prepared={id:'valid-case-set',title:'核对分期付款条件',relation:'履行事实影响价款到期。',verifiedSources:examples};
  const ready=verifiedProposal(home,memory,prepared,packet('case-0'),'s0');assert.equal(prepareWeeklyCard(ready).ready,true);
  const answerMissing=structuredClone(prepared);answerMissing.verifiedSources[1].after='没有在相似案实际输出中出现的意见。';
  assert.equal(prepareWeeklyCard(verifiedProposal(home,memory,answerMissing,packet('case-0'),'s0')).ready,false);
  assert.throws(()=>verifiedProposal(home,memory,{...prepared,verifiedSources:[{...examples[0],quote:'伪造原文'}]},packet('case-0'),'s0'),/原句/);
  const stored=api.addVerifiedExperience(prepared,packet('case-0'),'s0');assert.ok(collectProposals(memory).some(c=>c.id===stored.id));
});
test('周五截止补生成，快照只含当时材料，滚动游标避免重复',t=>{
  const {api,home,commands}=setup(t);
  saveJSON(path.join(home,'memory','weekly.json'),{enabled:true,time:'18:00:00'});
  assert.deepEqual(api.scheduled(new Date('2026-11-19T00:00:00Z')),[]);
  const made=api.scheduled(new Date('2026-11-27T10:00:00Z'));assert.equal(made.length,2);assert.ok(made.every(r=>fs.existsSync(r.file)));
  assert.deepEqual(api.scheduled(new Date('2026-11-27T11:00:00Z')),[]);
  return commands.get('civil-digest').handler({agent:{id:'owner'},rawInput:'history'}).then(r=>assert.match(r.text,/w-[a-f0-9]+/));
});
