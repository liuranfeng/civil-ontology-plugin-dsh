import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {companyLevelSources,readCompanyCard,searchCompany,registerCompany} from './company-policy.mjs';
import {legalReviewMarkdown} from './word-tools.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./civil/company.json',import.meta.url)));
test('两份资料逐项可查，双向对读且引用自然出处',()=>{
 const size=new Set(catalog.cards.map(c=>c.id)).size;
 assert.equal(size,134);
 const pages=[];
 for(let i=0;i<size;i+=12)pages.push(...searchCompany('','',i).items);
 assert.equal(pages.length,size);
 for(const c of catalog.cards){assert(c.fields.length>0);for(const r of c.related)assert(readCompanyCard(r).card.related.includes(c.id));}
 assert.equal(catalog.conflicts.length,11);
 const c=readCompanyCard('legal-26').card;
 assert.equal(readCompanyCard(c.location).card.id,c.id);
 assert.match(readCompanyCard(c.location).markdown,/预付费/);
 assert(searchCompany('源代码').items.some(c=>c.id==='legal-22'));
});
const entity='示例软件供应有限公司';
const source={id:'A',kind:'正文',locator:'签约主体',text:'服务提供方为'+entity+'。'};
const clause={id:'B',kind:'正文',locator:'赔偿责任条款',text:'我方承担全部赔偿责任，赔偿不设上限。'};
const policyScope='本制度适用于'+entity+'的销售交易。';
const policyQuote='整体赔偿无上限时须按Ⅱ级审批。';
const policy={id:'C',kind:'本案现行审批制度',locator:'《示例交易授权指引》责任限额条款',text:policyScope+policyQuote};
const policyRefs={policySourceId:'C',policyQuote,policyScopeQuote:policyScope};
const packet={id:'s',scene:'销售业务',stance:'卖方',stage:'签约前',businessKind:'云服务销售合同',sources:[source,clause,policy]};
function fixture(p=packet){
 let row={revision:1,packet:p};
 const tools=new Map();
 registerCompany({systemPrompt:{section(){}},tools:{register:x=>tools.set(x.name,x)}},{tool:(name,d,ps,r,fn)=>({name,fn}),store:{get:()=>row},session:()=>1,save:(_,v)=>{row=v;return 'case.html';}});
 const args={reviewRevision:1,cardId:'legal-30',sourceId:'B',quote:clause.text,organization:entity,scopeSourceId:'A',scopeQuote:p.sources[0].text,...policyRefs,status:'制度所列口径，待核适用',decision:'总赔偿范围应核实。',action:'取得签署文本及发布版制度。'};
 return {row:()=>row,run:extra=>tools.get('company_record_review').fn({...args,...extra},{})};
}
test('本案立场、逐字引文、资料状态和修订均为前提',()=>{
 const f=fixture();assert.throws(()=>f.run({quote:'其他交易的条款。'}));
 assert.throws(()=>f.run({reviewRevision:2}));assert.throws(()=>f.run({scopeQuote:'这份材料没有这句话。'}));
 assert.throws(()=>fixture({...packet,stance:'买方'}).run({}));
 assert.throws(()=>fixture({...packet,sources:[{...source,text:'采购方为'+entity+'。'},clause]}).run({}));
 for(const c of catalog.cards.filter(c=>/废止|原表注明免除/.test(c.status))){assert.throws(()=>f.run({cardId:c.id}));assert(f.run({cardId:c.id,status:'本案不适用'}).markdown.includes(c.title));}
});
test('Word 以单案核准的表列原文说明条件，不使旧审批表自动生效',()=>{
 const f=fixture();const n=f.run({});assert(n.markdown.includes(policyQuote));
 const notes=f.row().companyNotes,ref=companyLevelSources(notes)[0];
 const review={title:'销售合同意见',stance:'我方是服务提供方',materialScope:'审阅交易条款。',decision:'请核实责任上限。',profile:['本案为服务交易。'],
 risks:[{status:'待确认',risk:'赔偿范围',action:'核对终稿条款。',refs:[{sourceId:'B',name:'赔偿责任条款',quote:clause.text}]}],
 approval:[{text:'若本表适用，按原表所列金额档核实是否需Ⅱ级审批。',refs:[{sourceId:ref.locator,quote:ref.text}]}],conclusion:'核实金额与现行制度后再决定签署。'};
 assert.match(legalReviewMarkdown(packet,review,[],notes).markdown,/公司法务依据/);
 assert.throws(()=>legalReviewMarkdown(packet,{...review,approval:[{...review.approval[0],text:'应直接办理Ⅱ级审批。'}]},[],notes));
 assert.throws(()=>legalReviewMarkdown(packet,{...review,approval:[{...review.approval[0],text:'按原表办理Ⅴ级审批。'}]},[],notes));
 assert.throws(()=>legalReviewMarkdown(packet,review,[],[]));
});
test('仅有签约人和合同证据时可以记为待核，不能声称适用本案审批制度',()=>{
 const f=fixture({...packet,sources:[source,clause]});
 const none={policySourceId:undefined,policyQuote:undefined,policyScopeQuote:undefined};
 assert.throws(()=>f.run(none));
 assert.throws(()=>f.run({policySourceId:'B',policyQuote:clause.text,policyScopeQuote:clause.text}));
 assert.match(f.run({...none,status:'需补证'}).markdown,/待补/);
 assert.throws(()=>fixture().run({...policyRefs,policyScopeQuote:'另一企业为本制度的适用主体。'}));
});

