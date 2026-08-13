# Codex 任务书 —— 批次 K：并行异步 + 常驻命名空间 + 失败所有权收口

先读 `.claude/agents/ops.md` 常备纪律。隔离与交付同批次 I 模式：worktree +
专属分支，自行提交到分支、不碰 main、不 push。

## 基线（重要）

```
git -C /Users/mac/Documents/VelarScript log --oneline -3
```

**基线必须包含批次 I 的合并**（log 里应见 Web 词汇/keyframes 相关提交）。
若还没有，等编排方落地后再开工。确认后：

```
git -C /Users/mac/Documents/VelarScript worktree add ../velar-batch-k -b codex/batch-k <该 HEAD>
```

减冲突纪律不变：charter 只加新小节；新字符串一律双引号/反引号；
AI 简报双份逐字节一致。

## 必读规格

1. `docs/handoff/D35-PARALLEL-ASYNC-AND-NAMESPACES.md` —— Promise.all(记录) 与
   常驻命名空间 Json. / Promise. / Look. 的裁决（零发明名册）；range 进 prelude
   的既批项（**先核实现状**，已落地则跳过并在报告注明）
2. `docs/handoff/D39-ADDITIONS.md` 第 52 条（sleep Duration）与第 55 条
   （stdlib 错误码约定）
3. `docs/handoff/D41-BOUNDS-AND-POP.md` 第 63.3 条（velar/math 双拼写清理）
4. `docs/handoff/COMPLETENESS-AUDITS.md` —— ASY-D1（组合子输家）、
   裁判迁移节的 MIG-1(ii) 与 MIG-2

## 任务项

**A. D35 并行异步**
1. `Promise.all(记录)` → `Promise<记录>`（记录字段各为 Promise，解出同形记录）；
   列表形按 D35 既定语义；今天的自相矛盾异构诊断被真实实现替换。
2. **常驻命名空间**（零发明名册，成员即既有能力换个门牌）：`Json.parse` /
   `Json.stringify` / `Json.stableStringify` / `Json.clone`；`Promise.all` 及
   D35 名册所列成员；web 侧 `Look.` 按 D35。裸 `Promise` / `Json` 引用不再是
   Unknown name 裸报。与既有 import 形式的关系按 D35 的裁决处理（若 D35 未定
   双拼写取舍——命名空间与 velar/json 导入并存还是迁移——**报告呈选项，不擅裁**）。

**B. 计时与约定**
3. D39-52 `sleep(2s)`：按规格给 sleep 接受 Duration。若规格与现实冲突
   （Duration 属 web 扩展而 sleep 在 Core），**报告，不擅自发明 Core 单位**。
4. D39-55 stdlib 错误码约定落地（各 velar/* 模块的抛错带稳定错误码，按规格）。
5. D41-63.3：`velar/math` 的 `isFinite`/`isInteger` 函数删除（方法已存在），
   定向指引 + 迁移。

**C. 失败所有权收口（账本已决）**
6. **ASY-D1**：`race`/`timeout`/`all`/`map` 的输家 rejection 交给既有
   `__velarDetachedTask` 观察者上报（standard-modules velar/async）；`map` 在
   首败后不再无主继续执行剩余项（或其副作用有主——按账本处置实现并写明选择）。
   回归含：race 赢家结算后输家失败仍上报、all 首败后其余失败不消失。

**D. 裁判迁移工单（账本已决）**
7. **MIG-1(ii)**：`Kind.is(raw)` 建立收窄（validator-is narrowing，FLW-N3 升格）
   —— `if Kind.is(raw):` 后 raw 在真分支收窄为 Kind；开放协议模式变一等拼写。
   流审计的 DECIDED-AND-CORRECT 清单（~80 项）是不回归契约；实现参考第 71 条
   （赋值建立事实）落地时的 establish 机制。记录类型的 `User.is(x)` 同理。
8. **MIG-2**：未类型化的导出 computed/访问器在**导出处**诊断（教
   `export const name: () -> T = computed(...)`），消费端的 unknown 级联消失
   或降为跟随引用。

## 门禁与交付

worktree 内三门禁全绿（含 desktop-worker 抖动协议）；新测试进
`tests/hardening-batch-k.test.ts`；报告写到分支内
`docs/handoff/CODEX-REPORT-K.md`（逐项、双拼写取舍呈报、门禁尾部）；
向用户回报分支名与提交列表。
