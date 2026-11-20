import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {apply} from './index.mjs';

test('DSH 入场只给共用说明，三个独立委托只展开各自的工具和交付方式',async t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'civil-routes-')),last=process.env.DSH_HOME;
  process.env.DSH_HOME=home;
  t.after(()=>{if(last===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=last;});
  const registered=new Map(),prompts=[];
  apply({tools:{register:def=>registered.set(def.name,def)},systemPrompt:{section:def=>prompts.push(def.text)},inject(){}});
  assert.doesNotMatch(prompts.join(''),/word_review_export|civil_compare_cases|civil_consult_opinion|审批级别/);
  for(const op of ['word_review_export','civil_compare_cases','company_read_rule','civil_consult_opinion'])assert(!registered.has(op));
  for(const [mode,correct,wrong] of [['contract','word_review_export','civil_compare_cases'],['consult','civil_consult_opinion','word_review_export'],['research','civil_compare_cases','civil_consult_opinion']]){
    const exec={agent:{id:mode},signal:new AbortController().signal};
    const packet={id:'独立委托',taskMode:mode,scene:'委托服务',stage:'履行',stance:'委托人',sources:[{id:'M1',kind:'陈述',locator:'委托人说明',text:'当事人对服务交付日期有争议。'}]};
    const call=(n,args)=>registered.get(n).execute(args,exec);
    const opened=await call('civil_open_case',{packet});
    assert(opened.markdown.includes(correct));
    assert(!opened.markdown.includes(wrong));
    assert((await call('civil_task_tool',{operation:correct})).markdown.includes('input'));
    await assert.rejects(call('civil_task_tool',{operation:wrong,input:{}}),/当前事项/);
    if(mode!=='contract')assert.doesNotMatch(opened.markdown,/签署意见|用印|word_contract_revise/);
  }
});
