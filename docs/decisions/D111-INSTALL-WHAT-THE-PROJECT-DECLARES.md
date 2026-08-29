# D111 — 装项目声明的那些，而不是全部

Status: accepted — 2026-08-29（所有者裁决）

## 背景：模板是干净的，扇出在 CLI

所有者提问：生成项目时，扩展能不能需要哪个装哪个，别全塞进依赖。

实测：**模板本身已经是按需的。** web 模板只声明 `@velarscript/web`，
node 模板只声明 `@velarscript/server`，desktop 模板只声明
`@velarscript/desktop`。生成项目的 `package.json` 没有问题。

扇出来自 `@velarscript/cli`——每个模板都把它放进 devDependencies，而它自己
硬依赖六个工具链包外加 `esbuild` 与 `playwright`。后果：**一个纯 Core 项目
`npm install` 之后，node_modules 里同样躺着 Desktop、Server、Web 与
playwright（约 18 MB）。**

为什么会这样，是一条可查的因果，不是疏忽：

| CLI 的依赖 | 谁真的需要它 |
|---|---|
| `@velarscript/compiler`、`@velarscript/core` | CLI 全程 |
| `@velarscript/node` | **CLI 核心自身**：`project.ts`、`standard-modules.ts`、`production-build.ts` 三处静态引用（node-only 模块诊断与标准模块） |
| `@velarscript/web`、`server`、`desktop` | **只有** `official-language-server-extensions.ts`，即 `velar lsp` 在运行期用 esbuild 现打的语言服务器包 |
| `playwright` | 只有 `browser-test-runner.ts`，而它**已经是懒加载**（`cli.ts` 用 `await import()` 引入，静态处只 import type） |

也就是说：四个目标扩展被硬装，是为了让编辑器在项目没装某个目标时也能给它
补全；playwright 被硬装，则没有任何加载期理由——需要它的模块本来就是懒的。

扩展解析顺序本身没有问题，已经是**项目优先 → 工具链 → 内置**
（`extension-metadata.ts`）。项目自己装的那个永远赢；CLI 的硬依赖只是让它们
**总是被装上**。

## 裁决

### 第 1 条 —— 安装面积由项目的声明决定

一个项目安装的工具链包，等于它自己声明的那些，加上 CLI 真正在加载期需要的
那些。**不为「编辑器也许想看别的目标」而给每个项目装上别的目标。**

### 第 2 条 —— CLI 的依赖按「加载期是否需要」重新分类

- **保留为 `dependencies`**：`@velarscript/compiler`、`@velarscript/core`、
  `@velarscript/node`、`create-velar`、`esbuild`。
  `node` 留下不是妥协——CLI 核心的三处静态引用是真实的加载期需要；
  它同时也是 Server 与 Desktop 的组合基础。
- **改为可选 peer**（`peerDependencies` + `peerDependenciesMeta.optional`）：
  `@velarscript/web`、`@velarscript/server`、`@velarscript/desktop`、
  `playwright`。

**钉法不变**：三个扩展在 peer 位置上仍然是**精确版本**（`"0.25.0"`），
不是区间。D111 改的是「装不装」，不是「锁不锁」——版本锁定契约原样成立
（见第 4 条）。

### 第 3 条 —— 语言服务器打它能解析到的目标

`official-language-server-extensions.ts` 现在静态 import 四个目标，因此缺一个
就打不出包。改为：**逐个尝试解析，注册解析得到的，跳过缺席的。**

- 一个 web 项目的 `velar lsp` 打出 web + node，不打 server/desktop。
- 缺席不是错误，也不产生警告：项目没声明的目标，编辑器本来就不该为它补全。
- 内置注册表（`bundled-extension-registry.ts`）与「项目 → 工具链 → 内置」的
  解析顺序**不变**。

### 第 4 条 —— 发布不变量改字段，不改强度

`release-process.md` 的「八包版本锁定发布集」与候选模式的精确钉校验
（`scripts/release-toolchain.mjs`：`cli.dependencies?.[...] !== rootManifest.version`）
必须跟着搬到 `peerDependencies` 读。

**校验强度一格不许降**：移动后的三个包仍必须精确等于发布版本，缺失、区间、
`^`/`~` 一律失败。八包发布集的成员**不变**。

### 第 5 条 —— 需要浏览器的模板自己声明 playwright

`velar test --browser` 需要 playwright 可解析。CLI 不再替所有项目装它，
因此**发布浏览器测试的模板（web、desktop）把 `playwright` 写进自己的
devDependencies**；Core 与 Node/Server 模板不写。

模板脚手架出的 `surfaces` 块（D110 第 5 条）不受影响。

### 第 6 条 —— 缺席要教，不要栈

一个项目声明了某个扩展却没安装它，诊断必须点名**这个项目缺哪个包、怎么装**，
而不是让 `require.resolve` 的失败冒出去。`velar test --browser` 在 playwright
缺席时同理——那里已有「Install it with: npx playwright install <engine>」的先例，
新诊断沿用同一语气。

## 验收

不是「依赖表看起来变短了」，而是**装出来的树真的变小**：

- 一个 Core/Node 项目安装后，`node_modules/@velarscript/` 下**没有**
  `web`、`server`、`desktop`，且没有 `playwright`。
- 一个 web 项目安装后有 `web` 与 `playwright`，**没有** `server`、`desktop`。
- 三种模板生成的项目仍能 `check`、`test`、`build`、`verify` 全绿；
  web/desktop 模板的 `test --browser` 仍能跑。

这三条进打包消费验收（`tests/package.acceptance.ts`），与 D110 的
表面门禁一样，**由门禁而不是由记忆守住**。

## 所有权与落点

- 依赖分类归 `packages/cli/package.json`。
- 目标注册的容错归 `packages/cli/src/official-language-server-extensions.ts`。
- 精确钉校验归 `scripts/release-toolchain.mjs` 与 `docs/contributing/release-process.md`。
- 模板归 `packages/create/src/templates.ts`。
- 未来新增的目标扩展默认进**可选 peer**；要进 `dependencies` 必须证明
  CLI 核心在加载期真的需要它。
