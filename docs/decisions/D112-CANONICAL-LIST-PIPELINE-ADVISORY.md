# D112：List 查询、筛选与投影的规范 API 建议（2026-09-04）

## 结论

扩展 Core advisory `A8`，使精确的提前返回循环除了 `some` 之外也能提示
`every` 和 `find`。同时新增 Core advisory `A13`：当编译器能够证明“相邻的空
List 声明 + `for`”只是在把一个 List 做逐项投影、扁平投影，并可选地先用
一个纯布尔条件筛选时，提示已有的 `map`、`filter`、`flatMap` 或组合管线。

这不是“所有循环都应写成链”的风格规则。它只覆盖集合 API 已经完整表达、且
编译器能证明等价的无状态数据变换；修改元素、提前退出、多路输出、有状态聚合和
副作用仍使用 `for`。

## 准入条件

以下条件必须同时成立：

1. 目标是紧邻循环声明的空 `List`，来源是普通 List 绑定或由静态记录数据字段
   构成的稳定路径；
2. 循环同步，循环体只有一次写入目标 List 的 `append` 或 `extend`；无 guard 时
   可使用第二槽索引并改写为 `(value, index)` 回调，有 guard 时仍限定单槽；
3. 可选筛选只能是一条无 `else` 的 `if`，条件类型恰好为 `bool`；
4. 条件和投影只读取普通绑定、稳定数据字段、字面量和运算符；
5. 投影中唯一允许的调用是编译器拥有且已通过静态检查的
   `Target.from(value)`；
6. 条件和投影都不能读取正在构造的目标 List。

当循环对目标调用 `extend` 而不是 `append` 时，对应的规范投影是 `flatMap`；
它接受的表达式证明边界与 `map` 相同。

普通函数调用、class getter、索引读取、await、计算来源、带 guard 的双槽循环、
第二条循环体语句、目标状态依赖及任意其他副作用都保持沉默。目标扩展可以通过
编译器协议证明自己的值表达式；Web 只放行无即时写入的原生 JSX 构造。

## 规范写法

<!-- velar-preamble
type BlockChange:
    changed: bool

type BlockChangeBatch:
    changes: readonly List<readonly BlockChange>

type RealtimeBlockChange:
    changed: bool

type ChunkDelta:
    value: number

type RealtimeChunkDelta:
    value: number
-->

```velar fragment
def realtimeBlockChanges(batch: readonly BlockChangeBatch) -> List<RealtimeBlockChange>:
    return batch.changes
        .filter(change => change.changed)
        .map(change => RealtimeBlockChange.from(change))

def realtimeChunkDeltas(deltas: readonly List<readonly ChunkDelta>) -> List<RealtimeChunkDelta>:
    return deltas.map(delta => RealtimeChunkDelta.from(delta))
```

当 append 的就是循环槽本身时，筛选形只提示 `filter`，不会生成多余的 identity
`map`。不带筛选的 identity copy 继续由 A7 负责并提示 `List.copy()`。

## A8 查询扩展

A8 原有的 `if predicate: return true` / `return false` 形状保持不变，并增加：

- `if not predicate: return false` / `return true` → `every(predicate)`；其他纯条件
  会规范地取反为 `every(item => not (condition))`；
- `if predicate: return item` / `return null` → `find(predicate)`。

三种查询共用原有严格边界：普通 List 名、同步单槽循环、唯一无 `else` 条件、
相邻耗尽返回、精确 `bool` 条件和纯数据表达式。A8 因此是一类“提前返回 List
查询”，而不是只绑定 `some` 的特殊检查。

## 等价性边界

VelarScript 的 List 管线读取输入快照，而 `for` 迭代观察实时集合。A13 因此必须
排除可能修改来源的调用和 getter。`Target.from` 是例外，因为它是编译器拥有的
纯记录投影：只按目标字段表读取已有数据字段并构造新记录，不执行用户代码。

## 抑制、修复与覆盖

A13 不阻止生成，并由 `// velar-allow A13: <reason>` 管理。无理由和过期抑制仍是
编译错误。

在替换区间没有注释时，A13 提供编辑器机械修复：把空初始化和循环折叠成集合
管线；存在注释时只报告建议，避免删除作者文本。

覆盖必须包含：`some`/`every`/`find`，纯 `map`、稳定字段来源上的
`filter(...).map(...)`、identity `filter`、`flatMap`、机械修复、注释保留、
抑制三态，以及调用、getter、目标读取、宽循环、计算来源和双槽循环的静默边界。
