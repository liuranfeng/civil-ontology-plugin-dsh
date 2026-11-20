import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const txt=(value,limit=2400)=>typeof value==='string'?value.trim().slice(0,limit):'';
const kinds={legal:'审查方法',enterprise:'企业规则',presentation:'展示方法',fact:'本案事实'};
const roles={original:'原案纠正',similar:'独立相似案',counter:'反例',contract:'原合同',feedback:'会话反馈',recognition:'用户认可',material:'证据材料'};
const dimensions=['scene','stance','stage','businessKind','taskMode','organization','caseId','sessionId','audience','deliverable'];
const exactDimensions=['scene','stance','stage','businessKind','taskMode','organization'];
const modeLabels={contract:'合同审查',consult:'法律咨询',research:'类案检索'};
const publicSources={original:'原案纠正记录',similar:'独立相似案验证记录',counter:'改变判断的反例记录',contract:'合同材料',feedback:'办理反馈',recognition:'成果认可记录',material:'核验材料'};
function evidenceView(card){
  // Source titles can themselves be party names, quotes, local paths or client-specific locators.
  // Expose only approved purpose and a controlled material description outside the review snapshot.
  const scope=card.kind==='fact'?'原会话的本案事项':card.kind==='presentation'?'同一组织、任务、读者与交付类型':'同一组织、业务方向、任务、立场与时点';
  const title=[modeLabels[card.scopeFields.taskMode],kinds[card.kind]].filter(Boolean).join(' · ');
  const sources=card.sources.filter(s=>s.verified).map(s=>{
    const material=['合同','附件','表单','判决','报告','邮件','清单','制度'].find(kind=>s.title.includes(kind));
    const base=publicSources[s.roleKey]||'核验材料';
    return {role:roles[s.roleKey]||'证据材料',title:material?base+' · '+material:base};
  });
  return {title,scope,gate:'证据已核验，并由本人采纳此版本。',sources};
}
function immutable(file,record){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.'+randomUUID()+'.tmp';
  try{
    fs.writeFileSync(tmp,JSON.stringify(record),{flag:'wx',mode:0o600});
    try{fs.linkSync(tmp,file);return record;}
    catch(e){if(e.code!=='EEXIST')throw e;return read(file);}
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
function files(dir){return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>read(path.join(dir,n))):[];}
function gate(kind,scope,sources,conflict){
  if(conflict)return '冲突尚待核实，需先查清适用条件或制度版本。';
  const verified=sources.filter(s=>s.verified);
  if(kind==='legal'||kind==='enterprise'){
    if(!exactDimensions.every(key=>scope[key]))return '需补齐业务、任务、当事人立场、时点和适用组织。';
    const orig=verified.filter(s=>s.roleKey==='original'&&s.corrected);
    const sim=verified.filter(s=>s.roleKey==='similar'&&s.independent);
    const ctr=verified.filter(s=>s.roleKey==='counter'&&s.independent);
    if(!orig.length)return '缺少附原文的原案纠正。';
    if(!sim.length)return '缺少经独立验证的相似案。';
    if(!ctr.length)return '缺少能够改变结论的独立反例。';
    const independent=(a,b,c)=>[a,b,c].every(s=>s.caseId&&s.materialFingerprint)&&new Set([a,b,c].map(s=>s.caseId)).size===3&&new Set([a,b,c].map(s=>s.materialFingerprint)).size===3;
    if(!orig.some(a=>sim.some(b=>ctr.some(c=>independent(a,b,c)))))return '请核对三案是否各有独立的案件和材料。';
    if(kind==='enterprise'&&!verified.some(s=>s.roleKey==='material'||s.roleKey==='contract'))return '需核实适用组织的制度原文及版本。';
  }else if(kind==='presentation'){
    if(!scope.audience||!scope.deliverable||!scope.taskMode||!scope.organization)return '需要明确适用组织、交付类型、读者和任务。';
    if(!verified.some(s=>s.roleKey==='recognition'))return '需要用户对具体成果或写法表示认可的原话。';
  }else if(kind==='fact'){
    if(!scope.caseId||!scope.sessionId||!verified.some(s=>s.caseId===scope.caseId&&s.sessionId===scope.sessionId))return '需要定位原案、会话和对应材料原句。';
  }else return '提案类型待核。';
  return '';
}
export function prepareWeeklyCard(proposal){
  const kind=proposal?.kind;
  if(!Object.hasOwn(kinds,kind)||!txt(proposal.id)||!txt(proposal.title))throw Error('提案缺少明确的类型、名称或来源。');
  const id='p-'+hash(proposal.id).slice(0,24);
  const scope=Object.fromEntries(dimensions.map(k=>[k,txt(proposal.scope?.[k],250)]));
  const sources=(Array.isArray(proposal.sources)?proposal.sources:[]).map((raw,i)=>{
    const roleKey=Object.hasOwn(roles,raw.role)?raw.role:'material';
    const quote=txt(raw.quote,4000);
    const turns=(raw.turns||[]).map(t=>({who:txt(t.who,80),text:typeof t.text==='string'?t.text.trim():''})).filter(t=>t.who&&t.text);
    const verified=raw.verified===true&&!!quote&&turns.some(t=>t.text.includes(quote));
    return {id:id+'-s'+i,roleKey,role:roles[roleKey],title:txt(raw.title,240)||roles[roleKey],setting:txt(raw.setting,360),
      detail:txt(raw.detail)||'来源的时间与情境见下列原文。',turns,quote,verified,corrected:verified&&raw.corrected===true,
      independent:verified&&raw.independent===true,caseId:txt(raw.caseId,250),sessionId:txt(raw.sessionId,250),materialFingerprint:txt(raw.materialFingerprint,250)};
  });
  const gap=gate(kind,scope,sources,proposal.conflict);
  const boundary=[scope.organization,modeLabels[scope.taskMode]||scope.taskMode,scope.scene,scope.stance,scope.stage,scope.businessKind,kind==='fact'?scope.caseId:'',scope.audience,scope.deliverable].filter(Boolean);
  const impact=kind==='fact'?'只随本案保存，供本案后续核查。':kind==='presentation'?'只在相同组织、任务、读者和交付类型中使用此表达方法。':'供匹配所列组织、业务、任务、立场及时点的新案核对，后案仍须引用自身材料。';
  const card={id,kind,title:txt(proposal.title,200),summary:txt(proposal.summary),category:scope.businessKind||scope.scene||'待核事项',
    relation:txt(proposal.relation,240)||kinds[kind],type:kinds[kind],scope:boundary.join(' · ')||'适用范围待核',scopeFields:scope,
    change:txt(proposal.change),before:txt(proposal.before),after:txt(proposal.after),impact,ready:!gap,gate:gap||'所需证据已定位，请本人核验充分性并取舍。',sources};
  card.version=hash(card);return card;
}
export function weeklyPeriod(now=new Date()){
  const chinaDay=new Date(new Date(now).getTime()+8*3600e3);
  const date=new Date(Date.UTC(chinaDay.getUTCFullYear(),chinaDay.getUTCMonth(),chinaDay.getUTCDate()));
  const monday=new Date(date);monday.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
  const thu=new Date(monday);thu.setUTCDate(monday.getUTCDate()+3);
  const weekYear=thu.getUTCFullYear();
  const weekNumber=1+Math.floor((thu-Date.UTC(weekYear,0,1))/(7*864e5));
  const sunday=new Date(monday);sunday.setUTCDate(monday.getUTCDate()+6);
  return {year:weekYear,number:weekNumber,start:monday.toISOString().slice(0,10),end:sunday.toISOString().slice(0,10)};
}
export function makeWeeklyStore(home,listProposals){
  const root=path.join(home,'weekly-v101'),snapDir=path.join(root,'snapshots'),receiptDir=path.join(root,'decisions');
  function snapshot(id){if(!/^w-[0-9a-f]{32}$/.test(id))throw Error('周报编号无效。');return read(path.join(snapDir,id+'.json'));}
  const receiptFile=c=>path.join(receiptDir,c.id+'-'+c.version+'.json');
  function decisionFor(c){const f=receiptFile(c);return fs.existsSync(f)?read(f):null;}
  function current(query){
    const cards=listProposals(query).map(prepareWeeklyCard).sort((a,b)=>a.id.localeCompare(b.id));
    if(new Set(cards.map(c=>c.id)).size!==cards.length)throw Error('重复提案编号，请重新核对来源。');
    return cards;
  }
  function freeze({sessionId,scope='week',now=new Date(),scheduled=false}){
    const period=weeklyPeriod(now),query={sessionId:scope==='session'?sessionId:'',scope};
    // A Saturday on-demand preview must not consume material for the following Friday's scheduled issue.
    const previous=files(snapDir).filter(s=>s.query.scope===query.scope&&s.query.sessionId===query.sessionId&&s.period.start<period.start&&(!scheduled||s.scheduled===true));
    const known=new Set(previous.flatMap(s=>s.cards.map(c=>c.id+':'+c.version)));
    const cutoff=new Date(now).toISOString();
    const cards=current({...query,asOf:cutoff}).filter(c=>!known.has(c.id+':'+c.version));
    const id='w-'+hash([query,period.start,scheduled,scheduled?cutoff:'',cards.map(c=>[c.id,c.version])]).slice(0,32);
    return immutable(path.join(snapDir,id+'.json'),{id,query,period,scheduled,cutoff,generated:new Date().toISOString(),cards});
  }
  function publicView(snap){
    return {id:snap.id,period:snap.period,generated:snap.generated,cutoff:snap.cutoff||snap.generated,scheduled:!!snap.scheduled,candidates:snap.cards.map(c=>{
      const {scopeFields,...view}=c;const decision=decisionFor(c);
      return {...view,decision:decision&&{action:decision.action,note:decision.note,at:decision.at}};
    })};
  }
  function decide({snapshotId,id,version,action,note='',actor}){
    if(!actor||!['accepted','declined','revision'].includes(action)||typeof note!=='string'||note.length>2000||action==='revision'&&!note.trim())throw Error('请核对本人的操作与说明。');
    const snap=snapshot(snapshotId),card=snap.cards.find(c=>c.id===id&&c.version===version);
    if(!card)throw Error('此提案与本期展示版本不一致。');
    const verifyExisting=receipt=>{if(receipt.action!==action||receipt.note!==note.trim())throw Error('此版本已有另一项取舍，请刷新页面。');return receipt;};
    const existing=decisionFor(card);if(existing)return verifyExisting(existing);
    const actual=current(snap.query).find(c=>c.id===id);
    if(!actual||actual.version!==version)throw Error('证据或适用范围已经变化，请重新打开最新周报。');
    if(action==='accepted'&&!actual.ready)throw Error(actual.gate);
    const receipt={snapshotId,id,version,action,note:note.trim(),actor,at:new Date().toISOString()};
    return verifyExisting(immutable(receiptFile(card),receipt));
  }
  function guidanceFor(packet,sessionId){
    const newest=new Map();
    for(const r of files(receiptDir).filter(r=>r.action==='accepted').sort((a,b)=>a.at.localeCompare(b.at))){
      const card=snapshot(r.snapshotId).cards.find(c=>c.id===r.id&&c.version===r.version);
      if(card?.ready)newest.set(card.id,card);
    }
    return [...newest.values()].filter(c=>{
      const s=c.scopeFields;
      if(c.kind==='fact')return s.caseId===packet.id&&s.sessionId===sessionId;
      const keys=c.kind==='presentation'?['deliverable','audience','organization','taskMode']:exactDimensions;
      return keys.every(k=>s[k]&&s[k]===packet[k]);
    }).map(c=>({title:c.title,relation:c.change||c.summary,scope:c.scope,counter:c.impact,kind:c.kind,id:c.id,version:c.version,evidenceView:evidenceView(c)}));
  }
  function history(sessionId){
    return files(snapDir).filter(s=>s.query.scope==='week'||s.query.sessionId===sessionId)
      .sort((a,b)=>b.generated.localeCompare(a.generated)).map(s=>({id:s.id,generated:s.generated,count:s.cards.length,period:s.period}));
  }
  return {freeze,snapshot,history,publicView,decide,guidanceFor};
}
