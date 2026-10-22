/**
 * 网申平台字段基准集 + 匹配率打分（离线，不依赖浏览器）
 *
 * 运行：node tests/match-benchmark.mjs
 * 输出：整体 / 分平台 的 命中 / 错配 / 漏配，以及错漏明细（前 40 条）
 *
 * 语料来源标注（每条 entry 的 src 字段）：
 *   obs —— 真实页面观察到的标签或 id（小红书投递页、北森 Phoenix、Moka 的缺陷记录）
 *   gen —— 该平台常见命名（公开产品界面 / ATS 惯例 / Workday 官方英文标签）
 * 维护约定：expect 必须是 shared/match.js 里 FIELD_KEYWORDS 的键，或 "-"（应当不匹配 / 不填）。
 */

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const Match = require(path.join(root, "shared/match.js"));

const e = (p, label, expect, extra = {}) => ({ p, label, expect, src: "gen", ...extra });
const o = (p, label, expect, extra = {}) => ({ p, label, expect, src: "obs", ...extra });

/** ─────────────── 语料 ─────────────── */
const CORPUS = [
  // 小红书校招投递页（obs：2026-10 实际页面）
  o("小红书", "投递志愿", "jobTarget"),
  o("小红书", "推荐码", "-"),
  o("小红书", "姓名", "name"),
  o("小红书", "证件号码（用于实名认证）", "idNumber"),
  o("小红书", "性别", "gender"),
  o("小红书", "出生年月", "birthday"),
  o("小红书", "手机号", "phone"),
  o("小红书", "邮箱", "email"),
  o("小红书", "起止时间", "eduStart", { ctx: "edu", ph: "入学时间" }),
  o("小红书", "起止时间", "eduEnd", { ctx: "edu", ph: "毕业时间" }),
  o("小红书", "学历", "eduDegree", { ctx: "edu" }),
  o("小红书", "学校", "school", { ctx: "edu", id: "form_item_resumeVo_resumeEducationInfo_0_schoolName" }),
  o("小红书", "学校所在城市", "schoolCity", { ctx: "edu", id: "form_item_resumeVo_resumeEducationInfo_0_city" }),
  o("小红书", "院系", "department", { ctx: "edu", id: "form_item_resumeVo_resumeEducationInfo_0_collegeName" }),
  o("小红书", "专业", "major", { ctx: "edu", id: "form_item_resumeVo_resumeEducationInfo_0_major" }),
  o("小红书", "成绩排名", "majorRank", { ctx: "edu", id: "form_item_resumeVo_resumeEducationInfo_0_scoreRank" }),
  o("小红书", "导师", "advisorName", { ctx: "edu" }),
  o("小红书", "实验室", "labName", { ctx: "edu" }),
  o("小红书", "研究方向", "researchDirection", { ctx: "edu" }),
  o("小红书", "公司", "company", { ctx: "work", id: "form_item_resumeVo_resumeWorkInfo_0_companyName" }),
  o("小红书", "部门", "workDepartment", { ctx: "work", id: "form_item_resumeVo_resumeWorkInfo_0_department" }),
  o("小红书", "职位", "title", { ctx: "work", id: "form_item_resumeVo_resumeWorkInfo_0_positionName" }),
  o("小红书", "工作性质", "workNature", { ctx: "work" }),
  o("小红书", "工作描述", "workDescription", { ctx: "work", id: "form_item_resumeVo_resumeWorkInfo_0_description" }),
  o("小红书", "竞赛/奖项名称", "awardName"),
  o("小红书", "获奖名次", "awardRank"),
  o("小红书", "获奖时间", "awardDate"),
  o("小红书", "Github 链接", "github"),
  o("小红书", "是否服从调剂", "acceptAdjustment"),
  o("小红书", "自我介绍视频", "-"),
  o("小红书", "上传附件", "-"),

  // 北森（obs：resumeXxxInfo_N_* 行级 id + 常见标签）
  o("北森", "学校名称", "school", { ctx: "edu", id: "resumeEducationInfo_0_schoolName" }),
  o("北森", "院系", "department", { ctx: "edu", id: "resumeEducationInfo_0_collegeName" }),
  o("北森", "专业名称", "major", { ctx: "edu", id: "resumeEducationInfo_0_major" }),
  o("北森", "学历", "eduDegree", { ctx: "edu", name: "degree" }),
  o("北森", "学位", "degree", { ctx: "edu" }),
  o("北森", "入学时间", "eduStart", { ctx: "edu" }),
  o("北森", "毕业时间", "eduEnd", { ctx: "edu" }),
  o("北森", "学校所在城市", "schoolCity", { ctx: "edu" }),
  o("北森", "成绩排名", "majorRank", { ctx: "edu" }),
  o("北森", "绩点排名", "gpaRank", { ctx: "edu" }),
  o("北森", "GPA", "gpa", { ctx: "edu" }),
  o("北森", "导师姓名", "advisorName", { ctx: "edu" }),
  o("北森", "实验室", "labName", { ctx: "edu" }),
  o("北森", "研究方向", "researchDirection", { ctx: "edu" }),
  o("北森", "公司名称", "company", { ctx: "work" }),
  o("北森", "所在部门", "workDepartment", { ctx: "work" }),
  o("北森", "职位名称", "title", { ctx: "work" }),
  o("北森", "工作性质", "workNature", { ctx: "work" }),
  o("北森", "工作描述", "workDescription", { ctx: "work" }),
  o("北森", "离职原因", "leaveReason", { ctx: "work" }),
  o("北森", "证明人姓名", "refereeName", { ctx: "work" }),
  o("北森", "证明人联系方式", "refereeContact", { ctx: "work" }),
  e("北森", "是否服从调剂", "acceptAdjustment"),
  e("北森", "是否有亲属在本公司任职", "hasRelativeAtCompany"),
  e("北森", "招聘渠道", "referralSource"),

  // Moka（obs：缺陷记录 + 常见命名）
  o("Moka", "姓名", "name"),
  o("Moka", "手机号", "phone"),
  o("Moka", "邮箱", "email"),
  o("Moka", "学校名称", "school", { ctx: "edu" }),
  o("Moka", "专业", "major", { ctx: "edu" }),
  o("Moka", "学历", "eduDegree", { ctx: "edu" }),
  o("Moka", "开始时间", "eduStart", { ctx: "edu", ph: "开始时间" }),
  o("Moka", "结束时间", "eduEnd", { ctx: "edu", ph: "结束时间" }),
  o("Moka", "公司名称", "company", { ctx: "work" }),
  o("Moka", "职位名称", "title", { ctx: "work" }),
  o("Moka", "工作内容", "workDescription", { ctx: "work" }),
  e("Moka", "项目名称", "projectName", { ctx: "project" }),
  e("Moka", "项目描述", "projectDesc", { ctx: "project" }),
  e("Moka", "附件简历", "-"),
  e("Moka", "招聘渠道", "referralSource"),

  // Workday（英文标签，gen）
  e("Workday", "Legal Name", "name"),
  e("Workday", "First Name", "firstName"),
  e("Workday", "Last Name", "lastName"),
  e("Workday", "Email Address", "email"),
  e("Workday", "Phone Number", "phone"),
  e("Workday", "Address Line 1", "address"),
  e("Workday", "City", "city"),
  e("Workday", "State", "province"),
  e("Workday", "Postal Code", "zip"),
  e("Workday", "Country", "country"),
  e("Workday", "School or University", "school", { ctx: "edu" }),
  e("Workday", "Degree", "degree", { ctx: "edu" }),
  e("Workday", "Field of Study", "major", { ctx: "edu" }),
  e("Workday", "Start Date", "eduStart", { ctx: "edu" }),
  e("Workday", "End Date", "eduEnd", { ctx: "edu" }),
  e("Workday", "Job Title", "title", { ctx: "work" }),
  e("Workday", "Company", "company", { ctx: "work" }),
  e("Workday", "Role Description", "workDescription", { ctx: "work" }),
  e("Workday", "Resume/CV", "-"),
  e("Workday", "LinkedIn URL", "linkedin"),
  e("Workday", "How Did You Hear About Us?", "-"),
  e("Workday", "Are you legally authorized to work in this country?", "-"),

  // 飞书招聘（gen）
  e("飞书招聘", "姓名", "name"),
  e("飞书招聘", "手机号", "phone"),
  e("飞书招聘", "邮箱", "email"),
  e("飞书招聘", "最高学历", "eduDegree", { ctx: "edu" }),
  e("飞书招聘", "毕业院校", "school", { ctx: "edu" }),
  e("飞书招聘", "专业", "major", { ctx: "edu" }),
  e("飞书招聘", "毕业时间", "eduEnd", { ctx: "edu" }),
  e("飞书招聘", "公司名称", "company", { ctx: "work" }),
  e("飞书招聘", "职位名称", "title", { ctx: "work" }),
  e("飞书招聘", "开始时间", "startDate", { ctx: "work" }),
  e("飞书招聘", "结束时间", "workEnd", { ctx: "work" }),
  e("飞书招聘", "工作内容", "workDescription", { ctx: "work" }),
  e("飞书招聘", "附件简历", "-"),
  e("飞书招聘", "招聘渠道", "referralSource"),

  // 牛客（校招，gen）
  e("牛客", "姓名", "name"),
  e("牛客", "学校", "school", { ctx: "edu" }),
  e("牛客", "专业", "major", { ctx: "edu" }),
  e("牛客", "学历", "eduDegree", { ctx: "edu" }),
  e("牛客", "毕业时间", "eduEnd", { ctx: "edu" }),
  e("牛客", "求职意向", "jobTarget"),
  e("牛客", "期望城市", "expectedCity"),
  e("牛客", "手机", "phone"),
  e("牛客", "邮箱", "email"),
  e("牛客", "项目经历", "projectDesc", { ctx: "project" }),
  e("牛客", "实习经历", "-", { ctx: "work" }),
  e("牛客", "获奖情况", "honors"),

  // 智联招聘（gen）
  e("智联", "姓名", "name"),
  e("智联", "性别", "gender"),
  e("智联", "出生日期", "birthday"),
  e("智联", "手机号码", "phone"),
  e("智联", "电子邮箱", "email"),
  e("智联", "现居住地", "currentCity"),
  e("智联", "户口所在地", "hukou"),
  e("智联", "期望职位", "jobTarget"),
  e("智联", "期望城市", "expectedCity"),
  e("智联", "期望薪资", "expectedSalary"),
  e("智联", "工作年限", "years"),
  e("智联", "最高学历", "eduDegree", { ctx: "edu" }),
  e("智联", "毕业院校", "school", { ctx: "edu" }),
  e("智联", "所学专业", "major", { ctx: "edu" }),
  e("智联", "到岗时间", "availability"),

  // 51job（gen）
  e("51job", "姓名", "name"),
  e("51job", "性别", "gender"),
  e("51job", "出生年月", "birthday"),
  e("51job", "手机", "phone"),
  e("51job", "邮箱", "email"),
  e("51job", "现居地", "currentCity"),
  e("51job", "求职意向", "jobTarget"),
  e("51job", "期望薪资", "expectedSalary"),
  e("51job", "到岗时间", "availability"),
  e("51job", "工作年限", "years"),
  e("51job", "学历", "eduDegree", { ctx: "edu" }),
  e("51job", "学校", "school", { ctx: "edu" }),
  e("51job", "专业", "major", { ctx: "edu" }),
  e("51job", "自我评价", "summary"),

  // 猎聘 / BOSS（gen）
  e("猎聘", "姓名", "name"),
  e("猎聘", "手机", "phone"),
  e("猎聘", "邮箱", "email"),
  e("猎聘", "期望职位", "jobTarget"),
  e("猎聘", "期望城市", "expectedCity"),
  e("猎聘", "期望薪资", "expectedSalary"),
  e("猎聘", "当前公司", "company"),
  e("猎聘", "当前职位", "title"),
  e("猎聘", "工作年限", "years"),
  e("猎聘", "学历", "eduDegree", { ctx: "edu" }),
  e("猎聘", "学校", "school", { ctx: "edu" }),
  e("猎聘", "专业", "major", { ctx: "edu" }),
  e("猎聘", "个人优势", "personalStrengths"),

  // —— 补充：真实站点高频但容易错配的字段 ——
  o("北森", "证件号码", "idNumber"),
  o("北森", "出生日期", "birthday"),
  o("北森", "手机号码", "phone"),
  o("北森", "紧急联系人", "emergencyContact"),  // 已知：单框会拿到「姓名+电话」组合值，待 autofill 层拆分
  o("北森", "紧急联系人电话", "emergencyContactPhone"),
  o("北森", "是否应届生", "isFreshGraduate"),
  o("北森", "期望城市", "expectedCity"),
  o("北森", "意向岗位", "jobTarget"),
  o("北森", "期望薪资", "expectedSalary"),
  o("北森", "证明人", "refereeName", { ctx: "work" }),
  o("北森", "证明人职位", "refereeTitle", { ctx: "work" }),
  o("Moka", "当前薪资", "currentSalary"),
  o("Moka", "期望薪资", "expectedSalary"),
  o("Moka", "到岗时间", "availability"),
  o("Moka", "招聘渠道", "referralSource"),
  o("飞书招聘", "出生年月", "birthday"),
  o("飞书招聘", "证件号码", "idNumber"),
  o("飞书招聘", "现居住城市", "currentCity"),
  o("飞书招聘", "工作性质", "workNature", { ctx: "work" }),
  o("飞书招聘", "离职原因", "leaveReason", { ctx: "work" }),
  o("智联", "婚姻状况", "maritalStatus"),
  o("智联", "政治面貌", "politicalStatus"),
  o("智联", "民族", "ethnicity"),
  o("智联", "身高", "height"),
  o("智联", "体重", "weight"),
  o("智联", "档案所在地", "archiveLocation"),
  o("通用", "是否统招", "isTongzhao", { ctx: "edu" }),
  o("通用", "学制", "eduYears", { ctx: "edu" }),
  o("通用", "学习形式", "studyMode", { ctx: "edu" }),
  o("通用", "主修课程", "majorCourses", { ctx: "edu" }),
  o("通用", "挂科数", "failedCourses", { ctx: "edu" }),
  o("通用", "是否保研", "isRecommendedPostgrad"),
  o("通用", "高考分数", "gaokaoScore"),
  o("通用", "英语等级", "englishLevel"),
  o("通用", "证书名称", "certName"),
  o("通用", "专利名称", "patentName"),
  o("通用", "论文标题", "paperTitle"),
  o("通用", "培训名称", "trainingName"),
  e("Workday", "Preferred Name", "preferredName"),
  e("Workday", "Country/Region Phone Code", "phoneCountryCode"),
  e("Workday", "Previous Worker", "-"),
  e("Workday", "Suffix", "-"),

  // 大厂自建 / 通用（gen）
  e("通用", "姓名", "name"),
  e("通用", "手机号码", "phone"),
  e("通用", "电子邮箱", "email"),
  e("通用", "身份证号码", "idNumber"),
  e("通用", "出生日期", "birthday"),
  e("通用", "籍贯", "nativePlace"),
  e("通用", "现居住地址", "currentAddress"),
  e("通用", "紧急联系人姓名", "emergencyContactName"),
  e("通用", "紧急联系人电话", "emergencyContactPhone"),
  e("通用", "最高学历", "eduDegree", { ctx: "edu" }),
  e("通用", "毕业院校", "school", { ctx: "edu" }),
  e("通用", "所学专业", "major", { ctx: "edu" }),
  e("通用", "入学时间", "eduStart", { ctx: "edu" }),
  e("通用", "毕业时间", "eduEnd", { ctx: "edu" }),
  e("通用", "平均绩点", "gpa", { ctx: "edu" }),
  e("通用", "专业排名", "majorRank", { ctx: "edu" }),
  e("通用", "实习经历", "-", { ctx: "work" }),
  e("通用", "项目经历", "projectDesc", { ctx: "project" }),
  e("通用", "获奖情况", "honors"),
  e("通用", "技能特长", "skills"),
  e("通用", "自我评价", "summary"),
  e("通用", "是否服从调剂", "acceptAdjustment"),
  e("通用", "是否有亲属在本公司任职", "hasRelativeAtCompany"),
  e("通用", "招聘渠道", "referralSource"),
  e("通用", "验证码", "-"),

  // v1.5.23：一字之差 / 第三方实体 / 同义写法（gen：国内网申常见变体）
  e("语义兼容", "入职日期", "startDate"),
  e("语义兼容", "离职日期", "workEnd"),
  e("语义兼容", "入学年份", "eduStart"),
  e("语义兼容", "邮寄地址", "address"),
  e("语义兼容", "户口所在城市", "hukouCity"),
  e("语义兼容", "证书获得日期", "certDate"),
  e("语义兼容", "论文发表日期", "paperDate"),
  e("语义兼容", "英语六级分数", "englishScore"),
  e("语义兼容", "意向工作地点", "expectedCity"),
  e("语义兼容", "期望工作城市", "expectedCity"),
  e("语义兼容", "父亲姓名", "familyName"),
  e("语义兼容", "母亲工作单位", "familyEmployer"),
  e("语义兼容", "家庭成员电话", "familyPhone"),
  e("语义兼容", "紧急联系人与本人关系", "emergencyContactRelation"),
  e("语义兼容", "推荐人电话", "-"),
  e("语义兼容", "学位类型", "degreeType"),
  e("语义兼容", "单位全称", "company"),

  // v1.6.0：字段细分（省 / 市 / 区拆分、拼音姓名、第二志愿、名次）（gen：北森 / Moka / 智联网申常见拆分写法）
  e("字段细分", "拼音姓", "pinyinLastName"),
  e("字段细分", "姓（拼音）", "pinyinLastName"),
  e("字段细分", "拼音名", "pinyinFirstName"),
  e("字段细分", "名（拼音）", "pinyinFirstName"),
  e("字段细分", "姓名拼音", "namePinyin"),
  e("字段细分", "籍贯省份", "nativeProvince"),
  e("字段细分", "籍贯（省）", "nativeProvince"),
  e("字段细分", "籍贯城市", "nativeCity"),
  e("字段细分", "籍贯", "nativePlace"),
  e("字段细分", "户口所在省份", "hukouProvince"),
  e("字段细分", "户籍城市", "hukouCity"),
  e("字段细分", "户口所在地", "hukou"),
  e("字段细分", "现居住省份", "currentProvince"),
  e("字段细分", "现居住城市", "currentCity"),
  e("字段细分", "现居住区县", "currentDistrict"),
  e("字段细分", "第二志愿", "jobTarget2"),
  e("字段细分", "第一志愿", "jobTarget"),
  e("字段细分", "第二意向城市", "expectedCity2"),
  e("字段细分", "获奖名次", "awardRank"),
  e("字段细分", "学位", "degree", { ctx: "edu" }),
];

const M2 = Match;

function hintsOf(entry) {
  return [entry.label, entry.ph, entry.name, entry.id, entry.auto].filter(Boolean).join(" ");
}

function score() {
  const rows = [];
  for (const entry of CORPUS) {
    const hints = hintsOf(entry);
    const opts = { context: entry.ctx || "", autocomplete: entry.auto || "" };
    const r = M2.matchFieldKeyScored(hints, opts);
    const got = r ? r.key : null;
    const ok = entry.expect === "-" ? !got : got === entry.expect;
    rows.push({ ...entry, got, ok, method: r ? r.method : null, conf: r ? r.confidence : 0 });
  }
  return rows;
}

const known = new Set(Object.keys(Match.FIELD_KEYWORDS || {}));
const badExpect = CORPUS.filter((c) => c.expect !== "-" && !known.has(c.expect));
if (badExpect.length) {
  console.error("语料里有不存在的 expect 键：");
  badExpect.slice(0, 10).forEach((c) => console.error("  -", c.p, c.label, "->", c.expect));
  process.exit(2);
}

const rows = score();
const total = rows.length;
const hits = rows.filter((r) => r.ok).length;
const wrong = rows.filter((r) => !r.ok && r.got).length;
const miss = rows.filter((r) => !r.ok && !r.got).length;

const byPlatform = {};
for (const r of rows) {
  const b = (byPlatform[r.p] = byPlatform[r.p] || { n: 0, hit: 0, wrong: 0, miss: 0 });
  b.n += 1;
  if (r.ok) b.hit += 1;
  else if (r.got) b.wrong += 1;
  else b.miss += 1;
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "-");

// --check：给 CI / pre-commit 用的门槛（低于阈值直接非零退出）
if (process.argv.includes("--check")) {
  const rate = hits / total;
  const floor = 0.98;
  if (rate < floor) {
    console.error("匹配率 " + (rate * 100).toFixed(1) + "% 低于门槛 " + floor * 100 + "%（" + hits + "/" + total + "）");
    process.exit(1);
  }
  console.log("match-benchmark OK: " + (rate * 100).toFixed(1) + "%（" + hits + "/" + total + "，错配 " + wrong + "，漏配 " + miss + "）");
  process.exit(0);
}

// ── 可选：把语料丢进真实档案，区分「能填 / 匹配到但没值 / 未匹配」──
const pfIdx = process.argv.indexOf("--profile");
if (pfIdx !== -1) {
  const fsx = await import("node:fs");
  const raw = JSON.parse(fsx.readFileSync(process.argv[pfIdx + 1], "utf8"));
  const profile = raw.profile || raw;
  const rowsP = rows.map((r) => {
    const val = r.expect === "-" ? "" : String(Match.profileValue(profile, r.expect) || "").trim();
    const fillable = r.ok && r.expect !== "-" && !!val;
    return { ...r, val, fillable };
  });
  const withVal = rowsP.filter((r) => r.fillable).length;
  const noVal = rowsP.filter((r) => r.ok && r.expect !== "-" && !r.val);
  const un = rowsP.filter((r) => !r.ok);
  const percent = ((withVal / total) * 100).toFixed(1);
  console.log("");
  console.log("== 对接你的档案 ==");
  console.log("可填 " + withVal + " / " + total + "（" + percent + "%）；匹配到但档案没值 " + noVal.length + "；未匹配 " + un.length);
  const byKey = {};
  for (const r of noVal) {
    byKey[r.expect] = byKey[r.expect] || { n: 0, labels: [] };
    byKey[r.expect].n += 1;
    if (byKey[r.expect].labels.length < 2) byKey[r.expect].labels.push(r.label);
  }
  const ranked = Object.entries(byKey).sort((a, b) => b[1].n - a[1].n);
  console.log("");
  console.log("-- 档案缺值（匹配上了但没法填），按影响字段数排序 --");
  ranked.forEach(([k, v]) => console.log("  " + k.padEnd(22) + v.n + " 处  ← " + v.labels.join("、")));
  if (un.length) {
    console.log("");
    console.log("-- 未匹配字段 --");
    un.forEach((r) => console.log("  [" + r.p + "] " + r.label + " → " + (r.got || "∅")));
  }
  process.exit(0);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ total, hits, wrong, miss, byPlatform, rows }, null, 2));
} else {
  console.log("== 网申字段匹配基准（%d 条 / %d 个平台）==", total, Object.keys(byPlatform).length);
  console.log("命中 %s（%d）  错配 %d  漏配 %d", pct(hits, total), hits, wrong, miss);
  console.log("");
  console.log("平台            条数   命中率   错配  漏配");
  for (const [p, b] of Object.entries(byPlatform)) {
    console.log(
      p.padEnd(14, " "),
      String(b.n).padStart(4),
      pct(b.hit, b.n).padStart(8),
      String(b.wrong).padStart(6),
      String(b.miss).padStart(5)
    );
  }
  const bad = rows.filter((r) => !r.ok);
  if (bad.length) {
    console.log("\n-- 未命中明细（%d 条）--", bad.length);
    for (const r of bad.slice(0, 40)) {
      console.log(
        `[${r.p}] ${r.label}${r.ctx ? " @" + r.ctx : ""}  期望=${r.expect}  实际=${r.got || "∅"}  (${r.src})`
      );
    }
    if (bad.length > 40) console.log("… 其余 %d 条省略（--json 看全量）", bad.length - 40);
  }
}
