/** DSH Web client entry, loaded by the same module registry as the host's chat. */
window.__ModuleLoader__.load({
  id: 'civil-ontology-dsh',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const tabKind = 'civil-ontology:atlas';
    const tabId = 'civil-ontology-dsh/workbench';
    const atlasPath = '/civil-ontology/atlas';
    const commandNames = {
      civil: '民事法律工作台',
      'civil-map': '民事法律关系图',
      'civil-digest': '本体周报',
      'civil-week': '周报时间',
      'civil-confirm': '经验审阅',
      'civil-apply': '采纳候选经验',
      'civil-drop': '不采纳候选经验',
      'procurement-confirm': '采购经验审阅',
      'civil-market': '插件市场'
    };
    const timePattern = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
    const reportPattern = /^w-[0-9a-f]{32}$/;
    const envelope = /^\[civil-view-v1\]: <data:application\/json;base64,([A-Za-z0-9+/=]+)>$/m;
    const home = {
      command: 'civil', view: 'home', title: commandNames.civil,
      summary: '从本体图查看法律关系，从周报逐项核对跨案经验。',
      actions: [
        {label:'查看本体图', command:'/civil-map'},
        {label:'查看本案经验', command:'/civil-map case'},
        {label:'审阅本期周报', command:'/civil-digest'},
        {label:'查看往期周报', command:'/civil-digest history'},
        {label:'安排周报时间', command:'/civil-week'},
        {label:'查看插件市场', command:'/civil-market'}
      ]
    };

    function allowedCommand(line) {
      if (typeof line !== 'string') return false;
      const [head, arg, extra] = line.split(' ');
      if (extra !== undefined || !head.startsWith('/') || !Object.hasOwn(commandNames, head.slice(1))) return false;
      if (arg === undefined) return true;
      if (head === '/civil-map') return arg === 'case';
      if (head === '/civil-week') return arg === 'off' || timePattern.test(arg);
      return head === '/civil-digest' && (arg === 'history' || reportPattern.test(arg));
    }

    function grantLink(text, type) {
      if (type !== 'weekly' && type !== 'case') return null;
      const expected = new RegExp('^/civil-ontology/' + type + '/open/[0-9a-f]{64}$');
      for (const match of text.matchAll(/\[[^\]\n]*\]\(<?(https?:\/\/[^\s<>)]{1,2048})>?\)/g)) {
        try {
          const url = new URL(match[1]);
          if (url.origin === window.location.origin && !url.username && !url.password && !url.search && !url.hash && expected.test(url.pathname)) return url.href;
        } catch { /* Other links in the text are not navigation actions. */ }
      }
      return null;
    }

    function cleanText(text) {
      return text.replace(/^\[civil-view-v1\]:.*$/gm, '').split(/\r?\n/)
        .filter(line => !/file:\/\/|[A-Za-z]:[\\/]|\\\\|\/civil-ontology\/(case|weekly)\/open\//.test(line))
        .map(line => line.replace(/\*\*/g, '').trim()).filter(Boolean);
    }

    function readCommandPage(command,text) {
      const lines = text.split(/\r?\n/);
      if (!lines[0]?.startsWith('## ')) return null;
      const title = lines.shift().slice(3).trim();
      const views = {civil:'home','civil-week':'schedule','civil-market':'market'};
      let view = views[command] || 'review';
      if (command === 'civil-map') view = title.includes('本案') ? 'case' : 'atlas';
      if (command === 'civil-digest') view = title === '历史周报' ? 'history' : 'weekly';
      const page = {title,view,summary:'',details:[],actions:[],reports:[]};
      let section = 'body';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line === '往期周报' || line === '可用操作') {section = line;continue;}
        if (section === 'body') {
          const timing = /^周报安排：每周五 (\d{2}:\d{2})（北京时间），已(启用|暂停)。$/.exec(line);
          if (timing && timePattern.test(timing[1])) page.schedule = {time:timing[1],enabled:timing[2]==='启用'};
          else if (!page.summary) page.summary = line;
          else page.details.push(line.replace(/^- /,''));
          continue;
        }
        const operation = /^- (.+) · `([^\s`]+(?: [^\s`]+)?)`$/.exec(line);
        if (operation && allowedCommand(operation[2])) {
          if (section === '可用操作') page.actions.push({label:operation[1],command:operation[2]});
          else if (operation[2].startsWith('/civil-digest ') && reportPattern.test(operation[2].slice(14))) {
            page.reports.push({id:operation[2].slice(14),label:operation[1]});
          }
          continue;
        }
        const link = /^- \[([^\]\n]+)\]\(<?([^\s<>)]{1,2048})>?\)$/.exec(line);
        if (section === '可用操作' && link) {
          if (link[2] === atlasPath) page.actions.push({label:link[1],href:atlasPath});
          else for (const type of ['case','weekly']) {
            if (grantLink(line,type)) page.actions.push({label:link[1],link:type});
          }
        }
      }
      return page;
    }

    function resultCard(command, result) {
      const text = typeof result?.text === 'string' ? result.text : '';
      let data = readCommandPage(command,text);
      try {
        const encoded = !data && envelope.exec(text)?.[1];
        if (encoded) {
          const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
          const value = JSON.parse(new TextDecoder().decode(bytes));
          if (value?.v === 1 && value.command === command && typeof value.title === 'string' && typeof value.summary === 'string') data = value;
        }
      } catch { /* Old, incomplete and malformed outcomes still get readable cards. */ }
      const error = result?.kind === 'error';
      if (!data) {
        const [first, ...details] = cleanText(text);
        return {command, view:'message', title:commandNames[command], error,
          summary:first || (error ? '未完成这次操作。' : '指令已完成。'), details,
          actions:[{label:'返回工作台',command:'/civil'}]};
      }
      const actions = [];
      for (const item of Array.isArray(data.actions) ? data.actions : []) {
        if (!item || typeof item.label !== 'string') continue;
        if (allowedCommand(item.command)) actions.push({label:item.label,command:item.command});
        else if (item.href === atlasPath) actions.push({label:item.label,href:atlasPath});
        else if (item.link) {
          const href = grantLink(text, item.link);
          if (href) actions.push({label:item.label,href});
        }
      }
      return {command, view:data.view, title:data.title, summary:data.summary, error, actions,
        details:Array.isArray(data.details) ? data.details.filter(x => typeof x === 'string') : [],
        schedule:data.view === 'schedule' && typeof data.schedule?.enabled === 'boolean' ? data.schedule : null,
        reports:Array.isArray(data.reports) ? data.reports.filter(r => reportPattern.test(r?.id) && typeof r.label === 'string') : []};
    }

    const css = `
      .civil-ui{box-sizing:border-box;font:14px/1.55 system-ui,"Microsoft YaHei",sans-serif;color:var(--civil-fg,#20302d);--civil-bg:#fff;--civil-fg:#24342f;--civil-dim:#52665e;--civil-edge:#cdd9d3;--civil-accent:#155842;--civil-soft:#edf5ef;--civil-danger:#9b392e;color-scheme:light dark}
      @media(prefers-color-scheme:dark){.civil-ui{--civil-bg:#202825;--civil-fg:#e4ece7;--civil-dim:#b3c4ba;--civil-edge:#48564e;--civil-accent:#91d3b0;--civil-soft:#273a31;--civil-danger:#ffaaa0}}
      .civil-ui *{box-sizing:border-box}.civil-ui article{padding:16px 18px;background:var(--civil-bg);border:1px solid var(--civil-edge);border-radius:10px;text-align:start;overflow-wrap:anywhere}
      .civil-ui header{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.civil-ui h3{font-size:17px;line-height:1.4;font-weight:650;color:var(--civil-fg);margin:0}.civil-ui code{font-size:11px;color:var(--civil-dim);overflow-wrap:anywhere}
      .civil-ui p{margin:8px 0;color:var(--civil-fg);white-space:pre-line}.civil-ui ul{padding-inline-start:20px;margin:8px 0;color:var(--civil-dim)}.civil-ui li+li{margin-top:4px}
      .civil-ui .civil-actions,.civil-ui form{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}.civil-ui input,.civil-ui button,.civil-ui a{font:inherit}
      .civil-ui button,.civil-ui a{cursor:pointer;border:1px solid var(--civil-edge);border-radius:6px;background:var(--civil-soft);color:var(--civil-accent);padding:5px 10px;line-height:1.5;text-decoration:none;font-weight:550}
      .civil-ui button:hover,.civil-ui a:hover{border-color:var(--civil-accent)}.civil-ui :focus-visible{outline:2px solid var(--civil-accent);outline-offset:2px}.civil-ui button:disabled{opacity:.55;cursor:default}
      .civil-ui input{color:var(--civil-fg);background:var(--civil-bg);border:1px solid var(--civil-edge);border-radius:5px;padding:4px}.civil-ui label{display:flex;align-items:center;gap:6px}
      .civil-ui .civil-error{color:var(--civil-danger)}.civil-ui .civil-history{padding:0;list-style:none}.civil-ui .civil-dock{display:grid;gap:12px;padding:12px;min-height:100%;align-content:start}.civil-ui iframe{display:block;width:100%;height:clamp(360px,68vh,800px);border:1px solid var(--civil-edge);border-radius:8px;background:white}
    `;

    function apply(ctx) {
      const cards = new Map();
      const subscribers = new Map();
      let submit;
      ctx.inject(['remote','remote.commands'], connection => {
        const invoke = (sid,line) => connection.remote.commands.execute(sid,line,[]);
        connection.effect(() => {
          submit = invoke;
          return () => { if (submit === invoke) submit = undefined; };
        },'civil-ontology: command connection');
      });
      function write(sid, card) {
        cards.set(sid, card);
        for (const publish of subscribers.get(sid) || []) publish();
      }
      function subscribe(sid, fn) {
        if (!subscribers.has(sid)) subscribers.set(sid, new Set());
        const entries = subscribers.get(sid);
        entries.add(fn);
        return () => { entries.delete(fn); if (!entries.size) subscribers.delete(sid); };
      }
      function reveal(sid, card) {
        if (!sid) return;
        write(sid, card);
        if (ctx.sidebarRight.mounted.getSnapshot() === sid) ctx.sidebarRight.openTab(tabKind);
      }
      function observe(sid, name, result) {
        if (sid && Object.hasOwn(commandNames, name)) reveal(sid, resultCard(name, result));
      }
      async function execute(sid, line) {
        if (!sid || !allowedCommand(line)) throw Error('请从当前会话重新打开民事法律工作台。');
        const name = line.split(' ')[0].slice(1);
        if (!submit) throw Error('DSH 正在连接，请稍后重试。');
        const reply = await submit(sid,line);
        if (!reply?.ok || !reply.value?.result) throw Error('DSH 未能执行此指令。请检查连接后重试。');
        observe(sid, name, reply.value.result);
      }

      function Card({sid, card, dock = false}) {
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState('');
        const [time, setTime] = React.useState((card.schedule?.time || '18:00').slice(0,5));
        async function run(line) {
          setBusy(true);
          setNotice('');
          try { await execute(sid, line); }
          catch (e) { setNotice(e.message); }
          finally { setBusy(false); }
        }
        function openAtlas() {
          reveal(sid,{...card, showAtlas:true});
        }
        const buttons = (card.actions || []).map((action, i) => {
          if (action.href === atlasPath) return h('button',{key:i,type:'button',onClick:openAtlas},action.label);
          if (action.href) return h('a',{key:i,href:action.href,target:'_blank',rel:'noopener noreferrer',
            onClick:event => event.stopPropagation()},action.label);
          return h('button',{key:i,type:'button',disabled:busy,onClick:()=>run(action.command)},action.label);
        });
        if (!dock && !card.running) buttons.push(h('button',{key:'side',type:'button',onClick:()=>reveal(sid,card)},'在侧栏查看'));
        return h('article',{'aria-label':card.title,'aria-busy':busy || Boolean(card.running)},
          h('header',null,h('h3',null,card.title),h('code',null,'/' + card.command)),
          h('p',{role:card.error?'alert':'status',className:card.error?'civil-error':undefined},card.summary),
          card.details?.length ? h('ul',null,card.details.map((s,i)=>h('li',{key:i},s))) : null,
          card.reports?.length ? h('ul',{className:'civil-history'},card.reports.map(r=>h('li',{key:r.id},
            h('button',{type:'button',disabled:busy,onClick:()=>run('/civil-digest '+r.id)},r.label)))) : null,
          card.schedule ? h('form',{onSubmit:e=>{e.preventDefault();if(timePattern.test(time))run('/civil-week '+time);}},
            h('label',null,'周五时间（北京）',h('input',{type:'time',value:time,required:true,onChange:e=>setTime(e.target.value)})),
            h('button',{type:'submit',disabled:busy || !timePattern.test(time)},card.schedule.enabled?'保存时间':'启用周报'),
            card.schedule.enabled?h('button',{type:'button',disabled:busy,onClick:()=>run('/civil-week off')},'暂停周报'):null) : null,
          buttons.length ? h('div',{className:'civil-actions'},buttons) : null,
          busy?h('p',{role:'status'},'正在执行…'):null,
          notice?h('p',{role:'alert',className:'civil-error'},notice):null);
      }
      function wrap(body) {return h('div',{className:'civil-ui'},h('style',null,css),body);}
      function Dock({sessionId}) {
        const card = React.useSyncExternalStore(fn=>subscribe(sessionId,fn),()=>cards.get(sessionId)||home);
        const showAtlas = !card.error && (card.showAtlas || (card.view==='atlas' && card.actions?.some(a=>a.href===atlasPath)));
        return wrap(h('div',{className:'civil-dock'},
          h(Card,{key:JSON.stringify([card.command,card.summary,card.schedule?.time]),sid:sessionId,card,dock:true}),
          showAtlas ? h('iframe',{src:atlasPath,title:'民事法律关系本体图',referrerPolicy:'no-referrer'}) : null,
          card.view === 'home' ? null : h('div', {className:'civil-actions'},
            h('button',{type:'button',onClick:()=>write(sessionId,home)},'返回工作台'))));
      }
      function Chat({sessionId,node}) {
        const card = node.outcome ? resultCard(node.name,node.outcome) :
          {command:node.name,title:commandNames[node.name],summary:'正在执行…',running:true};
        return wrap(h(Card,{key:node.commandId,sid:sessionId,card}));
      }
      ctx.sidebarRightTabs.register({id:tabId,kind:tabKind,title:()=> '民事法律工作台',
        guide:[{id:'civil-workbench',order:35,title:()=> '民事法律工作台',description:()=> '查看本体关系、案件经验与周报'}]});
      const registerSeat = (name,key,component) => ctx.slots.inject(name,()=>ctx.slots.register({name,key},component));
      registerSeat('sidebar.right.pane.tab',tabId,Dock);
      for (const name of Object.keys(commandNames)) registerSeat('conversation.chat.commandview',name,Chat);
      ctx.on('command/executed',observe);
      ctx.effect(()=>()=>{cards.clear();subscribers.clear();},'civil-ontology: clear session panels');
    }
    return {apply,inject:['slots','sidebarRight','sidebarRightTabs']};
  }
});
