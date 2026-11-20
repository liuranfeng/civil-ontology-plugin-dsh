import fs from 'node:fs';
import path from 'node:path';
import {digestKey,readJSON} from './memory-store.mjs';
import {matterFingerprint,packetScope} from './memory-context.mjs';

const localTime=at=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(at));
const roleNames={原案:'original',相似案:'similar',反例:'counter'};
const label={legal:'办理方法',enterprise:'内部制度',presentation:'报告写法',fact:'本案材料'};
const compact=v=>String(v||'').trim().replace(/\s+/g,' ');
const trim=(s,n)=>s.length>n?s.slice(0,n)+'…':s;
function notesAround(turn,history){
  const index=history.findIndex(r=>r.id===turn.id);
  if(index<0)return [turn];
  const n=turn.episode;
  return history.slice(Math.max(0,index-4),index+2).filter(r=>r.episode===n&&(!turn.caseId||!r.caseId||r.caseId===turn.caseId));
}
function fromTurn(turn,history,role,proposalTarget){
  const context=notesAround(turn,history);
  const target=proposalTarget&&history.find(r=>r.id===proposalTarget);
  if(target&&!context.some(r=>r.id===target.id))context.unshift(target);
  const source={role,caseId:turn.caseId||'',sessionId:turn.sessionId,materialFingerprint:turn.materialFingerprint||'',sourceId:turn.id,
    title:turn.author==='交付'?turn.display:turn.author+' · '+(turn.tags?.action||'会话原文'),
    setting:localTime(turn.at)+' · '+(turn.scope?.scene||'民事法律会话'),
    detail:turn.targetQuote?'所指意见　'+trim(turn.targetQuote,400):'按当时的顺序保留用户可见的原话和相关交付记录。',
    quote:turn.text,turns:context.map(r=>({who:r.author,text:r.text})),verified:true,
    corrected:turn.author==='用户'&&turn.tags?.action==='纠正'&&Boolean(turn.targetId)};
  return source;
}
function cardForTurn(t,history){
  const {action,nature}=t.tags,target=history.find(r=>r.id===t.targetId);
  if(!['纠正','认可','表达要求','补充事实'].includes(action))return null;
  const kind=nature==='展示方法'?'presentation':action==='补充事实'||action==='认可'?'fact':'legal';
  const topic=t.tags.issues[0]||t.tags.relations[0]||'本次委托';
  const title=label[kind]+' · '+trim(compact(t.text),40);
  const role=kind==='presentation'&&action==='认可'?'recognition':kind==='fact'&&action==='补充事实'?'material':action==='纠正'&&kind==='legal'?'original':'feedback';
  const source=fromTurn(t,history,role,t.targetId);
  // An unresolved pronoun cannot authenticate which finding or format was approved.
  if((action==='认可'||action==='纠正')&&!target)source.verified=false;
  const sources=[source];if(target)sources.push(fromTurn(target,history,target.author==='交付'?'material':'feedback'));
  const src=t.scope||{};
  const scope={...src,caseId:t.caseId,sessionId:t.sessionId};
  return {id:'feedback-'+t.id,kind,title,summary:t.text,relation:kind==='presentation'?'用户反馈与成果表达':kind==='fact'?'本案陈述与材料':topic+'的判断依据',
    change:t.text,before:target?t.targetQuote:'原意见尚待定位。',after:t.text,
    impact:kind==='fact'?'仅保留在本案，维持原有证据状态。':kind==='presentation'?'仅在匹配的报告类型和受众中使用。':'仅在经批准的同组织、同方向新案中作为核对方法。',
    scope,updatedAt:t.at,sources};
}
export function historicalCases(home){
  const dir=path.join(home,'cases');if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.json')).flatMap(e=>{
    const sid=e.name.slice(0,-5);return (readJSON(path.join(dir,e.name),{}).records||[]).map(row=>({sid,row}));
  });
}
/** Receives records from the existing case verifier only; never register this as a raw model tool. */
export function verifiedProposal(home,memory,prepared,packet,sid){
  const cases=historicalCases(home),sources=[];
  if(!prepared?.id||!Array.isArray(prepared.verifiedSources))throw Error('原案、相似案与反例需要逐案核验。');
  for(const e of prepared.verifiedSources){
    const role=roleNames[e.role]||e.role;
    if(!['original','similar','counter'].includes(role))throw Error('验证材料角色无效。');
    const rows=cases.filter(c=>c.row.packet.id===e.caseId&&(!e.sessionId||e.sessionId===c.sid));
    if(rows.length!==1)throw Error('验证案例无法唯一定位。');
    const {sid:sourceSid,row}=rows[0];
    if(row.packet.organization!==packet.organization)throw Error('案例所属组织不同，不能合并为同范围经验。');
    const material=row.packet.sources.find(s=>s.id===e.sourceId);
    if(!material||!compact(e.quote)||!material.text.includes(e.quote))throw Error('验证原句与案件材料不符。');
    const history=memory.turns(sourceSid).filter(t=>t.caseId===e.caseId);
    const corrections=(row.corrections||[]).filter(x=>x.state!=='hypothetical'&&material.id===x.sourceId&&x.quote&&material.text.includes(x.quote));
    const humanFeedback=history.filter(t=>t.author==='用户'&&['纠正','认可'].includes(t.tags?.action));
    const measured=humanFeedback.find(t=>{
      if(!t.targetId)return false;
      const opinion=t.tags.action==='认可'?t.targetQuote:t.text;
      const actual=compact(opinion),claimed=compact(e.after);
      return claimed.length>=4&&actual.includes(claimed);
    });
    const roleVerified=Boolean(packet.organization)&&(role==='original'?corrections.length>0:Boolean(measured));
    const dialogue=measured||humanFeedback.at(-1);
    sources.push({role,caseId:e.caseId,sessionId:sourceSid,sourceId:material.id,materialFingerprint:matterFingerprint(row.packet),title:material.locator||material.kind,
      setting:[row.packet.scene,row.packet.stance,row.packet.stage,material.locator].filter(Boolean).join(' · '),detail:e.reason||'',quote:e.quote,
      turns:[{who:'案件材料',text:material.text},{who:'验证记录 · 原意见',text:e.before},{who:'验证记录 · 调整意见',text:e.after},...(dialogue?notesAround(dialogue,history).map(t=>({who:t.author,text:t.text})):[])],
      verified:roleVerified,corrected:role==='original'&&corrections.length>0,independent:role!=='original'&&roleVerified});
  }
  const original=prepared.verifiedSources.find(e=>['原案','original'].includes(e.role));
  const stamp=new Date().toISOString();
  const identity=[prepared.title,packet.scene,packet.stance,packet.stage,packet.businessKind,packet.taskMode||'contract',packet.organization||''];
  return {id:'cases-'+digestKey(identity).slice(0,24),kind:'legal',title:prepared.title,summary:prepared.change||prepared.relation,
    relation:prepared.relation,change:prepared.change||prepared.relation,before:prepared.before||original?.before,after:prepared.after||original?.after,
    impact:'仅在同一组织、业务、立场、时点及委托类型的新案中供核对。',scope:packetScope({packet},sid),updatedAt:stamp,sources};
}
export function collectProposals(memory,{sessionId,scope,asOf}={}){
  const sid=scope==='session'?sessionId:undefined;
  const available=r=>!asOf||r.at&&r.at<=asOf;
  const history=memory.turns(sid,asOf).filter(available);
  const sessions=new Map();
  for(const t of history){if(!sessions.has(t.sessionId))sessions.set(t.sessionId,[]);sessions.get(t.sessionId).push(t);}
  const cards=new Map();
  for(const t of history){
    if(t.author!=='用户')continue;
    const card=cardForTurn(t,sessions.get(t.sessionId));if(card)cards.set(card.id,card);
  }
  for(const s of memory.suggestions(sid).filter(available)){
    if(s.prepared){cards.set(s.prepared.id,s.prepared);continue;}
    const turns=sessions.get(s.sessionId)||[],target=turns.find(r=>r.id===s.anchor);
    if(!target)continue;
    const derived=target.author==='用户'&&cardForTurn(target,turns);
    const id=derived?.id||('suggestion-'+s.id);
    // The model can suggest change wording; it cannot upgrade a source's role/verification or scope.
    cards.set(id,{id,kind:derived?.kind||'legal',title:s.title,summary:s.text,relation:derived?.relation||'待验证的办理方法',change:s.text,
      before:derived?.before||'待核原判断。',after:s.text,impact:derived?.impact||'来源和适用条件须核实后再决定是否跨案使用。',
      scope:derived?.scope||target.scope||{},updatedAt:s.at,sources:derived?.sources||[fromTurn(target,turns,'feedback')]});
  }
  for(const old of memory.legacy(sid).filter(available)){
    if(!old.caseId||!old.text||!old.id)continue;
    const id='legacy-'+digestKey([old.sessionId,old.id]).slice(0,20);
    cards.set(id,{id,kind:'legal',title:'历史记录待复核 · '+trim(compact(old.text),32),summary:old.text,relation:'旧台账待核',change:old.text,before:'原始认可范围尚待复核。',after:old.text,impact:'历史记录供核对，跨案使用须重新举证并确认。',scope:{...Object.fromEntries(['scene','stance','stage','businessKind','taskMode','caseId','sessionId'].map(k=>[k,old[k]||'']))},updatedAt:old.at,
      sources:[{role:'material',caseId:old.caseId,sessionId:old.sessionId,sourceId:old.id,title:'旧台账原记录',setting:'1.0.0 历史记录',detail:'旧台账未保留完整的反馈目标。',quote:old.quote||old.text,turns:[{who:'旧台账',text:old.text}],verified:false}]});
  }
  return [...cards.values()];
}
