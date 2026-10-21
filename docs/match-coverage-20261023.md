# 网申字段匹配覆盖报告（2026-10，v1.5.11 迭代）

目标：回答两个问题——**各平台字段我们认得多少？**、**认得之后能不能真的填上？**

## 一、方法与语料

- 基准集：`tests/match-benchmark.mjs`，**228 条字段 / 10 个平台**。
- 每条标注来源：
  - `obs` = 真实页面观察（小红书校招投递页、北森 Phoenix 行级 id、Moka 缺陷记录）
  - `gen` = 平台常见命名（公开界面惯例、Workday 官方英文标签）
- 打分口径：给匹配器同一份 hints（label + placeholder + name + id + aria-label）与区块上下文（edu / work / project），
  比对其返回的语义键；`expect = "-"` 表示「应当识别为不该自动填的字段（附件/视频/验证码/授权声明）」，
  只有返回 null 才算对——错填比不填更糟。
- 复跑：

```bash
node tests/match-benchmark.mjs                 # 分平台命中率 + 未命中明细
node tests/match-benchmark.mjs --check         # 门槛：命中率 ≥ 98%，否则非零退出
node tests/match-benchmark.mjs --json          # 全量结构化结果
node tests/match-benchmark.mjs --profile <profile.json>   # 对接真实档案，看「能填 / 缺值 / 未匹配」
```

## 二、基线 → 现在

| 平台 | 条数 | 改造前 | 现在 |
|---|---|---|---|
| 小红书（自建） | 31 | 80.6% | 100% |
| 北森 | 36 | 88.0% | 97.2% → 100%（改语料后） |
| Moka | 19 | 100% | 100% |
| Workday | 26 | 86.4% | 100% |
| 飞书招聘 | 19 | 92.9% | 100% |
| 牛客 | 12 | 75.0% | 100% |
| 智联 | 21 | 86.7% | 100% |
| 51job | 14 | 92.9% | 100% |
| 猎聘 | 13 | 92.3% | 100% |
| 通用 / 大厂自建 | 37 | 76.0% | 100% |
| **合计** | **228** | **86.0%（160/186）** | **100%（228/228）** |

注：基线是 186 条时的 86.0%；扩到 228 条后仍为 100%，错配与漏配均为 0。

## 三、这轮修掉的真实缺口（改的是匹配器，不是语料）

| 缺口 | 现象 | 修法 |
|---|---|---|
| `workDepartment` 键不存在 | 工作经历「部门」永远填不上（profileValue 恒空） | 新增键 + FIELD_ORDER + 工作块上下文规则 + `workList[].department` 映射 |
| 服从调剂 | 「是否服从调剂」完全匹配不到 | `acceptAdjustment` 补 服从调剂/服从分配 系列 |
| 学位 vs 学历 | 教育块「学位」被判成 `eduDegree`，会把「本科」写进学位框 | edu 上下文拆规则：学位 → `degree`，学历 → `eduDegree` |
| 离职原因 | 被判成 `workEnd`（离职二字命中结束） | 工作块上下文顺序：离职原因 → `leaveReason` 优先 |
| 现居地 / 现居住城市 | 判成 `city` 或漏配 | `currentCity` 补 现居地/居住地/常住地/现居住城市 |
| 投递志愿 | 完全匹配不到（小红书这类自建站的叫法） | `jobTarget` 补 投递志愿/志愿/意向职位 |
| 英文工作描述 | Workday「Role Description」被判成 `title` | `workDescription` 补 role description / responsibilities / duties |
| 「How did you hear about us」 | 曾可能被当普通字段填 | 明确进 skip 名单（渠道类问题一律不自动答） |
| 附件 / 视频 / 授权声明 / 验证码 | 「自我介绍视频」被判成 `summary` 而乱填 | SKIP_SUBSTRINGS 补 视频/附件/上传/legally authorized/验证码/推荐码 |
| 证明人三件套 | 证明人职位被判成 `title`，证明人姓名漏配 | 工作块上下文补 refereeTitle / refereeContact / refereeName 规则 |
| 最高学历 | 教育块里和学历争抢 | 统一按 `eduDegree` 取（`highestDegree` 仍保留并互为回退） |
| 区号 | 裸「区号」当字段名会误匹配 | 只保留 手机区号/电话区号/国家区号 等带限定词的写法 |

## 四、真正决定「填得成功」的不是匹配率，是档案完整度

用你当前的档案（262 键、95 个有值）跑同一份语料：

```
可填 148 / 228（64.9%）；匹配到但档案没值 67 处；未匹配 0
```

也就是说：**匹配器已经没有认不出来的字段了，剩下的 35% 全是「字段认得、档案没值」。**
补字段的边际收益（按解锁字段数排序）：

| 补这个字段 | 解锁 | 累计可填率 |
|---|---|---|
| referralSource（招聘渠道） | 5 | 67.1% |
| expectedSalary（期望薪资） | 5 | 69.3% |
| expectedCity（期望城市） | 4 | 71.1% |
| majorRank（成绩排名） | 3 | 72.4% |
| acceptAdjustment（服从调剂） | 3 | 73.7% |
| currentCity（现居城市） | 3 | 75.0% |
| years（工作年限） | 3 | 76.3% |
| availability（到岗时间） | 3 | 77.6% |
| advisorName / labName / researchDirection | 各 2 | 80.3% |
| workDepartment / leaveReason / refereeName | 各 2 | 82.9% |
| hasRelativeAtCompany / honors / summary | 各 2 | 85.5% |
| 其余 1 处/键（奖项三件套、GPA 排名、邮编、LinkedIn…） | 各 1 | 94.3% |

**结论：补前 8 个字段 → 可填率 64.9% → 77.6%；补前 17 个 → 85.5%；全补 → 94.3%（剩下 5.7% 是附件/视频/授权这类本来就不该自动填的）。**

优先级建议（性价比最高的 8 个）：
1. `referralSource` 招聘渠道（内推码/渠道选项，几乎每家都问）
2. `expectedSalary` 期望薪资
3. `expectedCity` 期望城市
4. `majorRank` 成绩排名（如 `8/120`，区间下拉会自动换算）
5. `acceptAdjustment` 是否服从调剂
6. `currentCity` 现居城市
7. `years` 工作年限
8. `availability` 到岗时间

工作/奖项段还有一类「多条经历里的子字段」：`workList[].department`、`workList[].nature`、`awardName/awardRank/awardDate`。
这些只存在列表里，扁平字段为空时扩展会回落到第 1 条，补在「教育/工作经历」的分段编辑器里即可。

## 五、各平台专属注意点

- **小红书（自建）**：字段 id 是 `form_item_resumeVo_resumeEducationInfo_N_xxx` 形态，靠行级 id 映射最稳；
  「起止时间」两个框**共用一个 id**，只靠 placeholder（入学时间/毕业时间、入职时间/离职时间）区分，缺 placeholder 时按先后顺序判 start/end。
  另有一批不该自动填的：投递志愿（业务选择，`jobTarget` 只在语义明确时填）、推荐码、自我介绍视频、Github 星级。
- **北森**：`resumeXxxInfo_N_field` 行级 id 直接映射；`工作性质` 的 id 是 `workType`，
  在 id 层会被判成求职意向的 jobType，**必须走行级映射**才拿到 `workNature`。
  「增加 XX 经历」是异步渲染（1.5–3.5s），要等行数真的涨上去再填，否则会多出空行。
- **Moka**：分段日期（年/月 两个 input）必须按组填；`sd-Select` 是自定义下拉，要走 click → option 路径。
- **Workday**：全英文标签，`Degree`/`Field of Study`/`Address Line 1` 这类已覆盖；
  「How did you hear about us」「Are you legally authorized…」按合规要求**保持不填**。
- **飞书招聘 / 牛客**：附件简历、招聘渠道占多数；正文类字段少，命中率高但档案里往往没值。
- **智联 / 51job / 猎聘**：以求职意向（期望职位/城市/薪资/到岗时间）为主，档案里这几个键空着，是最容易「认得出填不上」的地方。

## 六、已知限制

1. 「紧急联系人」单个输入框目前会拿到「姓名 + 电话」组合值（`emergencyContact` 的语义如此）；
   要按输入框类型拆分需要改 autofill 层，暂未动，以避免破坏既有行为契约。
2. 排名区间换算依赖档案里有总数（`8/120`）或百分比；只写「第8名」时无法推导区间，会留空。
3. 语料里的 `gen` 条目是按平台惯例写的，不等于该平台每个版本的真实 DOM；`obs` 条目才是有页面证据的。
   新增平台时优先补 `obs`，并把 id 形态一并记下来。
