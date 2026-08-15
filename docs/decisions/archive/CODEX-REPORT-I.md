# 批次 I 交付报告 —— Web 受检词汇

## 隔离与提交

- 基线：`44c3eaa`
- worktree：`/Users/mac/Documents/velar-batch-i`
- 分支：`codex/batch-i`
- 未修改主工作树，未 push。
- 逻辑提交：扩展文本形；Web 视觉词汇；文档与本报告。

## 1. D49 keyframes

- Web 词法、AST、Parser、Analyzer、Emitter、语义/检查遍历和 runtime 已贯通
  `keyframes:` 块值。
- 支持 `from`、`to`、`1%` 到 `99%`、逗号停靠点、重复检查、声明组升序、
  非空块和直接属性体；`0%`/`100%` 定向教 `from`/`to`。
- 停靠点复用 Look 属性和值机器，并减去不可插值属性；响应式状态读、条件、
  目标、展开和动态 CSS 值均在编译期拒绝。
- `Keyframes`/`Animation` 穿过模块接口；`animate` 检查 duration、delay、count、
  loop、easing、direction、fill，且 count/loop 互斥。
- Look `animation` 只收 `Animation`、`List<Animation>` 或 `null`；字符串形教
  `keyframes:` + `animate(...)`，动画 longhand 教同一所有权边界。
- keyframe 结构规范化后以稳定 FNV 内容名生成 `velar-kf-xxxxxxxx`；同模块同形
  只发一条 `@keyframes`。
- `velar/web-test` 的 browser controller 新增 `animation(selector)`，通过
  `getAnimations()`、CSSAnimation 名称、两帧 `rotate` 采样证明真动画。
- Core 未启用 Web 时，`keyframes:` 只报一条 `VEL2035`，直接给出
  `velar.json` 扩展启用方式，不产生语法级联。

规格落地说明：D49 的示例同时要求停靠点升序并把 `from, to:` 写在 `50%:`
之前。本实现把一个逗号声明视作一组，以组内最小偏移判断声明组顺序，同时仍
对所有展开后的偏移全局查重，因此批准示例合法。D49 还写了当前不存在的
`rotate(...)` 构建器，但只批准 `animate` 加入 builder 表；实现使用已受检的
individual `rotate = 0deg` / `rotate = 1turn`，没有额外扩张公共 builder 词汇。

## 2. Look 属性和值

- 收录原则已发布：标准、未废弃、且值模型可被 Look 类型族诚实描述。
- 属性表从基线 123 项增至 225 项，净增 102 项，按 14 个功能族发布。
- 225/225 属性都有显式 value kind；不存在 `stringType` 回落。
- 明确排除 36 项：float 2、table 5、multi-column 9、animation longhand 11、
  generated content 4、paged fragmentation 5；每组理由已进入 charter。
- textShadow、grid 长手、逻辑尺寸/间距/inset、border 长手、滚动、表单主题、
  国际文本和 SVG paint 已系统补录。
- 诊断顺序为：近似拼写建议；真实 CSS 域外边界 + `import css unsafe`；完全未知
  词汇表消息。相邻字符转置也计为一次编辑。
- 关键字值采用闭集，长度、颜色、图像、track、阴影、动画等走类型族；已覆盖
  `flexx`、`big`、字符串 `"12px"`、`reddish`、raw grid template 和 raw
  gradient 的定向拒绝。

## 3. 元素名表

- 发布 199 个标准、未废弃的 HTML/SVG/MathML native 元素，按 9 族维护；
  void 元素由同一 Web owner 提供给 lexer/compiler。
- `<dvi>` 在编译期拒绝并建议 `<div>`；现有 SVG `<desc>` 进入 owner 表。
- 自定义元素采用 HTML Standard 的保守子集：ASCII 小写字母开头、只含小写
  字母/数字分段、至少一个连字符；标准保留的旧式连字符名仍拒绝。
- `<user-card>` 合法，PascalCase 继续表示 VelarScript 组件。

## 4. 扩展文本形

- compiler 扩展协议新增 `textForm(type)`，TypeEnvironment、Analyzer、f-string
  和 `str(...)` 共用这一条契约。
- Web 为 Length、Percentage、TrackFraction、Duration、Angle 声明全定义文本
  形；`f"gap: {16px}"` 与 `str(16px)` 保留单位输出。
- 其他扩展值继续报 VEL4026，但只教 `print` 检视，不再错误建议 stringify。

## 5. examples 迁移清单（穷尽）

- `examples/production-web/src/pages/home.vel`：新增受检 spin keyframes、
  `motion.reduced` 条件、真实动画探针，以及 `Animation?` 从值到 `null` 的交互
  切换。
- `examples/production-web/src/app.browser.test.vel`：新增动画名称、真旋转、三浏览器
  执行和 null 移除断言。
- 关键字值收紧没有拒绝其他 `examples/**` 现有写法，因此没有隐式迁移；
  production-web、flow-board、support-desk、api-dashboard 均重新检查通过。

## 6. 文档

- `docs/language-charter.md` 只追加 section 17 附录，没有改既有段落；附录由
  `LOOK_PROPERTY_GROUPS` 的实际 225 项词表转录，并发布排除表、keyframes、
  元素约定和扩展文本形。
- `docs/ai-skill.md` 与 `packages/cli/skill/ai-skill.md` 逐字节一致；动画示例明确
  使用 `if not motion.reduced:`。
- 152 个 VelarScript 文档 fence 全部编译。

## 7. 门禁尾部

`npm run check`：

```text
Checked 53 formatted VelarScript source files
Checked 152 VelarScript documentation examples (71 complete, 81 fragments)
Checked 76 runtime boundary operations and the shared registry, strict JSON, Web DOM, host-event, browser-platform, storage-host, and Desktop-host ABIs
```

`npm test`：

```text
tests 929
pass 929
fail 0
Checked 15 modules from examples/production-web
Checked 9 modules from examples/flow-board
Checked 8 modules from examples/support-desk
Checked 3 modules from examples/api-dashboard
```

`npm run test:browser`：

```text
VelarScript development and CSP production browser matrices passed
production-web: 30 passed, 0 failed
flow-board: 6 passed, 0 failed
support-desk: 15 passed, 0 failed
api-dashboard: 6 passed, 0 failed
Installed VelarScript browser-project acceptance passed
```

新增 animation 回归在 Chromium、Firefox、WebKit 各通过一次；总计 57 个示例
浏览器用例通过。
