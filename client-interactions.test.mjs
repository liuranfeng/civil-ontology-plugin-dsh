import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { commandResult } from './command-result.mjs';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
const origin = 'http://127.0.0.1:43180';
const slot = 'conversation.chat.commandview';

function harness() {
  const seats = new Map(), opens = [], commands = [];
  let descriptor, event, mounted = 'A', reply, connect, disconnect;
  const definition = [];
  const react = {
    createElement(type, props, ...children) { return {type, props:props || {}, children:children.flat(Infinity)}; },
    useState(value) { return [value,()=>{}]; },
    useSyncExternalStore(_subscribe, get) { return get(); }
  };
  const window = {location:{origin},__ModuleLoader__:{load(entry) { descriptor = entry; }}};
  vm.runInNewContext(source,{window,URL,Uint8Array,TextDecoder,atob});
  const plugin = descriptor.factory(name => { assert.equal(name,'react'); return react; });
  const context = {
    sidebarRightTabs:{register(data) { definition.push(data); }},
    sidebarRight:{mounted:{getSnapshot:()=>mounted},openTab:kind=>opens.push(kind)},
    slots:{
      inject(_name, register){register();},
      register({name,key},render){seats.set(name+' '+key,render);}
    },
    on(name, fn){assert.equal(name,'command/executed');event=fn;},
    effect() {},
    inject(services,attach) {
      assert.deepEqual([...services],['remote','remote.commands']);
      connect=()=>attach({effect:fn=>{disconnect=fn();},remote:{commands:{
        async execute(sid,line,attachments){commands.push({sid,line,count:attachments.length});return reply;}
      }}});
      connect();
    }
  };
  plugin.apply(new Proxy(context,{
    get(target,key) {
      if (['sidebarRight','sidebarRightTabs','slots','remote'].includes(key)) assert.ok(plugin.inject.includes(key),'missing service injection for '+key);
      return target[key];
    }
  }));
  function flatten(root) {
    if (!root || typeof root !== 'object') return root == null || root === false ? [] : [root];
    if (typeof root.type === 'function') return flatten(root.type(root.props));
    return [root,...root.children.flatMap(flatten)];
  }
  const dock = sid=>flatten(seats.get('sidebar.right.pane.tab '+definition[0].id)({sessionId:sid}));
  const card = (sid,name,outcome)=>flatten(seats.get(slot+' '+name)({sessionId:sid,node:{name,commandId:'r1',outcome}}));
  return {seats,opens,commands,definition,dock,card,event:(...args)=>event(...args),
    setReply:value=>{reply=value;},setMounted:sid=>{mounted=sid;},reconnect:()=>connect(),disconnect:()=>disconnect()};
}

function result(title,extra={}) {
  return commandResult({title,summary:title+'的结果',...extra});
}
const elements = (tree,type)=>tree.filter(item=>item?.type===type);
const find = (tree,type,label)=>elements(tree,type).find(item=>item.children.includes(label));

test('readable command replies render without a hidden data envelope or untrusted actions',()=>{
  const ui=harness();
  const historyId='w-'+'d'.repeat(32);
  const text='## 历史周报\n\n找到一份周报。\n- 过去七天\n\n往期周报\n- 十一月周报 · `/civil-digest '+historyId+
    '`\n\n可用操作\n- 时间安排 · `/civil-week`\n- 冒用命令 · `/civil-week 99:99`\n- [外部网站](<https://example.com/>)';
  const rows=ui.card('A','civil-digest',{kind:'success',text});
  assert.ok(rows.includes('找到一份周报。'));
  assert.ok(rows.includes('过去七天'));
  assert.ok(find(rows,'button','十一月周报'));
  assert.ok(find(rows,'button','时间安排'));
  assert.equal(find(rows,'button','冒用命令'),undefined);
  assert.equal(elements(rows,'a').length,0);
  const schedule='## 周报时间\n\n已经暂停。\n周报安排：每周五 18:30（北京时间），已暂停。';
  const timing=ui.card('A','civil-week',{kind:'success',text:schedule});
  assert.equal(elements(timing,'input')[0].props.value,'18:30');
  assert.ok(find(timing,'button','启用周报'));
});

test('nine actual commands have durable cards; only the originating visible session opens',()=>{
  const ui=harness();
  assert.equal(ui.seats.size,10);
  ui.event('A','unknown',{kind:'success',text:'test'});
  assert.deepEqual(ui.opens,[]);
  ui.event('B','civil-market',result('B 的市场'));
  assert.deepEqual(ui.opens,[]);
  assert.ok(ui.dock('B').includes('B 的市场'));
  assert.ok(!ui.dock('A').includes('B 的市场'));
  ui.event('A','civil-map',result('基础本体',{actions:[{label:'展开',href:'/civil-ontology/atlas'}]}));
  assert.deepEqual(ui.opens,['civil-ontology:atlas']);
  assert.equal(elements(ui.dock('A'),'iframe')[0].props.src,'/civil-ontology/atlas');
  assert.ok(ui.card('A','civil-map',null).includes('正在执行…'));
  assert.ok(ui.card('A','civil-map',{kind:'error',text:'请检查参数。'}).includes('请检查参数。'));
});

test('privileged weekly and case links require an explicit click in a new top-level document',()=>{
  const ui=harness();
  for (const [type,command] of [['weekly','civil-digest'],['case','civil-map']]) {
    const path='/civil-ontology/'+type+'/open/'+'b'.repeat(64);
    const data=result(type==='case'?'本案经验':'审阅',{actions:[{label:'打开画布',href:origin+path}]});
    ui.event('A',command,data);
    for(const rows of [ui.card('A',command,data),ui.dock('A')]){
      const link=find(rows,'a','打开画布');
      assert.equal(link.props.target,'_blank');
      assert.equal(link.props.href,origin+path);
      assert.equal(elements(rows,'iframe').length,0);
      assert.ok(!rows.some(x=>typeof x==='string'&&x.includes('data:application/json')));
    }
    for (const bad of ['https://example.org'+path,origin+path+'?x=1',origin+path+'/evil']){
      const data=result('审阅',{actions:[{label:'打开画布',href:bad}]});
      assert.equal(elements(ui.card('A',command,data),'a').length,0);
    }
  }
});

test('buttons call the target session on the actual command RPC and render its outcome',async()=>{
  const ui=harness(),id='w-'+'c'.repeat(32);
  const history=result('历史周报',{reports:[{id,label:'十一月周报'}],actions:[{label:'无效按钮',command:'/shell whoami'}]});
  const rows=ui.card('B','civil-digest',history);
  assert.equal(find(rows,'button','无效按钮'),undefined);
  ui.setReply({ok:true,value:{result:result('历史画布')}});
  await find(rows,'button','十一月周报').props.onClick();
  assert.deepEqual(ui.commands,[{sid:'B',line:'/civil-digest '+id,count:0}]);
  assert.ok(ui.dock('B').includes('历史画布'));
  assert.deepEqual(ui.opens,[]);
  const historyWithNoReports = result('暂无历史周报',{reports:[]});
  assert.ok(ui.card('A','civil-digest',historyWithNoReports).includes('暂无历史周报'));
  const form=ui.card('A','civil-week',result('周报安排',{schedule:{enabled:true,time:'18:30'}}));
  assert.equal(elements(form,'input')[0].props.value,'18:30');
  await find(form,'button','暂停周报').props.onClick();
  assert.equal(ui.commands.at(-1).line,'/civil-week off');
});

test('a temporarily disconnected command service leaves the card and sidebar available',async()=>{
  const ui=harness();
  const data=result('周报入口',{actions:[{label:'查看历史',command:'/civil-digest history'}]});
  ui.event('A','civil',data);
  ui.disconnect();
  assert.ok(ui.dock('A').includes('周报入口'));
  await find(ui.dock('A'),'button','查看历史').props.onClick();
  assert.equal(ui.commands.length,0);
  ui.reconnect();
  ui.setReply({ok:true,value:{result:result('历史周报')}});
  await find(ui.dock('A'),'button','查看历史').props.onClick();
  assert.equal(ui.commands.length,1);
  assert.ok(ui.dock('A').includes('历史周报'));
});
