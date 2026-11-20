
import { gateLabels } from './case-process.mjs';

const uniq=ids=>[...new Set(ids.filter(Boolean))];
const get=(result,id)=>result.process.flatMap(s=>s.items).find(x=>x.id===id);
const find=(result,stage,expr)=>result.process.find(x=>x.id===stage)?.items.find(x=>expr.test(x.title));
const ids=(...parts)=>uniq(parts.flatMap(x=>x?.refs||[]));
const note=x=>x?[x.why,...x.basis].join(' '):'按本次材料核对适用条件。';
const question=(id,title,answer,body)=>({id,question:title,answer,...body,refs:uniq(body.refs||[])});

function paymentCase(r,action) {
  const payment=r.installments.find(x=>x.gates.includes('receipt')||x.gates.includes('delivery'))||r.installments[0];
  if(!payment||!action)return null;
  const paymentNumber=r.installments.indexOf(payment)+1;
  const reviewed=get(r,'payment-'+paymentNumber);
  const purchaseRule=find(r,'knowledge',/付款约定/);
  const risk=find(r,'knowledge',/验收条款/);
  const quantity=find(r,'knowledge',/数量验收/);
  const claim=get(r,'claim-payment');
  const defense=get(r,'claim-defense');
  const tookAcceptance=payment.gates.includes('acceptance');
  const timing=payment.gates.map(g=>gateLabels[g]||g).join('与');
  const period=payment.delayDays?payment.delayDays+(payment.workingDays?'个工作日':'天'):'合同约定期间';
  const linked=get(r,'acceptance-required')||get(r,'acceptance-unlinked');
  const invoice=get(r,'invoice-exception');
  const whenQuestion=payment.connectors==='all'?'当前付款条款要求哪些条件先满足？':'当前付款条款怎样组合触发条件？';
  const whenAnswer=payment.connectors==='all'?timing+'满足后，按约定计算'+period+'。':note(reviewed);

  const questions=[
    question('payment-trigger',whenQuestion,whenAnswer,{
      business:purchaseRule?.why||'先定位合同中的这一笔付款和对应交易材料。',
      law:note(claim),
      choice:'按合同所示的这笔价款确定起算条件。签前先确认条件与期间，后续履行时再填入实际日期。',
      needed:'核对正式付款条款及适用附件。履约时回收各项触发凭证和日期。',
      refs:ids(purchaseRule,reviewed,claim)
    })
  ];
  if(risk||tookAcceptance)questions.push(question('payment-inspection','验收约定在这里解决什么问题？',
    tookAcceptance?'所选付款条款直接引用验收。单独的验收标准与凭证条款也需要核对。':
      risk?.why||'验收条件与付款的关联需要从合同中核实。',{
    business:[risk?.why,quantity?.why].filter(Boolean).join(' ')||'按当前合同材料定位要求。',
    law:note(linked),
    choice:tookAcceptance?'把验收纳入这笔付款的触发项，再查标准、时限和签署人。':'区分风险转移、数量验收和付款起算。要把验收纳入付款条件，需找到对应关联约定。',
    needed:'核对完整的验收标准、付款条款、有效附件与优先顺序。',
    refs:ids(risk,quantity,linked,reviewed)
  }));
  if(defense)questions.push(question('payment-defense','买方能否等到验收完成再付款？',
    tookAcceptance?'按已阅条款，买方可以要求先核验验收条件是否满足。能否暂缓以及范围还要结合履行事实。':
      '仅凭已有摘片，暂缓支付的依据还需核实。供应商可能按写明的付款条件主张起算。',{
    business:'确认采购方想让哪项业务凭证控制付款，并检查这项要求有没有落进合同。',
    law:note(defense),
    choice:tookAcceptance?'按约定的先后履行检查该笔价款及争议范围。':'当前保留两种结果。若有效附件把验收设为付款条件，重新判断；若按现稿付款安排，先处理起算争议。',
    needed:'补对验收与付款关系有明示约定的条款或有效附件。履约时补交付、验收与发票状态。',
    refs:ids(defense,linked,reviewed)
  }));
  if(invoice)questions.push(question('payment-invoice','变更开票信息时，什么时候可能顺延？',
    '合同约定了一条特定顺延路径，需核实财务信息变更及退票、补开的经过。',{
    business:'把卖方信息变更和常见的票据迟到分开核对，留存变更审批和开票记录。',
    law:note(invoice),
    choice:'已有约定支持针对信息变更核对顺延。查清变更是否影响发票记载和相应期间后，再判断该约定能否适用。',
    needed:'卖方信息变更记录、退回及重新开票凭证、合同约定的相关通知与时间。',
    refs:ids(invoice)
  }));
  const scenario=payment.gates.includes('receipt')&&payment.gates.includes('invoice')?'货和票已到':'约定的付款触发项已满足';
  return {id:'payment',label:'付款与验收',question:tookAcceptance?'验收条件怎样影响这笔价款？':scenario+'，但验收未完成，付款期限会先起算吗？',
    answer:tookAcceptance?'现有付款条款把验收列为触发条件。签前确认标准、证据和期限。':
      '按现有摘片，供应商可能以'+timing+'主张起算。签前先确认是否还要以验收合格为条件，并将业务决定落实到有效条款。',
    refs:uniq([...action.refs,...ids(reviewed,linked)]),questions,action,
    material:'完整付款条款、适用附件与补充协议。'
  };
}

function deliveryCase(r,action) {
  const priority=find(r,'knowledge',/交货依据及版本/);
  const evidence=find(r,'knowledge',/交货文件/);
  const quantity=find(r,'knowledge',/数量验收/);
  const claim=get(r,'claim-delivery');
  const deferred=get(r,'choice-date');
  if(!action||!priority||!claim)return null;
  const related=r.sources.filter(s=>priority.refs.includes(s.id));
  const document=related.map(s=>s.text.match(/(?:内向)?交货单|送货通知|采购订单/)?.[0]).find(Boolean)||'合同指定的交货凭证';
  const date=related.find(s=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s.text.trim()))?.text.trim();
  const questions=[
    question('delivery-date','合同里的提取日期能确定应交时间吗？',
      (date?'已提取日期 '+date+'。':'')+'按正文指定的'+document+'核对要求到货时间。',{ 
       business:priority.why+' 采购签订与交货先后检查需要先确认各日期来自哪份业务材料。',law:note(claim),
       choice:deferred?.why||'区分交货计划、约定时点和实际履行。',
       needed:'补同一交易当前有效的交货单，核对编号、版本、订单范围和通知记录。',
       refs:ids(priority,claim,deferred)
    }),
    question('delivery-proof','怎样验证后续是否按约交货？',
      '先确认应交时点，再核对实际交付记录、交货文件和对应数量。',{
       business:[evidence?.why,quantity?.why].filter(Boolean).join(' ')||'用实际业务文件复核交付及凭证。',
       law:note(claim),
       choice:'交货单提供应交依据。签收与验收材料支持实际履行判断，需要对应同一订单和范围。',
       needed:'履约时回收送货记录、签收与验收资料，以及按合同应提供的交货文件。',
       refs:ids(priority,claim,evidence,quantity)
    })
  ];
  return {id:'delivery',label:'交货与凭证',question:'卖方究竟应按哪份材料、哪个时间交货？',
    answer:'合同将要求到货时间指向'+document+'。签前取得同一订单的有效版本，并明确通知及效力顺序。',
    refs:uniq(action.refs),questions,action,material:'当前有效的交货单及其送达依据。'
  };
}

function fallbackCase(action,i) {
  return {id:'review-'+(i+1),label:action.title,question:'签约前怎样处理「'+action.title+'」？',
    answer:action.action, refs:uniq(action.refs),action,questions:[question('support-'+(i+1),'是什么材料支持这项判断？',action.why,{
      business:'从当前业务材料核对问题的适用范围。',
      law:'根据该事项对应的有效约定及适用规范复核。',
      choice:action.action,needed:'依报告内列明的待核点补足材料。',refs:action.refs
    })]};
}

function agentCase(record,action,i) {
  const linked=record.steps.find(s=>s.id===action.anchor);
  if(!linked)return fallbackCase(action,i);
  const relevant=record.steps.filter(s=>s.id===linked.id||s.evidence.some(e=>action.refs.includes(e.sourceId)));
  const conditions=relevant.filter(s=>s.kind==='knowledge');
  const lawSteps=relevant.filter(s=>s.kind==='claims');
  const questions=relevant.map((s,n)=>question('agent-q-'+(i+1)+'-'+(n+1),
    s.title.endsWith('？')?s.title:'如何理解「'+s.title+'」？',s.decision,{
      business:s.kind==='knowledge'?s.reason:conditions.map(x=>x.reason).join(' ')||'请核对本案已列示的业务原因。',
      law:s.kind==='claims'?[s.reason,...s.basis].join(' '):lawSteps.map(x=>[x.reason,...x.basis].join(' ')).join(' ')||s.basis.join(' ')||'法律判断以本案已列示的关联依据为准。',
      choice:[s.reason,...s.alternatives].join(' '),
      needed:'复核本步骤引用的原文、时点和材料范围。',
      refs:s.evidence.map(e=>e.sourceId)
    }));
  return {id:'agent-'+(i+1),label:action.title,question:'签约前怎样处理「'+action.title+'」？',
    answer:action.action, refs:uniq(action.refs),action,questions};
}

export function buildQuestionDossier(result) {
  const record=result.agentRecord;
  const selected=record?.opinion?.actions||result.actions;
  const special=record?.opinion?[]:[
    paymentCase(result,selected.find(a=>a.id==='action-acceptance')),
    deliveryCase(result,selected.find(a=>a.id==='action-delivery'))
  ].filter(Boolean);
  const used=new Set(special.map(t=>t.action.id));
  const cases=record?.opinion?selected.map((a,i)=>agentCase(record,a,i)):
    [...special,...selected.filter(a=>!used.has(a.id)).map(fallbackCase)];
  const both=special.some(t=>t.id==='payment')&&special.some(t=>t.id==='delivery');
  const context=result.process.find(x=>x.id==='intake')?.items[0];
  return {
    question:both?'按现稿签约前，付款起算与交货依据还需确定什么？':'依据当前材料，签约前有哪些事项需要确认或处理？',
    answer:record?.opinion?.summary||(both?'先确认验收是否影响付款起算，再核定有效交货单。':cases.length?'按专题处理下列签前核对、补件或改约事项。':'先核实当前事项和材料适用范围。'),
    context:context?.why||'请结合所列交易材料和本次审查立场阅读。',
    refs:context?.refs||[],
    cases
  };
}

