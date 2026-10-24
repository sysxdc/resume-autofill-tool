/**
 * 填写审计：填完之后，逐项把「我们以为填进去的值」与「页面上真实的值」对一遍。
 *
 * 为什么需要它：这几轮实测里最常见的失败不是「填错了内容」，而是**以为填上了、其实没进去**
 * （值进了搜索框、点 li 不提交、隐藏 input 让字段被误判为已填、受控组件重渲染把值吞掉）。
 * 这类失败在「零错填」的红线下表现为「留空」，但如果哪天某个站点把值写到了错字段上，
 * 只有审计能抓住。审计只做本地比较，不发网络、不上传内容。
 *
 * 浏览器：ResumeAutofillAudit；Node：module.exports
 */
(function (root, factory) {
  var Cap = root.ResumeAutofillDate;
  if (typeof module === 'object' && module.exports) {
    try { if (!Cap) Cap = require(require('path').join(__dirname, 'date-capability.js')); } catch (_) { /* ignore */ }
  }
  var api = factory(Cap);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ResumeAutofillAudit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cap) {
  'use strict';

  function norm(t) {
    return String(t == null ? '' : t)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 只比数字/字母，用于「广东省阳江市」vs「广东省 阳江市」这类排版差异 */
  function tight(t) {
    return norm(t).replace(/[\s\-/.()（）【】[\]]+/g, '').toLowerCase();
  }

  var DATE_HINT = /^(birthday|eduStart|eduEnd|startDate|endDate|workEnd|projectStart|projectEnd|campusStart|campusEnd|socialStart|socialEnd|awardDate|awardEnd|internStart|internEnd|trainingStart|trainingEnd|gaokaoDate|englishDate|langDate|certDate|certExpiry|degreeAwardDate|paperDate|patentApplyDate|partyJoinDate|leagueOrPartyJoinDate|expectedStartDate|earliestStart)$/;
  var PHONE_KEY = /^(phone|emergencyContactPhone|familyPhone|refereeContact|internRefereeContact|projectRefereeContact|counselorContact)$/;
  var NUMBER_KEY = /^(gpa|englishScore|langScore|certScore|gaokaoScore|height|weight|years|eduYears|failedCourses|majorClassSize|projectTeamSize|expectedSalary|expectedAnnualSalary|currentSalary|monthlySalary|annualSalary|internAnnualSalary)$/;
  var REGION_KEY = /^(province|city|currentProvince|currentCity|currentDistrict|nativePlace|nativeProvince|nativeCity|studentOrigin|hukou|hukouProvince|hukouCity|schoolCity|workCity|internCity|projectCity|expectedCity|expectedCity2|interviewCity)$/;

  function numberValue(s) {
    // 不允许 parseFloat 吞掉后缀、分母、单位或证件号中的字符。
    if (!/^[¥￥$€]?\s*[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) return null;
    var n = Number(s.replace(/[¥￥$€,\s]/g, ''));
    return isFinite(n) ? n : null;
  }

  function phoneValue(s) {
    if (!/^\+?[\d\s()（）-]+$/.test(s)) return null;
    var digits = s.replace(/\D/g, '');
    if (/^\+86/.test(s) && /^861\d{10}$/.test(digits)) return digits.slice(2);
    return digits;
  }

  /**
   * 单条比较。
   * @param {{key:string,label?:string,expected:string,actual:string,kind?:string}} e
   * @returns {{key,label,expected,actual,status:'ok'|'empty'|'mismatch'|'approx',level?:string}}
   */
  function compareEntry(e) {
    var expected = norm(e && e.expected);
    var actual = norm(e && e.actual);
    var label = (e && e.label) || (e && e.key) || '';

    function result(status, level, accepted) {
      var r = { key: e.key, label: label, expected: expected, actual: actual, status: status, accepted: accepted === true };
      if (level) r.level = level;
      return r;
    }
    if (e.kind === 'multi' || Array.isArray(e.expected)) {
      var wantedSet = Array.isArray(e.expected) ? Array.from(new Set(e.expected.map(norm))).sort() : null;
      var actualSet = Array.isArray(e.actual) ? Array.from(new Set(e.actual.map(norm))).sort() : null;
      if (!wantedSet || !actualSet) return result('mismatch', 'set-type', false);
      return result(JSON.stringify(wantedSet) === JSON.stringify(actualSet) ? 'ok' : (actualSet.length ? 'mismatch' : 'empty'), 'set', JSON.stringify(wantedSet) === JSON.stringify(actualSet));
    }
    if (!expected) return result('ok', null, true);

    // 日期字段：精度损失或补日仍需核对，不能当作精确事实。
    var kind = (e && e.kind) || '';
    var looksDate = kind === 'date' || DATE_HINT.test(String(e && e.key || ''));
    if (looksDate && Cap && Cap.matchLevel) {
      var m = Cap.matchLevel(actual, expected);
      if (m.level === 'exact') return result('ok', 'exact', true);
      if (m.level === 'day-approx' || m.level === 'month-only') {
        return result('approx', m.level, false);
      }
      return result(actual ? 'mismatch' : 'empty', m.level, false);
    }

    if (!actual) return result('empty', null, false);

    if (actual === expected) return result('ok', null, true);
    var key = String(e.key || '');
    if (PHONE_KEY.test(key) || kind === 'tel') {
      var pa = phoneValue(actual), px = phoneValue(expected);
      return pa && px && pa === px ? result('ok', 'phone-format', true) : result('mismatch', null, false);
    }
    if (NUMBER_KEY.test(key) || kind === 'number') {
      var na = numberValue(actual), nx = numberValue(expected);
      if (na !== null && nx !== null && na === nx) return result('ok', 'number-format', true);
      // GPA 的分母属于资料的一部分，不能用去标点或只读分子来核验。
      if (key === 'gpa') {
        var ga = actual.match(/^(\d+(?:\.\d+)?)\s*[/／]\s*(\d+(?:\.\d+)?)$/);
        var gx = expected.match(/^(\d+(?:\.\d+)?)\s*[/／]\s*(\d+(?:\.\d+)?)$/);
        if (ga && gx && Number(ga[1]) === Number(gx[1]) && Number(ga[2]) === Number(gx[2])) return result('ok', 'gpa-format', true);
      }
      return result('mismatch', null, false);
    }
    if (/^(idNumber|eduCertNo|degreeCertNo)$/.test(key) && actual.toUpperCase() === expected.toUpperCase()) return result('ok', 'id-case', true);
    if (/^(email|secondaryEmail)$/.test(key) || kind === 'email') {
      var atA = actual.lastIndexOf('@'), atX = expected.lastIndexOf('@');
      if (atA > 0 && atX > 0 && actual.slice(0, atA) === expected.slice(0, atX) && actual.slice(atA).toLowerCase() === expected.slice(atX).toLowerCase()) return result('ok', 'email-domain-case', true);
      return result('mismatch', null, false);
    }
    if (e.key === 'gradYear' && /^\d{4}$/.test(expected) &&
        actual.replace(/[年届]/g, '') === expected) {
      return result('approx', 'year-suffix', true);
    }
    if (/^(englishLevel|langLevel|langCertName)$/.test(e.key || '')) {
      var cet = function (v) {
        if (/^(cet[\s-]?4|大学英语四级|英语四级|四级)$/i.test(v)) return 'CET4';
        if (/^(cet[\s-]?6|大学英语六级|英语六级|六级)$/i.test(v)) return 'CET6';
        return v;
      };
      if (cet(actual) === cet(expected)) return result('approx', 'cet-synonym', true);
    }

    // 页面给值加了「(类别)(层次)(地区)」这类消歧后缀 → 近似，例如专业「自动化」显示成
    // 「自动化(自动化类)(普通本科)(中国大陆)」。只认「紧跟括号」，所以
    // 「广东工业大学」vs「广东工业大学华立学院」仍然是错填（那是另一所学校）。
    if (/^(major|majorCategory)$/.test(key) && actual.indexOf(expected) === 0 &&
        /^(?:\([^()]+\)|（[^（）]+）)+$/.test(actual.slice(expected.length))) {
      return result('approx', 'code-suffix', true);
    }
    // 页面把值截断了（期望更长、且包含页面显示）→ 近似，例如「广东省阳江市」显示成「阳江市」
    if (REGION_KEY.test(key) && expected.indexOf(actual) !== -1 && /(?:省|市|区|县|自治州|自治区)$/.test(actual)) {
      return result('approx', 'region-partial', false);
    }
    // 选项题：页面常把「本科」显示成「本科（学士）」。只对枚举类字段放宽，
    // 否则「广东工业大学」vs「广东工业大学华立学院」会被误判成同一个学校。
    if (/^(eduDegree|highestDegree)$/.test(key)) {
      var labels = { '本科': ['大学本科', '本科（学士）', '本科(学士)'], '专科': ['大学专科', '大专'], '硕士': ['硕士研究生'], '博士': ['博士研究生'] };
      if (labels[expected] && labels[expected].indexOf(actual) !== -1) return result('approx', 'degree-label', true);
    }
    if (key === 'degree' && /^(?:工学|理学|文学|经济学|管理学|法学|教育学|农学|医学|艺术学|历史学|哲学|军事学)(?:学士|硕士|博士)$/.test(expected) &&
        /^(学士|硕士|博士)$/.test(actual) && expected.endsWith(actual)) return result('approx', 'degree-label', true);
    if (key === 'studyMode' && ((expected === '全日制' && actual === '全日制教育') ||
        (expected === '非全日制' && actual === '非全日制教育'))) return result('approx', 'study-mode-label', true);
    return result('mismatch', null, false);
  }

  /**
   * 批量审计。
   * @returns {{checked:number, ok:number, approx:number, empty:number, mismatch:number, problems:Array, entries:Array}}
   */
  function auditEntries(entries, opts) {
    var o = opts || {};
    var rows = [];
    (entries || []).forEach(function (e) {
      if (!e || !e.key) return;
      rows.push(compareEntry(e));
    });
    var res = { checked: rows.length, ok: 0, approx: 0, empty: 0, mismatch: 0, verified: 0, needsReview: 0, problems: [], entries: rows };
    rows.forEach(function (r) {
      if (r.status === 'ok') res.ok += 1;
      else if (r.status === 'approx') res.approx += 1;
      else if (r.status === 'empty') res.empty += 1;
      else res.mismatch += 1;
      if (r.accepted) res.verified += 1;
      else if (r.status === 'approx') res.needsReview += 1;
      if (r.status === 'mismatch' || (r.status === 'empty' && !o.ignoreEmpty) || r.status === 'approx') {
        res.problems.push(r);
      }
    });
    res.okAll = res.mismatch === 0 && (o.ignoreEmpty || res.empty === 0) && res.needsReview === 0;
    res.wrongFill = res.mismatch;   // 红线：真填错了
    return res;
  }

  return {
    compareEntry: compareEntry,
    auditEntries: auditEntries,
    _internals: { norm: norm, tight: tight, DATE_HINT: DATE_HINT }
  };
});
