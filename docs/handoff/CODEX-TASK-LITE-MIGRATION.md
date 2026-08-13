# Codex 任务书 —— VelarOS-Lite 迁移到 Vel 马拉松 HEAD（裁判上场）

你是这次迁移的执行者，也是**被测对象**：马拉松在 Vel 上落了约三十项破坏性收紧，
每一项都带教学诊断。**迁移过程本身就是产出**——每条诊断有没有一步教会你改对，
是这门语言的核心 KPI 数据。

## 关键环境规则（先读这个）

- **不得以任何方式修改 VelarScript 仓库**（/Users/mac/Documents/VelarScript）。
  它的工作树上有两波未提交的在途工作。
- **钉住提交构建**：`git worktree add`（或 clone）VelarScript 于提交
  **`db629df`**，从那份干净快照构建工具链、供 Lite 消费。不要用活树。
- 所有改动只发生在 VelarOS-Lite 仓库（你建的那个裁判项目；若含独立的编辑器
  项目，一并迁移）。

## 任务

把 VelarOS-Lite 全量迁移到钉住的 Vel 版本，直至 Lite 自己的
check / test / build 全绿。

### 已知破坏性变更清单（迁移热点，全部带教学诊断）

- **值语义**：`pop(index=-1)` 严格（空/越界抛 IndexError）、`removeLast()` 删除
  （排空用 `while items.size > 0:`）；`==`/`!=` 要求类型有交集（枚举 vs 字符串
  拒绝，教 `Kind.parse(raw) ==` 或 `str()` 显式降级）；集合字面量做 `==` 操作数
  拒绝（教 `equals(a, b)`）；成员测试词汇（`in`/`has`/`index`/`Map.get`）同交集
  规则。
- **枚举**：不再可排序（`sorted(by=rank)` 或字符串背书编码顺序）；新增
  `Status.values()`；跨枚举 `is` 拒绝。
- **类**：类名不是值（工厂写 `() => P()`）；类家族 match 必须兜底（`case Base:`
  或 `case _:`）；块内 class/type 拒绝；构造器 rest 拒绝；`super()` 仅首句；
  基类构造器不得触抽象/被覆盖成员；声明前使用类名拒绝。
- **readonly**：只收纯数据（任何深度含类即拒，教建模为记录或去掉 readonly）。
- **模块**：块内 import/export 拒绝；自导入拒绝；大小写分歧路径拒绝；未知
  `velar/*` 会列出可用模块。
- **stdlib 迁出（重点）**：`velar/javascript` 与 `velar/text-buffer` 已不存在 ——
  安装并改用 **`@velarscript/script-analysis`** 与 **`@velarscript/text-buffer`**
  包（旧导入的诊断会教你）。这是编辑器侧的 D48 收尾。
- **排序**：字符串排序改码点序（含代理对的字符串顺序可能变化——若 Lite 有依赖
  排序快照的测试，按新序更新）。
- **测试信任**：测试期间任何无主错误（detached 失败、headless 下模块初始化碰
  DOM）都会判该测试失败——之前静默全绿的测试现在可能如实变红，**那是修复不是
  回归**：修 Lite 的测试布局（挂载入口与纯可测模块分离）。
- 尚未落地、**不要使用**：反引号字符串、`bind:value={form.name}` 成员路径、
  `bind:group`、keyframes（都在途，下一轮迁移再吃）。

### 记录纪律（产出的核心）

在 Lite 仓库写 `MIGRATION-NOTES.md`，对**每一条撞到的诊断**记录：

1. 原样消息；
2. 你按它做的修改；
3. **它是否一步教会你**（是/否——"否"的每一条都是语言的工单）；
4. 卡住超过两轮的地方（详细）；
5. 迁移前后 Lite 的测试数与通过率对照。

## 交付

- Lite 在钉住 Vel 版本上 check/test/build 全绿（Lite 仓库内提交随你的项目惯例）；
- `MIGRATION-NOTES.md` + 一段总结（最痛三处/最顺三处/诊断教学质量总评）；
- 向用户回报时附上笔记路径。VelarScript 仓库零改动。
