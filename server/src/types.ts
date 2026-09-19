/** 替换模式：固定模板 / 稳定化名 */
export type ReplaceMode = 'template' | 'alias';

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
   * （mode 为 alias 时忽略，以化名表中的化名为准）
   */
  replacement: string;
  /** 替换模式，缺省为 template（固定模板） */
  mode?: ReplaceMode;
  /** 化名模式的编号前缀（缺省「用户」），自动命名为「前缀+序号」 */
  aliasPrefix?: string;
  /** 数值越大优先级越高；同值按规则名排序 */
  priority: number;
  enabled: boolean;
}

/**
 * 稳定化名映射条目。
 * 预览首次命中某实体时建立，随任务持久化；
 * 序号只增不回收，增删字幕不会重排已有编号。
 */
export interface AliasEntry {
  /** 实体键：规则 ID + 经 Unicode NFKC 并去首尾空白后的原文 */
  entityKey: string;
  ruleId: string;
  /** 规范化后的实体原文 */
  source: string;
  /** 规则内分配序号（1 起） */
  seq: number;
  /** 当前生效化名（可手动改名；留空则回退为「前缀+序号」） */
  alias: string;
}

/** 任务级化名映射表 */
export interface AliasTable {
  /** 每条规则的下一个可分配序号（持久，不回收） */
  nextSeq: Record<string, number>;
  entries: AliasEntry[];
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
  /** 化名模式命中：所属实体键（稳定映射，可据此查化名表） */
  entityKey?: string;
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
  /** 本次预览后的完整化名表（含新建映射，调用方应持久化） */
  aliases: AliasTable;
}

export interface PreviewInput {
  vtt: string;
  rules: MaskRule[];
  revertedKeys?: string[];
  aliases?: AliasTable;
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
  /** 化名模式：实体键（规则 ID + NFKC 规范化原文） */
  entityKey?: string;
  /** 化名模式：最终生效的化名 */
  alias?: string;
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
  /** 导出时的完整化名映射表（无化名模式规则时为空数组） */
  aliases: AliasEntry[];
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
  /** 稳定化名映射表（持久化，增删字幕不重排编号） */
  aliases: AliasTable;
  updatedAt: string;
}

export interface ExportResult {
  vtt: string;
  audit: AuditReport;
  jobId: string;
  /** 导出时的完整化名表（含导出过程中新建的映射） */
  aliases: AliasTable;
}
