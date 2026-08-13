# Codex 报告 —— 波 S：标准库迁出

执行规格：D48。工作留在当前工作树，未执行任何 Git 写命令。

## 结论

`velar/text-buffer` 与 `velar/javascript` 已从 Standard API、CLI stdlib
资产和发布物中摘除，分别迁为 `@velarscript/text-buffer` 与
`@velarscript/script-analysis` 两个可安装的纯 VelarScript 源码包。CLI
语言服务通过构建期内部包边消费 script-analysis，不再把它暴露为用户可见的
`velar/*` 模块。旧导入得到精确的安装与包名迁移教学。

AI 简报原本没有列出这两个模块，因此正文无需删项；
`docs/ai-skill.md` 与 `packages/cli/skill/ai-skill.md` 仍逐字节一致。

## 最终包名与形状

### `@velarscript/text-buffer`

- 目录：`packages/text-buffer/`
- 版本：`0.10.0`
- 源码入口：`velar.entry = "src/index.vel"`
- 发布内容：`LICENSE`、`README.md`、`package.json`、`src/index.vel`
- 运行依赖：无
- 来源：原 `packages/cli/stdlib/text-buffer.vel`，源码语义未改

### `@velarscript/script-analysis`

- 目录：`packages/script-analysis/`
- 版本：`0.10.0`
- 源码入口：`velar.entry = "src/index.vel"`
- 发布内容：`LICENSE`、`README.md`、`package.json`、`src/index.vel`
- 精确依赖：`@velarscript/text-buffer = 0.10.0`
- 来源：原 `packages/cli/stdlib/javascript.vel`；唯一源码迁移改动是把
  `velar/text-buffer` 导入改成 `@velarscript/text-buffer`

两个包均进入 workspace lockfile、packed consumer、installed-browser
consumer，以及包含八个 tarball 的 release rehearsal/verify 集合。release
读取阶段同时校验两包版本、script-analysis → text-buffer 与 CLI →
script-analysis 的精确依赖。

## 改动清单

### Standard 与 CLI

- 删除 `packages/cli/stdlib/javascript.vel`、
  `packages/cli/stdlib/text-buffer.vel` 及 CLI `stdlib` 发布目录。
- `packages/cli/src/standard-modules.ts` 删除两项注册及整条 source-backed
  Standard loader/cache/bootstrap 支路；Standard API 总导出由 304 收窄至
  280。
- 删除仅服务旧 stdlib 资产的 `embedded-standard-assets.ts`。
- `official-script-language-service.ts` 改从
  `@velarscript/script-analysis` 导入；对应 TS 声明迁为
  `script-analysis-runtime.d.ts`。
- `official-tool-assets.ts` 在构建语言服务/项目工具时经普通项目包解析器编译
  新包入口，再把 script-analysis、text-buffer 与其 Standard/runtime 依赖
  内联到工具包。这是 CLI 实现边，不创建用户可见 Standard 身份。
- `project.ts` 对两个旧 `velar/*` 拼写优先给定向教学，而不是落入 npm 子路径
  或未知模块噪音。

### 测试与发布

- `tests/compiler.test.ts` 的 text-buffer/script-analysis 行为、类型拒绝和
  性能用例改为建立真实 workspace package 安装形状后按包名导入；新增两个旧
  Standard 导入的精确诊断断言。
- `tests/performance.test.ts` 的 1 MiB 增量分析门禁改走安装包导入。
- `tests/package.acceptance.ts` 打包、安装并检查两个新 tarball，经
  `velar.entry` 编译两个包，实际运行结果，并保留可读 JS eject 验收。
- `tests/installed-browser.acceptance.ts` 的干净安装集合扩为八个 tarball。
- `scripts/release-toolchain.mjs` 与 `tests/release.acceptance.ts` 的完整发布集合
  扩为八包，并验证确定性身份与精确依赖。

### 文档

- `docs/standard-library.md` 开头加入第 86 条成员规则，删除两个模块章节。
- `docs/language-charter.md` 在 §19 前成文同一封闭词汇与领域包边界。
- 同步 `docs/runtime-boundary.md`、`docs/compiler-architecture.md`、
  `docs/package-distribution.md`、`docs/continuous-integration.md`、
  `docs/best-practices.md` 与 `packages/cli/README.md`。

## 测试迁移前后对照

| 门禁面 | 迁移前 | 迁移后 |
| --- | --- | --- |
| 编译器/执行 | 直接导入 `velar/text-buffer`、`velar/javascript`，产物落在生成的 `node_modules/velar` | 临时消费者安装两个 workspace 包，按 `@velarscript/*` 导入，包源码落在 `__velar_packages__` 并实际执行 |
| 性能 | script service 作为 Standard 模块执行 | 同一 1 MiB 初次/尾部增量预算经安装包解析、编译、执行 |
| packed consumer | 两份 `.vel` 随 CLI tarball 内置，消费者零依赖导入 Standard 身份 | 两个独立 tarball 安装后经 `velar.entry` 导入；script-analysis 的包依赖也由 npm 安装图承担 |
| 负向迁移 | 旧拼写仍合法 | 两个旧拼写各产生一条包含安装动作和唯一新包名的教学错误 |
| 发布 | 六个工具链 tarball | 六个工具链包 + 两个领域源码包，共八个确定性 tarball |

## 额外验证

- `node tests/package.acceptance.ts`：退出 0；packed consumer 与 eject 均通过。
- `node --test --test-concurrency=1 tests/release.acceptance.ts`：2/2 通过。
- `npm run release:rehearse`：退出 0，八包 rehearsal 通过。
- `node packages/cli/src/cli.ts lsp </dev/null`：退出 0。
- `node packages/cli/src/cli.ts skill >/dev/null`：退出 0。
- `cmp docs/ai-skill.md packages/cli/skill/ai-skill.md`：相同。
- 两个新包的 `npm pack --dry-run --json` 均只含 LICENSE、README、manifest 与
  `.vel` 入口。

## 最终门禁原样输出尾部

以下三段来自最终树、独占串行执行的 `check → test → test:browser`。此前执行器
提前回报完成导致的三组并发门禁已由本任务按明确 PGID 终止并全部作废，未用于
以下证据。

### `npm run check`（exit 0）

```text
> @velarscript/cli@0.10.0 clean
> node ../../scripts/clean-package-dist.mjs


> @velarscript/cli@0.10.0 postbuild
> node ../../scripts/mark-package-bin.mjs dist/cli.js


> velarscript-workspace@0.10.0 check:format
> node scripts/check-velar-format.mjs

Checked 53 formatted VelarScript source files

> velarscript-workspace@0.10.0 check:docs
> node scripts/check-documentation-examples.mjs

Checked 147 VelarScript documentation examples (68 complete, 79 fragments)

> velarscript-workspace@0.10.0 check:boundaries
> node scripts/check-runtime-boundary.mjs

Checked 76 runtime boundary operations and the shared registry, strict JSON, Web DOM, host-event, browser-platform, storage-host, and Desktop-host ABIs
```

### `npm test`（exit 0）

```text
ℹ tests 820
ℹ suites 0
ℹ pass 820
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 140566.846291
Checked 15 modules from examples/production-web
Checked 9 modules from examples/flow-board
Checked 8 modules from examples/support-desk
Checked 3 modules from examples/api-dashboard
✓ src/store.test.vel :: test_theme_store

1 passed, 0 failed
✓ src/domain.test.vel :: test_task_workflow_uses_finite_states
✓ src/domain.test.vel :: test_board_mutations_are_direct_and_typed
✓ src/domain.test.vel :: test_task_draft_uses_named_record_fields

3 passed, 0 failed
✓ src/domain.test.vel :: test_ticket_selection_and_pagination
✓ src/domain.test.vel :: test_ticket_resolution_mutates_the_owned_ticket
✓ src/domain.test.vel :: test_ticket_draft_crosses_the_domain_boundary

3 passed, 0 failed
✓ src/chart.test.vel :: test_chart_coordinates_are_bounded
✓ src/chart.test.vel :: test_chart_scale_owns_derived_internal_state
✓ src/chart.test.vel :: test_chart_scale_constructor_rejects_invalid_values

3 passed, 0 failed
```

### `npm run test:browser`（exit 0）

```text
27 passed, 0 failed
✓ chromium :: src/app.browser.test.vel :: test_flow_board_crud_and_persistence
✓ chromium :: src/app.browser.test.vel :: test_search_and_lazy_analytics_route
✓ firefox :: src/app.browser.test.vel :: test_flow_board_crud_and_persistence
✓ firefox :: src/app.browser.test.vel :: test_search_and_lazy_analytics_route
✓ webkit :: src/app.browser.test.vel :: test_flow_board_crud_and_persistence
✓ webkit :: src/app.browser.test.vel :: test_search_and_lazy_analytics_route

6 passed, 0 failed
✓ chromium :: src/app.browser.test.vel :: test_dialog_cancel_restores_trigger_focus
✓ chromium :: src/app.browser.test.vel :: test_support_desk_http_filter_and_pagination
✓ chromium :: src/app.browser.test.vel :: test_typed_form_route_context_and_persistence
✓ chromium :: src/app.browser.test.vel :: test_direct_detail_route_recovers_data
✓ chromium :: src/app.browser.test.vel :: test_query_page_uses_strict_optional_number_parsing
✓ firefox :: src/app.browser.test.vel :: test_dialog_cancel_restores_trigger_focus
✓ firefox :: src/app.browser.test.vel :: test_support_desk_http_filter_and_pagination
✓ firefox :: src/app.browser.test.vel :: test_typed_form_route_context_and_persistence
✓ firefox :: src/app.browser.test.vel :: test_direct_detail_route_recovers_data
✓ firefox :: src/app.browser.test.vel :: test_query_page_uses_strict_optional_number_parsing
✓ webkit :: src/app.browser.test.vel :: test_dialog_cancel_restores_trigger_focus
✓ webkit :: src/app.browser.test.vel :: test_support_desk_http_filter_and_pagination
✓ webkit :: src/app.browser.test.vel :: test_typed_form_route_context_and_persistence
✓ webkit :: src/app.browser.test.vel :: test_direct_detail_route_recovers_data
✓ webkit :: src/app.browser.test.vel :: test_query_page_uses_strict_optional_number_parsing

15 passed, 0 failed
✓ chromium :: src/app.browser.test.vel :: test_dashboard_loads_typed_data_and_real_svg
✓ chromium :: src/app.browser.test.vel :: test_dashboard_resource_reloads_without_replacing_the_chart_contract
✓ firefox :: src/app.browser.test.vel :: test_dashboard_loads_typed_data_and_real_svg
✓ firefox :: src/app.browser.test.vel :: test_dashboard_resource_reloads_without_replacing_the_chart_contract
✓ webkit :: src/app.browser.test.vel :: test_dashboard_loads_typed_data_and_real_svg
✓ webkit :: src/app.browser.test.vel :: test_dashboard_resource_reloads_without_replacing_the_chart_contract

6 passed, 0 failed
Installed VelarScript browser-project acceptance passed
```

## 规格/代码冲突与并发说明

- 没有发现需要重新裁决的 D48 语义冲突。
- 现有 CLI LSP 曾把两份源码作为 stdlib 资产嵌入；迁移后改为构建期编译普通包
  入口。这是实现所有权调整，未恢复任何用户可见 Standard 身份。
- 初次 dry-run 发现若只建 manifest/README/source，新 tarball 不会自动继承仓库根
  LICENSE；已为两个包各加入与根文件逐字节一致的 Apache-2.0 LICENSE。
- 初次实现清单之外，release script 仍硬编码六包，会让新包无法进入 rehearsal；
  已作为“可安装包”的实现完整性缺口补齐八包发布集合和精确依赖门禁。
- 迁移中间态曾让并行盲测一次读到已移动的旧资产并报 ENOENT；CLI 内部包链接通后
  LSP/skill/check smoke 全绿，该次由编排方标记为并发噪声。
- 最终复核时发现禁区 `packages/compiler/src/analyzer.ts` 出现其他会话 WIP。本任务
  从未修改、读取内容、回退或纳入改动。由于它是在最终门禁完成后的 status 复核
  才首次被观察到，无法证明该外部 WIP 是在三门禁前、期间还是之后进入共享树；
  报告不把该禁区文件列为 Wave S 成果，也不把门禁结果解释成对其单独验收。
- 未修改 `packages/web/src/**`、`CHANGELOG.md`、`HANDOFF.md` 或其他
  `docs/handoff/**` 文件。

## 未完成项

无 Wave S 未完成项。工作树尚未提交，等待编排方验收。
