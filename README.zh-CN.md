<p align="center">
  <img src="./assets/brand/velarscript-mark.svg" alt="VelarScript" width="116" />
</p>

# VelarScript

[English](README.md) | [简体中文](README.zh-CN.md)

[![VelarScript CI](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml/badge.svg)](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml)

**面向 AI 时代的一门可扩展的编程语言，语言与框架一体化。**

模型写代码的速度，已经超过了任何人验证它的速度——瓶颈从「写」移到了「信」。今天在用的每一套技术栈，都是为另一个时代造的：每一行由人写，人脑里装着全部上下文。那个时代承受得起静默的错误，因为写的人知道自己是什么意思。这个前提没有了，而技术栈没有动。Vel 的回答是同一件事的两面：把需要验证的面收成一门语言，再让编译器来做验证。写错的 CSS 取值、拼错的 `aria-*`、漏掉的响应式依赖、一次强转、一个无主的失败——在别处全是静默的，在这里是编译错误。

`component`、`state`、`computed`、`watch`、`look`、`keyframes` 是**关键字，不是导入**——语言之上没有另铺一层框架，因为框架**就是**语言。而 Core 本身不认识上面任何一个词：它不知道什么是 DOM、样式表、文件系统或窗口。每一项能力都由扩展经编译器协议加入真正的语法：`@velarscript/web` 带来上面这些词和 JSX，`@velarscript/desktop` 让同一套源码模型跑在系统 WebView 上、能力受权限范围约束，`@velarscript/node` 补上服务端。**扩展加的是语法，不只是库**——这才叫可扩展，而不只是可配置。

Vel 以 JavaScript 和 Python 为根基——这是所有模型最熟悉的两门语言，因此模型仅凭已有知识就能编写它。同时，这门语言坚持**每个概念只有一种明确写法**，让输出始终统一，也让任何 Vel 代码库都拥有一致的阅读体验。你提供意图并阅读结果，模型负责编写 VelarScript 代码以及之后的每一次修改，编译器则守护每一次变更。

## 开始使用

```sh
npm create velar@latest my-app
cd my-app
npm install
npm run dev
```

其他模板：`--template node | desktop | docs | library | component`。

接下来阅读[入门指南](docs/getting-started.md)，或按生成的 `AGENTS.md` 运行其中列出的分平台 `velar skill` 命令。

## 代码示例

```velar
import {Head} from "velar/web"
import {border, color, rgb, spacing} from "velar/look"

type Task:
    id: string
    title: string
    done: bool

const pageLook = look:
    display = "grid"
    gap = 16px
    maxWidth = 720px
    marginInline = "auto"
    padding = spacing(48px, 20px)

    if viewport.width <= 640px:
        padding = spacing(24px, 16px)

const buttonLook = look:
    border = border(0px, color("transparent"))
    borderRadius = 10px
    padding = spacing(10px, 14px)
    cursor = "pointer"

    if @hover:
        background = rgb(235, 240, 255)

export component App:
    state tasks: List<Task> = []
    state draft = ""

    computed remaining = tasks.filter(task => not task.done).size

    def addTask():
        if draft == "":
            return
        tasks = [
            ...tasks,
            {id: f"task-{tasks.size}", title: draft, done: false},
        ]
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

这段代码会被编译为普通的 JavaScript 和 DOM 调用，并生成稳定、易读的 CSS 选择器。除了显式引入的 `@velarscript/web` 包，浏览器中不存在额外的框架运行时。

## 真正不同之处

**编译器负责教会你，而不是把你困住。** 每当你使用已移除或错误的写法，诊断信息都会指出唯一的当前写法，让模型一次就能自行纠正，也让人可以直接从编译器学习这门语言。这项能力由盲测验证，而不只是口头宣称。

**没有技术锁定。** Vel 会编译为易读且带有源码映射的 JavaScript。如果 Vel 本身有一天成为阻碍，你可以直接接管编译产物并继续交付。这个退出通道由[永久验收门禁](tests/package.acceptance.ts)持续保证，而不是停留在文字承诺中。

**它从不承诺向后兼容，而这正是要点。** 这门语言存在，是因为它的作者受不了 React 的一堆条框和 Vue 的模板写法；而它给自己定的目标是：**用它的人不该有一天因为同样的理由去设计一门替代品**。没有任何单独一条约束会让人重写一门语言 —— React 的每一条都站得住 —— 是**累积**让人受不了。而承诺兼容的语言**只能往上加**，于是它发现的摩擦就是它要永远背着的摩擦。

**拒绝这个承诺，才是「发现摩擦之后能真的拿掉它」的机制。** 被移除的写法会得到带迁移指导的诊断，绝不会成为静默别名，也不会留下永久兼容债务，纯机械的改动由 `velar fix` 完成。代价是：请固定工具链版本，升级时做迁移。Vel 目前适合快速演进的产品 —— 原型、内部工具、生命周期较短的项目；面向长期产品的稳定通道是未来里程碑，必须由证据赢得，而不是靠版本号宣布。

完整的设计思考见[为什么要创造 VelarScript](docs/why-velarscript.md)。

## 文档

**使用这门语言**

- [入门指南](docs/getting-started.md) — 安装、创建、运行和测试
- [最佳实践](docs/best-practices.md) — 包含可运行代码的推荐风格
- [CLI 参考](docs/cli.md) — 按使用场景组织的全部命令
- [语言参考](docs/language-charter.md) — 完整的语言契约
- [标准库](docs/standard-library.md) · [Web 框架](docs/web-api.md)
- [二进制数据与并发](docs/binary-data-and-concurrency.md) — 受检内存、确定性 Worker、传输与持久化
- [AI 技能简报](docs/ai-skill.md) — Core，以及独立的 [Web](docs/ai-skill-web.md)、[Node](docs/ai-skill-node.md)、[Desktop](docs/ai-skill-desktop.md) 指南
- [逃生舱](docs/escape-hatches.md) · [JavaScript 边界](docs/javascript-bridge.md)

**参与编译器开发**

- [贡献指南](CONTRIBUTING.md)和[贡献者文档](docs/contributing/)
- [设计决策](docs/decisions/) — 这门语言为何采用现在的设计

## 软件包

Core 保持与目标平台无关；每种目标平台都由显式的软件包负责，不依赖隐藏的编译器行为。

| 软件包 | 职责 |
| --- | --- |
| `@velarscript/compiler` | Core 语言 |
| `@velarscript/node` | 文件系统、SQLite、Worker、WebSocket/服务器与 HTTP，且不暴露 Node.js ABI |
| `@velarscript/web` | 组件、JSX、响应式系统、生命周期、Look、浏览器 Worker 与二进制存储/传输 |
| `@velarscript/desktop` | 在系统 WebView 宿主上沿用相同的 Web 源码模型，并提供受权限范围约束的能力 |
| `@velarscript/cli` | 项目、构建、测试、开发服务器和语言服务器 |
| `create-velar` | 项目模板 |

Vel 有意不引入虚拟机、第二套对象模型、TypeScript 式类型编程、React effects、CSS Modules 哈希以及隐式 JavaScript 类型转换。

## 许可证

采用 Apache-2.0 许可证。详见 [LICENSE](LICENSE)。
