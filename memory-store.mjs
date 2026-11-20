import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const TAGS=['事实','成果','技能','取舍'];
export const digestKey=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function readJSON(file,fallback){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}
}
export function saveJSON(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,JSON.stringify(value),{flag:'wx'});fs.renameSync(tmp,file);}
  finally{fs.rmSync(tmp,{force:true});}
}
function filesAt(dir,ext){
  try{return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>ext?e.isFile()&&e.name.endsWith(ext):e.isDirectory()).map(e=>path.join(dir,e.name));}
  catch(e){if(e.code==='ENOENT')return [];throw e;}
}
export function makeMemory(home){
  const root=path.join(home,'memory','v101');
  const folder=sid=>path.join(root,'sessions',digestKey(sid));
  const sessionDirs=sid=>sid?[folder(sid)]:filesAt(path.join(root,'sessions'));
  function list(group,sessionId){
    return sessionDirs(sessionId).flatMap(dir=>filesAt(path.join(dir,group),'.json').map(f=>readJSON(f,null)))
      .filter(Boolean).sort((a,b)=>a.at.localeCompare(b.at)||(a.seq||0)-(b.seq||0)||a.id.localeCompare(b.id));
  }
  function record(group,input,key){
    if(typeof input.sessionId!=='string'||!input.sessionId.length)throw Error('缺少会话身份。');
    const id='m-'+digestKey([group,input.sessionId,key]).slice(0,24);
    const file=path.join(folder(input.sessionId),group,id+'.json');
    const previous=readJSON(file,null);if(previous)return previous;
    const row={...input,id,at:input.at||new Date().toISOString()};
    // Link a fully-written file without replacing another worker's identical event.
    fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(tmp,JSON.stringify(row),{flag:'wx'});try{fs.linkSync(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;}}
    finally{fs.rmSync(tmp,{force:true});}
    return readJSON(file,row);
  }
  const bindingKey=t=>digestKey([t.sessionId,t.episode,t.turn]);
  function turns(sid,asOf){
    const assignments=new Map();
    for(const b of list('bindings',sid)){if(asOf&&b.at>asOf)continue;const k=bindingKey(b);
      if(assignments.has(k)&&assignments.get(k)?.caseId!==b.caseId)assignments.set(k,null);else assignments.set(k,b);}
    return list('turns',sid).filter(t=>!asOf||t.at<=asOf).map(t=>{
      const k=bindingKey(t);if(!assignments.has(k))return t;
      const b=assignments.get(k);
      return b?{...t,scope:b.scope,caseId:b.caseId,materialFingerprint:b.materialFingerprint}:{...t,scope:{sessionId:t.sessionId},caseId:'',materialFingerprint:''};
    });
  }
  const suggestions=sid=>list('suggestions',sid);
  const legacy=sid=>(readJSON(path.join(home,'memory','ledger.json'),{items:[]}).items||[])
    .filter(x=>(!sid||x.sessionId===sid)&&x.status!=='rejected');
  function saveIntent(sid,active){
    const file=path.join(folder(sid),'context.json');
    if(!active&&!fs.existsSync(file))return;
    saveJSON(file,{active:Boolean(active)});
  }
  return {root,turns,suggestions,legacy,
    isActive:sid=>Boolean(sid&&readJSON(path.join(folder(sid),'context.json'),{}).active),
    saveIntent,
    bindCase:input=>record('bindings',input,[input.episode,input.turn,input.caseId]),
    addTurn:input=>record('turns',input,input.eventKey),
    addSuggestion:(input,key)=>record('suggestions',input,key)};
}
