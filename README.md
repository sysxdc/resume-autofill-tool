# 简历填写工具（resume-autofill-tool）

一款 **Chrome Manifest V3** 扩展：在本地保存你的简历资料，打开求职/申请表单页面后一键自动填写常见字段。灵感来自 Simplify Copilot、Teal 等「本地资料 + 内容脚本检测表单」的思路，**并非复制其代码**。

填写后由你自行核对并提交，扩展**不会自动点击提交**。

当前版本：**1.1.0**

## 功能概览

- **本地资料库**：选项页分区编辑全部字段（基本 / 联系与链接 / 教育 / 工作 / 求职偏好 / 其他）。
- **导入 / 导出 JSON**、**加载示例资料**、清空确认与保存反馈。
- **智能字段匹配**：根据 `name` / `id` / `autocomplete` / `placeholder` / `label` / `aria-label` 等启发式识别；增强 Boss 直聘 / 智联 / 前程无忧 / Greenhouse / Lever 常见中英关键词。
- **一键填写** + **扫描字段**（预览本页可识别 key，不写入）。
- **安全约束**：不自动提交、不填 password/file、不盲勾 checkbox；同一语义键最多填 1–2 次。
- **隐私优先**：资料仅存于 `chrome.storage.local`，不上传服务器。

## 资料字段

| 分区 | 字段 |
|------|------|
| 基本 | `name`, `firstName`, `lastName`（可选显式覆盖；填写时显式优先于从姓名拆分）, `email`, `phone` |
| 联系与链接 | `city`, `address`, `province`, `zip`, `country`, `linkedin`, `github`, `website` |
| 教育 | `school`, `degree`, `major`, `gradYear` |
| 工作 | `company`, `title`, `years`, `startDate` |
| 求职偏好 | `expectedSalary`, `availability`, `workAuth`（工作许可/签证文字） |
| 其他 | `skills`, `summary` |

说明：`address` 使用资料中的详细地址，**不会**误用 `city`。

## 如何安装（加载未打包扩展）

1. 打开 Chrome，地址栏进入 `chrome://extensions/`。
2. 右上角打开 **「开发者模式」**。
3. 点击 **「加载已解压的扩展程序」**，选择本仓库目录（包含 `manifest.json` 的文件夹）。
4. 安装后点击扩展图标：
   - 先点 **「编辑资料」** 填好并保存（或「加载示例资料」再保存）；
   - 打开求职申请页或下方演示页，点 **「扫描字段」** / **「一键填写」**；
   - **仔细核对**高亮字段后，再手动提交。

无需 npm 构建，纯原生 HTML / CSS / JS。

## 演示页（手动测试）

仓库内提供双语申请表：

```text
demo/job-application.html
```

两种打开方式：

1. **file://** — 在 Chrome 中直接打开该 HTML 文件（需扩展已加载，且允许访问文件或通过扩展弹窗注入）。
2. **本地静态服务**（推荐）：

```bash
cd resume-autofill-tool
python3 -m http.server 8765
# 浏览器打开 http://localhost:8765/demo/job-application.html
```

演示页含姓名拆分、邮箱、电话、城市、详细地址、教育（含学历 select）、经历、链接、自我介绍，以及 **password / file / checkbox**（扩展应跳过）。

## 自动化测试（无需 Chrome）

匹配逻辑在 `shared/match.js`，可用 Node 直接测：

```bash
node tests/run-tests.mjs
```

覆盖：关键词匹配、中英姓名拆分、`profileValue`（含 address≠city）、select 模糊匹配、manifest/图标完整性等。零第三方依赖。

## 目录结构

```text
resume-autofill-tool/
├── manifest.json                 # MV3，version 1.1.0
├── shared/
│   ├── profile.js                # DEFAULT_PROFILE / 字段列表 / 示例资料
│   └── match.js                  # 关键词与匹配辅助（浏览器 + Node）
├── background/
│   └── service-worker.js
├── content/
│   └── autofill.js               # FILL_FORM / SCAN_FIELDS
├── popup/
├── options/
├── icons/                        # icon16 / 48 / 128
├── demo/
│   └── job-application.html
├── tests/
│   └── run-tests.mjs
├── README.md
└── .gitignore
```

## 隐私说明

- 所有简历字段保存在浏览器本地存储（`chrome.storage.local`）。
- 扩展不请求远程 API，不收集分析数据。
- `host_permissions` 使用 `<all_urls>` 以便在各类招聘站注入内容脚本；可按需自行收窄。
- 请勿在公共电脑保存敏感信息；卸载或清空浏览器数据会删除本地资料。

## 使用提示与限制

- 不同网站字段命名差异大，匹配可能不完全；可先「扫描字段」再决定是否填写。
- 浏览器内置页（`chrome://` 等）无法注入脚本。
- 不会自动勾选 checkbox/radio，不会填写 password/file，不会提交表单。
- SPA 动态渲染的表单若在注入后很久才出现，可刷新页面或再点一次填写。

## 许可与声明

本项目为独立实现的学习/个人效率工具，界面与流程参考了主流求职 autofill 产品的**产品形态**，不包含、不抄袭任何第三方扩展的专有代码。
