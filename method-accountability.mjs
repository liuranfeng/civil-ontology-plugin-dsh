import {createHash} from 'node:crypto';
import {internalText} from './counsel-view.mjs';

const applicabilityValues=['适用','不适用','待核'];
const placementValues=['列入结论','不列入结论'];
const field=(description)=>({type:'string',minLength:1,description});
export const methodDecisionFields={
  reviewRevision:{type:'integer',description:'本案最近一次开案或补件回执所列 revision。仅读取待办清单时可省略。'},
  entries:{
    type:'array',description:'可一次登记多项或分批登记；以空数组查询已经详读的标题、取舍状态及当前 revision。',
    items:{type:'object',additionalProperties:false,required:['title','applicability','placement','sourceId','quote','reason'],properties:{
      title:field('照抄成功读取的方法详情标题。'),
      applicability:{type:'string',enum:applicabilityValues,description:'该方法在本案是否适用。'},
      placement:{type:'string',enum:placementValues,description:'适用方法可列入或说明理由后不列；待核事项列入结论并交代须谁补证。'},
      sourceId:field('本案已登记且含该原句的来源编号。'),
      quote:field('从该来源逐字复制与判断直接相关的原句或完整分句。缺少直接约定时引已核实的最相关条款，在理由中说明核查范围。'),
      reason:field('结合合同履行或法律效果，具体说明为什么采用、保留或排除这个问题，以及为什么写入或不写入结论。'),
      effect:field('列入结论时必填。用一句能直接进入本案意见的话，写明法律后果及处置；也可以是保留有利条款的意见。'),
      missing:field('待核时必填。写明缺哪项事实或材料、由谁确认以及会改变什么判断。')
    }}
  }
};

export function basisOf(row){
  // A new rendering revision alone does not change the evidence. A correction or
  // a new item of material does, including evidence relevant to an exclusion.
  const {id,...facts}=row.packet;
  return createHash('sha256').update(JSON.stringify({facts,corrections:row.corrections,rules:row.rules,methodBatch:row.methodBatch})).digest('hex');
}

export function rememberMethod(row,title){
  const reviews=row.methodReviews??[];
  if(reviews.some(item=>item.title===title))return row;
  return {...row,methodReviews:[...reviews,{title}]};
}

function readerText(value,label){
  if(typeof value!=='string'||!value.trim()||value.length>4000||internalText.test(value))
    throw Error('请以法务可直接阅读的文字填写'+label+'。');
  return value.trim();
}

export function recordMethodDecisions(row,revision,entries){
  if(!row||row.revision!==revision)throw Error('请按本案最新修订登记取舍，可提交空清单查询当前版本。');
  if(!Array.isArray(entries)||!entries.length)throw Error('请提交已详读方法的取舍。');
  const reviews=row.methodReviews??[];
  const updated=new Map();
  const basis=basisOf(row);
  for(const entry of entries){
    if(!entry||!reviews.some(item=>item.title===entry.title))throw Error('只可登记本案实际成功详读的方法，请使用其完整标题。');
    if(updated.has(entry.title))throw Error('本次提交出现同一方法的两份意见，请明确采用哪一份。');
    if(!applicabilityValues.includes(entry.applicability)||!placementValues.includes(entry.placement))
      throw Error('请标明适用、不适用或待核，以及列入或不列入结论。');
    if(entry.applicability==='不适用'&&entry.placement!=='不列入结论')throw Error('不适用的方法应说明排除理由，在取舍说明中保留。');
    if(entry.applicability==='待核'&&entry.placement!=='列入结论')throw Error('待核事项须在结论中明示待核及其影响。');
    const source=row.packet.sources.find(s=>s.id===entry.sourceId);
    // Preserve the evidence verbatim, including punctuation and internal whitespace.
    const quote=typeof entry.quote==='string'?entry.quote.trim():'';
    if(!source||quote.length<4||!source.text.includes(quote))throw Error('请为「'+entry.title+'」引用本案已登记材料中能够逐字回查的原句。');
    readerText(source.locator,'材料出处或条款标题');
    const decision={title:entry.title,applicability:entry.applicability,placement:entry.placement,
      sourceId:source.id,quote,reason:readerText(entry.reason,'适用及取舍理由'),basis};
    if(entry.placement==='列入结论')decision.effect=readerText(entry.effect,'对本案结论的具体影响及处置');
    if(entry.applicability==='待核'||entry.missing)decision.missing=readerText(entry.missing,'待补证据和核实责任');
    updated.set(entry.title,decision);
  }
  return {...row,methodReviews:reviews.map(item=>updated.get(item.title)??item)};
}

export function methodReviewOverview(row){
  if(!row?.methodReviews?.length)return [];
  const basis=basisOf(row);
  return row.methodReviews.map(item=>{
    if(!item.basis)return {title:item.title,state:'pending'};
    const source=row.packet.sources.find(s=>s.id===item.sourceId);
    if(item.basis!==basis||!source?.text.includes(item.quote))return {title:item.title,state:'stale'};
    return {title:item.title,state:'decided',applicability:item.applicability,placement:item.placement,
      evidence:source.locator+'「'+item.quote+'」',reason:item.reason,effect:item.effect,missing:item.missing};
  });
}

function describe(item){
  if(item.state==='pending')return '已查阅方法。适用性、原文依据及对本案结论的影响尚待说明。';
  if(item.state==='stale')return '本案事实或材料已更新，原判断须重新核实。';
  return [item.applicability+'，'+item.placement+'。','依据　'+item.evidence,'取舍理由　'+item.reason,
    item.effect&&'本案意见　'+item.effect,item.missing&&'待核事项　'+item.missing].filter(Boolean).join('\n');
}
export const methodReviewBlocks=row=>methodReviewOverview(row).map(item=>[item.title,describe(item)]);

export function methodReviewForDelivery(row){
  if(row.mode!=='on'&&!row.methodReviews?.length)return null;
  const all=methodReviewOverview(row);
  const pending=all.filter(item=>item.state!=='decided');
  if(pending.length)throw Error('以下已详读方法尚未依据当前案卷说明取舍：'+pending.map(item=>item.title).join('、')+'。请调用 civil_record_method_decision 逐项登记适用性、材料原句和取舍理由，再交付审查意见。');
  return {items:all,included:all.filter(item=>item.placement==='列入结论')};
}
