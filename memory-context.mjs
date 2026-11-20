import path from 'node:path';
import {digestKey} from './memory-store.mjs';

const legal=/民事|民法|民诉|法律|法务|律师|法院|判决|裁判|司法|起诉|诉讼|仲裁|案由|类案|权利|义务|请求权|抗辩|违约|侵权|欠款|借款|债权|债务|买卖|合同|协议|条款|买方|卖方|承租|出租人|租金|婚姻|离婚|抚养|赡养|遗产|继承|赔偿|物权|担保|抵押|质押|建设工程|价款|付款|交货|验收|续保|送审|用印|签约|法条|管辖|赔钱|欠我.{0,8}钱|欠钱|借钱.{0,8}不还|对方.{0,8}不还钱|拖欠|货没到|不给钱|退押金|押金不退|拖着不付/i;
const outside=/跑步路线|旅游攻略|写小说|小说对白|故事情节|创作小说|训练计划|菜谱|做饭|今天天气|股票行情|电影推荐|设计游戏|骑行路线|推荐.{0,4}(电影|餐馆|路线)/;
const presentation=/表格|版式|格式|排版|报告结构|写法|阅读|措辞|行文|段落|先.{0,8}问题.{0,8}答案/;
const correct=/纠正|更正|改成|改为|重做|重写|改掉|误判|写错|不对|有误|漏掉|漏审|不能|不应|应该改|说反|要改|才是|须同时|不能只凭|只确认/;
const agree=/认可|采纳|同意|接受|保留|没问题|可以了|正确|对了|符合/;
const supplement=/补充.{0,5}(事实|材料|情况)|实际是|实际为|经核实|合同写明|合同约定|根据附件|清单载明|我们确认|据我所知/;
const continuation=/^(那|请再|继续|如果|同意|认可|保留|补充|请改|改成|按|这|上|前|第|另外|还要|但|如果|为何|为什么|详细|展开|好的|可以|不用|是|没问题|不对|重新|我认为|我觉得|先|后|改为|加上|只|对，|事实)/;
const numbered=/第([0-9一二三四五六七八九十]+)[条项点]/;
const versionPattern=/(初稿|终稿|定稿|原版|第[一二三四五六七八九十0-9]+版|[Vv][0-9]+(?:\.[0-9]+)*)/;
const regimes=[['买卖合同',/买卖|买方|卖方|采购|交货|到货/],['租赁合同',/租赁|房租|租金|承租|房东/],['借款关系',/借款|借钱|还钱/],['侵权关系',/侵权|损害赔偿/],['服务合同',/服务合同|维保|续保/],['婚姻家庭',/离婚|抚养|赡养/],['继承关系',/遗产|继承/]];
const issues=[['付款与验收',/付款|价款|验收|签收/],['计价',/计价|单价|报价|定价/],['履约',/履约|交付|交货|逾期/],['审批',/审批|用印/],['争议解决',/管辖|仲裁|诉讼/],['责任',/违约|赔偿|免责/]];
export const textOf=m=>typeof m?.content==='string'?m.content.trim():Array.isArray(m?.content)?m.content.filter(b=>b?.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n').trim():'';
export const captureText=m=>m?.source?.kind==='user'?textOf(m):'';
export function segments(text,prior=false,attachmentNames=[]){
  const parts=text.match(/[^，,；;。！？!?\n]+[，,；;。！？!?]?/g)||[];
  let active=prior||attachmentNames.some(s=>legal.test(s));
  const kept=[];
  for(const part of parts){
    const t=part.trim();if(!t)continue;
    if(outside.test(t)){active=false;continue;}
    const follow=active&&(continuation.test(t)||correct.test(t)||agree.test(t)||presentation.test(t)||supplement.test(t)||numbered.test(t));
    const civilMatter=/交通事故|被车撞|医疗损害|侵犯名誉|泄露隐私|所有权|物业纠纷|房东.{0,6}押金|\bcivil law\b|\bcontract review\b|\bbreach of contract\b/i.test(t);
    const current=legal.test(t)||civilMatter||follow||active&&parts.length===1&&attachmentNames.some(n=>legal.test(n));
    if(current){kept.push(t);active=true;}else if(!kept.length){active=false;}
  }
  return {active:kept.length>0&&active,parts:kept};
}
export function classify(text){
  const isPresentation=presentation.test(text);
  const asking=/[？?]|是否|能否|可否|要不要|该不该|[吗么][、，。；;]?$/.test(text);
  const action=asking?'提问或陈述':correct.test(text)||/不(?:认可|接受|同意|保留)|拒绝|否定/.test(text)?'纠正':agree.test(text)?'认可':supplement.test(text)?'补充事实':isPresentation?'表达要求':'提问或陈述';
  const nature=isPresentation?'展示方法':action==='补充事实'?'当事人陈述':action==='纠正'?'判断取舍':action==='认可'?'成果反馈':'会话';
  const task=/类案|裁判|判例|案例检索/.test(text)?'类案检索':/合同审查|审合同|签约前|签前|能不能签|能否签署|送审/.test(text)?'合同审查':/怎么办|能否主张|咨询/.test(text)?'法律咨询':'';
  return {action,nature,task,relations:regimes.filter(([,r])=>r.test(text)).map(([v])=>v),issues:issues.filter(([,r])=>r.test(text)).map(([v])=>v)};
}
function chineseNumber(s){if(/^\d+$/.test(s))return Number(s);const parts=s.split('十'),d='零一二三四五六七八九';return parts.length===2?(parts[0]?d.indexOf(parts[0]):1)*10+(parts[1]?d.indexOf(parts[1]):0):d.indexOf(s);}
function findNumbered(text,number){
  const matches=[...text.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*{1,2})?(?:第([0-9一二三四五六七八九十]+)[项条点]|[（(]?([0-9一二三四五六七八九十]+)[）)、.．])/g)];
  const i=matches.findIndex(m=>chineseNumber(m[1]||m[2])===number);
  return i<0?'':text.slice(matches[i].index,matches[i+1]?.index||text.length).trim();
}
export function feedbackTarget(text,history,lastUser){
  const version=text.match(versionPattern)?.[1], pos=text.match(numbered)?.[1];
  const wantFile=presentation.test(text);
  const scope=lastUser?.caseId?history.filter(r=>!r.caseId||lastUser.caseId===r.caseId):history;
  const publicRows=scope.filter(r=>r.author==='模型'||r.author==='交付');
  let result;
  if(version){result=publicRows.findLast(x=>x.text.includes(version)||x.display?.includes(version));}
  else if(wantFile){result=publicRows.findLast(x=>x.author==='交付')||publicRows.at(-1);}
  else{result=publicRows.findLast(x=>x.author==='模型');}
  if(!result)return {};
  if(pos){
    const excerpt=findNumbered(result.text,chineseNumber(pos));
    return excerpt?{targetId:result.id,targetQuote:excerpt,targetVersion:result.version||result.id}:{targetAmbiguous:true};
  }
  return {targetId:result.id,targetQuote:result.text,targetVersion:result.version||result.id};
}
export function attachments(m){
  const fields=[...(Array.isArray(m?.attachments)?m.attachments:[]),...(Array.isArray(m?.content)?m.content.filter(b=>['file','attachment','document'].includes(b?.type)):[])];
  return fields.map(f=>String(f.filename||f.name||f.path||'')).filter(Boolean).map(name=>path.win32.basename(name));
}
export function packetScope(row,sid){
  const p=row?.packet||{};
  return {sessionId:sid,caseId:p.id||'',taskMode:p.taskMode||(row?'contract':''),scene:p.scene||'',stance:p.stance||'',stage:p.stage||'',businessKind:p.businessKind||'',organization:p.organization||'',audience:p.audience||'',deliverable:p.deliverable||''};
}
export function matterFingerprint(packet){
  const texts=(packet?.sources||[]).map(s=>String(s.text||'').replace(/\s/g,'')).filter(Boolean).sort();
  return texts.length?digestKey([...new Set(texts)]):'';
}
