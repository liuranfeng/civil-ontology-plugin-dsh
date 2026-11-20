import assert from 'node:assert/strict';
import test from 'node:test';
import {registerScenarioTools,workflowFor} from './scenario-tools.mjs';
import {createCourtWebJudgmentProvider} from './judgment-provider.mjs';

// Synthetic fixtures exercise protocol and evidence checks, not the legal merits or a live court portal.
const fact='对方确认已经收到该批货物。';
const reference={sourceId:'M',quote:fact};
const body='示例人民法院\n民事判决书\n（2025）示民初999号\n本院查明，受领方已经签字确认。\n本院认为，交付事实有相应证据支持。\n判决如下。';
const base={caseId:'核验-1',reviewRevision:1};
const plan={...base,question:'当事人以何种材料证明交付？',facts:[reference],scope:'公开民事案件及当事人提供的裁判文书',queries:['交付证明','交付未获证明'],axes:['签字确认的内容']};
const item={court:'示例人民法院',docket:'（2025）示民初999号',factQuote:'受领方已经签字确认。',reasonQuote:'交付事实有相应证据支持。',
  direction:'支持',similarity:'均涉及交付事实。',difference:'签字文件的内容仍待比对。',effect:'可以比对文书记载的交接事实。'};
const url='https://fixture.court.gov.cn/case/one';
const comparison={...base,searches:[],cases:[],limitation:'本次只核对指定范围的材料。',conclusion:'仅对已经核实的事实作条件比较。'};
function fixture(mode,fetchImpl,judgmentProvider=createCourtWebJudgmentProvider({fetchImpl})){
  let row={packet:{id:base.caseId,taskMode:mode,sources:[
    {id:'M',kind:'当事人陈述',locator:'委托人来信',text:fact},
    {id:'J',kind:'裁判文书原件',locator:'当事人提供的示例文书',text:body}]},revision:1};
  const fns=new Map();
  registerScenarioTools({tools:{register(o){fns.set(o.name,o.fn);}}},{
    tool(name,_description,_props,_required,fn){return {name,fn};},session(){return '会话';},
    store:{get(){return row;},put(_id,next){row=next;}},judgmentProvider});
  return {call:(name,args)=>fns.get(name)(args,{}),row:()=>row};
}
const advice={...base,question:'目前能证明什么？',answer:'目前可以作为对方受领的初步线索。',issues:[
  {question:'现有材料有何效力？',answer:'还需核对原始凭证。',grounds:'陈述与原始文件的证明力需要分别评价。',exception:'签字权限仍须核实。',
    facts:[reference],lawArticles:[509]}],nextSteps:['请核对实际交接记录。']};

test('咨询意见保存到本案，按卷核对事实、本地收录法条以及依然待核的依据',()=>{
  const f=fixture('consult');
  const out=f.call('civil_consult_opinion',advice);
  assert.match(out.markdown,/第五百零九条/);assert.match(out.markdown,/当事人陈述/);assert.equal(f.row().scenarioOutcome.markdown,out.markdown);
  assert.doesNotMatch(out.markdown,/能否签署|审批路径/);
  const bad={...advice,issues:[{...advice.issues[0],facts:[{...reference,quote:'相反内容'}]}]};
  assert.throws(()=>f.call('civil_consult_opinion',bad),/摘引/);
  assert.throws(()=>f.call('civil_consult_opinion',{...advice,issues:[{...advice.issues[0],lawArticles:[]}]}),/法律依据/);
  assert.match(f.call('civil_consult_opinion',{...advice,issues:[{...advice.issues[0],lawArticles:[],authorityLimit:'需核对约定及适用法律。'}]}).markdown,/待核依据/);
  assert.throws(()=>f.call('civil_consult_opinion',{...advice,reviewRevision:2}),/修订号/);
  assert.throws(()=>f.call('civil_plan_case_search',plan),/对应类型/);
  assert.throws(()=>fixture('contract').call('civil_consult_opinion',advice),/对应类型/);
});
test('两类正式交付均校验详读方法的取舍',()=>{
  const f=fixture('consult');f.row().methodReviews=[{title:'待复核方法'}];
  assert.throws(()=>f.call('civil_consult_opinion',advice),/待复核方法/);
  const r=fixture('research');r.call('civil_plan_case_search',plan);r.row().methodReviews=[{title:'另一待核方法'}];
  assert.throws(()=>r.call('civil_compare_cases',comparison),/另一待核方法/);
});
test('公开裁判逐跳核对来源、保存原件、核验法院案号和引文，不重复计案',async()=>{
  let count=0;
  const f=fixture('research',async()=>{count++;return new Response('<html><body><script>不得作为引文的测试</script><p>'+body+'</p></body></html>',{headers:{'Content-Type':'text/html; charset=UTF-8'}});});
  f.call('civil_plan_case_search',plan);
  const read=await f.call('civil_fetch_judgment',{...base,url});assert.match(read.markdown,/本院查明/);assert.doesNotMatch(read.markdown,/不得作为引文/);
  await f.call('civil_fetch_judgment',{...base,url,find:'本院认为'});assert.equal(count,1);
  const args={...comparison,cases:[{...item,url}]};
  assert.match(f.call('civil_compare_cases',args).markdown,/法院公开原文/);
  assert.throws(()=>f.call('civil_compare_cases',{...args,cases:[{...item,url,reasonQuote:'并不存在的理由。'}]}),/逐字/);
  assert.throws(()=>f.call('civil_compare_cases',{...args,cases:[{...item,url,court:'其他人民法院'}]}),/逐字/);
  assert.throws(()=>f.call('civil_compare_cases',{...args,cases:[{...item,url},{...item,url}]}),/同一案号/);
  assert.throws(()=>f.call('civil_compare_cases',{...args,cases:[{...item,url:'https://fixture.court.gov.cn/unread'}]}),/读取工具/);
  assert.throws(()=>f.call('civil_compare_cases',{...args,cases:[{...item,sourceId:'J'}]}),/来源标签不能证明/);
});
test('即使模型把材料类型标成裁判原件，案内摘录也只作待核线索',()=>{
  const f=fixture('research');
  f.call('civil_plan_case_search',plan);
  const args={...comparison,leads:[{sourceId:'J',quote:item.factQuote}]};
  const out=f.call('civil_compare_cases',args);
  assert.match(out.markdown,/待核线索（未纳入裁判比较）/);
  assert.match(out.markdown,/本次未取得可逐项核对的裁判/);
  assert.equal(f.row().scenarioOutcome.cases.length,0);
  assert.equal(f.row().scenarioOutcome.leads.length,1);
  assert.throws(()=>f.call('civil_compare_cases',{...args,leads:[{sourceId:'J',quote:'并未载有的语句。'}]}),/逐字/);
});
test('法院站点无法取得正文、跳到非许可域名或没有裁判时，如实保留限制',async()=>{
  let calls=0;
  const f=fixture('research',async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://not-a-court.invalid/one'}});});
  f.call('civil_plan_case_search',plan);
  await assert.rejects(()=>f.call('civil_fetch_judgment',{...base,url:'http://127.0.0.1/test'}),/官方域名/);
  assert.equal(calls,0);
  assert.match((await f.call('civil_fetch_judgment',{...base,url})).markdown,/未能提供/);assert.equal(calls,1);
  const out=f.call('civil_compare_cases',{...comparison,conclusion:'虚构的裁判结论。'}).markdown;
  assert.match(out,/本次未取得/);assert.match(out,/未取得裁判原文/);assert.doesNotMatch(out,/虚构的裁判结论/);
  assert.throws(()=>f.call('civil_compare_cases',{...comparison,cases:[{...item,url}]}),/读取工具/);
  f.row().revision++;assert.throws(()=>f.call('civil_compare_cases',{...comparison,reviewRevision:2}),/当前案卷/);
});
test('开案指南按任务区分',()=>{
  assert.match(workflowFor('research'),/web_search/);assert.match(workflowFor('consult'),/civil_consult_opinion/);
  assert.doesNotMatch(workflowFor('research')+workflowFor('consult'),/签约前|审批路径/);
});
test('更换裁判来源仍按同一套事实、裁判理由及例外比较，调用方自报来源不能混入',async()=>{
  const ref='fixture:判例-1';
  let reads=0;
  const provider={
    id:'fixture-records',label:'测试裁判资料库',normalize(s){if(s!==ref)throw Error('未知出处');return s;},
    async read(locator){reads++;return {kind:'judgment-text',locator,text:body};}
  };
  const f=fixture('research',undefined,provider);
  f.call('civil_plan_case_search',plan);
  const args={...comparison,cases:[{...item,url:ref}]};
  assert.throws(()=>f.call('civil_compare_cases',args),/读取工具/);
  const supplied={...base,url:ref,text:'由调用方自报的裁判意见',providerId:'自报的来源'};
  assert.match((await f.call('civil_fetch_judgment',supplied)).markdown,/测试裁判资料库/);
  assert.equal(reads,1);
  assert.match(f.call('civil_compare_cases',args).markdown,/测试裁判资料库/);
  assert.equal(f.row().scenarioOutcome.cases[0].providerId,provider.id);
  const other=fixture('research',undefined,{...provider,id:'different-records'});
  other.call('civil_plan_case_search',plan);other.row().judgmentPages=f.row().judgmentPages;
  assert.throws(()=>other.call('civil_compare_cases',args),/读取工具/);
  f.row().judgmentPages[0].text+='被改变的正文';
  assert.throws(()=>f.call('civil_compare_cases',args),/读取工具/);
});
test('未接入裁判来源或来源只返回摘要时，仍可保存线索与检索范围',async()=>{
  const f=fixture('research',undefined,null);
  f.call('civil_plan_case_search',plan);
  assert.match((await f.call('civil_fetch_judgment',{...base,url})).markdown,/尚未连接/);
  assert.match(f.call('civil_compare_cases',comparison).markdown,/本次未取得/);
  const g=fixture('research',undefined,{id:'summary-only',label:'摘要库',normalize:s=>s,
    async read(ref){return {kind:'summary',locator:ref,text:body};}});
  g.call('civil_plan_case_search',plan);
  assert.match((await g.call('civil_fetch_judgment',{...base,url})).markdown,/未能提供/);
  assert.throws(()=>g.call('civil_compare_cases',{...comparison,cases:[{...item,url}]}),/读取工具/);
});
