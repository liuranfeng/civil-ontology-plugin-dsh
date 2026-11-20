import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {captureText,textOf,segments,classify,feedbackTarget,attachments,packetScope,matterFingerprint} from './memory-context.mjs';
import {TAGS,digestKey,readJSON,saveJSON} from './memory-store.mjs';
import {collectProposals,verifiedProposal} from './memory-digest.mjs';
import {registerWeekly} from './weekly-service.mjs';

export {captureText};
export const WEEKLY_TITLE='民事本体周报';
const defaults={time:'18:00:00',timeZone:'Asia/Shanghai',enabled:true};
const control=/民事本体|本体(?:图|关系图|周报|画布)|周报画布/;
const sidOf=a=>a?.session?.id||a?.id;
const when=stamp=>Number.isFinite(stamp)?new Date(stamp).toISOString():new Date().toISOString();
const scheduleStamp=(now,time)=>{
  const sh=new Date(new Date(now).getTime()+8*3600e3),days=(sh.getUTCDay()+2)%7;
  const [hours,minutes]=time.split(':').map(Number);
  const end=Date.UTC(sh.getUTCFullYear(),sh.getUTCMonth(),sh.getUTCDate()-days,hours-8,minutes);
  return end>+new Date(now)?end-7*86400e3:end;
};
function splitFeedback(text){
  // Keep unlabelled continuations (conditions, explanations and numbers) with their preceding assertion.
  const chunks=text.match(/[^，,；;。！？!?\n]+[，,；;。！？!?]?/g)||[text],out=[];
  for(const chunk of chunks){const val=chunk.trim();if(!val)continue;
    if(out.length&&classify(val).action==='提问或陈述')out[out.length-1]+=val;else out.push(val);}
  return out;
}
export function registerMemory(ctx,{home,memory,tool,session,store,config={}}){
  const root=memory.root,settingsFile=path.join(home,'memory','weekly.json'),cursorFile=path.join(root,'schedule-cursor.json');
  const settings=()=>({...defaults,...readJSON(settingsFile,{})});
  const runtime=new Map();
  const weekly=registerWeekly(ctx,{home,listProposals:query=>collectProposals(memory,query)});
  function getRow(sid){try{return store.get(sid);}catch{return null;}}
  function ctxFor(sid){if(!runtime.has(sid))runtime.set(sid,{civil:memory.isActive(sid),episode:null,turn:null,hadOther:false});return runtime.get(sid);}
  function bindCase(sid,packet){
    const c=ctxFor(sid);if(config.capture===false||!c.civil||!c.episode||c.turn==null)return;
    memory.bindCase({sessionId:sid,episode:c.episode,turn:c.turn,scope:packetScope({packet},sid),caseId:packet.id,materialFingerprint:matterFingerprint(packet)});
  }
  function classifyInput(sid,message,turn,{persist=true}={}){
    if(!sid)return;
    const text=captureText(message);if(!text||text.startsWith('/'))return;
    const c=ctxFor(sid),was=c.follow??c.civil,files=attachments(message);
    const intent=segments(text,was,files),matched=control.test(text);
    if(matched&&!intent.parts.length)intent.parts=[text];
    c.follow=matched||intent.active;c.civil=c.follow||intent.parts.length>0;c.turn=turn;
    const entirelyCivil=intent.parts.join('').replace(/\s/g,'')===text.replace(/\s/g,'');
    c.hadOther=c.civil&&!entirelyCivil;
    const prior=was||memory.isActive(sid);
    if(!c.episode||!prior){
      const last=prior?memory.turns(sid).at(-1):null;c.episode=last?.episode||randomUUID();
    }
    memory.saveIntent(sid,c.follow);
    if(!c.civil||!persist||config.capture===false)return;
    const row=getRow(sid),scope=packetScope(row,sid),history=memory.turns(sid);
    const stamp=when(message.time),origin=message.id||message.messageId||digestKey([turn,text]);
    const last=history.findLast(t=>t.episode===c.episode&&t.author==='用户');
    const same=history.filter(t=>t.episode===c.episode&&(!scope.caseId||!t.caseId||scope.caseId===t.caseId));
    const joined=intent.parts.join(''),parts=splitFeedback(joined);
    for(const [i,part] of parts.entries()){
      const tags=classify(part),feedback=['认可','纠正','表达要求'].includes(tags.action);
      memory.addTurn({sessionId:sid,caseId:scope.caseId,scope,episode:c.episode,turn,seq:i,at:stamp,
        eventKey:'user-'+origin+'-'+i,author:'用户',audience:'模型',text:part,tags,files,
        ...(feedback?feedbackTarget(part,same,last):{}),materialFingerprint:matterFingerprint(row?.packet)});
    }
  }
  function committed(subject,event){
    const sid=sidOf(subject),data=event?.data;
    if(!sid||!data||config.capture===false||!['assistant/message','deliverables/presented'].includes(event.type))return;
    const c=ctxFor(sid);if(!c.civil||!c.episode)return;
    // Only settle outputs belonging to the classified turn. No background jobs, private reasoning or tool arguments.
    if(c.turn!==null&&data.turn!==undefined&&data.turn!==c.turn)return;
    const row=getRow(sid),scope=packetScope(row,sid);
    const common={sessionId:sid,scope,caseId:scope.caseId,episode:c.episode,turn:data.turn??c.turn,seq:event.seq,at:when(event.time),materialFingerprint:matterFingerprint(row?.packet)};
    if(event.type==='assistant/message'){
      let text=textOf(data.message);if(c.hadOther)text=segments(text,false).parts.join('');
      if(text)memory.addTurn({...common,eventKey:'answer-'+event.seq,author:'模型',audience:'用户',text,tags:{action:'公开答复',nature:'成果'},version:'答复 '+event.seq});
    }else{
      for(const [i,f] of (data.files||[]).entries()){
        const name=path.win32.basename(f.path||f.name||'');if(!name||c.hadOther&&!segments(name,false).parts.length)continue;
        const desc=String(f.description||'');memory.addTurn({...common,eventKey:'file-'+event.seq+'-'+i,author:'交付',audience:'用户',display:name,text:[name,desc].filter(Boolean).join('\n'),tags:{action:'已交付',nature:'成果'},version:'交付 '+event.seq+' · '+name});
      }
    }
  }
  function scheduled(now=new Date()){
    const cfg=settings();if(!cfg.enabled)return [];
    const due=scheduleStamp(now,cfg.time),cursor=readJSON(cursorFile,null);
    if(!cursor){saveJSON(cursorFile,{last:due});return [];}
    const reports=[];
    for(let next=cursor.last+7*86400e3;next<=due;next+=7*86400e3){
      reports.push(weekly.open({sessionId:'',now:new Date(next),scheduled:true}));saveJSON(cursorFile,{last:next});
    }
    return reports;
  }
  function safeSchedule(){try{scheduled();}catch(error){ctx.logger?.warn?.('本体周报生成待重试：'+error.message);}}
  if(typeof ctx.on==='function'){
    ctx.on('agent/inbox/claimed',({agent,message,turn}={})=>{
      const sid=sidOf(agent);if(!sid)return;
      if(message?.source?.kind!=='user'){const c=ctxFor(sid);if(c.turn!==turn){c.civil=false;c.turn=turn;}return;}
      classifyInput(sid,message,turn);
    });
    ctx.on('session/event',committed);
    if(typeof ctx.effect==='function'){ctx.effect(()=>{safeSchedule();const t=setInterval(safeSchedule,60000);t.unref?.();return ()=>clearInterval(t);});}
  }
  const status=()=>{const cfg=settings();return '本体周报　'+(cfg.enabled?'每周五 '+cfg.time.slice(0,5)+'（北京时间）':'定时生成已关闭')+'。本人输入 /civil-digest 审阅当期画布，/civil-week 设置时间。';};
  function guidanceFor(packet,sid){
    return weekly.guidanceFor(packet,sid).map(r=>({...r,type:r.kind==='presentation'?'presentation':r.kind==='fact'?'case':'legal',text:r.relation||r.title}));
  }
  function addVerifiedExperience(prepared,packet,sid){
    const fallbackTitle=prepared.title||prepared.guidance?.title;
    const proposal=verifiedProposal(home,memory,{...prepared,title:fallbackTitle},packet,sid);
    const {updatedAt,...version}=proposal;
    const note=memory.addSuggestion({sessionId:sid,prepared:proposal},[proposal.id,digestKey(version)]);
    return {id:note.prepared.id,markdown:'已把「'+proposal.title+'」及案件材料列入周报待审。法务可输入 /civil-digest 查看。'};
  }
  ctx.tools.register(tool('civil_memory_note','仅提出候选。quote 摘引本会话中实际发生的用户或模型公开原话；关系、证据是否齐备、生效范围由本地程序核定。',
    {tag:{type:'string',enum:TAGS},text:{type:'string'},quote:{type:'string'},title:{type:'string'},sourceId:{type:'string'}},['tag','text','quote'],(args,exec)=>{
      const sid=session(exec);if(!ctxFor(sid).civil)throw Error('请先明确当前民事委托。');
      const row=getRow(sid),history=memory.turns(sid).filter(t=>t.episode===ctxFor(sid).episode&&(!row||t.caseId===row.packet.id||!t.caseId));
      const quote=String(args.quote||'').trim(),val=String(args.text||'').trim();if(quote.length<4||!val||val.length>4000)throw Error('请提供四字以上逐字来源及简明的拟议变化。');
      const matches=history.filter(t=>t.text.includes(quote)&&(!args.sourceId||args.sourceId===t.id));
      if(matches.length!==1)throw Error('请提供可在本会话中唯一定位的公开原句。');
      const t=matches[0],title=(args.title||val).slice(0,100);
      const s=memory.addSuggestion({sessionId:sid,title,text:val,anchor:t.id,tag:args.tag},[t.id,val]);
      return {markdown:'已作为待审提议保存，后案使用范围由证据和本人取舍决定。',id:s.id};
    }));
  ctx.tools.register(tool('civil_memory_digest','生成当前会话的只读 HTML 周报。全域周报及取舍仅从本人的 /civil-digest 命令进入。',{},[],(_args,exec)=>weekly.open({scope:'session',sessionId:session(exec)})));
  ctx.tools.register(tool('civil_memory_recall','按本案实际登记的范围查看已批准的同类经验。',{},[],(_args,exec)=>{
    const sid=session(exec),p=getRow(sid)?.packet;const items=p?guidanceFor(p,sid):[];
    return {markdown:items.map(r=>r.title+'　'+r.text).join('\n')||'本案尚无匹配的已采纳经验。'};
  }));
  ctx.tools.register(tool('civil_memory_status','查看周报安排和审阅入口。',{},[],()=>({markdown:status()})));
  if(typeof ctx.inject==='function')ctx.inject(['commands'],c=>{
    const register=(name,description,run,input)=>c.commands.register({name,description,...(input?{input:{hint:input}}:{}),handler:async ctx=>{
      try{return {kind:'success',text:await run(ctx)};}catch(e){return {kind:'error',text:e.message};}
    }});
    register('civil','查看民事本体和周报安排。',status);
    register('civil-digest','打开本人当期周报、历史清单或往期画布。',({agent,rawInput})=>{
      const sessionId=sidOf(agent),arg=String(rawInput||'').trim();
      if(arg==='history'){const rows=weekly.history(sessionId);return rows.map(r=>r.period.start+' 至 '+r.period.end+'　'+r.count+' 项　/civil-digest '+r.id).join('\n')||'暂无历史周报。';}
      if(arg&&!/^w-[a-f0-9]{32}$/.test(arg))throw Error('使用 /civil-digest、/civil-digest history，或从往期清单选择编号。');
      return weekly.open({sessionId,human:true,...(arg?{snapshotId:arg}:{})}).markdown;
    },'history 或往期编号，可留空');
    register('civil-week','设置每周五的报告时间。',({rawInput})=>{
      const s=String(rawInput||'').trim();if(!s)return status();
      const cfg=settings();
      if(s==='off'){saveJSON(settingsFile,{...cfg,enabled:false});return status();}
      if(!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s))throw Error('请填写 24 小时制时间，如 18:30。');
      const time=s.padStart(5,'0')+':00';saveJSON(settingsFile,{...cfg,time,enabled:true});saveJSON(cursorFile,{last:scheduleStamp(new Date(),time)});return status();
    },'HH:mm 或 off');
    for(const n of ['civil-apply','civil-drop'])register(n,'在本人周报画布逐项取舍。',()=> '请使用 /civil-digest 打开当期画布，逐项查看证据并取舍。');
  });
  return {ensureWeekly:async()=>{safeSchedule();return {ok:true};},isCivilContext:sid=>Boolean(sid&&ctxFor(sid).civil),bindCase,guidanceFor,addVerifiedExperience,
    digest:weekly.open,status,scheduled,readView:weekly.readView};
}
