export type ReplaceMode = 'template' | 'alias';

export interface MaskRule {
  id: string;
  name: string;
  pattern: string;
  flags: string;
  replacement: string;
  /** 替换模式，缺省为 template（固定模板） */
  mode?: ReplaceMode;
  /** 化名模式的编号前缀（缺省「用户」） */
  aliasPrefix?: string;
  priority: number;
  enabled: boolean;
}

/** 稳定化名映射条目：首次命中时建立，持久化，编号不重排 */
export interface AliasEntry {
  /** 实体键：规则 ID + 经 Unicode NFKC 并去首尾空白后的原文 */
  entityKey: string;
  ruleId: string;
  source: string;
  seq: number;
  alias: string;
}

export interface AliasTable {
  nextSeq: Record<string, number>;
  entries: AliasEntry[];
}

export interface Hit {
  key: string;
  ruleId: string;
  ruleName: string;
  priority: number;
  start: number;
  end: number;
  match: string;
  replacement: string;
  /** 化名模式命中：所属实体键 */
  entityKey?: string;
  reverted: boolean;
}

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
  /** 本次预览后的完整化名表（含新建映射） */
  aliases: AliasTable;
}

export interface JobState {
  jobId: string;
  vtt: string;
  rules: MaskRule[];
  revertedKeys: string[];
  aliases: AliasTable;
  updatedAt: string;
}

export interface AuditRecord {
  cueIndex: number;
  cueId: string;
  time: { start: string; end: string };
  rule: { id: string; name: string; priority: number };
  source: { start: number; end: number; text: string };
  replacement: string;
  status: 'applied' | 'reverted' | 'suppressed';
  suppressedBy?: { id: string; name: string };
  /** 化名模式：实体键与最终化名 */
  entityKey?: string;
  alias?: string;
}

export interface AuditReport {
  app: string;
  version: number;
  generatedAt: string;
  source: { sha256: string; length: number; cueCount: number };
  rules: MaskRule[];
  /** 导出时的完整化名映射表 */
  aliases: AliasEntry[];
  stats: {
    totalHits: number;
    appliedHits: number;
    revertedHits: number;
    suppressedHits: number;
  };
  records: AuditRecord[];
}

export interface ExportResult {
  vtt: string;
  audit: AuditReport;
  jobId: string;
  aliases: AliasTable;
}

export interface Preset {
  name: string;
  description: string;
  rule: Omit<MaskRule, 'id'>;
}
