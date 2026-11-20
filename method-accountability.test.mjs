import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {batch} from './approved-methods.mjs';
import {registerCivilTools} from './civil-tools.mjs';
import {legalReviewMarkdown,registerWordTools} from './word-tools.mjs';
import {makeStore} from './case-store.mjs';
import {methodReviewOverview} from './method-accountability.mjs';
import {registerClaimTool} from './review-narrative.mjs';
import {readDocument} from './word/vendor/docx.mjs';

test('目录、失败查询与重复详读分开登记；审查意见和 Word 逐项交代证据及取舍',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'civil-method-choice-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const registry=new Map();
  const ctx={tools:{register:definition=>registry.set(definition.name,definition)},systemPrompt:{section(){}}};
  const store=makeStore(home),sid='会话一';
  const shared={tool:(name,description,properties,required,run)=>({name,run}),session:()=>sid,store,openCase(){}};
  registerCivilTools(ctx,shared);registerWordTools(ctx,shared);
  registerClaimTool(ctx,{...shared,save:(id,row)=>store.put(id,row)});
  const run=(name,args)=>registry.get(name).run(args,{});
  const source={id:'C1',kind:'合同正文',locator:'《展会服务合同》服务费条款',text:'服务费在会展结束后十个工作日内支付。展品由委托方自行保管。'};
  const packet={id:'服务合同',scene:'会务服务',stance:'承办方',stage:'签约前',sources:[source]};
  store.put(sid,{...store.open(sid,packet),mode:'on',methodBatch:batch});
  const titles=run('civil_read_method',{}).titles.slice(0,3);
  assert.equal(methodReviewOverview(store.get(sid)).length,0);
  assert.throws(()=>run('civil_read_method',{title:'目录未收录的事项'}));
  for(const title of titles)run('civil_read_method',{title});
  run('civil_preview_candidate',{title:titles[0]});
  assert.equal(methodReviewOverview(store.get(sid)).length,3);
  const quote='服务费在会展结束后十个工作日内支付。';
  const ref={sourceId:'C1',name:source.locator,quote};
  const opinion={title:'会展承办合同审查意见',stance:'承办方',materialScope:'合同正文',decision:'建议确认服务安排后签署。',
    profile:['会务服务'],risks:[{risk:'付款期限',refs:[ref],status:'待确认',action:'记录到期日。'}],approval:['经办人核对后提交用印。'],conclusion:'以服务期限确认作为用印条件。'};
  const exportDoc=()=>run('word_review_export',{reviewRevision:store.get(sid).revision,contractReview:opinion});
  const entry={title:titles[0],applicability:'适用',placement:'列入结论',sourceId:'C1',quote,
    reason:'费用以会展结束为到期计算起点，须保存可核实的履行记录。',effect:'请双方确认服务结束日期并留存交接单。'};
  const undecided={...entry,title:titles[1],applicability:'待核',missing:'请项目负责人确认是否约定分批结束，明确付款起算日。'};
  const excluded={title:titles[2],applicability:'不适用',placement:'不列入结论',sourceId:'C1',
    quote:'展品由委托方自行保管。',reason:'现有约定由委托方保管展品，未发现承办方承担展品保管义务，故未列为承办方责任。'};
  const submit=entries=>run('civil_record_method_decision',{reviewRevision:store.get(sid).revision,entries});
  assert.throws(exportDoc,/尚未/);
  assert.throws(()=>submit([entry,{...excluded,quote:'委托方免除一切责任。'}]),/逐字/);
  assert.equal(methodReviewOverview(store.get(sid)).filter(x=>x.state==='decided').length,0);
  assert.throws(()=>submit([{...undecided,missing:''}]),/待补/);
  submit([entry,undecided,excluded]);
  assert.throws(exportDoc,/主要请求/);
  run('civil_record_claim_basis',{reviewRevision:0,background:'展会结束后委托方支付费用。',backgroundRefs:[ref],
    claims:[{claimant:'承办方',respondent:'委托方',request:'支付服务费',basis:'依合同服务费条款',
      condition:'展会结束后十个工作日届满',defense:'未按约服务时可主张履行抗辩',
      proof:'确认结束时间并保留服务记录',consequence:'约定结束日期确认方式',refs:[ref]}]});
  const result=exportDoc(),word=readDocument(fs.readFileSync(result.file)).blocks.map(b=>b.text).join('\n');
  for(const text of [result.markdown,word]){
    for(const heading of ['合同情况','业务背景','请求权基础','审查结果与签署意见'])assert(text.includes(heading));
    assert(!text.includes('sourceId'));
  }
  for(const title of titles)assert(word.includes(title));
  for(const value of [entry.effect,entry.reason,source.locator,quote,undecided.missing,excluded.reason])assert(word.includes(value));
  assert(result.markdown.includes('3 项方法取舍见 Word 附录'));
  assert(!result.markdown.includes(excluded.reason));
  const restarted=makeStore(home);
  assert.equal(methodReviewOverview(restarted.get(sid)).length,3);
  const prior=store.get(sid);
  store.put(sid,{...prior,revision:prior.revision+1,packet:{...prior.packet,sources:[...prior.packet.sources,
    {id:'C2',kind:'补充约定',locator:'《补充约定》服务范围',text:'另行委托保管参展样品。'}]}});
  assert(methodReviewOverview(store.get(sid)).every(x=>x.state==='stale'));
  assert.throws(exportDoc,/尚未/);
});

test('十余项关联风险的主文篇幅受控，所有决定、证据与不列入的理由仍可逐条回查',()=>{
  const quote='服务范围见经双方确认的服务订单。',location='《服务合同》服务范围';
  const packet={sources:[{id:'S1',locator:location,text:quote}]};
  const clause={sourceId:'S1',name:location,quote};
  const source={title:'签约意见',stance:'服务方',profile:['按订单提供服务。'],materialScope:'主合同及订单',
    decision:'须修订后签。',conclusion:'待双方明确服务范围再提交签署。',approval:['业务负责人确认。','法务复核。','留存用印档。']};
  const narrative={claimsShort:'服务方可据订单请求价款。',claimsLead:'服务方可依履约条款请求价款。',
    claimsDetail:'原订单和签收记录用于证明履行。',background:'按订单结算。',backgroundShort:'按订单结算。'};
  function make(count){
    const items=Array.from({length:count},(_,i)=>({title:'审查方法'+i,applicability:'适用',placement:'列入结论',
      evidence:location+'「'+quote+'」',reason:'结合本案订单说明取舍'+i+'。',effect:'提交并复核签署条件'+i+'。'}));
    const risks=items.map((m,i)=>({risk:'订单要点'+i,status:'须先处理',refs:[clause],action:m.effect,methodTitles:[m.title],primary:i<3}));
    const unused={title:'未采用的事项',applicability:'不适用',placement:'不列入结论',reason:'本案未委托保管。',evidence:items[0].evidence};
    return legalReviewMarkdown(packet,{...source,risks},[],[],{items:[...items,unused],included:items},narrative);
  }
  const few=make(5),many=make(16);
  const body=out=>out.markdown.split('## 附')[0];
  assert(Math.abs(body(many).length-body(few).length)<20);
  assert(Math.abs(many.chat.length-few.chat.length)<15);
  assert(!body(many).includes('提交并复核签署条件4。'));
  assert(!many.chat.includes('结合本案订单说明取舍'));
  for(let i=0;i<16;i++){
    assert(many.markdown.includes('结合本案订单说明取舍'+i+'。'));
    assert.equal(many.markdown.split('提交并复核签署条件'+i+'。').length,2);
  }
  assert(many.markdown.includes('本案未委托保管。'));
  assert.equal((many.markdown.match(/留存用印档。/g)??[]).length,1);
});
