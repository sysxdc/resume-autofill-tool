/**
 * v1.4.0：简历解析器（纯本地，无网络）
 *
 * 两段式：
 *  1) extractTextFromFile：PDF（pdf.js）/ DOCX（mammoth）/ TXT|MD（FileReader）→ 纯文本
 *  2) parseResumeText：标题分段 → 日期区间切记录 → 字段抽取 → profile（含 eduList/workList/projectList）
 *
 * 设计约束：不做 OCR（扫描件需要另配），不联网，解析结果进入「待确认」状态由用户保存。
 */
(function (root) {
  'use strict';

  var P = (typeof module === 'object' && module.exports)
    ? require('./profile.js')
    : root.ResumeAutofillProfile;

  var MAX_TEXT = 200000;

  // ————— 文本归一化 —————

  function normalizeText(raw) {
    var s = String(raw || '');
    s = s.replace(/\r\n?/g, '\n');
    // 全角数字/字母/冒号/括号 → 半角（只处理常见区段）
    s = s.replace(/[\uFF10-\uFF19]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    s = s.replace(/[\uFF21-\uFF3A\uFF41-\uFF5A]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    s = s.replace(/\uFF1A/g, ':').replace(/\uFF08/g, '(').replace(/\uFF09/g, ')');
    // 各种项目符号 → 空
    s = s.replace(/^[\s\u2022\u00B7\u25CF\u25AA\u25A0\u25C6\u25C7\u2013\u2014*\-\u30FB>·]+/gm, '');
    // 行内多空格压一
    s = s.replace(/[ \t\u00A0]+/g, ' ');
    // 连续空行压一
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim().slice(0, MAX_TEXT);
  }

  function compact(s) {
    return String(s || '').replace(/\s+/g, '');
  }

  var HEADINGS = [
    { key: 'basic', re: /^(个人信息|基本信息|个人资料|联系方式|基本资料|个人情况)$/ },
    { key: 'intent', re: /^(求职意向|求职目标|应聘意向|期望职位|职业意向)$/ },
    { key: 'education', re: /^(教育背景|教育经历|学习经历|学历背景|教育信息|教育情况|教育)$/ },
    { key: 'work', re: /^(工作经历|工作经验|职业经历|工作履历|任职经历|实习经历|实习经验|工作及实习经历|工作)$/ },
    { key: 'project', re: /^(项目经历|项目经验|主要项目|项目实践|项目)$/ },
    { key: 'campus', re: /^(校园经历|社团经历|学生工作|社会实践|校园实践)$/ },
    { key: 'skills', re: /^(专业技能|技能特长|技能专长|技能|技术栈|个人技能|专业能力)$/ },
    { key: 'awards', re: /^(荣誉奖项|获奖经历|获奖情况|所获奖励|荣誉|奖项|证书|资格证书)$/ },
    { key: 'summary', re: /^(自我评价|个人评价|自我介绍|个人简介|自我描述|个人总结|总结)$/ }
  ];

  /** 去掉标题前后的装饰：一、 【】 1. ◆ 等 */
  function stripHeadingDecor(line) {
    var s = String(line || '').trim();
    s = s.replace(/^[【\[（(「《]/, '').replace(/[】\]）)」》]$/, '');
    s = s.replace(/^[\s\d]+[、.．)）]\s*/, '');
    s = s.replace(/^[一二三四五六七八九十]+[、.]?\s*/, '');
    s = s.replace(/[:：]\s*$/, '');
    return s.trim();
  }

  function headingKey(line) {
    var t = compact(stripHeadingDecor(line));
    if (!t || t.length > 12) return null;
    for (var i = 0; i < HEADINGS.length; i++) {
      if (HEADINGS[i].re.test(t)) return HEADINGS[i].key;
    }
    return null;
  }

  /** 切段：返回 {basic:[], education:[], ...} —— 未命中的行进 preamble */
  function splitSections(text) {
    var lines = String(text || '').split('\n');
    var out = { preamble: [] };
    var cur = 'preamble';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var key = headingKey(line);
      if (key) {
        cur = key;
        if (!out[cur]) out[cur] = [];
        continue;
      }
      if (!out[cur]) out[cur] = [];
      out[cur].push(line);
    }
    return out;
  }

  // ————— 基础字段 —————

  var RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  var RE_PHONE = /(?:^|[^\d])(1[3-9]\d{9})(?!\d)/;
  var RE_PHONE_INTL = /(?:^|[^\d])((?:\+?86[-\s]?)?1[3-9]\d{9}(?:[-\s]?\d{4})?)(?!\d)/;

  function matchText(text, re) {
    var m = String(text || '').match(re);
    return m ? (m[1] || m[0]) : '';
  }

  /** 日期区间：2019.09-2023.06 / 2019年9月—至今 / 2019/09 - 2023/06 */
  var RE_RANGE = new RegExp(
    '(\\d{4})\\s*[./年\\-]\\s*(\\d{1,2})?\\s*[月.]?' +
    '\\s*(?:[-–—~～至到]|to)\\s*' +
    '(?:(\\d{4})\\s*[./年\\-]\\s*(\\d{1,2})?\\s*[月.]?|(至今|现在|今|present|now))', 'i'
  );

  function two(n) {
    var v = String(parseInt(n, 10));
    return v.length === 1 ? '0' + v : v;
  }

  function toYm(year, month) {
    if (!year) return '';
    var y = String(year);
    if (!month) return y;
    var m = parseInt(month, 10);
    if (!(m >= 1 && m <= 12)) return y;
    return y + '-' + two(m);
  }

  function parseRange(line) {
    var m = String(line || '').match(RE_RANGE);
    if (!m) return null;
    var start = toYm(m[1], m[2]);
    var end = m[5] ? '至今' : toYm(m[3], m[4]);
    if (!start) return null;
    return { start: start, end: end || '', raw: m[0] };
  }

  /** 抽取「标签: 值」形式（支持全角冒号与顿号分隔的多标签行） */
  function labeled(text, labels) {
    var src = String(text || '');
    for (var i = 0; i < labels.length; i++) {
      var lb = labels[i];
      // 允许“现居 杭州”这种无冒号写法；值遇到下一个“标签:”或分隔符就停
      var re = new RegExp(
        '(?:^|[\\s|,，;；/])' + lb + '\\s*[:：]?\\s*' +
        '([^|,，;；\\n]{1,40}?)' +
        '(?=\\s+[\\u4e00-\\u9fa5A-Za-z]{2,10}\\s*[:：]|\\s*[|,，;；]|\\s{2,}|$)'
      );
      var m = src.match(re);
      if (m && m[1] && m[1].trim()) return m[1].trim();
    }
    return '';
  }

  /** 取标签后的第一个“短值”（城市/薪资/性别这类不应该包含空格后续描述） */
  function labeledToken(text, labels) {
    var v = labeled(text, labels);
    return String(v || '').split(/[\s|,，;；/]/).filter(Boolean)[0] || '';
  }

  function detectName(text, sections) {
    var m = String(text || '').match(/姓\s*名\s*[:：]\s*([\u4e00-\u9fa5]{2,6}|[A-Za-z][A-Za-z .'-]{1,30})/);
    if (m) return m[1].trim();
    // 首屏第一行：2~4 个汉字且不含数字/邮箱
    var pool = (sections.preamble || []).concat(sections.basic || []);
    for (var i = 0; i < Math.min(pool.length, 6); i++) {
      var t = String(pool[i] || '').trim();
      if (!t || t.length > 20) continue;
      if (/@|\d/.test(t)) continue;
      if (/^(个人简历|简历|RESUME|Curriculum Vitae)$/i.test(t)) continue;
      var cjk = t.match(/^[\u4e00-\u9fa5·]{2,4}$/);
      if (cjk) return t;
    }
    return '';
  }

  function detectGender(text) {
    var v = labeled(text, ['性别']);
    if (/男/.test(v)) return '男';
    if (/女/.test(v)) return '女';
    var m = String(text || '').match(/(?:^|[\s|,，;；])(男|女)(?:[\s|,，;；]|$)/);
    return m ? m[1] : '';
  }

  function detectBirthday(text) {
    var v = labeled(text, ['出生日期', '出生年月', '生日']);
    var m = String(v || '').match(/(\d{4})\s*[./年-]\s*(\d{1,2})(?:\s*[./月-]\s*(\d{1,2}))?/);
    if (m) {
      var ym = toYm(m[1], m[2]);
      return m[3] ? ym + '-' + two(m[3]) : ym;
    }
    // 无“出生日期”标签时，从首屏找第一个完整日期（限定前 300 字符，避免误取毕业时间）
    var head = String(text || '').slice(0, 300);
    var m2 = head.match(/(\d{4})\s*[./年-]\s*(\d{1,2})\s*[./月-]\s*(\d{1,2})/);
    if (m2) return toYm(m2[1], m2[2]) + '-' + two(m2[3]);
    return '';
  }

  function detectCity(text) {
    var v = labeled(text, ['现居地', '现居住地', '所在城市', '现居', '城市', '所在地']);
    if (v) return v.replace(/[（(].*?[)）]/g, '').trim();
    return '';
  }

  function detectLinks(text) {
    var out = { github: '', linkedin: '', website: '' };
    var gh = String(text || '').match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_.-]+/i);
    if (gh) out.github = /^https?:/i.test(gh[0]) ? gh[0] : 'https://' + gh[0];
    var li = String(text || '').match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_.-]+/i);
    if (li) out.linkedin = /^https?:/i.test(li[0]) ? li[0] : 'https://' + li[0];
    var site = String(text || '').match(/个人网站\s*[:：]\s*(\S+)/);
    if (site) out.website = site[1];
    return out;
  }

  // ————— 教育 —————

  var DEGREE_ENUM = [
    ['博士', /博士|ph\.?d|doctor/i],
    ['硕士', /硕士|研究生|master|m\.s\./i],
    ['本科', /本科|学士|bachelor|b\.s\./i],
    ['大专', /大专|专科|高职/],
    ['高中', /高中|中专|职高/]
  ];

  function detectDegree(text) {
    for (var i = 0; i < DEGREE_ENUM.length; i++) {
      if (DEGREE_ENUM[i][1].test(text)) return DEGREE_ENUM[i][0];
    }
    return '';
  }

  var SCHOOL_RE = /([\u4e00-\u9fa5]{2,20}(?:大学|学院|学校|中学|职业技术学院))|((?:University|College|Institute|School)(?:\s+of\s+[A-Za-z]+)?)/i;

  function detectSchool(text) {
    var m = String(text || '').match(SCHOOL_RE);
    return m ? (m[1] || m[2] || '').trim() : '';
  }

  /** 把一段文字按日期区间切成多条记录；没有日期时整段算一条 */
  function splitRecords(lines) {
    var records = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i] || '').trim();
      if (!line) continue;
      var range = parseRange(line);
      // 常见排版：学校/公司在前，日期另起一行 → 挂到当前这条，而不是新起记录
      if (range && cur && !cur.range && cur.lines.length <= 3 &&
          cur.lines.every(function (l) { return String(l).length <= 40; })) {
        cur.range = range;
        continue;
      }
      var startsNew = !!range;
      if (!startsNew && cur && cur.range) {
        // 同一条记录里出现第二所学校/公司 → 也视为新记录
        var hasSchool = SCHOOL_RE.test(line);
        var hasCompany = /(?:有限公司|有限责任公司|集团|科技|公司|Inc\.?|Ltd\.?|Corp\.?)/i.test(line);
        var curKeyLine = cur.lines[0] || '';
        if ((hasSchool && !SCHOOL_RE.test(curKeyLine)) || (hasCompany && !/(?:有限公司|有限责任公司|集团|科技|公司|Inc\.?|Ltd\.?|Corp\.?)/i.test(curKeyLine))) {
          startsNew = true;
        }
      }
      if (startsNew || !cur) {
        cur = { range: range, lines: [] };
        records.push(cur);
      }
      cur.lines.push(line);
    }
    return records;
  }

  /** 从“浙江大学  计算机科学与技术  本科”这种行里猜专业 */
  function guessMajor(line, school, degree) {
    var t = String(line || '');
    if (school) t = t.replace(school, ' ');
    if (degree) t = t.replace(degree, ' ');
    t = t.replace(RE_RANGE, ' ').replace(/\b(19|20)\d{2}\b/g, ' ');
    var tokens = t.split(/[\s|,，;；/]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (tok.length < 2 || tok.length > 20) continue;
      if (/^(本科|硕士|博士|大专|专科|研究生|学士|在读|全日制|统招)$/.test(tok)) continue;
      if (/^[\d.%\/]+$/.test(tok)) continue;
      if (/大学|学院|学校|中学/.test(tok)) continue;
      return tok;
    }
    return '';
  }

  /** 专业：优先“专业: X”，其次“自动化专业”这种后缀写法，最后按学校行猜 */
  function detectMajor(blob, firstLine, school, degree) {
    var m = String(blob || '').match(/专\s*业\s*[:：]\s*([^\s|,，;；]{2,20})/);
    if (m && m[1]) return m[1].trim();
    var m2 = String(blob || '').match(/([\u4e00-\u9fa5]{2,12})专业(?![\u4e00-\u9fa5])/);
    if (m2 && m2[1] && !/^(基础|课程|知识|技能|能力)$/.test(m2[1])) return m2[1].trim();
    return guessMajor(firstLine || '', school, degree);
  }

  function parseEducation(sections) {
    var lines = (sections.education || []).filter(function (l) { return String(l).trim(); });
    var records = splitRecords(lines);
    var out = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var blob = rec.lines.join(' ');
      var school = detectSchool(blob);
      var degree = detectDegree(blob);
      var major = detectMajor(blob, rec.lines[0] || '', school, degree);
      if (!school && !major && !degree) continue;
      out.push({
        school: school,
        major: String(major || '').replace(/^专业[:：]?/, '').trim(),
        degree: degree,
        start: rec.range ? rec.range.start : '',
        end: rec.range ? rec.range.end : '',
        city: '',
        gpa: (blob.match(/(?:GPA|绩点)\s*[:：]?\s*([\d.]+\s*\/?\s*[\d.]*)/i) || [])[1] || '',
        description: rec.lines.slice(1).join(' ').slice(0, 200)
      });
    }
    return out;
  }

  // ————— 工作 —————

  var COMPANY_RE = /([\u4e00-\u9fa5A-Za-z0-9（）()·&]{2,30}?(?:股份有限公司|有限责任公司|有限公司|集团|研究院|公司|科技|事业部|Inc\.?|Ltd\.?|Corp\.?|LLC|Group))/i;
  // 先贪心匹配“XX有限公司”，否则“字节跳动科技有限公司”会被切成“字节跳动科技”
  var COMPANY_STRONG_RE = /([\u4e00-\u9fa5A-Za-z0-9（）()·&]{2,30}(?:股份有限公司|有限责任公司|有限公司))/;
  var TITLE_RE = /((?:高级|资深|首席|初级|中级|senior|junior|lead)?\s?[\u4e00-\u9fa5A-Za-z]{0,8}?(?:工程师|架构师|技术专家|产品经理|项目经理|经理|主管|总监|专员|实习生|设计师|分析师|顾问|负责人|组长|Engineer|Manager|Developer|Intern))/i;

  function parseWork(sections) {
    var lines = (sections.work || []).filter(function (l) { return String(l).trim(); });
    var records = splitRecords(lines);
    var out = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var blob = rec.lines.join(' ');
      var company = (blob.match(COMPANY_STRONG_RE) || blob.match(COMPANY_RE) || [''])[0];
      var title = '';
      var tm = blob.match(new RegExp('(?:职位|岗位|职务)\\s*[:：]\\s*([^\\s，,;；]{2,20})'));
      if (tm) title = tm[1];
      if (!title) title = (blob.match(TITLE_RE) || [''])[0];
      if (!company && !title) continue;
      out.push({
        company: company.trim(),
        title: title.trim(),
        start: rec.range ? rec.range.start : '',
        end: rec.range ? rec.range.end : '',
        city: labeledToken(blob, ['工作地点', '地点']) || '',
        description: rec.lines.slice(1).join(' ').slice(0, 400)
      });
    }
    return out;
  }

  // ————— 项目 —————

  function parseProjects(sections) {
    var lines = (sections.project || []).filter(function (l) { return String(l).trim(); });
    var out = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i]).trim();
      if (!line) continue;
      var isStart = /^(项目名称|项目)\s*[:：]/.test(line) || !!parseRange(line) || (!cur && !/^(项目描述|职责|业绩|成果|技术栈)/.test(line));
      if (isStart) {
        if (cur) out.push(cur);
        var name = line.replace(/^项目名称\s*[:：]\s*/, '').replace(/^项目\s*[:：]\s*/, '');
        var range = parseRange(line);
        if (range) name = name.replace(range.raw, '').trim();
        cur = { name: name.slice(0, 60), role: '', start: range ? range.start : '', end: range ? range.end : '', tech: '', description: '' };
      } else if (cur) {
        if (/^(技术栈|使用技术|技术)\s*[:：]/.test(line)) cur.tech = line.replace(/^[^:：]*[:：]\s*/, '');
        else if (/^(项目角色|担任角色|职责)\s*[:：]/.test(line)) cur.role = line.replace(/^[^:：]*[:：]\s*/, '');
        else cur.description = (cur.description + ' ' + line).trim().slice(0, 500);
      }
    }
    if (cur) out.push(cur);
    return out.filter(function (p) { return p.name; });
  }

  // ————— 其他 —————

  function parseIntent(sections) {
    var blob = (sections.intent || []).join(' ') + ' ' + (sections.preamble || []).join(' ');
    return {
      jobTarget: labeledToken(blob, ['求职意向', '期望职位', '应聘职位', '目标职位', '职位']),
      expectedCity: labeledToken(blob, ['期望城市', '意向城市', '期望工作地']),
      expectedSalary: labeledToken(blob, ['期望薪资', '期望月薪', '薪资要求']),
      expectedIndustry: labeledToken(blob, ['期望行业', '意向行业'])
    };
  }

  function parseSkills(sections) {
    var lines = (sections.skills || []).filter(function (l) { return String(l).trim(); });
    if (!lines.length) return '';
    var parts = [];
    for (var i = 0; i < lines.length; i++) {
      var t = String(lines[i]).replace(/^[^:：]{2,10}[:：]\s*/, '').trim();
      if (!t) continue;
      parts = parts.concat(t.split(/[、,，;；|]/).map(function (x) { return x.trim(); }).filter(Boolean));
    }
    return parts.slice(0, 40).join('、');
  }

  function parseSummary(sections) {
    var lines = (sections.summary || []).filter(function (l) { return String(l).trim(); });
    return lines.join(' ').trim().slice(0, 600);
  }

  function parseAwards(sections) {
    var lines = (sections.awards || []).filter(function (l) { return String(l).trim(); });
    return lines.join(' ').trim().slice(0, 400);
  }

  // ————— 主入口 —————

  /** 排序用：结束时间晚（“至今”最晚）优先，其次开始时间；无时间的排最后 */
  function recencyKey(item) {
    var end = String(item.end || '');
    if (end === '至今') return '9999-99';
    if (!end) return String(item.start || '0000-00');
    return end;
  }

  function byRecency(a, b) {
    var ka = recencyKey(a);
    var kb = recencyKey(b);
    if (ka !== kb) return ka < kb ? 1 : -1;
    var sa = String(a.start || '');
    var sb = String(b.start || '');
    if (sa === sb) return 0;
    return sa < sb ? 1 : -1;
  }

  function parseResumeText(rawText, options) {
    var opts = options || {};
    var text = normalizeText(rawText);
    var sections = splitSections(text);
    var profile = P.emptyProfile();
    var warnings = [];

    var basicBlob = [sections.preamble || [], sections.basic || []].map(function (a) { return a.join(' '); }).join(' ');
    var allBlob = text.slice(0, 4000);

    profile.name = detectName(text, sections);
    profile.email = matchText(allBlob, RE_EMAIL);
    profile.phone = matchText(allBlob, RE_PHONE) || matchText(allBlob, RE_PHONE_INTL);
    profile.gender = detectGender(basicBlob);
    profile.birthday = detectBirthday(basicBlob);
    profile.city = labeledToken(basicBlob, ['现居地', '现居住地', '所在城市', '现居', '城市', '所在地']);
    var links = detectLinks(text);
    profile.github = links.github;
    profile.linkedin = links.linkedin;
    profile.website = links.website;
    profile.wechat = labeled(basicBlob, ['微信', '微信号']);
    profile.ethnicity = labeled(basicBlob, ['民族']);
    profile.politicalStatus = labeled(basicBlob, ['政治面貌']);
    profile.nativePlace = labeled(basicBlob, ['籍贯']);
    profile.currentCity = profile.city;
    profile.highestDegree = '';

    var intent = parseIntent(sections);
    profile.jobTarget = intent.jobTarget;
    profile.expectedCity = intent.expectedCity;
    profile.expectedSalary = intent.expectedSalary;
    profile.expectedIndustry = intent.expectedIndustry;

    var eduList = parseEducation(sections);
    var workList = parseWork(sections);
    var projectList = parseProjects(sections);

    // 最新在前：主条目（school/company 等）取第一段 = 最近/最高学历，符合简历习惯
    eduList.sort(byRecency);
    workList.sort(byRecency);
    projectList.sort(byRecency);

    profile.eduList = eduList;
    profile.workList = workList;
    profile.projectList = projectList;

    var degreeRank = { '博士': 5, '硕士': 4, '本科': 3, '大专': 2, '高中': 1, '': 0 };
    var best = { degree: '', rank: -1 };
    eduList.forEach(function (e) {
      var r = degreeRank[e.degree] || 0;
      if (r > best.rank) { best = { degree: e.degree, rank: r }; }
    });
    profile.highestDegree = best.degree;
    profile.eduDegree = best.degree;
    profile.degree = best.degree;

    profile.techSkills = parseSkills(sections);
    profile.skills = profile.techSkills;
    profile.summary = parseSummary(sections);
    profile.honors = parseAwards(sections);
    if (workList.length) profile.lastCompany = workList[0].company;
    if (eduList.length) profile.isFreshGraduate = workList.length ? '' : '是';
    profile.resumeTitle = (profile.name ? profile.name + '-' : '') + (profile.jobTarget || '简历');
    profile.years = estimateYears(workList);

    P.deriveMainEntries(profile);

    // 置信度 & 提醒
    var keyFields = ['name', 'phone', 'email', 'school', 'company', 'jobTarget'];
    var hit = keyFields.filter(function (k) { return !!profile[k]; }).length;
    if (!profile.phone) warnings.push('未识别到手机号');
    if (!profile.email) warnings.push('未识别到邮箱');
    if (!eduList.length) warnings.push('未识别到教育经历');
    if (!workList.length) warnings.push('未识别到工作/实习经历');
    if (!profile.name) warnings.push('未识别到姓名');

    return {
      profile: profile,
      text: text,
      sections: Object.keys(sections).reduce(function (acc, k) {
        acc[k] = (sections[k] || []).filter(function (l) { return String(l).trim(); }).length;
        return acc;
      }, {}),
      confidence: Math.round((hit / keyFields.length) * 100),
      warnings: warnings,
      stats: { chars: text.length, edu: eduList.length, work: workList.length, project: projectList.length },
      parsedAt: Date.now(),
      parserVersion: opts.version || '1.4.1'
    };
  }

  function estimateYears(workList) {
    if (!workList || !workList.length) return '';
    var earliest = '';
    var latest = '';
    workList.forEach(function (w) {
      if (w.start && (!earliest || w.start < earliest)) earliest = w.start;
      if (w.end) {
        if (w.end === '至今') latest = 'now';
        else if (latest !== 'now' && (!latest || w.end > latest)) latest = w.end;
      }
    });
    if (!earliest) return '';
    var sy = parseInt(earliest.slice(0, 4), 10);
    var ey = latest === 'now' ? new Date().getFullYear() : (latest ? parseInt(latest.slice(0, 4), 10) : sy);
    var y = Math.max(0, ey - sy);
    return y ? String(y) : '';
  }

  // ————— 文件 → 文本 —————

  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(fr.error || new Error('读取文件失败')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('读取文件失败')); };
      fr.readAsArrayBuffer(file);
    });
  }

  async function extractPdf(file) {
    var lib = root.pdfjsLib;
    if (!lib) throw new Error('pdf.js 未加载');
    if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = root.chrome && chrome.runtime
        ? chrome.runtime.getURL('lib/pdf.worker.min.js')
        : 'lib/pdf.worker.min.js';
    }
    var buf = await readAsArrayBuffer(file);
    var doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    var pages = [];
    for (var i = 1; i <= doc.numPages; i++) {
      var page = await doc.getPage(i);
      var content = await page.getTextContent();
      var line = '';
      var lastY = null;
      content.items.forEach(function (it) {
        if (!it || typeof it.str !== 'string') return;
        var y = it.transform ? it.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { line += '\n'; }
        line += it.str;
        if (it.hasEOL) line += '\n';
        lastY = y;
      });
      pages.push(line);
    }
    return { text: pages.join('\n\n'), pages: doc.numPages, kind: 'pdf' };
  }

  async function extractDocx(file) {
    var mammoth = root.mammoth;
    if (!mammoth) throw new Error('mammoth 未加载');
    var buf = await readAsArrayBuffer(file);
    var result = await mammoth.extractRawText({ arrayBuffer: buf });
    return { text: String(result.value || ''), kind: 'docx', messages: (result.messages || []).map(function (m) { return m.message; }) };
  }

  var MAX_FILE_BYTES = 20 * 1024 * 1024;

  /** 统一入口：按扩展名/类型分派 */
  async function extractTextFromFile(file) {
    if (!file) throw new Error('未选择文件');
    if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
      throw new Error('文件过大（上限 20MB）');
    }
    var name = String(file.name || '');
    var ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf' || file.type === 'application/pdf') return await extractPdf(file);
    if (ext === 'docx') return await extractDocx(file);
    if (ext === 'doc') {
      throw new Error('老版 .doc 暂不支持，请另存为 .docx 或 PDF');
    }
    if (ext === 'txt' || ext === 'md' || ext === 'text') {
      return { text: await readAsText(file), kind: ext };
    }
    if (file.type && file.type.indexOf('text/') === 0) {
      return { text: await readAsText(file), kind: 'text' };
    }
    throw new Error('不支持的文件类型：' + (ext || file.type || '未知'));
  }

  var api = {
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    normalizeText: normalizeText,
    splitSections: splitSections,
    headingKey: headingKey,
    parseRange: parseRange,
    parseResumeText: parseResumeText,
    extractTextFromFile: extractTextFromFile,
    extractPdf: extractPdf,
    extractDocx: extractDocx
  };

  root.ResumeAutofillParser = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
