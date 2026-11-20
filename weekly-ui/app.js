'use strict';
const view=JSON.parse(document.getElementById('weekly-data').textContent);
const candidates=view.candidates,byId=new Map(candidates.map(c=>[c.id,c]));
const live=view.interactive&&/^https?:$/.test(location.protocol);
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={network:'<path d="m5 5 14 3-9 11-5-14Z"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="8" r="2"/><circle cx="10" cy="19" r="2"/>',route:'<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M5 7v4q0 2 2 2h10q2 0 2 2v2"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',list:'<path d="M4 6h16M4 12h16M4 18h16"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',plus:'<path d="M5 12h14m-7-7v14"/>',minus:'<path d="M5 12h14"/>',frame:'<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/>',hand:'<path d="M7 12V7a1.4 1.4 0 0 1 3 0v4-6a1.4 1.4 0 0 1 3 0v6-5a1.4 1.4 0 0 1 3 0v6-3a1.4 1.4 0 0 1 3 0v5q0 6-5 7H11q-2 0-4-3l-3-4q-1-3 2-2l2 2"/>',x:'<path d="m6 6 12 12m0-12L6 18"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',chev:'<path d="m9 5 7 7-7 7"/>',branch:'<path d="M5 5v14m0-8h8q4 0 4-4"/><circle cx="5" cy="4" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="17" cy="5" r="2"/>'};
function icon(key){return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[key]||'')+'</svg>'}
document.querySelectorAll('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
const records=new Map(candidates.filter(c=>c.decision).map(c=>[c.id,c.decision]));
const submitting=new Set();
let active=candidates[0]?.id||'',filter='all',noteFor=null,toastTimer,frame=null,drag=null;
const openSources=new Map([[active,true]]),openTurns=new Map(),coordinates=new Map(),layout=new Map();
let camera={x:0,y:0,z:1};
const viewport=$('#viewport'),edges=$('#edges'),nodes=$('#nodes');
const flows=[
 ['识别民事意图','先判断这一轮需要哪些法律知识。','本轮原话、必要前文和所指材料。','结合说话对象和前文处理“第二条改掉”。混合话题仅选取民事片段，意图不明暂留本会话待核。','为本轮选择办理方法和工具，域外原话不进入民事台账。','“供应商逾期交货，该怎么处理？”进入法律咨询。紧接着的“把第二条展开”承接上一答。'],
 ['关联会话与成果','把反馈连回用户看到的具体判断。','用户问题、模型公开答复、交付稿版本、引用条款和后续反馈。','分开标记谁说、给谁用、法律关系、争点、内容性质和反馈动作。找不到指代对象，保留待核。','按原顺序保存可回看的片段，连接“纠正哪句”“认可哪版”及相应材料。','“付款意见重做，表格保留”形成两条关联，分别指向付款结论与报告版式。'],
 ['归纳变更与例外','比较已有方法，提出可以独立取舍的变化。','同争点的片段、现有本体内容、相似情形和相反材料。','按独立案件计算证据。同一合同多次讨论合并计数；将本案事实、展示偏好与法律经验分别处理。','列明原做法、拟改内容、边界、缺口和拟影响的后案范围。','两次送审都讨论同一笔设备采购，证据包列明两次反馈，只计一个原案。'],
 ['冻结本期周报','让每次判断对应到当时看到的那组证据。','本期候选、来源原句、案件角色、提案与证据版本。','法律经验须有纠正原案、独立相似案和能改变判断的反例；证据数量、独立性及代表性由你审阅。缺证或冲突保留可见。','按周生成 HTML。每张卡标出采纳后的效力与缺口，变更证据后生成新的待审版本。','部分续保只有一份报价和一次纠正，本期显示“待补证”，仍可沿连线阅读原文。'],
 ['本人取舍与生效','把你的决定应用到准确的版本和范围。','当前所见的提案版本、证据快照、操作和可选说明。','采纳写入本人回执；不采纳关闭这个版本；提交详细说明退回补充。重复点击幂等，过期决定须重新审阅。','法律经验仅在匹配业务、任务、立场和时点的新案调用。版式只影响呈现，本案事实只归原案。','认可报告结构只改变报告的写法。批准付款核对方法后，新案仍须从自己的合同确定付款条件。']
];
const stateInfo=c=>{
 const r=records.get(c.id)?.action;
 if(r==='accepted')return ['已采纳','done'];if(r==='declined')return ['不采纳','rejected'];if(r==='revision')return ['已提说明','warn'];
 return c.ready?['可采纳','']:['待补证','warn'];
};
function visible(c){const r=records.get(c.id);return filter==='all'||(filter==='ready'?c.ready&&!r:(!c.ready&&!r)||r?.action==='revision');}
function stateTag(c){const [s,k]=stateInfo(c);return '<span class="state '+k+'">'+s+'</span>'}
function notify(s){clearTimeout(toastTimer);$('#notice').textContent=s;toastTimer=setTimeout(()=>$('#notice').textContent='',3400)}
function refreshList(){
 const items=candidates.filter(visible);
 $('#indexList').innerHTML=items.map(c=>'<button class="item '+(active===c.id?'active':'')+'" data-pick="'+c.id+'" aria-current="'+(active===c.id?'true':'false')+'"><span class="itemTop"><span>'+esc(c.type)+' · '+esc(c.category)+'</span>'+stateTag(c)+'</span><span class="itemTitle">'+esc(c.title)+'</span></button>').join('');
 $('#listCount').textContent=items.length;$('#mTotal').textContent=candidates.length;$('#mReady').textContent=candidates.filter(c=>c.ready&&!records.has(c.id)).length;$('#mDone').textContent=records.size;
 $('#empty').hidden=!!items.length;$('#emptyText').textContent=candidates.length?'没有符合筛选条件的提案。':'本期没有新增或更新的提案。';$('#clearFilter').hidden=!candidates.length;$('#saveLabel').textContent=live?'取舍由本人在 DSH 中提交':'只读归档 · 取舍须在 DSH 中提交';
 document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter===filter));
}
$('#weekLabel').textContent=view.period.year+' 年 · 第 '+view.period.number+' 周';
$('#rangeLabel').textContent=view.period.start+' — '+view.period.end+'　｜　材料截至 '+new Date(view.cutoff||view.generated).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
$('#originLabel').textContent=live?'本人审阅':'只读归档';
if(live){const brand=$('.identity');const link=document.createElement('a');link.className='identity';link.style.cssText='color:inherit;text-decoration:none';link.href='/civil-ontology/atlas';link.title='打开民事法律关系本体关系图';link.innerHTML=brand.innerHTML;brand.replaceWith(link);}
function actBtn(id,action,label,cls,extra=''){return '<button data-id="'+id+'" data-action="'+action+'" class="'+cls+'" '+extra+'>'+label+'</button>'}
function card(c){
 const rec=records.get(c.id);const idx=candidates.indexOf(c)+1;
 const actions=rec?'<div class="reviewed"><span>'+stateTag(c)+'</span>'+actBtn(c.id,'note','查看说明','textbtn')+'</div>':
   actBtn(c.id,'accept','采纳','primary',live&&c.ready?'':'disabled title="请先补齐证据或核实冲突"')+actBtn(c.id,'decline','不采纳','secondary',live?'':'disabled')+actBtn(c.id,'note','详细说明','plain');
 const small=viewport.clientWidth<560;
 const sourceLabel=small?'查看关联来源':openSources.get(c.id)?'收起来源':'展开来源';
 return '<article class="node proposal '+(active===c.id?'isactive':'')+'" data-card="'+c.id+'"><div class="cap"><span class="capLead"><i>'+icon('network')+'</i>'+esc(c.type)+'</span><small>提案 '+String(idx).padStart(2,'0')+' / '+String(candidates.length).padStart(2,'0')+'</small></div><div class="propBody"><div class="relation"><i>'+icon('route')+'</i>'+esc(c.relation)+'</div><h2>'+esc(c.title)+'</h2><p class="summary">'+esc(c.summary)+'</p><div class="scopeLine"><em>适用范围</em><p>'+esc(c.scope)+'</p></div><div class="scopeLine"><em>采纳后的影响</em><p>'+esc(c.impact)+'</p></div></div><div class="propStatus">'+stateTag(c)+actBtn(c.id,'sources',sourceLabel+' · '+c.sources.length+' <i>'+icon('branch')+'</i>','contextBtn','aria-expanded="'+!!openSources.get(c.id)+'"')+'</div>'+(!c.ready?'<p class="gateMsg">'+esc(c.gate)+'</p>':'')+'<div class="actions">'+actions+'</div></article>';
}
function source(c,s){const tone=s.role.includes('反')?'counter':s.role.includes('相似')?'similar':'origin';
 return '<button class="node source '+(openTurns.get(c.id)===s.id?'chosen':'')+'" data-id="'+c.id+'" data-source="'+s.id+'" data-tone="'+tone+'" aria-expanded="'+(openTurns.get(c.id)===s.id)+'"><span class="srcMeta"><span><i class="tagOrb"></i>'+esc(s.role)+'</span><span class="chev">'+icon('chev')+'</span></span><b>'+esc(s.title)+'</b></button>';
}
function thread(c,s){return '<article class="node thread" data-thread="'+s.id+'"><header class="threadHead"><div class="srcMeta"><span>'+esc(s.role)+' · 来源原文</span>'+actBtn(c.id,'back','返回提案','nodeback')+'</div><h3>'+esc(s.title)+'</h3><p>'+esc(s.setting)+'</p></header><div class="threadBody" tabindex="0" aria-label="可滚动的来源原文"><div class="turn"><b>情境归纳</b>'+esc(s.detail)+'</div>'+s.turns.map(t=>'<div class="turn"><b>'+esc(t.who)+'</b>'+esc(t.text)+'</div>').join('')+'<div class="quote"><strong>所引原句</strong><br>“'+esc(s.quote)+'”</div></div></article>'}
function position(el,x,y){el.style.left=x+'px';el.style.top=y+'px';return {x,y,w:el.offsetWidth,h:el.offsetHeight};}
function wire(a,b,kind=''){
 const x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x,y2=b.y+b.h/2,mid=(x1+x2)/2;
 return '<path d="M '+x1+' '+y1+' C '+mid+' '+y1+', '+mid+' '+y2+', '+x2+' '+y2+'" fill="none" stroke="'+(kind?'#7f9270':'#91a58a')+'" stroke-width="1.7"/><circle cx="'+x1+'" cy="'+y1+'" r="3.1" fill="#637f60"/><circle cx="'+x2+'" cy="'+y2+'" r="3.1" fill="#8b9c7b"/>';
}
function union(rects){if(!rects.length)return null;const x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y));return {x,y,w:Math.max(...rects.map(r=>r.x+r.w))-x,h:Math.max(...rects.map(r=>r.y+r.h))-y};}
function graph(){
 const items=candidates.filter(visible);
 nodes.innerHTML=items.map(c=>card(c)+(openSources.get(c.id)?c.sources.map(s=>source(c,s)+(openTurns.get(c.id)===s.id?thread(c,s):'')).join(''):'')).join('');
 let wires='';coordinates.clear();layout.clear();
 const heights=items.map(c=>{
   const box=nodes.querySelector('[data-card="'+c.id+'"]');
   if(!openSources.get(c.id))return box.offsetHeight;
   const sourceHeight=c.sources.reduce((height,s)=>height+nodes.querySelector('[data-source="'+s.id+'"]').offsetHeight+15,0);
   const open=nodes.querySelector('[data-thread="'+openTurns.get(c.id)+'"]');
   return Math.max(box.offsetHeight,sourceHeight+(open?open.offsetHeight:0));
 });
 const centers=[0];const rowHeights=[];
 for(let i=0;i<heights.length;i+=2){rowHeights.push(Math.max(heights[i],heights[i+1]||0));}
 for(let row=1;row<rowHeights.length;row++)centers.push(centers[row-1]+Math.max(1120,(rowHeights[row-1]+rowHeights[row])/2+150));
 items.forEach((c,i)=>{
   const bx=(i%2)*1700,by=centers[Math.floor(i/2)],cardEl=nodes.querySelector('[data-card="'+c.id+'"]');
   const cardBox=position(cardEl,bx,by-cardEl.offsetHeight/2),parts=[cardBox];coordinates.set(c.id,cardBox);
   if(openSources.get(c.id)){
     const srcEls=c.sources.map(s=>nodes.querySelector('[data-source="'+s.id+'"]')),gap=15,total=srcEls.reduce((v,el)=>v+el.offsetHeight,0)+gap*(srcEls.length-1);
     let y=by-total/2;
     c.sources.forEach((s,j)=>{const a=position(srcEls[j],bx+415,y);parts.push(a);coordinates.set(s.id,a);y+=a.h+gap;wires+=wire(cardBox,a);
       if(openTurns.get(c.id)===s.id){const el=nodes.querySelector('[data-thread="'+s.id+'"]');const t=position(el,a.x+a.w+75,a.y+a.h/2-el.offsetHeight/2);coordinates.set('t-'+s.id,t);parts.push(t);wires+=wire(a,t,'thread');}
     });
   }
   layout.set(c.id,union(parts));
 });edges.innerHTML=wires;refreshList();
}
function paint(){const {x,y,z}=camera;$('#world').style.transform='translate('+x+'px,'+y+'px) scale('+z+')';viewport.style.backgroundSize=20*z+'px '+20*z+'px';viewport.style.backgroundPosition=x+'px '+y+'px';$('#scale').textContent=Math.round(z*100)+'%';}
function center(box,max=1,min=.12){
 if(!box||!viewport.clientWidth||!viewport.clientHeight)return;
 const w=viewport.clientWidth,h=viewport.clientHeight,pad=w<510?14:32,top=15,bottom=55;
 const z=Math.max(min,Math.min((w-2*pad)/box.w,(h-top-bottom)/box.h,max));
 camera={z,x:(w-box.w*z)/2-box.x*z,y:top+(h-top-bottom-box.h*z)/2-box.y*z};paint();
}
function fitActive(){$('#branchBack').hidden=true;const box=viewport.clientWidth<560?coordinates.get(active):layout.get(active);center(box,1.12)}
function fitSource(id){const threadBox=coordinates.get('t-'+id),sourceBox=coordinates.get(id);if(threadBox){center(viewport.clientWidth<710?threadBox:union([threadBox,sourceBox]),1.07);$('#branchBack').hidden=viewport.clientWidth>=560;}else fitActive();}
function zoomAt(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2){const z=Math.min(2.3,Math.max(.12,camera.z*factor));camera={z,x:x-(x-camera.x)*z/camera.z,y:y-(y-camera.y)*z/camera.z};paint();}
function select(id){if(!byId.has(id))return;active=id;openSources.set(id,true);$('.index').classList.remove('open');graph();fitActive();}
async function submitDecision(c,action,note=''){
 if(!live||submitting.has(c.id)||records.has(c.id))return false;
 submitting.add(c.id);
 try{
   const res=await fetch(location.pathname,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Civil-Weekly':'1'},body:JSON.stringify({id:c.id,version:c.version,action,note})});
   const result=await res.json();
   if(!res.ok)throw Error(result.error||'提交失败，请重新打开 DSH 周报。');
   records.set(c.id,result.receipt);afterDecision();
   notify(action==='accepted'?'已采纳 · '+c.scope:action==='revision'?'说明已保存，待补充复核。':'本版本已标记为不采纳。');return true;
 }catch(e){notify(e.message);return false;}finally{submitting.delete(c.id);}
}
function afterDecision(){const first=candidates.find(visible);if(!visible(byId.get(active))&&first){active=first.id;openSources.set(active,true);}graph();fitActive();}
function setNote(c){
 noteFor=c.id;const rec=records.get(c.id);$('#noteTitle').textContent=rec?'取舍说明':'详细说明';$('#noteSubject').textContent=c.title;
 $('#noteGate').textContent=['拟议变化　'+c.change,'原判断　'+c.before,'据此调整　'+c.after,'证据情况　'+c.gate,'采纳范围　'+c.impact].join('\n\n');
 $('#noteText').value=rec?.note||'';$('#noteText').readOnly=!!rec||!live;$('#noteSubmit').hidden=!!rec||!live;$('#noteSubmit').disabled=true;$('#noteDialog').showModal();
}
nodes.addEventListener('click',e=>{
 const src=e.target.closest('[data-source]'),action=e.target.closest('[data-action]'),head=e.target.closest('[data-card]');
 if(src){active=src.dataset.id;const id=src.dataset.source;if(openTurns.get(active)===id){openTurns.delete(active);graph();fitActive()}else{openTurns.set(active,id);graph();fitSource(id)}return;}
 if(!action){if(head&&active!==head.dataset.card)select(head.dataset.card);return;}
 const id=action.dataset.id,op=action.dataset.action,c=byId.get(id);active=id;
 if(op==='sources'){const small=viewport.clientWidth<560;openSources.set(id,small||!openSources.get(id));openTurns.delete(id);graph();if(small){center(union(c.sources.map(s=>coordinates.get(s.id))),1.04);$('#branchBack').hidden=false;}else fitActive();return;}
 if(op==='back'){openTurns.delete(id);graph();fitActive();return;}
 if(op==='note'){setNote(c);return;}
 if(records.has(id)||op==='accept'&&!c.ready)return;
 if(op==='accept'||op==='decline')submitDecision(c,op==='accept'?'accepted':'declined');
});
$('#noteText').addEventListener('input',()=>$('#noteSubmit').disabled=!$('#noteText').value.trim());
$('#noteForm').addEventListener('submit',async e=>{e.preventDefault();const txt=$('#noteText').value.trim();if(!noteFor||!txt||records.has(noteFor))return;if(await submitDecision(byId.get(noteFor),'revision',txt))$('#noteDialog').close();});
$('#closeNote').onclick=$('#noteCancel').onclick=()=>$('#noteDialog').close();
$('#noteDialog').addEventListener('close',()=>{const id=noteFor;noteFor=null;nodes.querySelector('[data-id="'+id+'"][data-action="note"]')?.focus({preventScroll:true});});
$('#indexList').addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(b)select(b.dataset.pick)});
function changeFilter(which){filter=which;const item=candidates.filter(visible).find(c=>c.id===active)||candidates.find(visible);if(item)select(item.id);else graph();}
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>changeFilter(b.dataset.filter));$('#clearFilter').onclick=()=>changeFilter('all');
$('#mobileIndex').onclick=()=>$('.index').classList.toggle('open');
$('#branchBack').onclick=()=>{openTurns.delete(active);graph();fitActive();};
$('#zoomOut').onclick=()=>zoomAt(1/1.2);$('#zoomIn').onclick=()=>zoomAt(1.2);$('#fit').onclick=fitActive;$('#overview').onclick=()=>center(union([...layout.values()]),1);
viewport.addEventListener('wheel',e=>{if(e.target.closest('.threadBody')&&!e.ctrlKey&&!e.metaKey)return;e.preventDefault();const r=viewport.getBoundingClientRect();zoomAt(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.004),e.clientX-r.left,e.clientY-r.top)},{passive:false});
viewport.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button,.node,.controlbar,#empty'))return;drag={id:e.pointerId,x:e.clientX-camera.x,y:e.clientY-camera.y};viewport.setPointerCapture(e.pointerId);viewport.classList.add('drag');});
viewport.addEventListener('pointermove',e=>{if(drag?.id!==e.pointerId)return;camera.x=e.clientX-drag.x;camera.y=e.clientY-drag.y;paint()});
function endDrag(){drag=null;viewport.classList.remove('drag')}viewport.addEventListener('pointerup',endDrag);viewport.addEventListener('pointercancel',endDrag);
viewport.addEventListener('keydown',e=>{if(e.target!==viewport)return;const moves={ArrowLeft:[60,0],ArrowRight:[-60,0],ArrowUp:[0,60],ArrowDown:[0,-60]};if(moves[e.key]){e.preventDefault();camera.x+=moves[e.key][0];camera.y+=moves[e.key][1];paint()}if(e.key==='+'||e.key==='=')zoomAt(1.2);if(e.key==='-')zoomAt(1/1.2);if(e.key==='Home')fitActive();});
function flow(n){$('#flowSteps').innerHTML=flows.map((v,i)=>'<button class="flowstep '+(i===n?'on':'')+'" data-step="'+i+'" aria-current="'+(i===n?'step':'false')+'"><span class="num">0'+(i+1)+'</span><b>'+v[0]+'</b><i>'+icon('chev')+'</i></button>').join('');const a=flows[n];$('#flowDetail').innerHTML='<div class="period">环节 0'+(n+1)+' / 05</div><h2>'+a[0]+'</h2><p>'+a[1]+'</p><dl class="flowrows">'+['输入材料','通过条件','输出与效力'].map((s,i)=>'<div><dt>'+s+'</dt><dd>'+a[i+2]+'</dd></div>').join('')+'</dl><div class="flowexample"><b>会话示例</b>'+a[5]+'</div>';}
$('#flowSteps').onclick=e=>{const step=e.target.closest('[data-step]');if(step)flow(Number(step.dataset.step))};
function page(isFlow){$('#boardPage').hidden=isFlow;$('#flowPage').hidden=!isFlow;['canvasTab','flowTab'].forEach((k,i)=>{const b=$('#'+k),on=Boolean(i)===isFlow;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});if(!isFlow){graph();fitActive();}}
$('#canvasTab').onclick=()=>page(false);$('#flowTab').onclick=()=>page(true);
new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!$('#boardPage').hidden){graph();const s=openTurns.get(active);if(s)fitSource(s);else fitActive();}})}).observe(viewport);
flow(0);graph();fitActive();
