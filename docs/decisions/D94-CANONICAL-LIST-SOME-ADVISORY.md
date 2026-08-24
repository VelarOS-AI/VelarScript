# D94：List 存在性查询的规范形建议（2026-08-24）

## 结论

新增 advisory `A8`：当编译器能够证明一个循环只是在 List 中寻找首个满足
条件的元素，命中返回 `true`、耗尽返回 `false` 时，提示已有的
`List.some(test)` 写法。

本裁决扩展 D93，并取代 D93 标题中“唯一规范形建议”的数量限定。D93 的
`A7` 仍只负责集合转换；`A8` 只负责可证明等价的存在性查询。普通循环风格
偏好仍不得进入 advisory 通道。

## 准入条件

以下条件必须同时成立：

1. 位于普通函数块中，是同步、单槽 `for`，来源为普通 `List` 绑定名；
2. 循环体只有一条无 `else` 的 `if`；
3. `if` 的唯一语句是字面量 `return true`；
4. 循环之后紧邻字面量 `return false`；
5. 条件的静态类型恰好为 `bool`，不是 `bool?`；
6. 条件只由字面量、绑定读取、受检数据字段读取和运算符组成。

条件中出现调用、类成员读取、等待、动态导入或其他无法证明无副作用的
表达式时保持沉默。双槽、异步、Set/Map、计算来源、更宽的循环体、`else`
或两条语句间有其他语句时也保持沉默。

## 等价性边界

原始形状：

```velar
type SchemaColumnRow:
    name: string

def hasColumn(columns: List<SchemaColumnRow>, name: string) -> bool:
    for column in columns: // velar-allow A8: this is the expanded form the decision defines
        if column.name == name:
            return true
    return false
```

规范形：

```velar
type SchemaColumnRow:
    name: string

def hasColumn(columns: List<SchemaColumnRow>, name: string) -> bool:
    return columns.some(column => column.name == name)
```

无副作用条件是必要边界：List 普通迭代读取实时长度，`some` 在调用谓词前
取得稳定快照。一个调用或 getter 可能修改来源 List，此时两种写法不保证
相同，因此不得报告。

## 抑制与修复

`A8` 与其他 advisory 一样不阻止生成，并由
`// velar-allow A8: <reason>` 管理。理由缺失或抑制过期仍是编译错误。

不注册自动编辑。改写横跨循环和紧随其后的 `return false`，直接删除整个
区间可能吞掉注释；消息给出完整的 `return list.some(...)` 写法，由作者改写
或带理由保留展开循环。

## 覆盖

- 原始 `hasColumn` 形状必须报告、继续生成，并给出完整 `some` 写法；
- 组合布尔运算和结构数据字段读取必须仍可证明；
- 调用、类 getter、`bool?`、更宽循环体、非 List、计算来源、双槽、非相邻
  返回和 `else` 均不得报告；
- 带理由、无理由和过期抑制三态必须覆盖；
- 格式化往返必须保留 `A8` 抑制及其理由。
