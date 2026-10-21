# 简历填写工具（resume-autofill-tool）

一款 **Chrome Manifest V3** 扩展：在本地保存你的简历资料，打开求职/申请表单页面后一键自动填写常见字段。支持 **中英同义模糊匹配**，以及可选的 **AI 巡查 / AI 填写**（OpenAI 兼容接口）。灵感来自 Simplify Copilot、Teal 等产品形态，**并非复制其代码**。

填写后由你自行核对并提交，扩展**不会自动点击提交**。

当前版本：**1.5.5**

## 功能概览

- **本地资料库**：选项页按 playoffer 风格折叠分区编辑（个人信息 / 求职意向 / 教育 / 实习 / 工作 / 项目 / 校园 / 社会实践 / 技能 / 证书 / 外语 / 家庭 / 获奖 / 专利 / 论文 / 培训）。
- **多段经历编辑（1.5.0）**：选项页可增删改排序 `eduList` / `workList` / `projectList`；保存写入列表；主条目扁平字段仍兼容旧匹配。
- **自定义下拉适配（1.5.0）**：原生 select、`.el-select`、`.ant-select`、`.dictionary-selector` / listbox 写路径；Yes/No radio 增强；见 `demo/dropdowns.html`。
- **简历解析与多档案库（1.4.0）**：导入 PDF / DOCX / TXT / MD，本地解析成 profile 存进 IndexedDB，多份简历共存、一键切换应用。
- **导入 / 导出 JSON**、**加载示例资料**、清空确认与保存反馈。
- **兼容匹配（非完全匹配）**：关键词 + CN↔EN 同义 + Levenshtein / token 模糊评分；`autocomplete` 优先；保留 EEO / 法律问卷 denylist。
- **一键填写** + **扫描字段** + **AI 巡查** + **AI 填写**。
- **安全约束**：不自动提交、不填 password/file、不盲勾 checkbox；同一语义键最多填 1–2 次；Yes/No select 谨慎处理。
- **隐私优先**：资料默认仅存于 `chrome.storage.local`；仅在启用 AI 并点击巡查/填写时，将非空字段发送到你配置的 API。

## 资料字段（1.3.0 playoffer 全量）

受 [playoffer](https://playoffer.cn) 类 ATS 简历字段启发，扁平 schema 约 **255** 键（相对 1.2.x ~60 键大幅扩展）。扁平主条目 + 多段数组（`eduList`/`workList`/`projectList`，1.5.0 可在选项页编辑）；完整 CN→key 对照见 [`docs/playoffer-field-map.md`](docs/playoffer-field-map.md)。

| 分区 | 主要字段（节选） |
|------|------|
| 个人信息 | `resumeTitle`, `name`, `namePinyin`, `englishName`, `gender`, `birthday`, `age`, `nationality`, `ethnicity`, `politicalStatus`, `maritalStatus`, `idType`/`idNumber`（**选填**）, `phone`, `email`, `wechat`, `qq`, `emergencyContact*`，`currentAddress`, `hukou*`, `nativePlace`, `highestDegree`, `isFreshGraduate`, `workStatus`, `years`, `lastCompany`, `summary`, `personalStrengths`, `hobbies`, `careerPlan`… |
| 求职意向 | `jobTarget`, `expectedIndustry`, `expectedCity`, `interviewCity`, `expectedSalary`, `expectedAnnualSalary`, `acceptAdjustment`, `referralSource`, `availability`… |
| 教育（主） | `school`, `eduDegree`, `degree`, `major`, `eduStart`/`eduEnd`, `gpa`, `thesisTitle`, `isTongzhao`… |
| 实习（主） | `internCompany`, `internTitle`, `internStart`/`internEnd`, `internDescription`… |
| 工作（主） | `company`, `title`, `startDate`, `workEnd`, `workCity`, `monthlySalary`, `referee*`, `achievements`, `workDescription`… |
| 项目（主） | `projectName`, `projectRole`, `projectDesc`, `projectResponsibilities`, `projectOutcome`… |
| 校园 / 社会实践 | `campus*`, `social*` |
| 技能 / 证书 / 外语 | `techSkills`/`skills`, `cert*`, `lang*`, `languages`, `certificates` |
| 家庭（选填） | `family*`（含 `familyIdNumber`，默认空） |
| 获奖 / 专利 / 论文 / 培训 | `award*`, `patent*`, `paper*`, `training*` |

示例资料为虚构「张三」；**切勿**把真实身份证/手机/邮箱提交进仓库。`normalizeProfile` 对旧 JSON 缺键填空、丢弃未知键。


## 简历库与解析（1.4.0）

选项页顶部「简历库」支持把现成简历文件直接变成可填写的档案，**全部在本机完成，不联网**。

**支持格式**

| 格式 | 解析方式 | 说明 |
|------|----------|------|
| PDF | 打包的 pdf.js 3.11 | 取文本层；纯图片/扫描件无文本层，需先 OCR |
| DOCX | 打包的 mammoth 1.13 | `extractRawText`，不受排版样式影响 |
| TXT / MD | FileReader | 直接按文本解析 |

**流程**：选择文件 → 自动解析 → 预览（姓名/联系方式/意向/教育段数/工作段数/技能/置信度 + 缺失提醒）→ 改档案名 → 「保存到简历库并应用」。
应用后会把该档案的 profile 写入 `chrome.storage.local`，内容脚本照旧读取并填表。

**多档案**：所有档案存在 IndexedDB（库名 `resume-autofill`，store `resumes`），列表里可 **应用 / 重命名 / 删除**；支持「导出全部档案」「导入档案 JSON」整库搬迁。当前使用的档案 id 存在同一库的 `meta` store。

**多段经历（schema 扩展）**：`eduList` / `workList` / `projectList` 三个数组各存多段，元素字段：

- `eduList[]`：`school, major, degree, start, end, city, gpa, description`
- `workList[]`：`company, title, start, end, city, description`
- `projectList[]`：`name, role, start, end, tech, description`

数组按**最新在前**排序；扁平主条目（`school/major/eduDegree/eduStart/eduEnd`、`company/title/startDate/workEnd`、`projectName/projectRole/…`）自动取第一条，因此旧的模糊匹配逻辑零改动。

**解析策略**（`shared/resume-parser.js`）

1. 文本归一化：CRLF、全角数字/字母/冒号括号、项目符号、连续空行。
2. 标题分段：`教育背景/工作经历/项目经历/专业技能/荣誉奖项/自我评价` 等别名（支持 `一、`、`【】`、`1.` 前缀），整行匹配避免正文误判。
3. 记录切分：日期区间（`2019.09-2023.06`、`2019/09 - 2023/06`、`2019年9月—至今`）作为记录起点，学校/公司关键词二次校正。
4. 字段抽取：手机/邮箱/GitHub/LinkedIn、性别/生日/城市、学校/专业/学历、公司全称/职位、项目名/技术栈/职责、技能词表。
5. 置信度 = 6 个关键字段命中率；缺手机号/邮箱/教育/工作会写进 `warnings`。

**已知限制**：不做 OCR（扫描件需先转文字）；`.doc` 老格式提示另存为 `.docx`/PDF；填充仍是「主条目 + 单行」——表单有多段教育/工作行时，目前只填第一段（数组已入库，多行填充待后续版本）。

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
demo/job-application.html   # 综合申请表
demo/dropdowns.html         # 原生 / Element / Ant / dictionary 下拉 + Yes/No（v1.5.0）
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
├── manifest.json                 # MV3，version 1.5.0
├── lib/                          # 打包的第三方库（离线，无 CDN）
│   ├── pdf.min.js / pdf.worker.min.js
│   └── mammoth.browser.min.js
├── shared/
│   ├── profile.js                # 字段列表 / 示例 / normalize / 多段经历
│   ├── match.js                  # 关键词、模糊评分、denylist
│   ├── ai.js                     # AI 设置 + mergeAiMappingWithProfile
│   ├── db.js                     # IndexedDB 多档案库
│   └── resume-parser.js          # PDF/DOCX/TXT → 文本 → profile
├── background/
│   └── service-worker.js         # AI_MAP_FIELDS / GET_AI_STATUS
├── content/
│   └── autofill.js               # FILL / SCAN / COLLECT / APPLY
├── popup/
├── options/
├── icons/
├── demo/
├── docs/
│   ├── playoffer-field-map.md    # CN 标签 → 键
│   └── live-field-coverage.md
├── tests/
│   ├── run-tests.mjs             # 匹配/填充/资源完整性
│   ├── resume-parser.test.mjs    # 解析器 + 多档案 schema
│   └── fixtures/                 # resume-zh.{txt,docx,pdf}
├── README.md
└── .gitignore
```

## 使用提示与限制

- 不同网站字段命名差异大；可先「AI 巡查」或「扫描字段」。
- 浏览器内置页（`chrome://` 等）无法注入脚本。
- 不会自动勾选 checkbox/radio，不会填写 password/file，不会提交表单。
- **只填空也会填「空白模板行」**（空的教育/工作段），可能多出一段示例经历；提交前请删多余段。
- SPA 动态渲染的表单若出现较晚，可刷新后再点填写。
- 自定义 AI Base 若域名不在权限内：当前 `host_permissions` 为 `<all_urls>`；若你自行收窄权限，需为 API 域名补权限。
- 证件号等敏感字段为选填；公共电脑请勿保存。

## Changelog

### 1.5.5

- **自动点「添加」展开分区**：教育 / 工作 / 实习 / 项目 / 奖项 / 校园等分区如果初始是空的，先按档案里
  `eduList/workList/projectList/awardList` 的条数点「+ 添加 xx」把输入框展开再填；附件 / 上传 / 视频类
  按钮一律不点（会弹文件框）。返回结果带 `expanded: [{section, clicks, before, after}]`。
- **结构字段按 id 路径映射**：`resumeEducationInfo_0_collegeName` / `resumeWorkInfo_0_description` 这类
  ATS 行级 id 直接映射到「第几段」的数据，同 id 的两个日期框用 placeholder（入学/毕业、入职/离职）区分。
- **工作描述类语义补齐**：岗位职责 / 工作职责 / 主要职责 / 职责说明 / 主要工作内容 / 工作经历描述 → `workDescription`；
  项目内容 / 项目背景 / 项目简介 → `projectDesc`；工作段 `description` 直连 textarea。
- **教育块规则顺序修正**：「毕业院校 / School / University」曾被「毕业」规则抢成毕业时间，导致学校框被写成 `2027-06`；
  学校规则现排在入学/毕业之前。
- **占位 option 识别放宽**：`请选择 / Select`、`Select`、`-- 请选择 --` 等不再被当成「已填」而整组跳过。
- antd 月面板年份导航补齐（月面板只有 super-prev/super-next = ±1 年）+ 面板隔离，避免多点开到别的日期框。

### 1.5.3
- **区块上下文匹配**：`matchFieldKeyScored(hints, {context})` 新增 `CONTEXT_RULES`（edu / intern / work / project / campus）。「城市」在教育块 → `schoolCity`，在工作块 → `workCity`；「学院/院系」→ `department`；「入学年月 / 就读起止」→ `eduStart`；「毕业时间」→ `eduEnd`。
  - 上下文来自 `detectSectionContext()`：上溯 7 层读 `legend / h2-h4 / summary / .section-title / 卡片头`，命中即用。
  - 是非题（`是否/有无/有没有…`）、户籍类（`户籍/户口/生源/现居`）、联系方式一律跳过上下文规则，避免「是否有亲属在本公司任职」被当成公司名。
- **别名补齐**：`学校所在城市 / 院校所在地 / 就读城市 / 院校城市`、`入学年月 / 就读起止时间`、`任职单位 / 就职单位`、`院系名称 / 系别 / 所在学院 / faculty`；`专业排名 / 班级排名` 优先于 `major`。
- **日期组 fail-closed**（`content/autofill.js`）：
  - `collectDateGroup` 支持「年 + 月」双下拉（无“日”），hint 命中 `year` 的 select 也计入 `yearSelect`；**没有年份的一律不认**。
  - `fillDateGroup` 先用完整日期（未拆分前）整组尝试；年份/月份不在选项里时整组放弃并返回 `year_not_available` / `month_not_available` / `date_group_incomplete`，不再写半截日期。
  - 「是年/月/日部件但组不成完整日期」→ 跳过并报 `date_part_no_group`。
  - `fieldLooksFilled` 把 `年 / 月 / 日 / 请选择 / --` 这类占位 option 视为未填，年月下拉不再被整组跳过。
- **数据侧**：`eduList` 新增 `department`（`MAIN_ENTRY_MAP` 与 `LIST_OCCURRENCE_MAP` 同步，多行教育可按行填院系）；解析器抽 `department`（`XX学院`、`院系: X`）与 `city`（校名 → 城市表 + 校名内含城市兜底）；「日期行在标题下方」的排版现在能正确切成多条教育/工作记录。
- 实测（ego + 本地复现页）：`r14` 教育块 `就读城市` 不再错填成现居城市、日期组 `2016/9/20` 与 `2023/6` 正确；回归 r1–r13 与 demo 两页全部通过（r13 多段 5 键、demo 下拉 8 键含两组 radio、求职页 13 键）。
- 测试：主套件 126 项、解析器 20 项。

### 1.5.1
- **解析器：标题后置日期**：`splitRecords` 支持「学校/公司 → 专业行 → 日期行」这种常见排版（日期不再另起一条），教育/工作起止时间能正确落位。
- **解析器：专业识别**：新增 `detectMajor`，优先 `专业: X`、其次 `自动化专业` 后缀写法，避免把「专业基础: Python…」误当专业名。
- **命名 radio 组标题发现**：`fillNamedRadioGroups` 新增 `radioGroupHints`，标题不再只认 `legend / el-form-item__label`；支持「行首 `<span>`/`<td>` 文本」「本组容器前一个非空兄弟」「父容器剔除选项后的文本」「name 语义名（`is_fresh`、`has_relative`）」，逐候选匹配。
- 修复 `demo/dropdowns.html` 上「是否应届生」「是否有亲属在本公司」两组是/否 radio 填不上；实测该页 8 个字段全部命中。
- 测试：解析器 17 项（含标题后置日期/专业后缀）、主套件 124 项。

- **命名 radio 组标题发现**：`fillNamedRadioGroups` 新增 `radioGroupHints`，标题不再只认 `legend / el-form-item__label`；支持「行首 `<span>`/`<td>` 文本」「本组容器前一个非空兄弟」「父容器剔除选项后的文本」「name 语义名（`is_fresh`、`has_relative`）」，逐候选做匹配。
- 修复 `demo/dropdowns.html` 上「是否应届生」「是否有亲属在本公司」两组是/否 radio 填不上的问题；实测 8 个字段全部命中（原生/el-select/ant-select/字典下拉各 1+2+2+1，两组 radio）。
- 测试：守卫 `radioGroupHints` 的四处关键实现；主套件 124 项。

### 1.5.0
- **选项页多段经历编辑**：可折叠分区编辑教育 / 工作 / 项目多段（增删、上移下移）；加载示例 / 导入 / 切换档案刷新列表 UI；保存经 `mergeFlatOntoProfile` 写入显式列表（空数组表示清空）。
- **下拉组件适配**：`autofill.js` 增加 Element-UI / Ant Design / dictionary-selector 点击展开→按文案选选项；命名 Yes/No radio 组可填；纯函数 `normalizeOptionText` / `findBestOption` / `parseYesNo` 可单测。
- **演示页**：新增 `demo/dropdowns.html`（原生 select + 三类自定义下拉 + radio），附手动活体验证清单。
- **语义模糊增强**：更多 CN ATS 同义（意向/应聘岗位、毕业学校、目前/期望薪资变体、籍贯/户口、婚姻/民族、紧急联系人*、到岗时间、工作性质等）；标签噪声归一（请选择/请输入、全角半角）；denylist 仍拦截上司微信等误匹配。
- **多段填写（初版）**：同标签多行时 `profileValueForOccurrence` 按 `eduList[i]` / `workList[i]` / `projectList[i]` 取值（最多仍受 `MAX_FILLS_PER_KEY` 约束）。
- SAMPLE 仍为虚构「张三」；manifest **1.5.0**。

### 1.4.1
- **修复：保存表单不再清空多段经历**：选项页「保存资料」原先只写扁平字段，会把 IndexedDB / `chrome.storage` 里的 `eduList`/`workList`/`projectList` 冲掉；现通过 `mergeFlatOntoProfile` 拼回列表。
- **修复：`normalizeProfile` / `emptyProfile` 保留列表字段**，避免解析结果在归一化时丢段。
- **修复：切换档案前确认未保存修改**；快速连点「应用」用代数号只落地最后一次。
- **修复：「清空」同时清理 IndexedDB 简历库**（文案与行为一致）。
- **修复：IndexedDB 打开失败后可重试**（失败时重置 `dbPromise`；监听 `onclose` / `onversionchange`）。
- **优化：解析文件上限 20MB**；整库导入前确认覆盖；`run-tests.mjs` 串联 `resume-parser.test.mjs`。

### 1.4.0
- **简历解析（纯本地）**：新增 `shared/resume-parser.js` + 打包 `pdf.js 3.11` / `mammoth 1.13`；PDF / DOCX / TXT / MD → 文本 → profile，无需联网、无 CDN。
- **多档案库**：新增 `shared/db.js`（IndexedDB，库 `resume-autofill`），多份简历共存，列表可应用/重命名/删除，支持整库导出与导入 JSON。
- **schema 扩展**：`eduList` / `workList` / `projectList` 三段数组；按最新在前排序，扁平主条目自动取第一条，旧匹配逻辑零改动。
- **选项页「简历库」**：导入 → 解析预览（字段 + 置信度 + 缺失提醒）→ 改名保存并应用；保存资料时同步回写当前档案。
- **解析策略**：标题别名分段（含 `一、`/`【】` 前缀）+ 日期区间切记录 + 学校/公司关键词校正 + 技能词表。
- 手册：README 新增「简历库与解析」；测试 107 + 14。

### 1.3.7
- 适配 Ant Design 日期面板（年面板 / `« 2020年 »` 月面板 / 日网格）；`gridNavigate` 修复「十年箭头」死循环；`parseDateParts` 收紧分隔符与数值校验；支持 `YYYY-MM` 的年月字段（`ym` 角色）；单字段异常不再中断整次填充。

### 1.3.0
- **playoffer 全量字段**：profile / 选项页 / 匹配关键词对齐 ATS 简历模型（约 255 键）；多段经历存主条目。
- **新分区**：实习、校园、社会实践、证书明细、外语明细、家庭（选填）、获奖、专利、论文、培训等。
- **匹配增强**：`姓名拼音`、`政治面貌`、`是否应届生`、`实习公司`、`上一家公司`、`紧急联系人姓名`、`现居住地址`、`最高学历` 等；证明人→`referee*`；上司 denylist 保留。
- **别名**：`currentAddress`↔`address`、`techSkills`↔`skills`、紧急联系人组合回退等。
- 文档：`docs/playoffer-field-map.md`；manifest **1.3.0**。

### 1.2.4
- **D9 毕业时间 / 月份拆分**：`毕业时间` 改映射 `eduEnd`（不再误为 `gradYear`）；`maybeExtractDatePartValue` 在年/月角色拆分失败时返回空串跳过，避免把年份 `2020` 塞进月份格。
- **D10 相邻年/月 placeholder**：Moka 等仅有 `placeholder="年"` / `"月"` 的输入对，通过相邻互补检测 + 祖先日期组标签（入学/毕业/…）完成角色与字段匹配。
- **安全 / 只填空说明**：只填空也会填「空白模板行」（空的教育/工作段），可能多出一段示例经历；提交前请删多余段。
- D1/D5（visibleLabelText、skip-if-filled）保持不变。
- manifest **1.2.4**；测试套件 79+。

### 1.2.3
- **D2 antd / React 表单标签**：`getLabelText` 增加 `aria-labelledby`、`.ant-form-item` / `.el-form-item` 等 form-item 标签发现，以及父列 previousSibling 回退；SCAN/COLLECT hints 优先放标签（D6）。
- **D3 上司联系人 denylist**：`直接上司电话/微信/QQ` 等不再误映射到申请人 `wechat`/`phone`/`qq`；`紧急联系人` 仍映射 `emergencyContact`。
- **D4 年/月拆分**：`extractDatePart` + `detectDatePartRole`，对 `birthday`/`eduStart` 等日期字段的「年」「月」分栏分别填入年份/月份。
- D1/D5（visibleLabelText、skip-if-filled）已在 1.2.2，本版不回归。
- 新增 Node 测试；manifest **1.2.3**。

### 1.2.2
- **visibleLabelText**：标签文本只取可见文案，跳过 select/option/input 等控件子树，修复「学历 / Degree」被 option 里 `High School` 的 `school` 误匹配为学校字段。
- **skip-if-filled（只填空）**：`fillFromProfile` / `applyMappings` 在写入前若字段已有有效值则跳过，不覆盖已填内容。
- 新增 Node 测试（visibleLabelText、source guard、manifest 1.2.2）；测试套件 67+ passed。

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
