import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {internalText} from './counsel-view.mjs';
import {readCandidate} from './approved-methods.mjs';
import {taskModeOf} from './case-store.mjs';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
function scope(packet){
  const values=[packet.scene,packet.stance,packet.stage,packet.businessKind];
  // Preserve the original scope and signed receipt for contract reviews.
  const mode=taskModeOf(packet);
  if(mode!=='contract')values.push(mode);
  return values;
}
const validScope=p=>scope(p).every(s=>typeof s==='string'&&s.trim().length);
const roles=['原案','相似案','反例'];
const text=v=>typeof v==='string'&&v.trim().length>=4&&v.length<=1800&&!internalText.test(v);
const folder=store=>path.join(store.home,'catalog-review');
function records(store){
  const dir=path.join(store.home,'cases');
  return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')).flatMap(n=>read(path.join(dir,n)).records.map(row=>({...row,sessionId:n.slice(0,-5)}))):[];
}
function packets(store){
  const dir=folder(store);
  return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>read(path.join(dir,n))):[];
}
export function approvedForCase(store,packet){
  if(!validScope(packet))return [];
  return packets(store).filter(r=>r.confirmed&&authenticLegacyReceipt(r)&&
    (r.organization||'')===(packet.organization||'')&&JSON.stringify(r.scope)===JSON.stringify(scope(packet))).map(r=>r.guidance);
}
function authenticLegacyReceipt(r){
  if(r.origin==='session-memory'||!Array.isArray(r.evidence)||!roles.every(role=>r.evidence.some(e=>e.role===role&&text(e.quote)&&text(e.reason))))return false;
  return hash({scope:r.scope,guidance:r.guidance,evidence:r.evidence,...(r.organization?{organization:r.organization}:{})}).slice(0,16)===r.id;
}
export function prepareCatalogReview(store,current,{title,proposal,examples}){
  const existing=readCandidate(title);
  const fresh=typeof title==='string'&&text(title)&&title.length<=100&&proposal&&['relation','scope','counter'].every(k=>text(proposal[k]));
  const proposed=existing||(fresh?{title,relation:proposal.relation,scope:proposal.scope,counter:proposal.counter}:null);
  if(!proposed||!validScope(current.packet))throw Error('选定既有方法，或提供新提案的关系、适用条件和排除条件。请明确业务、审查方向、立场和时点。');
  if(!Array.isArray(examples)||examples.length<3||examples.length>24||roles.some(role=>!examples.some(e=>e.role===role)))throw Error('请分别提供纠正原案、独立相似案和能够改变结论的反例。');
  const universe=records(store),used=new Set(),matterIds=new Set(),evidence=[],verifiedSources=[];
  for(const e of examples){
    if(!roles.includes(e.role)||![e.before,e.after,e.reason].every(text))throw Error('请逐案说明纠正前后意见及适用或排除的理由。');
    const compare=e.role==='反例'?3:4;
    const matches=universe.filter(r=>r.packet.id===e.caseId&&taskModeOf(r.packet)===taskModeOf(current.packet)&&(r.packet.organization||'')===(current.packet.organization||'')&&
      scope(r.packet).slice(0,compare).every((s,i)=>s===scope(current.packet)[i]));
    const row=matches.length===1?matches[0]:null;
    const src=row?.packet.sources.find(s=>s.id===e.sourceId);
    if(!src||!text(e.quote)||!src.text.includes(e.quote))throw Error('所引原件须来自可区分的同一业务方向案件，摘引须与原件一致。');
    if(e.role==='原案'&&!row.corrections?.some(c=>c.state!=='hypothetical'&&text(c.reason)&&c.sourceId===e.sourceId&&text(c.quote)&&src.text.includes(c.quote)))throw Error('原案的纠正意见须说明理由并附对应的原件摘引。');
    const key=hash(row.packet.sources.map(s=>s.text.replace(/\s+/g,'')).sort());
    if(used.has(key)||matterIds.has(e.caseId))throw Error('同一份材料或同一案件不能重复计作独立验证。');
    used.add(key);matterIds.add(e.caseId);
    evidence.push({role:e.role,businessKind:row.packet.businessKind,quote:e.quote,before:e.before,after:e.after,reason:e.reason});
    verifiedSources.push({role:e.role,caseId:row.packet.id,sessionId:row.sessionId,sourceId:src.id,locator:src.locator,quote:e.quote,before:e.before,after:e.after,reason:e.reason,materialFingerprint:key});
  }
  const guidance={title:proposed.title,relation:proposed.relation,scope:proposed.scope,counter:proposed.counter};
  const record={scope:scope(current.packet),guidance,evidence,...(current.packet.organization?{organization:current.packet.organization}:{})};
  const id=hash(record).slice(0,16);
  fs.mkdirSync(folder(store),{recursive:true});const file=path.join(folder(store),id+'.json');
  if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({...record,id,confirmed:false}),{flag:'wx'});
  const taskName={contract:'合同审查',consult:'法律咨询',research:'类案检索'}[taskModeOf(current.packet)];
  const original=evidence.find(e=>e.role==='原案');
  return {id,title,relation:guidance.relation,change:guidance.relation,before:original.before,after:original.after,verifiedSources,markdown:['**待法务确认　'+title+'**','适用范围　'+[taskName,...record.scope.slice(0,4)].join('、'),...evidence.map(e=>e.role+' · '+e.businessKind+'　原文「'+e.quote+'」\n\n原意见　'+e.before+'\n\n纠正后　'+e.after+'\n\n依据与例外　'+e.reason),'请核查案件是否真正独立、材料是否充分以及反例能否排除错误类推。确认前仅供试验。'].join('\n\n')};
}
export function confirmCatalogReview(store,id){
  if(!/^[a-f0-9]{16}$/.test(id)){
    const pending=packets(store).filter(r=>!r.confirmed&&r.guidance.title===id.trim());
    if(pending.length!==1)throw Error('请核对待确认的候选名称。若有多份同名取舍意见，须从对应的审阅回执逐一确认。');
    id=pending[0].id;
  }
  if(!/^[a-f0-9]{16}$/.test(id))throw Error('请选取待确认的审阅回执。');
  const file=path.join(folder(store),id+'.json');const row=read(file);
  if(row.id!==id||!authenticLegacyReceipt(row))throw Error('意见或证据已经变化，请重新审阅。');
  if(!row.confirmed){
    const tmp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify({...row,confirmed:true,confirmedAt:new Date().toISOString()}),{flag:'wx'});fs.renameSync(tmp,file);
  }
  return row.guidance.title;
}

