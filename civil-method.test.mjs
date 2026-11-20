import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {explainTradeTerm} from './trade-review.mjs';
import {makeCounselReport} from './counsel-view.mjs';
import {analyzeCase} from './analysis.mjs';
import {registerCivilTools} from './civil-tools.mjs';
import {apply} from './index.mjs';
import os from 'node:os';
import path from 'node:path';
import {makeStore} from './case-store.mjs';
import {prepareCatalogReview,approvedForCase,confirmCatalogReview} from './catalog-review.mjs';
import {legalReviewMarkdown} from './word-tools.mjs';
const law=JSON.parse(fs.readFileSync(new URL('./civil/code.json',import.meta.url)));
const sample={id:'trade-test',scene:'采购业务',stage:'签约前',stance:'买方',sources:[{id:'P1',kind:'正文',locator:'main_document.text 第99行',text:'Price = Platts FOB Port A weekly average.'},{id:'D1',kind:'正文',locator:'交付条款',text:'Delivery mode: CFR.'}]};
test('价格源、交货和船名各按原句认定',()=>{
 assert.match(explainTradeTerm('FOB',sample.sources[0].text).term,/报价/);
 assert.match(explainTradeTerm('CFR','benchmark CFR Port B').term,/报价/);
 assert.match(explainTradeTerm('CFR',sample.sources[1].text).duties.join(''),/卖方负责.*主运费/);
 assert.match(explainTradeTerm('FOB','FOB Port A').duties.join(''),/货物已明确划归本合同/);
 assert.match(explainTradeTerm('Ginga','Vessel Name: GINGA EXAMPLE').qualification,/船名栏/);
 assert.match(explainTradeTerm('Ginga','as per Ginga').qualification,/标准条款/);
 for(const t of ['EXW','FCA','CPT','CIP','FAS','FOB','CFR','CIF','DAP','DPU','DDP'])assert(explainTradeTerm(t,t).duties.length>0);
});
test('两组会话可用同一份材料和制度试审，普通组不会预读本体',async()=>{
 const previous=process.env.DSH_HOME,mode=process.env.DSH_CIVIL_METHOD;
 process.env.DSH_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'civil-pair-'));
 delete process.env.DSH_CIVIL_METHOD;
 try {
   function group(enabled){
     const tools=new Map(),prompts=[];
     apply({tools:{register:t=>tools.set(t.name,t)},systemPrompt:{section:x=>prompts.push(x.text)},inject(){}},{ontology:enabled});
     return {tools,prompt:prompts.join('\n')};
   }
   const off=group(false),on=group(true);
   assert(!off.tools.has('civil_preview_candidate'));assert(on.tools.has('civil_preview_candidate'));
   assert.doesNotMatch(off.prompt,/须有相应的|请求权基础/);assert.match(on.prompt,/请求权基础/);
   const open=(g,id)=>g.tools.get('civil_open_case').execute({packet:sample},{agent:{id},signal:new AbortController().signal});
   const ordinary=await open(off,'plain'),assisted=await open(on,'assisted');
   assert.equal(ordinary.result.ontology,false);assert.equal(assisted.result.ontology,true);
   assert.deepEqual(ordinary.result.sources,assisted.result.sources);assert.deepEqual(ordinary.result.policy,assisted.result.policy);
 }finally{
   if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;
   if(mode===undefined)delete process.env.DSH_CIVIL_METHOD;else process.env.DSH_CIVIL_METHOD=mode;
 }
});
test('本地法典原文逐条连续且七编齐备',()=>{
 assert.equal(law.length,1260);assert.equal(new Set(law.map(x=>x.book)).size,8);
 assert(law.every((a,i)=>a.number===i+1&&a.text.length>4));
 assert.match(law[627].text,/价款/);
});
test('对话与案件意见使用律师引法并保留原始证据在内部',()=>{
 const r=analyzeCase(sample);r.operations=[{name:'internalTool',callId:'secret-run-01'}];
 const v=makeCounselReport(r);for(const txt of [v.markdown,v.summary,v.html])assert.doesNotMatch(txt,/secret-run|main_document|第99行|PROC-|\[P1\]|internalTool/);
});
test('术语意见写回当前案时须核对案件、原句及相应版本',()=>{
 const tools=new Map();const ctx={tools:{register:x=>tools.set(x.name,x)},systemPrompt:{section(){}}};let row={packet:sample,revision:4};
 const store={get:()=>row,put:(_,v)=>{row=v;}};
 registerCivilTools(ctx,{tool:(name,d,p,r,run)=>({name,run}),session:()=>1,store,openCase(){}});
 const arg={term:'FOB',sourceId:'P1',quote:sample.sources[0].text,reviewRevision:4,meaning:'作为价格基准。',obligation:'应按约取价。',claim:'按买卖合同主张到期价款。',boundary:'交付条件另查。',publication:'国际商会海运条款',url:'https://iccwbo.org/'};
 assert.throws(()=>tools.get('civil_record_term_opinion').run({...arg,reviewRevision:5},{}));
 assert.throws(()=>tools.get('civil_record_term_opinion').run({...arg,sourceId:'D1'},{}));
 tools.get('civil_record_term_opinion').run(arg,{});assert.equal(row.termNotes[0].meaning,arg.meaning);
 assert.match(tools.get('civil_lookup_statute').run({query:'628'}).markdown,/第六百二十八条/);
});
test('跨案证据须经本人确认且仅进入同一审查方向',()=>{
 const store=makeStore(fs.mkdtempSync(path.join(os.tmpdir(),'civil-evidence-')));
 const title='所有权转移与验收、价款支付';
 const examples=['原案','相似案','反例'].map((role,i)=>{
   const quote=['付清全部价款后转移所有权。','付清余款后设备所有权转移。','设备交付时所有权转移。'][i];
   const packet={...sample,id:'独立事项'+i,businessKind:i===2?'物料采购':'设备采购',sources:[{id:'C1',kind:'正文',locator:'所有权条款',text:quote}]};
   let row=store.open('会话'+i,packet);
   if(!i)store.put('会话'+i,{...row,corrections:[{state:'recorded',sourceId:'C1',quote,reason:'应依合同另行确定所有权转移。'}]});
   return {caseId:packet.id,sourceId:'C1',quote,role,before:'原意见按交付认定。',after:'按本案具体条款认定。',reason:'两份合同的权属约定不同。'};
 });
 const current=store.get('会话1'), args={title,examples};
 assert.throws(()=>prepareCatalogReview(store,current,{title,examples:examples.slice(0,2)}));
 assert.throws(()=>prepareCatalogReview(store,current,{title,examples:[examples[0],{...examples[0],role:'相似案'},examples[2]]}));
 assert.throws(()=>prepareCatalogReview(store,current,{title,examples:examples.map(e=>({...e,quote:'原文没有的内容。'}))}));
 const review=prepareCatalogReview(store,current,args);
 assert.equal(approvedForCase(store,current.packet).length,0);assert.match(review.markdown,/反例/);
 confirmCatalogReview(store,title);
 assert.equal(approvedForCase(store,current.packet)[0].title,title);
 assert.equal(approvedForCase(store,{...current.packet,stance:'卖方'}).length,0);
});
test('律师意见仅引用可核实的条号和相符的审批级别，包含本案术语依据',()=>{
 const packet={sources:[{id:'C',kind:'正文',locator:'交付条款',text:'第十条　交付采用 CFR。'},{id:'R',kind:'采购授权制度',locator:'审批权限',text:'重大事项应先取得二级审批。'}]};
 const ref={sourceId:'C',name:'合同第10条',quote:'交付采用 CFR。'},policy={sourceId:'R',name:'采购授权制度',quote:'重大事项应先取得二级审批。'};
 const review={title:'采购签约意见',decision:'请补交付单据。',stance:'我方是买方',materialScope:'已审阅所列条款。',profile:['货物买卖。'],risks:[{risk:'核对交付安排',refs:[ref],status:'待确认',action:'核查指定港口。'}],approval:[{text:'应先取得Ⅱ级审批。',refs:[policy]}],conclusion:'明确交付安排后决定签署。'};
 const note={sourceId:'C',term:'CFR',quote:ref.quote,meaning:'成本加运费。',obligation:'卖方支付主运费。',claim:'区分价款请求与货损责任。',boundary:'所选版本仍需核实。',publication:'国际商会海运规则'};
 assert.match(legalReviewMarkdown(packet,review,[note]).markdown,/成本加运费/);
 assert.throws(()=>legalReviewMarkdown(packet,{...review,approval:[{text:'需要三级审批。',refs:[policy]}]}));
 assert.throws(()=>legalReviewMarkdown(packet,{...review,approval:[{text:'需二级审批。',refs:[ref]}]}));
 assert.throws(()=>legalReviewMarkdown(packet,{...review,risks:[{...review.risks[0],refs:[{...ref,name:'合同第九条'}]}]}));
});

