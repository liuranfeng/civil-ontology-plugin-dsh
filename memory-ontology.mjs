import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const line = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * 把用户确认的记忆条目写回本体：与 catalog-review 同一份存储，
 * approvedForCase 在开案时按 场景/立场/时点/业务类型 精确命中后带入审查意见。
 */
export function writeBackOntology(home, items) {
  const dir = path.join(home, 'catalog-review');
  fs.mkdirSync(dir, { recursive: true });
  const written = [], general = [];
  for (const item of items) {
    const scope = ['scene', 'stance', 'stage', 'businessKind'].map(k => line(item[k], 80));
    const scoped = scope.every(Boolean);
    if (!scoped || item.taskMode !== 'contract') { general.push(item); continue; }
    const guidance = {
      title: line(item.text, 48),
      relation: [item.tag, item.scene].filter(Boolean).join(' · '),
      scope: [item.stance, item.stage].filter(Boolean).join(' · '),
      counter: item.quote ? '会话原句「' + line(item.quote, 160) + '」' : ''
    };
    const values = item.taskMode === 'contract' ? scope : [...scope, item.taskMode];
    const id = hash(JSON.stringify({ values, guidance })).slice(0, 16);
    const file = path.join(dir, id + '.json');
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify({
        id, scope: values, guidance, evidence: [],
        confirmed: true, confirmedAt: item.confirmedAt || new Date().toISOString(),
        origin: 'session-memory', memoryId: item.id
      }, null, 2), { flag: 'wx' });
    }
    written.push(item.id);
  }
  return { written, general: general.map(x => x.id) };
}
