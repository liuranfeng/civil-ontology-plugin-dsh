import fs from 'node:fs';
import {createHash} from 'node:crypto';

const source=new URL('./civil/approved-methods.json',import.meta.url);
const receipt=JSON.parse(fs.readFileSync(new URL('./civil/method-approval.json',import.meta.url),'utf8'));

export function verifyMethodSnapshot(bytes,decision=receipt){
  const digest=createHash('sha256').update(bytes).digest('hex');
  if(digest!==decision.snapshotSha256)throw Error('正式审查方法已偏离用户确认的版本，请核对留档。');
  const rows=JSON.parse(bytes);
  const titles=new Set(rows.map(r=>r.title));
  if(rows.length!==decision.count||titles.size!==rows.length)throw Error('正式审查方法的数量或标题与确认记录不符。');
  return rows;
}
const rows=verifyMethodSnapshot(fs.readFileSync(source));
export const batch=receipt.snapshotSha256;
export const methodLibrary={release:receipt.release,count:rows.length,use:receipt.use};
export function libraryFor(row){
  return row.mode==='on'&&row.methodBatch===batch?methodLibrary:undefined;
}
const catalog=list=>list.map(r=>r.domain+' · '+r.title).join('\n');
export const methodPrompt='用 civil_read_method 按需查阅方法目录与相关条目。对每项详读的方法，用 civil_record_method_decision 记录本案依据、适用边界与取舍理由。';

function sourceQuote(quote){
  if(!quote)return '';
  const marker='据记录转述｜';
  if(quote.startsWith(marker))return '讨论记录转述　'+quote.slice(marker.length);
  if(quote.startsWith('原话｜'))return '讨论原话　「'+quote.slice(3)+'」';
  return '来源原文　「'+quote+'」';
}
function supportingText(item){
  if(typeof item==='string')return item;
  return [[item.source,item.locator].filter(Boolean).join('，'),sourceQuote(item.quote),item.url&&'[查阅补充来源]('+item.url+')'].filter(Boolean).join('　');
}
function detail(r){
  const c=r.claim;
  const details=r.details||[];
  const claimFields=[
    ['请求权人与相对人',c?.parties],
    ['主张的法律效果',c?.effect],
    ['成立条件',c?.conditions],
    ['可对照的民法典条文',c?.comparableLaw?.join('、')]
  ];
  return [
    '**'+r.title+'**',
    [r.kind,r.domain].join(' · '),
    '来源　'+[r.source,r.locator].filter(Boolean).join('，'),
    r.url&&'[查阅'+r.source+'公开原文]('+r.url+')',
    sourceQuote(r.quote),
    ...(r.supporting||[]).map(supportingText),
    r.relation&&'问题所涉关系　'+r.relation,
    r.scope&&'适用前提　'+r.scope,
    ...details,
    ...claimFields.filter(([,value])=>value&&!details.some(line=>line.includes(value)))
      .map(([label,value])=>label+'　'+value),
    r.evidence&&'需要核对的材料　'+r.evidence,
    r.counter&&'区别与例外　'+r.counter,
    r.question&&'需要回答　'+r.question
  ].filter(Boolean).join('\n\n');
}
export function hasApprovedTitle(title){
  return rows.some(r=>r.title===title);
}
export function readCandidate(title){
  const method=rows.find(r=>r.title===title);
  return method&&structuredClone(method);
}
export function readApprovedMethod(row,{title,kind,domain}){
  if(!row||!libraryFor(row))throw Error('请先在启用本版审查方法的新案件内查阅。');
  const list=rows.filter(r=>(!kind||kind===r.kind)&&(!domain||domain===r.domain));
  if(title){
    const r=list.find(v=>v.title===title.trim());
    if(!r)throw Error('该标题未列入当前筛选范围，请用目录中的完整名称。');
    return {markdown:detail(r),method:structuredClone(r)};
  }
  return {markdown:list.length?'**可选审查事项**\n\n'+catalog(list):'本次分类下没有已确认的审查事项。',titles:list.map(r=>r.title)};
}

