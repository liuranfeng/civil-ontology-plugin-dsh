import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {makeStore} from './case-store.mjs';
import {recordReviewNarrative,renderReviewNarrative} from './review-narrative.mjs';

const clause={id:'C1',kind:'合同正文',locator:'《翻译委托协议》第三条',text:'译件交付后三日内，委托人应付清报酬。'};
const packet={id:'翻译委托甲',scene:'翻译委托',stage:'签约前',stance:'受托方',sources:[clause]};
const refs=[{sourceId:'C1',quote:clause.text}];
const facts={reviewRevision:1,background:'双方约定交件后付款，实际交件日期待核。',backgroundRefs:refs,
  claims:[{claimant:'受托方',respondent:'委托方',request:'支付报酬',basis:'依据协议第三条',condition:'交件满三日后到期',
    defense:'对方可争执译件是否已交付',proof:'已约定付款条件，实际交件须以交付记录核实',consequence:'在合同中明确交件回执',refs}]};

test('给付、抗辩及证据随案保留，补入新原件后两份工作记录均需复核',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'civil-narrative-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const store=makeStore(temp);
  const first={...store.open('a',packet),revision:1,methodReviews:[{title:'交付与报酬'}]};
  const saved=recordReviewNarrative(first,facts);
  store.put('a',saved);
  assert.match(renderReviewNarrative(saved).claims,/争执译件是否已交付/);
  assert.deepEqual(store.open('a',packet).methodReviews,first.methodReviews);
  assert.throws(()=>store.open('a',{...packet,id:'另一个编号'}),/原案件编号/);
  const next=store.open('a',{...packet,sources:[clause,{id:'A2',kind:'附件',locator:'附件一',text:'双方以交付回执确认日期。'}]});
  assert.equal(next.packet.sources.length,2);
  assert.deepEqual(next.methodReviews,first.methodReviews);
  assert.throws(()=>renderReviewNarrative(next),/当前材料/);
  assert.throws(()=>recordReviewNarrative(next,{...facts,backgroundRefs:[{sourceId:'C1',quote:'已交付的日期'}]}),/引文/);
});
