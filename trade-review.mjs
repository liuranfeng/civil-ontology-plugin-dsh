import {otherTradeTerm} from './standard-terms.mjs';
const icc='https://library.iccwbo.org/content/tfb/BOOKS/BK_0049/BK_0049_05_RulesSea.htm';
const convention='https://uncitral.un.org/en/texts/salegoods/conventions/sale_of_goods/cisg';
const ginga='https://www.ginga.com.sg/lpg/';
const argus='https://www.argusmedia.com/-/media/project/argusmedia/mainsite/english/documents-and-files/methodology/argus-international-lpg.ashx';
export const termGuide = '先引合同原句和所在条款，核对语法、主体、商品、路线、版本和单据。说明谁应在何时何地做何事、谁负责费用及风险、例外如何证明。将每项义务连到相对人的请求、抗辩、通知、损失和救济。查合同采用的准据法和争议解决条款。业务资料欠缺时，使用宿主检索公开的机构、产品和条款原文；记录出版主体、标题、条款及网址。只提交公开术语作查询。无法确定的具体交易条件向经办人调取材料。';
export function explainTradeTerm(term, excerpt='') {
  const key=term.trim().toUpperCase();
  if(/^(?:EXW|FCA|FAS|CPT|CIP|CFR|CIF|DAP|DPU|DDP)$/.test(key)&&new RegExp('(?:PLATTS|ARGUS|benchmark)\\s+'+key+'\\b|'+key+'\\s+.{0,24}(?:WEEKLY AVERAGE|PRICE ASSESSMENT)','i').test(excerpt))return {term:key+' 报价基准',qualification:'所引文字在描述市场价格，核定交付义务应另查交付条款。',duties:['核实产品、报价机构、计价期、单位、折算及替代报价。'],claims:['按适用公式计算合同价款，再根据付款条件判断到期。价格术语本身不足以确定谁应承担运费和货损。'],evidence:'查价格公式、交付约定及相应的市场报价。',sources:[['国际商会贸易术语说明',icc]]};
  if(/FOB/.test(key) && /(?:PLATTS|ARGUS)\s+FOB|FOB\s+.{0,25}(?:WEEKLY|MONTHLY|AVERAGE|ASSESSMENT|INDEX)/i.test(excerpt)) return {term:'FOB 报价基准',qualification:'此处连接报价机构、市场与计价期间，优先按价格基准理解。实际交付方式另查交付条款。',duties:['核对报价来源、对应产品和市场、观察期、平均方法、升贴水和报价缺失时的替代安排。'],claims:['付款请求按适用定价公式和交付、收票等到期条件分别确定。仅凭价格基准不得分配订船、装船、运费和货损风险。'],evidence:'请对照价格条款、交付方式、贸易术语版本、装运或目的港及对应的报价记录。',sources:[['国际商会海运贸易术语',icc]]};
  if(key==='CFR')return {term:'CFR（成本加运费）',qualification:'以双方采用《国际贸易术语解释通则 2020》的海运 CFR 为前提。核实名称后的指定目的港和实际装运港。',duties:['卖方负责出口清关，负责安排主运输并支付至指定目的港的主运费，将货物装船或取得已如此交付的货物，并交付约定运输单据。','货损风险通常在装运港装上船时转移。买方办理进口清关；目的港卸货费应核运输合同是否已由卖方承担。卖方按此术语没有向买方投保的义务。'],claims:['运费承担与货损风险在不同地点判断。检查货损发生阶段、运输单据及违约原因，分别核对买卖双方与承运人的责任。'],evidence:'核对指定港口、提单、运输合同、费用账单和货损记录。',sources:[['国际商会海运贸易术语',icc]]};
  if(key==='FOB'||key==='FREE ON BOARD') return {
    term:'FOB（船上交货）',qualification:'下列说明以合同采用《国际贸易术语解释通则 2020》的海运或内河水运 FOB 为前提。核对指定装运港、交货点、装期与当事人的特别约定。',
    duties:[
      '买方通常负责订立并支付主运输合同，及时告知船名、装货点及约定期间内选定的交货时间。查租船或订舱确认、指船及变更通知。',
      '卖方负责约定货物、适当包装和出口清关，在约定装运港将货装上买方指定船舶，或取得已如此交付的货物。核对报关、装船记录、提单及交货通知。',
      '通常以货物装上指定船舶作为交货和货损风险转移节点。按双方约定分清码头、装船、海运费和进口清关费用；通则未要求买卖任一方为对方投保。',
      '买方指船或通知有误、船舶迟到、不能受载或提前停收时，另查货物已明确划归本合同、约定日期或交货期及所致费用。符合条件时，即使尚未装船，特定风险和额外费用也可能由买方承担。'
    ],claims:[
      '买方可以依据买卖合同请求卖方按时装船并交付约定单证。发生迟延或货损时，先确定原因、风险时点、违约及损害，再判断补救、赔偿或其他救济。',
      '卖方可以按合同付款条件主张价款。买方迟延指船引起仓储等额外费用时，应证明通知义务、归货、因果关系和金额。滞期费还要查买卖或租船约定及可归责期间。',
      '所有权转移、付款到期、检验异议及解除分别审查。涉外案件另核交易双方营业地、公约适用或排除、准据法和特别约定。'
    ],evidence:'向业务调取签署版合同、适用通则及版本、装期和港口约定、指船通知、装船提单及费用凭证。',sources:[['国际商会《国际贸易术语解释通则 2020》海运规则',icc],['联合国《国际货物销售合同公约》',convention]]};
  if(/GINGA/.test(key)){
    const vessel=/vessel(?:\s+name)?\s*[:：]?\s*ginga(?:\s+[a-z][a-z0-9-]*)?/i.test(excerpt);
    return {term:'Ginga',qualification:vessel?'在所引装运约定中，该名称位于船名栏，可用于识别拟装运船舶；仍须核对实际指船及替代船约定。':'在液化石油气现货或远期交易中，Ginga 可能指经纪机构、经纪成交确认，亦可能指其远东交割合同的标准条款。先核引用所在句和交易品种。',
      duties:vessel?['核对船舶身份、航次、装期、替代权与有效指船通知。']:['核实所引文件名称、全文、版本、成交确认与买卖合同的优先关系，以及双方是否同意纳入。','若引用标准交割条件，逐项核对品种、数量容差、交货港、装期、运费、通知和违约安排。若仅确认经纪成交，则核成交双方、核心交易条件及经纪服务边界。'],
      claims:vessel?['仅凭船名无法确认买卖双方纳入任何经纪或标准交易条款。迟延或滞期请求须另查合同依据。']:['证明标准条款已纳入且与特别约定一致后，才据具体义务判断履行、价款或违约请求。单独的经纪委托另查佣金及服务责任。'],
      evidence:'调取签署合同完整上下文、经纪成交确认、实际引用的标准文本和版本。价格评估机构的方法只能证明市场用法。',sources:[['Ginga 液化石油气交易说明',ginga],['Argus 国际液化石油气价格评估方法',argus]]};
  }
  return otherTradeTerm(key)||{term,qualification:'所引术语的交易含义待核。',duties:[],claims:[],evidence:termGuide,sources:[]};
}
