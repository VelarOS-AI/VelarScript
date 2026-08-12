# 马拉松缺陷账本（2026-08-12 起，持续更新）

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
| β-1 | blocker | `web/emitter.ts:1244-1256`、`runtime-foundation.ts:662-670` | 替换 state 根后，全部后代仍强引用死根：无界滞留 + 每次深层突变 O(代数) | 未验证 |
| β-2 | blocker | `collection-lowering-runtime.ts:472` | `Set.update()` 只触发 iterate/structure，不触发成员键 —— `"x" in tags` 永不更新 | 未验证 |
| β-3 | blocker | `collection-lowering-runtime.ts:186,191,218,221,237` | `Set()`/`Map()` 构造存入的是响应式代理，读取侧解包 → 成员身份分裂（违反 web-api.md:293 明文契约） | 未验证 |
| β-4 | major | `web/emitter.ts:1218-1231,1168-1173` | 跨观察者互相失效无预算：两个 watch 互喂可同步冻页且无报告（#30 只修了自失效） | 未验证 |
| β-5 | major | `web/emitter.ts:1691-1699` | keyed 渲染无「已在位」判断，每次更新重插全部行 → O(n) DOM 移动 + 焦点/IME 丢失 | 未验证 |
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
| α-2 | blocker | `cli/project.ts:702-713`、`:320-333` | VEL3019 消失后增量缓存里 `code: null` 永不恢复 → **静默产出空 JS 模块**（`velar dev` watch 下，改动传播只到 dependents，被复用模块保持 null；下游全部 `code ?? ""`） | 未验证 |
| α-3 | major | `compiler/emitter.ts:543-546,537-541` | detached 报告失败变成 unhandled rejection → **Node 进程死亡**，违反 B-DETACHED-ASYNC「不终止程序」（三条路径：无 console 的 `throw`、console.error 自身抛、`__velarNormalizeError` 非全函数） | 未验证 |
| α-4 | major | `web/emitter.ts:207` | Web `detachedTaskHelpers()` **未按 `webOutput` 门控**（同族其他 helper 全都门控）→ web 项目里的纯数据模块走浏览器报告路径，`velar test`(Node) 下 `queueMicrotask` throw 杀测试进程 | 未验证 |
| α-5 | major | `compiler/emitter.ts:1031-1036` | `async <expr>` 是唯一跳过 Promise 归一化的消费者（传 `false`）→ 外来 thenable/`undefined` 触发同步 `TypeError: Promise.prototype.then called on incompatible receiver`，未被拥有 | 未验证 |
| α-6 | major | `compiler/analyzer.ts:7340-7347` | VEL3019 **误报**：`def` 提升为 ESM 链接期初始化，但顶层调用导入的 `def` 被判不安全（修复需模块接口携带 hoistedness —— 箭头 const 导出确实是 TDZ，仅凭绑定种类不够） | 未验证 |
| α-7 | major | `cli/project.ts:683` | VEL3019 **漏报**：按直接 import 说明符判序，**再导出indirection 丢失真实定义模块** → 环内读判为安全，运行期正是该特性要防的 ReferenceError | 未验证 |
| α-8 | major | `cli/project.ts:605,686-690` | VEL3019 **漏报**：跳过 `dynamic` 引用，但动态导入的 .vel 确实被加载且无 order 位置 → 整个环无检查 | 未验证 |
| α-9 | major | `cli/project.ts:657-671`、`project-session.ts:51,240` | **VEL3019 依赖 entry 列表** → LSP（每个文件都是 entry）与 `velar check`（单 entry）判定不一致：编辑器报错、构建通过 | 未验证 |
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
