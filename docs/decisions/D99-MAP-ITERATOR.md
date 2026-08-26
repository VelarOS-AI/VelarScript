# D99：Map 增量迭代游标

状态：已采用

## 问题

`Map.keys()` 的既有契约是返回一份完整 `List<K>` 快照。这个契约适合排序、转换、
传参和重复读取，但只想取得插入顺序中的下一项时会复制整个键集合。LRU 淘汰之类
的调用只能写成只执行一次的 `for` 循环，性能正确，但意图不够直接。

## 裁决

增加 `Map.iterator()`。它创建一个按插入顺序读取 key 的实时游标；游标只公开
`next()`，每次最多前进一步：

<!-- velar-preamble
const entries: Map<string, number> = Map([["first", 1]])
-->
```velar fragment
const cursor = entries.iterator()
const item = cursor.next()
if item != null:
    entries.remove(item.value)
```

`next()` 返回 `{value: K}?`，而不是直接返回 `K?`。外层 `null` 只表示耗尽；
`{value: null}` 是一个真实的可空 key，因此 `Map<K?, V>` 不会丢失表达力。游标耗尽
后永久返回 `null`。

游标采用与单槽 `for key in map` 相同的实时 Map 迭代规则：删除尚未到达的 key 会
跳过它，新增 key 会在后续被看到。它不复制 Map，也不改写插入顺序。

## 边界

- `keys()`、`values()` 和 `entries()` 继续返回完整 List 快照。
- 不增加 `removeFirst`、`popFirst` 或 LRU 专用 API。
- 不把 `next()` 变成全局函数，也不把普通类中同名方法识别成 `@iterate:`。
- 这一轮只开放 Map key 游标；其他集合需要独立的真实用例后再扩展。
