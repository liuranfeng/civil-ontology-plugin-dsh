'use strict';
const K=JSON.parse(document.getElementById('ontology-data').textContent);
const {model,methods,statutes,enterprise}=K;
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const types=model.types, rels=model.relations.map(([from,label,to],id)=>({from,label,to,id}));
const attached=t=>rels.filter(r=>r.from===t||r.to===t);
const opposite=(r,t)=>r.from===t?r.to:r.from;
const codeByLabel=new Map(statutes.map((r,i)=>[r.label,i]));
const viewport=$('#viewport'),dialog=$('#detail');
let root=types.includes('请求权基础')?'请求权基础':types[0],expanded=new Set([root]),all=false,view='graph',drag,resizeFrame;
let positions=new Map(),drawn=[],camera={x:0,y:0,z:1};
const groups=['办理方法','民法典','企业审查',...(K.experience?['本案可用经验']:[])];
let libraryGroup=0,kind='',query='',pageNo=0;
function button(action,label,index,cls=''){return '<button type="button" data-op="'+action+'" data-idx="'+index+'" class="'+cls+'">'+esc(label)+'</button>';}
function combined(entries){if(!entries.length)return;const x=Math.min(...entries.map(e=>e.x)),y=Math.min(...entries.map(e=>e.y));return{x,y,w:Math.max(...entries.map(e=>e.x+e.w))-x,h:Math.max(...entries.map(e=>e.y+e.h))-y};}
function paint(){const {x,y,z}=camera;$('#world').style.transform='translate('+x+'px,'+y+'px) scale('+z+')';viewport.style.backgroundSize=20*z+'px '+20*z+'px';viewport.style.backgroundPosition=x+'px '+y+'px';$('#zoom').textContent=Math.round(z*100)+'%';}
function frame(area,limit=1.09){if(!area||!viewport.clientWidth||!viewport.clientHeight)return;const w=viewport.clientWidth,h=viewport.clientHeight,pad=w<500?13:25;const z=Math.max(.10,Math.min(limit,(w-pad*2)/area.w,(h-68)/area.h));camera={z,x:(w-area.w*z)/2-area.x*z,y:10+(h-57-area.h*z)/2-area.y*z};paint();}
function focusFrame(){frame(viewport.clientWidth<550?positions.get(root):combined([...positions.values()]),1.13);}
function zoom(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2){const z=Math.max(.10,Math.min(2.4,camera.z*factor));camera={z,x:x-(x-camera.x)*z/camera.z,y:y-(y-camera.y)*z/camera.z};paint();}
function liveGraph(){
 const entries=new Map([[root,{level:0}]]),queue=[root],edges=new Set();
 function walk(){for(let i=0;i<queue.length;i++){
   const t=queue[i];if(!expanded.has(t)&&!all)continue;
   for(const r of attached(t)){edges.add(r.id);const other=opposite(r,t);if(!entries.has(other)){
     const level=entries.get(t).level;
     // Continue outward after the first column, keeping cyclic references as real edges.
     entries.set(other,{level:level===0?(r.from===t?1:-1):level+Math.sign(level),via:r,parent:t});queue.push(other);
   }}
 }}
 walk();
 if(all)for(const t of types)if(!entries.has(t)){queue.length=0;queue.push(t);entries.set(t,{level:0});walk();}
 return {entries,edges:[...edges].map(id=>rels[id])};
}
function nodeMarkup(t,meta){
 const ix=types.indexOf(t),incident=attached(t),incoming=incident.filter(r=>r.to===t).length;
 const focal=t===root,neighbor=meta.via;
 const plain='<div class="nodeTop">本体对象</div>';
 const description=focal?incoming+' 项关系指向本对象，'+(incident.length-incoming)+' 项关系由此出发。':neighbor?[neighbor.from,neighbor.label,neighbor.to].map(esc).join(' → '):'';
 const connected=focal?button('relationships','逐项看关系',ix):button('center','以此为中心',ix);
 const extra=focal&&['请求权','请求权基础'].includes(t)?button('claim','请求权核对项',ix):'';
 const source=focal&&t==='适用法'?button('statutes','查民法典',ix):focal&&t==='术语与机构'?button('terms','查贸易术语',ix):focal&&['企业审核事项','制度表列口径'].includes(t)?button('company','查企业审查资料',ix):'';
 return '<article class="node '+(focal?'focus':'')+'" data-object="'+ix+'" aria-label="'+esc(t)+'">'+(focal?'<div class="cap"><b>当前对象</b><small>本体关系</small></div>':'')+'<div class="nodeMain">'+(focal?'':plain)+'<h2>'+esc(t)+'</h2><p>'+description+'</p></div><div class="actions">'+connected+extra+source+(!all&&incident.length?button('toggle',expanded.has(t)?'收起相邻关系':'展开相邻关系',ix):'')+'</div></article>';
}
function draw(){
 const {entries,edges}=liveGraph();drawn=edges;
 const cards=$('#cards');cards.innerHTML=[...entries].map(([t,row])=>nodeMarkup(t,row)).join('');
 const levels=new Map(),out=new Map();
 for(const [t,row] of entries){if(!levels.has(row.level))levels.set(row.level,[]);levels.get(row.level).push(t);}
 for(const [level,ts] of levels){
   const measured=ts.map(t=>({t,el:cards.querySelector('[data-object="'+types.indexOf(t)+'"]')}));
   const gap=21,total=measured.reduce((n,{el})=>n+el.offsetHeight,0)+(measured.length-1)*gap;
   let y=-total/2;
   for(const {t,el} of measured){const w=el.offsetWidth,h=el.offsetHeight,x=level*298-w/2;el.style.left=x+'px';el.style.top=y+'px';out.set(t,{x,y,w,h});y+=h+gap;}
 }
 positions=out;
 const pathData=edges.map(({from,to,id})=>{const a=out.get(from),b=out.get(to);let x1,y1,x2,y2,d;
   if(Math.abs(a.x-b.x)>100){const dir=b.x>a.x?1:-1;x1=dir===1?a.x+a.w:a.x;y1=a.y+a.h/2;x2=dir===1?b.x-3:b.x+b.w+3;y2=b.y+b.h/2;
     const mid=(x1+x2)/2;d='M '+x1+' '+y1+' C '+mid+' '+y1+', '+mid+' '+y2+', '+x2+' '+y2;
   }else{x1=a.x+a.w/2;y1=a.y+(b.y>a.y?a.h:0);x2=b.x+b.w/2;y2=b.y+(b.y>a.y?-3:b.h+3);const curve=Math.max(a.x+a.w,b.x+b.w)+25;d='M '+x1+' '+y1+' C '+curve+' '+y1+', '+curve+' '+y2+', '+x2+' '+y2;}
   return '<path data-edge="'+id+'" d="'+d+'" fill="none" stroke="#81977a" stroke-width="1.65" marker-end="url(#tip)"><title>'+esc(from+' '+rels[id].label+' '+to)+'</title></path>';
 }).join('');
 $('#wires').innerHTML='<defs><marker id="tip" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#688260"/></marker></defs>'+pathData;
 $('#crumb').textContent=root;$('#all').textContent=all?'回到当前对象':'展开全图';indexList();
}
function indexList(){const q=$('#typeSearch').value.toLowerCase().trim(),list=types.filter(t=>!q||t.toLowerCase().includes(q)||attached(t).some(r=>r.label.toLowerCase().includes(q)));
 $('#typeList').innerHTML=list.length?list.map(t=>'<button data-pick="'+types.indexOf(t)+'" class="'+(t===root?'active':'')+'" '+(t===root?'aria-current="true"':'')+'><span>'+esc(t)+'</span><small>'+attached(t).length+' 关系</small></button>').join(''):'<p class="empty">未找到匹配对象。</p>';
}
function choose(t){if(!types.includes(t))return;root=t;expanded=new Set([t]);all=false;$('#index').classList.remove('open');draw();focusFrame();}
function modal(type,title,html){$('#detailKind').textContent=type;$('#detailTitle').textContent=title;$('#detailBody').innerHTML=html;if(!dialog.open)dialog.showModal();dialog.scrollTop=0;}
function paragraph(title,value){return value?'<div class="block"><h3>'+esc(title)+'</h3><p>'+esc(value)+'</p></div>':'';}
function section(title,html){return html?'<section class="block"><h3>'+esc(title)+'</h3>'+html+'</section>':'';}
function list(rows){return rows?.length?'<ul>'+rows.map(v=>'<li>'+esc(v)+'</li>').join('')+'</ul>':'';}
function showRelations(t){const touching=all?rels:attached(t);modal('基础本体 · 有向关系',all?'全部关系':t+'的关系',
    paragraph('阅读方向','从第一项对象出发，沿本体原文所列的关系，指向最后一项对象。选择一行可定位到相邻对象。')+
    touching.map(r=>button('center',[r.from,r.label,r.to].join('　→　'),types.indexOf(r.to===t?r.from:r.to),'edgeitem')).join(''));
}
function claim(){modal('本体内置 · 请求权分析','逐项核对请求权',section('每个主要请求均须说明','<ol>'+model.requiredForClaim.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol>')+paragraph('来源',model.version+'中的请求权核对项。'));}
function op(event){
 const b=event.target.closest('[data-op]');if(!b)return;const t=types[Number(b.dataset.idx)],a=b.dataset.op;
 if(a==='center'){if(dialog.open)dialog.close();choose(t);}
 else if(a==='toggle'){if(expanded.has(t))expanded.delete(t);else expanded.add(t);draw();if(viewport.clientWidth<550){if(expanded.has(t))showRelations(t);else frame(positions.get(root));}else frame(combined([...positions.values()]));}
 else if(a==='relationships')showRelations(t);else if(a==='claim')claim();
 else if(a==='statutes')openLibrary(1);else if(a==='company')openLibrary(2);else if(a==='terms')openLibrary(0,'贸易术语');
 else if(a==='statute')showStatute(Number(b.dataset.idx));else if(a==='method')showMethod(Number(b.dataset.idx));else if(a==='enterprise')showEnterprise(Number(b.dataset.idx));
 else if(a==='experience'){const r=K.experience[Number(b.dataset.idx)];if(r)modal('本人已采纳 · 本案匹配',r.title,paragraph('适用范围',r.scope)+paragraph('已采纳的内容',r.change)+section('审阅时的证据类别',list(r.sources.map(s=>[s.role,s.title].filter(Boolean).join(' · ')))));}
}
$('#cards').addEventListener('click',op);$('#detailBody').addEventListener('click',op);$('#results').addEventListener('click',op);
$('#detailBody').addEventListener('click',e=>{const p=e.target.closest('[data-back-method]');if(p)showMethod(Number(p.dataset.backMethod));});
$('#indexBtn').onclick=()=>$('#index').classList.add('open');$('#closeIndex').onclick=()=>$('#index').classList.remove('open');
$('#typeSearch').oninput=indexList;$('#typeList').onclick=e=>{const b=e.target.closest('[data-pick]');if(b)choose(types[Number(b.dataset.pick)])};
$('#dialogClose').onclick=()=>dialog.close();$('#relationList').onclick=()=>showRelations(root);
$('#all').onclick=()=>{all=!all;draw();frame(combined([...positions.values()]));};$('#fit').onclick=()=>frame(combined([...positions.values()]));
$('#locate').onclick=()=>frame(positions.get(root));$('#minus').onclick=()=>zoom(1/1.2);$('#plus').onclick=()=>zoom(1.2);
viewport.addEventListener('wheel',e=>{e.preventDefault();const {left,top}=viewport.getBoundingClientRect();zoom(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.004),e.clientX-left,e.clientY-top)},{passive:false});
viewport.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button,.node,.controls'))return;drag={id:e.pointerId,x:e.clientX-camera.x,y:e.clientY-camera.y};viewport.setPointerCapture(e.pointerId);viewport.classList.add('drag');});
viewport.addEventListener('pointermove',e=>{if(drag?.id===e.pointerId){camera.x=e.clientX-drag.x;camera.y=e.clientY-drag.y;paint();}});
function end(){drag=undefined;viewport.classList.remove('drag')}viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
viewport.addEventListener('keydown',e=>{if(e.target!==viewport)return;const m={ArrowLeft:[60,0],ArrowRight:[-60,0],ArrowUp:[0,60],ArrowDown:[0,-60]}[e.key];if(m){e.preventDefault();camera.x+=m[0];camera.y+=m[1];paint()}if(e.key==='Home'){e.preventDefault();focusFrame()}if(e.key==='+'||e.key==='=')zoom(1.2);if(e.key==='-')zoom(1/1.2);});
function shown(v){view=v;$('#graphPage').hidden=v!=='graph';$('#library').hidden=v!=='library';for(const [key,tab] of [['graph','#graphTab'],['library','#libraryTab']]){if(v===key)$(tab).setAttribute('aria-current','page');else $(tab).removeAttribute('aria-current');}
 $('#pageTitle').textContent=v==='graph'?'民事关系画布':'知识资料';
 $('#summary').textContent=v==='graph'?'沿箭头查看法律对象之间的关系。':'查阅随包收录的方法、条文及企业资料。';
 $('#metrics').innerHTML=(v==='graph'?[[types.length,'对象'],[rels.length,'关系'],[methods.length,'方法']]:[[methods.length,'方法'],[statutes.length,'条文'],[enterprise.cards.length,'事项']]).map(([n,s])=>'<div><strong>'+n+'</strong><span>'+s+'</span></div>').join('');}
function openLibrary(group=0,filter=''){shown('library');libraryGroup=group;kind=filter;query='';pageNo=0;$('#librarySearch').value='';library();}
function sourcesLink(name,url){if(!url)return '';try{const u=new URL(url);if(u.protocol!=='https:')return '';return '<a target="_blank" rel="noopener noreferrer" href="'+esc(u.href)+'">'+esc(name||'公开原文')+' ↗</a>';}catch{return '';}}
function articleRefs(r){return (r.claim?.comparableLaw||[]).map(label=>codeByLabel.has(label)?button('statute',label,codeByLabel.get(label),'textbtn'):esc(label)).join('、');}
function showMethod(i){const r=methods[i];if(!r)return;
 const ref=articleRefs(r),sup=(r.supporting||[]).map(s=>typeof s==='string'?paragraph('补充依据',s):paragraph('补充依据',[s.source,s.locator,s.quote].filter(Boolean).join('　'))+(s.url?section('补充出处',sourcesLink(s.source,s.url)):'' )).join('');
 const cf=r.claim||{};
 modal(r.kind+' · '+r.domain,r.title,
   paragraph('所涉关系',r.relation)+paragraph('适用前提',r.scope)+paragraph('需要核对的材料',r.evidence)+paragraph('区别与例外',r.counter)+paragraph('需要回答',r.question)+section('办理说明',list(r.details))+
   paragraph('请求人与相对人',cf.parties)+paragraph('主张的法律效果',cf.effect)+paragraph('成立条件',cf.conditions)+section('本条方法列出的对照法条',ref)+
   paragraph('来源',[r.source,r.locator].filter(Boolean).join('　'))+paragraph('来源摘录',r.quote)+section('公开出处',sourcesLink(r.source,r.url))+sup+paragraph('方法收录',K.approval.approvedOn+' 确认 · 方法批次 '+K.approval.release));
 for(const b of $('#detailBody').querySelectorAll('[data-op=statute]'))b.dataset.fromMethod=i;
}
let backToMethod=null;
$('#detailBody').addEventListener('click',e=>{const b=e.target.closest('[data-from-method]');if(b)backToMethod=Number(b.dataset.fromMethod);},true);
function showStatute(i){const r=statutes[i];if(!r)return;const related=backToMethod;backToMethod=null;
 modal('随包法源 · 《中华人民共和国民法典》',r.label,paragraph('编章位置',[r.book,r.division,r.chapter,r.section].filter(Boolean).join(' · '))+paragraph('条文',r.text)+paragraph('来源','《中华人民共和国民法典》随包条文。')+(related!=null?'<button class="chip" data-back-method="'+related+'">返回方法</button>':''));
}
const entRows=[...enterprise.cards.map(r=>({title:r.title,tag:'审查事项',scope:r.section,body:r})),...enterprise.families.map(r=>({title:r.name,tag:'审查主题',scope:'企业审查',body:r})),...enterprise.conflicts.map(r=>({title:r.title,tag:'适用冲突',scope:'需核适用范围',body:r}))];
function showEnterprise(i){const o=entRows[i];if(!o)return;const r=o.body;modal('企业审查 · '+o.tag,r.title||r.name,paragraph('适用边界',enterprise.scope)+paragraph('分组',r.groups?.join('、'))+paragraph('资料状态',r.status)+paragraph('来源',[r.source,r.location].filter(Boolean).join('　'))+(r.fields||[]).map(([s,v])=>paragraph(s,v)).join('')+paragraph('需要核对',r.question)+paragraph('证据',r.evidence)+paragraph('请求权联系',r.claim)+paragraph('处置',r.disposition)+paragraph('涉及事项',r.topics?.join('、')));}
function library(){
 $('#libraryTabs').innerHTML=groups.map((g,i)=>'<button class="chip" aria-pressed="'+(libraryGroup===i)+'" data-group="'+i+'">'+g+'</button>').join('');
 const filters=libraryGroup===0?[...new Set(methods.map(r=>r.kind))]:libraryGroup===2?['审查事项','审查主题','适用冲突']:[];
 $('#byKind').innerHTML=filters.length?['',...filters].map(k=>'<button class="chip" aria-pressed="'+(kind===k)+'" data-kind="'+esc(k)+'">'+esc(k||'全部')+'</button>').join(''):'';
 const needle=query.toLowerCase().trim(),num=needle.match(/^(?:第)?(\d+)(?:条)?$/)?.[1],rows=[];
 if(libraryGroup===0){methods.forEach((r,i)=>{if((!kind||r.kind===kind)&&(!needle||JSON.stringify(r).toLowerCase().includes(needle)))rows.push([i,r.kind+' · '+r.domain,r.title,r.question||r.source,'method']);});}
 else if(libraryGroup===1){statutes.forEach((r,i)=>{if(!needle||(num?Number(num)===r.number:[r.label,r.text,r.book,r.chapter].join('').toLowerCase().includes(needle)))rows.push([i,r.book+' · '+r.chapter,r.label,r.text,'statute']);});}
 else if(libraryGroup===2){entRows.forEach((r,i)=>{if((!kind||r.tag===kind)&&(!needle||JSON.stringify(r.body).toLowerCase().includes(needle)))rows.push([i,r.tag,r.title,r.scope,'enterprise']);});}
 else{K.experience.forEach((r,i)=>{if(!needle||[r.title,r.scope,r.change].join(' ').toLowerCase().includes(needle))rows.push([i,{legal:'特定范围办案经验',presentation:'表达偏好',case:'本案记录'}[r.kind]||'已采纳经验',r.title,r.scope,'experience']);});}
 const size=12,total=Math.ceil(rows.length/size);pageNo=Math.max(0,Math.min(pageNo,total-1));
 $('#resultHead').textContent=rows.length+' 项资料';
 $('#results').innerHTML=rows.slice(pageNo*size,(pageNo+1)*size).map(([i,tag,title,desc,op])=>'<button class="entry" data-op="'+op+'" data-idx="'+i+'"><small>'+esc(tag)+'</small><b>'+esc(title)+'</b><p>'+esc(desc.length>38?desc.slice(0,38)+'…':desc)+'</p></button>').join('')||'<p class="empty">没有找到匹配的资料。</p>';
 $('#pages').innerHTML=total>1?'<button class="small" data-page="-1" '+(!pageNo?'disabled':'')+'>上一页</button><span>'+(pageNo+1)+' / '+total+'</span><button class="small" data-page="1" '+(pageNo===total-1?'disabled':'')+'>下一页</button>':'';
}
$('#graphTab').onclick=()=>{shown('graph');draw();focusFrame()};$('#libraryTab').onclick=()=>openLibrary(libraryGroup,kind);
$('#libraryTabs').onclick=e=>{const b=e.target.closest('[data-group]');if(b)openLibrary(Number(b.dataset.group))};
$('#byKind').onclick=e=>{const b=e.target.closest('[data-kind]');if(b){kind=b.dataset.kind;pageNo=0;library()}};
$('#librarySearch').oninput=e=>{query=e.target.value;pageNo=0;library()};
$('#pages').onclick=e=>{const b=e.target.closest('[data-page]');if(b){pageNo+=Number(b.dataset.page);library();$('#library').scrollTop=0;}};
$('#edition').textContent='基础本体 '+model.version.split(' ').pop();
new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(view==='graph'){draw();focusFrame();}})}).observe(viewport);
shown('graph');draw();focusFrame();
if(K.experience)openLibrary(3);
