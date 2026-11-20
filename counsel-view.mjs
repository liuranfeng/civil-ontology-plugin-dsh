import {buildQuestionDossier} from './question-model.mjs';
export const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const internalText=/\b(?:PROC-[\w-]+|[FPDVLQ]\d+(?:-\d+)?|form_data|record_fields|main_document|recordCreatedAt|lineItem|field[A-Z]\w+|agent-step-\d+|sourceId|callId|sha256|sha-256|PENDING_DATA|SKIPPED|DSL|JSON|API)\b|[A-Z]:[\\/]|第\s*\d+\s*(?:至\s*\d+\s*)?行|正文抽取|规则回放|证据编号|正文命中|结构化输入|哈希|工具回执|系统字段/i;
const clean=(s,fallback='待补充审阅意见。')=>typeof s==='string'&&s.trim()&&!internalText.test(s)?s.replaceAll('摘片','已阅条款').replaceAll('触发项','约定条件').trim():fallback;
function cite(source){
  if(!source)return '';
  const kind=/表单/.test(source.kind)?'采购审批表':/附件/.test(source.kind)?'合同附件':/正文|条款/.test(source.kind)?'合同正文':'交易材料';
  const location=clean(source.locator,'');
  const label=[clean(source.displayName,'')||kind,location&&/^(?:第[一二三四五六七八九十百零\d.]+[条款项节]|附件[一二三四五六七八九十\d]+|[\u4e00-\u9fff]{2,20}(?:条款|约定|栏))/.test(location)?location:''].filter(Boolean).join(' ');
  const text=clean(source.text,'').replace(/<\/?br\s*\/?>/gi,' ').replace(/^#+\s*/,'').replace(/\s+/g,' ').trim();
  return text?label+'所载「'+text.slice(0,145)+(text.length>145?'……':'')+'」':label+'，请核对原件。';
}
export function makeCounselReport(result,revision=1,corrections=[]){
  const dossier=buildQuestionDossier(result);
  const title=clean(result.businessKind||result.scene,'合同')+'审查意见';
  const procurement=result.reviewScope!=='general'&&result.scene==='采购业务'&&result.stance==='买方'&&result.stage==='签约前';
  const preliminary=procurement&&!result.agentRecord?.opinion?dossier.cases:[];
  const concerns=preliminary.map(c=>({title:clean(c.label),answer:clean(c.answer),action:clean(c.action.action),sources:(c.action.refs?.length?c.action.refs:c.refs).map(id=>cite(result.sources.find(s=>s.id===id))).filter(Boolean),why:clean(c.questions[0]?.business,''),law:clean(c.questions[0]?.law,''),choice:clean(c.questions[0]?.choice,'')}));
  const rec=result.agentRecord;
  if(rec?.opinion?.actions) for(const a of rec.opinion.actions){
    const step=rec.steps.find(s=>s.id===a.anchor);
    concerns.push({title:clean(a.title),answer:clean(step?.decision),action:clean(a.action),sources:(step?.evidence||[]).map(e=>{const s=result.sources.find(x=>x.id===e.sourceId);return s?cite({...s,text:e.quote}):'';}).filter(Boolean),why:clean(step?.reason,''),law:clean(step?.basis?.join('。'),''),choice:clean(step?.alternatives?.join('。'),'')});
  }
  const conclusion=clean(rec?.opinion?.summary||(procurement?dossier.answer:'本案材料已列入审阅范围，尚待形成具体签署意见。'),'待审阅完整交易文件并核实决定签署的条件。');
  const notes=corrections.map(c=>clean(c.reason,'')).filter(Boolean);
  const blocks=[
    ['合同定性与审查立场','本次审阅'+clean(result.businessKind||result.scene,'交易文件')+'。我方为'+clean(result.stance,'待确定的一方')+'，依据'+clean(result.stage,'当前审阅时点')+'已提供的材料提出意见。'],
    ...(result.claimReviewBlocks||[]),
    ['审查结论',conclusion],
    ...(result.companyBlocks||[]),
    ...(result.methodReviewBlocks||[]),
    ...(result.methodLibrary?[['本案可用的审查方法','法务已确认收录'+result.methodLibrary.count+'项。按本案的交易目的、立场和争点选取，并查阅相应的出处、适用前提和例外。签署意见所用事实、法律和公司制度，应分别列明依据。']]:[]),
    ...(result.approvedGuidance||[]).map(g=>['已确认的同类事项经验　'+clean(g.title),[g.relation,g.scope,g.counter,'仍应对照本案原文，逐项说明相关事实能否满足前提。'].map(t=>clean(t,'')).filter(Boolean).join('\n\n')]),
    ...(result.termNotes||[]).filter(n=>n.reviewRevision===revision).map(n=>[clean(n.term,'交易用语'),['案涉材料载有「'+clean(n.quote,'请核对原件')+'」。',n.meaning,n.obligation,n.claim,n.boundary,n.publication].map(t=>clean(t,'')).filter(Boolean).join('\n\n')]),
    ...concerns.map(c=>[c.title,[c.answer,'处置意见　'+c.action,c.why&&'业务依据　'+c.why,c.law&&'法律依据　'+c.law,c.choice&&'取舍　'+c.choice,...c.sources].filter(Boolean).join('\n\n')]),
    ['审批与签署','签署前请核对适用的授权制度、审批结论和最终文本。需要例外审批的事项应由有权人员确认。'],
    ...(notes.length?[['补充意见',notes.join('\n\n')]]:[])
  ];
  const topics=procurement||rec?.opinion ? dossier.cases : [];
  const questions=topics.flatMap(t=>t.questions.map(q=>({
    title:clean(q.question,'本项需要确认什么？'),answer:clean(q.answer),
    fields:[['业务上为什么要问',q.business],['法律依据',q.law],['取舍及其影响',q.choice],['须核实的材料',q.needed]].map(([k,v])=>[k,clean(v,'')]).filter(([,v])=>v),
    quotes:q.refs.map(id=>cite(result.sources.find(s=>s.id===id))).filter(Boolean)
  })));
  const heading=clean(dossier.question,'依据当前材料，我方能否签署？');
  const markdown='# '+title+'\n\n**'+heading+'**\n\n'+conclusion+'\n\n## 审查成果\n\n'+blocks.map(([k,v])=>'### '+k+'\n\n'+v).join('\n\n')+(questions.length?'\n\n## 判断依据与取舍\n\n'+questions.map(q=>'### '+q.title+'\n\n'+[q.answer,...q.fields.map(([k,v])=>k+'　'+v),...q.quotes].join('\n\n')).join('\n\n'):'');
  const html='<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(title)+'</title><style>body{max-width:55rem;margin:3rem auto;padding:0 1.3rem;color:#173d39;font:17px/1.8 system-ui,"Microsoft YaHei",sans-serif}section,details{border-top:1px solid #ccd9d2;padding:.7rem 0}p{color:#273d39;white-space:pre-line}summary{cursor:pointer;font-weight:650}dt{font-weight:bold}dd{margin-left:0}blockquote{border-left:3px solid #89a59b;padding-left:1rem}</style><h1>'+escapeHtml(title)+'</h1><p><strong>'+escapeHtml(heading)+'</strong></p><p>'+escapeHtml(conclusion)+'</p><h2>审查成果</h2>'+blocks.map(([k,v])=>'<section><h3>'+escapeHtml(k)+'</h3><p>'+escapeHtml(v)+'</p></section>').join('')+(questions.length?'<h2>判断依据与取舍</h2>'+questions.map(q=>'<details><summary>'+escapeHtml(q.title)+'</summary><p>'+escapeHtml(q.answer)+'</p><dl>'+q.fields.map(([k,v])=>'<dt>'+escapeHtml(k)+'</dt><dd>'+escapeHtml(v)+'</dd>').join('')+'</dl>'+q.quotes.map(s=>'<blockquote>'+escapeHtml(s)+'</blockquote>').join('')+'</details>').join(''):'')+'</html>';
  return {html,markdown,summary:markdown};
}
