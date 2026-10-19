# 简历填写工具（resume-autofill-tool）

一款 **Chrome Manifest V3** 扩展：在本地保存你的简历资料，打开求职/申请表单页面后一键自动填写常见字段。支持 **中英同义模糊匹配**，以及可选的 **AI 巡查 / AI 填写**（OpenAI 兼容接口）。灵感来自 Simplify Copilot、Teal 等产品形态，**并非复制其代码**。

填写后由你自行核对并提交，扩展**不会自动点击提交**。

当前版本：**1.2.1**

## 功能概览

- **本地资料库**：选项页分区编辑全部字段（身份 / 联系 / 地址 / 教育 / 工作 / 项目 / 求职偏好 / 语言证书 / 其他）。
- **导入 / 导出 JSON**、**加载示例资料**、清空确认与保存反馈。
- **兼容匹配（非完全匹配）**：关键词 + CN↔EN 同义 + Levenshtein / token 模糊评分；`autocomplete` 优先；保留 EEO / 法律问卷 denylist。
- **一键填写** + **扫描字段** + **AI 巡查** + **AI 填写**。
- **安全约束**：不自动提交、不填 password/file、不盲勾 checkbox；同一语义键最多填 1–2 次；Yes/No select 谨慎处理。
- **隐私优先**：资料默认仅存于 `chrome.storage.local`；仅在启用 AI 并点击巡查/填写时，将非空字段发送到你配置的 API。

## 资料字段（1.2.0 拓展）

| 分区 | 字段 |
|------|------|
| 基本 / 身份 | `name`, `firstName`, `lastName`, `englishName`, `preferredName`, `gender`, `birthday`, `idType` / `idNumber`（**选填**，请谨慎） |
| 联系 | `email`, `secondaryEmail`, `phone`, `wechat`, `qq`, `emergencyContact` |
| 地址与地点 | `city`, `currentCity`, `address`, `province`, `zip`, `country`, `hukou`, `nativePlace`, `willingToRelocate` |
| 链接 | `linkedin`, `github`, `website`（不自动填作品集密码） |
| 教育 | `school`, `degree`, `major`, `gradYear`, `gpa`, `eduStart`, `eduEnd`, `dualDegree` |
| 工作 | `company`, `title`, `years`, `startDate`, `industry`, `department`, `jobType`, `leaveReason`, `achievements` |
| 项目 | `projectName`, `projectRole`, `projectDesc` |
| 求职偏好 | `expectedSalary`, `expectedCity`, `jobTarget`, `availability`, `noticePeriod`, `earliestStart`, `workAuth` |
| 语言与证书 | `languages`, `certificates` |
| 其他 | `skills`, `summary`, `referralSource`, `additionalInfo` |

导入旧版 JSON 时，`normalizeProfile` 会保留已知键并忽略未知键，缺省字段为空字符串。

## 模糊匹配说明

- **同义示例**：微信↔`wechat`、期望城市↔`expectedCity`、到岗/通知期↔`availability`/`noticePeriod`、项目经历↔`projectDesc` 等。
- **模糊**：在关键词未精确命中时，用 token 包含与 Levenshtein 相似度评分；分数 ≥ 阈值（默认 0.72）才映射。
- **仍跳过**：种族/族裔、残疾、英文 Gender（EEO）、how did you hear、竞业/employment agreement、previously worked、capacity 等（与 1.1.1 一致并略有加强）。
- 国内表单「性别」可映射到 `gender`；美式 EEO 的 Gender 问卷仍被 denylist 拦截。

## AI 巡查与 AI 填写

### 配置（选项页 →「AI 设置」）

1. 勾选 **启用 AI**。
2. 填写 **API Base URL**（默认 `https://api.openai.com/v1`，也可填兼容网关）。
3. 填写 **API Key**（仅存 `chrome.storage.local`，扩展不会在日志中打印）。
4. 填写 **模型名称**（默认 `gpt-4o-mini`）。
5. 点击 **保存 AI 设置**（与简历资料分开存储，键名 `aiSettings`）。

未启用或未配置 Key 时，弹窗显示 **未配置**，巡查/填写自动走 **本地模糊匹配**。

### 使用

| 按钮 | 行为 |
|------|------|
| **一键填写** | 本地启发式匹配并写入 |
| **AI 巡查** | 收集页面字段 →（可选）调用 LLM 映射 → 在弹窗列出「标签 → 资料键 / 建议值 / 置信度」，低置信高亮 |
| **AI 填写** | 先做与巡查相同的映射，再写入页面（绿框高亮），**不提交** |
| **扫描字段** | 仅预览本地可识别 key |

API 调用在 **background service worker** 中完成（避免页面 CORS），超时约 20 秒；失败时中文提示并回退启发式填充。

### 隐私说明（AI）

- API Key 仅本地存储，代码路径避免 `console.log` 密钥。
- **只有**你点击 AI 巡查/填写且已启用时，才会把 **非空** 简历字段 + 表单标签发往你配置的 Base URL。
- 未启用 AI 时行为与 1.1.x 一样，不发起外网请求（扩展自身）。
- Prompt 约束：不编造雇主经历；跳过 EEO/种族/残疾等；select 只能选 options 中的项；Yes/No 仅返回 Yes/No（长句归一或 skip）。

## 如何安装（加载未打包扩展）

1. 打开 Chrome，地址栏进入 `chrome://extensions/`。
2. 右上角打开 **「开发者模式」**。
3. 点击 **「加载已解压的扩展程序」**，选择本仓库目录（包含 `manifest.json` 的文件夹）。
4. 安装后点击扩展图标：编辑资料 → 打开申请页 → 扫描 / 一键填写 / AI 巡查 → **仔细核对**后再手动提交。

无需 npm 构建，纯原生 HTML / CSS / JS。

## 演示页（手动测试）

```text
demo/job-application.html
```

```bash
cd resume-autofill-tool
python3 -m http.server 8765
# 浏览器打开 http://localhost:8765/demo/job-application.html
```

## 自动化测试（无需 Chrome）

```bash
node tests/run-tests.mjs
```

覆盖：关键词与同义模糊、denylist、姓名拆分、`profileValue`、select 匹配、**AI merge 纯函数（无网络）**、manifest / 选项页 / 弹窗结构等。零第三方依赖。

## 目录结构

```text
resume-autofill-tool/
├── manifest.json                 # MV3，version 1.2.1
├── shared/
│   ├── profile.js                # 字段列表 / 示例 / normalize
│   ├── match.js                  # 关键词、模糊评分、denylist
│   └── ai.js                     # AI 设置 + mergeAiMappingWithProfile
├── background/
│   └── service-worker.js         # AI_MAP_FIELDS / GET_AI_STATUS
├── content/
│   └── autofill.js               # FILL / SCAN / COLLECT / APPLY
├── popup/
├── options/
├── icons/
├── demo/
├── tests/
│   └── run-tests.mjs
├── README.md
└── .gitignore
```

## 使用提示与限制

- 不同网站字段命名差异大；可先「AI 巡查」或「扫描字段」。
- 浏览器内置页（`chrome://` 等）无法注入脚本。
- 不会自动勾选 checkbox/radio，不会填写 password/file，不会提交表单。
- SPA 动态渲染的表单若出现较晚，可刷新后再点填写。
- 自定义 AI Base 若域名不在权限内：当前 `host_permissions` 为 `<all_urls>`；若你自行收窄权限，需为 API 域名补权限。
- 证件号等敏感字段为选填；公共电脑请勿保存。

## Changelog

### 1.2.1
- **Select 安全填写**：填写 `<select>` 前必须 `matchSelectOption`；无匹配则跳过，禁止把城市名/长段落贴进下拉框。
- **Yes/No 归一**：`yes/是/true`→Yes、`no/否/false`→No；签证句「No I am citizen…」映射为 No；无法判断则 skip。
- **地区枚举**：`Where are you currently based?`（US/Canada/Elsewhere）在城市不在 options 时 skip，启发式不再 city→region 硬填。
- 加强 AI system prompt；新增 Node 测试覆盖上述场景。

### 1.2.0
- **拓展简历字段**（身份、联系、地点、教育/工作附加、项目、求职偏好、语言证书等）。
- **兼容 / 模糊匹配**：同义词典 + Levenshtein/token 评分；保留 1.1.1 denylist 与 autocomplete 优先。
- **AI 巡查 / AI 填写**：选项页 AI 设置；background 调用 OpenAI 兼容 Chat Completions；失败回退本地匹配。
- 弹窗按钮：一键填写 | AI 巡查 | AI 填写 | 扫描字段 | 编辑资料；显示 AI 状态。
- 测试与 README 同步更新。

### 1.1.1
- Matcher false-positive fixes（Greenhouse 实测）：autocomplete 优先、短词词界、EEO/法律 denylist、学历同义、Yes/No select 保护。

### 1.1.0
- Expanded profile fields, autofill keywords, demo page, and Node test suite.

## 许可与声明

本项目为独立实现的学习/个人效率工具，界面与流程参考了主流求职 autofill 产品的**产品形态**，不包含、不抄袭任何第三方扩展的专有代码。
