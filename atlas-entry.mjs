import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { renderOntology } from './ontology-view.mjs';

const routePath = '/civil-ontology/atlas';
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The atlas is entirely derived from the bundled catalog. Case data never passes this entry. */
export function registerAtlas(ctx, { home, tool, experienceFor }) {
  let html, address, file;
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
      if(arg==='case'){
        const matched=experienceFor?.(agent?.session?.id||agent?.id);
        if(!matched)return {kind:'success',text:'请先在本会话登记具体委托，再查看本案适用的已批准经验。'};
        const report=exportFile(renderOntology(matched));
        return {kind:'success',text:'[查看本案可用经验](<'+pathToFileURL(report).href+'>)\n'+report};
      }
      if(arg)return {kind:'error',text:'使用 /civil-map 或 /civil-map case。'};
      const shown = view(); return { kind: 'success', text: shown.markdown + '\n' + shown.url };
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
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff','cache-control':'private, no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"});
      res.end(req.method === 'HEAD' ? undefined : content());
    }});
    if (c.effect) c.effect(bind); else bind();
    address = new URL(routePath,origin).href;
  });
}
