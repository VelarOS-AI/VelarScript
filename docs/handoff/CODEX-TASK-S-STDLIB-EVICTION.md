# Codex 任务书 —— 波 S：标准库迁出（规格 = D48，已获用户批准）

你是执行者。规格与裁决已定，不要重新设计；有疑问在报告里提出，不要自行改变语义。

## 必读（按序）

1. `docs/handoff/D48-STDLIB-BOUNDARY.md` —— 本任务的完整裁决与迁移清单
2. `HANDOFF.md` 顶部的协调区 —— 当前在途波次与禁区
3. `docs/standard-library.md`、`packages/cli/src/standard-modules.ts`

## 禁区（其他波次在途，碰了会撞车）

- **不得改** `packages/web/src/**`（N-2w 热修在途）
- **不得改** `packages/compiler/src/**`（N-2b 排队中）
- 不得改 CHANGELOG.md、HANDOFF.md、docs/handoff/**
- **不得运行任何 git 写命令**（commit/checkout/restore/stash/reset）——工作留在
  工作树，由编排方验收提交

## 任务

把 `velar/javascript` 与 `velar/text-buffer` 迁出标准库，改为可安装包：

1. **建包**：workspace 内新建两个包（命名建议 `@velarscript/script-analysis`
   与 `@velarscript/text-buffer`，可按仓库既有命名惯例调整），各含
   `package.json`（带 `velar.entry` 指向 `.vel` 源）+ 原模块源码。包机制已存在
   （`velar.entry`），参考仓库内既有包的形状。
2. **摘除注册**：`packages/cli/src/standard-modules.ts` 删除两行
   `loadVelarSourceStandardModule` 注册；`packages/cli/stdlib/` 两个 `.vel`
   文件随迁移移除。
3. **CLI 内部引用**：`packages/cli/src/official-script-language-service.ts`
   消费 `velar/javascript` —— 改为**内部引用**新包（工具链实现细节，不经用户
   可见的 stdlib 通道）。`velar-javascript-runtime.d.ts` 相应处理。
4. **测试迁移**：`tests/compiler.test.ts`、`tests/performance.test.ts`、
   `tests/package.acceptance.ts` 中引用这两个模块的用例——改为经包导入
   （这正好把「安装包→导入→运行」的通道纳入门禁，是本任务的隐藏收益）。
5. **文档迁移**：`docs/standard-library.md` 删两模块条目并在开头加 D48 第 86 条
   的成员规则一段；`docs/runtime-boundary.md`、`docs/compiler-architecture.md`、
   `packages/cli/README.md` 中的引用同步。`docs/best-practices.md` §10 的
   「stdlib 自己的 text-buffer 模块」措辞改为指向包（样本地位保留）。
6. **AI 简报**：若 `docs/ai-skill.md` 列出这两个模块则删除，并同步
   `packages/cli/skill/ai-skill.md`（**逐字节一致**，有测试强制）。
7. **用户面错误**：迁出后 `import {analysis} from "velar/javascript"` 应得到
   定向诊断（「velar/javascript 已迁出为包 @velarscript/script-analysis；
   安装后按包名导入」），不是裸的未知模块错误。参照 MOD-U6 的教学风格。

## 门禁（按序全过才算完成）

```
npm run check
npm test
npm run test:browser
```

（注：desktop-worker.test.ts 有既知的并发环境间歇性挂起；挂 10 分钟以上就干净
重跑一次。）

## 交付

工作留在工作树未提交 + 写报告到 `docs/handoff/CODEX-REPORT-S.md`：改动清单、
两包的最终命名与形状、测试迁移前后对照、门禁三段原样输出尾部、任何规格与代码
冲突之处（报告，不要自行裁决）。
