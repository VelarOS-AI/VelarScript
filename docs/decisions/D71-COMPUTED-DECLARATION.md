# D71 — `computed` 成为声明，与 `state` 对齐（用户裁决 2026-08-16）

---

## 第 182 条 —— 反应层的四格网格

### 用户的话

> 重新用 `state` 声明一个响应式变量不行吗，和 `let` 的用法一致

**这句话把整件事说清楚了。** `state` 今天已经是 `let` 的形状（实测：
`=`、`+=`、带标注全部成立）。缺的是另一半：

| | 不反应式 | 反应式 |
|---|---|---|
| **可写** | `let` | `state` |
| **只读 / 派生** | `const` | **`computed`** |

**`state` 之于 `let`，正如 `computed` 之于 `const`。**
今天只有三格填着语言构造，第四格填的是一个库形状。

```velar
state count = 0
computed doubled = count * 2      ← 与 count 同形，裸读
```

### 今天的形态是实现漏到了表面

```
computed doubled = count * 2
→ VEL5055: computed is a function that returns a derived accessor,
           not a declaration keyword
```

**语言在明确地强制这个不对称**，而它的理由是实现事实
（`computed(…)` 确实返回一个访问器）。**而最高原则是「框架可以任意复杂，
对外必须简单」** —— 实现形状不是表面不对称的理由。

`state` 已经证明反应式来源可以是声明。**`computed` 是那个异类。**

### 它从源头消掉 D69 的陷阱

D69 那个 `watch total:` 不是作者粗心 —— **它是被这个不对称制造出来的**：
一个从 `state` 学会「反应式的东西直接读」的作者，
碰到 `computed` 时被要求改用调用，于是漏掉括号。

声明化之后 `watch doubled:` **自然就是对的**。

**D69 的规则仍然需要**（`watch 5:`、`watch someConst:` 还是死的），
但它最可能命中的那个真实笔误蒸发了。**这是设计修复优于诊断修复的一个实例**：
诊断在错误发生后教你，设计让错误不发生。

---

## 第 183 条 —— 迁移：21 个站点，一处能力要换拼写

### 面（实测）

`examples/` 与 `docs/` 共 **21 处** `computed(`。**很小。**

### 一处真实的不等价，我查过了

**(a) 跨模块导出今天要显式写访问器类型**：

```
export const openTasks: () -> number = computed(...)        ← 今天
export computed openTasks = tasks.filter(…).size            ← 之后
```

导入方从 `openTasks()` 变成裸读 `openTasks`。
**机制现成** —— `export state` 的跨模块反应式裸读今天就在工作
（官网的 `siteLocale` 正是如此）。

**(b) 访问器可以当函数值传，实测通过**：

```velar
export def show(read: () -> number) -> string:
    return str(read())

const doubled = computed(() => count * 2)
show(doubled)          ← 今天合法
```

声明化之后 `doubled` 是 `number` 不是 `() -> number`，**这个写法不再成立**。

**但能力没有丢**：要给别人一个「活的读取器」，写 `() => doubled` ——
一个 lambda，**对 `state` 同样适用**，所以它是这件事的**通用**拼写，
而不是 `computed` 的特例。而在 Web 里，给子组件活值的正路本来就是 **prop**
（prop 是反应式投影）。

**实施要求**：迁移前**穷举仓内「把 computed 结果当函数值传递」的真实用例**，
逐个记录改法。若发现某个用例 `() => x` 与 prop 都覆盖不了，
**停下来上报** —— 那才是真正的能力损失。

### `velar fix` 能做多少

`const x = computed(() => E)` → `computed x = E`，以及 `x()` → `x`：
**在 `x` 从不被当作值传递时可证等价**。传递用例不可机械改写。

**所以这是两类修复**（与 D58 更正二同一条纪律）：机械的那部分进 `velar fix`，
需要判断的那部分只给诊断。**不要让 `velar fix` 去改它证不了的东西。**

---

## 实施要求

1. `computed name = <expr>` 成为 web 扩展的**声明形式**，与 `state` 同一套解析路径。
2. **裸读**，与 `state` 同形；不可赋值（它是派生的，赋值应报错并说明）。
3. 三种作用域与 `state` 一致（模块级 / 组件级 / 块级）—— **实测确认 `state`
   的三种作用域，`computed` 逐一对齐**。
4. **跨模块**：`export computed` 的裸读，机制照 `export state`。
5. `computed(…)` 的**函数形态退役**，给迁移诊断（VEL5055 的反向：
   现在教「写 `computed x = E`」）。
6. `watch` 与 D69 一并处理 —— 声明化之后 `watch doubled:` 合法，
   D69 的规则只剩字面量与非反应式 const。
7. charter §15、简报、展示 `03-state-and-derived.vel` 全部更新；
   **展示要把四格网格并排写出来**（`let`/`const`/`state`/`computed`），
   因为那正是这条裁决要教会读者的东西。
8. `readonly` 与 `computed` 的关系：`computed` 派生值是否自动 readonly 投影？
   **实施者调查后上报**，不要默认。

## 排期

**排在波 R1、D69、D70 之后** —— 四者同在 `packages/web`。
D69 的实现要等本条，否则它会去诊断一个即将不存在的形态。
