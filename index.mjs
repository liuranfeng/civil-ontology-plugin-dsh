
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { analyzeCase, resolveCorrection } from './analysis.mjs';
import { makeCounselReport } from './counsel-view.mjs';
import { registerWordTools } from './word-tools.mjs';
import { registerCivilTools } from './civil-tools.mjs';
import {caseOpeningFields,civilOpeningDescription,procurementOpeningDescription} from './case-intake.mjs';
import {approvedForCase,prepareCatalogReview,confirmCatalogReview} from './catalog-review.mjs';
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
  const store=makeStore(stateRoot());
  const memory=makeMemory(stateRoot());
  const memoryApi=registerMemory(ctx,{home:stateRoot(),memory,tool,session,store,config});
  ctx.systemPrompt.section({name:'civil-ontology:entry',order:6201,interpolate:false,text:
    '民事法律问题默认启用民事法律关系本体：合同审查、法律咨询、类案检索和民事法律研究都先调用 civil_open_case 登记事实与材料，同一份本体贯穿三个任务。'+
    '办理过程中用 civil_memory_note 把已核实的事实、形成的成果、可复用的技能和有理由的取舍连同原句记入台账；用户可用 /civil 查看台账、/civil-week 设周报时间、/civil-digest 立即汇总、/civil-apply 确认后写回本体。'});
  const router=taskRouter(ctx,{tool,session,store});
  const contract=router.target('contract');
  const consult=router.target('consult'),research=router.target('research');
  const openCase=(args,exec)=>{
      const sid=session(exec);
      const {confirmedFacts,...input}=args.packet;
      modeOf(input);
      analyzeCase(input);
      const row=store.open(sid,input);
      const approvedGuidance=methodEnabled?(row.approvedGuidance??(row.revision===0?approvedForCase(store,row.packet):[])):[];
      // Pin only at first opening; the saved records of older cases keep their original method.
      const methodBatch=row.revision===0&&methodEnabled?batch:row.methodBatch;
      const response=render(store,sid,{...row,methodBatch,approvedGuidance,mode:methodEnabled?'on':'off'},{execution:exec,carryTerms:true});
      const mode=modeOf(row.packet);
      const guide=mode==='contract'?contractGuide:'';
      response.markdown += '\n\n'+[guide,router.menu(mode)].filter(Boolean).join('\n\n');
      const recalled=memory.guidanceFor(row.packet);
      if(recalled.length)response.markdown+='\n\n**本体已确认的同类经验**\n\n'+recalled.map(x=>'· '+x.tag+'　'+x.text).join('\n')+'\n\n与本案事实不一致的，请说明差异后再决定取舍；办理中的新增量用 civil_memory_note 记入台账。';
      memoryApi.ensureWeekly(sid).catch(()=>{});
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
  if(methodEnabled)ctx.tools.register(tool('civil_prepare_experience','按已有案件和逐字原文汇总纠正、独立相似案及反例，提交给法务取舍。',{title:string,examples:{type:'array',items:object}},['title','examples'],(args,exec)=>{
    const current=store.get(session(exec));if(!current)throw Error('请先打开当前事项。');
    return prepareCatalogReview(store,current,args);
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
  ctx.inject(['commands'], commandContext=>{
    if(methodEnabled)commandContext.commands.register({name:'civil-confirm',description:'法务本人确认已审阅的跨案经验，输入候选名称。',handler({rawInput}){
      try{return {kind:'success',text:'已确认「'+confirmCatalogReview(store,rawInput.trim())+'」。用于适用范围内的新事项。'};}catch(e){return {kind:'error',text:e.message};}
    }});
    commandContext.commands.register({name:'procurement-confirm',description:'确认一条已完成充分验证的候选经验版。输入候选 ID 和审核回执校验码。',
      handler({rawInput}){
        try{
          const [id,token,extra]=rawInput.trim().split(/\s+/);
          if(extra||!token) throw Error('需要候选 ID 与审核回执校验码');
          const version=store.publish(id,token);
          return {kind:'success',text:'已确认适用范围内新案件使用 '+version+'。'};
        }catch(e){return {kind:'error',text:e.message};}
      }});
  });
  registerMarket(ctx,{home:stateRoot(),config});
}
export default {name,inject,apply};


