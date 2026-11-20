export function validCharacters(value) {const s=String(value);if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(s)||[...s].some(c=>{const n=c.codePointAt(0);return n>=0xd800&&n<=0xdfff;}))throw Object.assign(Error('文本含不支持的XML字符，请移除控制字符后重试。'),{code:'INVALID_TEXT',status:400});return s;}
export const xmlText = value => validCharacters(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export const xmlAttr = value => xmlText(value).replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function decode(value) {
  return value.replace(/&([^;\s]+);/g, (_, e) => {
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}; if(e in named)return named[e];
    const n=e.startsWith('#x')?Number.parseInt(e.slice(2),16):e.startsWith('#')?Number(e.slice(1)):NaN;
    if(!Number.isInteger(n)||n<1||n>0x10ffff||(n>=0xd800&&n<=0xdfff))throw Error('XML实体不支持。');
    return String.fromCodePoint(n);
  });
}
// A bounded token tree, retaining exact source ranges. No DTD, entity loading or XML execution.
export function parseXml(xml) {
  validCharacters(xml);
  if(typeof xml!=='string'||xml.length>8*1024*1024||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml))throw Error('不支持DTD、外部实体或超大XML。');
  const document={name:'#document',children:[],start:0,end:xml.length}, stack=[document];
  const token=/<(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/g;
  let covered=0, count=0;
  for(const m of xml.matchAll(token)) {
    if(m.index!==covered||++count>200000)throw Error('XML结构损坏或过于复杂。'); covered=m.index+m[0].length;
    const raw=m[0], parent=stack.at(-1);
    if(raw.startsWith('<?')||raw.startsWith('<!--'))continue;
    if(!raw.startsWith('<')) {parent.children.push({name:'#text',value:decode(raw),start:m.index,end:covered});continue;}
    if(raw.startsWith('</')) {const name=raw.slice(2,-1).trim(); if(stack.length<2||stack.at(-1).name!==name)throw Error('XML标签不匹配。'); stack.pop().end=covered;continue;}
    const name=raw.match(/^<([A-Za-z_][\w.:-]*)/)?.[1]; if(!name)throw Error('XML标签不支持。');
    const attrs={}; for(const a of raw.matchAll(/([\w.:-]+)\s*=\s*("[^"]*"|'[^']*')/g))attrs[a[1]]=decode(a[2].slice(1,-1));
    const node={name,attrs,children:[],start:m.index,openEnd:covered,end:covered}; parent.children.push(node);
    if(!raw.endsWith('/>')){stack.push(node);if(stack.length>100)throw Error('XML层级过深。');}
  }
  if(covered!==xml.length||stack.length!==1)throw Error('XML不完整。');
  return document;
}
export const children = (node,name) => node.children.filter(n=>n.name===name);
export function descendants(node,name) {const out=[]; const walk=n=>{if(n.name===name)out.push(n);for(const c of n.children??[])walk(c);};walk(node);return out;}
export const textContent = node => node.name==='#text'?node.value:node.children.map(textContent).join('');
