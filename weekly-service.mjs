import {createHash,randomBytes,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {makeWeeklyStore} from './weekly-store.mjs';

const rootPath='/civil-ontology/weekly';
const template=name=>fs.readFileSync(new URL('./weekly-ui/'+name,import.meta.url),'utf8');
const script=template('app.js'),css=template('styles.css'),page=template('page.html');
const scriptHash=createHash('sha256').update(script).digest('base64');
const loopback=h=>['127.0.0.1','localhost','::1','[::1]','::ffff:127.0.0.1'].includes(String(h).toLowerCase());
export function renderWeekly(view,{interactive=false}={}){
  const json=JSON.stringify({...view,interactive}).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const slots={'/*STYLE*/':css,'/*DATA*/':json,'/*SCRIPT*/':script};
  return page.replace(/\/\*(?:STYLE|DATA|SCRIPT)\*\//g,k=>slots[k]);
}
function saveArchive(home,snap,view){
  const directory=path.join(home,'weekly-v101','exports');fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,snap.id+'.html'),temp=file+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,renderWeekly(view),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}
  finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  return file;
}
function send(res,status,data,headers={}){
  res.writeHead(status,{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8',...headers});
  res.end(typeof data==='string'?data:JSON.stringify(data));
}
async function input(req){
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>16384)throw Error('说明超出可保存长度。');chunks.push(Buffer.from(chunk));}
  const val=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!val||typeof val!=='object'||Object.keys(val).some(key=>!['id','version','action','note'].includes(key)))throw Error('取舍内容格式无效。');
  return val;
}
/** The command handler alone asks for a browser navigation grant. Scheduled/tool calls get a standalone read-only export. */
export function registerWeekly(ctx,{home,listProposals}){
  const repo=makeWeeklyStore(home,listProposals),tickets=new Map(),sessions=new Map();
  let origin='';
  function clean(){for(const map of [tickets,sessions])for(const [k,v] of map)if(v.until<=Date.now())map.delete(k);}
  function open({sessionId='',now=new Date(),human=false,scope='week',snapshotId,scheduled=false}={}){
    if(scope==='session'&&!sessionId)throw Error('需要明确会话编号。');
    const snap=snapshotId?repo.snapshot(snapshotId):repo.freeze({sessionId,now,scope,scheduled});
    if(snap.query.scope==='session'&&snap.query.sessionId!==sessionId)throw Error('请从原会话打开这份周报。');
    const view=repo.publicView(snap),file=saveArchive(home,snap,view);
    let url='';
    if(human&&sessionId&&origin){
      clean();const token=randomBytes(32).toString('hex');
      tickets.set(token,{id:snap.id,actor:sessionId,until:Date.now()+10*60e3});
      url=origin+rootPath+'/open/'+token;
    }
    const markdown=['**本体周报**　'+snap.period.start+' 至 '+snap.period.end+'，本期 '+snap.cards.length+' 项提案。',
      url?'[打开本期画布并取舍]('+url+')':'在 DSH 会话输入 /civil-digest，即可打开本人审阅画布。',
      '只读归档　'+file].join('\n\n');
    return {id:snap.id,period:snap.period,count:snap.cards.length,markdown,file,...(url?{url}:{})};
  }
  async function handler(req,res){
    clean();
    if(!origin||!loopback(req.socket?.remoteAddress)||req.headers.host!==new URL(origin).host)return send(res,403,{error:'请从 DSH 本机打开。'});
    const pathname=new URL(req.url,origin).pathname,opening=pathname.match(/^\/civil-ontology\/weekly\/open\/([a-f0-9]{64})$/);
    if(opening&&req.method==='GET'){
      const grant=tickets.get(opening[1]);
      if(!grant||req.headers['sec-fetch-mode']!=='navigate'||!['none','same-origin'].includes(req.headers['sec-fetch-site'])||req.headers['sec-fetch-dest']!=='document'||req.headers['sec-fetch-user']!=='?1')return send(res,403,{error:'请本人在 DSH 中重新打开周报链接。'});
      tickets.delete(opening[1]);const token=randomBytes(32).toString('hex'),viewPath=rootPath+'/view/'+grant.id;
      sessions.set(token,{...grant,until:Date.now()+4*3600e3});
      return send(res,303,'',{Location:viewPath,'Set-Cookie':'civil_'+grant.id+'='+token+'; Path='+viewPath+'; HttpOnly; SameSite=Strict; Max-Age=14400'+(origin.startsWith('https:')?'; Secure':'')});
    }
    const route=pathname.match(/^\/civil-ontology\/weekly\/view\/(w-[0-9a-f]{32})$/);
    if(!route)return send(res,404,{error:'页面不存在。'});
    const id=route[1],cookie=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('civil_'+id+'='));
    const session=sessions.get(cookie?.split('=')[1]);
    if(!session||session.id!==id)return send(res,403,{error:'审阅已结束，请由本人从 DSH 重新打开。'});
    try{
      if(req.method==='GET'){
        const snap=repo.snapshot(id),html=renderWeekly(repo.publicView(snap),{interactive:true});
        return send(res,200,html,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'sha256-"+scriptHash+"'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'"});
      }
      if(req.method!=='POST')return send(res,405,{error:'请求方式无效。'},{Allow:'GET, POST'});
      if(req.headers.origin!==origin||req.headers['sec-fetch-site']!=='same-origin'||req.headers['x-civil-weekly']!=='1'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(res,403,{error:'请在本期周报中提交取舍。'});
      const data=await input(req);
      const receipt=repo.decide({...data,actor:session.actor,snapshotId:id});
      return send(res,200,{receipt:{action:receipt.action,note:receipt.note,at:receipt.at}});
    }catch(e){return send(res,409,{error:e instanceof SyntaxError?'无法解析本次操作。':e.message});}
  }
  if(typeof ctx.inject==='function')ctx.inject(['webServer'],webCtx=>{
    const web=webCtx.webServer,address=new URL(web.getOrigin());
    if(!loopback(address.hostname))return;
    const route={kind:'prefix',path:rootPath,handler};
    if(typeof webCtx.effect==='function')webCtx.effect(()=>web.register(route));else web.register(route);
    origin=address.origin;
  });
  return {open,history:repo.history,guidanceFor:repo.guidanceFor,readView:id=>repo.publicView(repo.snapshot(id))};
}
