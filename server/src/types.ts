/** 脱敏规则 */
export interface MaskRule {
  id: string;
  name: string;
  /** JS 正则表达式源码（不含首尾 /） */
  pattern: string;
  /** 正则标志，如 g / i；u 默认补齐 */
  flags: string;
  /**
   * 替换模板，支持：
   *  $& 整体命中、$1..$n 捕获组、$name 命名组、
   *  $RULE、$KEEP:n、$MASK:n、$MASKALL
   */
  replacement: string;
  /** 数值越大优先级越高；同值按规则名排序 */
  priority: number;
  enabled: boolean;
}

/** 合并后落到某条字幕上的命中 */
export interface Hit {
  /** 稳定标识：cue 序号 + 原文区间 + 规则 id，撤销状态据此恢复 */
  key: string;
  ruleId: string;
  ruleName: string;
  priority: number;
  /** 在 cue 纯文本中的起止偏移（含） */
  start: number;
  end: number;
  /** 原文区间 */
  match: string;
  replacement: string;
  /** true 表示用户已撤销，导出时恢复原文 */
  reverted: boolean;
}

/** 被更高优先级 / 更长命中吞并的重叠命中，仅用于审计 */
export interface SuppressedHit {
  ruleId: string;
  ruleName: string;
  priority: number;
  start: number;
  end: number;
  match: string;
  reason: 'overlap';
  winnerRuleId: string;
  winnerRuleName: string;
}

export interface CueHit {
  index: number;
  id: string;
  start: string;
  end: string;
  payload: string;
  /** 纯文本 -> 原文 payload 的偏移映射 */
  map: number[];
  text: string;
  hits: Hit[];
  suppressed: SuppressedHit[];
}

export interface PreviewResult {
  cueCount: number;
  totalHits: number;
  appliedHits: number;
  revertedHits: number;
  suppressedHits: number;
  cues: CueHit[];
  parseErrors: string[];
}

export interface PreviewInput {
  vtt: string;
  rules: MaskRule[];
  revertedKeys?: string[];
}

export interface AuditRecord {
  cueIndex: number;
  cueId: string;
  time: { start: string; end: string };
  rule: { id: string; name: string; priority: number };
  /** 原文区间（含纯文本偏移） */
  source: { start: number; end: number; text: string };
  /** 替换结果 */
  replacement: string;
  status: 'applied' | 'reverted' | 'suppressed';
  /** 被抑制时的胜出规则 */
  suppressedBy?: { id: string; name: string };
}

export interface AuditReport {
  app: string;
  version: number;
  generatedAt: string;
  source: {
    sha256: string;
    length: number;
    cueCount: number;
  };
  rules: MaskRule[];
  stats: {
    totalHits: number;
    appliedHits: number;
    revertedHits: number;
    suppressedHits: number;
  };
  records: AuditRecord[];
}

export interface JobState {
  jobId: string;
  vtt: string;
  rules: MaskRule[];
  /** 已撤销命中的 key 列表 */
  revertedKeys: string[];
  updatedAt: string;
}

export interface ExportResult {
  vtt: string;
  audit: AuditReport;
  jobId: string;
}
