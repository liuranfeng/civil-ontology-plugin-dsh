/**
 * 段落级 DOCX 修订生成（不依赖任何第三方引擎）
 *
 * 设计约束：
 *  1. 骨架来自原件：只改被点名的段落，段落内非 run 的子元素（书签、批注范围等）原样保留；
 *  2. 修订用 Word 原生 w:ins / w:del，接受/拒绝语义与 Word 一致；
 *  3. 只支持三种改动：整段替换、句内替换、段后插入；
 *  4. 遇到无法安全处理的结构（超链接内文字、内容控件、已有修订）一律阻断并说明，不猜、不静默丢内容。
 */

const RUN_RE = /<w:r\b[^>]*\/>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const PARA_RE = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const TEXT_RE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
const RPR_RE = /<w:rPr>[\s\S]*?<\/w:rPr>/;

/** 段落内可识别的子元素（按出现顺序切分；未识别的片段按“其他”保留） */
const CHILD_RE = new RegExp(
  [
    '<w:pPr>[\\s\\S]*?<\\/w:pPr>',
    '<w:r\\b[^>]*\\/>',
    '<w:r\\b[^>]*>[\\s\\S]*?<\\/w:r>',
    '<w:hyperlink\\b[^>]*>[\\s\\S]*?<\\/w:hyperlink>',
    '<w:smartTag\\b[^>]*>[\\s\\S]*?<\\/w:smartTag>',
    '<w:sdt\\b[^>]*>[\\s\\S]*?<\\/w:sdt>',
    '<w:ins\\b[^>]*\\/>',
    '<w:del\\b[^>]*\\/>',
    '<w:ins\\b[^>]*>[\\s\\S]*?<\\/w:ins>',
    '<w:del\\b[^>]*>[\\s\\S]*?<\\/w:del>',
    '<w:bookmarkStart\\b[^>]*\\/>',
    '<w:bookmarkEnd\\b[^>]*\\/>',
    '<w:proofErr\\b[^>]*\\/>',
    '<w:commentRangeStart\\b[^>]*\\/>',
    '<w:commentRangeEnd\\b[^>]*\\/>',
  ].join('|'),
  'g'
);

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 段落里的可见文本（w:t / tab / br） */
export function paragraphText(pXml) {
  let out = '';
  const parts = pXml.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g) ?? [];
  for (const part of parts) {
    // 注意顺序：'<w:tab/' 也以 '<w:t' 开头，必须先判 tab/br
    if (part.startsWith('<w:tab')) out += '\t';
    else if (part.startsWith('<w:br')) out += '\n';
    else out += decode(part.replace(/<[^>]+>/g, ''));
  }
  return out;
}

/** 列出全部段落：{ start, end, xml, text } */
export function listParagraphs(xml) {
  const out = [];
  for (const m of xml.matchAll(PARA_RE)) {
    out.push({ start: m.index, end: m.index + m[0].length, xml: m[0], text: paragraphText(m[0]) });
  }
  return out;
}

/** 文档全文（段落文本按行拼接） */
export function docText(xml) {
  return listParagraphs(xml).map((p) => p.text).join('\n');
}

function runText(runXml) {
  let t = '';
  for (const m of runXml.matchAll(TEXT_RE)) t += decode(m[1]);
  return t;
}

const runOpen = (runXml) => runXml.match(/^<w:r\b[^>]*>/)?.[0] ?? '<w:r>';
const runRpr = (runXml) => runXml.match(RPR_RE)?.[0] ?? '';

function runWithText(runXml, text, del = false) {
  const tag = del ? 'w:delText' : 'w:t';
  return runOpen(runXml) + runRpr(runXml) + '<' + tag + ' xml:space="preserve">' + encode(text) + '</' + tag + '></w:r>';
}

const attrs = (id, ctx) => ' w:id="' + id + '" w:author="' + encode(ctx.author) + '" w:date="' + ctx.date + '"';
const delBlock = (inner, id, ctx) => '<w:del' + attrs(id, ctx) + '>' + inner + '</w:del>';
const insBlock = (inner, id, ctx) => '<w:ins' + attrs(id, ctx) + '>' + inner + '</w:ins>';

const WRAPPERS = /^<(w:hyperlink|w:smartTag|w:sdt)\b/;
const REVISIONS = /^<(w:ins|w:del)\b/;

/**
 * 把段落拆成有序子元素：{ kind: 'pPr'|'run'|'wrapper'|'revision'|'marker'|'other', xml }
 * 只有 run 是可编辑的；wrapper/revision 内的文字不参与切分，遇到就阻断。
 */
export function paragraphChildren(pXml) {
  if (/^<w:p\b[^>]*\/>$/.test(pXml)) return [];
  const open = pXml.match(/^<w:p\b[^>]*>/)[0];
  const inner = pXml.slice(open.length, pXml.length - '</w:p>'.length);
  const out = [];
  let cursor = 0;
  for (const m of inner.matchAll(CHILD_RE)) {
    if (m.index > cursor) {
      const gap = inner.slice(cursor, m.index);
      if (gap.trim()) out.push({ kind: 'other', xml: gap });
    }
    const xml = m[0];
    if (xml.startsWith('<w:pPr')) out.push({ kind: 'pPr', xml });
    else if (/^<w:r\b/.test(xml)) out.push({ kind: 'run', xml });
    else if (WRAPPERS.test(xml)) out.push({ kind: 'wrapper', xml });
    else if (REVISIONS.test(xml)) out.push({ kind: 'revision', xml });
    else out.push({ kind: 'marker', xml });
    cursor = m.index + xml.length;
  }
  if (cursor < inner.length) {
    const tail = inner.slice(cursor);
    if (tail.trim()) out.push({ kind: 'other', xml: tail });
  }
  return out;
}

function assertEditable(children, changeType) {
  const wrappers = children.filter((c) => c.kind === 'wrapper' && paragraphText(c.xml).trim());
  if (wrappers.length) {
    throw new Error('该段落含超链接/内容控件等容器，“' + changeType + '”会丢失其中的内容或结构；请先人工处理该段，或改为整段替换并在说明中注明。');
  }
  const revisions = children.filter((c) => c.kind === 'revision');
  if (revisions.length) {
    throw new Error('该段落已含修订痕迹，禁止在其上再叠加生成；请以干净版本为基准，或先接受/拒绝既有修订。');
  }
}

/** 整段替换：段落内全部 run 合并为一个删除块，追加插入块；非 run 子元素原位保留 */
export function replaceParagraph(pXml, after, ctx) {
  const children = paragraphChildren(pXml);
  const runs = children.filter((c) => c.kind === 'run');
  assertEditable(children, '整段替换');
  if (runs.length === 0) throw new Error('段落没有可标记的 run，无法替换');
  const deleted = runs.map((r) => runWithText(r.xml, runText(r.xml), true)).join('');
  const out = [];
  let emittedDel = false;
  for (const c of children) {
    if (c.kind === 'run') {
      if (!emittedDel) {
        out.push(delBlock(deleted, ctx.nextId(), ctx) + insBlock(runWithText(runs[0].xml, after), ctx.nextId(), ctx));
        emittedDel = true;
      }
      continue;
    }
    out.push(c.xml);
  }
  return '<w:p>' + out.join('') + '</w:p>';
}

/** 句内替换：只切分 run；超链接等容器内的文字不参与 */
export function replaceInline(pXml, before, after, ctx) {
  const children = paragraphChildren(pXml);
  assertEditable(children, '句内替换');
  const runs = children.filter((c) => c.kind === 'run');
  if (runs.length === 0) throw new Error('段落没有 run，无法做句内替换');
  for (const r of runs) {
    if ((r.xml.match(/<w:t\b/g) ?? []).length > 1) throw new Error('run 内含多段文本，暂不支持句内替换');
  }

  const full = runs.map((r) => runText(r.xml)).join('');
  const pos = full.indexOf(before);
  if (pos < 0) throw new Error('段落中找不到待替换文字：' + before);
  if (full.indexOf(before, pos + 1) >= 0) throw new Error('待替换文字在同段出现多次，需要更长上下文：' + before);
  const end = pos + before.length;

  const out = [];
  let inserted = false;
  let offset = 0;
  for (const c of children) {
    if (c.kind !== 'run') {
      out.push(c.xml);
      continue;
    }
    const text = runText(c.xml);
    const rs = offset;
    const re = offset + text.length;
    offset = re;
    if (re <= pos || rs >= end) {
      out.push(c.xml);
      continue;
    }
    const headLen = Math.max(0, pos - rs);
    const tailStart = Math.min(text.length, end - rs);
    const head = text.slice(0, headLen);
    const cut = text.slice(headLen, tailStart);
    const tail = text.slice(tailStart);
    if (head) out.push(runWithText(c.xml, head));
    if (cut) out.push(delBlock(runWithText(c.xml, cut, true), ctx.nextId(), ctx));
    if (!inserted && after !== '') {
      out.push(insBlock(runWithText(c.xml, after), ctx.nextId(), ctx));
      inserted = true;
    }
    if (tail) out.push(runWithText(c.xml, tail));
  }
  if (!inserted && after !== '') throw new Error('句内替换未生成插入内容');
  return '<w:p>' + out.join('') + '</w:p>';
}

/** 段后插入新段落（整段视为插入，段落标记也标记为插入）；不改动目标段落 */
export function insertParagraphAfter(pXml, text, ctx) {
  const children = paragraphChildren(pXml);
  const pPr = children.find((c) => c.kind === 'pPr')?.xml ?? '';
  const firstRun = children.find((c) => c.kind === 'run')?.xml;
  const mark = '<w:ins' + attrs(ctx.nextId(), ctx) + '/>';
  let nextPPr;
  if (pPr) {
    nextPPr = RPR_RE.test(pPr)
      ? pPr.replace(RPR_RE, (m) => m.replace('<w:rPr>', '<w:rPr>' + mark))
      : pPr.replace('<w:pPr>', '<w:pPr><w:rPr>' + mark + '</w:rPr>');
  } else {
    nextPPr = '<w:pPr><w:rPr>' + mark + '</w:rPr></w:pPr>';
  }
  const newRun = firstRun ? runWithText(firstRun, text) : '<w:r><w:t xml:space="preserve">' + encode(text) + '</w:t></w:r>';
  return '<w:p>' + nextPPr + insBlock(newRun, ctx.nextId(), ctx) + '</w:p>';
}

/**
 * 按「字符偏移」做局部替换（纯插入 / 纯删除 / 替换三合一）。
 * 不用锚点文字定位，避免重复文字歧义；offset 与 length 来自段落文本。
 */
export function replaceInlineAt(pXml, offset, length, text, ctx) {
  const children = paragraphChildren(pXml);
  assertEditable(children, '局部替换');
  const runs = children.filter((c) => c.kind === 'run');
  if (runs.length === 0) throw new Error('段落没有 run，无法做局部替换');
  for (const r of runs) {
    if ((r.xml.match(/<w:t\b/g) ?? []).length > 1) throw new Error('run 内含多段文本，暂不支持局部替换');
  }
  const total = runs.reduce((n, r) => n + runText(r.xml).length, 0);
  if (offset < 0 || offset > total) throw new Error('偏移超出段落范围：' + offset + ' / ' + total);
  if (offset + length > total) throw new Error('删除范围超出段落：' + offset + '+' + length + ' / ' + total);

  const out = [];
  let cursor = 0;
  let inserted = false;
  const start = offset;
  const end = offset + length;
  for (const c of children) {
    if (c.kind !== 'run') {
      out.push(c.xml);
      continue;
    }
    const t = runText(c.xml);
    const rs = cursor;
    const re = rs + t.length;
    cursor = re;
    const touches = length === 0 ? start >= rs && start <= re : re > start && rs < end;
    if (!touches) {
      out.push(c.xml);
      continue;
    }
    const headLen = Math.max(0, start - rs);
    const delEnd = Math.min(t.length, end - rs);
    const head = t.slice(0, headLen);
    const cut = length > 0 ? t.slice(headLen, delEnd) : '';
    const tail = length > 0 ? t.slice(delEnd) : t.slice(headLen);
    if (head) out.push(runWithText(c.xml, head));
    if (cut) out.push(delBlock(runWithText(c.xml, cut, true), ctx.nextId(), ctx));
    if (!inserted && text !== '') {
      out.push(insBlock(runWithText(c.xml, text), ctx.nextId(), ctx));
      inserted = true;
    }
    if (tail) out.push(runWithText(c.xml, tail));
  }
  if (!inserted && text !== '') {
    // 偏移正好在段落末尾
    out.push(insBlock(runWithText(runs[runs.length - 1].xml, text), ctx.nextId(), ctx));
  }
  return '<w:p>' + out.join('') + '</w:p>';
}

/**
 * 给段落加批注范围。
 *   mode='paragraph' 整段加范围（原行为）
 *   mode='revision'  只包住修订块（del/ins），批注只圈改动处
 * 找不到修订块时退回整段，并在返回值里标注实际模式。
 */
export function commentRange(pXml, id, { mode = 'paragraph' } = {}) {
  const open = pXml.match(/^<w:p\b[^>]*>/)[0];
  const inner = pXml.slice(open.length, pXml.length - '</w:p>'.length);
  let from = 0;
  let to = inner.length;
  let applied = 'paragraph';
  if (mode === 'revision') {
    // 注意 '<w:instrText' 也以 '<w:ins' 开头，必须用带边界的分隔符匹配
    const starts = [/<w:del\b[^>]*>/, /<w:ins\b[^>]*>/]
      .map((re) => re.exec(inner)?.index)
      .filter((i) => i !== undefined);
    const endDel = inner.lastIndexOf('</w:del>');
    const endIns = inner.lastIndexOf('</w:ins>');
    if (starts.length && (endDel >= 0 || endIns >= 0)) {
      from = Math.min(...starts);
      to = Math.max(endDel >= 0 ? endDel + '</w:del>'.length : 0, endIns >= 0 ? endIns + '</w:ins>'.length : 0);
      applied = 'revision';
    }
  }
  const before = inner.slice(0, from);
  const middle = inner.slice(from, to);
  const after = inner.slice(to);
  const ref = '<w:r><w:commentReference w:id="' + id + '"/></w:r>';
  return (
    open + before +
    '<w:commentRangeStart w:id="' + id + '"/>' + middle + '<w:commentRangeEnd w:id="' + id + '"/>' + ref +
    after + '</w:p>'
  );
}

/** 接受全部修订：删除 w:del，展开 w:ins */
export function acceptAll(xml) {
  return xml
    .replace(/<w:del\b[^>]*\/>/g, '')
    .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '')
    .replace(/<w:ins\b[^>]*\/>/g, '')
    .replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, '$1');
}

/** 拒绝全部修订：整段插入的段落整体移除，w:ins 丢弃，w:del 还原 */
export function rejectAll(xml) {
  let out = xml.replace(PARA_RE, (p) => (isInsertedParagraph(p) ? '' : p));
  out = out.replace(/<w:ins\b[^>]*\/>/g, '');
  out = out.replace(/<w:ins\b[^>]*>[\s\S]*?<\/w:ins>/g, '');
  out = out.replace(/<w:del\b[^>]*\/>/g, '');
  out = out.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, (block) =>
    block
      .replace(/^<w:del\b[^>]*>/, '')
      .replace(/<\/w:del>$/, '')
      .replace(/<w:delText\b([^>]*)>/g, '<w:t$1>')
      .replace(/<\/w:delText>/g, '</w:t>')
  );
  return out;
}

/** 段落标记被标记为插入的段落（整段新增） */
export function isInsertedParagraph(pXml) {
  const pPr = pXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  return /<w:rPr>[\s\S]*?<w:ins\b/.test(pPr);
}

/** 结构指纹：段落数、表格数、列宽、显式分页、分节 */
export function structure(xml) {
  return {
    paragraphs: (xml.match(/<w:p[ >]/g) ?? []).length,
    tables: (xml.match(/<w:tbl>/g) ?? []).length,
    gridCols: [...xml.matchAll(/<w:gridCol\b[^>]*w:w="(\d+)"/g)].map((m) => m[1]),
    pageBreaks: (xml.match(/<w:br\b[^>]*w:type="page"/g) ?? []).length,
    sections: (xml.match(/<w:sectPr\b/g) ?? []).length,
  };
}

/** 统计 w:ins / w:del 容器数量（不含自闭合标记） */
export function revisionCounts(xml) {
  const count = (re) => (xml.match(re) ?? []).filter((t) => !/\/>$/.test(t)).length;
  return { ins: count(/<w:ins\b[^>]*>/g), del: count(/<w:del\b[^>]*>/g) };
}

/** 一条改动在“支持语义”下预期的修订形状：ins 数、del 数、涉及 run 数 */
export function expectedShape(originalXml, change) {
  if (change.type === 'insert') return { ins: 1, del: 0, runs: 0, paragraphMarks: 1 };
  const para = listParagraphs(originalXml).find((p) => {
    const t = p.text;
    if (change.type === 'replace') return t === change.before || t.replace(/\s+/g, '') === String(change.before).replace(/\s+/g, '');
    return t.includes(change.before);
  });
  if (!para) return { ins: 0, del: 0, runs: 0 };
  if (change.type === 'replace') return { ins: 1, del: 1, runs: 1 };
  // inline：跨几个 run 就切成几个删除块
  const runs = paragraphChildren(para.xml).filter((c) => c.kind === 'run');
  const texts = runs.map((r) => runText(r.xml));
  const full = texts.join('');
  const pos = full.indexOf(change.before);
  const end = pos + change.before.length;
  let offset = 0;
  let touched = 0;
  for (const t of texts) {
    const rs = offset;
    const re = offset + t.length;
    offset = re;
    if (re > pos && rs < end) touched++;
  }
  return { ins: 1, del: touched, runs: touched };
}

/** 纯文本层面应用改动，作为独立于 XML 管道的“预期值”来源 */
export function applyChangesToText(text, changes) {
  let t = text;
  for (const c of changes) {
    if (c.type === 'replace' || c.type === 'inline') {
      if (!t.includes(c.before)) throw new Error('文本层找不到片段：' + c.before.slice(0, 40));
      t = t.replace(c.before, c.after);
    } else if (c.type === 'insert') {
      const idx = t.indexOf(c.afterParagraph);
      if (idx < 0) throw new Error('文本层找不到锚点段落：' + c.afterParagraph.slice(0, 40));
      const lineEnd = t.indexOf('\n', idx);
      const at = lineEnd < 0 ? t.length : lineEnd;
      t = t.slice(0, at) + '\n' + c.text + t.slice(at);
    } else {
      throw new Error('未知改动类型：' + c.type);
    }
  }
  return t;
}

/**
 * 把「段落旧文本 → 段落新文本」压成单处局部替换（公共前缀 + 公共后缀）。
 * 返回 { prefix, before, after, suffix, beforeLength, afterLength }；
 * 若新旧文本相同则返回 null。多段分散改动不在此处理（调用方应退回整段替换）。
 */
export function inlineDiff(oldText, newText) {
  if (typeof oldText !== 'string' || typeof newText !== 'string') return null;
  if (oldText === newText) return null;
  let start = 0;
  const maxStart = Math.min(oldText.length, newText.length);
  while (start < maxStart && oldText[start] === newText[start]) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--;
    endNew--;
  }
  return {
    prefix: oldText.slice(0, start),
    before: oldText.slice(start, endOld),
    after: newText.slice(start, endNew),
    suffix: oldText.slice(endOld),
    beforeLength: endOld - start,
    afterLength: endNew - start,
  };
}
