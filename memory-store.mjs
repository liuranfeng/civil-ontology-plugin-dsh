import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 用户确认的本体四类增量。未归类的会话原话单列，等待 Agent 在周报时补标签。 */
export const TAGS = ['事实', '成果', '技能', '取舍'];
export const UNTAGGED = '待归类';
export const ALL_TAGS = [...TAGS, UNTAGGED];
const MAX_ITEMS = 4000;
const MAX_TEXT = 2000;

const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const read = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
};
function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { flag: 'wx' });
  fs.renameSync(tmp, file);
}
const clean = (v, max = MAX_TEXT) => {
  if (typeof v !== 'string') return '';
  const t = v.replace(/\r\n/g, '\n').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
};
const day = iso => String(iso || '').slice(0, 10);
/** 本周从周一开始计；周五推送时覆盖周一至推送当刻。 */
export function weekStart(now = new Date()) {
  const d = new Date(now.getTime());
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function makeMemory(home) {
  const root = path.join(home, 'memory');
  const file = path.join(root, 'ledger.json');
  const digests = path.join(root, 'digests');
  const load = () => {
    const state = read(file, { version: 1, items: [] });
    if (!Array.isArray(state.items)) state.items = [];
    return state;
  };
  const put = state => {
    const items = state.items.slice(-MAX_ITEMS);
    save(file, { version: 1, items });
    return items;
  };

  function add(input = {}) {
    const text = clean(input.text);
    if (text.length < 2) throw Error('请写出可回查的一条内容，至少两个字。');
    const tag = ALL_TAGS.includes(input.tag) ? input.tag : UNTAGGED;
    const state = load();
    const same = state.items.find(x => x.sessionId === input.sessionId && x.text === text);
    if (same) return same;
    const at = input.at || new Date().toISOString();
    let id = 'm-' + hash(input.sessionId + '|' + tag + '|' + text).slice(0, 8);
    if (state.items.some(x => x.id === id)) id = 'm-' + hash(id + at).slice(0, 8);
    const item = {
      id, at, sessionId: input.sessionId || '', tag,
      text, quote: clean(input.quote, 800),
      scene: clean(input.scene, 80), stance: clean(input.stance, 80),
      stage: clean(input.stage, 80), businessKind: clean(input.businessKind, 80),
      taskMode: ['contract', 'consult', 'research'].includes(input.taskMode) ? input.taskMode : 'contract',
      caseId: clean(input.caseId, 80),
      status: 'pending', digest: null, confirmedAt: null
    };
    state.items.push(item);
    put(state);
    return item;
  }

  const list = (filter = {}) => load().items.filter(x =>
    (!filter.status || x.status === filter.status) &&
    (!filter.tag || x.tag === filter.tag) &&
    (!filter.sessionId || x.sessionId === filter.sessionId) &&
    (!filter.since || x.at >= filter.since));

  /** 待确认增量：本周新增，或尚未进入过任何一期周报。 */
  const pending = (since = weekStart().toISOString()) =>
    list({ status: 'pending' }).filter(x => x.at >= since || !x.digest);

  function retag(id, tag) {
    if (!ALL_TAGS.includes(tag)) throw Error('标签只能是' + TAGS.join('、') + '。');
    const state = load();
    const item = state.items.find(x => x.id === id);
    if (!item) throw Error('没有编号 ' + id + ' 的条目。');
    item.tag = tag;
    put(state);
    return item;
  }

  function resolve(ids, status) {
    const state = load();
    const wanted = ids === 'all' ? state.items.filter(x => x.status === 'pending') : state.items.filter(x => ids.includes(x.id));
    if (!wanted.length) throw Error(ids === 'all' ? '本周没有待确认的条目。' : '没有匹配的待确认条目，请核对编号。');
    const done = [];
    for (const item of wanted) {
      if (item.status === 'pending') {
        item.status = status;
        item.confirmedAt = status === 'confirmed' ? new Date().toISOString() : null;
        done.push(item);
      }
    }
    put(state);
    return done;
  }

  function markDigested(digestId) {
    const state = load();
    let n = 0;
    for (const item of state.items) if (item.status === 'pending' && !item.digest) { item.digest = digestId; n++; }
    put(state);
    return n;
  }

  /** 写入某期周报文件，返回可回查的绝对路径。 */
  function saveDigest(digestId, markdown) {
    fs.mkdirSync(digests, { recursive: true });
    const target = path.join(digests, digestId + '.md');
    fs.writeFileSync(target, markdown, { flag: 'wx' });
    return target;
  }

  const summary = () => {
    const items = load().items;
    const count = status => items.filter(x => x.status === status).length;
    return {
      total: items.length,
      pending: count('pending'), confirmed: count('confirmed'), rejected: count('rejected'),
      byTag: Object.fromEntries(ALL_TAGS.map(tag => [tag, items.filter(x => x.tag === tag && x.status !== 'rejected').length])),
      lastDigest: items.map(x => x.digest).filter(Boolean).sort().at(-1) || null
    };
  };

  /** 开案时注入：同场景已确认的本体积淀，最近的在前。 */
  function guidanceFor(packet = {}, limit = 6) {
    return load().items
      .filter(x => x.status === 'confirmed' && x.scene && x.scene === packet.scene)
      .sort((a, b) => String(b.confirmedAt || '').localeCompare(String(a.confirmedAt || '')))
      .slice(0, limit)
      .map(x => ({ id: x.id, tag: x.tag, text: x.text, quote: x.quote, stance: x.stance, stage: x.stage }));
  }

  return { root, add, list, pending, retag, confirm: ids => resolve(ids, 'confirmed'), reject: ids => resolve(ids, 'rejected'), markDigested, saveDigest, summary, guidanceFor, day };
}
