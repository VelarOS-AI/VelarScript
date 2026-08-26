# D96 — Map 原子取值或写入

## 问题

`Map.get(key)` 返回 `V?`，这是普通读取的正确契约。但当 `V` 本身是集合时，常见
的分桶写法会先检查 `null`，再使用收窄后的集合：

```velar fragment
const bucket = buckets.get(key)
if bucket == null: buckets.set(key, [value])
else: bucket.append(value)
```

VelarScript 会在每次依赖收窄事实的读取处重新验证集合。这个规则负责在不引入跨
函数副作用分析的前提下捕获陈旧事实，不能为了性能直接削弱；但上面的分桶会反复
遍历持续增长的 List，使本应为 O(n) 的构建退化为 O(n²)。OpenVoxel 世界生成的
表层与特征计划已经实际触发了这个量级差异。

## 裁决

Map 增加一个受检的可变成员：

```text
getOrSet(key: K, fallback: V) -> V
```

- 键已存在时，返回已有值，不覆盖它。
- 键不存在时，写入并返回 `fallback`。
- `fallback` 遵守普通函数实参规则，会在调用前求值。
- 返回类型直接是 `V`，不建立可空流事实，也不生成深度收窄守卫。
- 它会改变 Map，因此不能通过 `readonly Map<K, V>` 调用。
- 新键的响应式跟踪、父子链接和结构更新与 `Map.set` 使用同一运行时语义。

规范分桶写法变为：

```velar fragment
const buckets: Map<string, List<Write>> = Map()
buckets.getOrSet(stage, []).append(write)
```

这不是 `get(key, fallback)` 的第二种读取契约。后者仍由 `get(key) ?? fallback`
表达；`getOrSet` 的名字明确声明了缺失时会修改 Map。

## 验证

- 编译器检查键、回退值、命名参数和 readonly 边界。
- standalone 与共享运行时都只调用一个编译器拥有的 helper。
- 运行测试覆盖命中不覆盖、缺失插入、返回同一对象和响应式新增键。
- 性能门覆盖 10 万条数据分配到 256 个 List 桶，保证分桶保持线性。
