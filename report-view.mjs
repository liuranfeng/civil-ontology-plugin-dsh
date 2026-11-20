
import { buildQuestionDossier } from './question-model.mjs';

const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={F1:'业务类型',F2:'付款表单',P1:'付款条款',P2:'开票变更和顺延',D1:'表内交货日期',D2:'交货时间约定',D3:'交货文件',V1:'验收与风险转移',V2:'数量验收'};
function sourceName(source){
  if(source.id==='F1'&&!/fd(Big|Small)Category|采购业务|销售业务/.test(source.locator+' '+source.text))return source.kind+' '+source.id;
  return names[source.id]||source.kind+' '+source.id;
}
const css=[
  ':root{--ink:#172a36;--muted:#475b64;--bg:#f2f6f5;--panel:#fff;--line:#d6e3e0;--green:#1a655c;--light:#e3f0ec;--dark:#183e42;--amber:#755419;--aw:#fbf2de}',
  '*{box-sizing:border-box}[hidden]{display:none!important}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.68 "Microsoft YaHei","Segoe UI",sans-serif;text-wrap:pretty}',
  'a{color:var(--green);text-underline-offset:.2em}a:hover{text-decoration-thickness:2px}a:focus-visible,summary:focus-visible{outline:3px solid var(--green);outline-offset:3px}p{margin:.35em 0 .65em}h1,h2,h3,h4{line-height:1.34}',
  '.wrap{max-width:1220px;margin:0 auto;padding:27px 34px 55px}.top{padding:24px 28px 20px;color:#edf7f4;background:var(--dark);border-radius:10px 10px 0 0}.top h1{font-size:clamp(27px,3.2vw,39px);letter-spacing:-.045em;margin:.2em 0 .22em}.top p{margin:0;color:#d5e7e2}.top small{color:#cae1db;font-size:13px}',
  '.nav{display:flex;flex-wrap:wrap;gap:5px;background:var(--panel);padding:7px 12px;border:1px solid var(--line);border-top:0}.nav a{display:inline-flex;align-items:center;min-height:44px;padding:5px 13px;color:var(--muted);text-decoration:none;border-radius:5px;font-weight:650}.nav a[aria-current=true],.nav a:hover{color:var(--dark);background:var(--light)}',
  '.notice{color:var(--muted);font-size:13px;margin:11px 2px 14px}.panel,.box,.question-canvas,.answer,.action,.support{border:1px solid var(--line);border-radius:8px;background:var(--panel)}.panel{padding:22px 25px;margin-bottom:14px}.panel h2{margin:.35rem 0 .55rem;font-size:clamp(22px,3.2vw,31px)}.kicker{font-weight:700;color:var(--green);font-size:14px;letter-spacing:.025em}.badge{display:inline-block;background:var(--aw);color:var(--amber);font-size:12px;font-weight:700;border-radius:4px;padding:2px 8px;white-space:nowrap}',
  '.overview-top{max-width:72ch}.paper{background:#f6fbf9;border:1px solid #d8ebe4;border-radius:6px;padding:13px 16px;margin-top:15px}.paper strong{color:var(--dark)}.paper p{margin:3px 0 0}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:15px 0 0}.card{display:block;background:#f8fbfa;border:1px solid var(--line);border-radius:7px;padding:13px 15px;color:var(--ink);text-decoration:none}.card:hover{border-color:var(--green);background:var(--light)}.card h3{color:var(--dark);font-size:18px;margin:4px 0}.card p{color:var(--muted);font-size:14px;margin:3px 0}.card strong{font-size:13px;color:var(--green)}',
  '.topic{scroll-margin-top:14px}.topic-head{margin-bottom:13px}.topic-head p{font-size:14px;color:var(--muted);margin:0}.layout{display:grid;grid-template-columns:minmax(285px,.86fr) minmax(0,1.14fr);gap:15px;align-items:start}.question-canvas{padding:18px 16px;background:#f8fbfa}.question-canvas h3{font-size:17px;margin:0 0 9px}.question-canvas p{margin:0;color:var(--muted)}.tree{padding:0;margin:12px 0;list-style:none}.tree li{position:relative;margin:0 0 0 10px;padding:0 0 10px 18px;border-left:1px solid #9cbdb5}.tree li:last-child{padding-bottom:0}.tree li::before{position:absolute;content:"";height:1px;width:13px;background:#9cbdb5;top:23px;left:0}.tree a,.tree-end{display:block;border:1px solid var(--line);border-radius:6px;background:var(--panel);padding:9px 11px;color:var(--ink);text-decoration:none}.tree a:hover,.tree a[aria-current=true],.tree-end:hover,.tree-end[aria-current=true]{background:var(--light);border-color:var(--green)}.tree a strong,.tree-end strong{display:block;color:var(--dark);font-size:14px;line-height:1.48}.tree a span{display:block;font-size:13px;line-height:1.45;color:var(--muted);margin-top:2px}.tree-root{border-bottom:1px solid var(--line);padding-bottom:11px}.tree-root strong{display:block;margin:3px 0;color:var(--dark);font-size:16px}.tree-end{color:var(--green);font-weight:700}.tree-end span{display:block;font-size:13px;font-weight:400;color:var(--muted);margin-top:4px}',
  '.answer{padding:18px 22px;margin:0 0 12px;scroll-margin-top:14px}.answer h3{margin:.22rem 0 .65rem;font-size:21px}.answerLead{font-size:17px;margin-bottom:12px}.layers{display:grid;margin:14px 0 0;grid-template-columns:minmax(0,1fr)}.layer{border-top:1px solid var(--line);padding:9px 0 3px}.layer h4{font-size:15px;color:var(--dark);margin:0 0 4px}.layer p{margin:0 0 6px;color:var(--muted);font-size:14px}.answer .proof-name{margin:10px 0 5px;font-size:15px}.needed{padding:8px 11px;background:#fff8e9;border-radius:5px;margin:8px 0 0;font-size:14px}.needed strong{color:var(--amber)}',
  '.proofs{display:grid;gap:6px;margin:9px 0}.proof{background:#f4f9f7;border:1px solid var(--line);border-radius:5px;padding:7px 9px}.proof summary,.support summary{cursor:pointer;color:var(--green);font-weight:650}.proof summary{font-size:13px;min-height:25px}.quote{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink);margin:7px 0 2px;font-size:14px}.loc{color:var(--muted);overflow-wrap:anywhere;font-size:12px}.refs{display:flex;gap:5px 8px;flex-wrap:wrap;margin:8px 0}.refs a{font-size:13px}.small-link{display:inline-block;margin:7px 0 0;font-size:13px;font-weight:650}.proof[open]{background:var(--light)}',
  '.action{padding:17px 20px;margin:0 0 12px}.action h3{font-size:20px;margin:3px 0 5px}.clause{padding:9px 12px;background:#ecf7f2;border-radius:5px;margin:9px 0}.action p,.clause{font-size:15px}.support{padding:13px 17px;margin:15px 0}.support details{margin-top:9px}.support h4{margin:7px 0}.support>div{padding:8px 0}.blocks{display:grid;gap:5px}.small-list{font-size:14px;padding-left:24px}',
  '@media(max-width:820px){.wrap{padding:17px 18px 43px}.layout{grid-template-columns:minmax(225px,.86fr) minmax(0,1.14fr);gap:10px}.panel,.answer{padding:17px}.top{padding:20px}}',
  '@media(max-width:650px){.wrap{padding:0 11px 27px}.top{border-radius:0;padding:15px}.nav{padding:5px}.nav a{padding:5px 8px;font-size:14px}.cards,.layout{grid-template-columns:minmax(0,1fr)}.panel,.answer,.action{padding:13px}.question-canvas{padding:12px}.tree a,.tree-end{min-height:44px}}',
  '@media print{body{background:white}.wrap{padding:0;max-width:none}.nav{display:none}.top{background:white;color:black;border-bottom:2px solid #555}.top small,.top p{color:#333}[hidden]{display:block!important}.layout,.cards{display:block}.topic,.action{break-inside:avoid}.question-canvas,.action{margin:8px 0}}',
  '@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}'
].join('\n');
const client=[
  '(function(){',
  'const views=[...document.querySelectorAll("[data-view]")];',
  'const nav=[...document.querySelectorAll(".nav a")];',
  'const cards=[...document.querySelectorAll("[data-question-link]")];',
  'function setView(id){for(const v of views)v.hidden=v.id!==id;for(const a of nav)a.setAttribute("aria-current",String(a.hash==="#"+id));}',
  'function setQuestion(view,id){for(const p of view.querySelectorAll("[data-question-panel]"))p.hidden=p.id!==id;for(const a of view.querySelectorAll("[data-question-link]"))a.setAttribute("aria-current",String(a.hash==="#"+id));}',
  'function openHash(hash){const target=document.getElementById(hash||"process-view");if(!target)return;',
  ' if(target.matches("[data-question-panel]")){const view=target.closest("[data-view]");setView(view.id);setQuestion(view,target.id);return;}',
  ' if(target.matches("[data-view]")){setView(target.id);const first=target.querySelector("[data-question-panel]");if(first)setQuestion(target,first.id);return;}',
  ' if(target.matches("details")){for(let node=target;node;node=node.parentElement?.closest("details"))node.open=true;}',
  '}',
  'for(const a of [...nav,...cards])a.addEventListener("click",()=>openHash(a.hash.slice(1)));',
  'document.addEventListener("click",event=>{const link=event.target.closest("a");if(link?.hash)openHash(link.hash.slice(1));});',
  'setView("process-view");openHash(location.hash.slice(1));addEventListener("hashchange",()=>openHash(location.hash.slice(1)));',
  '})();'
].join('\n');

function matching(refs,sources){return refs.map(id=>sources.find(s=>s.id===id)).filter(Boolean);}
function refLinks(refs,sources){
  return refs.length?'<div class="refs">'+matching(refs,sources).map(s=>'<a href="#source-'+esc(s.id)+'">'+esc(sourceName(s))+' · '+esc(s.id)+'</a>').join('')+'</div>':'';
}
function evidenceDetails(refs,sources){
  return refs.length?'<div class="proofs">'+matching(refs,sources).map(s=>
    '<details class="proof"><summary>'+esc(sourceName(s))+' · '+esc(s.id)+'</summary><div class="quote">'+esc(s.text)+'</div><div class="loc">'+esc(s.kind)+' · '+esc(s.locator)+'</div></details>').join('')+'</div>':'';
}
function layer(title,body){return '<section class="layer"><h4>'+esc(title)+'</h4><p>'+esc(body)+'</p></section>';}
function panelId(q){return 'question-'+q.id;}
function topicHtml(topic,sources){
  const end='answer-'+topic.id;
  const qNodes=topic.questions.map((q,i)=>'<li><a href="#'+esc(panelId(q))+'" data-question-link><strong>'+String(i+1)+'. '+esc(q.question)+'</strong><span>'+esc(q.answer)+'</span></a></li>').join('');
  const panels=topic.questions.map((q,i)=>'<article class="answer" id="'+esc(panelId(q))+'" data-question-panel><div class="kicker">子问题 '+String(i+1)+'</div><h3>'+esc(q.question)+'</h3><p class="answerLead">'+esc(q.answer)+'</p><div class="layers">'+
    layer('业务背景与判断依据',q.business)+layer('请求权基础与抗辩',q.law)+layer('本案取舍及改判条件',q.choice)+
    '</div><h4 class="proof-name">已有证据</h4>'+evidenceDetails(q.refs,sources)+'<p class="needed"><strong>还需佐证</strong>　'+esc(q.needed)+'</p></article>').join('');
  const synthesis='<article class="answer" id="'+esc(end)+'" data-question-panel><div class="kicker">专题答案</div><h3>'+esc(topic.question)+'</h3><p class="answerLead">'+esc(topic.answer)+'</p>'+evidenceDetails(topic.refs,sources)+
    (topic.material?'<p class="needed"><strong>签前还需核实</strong>　'+esc(topic.material)+'</p>':'')+
    '<a class="small-link" href="#deliverable-view">查看汇总审查成果</a></article>';
  return '<section data-view data-topic="'+esc(topic.id)+'" class="topic" id="topic-'+esc(topic.id)+'">'+
    '<header class="panel topic-head"><div class="kicker">'+esc(topic.label)+' · 专题主问题</div><h2>'+esc(topic.question)+'</h2><p>点选画布里的子问题，正文会显示答案、取舍和要核对的证据。</p></header><div class="layout">'+
    '<nav class="question-canvas" aria-label="'+esc(topic.label)+'问题画布"><div class="tree-root"><div class="kicker">专题主问题</div><strong>'+esc(topic.question)+'</strong></div><ol class="tree">'+qNodes+'</ol><a class="tree-end" href="#'+esc(end)+'" data-question-link>专题答案<span>'+esc(topic.answer)+'</span></a></nav><div>'+panels+synthesis+'</div></div></section>';
}
function actionHtml(topic,sources){
  const a=topic.action;
  return '<article class="action" id="deliver-'+esc(topic.id)+'"><span class="badge">'+esc(a.priority)+'</span><h3>'+esc(a.title)+'</h3><p>'+esc(topic.answer)+'</p><p><strong>签前动作</strong>　'+esc(a.action)+'</p>'+
    (a.drafting?'<div class="clause"><strong>供确认的改约措辞</strong><p>'+esc(a.drafting)+'</p></div>':'')+
    refLinks(a.refs,sources)+'<a class="small-link" href="#answer-'+esc(topic.id)+'">回看专题论证</a></article>';
}
function evidenceLibrary(sources){
  return '<details class="support"><summary>材料与证据索引</summary><div class="blocks">'+sources.map(s=>'<details class="proof" id="source-'+esc(s.id)+'"><summary>'+esc(sourceName(s))+' · '+esc(s.id)+'</summary><div class="quote">'+esc(s.text)+'</div><div class="loc">'+esc(s.kind)+' · '+esc(s.locator)+'</div></details>').join('')+'</div></details>';
}
function historyHtml(result,corrections){
  const agent=result.agentRecord?'<details class="support"><summary>Agent 提交的判断记录</summary><ul class="small-list">'+result.agentRecord.steps.map(s=>'<li><b>'+esc(s.title)+'</b>　'+esc(s.decision)+'。'+esc(s.reason)+refLinks(s.evidence.map(e=>e.sourceId),result.sources)+'</li>').join('')+'</ul></details>':'';
  const operations=result.operations?.length?'<details class="support"><summary>工具执行回执</summary><ul class="small-list">'+result.operations.map(op=>'<li>'+esc(op.name)+' · '+esc(op.callId)+'</li>').join('')+'</ul></details>':'';
  const changes=corrections.length?'<details class="support"><summary>本案纠正</summary><ul class="small-list">'+corrections.map(s=>'<li>'+esc(s.reason)+'（'+esc(s.state)+'） '+esc(s.effect)+'</li>').join('')+'</ul></details>':'';
  return agent+operations+changes;
}
export function makeReport(result,revision=1,corrections=[]) {
  const dossier=buildQuestionDossier(result);
  const {cases}=dossier, sources=result.sources;
  const title=result.businessKind||result.scene;
  const context=result.scene+' · '+result.stance+'立场 · '+result.stage;
  const version=result.id+' · '+result.version+' · 修订 '+revision;
  const run=result.agentRecord?'DSH 工具记录含 Agent 提交的判断':result.operations?.length?'DSH 工具执行记录':'本地规则回放';
  const note=result.agentRecord?'每项成果关联到本次 Agent 记录的分析与证据。':
    result.operations?.length?'Agent 尚未提交补充判断记录。':'依据实际材料摘片运行。本例的真实模型调用及增益待验证。';
  const sourceNote=result.sourceBoundary?' '+result.sourceBoundary:'';
  const citations=refs=>refs.map(r=>'['+r+']').join(' ');
  const caseOutline=cases.map(t=>'- **'+t.label+'** '+t.question+'\n  '+t.answer).join('\n');
  const answers=cases.map(t=>'### '+t.label+'\n\n**专题主问题**　'+t.question+'\n\n'+
    t.questions.map((q,i)=>'#### 子问题 '+(i+1)+' · '+q.question+'\n\n**子问题答案**　'+q.answer+'\n\n- **业务背景与规则** '+q.business+'\n- **请求权基础与抗辩** '+q.law+'\n- **判断与取舍** '+q.choice+'\n- **已有证据** '+citations(q.refs)+'\n- **还需佐证** '+q.needed).join('\n\n')+
    '\n\n**专题答案**　'+t.answer+' '+citations(t.refs)).join('\n\n');
  const actionText=cases.map((t,i)=>(i+1)+'. **'+t.action.title+'** '+t.action.action+' '+citations(t.action.refs)+(t.action.drafting?'\n   '+t.action.drafting:'')).join('\n')||'当前材料待核。';
  const agentText=result.agentRecord?'\n\n### Agent 提交的判断记录\n\n'+result.agentRecord.steps.map(s=>'- **'+s.title+'** '+s.decision+'。'+s.reason+' '+citations(s.evidence.map(e=>e.sourceId))).join('\n'):'';
  const operations=result.operations?.length?'\n\n### 工具执行\n\n'+result.operations.map(op=>'- '+op.name+' · '+op.callId).join('\n'):'';
  const changes=corrections.length?'\n\n### 本案纠正\n\n'+corrections.map(c=>'- '+c.reason+'（'+c.state+'） '+(c.effect||'')).join('\n'):'';
  const evidence=sources.map(s=>'- ['+s.id+'] '+sourceName(s)+' · '+s.locator+'\n  '+s.text).join('\n');
  const markdown='# Case 审查报告 · '+title+'\n\n'+context+' · '+version+'\n\n'+run+'。'+note+sourceNote+
    '\n\n## 合同主问题\n\n'+dossier.question+'\n\n'+dossier.context+'\n\n**合同层面的答案**　'+dossier.answer+'\n\n'+caseOutline+
    '\n\n## 分析过程\n\n'+answers+agentText+operations+changes+
    '\n\n## 审查成果\n\n'+dossier.answer+'\n\n'+actionText+
    '\n\n## 事实与证据\n\n'+evidence+'\n\n方法与技能见各问题的业务背景与分析依据。\n';
  const summary='**合同主问题**　'+dossier.question+'\n\n**分析过程**\n\n'+caseOutline+'\n\n**审查成果**\n\n'+dossier.answer+'\n\n'+actionText;
  const cards=cases.map(t=>'<a class="card" href="#topic-'+esc(t.id)+'"><strong>'+esc(t.label)+'</strong><h3>'+esc(t.question)+'</h3><p>'+esc(t.answer)+'</p></a>').join('');
  const recorded=result.findings.length?'<details class="support"><summary>规则执行明细</summary><ul class="small-list">'+result.findings.map(f=>'<li id="'+esc(f.id)+'"><b>'+esc(f.title)+'</b>　'+esc(f.judgment)+refLinks(f.refs,sources)+'</li>').join('')+'</ul></details>':'';
  const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>采购签前审查 · '+esc(title)+'</title><style>'+css+'</style></head><body><main class="wrap">'+
    '<header class="top"><small>'+esc(context)+'</small><h1>'+esc(title)+'</h1><p>'+esc(version)+' · '+esc(run)+'</p></header>'+
    '<nav class="nav" aria-label="审查报告导航"><a href="#process-view" aria-current="true">合同总览</a>'+cases.map(t=>'<a href="#topic-'+esc(t.id)+'">'+esc(t.label)+'</a>').join('')+'<a href="#deliverable-view">审查成果</a></nav><p class="notice">'+esc(note+sourceNote)+'</p>'+
    '<section data-view id="process-view" class="panel"><div class="overview-top"><div class="kicker">合同主问题</div><h2>'+esc(dossier.question)+'</h2><p>'+esc(dossier.context)+'</p>'+refLinks(dossier.refs,sources)+'</div>'+
    '<div class="cards" aria-label="专题分案">'+cards+'</div><div class="paper"><strong>合同层面的答案</strong><p>'+esc(dossier.answer)+'</p><a class="small-link" href="#deliverable-view">查看签前审查成果</a></div></section>'+
    cases.map(t=>topicHtml(t,sources)).join('')+
    '<section data-view id="deliverable-view"><div class="panel"><div class="kicker">审查成果</div><h2>本轮签前意见</h2><p>'+esc(dossier.answer)+'</p></div>'+cases.map(t=>actionHtml(t,sources)).join('')+'</section>'+
    evidenceLibrary(sources)+historyHtml(result,corrections)+recorded+'</main><script>'+client+'</script></body></html>';
  return {summary,markdown,html};
}

