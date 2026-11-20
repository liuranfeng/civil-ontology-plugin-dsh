import { createHash } from 'node:crypto';
import { inflateRawSync, crc32 } from 'node:zlib';
import { writeZip } from './zip.mjs';
import { replaceParagraph, replaceInlineAt, insertParagraphAfter, acceptAll, inlineDiff, paragraphText as ooxmlParagraphText, commentRange } from './revise.mjs';
import { parseXml, descendants, children, textContent, xmlText, xmlAttr, decode } from './xml.mjs';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const error = (code,message,status=400) => Object.assign(new Error(message),{code,status});
const limit=32*1024*1024, W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export function readPackage(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>12*1024*1024)throw error('INVALID_DOCX','DOCX/ZIP大小不支持（上限12MB）。');
  try {
    let e=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){e=i;break;}
    if(e<0)throw Error();
    const count=bytes.readUInt16LE(e+10), size=bytes.readUInt32LE(e+12);let off=bytes.readUInt32LE(e+16),total=0;
    if(!count||count>1500||off+size>e||bytes.readUInt16LE(e+4)||bytes.readUInt16LE(e+6))throw Error();
    const entries=new Map();
    for(let i=0;i<count;i++) {
      if(off+46>e||bytes.readUInt32LE(off)!==0x02014b50)throw Error();
      const flags=bytes.readUInt16LE(off+8),method=bytes.readUInt16LE(off+10),checksum=bytes.readUInt32LE(off+16),compressed=bytes.readUInt32LE(off+20),expanded=bytes.readUInt32LE(off+24),n=bytes.readUInt16LE(off+28),extra=bytes.readUInt16LE(off+30),comment=bytes.readUInt16LE(off+32),local=bytes.readUInt32LE(off+42);
      if((flags&1)||![0,8].includes(method)||expanded>limit||compressed>bytes.length||off+46+n+extra+comment>e)throw Error();
      const name=bytes.subarray(off+46,off+46+n).toString('utf8');off+=46+n+extra+comment;
      if(entries.has(name)||name.includes('..')||name.startsWith('/')||name.includes('\\'))throw Error();
      if(local+30>bytes.length||bytes.readUInt32LE(local)!==0x04034b50)throw Error();
      const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
      if(start+compressed>bytes.length||(total+=expanded)>limit)throw Error();
      const data=bytes.subarray(start,start+compressed), decoded=method===8?inflateRawSync(data,{maxOutputLength:Math.max(1,Math.min(expanded+1,limit))}):Buffer.from(data);
      if(decoded.length!==expanded||crc32(decoded)!==checksum)throw Error();
      if(!name.endsWith('/'))entries.set(name,decoded);
    }
    if(!entries.has('word/document.xml')||!entries.has('[Content_Types].xml'))throw Error();
    return entries;
  } catch {throw error('INVALID_DOCX','DOCX/ZIP损坏、压缩方式不支持或解压量超限。');}
}
const elementChildren=n=>n.children.filter(c=>c.name!=='#text');
function simpleParagraph(p,xml) {
  const parts=elementChildren(p),runs=parts.filter(n=>n.name==='w:r');
  const properties=[...descendants(p,'w:pPr'),...descendants(p,'w:rPr')];
  // The reused generator recognizes exact property tags. Unusual attributes or
  // namespace declarations must not be silently stripped by its legacy regex.
  const safeProperties=properties.every(n=>xml.slice(n.start,n.openEnd)===`<${n.name}>`||xml.slice(n.start,n.end)===`<${n.name}/>`);
  return safeProperties&&runs.length>0&&parts.every(n=>['w:pPr','w:r'].includes(n.name))&&runs.every(r=>elementChildren(r).every(n=>['w:rPr','w:t'].includes(n.name)));
}
function paragraphText(p) {
  let out='';const walk=n=>{if(n.name==='w:t'){out+=textContent(n);return;}if(n.name==='w:tab'){out+='\t';return;}if(n.name==='w:br'){out+='\n';return;}for(const c of n.children??[])walk(c);};walk(p);return out;
}
export function readDocument(bytes) {
  const entries=readPackage(bytes),xml=entries.get('word/document.xml').toString('utf8'),parsed=parseXml(xml),root=children(parsed,'w:document')[0],body=root&&children(root,'w:body')[0];
  if(!body||root.attrs['xmlns:w']!==W)throw error('UNSUPPORTED_DOCX','当前仅支持标准Word主文档命名空间。');
  if(/<w:(?:ins|del|moveFrom|moveTo|pPrChange|rPrChange|tblPrChange)\b/.test(xml))throw error('UNRESOLVED_REVISIONS','来稿含未决Word修订，请先明确接受/拒绝后另存副本再导入；原件未改。');
  if(/<w:(?:vanish|webHidden|specVanish)\b/.test(xml))throw error('HIDDEN_TEXT','来稿含隐藏文字格式，当前不支持安全编辑，请先核对并另存副本；原件未改。');
  const blocks=[], warnings=[];
  function walk(n,inTable=false,locked=false) {
    if(n.name==='w:p') {
      const text=paragraphText(n),pPr=children(n,'w:pPr')[0],style=pPr&&descendants(pPr,'w:pStyle')[0]?.attrs['w:val'];
      const id=`b_${blocks.length.toString(36).padStart(4,'0')}_${sha(xml.slice(n.start,n.end)).slice(0,8)}`;
      const b={id,text,inTable,editable:!locked&&simpleParagraph(n,xml),style:style??'',start:n.start,end:n.end};
      blocks.push(b);if(!b.editable&&text)warnings.push({blockId:id,message:'含复杂结构，只读展示；当前不支持修改此段。'});
      return {kind:'paragraph',blockId:id};
    }
    if(n.name==='w:tbl')return {kind:'table',rows:children(n,'w:tr').map(row=>({cells:children(row,'w:tc').map(cell=>({span:Math.min(20,Math.max(1,Number(descendants(cell,'w:gridSpan')[0]?.attrs['w:val'])||1)),children:elementChildren(cell).map(c=>walk(c,true,locked)).filter(Boolean)}))}))};
    if(n.name==='w:sdt'||n.name==='w:sdtContent')return {kind:'group',children:elementChildren(n).map(c=>walk(c,inTable,true)).filter(Boolean)};
    return null;
  }
  const tree=elementChildren(body).map(n=>walk(n)).filter(Boolean);
  if(blocks.length>1200||blocks.map(b=>b.text).join('\n').length>60000)throw error('DOCUMENT_TOO_LARGE','当前支持1200段、60000字以内的主文档。');
  if(!blocks.some(b=>b.text.trim()))throw error('EMPTY_DOCUMENT','主文档没有可读取正文。');
  return {blocks,tree,text:blocks.map(b=>b.text).join('\n'),warnings};
}
function annotated(pXml,id,mode='paragraph') { return commentRange(pXml,id,{mode}); }
function annotatedLegacy(pXml,id) {
  const pos=pXml.indexOf('>')+1,pr=pXml.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>|<w:pPr\b[^>]*\/>/);
  const at=pr?pr.index+pr[0].length:pos,end=pXml.lastIndexOf('</w:p>');
  return pXml.slice(0,at)+`<w:commentRangeStart w:id="${id}"/>`+pXml.slice(at,end)+`<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`+pXml.slice(end);
}
export function generateVersion(bytes,changes) {
  if(!Array.isArray(changes)||!changes.length||changes.length>100)throw error('INVALID_CHANGES','请提供1至100处修改。');
  const doc=readDocument(bytes), entries=readPackage(bytes), originalXml=entries.get('word/document.xml').toString(),byId=new Map(doc.blocks.map(b=>[b.id,b]));
  const existingRels=entries.get('word/_rels/document.xml.rels')?.toString('utf8');
  const commentRels=[];
  const inspectRelationships=n=>{if(n.name.split(':').at(-1)==='Relationship'&&n.attrs?.Type?.endsWith('/comments'))commentRels.push(n);for(const child of n.children??[])inspectRelationships(child);};
  if(existingRels)inspectRelationships(parseXml(existingRels));
  if(commentRels.length>1||commentRels.some(n=>n.attrs.TargetMode==='External'||!['comments.xml','/word/comments.xml'].includes(n.attrs.Target)))throw error('UNSUPPORTED_COMMENTS','已有批注关系使用非默认路径，当前不支持追加批注；未生成新版本。');
  const used=new Set();let nextId=Math.max(0,...[...(originalXml+(entries.get('word/comments.xml')?.toString()??'')).matchAll(/w:id="(\d+)"/g)].map(m=>Number(m[1])))+100;
  const ctx={author:'合同工作台',date:new Date().toISOString().replace(/\.\d+Z$/,'Z'),nextId:()=>String(nextId++)};
  const plans=changes.map((c,i)=>{
    const b=byId.get(c.blockId);if(!b||c.before!==b.text)throw error('STALE_RANGE','修改原文或版本已变化，请重新复核。',409);
    if(used.has(b.id))throw error('OVERLAPPING_CHANGES','同段存在重复或重叠修改，请先合并改法。');used.add(b.id);
    if(!['replace','insert-after'].includes(c.type)||typeof c.after!=='string'||c.after.length>6000||(c.type==='replace'&&c.after===b.text))throw error('INVALID_CHANGES','改法格式无效或没有变化。');
    if(!b.editable)throw error('UNSUPPORTED_RANGE','目标段落含复杂结构，当前不支持修改；未生成新版本。');
    // Canonicalize only text entities in the target paragraph before invoking
    // the old writer, whose decoder supports named entities but not numeric ones.
    const raw=originalXml.slice(b.start,b.end).replace(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g,(_,open,text,close)=>open+xmlText(decode(text))+close);
    if(c.type==='insert-after'&&(b.inTable||/<w:(?:sectPr|numPr)\b/.test(raw)))throw error('UNSUPPORTED_RANGE','当前不支持在表格、自动编号或分节段落后插入。');
    const change={...c,id:`change_${i+1}`,reason:String(c.reason??'用户复核修改').slice(0,3000)};
    let replacement=null, granularity='paragraph';
    if(c.type==='replace') {
      // 词级优先：整段里只有一处局部改动时，生成「删片段 + 插片段」而不是整段重写。
      // 用字符偏移定位（不靠重复文字匹配）；范围超段落六成、文本抽取不一致或切分失败时退回整段替换。
      const d=inlineDiff(b.text,c.after);
      const limit=Math.max(24,Math.floor(b.text.length*0.6));
      if(d&&d.before.length+d.after.length<=limit&&ooxmlParagraphText(raw)===b.text) {
        try{ replacement=replaceInlineAt(raw,d.prefix.length,d.before.length,d.after,ctx); granularity='inline'; }catch{ replacement=null; }
      }
      if(!replacement) replacement=replaceParagraph(raw,c.after,ctx);
    } else {
      replacement=insertParagraphAfter(raw,c.after,ctx);
    }
    return {b,change:{...change,docxGranularity:granularity},replacement,comment:nextId++};
  });
  let plain=originalXml,trackedXml=originalXml;
  for(const p of [...plans].sort((a,b)=>b.b.start-a.b.start)) {
    const {b,change,replacement,comment}=p,at=change.type==='replace'?b.start:b.end,end=change.type==='replace'?b.end:b.end;
    plain=plain.slice(0,at)+replacement+plain.slice(end);trackedXml=trackedXml.slice(0,at)+annotated(replacement,comment,change.docxGranularity==='inline'?'revision':'paragraph')+trackedXml.slice(end);
  }
  const cleanXml=acceptAll(plain), cleanEntries=new Map(entries),trackedEntries=new Map(entries);
  cleanEntries.set('word/document.xml',Buffer.from(cleanXml));trackedEntries.set('word/document.xml',Buffer.from(trackedXml));
  let comments=entries.get('word/comments.xml')?.toString('utf8')??`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W}"></w:comments>`;
  parseXml(comments);
  comments=comments.replace(/<w:comments\b([^>]*?)\/>/, '<w:comments$1></w:comments>');
  const additions=plans.map(p=>`<w:comment w:id="${p.comment}" w:author="合同工作台" w:date="${xmlAttr(ctx.date)}"><w:p><w:r><w:t xml:space="preserve">${xmlText(p.change.reason)}</w:t></w:r></w:p></w:comment>`).join('');
  if(!comments.includes('</w:comments>'))throw error('UNSUPPORTED_COMMENTS','已有批注结构不支持追加。');
  comments=comments.replace('</w:comments>',additions+'</w:comments>');trackedEntries.set('word/comments.xml',Buffer.from(comments));
  let rels=entries.get('word/_rels/document.xml.rels')?.toString('utf8')??'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  rels=rels.replace(/<Relationships\b([^>]*?)\/>/,'<Relationships$1></Relationships>');
  if(!rels.includes('</Relationships>'))throw error('UNSUPPORTED_RELATIONSHIPS','文档关系结构不支持。');
  if(!commentRels.length) {
    let id=1;while(rels.includes(`Id="rIdC${id}"`))id++;
    rels=rels.replace('</Relationships>',`<Relationship Id="rIdC${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`);
  }
  trackedEntries.set('word/_rels/document.xml.rels',Buffer.from(rels));
  let ct=entries.get('[Content_Types].xml').toString('utf8');
  if(!ct.includes('PartName="/word/comments.xml"'))ct=ct.replace('</Types>','<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>');
  trackedEntries.set('[Content_Types].xml',Buffer.from(ct));
  const clean=writeZip(cleanEntries),tracked=writeZip(trackedEntries);
  return {clean,tracked,changes:plans.map(p=>({...p.change,commentId:p.comment})),document:readDocument(clean)};
}

