// The tool descriptions are part of the DSH model request. The runtime
// validator remains in analysis.mjs and is also used when adding sources.
const source = {
  type: 'object',
  required: ['id', 'kind', 'locator', 'text'],
  additionalProperties: true,
  properties: {
    id: {
      type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9-]+$',
      description: '本案内唯一的来源编号，用 1 至 40 个英文字母、数字或半角连字符，例如 C1、ATT-2。'
    },
    kind: {
      type: 'string', pattern: '\\S',
      description: '材料的实际性质，例如合同正文、合同附件、业务表单、审批规则或会话说明。分别登记；企业规则不能当作合同约定，业务说明也不能证明已履行。'
    },
    locator: {
      type: 'string', pattern: '\\S',
      description: '读者可回查的出处，例如合同名称与真实条款标题、附件名称与表格行、表单名称与字段。没有条号可用真实小标题和段落开头定位。'
    },
    text: {
      type: 'string', pattern: '\\S', maxLength: 20000,
      description: '从该出处逐字摘录与审查有关的原文，每条至多 20000 个 UTF-16 码元。按自然段或条款拆分过长材料，分别编号。只引用实际读到的内容。'
    }
  }
};

export const caseOpeningFields = {
  packet: {
    type: 'object',
    required: ['id', 'scene', 'stance', 'stage', 'sources'],
    additionalProperties: true,
    properties: {
      id: {
        type: 'string', minLength: 1, maxLength: 80, pattern: '^[\\p{L}\\p{N}-]+$',
        description: '本案编号，用 1 至 80 个文字字母（含汉字）、数字或半角连字符。空格、下划线、斜线和其他标点均不可用。同案复用同一编号。'
      },
      taskMode:{type:'string',enum:['contract','consult','research'],description:'合同审查、法律咨询或类案检索。旧合同案省略时沿用原模式。'},
      businessKind:{type:'string',description:'业务子类；使用已确认的同类事项经验时须明确。'},
      organization:{type:'string',description:'材料明确的适用组织。组织边界不明时留空，不引用企业专属跨案经验。'},
      audience:{type:'string',description:'本次交付的实际读者，适用已批准的文书表达偏好时填写。'},
      deliverable:{type:'string',description:'交付类型，例如签前审查报告。'},
      scene: {type: 'string', pattern: '\\S', description: '本案业务场景，例如翻译委托。'},
      stance: {type: 'string', pattern: '\\S', description: '代表谁审查及其交易角色，例如委托方。'},
      stage: {type: 'string', pattern: '\\S', description: '当前审查时点，例如签约前。'},
      sources: {
        type: 'array', minItems: 1, maxItems: 48, items: source,
        description: '1 至 48 条有出处的材料，每项均须填写 id、kind、locator、text，id 不得重复。只提交本案已有材料；缺失材料留待核实。'
      }
    }
  }
};

const example = {
  packet: {
    id: '翻译-01', taskMode:'contract', scene: '翻译委托', stance: '委托方', stage: '签约前',
    sources: [{
      id: 'C1', kind: '合同正文', locator: '《培训手册翻译委托合同》第一条“委托事项”',
      text: '甲方委托乙方将所附中文培训手册译为英文。'
    }]
  }
};

const intake = '顶层传入 packet。packet 必填 id、scene、stance、stage 及 sources；场景、立场、时点须分别填写非空文字。先读取实际材料，每项来源写明唯一编号、材料性质、可核对的位置和逐字原文。下列调用是虚构的格式示例，实际调用须替换为本案事实与材料：'
  + JSON.stringify(example);
export const civilOpeningDescription = '打开民事事项，按用户目标选择 packet.taskMode：合同审查 contract、法律咨询 consult、类案检索 research。咨询可将当事人原话登记为来源。' + intake;
export const procurementOpeningDescription = '打开适用专项采购制度的案件。适用现有采购买方签前分析时，scene 填“采购业务”、stance 填“买方”、stage 填“签约前”。' + intake;
