import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {makeStore} from './case-store.mjs';
import {prepareCatalogReview,approvedForCase,confirmCatalogReview} from './catalog-review.mjs';
import {renderOntology} from './ontology-view.mjs';
import {buildIndex} from './market-index.mjs';

test('周报与关系图的固定页面、样式和交互与 1.0.1 分发快照一致',()=>{
  const lock=JSON.parse(fs.readFileSync(new URL('./canvas-lock.json',import.meta.url),'utf8'));
  assert.equal(Object.keys(lock.templates).length,6);
  for(const [name,expected] of Object.entries(lock.templates)){
    const source=fs.readFileSync(new URL('./'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
    assert.equal(createHash('sha256').update(source).digest('hex'),expected,name);
  }
});

test('证据齐全的库外方法可提交候选，弱旧回执与跨组织条目不进入后案',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'civil-evidence-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const store=makeStore(home),scope={organization:'演示组织',scene:'设备采购',stance:'买方',stage:'签前',businessKind:'点验'};
  const samples=['甲乙双方共同出具点验单后支付本期价款。','财务收齐双方签署的试运转证明后支付该期价款。','本期到货款自签收之日起计算。'];
  const rows=samples.map((text,i)=>{
    const id='matter'+i,sid='session'+i;
    const row=store.open(sid,{id,...scope,sources:[{id:'C1',kind:'正文',locator:'交付与付款',text}]});
    if(!i)store.put(sid,{...row,corrections:[{state:'recorded',quote:text,sourceId:'C1',reason:'请以原件核实各期价款的起算条件。'}]});
    return {role:['原案','相似案','反例'][i],caseId:id,sourceId:'C1',quote:text,before:'曾采用通用付款条件。',after:'按该期约定分别判断。',reason:'本期条件须以实际约定为准。'};
  });
  const args={title:'逐笔点验回单办理方法测试',proposal:{relation:'区分收货证明与各期付款条件。',scope:'仅在合同约定有独立点验环节时使用。',counter:'付款条件明确仅以签收为准时排除。'},examples:rows};
  const p=prepareCatalogReview(store,store.get('session0'),args);
  assert.equal(p.verifiedSources.length,3);
  assert.equal(p.verifiedSources[1].sessionId,'session1');
  assert.deepEqual(approvedForCase(store,store.get('session0').packet),[]);
  assert.throws(()=>prepareCatalogReview(store,store.get('session0'),{...args,examples:[rows[0],rows[1]]}));
  confirmCatalogReview(store,p.id);
  assert.equal(approvedForCase(store,store.get('session0').packet).length,1);
  assert.equal(approvedForCase(store,{...store.get('session0').packet,organization:'另一个组织'}).length,0);
  const legacyFile=path.join(home,'catalog-review','legacy.json');
  const r=JSON.parse(fs.readFileSync(path.join(home,'catalog-review',p.id+'.json'),'utf8'));
  fs.writeFileSync(legacyFile,JSON.stringify({...r,id:'weak',origin:'session-memory',confirmed:true,evidence:[],guidance:{title:'旧周报单条确认'}}));
  assert.equal(approvedForCase(store,store.get('session0').packet).length,1);
});

test('仅本案画布包含匹配的已采纳摘要，资料源投影不暴露其他案件原文',()=>{
  const match={type:'legal',title:'核对交付凭证',scope:'该组织采购签前',relation:'逐期核对付款前提。',evidenceView:{sources:[{role:'反例',title:'反例材料',raw:'PRIVATE_BODY'}]},raw:'PRIVATE_BODY'};
  const scoped=renderOntology([match]);
  assert.ok(scoped.includes('逐期核对付款前提。')&&scoped.includes('反例材料'));
  assert.ok(!scoped.includes('PRIVATE_BODY')&&!renderOntology().includes('逐期核对付款前提。'));
});

test('市场列出与插件匹配的发布版本并保留上一版独立来源',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('./package.json',import.meta.url)));
  assert.equal(pkg.version,'1.0.1');
  const versions=buildIndex({}).plugins[0].versions;
  assert.deepEqual(versions.map(v=>v.version),[pkg.version,'1.0.0']);
  assert.notEqual(versions[0].source.commit,versions[1].source.commit);
  assert.match(versions[0].source.commit,/^[0-9a-f]{40}$/);
});
