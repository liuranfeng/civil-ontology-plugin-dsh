import fs from 'node:fs';
import {explainTradeTerm,termGuide} from './trade-review.mjs';
import {internalText} from './counsel-view.mjs';
import {caseOpeningFields,civilOpeningDescription} from './case-intake.mjs';
import {methodPrompt,readCandidate,readApprovedMethod,libraryFor,hasApprovedTitle} from './approved-methods.mjs';
import {methodDecisionFields,methodReviewOverview,recordMethodDecisions,rememberMethod} from './method-accountability.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL('./civil/'+name,import.meta.url),'utf8'));
const string={type:'string'};
export function registerCivilTools(ctx,{store,session,tool,openCase,saveTermOpinion}){
  const framework=read('model.json');
  const save=(sid,row)=>saveTermOpinion?saveTermOpinion(sid,row):store.put(sid,row);
  function readMethod(args,exec){
    const sid=session(exec),row=store.get(sid);
    const result=readApprovedMethod(row,args);
    if(result.method){
      const next=rememberMethod(row,result.method.title);
      if(next!==row)save(sid,next);
      result.markdown+='\n\n本案已登记详读「'+result.method.title+'」。交付前请用 civil_record_method_decision 记录其适用性、原文与取舍。当前案件修订为 '+row.revision+'。';
    }
    return result;
  }
  ctx.systemPrompt.section({name:'civil-review:practice',order:6202,interpolate:false,text:
    fs.readFileSync(new URL('./skills/civil-review/SKILL.md',import.meta.url),'utf8').replace(/^---[\s\S]*?---\s*/,'')+
    '\n对请求权核对'+framework.requiredForClaim.join('、')+'。'+methodPrompt});
  ctx.tools.register(tool('civil_ontology','按主题查询共用的民事法律关系。省略 term 可浏览全部关系。',{term:string},[],({term})=>{
    const key=term?.trim();
    const rows=framework.relations.filter(r=>!key||r.some(v=>v.includes(key)));
    return {markdown:rows.map(r=>r.join(' — ')).join('\n')||'没有对应关系，请换用法律概念。'};
  }));
  ctx.tools.register(tool('civil_open_case',civilOpeningDescription,caseOpeningFields,['packet'],openCase));
  ctx.tools.register(tool('civil_read_method','读取本案启用的法务审查方法。按完整标题详读，填标题时不带分类前缀。浏览目录不计详读。详读后须逐项登记适用性、出处和取舍。',{title:string,kind:string,domain:string},[],readMethod));
  ctx.tools.register(tool('civil_record_method_decision','记录实际详读方法的取舍。entries 可分批填写，必须用本案原句。原文不足时标待核，说明范围、证据和影响。entries 为空可查待办和最近案件修订。',methodDecisionFields,['entries'],(args,exec)=>{
    const sid=session(exec),row=store.get(sid);
    if(!row||!libraryFor(row))throw Error('请先打开启用本版审查方法的案件。');
    if(!Array.isArray(args.entries))throw Error('请用 entries 数组提交取舍，或用空数组查询。');
    const next=args.entries.length?recordMethodDecisions(row,args.reviewRevision,args.entries):row;
    if(next!==row)save(sid,next);
    const items=methodReviewOverview(next);
    const pending=items.filter(item=>item.state!=='decided').map(item=>item.title);
    return {markdown:'本案当前修订 '+next.revision+'，已详读 '+items.length+' 项，已说明取舍 '+(items.length-pending.length)+' 项。'+
      (pending.length?'\n尚待核对　'+pending.join('、'):'\n本次已读方法取舍均已登记。')};
  }));
  ctx.tools.register(tool('civil_lookup_statute','按条号或用语查阅本地收录的中国民法典条文，以条名与原文答复。',{query:string},['query'],({query})=>{
    const key=query.trim();if(!key)throw Error('请输入条号或法律用语。');
    const rows=read('code.json');const number=key.match(/^(?:第)?(\d+)(?:条)?$/)?.[1];
    const hits=rows.filter(a=>number?a.number===Number(number):a.label===key||a.text.includes(key)||a.chapter.includes(key)).slice(0,8);
    return {markdown:hits.length?hits.map(a=>'**《中华人民共和国民法典》'+a.label+'**\n\n'+a.text).join('\n\n'):'尚未找到相应条文，请核对条号或查询法律法规数据库。'};
  }));
  ctx.tools.register(tool('civil_explain_term','结合本案原句解释贸易术语、机构、行业文本及其权利义务，标明仍须检索的背景。',{term:string,sourceId:string,quote:string},['term','sourceId','quote'],({term,sourceId,quote},exec)=>{
    const row=store.get(session(exec));const source=row?.packet.sources.find(s=>s.id===sourceId);
    if(!source||!term.trim()||quote.length<3||!source.text.includes(quote)||!quote.toLowerCase().includes(term.toLowerCase()))throw Error('请在本案材料中选取包含该用语的完整原句。');
    const result=explainTradeTerm(term,quote);
    return {markdown:[result.term,result.qualification,...result.duties,...result.claims,result.evidence,...result.sources.map(([n,u])=>'['+n+']('+u+')')].join('\n\n'),researchMethod:termGuide};
  }));
  ctx.tools.register(tool('civil_record_term_opinion','把查实的语境、交易义务及待补证据写入本案术语意见。',{reviewRevision:{type:'integer'},term:string,sourceId:string,quote:string,meaning:string,obligation:string,claim:string,boundary:string,publication:string,url:string},['reviewRevision','term','sourceId','quote','meaning','obligation','claim','boundary','publication','url'],(args,exec)=>{
    const id=session(exec),row=store.get(id),s=row?.packet.sources.find(x=>x.id===args.sourceId);
    if(row?.revision!==args.reviewRevision||!s||args.quote.length<3||!s.text.includes(args.quote)||!args.quote.toLowerCase().includes(args.term.toLowerCase()))throw Error('请核对本案材料、所引原句及当前版本。');
    const keys=['term','quote','meaning','obligation','claim','boundary','publication'];
    if(keys.some(k=>!args[k]?.trim()||args[k].length>3000||internalText.test(args[k])))throw Error('请用法务可直接阅读的文字填写引文、履行内容、请求和证据边界。');
    const url=new URL(args.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('请提供正式出版物公开链接。');
    const note={...Object.fromEntries(keys.map(k=>[k,args[k].trim()])),url:url.href,sourceId:s.id,reviewRevision:row.revision};
    const next={...row,termNotes:[...(row.termNotes||[]).filter(t=>t.term!==note.term||t.quote!==note.quote),note]};
    if(saveTermOpinion)saveTermOpinion(id,next);
    else store.put(id,next);
    return {markdown:[note.term,'案涉材料载有「'+note.quote+'」。',note.meaning,note.obligation,note.claim,note.boundary,'['+note.publication+']('+url.href+')'].join('\n\n')};
  }));
  ctx.tools.register(tool('civil_preview_candidate','在用户明确要求试用、评估或取舍本体时查阅候选关系。',{title:string},['title'],({title},exec)=>{
    const row=store.get(session(exec));
    if(row&&libraryFor(row)&&hasApprovedTitle(title))return readMethod({title},exec);
    const found=readCandidate(title);
    return {markdown:found?'**试验用候选意见 · '+found.title+'**\n\n'+[found.relation,found.scope,...(found.details||[]),found.quote&&'案涉材料载有「'+found.quote+'」。',found.evidence,found.counter,found.question].filter(Boolean).join('\n\n'):'请使用取舍报告列明的候选名称。'};
  }));
}
