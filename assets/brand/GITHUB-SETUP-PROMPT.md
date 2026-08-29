# 任务：配置 GitHub 组织 VelarOS-AI 的图标与资料

你要操作浏览器完成下面的事。**所有文案我已经写好，逐字粘贴，不要自己发挥、不要翻译、不要改写。**

---

## 零、先读：命名规则（会影响你在任何输入框里写的字）

- **VelarScript 是语言名**，书面简称 **Vel**。
- **Velar 是平台名**（Core 编译器 + web/node/desktop 目标扩展 + 工具链）。
  一句话：你写 VelarScript，你装 Velar。
- **英文任何地方都不许出现 "Velar Framework"。** 平台的英文名就是 `Velar`。
  框架不是 Velar 的组成部分，因为框架就是语言本身。
- 定位句（英文）：`An extensible application-layer programming language for the AI era, where the framework is the language.`
- 定位句（中文）：`面向 AI 时代的一门可扩展的应用层编程语言，语言与框架一体化。`

依据是仓库里的 `docs/decisions/D105-PLATFORM-NAME-AND-PRONUNCIATION.md`。

---

## 一、上传两张图片（**必须在网页上点，GitHub 这两处没有 API**）

图片在本机：`/Users/mac/Desktop/VelarOS/projects/VelarScript/assets/brand/`

### 1. 组织头像

- 文件：`velarscript-avatar.png`（512×512）
- 打开：<https://github.com/organizations/VelarOS-AI/settings/profile>
- 在 **Profile picture** 区域点 **Upload a picture…** → 选上面那个文件
- 弹出裁剪框时：**把裁剪框拖到最大、铺满整张图**。图本身已经是正方形并留好了留白，
  再裁一次会把标切掉。
- 点 **Set new organization profile picture**
- 验收：页面左上角的头像从灰蓝色方格 identicon 变成黑色的 V 形标

### 2. VelarScript 仓库的 social preview

- 文件：`velarscript-social-preview-dark.png`（1280×640）
- 打开：<https://github.com/VelarOS-AI/VelarScript/settings>
- 往下滚到 **Social preview** → 点 **Edit** → **Upload an image…** → 选文件
- 验收：预览区出现深色卡片，上面是 VelarScript 字样和定位句

### 3. VelarScript-Website 仓库的 social preview

- 同一张 `velarscript-social-preview-dark.png`
- 打开：<https://github.com/VelarOS-AI/VelarScript-Website/settings>，同样操作

---

## 二、组织资料

还是在 <https://github.com/organizations/VelarOS-AI/settings/profile>，填这三个框，其余留空：

| 字段 | 填什么 |
| --- | --- |
| **Name** | `VelarOS` |
| **Description** | `VelarScript — an extensible application-layer programming language where the framework is the language — and the VelarOS products built on it.` |
| **URL** | `https://velaros.cn` |
| Location / Email / Twitter | 留空，不要填 |

填完点页面底部的 **Update profile**。

---

## 三、公开仓库的描述、网址、标签

只改下面列出的三个仓库。改法：进仓库首页，右上角 **About** 旁边的齿轮图标，
在弹窗里改 Description / Website / Topics，然后 **Save changes**。

### VelarScript-Website

| 字段 | 值 |
| --- | --- |
| Description | `Official site and documentation for VelarScript, itself written in VelarScript and running on Velar.` |
| Website | `https://velarscript.velaros.cn` |
| Topics | 删掉 `web-framework`，最终留这五个：`velarscript` `velar` `programming-language` `documentation` `web-development` |

> `web-framework` 必须删掉：VelarScript 不是一个 Web 框架，这个标签是旧定位留下的。

### VelarScript-Libraries

| 字段 | 值 |
| --- | --- |
| Description | 不动 |
| Website | `https://velarscript.velaros.cn` |
| Topics | 在现有的 `lsp` `npm-packages` `programming-language` `velarscript` 上加一个 `velar` |

### openvoxel

| 字段 | 值 |
| --- | --- |
| Description | 不动 |
| Website | 留空 |
| Topics | 现在是空的，加这五个：`velarscript` `velar` `voxel` `game-development` `teaching` |

---

## 四、验收

全部做完后，在终端跑这两条，把输出贴回来：

```bash
gh api orgs/VelarOS-AI --jq '{name,description,blog,avatar_url}'
```

```bash
gh api "orgs/VelarOS-AI/repos?per_page=50" --jq '.[] | select(.private==false) | {name,description,homepage,topics}'
```

期望：

- `name` 是 `VelarOS`，`description` 和 `blog` 不再是 `null`
- `avatar_url` 后面的 `?v=` 数字变了（说明头像换过）
- `VelarScript-Website` 的 topics 里没有 `web-framework`

两张 social preview 没法用 API 核对，用浏览器打开
<https://github.com/VelarOS-AI/VelarScript> 看右侧 About 上方是否显示卡片，
或者把仓库链接贴进任意聊天软件看展开的预览图。

---

## 五、不要做的事

- **不要动任何私有仓库**（VelarOS-Desktop / Extension / Workbench / Platform /
  Termel / Labs / Workspace / VelarScript-Editor）。
- **不要动 VelarScript 仓库的 description / homepage / topics**，已经配好了。
- **不要动 VelarOS-Arch-Guard**，它是另一条产品线，描述和网址都是对的。
- **不要重新裁剪头像**，也不要改 `velarscript-mark.svg`。
- **不要在任何输入框里写 "Velar Framework"**，也不要把 VelarScript 描述成
  "Web framework" 或 "Web-first"。
- 遇到任何这份文档没写到的字段，**留空并告诉我**，不要自己编。
