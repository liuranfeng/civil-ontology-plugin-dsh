import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {apply} from './index.mjs';
import {verifyMethodSnapshot,batch,methodPrompt,readCandidate,readApprovedMethod} from './approved-methods.mjs';
import {makeStore} from './case-store.mjs';

const expected=JSON.parse(fs.readFileSync(new URL('./civil/approved-methods.json',import.meta.url)));
test('确认原文的指纹覆盖完整内容，包括来源、例外及适用范围',()=>{
  assert.equal(expected.length,82);
  assert.equal(new Set(expected.map(r=>r.title)).size,82);
  const altered=structuredClone(expected);
  altered[0].scope+='新加范围';
  assert.throws(()=>verifyMethodSnapshot(Buffer.from(JSON.stringify(altered))),/已偏离/);
});
test('已确认方法和跨案选题共用同一快照，详读保留完整说明且不重复展开请求权字段',()=>{
  assert.equal(batch,'b617016ae51a7cdaedc6e5d1ab3a38cb3c2365378591fa79659482cc838d8f59');
  assert.equal(fs.existsSync(new URL('./civil/candidates.json',import.meta.url)),false);
  assert.equal(readCandidate('尚未收录的新标题'),undefined);
  const row={mode:'on',methodBatch:batch};
  for(const r of expected){
    assert.deepEqual(readCandidate(r.title),r);
    assert(!methodPrompt.includes(r.title));
    const {markdown}=readApprovedMethod(row,{title:r.title});
    for(const line of r.details||[])assert(markdown.includes(line));
    if(r.claim){
      const description=r.details.join('\n');
      for(const value of [r.claim.parties,r.claim.effect,r.claim.conditions,r.claim.comparableLaw.join('、')]){
        assert(description.includes(value));
        assert(!markdown.split('\n\n').some(line=>line.endsWith('　'+value)&&!r.details.includes(line)));
      }
    }
  }
  const model=JSON.parse(fs.readFileSync(new URL('./civil/model.json',import.meta.url)));
  for(const [subject,target] of [['证据材料','法律事实'],['合同条款','请求权基础']]){
    assert.equal(model.relations.filter(([from,,to])=>from===subject&&to===target).length,1);
  }
});
test('开案加载已确认的方法，保留既有案件口径和独立的跨案证据要求',async()=>{
  const env=process.env.DSH_HOME,mode=process.env.DSH_CIVIL_METHOD;
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'approved-methods-'));
  process.env.DSH_HOME=home;
  delete process.env.DSH_CIVIL_METHOD;
  const packet={id:'真实审阅测试',stage:'签约前',scene:'销售业务',stance:'卖方',businessKind:'软件许可',sources:[{id:'C1',kind:'正文',locator:'价款约定',text:'乙方提供软件许可，甲方按期付款。'}]};
  function host(ontology){
    const registry=new Map(),prompts=[];
    apply({tools:{register:t=>registry.set(t.name,t)},systemPrompt:{section:s=>prompts.push(s.text)},inject(){}},{ontology});
    return {registry,prompt:prompts.join('\n'),call:(name,args,id)=>registry.get(name).execute(args,{agent:{id},signal:new AbortController().signal})};
  }
  try{
    const on=host(true),off=host(false);
    assert(!on.prompt.includes(expected[0].title));
    const enabled=await on.call('civil_open_case',{packet},'新版本案');
    assert.equal(enabled.result.methodLibrary.count,82);
    assert.deepEqual(enabled.result.approvedGuidance,[]);
    assert.match(enabled.markdown,/法务已确认收录82项/);
    const all=await on.call('civil_read_method',{},'新版本案');
    assert.equal(all.titles.length,82);
    const compatible=await on.call('civil_preview_candidate',{title:expected[0].title},'新版本案');
    assert.deepEqual(compatible.method,expected[0]);
    assert.doesNotMatch(compatible.markdown,/试验用候选/);
    const trade=await on.call('civil_read_method',{kind:'贸易术语'},'新版本案');
    assert.equal(trade.titles.length,14);
    for(const r of expected){
      const info=await on.call('civil_read_method',{title:r.title},'新版本案');
      assert.deepEqual(info.method,r);
      assert(info.markdown.includes(r.source)&&info.markdown.includes(r.scope)&&info.markdown.includes(r.counter));
    }
    const ordinary=await off.call('civil_open_case',{packet},'普通本案');
    assert(!ordinary.result.methodLibrary);
    assert(!off.registry.has('civil_read_method'));
    assert(!off.prompt.includes(expected[0].title));
    const store=makeStore(path.join(home,'civil-contract-review'));
    const legacy=store.open('旧版本案',packet);
    store.put('旧版本案',{...legacy,mode:'on',revision:2});
    const old=await on.call('civil_open_case',{packet},'旧版本案');
    assert(!old.result.methodLibrary);
    await assert.rejects(on.call('civil_read_method',{title:expected[0].title},'旧版本案'));
    const fresh=await on.call('procurement_open_case',{packet:{...packet,id:'新采购事项',scene:'采购业务',stance:'买方'}},'采购会话');
    assert.equal(fresh.result.methodLibrary.count,82);
    assert.equal(store.get('采购会话').methodBatch,batch);
  }finally{
    if(env===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=env;
    if(mode===undefined)delete process.env.DSH_CIVIL_METHOD;else process.env.DSH_CIVIL_METHOD=mode;
    const temp=path.resolve(os.tmpdir());
    if(path.dirname(path.resolve(home))===temp&&path.basename(home).startsWith('approved-methods-'))fs.rmSync(home,{recursive:true,force:true});
  }
});

