
export const gateLabels = {
  signature:'合同签订或生效', receipt:'货物到达', acceptance:'按约验收',
  invoice:'收到约定发票', delivery:'完成约定交付'
};

const item = (title,status,why,refs=[],basis=[],id='')=>({title,status,why,refs:[...new Set(refs.filter(Boolean))],basis,id});
const stage=(id,title,lead,items)=>({id,title,lead,items});
const supports=(source,re)=>re.test(source.text);
const bodyOf=sources=>sources.filter(s=>/正文|条款|当前合同/.test(s.kind));
const orderTerm=/以.{1,70}(?:交货单|送货通知|采购订单).{0,45}(?:为准|日期)/;
const priceLaw='《民法典》第626条、第628条及合同付款条款';
const deliveryLaw='《民法典》第598条、第601条及合同交货条款';
const defenseLaw='《民法典》第526条，须结合先后履行顺序及未履行范围';
const inspectionLaw='《民法典》第620至623条及合同验收条款';
const terminationLaw='《民法典》第563条、第565至566条及合同相关约定';

export function buildProcess(packet,result) {
  const sources=result.sources;
  const body=bodyOf(sources);
  const payments=result.installments;
  const formScene=sources.find(s=>s.kind==='表单'&&supports(s,/采购|销售|建设|运输/));
  const formPayment=sources.find(s=>s.kind==='表单'&&supports(s,/货到|到货|发票|货款|电汇|银行转账|支票|付款/));
  const contractPriority=body.find(s=>supports(s,orderTerm));
  const delivery=contractPriority||body.find(s=>supports(s,/交货|交付/));
  const dates=body.find(s=>/交货时间|交付日期/.test(s.locator));
  const inspection=body.find(s=>supports(s,/验收/)&&!/支付|付款条件/.test(s.text));
  const deliveryPapers=body.find(s=>supports(s,/交货文件/));
  const quantityInspection=body.find(s=>supports(s,/数量验收|实际收货数量/));
  const invoiceChange=body.find(s=>supports(s,/发票/)&&supports(s,/付款期限顺延|顺延合同的付款期限/)&&supports(s,/重新开具/));
  const termination=body.find(s=>supports(s,/解除|终止/));
  const payment=payments.find(x=>x.gates.includes('receipt')||x.gates.includes('delivery'))||payments[0];
  const sourceOfPayment=payment&&sources.find(s=>s.id===payment.sourceId);
  const branchFindings=result.findings.filter(f=>!f.id.startsWith('payment-')&&f.id!=='scope');
  const tableBind=contractPriority&&result.findings.find(f=>f.id==='schedule-priority');
  const main=payment?.sourceId||body[0]?.id||sources[0]?.id;
  const allPayment=payments.map(p=>p.sourceId);
  const inScope=!result.findings.some(x=>x.id==='scope');
  const accepted=payments.some(b=>b.gates.includes('acceptance'));
  const visibleUse=result.ontology&&inScope;
  const normalized=s=>s?.replace(/\s|：|:|。/g,'')||'';
  const agreeingForm=formPayment&&payment&&normalized(formPayment.text).includes(normalized(payment.quote));

  const identity=[item(
    packet.businessKind||packet.scene, inScope?'已进入本流程':'适用性待核',
    (formScene?'表单给出的业务路径为「'+formScene.text+'」。':'业务场景来自本次案件输入。')+
    '以'+packet.stance+'立场，在'+packet.stage+'时点推演签约后的法律关系。', [formScene?.id||main]
  )];
  if (contractPriority) identity.push(item('区分交货计划与约定时点','定位到条款',
    (/预估/.test(contractPriority.text)?'正文把表内日期标为预估，并指向买方下达的交货单。':'正文指定了用于确认交货时点的文件。')+'需把计划时点、订单要求时点、实际交付分别记录。',[dates?.id,contractPriority.id]));

  const knowledge=[];
  if(payment&&formPayment) knowledge.push(item('付款约定与提报表单','已对照',
    agreeingForm?'表单和选中的正文付款表述一致。继续核对付款触发，以正文及适用附件作为权利义务判断依据。':'核对到表单与正文均有付款信息。文本是否同义、哪一份具有约定效力，需逐项确认。',
    [formPayment.id,sourceOfPayment.id],['付款条件核对','采购付款审查业务口径'] ));
  if(inspection) knowledge.push(item('验收条款的功能','已定位',
    supports(inspection,/转移/)?
      '这一处验收条件与转移时间关联。付款条件是否也受验收约束，要看付款条款或其他有效约定的连接。':
      '验收条款提供履行证据与质量检查的依据。另查付款条款是否将验收设为触发条件。',
    [inspection.id,payment?.sourceId],['交付、验收与付款的分别核对']));
  if(delivery) knowledge.push(item('交货依据及版本',tableBind?'已采用':contractPriority?'发现优先约定':'已定位',
    tableBind?'本次回放应用了交货凭证优先关系，先取合同点名的有效交货单，再核对实际履行。':
    contractPriority?'正文已经指出交货单的作用。正式审查口径及适用交货单还需核实。':'交货条款提供合同时间参照，实际履行由交付记录证明。',
    [dates?.id,delivery.id], [tableBind?'交货凭证优先关系（本次运行版本）':'合同的交货约定'] ));
  if(deliveryPapers) knowledge.push(item('交货文件用于核对履行','已定位','区分合同要求的交货地点、交货文件与实际收货记录。需要根据供应类型逐项核实应提供的文件。',[deliveryPapers.id,delivery?.id],['交货条款']));
  if(quantityInspection) knowledge.push(item('数量验收用于核对收货量','已定位','数量验收条款解决到货数量和约定损耗。质量标准、异议及付款相关验收条件仍要按对应条款核对。',[quantityInspection.id,inspection?.id],['数量验收条款']));
  if(!knowledge.length) knowledge.push(item('业务条件与来源','材料待核','当前材料不足以交叉核对表单、条款和履行文件。',[main]));

  const claims=[];
  if(payment) claims.push(item('供应商向采购方请求支付价款',visibleUse?'采用':'定位到条款',
    '按每笔价款的约定识别义务与起算条件。签约前，实际触发事件保留为条件。',allPayment,visibleUse?[priceLaw]:[],'claim-payment'));
  if(delivery) claims.push(item('采购方向供应商请求按约交货',visibleUse?'相关路径':'待分析',
    '交付时点、范围及凭证能影响迟延判断和付款推演。按合同与对应订单逐项核对。',[delivery.id],visibleUse?[deliveryLaw]:[],'claim-delivery'));
  if(payment&&visibleUse) claims.push(item('采购方的先履行抗辩','待事实触发',
    '需要核清合同约定的履行先后、对方未履行的是什么以及能拒绝到什么范围。缺少到货、到票或验收的证据时，先确认条件是否具备。',[payment.sourceId,inspection?.id,invoiceChange?.id],[defenseLaw],'claim-defense'));
  if(termination&&visibleUse) claims.push(item('解除权及解除后的返还、结算','待事实触发',
    '先核到期、违约、催告或约定条件以及行使，再判断已履行和未履行部分的效果。',[termination.id],[terminationLaw],'claim-termination'));
  if(!claims.length) claims.push(item('候选请求权','材料待核','先补能够证明约定内容、义务主体和触发条件的条款。',[main]));

  const reasoning=payments.map((p,i)=>{
    let why='从本笔付款条款取得触发项「'+p.gates.map(g=>gateLabels[g]||g).join('、')+'」。';
    if(visibleUse){
      if(p.connectors==='unresolved') why+='并列、任选分组含义尚不明确，需要查全文。';
      else if(p.connectors==='all'&&p.gates.length>1) why+='这些事件在该条款里共同触发付款'+(p.delayDays?'，最后一个条件满足后开始计算'+p.delayDays+(p.workingDays?'个工作日':'日'):'')+'。';
      else if(p.connectors==='any') why+='条款出现任选结构，具体适用条件需按条款核对。';
      why+=p.conclusion==='ready'?'本次回放输入将触发项列为已证。':'本次只推演签后的条件关系，实际履行证据待补。';
    }
    return item('第 '+(i+1)+' 笔付款如何起算',p.conclusion==='ready'?'已进入计算':'条件推演',why,[p.sourceId],visibleUse?[priceLaw]:[],'payment-'+(i+1));
  });
  if(visibleUse&&inspection&&payment) reasoning.push(item(accepted?'验收与付款已出现明确连接':'验收是否改变付款时点',accepted?'有付款文字依据':'关联待核',
    accepted?'付款条款直接把验收列为触发项。验收标准、凭证及异议规则进入该笔价款审查。':'正文付款依据列出的触发项和验收条款分处两处。检查全文、补充协议与优先顺序后，再决定是否将验收带入付款路径。',
    [inspection.id,payment.sourceId],[inspectionLaw],accepted?'acceptance-required':'acceptance-unlinked'));
  if(invoiceChange&&visibleUse) reasoning.push(item('开票信息变更如何影响付款期限','条件推演','约定对卖方变更财务信息、原发票退回和重新开具设置了专门的付款顺延安排。要先核实变更事项是否影响发票记载、是否已补开，以及相应期间。',[invoiceChange.id,payment?.sourceId],['合同约定的顺延条件'],'invoice-exception'));
  if(!reasoning.length) reasoning.push(item('付款触发','材料待核','待补付款条件或有效付款附件。',[main]));

  const choices=[];
  if(inspection&&payment&&visibleUse) choices.push(item('把验收直接当作付款开关',accepted?'采用':'保留为待核',
    accepted?'付款条款文字直接支持验收是该笔价款的条件。':'现有付款摘片未显示验收这项条件。另一处验收有自己的作用，需核查有无有效文件把两条约定连起来。',
    [payment.sourceId,inspection.id],[],'choice-acceptance'));
  if(contractPriority&&visibleUse) choices.push(item('用提取日期判断供应商已迟延','暂缓',
    '提取日期和有效交货单可能指向不同日期。迟延还需要确定应交时间和实际交付证据。',[dates?.id,contractPriority.id],[],'choice-date'));
  if(!termination&&visibleUse&&payment) choices.push(item('直接给出解除或返还结论','暂缓',
    '当前为签前审查。需要先确认相关约定、解除条件、行使和付款履行事实。',[payment.sourceId],[terminationLaw],'choice-termination'));
  if(quantityInspection&&inspection&&visibleUse) choices.push(item('把数量签收视为全部验收','暂缓','当前数量验收条款只支持收货量核对。质量验收及其法律后果仍需对应标准和异议程序。',[quantityInspection.id,inspection.id],[inspectionLaw],'choice-quantity'));
  if(!choices.length) choices.push(item('形成确定的签前意见','保留待核','确认材料版本及适用业务口径。',[main]));

  const process = [
    stage('intake','确认合同与审查立场','先定这笔业务是什么，再决定后续分析适用的知识和范围。',identity),
    stage('knowledge','定位本案用到的业务知识','将提报口径、合同约定和实际业务凭证各自对应到要判断的问题。',knowledge),
    stage('claims','列出请求权、抗辩与解除路径','围绕双方未来可以提出的法律主张，写明哪些已进入判断、哪些等待前提。',claims),
    stage('reasoning','从证据推到当前判断','逐项说明材料支持什么关系，条件变化会影响哪一条结论。',reasoning),
    stage('choices','记录取舍与改判条件','把暂缓采用的推断和缺少的决定性材料留在案件里。',choices)
  ];
  const actions=[];
  if(visibleUse&&payment&&inspection&&!accepted){
    actions.push({id:'action-acceptance',priority:'签前确认',title:'明确验收是否控制付款起算',
      why:'按现有付款摘片，供应商可能主张付款按「'+payment.gates.map(g=>gateLabels[g]||g).join('、')+'」等约定条件起算。验收条款与付款条款的适用关系还需核实。',
      action:'若采购方要求验收合格才起算，将该条件写入付款义务，约定验收标准、凭证和异议时限。',
      drafting:payment.connectors==='all'?'若业务确认采用验收作为支付条件：买方在'+[...payment.gates.map(g=>gateLabels[g]||g),'按合同约定验收合格'].join('、')+'等条件均满足后，按原约定的'+(payment.delayDays?payment.delayDays+(payment.workingDays?'个工作日':'天'):'付款')+'期限支付该笔价款。':undefined,
      refs:[payment.sourceId,inspection.id],step:'reasoning'});
  }else if(visibleUse&&accepted){
    actions.push({id:'action-acceptance',priority:'签前核对',title:'落实验收标准与合格凭证',
      why:'付款条件直接引用验收。',action:'确认验收主体、标准、异议期限以及有效的验收凭证。',
      refs:[...new Set([...payments.filter(b=>b.gates.includes('acceptance')).map(b=>b.sourceId),inspection?.id].filter(Boolean))],step:'reasoning'});
  }
  if(visibleUse&&contractPriority){
    actions.push({id:'action-delivery',priority:'待补材料',title:'取得合同点名的交货单',
      why:'正文将交货日期连到买方下达的交货单，当前摘片提供的是正文约定及提取日期。',
      action:'签前明确交货单的编号、版本、通知方式和与合同的效力顺序。履约时分别回收交付、验收和发票凭证。',
      refs:[dates?.id,contractPriority.id,deliveryPapers?.id].filter(Boolean),step:'knowledge'});
  }
  if(!actions.length){
    for(const f of branchFindings) actions.push({id:f.id,priority:'待核对',title:f.title,why:f.method,action:f.judgment,refs:f.refs,step:'reasoning'});
  }
  return {process,actions};
}

