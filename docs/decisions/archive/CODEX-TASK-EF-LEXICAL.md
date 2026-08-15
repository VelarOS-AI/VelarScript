# Codex 任务书 —— 批次 E/F：词法大波（规格全部已批，执行不重设计）

先读 `.claude/agents/ops.md` 的十条常备纪律，全部适用（规格权威、禁 git 写、
门禁三连、报告格式、快照技术、设计问题留档）。

## 必读规格（按序）

1. `docs/decisions/D46-BACKTICK-STRINGS.md` —— 反引号字符串完整规格
2. `docs/decisions/D47-MORNING-RULINGS.md` 第 82 条 —— `\u{...}` 转义 + 双向字符禁令
3. `docs/decisions/D30-LEXICAL-AUDIT.md` —— 第 17 条（纯表达式语句）、第 18.4
   条（前导零）、第 20 条（比较链限定）、数字分隔符
4. `docs/decisions/D36-CHAIN-ATTRS-BIDI.md` 第 40.1 条 —— `/* */` 块注释
5. `docs/decisions/archive/COMPLETENESS-AUDITS.md` 审计六（TXT-I3）与审计十一（GRM-A1/
   A2/D2/D3、T-6）—— 期望行为的实测口径

## 协调（关键，先看这个）

- **永久禁区**：`packages/web/src/**`（N-2c 在途）、CHANGELOG.md、HANDOFF.md、
  docs/handoff/**（报告文件除外）。
- **共享文件延迟规则**：`docs/language-charter.md`、`docs/web-api.md`、
  `docs/ai-skill.md` + `packages/cli/skill/ai-skill.md`、`tests/compiler.test.ts`、
  `examples/**` 可能被 N-2c 同时修改。**动它们之前先看 `git status`**：若
  `packages/web/` 下仍有未提交修改（N-2c 未落地），**不要碰这些文件**——把
  待做的编辑逐条列进报告的「Deferred shared-file edits」一节；若树已干净
  （编排方已提交 N-2c），照常编辑。实现与新测试文件**不受此限制，立刻开工**。
- 若因延迟共享编辑导致门禁无法全绿，报告里写明确切的失败钉与原因——这不算
  任务失败，算按协调规则交付。

## 任务项

**A. 反引号字符串（D46 全套）**
1. `` `...` `` 与 `"..."` 语义相同、串内 `"` 免转义、`` \` `` 转义字面反引号；
   前缀正交（`f`/`r`/`rf` × 两种引号全组合）；`${` 是字面文本（零诊断）；
   裸换行 → 既有布局串教学；单引号维持拒绝；替换现有「反引号→教布局串」。
2. **格式化器典章规则**：默认 `"..."`；串含 `"` 不含 `` ` `` → 反引号；两者
   都含 → 转义少者、平手取 `"..."`。velar format 按此归一（Black 同构）。

**B. 转义与源文件卫生（D47 第 82 条全套）**
3. `\u{1-6 位十六进制}`：产出码点；拒 > 0x10FFFF；**拒 D800-DFFF**；
   `\uXXXX` 无花括号与 `\xNN` → 教花括号形。
4. **双向控制字符（U+202A-202E、U+2066-2069）源文件全文禁裸**（字符串、注释、
   一切位置）——进字符串唯一途径是 `\u{...}`。Cc 控制字符（NUL、DEL、
   U+0080-009F）字面量内禁裸、教转义。**明确不禁**：ZWJ（U+200D）、变体
   选择符（U+FE0F）——emoji 构成字符；ZWSP 暂不禁。
5. 顺带迁移实证痛点：原 stdlib javascript.vel 的裸 U+0080 现居
   `packages/script-analysis/src/index.vel` —— 改写为 `\u{80}`。
6. TXT-I3：`\'` 在 `"..."` 内接受（双亲一致）。

**C. 数字字面量（D30 + 审计十一 T-6）**
7. 数字分隔符 `1_000`：仅数字之间、不得前导/尾随/连续；`1_000.5`、`1e1_0`
   合法性按同规则。
8. 前导零 `007` 拒绝（双亲一致）+ 教学。
9. T-6 定向消息批：`0xFF`/`0b101`/`0o17` → 「十六进制/二进制/八进制字面量
   不存在，写十进制」（替换误导的 Unknown numeric unit）；`.5` → 教 `0.5`；
   `5.` → 教 `5.0`；`Infinity`/`NaN` 裸名 → 「无字面量；由运算产生
   （如 1/0）；NaN 用 `value.isNaN()` 检测」。

**D. 语句纯度与比较链（D30 第 17/20 条 + GRM-A1/A2/D2）**
10. **纯表达式语句拒绝**：`x == 5`、裸 `42`、裸标识符、`a + b`、`a ?? 5`、
    三元、`values[0]`、`[1, 2]`、`-x`、`not x`、裸字符串（Python docstring
    习惯着陆点——定向教 `//` 注释）。语句头堆叠一元 `+`/`-`（`++i` 解析形）
    并入。已有豁免不动：调用、await、赋值、`async` 语句；VEL4029/4027 族
    不回归。**迁移**：全仓扫描（预期极少）。
11. **比较链限定**：仅同向链（`a < b <= c` 合法）；`==`/`!=` **永不链**
    （`a == b == c` → 教 split with 'and'）；混向链拒绝；`in`/`is` 作其他
    比较层运算符的操作数必须加括号（GRM-A2，同教 split with 'and'）。
    这杀掉全审计最高风险歧义（Python 链读法 vs JS 两两读法静默相反）。
12. `not x in y` → 既有 D30 第 19 条指引「Use 'x not in y'」落地。

**E. 块注释（D36 第 40.1 条）**
13. `/* */` 按已批规格：支持嵌套、行纪律（规格里有）；`/*` 当前的裸报错
    被真实实现替换。

## 测试与门禁

- 新测试进 `tests/hardening-lexical.test.ts`，执行级（字面量的运行值、拒绝的
  逐字消息、格式化器归一前后对照、块注释嵌套、比较链两读法的杀死证明——
  `a == b == c` 三 false 之前打 true、之后编译拒绝）。
- 门禁三连（`npm run check` / `npm test` / `npm run test:browser`，超时
  600000ms，desktop-worker 挂 10 分钟即杀掉干净重跑一次）。

## 交付

工作留树未提交 + 报告写到 `docs/decisions/archive/CODEX-REPORT-EF.md`：逐项修复与测试名、
迁移清单、**Deferred shared-file edits 一节**（若适用）、规格与代码出入
（报告不擅裁）、门禁三段原样尾部。
