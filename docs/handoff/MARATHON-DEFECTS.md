# 马拉松缺陷账本（2026-08-12 起，持续更新）

> **修复波 1（Core 编译器 + CLI）已落地**：α-1、α-2、α-3+NEW-1、α-5、
> α-6/7/8/9/10/13/14、β-2、β-3、β-8、β-10、β-12、γ-1、γ-2、γ-3 全部修复并
> 带回归（`tests/hardening-marathon-core.test.ts` 20 项）。**修复波 2（Web
> 运行时）待跑**：β-1、β-4、β-5、β-6（门禁扩展）、β-7、β-9、β-11、β-13、α-4。

马拉松协议下的实现层漏洞搜捕记录。纪律沿用七A节硬化阶段：**静态发现 =
未验证假设**，一律先执行验证（默认立场是驳回）再修；验证通过才进修复波。
状态字段：`未验证` → `已确认` / `已驳回` → `已修复`。

设计层问题不在此账本处理 —— 单独记录、等用户裁决（马拉松协议第 1 条）。

---

## 搜捕 β —— 响应式核心 + 集合运行时（静态审查，2026-08-12）

**历史 blocker 复核结论**：#2（空集合迭代不注册依赖）、#3（双槽 Map for 不
追踪 iterate key）、#4（解构/match/展开丢深层响应）**三类均已关闭且证据充分**；
但发现 **#27（keyed 无界滞留）与 #2/#3 的同族缺陷在新路径上复活**（见 β-1、β-2）。

| ID | 严重度 | 位置 | 一句话 | 状态 |
|---|---|---|---|---|
| β-1 | blocker ✔已确认 | `web/emitter.ts:1244-1256`、`runtime-foundation.ts:662-670` | 替换 state 根后，全部后代仍强引用死根：无界滞留 + 每次深层突变 O(代数) | 未验证 |
| β-2 | blocker ✔已确认 | `collection-lowering-runtime.ts:472` | `Set.update()` 只触发 iterate/structure，不触发成员键 —— `"x" in tags` 永不更新 | 未验证 |
| β-3 | blocker ✔已确认(收窄) | `collection-lowering-runtime.ts:186,191,218,221,237` | `Set()`/`Map()` 构造存入的是响应式代理，读取侧解包 → 成员身份分裂（违反 web-api.md:293 明文契约） | 未验证 |
| β-4 | major ✔已确认 | `web/emitter.ts:1218-1231,1168-1173` | 跨观察者互相失效无预算：两个 watch 互喂可同步冻页且无报告（#30 只修了自失效） | 未验证 |
| β-5 | major ✔已确认(正确性) | `web/emitter.ts:1691-1699` | keyed 渲染无「已在位」判断，每次更新重插全部行 → O(n) DOM 移动 + 焦点/IME 丢失 | 未验证 |
| β-6 | major | `web/emitter.ts` 多处（1654-1704、1593、1846-2159） | 新 Web 运行时面回退到可覆盖实例方法（Map/Array 迭代器/style/classList/事件）—— W-83..W-99 类回归 | 未验证（可利用性）／**门禁缺口已确认**，见下 |
| β-7 | major(perf) | `runtime-foundation.ts:635,645,588-613` | 记录字段写入对**原始值**也走 `contains` → 每次写抛接 2 次异常 + O(字段) 描述符分配（bind:value 每键击） | 未验证 |
| β-8 | major(perf) | `collection-lowering-runtime.ts:379,392,117-122` | `insert`/`pop`/`copy` 走 dense 校验而非 owned 快路径；`copy` 是全部回调操作的入口 → `map` 前 ~3n 次分配 | 未验证 |
| β-9 | major(perf) | `runtime-foundation.ts:311-316,329-360,614-617,488-505,545` | 每次响应式属性读 ~14 次瞬时数组分配；原始值读未提前返回；依赖集每轮重建 | 未验证 |
| β-10 | minor(perf) | `collection-lowering-runtime.ts:576-578` | `Set.remove` 重复 unlink 同一 child，多付一次 O(n) 扫描 | 未验证 |
| β-11 | minor | `web/emitter.ts:379-380` | `String.replace` 单次替换重写 `__velarListPop` —— 未来一节点两调用时静默丢包装（#29 潜在复活） | 未验证 |
| β-12 | minor | `collection-lowering-runtime.ts:100-107` | owned 快路径不复验密度：`unsafe` JS 加自有名后 `size` 与 `[i]` 不一致 | 未验证 |
| β-13 | minor | `runtime-foundation.ts:629-633` | 通过代理给缺席键赋 `undefined` 会建键但不发布（仅 `import js unsafe` 可达） | 未验证 |

**β 报告确认干净的类别**（记档防重查）：回调操作快照语义（全部 10 个回调操作
均先 `__velarCopyList` 快照，回调内突变不影响本次迭代）；List 元素读的宿主
敌意防护（getter/Proxy/稀疏/污染原型全在读之前被拒）；索引位移的依赖粒度
（`indexFrom` 精确通知）；computed 环检测（直接与间接均有界 RangeError）；
销毁后读的清理链；跨组件/跨模块 owner 正确性（无法构造错误注册）；keyed 键
身份（类型分离、越界拒绝、事务性销毁）。

### β-6 门禁覆盖缺口：**已确认**（编排代理静态核验，2026-08-12）

`scripts/check-runtime-boundary.mjs` 确实扫描 `web/emitter.ts`，但只对**三段
切片**施加 ABI 正则，切片边界（实测锚点行号）为：

| 切片 | 范围 | 施加的检查 |
|---|---|---|
| `emittedReactivityRuntimeSource` | `__velarSchedule`(1158) → `__velarResource`(1283) | **有** `new Set/Map/WeakMap`、`Object.is`、`Array.isArray`、`Reflect.*` 禁用（脚本 1200 行） |
| `emittedManagedAsyncRuntimeSource` | `__velarManagedAsyncNativePromise` → `__velarScope` | Promise/Object.freeze 禁用 |
| `emittedDomRuntimeSource` | `__velarComponent`(1444) → `__velarLook(parts)`(1758) | **仅** `document.`／`globalThis.Node`／`parent.append|insertBefore`／`node|owned|end.remove|before`（脚本 1163 行）—— **不含** Map/迭代器/属性操作检查 |

两处缺口因此成立：

1. **keyed 与 JSX List 展开（1593、1650-1757）落在 DOM 切片内，但该切片的正则
   不检查集合与迭代器使用** —— β-6 所指的 `new Map()`／实例 `get/set/values`／
   `for…of` 数组迭代不会被拦。
2. **`__velarLook`(1758) 之后的全部代码（look/class/style/事件，约 1758-2160+）
   落在三段切片之外，完全无 ABI 检查**。

结论：**这是机械保障的结构性缺口，而非单点缺陷** —— 即使 β-6 逐条列举的用法
经复核被判为无害，同类回归仍会持续发生且无人察觉。修复波必须包含门禁扩展
（把 emitter 的运行时模板整体纳入 ABI 正则，或按函数边界枚举切片并断言覆盖
完备），否则只是打地鼠。

### 设计层待议（不在本账本处理，等用户裁决）

- **β-D1**：`List` 越界行为不一致 —— `list[i]` 抛 IndexError、`get(i)` 返 null、
  **`pop(i)` 越界静默返 null**、`removeLast()` 空表抛、`slice` 静默钳制。
  `pop(i)` 是异类（D29 附议 B 只收紧了非整数索引，未碰越界整数）。

---

## 搜捕 α —— 批次 H 四特性（静态审查，2026-08-12）

审查对象：commit `c166e1f`（模块环 VEL3019 / 文本白名单 VEL4026 / 浮动 Promise
与 async 语句 VEL4027-4028 / `??` 混用 VEL2034）。**两个 blocker 直接命中刚
提交的代码**。

| ID | 严重度 | 位置 | 一句话 | 状态 |
|---|---|---|---|---|
| α-1 | blocker | analyzer HEAD:3927、7405、7231-7236；emitter HEAD:1448 | **`str` 作为值绕过 VEL4026** → toString 钩子洞重开 | **已确认**（见下） |
| α-2 | blocker ✔已确认 | `cli/project.ts:702-713`、`:320-333` | VEL3019 消失后增量缓存里 `code: null` 永不恢复 → **静默产出空 JS 模块**（`velar dev` watch 下，改动传播只到 dependents，被复用模块保持 null；下游全部 `code ?? ""`） | 未验证 |
| α-3 | major ✔已确认 | `compiler/emitter.ts:543-546,537-541` | detached 报告失败变成 unhandled rejection → **Node 进程死亡**，违反 B-DETACHED-ASYNC「不终止程序」（三条路径：无 console 的 `throw`、console.error 自身抛、`__velarNormalizeError` 非全函数） | 未验证 |
| α-4 | major ✔已确认 | `web/emitter.ts:207` | Web `detachedTaskHelpers()` **未按 `webOutput` 门控**（同族其他 helper 全都门控）→ web 项目里的纯数据模块走浏览器报告路径，`velar test`(Node) 下 `queueMicrotask` throw 杀测试进程 | 未验证 |
| α-5 | major ✔已确认 | `compiler/emitter.ts:1031-1036` | `async <expr>` 是唯一跳过 Promise 归一化的消费者（传 `false`）→ 外来 thenable/`undefined` 触发同步 `TypeError: Promise.prototype.then called on incompatible receiver`，未被拥有 | 未验证 |
| α-6 | major ✔已确认 | `compiler/analyzer.ts:7340-7347` | VEL3019 **误报**：`def` 提升为 ESM 链接期初始化，但顶层调用导入的 `def` 被判不安全（修复需模块接口携带 hoistedness —— 箭头 const 导出确实是 TDZ，仅凭绑定种类不够） | 未验证 |
| α-7 | major ✔已确认 | `cli/project.ts:683` | VEL3019 **漏报**：按直接 import 说明符判序，**再导出indirection 丢失真实定义模块** → 环内读判为安全，运行期正是该特性要防的 ReferenceError | 未验证 |
| α-8 | major ✔已确认 | `cli/project.ts:605,686-690` | VEL3019 **漏报**：跳过 `dynamic` 引用，但动态导入的 .vel 确实被加载且无 order 位置 → 整个环无检查 | 未验证 |
| α-9 | major ✔已确认 | `cli/project.ts:657-671`、`project-session.ts:51,240` | **VEL3019 依赖 entry 列表** → LSP（每个文件都是 entry）与 `velar check`（单 entry）判定不一致：编辑器报错、构建通过 | 未验证 |
| α-10 | major(perf) | `cli/project.ts:657-671,686` | `entryOrders` 无条件计算，O(entries×(V+E))：LSP 场景 4096 entry × 全图 DFS ≈ 千万级 Map 条目**每次击键**，且项目**无环也照付**（现有测试只断言零诊断、未断言跳过） | 未验证 |
| α-11 | minor | `analyzer.ts:7355-7360` | VEL3019 无调用图传播：`const eager = read()` 顶层调用本模块函数读环内绑定 → 仍裸崩（承诺打折，作用域限制已记档） | 未验证 |
| α-12 | minor | `analyzer.ts:2175,2241` | VEL4027/4028 教的 `await` 在非 async `def` 里非法（测试还固化了这个消息）→ 该场景只有 `async x()` 可用 | 未验证 |
| α-13 | minor | `project.ts:703-708` | VEL3019 破坏按 span 排序的诊断顺序契约（`index.ts:168`） | 未验证 |
| α-14 | minor | `project.ts:652,681,692-699` | 环检查里的死代码与冗余（不可达自环分支、与 analyzer 重复的 dedupe、未用 `diagnostic()` 构造） | 未验证 |
| α-15 | minor(perf) | `analyzer.ts:2170,2181-2185,7385-7392,1262-1281` | 新增 `expandAliases` 进热路径：**每条表达式语句**深展开类型只为判 promise；`carriesPromise`/`isTextConvertible` 递归重复展开；`expandAliases` 每节点新建 Map | 未验证 |
| α-16 | minor | `emitter.ts:1392` | 发射器无条件重写 `str`/`print` 标识符，不尊重用户遮蔽（analyzer 新注释声称尊重）—— 先存缺陷，但本次提交开始依赖它 | 未验证 |

**α 报告确认干净的类别**（记档防重查）：VEL2034 健全性（完整追了优先级表与
`parseExpressionBody`/`parseUnary`/`parsePower`，链/`not`/`**`/比较链/`?:`/嵌套
括号均无逃逸无误报；`parenthesized` 无需跨克隆存活因格式化器是 token 式）；
文本白名单的类型形状旁路（跨模块 enum 保 kind、跨模块别名在接口边界预展开、
`readonly string` 无操作、`unknown` 未被误判 invalid、spread 进 `str()` fail-closed、
多趟结果推断的诊断去重）；浮动 Promise 逃逸（条件/`??`/可选调用/记录字段读/
联合全被 `carriesPromise` 的 optional-union 遍历接住；namespace 导入亦覆盖）。

### α-1 **已确认**（编排代理静态核验 HEAD 提交版，2026-08-12）

三段代码合成完整的洞，逐条查证（行号为 HEAD 提交版）：

1. `analyzer.ts:7231-7236` —— `builtin("str")` 返回
   `{parameterNames:["value"], parameters:[anyType], result:string}`：
   **裸 `str` 是合法的一等可调用值，参数类型 `any` 接受一切**。
2. `analyzer.ts:3927` —— 白名单调用 `requireTextConvertible` 的守卫形态是
   `calleeExpression.kind === "IdentifierExpression" && name === "str"`：
   **只在直接调用语法上生效**。
3. `emitter.ts:1448` —— `expression.name === "str" ? "String" : …`：
   **无条件把标识符重写为 `String`**（与用户遮蔽的注释声明相矛盾 = α-16）。

因此 `const convert = str` / `values.map(str)` / `(flag ? str : f)(x)` 全部
类型通过并发射为原生 `String(...)`，记录的 `toString` 数据字段照样被执行 ——
批次 H 的主要修复目标之一（正门钩子洞）**实际未关闭**。

**修法（实现层，但有小的表面后果，请用户确认）**：`str`/`print` 是编译器自有
操作（发射器重写它们），作为值传递本质上绕过检查。最小健全修法 = **拒绝裸
`str`/`print` 作为值**，定向教 `values.map(value => str(value))`（这样每元素
仍走白名单）。备选（收窄 builtin 参数类型为文本可转换联合）不可行：枚举是
标称类型，联合无法表达「任意枚举」，这正是当初用 `any` 的原因。
表面后果 = 一等函数引用被禁；等用户确认后随修复波实施。

### 设计层待议（α，等用户裁决）

- **α-D1**：泛型类型参数永远不可文本转换（`isTextConvertible` 对 `parameter`
  返 false），`def label<T>(v: T) -> string: return f"{v}"` 被拒且无 bound 语法
  可选择加入 → 泛型 render/label 辅助函数写不出来。
- **α-D2**：`str()` 失去逃生阀角色（`unknown`/`any` 均被拒），JS 边界值只能经
  `print`（检查用）或 `stringify` 成文本 —— 值得 charter 明写一句。

---

## 验证波结果（执行级，2026-08-12）：**13/13 确认，零幻影**

对抗性验证（默认立场驳回）全部给出可复现执行证据。**三条的推理被修正、一条
新缺陷被发现** —— 这些修正与确认同等重要，修复必须打在真实路径上。

| ID | 判定 | 关键执行证据 |
|---|---|---|
| α-2 | **确认** | 增量复用后 `cycle-a` 诊断为空但 `code=NULL`；同源重编为 71 字节。dev 服务器实测返回**空模块 + 零诊断**，导入方随后 `SyntaxError: does not provide an export named` |
| α-3 | **确认（路径被修正）** | 真实可达路径是 `emitter.ts:539` **无守卫读 `error.stack`** → 报告器内抛 → unhandled rejection → 进程死。**原列三条路径中两条被驳回**：删 `globalThis.console` / 事后替换 `console.error` 均被模块初始化捕获防住（实测存活并正常打印），只有「导入前污染」才咬 |
| α-4 | **确认** | 无任何 web 语法的 `tasks.vel` 仍拿到 web detached helper（`queueMicrotask:true`）；`velar test` 下 detached 失败**杀死整个测试进程**（0 passed，第二个测试没跑）。反证：`extensions: []` 同源 → 2 passed 且失败上 stderr |
| α-5 | **确认** | extern 返回外来 thenable → `TypeError: Method Promise.prototype.then called on incompatible receiver` 同步杀进程；返回 `undefined` 同样。反证：同值走 `await` → 干净可捕获的 `Expected an actual Promise` |
| α-6 | **确认（误报）** | 导入 `def` 的顶层调用被 VEL3019 挡住（`code=NULL`，构建被阻断），但实测运行 `exit=0 stdout="helped"`；对照组 `const` 箭头确实 `ReferenceError` —— 检查器对 `def` 判错、对 `const` 判对 |
| α-7 | **确认（漏报）** | 经桶文件再导出的环：三模块零诊断，运行 `ReferenceError: Cannot access 'value' before initialization`；去掉桶直接导入则 VEL3019 正常命中 |
| α-8 | **确认（漏报）** | `await import("./a.vel")` 后的环：零诊断 + 运行期 ReferenceError；同环改静态导入则命中 |
| α-9 | **确认** | 同一份磁盘项目：`VelarProjectSessions.snapshot()` 报 VEL3019，`velar check` 同目录 `exit 0` 无诊断 —— 编辑器红、构建绿 |
| β-1 | **确认（含实测数字）** | 惯用写法 `settings = {...settings, label: next}` ×200 → `theme.parents = 201`，gc 后 **200/200 死根仍存活**；每次深层突变耗时随代数线性增长：51 代 7.66µs → 3200 代 197.73µs |
| β-2 | **确认** | `Set.update()` 后 `'x' in tags` 为 true 但 watch 未触发（membershipRuns=0）；对照 `Set.add()` 正常触发 |
| β-3 | **确认（范围收窄）** | `Set([...])`/`Map([...])` 构造后成员/键查找恒 false/null，`add`/`set` 对照正常。**List 那两行被驳回** —— List 读取侧两边都 raw，无缺陷 |
| β-4 | **确认** | 两个互喂 watch：子进程 12 秒后仍在跑、宏任务定时器**从未触发**、错误通道零输出，SIGKILL 收场；对照自失效 watch 正常抛 RangeError |
| β-5 | **确认（性能半边降级）** | Chromium 实测：相同键、相同值的重新赋值使聚焦 input **失焦**（blur 计数 1）。但性能半边测得 1000 行仅 6.6ms/帧（≈2µs/行冗余移动）—— **真正的缺陷是正确性（焦点/IME/子树瞬态），不是性能** |

### NEW-1（新发现，major）—— Core detached 报告器读 `error.stack` 无守卫

`compiler/emitter.ts:539` 在 rejection 处理器内读外来错误对象的 `.stack`，
而该处理器返回的 promise 被丢弃 → 任何带抛出型/异质 `stack` 访问器的 rejection
值都会**把报告本身变成 unhandled rejection 并杀死 Node 进程**。比 α-3 原列的
三条路径**严格更可达**（不需要污染 console、不需要初始化顺序配合）。Web 报告器
不读 `.stack` 且对用户处理器有 try/catch，不受影响。

**修复方向**：整个报告器包 try/catch + `.stack` 读取加守卫（或改用已捕获的
安全提取），并确保 `then` 派生 promise 不被丢弃。

---

## 搜捕 γ —— 运行期基准（执行测量，2026-08-12）：三条静态审查未发现的性能缺陷

`tests/performance-runtime.test.ts` 建立基线时**测量本身撞出三个缺陷**，均为
静态审查两条线都没看到的路径。基线机器：Apple Silicon / Node 24。

**头条（好消息）**：SameValueZero 等式代价 ≈ **0.6 ns/次比较**，数字/字符串
耗时比 **1.35**（10M 次：数字 20.9ms、字符串 15.1ms、枚举 20.4ms）。批次 A 的
等式统一几乎免费；类型驱动消除经发射形态断言锁定。

| ID | 严重度 | 位置 | 实测 | 状态 |
|---|---|---|---|---|
| γ-1 | **blocker(perf)** | `collection-lowering-runtime.ts:100-107`（owned 标记覆盖面） | **List 索引读在非 owned 列表上是 O(n)**：`range(0,2000)` 结果 200k 次索引读 = **39,796 ms（≈199µs/次读）**；对照 append 构建的 2000 项列表 42.8ms。根因：只有变更方法与 map/filter/slice/sorted 标记 owned，**列表字面量与 `velar/collections` 返回值都不标记**，`range()` 更是在模块内建普通数组、够不到降级运行时的 WeakSet。`for x in list` 不受影响（只验一次），但 `for i in range(n): values[i]` 是二次的 | 已确认（实测） |
| γ-2 | major(perf) | `collection-runtime.ts:22`（`__velarIsMap`） | **`Set.has` 比 `Map.get` 慢约 13×**：以**抛异常探型**识别非 Map（调用 `Map.prototype.size` getter 再 catch），每次 Set 成员测试都付一次抛接。200k 次 A/B：`Map.has` 21.7ms、`Map.get` 26.9ms、**`Set.has` 394ms（1.97µs/次）** | 已确认（实测） |
| γ-3 | major(perf) | `text-runtime.ts:76`（`__velarTextCodeUnitOffset`） | **`String.slice` 是 O(语料+起点)，纯 ASCII 也是**：码点位置转码单元偏移逐码点从 0 走起，无 ASCII 快路径（`__velarTextCodePointLength` 有代理对正则快路径，偏移走没有）。实测 111k 字符串上偏移 ~50k 的切片 **110µs**；222k 语料上分散切片 **~510µs/次**。**任何用切片扫描文档的代码都是二次的** —— 本轮测得最贵的值方法 | 已确认（实测） |
| γ-4 | 观察 | 枚举成员读 | 热循环中枚举成员是冻结对象属性载入而非内联常量 —— 枚举与字符串等式那 ~5ms 差距全部来自此，与等式工作无关 | 记档 |

γ-1/γ-2 的预算已按当前慢数字设定并在注释中写明根因与「修好后收紧」；
γ-1 的极端路径（range 索引读）**故意不进门禁**（会撑爆 30 秒预算），
provenance 规则写在注释里。

---

## 修复波 1 实测结果（2026-08-12 落地）

| 项 | 修复前 | 修复后 |
|---|---|---|
| γ-1 `range(0,2000)` 20 万次索引读 | **39,796 ms**（199µs/读） | **41.6 ms**（0.21µs/读）—— **≈950×** |
| γ-2 20 万次 `Set.has` | 190.0 ms | **11.6 ms** —— 预算 575 → **34** |
| γ-3 222k 语料 300 次切片 | 153.8 ms（~510µs/次） | **~0.0 ms**（~0.3µs/次）—— 预算 465 → **12** |
| β-8 10 万项 map/filter/sorted | 16.6 / 15.9 / 24.0 ms | **8.9 / 8.1 / 15.6 ms** |
| α-10 4096 模块 LSP 形态的排序开销 | 984 ms、839 万 Map 条目**每次击键** | **无环时为 0**；有环时 0.5ms / 4096 条目 |

**γ-1 的机制值得记档**：ownership 从 `WeakSet` 标记改为 **`WeakMap<Array, 元素数>`
的"已完成密集校验"备忘** —— 任何 List（字面量、`range()`、`velar/collections`
返回值）首次操作付一次完整校验，之后 O(1)；外部改动 length 会破坏匹配并强制
重新校验，**同时也是 β-12 的修复**。原以为需要跨模块 provenance 机制，实际不需要。

**实施者反馈的三处诊断不完整**（记档）：
1. α-1 我判断的「拒绝裸 `str`」与「收窄参数类型不可行」**都可避免** —— 标记
   类型方案对枚举有效（失败的只是*联合*方案）。零表面变更、无需用户批准。
2. α-8 的处方（把动态模块加入排序）是症状描述；**移除 entry 依赖后自动被涵盖**，
   且顺带消掉 α-10 的开销。动态目标成为求值根，但不加入 SCC 图边（`await
   import()` 确实延迟求值）。
3. β-12 若真的在 owned 快路径复验密度，就会退回它要避免的 O(n)；计数备忘同时
   满足两者。

**α-9 的判断留痕（供用户复核）**：让判定与 entry 列表无关，必须选一个规范顺序。
实施者选了「项目主 entry 为第一根」，而非最保守的「SCC 内任何读都不安全」——
后者会拒掉现有测试套件钉住的三个合法程序。两个驱动器传同一个 primaryEntry，
分歧无论如何已闭合。

## 验证与修复编排

1. **验证波**（批次 A 落地后立即）：对 β-1..β-6 各写最小执行探针（浏览器
   执行级），默认立场驳回；β-7..β-9 用基准测量确认量级。
2. **修复波 N**（验证通过项）：按 β 报告建议序 —— β-1（根替换传递性解链或
   owner 集弱化/代际校验）→ β-2（一行）→ β-3（两行）→ β-4（flush 迭代预算）
   → β-5（位置游标）→ β-7（`typeof` 守卫，单位字节收益最大的性能修复）。
3. **门禁扩展**：β-6 若确认，`scripts/check-runtime-boundary.mjs` 需覆盖
   WEB_RUNTIME_BODY 的 DOM/集合操作（当前只查 runtime-foundation 侧），
   否则同类回归会再次发生 —— 这是「机械保障缺失」而非单点缺陷。
4. **运行期基准**（马拉松发现 #1）：β-5/β-7/β-8/β-9 全部需要它才能证明修复
   有效，因此基准套件先于性能修复落地。
