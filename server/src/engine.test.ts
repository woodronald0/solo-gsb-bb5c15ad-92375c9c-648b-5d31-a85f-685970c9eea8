/** 引擎自测：node --import tsx src/engine.test.ts（通过 npm run test:engine 运行） */
import assert from 'assert';
import { buildPreview, exportResult, plainText } from './engine';
import { PRESETS, SAMPLE_VTT } from './presets';
import type { MaskRule } from './types';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function presetRule(name: string, override: Partial<MaskRule> = {}): MaskRule {
  const p = PRESETS.find((x) => x.rule.name === name)!;
  return { id: 'r-' + name, ...p.rule, ...override };
}

test('内联标签剥离与偏移映射', () => {
  const { text, map } = plainText('你好<00:00:01.000>世界<c.yellow>!</c>');
  assert.strictEqual(text, '你好世界!');
  assert.deepStrictEqual(map, [0, 1, 16, 17, 28]);
});

test('基础命中：手机号/邮箱/姓名', () => {
  const rules = [presetRule('手机号'), presetRule('邮箱'), presetRule('姓名')];
  const v = buildPreview({ vtt: SAMPLE_VTT, rules });
  assert.ok(v.totalHits >= 4, `应至少 4 个命中，实际 ${v.totalHits}`);
  const phone = v.cues[0].hits.find((h) => h.ruleName === '手机号')!;
  assert.strictEqual(phone.match, '13812345678');
  assert.strictEqual(phone.replacement, '138****5678');
  const name = v.cues[0].hits.find((h) => h.ruleName === '姓名')!;
  assert.strictEqual(name.match, '张伟');
  assert.strictEqual(name.replacement, '张*');
});

test('优先级合并：身份证(80) 吞并重叠的银行卡(75)', () => {
  const rules = [presetRule('身份证'), presetRule('银行卡')];
  const v = buildPreview({ vtt: SAMPLE_VTT, rules });
  // 18 位身份证数字同时落在银行卡 [16,19] 区间，两条规则在同一区间重叠
  const idCue = v.cues.find((c) => c.text.includes('110101'))!;
  assert.ok(idCue.suppressed.length >= 1, '应有被抑制命中');
  const sup = idCue.suppressed.find((s) => s.ruleName === '银行卡');
  assert.ok(sup, '银行卡应被身份证抑制（18 位重叠区间）');
  assert.strictEqual(sup!.winnerRuleName, '身份证');
});

test('19 位卡号不与身份证冲突，走银行卡规则', () => {
  const rules = [presetRule('身份证'), presetRule('银行卡')];
  const v = buildPreview({ vtt: SAMPLE_VTT, rules });
  const cardCue = v.cues.find((c) => c.text.includes('6222'))!;
  const bank = cardCue.hits.find((h) => h.ruleName === '银行卡');
  assert.ok(bank, '19 位卡号应由银行卡规则命中');
  assert.strictEqual(bank!.match, '6222021234567890123');
  assert.strictEqual(bank!.replacement, '6222********0123');
});

test('逐条撤销：key 稳定且导出恢复原文', () => {
  const rules = [presetRule('手机号')];
  const v1 = buildPreview({ vtt: SAMPLE_VTT, rules });
  const key = v1.cues[0].hits[0].key;
  const v2 = buildPreview({ vtt: SAMPLE_VTT, rules, revertedKeys: [key] });
  assert.strictEqual(v2.appliedHits, 1);
  assert.strictEqual(v2.revertedHits, 1);
  const ex = exportResult({ vtt: SAMPLE_VTT, rules, revertedKeys: [key] });
  assert.ok(!ex.vtt.includes('138****5678'), '撤销号码应保持原文');
  assert.ok(ex.vtt.includes('13812345678'));
  assert.ok(ex.vtt.includes('139****4321'), '未撤销号码应脱敏');
  assert.ok(ex.audit.records.some((r) => r.status === 'reverted'));
  assert.ok(ex.audit.records.some((r) => r.status === 'applied'));
});

test('时间轴/头部完整保留', () => {
  const vtt = 'WEBVTT\n\nNOTE\n这是备注\n\n00:00:01,000 --> 00:00:02,000  align:start\n电话 13812345678\n';
  const rules = [presetRule('手机号')];
  const ex = exportResult({ vtt, rules });
  assert.ok(ex.vtt.includes('NOTE'));
  assert.ok(ex.vtt.includes('00:00:01,000 --> 00:00:02,000  align:start'));
  assert.ok(ex.vtt.includes('电话 138****5678'));
  assert.strictEqual(ex.audit.source.cueCount, 1);
});

test('审计包含规则、原文区间与替换结果', () => {
  const rules = [presetRule('邮箱')];
  const ex = exportResult({ vtt: SAMPLE_VTT, rules });
  const rec = ex.audit.records.find((r) => r.rule.name === '邮箱')!;
  assert.strictEqual(rec.source.text, 'zhang.wei@example.com');
  assert.strictEqual(rec.replacement, '****@example.com');
  assert.strictEqual(typeof rec.source.start, 'number');
  assert.ok(rec.time.start && rec.time.end);
  assert.strictEqual(ex.audit.rules.length, 1);
  assert.ok(/^[a-f0-9]{64}$/.test(ex.audit.source.sha256));
});

test('非法正则在预览中报错而不崩溃', () => {
  const bad = { ...presetRule('手机号'), id: 'bad', pattern: '([0-9]+' };
  const v = buildPreview({ vtt: SAMPLE_VTT, rules: [bad] });
  assert.ok(v.parseErrors.some((e) => e.includes('bad')));
});

console.log(`\n引擎自测全部通过（${passed} 项）`);
