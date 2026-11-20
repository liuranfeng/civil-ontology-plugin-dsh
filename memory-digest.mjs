import { TAGS, UNTAGGED, weekStart } from './memory-store.mjs';

const cut = (v, n) => {
  const t = String(v || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};
const stamp = iso => String(iso || '').slice(0, 10);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function section(title, items) {
  if (!items.length) return '';
  const lines = items.map((x, i) => {
    const where = [x.caseId && '案件 ' + x.caseId, x.scene, x.stance, x.stage].filter(Boolean).join(' · ');
    const quote = x.quote ? '\n   > 原句：' + cut(x.quote, 120) : '';
    return (i + 1) + '. **' + x.id + '**　' + stamp(x.at) + (where ? '　' + where : '') + '　' + cut(x.text, 220) + quote;
  });
  return '## ' + title + '\n\n' + lines.join('\n') + '\n';
}

/** 生成一期周报的 Markdown 与同名 HTML。 */
export function buildDigest(memory, { now = new Date(), since, digestId, sessionId } = {}) {
  const id = digestId || 'weekly-' + stamp(now.toISOString());
  const from = since || weekStart(now).toISOString();
  const items = memory.pending(from).filter(x => !sessionId || x.sessionId === sessionId);
  const groups = Object.fromEntries([...TAGS, UNTAGGED].map(tag => [tag, items.filter(x => x.tag === tag)]));
  const counts = TAGS.map(tag => tag + ' ' + groups[tag].length).join('、');
  const head = '# 民事本体周报 · ' + stamp(now.toISOString()) + '\n\n覆盖 ' + stamp(from) + ' 起至 ' + stamp(now.toISOString()) +
    (sessionId ? '（仅本会话）' : '（全部会话）') +
    '，本次增量 ' + items.length + ' 条（' + counts + '，待归类 ' + groups[UNTAGGED].length + '）。';
  const body = [head,
    groups[UNTAGGED].length ? '待归类条目请先用 civil_memory_note 的 tag 补标签，或在 /civil-apply 前用 civil_memory_retag 归类。' : '',
    ...TAGS.map(tag => section(tag, groups[tag])),
    groups[UNTAGGED].length ? section('待归类', groups[UNTAGGED]) : '',
    items.length ? ['## 确认方式',
      '- 全部采纳入本体：`/civil-apply all`',
      '- 只采纳指定条目：`/civil-apply ' + items.slice(0, 3).map(x => x.id).join(' ') + '`',
      '- 本次不采纳：`/civil-drop ' + (items[0]?.id || 'm-xxxx') + '`',
      '确认后的条目写入本体，同一场景的新案件开案时会自动带出。'].join('\n') : '## 本期没有待确认的增量\n\n本体与当前会话已经同步。'
  ].filter(Boolean).join('\n\n');
  const markdown = body + '\n';
  const html = '<!doctype html><meta charset="utf-8"><title>民事本体周报 ' + esc(stamp(now.toISOString())) + '</title>' +
    '<style>body{font:15px/1.7 -apple-system,"Microsoft YaHei",sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1f2328}' +
    'h1{font-size:22px;border-bottom:1px solid #d0d7de;padding-bottom:8px}h2{font-size:17px;margin-top:28px}' +
    'ol{padding-left:22px}li{margin:8px 0}code{background:#f6f8fa;padding:1px 5px;border-radius:4px}blockquote{margin:4px 0;color:#57606a;border-left:3px solid #d0d7de;padding-left:10px}</style>' +
    '<h1>民事本体周报 · ' + esc(stamp(now.toISOString())) + '</h1>' +
    '<p>覆盖 ' + esc(stamp(from)) + ' 起，本次增量 ' + items.length + ' 条（' + esc(counts) + '）。</p>' +
    [...TAGS, UNTAGGED].filter(tag => groups[tag].length).map(tag =>
      '<h2>' + esc(tag) + '</h2><ol>' + groups[tag].map(x =>
        '<li><b>' + esc(x.id) + '</b> ' + esc(stamp(x.at)) + ' ' + esc(cut(x.text, 260)) +
        (x.quote ? '<blockquote>原句：' + esc(cut(x.quote, 160)) + '</blockquote>' : '') + '</li>').join('') + '</ol>').join('') +
    '<p>确认：<code>/civil-apply all</code> 或 <code>/civil-apply ' + esc(items[0]?.id || 'm-xxxx') + '</code>；舍弃：<code>/civil-drop</code>。</p>';
  return { id, markdown, html, items, counts, from };
}
