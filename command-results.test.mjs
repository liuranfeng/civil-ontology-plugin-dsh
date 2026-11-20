import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerMemory} from './memory-plugin.mjs';
import {registerMarket} from './market-index.mjs';
import {registerAtlas} from './atlas-entry.mjs';
import {makeMemory} from './memory-store.mjs';
import {makeStore} from './case-store.mjs';

const host = '127.0.0.1:3000';
function scenario(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(),'civil-command-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const commands = new Map(), routes = new Map(), indexes = [];
  const services = {
    commands:{register: cmd=>{assert.ok(!commands.has(cmd.name));commands.set(cmd.name,cmd);}},
    webServer:{getOrigin:()=>'http://'+host,register:r=>routes.set(r.path,r)},
    pluginMarket:{listIndexes:()=>indexes.map(url=>({url})),setIndexes:urls=>indexes.splice(0,indexes.length,...urls)}
  };
  const ctx = {tools:{register(){}},inject(deps,fn){if(deps.every(d=>services[d]))fn(Object.assign(Object.create(ctx),services));}};
  const tool=(name,desc,fields,req,handler)=>({name,handler});
  registerMemory(ctx,{home,memory:makeMemory(home),store:makeStore(home),tool});
  registerAtlas(ctx,{home,tool,experienceFor:sid=>sid==='original'?[{title:'本案专属经验',scope:'演示'}]:null});
  registerMarket(ctx,{home,config:{marketIndex:false}});
  async function run(name,rawInput='',agent={id:'original'}){
    const result=await commands.get(name).handler({agent,rawInput});
    assert.match(result.text,/^## [^\n]+\n\n[^\n]+/);
    assert.doesNotMatch(result.text,/data:application\/json|base64|civil-view-v1|<!--[\s\S]*?-->|file:\/\/|\b[A-Z]:[\\/]/i);
    return result;
  }
  async function navigate(url,headers={}){
    const pathname=new URL(url).pathname;
    const route=[...routes.values()].find(r=>r.kind==='exact'?pathname===r.path:pathname.startsWith(r.path+'/'));
    assert.ok(route);
    const res={writeHead(code,h){this.code=code;this.headers=h;},end(body){this.body=String(body||'');}};
    await route.handler({url:pathname,method:'GET',socket:{remoteAddress:'127.0.0.1'},headers:{host,...headers}},res);
    return res;
  }
  return {commands,indexes,run,navigate};
}
const browser={'sec-fetch-mode':'navigate','sec-fetch-site':'same-origin','sec-fetch-dest':'document','sec-fetch-user':'?1'};
const grantIn=(text,part)=>text.match(new RegExp('http://[^\\s<>()]+/civil-ontology/'+part+'/open/[a-f0-9]{64}'))?.[0];

test('all command cards, settings persistence, explicit failure, and market registration',async t=>{
  const {commands,run,indexes}=scenario(t);
  assert.deepEqual([...commands.keys()].sort(),['civil','civil-apply','civil-confirm','civil-digest','civil-drop','civil-map','civil-market','civil-week','procurement-confirm'].sort());
  assert.match((await run('civil')).text,/## 民事法律关系本体[\s\S]*可用操作\n- 查看本体图 · `\/civil-map`/);
  assert.match((await run('civil-map')).text,/\[打开本体图\]\(<\/civil-ontology\/atlas>\)/);
  assert.match((await run('civil-week','off')).text,/周报安排：每周五 18:00（北京时间），已暂停。/);
  assert.match((await run('civil-week','9:15')).text,/周报安排：每周五 09:15（北京时间），已启用。/);
  assert.equal((await run('civil-week','45:19')).kind,'error');
  assert.match((await run('civil-week')).text,/周报安排：每周五 09:15（北京时间），已启用。/);
  assert.equal((await run('civil-map','bad')).kind,'error');
  assert.match((await run('civil-market')).text,/## 本体插件市场/);await run('civil-market');
  assert.deepEqual(indexes,['http://'+host+'/civil-ontology/market/index.json']);
});

test('review commands create a grant only after human invocation; replay does not take a decision',async t=>{
  const {run,navigate}=scenario(t);
  assert.equal((await run('civil-digest','',{})).kind,'error');
  for(const name of ['civil-digest','civil-apply','civil-drop','civil-confirm','procurement-confirm']){
    const {text}=await run(name),url=grantIn(text,'weekly');
    assert.ok(url);assert.equal(text.split(url).length,2);assert.match(text,/可用操作\n- \[打开画布并逐项取舍\]/);
    const prefetch=await navigate(url,{...browser,'sec-fetch-dest':'iframe'});
    assert.equal(prefetch.code,403);
    const clicked=await navigate(url,browser);
    assert.equal(clicked.code,303);assert.match(clicked.headers['Set-Cookie'],/HttpOnly/);
    assert.equal((await navigate(url,browser)).code,403);
  }
  const history=await run('civil-digest','history');
  assert.match(history.text,/## 历史周报/);
  const row=/往期周报\n- [^\n]+ · `\/civil-digest (w-[0-9a-f]{32})`/.exec(history.text);assert.ok(row);
  assert.ok(grantIn((await run('civil-digest',row[1])).text,'weekly'));
  assert.equal((await run('civil-digest','oops')).kind,'error');
});

test('case atlas is scoped to the issuing case and requires a fresh one-time human navigation',async t=>{
  const {run,navigate}=scenario(t);
  const missing=await run('civil-map','case',{id:'second'});
  assert.match(missing.text,/## 本案适用的经验/);assert.ok(!grantIn(missing.text,'case'));
  const {text}=await run('civil-map','case'),url=grantIn(text,'case');
  assert.ok(url);assert.equal(text.split(url).length,2);assert.match(text,/可用操作\n- \[打开本案关系图\]/);
  assert.equal((await navigate(url,{...browser,'sec-fetch-user':''})).code,403);
  assert.equal((await navigate(url,{...browser,'sec-fetch-site':'cross-site'})).code,403);
  const clicked=await navigate(url,browser);assert.equal(clicked.code,200);assert.match(clicked.body,/本案专属经验/);
  assert.equal((await navigate(url,browser)).code,410);
  assert.doesNotMatch((await navigate('http://'+host+'/civil-ontology/atlas')).body,/本案专属经验/);
});
