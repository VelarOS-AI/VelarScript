# D31 — 第三轮语法排查：模块环、组件契约、泛型推断（已批准，待实施）

用户于 2026-08-12 批准。第 24 条（JSX 展开）用户**推翻了我的保守建议**改为支持；
其余按建议执行。判据同 D28-D30。所有现状结论均由真编译器探针验证。

---

## 第 23 条 —— 模块初始化环：编译期拒绝（缺陷族，优先级最高）

### 现状（实测，硬化 41 条同族：编译干净、运行裸崩）

```
a.vel: import {b} from "./b.vel" / export const a = "A" / print(b)
b.vel: import {a} from "./a.vel" / export const b = "B" + a

velar check → Checked 2 modules（零诊断）
velar run   → ReferenceError: Cannot access 'a' before initialization（裸 JS 错误）
```

违反「过检查即无裸 JS 错误」承诺。模块图编译期完全已知（charter：项目模块作为
一个依赖图检查；扩展语义图已经拒环），ESM 求值顺序确定，静态可查。

### 目标语义（v1，精确且不禁纯函数环）

- 计算模块求值顺序（与发射产物的 ESM 后序一致）。
- 参与 import 环的模块中，**初始化期位置**（顶层绑定初始化器、顶层表达式语句、
  顶层调用的实参、`state`/look 顶层初始化器、类 `static` 字段初始化器、`mount(...)`）
  对「求值顺序在本模块之后的环内模块绑定」的**直接读取** → 编译错误，消息教两个
  修法：`Move this read into a function, or extract the shared value into a third
  module; './a.vel' has not initialized when this line runs`。
- **函数体内的读取合法**（def/component/action/方法/箭头体都是延迟执行）——
  纯函数环（a 导 b 的函数、b 导 a 的函数）是正当形态，不误伤。
- 类型互递归跨模块（记录类型 A/B 分居两文件互相引用）必须保持合法 ——
  验证器相互引用是惰性的；回归必须覆盖这一形态，防止一刀切禁环误伤。

### 已知残余（记档，不阻塞 v1）

顶层调用本模块函数、该函数体内读环内绑定 —— 间接的初始化期读取，v1 不追
（需要初始化期可达性分析，D1/D2 已裁决不做全程序效应系统）。运行期兜底仍是
裸 ReferenceError。记入对抗搜捕的模块维度；等真实证据再议加深。

---

## 第 24 条 —— 支持 JSX 展开 `<Chip {...attrs} />`（用户裁决，推翻保守建议）

### 现状

`{...attrs}` 裸拒（`VEL5002: Expected a JSX attribute` ×2，无指引）。React 肌肉
记忆的高频形态，转发场景（`<input {...rest} value={v} />`）尤甚。

### 目标语义 —— 一句话：**展开是「逐个写出」的等价物，不是动态口子**

- **语法**：`{...expression}` 在 JSX 属性位，组件与原生元素均可，一个元素可多个。
- **源类型约束**：必须是字段静态已知的记录（具名记录类型或结构对象类型）。
  `Record<T>`（动态键）、`Map`、`unknown`、类实例 → 定向拒绝：字段名必须编译期
  可知，否则无法按名检查。
- **检查规则**：源类型的每个字段按「就地写出该属性」检查 —— 组件：字段名必须是
  声明的 prop（含 `children`，受 VEL5014 冲突规则约束）、类型可赋；原生元素：
  字段按既有原生属性表与类型检查。未声明/未知字段 → 错误（与显式属性同规则）。
- **compiler-owned 名字不可走私**：源记录含 `key`/`ref` 字段 → 拒绝（与第 25 条
  同一守卫）；指令族（`on:`/`bind:`/`look:`/`style:`/`unsafe:`）是语法不是数据，
  天然无法出现在记录字段里，文档写明即可。
- **重复与顺序**：沿用**记录展开的既有规则**（charter §3：从左到右求值，后者
  覆盖前者）—— 这是语言里已教过的规则，零新增心智；`<Chip {...defaults}
  label="override" />` 因此自然成立。两个**显式**同名属性仍是错误（现状不变）。
- **求值**：展开表达式在其属性位置求值一次；字段读取沿用受控记录展开契约
  （own enumerable data 字段、不触 accessor）。字段值是反应式读取，走既有
  per-prop 单元。
- **降级**：字段名静态已知 → 展开编译期铺开为逐字段赋值（读一次求值的临时量），
  复用每属性既有路径；不引入运行时动态属性机制。
- charter §14 补一节（语法、约束、顺序规则、与记录展开的一致性）。
- 回归：组件与原生各一组（类型不符、未知字段、`Record<T>` 拒绝、覆盖顺序、
  `key` 走私拒绝、children 经展开 + JSX 内容冲突、反应式更新执行级）。

---

## 第 25 条 —— `key` 加入 VEL5056 守卫（可声明但不可满足的死局）

### 现状（实测）

```
component Badge(key: string):      // 声明通过
<Badge key={item} />               // key 被 keyed-children 机制消费
→ VEL5012: Component 'Badge' requires prop 'key'   // 永远喂不进
```

`ref` 已有守卫（`VEL5056: 'ref' is a compiler-owned JSX directive and cannot be
declared as a component prop`），`key` 漏掉。`class`/`look` 因关键字身份天然挡住。

### 实施

`key` 加入 VEL5056 同款守卫（声明位拒绝）；回归覆盖 `key`、`ref` 两个名字与
第 24 条的展开走私路径。

---

## 第 26 条 —— children 机制成文 + 诊断教拼写（发布必修）

### 现状（实测）

机制存在且好用：声明 `children: WebNode` prop 即接收 JSX 子节点；`children:
WebNode?` 表示子节点可省略；VEL5014 已查「prop 与 JSX 内容双给」冲突。但：

- **charter §14 零提及** —— Web 框架最核心的组合机制（`<Card><p>…</p></Card>`）
  没有成文语法。
- `VEL5018: Component 'Card' does not declare JSX children` 只说缺、不说怎么声明
  —— 盲写者死路。

### 实施

- charter §14 补一节：`children` 是普通具名 prop（`children: WebNode` 必需子节点、
  `children: WebNode?` 可选子节点）；JSX 标签体内容即该 prop 的实参；与显式
  `children=` prop 互斥（VEL5014 现状成文）。
- VEL5018 文案改为教拼写：`…does not declare JSX children; declare a
  'children: WebNode' prop to accept them`。

---

## 第 27 条 —— 泛型改 bind-then-check：错误报在因处

### 现状（实测）

```
def pick<T>(a: T, b: T) -> T: return a
pick(1, "x")            // 静默通过，T = number | string
const r: number = pick(1, "x")   // 错误在下游远处才爆
```

混型实参几乎总是笔误；联合静默扩散后，错误落点与病因相隔任意远。TS 对同款
形态在第二实参处报错。

### 目标语义

1. **上下文播种优先**：调用位存在期望类型且提及 `T`（绑定注解、参数位、返回
   契约）→ 先以期望播种 `T`，随后各实参按已播种的 `T` 检查。联合因此仍可显式
   表达：`const r: number | string = pick(1, "x")` 合法。
2. **无上下文时 bind-then-check**：`T` 由最左出现的固定实参绑定；后续提及 `T`
   的实参必须可赋给已绑定类型，不匹配**在该实参处**报错并点名双方：
   `Cannot assign string to T, which argument 1 bound to number`。
3. **边界明确**：List 字面量自身的元素联合推断**不变**（`[1, "x"]` 是
   `List<number | string>`，异构数据正当；charter 小联合成文）。本条只改
   「同一类型参数跨实参合并」。回调两阶段推断（D8）不变。
- charter §7 类型参数段落同步改写推断描述。
- 回归：三形态（无上下文报错在因处、上下文联合合法、List 字面量不受影响）+
  既有泛型测试全量重跑。

---

## 第 28 条 —— 五个小项（消息与文档；第 4/5 项为第五轮追加，用户已批准）

1. **静态方法里的 `self`**：现报裸 `VEL3001: Unknown name 'self'`。类名访问
   已可用（实测 `Counter.total += 1` 于 static def 内正常）。诊断升级：
   `'self' is not available in a static method; use the class name: 'Counter.total'`。
   charter §10 static 段落补一句。
4. **字段初始化器里的 `self`**（同族，第五轮实测）：`let a: number = self.b + 1`
   现报裸 `Unknown name 'self'`。设计正确（依赖初始化归构造器），消息升级：
   `'self' is not available in a field initializer; assign the field in the
   constructor`。与第 1 项同一发射面，同批实施。
5. **迭代语义分裂成文**（第五轮实测）：普通 `for` 是 **live** 迭代 ——
   `for x in items` 体内 `items.append(x)` 会被访问到（与 Python/JS 亲代一致，
   BFS 工作队列是正当用法），而回调族（map/filter/…）是快照（charter §8 已写）。
   charter §9 循环节补一句 live 语义与两者的分工；**不加诊断**（合法模式）。
2. **charter §10 构造器措辞**：现文「one explicit constructor」与实测不符 ——
   全字段有初始化器的类可省构造器（`Point()` 直接可用）。改为「至多一个显式
   构造器；全字段就绪时可省略」。默认构造器行为已正确，纯措辞。
3. **裸副作用导入**：`import "./x.vel"` 现报误导的 `Module './x.vel' has no
   export named 'default'`。副作用导入维持不支持（显式导入哲学），消息改定向：
   `Side-effect imports are not part of VelarScript; import a name, or move the
   effect into an exported function`。

---

## 批次编排（并入全局序）

- **批次 H（模块环，缺陷族）**：第 23 条。自包含的模块图分析，**排在空值拼写
  返工波提交之后、批次 A 之前** —— 缺陷优先于清理。
- **批次 I（Web 组件面）**：第 24 + 25 + 26 条，与既定批次 B（`null` 渲染 +
  `ready` 删除）合并为一个 Web 波，避免两次动同一批 web 文件。
- **第 27 条**并入批次 F（同为 analyzer 推断层）。
- **第 28 条**消息部分随其所在文件的批次走（1 随 F、3 随 H），文档部分并批次 C。

每批次三道门禁不变；批次 I 含执行级渲染回归（展开的反应式更新必须真跑浏览器）。
