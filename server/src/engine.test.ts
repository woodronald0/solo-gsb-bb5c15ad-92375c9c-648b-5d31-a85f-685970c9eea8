/** 引擎自测：node --import tsx src/engine.test.ts（通过 npm run test:engine 运行） */
import assert from 'assert';
import { buildPreview, exportResult, plainText } from './engine';
import { PRESETS, SAMPLE_VTT } from './presets';
import type { AliasTable, MaskRule } from './types';

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

/* ---------------- 稳定化名模式 ---------------- */

function aliasRule(id: string, pattern: string, prefix: string, priority = 10): MaskRule {
  return {
    id,
    name: id,
    pattern,
    flags: 'g',
    replacement: '',
    mode: 'alias',
    aliasPrefix: prefix,
    priority,
    enabled: true,
  };
}

function vttOf(...payloads: string[]): string {
  const cues = payloads.map(
    (p, i) =>
      `00:00:${String(i * 2).padStart(2, '0')}.000 --> 00:00:${String(i * 2 + 1).padStart(2, '0')}.000\n${p}`,
  );
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

test('稳定化名：同实体跨 cue 共享编号，新实体按首现顺序分配', () => {
  const rules = [aliasRule('r-name', '张伟|李四', '用户')];
  const v = buildPreview({ vtt: vttOf('张伟先到这里', '李四和张伟都在'), rules });
  const [c0, c1] = v.cues;
  assert.strictEqual(c0.hits[0].replacement, '用户1');
  const li = c1.hits.find((h) => h.match === '李四')!;
  const zhang = c1.hits.find((h) => h.match === '张伟')!;
  assert.strictEqual(li.replacement, '用户2');
  assert.strictEqual(zhang.replacement, '用户1', '同一实体跨 cue 必须用同一编号');
  assert.strictEqual(zhang.entityKey, c0.hits[0].entityKey);
  assert.deepStrictEqual(
    v.aliases.entries.map((e) => [e.source, e.seq, e.alias]),
    [
      ['张伟', 1, '用户1'],
      ['李四', 2, '用户2'],
    ],
  );
  assert.strictEqual(v.aliases.nextSeq['r-name'], 3);
});

test('稳定化名：NFKC 与去首尾空白归一为同一实体', () => {
  const rules = [
    aliasRule('r-num', '[0-9０-９]{3}', '号码'),
    aliasRule('r-name', '张三\\s*', '用户'),
  ];
  const v = buildPreview({
    vtt: vttOf('半角123与张三  来了', '全角１２３，是张三吗'),
    rules,
  });
  const nums = v.cues.flatMap((c) => c.hits.filter((h) => h.ruleId === 'r-num'));
  const names = v.cues.flatMap((c) => c.hits.filter((h) => h.ruleId === 'r-name'));
  assert.strictEqual(nums.length, 2);
  assert.strictEqual(names.length, 2);
  assert.ok(nums.every((h) => h.replacement === '号码1'), '全角/半角数字应归一为同一实体');
  assert.ok(names.every((h) => h.replacement === '用户1'), '首尾空白应归一为同一实体');
  assert.strictEqual(v.aliases.entries.length, 2);
});

test('稳定化名：映射持久，增删字幕不重排已有编号', () => {
  const rules = [aliasRule('r-name', '张三|李四|王五', '用户')];
  const first = buildPreview({ vtt: vttOf('张三先到', '李四随后'), rules });
  assert.strictEqual(first.aliases.entries.length, 2);

  // 删除张三所在 cue、新增王五 cue，沿用上次映射表
  const second = buildPreview({
    vtt: vttOf('李四随后', '王五最后到'),
    rules,
    aliases: first.aliases,
  });
  const li = second.cues[0].hits[0];
  const wang = second.cues[1].hits[0];
  assert.strictEqual(li.replacement, '用户2', '已有实体编号不得重排');
  assert.strictEqual(wang.replacement, '用户3', '新实体应使用未占用的下一序号');
  assert.strictEqual(second.aliases.entries.length, 3);
});

test('稳定化名：手动改名立即联动未撤销命中，撤销语义不变', () => {
  const rules = [aliasRule('r-name', '张伟', '用户')];
  const vtt = vttOf('张伟先到', '张伟又到');
  const first = buildPreview({ vtt, rules });
  const renamed: AliasTable = {
    nextSeq: first.aliases.nextSeq,
    entries: first.aliases.entries.map((e) => ({ ...e, alias: '甲方' })),
  };
  // 撤销第二条命中
  const revertKey = first.cues[1].hits[0].key;
  const second = buildPreview({ vtt, rules, revertedKeys: [revertKey], aliases: renamed });
  assert.strictEqual(second.cues[0].hits[0].replacement, '甲方');
  assert.strictEqual(second.cues[1].hits[0].replacement, '甲方');
  assert.ok(second.cues[1].hits[0].reverted);

  const ex = exportResult({ vtt, rules, revertedKeys: [revertKey], aliases: renamed });
  assert.ok(ex.vtt.includes('甲方先到'), '未撤销命中应用新化名');
  assert.ok(ex.vtt.includes('张伟又到'), '已撤销命中恢复原文');
  const rec = ex.audit.records.find((r) => r.status === 'reverted')!;
  assert.strictEqual(rec.alias, '甲方');
});

test('稳定化名：审计持久化映射并记录实体键/最终化名/状态', () => {
  const rules = [aliasRule('r-name', '张伟', '用户')];
  const ex = exportResult({ vtt: vttOf('张伟先到', '张伟又到'), rules });
  assert.strictEqual(ex.audit.version, 2);
  assert.deepStrictEqual(
    ex.audit.aliases.map((e) => [e.entityKey, e.source, e.seq, e.alias]),
    [['r-name:张伟', '张伟', 1, '用户1']],
  );
  for (const r of ex.audit.records) {
    assert.strictEqual(r.entityKey, 'r-name:张伟');
    assert.strictEqual(r.alias, '用户1');
    assert.strictEqual(r.status, 'applied');
  }
  // 导出返回的化名表可直接用于下一次预览（幂等，不重复分配）
  const again = buildPreview({ vtt: vttOf('张伟先到'), rules, aliases: ex.aliases });
  assert.strictEqual(again.aliases.entries.length, 1);
});

test('稳定化名：重叠优先级语义不变，被抑制命中不分配编号', () => {
  const rules = [
    aliasRule('r-long', '13812345678', '电话', 50),
    aliasRule('r-short', '1381234', '号码', 90),
  ];
  const vtt = vttOf('手机13812345678在用');
  const v = buildPreview({ vtt, rules });
  assert.strictEqual(v.suppressedHits, 1);
  assert.strictEqual(v.cues[0].hits.length, 1);
  assert.strictEqual(v.cues[0].hits[0].ruleId, 'r-short', '高优先级命中胜出');
  assert.strictEqual(v.cues[0].hits[0].replacement, '号码1');
  assert.ok(
    v.aliases.entries.every((e) => e.ruleId === 'r-short'),
    '被抑制命中不得建立映射',
  );

  const ex = exportResult({ vtt, rules });
  const sup = ex.audit.records.find((r) => r.status === 'suppressed')!;
  assert.strictEqual(sup.rule.id, 'r-long');
  assert.strictEqual(sup.entityKey, 'r-long:13812345678');
  assert.strictEqual(sup.alias, undefined, '未建映射的抑制记录不带化名');
});

console.log(`\n引擎自测全部通过（${passed} 项）`);
