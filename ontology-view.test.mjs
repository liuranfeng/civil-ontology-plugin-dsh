import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {ontologyData,renderOntology} from './ontology-view.mjs';

test('关系图保留知识快照的每个对象、关系方向和请求权检查项',()=>{
  const {model,methods,statutes,enterprise}=ontologyData();
  const original=JSON.parse(readFileSync(new URL('./civil/model.json',import.meta.url),'utf8'));
  assert.deepEqual(model,original);
  assert.equal(methods.length,82);
  assert.equal(statutes.length,1260);
  assert.equal(enterprise.cards.length,134);
  assert.equal(enterprise.conflicts.length,11);
  assert.equal(enterprise.families.length,17);
});
test('只读页面只内嵌随包数据，渲染结果不随多次调用改变',()=>{
  const html=renderOntology();
  assert.equal(html,renderOntology());
  const embedded=JSON.parse(html.match(/id="ontology-data" type="application\/json">([\s\S]+?)<\/script>/)[1]);
  assert.deepEqual(embedded,ontologyData());
  assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+href=|\bfetch\s*\(/i);
});
