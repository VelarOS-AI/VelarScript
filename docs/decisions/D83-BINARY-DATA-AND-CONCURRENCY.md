# D83 — 二进制数据、确定性与有界并发（用户裁决 2026-08-18）

这是一份已实施裁决的历史记录，不是当前规格。当前契约见
[语言宪章](../language-charter.md)、[标准库](../standard-library.md) 与
[二进制数据与结构化并发](../binary-data-and-concurrency.md)。其中 SQLite、
MessagePack、压缩与噪声的包归属已由
[D87](D87-DATABASE-AND-EXTERNAL-ADAPTER-BOUNDARY.md) 重新裁定为外部源包；
本记录中的旧 `velar/*` 身份不再是当前契约。

## 证据

真实二进制工作负载需要跨 Node 与浏览器共享定长数值内存、压缩、网络与
持久化。用 `List<number>` 执行约 102 万次定长缓冲区读写的中位耗时约
355 ms，extern 包装约 83.5 ms，原生
`Uint16Array` 内核约 1.52 ms；编译器专用检查索引原型约为原生 2.8 倍。

同一轮又确认，约 409 万次简单循环中，`for ... in range(...)` 的中位耗时
约 516 ms，而 `while` 约 2.82 ms，相差约 183 倍。只改数据结构会留下
循环本身这个同量级热路径缺陷。

## 裁决

1. `Bytes` 是只读跨平台快照，`UInt16Buffer` 是定长可变工作内存；两者复用
   `[]`，由编译器专门降级并做严格整数、范围、越界检查。Node `Buffer`
   永远只存在于实现层。
2. 直接单槽 `for value in range(...):` 保持一次求值与完整 `range` 异常语义，
   但降级为原生计数循环。`range` 作为值时仍返回普通有界 List。
3. 加入 `0x`、`0b`、`0o` 整数文本，以及严格的
   `~ & | ^ << >> >>>` 和对应复合赋值。位运算不继承 JavaScript 的静默
   强制转换与移位回绕。
4. `velar/random` 以字符串或安全整数为种子，提供可派生、跨目标完全一致的
   随机流；可复现数据不依赖宿主 `Math.random()`。
5. `velar/task` 使取消、父子传播、合作检查点、真正取消底层工作的超时和
   `using` 自动收敛成为同一个所有权模型。
6. `velar/worker` 由 `velar.json` 声明入口，统一浏览器 Worker 与 Node
   `worker_threads`，并固定 Runtime Type 校验、Bytes transfer、有界池/队列、
   单调用取消/超时和崩溃收敛。
7. `velar/websocket` 统一 Node/Web 客户端，增加 Node 服务端和同端口 HTTP
   upgrade，以拉取式消息、真实发送背压和有界资源替代回调堆积；旧 Web 文本
   realtime API 保持兼容。
8. Node SQLite 在隔离 Worker 中运行，IndexedDB 获得 Bytes 与原子批处理；
   FS/HTTP、WebSocket、Worker、SQLite、IndexedDB 全部消费同一种 `Bytes`。
9. MessagePack、压缩和 Simplex 噪声不重写成熟算法；官方适配面分别固定在
   `msgpackr`、`fflate`、`simplex-noise` 之上，不把复杂 TypeScript 泛型或
   宿主偶然 API 变成 VelarScript 公共契约。
10. 数值处理补充具名 `UInt8Buffer`、`UInt32Buffer`、`Float32Buffer`，以及有
    `maxElements` 的 `UInt32Builder`、`Float32Builder`；不引入公开泛型
    `Buffer<T>`。所有定长缓冲区具有专用索引和独立 `copy`/`slice`。
11. 收口门禁要求：range 边界和步长提升为局部标量；解压按剩余预算动态切分
    压缩输入，超限时停止消费后续输入与计算，默认小包不预留 64 MiB；所有二
    进制 Runtime Type 在扫描或复制前执行统一 64 MiB 字节上限；WebSocket 接
    收队列同时限制消息数与总字节，正常 EOF 可排空、失败立即清空；Worker 在
    有界、去重的数据图遍历中隔离调用方快照后 transfer 嵌套 Bytes 与数值缓冲
    区，不暗中 detach 调用方值。

## 被本裁决重新打开的旧结论

D30/D54 记录的“无基数整数文本、无位运算”由本裁决以真实工作负载与性能证据
重新打开。归档 HANDOFF 中“等第一个真实二进制消费者出现再设计统一
Node/Web Bytes”的条件已经满足。D48 的库边界仍成立：公开的是经过真实消费
验证的小型稳定 Velar 适配面，不是把第三方包的完整 API 搬入标准库。

## 完成判据

完成不是若干单元测试，而是一个无界面项目：同一份 `shared-data.vel` 在 Node
与 Chromium Worker 生成逐字节相同的 8,192 字节数据集；任务可取消且可由
有界池并行；数据经过压缩、MessagePack、二进制 WebSocket/HTTP、SQLite 与
IndexedDB 后保持一致；慢客户端产生背压，断线释放任务和连接；热循环不再
承受物化 range 的历史惩罚；验收项目中没有 `unsafe js` 补洞。
