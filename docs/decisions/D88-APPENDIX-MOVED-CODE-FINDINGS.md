# D88 附录：随代码移出仓库的审计结论

D88 把 `adapters/*`、`libraries/*`、`integrations/*` 移出本仓库。移出**之前**，
一次覆盖语言、编译器与框架的全面审计在那些实现里确认了若干缺陷（全审计 269 条
上报、60 条被对抗式验证推翻、205 条确认）。

这些结论不随代码作废，只是换了归属：

- **compression、msgpack、noise、text-buffer** 已迁入
  [VelarScript-Libraries](https://github.com/VelarOS-AI/VelarScript-Libraries)。
  逐字节比对确认迁移后的 `src/index.vel` 与被删时**完全相同**，因此审计结论、
  行号与复现步骤全部直接适用。落在它们身上的 **10 条**已在那个仓库修复。
- **sqlite、database、script-analysis** 至今没有实现。它们的 **11 条**（sqlite 7、
  database 3、script-analysis 1）**现在住在 Libraries 仓**：
  [`docs/restoration-findings.md`](https://github.com/VelarOS-AI/VelarScript-Libraries/blob/main/docs/restoration-findings.md)，
  并由那边的 `ROADMAP.md` 在每个包的条目上直接链过去——重建这些实现的人会先看到
  路线图，让证据长在决定的旁边。

**这里不再保留副本。** 同一份清单放两处一定会各自漂移，而"同一个概念两套定义"
正是这次审计最常抓到的形状（见 [AGENTS.md](../../AGENTS.md)）。

原始代码仍可从 `aa4723a` 取回，例如
`git show aa4723a:adapters/sqlite/src/index.vel`。

---

## 附：一条跨仓库的残留

「四种不兼容的行模型」这一条同时横跨两个仓库，`VelarScript-Libraries` 只能做它那一半。

- **已在那边完成**：`packages/text-buffer/README.md` 写明 `lineCount` 只按 `\n` 计数，
  与编译器的行模型不一致。
- **留在本仓**：真正的统一。`Text.lineStarts` 是 Core 标准 API，只认 `\n`；
  `packages/compiler/src/source.ts` 的 `lineStarts` 构造、`Text.lines`、以及
  script-analysis 各自另有一套。Libraries 那边按其 AGENTS.md **不拥有语言与标准 API**，
  所以正确的做法是在本仓把其中一种定为规范（例如让 `\r\n | \r | \n` 成为可选项或
  第二个入口），而不是在库里再实现第五种切分——那只会让问题更糟。

这条本身是 low 级，但它是一个典型形状：**同一个概念在四处各自实现**，
迟早会在某个边界上对不齐。
