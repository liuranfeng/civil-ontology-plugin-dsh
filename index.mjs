
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { analyzeCase, resolveCorrection } from './analysis.mjs';
import { makeCounselReport } from './counsel-view.mjs';
import { registerWordTools } from './word-tools.mjs';
import { registerCivilTools } from './civil-tools.mjs';
import {caseOpeningFields,civilOpeningDescription,procurementOpeningDescription} from './case-intake.mjs';
import {approvedForCase,prepareCatalogReview} from './catalog-review.mjs';
import { makeStore } from './case-store.mjs';
import { validateAgentRecord } from './agent-record.mjs';
import {registerCompany,noteBlocks} from './company-policy.mjs';
import {batch,libraryFor} from './approved-methods.mjs';
import {methodReviewBlocks} from './method-accountability.mjs';
import {claimReviewBlocks,registerClaimTool} from './review-narrative.mjs';

import {modeOf,taskRouter} from './task-router.mjs';
import {registerScenarioTools,workflowFor} from './scenario-tools.mjs';
import {createCourtWebJudgmentProvider} from './judgment-provider.mjs';
import {makeMemory} from './memory-store.mjs';
import {registerMemory} from './memory-plugin.mjs';
import {registerMarket} from './market-index.mjs';
import {registerAtlas} from './atlas-entry.mjs';

const skillText=name=>fs.readFileSync(new URL('./skills/'+name+'/SKILL.md',import.meta.url),'utf8').replace(/^---[\s\S]*?---\s*/,'');
const contractGuide=skillText('word-review');
function otherMatter(row){
  const mode=modeOf(row.packet);
  const recent=row.scenarioOutcome?.revision===row.revision?row.scenarioOutcome.markdown:'';
  const approved=(row.approvedGuidance||[]).map(g=>'本场景已确认的经验　'+[g.title,g.relation,g.scope,g.counter].filter(Boolean).join('。'));
  return {caseId:row.packet.id,revision:row.revision,markdown:[recent||'已登记本案材料。',...approved,'事项编号 '+row.packet.id+'，当前修订 '+row.revision,recent?'':workflowFor(mode)].filter(Boolean).join('\n\n')};
}
export const name='civil-ontology';
export const inject=['tools','systemPrompt'];
const object={type:'object',additionalProperties:true};
const string={type:'string'};
const stateRoot=()=>path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'civil-contract-review');
function session(exec){if(!exec.agent?.id)throw Error('需要 DSH 会话身份');return exec.agent.id;}
function tool(name,description,props,required,fn){
  return {name,description,parameters:{type:'object',properties:props,required,additionalProperties:false},
    executionMode:{kind:'exclusive'},
    output:{schema:object,render:(_args,x)=>[{type:'text',text:x.markdown||JSON.stringify(x,null,2)}]},
    async execute(args,exec){exec.signal.throwIfAborted();return fn(args,exec);}};
}
function render(store,sid,row,{alternate,execution,carryTerms=false}={}){
  if(modeOf(row.packet)!=='contract'){
    analyzeCase(row.packet,{ontology:row.mode!=='off'});
    const next={...row,revision:row.revision+1};
    store.put(sid,next);
    return otherMatter(next);
  }
  const options={version:row.version, useRules:row.rules, ontology:row.mode!=='off'};
  const operations=execution?[...(row.operations||[]),{name:execution.name,callId:execution.callId}].slice(-80):row.operations;
  const termNotes=carryTerms?(row.termNotes||[]).filter(note=>note.reviewRevision===row.revision).map(note=>({...note,reviewRevision:row.revision+1})):[];
  const companyNotes=carryTerms&&row.mode!=='off'?(row.companyNotes||[]):[];
  const result=JSON.parse(JSON.stringify({...analyzeCase(row.packet,options),methodLibrary:libraryFor(row),methodReviewBlocks:methodReviewBlocks(row),agentRecord:row.agentRecord,termNotes,companyBlocks:noteBlocks(companyNotes),approvedGuidance:row.approvedGuidance,operations}));
  result.claimReviewBlocks=claimReviewBlocks(row);
  const next={...row,operations,termNotes,companyNotes,revision:row.revision+1};
  const report=makeCounselReport(result,next.revision,row.corrections);
  const directory=path.join(store.home,'reports',sid);
  fs.mkdirSync(directory,{recursive:true});
  const base=path.join(directory,row.packet.id+'-'+next.revision);
  fs.writeFileSync(base+'.html',report.html,{flag:'wx'});
  fs.writeFileSync(base+'.md',report.markdown,{flag:'wx'});
  store.put(sid,{...next,report:base+'.html'});
  const outputs=alternate?analyzeCase(alternate,options):null;
  const markdown=report.summary+'\n\n[查看审查意见](<'+(base+'.html').replaceAll('\\','/')+'>)'+
    (outputs?'\n\n按口头更正作条件推演，请核实事实。'+outputs.installments.map(x=>x.conclusion==='ready'?'部分触发已按假设满足。':'条件仍待核。').join(''):'');
  return {status:row.agentRecord?'agent-recorded':'checked',markdown,report:base+'.html',caseId:row.packet.id,version:row.version,revision:next.revision,result};
}
export function apply(ctx,config={}) {
  const methodEnabled=config?.ontology!==false&&process.env.DSH_CIVIL_METHOD!=='off';
  const originalStore=makeStore(stateRoot());
  function verifiedExisting(row){
    if(!row?.approvedGuidance?.length||row.guidanceEdition==='1.0.1')return row;
    const allowed=new Set(approvedForCase(originalStore,row.packet).map(g=>JSON.stringify(g)));
    return {...row,approvedGuidance:row.approvedGuidance.filter(g=>allowed.has(JSON.stringify(g)))};
  }
  const store={...originalStore,get:sid=>verifiedExisting(originalStore.get(sid)),open:(...args)=>verifiedExisting(originalStore.open(...args))};
  const memory=makeMemory(stateRoot());
  const memoryApi=registerMemory(ctx,{home:stateRoot(),memory,tool,session,store,methodEnabled,config:{...config,capture:methodEnabled&&config.capture!==false}});
  registerAtlas(ctx,{home:stateRoot(),tool,experienceFor:sid=>{
    if(!sid||!methodEnabled)return null;
    const row=store.get(sid);
    return row?memoryApi.guidanceFor(row.packet,sid):null;
  }});
  if(methodEnabled)ctx.systemPrompt.section({name:'civil-ontology:entry',order:6201,interpolate:false,text:
    '民事概念可直接查询；具体委托使用 civil_open_case。用户要看本体图时调用 civil_open_map，直接给出工具返回的画布。周报和关系图始终由插件模板生成。仅提交有出处的结构化内容，不编写展示页面，不代替本人作取舍。'});
  ctx.on?.('system-prompt/assemble',async(_assembly,context,next)=>{
    const assembly=await next();
    if(!methodEnabled)return {...assembly,tools:assembly.tools.filter(t=>!t.name.startsWith('civil_memory_')&&t.name!=='civil_open_map')};
    const sid=context?.agent?.session?.id||context?.agent?.id;
    if(sid&&memoryApi.isCivilContext(sid))return assembly;
    return {...assembly,
      sections:assembly.sections.filter(s=>!s.name.startsWith('civil-ontology:')&&!s.name.startsWith('civil-review:')),
      tools:assembly.tools.filter(t=>!t.name.startsWith('civil_')&&t.name!=='procurement_open_case')
    };
  },{prepend:true});
  const router=taskRouter(ctx,{tool,session,store});
  const contract=router.target('contract');
  const consult=router.target('consult'),research=router.target('research');
  const openCase=(args,exec)=>{
      const sid=session(exec);
      const {confirmedFacts,...input}=args.packet;
      modeOf(input);
      analyzeCase(input);
      const row=store.open(sid,input);
      if(methodEnabled)memoryApi.bindCase(sid,row.packet);
      const recalled=methodEnabled?memoryApi.guidanceFor(row.packet,sid):[];
      const approvedGuidance=methodEnabled?(row.approvedGuidance??(row.revision===0?
        [...approvedForCase(store,row.packet),...recalled.filter(g=>g.type==='legal')]:[])):[];
      // Pin only at first opening; the saved records of older cases keep their original method.
      const methodBatch=row.revision===0&&methodEnabled?batch:row.methodBatch;
      const response=render(store,sid,{...row,methodBatch,approvedGuidance,guidanceEdition:'1.0.1',mode:methodEnabled?'on':'off'},{execution:exec,carryTerms:true});
      const mode=modeOf(row.packet);
      const guide=mode==='contract'?contractGuide:'';
      response.markdown += '\n\n'+[guide,router.menu(mode)].filter(Boolean).join('\n\n');
      for(const [type,label] of [['case','仅限本案的核验记录'],['presentation','适用于本交付的表达偏好']]){
        const items=recalled.filter(g=>g.type===type);
        if(items.length)response.markdown+='\n\n**'+label+'**\n\n'+items.map(g=>'· '+g.text).join('\n');
      }
      if(methodEnabled)memoryApi.ensureWeekly(sid).catch(()=>{});
      return response;
    };
  ctx.tools.register(tool('procurement_open_case',procurementOpeningDescription,caseOpeningFields,['packet'],(a,exec)=>{
    if(modeOf(a.packet)!=='contract')throw Error('专项采购入口仅用于合同审查。');
    return openCase({packet:{...a.packet,taskMode:'contract'}},exec);
  }));
  const openCivil=(args,exec)=>openCase({packet:{...args.packet,reviewScope:'general'}},exec);
  function saveOpinion(sid,row){
    if(modeOf(row.packet)!=='contract'){store.put(sid,row);return;}
    const base=path.join(store.home,'reports',sid,randomUUID());
    const opinion=makeCounselReport({...analyzeCase(row.packet,{version:row.version,useRules:row.rules,ontology:row.mode!=='off'}),claimReviewBlocks:claimReviewBlocks(row),methodLibrary:libraryFor(row),methodReviewBlocks:methodReviewBlocks(row),agentRecord:row.agentRecord,termNotes:row.termNotes,companyBlocks:noteBlocks(row.companyNotes),approvedGuidance:row.approvedGuidance},row.revision,row.corrections);
    fs.writeFileSync(base+'.html',opinion.html,{flag:'wx'});
    fs.writeFileSync(base+'.md',opinion.markdown,{flag:'wx'});
    store.put(sid,{...row,report:base+'.html'});
    return base+'.html';
  }
  if(methodEnabled){
    registerCompany(contract,{tool,session,store,save:saveOpinion});
    registerClaimTool(contract,{tool,session,store,save:saveOpinion});
  }
  registerWordTools(contract,{store,session,tool});
  registerScenarioTools({tools:{register(def){
    const owner={civil_consult_opinion:consult,civil_plan_case_search:research,civil_fetch_judgment:research,civil_compare_cases:research}[def.name];
    if(!owner)throw Error('场景工具未指定任务 '+def.name);
    owner.tools.register(def);
  }}},{tool,session,store,judgmentProvider:config.judgmentProvider===undefined?createCourtWebJudgmentProvider():config.judgmentProvider});
  if(!methodEnabled){
    ctx.systemPrompt.section({name:'civil-review:ordinary',order:6202,interpolate:false,text:'按用户问题使用 civil_open_case，选择 contract、consult 或 research。开案后按本场景说明，通过 civil_task_tool 调用专用工具。'});
    ctx.tools.register(tool('civil_open_case',civilOpeningDescription,caseOpeningFields,['packet'],openCivil));
  }else registerCivilTools(ctx,{store,session,tool,openCase:openCivil,saveTermOpinion:saveOpinion});
  if(methodEnabled)ctx.tools.register(tool('civil_prepare_experience','按存档案件和材料原句验证一个已有或新方法，提交周报。新标题须填写 proposal 的 relation、scope、counter。',{title:string,
    proposal:{type:'object',additionalProperties:false,required:['relation','scope','counter'],properties:{relation:{type:'string',description:'拟增加或细化的判断方法'},scope:{type:'string',description:'方法适用的条件'},counter:{type:'string',description:'足以排除类推的情形'}}},
    examples:{type:'array',minItems:3,maxItems:24,items:{type:'object',additionalProperties:false,required:['role','caseId','sourceId','quote','before','after','reason'],properties:{role:{type:'string',enum:['原案','相似案','反例']},caseId:string,sourceId:string,quote:string,before:string,after:string,reason:string}}}},['title','examples'],(args,exec)=>{
    const current=store.get(session(exec));if(!current)throw Error('请先打开当前事项。');
    const prepared=prepareCatalogReview(store,current,args);
    memoryApi.addVerifiedExperience(prepared,current.packet,session(exec));
    return {id:prepared.id,markdown:prepared.markdown+'\n\n已登记周报候选。请由本人打开 /civil-digest 查看当前版本与证据。'};
  }));
  ctx.tools.register(tool('civil_add_source','向本会话当前案件补入有出处的证据。来源编号唯一，保留旧修订。',
    {source:object},['source'],(args,exec)=>{
      const sid=session(exec),row=store.get(sid);
      if(!row)throw Error('请先引用插件打开案件');
      return render(store,sid,{...row,agentRecord:undefined,packet:{...row.packet,sources:[...row.packet.sources,args.source]}},{execution:exec});
    }));
  contract.tools.register(tool('civil_record_analysis','把本次 Agent 决策、所用知识、备选取舍和逐字原文定位记录到可审计的 Case 报告。',{reviewRevision:{type:'integer'},steps:{type:'array',items:object},opinion:object},['reviewRevision','steps','opinion'],(args,exec)=>{
    const sid=session(exec),row=store.get(sid);
    if(!row?.report||args.reviewRevision!==row.revision)throw Error('需要匹配当前案件修订，请先查看当前 Case 报告');
    const basis=analyzeCase(row.packet,{version:row.version,useRules:row.rules,ontology:row.mode!=='off'});
    const agentRecord={...validateAgentRecord(basis,args.steps,args.opinion),sourceRevision:row.revision};
    return render(store,sid,{...row,agentRecord},{execution:exec,carryTerms:true});
  }));
  ctx.tools.register(tool('civil_read_case','查看同一会话最近一次 Case 报告。',
    {},[],(_args,exec)=>{
      const row=store.get(session(exec));
      if(row&&modeOf(row.packet)!=='contract')return otherMatter(row);
      if(!row?.report)throw Error('本会话没有已完成的案件报告');
      const result={...analyzeCase(row.packet,{version:row.version,useRules:row.rules,ontology:row.mode!=='off'}),methodLibrary:libraryFor(row),methodReviewBlocks:methodReviewBlocks(row),agentRecord:row.agentRecord,termNotes:row.termNotes,companyBlocks:noteBlocks(row.companyNotes),approvedGuidance:row.approvedGuidance};
      result.claimReviewBlocks=claimReviewBlocks(row);
      return {markdown:makeCounselReport(result,row.revision,row.corrections).markdown,report:row.report};
    }));
  ctx.tools.register(tool('civil_correct_case','记录本案的纠正理由。含事实争议时显示条件推演。',
    {correction:object},['correction'],(args,exec)=>{
      const sid=session(exec),row=store.get(sid);
      if(!row)throw Error('请先引用插件打开案件');
      const change=resolveCorrection(row.packet,args.correction);
      const before=analyzeCase(row.packet,{version:row.version,useRules:row.rules,ontology:row.mode!=='off'});
      const rules=[...new Set([...row.rules,...(change.additionalRules||[])])];
      const after=analyzeCase(change.proposed,{version:row.version,useRules:rules,ontology:row.mode!=='off'});
      const affected=after.installments.flatMap((x,i)=>x.conclusion===before.installments[i]?.conclusion?[]:['付款安排 '+(i+1)+' 触发状态变化']);
      affected.push(...after.findings.filter(x=>!before.findings.some(v=>v.id===x.id)).map(x=>x.title));
      return render(store,sid,{
        ...row, rules, agentRecord:undefined, packet:change.updated, corrections:[...row.corrections,{...args.correction,state:change.state,effect:affected.join('，')||'请核对后续适用范围。'}]
      },{alternate:change.state==='hypothetical'?change.proposed:undefined,execution:exec});
    }));
  ctx.tools.register(tool('civil_experience_evidence','查看候选经验的原案、测试和待确认状态。发布由用户在 DSH 命令入口完成。',
    {id:string},['id'],args=>{
      const c=store.candidate(args.id);
      if(!c)return {markdown:'未找到相应的取舍意见。'};
      const e=c.evidence||{};
      return {markdown:['**采购审查经验的取舍意见**',c.observation,c.reason,'支持事项 '+(e.support?.length||0)+' 笔，反例 '+(e.counter?.length||0)+' 笔，复核事项 '+(e.regression?.length||0)+' 笔。',c.state==='published'?'法务已经确认适用范围。':'等待取得足够材料并由法务本人确认。'].filter(Boolean).join('\n\n')};
    }));
  registerMarket(ctx,{home:stateRoot(),config});
}
export default {name,inject,apply};


