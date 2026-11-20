import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {methodReviewForDelivery} from './method-accountability.mjs';

const wording = description => ({type:'string',description});
const strings = description => ({type:'array',items:{type:'string'},description});
const shape = (properties, required) => ({type:'object',properties,required,additionalProperties:false});
const refs = {type:'array',items:shape({sourceId:wording('案内材料编号'),quote:wording('逐字原文')},['sourceId','quote'])};
const binding = {caseId:wording('当前案件编号'),reviewRevision:{type:'integer',description:'当前材料修订号'}};
const issue = {
  question:wording('需要解答的争点'),answer:wording('针对该争点的答复'),
  grounds:wording('法律关系、要件与事实如何支持答复'),exception:wording('抗辩、例外或会改变答复的事实'),
  facts:refs,lawArticles:{type:'array',items:{type:'integer'},description:'已查明适用的民法典条号'},
  legalRefs:{...refs,description:'案内其他法源或约定的原文'},authorityLimit:wording('法源尚未核实的具体事项'),
};
const opinionFields = {...binding,question:wording('委托人希望解决什么问题'),answer:wording('直接、必要时有条件地答复'),
  issues:{type:'array',items:shape(issue,['question','answer','grounds','exception','facts'])},
  nextSteps:strings('下一步行动和应补的证据')};
const planFields = {...binding,question:wording('拟检索的具体法律争点'),facts:refs,scope:wording('法院、期间、地域和来源范围'),
  queries:strings('按公开争点、裁判分歧或反向结果制定的检索词'),axes:strings('足以改变类比结论的事实或法律差异')};
const searchLog = {query:wording('实际使用的检索词'),source:wording('实际检索的来源或数据库'),result:wording('命中、无结果或访问受限的情形')};
const authority = {
  url:wording('本案从已接入来源实际读取的裁判文书出处'),
  court:wording('原文所载完整法院名称'),docket:wording('原文所载案号'),
  factQuote:wording('裁判文书中与比较相关的事实原句'),reasonQuote:wording('裁判理由或裁判结论原句'),
  direction:{enum:['支持','相反','区别适用'],type:'string'},similarity:wording('与本案的共同点'),
  difference:wording('会改变类比的事实、程序或法律差异'),effect:wording('裁判理由对本案的参考范围'),
};
const researchFields = {...binding,searches:{type:'array',items:shape(searchLog,Object.keys(searchLog))},
  leads:{...refs,description:'可选，案卷里仅有摘录或尚未独立核验出处的文书线索。不得计入可核验裁判。'},
  cases:{type:'array',items:shape(authority,Object.keys(authority))},
  limitation:wording('未覆盖的来源、未找到的相反裁判或其他限制'),conclusion:wording('结合已核对裁判给出的结论，有可核对裁判时填写')};
const code = new Map(JSON.parse(fs.readFileSync(new URL('./civil/code.json',import.meta.url),'utf8')).map(a=>[a.number,a]));

function value(input,name,max=1800) {
  if(typeof input!=='string'||input.trim().length<2||input.length>max)throw Error('请核对'+name+'的内容和长度。');
  return input.trim();
}
function list(input,name,min=1,max=12) {
  if(!Array.isArray(input)||input.length<min||input.length>max)throw Error('请核对'+name+'的条数。');
  return input;
}
const lines = (input,name) => list(input,name).map(v=>value(v,name,500));
function cite(row,entries){
  return list(entries,'案卷引文',1,8).map(e=>{
    const s=row.packet.sources.find(item=>item.id===e?.sourceId);
    const quote=value(e?.quote,'材料原句');
    if(!s||!s.text.includes(quote))throw Error('摘引必须逐字出自本案已登记的材料。');
    return {sourceId:s.id,quote,label:s.locator,kind:s.kind};
  });
}
const cited = entries => entries.map(e=>[e.kind,e.label].filter(Boolean).join(' · ')+'「'+e.quote+'」').join('；');
function attachMethodReasons(out,review){
  if(!review?.items.length)return out;
  const reasons=review.items.map(m=>[m.title+'　'+m.placement,m.applicability,m.evidence,m.reason,m.effect,m.missing].filter(Boolean).join('　'));
  return {...out,markdown:out.markdown+'\n\n### 已查方法及其取舍\n\n'+reasons.join('\n\n')};
}
function bound(store,sid,args,mode){
  const row=store.get(sid);
  if(!row||row.packet.taskMode!==mode||row.packet.id!==args.caseId||row.revision!==args.reviewRevision)
    throw Error('请先打开对应类型的案件，并使用当前案件编号和材料修订号。');
  return row;
}
function recordConsult(row,args){
  const question=value(args.question,'咨询问题'),answer=value(args.answer,'总体答复');
  const nextSteps=lines(args.nextSteps,'后续行动');
  const issues=list(args.issues,'咨询争点',1,8).map(item=>{
    const facts=cite(row,item.facts);
    const articles=list(item.lawArticles??[],'民法典条号',0,12).map(n=>{
      const article=code.get(n);if(!article)throw Error('所引民法典条号超出本地收录范围。');
      return '《中华人民共和国民法典》'+article.label+'「'+article.text+'」';
    });
    const legalRefs=item.legalRefs?.length?cite(row,item.legalRefs):[];
    const law=[...articles,...legalRefs.map(e=>cited([e]))];
    const authorityLimit=item.authorityLimit?value(item.authorityLimit,'待核法源'):'';
    if(!law.length&&!authorityLimit)throw Error('请写明适用依据；尚未取得的，列明待核的法律依据。');
    return {question:value(item.question,'咨询争点'),answer:value(item.answer,'争点答复'),grounds:value(item.grounds,'依据'),
      exception:value(item.exception,'事实前提及抗辩'),facts,law,authorityLimit};
  });
  const markdown=['## 法律咨询意见',question,'**答复**　'+answer,...issues.map(it=>[
    '### '+it.question,it.answer,it.grounds,'已掌握的材料　'+cited(it.facts),it.law.length?'法律或约定依据　'+it.law.join('；'):'',
    it.authorityLimit?'待核依据　'+it.authorityLimit:'','可能改变判断的情形　'+it.exception].filter(Boolean).join('\n\n')),
    '### 下一步',nextSteps.map(s=>'- '+s).join('\n')].join('\n\n');
  return {revision:row.revision,question,answer,issues,nextSteps,markdown};
}
function makePlan(row,args){
  const plan={question:value(args.question,'检索争点'),facts:cite(row,args.facts),scope:value(args.scope,'检索范围'),
    queries:lines(args.queries,'检索词'),axes:lines(args.axes,'比较因素')};
  return {...plan,key:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),revision:row.revision};
}
function locatorFor(provider,raw){
  const id=provider.normalize(raw);
  if(typeof id!=='string'||!id.trim()||id.length>3000||/[\u0000-\u001f]/u.test(id))throw Error('裁判来源缺少可回查的文书出处。');
  return id;
}
function sourceDigest(page){
  return createHash('sha256').update(JSON.stringify([page.providerId,page.planKey,page.url,page.text])).digest('hex');
}
function rememberedPage(row,plan,provider,url){
  return (row.judgmentPages||[]).find(p=>p.planKey===plan.key&&p.providerId===provider.id&&
    (p.requested===url||p.url===url)&&p.text&&p.sourceDigest===sourceDigest(p));
}
function bindDocument(provider,retrieved,requested,planKey){
  if(retrieved?.kind!=='judgment-text'||typeof retrieved.text!=='string'||!retrieved.text.trim()||retrieved.text.length>200000)
    throw Error('该来源未返回可核对的裁判文书正文。');
  const page={providerId:provider.id,sourceName:provider.label,requested,planKey,url:locatorFor(provider,retrieved.locator),
    text:retrieved.text,fetchedAt:new Date().toISOString()};
  return {...page,sourceDigest:sourceDigest(page)};
}
function showPage(page,args){
  let start=args.offset??0;
  if(args.find){
    start=page.text.indexOf(value(args.find,'原文字词',100));
    if(start<0)return {markdown:'该文书中未找到所给字词。可继续按页阅读。'};
    start=Math.max(0,start-450);
  }
  if(!Number.isInteger(start)||start<0||start>=page.text.length)throw Error('原文读取位置超出范围。');
  const end=Math.min(start+6000,page.text.length);
  return {markdown:page.sourceName+'　'+page.url+'\n\n'+page.text.slice(start,end)+(end<page.text.length?'\n\n可用同一出处继续阅读，下一段 offset 为 '+end+'。':'')};
}
function verifiedCase(row,plan,input,provider){
  if(input.sourceId||!input.url)throw Error('案内材料的来源标签不能证明裁判真实性。请将案内引文放入 leads 待核，只有实际从接入来源取得的裁判原文可列入比较。');
  if(!provider)throw Error('尚未连接可核对裁判原文的来源。');
  const url=locatorFor(provider,input.url);
  const hit=rememberedPage(row,plan,provider,url);
  if(!hit?.text)throw Error('请先用本案的裁判原文读取工具取得该页面。');
  const court=value(input.court,'裁判法院',80),docket=value(input.docket,'完整案号',100);
  if(!/法院$/.test(court)||court.length<4||!/[（(〔]?\d{4}[）)〕]?[\u3400-\u9fff].*\d+号$/.test(docket))throw Error('请按裁判原文列明法院全称及完整案号。');
  const factQuote=value(input.factQuote,'裁判所认定的事实'),reasonQuote=value(input.reasonQuote,'裁判理由或结论');
  if(factQuote.length<5||reasonQuote.length<5||[court,docket,factQuote,reasonQuote].some(s=>!hit.text.includes(s)))
    throw Error('法院、案号、裁判事实和理由摘引须同时逐字见于选定的裁判材料。');
  if(!['支持','相反','区别适用'].includes(input.direction))throw Error('请核对本案与该裁判的方向。');
  return {court,docket,factQuote,reasonQuote,direction:input.direction,similarity:value(input.similarity,'相同点'),
    difference:value(input.difference,'不同点'),effect:value(input.effect,'裁判的可参考范围'),
    sourceLabel:hit.sourceName+'　'+hit.url,url:hit.url,providerId:hit.providerId,sourceDigest:hit.sourceDigest};
}
function compare(row,args,provider){
  const plan=row.researchPlan;
  if(!plan||plan.revision!==row.revision)throw Error('请先按当前案卷记录检索争点、范围与比对因素。');
  const searches=list(args.searches,'实际检索记录',0,25).map(s=>Object.fromEntries(Object.keys(searchLog).map(k=>[k,value(s[k],'检索工作记录',600)])));
  const leads=args.leads?.length?cite(row,args.leads):[];
  const limitations=value(args.limitation,'检索范围及证据限制');
  const cases=list(args.cases,'已核对的裁判',0,16).map(item=>verifiedCase(row,plan,item,provider));
  if(new Set(cases.map(c=>c.docket.normalize('NFKC').replace(/\s/g,''))).size!==cases.length)throw Error('同一案号只可计入一次。');
  const attempts=(row.judgmentPages||[]).filter(a=>a.planKey===plan.key&&a.providerId===provider?.id);
  const conclusion=cases.length?value(args.conclusion,'类案比较结论'):'本次未取得可逐项核对的裁判。现有材料不足以归纳法院立场。';
  const markdown=['## 类案检索意见',plan.question,'**检索结果**　'+conclusion,'检索范围　'+plan.scope,
    '比较的争点　'+plan.axes.join('、'),
    searches.length?'检索工作记录\n\n'+searches.map(s=>'- '+s.source+' · '+s.query+'　'+s.result).join('\n'):'本次未登记检索词执行结果。',
    ...(leads.length?['待核线索（未纳入裁判比较）',...leads.map(l=>l.label+'「'+l.quote+'」')]:[]),
    ...attempts.map(a=>a.text?'已读取　'+a.sourceName+'　'+a.url:'未取得裁判原文　'+a.requested+'　'+a.error),
    ...cases.map(c=>['### '+c.court+'　'+c.docket,'裁判事实　「'+c.factQuote+'」','裁判理由或结论　「'+c.reasonQuote+'」',
      '共同点　'+c.similarity,'区别　'+c.difference,'对本案的参考　'+c.direction+'。'+c.effect,c.sourceLabel].join('\n\n')),
    cases.length&&!cases.some(c=>c.direction==='相反')?'本次列入的裁判中没有相反结果。':'','检索局限　'+limitations].filter(Boolean).join('\n\n');
  return {revision:row.revision,planKey:plan.key,searches,leads,cases,limitations,conclusion,markdown};
}

export function workflowFor(mode){
  if(mode==='consult')return '法律咨询：从当事人陈述与已核实材料归纳法律关系、请求、抗辩和证据缺口。可用 civil_lookup_statute 核对民法典。调用 civil_consult_opinion，带当前 caseId、reviewRevision，传入 question、answer、issues、nextSteps。每个争点提供 question、answer、grounds、exception、facts（示例 [{"sourceId":"M1","quote":"本案材料的逐字原句"}]）和已核实的 lawArticles 或 legalRefs；法源待核填 authorityLimit。向委托人交付该工具返回的答复。';
  if(mode==='research')return '类案检索：带当前 caseId 和 reviewRevision 调用 civil_plan_case_search，提交 question、facts（sourceId 与原句 quote）、scope、queries、axes。随后使用实际可用的裁判检索服务，按正反方向检索；如用 web_search 只检索公开争点和术语。对命中文书调用 civil_fetch_judgment（url 填已接入来源可回查的文书出处）。调用 civil_compare_cases，searches 写实际 query/source/result，cases 填已读取的文书出处 url、court、docket、factQuote、reasonQuote、direction（支持/相反/区别适用）、similarity、difference、effect；另填 limitation，有可核对裁判时填 conclusion。案内摘录或自陈来源作为 leads（sourceId、quote）待核。未取得裁判原文就传空 cases 并说明检索覆盖与限制。';
  return '';
}
export function registerScenarioTools(ctx,{tool,session,store,judgmentProvider=null}){
  if(judgmentProvider&&(!/^[a-z][a-z0-9-]{1,79}$/.test(judgmentProvider.id)||!judgmentProvider.label?.trim()||
    typeof judgmentProvider.normalize!=='function'||typeof judgmentProvider.read!=='function'))throw Error('裁判来源须提供独立标识、名称、出处核对及正文读取方法。');
  const add=(name,description,properties,required,run)=>ctx.tools.register(tool(name,description,properties,['caseId','reviewRevision',...required],run));
  add('civil_consult_opinion','按当事人问题出具咨询答复，区分陈述、法源、抗辩与下一步。',opinionFields,['question','answer','issues','nextSteps'],(args,exec)=>{
    const sid=session(exec),row=bound(store,sid,args,'consult');
    const reviewed=methodReviewForDelivery(row);
    const out=attachMethodReasons(recordConsult(row,args),reviewed);
    store.put(sid,{...row,scenarioOutcome:out});return {markdown:out.markdown};
  });
  add('civil_plan_case_search','登记类案检索范围、正反方向和比较因素。随后实际使用可用检索来源获取原文。',planFields,['question','facts','scope','queries','axes'],(args,exec)=>{
    const sid=session(exec),row=bound(store,sid,args,'research'),plan=makePlan(row,args);
    store.put(sid,{...row,researchPlan:plan,scenarioOutcome:undefined});
    return {markdown:['**检索争点**　'+plan.question,'范围　'+plan.scope,'检索词　'+plan.queries.join('、'),'比较因素　'+plan.axes.join('、'),workflowFor('research')].join('\n\n')};
  });
  add('civil_fetch_judgment','向已接入来源读取裁判原文并保存在当前检索案。长文按段读，offset 为下段起点，也可用 find 定位裁判理由。',{...binding,url:wording('已接入来源可回查的裁判文书出处'),offset:{type:'integer',minimum:0},find:wording('文书中实际出现的短语')},['url'],async(args,exec)=>{
    const sid=session(exec),row=bound(store,sid,args,'research'),plan=row.researchPlan;
    if(!plan||plan.revision!==row.revision)throw Error('请按当前案卷登记检索争点和范围。');
    if(!judgmentProvider)return {markdown:'尚未连接裁判原文来源。可以记录检索计划与待核线索，当前无法核对裁判原文。'};
    const url=locatorFor(judgmentProvider,args.url),timeout=AbortSignal.timeout(15000);
    const cached=rememberedPage(row,plan,judgmentProvider,url);
    if(cached)return showPage(cached,args);
    const signal=exec.signal?AbortSignal.any([exec.signal,timeout]):timeout;
    let page;
    try{page=bindDocument(judgmentProvider,await judgmentProvider.read(url,{signal}),url,plan.key);}
    catch(err){if(exec.signal?.aborted)throw err;page={providerId:judgmentProvider.id,sourceName:judgmentProvider.label,error:'该来源未能提供可核对正文。'+String(err.message).slice(0,180)};}
    const latest=bound(store,sid,args,'research');
    if(latest.researchPlan?.key!==plan.key)throw Error('检索范围已更新，请重新核对本次读取的来源。');
    const pages=(latest.judgmentPages||[]).filter(p=>p.planKey!==plan.key||p.requested!==url||p.providerId!==judgmentProvider.id);
    if(pages.filter(p=>p.planKey===plan.key).length>=25)throw Error('每份检索计划最多保留25个公开文书链接，请收窄检索范围。');
    pages.push({...page,requested:url,planKey:plan.key});
    store.put(sid,{...latest,judgmentPages:pages,scenarioOutcome:undefined});
    return page.error?{markdown:page.error}:showPage(page,args);
  });
  add('civil_compare_cases','逐案核对法院、案号、事实与裁判理由，区分相同与相反裁判；没有原文时仅交付已检索范围及局限。',researchFields,['searches','cases','limitation'],(args,exec)=>{
    const sid=session(exec),row=bound(store,sid,args,'research');
    const reviewed=methodReviewForDelivery(row);
    const out=attachMethodReasons(compare(row,args,judgmentProvider),reviewed);
    store.put(sid,{...row,scenarioOutcome:out});return {markdown:out.markdown};
  });
}
