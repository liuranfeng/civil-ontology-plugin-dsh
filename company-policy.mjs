import fs from 'node:fs';
import {internalText} from './counsel-view.mjs';
import {evaluatePolicy,policyFactGuide} from './company-thresholds.mjs';

const library=JSON.parse(fs.readFileSync(new URL('./civil/company.json',import.meta.url),'utf8'));
const byId=new Map(library.cards.map(c=>[c.id,c]));
function cardByName(key){
 const unique=library.cards.filter(c=>c.title===key||c.location===key);
 return byId.get(key)||(unique.length===1?unique[0]:null);
}
const sections=new Set(library.cards.map(c=>c.section));
const str={type:'string'};
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s/g,'');
const segments=new Intl.Segmenter('zh-CN',{granularity:'word'});
const boundaries='这些问题供企业合同审查参考。具体审批、豁免或批准权限需由本案适用主体的现行制度原文支持。';
function differences(card){
  const self=new Set([card.id,...card.related]);
  return library.conflicts.filter(c=>c.sourceRows.some(p=>library.cards.some(r=>r.sheet===p.sheet&&r.row===p.row&&self.has(r.id))));
}
export function searchCompany(query,section='',offset=0){
  if(section&&!sections.has(section))throw Error('请从目录中选取事项范围。');
  if(!Number.isSafeInteger(offset)||offset<0)throw Error('请选择有效的目录位置。');
  const q=normalize(query);
  const words=[...new Set([q,...[...segments.segment(query||'')].filter(w=>w.isWordLike&&w.segment.length>1).map(w=>normalize(w.segment))].filter(Boolean))];
  const hits=library.cards.filter(c=>!section||c.section===section).map(c=>{
    const indexed=[normalize(c.title),normalize(c.topic),normalize(c.groups.join(' ')),normalize(c.fields.map(f=>f[1]).join(' '))];
    const weights=[12,8,4,1];let score=c.id===query?10000:0;
    for(const w of words)for(let i=0;i<indexed.length;i++)if(indexed[i].includes(w))score+=weights[i]*(w===q?2:1);
    return {c,score};
  }).filter(r=>!q||r.score>0).sort((a,b)=>b.score-a.score);
  const items=hits.slice(offset,offset+12).map(({c})=>({id:c.id,title:c.title,source:c.location,status:c.status,section:c.section}));
  return {items,total:hits.length,nextOffset:offset+items.length<hits.length?offset+items.length:null,
    markdown:items.length?items.map(x=>'**'+x.title+'**　'+x.status+'\n'+x.source).join('\n\n'):'未查到对应事项。可换用合同用语，或按事项类别查看目录。'};
}
export function readCompanyCard(id){
 const c=cardByName(id);if(!c)throw Error('请使用目录中列明的完整出处或唯一事项名称。');
 const legal=library.families.filter(f=>c.groups.includes(f.name));
 const related=c.related.map(k=>byId.get(k));
 return {card:c,related:related.map(r=>({id:r.id,title:r.title})),markdown:['**'+c.title+'**',c.location+'　'+c.status,...c.fields.map(([label,value])=>label+'　'+value),
 ...legal.map(f=>'本案应追问　'+f.question+' '+f.evidence+' '+f.claim),
 ...differences(c).map(r=>'两处口径须联读　'+r.title+'。'+r.disposition),
 related.length?'另请对照　'+related.map(r=>r.title).join('、'):'',boundaries].filter(Boolean).join('\n\n')};
}
export function noteBlocks(notes=[]){
 return notes.map(n=>['公司审查依据 · '+n.title,['本案原文　'+n.clauseName+'「'+n.quote+'」','审查参考　'+n.location+'。'+n.citation,n.policy?'本案制度　'+n.policy.locator+'「'+n.policy.text+'」':'本案适用制度及审批权限待补。','适用状态　'+n.status,n.decision,'处置意见　'+n.action].join('\n\n')]);
}
export function companyLevelSources(notes=[]){
 return notes.filter(n=>n.policy).map(n=>n.policy);
}
function counselText(s){return typeof s==='string'&&s.trim().length>=2&&s.length<=1600&&!internalText.test(s)&&!/(?:file:\/\/|https?:\/\/[^\s]+-int\.com)/i.test(s);}
function verifyScope(row,card,args){
 const identity=row.packet.sources.find(s=>s.id===args.scopeSourceId);
 if(!identity||!args.scopeQuote||args.scopeQuote.length<4||!identity.text.includes(args.scopeQuote)||!args.organization?.trim()||!args.scopeQuote.includes(args.organization)||/^(?:本公司|公司|我方|客户|我司|甲方|乙方)$/.test(args.organization))throw Error('请引用本案的签约主体原句，核实所代表当事人的名称和角色。');
 const identityLine=args.scopeQuote.split(/[。；;\n]/).filter(s=>s.includes(args.organization)).join('　');
 if(card.section==='销售合同'&&/买方|采购方|买受人|采购人|客户方/.test(identityLine)&&!/卖方|出卖人|供应商|供方|服务提供方/.test(identityLine))throw Error('所引主体条款将该公司列为采购方，请核对我方交易方向。');
 const allowed=card.section==='销售合同'? /卖方|销售方|销售商|供应商|供方|服务提供方|服务方|出卖人|承包人|承揽人|许可方/.test(row.packet.stance) :card.section==='其他盖章文件审核'?/盖章|用印|投标|声明|承诺|证明|招标/.test(row.packet.scene+' '+row.packet.businessKind):card.section==='诉讼'?/诉讼|应诉|起诉/.test(row.packet.scene+' '+row.packet.stage):card.section==='计收相关'?/计收|收入确认|结算/.test(row.packet.scene+' '+row.packet.stage):/海外主体|境外设立|海外设立/.test(row.packet.scene+' '+row.packet.businessKind);
 if(!allowed)throw Error('这项公司口径与本案已确认的交易方向或事项不一致，请核对我方立场及材料。');
}
const statuses=new Set(['制度所列口径，待核适用','需补证','口径有分歧','仅作背景','本案不适用']);
// The signed contract proves the contracting identity. A separate policy source
// must prove the issuer/scope and the rule itself before attributing an approval.
function casePolicy(row,args){
 if(!args.policySourceId&&!args.policyQuote&&!args.policyScopeQuote)return null;
 const s=row?.packet.sources.find(x=>x.id===args.policySourceId);
 if(!s||!/制度|审批规则|授权规则|权限表/.test(s.kind)||/参考|样例|拟稿|历史|脱敏|草案|讨论/.test(s.kind)||s.id===args.scopeSourceId||
  !counselText(args.organization)||!args.policyScopeQuote?.includes(args.organization)||!s.text.includes(args.policyScopeQuote)||
  !counselText(args.policyQuote)||args.policyQuote.length<5||!s.text.includes(args.policyQuote))throw Error('请引用本案实际制度的适用主体及制度条文；合同签约主体、历史样例和脱敏审查资料不足以证明审批权限。');
 const identity=row.packet.sources.find(x=>x.id===args.scopeSourceId);
 if(!identity||!args.scopeQuote?.includes(args.organization)||!identity.text.includes(args.scopeQuote))throw Error('请以本案签约主体原句核实制度所适用的当事人。');
 return {id:s.id,kind:s.kind,locator:s.locator,text:args.policyQuote};
}
const policyFields={organization:str,scopeSourceId:str,scopeQuote:str,policySourceId:str,policyQuote:str,policyScopeQuote:str};
export function registerCompany(ctx,{tool,session,store,save}){
 ctx.tools.register(tool('company_search_rules','检索公司法务资料。搜索词为空时分页列目录。',{query:str,section:{type:'string',enum:[...sections]},offset:{type:'integer',minimum:0}},['query'],a=>searchCompany(a.query,a.section,a.offset)));
 ctx.tools.register(tool('company_read_rule','查阅脱敏审查问题、所需证据、相关事项与适用边界。',{cardId:str},['cardId'],a=>readCompanyCard(a.cardId)));
 ctx.tools.register(tool('company_evaluate_policy','按本案适用的真实企业制度试算。organization 填签约人，scopeSourceId、scopeQuote 填其合同出处；policySourceId 填独立制度材料，policyScopeQuote、policyQuote 分别逐字摘录适用主体和所核条款。无制度时留空，结果待核。'+JSON.stringify(policyFactGuide),{kind:{type:'string',enum:['penalty','liabilityCap','guarantee']},facts:{type:'object',additionalProperties:true},...policyFields},['kind'],(a,exec)=>{
   const policy=casePolicy(store.get(session(exec)),a);
   const result=evaluatePolicy(a.kind,a.facts||{},policy?.text);
   return {...result,markdown:['**本案制度口径试算**',result.finding,policy&&policy.locator+'「'+policy.text+'」',...(result.missing||[]).map(s=>'待核　'+s)].filter(Boolean).join('\n\n')};
 }));
 ctx.tools.register(tool('company_record_review','将案涉条款、对应公司口径与处置一并写入本案意见。',{
    reviewRevision:{type:'integer'},cardId:str,sourceId:str,quote:str,...policyFields,status:{type:'string',enum:[...statuses]},decision:str,action:str
 },['reviewRevision','cardId','sourceId','quote','organization','scopeSourceId','scopeQuote','status','decision','action'],(a,exec)=>{
   const sid=session(exec),row=store.get(sid),c=cardByName(a.cardId);
   if(!row||row.revision!==a.reviewRevision||!c)throw Error('请核对当前案件及审阅资料。');
   verifyScope(row,c,a);
   const s=row.packet.sources.find(x=>x.id===a.sourceId);
   if(!s||!counselText(a.quote)||a.quote.length<4||!s.text.includes(a.quote)||![a.decision,a.action].every(counselText)||!statuses.has(a.status))throw Error('请核对该案原句，使用法务语言填写判断及处置。');
   const archived=['原表注明废止','原表注明免除','被引用材料','工作记录','残缺提示','内部工作记录，需复核','流程说明或优化讨论'].includes(c.status);
   if(archived&&!['仅作背景','本案不适用','需补证','口径有分歧'].includes(a.status))throw Error('这项材料仅供追溯或补证，请勿作为现行审批要求。');
   const policy=casePolicy(row,a);
   if(a.status==='制度所列口径，待核适用'&&!policy)throw Error('确认为本案制度口径需要提供适用主体、来源和制度原文。仅有合同请登记为“需补证”或“仅作背景”。');
   const quoteField=c.fields.find(f=>f[0]==='适用条件与证据')||c.fields[0];
   const note={cardId:c.id,title:c.title,location:c.location,sourceId:s.id,clauseName:s.displayName||(counselText(s.locator)?s.locator:'合同条款'),quote:a.quote,citation:quoteField[1],status:a.status,decision:a.decision,action:a.action,policy};
   const list=[...(row.companyNotes||[]).filter(x=>x.cardId!==c.id||x.sourceId!==s.id||x.quote!==a.quote),note];
   const report=save(sid,{...row,companyNotes:list});
   return {report,approvalReference:companyLevelSources([note]),markdown:noteBlocks([note]).map(([h,b])=>'**'+h+'**\n\n'+b).join('\n\n')};
 }));
}

