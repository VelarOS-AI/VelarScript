# D48 — 标准库成员边界 + 库分发模型（用户裁决 2026-08-13，待实施）

用户原话：「之前让 codex 做 velar 的纯原生编辑器项目，可以把一些非标准库带入的
vel 这是不对的；create 创建应该是类似于 ts 的安装方式作为库去用，这样是不是
比较好」→ 编排代理确认：**是**，并落成边界规则。

## 实测现状（腐蚀证据）

`packages/cli/stdlib/` 的 `.vel` 源码模块**恰好两个、全是编辑器域**：
- `velar/javascript`（36KB）—— JS 词法/语义分析，`tokenAt`/`hoverAt`/
  `completionsAt`/`renameAt` —— 纯编辑器基础设施
- `velar/text-buffer`（22KB）—— 编辑器文本缓冲

两者由编辑器项目（Codex 执行）带入。**这是应用需求反向绑架语言表面的实例。**

---

## 第 86 条 —— 标准库成员规则（与约束/装饰器同一条封闭词汇原则）

**`velar/*` 是语言拥有的封闭词汇。** 一个模块获得成员资格仅当它属于：

- **(a) 普适计算** —— 任何程序都可能需要的纯计算（json/collections/math/text）；
- **(b) 能力原语** —— 碰外界的最小正交面（fs/http/time/app/forms/browser…）。

**域功能**（服务于某一类应用：编辑器、游戏、图表…）**永不入 stdlib** ——
它们是**可安装的库**（母亲生态的 npm 心智；TS 也不把 language-service 塞进
lib.d.ts）。加入 stdlib 的门槛与加语言特性同级 —— 因为 stdlib 是 AI 简报要背、
盲测要靠的先验面，每个成员都在消耗 600 行预算。

**按此规则审计现有成员**：json/collections/math/text/fs/http/time/app/forms/
browser 全部通过（普适计算或能力原语）；**velar/javascript 与 velar/text-buffer
不通过 → 迁出**。

## 第 87 条 —— 迁出方案 + 库分发模型确认

1. **两模块迁出为可安装包**（命名与分包属实现层，编排代理定）。包机制**已存在
   且已验证**（`velar.entry`，审计七/八：可导入、多版本守卫、适配器模式全通）。
2. **CLI 自身的语言服务**（`official-script-language-service.ts`）消费
   velar/javascript —— 这是工具链内部实现细节：**内部打包引用，不作为用户可见
   stdlib 暴露**。用户面的 `import {analysis} from "velar/javascript"` 消失，
   改为安装包后按包名导入。
3. **`velar create` 走 TS 模型**：脚手架产出的项目用 package.json 声明依赖、
   npm 安装、按包名导入。配合既有的 AGENTS.md 脚手架（批次 J），加一行库工作流
   指引（与 BRG-U7 适配器模式文档、MOD-U7 上桥教学同族 —— 三者合成「库的故事」
   一章）。
4. **编辑器项目成为第一个真实的 Vel 库消费者** —— 它踩的正是第三方作者要走的
   分发路，比住在 stdlib 里当特权公民是**更好的裁判**。编辑器侧迁移是 Codex
   任务（用户委派），本仓产出包即可。
5. 收益记档：AI 先验面变小（简报预算）；兼容承诺范围收窄（库独立版本化，
   编辑器可钉版本 —— 应用不被语言节奏绑架，语言不被应用需求绑架）；
   分发通道被真实项目试炼。

## 迁移面（本仓）

- `packages/cli/stdlib/*.vel` 迁出、`standard-modules.ts` 注册表删两行；
- `official-script-language-service.ts` 改内部引用；
- 引用清单（已 grep）：tests/compiler.test.ts、tests/performance.test.ts、
  tests/package.acceptance.ts、docs/standard-library.md、docs/contributing/runtime-boundary.md、
  docs/contributing/compiler-architecture.md、packages/cli/README.md、HANDOFF.md；
- **best-practices §10 的措辞**：「stdlib 自己的 text-buffer 模块是参考样本」→
  样本地位保留、出处改为库（或换一个 stdlib 内的新样本 —— 实现层决定）；
- AI 简报若列 stdlib 模块清单则同步缩减（镜像规则照旧）。

## 批次归属

新增**波 S（stdlib 迁出）**，排 N-2b 之后（同样重触 cli 与 tests，串行）。
第 86 条的成员规则写入 charter §19 旁的新小节 + standard-library.md 开头。
