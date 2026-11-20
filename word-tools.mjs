import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDocx } from './word/vendor/document-export.mjs';
import { readDocument, generateVersion } from './word/vendor/docx.mjs';
import {noteBlocks,companyLevelSources} from './company-policy.mjs';
import {methodReviewForDelivery} from './method-accountability.mjs';
import {renderReviewNarrative} from './review-narrative.mjs';

// Locator ids belong to the case evidence index. The export only emits counsel-facing labels and quotes.
const internal = /\b(?:PROC-[A-Z0-9-]+|[FPDVALQHR]\d+(?:-\d+)?|recordCreatedAt|(?:form|bpm|bw|srm|bid)_data|record_fields|main_document|lineItem|attachment_texts|singleKey|field[A-Z_][a-zA-Z_0-9]*|sha(?:-?256)?|hash|sourceId|blockId|agent-step-\d+)\b|[a-z]:[\\/]|(?:^|\s)\/(?:Users|home|mnt|tmp)\/|\b[a-f\d]{32,64}\b|第\s*\d+\s*(?:至\s*\d+\s*)?行|正文抽取|来源编号|证据编号/i;
const prose = (value, label) => {
  if(typeof value !== 'string' || !value.trim() || value.length>4000 || internal.test(value)) throw Error(`请用律师可以直接引用的自然语言填写${label}，以材料名称、条款标题或合同原句定位。`);
  return value.replace(/\s+/g,' ').trim();
};
const list = (value, label) => {
  if(!Array.isArray(value)||value.length===0||value.length>40) throw Error(`请补全${label}。`);
  return value;
};
const norm = s => s.replace(/\s+/g,'');
const cell = s => s.replaceAll('|','\\|');
const types = ['须先处理','待确认','对我方有利'];

function numberLabel(s){
  if(/^[\d.]+$/.test(s))return s;
  const romans={I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10};
  if(romans[s])return String(romans[s]);
  let v=0,d=0;
  for(const ch of s){const i='零一二三四五六七八九'.indexOf(ch);if(i>=0||ch==='〇')d=Math.max(0,i);else if(ch==='十'||ch==='百'||ch==='千'){v+=(d||1)*({十:10,百:100,千:1000}[ch]);d=0;}else return s;}
  return String(v+d);
}
function approvalLevels(value){
  const str=value.normalize('NFKC').toUpperCase();
  const levels=[...str.matchAll(/([IVX]+|[零一二三四五六七八九十百\d]+)\s*级(?:\s*(?:审批|审核|批准|授权))?/g)].map(m=>numberLabel(m[1])+'级');
  return [...levels,...[...str.matchAll(/BU\s*HEAD(?:\s*[-–—]\s*\d+)?/g)].map(m=>m[0].replace(/\s/g,'').replace(/[–—]/g,'-'))];
}

function reference(packet, ref) {
  const source = packet.sources.find(x=>x.id===ref?.sourceId);
  const quote = prose(ref?.quote,'引文');
  if(!source || quote.length<4 || !norm(source.text).includes(norm(quote))) throw Error('请核对引文与本案原件，提交能够逐字定位的摘引。');
  const name=prose(ref.name,'材料名称与条款标题');
  for(const m of name.matchAll(/第\s*([\d一二三四五六七八九十百零〇]+(?:\.\d+)*)\s*[条款项]/g)) {
    const supplied=String(source.text)+' '+String(source.locator);
    const labels=[...supplied.matchAll(/第\s*([\d一二三四五六七八九十百零〇.]+)\s*[条款项]|(?:^|[\n#])\s*([\d一二三四五六七八九十百零〇]+(?:\.\d+)*)[、.)）]/g)].map(x=>numberLabel(x[1]||x[2]));
    labels.push(...[...supplied.matchAll(/(?:^|[\n#])\s*(\d+(?:\.\d+)+)(?=[\s\u4e00-\u9fff])/g)].map(x=>x[1]));
    if(!labels.includes(numberLabel(m[1]))) throw Error('条款编号需要与原材料对应。');
  }
  return `${name}「${quote}」`;
}

function presentReview({scope,profile,narrative,conclusion,risks,approval,approvalShort,methods}){
  const issues=risks.map(r=>({...r,methods:[]}));
  const choices=methods?.items??[];
  for(const item of choices.filter(i=>i.placement==='列入结论')){
    // Only an explicit title or an identical statement establishes the association.
    // Two distinct rights can be based on the very same contract clause.
    let issue=issues.find(r=>r.methodTitles?.includes(item.title))
      ??issues.find(r=>r.risk===item.title||norm(r.action)===norm(item.effect));
    if(!issue){
      issue={risk:item.title,refs:[],status:item.applicability==='待核'?'待确认':'列入签约意见',
        action:item.effect,methods:[]};
      issues.push(issue);
    }
    issue.methods.push(item);
  }
  const priority=(issue)=>issue.primary?0:issue.status==='须先处理'?1:issue.status==='待确认'?2:3;
  const ordered=issues.filter(r=>r.status!=='对我方有利').sort((a,b)=>priority(a)-priority(b));
  const main=ordered.slice(0,4);
  const others=ordered.slice(4);
  const unresolved=issues.filter(r=>r.status==='待确认'||r.methods.some(m=>m.missing));
  const compactList=rows=>rows.slice(0,2).map(r=>r.risk).join('、')+(rows.length>2?'等':'');
  const group=others.length?'其他影响签署的事项共 '+others.length+' 项，包括'+compactList(others)+'，逐项处置见附录。':'';
  const followup=unresolved.length?'仍须确认 '+unresolved.length+' 项，包括'+compactList(unresolved)+'。':'';
  const route='审批与签署　'+approvalShort.slice(0,2).join('。')+(approvalShort.length>2?'。其余 '+(approvalShort.length-2)+' 项签署手续见附录。':'');
  const facts='## 一　合同情况',background='## 二　业务背景',claimHead='## 三　请求权基础',resultHead='## 四　审查结果与签署意见';
  const business=narrative.backgroundShort??narrative.background.split('\n\n')[0];
  const otherClaims=narrative.claimCount>3?'其他 '+(narrative.claimCount-3)+' 项请求及其依据见附录。':'';
  const head=[facts,scope,...profile,background,business,claimHead];
  const lines=[...head,narrative.claimsLead??narrative.claimsShort,otherClaims,resultHead,conclusion,
    ...main.map(r=>'**'+r.risk+'**　'+r.action),group,followup,route].filter(Boolean);
  const chat=[...head,narrative.claimsShort,resultHead,conclusion,main.length?'签前优先处理　'+main.map(r=>r.risk).join('、')+'。':'',followup,route,
    '完整处置及已查阅的 '+choices.length+' 项方法取舍见 Word 附录。'].filter(Boolean).join('\n\n');

  const annex=['## 附　逐项处置与方法取舍'];
  for(const issue of issues){
    const place=main.includes(issue)?'处置见正文第四部分。':issue.action;
    annex.push('### '+issue.risk,issue.status+'。'+place);
    const refs=[...new Set([...issue.refs,...issue.methods.map(m=>m.evidence)])];
    annex.push(...refs.map((ref,i)=>refs.length>1?'原文（'+(i+1)+'）　'+ref:ref));
    const actions=new Set([norm(issue.action)]);
    for(const m of issue.methods){
      const anchor=refs.length>1?'据本项原文（'+(refs.indexOf(m.evidence)+1)+'），':'';
      annex.push('审查方法　'+m.title+'。'+m.applicability+'，'+m.placement+'。'+anchor+m.reason);
      if(m.effect&&!actions.has(norm(m.effect))){annex.push('对签署的影响　'+m.effect);actions.add(norm(m.effect));}
      if(m.missing&&!actions.has(norm(m.missing))){annex.push('待补　'+m.missing);actions.add(norm(m.missing));}
    }
  }
  const excluded=choices.filter(i=>i.placement==='不列入结论');
  if(excluded.length){
    annex.push('### 未单列为签约条件的事项');
    for(const m of excluded)annex.push(m.title+'。'+m.applicability+'，'+m.placement+'。'+m.reason,m.evidence);
  }
  if(!choices.length)annex.push('本次审查未登记已查阅的方法详情。');
  const approvalDetails=approval.flatMap((detail,i)=>i>=2?[detail]:detail===approvalShort[i]?[]:[detail.slice(approvalShort[i].length).trim()]);
  if(approvalDetails.length)annex.push('### 审批依据与其余签署手续',...approvalDetails);
  annex.push('## 附　业务背景与请求的依据');
  if(narrative.backgroundCitations)annex.push('业务背景依据　'+narrative.backgroundCitations);
  else if(narrative.background.startsWith(business))annex.push(narrative.background.slice(business.length).trim());
  else annex.push(narrative.background);
  annex.push(narrative.claimsDetail??narrative.claims);
  return {lines:[...lines,...annex.filter(Boolean)],chat};
}

export function legalReviewMarkdown(packet, review, termNotes=[],companyNotes=[],methods=null,narrative=null) {
  const title=prose(review?.title,'报告标题');
  const stance=prose(review.stance,'我方立场');
  const materialScope=prose(review.materialScope,'审阅范围');
  const decision=prose(review.decision,'签约结论');
  const profile=list(review.profile,'合同定性').map(x=>prose(x,'合同定性'));
  const company=companyLevelSources(companyNotes);
  const approvalPacket={...packet,sources:[...packet.sources,...company]};
  const approvalShort=[];
  const approval=list(review.approval,'签署路径').map(x=>{
    const text=prose(typeof x==='string'?x:x.text,'签署动作');
    approvalShort.push(text);
    const inputs=(typeof x==='object'?x.refs||[]:[]).map(ref=>{
      const c=company.find(s=>s.locator===ref.sourceId||s.id===ref.sourceId);
      if(!c)return ref;
      if(!/按.{0,14}(?:原表|表列|审批表|所给表)|若.{0,18}适用|依.{0,10}表列/.test(text))throw Error('历史审批表仅作所列表内口径。请作条件说明，或另附本案现行制度。');
      return {...ref,sourceId:c.id,name:c.locator};
    });
    const refs=inputs.map(ref=>reference(approvalPacket,ref));
    const levels=approvalLevels(text);
    const proven=inputs.flatMap(r=>{
      if(company.some(c=>c.id===r.sourceId))return [...approvalLevels(r.quote),...[...r.quote.normalize('NFKC').matchAll(/\b([IVX]{1,4})\b/g)].map(m=>numberLabel(m[1])+'级')];
      return /制度|规则|授权|权限/.test(packet.sources.find(s=>s.id===r.sourceId)?.kind||'')?approvalLevels(r.quote):[];
    });
    if(levels.some(level=>!proven.includes(level)))throw Error('具体审批级别需要附本案适用的授权制度原文，且引文须支持所列级别。');
    return text+(refs.length?' 依据'+refs.join('。')+'。':'');
  });
  const risks=list(review.risks,'风险与处置').map(x=>{
    if(!types.includes(x?.status)) throw Error('判定可选须先处理、待确认或对我方有利。');
    const refs=list(x.refs,'原文依据').map(ref=>reference(packet,ref));
    const methodTitles=x.methodTitles??[];
    if(!Array.isArray(methodTitles)||methodTitles.some(title=>!methods?.included.some(i=>i.title===title)))
      throw Error('请在风险所列的 methodTitles 中仅引用本案已决定列入结论的方法全名。');
    return {risk:prose(x.risk,'审查事项'),refs,status:x.status,action:prose(x.action,'处置意见'),methodTitles,primary:x.primary===true};
  });
  const conclusion=prose(review.conclusion,'一句话意见');
  const riskTable=['| 审查事项 | 合同原文及位置 | 判定 | 处置意见 |','| --- | --- | --- | --- |', ...risks.map(x=>`| ${[x.risk,x.refs.join('。'),x.status,x.action].map(cell).join(' | ')} |`)].join('\n');
  const steps=approval.map((x,i)=>`${i+1}. ${x}`);
  const scope=`我方立场及审阅范围　${stance}。${materialScope}`;
  let lines,chat;
  if(narrative){
    ({lines,chat}=presentReview({scope,profile,narrative,conclusion,risks,approval,approvalShort,methods}));
  }else{
    lines=[decision,scope,'## 一　合同定性',...profile,'## 二　风险清单与处置',riskTable,'## 三　审批与签署路径',...steps,'## 四　签约意见',conclusion];
  }
  if(termNotes.length){
    lines.push('## 附　交易用语与判断依据');
    for(const n of termNotes){
      const source=packet.sources.find(s=>s.id===n.sourceId);
      if(!source||!source.text.includes(n.quote))throw Error('业务用语所引原件需要重新核实。');
      lines.push(prose(n.term,'交易用语')+'　案涉原文「'+prose(n.quote,'引文')+'」',...[n.meaning,n.obligation,n.claim,n.boundary,n.publication].map(v=>prose(v,'业务用语意见')));
    }
  }
  if(companyNotes.length){
    lines.push('## 附　公司法务依据与本案处置');
    for(const [heading,detail] of noteBlocks(companyNotes))lines.push(heading,detail);
  }
  return {title,markdown:lines.join('\n\n'),...(chat?{chat}:{})};
}

export function generateLegalReport(packet, review) {
  return createDocx(legalReviewMarkdown(packet,review));
}

export function reviseContract(bytes, changes, packet) {
  const doc=readDocument(bytes);
  const edits=list(changes,'修订条目').map(x=>{
    const before=prose(x.before,'原合同段落');
    const quote=reference(packet,x.ref);
    if(!norm(before).includes(norm(x.ref.quote))) throw Error('原合同段落与本案引文不符。');
    const matches=doc.blocks.filter(b=>norm(b.text)===norm(before));
    if(matches.length!==1) throw Error('请核对原件版本与完整段落，修订位置须唯一。');
    return {blockId:matches[0].id,before:matches[0].text,type:'replace',after:prose(x.after,'拟修改条款'),reason:prose(x.reason,'批注意见')+' 原约定见'+quote+'。'};
  });
  return generateVersion(bytes,edits).tracked;
}

const object={type:'object',additionalProperties:true};
const str={type:'string'};
const safeName = s=>s.replace(/[<>:"/\\|?*\u0000-\u001F]/g,'').slice(0,55)||'合同';
export function registerWordTools(ctx,{store,session,tool}) {
  const rowFor=(exec,version)=>{
    const sid=session(exec), row=store.get(sid);
    if(!row || row.revision!==version) throw Error('请先核对本次案件的最新审查意见。');
    return {row,directory:path.join(store.home,'reports',sid)};
  };
  const save=(directory,name,bytes)=>{
    fs.mkdirSync(directory,{recursive:true});
    const folder=path.join(directory,randomUUID());
    fs.mkdirSync(folder);
    const file=path.join(folder,safeName(name)+'.docx');
    fs.writeFileSync(file,bytes,{flag:'wx'});
    return file;
  };
  ctx.tools.register(tool('word_review_export','依当前案卷交付四段简明对话和 Word。先登记请求依据与每项详读方法的取舍。contractReview 须含 title、stance、materialScope、decision、profile（简短合同概况数组）、risks、approval（签署步骤数组，关键手续在前）、conclusion（一句完整签署意见）。每项风险含 risk、refs（sourceId、name、quote）、status（须先处理/待确认/对我方有利）、action；与已查方法关联时填写 methodTitles 数组。按影响排序，最影响用印的三四项可设 primary:true。次要事项和依据进入附录，原句和条件均予保留。',
    {reviewRevision:{type:'integer'},contractReview:object},['reviewRevision','contractReview'],({reviewRevision,contractReview},exec)=>{
      const {row,directory}=rowFor(exec,reviewRevision);
      const methods=methodReviewForDelivery(row);
      const narrative=row.methodBatch&&row.mode==='on'?renderReviewNarrative(row,contractReview):null;
      const clean=legalReviewMarkdown(row.packet,contractReview,(row.termNotes||[]).filter(n=>n.reviewRevision===reviewRevision),row.companyNotes||[],methods,narrative);
      const file=save(directory,clean.title,createDocx(clean));
      return {file,markdown:`${clean.chat??clean.markdown}\n\n[下载 Word 审查意见](<${file.replaceAll('\\','/')}>)`};
    }));
  ctx.tools.register(tool('word_contract_revise','针对用户提供的 Word 合同原件生成一份带原生修订及批注的可审阅副本。每项提交原段、改后文本、理由以及本案逐字引文。',
    {reviewRevision:{type:'integer'},sourceDocx:str,changes:{type:'array',items:object}},['reviewRevision','sourceDocx','changes'],({reviewRevision,sourceDocx,changes},exec)=>{
      const {row,directory}=rowFor(exec,reviewRevision);
      const fileStat=typeof sourceDocx==='string' ? fs.statSync(sourceDocx,{throwIfNoEntry:false}) : null;
      if(!fileStat?.isFile()||!path.isAbsolute(sourceDocx)||path.extname(sourceDocx).toLowerCase()!=='.docx'||fileStat.size>12*1024*1024) throw Error('请选择本案的 Word 合同原件，文件应为 12 MB 以内的 DOCX。');
      const file=save(directory,'合同修订意见稿',reviseContract(fs.readFileSync(sourceDocx),changes,row.packet));
      return {file,markdown:`[下载合同修订意见稿](<${file.replaceAll('\\','/')}>)`};
    }));
}
