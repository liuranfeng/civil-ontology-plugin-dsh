import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePolicy} from './company-thresholds.mjs';

test('同一案件事实随实际制度的上限而变化',()=>{
 const f={clauseBasis:'single',penaltyAmount:1200};
 assert.equal(evaluatePolicy('penalty',f,'单次违约金上限为1000元。').status,'exceeds-quoted-limit');
 assert.equal(evaluatePolicy('penalty',f,'单次违约金上限为1200元。').status,'within-quoted-limit');
 assert.equal(evaluatePolicy('penalty',f,'单次违约金小于1200元。').status,'needs-evidence');
 assert.equal(evaluatePolicy('penalty',f).status,'needs-evidence');
});
test('每日金额及比例分开，信息缺失或冲突时回到制度原文',()=>{
 const text='单日违约金不超过2000元；每日罚率不得超过2‰。';
 const f={clauseBasis:'daily',dailyRate:0.002,dailyAmount:1800};
 assert.equal(evaluatePolicy('penalty',f,text).comparisons.length,2);
 assert.equal(evaluatePolicy('penalty',{...f,dailyRate:0.003},text).status,'exceeds-quoted-limit');
 for(const facts of [{...f,dailyRate:undefined},{...f,dailyAmount:NaN},{...f,dailyAmount:'1400'}]){
   assert.equal(evaluatePolicy('penalty',facts,text).status,'needs-evidence');
 }
 assert.equal(evaluatePolicy('penalty',f,text+'单日违约金不超过3000元。').status,'needs-evidence');
});
test('整体限额与单条违约金区分，缺制度时不推断审批',()=>{
 const f={capBasis:'percent',capRatio:0.12};
 assert.equal(evaluatePolicy('liabilityCap',f,'赔偿总额占合同金额的比例最高为12%。').status,'within-quoted-limit');
 assert.equal(evaluatePolicy('liabilityCap',f,'单次违约金占合同金额的比例最高为8%。').status,'needs-evidence');
 assert.equal(evaluatePolicy('liabilityCap',{capBasis:'unlimited'},'赔偿总额占合同金额的比例最高为12%。').status,'needs-evidence');
});
test('保函使用相应基数且不跨类型套用',()=>{
 const f={type:'advance',guaranteeAmount:50,contractAmount:5000,advancePayment:200};
 const txt='预付款保函金额占预付款金额的比例不超过24%。';
 assert.equal(evaluatePolicy('guarantee',f,txt).status,'exceeds-quoted-limit');
 assert.equal(evaluatePolicy('guarantee',{...f,type:'warranty'},txt).status,'needs-evidence');
 assert.equal(evaluatePolicy('guarantee',{...f,advancePayment:null},txt).status,'needs-evidence');
 assert.equal(evaluatePolicy('guarantee',{...f,guaranteeAmount:12000},'预付款保函金额上限为1.2万元。').status,'within-quoted-limit');
});
test('不以隐式值填补事实，核验口径不产生任何审批结论',()=>{
 assert.throws(()=>evaluatePolicy('constructor',{}));
 assert.throws(()=>evaluatePolicy('guarantee',[]));
 for(const k of ['penalty','liabilityCap','guarantee'])assert.equal(evaluatePolicy(k,{}).status,'needs-evidence');
});
