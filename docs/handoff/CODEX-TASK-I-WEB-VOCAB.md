# Codex 任务书 —— 批次 I：Web 词汇大波（keyframes + 属性表 + 值收紧 + 元素表 + 扩展文本钩子）

先读 `.claude/agents/ops.md` 常备纪律。本单例外条款见「隔离与交付」——
这次你在**独立 worktree 的专属分支**上工作并**自行提交到该分支**。

## 隔离与交付（先读）

主工作树正有一个合流代理在跑门禁，**不得在主树工作**。设置：

```
git -C /Users/mac/Documents/VelarScript worktree add ../velar-batch-i -b codex/batch-i 44c3eaa
```

在 `../velar-batch-i` 里实现、测试、跑门禁、**按你的惯例分逻辑提交到
`codex/batch-i` 分支**。不碰 main、不 push。编排方在词法合流落地后 merge
你的分支并解决 charter 冲突。两点减冲突纪律：charter 编辑**只加新小节、
不改既有段落**；新写的字符串**一律双引号或反引号**（词法波的单引号拒绝
即将落地 main）。

## 必读规格

1. `docs/handoff/D49-KEYFRAMES.md` —— keyframes 完整规格（形态/规则/诊断/回归全列）
2. `docs/handoff/COMPLETENESS-AUDITS.md` 审计十 —— LOK-U1（属性表）、
   已排队项状态核对（D37-42 / 42-补 的现状数据）；审计九 —— WEB-U12（元素名表）
3. `docs/handoff/D37-WEB-SURFACE-QUALITY.md` 第 42 条与 42-补 —— 关键字值收紧
   与 grid-template 注册缺口的既批规格
4. `docs/handoff/D41-BOUNDS-AND-POP.md` 第 63.2 条 + `docs/handoff/D40-PERCENT-AND-UNITS.md`
   第 60 条 —— 扩展文本钩子（方向已批：单位值可进 f-string）

## 任务项

**1. D49 keyframes 全套**：`keyframes:` 块值（from/to/N% 停靠点、升序查重、
逗号多停靠点）、停靠点体复用 Look 属性机器减不可动画排除表、块内禁状态读、
`animate(frames, duration, easing?, delay?, count?, loop?, direction?, fill?)`
构建器（count/loop 互斥、字面量编译期检查）、`animation` 属性只收
Animation/List 且字符串形拒绝、`@keyframes` CSS 稳定生成名走既有去重、
浏览器回归含 getAnimations() 断言真旋转、`if not motion.reduced:` 搭配示例
进简报。落地后把 N-2c 留下的 animation 临时诊断升级为教本形态。

**2. LOK-U1 属性表**：
- **发布**：charter §17 新增附录小节列出全部 Look 属性（从
  packages/web/src/look.ts 生成，按功能族分组），并写明**收录原则**：
  「标准、未废弃、值模型能被 Look 类型族诚实描述的 CSS 属性」。
- **系统补录**：审计十列出的 ~55 个缺席真实属性是工单——逐个判定：符合
  原则则补（带类型化值，进 LOOK_PROPERTY_TYPES，不走 stringType 回落）；
  不符合则进排除清单并写明理由（如 float/clear 属遗留布局、table 族待证据）。
  排除清单也进 charter 附录。textShadow、grid 长手、动画长手（animate 接管，
  排除并指路）、滚动/表单主题/i18n 族是重点。
- **诊断三级**：打错字 → 就近建议（Levenshtein，N-2c 已给钩子/目标做了，
  属性对齐）；真 CSS 但域外 → 边界声明 + 逃生（unsafe CSS）；未知 → 现消息。

**3. D37-42 + 42-补 关键字值收紧**：`display = "flexx"`、`padding = "big"`、
`padding = "12px"`（字符串装长度）、`color = "reddish"` 全部编译期拒绝——
每个关键字属性获得封闭值集或类型化值；42-补的字符串值注册缺口全扫
（`gridTemplateColumns = "240px minmax(0, 1fr)"` → 教 tracks()/minmax()；
`backgroundImage = "linear-gradient(...)"` → 教 linearGradient()——审计十
的新登记数据）。**迁移**：examples/** 里被收紧拒绝的值全部改为受检形态。

**4. WEB-U12 元素名表**：未知元素名（`<dvi>`）编译期拒绝 + 就近建议，
沿 D36-38 属性表 / D37-43 事件表的同款模式；自定义元素约定（连字符名）
若网上有惯例则放行并成文。

**5. D41-63.2 扩展文本钩子**：扩展类型可声明文本形 → `f"gap: {16px}"` 合法
（Length 插值成 "16px"）；`str(16px)` 同理；VEL4026 对无文本形的扩展值维持
拒绝但不再教对 Length 失败的 stringify（D40 第 60 条的断出口修复）。
钩子进 compiler/src/extension.ts 的扩展协议，web 扩展为全部单位类型实现。

## 门禁与交付

worktree 内三门禁全绿；charter fences 全编译；简报双份逐字节一致。
报告写到分支内 `docs/handoff/CODEX-REPORT-I.md`：逐项、属性表的收录/排除
统计、迁移清单、门禁尾部。向用户回报分支名与提交列表。
