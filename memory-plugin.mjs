import fs from 'node:fs';
import path from 'node:path';
import { TAGS, UNTAGGED, weekStart } from './memory-store.mjs';
import { buildDigest } from './memory-digest.mjs';
import { writeBackOntology } from './memory-ontology.mjs';

/** 定时推送给模型的固定指令：先汇总，再请用户确认。 */
export const WEEKLY_PROMPT = '民事本体周报：请先调用 civil_memory_digest 汇总本周待确认的增量（事实、成果、技能、取舍），逐条列出编号与摘要，再用一句话请用户执行 /civil-apply 确认或 /civil-drop 舍弃。';
export const WEEKLY_TITLE = '民事本体周报';
const DEFAULT_WEEK = { time: '18:00:00', weekdays: [5], timeZone: 'Asia/Shanghai', enabled: true };
const TASK_NAMES = { contract: '合同审查', consult: '法律咨询', research: '类案检索' };
const sessionIdOf = agent => agent?.session?.id || agent?.id;

const textOf = message => {
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n').trim();
};
/** 只记人输入的原话：任务投递、后台通知、命令回执都不是委托内容。 */
export const captureText = message => (message?.source?.kind === 'user' ? textOf(message) : '');
const idsOf = raw => {
  const value = String(raw || '').trim();
  if (!value) throw Error('请给出条目编号，或写 all 表示本期全部。');
  if (value === 'all') return 'all';
  const ids = value.split(/[\s,，、]+/).filter(Boolean);
  if (!ids.length || ids.some(id => !/^m-[a-f0-9]{8}$/.test(id))) throw Error('条目编号形如 m-1a2b3c4d；也可以写 all。');
  return ids;
};

export function registerMemory(ctx, { home, memory, tool, session, store, config = {} }) {
  const settingsFile = path.join(home, 'memory', 'weekly.json');
  const readWeekly = () => {
    try { return { ...DEFAULT_WEEK, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; }
    catch { return { ...DEFAULT_WEEK }; }
  };
  const writeWeekly = value => {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(value, null, 2));
    return value;
  };
  const describeWeek = weekly => weekly.enabled === false
    ? '周报已关闭。'
    : '周报时间　每周' + weekly.weekdays.map(d => '一二三四五六日'[d - 1]).join('、') + ' ' + String(weekly.time).slice(0, 5) + '（' + weekly.timeZone + '）';

  async function ensureWeekly(sessionId) {
    const weekly = readWeekly();
    if (weekly.enabled === false) return { ok: true, disabled: true };
    const service = typeof ctx.get === 'function' ? ctx.get('schedule') : undefined;
    if (!service) return { ok: false, reason: '宿主未启用定时服务' };
    const timing = { kind: 'weekly', weekly: { time: weekly.time, weekdays: weekly.weekdays, time_zone: weekly.timeZone } };
    const existing = (await service.list({ sessionId })).find(row => typeof row.title === 'string' && row.title.startsWith(WEEKLY_TITLE));
    if (existing) {
      const same = existing.time === weekly.time && existing.timeZone === weekly.timeZone &&
        JSON.stringify(existing.weekdays) === JSON.stringify(weekly.weekdays);
      if (same) return { ok: true, unchanged: true, at: weekly };
      await service.update({ sessionId, id: existing.id, expected: existing, change: timing });
      return { ok: true, updated: true, at: weekly };
    }
    await service.create(sessionId, { title: WEEKLY_TITLE, prompt: WEEKLY_PROMPT, weekly: timing.weekly });
    return { ok: true, created: true, at: weekly };
  }
  const ensureQuietly = sessionId => { ensureWeekly(sessionId).catch(() => {}); };

  function digest({ sessionId, scope } = {}) {
    const now = new Date();
    const digestId = 'weekly-' + now.toISOString().slice(0, 10) + '-' + now.toISOString().slice(11, 16).replace(':', '');
    const built = buildDigest(memory, { now, digestId, sessionId: scope === 'session' ? sessionId : undefined });
    const saved = built.items.length ? memory.saveDigest(digestId, built.markdown) : null;
    memory.markDigested(digestId);
    return { ...built, saved };
  }

  function apply(ids) {
    const done = memory.confirm(ids);
    const back = writeBackOntology(home, done);
    return {
      done, back,
      markdown: [
        '**已确认 ' + done.length + ' 条增量**',
        done.map(x => x.id + '　' + x.tag + '　' + x.text.slice(0, 80)).join('\n'),
        back.written.length ? '其中 ' + back.written.length + ' 条按场景、立场、时点和业务类型写入本体，同一场景新案开案时自动带出。' : '',
        back.general.length ? '另 ' + back.general.length + ' 条属于通用经验（无法定位到具体业务类型），已作为本体注记保存，供 civil_memory_recall 查阅。' : ''
      ].filter(Boolean).join('\n\n')
    };
  }

  function status(sessionId) {
    const s = memory.summary();
    const row = sessionId ? store.get(sessionId) : null;
    const pending = memory.pending();
    return [
      '**民事法律关系本体**',
      '已确认 ' + s.confirmed + ' 条，待确认 ' + s.pending + ' 条，不采纳 ' + s.rejected + ' 条。',
      Object.entries(s.byTag).map(([tag, n]) => tag + ' ' + n).join('、'),
      describeWeek(readWeekly()),
      row ? '本会话案件　' + row.packet.id + '（' + (TASK_NAMES[row.packet.taskMode || 'contract']) + '，修订 ' + row.revision + '）' : '本会话尚未开案，提出民事法律问题时会自动启用。',
      pending.length ? '本期待确认 ' + pending.length + ' 条，可用 /civil-digest 查看明细。' : '',
      '用法　/civil-week 18:30 改时间、/civil-week off 关闭、/civil-digest 立即汇总、/civil-apply all 确认回写、/civil-drop 舍弃。'
    ].filter(Boolean).join('\n');
  }

  // 自动记录用户原话，标记待归类，周报时由 Agent 补标签。
  if (config.capture !== false && typeof ctx.on === 'function') {
    ctx.on('agent/inbox/claimed', ({ agent, message } = {}) => {
      try {
        const text = captureText(message);
        if (!text || text.startsWith('/') || text.startsWith(WEEKLY_TITLE)) return;
        memory.add({ sessionId: sessionIdOf(agent), tag: UNTAGGED, text: text.slice(0, 600) });
      } catch { /* 记录失败不影响对话 */ }
    });
  }

  ctx.tools.register(tool('civil_memory_note',
    '把本次办理中确认的事实、成果、技能或取舍连同原句记入本体台账；确认后写回本体，供同场景新案使用。',
    {
      tag: { type: 'string', enum: TAGS, description: '事实＝已核实的事实；成果＝交付或结论；技能＝可复用的办理方法；取舍＝放弃或保留某方案的判断。' },
      text: { type: 'string', description: '一条可独立阅读的内容，写明主体、条件和结论。' },
      quote: { type: 'string', description: '支持该条目的会话或材料原句，逐字摘录。' },
      scene: { type: 'string' }, stance: { type: 'string' }, stage: { type: 'string' }, businessKind: { type: 'string' },
      taskMode: { type: 'string', enum: ['contract', 'consult', 'research'] }
    }, ['tag', 'text'], (args, exec) => {
      const sid = session(exec);
      const row = store.get(sid);
      const packet = row?.packet || {};
      const item = memory.add({
        sessionId: sid, tag: args.tag, text: args.text, quote: args.quote,
        scene: args.scene ?? packet.scene, stance: args.stance ?? packet.stance, stage: args.stage ?? packet.stage,
        businessKind: args.businessKind ?? packet.businessKind, taskMode: args.taskMode ?? packet.taskMode,
        caseId: packet.id
      });
      ensureQuietly(sid);
      return { markdown: '已记入本体台账 **' + item.id + '**　' + item.tag + '　' + item.text, memoryId: item.id, pending: memory.summary().pending };
    }));

  ctx.tools.register(tool('civil_memory_digest', '汇总本期待确认增量（事实、成果、技能、取舍），生成可回查的周报文件并列出确认方式。',
    { scope: { type: 'string', enum: ['week', 'session'], description: 'week 覆盖本周全部会话；session 只含本会话。' } }, [],
    (args, exec) => {
      const built = digest({ sessionId: session(exec), scope: args.scope || 'week' });
      return { markdown: built.markdown, digestId: built.id, file: built.saved || null, count: built.items.length };
    }));

  ctx.tools.register(tool('civil_memory_apply', '把用户已确认的增量写回本体；编号用 all 表示本期全部。',
    { ids: { type: 'string', description: 'all 或空格分隔的条目编号，如 m-1a2b3c4d。' } }, ['ids'],
    args => apply(idsOf(args.ids))));

  ctx.tools.register(tool('civil_memory_recall', '按场景查阅已写回本体的经验，用于开案前比对。',
    { scene: { type: 'string' }, limit: { type: 'integer' } }, [],
    args => {
      const rows = memory.guidanceFor({ scene: args.scene || '' }, Math.min(Number(args.limit) || 8, 20));
      return { markdown: rows.length ? rows.map(x => '**' + x.id + '**　' + x.tag + '　' + x.text + (x.quote ? '\n> 原句：' + x.quote : '')).join('\n\n') : '该场景尚无已确认的本体积淀。' };
    }));

  ctx.tools.register(tool('civil_memory_status', '查看本体台账、四类增量计数、周报时间与本会话案件。', {}, [],
    (_args, exec) => ({ markdown: status(session(exec)) })));

  ctx.inject(['commands'], commandContext => {
    commandContext.commands.register({
      name: 'civil', description: '民事法律关系本体：台账、周报时间与用法。',
      handler: ({ agent }) => ({ kind: 'success', text: status(sessionIdOf(agent)) })
    });
    commandContext.commands.register({
      name: 'civil-week', description: '设置本体周报时间，如 /civil-week 18:30，或 /civil-week off 关闭。',
      input: { hint: 'HH:mm 或 off' },
      handler: async ({ agent, rawInput }) => {
        const value = String(rawInput || '').trim();
        try {
          if (!value) return { kind: 'success', text: describeWeek(readWeekly()) };
          if (value === 'off') {
            writeWeekly({ ...readWeekly(), enabled: false });
            const service = typeof ctx.get === 'function' ? ctx.get('schedule') : undefined;
            const sessionId = sessionIdOf(agent);
            const hit = service ? (await service.list({ sessionId })).find(r => String(r.title || '').startsWith(WEEKLY_TITLE)) : null;
            if (hit) await service.delete({ sessionId, id: hit.id });
            return { kind: 'success', text: '已关闭周报。重新开启：/civil-week 18:30。' };
          }
          const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
          if (!match) throw Error('时间写成 18:30 这样的 24 小时制，或写 off。');
          const time = String(match[1]).padStart(2, '0') + ':' + match[2] + ':00';
          writeWeekly({ ...readWeekly(), enabled: true, time });
          const result = await ensureWeekly(agent.id);
          return { kind: 'success', text: (result.ok ? '周报改为每周五 ' + time + '（' + readWeekly().timeZone + '）。' : '时间已保存，但定时服务报错：' + result.reason) };
        } catch (e) { return { kind: 'error', text: e.message }; }
      }
    });
    commandContext.commands.register({
      name: 'civil-digest', description: '立即汇总本期待确认增量，确认后写回本体。',
      input: { hint: '可留空' },
      handler: ({ agent }) => {
        try {
          const built = digest({ sessionId: agent.id, scope: 'week' });
          return { kind: 'success', text: built.markdown + (built.saved ? '\n\n已存 ' + built.saved : '') };
        } catch (e) { return { kind: 'error', text: e.message }; }
      }
    });
    commandContext.commands.register({
      name: 'civil-apply', description: '确认增量并写回本体，如 /civil-apply all 或 /civil-apply m-1a2b3c4d。',
      input: { hint: 'all 或条目编号' },
      handler: ({ rawInput }) => {
        try { return { kind: 'success', text: apply(idsOf(rawInput)).markdown }; }
        catch (e) { return { kind: 'error', text: e.message }; }
      }
    });
    commandContext.commands.register({
      name: 'civil-drop', description: '本次不采纳某些增量，如 /civil-drop all。',
      input: { hint: 'all 或条目编号' },
      handler: ({ rawInput }) => {
        try {
          const done = memory.reject(idsOf(rawInput));
          return { kind: 'success', text: '已舍弃 ' + done.length + ' 条，本体台账保留记录。' };
        } catch (e) { return { kind: 'error', text: e.message }; }
      }
    });
  });

  return { ensureWeekly, digest, status, captureSettings: readWeekly };
}
