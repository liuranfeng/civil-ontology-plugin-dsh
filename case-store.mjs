
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function key(x){if(typeof x!=='string'||!/^[\p{L}\p{N}-]{1,100}$/u.test(x))throw Error('无效标识');return x;}
function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
function save(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(value,null,2),{flag:'wx'});
  fs.renameSync(tmp,file);
}
export const taskModeOf=packet=>packet.taskMode??'contract';
function retainTaskMode(packet,previous){
  if(!previous)return packet;
  const oldMode=taskModeOf(previous);
  if(packet.taskMode==null)return oldMode==='contract'?packet:{...packet,taskMode:oldMode};
  if(packet.taskMode!==oldMode)throw Error('同一案件编号不能改作其他法律任务；请另立案件编号。');
  return packet;
}
function matches(s,p){return taskModeOf(s)==='contract'&&taskModeOf(p)==='contract'&&s.scene===p.scene&&s.stance===p.stance&&(s.businessKind===undefined||s.businessKind===p.businessKind);}
const eligible=rows=>Array.isArray(rows)&&rows.length>0&&rows.every(x=>x&&typeof x.id==='string'&&x.pass===true);
export function makeStore(root){
  const home=path.resolve(root),cases=id=>path.join(home,'cases',key(id)+'.json'),proof=id=>path.join(home,'proof',key(id)+'.json');
  const active=path.join(home,'approved.json'),versions=()=>read(active,[]);
  const getState=session=>read(cases(session),{active:null,records:[]});
  const get=session=>{ const state=getState(session); return state.records.find(row=>row.packet.id===state.active)||null; };
  function open(session,packet,{refresh=false}={}){
    const state=getState(session);
    const before=state.records.find(row=>row.packet.id===packet.id);
    packet=retainTaskMode(packet,before?.packet);
    if(before&&!refresh){
      const supplied=new Map(packet.sources.map(s=>[s.id,s]));
      const recorded=new Map(before.packet.sources.map(s=>[s.id,s]));
      for(const [id,old] of recorded){
        const next=supplied.get(id);
        if(next&&(next.text!==old.text||next.kind!==old.kind||next.locator!==old.locator))
          throw Error('同一材料编号已用于另一段原文或出处。补入新版本时请使用新编号，并注明文件版本。');
      }
      const added=packet.sources.filter(s=>!recorded.has(s.id));
      if(!added.length)return put(session,before);
      const sources=[...before.packet.sources,...added];
      if(sources.length>48)throw Error('合并后的案件上限为48条材料，请在开案前按同一出处整理相关分句。');
      return put(session,{...before,packet:{...before.packet,sources},agentRecord:undefined,companyNotes:[],termNotes:[]});
    }
    if(!before&&refresh)throw Error('重审要求匹配已有案件');
    if(!before){
      const duplicate=state.records.find(r=>r.methodReviews?.length&&taskModeOf(r.packet)===taskModeOf(packet)&&
        r.packet.scene===packet.scene&&r.packet.stance===packet.stance&&r.packet.stage===packet.stage&&
        r.packet.sources.every(s=>packet.sources.some(p=>p.text===s.text&&p.locator===s.locator&&p.kind===s.kind)));
      if(duplicate)throw Error('本会话已登记同一事项的全部原有材料。请使用原案件编号「'+duplicate.packet.id+'」续办；独立委托可在新会话开案。');
    }
    const applied=versions().filter(v=>matches(v.scope,packet));
    const row={packet,version:applied.at(-1)?.version||'v1',rules:applied.map(v=>v.rule),revision:0,corrections:[]};
    if(before?.packet.id===packet.id){row.revision=before.revision;row.corrections=before.corrections;row.methodReviews=before.methodReviews;row.methodBatch=before.methodBatch;}
    return put(session,row);
  }
  function put(session,row){
    const state=getState(session);
    const previous=state.records.find(r=>r.packet.id===row.packet.id);
    const packet=retainTaskMode(row.packet,previous?.packet);
    const next=packet===row.packet?row:{...row,packet};
    state.active=packet.id;
    state.records=state.records.filter(r=>r.packet.id!==packet.id);
    state.records.push(next);
    save(cases(session),state);
    return next;
  }
  function stage(c){
    key(c?.id);
    if(c.rule!=='schedule-document-priority'||c.scope?.scene!=='采购业务'||c.scope?.stance!=='买方'||taskModeOf(c.scope)!=='contract'||!c.observation?.trim()||!c.reason?.trim())throw Error('采购专项经验限于采购合同审查，且需注明适用范围、观察和理由。');
    if(read(proof(c.id),null)?.state==='published')throw Error('已发布记录使用新的候选 ID');
    const {support=[],counter=[],regression=[]}=c.evidence||{};
    const ids=[...support,...counter,...regression].map(x=>x.id);
    if(new Set(ids).size!==ids.length)throw Error('案例跨组复用');
    const proven=[support,counter,regression].every(eligible);
    const value={...c,state:proven?'awaiting-user':'collecting',version:'wc-'+digest(c).slice(0,12)};
    if(proven)value.confirmation=digest(value).slice(0,20);
    save(proof(c.id),value);return value;
  }
  function publish(id,token){
    const candidate=read(proof(id),null);
    if(!candidate||candidate.state!=='awaiting-user'||!token||candidate.confirmation!==token)throw Error('需要对应审阅版本的明确确认');
    const current=versions();
    if(!current.some(x=>x.version===candidate.version))save(active,[...current,{id,scope:candidate.scope,rule:candidate.rule,version:candidate.version,confirmedAt:new Date().toISOString()}]);
    save(proof(id),{...candidate,state:'published'});
    return candidate.version;
  }
  return {home,get,open,put,stage,publish,candidate:id=>read(proof(id),null)};
}

