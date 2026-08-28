# D105 — Velar 是平台名，VelarScript 是语言名（所有者裁决 2026-08-28）

## 背景

所有者提出的类比：**C# 之于 .NET**。C# 是语言，.NET 是它落地的那个面 ——
运行时、基础库、SDK、目标。这门项目缺的正是后者的名字：仓库里
「语言」有名字（VelarScript / Vel），「你装的那个东西」没有。

而它其实**一直有名字，只是没被说出来**：

| 语言侧 | 平台侧 |
|---|---|
| `.velar` 源文件、`@velarscript/*` npm 包、VelarScript / Vel | `velar` CLI、`velar build` / `fix` / `skill`、`npm create velar@latest`、`.velar/` 工程状态目录、`import ... from "velar/web"` |

命令行叫 `velar` 而不是 `velarscript`，import 写 `velar/look` 而不是
`velarscript/look` —— 这个分工仓库里已经执行了一年。本裁决只是给它命名。

所有者同时给出定位限定词：**应用层语言**。

## 裁决

1. **VelarScript 是语言名**，书面简称 **Vel**。
2. **Velar 是平台名** —— 应用层平台：Core 编译器 + web / node / desktop
   目标扩展 + 工具链（CLI、构建、测试、开发服务器、语言服务器）。
   一句话：**你写 VelarScript，你装 Velar。**
3. **「framework」不在第 2 条的清单里** —— 因为框架就是语言本身。
   D78 第 195 条一个字不改：`component`、`state`、`look` 是关键字不是导入。
   Velar 不是「语言之上的一层」，它是语言落地的那个面 —— .NET 之于 C#
   也不是一层。
4. **英文不写 "Velar Framework"**。英文里 "Framework" 会把第 3 条重新读反，
   这正是 D78 第 195 条记下的那个坑。英文平台名就是 **Velar**。
5. **「应用层」是定位限定词，也是刹车。** .NET 是通用平台（系统、服务、
   游戏都做）；Velar 只做应用层 —— 界面、状态、样式、服务端、桌面。
   这是 D78 第 196 条「Core 什么都不认识」的对外表述：它挡住
   「Velar 是平台 → Velar 什么都能干」这条漂移。
6. **定位句加一个限定词**，其余不动：

   > 面向 AI 时代的一门可扩展的**应用层**编程语言，语言与框架一体化。
   >
   > *An extensible application-layer programming language for the AI era,
   > where the framework is the language.*

## 读音（自定义音，非词典音）

所有者指定，理由与 Gemini 同 —— 品牌自定义读音，不取标准音。
`V` 发 `W` 的音，`-lar` 的韵母同 **well**，不同 *car*。

| 写法 | 读作 | 中文近似 |
|---|---|---|
| **Velar** | `/ˈwaɪ.lɛr/` | 歪勒 |
| **Vel** | *well* `/wɛl/` | 威尔 |

**只标这两个。** `VelarScript`、`VelarOS` 这类复合词按 `Velar` 顺下来念，
不单独立条 —— 所有者 2026-08-28 的简化要求：读音只需要介绍 `Velar`
和它的简称 `Vel`。

## 落点

语言仓：`README.md`、`README.zh-CN.md`（标题段、软件包节、读音）、
`docs/language-charter.md` §1、`docs/why-velarscript.md`、
`assets/brand/README.md`，以及 GitHub 仓库描述 / homepage / topics。

跨仓后续（不属本裁决，需各自提交）：`VelarScript-Website` 的首页文案、
`VelarOS-Desktop-Vel` 的 blueprint 术语。

**不改的东西**：npm 作用域仍是 `@velarscript/*`，import 说明符仍是
`velar/*`，CLI 仍是 `velar`，文件扩展名仍是 `.velar`。本裁决不动任何
标识符 —— 它命名的是已经存在的分工，不是新增的一层。
