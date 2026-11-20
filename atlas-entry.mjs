import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { renderOntology } from './ontology-view.mjs';
import { commandAction, commandError, commandResult } from './command-result.mjs';

const routePath = '/civil-ontology/atlas';
const casePath = '/civil-ontology/case/open';
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const atlasAction = commandAction('查看基础本体','/civil-map');
const caseAction = commandAction('重新查看本案','/civil-map case');
const htmlHeaders = {'content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff','cache-control':'private, no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"};

/** The public atlas is derived from the bundled catalog. A case export is only reachable via a user-issued, expiring link. */
export function registerAtlas(ctx, { home, tool, experienceFor }) {
  let html, address, file;
  const caseGrants = new Map();
  function pruneCases() {
    for(const [token,grant] of caseGrants)if(grant.expires<=Date.now())caseGrants.delete(token);
  }
  const content = () => html ??= renderOntology();
  function exportFile(scopedBody) {
    if (!scopedBody && file && fs.existsSync(file)) return file;
    const body = scopedBody || content();
    const version = createHash('sha256').update(body).digest('hex').slice(0, 16);
    const directory = path.join(home, 'atlas');
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, '民事法律关系本体-' + version + '.html');
    if (!fs.existsSync(target)) {
      const temporary = path.join(directory, randomUUID() + '.tmp');
      try {
        fs.writeFileSync(temporary, body, { flag: 'wx' });
        fs.renameSync(temporary, target);
      } finally { fs.rmSync(temporary, { force: true }); }
    }
    if (!scopedBody) file = target;
    return target;
  }
  function view() {
    const report = exportFile();
    const url = address || pathToFileURL(report).href;
    return { report, url, markdown: '[打开民事法律关系本体图](<' + url + '>)' };
  }
  ctx.tools.register(tool('civil_open_map', '打开插件自带的民事法律关系图。直接呈现返回的链接，页面和连线由知识库固定生成。', {}, [], view));
  ctx.inject(['commands'], c => c.commands.register({
    name: 'civil-map', description: '查看民事法律关系本体图和原始知识依据。',
    input:{hint:'留空查看基础本体；case 查看本案可用经验'},
    handler({agent,rawInput}={}) {
      const arg=String(rawInput||'').trim();
      try{if(arg==='case'){
        const matched=experienceFor?.(agent?.session?.id||agent?.id);
        if(!matched)return commandResult({title:'本案适用的经验',summary:'请先在本会话登记具体委托，再查看本案适用的已批准经验。',actions:[caseAction,atlasAction]});
        const report=exportFile(renderOntology(matched));
        const summary=matched.length?'本案有 '+matched.length+' 项适用的已批准经验。':'本案暂无适用的已批准经验。';
        if(!address)return commandResult({title:'本案适用的经验',summary,details:['只读文档已生成，待 DSH 本机网页服务就绪后可以在会话打开。'],actions:[caseAction,atlasAction]});
        pruneCases();
        const token=randomBytes(32).toString('hex');
        caseGrants.set(token,{report,expires:Date.now()+10*60_000});
        const url=new URL(casePath+'/'+token,address).href;
        return commandResult({title:'本案适用的经验',summary,actions:[{label:'打开本案关系图',href:url},caseAction,atlasAction]});
      }
      if(arg)throw Error('使用 /civil-map 或 /civil-map case。');
      view();
      return commandResult({title:'民事法律关系本体图',summary:'查看民事法律关系、请求权和相互关联的知识依据。',
        details:address?[]:['待 DSH 本机网页服务就绪后，可重新查看本体图。'],
        actions:[...(address?[{label:'打开本体图',href:routePath}]:[atlasAction]),caseAction]});
      }catch(e){return commandError(arg==='case'?'本案适用的经验':'民事法律关系本体图',e,[atlasAction,caseAction]);}
    }
  }));
  ctx.inject(['webServer'], c => {
    const web=c.webServer;
    if (!web?.register || !web.getOrigin) return;
    const origin = new URL(web.getOrigin());
    if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)) return;
    const bind = () => web.register({kind:'exact',path:routePath,handler(req,res){
      if (!loopback.has(req.socket?.remoteAddress) || req.headers?.host !== origin.host) {res.writeHead(403);res.end();return;}
      if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{'allow':'GET, HEAD'});res.end();return;}
      res.writeHead(200,htmlHeaders);
      res.end(req.method === 'HEAD' ? undefined : content());
    }});
    const bindCase=()=>web.register({kind:'prefix',path:casePath,handler(req,res){
      const failure=(code,text)=>{res.writeHead(code,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'});res.end(text);};
      if(!loopback.has(req.socket?.remoteAddress)||req.headers?.host!==origin.host)return failure(403,'请从 DSH 本机会话打开。');
      if(req.method!=='GET')return failure(405,'请从会话卡片打开本案关系图。');
      const match=new URL(req.url,origin).pathname.match(/^\/civil-ontology\/case\/open\/([a-f0-9]{64})$/);
      pruneCases();
      const grant=match&&caseGrants.get(match[1]);
      if(!grant)return failure(410,'本案关系图入口已失效，请回到原会话点击“重新查看本案”。');
      if(req.headers['sec-fetch-mode']!=='navigate'||!['none','same-origin'].includes(req.headers['sec-fetch-site'])||req.headers['sec-fetch-dest']!=='document'||req.headers['sec-fetch-user']!=='?1')
        return failure(403,'请本人在 DSH 会话卡片中点击“打开本案关系图”。');
      if(!fs.existsSync(grant.report))return failure(410,'本案文档已过期，请回到原会话重新查看本案。');
      caseGrants.delete(match[1]);res.writeHead(200,htmlHeaders);res.end(fs.readFileSync(grant.report));
    }});
    if(c.effect){c.effect(bind);c.effect(bindCase);}else{bind();bindCase();}
    address = new URL(routePath,origin).href;
  });
}
