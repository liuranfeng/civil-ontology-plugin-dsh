const names={contract:'合同审查',consult:'法律咨询',research:'类案检索'};
export function modeOf(packet){
  const mode=packet.taskMode??'contract';
  if(!Object.hasOwn(names,mode))throw Error('请选择合同审查 contract、法律咨询 consult 或类案检索 research。');
  return mode;
}

// DSH registers schemas globally. Keep specialist schemas in the active matter,
// so an unrelated task never receives long document or judgment parameters.
export function taskRouter(ctx,{tool,session,store}){
  const definitions=new Map(Object.keys(names).map(mode=>[mode,new Map()]));
  function target(mode){
    const registry=definitions.get(mode);
    return {tools:{register(def){
      if(!registry||registry.has(def.name))throw Error('场景工具重复登记 '+def.name);
      registry.set(def.name,def);
    }}};
  }
  function menu(mode){return '本案可用的专用工具　'+[...definitions.get(mode).keys()].join('、')+'。通过 civil_task_tool 调用，operation 填工具名称。省略 input 可查看该工具的完整填写说明，提交 input 执行。';}
  ctx.tools.register(tool('civil_task_tool','按已开事项调用专用工具。空参数查看本场景工具；仅填 operation 查看参数；同时填 operation 和 input 执行。',
    {operation:{type:'string'},input:{type:'object',additionalProperties:true}},[],(args,exec)=>{
      const row=store.get(session(exec));
      if(!row)throw Error('请先调用 civil_open_case，选择任务并登记来源。');
      const mode=modeOf(row.packet);
      if(!args.operation)return {markdown:menu(mode)};
      const def=definitions.get(mode).get(args.operation);
      if(!def)throw Error('当前事项是'+names[mode]+'。'+menu(mode));
      if(args.input===undefined)return {markdown:def.description+'\n\ninput 格式：\n'+JSON.stringify(def.parameters)};
      if(!args.input||typeof args.input!=='object'||Array.isArray(args.input))throw Error('input 须为含该工具参数的对象。');
      const missing=def.parameters.required.filter(k=>!Object.hasOwn(args.input,k));
      if(missing.length)throw Error('缺少 '+missing.join('、')+'。仅填 operation 可查完整参数。');
      return def.execute(args.input,exec);
    }));
  return {target,menu};
}
