# D98：双 JavaScript 产物模式

## 背景

VelarScript 同时承担两件事：日常构建要给部署环境足够小、足够快的 JavaScript；
语言或工具链成为阻碍时，作者又必须能接管一份结构清楚的 JavaScript，并在需要时
单独保留源码映射。
过去这两个目标由不同构建目标偶然实现：Web 会压缩，Node 和普通模块通常保持可读，
因此 `velar build` 的含义取决于目标，不能形成可靠契约。

## 裁决

1. JavaScript 构建公开两种模式：`production` 与 `readable`。它们共享同一次
   VelarScript 解析、类型检查和规范 JavaScript 生成，不维护两套语言语义。
2. `production` 是所有 `velar build` 目标的默认值。它允许压缩标识符、语法与
   空白，执行安全的 tree shaking，并压缩生成的标准运行时和 JSON 包装模块。
3. `readable` 保留编译器生成的结构化名称和排版，供人工审计、排障和脱离
   VelarScript 工具链后的接管。它不是调试专用运行时，行为必须与生产版一致。
4. 项目通过顶层配置选择稳定模式：

   ```json
   {
     "formatVersion": 2,
     "entry": "src/main.vel",
     "build": { "mode": "readable" }
   }
   ```

   单次构建通过 `velar build --mode production|readable` 覆盖项目配置；冻结库
   产物使用同一个 `velar build-library --mode ...` 选择。
5. Source Map 是与模式正交的顶层构建配置：`build.sourceMaps` 默认 `false`，
   `--source-maps` 与 `--no-source-maps` 可覆盖单次构建。开发和测试运行默认保留
   映射；正式构建只有显式开启时才写 `.map` 和链接注释。开启生产映射时，优化层
   必须组合编译器原始映射，让最终堆栈直接回到 `.vel`，不能停在中间 JavaScript。
6. 浏览器与 Node 构建清单记录最终模式。两种模式的模块边界、导出、异常类型、
   异常消息和运行结果必须相同；测试同时检查等价执行、产物卫生与生产体积。

## 所有权

编译器只生成可审计的规范 JavaScript。最终压缩属于 CLI 构建层：它掌握目标、
打包、source map、输出目录和部署清单，因此不会让压缩策略渗入语言分析器。

本裁决把 D33 的“最终出口必须可读”落实为显式 `readable` 模式；默认构建转为
部署导向的 `production`，可读出口本身继续是永久能力。
