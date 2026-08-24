# D93：集合转换的唯一规范形建议（2026-08-24）

## 结论

新增 advisory `A7`：当编译器能够证明“空集合声明 + 紧随其后的循环”只是在
逐项复制另一个集合时，提示现有的集合快照或构造写法。

这条裁决只在一个窄点上扩展 D89。D89 的 `A1`–`A6` 负责“外语反射被 Vel
静默接受成另一种意思”；`A7` 不属于那一类，它的代码语义正确，但存在一个
由编译器拥有、完全等价且唯一的集合转换写法。普通风格偏好仍然不得进入
advisory 通道。

## 准入条件

以下条件必须同时成立：

1. 目标是刚声明的空 `List`、`Set` 或 `Map`，循环与声明相邻；
2. 来源是一个普通绑定名，不是调用、getter 路径或任意表达式；
3. 循环体只有一条受检集合调用：`append`、`add` 或 `set`；
4. 写入值就是循环槽本身，没有变换、过滤、重排或额外副作用；
5. 替代写法创建新的集合并保持同一迭代顺序。

任何非空目标、间隔语句、计算来源、条件、变换或第二条循环体语句都保持
沉默。这条界线让提示成为证明结果，而不是 lint 猜测。

## 规范写法

| 目标 | 来源 | 写法 |
| --- | --- | --- |
| `List` | `List` | `source.copy()` |
| `List` | `Set` | `source.values()` |
| `List` | `Map` / `Record` 的键或值 | `source.keys()` / `source.values()` |
| `Set` | `List` | `Set(source)` |
| `Set` | `Set` | `source.copy()` |
| `Set` | `Map` / `Record` 的键或值 | `Set(source.keys())` / `Set(source.values())` |
| `Map` | `Map` | `source.copy()` |
| `Map` | `Record` | `Map(source)` |

用户提出的原始形状因此变成：

```velar
def sortedValues(values: readonly Set<string>) -> readonly List<string>:
    return values.values().sorted()
```

## 抑制与修复

`A7` 与其他 advisory 一样不阻止生成，并由同一套
`// velar-allow A7: <reason>` 规则管理：理由缺失或抑制过期仍是编译错误。

不注册自动编辑。这个改写横跨声明与循环，自动删除整个区间可能吞掉两者间
的注释；消息点名唯一初始化表达式，由作者改写或带理由保留展开循环。

## 覆盖

- 原始 `Set -> List -> sorted` 形状必须报告且继续生成；
- `List`、`Set`、`Map`、`Record` 的相邻规范转换逐项覆盖；
- 变换、过滤、副作用、非空目标、非相邻循环和计算来源不得报告；
- 带理由、无理由和过期抑制三态必须覆盖；
- 格式化往返必须保留 `A7` 抑制及其理由。
