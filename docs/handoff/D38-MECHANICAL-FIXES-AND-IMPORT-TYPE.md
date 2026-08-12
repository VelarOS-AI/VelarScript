# D38 — 第八轮语法排查：extern 吞没、自动修复类、import type（已批准，待实施）

用户于 2026-08-12 批准。判据同 D28-D37。所有现状结论均由真编译器探针验证。

---

## 第 47 条 —— extern 成员解析失败不得静默吞没（缺陷族，归批次 F）

### 现状（实测）

```
extern module "some-pkg":
    export def render(source) -> string    // 参数缺类型

→ 零诊断（Checked 1 module）
render(12345) → VEL3001: Unknown name 'render'   // 成员被整个丢弃
```

缺类型的 extern 成员未被接受为 any，而是**静默丢弃**：声明零报错、名字消失、
错误在使用处远程引爆。逃生通道（D33 无死胡同承诺）静默漏气。

### 目标语义

- extern 成员解析失败必须**在成员处诊断**；缺参数类型 → 定向
  `extern parameters require an explicit type; there is no body to infer from`。
  解析恢复 = 跳过该成员并继续（后续成员照常），**永不无声**。
- extern def 带函数体的既有拒绝（现 VEL2003 位置正确）补原因：
  `extern declarations have no body; the JavaScript package provides it`。
- 回归：缺类型/带体/花括号错位各一条在成员处命中；同 module 其余成员不受累。

---

## 第 48 条 —— 机械修复类：recovered 指引 = 可自动修复（归批次 E + 新批次 L）

用户裁决：「这种机械问题可以扔到自动修复里面去」。

### 关键洞察

recovered guidance 机制**本来就知道正确答案**（`===` 恢复为 `==`、`fr` 恢复
`rf`、诊断即重写）。自动修复几乎白拿。

### 目标语义

1. **分号指引**（归 E）：`const a = 1;` 现报裸 VEL1001。补 VEL1005 族指引
   `Semicolons are not statement syntax; a statement ends at its newline`，
   recovered（删除分号继续）。`===`/`!`/`#` 已有同族，`;` 补齐。
2. **家族制度**（归 L）：凡 recovered 指引，其恢复重写暴露为 **LSP quick fix**
   （charter §4 invert quick fix 先例升格为制度：新增 recovered 指引默认带
   fix，实现处一并登记重写区间与替换文本）。
3. **`velar fix` 命令**（归 L）：一次性应用全部机械重写后重新检查，输出
   「applied N mechanical fixes; M diagnostics remain」。对 AI 闭环是黄金命令
   —— 编译 → fix → 只剩真问题，省一轮自愈。安全边界：只应用 recovered 类
   （确定性重写），类型错误等真问题绝不自动改。CLI 命令表无冲突（已核）。
4. 回归：分号指引命中且 fix 后字节正确；`velar fix` 对混合文件只改机械项；
   幂等（二次 fix 零改动）。

---

## 第 49 条 —— `import type` 转正 + 双向统一区分（归批次 F）

### 现状（实测）

`import type {User} from "./users.vel"` → 破损消息
`Cannot resolve VelarScript package import '': invalid package name ''`。
TS 肌肉记忆高频形态。

### 目标语义（用户裁决：支持，并统一区分写法）

Vel 的类型是带验证器的值（`User.parse`），该区分在 Vel 有三层真语义：

1. **语法**：`import type {User, Status as S} from "./x.vel"` 合法；
   `export type {User} from "./x.vel"` 再导出同理。**行内混写拒绝**
   （`import {loadUser, type User}` → 指引拆两行）—— 一个明显拼写。
2. **检查**：type-import 的名字只可用于类型位；用于值位（`User.parse`、
   `value is User`、传参）→ 定向 `runtime validation needs the value import;
   drop 'type' from the import`。
3. **模块环放行**：type-only 边不参与初始化顺序 —— D31 第 23 条的模块环
   检查忽略纯 type-import 边；跨模块互递归类型的豁免从隐式特判升格为显式
   拼写（原特判保留兼容普通导入的既有合法形态）。
4. **发射**：仅被 type-import 的模块若无其他值边，运行时 import 整个省略
   （验证器不落包）。
5. **双向统一规则**（「统一区分一下写法」）：普通导入的名字若**全部用途都在
   类型位** → 诊断教 `import type`；`import type` 名字用于值位 → 反向教。
   两个方向都是确定性重写 → **进第 48 条自动修复类**（`velar fix` 一键翻转，
   编辑期用途变化零烦恼）。
6. 迁移：全仓按双向规则归位（门禁找站点）；AI 简报补一行；charter §12 成文
   （含「类型即验证器值，故 type-import 是真语义而非擦除标记」一段）。
7. 回归：type-import 类型位可用/值位定向拒绝、混写指引、type-only 环放行
   （互递归类型两模块 + 显式 import type）、发射省略断言、双向规则各命中、
   fix 翻转幂等。

---

## 第八轮正面清单（记档防重查）

显式泛型实例化 `pick<number>(...)` → VEL2031 教学典范；缺省参数后必需参数
VEL2016；缺 `super` 定向；`readonly number` 完整边界教学；`component Grid<T>`
VEL2025；枚举重复运行时值 VEL4014 点名双方；裸 `assert cond`（无 else）合法；
跨枚举单例联合合法（协议场景正当）。

## 批次归属汇总

第 47 条 → F；第 48.1 → E；第 48.2/48.3 → **新批次 L**（LSP + CLI，排 K 后）；
第 49 条 → F。全局序更新：J（在途）→ A → K → E/F → **L** → I+B → G → C/D。
