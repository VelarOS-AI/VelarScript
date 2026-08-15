# Codex 报告 —— 批次 K：并行异步 + 常驻命名空间 + 失败所有权收口

## 交付状态

- 基线：`226280f feat: merge the web vocabulary wave (batch I)`
- 分支：`codex/batch-k`
- worktree：`/Users/mac/Documents/velar-batch-k`
- 任务项 1、2、3、5、6、7、8 已实现；任务项 4 因规格没有错误码名册与编码规则，未擅自发明，详见“待裁决”。
- 新回归集中在 `tests/hardening-batch-k.test.ts`，9/9 通过。

## 逐项结果

### 1. D35 `Promise.all` 记录聚合与 `race` 联合

已完成。

- `Promise.all({name: Promise<string>, count: Promise<number>})` 推断为
  `Promise<{name: string, count: number}>`；空记录解析为空记录。
- 运行时只读取 own enumerable data fields，不触发 accessor，不接受 symbol 字段，
  并构造同字段的 null-prototype 结果记录。
- `List<Promise<T>>` 同构形态保留；混合结果 List 改为教学命名字段记录。
- `Promise.race(List<Promise<A> | Promise<B>>)` 返回 `Promise<A | B>`，联合可继续收窄。
- 自动生成的 `velar/async` 依赖进入编译器运行时模块清单，CLI 的 unbundled Node
  构建会物化模块，不再出现“生成代码有 import、产物没有 subpath”的断链。

### 2. D35 常驻命名空间与 prelude

已按任务书的明确 roster 完成。

- Core：`Json.parse/stringify/stableStringify/clone`；
  `Promise.all/race/sleep/timeout/retry/map/series`；prelude `range`。
- Web：注册现有完整 Look builder roster 到 `Look.*`，未发明新成员。
- `Promise<T>` 类型位与 `Promise.*` 值位同文件共存；`Look` 同理。
- 它们是普通词法绑定，不是保留字；局部同名绑定自然遮蔽常驻值。
- 纯成员的旧具名导入已退役并给出直接拼写；`range` 旧导入给出 prelude 指引；
  `http` 等能力模块仍要求显式 import。
- 编译器自动 import 的 `velar/json`、`velar/async`、`velar/look`、
  `velar/collections` 同时登记为运行时模块，Node 与 Web 构建均能物化。
- `JSON`、`Object`、`Array`、`Math`、`String` 亲代拼写得到定向 VelarScript 指引；
  AI skill 两份逐字节一致。

双拼写裁决：D35 已明确“一种拼写”，因此任务 roster 内的纯成员采用“常驻拼写为
唯一拼写、旧 import 报迁移诊断”；能力模块不变。不存在自行保留兼容别名。

### 3. D39-52 Core Duration

已完成。

- `ms`/`s` 与 `Duration` 提升到 Core；Web 再导出同一个类型契约。
- Core 支持 Duration 加减、正负号与数值缩放，执行结果保持 Duration 值。
- `Promise.sleep/timeout/retry` 与 Web `after/every` 接受 Duration；裸 number 在类型检查
  处失败并教单位拼写。
- 执行回归覆盖 `1ms + 2ms` 进入 sleep、Web 定时器与 Look 动画使用 Core Duration。

### 4. D39-55 stdlib 错误码

未实现，原因是批准文本只有“官方 Error 家族带稳定 readonly `code: string`”这一
原则，没有给出：错误家族 roster、每个既有抛错到 code 的映射、code 字符集/前缀、
同一 code 的参数化边界、原生 `TypeError`/`RangeError` 是否改造，以及跨 Core/Web/Node
的版本与兼容规则。实现任一套都会新增外部可依赖协议，违反任务书“不擅自发明”。

### 5. D41-63.3 math 双拼写

已完成。

- 从 `velar/math` 类型表和运行时删除 `isFinite`、`isInteger`。
- 裸函数与旧 import 均指向 `value.isFinite()` / `value.isInteger()`。
- 示例、文档和测试已迁移；未保留兼容导出。

### 6. ASY-D1 组合子失败所有权

已完成。

- `race` 赢家结算后的失败、`timeout` 超时后的原任务失败、`all` 首败后的其他失败，
  都进入既有 detached 运行时报告通道；无运行时注册表时保持响亮 stderr 兜底。
- `map` 采用“首败后停止领取新项”的处置；已启动 worker 仍属于聚合 Promise，其他
  worker 的后续失败由同一 loser 观察逻辑上报，不成为无主副作用。
- 执行回归覆盖 race、timeout、all 的晚失败报告，以及 map 首败后实际启动数停止在
  已领取的并发项。

### 7. MIG-1(ii) validator narrowing

已完成。

- `if Kind.is(raw):` 真分支把稳定位置收窄为枚举 Kind。
- `if User.is(raw):` 对记录 Type 同样建立运行时验证后的真分支事实。
- 普通词法解析仍决定 `Kind`/`User` 所指对象，没有按名字伪造收窄。

### 8. MIG-2 导出 computed 契约

已完成。

- 未标注的 `export const name = computed(...)` 在导出处报告 `VEL4025`。
- 诊断直接教学 `export const name: () -> T = computed(...)`。
- 示例中的公开 computed 已迁移；显式类型形式通过。

## 迁移与文档

- README、标准库/Web 文档、create 模板、实际 examples、测试 fixture 与 AI skill 已迁移。
- charter 增加 `Core permanent namespaces and durations` 小节。任务同时退役了旧纯导入，
  文档门禁会编译旧 charter 代码块，因此只对旧代码块做了相应机械迁移；未重写旧章节
  结构或另行设计规则。
- 四个实际示例项目均检查、Node 测试和三浏览器测试通过。

## 待裁决

1. **错误码协议（阻塞任务项 4）**：建议先发布一份权威表，至少固定
   `module/error-family -> code`、code 格式、原生错误的处理、版本策略；随后单独实施并
   对每个 code 做执行级回归。没有这张表不应让实现者先造事实标准。
2. **D35 与本任务 roster 的文字冲突**：D35 写 `velar/json 全量`，并要求
   `velar/text` 最终方法化清空；本任务却把 Json 常驻成员明确限定为四个，且没有列入
   Text 迁移。当前按更具体的任务书执行：`tryParse/isSerializable/deepEqual` 仍是模块
   导入，`velar/text` 未退役。建议明确选择：
   - 更新 D35，把 Json 常驻面钉为四个并说明其余纯函数归属；或
   - 给出全量常驻/方法化 roster，另开迁移批次。

## 门禁

### `npm run check`

通过。尾部：

```text
Checked 53 formatted VelarScript source files
Checked 153 VelarScript documentation examples (71 complete, 82 fragments)
Checked 76 runtime boundary operations and the shared registry, strict JSON, Web DOM, host-event, browser-platform, storage-host, and Desktop-host ABIs
```

### `npm test`

通过。核心尾部：

```text
tests 955
pass 955
fail 0
Checked 15 modules from examples/production-web
Checked 9 modules from examples/flow-board
Checked 8 modules from examples/support-desk
Checked 3 modules from examples/api-dashboard
production-web: 1 passed, 0 failed
flow-board: 3 passed, 0 failed
support-desk: 3 passed, 0 failed
api-dashboard: 3 passed, 0 failed
```

### `npm run test:browser`

通过。尾部：

```text
VelarScript development and CSP production browser matrices passed
production-web: 30 passed, 0 failed
flow-board: 6 passed, 0 failed
support-desk: 15 passed, 0 failed
api-dashboard: 6 passed, 0 failed
Installed VelarScript browser-project acceptance passed
```

### 批次 K 定向回归

```text
tests 9
pass 9
fail 0
```
