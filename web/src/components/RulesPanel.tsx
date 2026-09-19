import { useState } from 'react';
import type { MaskRule, Preset, ReplaceMode } from '../types';
import { uid, validateRegex } from '../utils';

interface Props {
  rules: MaskRule[];
  presets: Preset[];
  onChange: (rules: MaskRule[]) => void;
}

export function RulesPanel({ rules, presets, onChange }: Props) {
  const [openId, setOpenId] = useState<string | null>(rules[0]?.id ?? null);

  const update = (id: string, patch: Partial<MaskRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(rules.filter((r) => r.id !== id));
  const addBlank = () => {
    const r: MaskRule = {
      id: uid(),
      name: '新规则',
      pattern: '',
      flags: 'g',
      replacement: '***',
      mode: 'template',
      priority: 10,
      enabled: true,
    };
    onChange([...rules, r]);
    setOpenId(r.id);
  };
  const addPreset = (p: Preset) => {
    const r: MaskRule = { id: uid(), ...p.rule };
    onChange([...rules, r]);
    setOpenId(r.id);
  };

  const availablePresets = presets.filter(
    (p) => !rules.some((r) => r.name === p.rule.name && r.pattern === p.rule.pattern),
  );

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>② 脱敏规则</h2>
        <div className="panel-actions">
          <select
            className="preset-select"
            value=""
            onChange={(e) => {
              const p = presets.find((x) => x.name === e.target.value);
              if (p) addPreset(p);
            }}
          >
            <option value="">+ 添加预设…</option>
            {availablePresets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={addBlank}>
            + 自定义规则
          </button>
        </div>
      </header>

      <p className="hint">
        数值越大优先级越高；重叠命中由高优先级（同优先级取更长匹配）吞并，被吞并项仅进入审计。
        替换支持 <code>$1</code>、<code>$&amp;</code>、<code>$KEEP:3</code>、
        <code>$MASKALL</code>、<code>$RULE</code>；或切换为「稳定化名」模式，
        让同一实体全片统一为「前缀+序号」化名。
      </p>

      <ul className="rule-list">
        {rules.length === 0 && <li className="empty-tip">暂无规则，请从预设添加或自定义。</li>}
        {rules.map((r) => {
          const err = r.enabled ? validateRegex(r.pattern, r.flags) : null;
          const open = openId === r.id;
          const mode = r.mode ?? 'template';
          return (
            <li key={r.id} className={`rule-item ${r.enabled ? '' : 'disabled'}`}>
              <div className="rule-row">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => update(r.id, { enabled: e.target.checked })}
                  title="启用 / 停用"
                />
                <button className="rule-name" onClick={() => setOpenId(open ? null : r.id)}>
                  <span className="pri-badge" title="优先级">
                    {r.priority}
                  </span>
                  {r.name}
                  {mode === 'alias' && (
                    <span className="mode-badge" title="稳定化名模式：同一实体全片同一编号化名">
                      化名
                    </span>
                  )}
                  {err && <span className="rule-err-dot" title={err}>!</span>}
                  <span className="caret">{open ? '▾' : '▸'}</span>
                </button>
                <button className="btn btn-mini btn-danger" onClick={() => remove(r.id)}>
                  删除
                </button>
              </div>
              {open && (
                <div className="rule-detail">
                  <label>
                    规则名称
                    <input
                      value={r.name}
                      onChange={(e) => update(r.id, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    正则（不含 /）
                    <input
                      className="mono"
                      spellCheck={false}
                      value={r.pattern}
                      onChange={(e) => update(r.id, { pattern: e.target.value })}
                    />
                  </label>
                  {err && <div className="rule-err">正则无效：{err}</div>}
                  <div className="rule-grid">
                    <label>
                      标志
                      <input
                        className="mono"
                        value={r.flags}
                        onChange={(e) => update(r.id, { flags: e.target.value })}
                      />
                    </label>
                    <label>
                      优先级
                      <input
                        type="number"
                        value={r.priority}
                        onChange={(e) => update(r.id, { priority: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  <label>
                    替换模式
                    <select
                      value={mode}
                      onChange={(e) => update(r.id, { mode: e.target.value as ReplaceMode })}
                    >
                      <option value="template">固定模板</option>
                      <option value="alias">稳定化名</option>
                    </select>
                  </label>
                  {mode === 'alias' ? (
                    <>
                      <label>
                        化名前缀（自动命名为「前缀+序号」，如 用户1）
                        <input
                          value={r.aliasPrefix ?? ''}
                          placeholder="用户"
                          onChange={(e) => update(r.id, { aliasPrefix: e.target.value })}
                        />
                      </label>
                      <p className="hint">
                        同一实体（NFKC 规范化原文）跨字幕共享同一编号化名，编号持久不重排；
                        命中后可在下方「化名表」中手动改名。
                      </p>
                    </>
                  ) : (
                    <label>
                      替换模板
                      <input
                        className="mono"
                        value={r.replacement}
                        onChange={(e) => update(r.id, { replacement: e.target.value })}
                      />
                    </label>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
