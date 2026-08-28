# D103 — Look 的受检设计令牌引用（所有者委托裁决 2026-08-28）

## 背景（P1-2，壳骨架波次实测）

平台设计系统的契约是 CSS 自定义属性（`@velaros-ai/ui` 的 tokens/theme
文件；明暗主题靠变量换值切换；产品 225 个组件样式全部经由它取值）。而
受检 Look 对 `var(--token)` 的接纳面是割裂的：颜色类经 `color(string)`
原样透传，`fontFamily`/`backdropFilter` 等自由文本类透传，**所有尺寸类**
（width/height/padding/gap/borderRadius/fontSize…）与 `boxShadow`、
`transition` 一律 VEL5038 拒绝。后果：壳 chrome 只能整体落进
`import css unsafe` 的 CSS 文件；照此推演，重写面 70–90k Vel 行的组件
视觉将全部绕过 Look——「框架即语言」（D78）在本产品的视觉层缺席。
附带缺陷：`color("var(--x)")` 那条能走通的路把可静态折叠的模块级 Look
掉进运行时自定义属性写入路径。

所有者裁决方式：告知后按推荐直接处理（2026-08-28）。

## 裁决

1. Look 增加**一种**受检令牌引用值形式：`token("--name")`，在**每一个**
   Look 属性类中合法（尺寸、颜色、阴影、过渡、字体、自由文本类一律通行）。
   实参必须是以 `--` 开头的 CSS 自定义属性标识符**字面量**；动态名、
   插值、非字面量在声明处拒绝。
2. 编译期直接落入静态 CSS 规则中的 `var(--name)`——静态折叠保持，
   **不引入**运行时自定义属性路径。
3. 受检边界如实声明：被检查的是**引用**（拼写与位置），被引用值的合法性
   归设计系统所有（编译器看不见变量的值）。非令牌值继续受 D37 的逐属性
   关键字/单位表检查，不因本裁决放宽。
4. 统一拼写：`color("var(--x)")` 的自由字符串透传被 `token()` 取代——
   字面 `var(--x)` 字符串在 `color()` 中改为拒绝并指向 `token()`，
   `velar fix` 对该字面形态提供机械迁移。自由文本类（fontFamily 等）
   保持接受普通字符串（它们本就是自由文本），`token()` 同样可用。
5. 无回退实参。令牌是设计系统的封闭契约，缺席是系统缺陷而非逐处回退
   决策；重开条件 = 出现真实消费者需要逐处回退的场景。

## 所有权

`@velarscript/web`（Look 词表、分析、静态发射）；formatter/LSP/文档
（charter §17、web-api Look 节、skill 简报）/tour 同步；`velar fix`
携带第 4 条的迁移。消费侧（VelarOS-Desktop-Vel 的 `shell.css` 回迁
Look）是产品侧后续工作，不属本裁决。
