import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeMemory, weekStart } from './memory-store.mjs';
import { buildDigest } from './memory-digest.mjs';
import { writeBackOntology } from './memory-ontology.mjs';
import { approvedForCase } from './catalog-review.mjs';
import { makeStore } from './case-store.mjs';
import { captureText } from './memory-plugin.mjs';

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'civil-memory-'));
const packet = {
  id: '租赁-01', taskMode: 'contract', scene: '租赁', stance: '承租方', stage: '签约前', businessKind: '商业地产',
  sources: [{ id: 'C1', kind: '合同正文', locator: '第五条 租金调整', text: '租金每年按上一年度租金总额的百分之五递增。' }]
};

test('会话增量按四类标签入账，周报按周汇总并给出确认方式', () => {
  const memory = makeMemory(home());
  const a = memory.add({ sessionId: 's1', tag: '事实', text: '第五条约定租金年递增百分之五。', scene: '租赁', stance: '承租方', stage: '签约前', businessKind: '商业地产', caseId: '租赁-01' });
  const b = memory.add({ sessionId: 's1', tag: '取舍', text: '递增条款保留但要求改为按消费价格指数封顶。', scene: '租赁', stance: '承租方', stage: '签约前', businessKind: '商业地产', caseId: '租赁-01' });
  memory.add({ sessionId: 's2', tag: '待归类', text: '用户追问能否主张解除。' });
  assert.match(a.id, /^m-[a-f0-9]{8}$/);
  assert.equal(memory.summary().pending, 3);

  const built = buildDigest(memory, { now: new Date() });
  assert.equal(built.items.length, 3);
  assert.match(built.markdown, /事实 1/);
  assert.match(built.markdown, /取舍 1/);
  assert.match(built.markdown, /待归类 1/);
  assert.match(built.markdown, new RegExp(a.id));
  assert.match(built.markdown, /civil-apply/);
  assert.equal(built.from, weekStart().toISOString());
  assert.equal(built.id.startsWith('weekly-'), true);
});

test('确认后按场景写回本体，同一方向的新案开案即可带出', () => {
  const root = home();
  const memory = makeMemory(root);
  const item = memory.add({ sessionId: 's1', tag: '技能', text: '租金递增条款以消费价格指数封顶后可以接受。', quote: '租金每年按上一年度租金总额的百分之五递增。', scene: '租赁', stance: '承租方', stage: '签约前', businessKind: '商业地产', taskMode: 'contract' });
  const done = memory.confirm('all');
  assert.equal(done.length, 1);
  const back = writeBackOntology(root, done);
  assert.deepEqual(back.written, [item.id]);

  const store = makeStore(root);
  const guidance = approvedForCase(store, packet);
  assert.equal(guidance.length, 1);
  assert.match(guidance[0].title, /租金递增条款/);

  const other = approvedForCase(store, { ...packet, stance: '出租方' });
  assert.equal(other.length, 0, '不同立场不得带出同一条经验');
  assert.equal(memory.guidanceFor(packet).length, 1);
  assert.equal(memory.guidanceFor({ scene: '买卖' }).length, 0);
});

test('舍弃的条目不入本体，台账保留记录，重复登记不产生第二条', () => {
  const root = home();
  const memory = makeMemory(root);
  const item = memory.add({ sessionId: 's1', tag: '成果', text: '出具了签署意见。' });
  assert.equal(memory.add({ sessionId: 's1', tag: '成果', text: '出具了签署意见。' }).id, item.id);
  memory.reject([item.id]);
  assert.equal(memory.list({ status: 'rejected' }).length, 1);
  assert.equal(writeBackOntology(root, memory.list({ status: 'pending' })).written.length, 0);
  assert.throws(() => memory.confirm('all'), /没有待确认/);
});

test('无法定位业务类型的条目只作通用注记，不写入按场景命中的经验', () => {
  const root = home();
  const memory = makeMemory(root);
  memory.add({ sessionId: 's1', tag: '事实', text: '民法典第五百七十七条规定了违约责任。', scene: '咨询' });
  const back = writeBackOntology(root, memory.confirm('all'));
  assert.equal(back.written.length, 0);
  assert.equal(back.general.length, 1);
});

test('只记录用户原话，任务投递与后台通知不进台账', () => {
  assert.equal(captureText({ source: { kind: 'user' }, content: [{ type: 'text', text: '承租人能否要求解除' }] }), '承租人能否要求解除');
  assert.equal(captureText({ source: { kind: 'schedule' }, content: [{ type: 'text', text: '民事本体周报：…' }] }), '');
  assert.equal(captureText({ source: { kind: 'background-job' }, content: [{ type: 'text', text: 'background job pwsh-…' }] }), '');
  assert.equal(captureText({ content: [{ type: 'text', text: '没有来源标记' }] }), '');
  assert.equal(captureText(undefined), '');
});
