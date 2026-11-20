
const phases=['intake','knowledge','claims','reasoning','choices'];
function text(value,field,limit=900) {
  if(typeof value!=='string'||!value.trim()||value.length>limit) throw Error(field+'需填写，且不超过 '+limit+' 个字符');
  return value.trim();
}
export function validateAgentRecord(result,steps,opinion) {
  if(!Array.isArray(steps)||steps.length<phases.length||steps.length>24) throw Error('分析记录应覆盖 5 个分析阶段');
  const sources=new Map(result.sources.map(s=>[s.id,s]));
  const coverage=new Set();
  const checked=steps.map((step,i)=>{
    if(!step||!phases.includes(step.kind)) throw Error('分析阶段无效');
    coverage.add(step.kind);
    if(!Array.isArray(step.evidence)||step.evidence.length<1||step.evidence.length>7) throw Error('每条判断需附至少一项原文证据');
    const evidence=step.evidence.map(e=>{
      const source=e&&sources.get(e.sourceId);
      if(!source||typeof e.quote!=='string'||e.quote.trim().length<4||e.quote.length>1300||!source.text.includes(e.quote)) throw Error('引用必须定位到输入中的对应原文');
      return {sourceId:source.id,quote:e.quote};
    });
    const alternatives=step.alternatives??[];
    if(!Array.isArray(alternatives)||alternatives.length>8||step.kind==='choices'&&!alternatives.length) throw Error('请记录备选路径及取舍');
    const basis=step.basis??[];
    if(!Array.isArray(basis)||basis.length>6) throw Error('请列出与本判断直接有关的知识及依据');
    return {id:'agent-step-'+(i+1),kind:step.kind,title:text(step.title,'判断名称',140),decision:text(step.decision,'判断结论'),reason:text(step.reason,'证据与判断的关系'),evidence,
      alternatives:alternatives.map(a=>text(a,'备选路径',380)),basis:basis.map(b=>text(b,'依据',300))};
  });
  if(coverage.size!==phases.length) throw Error('分析记录应覆盖 5 个分析阶段');
  const record={steps:checked.sort((a,b)=>phases.indexOf(a.kind)-phases.indexOf(b.kind))};
  if(opinion===undefined)return record;
  if(!opinion||!Array.isArray(opinion.actions)||!opinion.actions.length||opinion.actions.length>10)throw Error('签前意见需要列出可执行动作');
  record.opinion={summary:text(opinion.summary,'签前结论'),actions:opinion.actions.map((action,i)=>{
    const step=record.steps.find(s=>s.id==='agent-step-'+action?.stepIndex);
    if(!step||!['reasoning','choices','claims'].includes(step.kind))throw Error('审查成果应回到同一次推导、请求权或取舍记录');
    const refs=[...new Set(step.evidence.map(e=>e.sourceId))];
    return {id:'agent-action-'+(i+1),anchor:step.id,title:text(action.title,'结果标题',140),why:step.reason,priority:text(action.priority,'结果状态',80),action:text(action.action,'签前动作'),refs,...(action.drafting?{drafting:text(action.drafting,'条件性条款建议')}: {})};
  })};
  return record;
}

