# D49 — 受检的 keyframes 声明形态（用户批准方向 2026-08-13，规格终稿待用户扫一眼）

用户裁决：动画进语言（选项 b）。近期止血（成文缺席 + `animation` 定向诊断）
已在 N-2c/N-3 推进，不受本规格影响；本规格落地后止血诊断升级为教 `keyframes`。

## 第 88 条 —— `keyframes` 块与 `animate` 构建器

### 完整形态

```
const spin = keyframes:
    from:
        transform = rotate(0deg)
    to:
        transform = rotate(360deg)

const pulse = keyframes:
    from, to:                    // 逗号多停靠点（match case 逗号先例）
        opacity = 1
    50%:
        opacity = 0.4

component Spinner():
    state active = true
    return <div look:animation={active ? animate(spin, 1s, loop=true) : null} />
```

### 声明规则（穷尽）

1. **`keyframes:` 是块值字面量**，产出 `Keyframes` 类型的一等值 —— 与
   `const card = look:` 同族。模块级/组件级 const、export/import 全部可用
   （跨模块共享动画）。`keyframes` 为 web 方言软关键字（批次 G 网格加一词）；
   Core 文件报 D37-45 族的 web 指引。
2. **停靠点标签**：`from`、`to`、`N%`（0 < N < 100 的数字字面量）。
   - `from`/`to` 是 0%/100% 的**唯一拼写**（写 `0%:`/`100%:` → 定向教
     from/to —— 一个明显拼写）。
   - 停靠点必须**升序**、重复拒绝（`from, to:` 逗号列表允许，成员间同样查重）。
   - 至少一个停靠点；空块拒绝。
3. **停靠点体 = 受限的 Look 属性集**：复用全套 Look 属性检查机器（类型化值、
   单位运算、构建器、拼错报 VEL5038），**减去不可动画属性排除表**
   （display/position/overflow/pointerEvents/cursor/userSelect/content 等，
   实施者按 MDN animatable 数据定案）—— 每条排除拒绝时说明「X 不参与动画
   插值」。**不允许**：嵌套 @-目标/条件（CSS 不允许）、`look:` 组合、
   展开。
4. **静态性**：keyframes 块内**禁止响应式状态读**（与 LOK-D1 的修复同一条
   规则 —— 快照位置诊断拒绝）。动态性活在使用点：
   `look:animation={cond ? animate(...) : null}` 是已证活的指令位置，
   null 移除动画。
5. `Keyframes` 值：`==` 是引用身份（与 Look 一致）；不进 readonly 数据
   （与 Look 同处理）；`print` 输出待 N-3 的 look 值呈现打磨一并处理。

### 使用规则

6. **`animate(frames, duration, ...)` 加入 LOOK_BUILDERS（18→19）**：
   - 必选：`frames: Keyframes`、`duration: Duration`（`1s`/`300ms`）。
   - 可选命名参数：`easing`（复用 transition 构建器的既有缓动词汇）、
     `delay: Duration = 0ms`、`count: number = 1`、`loop: bool = false`
     （loop=true 即 CSS infinite —— **不引入 Infinity 字面量**，语法审计
     T-6 已确认其不可拼写，用 bool 绕开）、`direction`/`fill`（词汇随
     transition 惯例，实施者对齐）。`count` 与 `loop` 互斥（同给拒绝）。
   - 全部实参编译期检查（含字面量 —— 与 LOK-U8 的字面量编译检查决案一致）。
7. **`animation` 属性只收 `Animation`（animate 的返回）或其 List**（CSS
   多动画真实存在，`look={[a,b]}` 先例）—— **原字符串形态拒绝**并教
   keyframes + animate（**这条同时关闭 LOK-D5 的静默死声明**）。
8. **降级**：`@keyframes` CSS 带稳定生成名，走既有的每模块规则去重机制
   （token 化，与 look 规则同队）；animation 属性降级为引用生成名的 CSS。

### a11y 立场（成文，不做魔法）

`animate` **不**自动响应 prefers-reduced-motion —— 但 LOK-U3 落地的
`motion.reduced` 条件是官方搭配，AI 简报的动画示例**必须**展示：

```
if not motion.reduced:
    animation = animate(spin, 1s, loop=true)
```

### 诊断清单（每条定向）

未知停靠点标签 / 乱序 / 重复 / `0%`→from 教学 / 不可动画属性带原因 /
块内状态读 / animation=字符串→教 animate / Core 文件→web 指引 /
嵌套目标或条件拒绝 / count+loop 互斥。

### 回归

spinner 端到端（浏览器 computed animation-name 非空且真旋转 —— 用
getAnimations() 断言）、多停靠点、逗号停靠点、乱序/重复/未知标签各一条、
不可动画属性拒绝、状态读拒绝、`look:animation` 动态切换与 null 移除、
跨模块导入的 keyframes、生成名去重（同形两处一条规则）、字符串 animation
教学、motion.reduced 搭配示例进简报且 fence 门禁编译。

### 批次归属

**批次 I（Web 词汇波）**——与属性表发布/系统补录（LOK-U1）、元素名表
（WEB-U12）、扩展文本钩子（D41 第 63.2）同批。近期止血诊断在 N-2c 先行，
本条落地时升级其文案。
