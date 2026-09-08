<p align="center">
  <img src="./assets/brand/velarscript-mark.svg" alt="VelarScript" width="116" />
</p>

# VelarScript

[English](README.md) | [简体中文](README.zh-CN.md)

[![VelarScript CI](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml/badge.svg)](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml)

**面向 AI 时代的一门可扩展的应用层编程语言，语言与框架一体化。**

**VelarScript 是语言，Velar 是它跑的应用层平台**——Core 编译器、目标扩展、工具链。你写 VelarScript，你装 Velar；就像你写 C#，你装 .NET。区别在范围：Velar 永远只做应用层——界面、状态、样式、服务端、桌面。

> `Velar` 读 `/ˈwaɪ.lɛr/`——`V` 发 `W` 的音，词尾韵同 *well*，不是 *car*。简称 `Vel` 就读 *well*。

模型写代码的速度，已经超过了任何人验证它的速度，瓶颈于是从「写」移到了「信」。今天在用的每一套技术栈，都是为另一个时代造的：每一行由人写，人脑里装着全部上下文；那个时代承受得起静默的错误，因为写的人知道自己是什么意思。这个前提没有了，而技术栈没有动。Vel 的回答是同一件事的两面：把需要验证的面收成一门语言，再让编译器来做验证。写错的 CSS 取值、拼错的 `aria-*`、漏掉的响应式依赖、一次强转、一个无主的失败——在别处全是静默的，在这里是编译错误。

`component`、`state`、`computed`、`watch`、`look`、`keyframes` 是关键字，不是导入：框架**就是**语言。Core 自己一个都不认识——它不知道什么是 DOM、样式表、文件系统或窗口。每一项能力都以扩展的形式到来，经编译器协议加入真正的语法，这让这门语言是可扩展的，而不只是可配置的。而 Vel 是拿 JavaScript 和 Python 的骨头搭起来的——所有模型最熟的两门语言——并坚持**每个想法只有一种明摆着的写法**，于是模型仅凭已有知识就能写出它，任何一个 Vel 代码库读起来都和别的一样。你提供意图并阅读结果；模型写下 VelarScript 以及之后的每一次改动；编译器守住每一次改动。

## 开始使用

需要 Node.js 24 或更新版本。其余的一切都来自 npm。

```sh
npm create velar@latest my-app
cd my-app
npm install
npm run dev
```

其他模板：`--template node | desktop | docs | library | component`。

接下来读[入门指南](docs/getting-started.md)，或者照着生成的 `AGENTS.md` 走，运行它点名的那些 `velar skill` 命令。

## 它长什么样

```velar
import {Head} from "velar/web"
import {rgb, spacing} from "velar/look"

type Task:
    id: string
    title: string
    done: bool

const pageLook = look:
    display = "grid"
    gap = 16px
    maxWidth = 720px
    padding = spacing(48px, 20px)

    if viewport.width <= 640px:
        padding = spacing(24px, 16px)

const buttonLook = look:
    borderRadius = 10px
    padding = spacing(10px, 14px)

    if @hover:
        background = rgb(235, 240, 255)

export component App:
    state tasks: List<Task> = []
    state draft = ""

    computed remaining = tasks.filter(task => not task.done).size

    def addTask():
        if draft == "": return
        tasks = [...tasks, {id: f"task-{tasks.size}", title: draft, done: false}]
        draft = ""

    return <main look={pageLook}>
        <Head title="Tasks · VelarScript" />
        <h1>{remaining} remaining</h1>
        <input bind:value={draft} aria-label="Task title" />
        <button look={buttonLook} type="button" on:click={addTask}>Add task</button>
        <ul>
            {tasks.map(task => <li key={task.id}>{task.title}</li>)}
        </ul>
    </main>
```

这段代码编译成普通的 JavaScript 和 DOM 调用，CSS 选择器稳定、可读；浏览器里除了 `@velarscript/web` 之外，没有别的框架运行时。

## 真正不同之处

**编译器是教你，不是困住你。** 每一个被移除或写错的拼写都会得到一条诊断，点名当前唯一的那种写法，于是模型一轮就能自己改对，人也能直接跟编译器学这门语言。这一条由盲测来衡量，不是靠嘴上说。

**没有锁定。** Vel 产出可读的 JavaScript，Source Map 单独开关。如果哪天 Vel 自己成了障碍，把产物接过去继续发版就是——这条出口由一道[永久验收门禁](tests/acceptance/package.acceptance.ts)守着，不是写在文案里的承诺。

**它从不承诺向后兼容，而这正是要点。** 这门语言之所以存在，是因为它的作者受不了 React 的一堆约束和 Vue 的模板写法；而它给自己定的目标是：用 Vel 的人，不该有一天因为同样的理由去设计一门替代品。没有哪一条单独的约束会逼人重写一门语言——React 的每一条都站得住——是**累积**。而承诺兼容的语言只能往上加，于是它发现的摩擦，就是它要永远背着的摩擦。拒绝这个承诺，才是「摩擦一旦被发现就能真的拿掉」的机制。Vel 适合快速演进的产品；面向长期的稳定通道是未来的里程碑，要由证据赢得。

完整的推理见[为什么有 VelarScript](docs/why-velarscript.md)。

## 版本，以及升级之后要重读什么

一次发版里每个包都走到同一个数字，所以那个数字说的是你装了什么，而不是什么变了。什么变了，由 `velar --version` 的第二行来说：

```text
velar 0.32.0
  core@0.8   web@0.14   node@0.17   server@0.15   desktop@0.10
```

五个可观察的面——语言本身，以及 Web、Node、Server 和 Desktop 扩展——各有自己的计数器；没动的那个数字，就是你不必重读的那个面。`0.N` 里的 `N` 数的是改动次数，从来不是成熟度：这套标号从 0.25.0 开始，那时 `core` 从 `0.1` 起步，四个扩展契约则沿用它们已有的数字，所以一个小数字挨着一个大数字，只说明这两者开始计数的时间不同。每个面的全部词汇由门禁哈希出来，而不是谁手敲上去的；项目把自己是对着哪一版写的记在 `velar.json` 的 `surfaces` 里，对不上就会被点名拒绝。

钉住你的工具链版本；要动它的时候，跑这三条命令：

```sh
npx velar --version   # which of the five surfaces moved
npx velar fix         # apply the mechanical part of the migration
npx velar check       # what is left, each naming its one current spelling
```

然后读[更新日志](CHANGELOG.md)里那些动过的面所对应的章节。

## 文档

- [入门指南](docs/getting-started.md) — 安装、创建、运行、测试
- [这门语言](docs/language.md) — 按阅读顺序讲完整门语言，附可运行代码
- [最佳实践](docs/best-practices.md) · [CLI 参考](docs/cli.md) · [语言宪章](docs/language-charter.md) — 统一风格、全部命令、完整契约
- [标准库](docs/standard-library.md) · [Web 框架](docs/web-api.md) · [Desktop API](docs/desktop-api.md) · [二进制数据与并发](docs/binary-data-and-concurrency.md)
- [AI 技能简报](docs/ai-skill.md) — Core，另有 [Web](docs/ai-skill-web.md)、[Node](docs/ai-skill-node.md)、[Server](docs/ai-skill-server.md) 和 [Desktop](docs/ai-skill-desktop.md)
- [逃生舱](docs/escape-hatches.md) · [JavaScript 边界](docs/javascript-bridge.md)

## Velar 的组成

八个软件包，作为一整套版本锁定的集合发布。Core 保持与目标无关，每一种目标都是一个显式的包而不是隐藏的编译器行为；这张表里没有哪一个包是*那个框架*——框架就是语言。

| 软件包 | 职责 |
| --- | --- |
| `@velarscript/compiler` | Core 语言——语法、类型、分析、JavaScript 产出、扩展协议 |
| `@velarscript/core` | 与目标无关的 Standard API，含 `velar/hash` 与 `velar/validation` |
| `@velarscript/web` | 组件、JSX、响应式、生命周期、Look、浏览器 Worker、二进制存储与传输 |
| `@velarscript/node` | 文件系统、进程、Worker、WebSocket、HTTP，以及原生的 `server` 路由语法——且不暴露 Node.js ABI |
| `@velarscript/server` | 服务配置、启动装配、认证组合、连接所有权 |
| `@velarscript/desktop` | 同一套 Web 源码模型跑在系统 WebView 宿主上，能力受权限范围约束 |
| `@velarscript/cli` | 项目、构建、测试、开发服务器、语言服务器 |
| `create-velar` | 项目模板 |

## 在这个仓库上开发

[贡献指南](CONTRIBUTING.md)说明了什么样的反馈才算有用：最有用的那一种是「哪个词读着不对」，而不是一个 pull request。要构建它，先 `npm ci`，然后是两条门禁命令，只有两条（[D116](docs/decisions/D116-SCOPED-GATES.md)）：

```sh
npm run gate            # the quick tier, scoped to what this change set can move
npm run release:check   # quick tier and heavy tier both, before a release
```

`gate` 会算出这次改动可能动到什么——包依赖闭包，加上产出指纹与 `output-fingerprint.lock` 的比对——只跑这些，并打印它跳过了什么、为什么跳过。浏览器套件、打包消费者验收，以及每一个 `*.slow.test.ts`，都只活在 `release:check` 里；完整规则见 [docs/contributing/gates.md](docs/contributing/gates.md)，一次改动要报告哪些套件跑了、哪些被跳过。

代码组织按 [D115](docs/decisions/D115-AGENT-MAINTAINABLE-CODE-ORGANIZATION.md) 来：`packages/compiler/src/` 下每个编译阶段一个目录——`lexer/`、`parser/`、`types/`、`analysis/`、`emit/`、`format/`、`semantic/`——目标包随着落地采用同样的形状；运行时 JavaScript 是 `packages/<name>/runtime/` 下的真源码，`src/*.generated.ts` 里的表由它派生并受门禁看管；`tests/<name>/` 镜像那棵源码树。源码与测试文件被限制在 800 行、函数被限制在 120 行，对着一份只减不增的豁免清单；而一次重构必须让产出逐字节不变——`npm run fingerprint` 来证明这一点。

## 许可证

采用 Apache-2.0 许可证。详见 [LICENSE](LICENSE)。
