# 北森 Phoenix 网申适配（zhiye.com）

目标页：`https://<company>.zhiye.com/form?fromPage=job&jobAdId=...&userId=...`
（示例：`derucci1.zhiye.com/form`，即北森 iTalent「Phoenix」渲染的表单）

这一版把该页面的**前端组件结构**逆向出来，并在 `content/autofill.js` 里做了专用适配层，
其余 ATS 的通用匹配逻辑不受影响。

## 1. 页面骨架

```
.form-root
└── .ux-standard-form
    └── form#GUID_Recruitment_*
        ├── .form-item.form-item--phoenix        ← 一个字段
        │   ├── .form-item__text / .form-item__title > label   ← 标签（「姓名」「民族」…）
        │   └── .phoenix-select                   ← 控件宿主（select / 日期 / 字典 / 地区 都是它）
        │       ├── input.phoenix-select__input   ← 只读输入框，值为展示文案
        │       └── .phoenix-select__tipEle       ← 少数控件的占位文案
        └── .phoenix-radio-group                  ← 纯 div 的 radio 组
```

关键结论：

- **没有 `name` / `id`**。整页字段都是无 id 的 `div`，只能靠 `.form-item__text` 的文案定位，
  所以 `shared/match.js` 里补了 `form-item` 的精确 token 选择器（`classHasToken`，避免把
  `.form-item__title` 误当容器）。
- 每个控件都是**受控组件**：值写在内部 `input.value` 上，页面靠 React state 驱动。
  直接 `input.value = x` 不会更新 React state，必须走「点开宿主 → 在弹层里选」的路径。
- 所有弹层都 portal 到 `body` 下的 `.common-unmodeled-layer`（`z-index:1200; left/top` 指向宿主），
  **每个字段一个常驻弹层实例**，关闭后节点仍在 DOM 里（`getBoundingClientRect()` 仍有尺寸）。
  这就是「上一个字段的面板」会污染下一个字段的直接原因。

## 2. 五类控件的交互协议（实测）

| 类型 | 弹层选择器 | 交互方式 |
| --- | --- | --- |
| 普通下拉 | `.phoenix-selectList` | 在 `.phoenix-input__input` 里搜关键词（虚拟列表只渲染前几行）→ 点 `.phoenix-selectList__singleLabel` |
| 日期（年月日） | `.phoenix-date-picker` + `.phoenix-calendar-input` | 直接给日历输入框写 `YYYY-MM-DD` → 派发 Enter |
| 日期（年月） | `.phoenix-date-picker` + `.phoenix-calendar-month-calendar` | **没有输入框**：点 `.phoenix-calendar-month-panel-{prev,next}-year-btn` 翻年 → 点 `.phoenix-calendar-month-panel-month` |
| 字典（民族等） | `.constant-main-selector-container` | 搜索 → 点**行内 `<svg>` 图标** → 点「确定」 |
| 地区（籍贯） | `.area-selector-container` | 同上，行选择器是 `.area-item-container` |

### 2.1 必须派发合成 `click` 事件，不能用 `el.click()`

`el.click()` 只存在于 `HTMLElement`；字典/地区的勾选热区是 **`<svg>`**，
`svg.click()` 不存在，`simulateClick()` 里的 `try { el.click() }` 会静默失败。
现在统一改成派发 `mousedown → mouseup → click` 三个 `MouseEvent`。

### 2.2 弹层要按「本次新出现」判定，不能取 `lastVisible`

弹层常驻 DOM 且关闭后尺寸不变，`lastVisible('.phoenix-date-picker')` 会拿到**上一个字段**的面板，
把值写进别人的输入框（实测：教育经历「开始时间」的 2023-09 被写进了「预计报到时间」）。
`phoenixOpenPanel(host)` 的做法是先记下「点击前可见的面板集合」，点击后取差集。

### 2.3 搜索后必须等重渲染

字典/地区的搜索结果列表会整体替换；搜索词刚写进去 250ms 内拿到的仍是旧行，
点上去没有任何反应（`已选 0/1`）。现在固定等 450ms，并在点击后轮询
`.right-container` 的 `已选 x/y` 文案确认勾选生效，没生效就重新取行再点一次。

### 2.4 宿主 `--active` 是开合状态

`phoenix-select--active` 在弹层打开时出现在宿主上；重复点击会 toggle 关闭。
`fillPhoenixHost()` 先检查这个类，避免「点开 → 再点一下 → 关掉」的反向操作。

## 3. 字段映射补充（`shared/match.js`）

- 「预计报到时间 / 报到时间」→ `expectedStartDate`
- 「紧急联系电话 / 紧急联络电话 / 应急联系电话」→ `emergencyContactPhone`
  （否则会被泛化的 `phone` 抢走，填成申请人手机号）
- `form-item` 容器识别：`classHasToken(cn,'form-item')`，`closest('.form-item')` 优先于
  模糊的 `[class*="form-item"]`（后者会把 `.form-item__title` 当容器，标签取到空串）

## 4. 多段取值：计数按「键 + 标签」分桶

同一页里「毕业时间」（基本信息）和「结束时间」（教育经历）都会命中 `eduEnd`。
原来 `keyCounts` 只按 key 计数，第 2 次命中会被当成「第 2 段教育」→ 取空值 → 结束时间填不上。
现在计数键是 `key + '|' + 标签`：

- 同名列（多段教育的两个「结束时间」）仍按顺序取 `eduList[0] / eduList[1]`
- 不同名但同键的字段（毕业时间 / 结束时间）各从第 0 段开始

## 5. 代码地图（`content/autofill.js`）

| 函数 | 作用 |
| --- | --- |
| `isPhoenixHost` / `PHOENIX_*_SEL` | 识别 Phoenix 宿主与四类弹层 |
| `phoenixOpenPanel(host)` | 点开宿主，返回本次新出现的弹层（差集判定） |
| `fillPhoenixHost(host, value, key)` | 按弹层类型分发；已打开先关、失败关弹层 |
| `fillPhoenixList` | 普通下拉：搜索 → 点选项（带 `interviewCity` 保守校验） |
| `fillPhoenixDate` / `fillPhoenixMonth` | 年月日输入框 / 年月面板 |
| `fillPhoenixPanel` | 字典 / 地区：搜索 → 点 svg → 确认 → 校验 `已选 x/y` |
| `fillPhoenixRadioGroups` | div radio 组（性别 / 是否应届 / 海外经历） |
| `closePhoenixPanels` | 点回 `--active` 宿主关闭弹层 |
| `occurrenceKey` | 多段取值计数键（key + 标签） |

## 6. 实测结果（derucci1.zhiye.com 校招表单，示例档案）

22 个字段一次填好：姓名、性别、出生日期、邮箱、最高学位、毕业时间、海外留学经历、应届/往届、
政治面貌、民族、籍贯、身高、国籍、紧急联系人/电话、预计报到时间、学校名称、开始时间、结束时间、
专业名称、学历、学习形式。

刻意不动的地方：

- **面试站点**：选项是「广州美术学院（线下站）」这类宣讲站点，档案里没有对应数据。
  只做保守匹配（选项长度不得超过值 +3 字），失败就跳过而不是猜一个学校。
- **简历附件**：`input[type=file]` 一律不点、不写。
- **保存 / 提交**：不做，留给你自己核对后点。

## 7. 复测方式

1. 打开目标表单页（需登录）。
2. 选项页保存一份档案，弹出扩展点「一键填写」。
3. 观察：`民族/籍贯` 弹层是否自行关闭、教育经历两个日期是否都填上、`预计报到时间` 是否为本人的预计报到月份。
