export interface MaskRule {
  id: string;
  name: string;
  pattern: string;
  flags: string;
  replacement: string;
  priority: number;
  enabled: boolean;
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
}

export interface JobState {
  jobId: string;
  vtt: string;
  rules: MaskRule[];
  revertedKeys: string[];
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
}

export interface AuditReport {
  app: string;
  version: number;
  generatedAt: string;
  source: { sha256: string; length: number; cueCount: number };
  rules: MaskRule[];
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
}

export interface Preset {
  name: string;
  description: string;
  rule: Omit<MaskRule, 'id'>;
}
