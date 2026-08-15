# D58 — `-> null` 只写在推断不到的位置（用户裁决 2026-08-15）

用户原话：「返回 null 尽量不写」。

---

## 现状（实测，非推断）

**两种拼写今天都合法**，这是一处摆在明面上的规则 3 违反：

```
export def log(m: string):            → clean
export def log(m: string) -> null:    → clean
```

charter:1058 明写「A body-backed function, method, or Web action **may** omit
its result annotation」—— 所以这不是缺陷，是**设计上允许的二选一**，
而二选一正是本项目一路在消灭的东西。

### `-> null` 强制的位置（没有函数体可推断）

| 位置 | 省略的后果 |
|---|---|
| `abstract def close()` | VEL4023 requires an explicit result annotation |
| `extern module` 内的 `export def sync(p)` | VEL4023 requires an explicit result annotation |
| 类型表达式 `type H = (n: number) -> null` | 语法层报错（VEL2001） |

**这三处已经有诊断在教「必须写」，方向已封闭。**

### 可省略的位置：85 处

`def` / 方法 / 箭头函数 / Web action —— 全部可省。分布：
**examples/ 69 处（该目录退役在即）、packages/ 16 处**，
另有 docs 35、AI 简报 4、`velar create` 模板 2。

### 递归不构成例外（实测）

charter:1064 提到「recursive result dependencies are solved to a fixed point;
a recursive group whose result cannot converge must add an explicit annotation」，
本来可能逼出一个必须写 `-> null` 的函数体位置。**实测不会**：

```
def walk(n: number):        自递归        → clean
def a(…) / def b(…)         互递归        → clean
class T: def walk(…)        方法自递归    → clean
```

**所以「有函数体」与「必须写」之间没有交集**，这条可以是硬规则而不是软偏好。

---

## 第 139 条 —— `-> null` 只写在没有函数体可推断的位置

**有函数体的声明位一律省略；`extern`、`abstract`、类型表达式一律写。**
在有函数体的位置写 `-> null` 予以拒绝，`velar fix` 机械删除。

### 为什么是 `-> null` 而不是所有标注

不能由此推出「凡可推断的标注都该省」—— `-> string` 必须保留可写，
它是**给调用者的契约**。两者的区别是**信息量**：

- **每一个别的标注都命名一个调用者能用的东西。** `-> string` 告诉调用者他拿到什么。
- **`-> null` 命名的是「没有东西」** —— 而调用者不用返回值时，本来就得到同样的信息。
  **它是唯一一个「写了等于没写」的标注。**

这条线是所有者划的；由它推出「拒绝而非仅仅不推荐」的是规则 3。
**如实标注这个分工**，与 D52 第 114 条对 `Text.` 的处理同一做法。

### 为什么是拒绝，不是「尽量不写」

因为**主要作者是 AI**。软偏好在人类团队里能靠 code review 收敛，
在 AI 写码的场景下只会产出**两种拼写混在同一个仓库里** ——
而使命的另一半是**人来读**，混用正是让阅读变难的东西。

「尽量」写进语言规格会变成两件事之一：变成「一律」，或者变成噪音。

### 诚实记录：本条确实丢掉一样东西

今天 `def f() -> null: return 2` 报 `VEL4001 Cannot assign number to null` ——
`-> null` 是个**真契约**，它禁止函数体返回值。本条之后这段合法，
签名静默变宽为 `-> number`。

**接受该代价**，理由：charter 对**所有**返回标注都已接受这个性质
（省略 `-> string` 同样让签名随函数体走），`-> null` 在这一点上并不特殊；
而为它单独保留一个例外，换来的是全语言最常见的那个标注有两种拼写。

---

## 落地要求

1. **拒绝诊断**：有函数体的声明位上的 `-> null`，在标注处拒绝并教删除。
2. **`velar fix` 机械删除** —— 删掉一个与推断结果完全相同的标注是**可证等价**的，
   符合 D50 第 95 条的入族判据。双向幂等。
3. **迁移**：packages/ 16 处、docs 35 处、AI 简报 4 处（双份逐字节一致、≤750 行）、
   `velar create` 模板 2 处。**examples/ 的 69 处不迁** —— 该目录整体退役（D56）。
4. charter:1058 那段补一句：省略不是可选风格，`-> null` 位是**必须**省略。
5. **回归**：三个强制位仍要求写、有函数体位拒绝、`velar fix` 幂等、
   派生类与基类一个写一个不写的互操作情形（今天 clean，之后应统一被拒）。

## 排期

**必须先于 D56 的展示正文落地** —— 否则展示会按旧风格写出 `-> null`，
然后立刻要返工。与波 J1 有文件冲突（同在 `packages/compiler/**`），
**排在 J1 之后**。
