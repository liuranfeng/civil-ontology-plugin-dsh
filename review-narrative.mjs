import {internalText} from './counsel-view.mjs';
import {basisOf} from './method-accountability.mjs';

const wording=description=>({type:'string',description});
const evidence={
  type:'array',minItems:1,maxItems:6,
  items:{type:'object',additionalProperties:false,required:['sourceId','quote'],properties:{
    sourceId:wording('本案已登记的材料编号。'),quote:wording('从该材料复制能够支持这项判断的一个完整原句或分句。')
  }}
};
const claimFields={
  claimant:wording('可能提出请求的一方。'),respondent:wording('该请求的相对人。'),
  request:wording('拟请求的给付、行为或救济；不同于解除权、抗辩权或公司审批。'),
  basis:wording('具体合同约定或经核实适用的法律依据。'),condition:wording('请求成立及到期需要什么条件。'),
  defense:wording('相对人可以提出什么抗辩，或目前为何看不到可用的抗辩。'),
  proof:wording('哪些事实已获材料支持，还缺怎样的证据；区分签前约定和实际履行。'),
  consequence:wording('在上述前提下可能得到的救济，以及它怎样影响本次签署。'),refs:evidence
};
const fields={
  reviewRevision:{type:'integer',description:'开案或补件后取得的当前修订序号。'},
  background:wording('用一小段说明交易为何这样安排、什么触发履行或收款、附件及上下文如何影响判断。有疑问的事实写作待核。'),
  backgroundRefs:evidence,
  claims:{type:'array',maxItems:10,description:'请按对签署的影响从大到小排列，通常二至三项足够，逐字段用短句。证据不足可列条件性请求。仅在确无具体请求可评时留空并填写 noClaimReason。',items:{
    type:'object',additionalProperties:false,properties:claimFields,required:Object.keys(claimFields)
  }},
  noClaimReason:wording('没有可具体评估的请求时，说明原因和已核查的材料范围。')
};
function text(value,label){
  if(typeof value!=='string'||value.trim().length<2||value.length>1400||internalText.test(value))throw Error('请以简明的法务语言填写'+label+'。');
  return value.trim();
}
function citations(row,refs){
  if(!Array.isArray(refs)||!refs.length||refs.length>6)throw Error('每项背景或请求至少需附一段本案原文。');
  return refs.map(ref=>{
    const s=row.packet.sources.find(x=>x.id===ref?.sourceId);
    if(!s||typeof ref.quote!=='string'||ref.quote.trim().length<4||!s.text.includes(ref.quote))
      throw Error('请求或业务背景的引文须逐字出自所选材料。');
    const label=text(s.locator,'材料名称与条款位置');
    return label+'「'+text(ref.quote,'原文摘引')+'」';
  });
}
export function recordReviewNarrative(row,args){
  if(!row||args.reviewRevision!==row.revision)throw Error('请在当前案件修订上登记业务背景与请求权基础。');
  const background=text(args.background,'业务背景');
  const backgroundRefs=citations(row,args.backgroundRefs);
  if(!Array.isArray(args.claims)||args.claims.length>10)throw Error('请逐项列明与签署有关的请求。');
  const claims=args.claims.map(c=>{
    const result={};
    for(const [key,spec] of Object.entries(claimFields))if(key!=='refs')result[key]=text(c?.[key],spec.description);
    result.refs=citations(row,c.refs);
    return result;
  });
  return {...row,reviewNarrative:{fingerprint:basisOf(row),background,backgroundRefs,claims,noClaimReason:claims.length?'':text(args.noClaimReason,'暂无法提出具体请求的依据')}};
}
export function renderReviewNarrative(row){
  const n=row.reviewNarrative;
  if(!n||n.fingerprint!==basisOf(row))throw Error('请先用 civil_record_claim_basis 按当前材料登记业务背景、合同原文和主要请求，之后再出具签署意见。');
  const sentence=value=>/[。！？!?]$/.test(value)?value:value+'。';
  const background=n.background+'\n\n依据　'+n.backgroundRefs.join('、');
  const lead=c=>sentence(c.claimant+'可向'+c.respondent+'主张'+c.request);
  const claims=n.claims.map(c=>lead(c)+sentence(c.basis)+sentence(c.condition)+'\n\n抗辩与举证　'+sentence(c.defense)+sentence(c.proof)+'\n\n对签署的影响　'+sentence(c.consequence)+'\n\n依据　'+c.refs.join('、')).join('\n\n');
  const principal=n.claims.slice(0,3);
  const claimsLead=principal.map(c=>lead(c)+sentence(c.basis)+sentence(c.condition)+sentence(c.consequence)).join('\n\n');
  const claimsShort=principal.map(c=>lead(c)+sentence(c.condition)+sentence(c.consequence)).join('\n\n');
  const claimsDetail=n.claims.map((c,i)=>lead(c)+(i<principal.length?'':sentence(c.basis)+sentence(c.condition)+sentence(c.consequence))+
    '抗辩与举证　'+sentence(c.defense)+sentence(c.proof)+'\n\n依据　'+c.refs.join('、')).join('\n\n');
  return {title:row.packet.businessKind||row.packet.scene,claimCount:n.claims.length,background,backgroundShort:n.background,backgroundCitations:n.backgroundRefs.join('、'),
    claims:claims||n.noClaimReason,claimsLead:claimsLead||n.noClaimReason,claimsShort:claimsShort||n.noClaimReason,claimsDetail};
}
export function claimReviewBlocks(row){
  if(!row.reviewNarrative||row.reviewNarrative.fingerprint!==basisOf(row))return [];
  const n=renderReviewNarrative(row);
  return [['交易的业务背景',n.background],['主要请求及其依据',n.claims]];
}
export function registerClaimTool(ctx,{tool,store,session,save}){
  ctx.tools.register(tool('civil_record_claim_basis','核对本案业务背景和会改变签署意见的请求权。逐项说明谁能向谁主张什么、依据、成立与到期、抗辩、举证及后果。请附合同或附件原文。先审材料再填写，不预设特定行业结论。出具正式意见前调用。',fields,['reviewRevision','background','backgroundRefs','claims'],(args,exec)=>{
    const sid=session(exec),next=recordReviewNarrative(store.get(sid),args);
    const report=save(sid,next);
    return {report,markdown:'业务背景和主要请求的依据已记入本案。\n\n'+renderReviewNarrative(next).claimsShort};
  }));
}
