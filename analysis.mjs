import { buildProcess } from './case-process.mjs';
export { makeReport } from './report-view.mjs';

const triggers = [
  ['signature', /合同签订|合同签署|签订后|签署后|合同生效|合同成立/],
  ['receipt', /货到|到货|收货|货物送达/],
  ['acceptance', /验收(?:合格|通过)?/],
  ['invoice', /发票(?:到|开具|送达)?|票到/],
  ['delivery', /交[付货](?:完成|后)|完成交[付货]/]
];
const policy = [
  { id:'PROC-SETTLEMENT', summary:'按适用的起草类型核对选定的结算方式、强制或可选方式及其附加条件。' },
  { id:'PROC-DELIVERY', summary:'采购业务按合同创建日比较正文当前适用交货计划。计划交货日均晚于创建日方通过，实际履行按有效交易文件另核。' },
  { id:'CONTROL-APPROVAL', summary:'核对合同是否落实适用审批的交易条件，保留变更记录和例外依据。' }
];
const procurementRules = {
  version:'v1',
  relations:[
    {id:'payment-trigger', terms:['出卖人','买方','价款请求','履行时点'], basis:'民法典第626条、第628条及合同约定', rule:'按每笔价款核对约定触发条件。并列触发事件共同决定起算时点。', evidence:['A/付款条件','B/付款条件','C/付款条件']},
    {id:'receipt-vs-acceptance', terms:['签收','质量检验','验收','异议'], basis:'民法典第620至623条及合同约定', rule:'分别核对到货、验收及支付条件的约定和证据。', evidence:['A/付款条款','B/验收条款及付款条件']},
    {id:'prior-performance', terms:['先后履行','先履行抗辩','相应拒绝'], basis:'民法典第526条', rule:'核对双方义务、履行顺序和未履行范围。', evidence:['A/付款条件','B/付款条件']},
    {id:'changing-relationship', terms:['解除权','行使','返还及结算'], basis:'民法典第563条、第565至566条', rule:'按解除条件和行使情况推导终止、返还及结算的范围。', evidence:['采购 PROC-TERMINATION 提供解除业务场景，当前真实案例对解除后果覆盖有限']}
  ]
};
function validate(packet) {
  if (!packet || !/^[\p{L}\p{N}-]{1,80}$/u.test(packet.id||'')) throw Error('案件 ID 无效');
  if (![packet.scene,packet.stance,packet.stage].every(x=>typeof x==='string'&&x.trim())) throw Error('需要场景、立场和时点');
  if (!Array.isArray(packet.sources)||!packet.sources.length||packet.sources.length>48) throw Error('需要 1 至 48 个来源');
  const ids=new Set();
  for (const s of packet.sources) {
    if (!s||!/^[A-Za-z0-9-]{1,40}$/.test(s.id)||ids.has(s.id)||![s.kind,s.locator,s.text].every(t=>typeof t==='string'&&t.trim())||s.text.length>20000) throw Error('来源需要唯一编号、类型、位置及原文');
    ids.add(s.id);
  }
}
function branchesOf(sources) {
  const found=new Map();
  for (const source of sources) {
    const clauses=source.text.split(/[，,；;。\n]/);
    let carry='';
    for (const raw of clauses) {
      const text=raw.trim();
      const isGate=triggers.some(([,re])=>re.test(text));
      if(isGate && !/支付|付款|结算/.test(text) && /后|且|并|和|同时/.test(text)){carry=text;continue;}
      if (!/支付|付款|结算/.test(text) || /付款期限|提前付款|补充协议|更改账户|付款方式|不得支付|不支付|推迟支付/.test(text)){carry='';continue;}
      const quote=carry?carry+'，'+text:text;
      carry='';
      const gates=triggers.filter(([,re])=>re.test(quote)).map(([k])=>k);
      if (!gates.length) continue;
      const key=quote.replace(/\s/g,'');
      const disjunction=/或(?!者不)|任一/.test(quote);
      const conjunction=/且|同时|以及|并且/.test(quote);
      const connectors=disjunction?(conjunction||gates.length<2?'unresolved':'any'):'all';
      if (!found.has(key)) found.set(key, {
        quote, sourceId:source.id,gates,connectors,
        delayDays:Number(quote.match(/(?:后|内)\s*(\d{1,3})\s*(?:个工作)?[天日]/)?.[1]||0),
        workingDays:/工作日|工作天/.test(quote)
      });
    }
  }
  return [...found.values()];
}
export function analyzeCase(packet,{ontology:enabled=true,useRules=[],version='v1'}={}) {
  validate(packet);
  const sources=packet.sources.map(s=>({...s}));
  if(packet.reviewScope==='general'){
    const policies=sources.filter(s=>/审计规则|制度|审批规则|授权规则/.test(s.kind)).map(s=>({id:s.id,summary:s.text}));
    return {id:packet.id,scene:packet.scene,stance:packet.stance,stage:packet.stage,businessKind:packet.businessKind,sourceBoundary:packet.sourceBoundary,reviewScope:'general',version,ontology:enabled,sources,policy:policies,installments:[],findings:[],process:[],actions:[]};
  }
  const findings=[];
  const add=(id,title,method,judgment,refs,basis=[])=>{
    if(!refs.length||refs.some(id=>!sources.some(s=>s.id===id))) throw Error('判断需要证据位置');
    findings.push({id,title,method,judgment,refs:[...new Set(refs)],basis});
  };
  const body=sources.filter(s=>/正文|条款|当前合同/.test(s.kind));
  const inScope=packet.scene==='采购业务'&&packet.stage==='签约前'&&packet.stance==='买方';
  const clauses=body.filter(x=>/验收/.test(x.text)&&!/支付|付款条件/.test(x.text));
  const installments=(inScope?branchesOf(body):[]).map(b=>{
    const values=b.gates.map(g=>packet.confirmedFacts?.[g]);
    const proven=b.connectors==='any'?values.some(x=>x===true):values.every(x=>x===true);
    return {...b,conclusion:b.connectors==='unresolved'?'pending':proven?'ready':'conditional'};
  });
  if(!inScope) add('scope','适用场景','核对事项类型、立场和审查时点','当前事项超出采购买方签前版本适用范围，请核对场景。',[sources[0].id]);
  if(!body.length) add('contract-missing','合同条款待补','定位当前合同','请补充当前合同正文或有定位的条款。',[sources[0].id]);
  if(inScope&&body.length&&!installments.length) add('terms-unknown','付款条件待核','识别有证据的分期付款条件','片段未给出可可靠解析的付款条件，请查看完整正文和合同组成。',[body[0].id]);
  for(const [i,b] of installments.entries()){
    const timing=b.conclusion==='pending'?'触发条件存在组合含义待核。':b.conclusion==='ready'?'所列事件在本次输入中为已证。':'按签约后的条件进行推演，实际履行状态待证。';
    add('payment-'+(i+1),'付款安排 '+(i+1),'逐笔定位付款条件和期间', '条款为“'+b.quote+'”。'+(enabled?timing:''),[b.sourceId],enabled?[procurementRules.relations[0].basis]:[]);
    if(b.connectors==='unresolved') add('payment-conditions-unclear-'+(i+1),'付款触发关系待核','逐项拆解并列与任选条件','复核该笔付款条件的分组和优先条款。',[b.sourceId]);
    if(enabled&&b.gates.length>1&&b.connectors==='all') add('joint-'+(i+1),'付款时点受多项条件共同约束','逐项核对签收、发票或验收等证据',
      '最后一个并列条件满足才进入约定付款期间。'+(b.delayDays?'按条款核算 '+b.delayDays+(b.workingDays?' 个工作日。':' 日。'):'请核对约定期间。'),[b.sourceId],[procurementRules.relations[0].basis]);
  }
  if(enabled&&inScope){
    const acceptance=installments.find(x=>x.gates.includes('acceptance'));
    const receipt=installments.find(x=>x.gates.includes('receipt')||x.gates.includes('delivery'));
    if(acceptance) add('acceptance-required','验收合格为付款条件','分别定位交付、验收及付款，检查期限、标准、签署凭证和异议',
      '签前明确何种证据能够确认验收合格。签收证据只按条款约定或适用法律验证其效力。若考虑拒付，逐笔核对履行顺序与相应范围。',[acceptance.sourceId,...clauses.map(x=>x.id)],['合同约定','民法典第526条、第620至623条']);
    else if(clauses.length&&receipt) add('acceptance-unlinked','验收条款与付款触发衔接','比较付款和独立验收条款，检查交叉引用及文件效力',
      '所示付款条件以交货相关事由为主，另见独立验收。先核对全文有无把它们关联；如采购方要以验收控制付款，签前补清条件、异议期限及签署凭证。',[receipt.sourceId,clauses[0].id],[procurementRules.relations[1].basis]);
    const term=body.find(s=>/解除|终止/.test(s.text));
    if(term) add('termination','解除及财务后果','识别解除条件、履行状态和通知条款',
      '按解除条件与行使时点推演已付款返还、未付价款及结算或责任。阅件不足时保留待核。',[term.id],[procurementRules.relations[3].basis]);
    const precedence=body.find(s=>/以.{1,70}(?:交货单|送货通知|采购订单).{0,45}(?:为准|日期)/.test(s.text));
    if(precedence&&useRules.includes('schedule-document-priority')){
      const orders=sources.filter(s=>s.kind==='交货单');
      add('schedule-priority','交货触发所依据的凭证','按合同优先约定配对订单及交货单',
        orders.length?'核对交货单、对应订单、通知及实质履行。':'补取合同明确指定的交货单及版本，草稿日期仅保留为预估。',[precedence.id,...orders.map(s=>s.id)],['合同交货约定']);
    }
  }
  const result={id:packet.id,scene:packet.scene,stance:packet.stance,stage:packet.stage,businessKind:packet.businessKind,sourceBoundary:packet.sourceBoundary,version,ontology:enabled,sources,policy,installments,findings};
  return {...result,...buildProcess(packet,result)};
}
export function resolveCorrection(packet,correction) {
  const {type,field,value,reason,sourceId,quote}=correction||{};
  if(typeof reason!=='string'||!reason.trim()) throw Error('纠正需要记录理由');
  if(type==='fact'){
    if(!triggers.some(([k])=>k===field)||typeof value!=='boolean') throw Error('事实纠正项或值无效');
    const proposed={...packet,confirmedFacts:{...packet.confirmedFacts,[field]:value}};
    const source=packet.sources.find(s=>s.id===sourceId);
    const anchors=typeof quote==='string'&&quote.length>=5&&source?.text.includes(quote);
    return {state:'hypothetical',updated:packet,proposed,reference:anchors?source.id:null,reason};
  }
  if(type==='method'&&(packet.taskMode??'contract')==='contract'&&correction.rule==='schedule-document-priority') {
    const source=packet.sources.find(s=>s.id===sourceId);
    if(source?.text.includes(quote)&&typeof quote==='string'&&/以.{1,70}(?:交货单|送货通知|采购订单).{0,45}(?:为准|日期)/.test(quote))
      return {state:'applied-to-case',updated:packet,proposed:packet,additionalRules:[correction.rule],reference:sourceId,reason};
  }
  if(type==='method'||type==='judgment') return {state:'recorded',updated:packet,proposed:packet,reference:sourceId||null,reason};
  throw Error('请选择事实、方法或判断纠正');
}
