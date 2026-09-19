import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { AliasTable, ExportResult, MaskRule, Preset, PreviewResult } from './types';
import { emptyAliasTable, uid, unionAliasTables } from './utils';
import { SAMPLE_VTT } from './sample';
import { VttInput } from './components/VttInput';
import { RulesPanel } from './components/RulesPanel';
import { AliasPanel } from './components/AliasPanel';
import { Preview } from './components/Preview';
import { ExportModal } from './components/ExportModal';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function App() {
  const [vtt, setVtt] = useState('');
  const [rules, setRules] = useState<MaskRule[]>([]);
  const [revertedKeys, setRevertedKeys] = useState<string[]>([]);
  const [aliases, setAliases] = useState<AliasTable>(emptyAliasTable());
  const [presets, setPresets] = useState<Preset[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [exportData, setExportData] = useState<ExportResult | null>(null);

  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------- 启动：拉预设 + 恢复上次任务 ------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ presets: ps }, { job }] = await Promise.all([
          api.presets(),
          api.getJob(),
        ]);
        if (!alive) return;
        setPresets(ps);
        if (job && (job.vtt || job.rules.length > 0)) {
          setVtt(job.vtt);
          setRules(job.rules);
          setRevertedKeys(job.revertedKeys ?? []);
          setAliases(job.aliases ?? emptyAliasTable());
          setUpdatedAt(job.updatedAt);
        } else {
          // 首次使用：加载预设（全部预置，按 enabled 字段决定启用）
          setRules(ps.map((p) => ({ id: uid(), ...p.rule })));
        }
      } catch (e) {
        setError(`初始化失败：${(e as Error).message}`);
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ------------- 防抖计算预览（300ms），并回收新建的稳定化名映射 ------------- */
  useEffect(() => {
    if (!hydrated) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (!vtt.trim()) {
      setPreview(null);
      return;
    }
    setLoading(true);
    previewTimer.current = setTimeout(async () => {
      try {
        const p = await api.preview(vtt, rules, revertedKeys, aliases);
        // 服务端只追加映射；并集合并保留本地手动改名，无变化时保持原引用
        setAliases((prev) => unionAliasTables(prev, p.aliases));
        setPreview(p);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [vtt, rules, revertedKeys, aliases, hydrated]);

  /* ------------- 防抖自动保存（800ms），刷新可恢复 ------------- */
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(async () => {
      try {
        const { job } = await api.saveJob(vtt, rules, revertedKeys, aliases);
        setUpdatedAt(job.updatedAt);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [vtt, rules, revertedKeys, aliases, hydrated]);

  /* ------------- 撤销 / 应用 ------------- */
  const toggleHit = useCallback(
    (key: string) => {
      setRevertedKeys((keys) =>
        keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
      );
    },
    [],
  );
  const revertAll = useCallback(() => {
    if (!preview) return;
    setRevertedKeys(preview.cues.flatMap((c) => c.hits.map((h) => h.key)));
  }, [preview]);
  const applyAll = useCallback(() => setRevertedKeys([]), []);

  /* 手动改名：更新映射表，预览防抖会立即联动所有未撤销命中 */
  const renameAlias = useCallback((entityKey: string, alias: string) => {
    setAliases((t) => ({
      ...t,
      entries: t.entries.map((e) => (e.entityKey === entityKey ? { ...e, alias } : e)),
    }));
  }, []);

  /* 规则变更后，清除已不存在的撤销项（key 由 cue 序号+区间+规则决定，天然稳定） */
  useEffect(() => {
    if (!preview) return;
    const valid = new Set(preview.cues.flatMap((c) => c.hits.map((h) => h.key)));
    setRevertedKeys((keys) => keys.filter((k) => valid.has(k)));
  }, [preview]);

  /* ------------- 导出 ------------- */
  const doExport = async () => {
    if (!vtt.trim()) return;
    try {
      const result = await api.export(vtt, rules, revertedKeys, aliases);
      setAliases((prev) => unionAliasTables(prev, result.aliases));
      setExportData(result);
    } catch (e) {
      setError(`导出失败：${(e as Error).message}`);
    }
  };

  const saveLabel = {
    idle: '',
    saving: '保存中…',
    saved: updatedAt ? `已自动保存 ${new Date(updatedAt).toLocaleTimeString()}` : '已保存',
    error: '保存失败',
  }[saveState];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🛡</span>
          <div>
            <h1>字幕脱敏审校台</h1>
            <p>WebVTT 本机正则脱敏 · 优先级合并 · 逐条撤销 · 审计导出</p>
          </div>
        </div>
        <div className="topbar-right">
          <span className={`save-state save-${saveState}`}>{saveLabel}</span>
          <button className="btn btn-primary btn-lg" onClick={doExport} disabled={!vtt.trim()}>
            ④ 确认并导出
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner-error" onClick={() => setError(null)}>
          ✕ {error}（点击关闭）
        </div>
      )}

      {!hydrated && <div className="loading-screen">正在加载本地任务…</div>}

      <main className="layout">
        <div className="col col-left">
          <VttInput
            vtt={vtt}
            onChange={setVtt}
            onLoadSample={() => setVtt(SAMPLE_VTT)}
            onClear={() => setVtt('')}
          />
          <RulesPanel rules={rules} presets={presets} onChange={setRules} />
          {(rules.some((r) => r.mode === 'alias') || aliases.entries.length > 0) && (
            <AliasPanel
              table={aliases}
              rules={rules}
              preview={preview}
              onRename={renameAlias}
            />
          )}
        </div>
        <div className="col col-right">
          <Preview
            preview={preview}
            loading={loading}
            onToggleHit={toggleHit}
            onRevertAll={revertAll}
            onApplyAll={applyAll}
          />
        </div>
      </main>

      <footer className="footer">
        所有数据仅在本机处理与存储（server/data/job.json），不会上传任何外部服务。
      </footer>

      {exportData && (
        <ExportModal
          vtt={exportData.vtt}
          audit={exportData.audit}
          onClose={() => setExportData(null)}
        />
      )}
    </div>
  );
}
