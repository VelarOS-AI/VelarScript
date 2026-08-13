# Codex 报告 —— 批次 E/F：词法大波

## 结论

批次 E/F 的 Core 实现、新执行级回归和非共享迁移已经完成，工作留在树中，未提交、
未暂存、未推送。任务书列为永久禁区的 `packages/web/src/**` 没有被本任务修改。

EF 定向回归为 43/43 通过；受任务书的共享文件延迟规则和当前 N-2c 并行改动影响，
三道全量门禁没有全绿。最终快照中 `packages/web/src/**` 仍有未提交修改，且共享的
charter、AI skill、Web API 和 `tests/compiler.test.ts` 也已经出现并行改动，因此本任务
没有碰这些共享文件。确切待办和门禁失败钉见下文。

## 逐项修复与测试

### A. 反引号字符串与格式化器典章

**根因**：Core 的普通字符串、插值字符串和格式化器分别维护引号/转义逻辑；反引号
仍走旧的“教布局串”分支，嵌套插值扫描也不认识嵌套块注释。

**修复**：

- 普通、`f`、`r`、`rf`/`fr` 字符串现在都支持双引号与反引号；单引号继续定向拒绝。
- 反引号内 `"` 不需要转义，`\`` 产生字面反引号；插值串内 `${` 保持字面文本。
- 反引号字符串的裸换行使用布局串教学；`rf`/`fr` 与引号选择正交。
- `scanStringEscape` 成为普通/插值字符串的共享转义 owner；嵌套插值表达式会跳过
  嵌套块注释。
- 格式化器按语义块选择分隔符：默认双引号；只含双引号时用反引号；两者都含时
  选转义更少者，平手取双引号。表达式块不做文本重写，格式化幂等。

**测试**：

- `[D46 80] backtick strings share plain, interpolated, raw, and raw-interpolated semantics`
- `[D46 80] f-backticks keep JavaScript template syntax literal while Velar interpolation stays explicit`
- `[D46 80] inline newline and single-quote reflexes retain directed diagnostics`
- `[D46 80] formatter chooses the delimiter with fewer escapes and is idempotent`
- `[D46 80] backtick strings are accepted in JSX attribute and Look expression positions`

### B. Unicode 转义与源文件卫生

**根因**：旧扫描器只拥有少量简单转义，没有一个同时服务普通/插值字符串的 Unicode
码点 owner；双向控制字符也没有覆盖注释与所有源位置的全文入口检查。

**修复**：

- 实现 `\u{1..6 hex}`，拒绝超出 U+10FFFF 和 UTF-16 surrogate 区间；`\uXXXX`
  与 `\xNN` 定向教花括号形式。
- 在最外层 lexer 做一次全文 bidi hygiene 扫描，禁止裸 U+202A–U+202E、
  U+2066–U+2069；嵌套 lexer 关闭重复扫描，保证一处源码只报一次。
- 字符串内禁止裸 C0（物理换行由字符串规则单独处理）、DEL、U+0080–U+009F，
  教 `\u{...}`；ZWJ、变体选择符和 ZWSP 不受影响。
- `\'` 在双引号和反引号字符串中都接受；raw 字符串继续不解释转义。

**测试**：

- `[D47 82/TXT-I3] Unicode escapes execute across delimiters and apostrophe escapes are accepted`
- `[D47 82] invalid Unicode escape forms receive one exact teaching message`
- `[D47 82] bidi controls are forbidden everywhere and escaped bidi text remains available`
- `[D47 82] literal controls are visible escapes while emoji joiners and selectors stay legal`

### C. 数字字面量

**根因**：数字 token 扫描没有统一验证下划线位置，前导零、radix reflex、点开头/结尾
小数和扩展 unit 后缀之间也没有清晰 owner，导致部分输入落入 Unknown numeric unit。

**修复**：

- 支持 `1_000`、`1_000.5`、`1e1_0`，只允许下划线位于两位数字之间；token 值
  在 emitter 前去除分隔符。
- `007`、`0xFF`、`0b101`、`0o17`、`.5`、`5.`、裸 `Infinity`/`NaN` 都有
  任务书要求的定向消息。
- Core 数字扫描与扩展词法 unit 后缀继续组合，`1_000px` 由 Web extension 接管。

**测试**：

- `[D30 18/T-6] separated decimal literals execute and invalid literal reflexes are directed`
- `[D30 18] numeric separators compose with extension-owned unit suffixes`

### D. 纯表达式语句与比较链

**根因**：Analyzer 过去允许任意表达式占一条语句；Parser 又把所有连续比较都建成
同一种链，导致 equality 链与混向 ordered 链保留 Python/JavaScript 两种相反读法。

**修复**：

- 新增 VEL4030，拒绝裸比较、字面量、标识符、二元/空值合并/三元、索引、集合、
  一元值和裸字符串；字符串定向教 `//`，比较定向教赋值/使用结果，`++i`/`--i`
  教 `+= 1`/`-= 1`。
- 调用、赋值、`await`、`async` 保持合法；Promise 仍由 VEL4027 独占，已证明纯方法
  仍只报 VEL4029。
- 只允许 `<`/`<=` 同向上升链和 `>`/`>=` 同向下降链；equality 多链、混向链、
  未分组的 `in`/`is` 复合都定向要求 `and` 或括号。
- `not x in y` 恢复为 `x not in y` 形状并给既定教学；AST 记录显式括号，避免把
  用户已经分组的 membership/type test 误判。

**测试**：

- `[D30 17/GRM-D2] pure expression statements are rejected while effect shapes retain their owners`
- `[D30 20/GRM-A1] only one-way ordered comparison chains survive`
- `[D30 20/GRM-A2] membership and type tests require grouping inside comparisons`
- `[D30 19] prefix-not membership teaches the natural negative operator`

### E. 嵌套块注释

**根因**：`/*` 仍是裸错误，没有深度计数，也没有多行开闭行纪律；格式化器无法可靠
保留/重缩进嵌套块。

**修复**：lexer 使用深度计数读取 `/* ... */`，支持嵌套、unterminated 定向错误和
多行 opening/closing whole-line 纪律；格式化器把完整嵌套块作为一个结构单元保存并
随所属 block 重缩进，inline 块注释仍可位于表达式中。

**测试**：

- `[D36 40.1] block comments nest, preserve layout, and enforce multiline line discipline`

## 迁移清单

- `packages/script-analysis/src/index.vel`：裸 U+0080 改为 `\u{80}`；同一文件经新
  典章格式化后有一处仅含双引号内容的字符串改用反引号。
- `tests/hardening-language.test.ts`：`\x` 归入 Unicode 花括号教学；布局串的语义
  tab 改为显式 `\t`，保留结构性 tab margin；旧混向比较样例改为期待拒绝。
- `tests/hardening-nan-semantics.test.ts`：`a == b == c` 改写为
  `a == b and b == c`，并更新 SameValueZero emission 断言。
- `tests/hardening-reactivity.test.ts` 与 `tests/hardening-web-syntax.test.ts`：浏览器
  测试夹具中的单引号字符串改为反引号或 `\u{22}` 形式；定向浏览器回归 10/10。
- `docs/best-practices.md`：补充 effect-only 表达式语句与比较链写法。
- 非 Web、非 `examples/**` 的生产 `.vel` 扫描没有发现需要迁移的纯表达式语句。
  `examples/**` 按共享文件延迟规则留到协调后扫描/格式化。

## Deferred shared-file edits

最终快照中 `packages/web/src/**` 仍有 N-2c 未提交修改；同时下列共享文件已有并行
改动。本任务依任务书没有触碰它们，待 N-2c 落地后应按当时 HEAD 重新应用：

1. `docs/language-charter.md`
   - 把“单/双引号等价”和反引号缺席的旧说明改为 D46 典章；补普通/`f`/`r`/`rf`
     组合、`${` 字面文本和裸换行教学。
   - 补 `\u{...}`、bidi/Cc hygiene、数字分隔符/前导零/T-6、effect-only 语句、
     comparison chain 限定及嵌套块注释。
2. `docs/ai-skill.md` 与 `packages/cli/skill/ai-skill.md`
   - 两份必须镜像更新；当前 trap row 仍写“backtick strings”不存在，应改为新典章，
     并补数字/比较/纯表达式/块注释的 AI 易错点。
3. `tests/compiler.test.ts`
   - 单引号插值夹具改为双引号/反引号；旧 legacy-backtick 教布局串断言改为执行值。
   - equality 链 facts/执行测试拆成 `and`；混向 formatter 样例不再作为可编译程序。
   - `.5` 的旧 VEL2002 断言改为 VEL1007 教 `0.5`；接受 VEL4030 后重新审阅旧
     recovered-guidance 的诊断数断言（`delete`、hex colour、invalid annotation 等）。
4. `examples/standard-library.vel`
   - 新典章格式化把 JSON 字符串从转义双引号改为反引号；这是 `check:format` 的
     当前唯一 EF 失败钉。
5. `examples/**`
   - N-2c 落地后再做全仓 format/compile 扫描；当前 `production-web`、`todo`、
     `api-dashboard` 的 Look 诊断来自并行 Web 规则，不能由 EF 批次越界处理。

`docs/web-api.md` 没有 EF 必需新增项；它也处于并行修改状态，保持不动。

## 规格与代码出入

1. 开工快照中的 lexer 实际接受单引号，`docs/language-charter.md` 也写明单/双引号
   等价；D46 和本任务书却说“单引号维持拒绝”。本实现遵循本批已批规格，改为定向
   拒绝。旧 charter 的相反陈述已经列入共享文档待迁移，没有在报告里擅自裁决。
2. D47 第 82 条仍把裸 U+0080 的位置称为 stdlib `javascript.vel`；任务书给出的
   实际 owner `packages/script-analysis/src/index.vel` 才是当前代码位置，本次在实际
   owner 上完成迁移。

除此之外没有需要用户重新裁决的设计问题。

## 定向验证

- `npm run build --workspace @velarscript/compiler`：通过。
- `node --test tests/hardening-lexical.test.ts tests/hardening-language.test.ts tests/hardening-nan-semantics.test.ts`：43/43 通过。
- `node --test tests/hardening-reactivity.test.ts tests/hardening-web-syntax.test.ts`：10/10 通过。
- 本任务文件 `git diff --check`：通过。

## 门禁

### 1. `npm run check`

退出码：1。原样尾部：

```text
> @velarscript/cli@0.10.0 clean
> node ../../scripts/clean-package-dist.mjs


> @velarscript/cli@0.10.0 postbuild
> node ../../scripts/mark-package-bin.mjs dist/cli.js


> velarscript-workspace@0.10.0 check:format
> node scripts/check-velar-format.mjs

VelarScript source formatting is stale:
examples/standard-library.vel
```

### 2. `npm test`

退出码：1；906 个测试中 885 通过、21 失败。EF 新增/相邻定向测试均通过；失败项
包括上面列出的共享 `compiler.test.ts` 旧语义、N-2c 的 VEL5021/VEL5038/VEL5058
与 Look/Style 断言、browser ready 失败，以及一个 Node terminal EPIPE。原样尾部：

```text
test at tests/compiler.test.ts:27862:1
✖ leading-dot lines continue the previous logical line across statement positions (53.207042ms)
  AssertionError [ERR_ASSERTION]: [{"code":"VEL1007","message":"Write '0.5'; decimal literals require a digit before the point","span":{"start":10,"end":12},"recovered":true},{"code":"VEL4030","message":"This expression result is discarded; call a function, assign the value, or use the result","span":{"start":10,"end":12}}]
      at TestContext.<anonymous> (file:///Users/mac/Documents/VelarScript/tests/compiler.test.ts:27894:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/node-platform.test.ts:351:1
✖ terminal close is final and queued oversized input rejects through the Vel promise (310.595458ms)
  Error: write EPIPE
      at WriteWrap.onWriteComplete [as oncomplete] (node:internal/stream_base_commons:87:19) {
    errno: -32,
    code: 'EPIPE',
    syscall: 'write'
  }

test at tests/release.acceptance.ts:95:1
✖ external preview preparation emits a reproducible root Netlify build (2183.653541ms)
  Error: external preview build failed (1)
  
  /Users/mac/Documents/VelarScript/examples/production-web/src/components/newsletter.vel:17:16 error VEL5038: Look property 'minWidth' is a CSS length and requires a unit; write a unit value such as 16px, 1rem, or 50%
      minWidth = 0
                 ^
  
  /Users/mac/Documents/VelarScript/examples/production-web/src/components/package-widgets.vel:11:14 error VEL5038: Look property 'margin' is a CSS length and requires a unit; write a unit value such as 16px, 1rem, or 50%
      margin = 0
               ^
  
  /Users/mac/Documents/VelarScript/examples/production-web/src/components/project-list.vel:14:15 error VEL5038: Look property 'padding' is a CSS length and requires a unit; write a unit value such as 16px, 1rem, or 50%
      padding = 0
                ^
  
  /Users/mac/Documents/VelarScript/examples/production-web/src/components/project-list.vel:31:14 error VEL5038: Look property 'margin' is a CSS length and requires a unit; write a unit value such as 16px, 1rem, or 50%
      margin = 0
               ^
  
  /Users/mac/Documents/VelarScript/examples/production-web/src/pages/home.vel:40:14 error VEL5038: Look property 'margin' is a CSS length and requires a unit; write a unit value such as 16px, 1rem, or 50%
      margin = 0
               ^
  
  /Users/mac/Documents/VelarScript/examples/production-web/src/pages/home.vel:43:14 error VEL5038: Look property 'margin' is a CSS length and requires a unit; write a unit value such as 16px, 1rem, or 50%
      margin = 0
               ^
  
      at run (file:///Users/mac/Documents/VelarScript/scripts/prepare-external-preview.mjs:87:25)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async runCompiler (file:///Users/mac/Documents/VelarScript/scripts/prepare-external-preview.mjs:74:3)
      at async prepareExternalPreview (file:///Users/mac/Documents/VelarScript/scripts/prepare-external-preview.mjs:32:5)
      at async TestContext.<anonymous> (file:///Users/mac/Documents/VelarScript/tests/release.acceptance.ts:101:25)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)
```

### 3. `npm run test:browser`

退出码：1；构建 packages 后，首个 browser acceptance 在 ready 状态失败，后续浏览器
矩阵未执行。原样尾部：

```text
> @velarscript/cli@0.10.0 postbuild
> node ../../scripts/mark-package-bin.mjs dist/cli.js

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

false !== true

    at scenario (file:///Users/mac/Documents/VelarScript/tests/browser.acceptance.ts:109:14)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async runBrowserAcceptance (file:///Users/mac/Documents/VelarScript/tests/browser.acceptance.ts:138:5)
    at async file:///Users/mac/Documents/VelarScript/tests/browser.acceptance.ts:45:9
```
