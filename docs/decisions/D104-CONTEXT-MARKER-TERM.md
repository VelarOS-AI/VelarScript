# D104 — `@` 的正式名词是「上下文标记」（所有者裁决 2026-08-28）

## 背景

`@name` 这一族语法（`@main:`、`@dispose:`、`@iterate:`、`@mounted:`、
`@cleanup:`、`@hover`、`@get`/`@post`/…）此前的正式名词是 **context
annotation**，`@` 叫 **annotation introducer**（charter §3）。

问题是「annotation」在同一份 charter 里已经被**类型注解**占用了 ——
`x: string` 的结果注解、绑定注解、集合注解、可选函数注解、D58
的 NULL-RESULT-ANNOTATION 全部用这个词，仅 charter 内就有二十余处。
同一个名词指两件毫无关系的事：一个是作者写的类型，一个是编译器拥有的
封闭角色。这正是「一个意思一种拼法」在术语层的反例。

所有者裁决方式：直接指定（2026-08-28）。

## 裁决

1. `@name` 的正式名词是**上下文标记**（英文 **context marker**）。
2. `@` 是**标记引导符**（英文 **marker introducer**）。
3. 「annotation / 注解」此后**只**指类型注解。任何面向用户的文本
   （charter、语言指南、AI skill 简报、包 README、贡献者文档、
   未来的编译器诊断与编辑器悬浮）都不得再用 annotation 指 `@`。
4. 语义**一个字都没有改**：封闭词表、编译器拥有、不查找、不可作为值、
   角色由所在语法上下文选定 —— charter §3 的全部条款原样成立。
   这是一次纯粹的命名裁决。

## 为什么是「标记」

`@` 做的事本来就是**标记**：它给紧随其后的声明或结构条目贴上一个
编译期角色，角色由上下文决定，标记自己不选择含义。旧文案里
「A context annotation **marks** the following declaration」这句话
一直在用「mark」这个动词描述它 —— 名词只是终于和动词对齐了。

## 所有权与落点

本裁决只改文案，**编译器源码零改动**：诊断文本中从未出现过
"context annotation"（`parser.ts` 里 `@` 的词法变量本来就叫 `marker`）。

已同步：`docs/language-charter.md`（§3 小节标题与全部条款）、
`docs/language.md`（§9、§13、§15）、`docs/ai-skill.md`、
`docs/ai-skill-web.md`、`docs/ai-skill-node.md`、
`docs/contributing/compiler-architecture.md`、`packages/node/README.md`，
以及 `packages/cli/skill/` 下的三份逐字镜像（`tests/distribution.test.ts`
要求与 `docs/` 逐字节一致）。

未来新增的编译器拥有角色沿用「上下文标记」这一个名词，不得为某一类
角色（生命周期、路由、选择器、入口）另起名字 —— 那正是 charter §3
当初要压掉的分裂。
