import {crc32} from 'node:zlib';

const MAX_CHARS=200000,MAX_BYTES=1024*1024;
const invalid=()=>Object.assign(new Error('导出需要完整文本，正文须在20万字符与1MiB以内；未截断或生成摘要。'),{code:'INVALID_EXPORT',status:400});
function payloadOf(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||typeof payload.title!=='string'||!payload.title.trim()||payload.title.length>500||typeof payload.markdown!=='string'||!payload.markdown.trim()||payload.markdown.length>MAX_CHARS||Buffer.byteLength(payload.markdown)>MAX_BYTES||(payload.versionLabel!==undefined&&(typeof payload.versionLabel!=='string'||payload.versionLabel.length>200)))throw invalid();
 for(const value of [payload.title,payload.markdown,payload.versionLabel||''])if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value)||!value.isWellFormed())throw invalid();
 return {title:payload.title,markdown:payload.markdown.replace(/\r\n?/g,'\n'),versionLabel:payload.versionLabel||''};
}
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function tableCells(line){
 const cells=[];let cell='',escaped=false;line=line.trim();if(line.startsWith('|'))line=line.slice(1);if(line.endsWith('|')&&!line.endsWith('\\|'))line=line.slice(0,-1);
 for(const char of line){if(escaped){cell+=char==='|'?'|':'\\'+char;escaped=false;}else if(char==='\\')escaped=true;else if(char==='|'){cells.push(cell.trim());cell='';}else cell+=char;}if(escaped)cell+='\\';cells.push(cell.trim());return cells;
}
function blocks(markdown){
 const lines=markdown.split('\n'),result=[];let index=0;
 while(index<lines.length){const line=lines[index];if(!line.trim()){index++;continue;}
  const fence=/^\s*(`{3,}|~{3,})(.*)$/.exec(line);if(fence){const content=[];index++;while(index<lines.length&&!new RegExp('^\\s*'+fence[1][0]+'{'+fence[1].length+',}\\s*$').test(lines[index]))content.push(lines[index++]);if(index<lines.length)index++;result.push({type:'code',text:content.join('\n')});continue;}
  const heading=/^(#{1,6})[ \t]+(.+)$/.exec(line);if(heading){result.push({type:'heading',level:heading[1].length,text:heading[2].replace(/[ \t]+#+[ \t]*$/,'')});index++;continue;}
  if(index+1<lines.length&&line.includes('|')){const delimiter=tableCells(lines[index+1]);if(delimiter.length>=2&&delimiter.every(value=>/^:?-{3,}:?$/.test(value))){const rows=[tableCells(line)];index+=2;while(index<lines.length&&lines[index].trim()&&lines[index].includes('|'))rows.push(tableCells(lines[index++]));const columns=Math.max(...rows.map(row=>row.length));if(columns>100||rows.length>10000)throw invalid();for(const row of rows)while(row.length<columns)row.push('');result.push({type:'table',rows});continue;}}
  const paragraph=[line];index++;while(index<lines.length&&lines[index].trim()&&!/^#{1,6}\s/.test(lines[index])&&!/^\s*(`{3,}|~{3,})/.test(lines[index])&&!(index+1<lines.length&&lines[index].includes('|')&&tableCells(lines[index+1]).every(value=>/^:?-{3,}:?$/.test(value))))paragraph.push(lines[index++]);result.push({type:'paragraph',text:paragraph.join('\n')});
 }
 return result;
}
// Keep unsupported Markdown and raw HTML as visible text: content is never executed or fetched.
// Underscores are contractual fill-in characters (____年____月), not safe
// emphasis delimiters to discard. Preserve them exactly in both formats.
function plainInline(value){return value.replace(/\*\*([^*\n]+)\*\*/g,'$1').replace(/`([^`\n]+)`/g,'$1');}
function run(text,{bold=false,code=false}={}){
 const properties=(bold?'<w:b/>':'')+(code?'<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="宋体"/>':'');
 return '<w:r>'+(properties?'<w:rPr>'+properties+'</w:rPr>':'')+String(text).split('\n').map((line,index)=>(index?'<w:br/>':'')+'<w:t xml:space="preserve">'+escape(line)+'</w:t>').join('')+'</w:r>';
}
function paragraph(text,style='Normal',options={}){return '<w:p><w:pPr><w:pStyle w:val="'+style+'"/></w:pPr>'+run(options.code?text:plainInline(text),options)+'</w:p>';}
function tableXml(rows){const width=9026,cellWidth=Math.floor(width/rows[0].length);return '<w:tbl><w:tblPr><w:tblW w:w="'+width+'" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(side=>'<w:'+side+' w:val="single" w:sz="4" w:color="777777"/>').join('')+'</w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'+rows[0].map(()=>'<w:gridCol w:w="'+cellWidth+'"/>').join('')+'</w:tblGrid>'+rows.map((row,index)=>'<w:tr><w:trPr>'+(index===0?'<w:tblHeader/>':'')+'<w:cantSplit/></w:trPr>'+row.map(cell=>'<w:tc><w:tcPr><w:tcW w:w="'+cellWidth+'" w:type="dxa"/>'+(index===0?'<w:shd w:fill="F3F3F3"/>':'')+'</w:tcPr>'+paragraph(cell,'TableText',{bold:index===0})+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';}
const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL='http://schemas.openxmlformats.org/package/2006/relationships';
function stylesXml(){
 const fonts='<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体" w:cs="Calibri"/>';
 const headings=Array.from({length:6},(_,index)=>{const level=index+1,size=[34,30,26,24,22,22][index];return '<w:style w:type="paragraph" w:styleId="Heading'+level+'"><w:name w:val="heading '+level+'"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="260" w:after="120"/><w:outlineLvl w:val="'+index+'"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑"/><w:b/><w:sz w:val="'+size+'"/></w:rPr></w:style>';}).join('');
 return XML+'<w:styles xmlns:w="'+W+'"><w:docDefaults><w:rPrDefault><w:rPr>'+fonts+'<w:sz w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="330" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="180"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑"/><w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Version"><w:name w:val="Version"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="300"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="宋体"/><w:sz w:val="18"/></w:rPr></w:style>'+headings+'</w:styles>';
}
function zipStore(entries){
 // Small OOXML parts use the standard ZIP STORE method; native Node is the only dependency.
 const local=[],central=[];let offset=0;
 for(const [filename,content] of Object.entries(entries)){const name=Buffer.from(filename),data=Buffer.from(content),crc=crc32(data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);local.push(header,name,data);const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);central.push(entry,name);offset+=header.length+name.length+data.length;}
 const directory=Buffer.concat(central),end=Buffer.alloc(22),count=Object.keys(entries).length;end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}

/** A clean current/selected version, without invented Word native changes or analysis summaries. */
export function createDocx(payload){
 const {title,markdown,versionLabel}=payloadOf(payload);
 const body=paragraph(title,'Title')+(versionLabel?paragraph(versionLabel,'Version'):'')+blocks(markdown).map(block=>block.type==='table'?tableXml(block.rows):block.type==='heading'?paragraph(block.text,'Heading'+block.level):paragraph(block.text,block.type==='code'?'Code':'Normal',{code:block.type==='code'})).join('');
 const entries={
  '[Content_Types].xml':XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
  '_rels/.rels':XML+'<Relationships xmlns="'+REL+'"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
  'word/document.xml':XML+'<w:document xmlns:w="'+W+'"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1247" w:right="1134" w:bottom="1247" w:left="1134" w:header="0" w:footer="0"/><w:cols w:space="708"/></w:sectPr></w:body></w:document>',
  'word/styles.xml':stylesXml(),
  'word/settings.xml':XML+'<w:settings xmlns:w="'+W+'"><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
  'word/_rels/document.xml.rels':XML+'<Relationships xmlns="'+REL+'"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
  'docProps/core.xml':XML+'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>'+escape(title)+'</dc:title><dc:creator>legalwork</dc:creator><cp:version>'+escape(versionLabel)+'</cp:version></cp:coreProperties>'
 };
 return zipStore(entries);
}

