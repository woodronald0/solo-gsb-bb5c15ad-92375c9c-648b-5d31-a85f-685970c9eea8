import { createHash } from 'crypto';
import { parseVtt, serializeVtt } from './vtt';
import type {
  AuditRecord,
  AuditReport,
  CueHit,
  ExportResult,
  Hit,
  MaskRule,
  PreviewResult,
  SuppressedHit,
} from './types';

/* ------------------------------------------------------------------ */
/* 规则编译                                                            */
/* ------------------------------------------------------------------ */

export interface CompiledRule {
  rule: MaskRule;
  regex: RegExp;
}

export function compileRules(rules: MaskRule[]): {
  compiled: CompiledRule[];
  errors: { ruleId: string; message: string }[];
} {
  const compiled: CompiledRule[] = [];
  const errors: { ruleId: string; message: string }[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!rule.pattern) continue;
    try {
      // 去重并限制标志：g 必须有（遍历全部命中），剔除不支持的标志
      const flagSet = new Set((rule.flags || '').split('').filter(Boolean));
      flagSet.add('g');
      flagSet.delete('y');
      flagSet.delete('d');
      const regex = new RegExp(rule.pattern, Array.from(flagSet).join(''));
      compiled.push({ rule, regex });
    } catch (e) {
      errors.push({ ruleId: rule.id, message: (e as Error).message });
    }
  }
  return { compiled, errors };
}

/* ------------------------------------------------------------------ */
/* payload <-> 纯文本 映射（剥离内联时间戳等标签）                       */
/* ------------------------------------------------------------------ */

const TAG_RE = /<[^>]+>/g;

/**
 * 返回去标签纯文本与逐字符映射：
 * map[i] 表示纯文本第 i 个字符在原 payload 中的下标。
 * 标签包围的命中在替换时会整体覆盖对应标签区间。
 */
export function plainText(payload: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let i = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = TAG_RE.exec(payload)) !== null) {
    for (; i < m.index; i++) {
      text += payload[i];
      map.push(i);
    }
    i = m.index + m[0].length;
    last = TAG_RE.lastIndex;
  }
  for (; i < payload.length; i++) {
    text += payload[i];
    map.push(i);
  }
  void last;
  return { text, map };
}

/* ------------------------------------------------------------------ */
/* 替换模板                                                            */
/* ------------------------------------------------------------------ */

function maskChar(ch: string): string {
  return /\s/.test(ch) ? ch : '*';
}

/**
 * 扩展内置占位符，再交给 JS 标准替换语义（$&/$1/$<name>）。
 *  - $KEEP:n   保留命中前 n 个字符，其余打码
 *  - $MASK:n   仅前 n 个字符打码
 *  - $MASKALL  整体打码（空白保留）
 *  - $RULE     替换为规则名
 */
export function expandReplacement(
  template: string,
  matched: string,
  ruleName: string,
): string {
  let t = template;
  t = t.replace(/\$MASKALL/g, () => matched.split('').map(maskChar).join(''));
  t = t.replace(/\$KEEP:(\d+)/g, (_s, n: string) => {
    const k = Math.min(Number(n), matched.length);
    return matched.slice(0, k) + matched.slice(k).split('').map(maskChar).join('');
  });
  t = t.replace(/\$MASK:(\d+)/g, (_s, n: string) => {
    const k = Math.min(Number(n), matched.length);
    return matched.slice(0, k).split('').map(maskChar).join('') + matched.slice(k);
  });
  t = t.replace(/\$RULE/g, ruleName);
  return t;
}

function applyTemplate(
  template: string,
  matched: string,
  ruleName: string,
  match: RegExpMatchArray | RegExpExecArray,
): string {
  const expanded = expandReplacement(template, matched, ruleName);
  // 标准 $& / $1.. / $<name> 语义
  return expanded.replace(/\$(\d+|&|`|'|<[^>]+>)/g, (tok) => {
    if (tok === '$&') return matched;
    if (tok === '$`' || tok === "$'") return '';
    if (tok.startsWith('$<')) {
      const name = tok.slice(2, -1);
      return (match.groups?.[name] ?? '') as string;
    }
    const g = match[Number(tok.slice(1))];
    return g ?? '';
  });
}

/* ------------------------------------------------------------------ */
/* 命中合并（优先级 + 最长重叠吞并）                                    */
/* ------------------------------------------------------------------ */

interface RawHit {
  ruleId: string;
  ruleName: string;
  priority: number;
  start: number;
  end: number; // 不含
  match: string;
  replacement: string;
}

function hitKey(cueIndex: number, start: string, h: RawHit): string {
  return `${cueIndex}:${start}:${h.start}-${h.end}:${h.ruleId}`;
}

/** 按优先级降序、长度降序、规则名排序，贪心选择互不重叠的命中 */
function mergeHits(raw: RawHit[]): { kept: RawHit[]; suppressed: SuppressedHit[] } {
  const ordered = [...raw].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return a.ruleName.localeCompare(b.ruleName);
  });
  const kept: RawHit[] = [];
  const suppressed: SuppressedHit[] = [];
  for (const h of ordered) {
    const winner = kept.find((k) => h.start < k.end && k.start < h.end);
    if (winner) {
      suppressed.push({
        ruleId: h.ruleId,
        ruleName: h.ruleName,
        priority: h.priority,
        start: h.start,
        end: h.end - 1,
        match: h.match,
        reason: 'overlap',
        winnerRuleId: winner.ruleId,
        winnerRuleName: winner.ruleName,
      });
    } else {
      kept.push(h);
    }
  }
  kept.sort((a, b) => a.start - b.start);
  return { kept, suppressed };
}

/* ------------------------------------------------------------------ */
/* 预览                                                                */
/* ------------------------------------------------------------------ */

export function buildPreview(input: {
  vtt: string;
  rules: MaskRule[];
  revertedKeys?: string[];
}): PreviewResult {
  const parsed = parseVtt(input.vtt);
  const { compiled, errors } = compileRules(input.rules);
  for (const e of errors) parsed.errors.push(`规则 ${e.ruleId} 正则无效：${e.message}`);

  const reverted = new Set(input.revertedKeys ?? []);
  const cues: CueHit[] = [];
  let totalHits = 0;
  let appliedHits = 0;
  let revertedHits = 0;
  let suppressedHits = 0;

  for (const cue of parsed.cues) {
    const { text, map } = plainText(cue.payload);
    const raw: RawHit[] = [];

    for (const { rule, regex } of compiled) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      // 防止零宽命中死循环
      while ((m = regex.exec(text)) !== null) {
        const matched = m[0];
        if (matched.length === 0) {
          regex.lastIndex++;
          continue;
        }
        raw.push({
          ruleId: rule.id,
          ruleName: rule.name,
          priority: rule.priority,
          start: m.index,
          end: m.index + matched.length,
          match: matched,
          replacement: applyTemplate(rule.replacement, matched, rule.name, m),
        });
      }
    }

    const { kept, suppressed } = mergeHits(raw);
    suppressedHits += suppressed.length;
    totalHits += kept.length;

    const hits: Hit[] = kept.map((h) => {
      const key = hitKey(cue.index, cue.start, h);
      const isReverted = reverted.has(key);
      if (isReverted) revertedHits++;
      else appliedHits++;
      return {
        key,
        ruleId: h.ruleId,
        ruleName: h.ruleName,
        priority: h.priority,
        start: h.start,
        end: h.end - 1,
        match: h.match,
        replacement: h.replacement,
        reverted: isReverted,
      };
    });

    cues.push({
      index: cue.index,
      id: cue.id,
      start: cue.start,
      end: cue.end,
      payload: cue.payload,
      map,
      text,
      hits,
      suppressed,
    });
  }

  return {
    cueCount: parsed.cues.length,
    totalHits,
    appliedHits,
    revertedHits,
    suppressedHits,
    cues,
    parseErrors: parsed.errors,
  };
}

/* ------------------------------------------------------------------ */
/* 应用命中到 payload（含标签区间覆盖）                                 */
/* ------------------------------------------------------------------ */

/** 用最终命中替换 cue payload 中的对应区间；reverted 的命中保持原文 */
export function applyHitsToPayload(cue: CueHit): string {
  const active = cue.hits.filter((h) => !h.reverted).sort((a, b) => b.start - a.start);
  let payload = cue.payload;
  for (const h of active) {
    const from = cue.map[h.start];
    const endIdx = h.end + 1 < cue.map.length ? cue.map[h.end + 1] : payload.length;
    payload = payload.slice(0, from) + h.replacement + payload.slice(endIdx);
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* 导出                                                                */
/* ------------------------------------------------------------------ */

export function exportResult(input: {
  vtt: string;
  rules: MaskRule[];
  revertedKeys?: string[];
  jobId?: string;
}): ExportResult {
  const preview = buildPreview(input);
  const parsed = parseVtt(input.vtt);
  const payloadByIndex = new Map<number, string>();
  for (const cue of preview.cues) {
    payloadByIndex.set(cue.index, applyHitsToPayload(cue));
  }
  const newVtt = serializeVtt(parsed, payloadByIndex);

  const records: AuditRecord[] = [];
  for (const cue of preview.cues) {
    for (const h of cue.hits) {
      records.push({
        cueIndex: cue.index,
        cueId: cue.id,
        time: { start: cue.start, end: cue.end },
        rule: { id: h.ruleId, name: h.ruleName, priority: h.priority },
        source: { start: h.start, end: h.end, text: h.match },
        replacement: h.replacement,
        status: h.reverted ? 'reverted' : 'applied',
      });
    }
    for (const s of cue.suppressed) {
      records.push({
        cueIndex: cue.index,
        cueId: cue.id,
        time: { start: cue.start, end: cue.end },
        rule: { id: s.ruleId, name: s.ruleName, priority: s.priority },
        source: { start: s.start, end: s.end, text: s.match },
        replacement: '',
        status: 'suppressed',
        suppressedBy: { id: s.winnerRuleId, name: s.winnerRuleName },
      });
    }
  }

  const sha256 = createHash('sha256').update(input.vtt, 'utf8').digest('hex');
  const audit: AuditReport = {
    app: 'subtitle-mask-console',
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      sha256,
      length: input.vtt.length,
      cueCount: preview.cueCount,
    },
    rules: input.rules,
    stats: {
      totalHits: preview.totalHits,
      appliedHits: preview.appliedHits,
      revertedHits: preview.revertedHits,
      suppressedHits: preview.suppressedHits,
    },
    records,
  };

  return {
    vtt: newVtt,
    audit,
    jobId: input.jobId ?? '',
  };
}
