// The distributable contains no organization-specific approval matrix.
export const policyFactGuide = {
  penalty: {clauseBasis:'single 表示单次违约金，daily 表示按日计付。', penaltyAmount:'单次违约金（元）', dailyAmount:'每日违约金（元）', dailyRate:'按日比例，1 表示 100%', contractAmount:'合同金额（元）', controllable:'发生风险是否可控。',teamConfirmedLow:'风险是否经相关团队确认为低。'},
  liabilityCap: {capBasis:'percent 有上限；unlimited 无上限。', capRatio:'赔偿上限占合同额的比例，1 表示 100%。'},
  guarantee: {type:'保函类型；投标、预付款、履约和质保需逐类核对。', guaranteeAmount:'保函金额（元）',contractAmount:'合同金额（元）',advancePayment:'预付款金额（元）'}
};
const prices = value => typeof value==='number' && Number.isFinite(value) && value>=0;
const result=(status,finding,missing=[])=>({status,finding,missing});
const cannotCompare=reason=>result('needs-evidence',reason,['该交易主体的现行制度、明确阈值、对应基数和适用条件']);
const capWords = /(?:不超过|不得超过|最高为|上限为|上限[：:]|≤)\s*(?:人民币\s*)?([\d,]+(?:\.\d+)?)\s*(万元|元|%|％|‰)/g;
const limitIn=(sentence,units)=>{
 const hits=[...sentence.matchAll(capWords)].filter(m=>units.includes(m[2]));
 if(hits.length!==1)return null;
 const [,v,u]=hits[0], amount=Number(v.replaceAll(',',''))*({'万元':10000,'元':1,'%':0.01,'％':0.01,'‰':0.001}[u]);
 return Number.isFinite(amount)?amount:null;
};
export function evaluatePolicy(kind, facts={}, policyText=''){
 if(!Object.hasOwn(policyFactGuide,kind)||!facts||typeof facts!=='object'||Array.isArray(facts))throw Error('请核对事项类型和本案事实。');
 if(!policyText)return cannotCompare('尚缺实际适用的企业制度原文。请列出需核对的事项并向制度管理部门取证。');
 // Compare only unambiguous upper bounds. No inference of approval, waiver or officer.
 const comparisons=[];
 function add(label,clause,value,units){
   const limit=limitIn(clause,units);
   if(limit===null)return;
   comparisons.push({label,limit,value:prices(value)?value:null,unit:units.includes('元')?'元':'比例'});
 }
 const sentences=policyText.split(/[。；;\n]/).map(x=>x.normalize('NFKC'));
 for(const s of sentences){
   if(kind==='penalty'){
     if(!/违约金|罚则|罚率|罚款/.test(s))continue;
     if(facts.clauseBasis==='daily'&&/每日|单日|按日/.test(s)){add('单日违约金金额',s,facts.dailyAmount,['元','万元']);add('每日罚率',s,facts.dailyRate,['%','‰']);}
     if(facts.clauseBasis==='single'&&/单次|一次性|单笔/.test(s)){add('单次违约金金额',s,facts.penaltyAmount,['元','万元']);if(/合同(?:总)?(?:价款|金额)/.test(s))add('单次违约金占合同金额比例',s,prices(facts.penaltyAmount)&&prices(facts.contractAmount)&&facts.contractAmount>0?facts.penaltyAmount/facts.contractAmount:null,['%','‰']);}
   }else if(kind==='liabilityCap'){
     if(facts.capBasis==='percent'&&/整体赔偿|总体赔偿|总赔偿|赔偿总额/.test(s)&&/合同(?:总)?(?:价款|金额)/.test(s))add('整体赔偿与合同金额的比例',s,facts.capRatio,['%','‰']);
   }else{
     const labels={bid:'投标',advance:'预付款',performance:'履约',warranty:'质保'};
     if(!Object.hasOwn(labels,facts.type)||!s.includes(labels[facts.type])||!/保函|保证金/.test(s))continue;
     add('该类保函的金额',s,facts.guaranteeAmount,['元','万元']);
     const basis=/合同(?:总)?(?:价款|金额)/.test(s)?facts.contractAmount:/预付款金额/.test(s)?facts.advancePayment:null;
     if(prices(basis)&&basis>0&&prices(facts.guaranteeAmount))add('保函占相应基数比例',s,facts.guaranteeAmount/basis,['%','‰']);
   }
 }
 if(!comparisons.length||comparisons.some(c=>c.value===null)||new Set(comparisons.map(c=>c.label)).size!==comparisons.length)return cannotCompare('所引制度或本案数据未能唯一确定可比较的上限，原文的审批条件须逐项人工核对。');
 const exceeded=comparisons.some(c=>c.value>c.limit);
 return {...result(exceeded?'exceeds-quoted-limit':'within-quoted-limit',comparisons.map(c=>c.label+'为'+(c.unit==='元'?c.value+'元':Number((c.value*100).toFixed(6))+'%')+'，'+(c.value>c.limit?'高于':'未超过')+'所引上限').join('。')+'。审批与免审仍须核实同条的其他条件、例外和有效授权。'),comparisons};
}

