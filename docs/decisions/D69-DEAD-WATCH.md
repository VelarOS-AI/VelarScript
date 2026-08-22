# D69 — `watch` 的主语必须能变（用户上报 2026-08-16）

---

## 第 178 条 —— 一个永不触发的 `watch` body 是被静默丢弃的语句

### 实测（我复验，四种形态全部编译干净）

```
export component App:
    state count = 0
    const total = computed(() => count * 2)

    watch total:          ← 裸 computed 引用：函数身份不变，body 永不执行
    watch 5:              ← 字面量
    watch "x":            ← 字面量
    watch count:          ← 正确：state 是反应式的
```

`velar check` → `Checked 1 module`，**退出码 0，零诊断**。
模块级 `watch frozen:`（`const`）与 `watch total as now, before:` 同样通过。

正确写法是 `watch total():` —— **语言仓自己的测试就是带括号的**。

### 矛盾比表面更锋利

语言**已经有**这条规则，而且执行得很严：

```
5                  →  VEL4030 This expression result is discarded; call a function, assign…
x == 5             →  VEL4030 This comparison result is discarded; use '=' to assign…
```

AI 简报第 188 行写着：**「A computed-and-discarded value is a compile error」**。

**于是：同一个表达式，单独写是编译错误，当 `watch` 主语就合法 ——
而且当主语时它还拖着一整个永不执行的块。** 严格的那一侧被拒，宽松的那一侧通过。

**这不是缺一条新规则，是一条已有的规则够不到一个位置。**
与本仓这两天反复撞到的是同一族。

### 裁决：`watch` 的主语必须读到至少一个反应式来源

| 主语 | 处置 |
|---|---|
| `state` 绑定 | ✓ |
| `computed(...)` 的**调用**（`total()`） | ✓ |
| 组件 prop | ✓ |
| 反应式字段路径（`tasks[0].done`） | ✓ |
| `resource` 的字段（`.value`/`.loading`/…） | ✓ |
| **字面量**（`5`、`"x"`、`true`） | **拒绝** |
| **非反应式 `const`** | **拒绝** |
| **裸可调用引用**（`total`，未调用） | **拒绝** |

### 诊断要分两种，因为出错原因不同

1. **主语是 computed/可调用但没调用** —— 这是最可能的真实笔误，
   **点名正确拼写**：`watch total:` → 「写 `watch total()`」。
   这正是语言承诺的那种诊断（每个错误拼写得到一条命名唯一正确拼写的诊断）。
2. **主语根本不可能变**（字面量、普通 const）——
   说清「这个主语永远不变，所以 body 永不执行」，不要假装有个拼写能修好它。

**两种都要拒**，但**给同一条消息是错的** —— 第一种有正确拼写，第二种没有。

### 已核对：展示与简报没有写错

`examples/tour/web/03-state-and-derived.vel`、`04-resources-and-actions.vel`
与 `docs/ai-skill.md:514` 里的 `watch` 主语全是 `state` 绑定
（`visits`、`query`、`userId`、`tasks[0].done`、`id`）—— **都是合法的反应式来源**。
本条不需要迁移，**但落地后要往展示补上「被拒的形态」的对照**，
否则覆盖率门禁看不见这条规则。

### 边界内穷尽：同族的其余位置一并核

落地时要逐个核，并把结论写进报告（不是只修 `watch`）：

- `computed(() => 5)` —— 无反应式依赖。**它不是死的**（求值一次），
  但它是不是也该被拒？**这条要给出判断与理由，不要默认跳过。**
- `resource name: T = load(input)` —— `input` 非反应式时，
  `resource` 是不是永不 reload？与本条同型。
- `watch` 带 `as current, previous` 的形态 —— 实测同样通过，随主规则一起修。

## 归属

`packages/web`（`watch` 是 web 扩展的构造），charter §15 补一句，
展示补被拒形态的对照。

**排在波 R1 之后** —— 它正持有 `packages/web/src/analyzer.ts`。

---

## 结论被 D90 R15 取代（2026-08-22）

**以上原文一字不改。** 第 178 条记录的缺陷仍然成立：一个永不触发的 `watch` body
是被静默丢弃的语句；「诊断要分两种，因为出错原因不同」这个判断同样成立，只是被
加细了一层。

**被取代的只有它给出的那个正确拼写。** 第 23 行写「正确写法是 `watch total():`」，
第 58 行又把它定为第一种诊断该点名的拼写 —— 那是 `const total = computed(() => …)`
的年代。此后 D71 把 `computed` 变成声明、把函数形态改名 `cached`，D90 R15 两半
一起落地：

- **R15(a)** 主语收敛为「一个 `state` 或 `computed` 的名字，或从它出发的读取
  路径」，**调用不再是合法主语** —— `watch total()` 本身现在也被拒。
- **R15(b)** `cached` 整个删除。它的类型 `() -> T` 与任何零参函数无法区分，
  编译器因此看不出「这是个派生值」 —— **本条这个死 watch 正是这么来的**。

于是今天只有一条路，没有第二条：

```
state count = 0
computed total = count * 2

watch total:
    print(total)
```

### 「分两种」落成三条，成因各不相同

| 被拒的主语 | 码 | 消息里有没有替代拼写 |
|---|---|---|
| **裸读取器**（零参函数的名字） | `VEL5064` | 有，且点名**声明**：`computed name = reader()`，然后 `watch name:` |
| **永不可能变**（字面量、普通 `const`，以及只由它们搭起来的表达式） | `VEL5064` | **没有** —— 没有哪个拼写能修好它 |
| **主语是计算**（出现运算符或调用） | `VEL5071` | 有，引用作者写的那个表达式，并给出替换它的 `computed` 行 |

第一种正是本条那个笔误今天的落点：消息指向**声明**，不再指向那对括号。

**先问「能不能变」，再问「是不是计算」**，所以一个形状永远只拿到一条消息。
实测 `watch a + b:`（`a`、`b` 都是普通 `const`）只报 VEL5064，不叠加 VEL5071。

本条当年教的那个形状 —— `watch total():`，`total` 是已声明的 `computed` ——
由既有的 `VEL5063` 自己回答：它是派生值不是读取器，裸读即可，去掉那对括号之后
主语直接合法，所以形状规则不再叠上去。与冻结先问是同一个理由。

### 本条对展示的要求仍然有效，且已满足

`examples/tour/web/03-state-and-derived.vel:150-156` 在 `DerivationVersusEffect`
上方并排列出三种合法主语（`computed` 名、`state` 名、读取路径）与「永不可能变」
和「主语是计算」这两种被拒的形状；`:189-190` 在 `DerivedAndCallable` 上方列出
剩下那一种（裸读取器 `watch readDoubled:`）—— 读取器只有在那里才有一个真实的
声明可指。
