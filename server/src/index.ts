import express, { type Request, type Response } from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { buildPreview, emptyAliasTable, exportResult } from './engine';
import { PRESETS } from './presets';
import { JobStore } from './store';
import type { AliasEntry, AliasTable, JobState, MaskRule, PreviewInput } from './types';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const WEB_DIST =
  process.env.WEB_DIST ?? path.join(__dirname, '..', '..', 'web', 'dist');

const app = express();
app.use(express.json({ limit: '5mb' }));

const store = new JobStore(DATA_DIR);

/* ------------------------------ 校验 ------------------------------ */

function validateRules(rules: unknown): MaskRule[] | string {
  if (!Array.isArray(rules)) return 'rules 必须是数组';
  for (const r of rules) {
    if (r === null || typeof r !== 'object') return '存在非法规则';
    const rule = r as Record<string, unknown>;
    if (typeof rule.id !== 'string' || !rule.id) return '规则缺少 id';
    if (typeof rule.name !== 'string') return `规则 ${rule.id} 缺少名称`;
    if (typeof rule.pattern !== 'string') return `规则 ${rule.id} 缺少正则`;
    if (typeof rule.replacement !== 'string')
      return `规则 ${rule.id} 缺少替换模板`;
    if (typeof rule.flags !== 'string') return `规则 ${rule.id} flags 必须是字符串`;
    if (typeof rule.priority !== 'number') return `规则 ${rule.id} 优先级必须是数字`;
    if (typeof rule.enabled !== 'boolean') return `规则 ${rule.id} enabled 必须是布尔值`;
    if (rule.mode !== undefined && rule.mode !== 'template' && rule.mode !== 'alias')
      return `规则 ${rule.id} mode 必须是 template 或 alias`;
    if (rule.aliasPrefix !== undefined && typeof rule.aliasPrefix !== 'string')
      return `规则 ${rule.id} aliasPrefix 必须是字符串`;
    try {
      new RegExp(rule.pattern as string, rule.flags as string);
    } catch (e) {
      return `规则「${rule.name}」正则无效：${(e as Error).message}`;
    }
  }
  return rules as MaskRule[];
}

/** 校验化名映射表结构（持久化数据，字段缺失时按空表处理） */
function validateAliases(input: unknown): AliasTable | string {
  if (input === null || typeof input !== 'object') return 'aliases 必须是对象';
  const t = input as Partial<AliasTable>;

  const nextSeq: Record<string, number> = {};
  if (t.nextSeq !== undefined) {
    if (t.nextSeq === null || typeof t.nextSeq !== 'object' || Array.isArray(t.nextSeq))
      return 'aliases.nextSeq 必须是对象';
    for (const [k, v] of Object.entries(t.nextSeq)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 1)
        return `aliases.nextSeq[${k}] 必须是 ≥1 的数字`;
      nextSeq[k] = Math.floor(v);
    }
  }

  if (!Array.isArray(t.entries)) return 'aliases.entries 必须是数组';
  const entries: AliasEntry[] = [];
  for (const raw of t.entries) {
    if (raw === null || typeof raw !== 'object') return 'aliases.entries 存在非法条目';
    const e = raw as unknown as Record<string, unknown>;
    if (typeof e.entityKey !== 'string' || !e.entityKey) return '化名条目缺少 entityKey';
    if (typeof e.ruleId !== 'string') return `化名 ${e.entityKey} 缺少 ruleId`;
    if (typeof e.source !== 'string') return `化名 ${e.entityKey} 缺少 source`;
    if (typeof e.alias !== 'string') return `化名 ${e.entityKey} 缺少 alias`;
    if (typeof e.seq !== 'number' || !Number.isFinite(e.seq) || e.seq < 1)
      return `化名 ${e.entityKey} 的 seq 必须是 ≥1 的数字`;
    entries.push({
      entityKey: e.entityKey,
      ruleId: e.ruleId,
      source: e.source,
      seq: Math.floor(e.seq),
      alias: e.alias,
    });
  }
  return { nextSeq, entries };
}

function readPreviewBody(req: Request): PreviewInput {
  const { vtt, rules, revertedKeys, aliases } = req.body as Partial<PreviewInput>;
  if (typeof vtt !== 'string') {
    throw new Error('vtt 必须是字符串');
  }
  const checked = validateRules(rules);
  if (typeof checked === 'string') throw new Error(checked);
  let aliasTable = emptyAliasTable();
  if (aliases !== undefined) {
    const checkedAliases = validateAliases(aliases);
    if (typeof checkedAliases === 'string') throw new Error(checkedAliases);
    aliasTable = checkedAliases;
  }
  return {
    vtt,
    rules: checked,
    revertedKeys: Array.isArray(revertedKeys)
      ? (revertedKeys as string[]).filter((k) => typeof k === 'string')
      : [],
    aliases: aliasTable,
  };
}

/* ------------------------------ 路由 ------------------------------ */

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/presets', (_req, res) => {
  res.json({ presets: PRESETS });
});

/** 恢复上次任务（刷新 / 重启后）；兼容旧版无化名表的存档 */
app.get('/api/job', (_req, res) => {
  const job = store.get();
  res.json({ job: job ? { ...job, aliases: job.aliases ?? emptyAliasTable() } : null });
});

/** 自动保存编辑中的任务 */
app.put('/api/job', (req, res) => {
  const { vtt, rules, revertedKeys, aliases } = req.body as Partial<JobState>;
  if (typeof vtt !== 'string') return res.status(400).json({ error: 'vtt 必须是字符串' });
  const checked = validateRules(rules);
  if (typeof checked === 'string') return res.status(400).json({ error: checked });
  if (!Array.isArray(revertedKeys))
    return res.status(400).json({ error: 'revertedKeys 必须是数组' });

  const previous = store.get();
  let aliasTable = previous?.aliases ?? emptyAliasTable();
  if (aliases !== undefined) {
    const checkedAliases = validateAliases(aliases);
    if (typeof checkedAliases === 'string')
      return res.status(400).json({ error: checkedAliases });
    aliasTable = checkedAliases;
  }

  const state: JobState = {
    jobId: previous?.jobId ?? randomUUID(),
    vtt,
    rules: checked,
    revertedKeys: revertedKeys.filter((k) => typeof k === 'string'),
    aliases: aliasTable,
    updatedAt: new Date().toISOString(),
  };
  store.save(state);
  res.json({ job: state });
});

/** 计算替换预览（合并优先级重叠，标记撤销态，建立稳定化名映射） */
app.post('/api/preview', (req, res) => {
  try {
    const input = readPreviewBody(req);
    res.json(buildPreview(input));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** 确认导出：新 VTT + JSON 审计报告 */
app.post('/api/export', (req, res) => {
  try {
    const input = readPreviewBody(req);
    const result = exportResult({
      ...input,
      jobId: store.get()?.jobId ?? randomUUID(),
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/* ---------------------------- 静态资源 ---------------------------- */

app.use(express.static(WEB_DIST));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
    if (err) next(err);
  });
});

/* ------------------------------ 启动 ------------------------------ */

async function main(): Promise<void> {
  await store.init();
  app.listen(PORT, () => {
    console.log(`字幕脱敏审校台已启动: http://localhost:${PORT}`);
    console.log(`数据目录: ${DATA_DIR}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// 退出前落盘
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.flush().finally(() => process.exit(0));
  });
}
