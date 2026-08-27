# L2 — 自包含运行时与签名发布链可执行规格（任务简报，D101 第 4 条的落实）

状态：spec approved for implementation。证据基础：`spike/embedded-node` 分支
（worktree 见波次报告）已证明嵌入官方 Node 的 `.app` 在完全剥夺外部 Node 的
sandbox-exec 环境下通过真实能力调用。实现应吸收 spike 的教训后**重写**，不是
直接合并 spike。

Spike 报出的六个设计题在此裁决（均在 D101 第 4 条既定边界内）：

## 1. 运行时版本归 CLI 一代，不归项目

- 每一代 CLI 内置**一个**受支持的 Node 版本号与其官方 SHASUMS256 指纹
  （与工具链一代一版的既有纪律同型）。项目不选择运行时版本；`velar.json`
  不新增字段。构建清单记录精确版本。
- 获取方式：`velar package` 时从 nodejs.org 下载官方 tarball，校验 SHA256，
  解压缓存到用户级缓存目录（按 `版本+平台+架构` 键）。缓存命中即离线可用；
  离线未命中时报错并指出缓存路径与所需版本。不新增独立命令。
- 架构：与打包机一致（当前 darwin-arm64）。x64 / universal 不在本波，记入
  desktop 目标后续里程碑（与 Windows/Linux 宿主同栏）。
- 只嵌入裸 `node` 可执行文件。不嵌入 `npm`/`npx`/`corepack` 及其符号链接
  （运行时不需要；也避开 hashTree 的符号链接拒绝——该拒绝**保留**）。

## 2. 预算语义：运行时不占应用预算

- `desktop.build.sizeBudgetBytes`（默认 32 MiB 不变）只约束**应用自身组件**
  （renderer、capability host、metadata、native host）。嵌入运行时单独成
  清单组件，由 CLI 自持固定上限（200 MiB 完整性界，不是项目旋钮）。
- tour 示例的预算回到默认值；spike 把 tour 提到 160 MiB 的改动不进主干。

## 3. 布局与签名：inside-out，CLI 执行、产品给身份

- 运行时放 `Contents/MacOS/node`（Apple 辅助可执行惯例；Resources 里的
  Mach-O 不被 `--deep` 签名且 arm64 拒绝执行未签名体——spike 实证）。
  Swift 宿主解析顺序改为：`VELAR_DESKTOP_NODE`（显式开发者覆盖，**最高**）
  → 捆绑运行时 → 既有外部搜索。打包产物正常路径走捆绑；env 覆盖保住排障
  能力。
- `velar package` 拥有 inside-out 签名步骤：先签嵌入的 `node`（带
  `com.apple.security.cs.allow-jit` —— spike 实证 hardened runtime 缺它时
  V8 无法保留 CodeRange），再签宿主，最后签 `.app`。签名身份、产品
  entitlements、公证凭据由产品经打包配置提供；语言只自带运行时必需的最小
  entitlements 文件。未提供身份时 ad-hoc 签名（`codesign -s -`），保证
  本机可运行；`--smoke` 一并升级（见 5）。
- 公证（notarytool 提交与装订）作为 `velar package` 的可选步骤，由配置
  开启；凭据永不写入清单或日志。
- 上游 Node 的 Developer ID 签名在产品签名时被替换属预期；来源可信由
  下载时的 SHASUMS 校验承担并记录在清单。

## 4. 构建清单升版

- 构建清单 `formatVersion` 升到 4：`runtime` 成为
  `{kind: "embedded-node", version, embedded: true, bytes, sha256}` 与
  `{kind: "external-node", embedded: false}` 的并集；旧版本无读取器
  （沿既有精确匹配纪律）。
- `hashTree` 改为流式哈希（spike 发现整读 116 MB 进内存）；树哈希覆盖
  运行时属预期——运行时版本随 CLI 一代钉死，哈希只在换代时变化，记录
  此语义即可，不做豁免。

## 5. 验收升级：`--smoke` 必须触发真实 V8 与能力调用

- spike 实证 `node --version` 在 Isolate 创建前返回，坏运行时也能过。
  `--headless-smoke`（宿主起、worker 起、完成一次真实能力往返、退出 0）
  提升为打包门的标准验收；spike 的 sandbox-exec 剥夺剧本
  （`file-read*` + `process-exec*` 双封）进入测试资产，防外部 Node 假阳。

## 6. 更新原语（机制归语言，策略归产品）

- `velar/desktop` 增 `applyUpdate(archivePath: string) -> Promise<null>`：
  宿主校验归档内 `.app` 的 bundle identifier 与签名 Team ID 同自身一致，
  原子替换自身并重启；任何校验失败 fail-closed 且不触碰现装。
  下载、通道、feed、回滚策略全部归产品（sidecar 自己的 HTTP 与策略）。
- 无自动检查、无内置 feed、无差量——这些是产品能力（对应产品现状
  electron-updater 的 autoDownload=false 姿态）。

## 7. 实现与验收要求

- 波次顺序：在 L1a/L1b 落地后于同一分支链实施（同文件冲突面：build.ts、
  Swift 宿主）。spike 分支只作参考与回归剧本来源。
- 覆盖：缓存命中/未命中/损坏三态；SHA 校验失败拒绝；ad-hoc 与身份签名
  两态的 `--headless-smoke`；entitlements 生效（无 allow-jit 复现失败的
  回归）；`applyUpdate` 的同一性校验矩阵（错 bundle id / 错 Team ID /
  未签名 / 正常）各自 fail-closed；清单 v4 字段与流式哈希等价性。
- 文档：`docs/cli.md` 打包节、`docs/ai-skill-desktop.md` 构建段、
  `packages/desktop/README.md` 同步；文档示例过门。
