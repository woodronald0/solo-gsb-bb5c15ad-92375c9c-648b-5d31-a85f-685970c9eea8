import { useMemo } from 'react';
import type { AliasTable, MaskRule, PreviewResult } from '../types';

interface Props {
  table: AliasTable;
  rules: MaskRule[];
  preview: PreviewResult | null;
  onRename: (entityKey: string, alias: string) => void;
}

/**
 * 稳定化名映射表：列出全部已建映射（含已不在当前字幕中的历史实体），
 * 支持手动改名；改名随预览防抖立即联动所有未撤销命中。
 */
export function AliasPanel({ table, rules, preview, onRename }: Props) {
  const ruleName = useMemo(() => new Map(rules.map((r) => [r.id, r.name])), [rules]);
  const activeKeys = useMemo(
    () =>
      new Set(
        preview?.cues.flatMap((c) =>
          c.hits.map((h) => h.entityKey).filter((k): k is string => Boolean(k)),
        ) ?? [],
      ),
    [preview],
  );

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>化名表</h2>
        <span className="meta-row">{table.entries.length} 个实体映射</span>
      </header>
      <p className="hint">
        「稳定化名」模式的规则首次命中时，按 <code>规则 + NFKC 规范化原文</code> 建立持久映射，
        同一实体跨字幕共享同一编号；编号只增不减，增删字幕不会重排。
        在下方输入框改名会立即联动所有未撤销命中；留空则恢复默认「前缀+序号」。
      </p>
      {table.entries.length === 0 ? (
        <div className="empty-tip">
          暂无映射：将规则切换为「稳定化名」模式并出现命中后，会自动在此生成。
        </div>
      ) : (
        <ul className="alias-list">
          {table.entries.map((e) => {
            const active = activeKeys.has(e.entityKey);
            return (
              <li
                key={e.entityKey}
                className={`alias-row ${active ? '' : 'alias-inactive'}`}
                title={active ? undefined : '当前字幕中暂无该实体命中（映射仍保留）'}
              >
                <span className="alias-seq">#{e.seq}</span>
                <input
                  className="alias-input"
                  value={e.alias}
                  placeholder="前缀+序号"
                  spellCheck={false}
                  onChange={(ev) => onRename(e.entityKey, ev.target.value)}
                  title="手动改名，立即联动所有未撤销命中；留空恢复默认编号"
                />
                <span className="alias-source" title={`实体键：${e.entityKey}`}>
                  ← {e.source}
                </span>
                <span className="alias-rule">{ruleName.get(e.ruleId) ?? '已删规则'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
