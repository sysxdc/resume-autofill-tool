# 简历填写工具（resume-autofill-tool）

一款 **Chrome Manifest V3** 扩展：在本地保存你的简历资料，打开求职/申请表单页面后一键自动填写常见字段。支持 **中英同义模糊匹配**，以及可选的 **AI 巡查 / AI 填写**（OpenAI 兼容接口）。灵感来自 Simplify Copilot、Teal 等产品形态，**并非复制其代码**。

填写后由你自行核对并提交，扩展**不会自动点击提交**。

当前版本：**1.5.23**

## 功能概览

- **本地资料库**：选项页按 playoffer 风格折叠分区编辑（个人信息 / 求职意向 / 教育 / 实习 / 工作 / 项目 / 校园 / 社会实践 / 技能 / 证书 / 外语 / 家庭 / 获奖 / 专利 / 论文 / 培训）。
- **多段经历编辑（1.5.0）**：选项页可增删改排序 `eduList` / `workList` / `projectList`；保存写入列表；主条目扁平字段仍兼容旧匹配。
- **自定义下拉适配（1.5.0）**：原生 select、`.el-select`、`.ant-select`、`.dictionary-selector` / listbox 写路径；Yes/No radio 增强；见 `demo/dropdowns.html`。
- **加行按钮 + 起止时间合体控件（1.5.7）**：`增加教育经历` 这类「图标 + 文字」按钮会解析到真正的 `<button>`（之前点到没有 handler 的外层 div，点了没反应）；`起止时间` 合在一起的日期范围控件按「分区 + 第几段」分别填开始/结束。
- **网申字段覆盖基准（1.5.11）**：`tests/match-benchmark.mjs` 收录 10 个平台 228 条真实/惯例字段，
  命中率 100%（0 错配 / 0 漏配），`--check` 可做门槛；对接你的档案跑一遍能算出「能填 / 缺值 / 未匹配」。
  报告见 [`docs/match-coverage-20261023.md`](docs/match-coverage-20261023.md)。
- **Moka 网申（1.5.10）**：app.mokahr.com 的字段名在 `.title` 里（不是 `label[for]`），按「字段块」兜底识别；`sd-Select` 自绘下拉按「点开再选」处理。
- **悬浮窗（1.5.9）**：打开网页就出现一张可拖动的小卡片（位置和收起状态会记住），直接「一键填写」；填完把还空着的字段按「分区 · 字段名」列出来，必填项带 `*`，不用自己一行行找。
- **语言技能 / 外语栏位（1.5.8）**：`语种`、`语言等级（CET-6 / 雅思…）`、`成绩`、`获得时间` 按语言分区识别；`语言等级 / 外语等级` 映射到 `englishLevel`，分区内的泛化「成绩」才落到 `certScore`（不会把高考成绩、绩点带偏）。
- **北森 Phoenix 网申（1.5.6）**：zhiye.com 的 `phoenix-select` 下拉 / 年月日期 / 字典与地区弹层 / div radio 全部走「点开弹层再选」；弹层按「本次新出现」判定、搜索后等重渲染、svg 勾选热区单独处理。组件结构与实测结论见 `docs/beisen-phoenix.md`。
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

## 多会话协作（同一 checkout）

本仓库曾被两个会话在**同一个 checkout** 上交替提交（v1.5.14–v1.5.16 与 v1.5.17–v1.5.20 混在一条 HEAD 历史里）。
那不会丢代码，但会让人误以为文件「莫名其妙变了」，也让「合并推送」变成猜谜。开工前先跑：

```bash
bash scripts/repo-state.sh
```

它会告诉你：当前分支与远端关系、未提交改动、**有几个 worktree 指向同一个 `.git`**、有没有 `.git/*.lock`、
**哪些分支 ahead main（=别人的活还没合）**、最近 5 条提交、stash 状态。

约定：

- 写代码前跑一次；**看到别的 worktree 或 ahead main 的分支就先确认**，别直接在自己的分支上继续堆提交
- 提交前 `git log -1` 看一眼父提交是不是自己上一条——不是的话，这个 checkout 被推进过，先重新确认改动范围
- 一轮工作结束就 push，别长期把提交压在本地分支上（压得越久，并线时越难分辨谁动了什么）
- 被放弃的临时改动用 `git stash` 时要留原因和恢复方式；确认已被后续实现覆盖后再 `stash drop`，
  并把 stash 提交固定成 `refs/attic/<名字>` 以便反悔（`git update-ref` 一条命令就能恢复）

## 自动化测试

```bash
npm test                        # 等价 node tests/run-tests.mjs（串联 unit + DOM + parser）
npm run test:dom                # 只跑真实浏览器里的控件行为基线（需 playwright）
npm run test:benchmark          # 网申字段匹配基准
# 或零依赖直接：
node tests/run-tests.mjs
node tests/run-dom-tests.mjs
```

DOM 基线依赖可选的 `playwright`（见 `package.json` `devDependencies`）。未安装时 `run-dom-tests.mjs` 会尝试 `npm root -g` 与 `~/.local/lib/node_modules/playwright`；仍找不到则跳过并提示，不阻塞主套件。

三套分层，各管一件事，别再混着看：

| 套件 | 断言什么 | 能不能证明「填得对」 |
|---|---|---|
| `tests/run-tests.mjs`（≈190+ 项） | 关键词/模糊评分、denylist、`profileValue`、select 匹配、AI merge 纯函数、manifest 结构 | **不能**，只做 smoke：防手滑删类名/常量 |
| `tests/run-dom-tests.mjs`（26 项 + `fixtures/dom/*.html`） | 真实 Chromium 里「怎么打开 / 怎么写进去 / 回读是什么 / 有什么坑」 | 能，这是唯一的行为证据 |
| `tests/resume-parser.test.mjs`（20 项） | 简历文本 → 结构化 profile | 能（解析域） |

### 为什么要有 DOM 基线

历史上 174 条单测全是对源码字符串断言（`assert.ok(src.includes('.ant-calendar-picker'))`），改一行类名就绿，真实站点照样填不上——「改好了 → 实测还是不行」的重演根因就在这。

`fixtures/dom/` 里是自包含的控件复刻页（无 CDN、无真实个人信息），每个包住一类组件和一个真实的坑：

| fixture | 组件 | 锁住的坑 |
|---|---|---|
| `wecruit-antd3-select.html` | antd v3 远程搜索下拉 | 隐藏 input 存 `0/20000/20001` 编码值 → 「是否已填」不能看它；**点 li 不提交**，只有键盘 `ArrowDown`+`Enter` 才提交 |
| `r11-antd-month.html` | antd 风格「只有年月」面板 | 绑的是 `focus` 不是 `click`，合成 click 打不开；年视图有「±1 年 / ±10 年」两种箭头 |
| `r12-antd-date.html` | antd 风格年月日面板 | 表里混着非当月格子，点错会串月 |
| `r1-en-datepicker.html` | 英文日历 + 上/下月导航 | 没有年视图，只能逐月点；42 格里有相邻月 |
| `datepanel-replica.html` | 年表/月表/日表 | 不点「确定」不回写 |
| `r5-wheel-picker.html` | 滚动轮 | 点选后还要「确定」才提交 |
| `r4-paginated-select.html` | 分页下拉 | 点选项立即提交，无需确认 |
| `r3-ymd-selects.html` | 年/月/日 三个原生 select | 年、月 value 不补零，日补零——统一补零写不进去 |
| `calendargrid-replica.html` | 日历网格 | 年箭头与月箭头语义不同，不能混用 |

**新增控件的规矩**：先写 fixture（复刻出那个坑），再写策略；策略合并时必须让对应用例从红转绿。只有源码字符串断言的改动不算修好。

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
│   ├── beisen-phoenix.md         # 北森 Phoenix 组件结构 + 适配说明
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
- **北森「面试站点」不会硬填**：选项常是「XX 大学（线下站）」这类宣讲站点，档案里没有对应数据，
  宁可不填也不猜；提交前手动选一下。

## 填写审计（`shared/audit.js`）

填完之后把「我们以为填进去的值」和「页面真实显示的值」逐项对一遍，纯本地比较、不发网络：

```
已填 18 项；校验 6/15 一致，29 处空着
AUDIT { ok: 6, approx: 9, empty: 0, wrong: 0 }   ← wrong 必须永远是 0
```

| 状态 | 含义 | 处理 |
|---|---|---|
| `ok` | 页面值与档案一致 | 通过 |
| `approx` | `day-approx`（月精度补日）、`code-suffix`（专业被加「(自动化类)(普通本科)」）、`truncated`、`option-longer` | 通过但标注 |
| `empty` | 写了但读不回值（值进了搜索框 / 点 li 不提交 / 受控组件把值吞了） | 列进「没填上」，**不是**已填 |
| `mismatch` | 页面显示的是另一个值 | **红线**，列进 `skipped` 并要求人工处理 |

判断收紧过两次，都是为了不放过"看起来像"：

- 「包含即近似」会把 `广东工业大学` vs `广东工业大学华立学院`（另一所学校）判成通过 → 现在只有**括号后缀**才算消歧后缀
- 日期判级复用 `date-capability`，所以 `2023-09 → 2023-09-01` 是 `approx`，`2023-08 → 2023-09` 是 `mismatch`

审计的在册点：主输入框、自定义下拉、只读日期控件、日期组、弹窗选择器（专业/学校）、单选组、起止时间合体控件。

## 日期策略层（`shared/date-strategies.js`）

能力层回答「期望值/回读值差到什么程度」，策略层回答「按什么顺序试、每步怎么验、失败了记什么」：

```js
S.fillDate(input, '2024-03-15', { perStrategyMs: 4000 })
// → { ok, level:'exact'|'day-approx'|'month-only'|'mismatch', strategy:'grid-click',
//     attempts:[{id:'native-input',level:'n/a'}, {id:'panel-nav',level:'exact'}], value }
```

- **顺序固定**：`native-input → native-selects → fiber-props → panel-input → panel-nav → keyboard-pick → grid-click → confirm`
- **每步写完立刻回读判级**：`exact` 立即停；可接受但非 `exact` 记 best 后继续找更精确的；全失败 → `ok:false` **留空**
- **同槽位可叠加**：内置实现先跑，返回 `false` 才跑注册进来的 → antd 的 `panel-nav` 不会顶掉通用「年/月/日表格」，反之亦然
- **站点扩展只写策略，不改顺序**：`autofill.js` 里 `S.register('panel-nav', tryAntdPanel)` 这样一行即可
- **预算护栏**：`perStrategyMs` 上限 + 模块活动预算，翻月/翻年这类长循环必须尊重它
  （曾因为一个难缠控件吃掉全部预算，把 7 个日期字段拖到整轮超时）

`content/autofill.js` 里原先 20 多个并列 `tryXxx` 的顺序判断已收敛到这一处：
`fillReadonlyPickerAntd` 现在是「打开面板 → `S.fillDate(4 个槽位)` → 不行再走候选路径」。

## 日期能力层（`shared/date-capability.js`）

日期控件是网申里最花的一类：同一个「2023-09」，有的站点要选年月、有的必须选到某天、
有的只给三个原生 select、有的要翻年视图再翻月。历史上每个站点都加一个 `tryXxx`，
`content/autofill.js` 里堆了 20 多个并列分支。能力层把与站点无关的四件事固定下来：

```js
Date.parseModel('2023-09')     // → { y:'2023', m:'9', d:null, precision:'month' }
Date.parseModel('至今')         // → { precision:'open', open:true }
Date.matchLevel('2023-09-01', '2023-09')  // → 'day-approx'（允许的降级）
Date.matchLevel('2023-08-01', '2023-09')  // → 'mismatch'（红线：错填）
Date.probeControl(inputEl)     // → { kind:'antd-picker'|'antd-v3-calendar'|'native-select-group'|…, hints }
Date.STRATEGY_ORDER            // native-input → native-selects → fiber-props → panel-input
                               // → panel-nav → keyboard-pick → grid-click → confirm → give-up
```

**精度判级就是「零错填」红线的落地方式**：

| 等级 | 含义 | 处理 |
|---|---|---|
| `exact` | 年月日都对上（或都只有年月） | 算成功 |
| `day-approx` | 期望只有年月，控件只能选到某天，补了 1 号 | 算成功，但进 `degradedDates` 标注 |
| `month-only` | 期望有日，控件只给年月，日被吃掉 | 算成功但标注（日粒度信息丢失） |
| `mismatch` | 年或月不一致 | **红线**，回滚/留空 |

填完结果里 `degradedDates: [{ key, actual, want, level }]` 会一路带到悬浮窗
（`#__ra_panel_host__.dataset.lastResult`），降级不再静默。

## Changelog

### 1.5.23

一轮「识别 → 填写 → 回读」全链路复查，重点是**零错填**与**杜绝「点了 / 写了但页面上没有」**。

- **错填修复（识别）**：中文模糊匹配收紧——4 字关键词差 1 字不再算命中（之前「入职日期」→ 入党日期、
  「邮寄地址」→ 邮箱、「论文发表日期」→ 证书时间）；补齐同义关键词（离职日期、入学年份、户口所在城市、
  期望工作城市 / 意向工作地点、六级分数、证书获得日期…）；`degreeType` / `degreeCategory` 之前不在
  `FIELD_ORDER`，永远匹配不到；camelCase 拆词（`userEmail`）此前因先小写而从未生效。
- **第三方实体**：新增「人 + 属性」组合识别——父亲姓名 → `familyName`、母亲工作单位 → `familyEmployer`、
  紧急联系人与本人关系 → `emergencyContactRelation`；推荐人 / 内推人 / 担保人一律不填。
  旧版会把申请人自己的姓名填进「父亲姓名」。
- **同义归一精确匹配**（只在原样匹配失败后用）：日期↔时间、号码↔号、分数↔成绩、全称↔名称……
  比编辑距离安全（不会把入职折成入党）。
- **下拉选项匹配改为打分 + 歧义拒填**：否定词不一致绝不选（接受 ≠ 不接受调剂、可以 ≠ 不可以、
  全日制 ≠ 非全日制、本科 ≠ 本科以下）；学历同义只取一个组（博士研究生之前会选成「硕士」）；
  英文缩写只认整词（MA ⊄ Diploma）；选项编码值（"3"）不参与包含匹配；多个选项都包含时不猜
  （计算机 → 计算机科学与技术 / 计算机应用 → 留空）；北京 ≈ 北京市（行政区后缀）；
  纯数字落进区间选项（GPA 3.8 → 3.5-4.0，边界值两边都中 → 留空）；
  是非题认「接受 / 同意 / 服从」及其否定。页面侧同义词选项、单选组、联动下拉同样加了否定护栏。
- **写入必须回读确认**：`writeAndVerify` 写完等框架重渲染（微任务）再读；对不上依次重试
  `execCommand('insertText')` → 逐字键入；仍不行就还原原值并报 `set_value_failed`。
  格式化差异（手机号掩码、分隔符、大小写、日期写法）判为成功，内容差异（清空 / 截断 / 改值）判失败。
  「至今」开关、单选组、北森 radio 点完都会回读选中态，合成点击不生效时补原生 click。
- **审计回写统计**：填完等一拍再整体回读，被清空的记 `not_written`、被改值的记 `audit_mismatch`，
  都从 `filled` / `filledKeys` 里扣掉（旧版只报不扣，悬浮窗会显示「已填」）。修正三处审计误报：
  年/月/日三件套、Moka 年月下拉对、起止范围控件之前按单格回读，必然判 mismatch。
- **日期兼容**：统一模型新增英文月份（Sep 2020 / 15 Sep 2020）、`09/2020`、`202009` / `20200915`、
  全角数字、`2020年九月`、美 / 欧式月日年（两个都 ≤12 时两种都判）。
  原生 `type=month` 之前被写成年月日（浏览器直接清空），现在按 `date / month / datetime-local` 规范写；
  文本日期框按 placeholder / data-format 的格式写（`YYYY/MM`、`yyyy年mm月dd日`、`MM/DD/YYYY`、
  `例：2020.09.01`）；年月值遇到只能点日的面板 / 日历网格时点 1 号（day-approx）；
  策略链全部失败时把留下的错值回滚。新增 Vue 3（Element Plus）日期 / 范围 / 数字组件的
  `onUpdate:modelValue` 提交路径（旧版只认 Vue 2 的 `__vue__`，Vue 3 上「看起来填了、表单没收到」）；
  范围控件没有组件实例时不再往 input 里硬塞文字。
- **maxlength**：长文本在句末截断，证件号 / 电话这类短值放不下直接跳过（截断就是错值）。
- **性能 / 内存**：关键词匹配预编译正则 + normalize 缓存 + 字符预筛 + 结果缓存（上限 1500 条），
  未命中缓存的匹配约快 5.8 倍（4.1 → 0.7 ms/次）；标签 / 区块上下文 / hints 在一轮内用 WeakMap 缓存
  （每个字段之前要算 5~6 遍）；「添加」按钮扫描改为只遍历含关键字的文本节点；审计完释放对 DOM 节点的引用；
  页面没有 iframe 时不再固定等 900ms 收子 frame 汇报（有 iframe 时全部汇报完即结束）；
  末尾的自定义下拉循环也受 45s 总预算约束。demo 实测：一键填写 1288 → 504ms、
  「扫描 + 未填清单」65 → 5ms，填写数量不变、零错填。
- **打包**：`scripts/package.py` 之前漏了 `popup/`（工具栏弹窗打不开）和 `lib/`（PDF / DOCX 简历导入用的
  pdf.js、mammoth），补上并加自检：manifest 引用的文件、各页面 `<script src>` 引用的本地文件都必须在包里。
- **测试**：单测 +6 组（202 条）；基准集 +17 条「语义兼容」（245 条，旧版在这 17 条上错配 13 条）；
  新增 2 个端到端用例（`tests/fixtures/dom/e2e-*.html`）——把整套内容脚本装进真实 Chromium、
  用假的 `chrome.storage` 跑一键填写，断言页面真实值与上报结果。

### 1.5.22

- **真 bug**：v1.5.16 的 `EXTRA_LABEL_KEYS` 把「工作经验 / 语种 / 语言等级 / 服从城市分配」别名到
  `workYears` / `languageType` / `languageLevel` / `cityAdjustment`——这些键**不在** `PROFILE_FIELDS`，
  `profileValue` 永远空 → 相关字段静默不填。改为真实键 `years` / `langName` / `langLevel` /
  `acceptAdjustment`。
- **匹配**：`语种` 从 `languages`（自由文本）改到 `langName`（联动下拉一级）；`语言等级` /
  `掌握程度` 等归 `langLevel`（不再误落 `englishLevel`）；`工作经验` → `years`；
  `是否服从城市分配` 等归 `acceptAdjustment`，并加 guard 防止短词「城市」抢走。
- **联动下拉**：`fillLinkedSelectChains` 按标签文本再兜底识别「语种 / 语言等级」。
- **DX**：补最小 `package.json`（`npm test` / `test:dom` / `test:benchmark`）+ 可选
  `playwright`；`run-dom-tests` 的 `loadPlaywright` 额外尝试 `~/.local/...`。
- 回归单测覆盖上述标签；勿把幽灵键写回别名表。

### 1.5.21

- 新增 `scripts/repo-state.sh`：开工前体检（worktree / 锁文件 / 分支 ahead main / 未提交改动 / stash），
  README 补「多会话协作」约定——本仓库确实出现过两个会话在同一个 checkout 上交替提交。
- 清理 `git stash`：两条 wip（`dropdownForHost`、`degree fix`）逐条比对确认已被后续实现覆盖
  （`dropdownForHost` 等 10 个函数均在 HEAD；`LABEL_SKIP_TAGS` 的能力已由 `visibleLabelText` 内的
  `SKIP_TAGS` 等价实现），先固定成 `refs/attic/stash-0-dropdownForHost`、
  `refs/attic/stash-1-degree-fix` 再 drop，需要时可反悔恢复。

### 1.5.20

- **单源化**：`autofill.js` 里 `findDatePanel / numericGroups / clickPanelItem / clickPanelConfirm /
  gridHeader / pickArrow / setPanelPeriod / gridNavigate / gridClickDay / isCalendarGrid /
  expandToActionableHost / looksLikeWeekHeader` 的兜底副本全部删除，只留一行委托 +
  `DATE_PANEL_SEL / CN_MONTH / EN_MONTH` 三个已搬走的常量也清掉（真实现只在 `shared/date-strategies.js`）。
- **联动下拉** 新增 `shared/select-chain.js`：`fillChain([{host,value}…])` 按顺序填，
  每级回读通过才继续，下一级以「选项集合发生变化」为就绪信号（不是死等固定 sleep）。
  `fillFromProfile` 用它填「语种 → 语言等级」（`langName → langLevel`）。
  直接写第二级必然失败——因为选项还没生成，这条现在有 fixture 和用例守着。
- 三个旧用例的断言目标从 `content/autofill.js` 改到 `shared/date-strategies.js`（实现已搬家）。
- 测试：主套件 189、DOM 基线 **26**（新增 `r17-lang-linked` 三条：直接写第二级失败 /
  按顺序成功 / 换语种后等级选项跟着换）、解析 20 全绿。
- 真实 wecruit 回归：18 项、`wrong=0` 不变；该页语种/等级由站点预置（档案无 `langName`），链条自动跳过。

### 1.5.19

- **AI 请求改成白名单** `shared/ai.js`：默认 `mode: 'whitelist'`，请求里只有
  「页面字段标签 + 控件类型 + 选项文本 + 你填过的键名」，**简历值一律不出本机**；
  模型只回 `profileKey`，值由本地 `mergeAiMappingWithProfile` 按 key 取。
  旧行为（发整份 profile，含证件号/手机/住址）保留为 `mode: 'full'`，需在选项页显式选择。
  选项页新增「发送内容」选择器。
- **新增填写审计** `shared/audit.js`：填完逐项比对「期望值 vs 页面真实值」，输出
  `ok / approx / empty / mismatch`；`mismatch` 会追加进 `skipped` 并在悬浮窗状态行报数。
  审计在册点：主输入框、自定义下拉、只读日期控件、日期组、弹窗选择器、单选组、起止合体控件。
- **修掉一个让诊断永远失效的缺陷**：`handleFill` 是白名单式重组结果，`degradedDates` /
  `dateTries` / `audit` 这些字段没被透传 → 悬浮窗永远看不到（1.5.17 写的 `degraded` 其实一直没生效）。
  现在显式透传，并在注释里写清「漏一个 = 该字段永远 undefined」。
- 审计判据收紧：`广东工业大学` vs `广东工业大学华立学院` 判错填（另一所学校）；
  只有括号消歧后缀（`自动化(自动化类)(普通本科)(中国大陆)`）才算近似。
- 测试：主套件 188、DOM 基线 23（新增 3 条审计用例，含「只输入不提交 → 判读不回」）、解析 20 全绿。
- 真实 wecruit 实测：`已填 18 项；校验 6/15 一致`，`wrong: 0`，9 条 approx 全部标注
  （6 条专业消歧后缀 + 3 条月精度补日）。

### 1.5.18

- **新增日期策略层** `shared/date-strategies.js`：`fillDate()` 按 `STRATEGY_ORDER` 依次试、
  每步回读判级、`exact` 即停、可接受非精确记 best、全失败留空；`register()` 让站点特有实现
  （antd v3 面板 / fiber 直写 / antd 面板 / 日格）挂到固定槽位，同槽位内置在前、注册在后。
- **收编原 `autofill.js` 里的日期工具**：`findDatePanel` / `numericGroups` / `clickPanelItem` /
  `clickPanelConfirm` / `gridHeader` / `pickArrow` / `setPanelPeriod` / `gridNavigate` /
  `gridClickDay` / `isCalendarGrid` / `expandToActionableHost` / `looksLikeWeekHeader` 统一搬进策略层，
  页面侧改为委托（保留旧函数名，调用点不动）。
- `fillReadonlyPickerAntd` 的 4 段 if 链换成一次 `S.fillDate(['fiber-props','panel-input','panel-nav','grid-click'])`。
- **修掉一个会挂死整轮填充的缺陷**：只读控件的异步策略链里如果抛异常，`resolve` 永远不会被调用，
  悬浮窗就停在「正在填写…」。现在整段包了 try/catch，异常时记录 `dateTries` 并 `resolve(false)`。
- 预算护栏：`perStrategyMs`（默认 4000ms）+ 模块活动预算，翻月/翻年循环必须提前退出。
- DOM 基线 14 → **20 条**：新增 6 条直接跑 `fillDate` 的用例——三个原生 select 合起来判级、
  年/月/日表格、英文日历翻月、网格年+月箭头、**只有年月的面板搞不定就留空（零错填）**、
  **注册一个站点策略后同一个控件就能填**。
- 真实 wecruit 回归：17–18 项照旧填上（页面自带值的字段会被跳过，计数会浮动），`degradedDates` 为空。

### 1.5.17

- **新增日期能力层** `shared/date-capability.js`（manifest content_scripts 里排在 `autofill.js` 之前）：
  统一模型 `parseModel`（年月日 / 只有年月 / 至今 / ISO 时间尾巴）、精度判级 `matchLevel`
  （`exact` / `day-approx` / `month-only` / `mismatch`）、控件探测 `probeControl`（纯观察不点击）、
  固定策略顺序 `STRATEGY_ORDER`。
- `autofill.js` 的 `parseDateParts` / `dateValueMatches` 改为委托能力层；新增 `dateMatchLevel`。
  **`mismatch` 一律不算填上**（零错填红线），`day-approx` / `month-only` 照旧填但记进 `degradedDates`。
- 悬浮窗诊断数据新增 `degraded` 字段，降级精度可见。
- DOM 基线扩到 **14 条**：新增 5 条能力层用例，直接在真实控件上验证
  `probeControl`（antd v4/v5 / 三个原生 select / 下拉）与 `matchLevel`（月精度 exact、日精度 month-only、跨月 mismatch、补日 day-approx）。
- 真实站点回归（wecruit）：仍为**已填 18 项**，`degradedDates` 为空（该页日期都是精确匹配），无回归。

### 1.5.16

- **Moka（app.mokahr.com）古茗这类校招页整体兼容**：
  - `sd-Select` 的 input 之前被当成「下拉内部搜索框」过滤掉了 —— 既填不上、
    也不出现在「未填」清单里。现在放行，交给 `fillCustomSelect` 点开选。
  - 「必填项未填写」这类红色校验提示曾被当成「已选中的值」，导致该下拉直接跳过。
  - 档案值和选项同义词不同写法（`应届生` vs `应届毕业生`）时匹配不上，
    现在加了一层同义组（应届/本科-学士/硕士-研究生/是-接受/否-不接受…），
    选完的校验也认同义词，不会再「选对了又被撤掉」。
  - 新补一层标签别名：所在地→现居城市、工作经验→工作年限、职责→项目角色、
    语言类型/掌握程度、期望城市、城市选择能否服从分配。
  - **「年 + 月」下拉对**（毕业时间 / 就读时间 / 起止时间）之前完全填不了：
    它们不是日历，是一串 `sd-Dropdown`，placeholder 是「年」「月」。
    新增 `fillYearMonthPairs`：按分区取 `eduList[i]/workList[i]/projectList[i]` 的起止，
    输年份/月份筛选后点选，4 个下拉（起止）或 2 个下拉（单月）都处理。
  - 表单是分块懒挂载的，点太早会漏掉下半截字段：填写前先等输入框数量稳定（≤1.5s）。
- 实测（古茗校招在线申请）：一趟填 **23 项**，剩下的只有推荐码、籍贯（只读城市选择器）、
  档案里没有的「项目中职责」。

### 1.5.15

- **中华英才网 wecruit（`wecruit.hotjob.cn`，antd v3）控件逐个对不上**：
  - **日期**：v3 是 `.ant-calendar-picker` + `.ant-calendar-picker-container`，且**只认原生 click**——合成
    `mousedown/click` 打不开面板（实测 y=-3910 的屏外字段也一样，原生 click 就行）。面板里 `.ant-calendar-input`
    写入 `YYYY-MM-DD` + Enter 最稳，退化路径走「年份面板 → 月份面板 → 日格」。
  - **下拉**：v3 的选项是 `li.ant-select-dropdown-menu-item`、已选值是 `.ant-select-selection-selected-value`，
    跟 v4/v5 完全不是一个类名。现在按 `.ant-select` 但无 `.ant-select-selector` 判定为 v3，走「原生 click 打开 →
    需要时输入搜索词 → 原生 click 选项 → 回读已选值」。
  - **值写进了搜索框**：主循环以前会把值写进 `.ant-select` 内部的搜索 `<input>`，组件不显示、页面一重渲染就没了；
    现在这类内部输入框统一跳过，只由下拉写路径负责。
  - **性别单选**：`.ant-radio-wrapper` 的 label 在另一列（`.ant-form-item-label`），组标题兜底去那里取；
    v3 的 Radio 也只认原生 click，合成事件不触发 `onChange`。
  - **没有区块标题的表单**：这块「教育经历 / 工作经历」只有重复的字段组，没有标题。新增
    「同一组字段里的兄弟标签」推断分区（有学校/专业 → edu，有企业名称/工作描述 → work），
    于是第二段的「开始时间 / 结束时间」不再被判成泛化的 `startDate/endDate`。
  - **省市级联**：`籍贯` 是 `.cascader-plugins-wrap` 里的两个下拉，档案里是「广东省-阳江市-江城区」，
    新增按行政区后缀切前缀，第一级能落到「广东省」。
  - **学校（远程搜索）**：下拉初值是「暂无数据」，输入校名后才有选项；**鼠标点选项不提交**，
    要键盘逐条 `ArrowDown` 到高亮的正是目标再 `Enter`（盲按第一下会选中列表第一条，籍贯曾因此填成「上海」）。
  - **专业（弹窗选择器）**：点输入框弹 `ant-modal`，里面是 `请输入专业名称` + `span.school-item` 列表，
    现在会搜关键词 → 点匹配项 → 点「选择」。没选中的弹窗会被关掉，否则遮罩会把后面的下拉点击全吞掉。
  - **「已填」误判**：v3 下拉的隐藏 input 里存着 `0/660/411987` 这种编码值，原来会被当成「已经填过」直接跳过；
    现在 v3 只认 `.ant-select-selection-selected-value`。这一条就是「学校怎么都不填」的直接原因。
- **诊断**：悬浮窗把最近一次填充结果（`filled` / `filledKeys` / `skipped`）挂在宿主节点的 `dataset.lastResult` 上，
  页面里读 `document.getElementById('__ra_panel_host__').dataset.lastResult` 就能看到「这个字段为什么没填」。

### 1.5.14

- **antd 日期框改成「直接改组件值」**，不再死磕点日历：
  从 DOM 往上找 Picker 组件的 fiber（特征：带 `generateConfig` + `onChange`），
  用 `generateConfig.setYear/setMonth/setDate` 造出日期对象，直接调它的 `onChange` ——
  Form 就是靠这个存值的，所以和真选一样，且**不需要任何点击**。
  - 单个日期框（毕业日期 / 出生日期）：先走这条路，失败再退回点日历
  - 范围控件（RangePicker，两个 input 都 readonly）：先走这条路，失败再退回点日历
- 范围控件的分区取数：实习分区常常只有 `workList`（实习写在里面），
  不再因为 `internList` 为空就跳过。
- 实测（campus.kuaishou.cn 在线编辑）：
  教育经历起止 `2023-09-01 ~ 2027-06-30`、实习经历起止 `2025-07-01 ~ 2025-09-30`、
  毕业日期 `2027-06-01`、出生日期 `2004-09-20` 全部落进表单，已填 11 项 / 未填 9 项。

### 1.5.13

- **快手校招：实习经历写不进去** —— 分区标题是 `.edit-resume-form-item-title`，不在「点添加」的标题识别表里，
  于是「实习经历」的「添加」根本没被点，整块永远是空的。补上这类标题选择器；
  行数按 `interShips_0_xxx` / `educations_0_xxx` 的 id 前缀统计，不会重复点成多行；
  档案里只有 `workList`（实习写在里面）时也能展开实习分区。
- **快手校招：毕业日期填不了** —— antd 的日期框是受控组件，往里写字不会提交。现在：
  - 合成事件打不开日历，就直接调组件自己的 `onMouseDown`（`__reactEventHandlers$` 上的函数，等于真点击）；
  - 日格子带 `title="YYYY-MM-DD"`，按 title 点；跨年先点「年份」进年面板再跳，不再逐月翻三年；
  - 单个日期框（毕业日期 / 出生日期）实测能填：`2027-06-01`、`2004-09-20`。
- `app.mokahr.com` 那种 `sd-Select` 不受影响，BYD 的 Element 日期面板照旧。

### 1.5.12

- **快手校招（campus.kuaishou.cn）一个字段都填不进去**，根因有两个：
  - `findCustomSelectHost` 用 `[role="combobox"]` 找下拉宿主，而 antd v5 把 `role="combobox"` 放在 **input 本身**上。
    host 变成了那个 input：`host.querySelector('input')` 是 null、弹层读不到、`customSelectLooksFilled` 永远 false，
    于是每个下拉都走一遍注定失败的流程。现在命中 input/textarea/select 就缩放回 `.ant-select` 这类外层组件。
  - 「最高学历学校 / 最高学历专业 / 最高学历毕业日期」被关键词匹配成了 `highestDegree`
    （先撞到「学历」），学校框里被塞「本科」。新增组合词优先判断：`...学校 → school`、`...专业 → major`、`...日期 → eduEnd`。
- **可搜索下拉（学校 / 专业）改成「先输入再选」**：点开 → 没匹配就网搜索框里输值 → 等远程结果（最多 4.2s）→ 点完全一致的那条。
  同一页面会同时挂着好几个没关的 antd 弹层，按 `aria-controls` 找到本字段的 listbox 再上溯到弹层，多弹层并存时只取最后出现的那组。
- **不再「宁可选错」**：
  - 选项点下去之前先核对：选项文字跟档案值对不上就不点（`斯威本科技大学` 进学校就是这么来的）。
  - 点完再读一次选中项核对；antd 没有 `.ant-select-selection-item` 就算没选中，不拿搜索框里的残留文字冒充。
  - 区号下拉（`+86` / `+82`）不再被手机号命中。
  - 选完之后**不按 Esc**：rc-select 的 Esc 会把旧值还原，刚选好的学校会被撤回去。

### 1.5.11

- **网申字段覆盖基准**：新增 `tests/match-benchmark.mjs`（228 条 / 10 平台，标注 `obs`=真实页面、`gen`=平台惯例），
  支持分平台命中率、`--check` 门槛（≥98%）、`--profile` 对接真实档案。基线 86.0% → 现在 100%（0 错配 / 0 漏配）。
- **补齐一批真实缺口**：
  - 新增 `workDepartment`（工作经历「部门」以前压根没有键，profileValue 恒空，永远填不上）；
  - 「是否服从调剂」「投递志愿」「现居地 / 现居住城市」以前匹配不到；
  - 教育块「学位」不再被判成 `eduDegree`（会把「本科」写进学位框），改判 `degree`；
  - 工作块「离职原因」不再被判成 `workEnd`；「证明人职位 / 联系方式 / 姓名」不再被 `title` 抢走；
  - Workday「Role Description / Responsibilities」以前被判成 `title`，现归 `workDescription`；
  - 「自我介绍视频 / 附件 / 验证码 / 推荐码 / legally authorized」进 skip 名单，以前「自我介绍视频」会被 `summary` 填进去；
  - 裸「区号」不再当字段名（只在 `手机区号 / 电话区号 / 国家区号` 这类限定写法下才认）。
- **报告**：`docs/match-coverage-20261023.md` 记录了分平台命中率、被修掉的缺口，
  以及「对接本机档案后只有 64.9% 能填上 → 补 8 个字段到 77.6%、补 17 个到 85.5%」的边际收益表。

### 1.5.10

- **Moka（app.mokahr.com）填不动 / 填错**：
  - 字段名不在 `label[for]`，而在 `.apply-field > .title > span > span` 里。新增「字段块」兜底识别（控件上方/左侧的短文本），
    并排掉校验提示（`必填项未填写`）、区号（`+86`）、导航条这类噪声——之前正是它们被当成字段名，造成误填。
  - `sd-Select` 自绘下拉接入通用下拉写路径（`sd-Menu-content-item` 当选项），以前是把「本科」直接写进 input，页面一重渲染就没了。
  - 同一控件组里的「+86」这类兄弟控件不再被当成标签；搜索框（`输入职位关键字`）继续跳过。
- **「点一下没反应」的悬浮窗胶囊**：拖动遮罩原来在 `pointerdown` 就铺满全屏，把胶囊的 click 吞掉了。
  现在遮罩只在真的拖起来之后才出现，展开动作改在 `pointerup` 里判定，胶囊点一下就能展开。
- **未填字段说清楚「在哪」**：清单改成「分区 · 字段名」，多条时带序号（`教育经历 2`），并且**点一下会滚到那个字段并闪一下**
  （`api.revealField`）。自定义下拉已经选过的（值渲染在 span 里那种）不再误报为空。
- **不会一直转圈**：单次填充加了 45s 上限，超时就在气泡里说明「部分字段没处理完」，不再看起来像卡死。

### 1.5.9

- **悬浮窗**：新增 `content/panel.js`，在任意页面右下角放一张可拖动的卡片（Shadow DOM，样式不污染页面；
  用 `createElement` 构建，避开 BYD 这类开了 Trusted Types 的站点）。位置 / 收起状态存 `panelState`，
  收起后变成小胶囊。填充逻辑通过 `window.__resumeAutofill` 直接调用（同一个 content-script world，不走消息中转）。
- **未填字段清单**：填完会自动列出页面上还空着、且能认出标签的字段，格式「分区 · 字段名」，必填项标 `*`；
  填充结果里也带上 `unfilled`，弹窗 / 悬浮窗都能直接用。
- **语言技能补两个键**：`englishScore`（外语成绩）、`englishDate`（外语取得时间），选项页在「英语等级」下面新增两栏；
  没填时分别回退到 `certScore` / `certDate`，老档案不用改。语言分区里的「成绩 / 获得时间」现在优先用这两个键，
  不再被证书的 `certDate` 抢走。

### 1.5.8

- **语言技能栏位填不上**（BYD 校招简历实测）：`语言等级` 之前匹配不到任何键（`请选择` 一直空着），
  分区里的 `成绩` 也匹配不到（泛化「成绩」不能乱映射，否则高考成绩/绩点会被写进语言成绩）。
  现在 `语言等级 / 外语等级 / 语言级别 → englishLevel`，只有区块标题是「语言技能 / 外语」时
  `成绩 → certScore`。`语种`、`获得时间` 仍按 `languages` / `certDate` 走。
- **「点了没反应」的第二个原因**：`querySelectorAll` 先返回祖先 `div`，它的文案和按钮相同，
  于是先点到一个没有 handler 的外层容器（用户看到的就是「点了没反应」，同时展开逻辑空转 3 轮 ~12s）。
  现在候选只保留最内层可点元素，行数一次就能涨上去。
- **下拉等得太死**：`fillCustomSelect` 固定等 320ms + 重试 280ms，慢页面（BYD 弹层要 1.5s+）必然失败。
  改为轮询到选项出现（最多 2.6s），前台标签页实测 100ms 内就绪，失败时才关弹层。
- **`el-input-number` / `el-date-editor` 写不进去**：这两个是 Element 包装组件，直接写 `input.value`
  不更新 v-model，重渲染后值被清掉（「成绩」「获得时间」就是这种情况）。现在优先走组件实例的
  `input` 事件（数字传 Number、日期按 `valueFormat` 传 Date 或 `yyyy-MM-dd`）。
- **`电话所在区域` 不再被当成手机号**：新增 `phoneCountryCode`（区号/国家码），避免把手机号写进区号下拉。

### 1.5.7

- **「增加 XX 经历」点不动**（BYD 校招简历实测）：按钮是 `<button><i/> <span>增加教育经历</span></button>`，
  老逻辑先按「子元素 > 1 就跳过」把 button 排除，又把 span 当成「与外层文案相同的重复项」丢掉，
  最后只剩一个没有点击 handler 的 wrapper div —— 点了没反应。
  现在统一上溯到 `button / a / [role=button] / .el-btn / .el-button` 并按元素去重；
  点完还会等行数真的涨上去（BYD 行是异步渲染的），避免在渲染完成前连点出多余空行。
- **起止时间合体控件**（`el-date-editor--daterange`）：两个 `input.el-range-input` 共用一个
  「起止时间」label，逐 input 匹配只会各写一份同样的值，而且派发 `change` 会触发 Element 的
  `handleStartChange/handleEndChange`，未提交时读 `this.value` 直接抛错。
  现在按「区块标题 → 第几段」取 `eduList[i] / workList[i] / projectList[i] / campusList[i]` 的
  `start/end`（缺失回落 `eduStart/eduEnd`、`startDate/workEnd`…），走组件自己的 `pick` 事件提交，
  并把这两个 input 从通用循环里排除。

### 1.5.6

- **排名类字段按「一个字段 + 多形态」处理**：档案里只存人写的原文（`15/120`、`前20%`、`3.0/4.5`、`第8名`），
  填充时按目标控件形态派生候选：原文 → `x/y` → `第x名` → 区间（`前20%` / `10%-20%`）→ 百分比。
  下拉是区间时自动换算（`15/120` → 12.5% → 前20%），文本/数字框优先写原文。
- **成绩排名 / 绩点排名分开**：`成绩排名 → majorRank`、`绩点排名 → gpaRank`（新增键），`GPA → gpa`；
  教育块上下文里「绩点排名」不再被泛「绩点」抢成 GPA。
- **工作性质（工作经历里）**：新增 `workNature`（全职/实习/兼职），选项页工作段可显式选；
  留空时按该段职位/公司名推断（含「实习」→ 实习），再回退求职意向的 `jobType`。
- **「至今」不再写进日期框**：`workEnd: "至今"` 时优先找附近的「至今/在职/目前」勾选框并勾上；
  没有开关且该框是普通文本框才写「至今」，是日期控件则跳过并记 `current_job_no_toggle`。
- **工作描述/项目描述回落到列表首条**：`workDescription` 扁平字段为空时用 `workList[0].description`，
  很多站点只有一个不分行的「工作描述」textarea。
- 「工作/实习经历」混合标题按工作段处理（之前被判成实习段，公司/职位/起止时间取不到值）。
- **北森 Phoenix 补齐**（`derucci1.zhiye.com/form` 实测 22 个字段一次填好）：下拉 / 年月日 / 年月面板 /
  字典（民族）/ 地区（籍贯）/ div radio 全覆盖。细节见 `docs/beisen-phoenix.md`。
  - 勾选热区是行内 `<svg>`：`svg.click()` 不存在，`simulateClick` 改为派发 `mousedown/mouseup/click`
    三个 `MouseEvent`（之前字典、地区一直填不上）。
  - 弹层判定改成「点击前后可见集合的差集」：弹层常驻 DOM、关闭后仍有尺寸，取 `lastVisible` 会把值写进
    上一个字段（实测「开始时间」的 2023-09 写进了「预计报到时间」）。
  - 教育经历的起止时间用**年月面板**（无输入框）：翻年 + 点月份；搜索类弹层在搜索后等 450ms 再取行，
    并在点击后校验 `已选 x/y` 文案，没选中就重取行再点一次。
  - 多段计数改为「键 + 标签」分桶：基础信息「毕业时间」和教育经历「结束时间」都映射 `eduEnd`，
    原来第二次命中被当成第 2 段而取空值。
- **映射补两条**：「预计报到时间 / 报到时间」→ `expectedStartDate`；「紧急联系电话 / 紧急联络电话 /
  应急联系电话」→ `emergencyContactPhone`（否则被泛化的 `phone` 抢走，填成申请人手机号）。
- **标签容器识别**：`form-item` 用精确 class token + `closest('.form-item')` 优先，避免
  `.form-item__title` 被当容器导致取不到标签。

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
