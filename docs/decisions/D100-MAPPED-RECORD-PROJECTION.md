# D100：具体记录拥有同名字段映射构造（2026-08-26）

## 结论

具体记录类型新增编译器拥有的 `Target.mapFrom(source, transform)`。它用于两个
记录拥有相同语义字段、但字段值需要统一转换的场景：

```velar
type Slots<T>:
    air: T
    water: T

type IdentitySlots = Slots<string>
type RuntimeSlots = Slots<number>

const identities: IdentitySlots = {air: "air", water: "water"}
def resolveRuntimeId(key: string) -> number: return key.size

const runtimeIds = RuntimeSlots.mapFrom(identities, resolveRuntimeId)
```

目标记录的字段表仍是字段集合、可选性和结果顺序的唯一权威。调用者不需要把
同一批字段手写成循环、动态 `Record`，再通过 `Type.parse` 恢复静态类型，也不
需要为每个字段重复同一转换调用。

## 静态契约

1. `mapFrom` 只属于具体记录 Type，包括已命名的具体泛型实例；
2. `source` 必须具有静态已知的记录形状，`unknown` 和 `any` 必须先验证；
3. 目标的每个必填字段必须在来源中存在同名必填字段；
4. 转换函数接收所有被读取来源字段类型的联合，其结果必须可赋值给目标的每种
   字段类型；
5. 来源多余字段不读取，缺失的目标可选字段省略；
6. readonly 来源字段以原有 readonly 数据视图进入转换函数。

该能力面向字段值同质的记录家族。转换函数不接收字段名，也不建立“字段名决定
输入输出类型”的依赖类型关系。需要按字段采取不同逻辑时继续使用显式构造。

## 求值与运行时边界

两个参数按调用处书写顺序各求值一次，之后按目标声明顺序逐字段映射。每个来源
字段读取一次，每个存在字段调用转换函数一次。

运行时只接受来源的 own enumerable data descriptor。访问器、非枚举字段、缺失
必填字段和非记录来源失败关闭。写入继续复用记录字段数量上限、特殊字段防护、
空值归一化与响应式读取路径。

## A10

当完整目标记录至少包含四个字段，且每个字段都严格写成
`field: transform(source.field)` 时，A10 推荐
`Target.mapFrom(source, transform)`。证明要求所有字段使用同一个普通来源绑定、
同一个普通转换函数绑定，并且原属性顺序已经等于目标声明顺序。最后一条保证转换
函数存在副作用时，改写也不会改变调用顺序。

少量字段、字段重排、混合来源、混合转换、复杂 callee、spread 与不完整目标保持
安静。

## 覆盖

- 泛型记录家族从 `string` 到 `number` 的映射与目标顺序；
- 命名参数的书写求值顺序；
- 缺失字段、不可信来源和转换结果不兼容诊断；
- 格式化往返和专用运行时 lowering；
- A10 正例、机械修复、注释保留、抑制及各静默边界。
