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

  /**
   * 单条比较。
   * @param {{key:string,label?:string,expected:string,actual:string,kind?:string}} e
   * @returns {{key,label,expected,actual,status:'ok'|'empty'|'mismatch'|'approx',level?:string}}
   */
  function compareEntry(e) {
    var expected = norm(e && e.expected);
    var actual = norm(e && e.actual);
    var label = (e && e.label) || (e && e.key) || '';

    if (!expected) return { key: e.key, label: label, expected: expected, actual: actual, status: 'ok' };

    // 日期字段：走能力层判级（月精度/补日都是合法的）
    var kind = (e && e.kind) || '';
    var looksDate = kind === 'date' || DATE_HINT.test(String(e && e.key || '')) ||
      /^\d{4}\s*[-/.年]/.test(expected);
    if (looksDate && Cap && Cap.matchLevel) {
      var m = Cap.matchLevel(actual, expected);
      if (m.level === 'exact') return { key: e.key, label: label, expected: expected, actual: actual, status: 'ok', level: 'exact' };
      if (m.level === 'day-approx' || m.level === 'month-only') {
        return { key: e.key, label: label, expected: expected, actual: actual, status: 'approx', level: m.level };
      }
      return { key: e.key, label: label, expected: expected, actual: actual, status: actual ? 'mismatch' : 'empty', level: m.level };
    }

    if (!actual) return { key: e.key, label: label, expected: expected, actual: actual, status: 'empty' };

    var a = tight(actual);
    var x = tight(expected);
    if (a === x) return { key: e.key, label: label, expected: expected, actual: actual, status: 'ok' };

    // 页面给值加了「(类别)(层次)(地区)」这类消歧后缀 → 近似，例如专业「自动化」显示成
    // 「自动化(自动化类)(普通本科)(中国大陆)」。只认「紧跟括号」，所以
    // 「广东工业大学」vs「广东工业大学华立学院」仍然是错填（那是另一所学校）。
    if (x && actual.length > expected.length && tight(actual).indexOf(x) === 0 &&
        /^[（(]/.test(norm(actual).slice(expected.length))) {
      return { key: e.key, label: label, expected: expected, actual: actual, status: 'approx', level: 'code-suffix' };
    }
    // 页面把值截断了（期望更长、且包含页面显示）→ 近似，例如「广东省阳江市」显示成「阳江市」
    if (x && a && x.indexOf(a) !== -1 && a.length >= 2) {
      return { key: e.key, label: label, expected: expected, actual: actual, status: 'approx', level: 'truncated' };
    }
    // 选项题：页面常把「本科」显示成「本科（学士）」。只对枚举类字段放宽，
    // 否则「广东工业大学」vs「广东工业大学华立学院」会被误判成同一个学校。
    var optionish = /^(degree|eduDegree|workNature|gender|politicalStatus|maritalStatus|idType|employmentType|jobType|awardLevel|awardType|awardGrade|certType|langLevel|englishLevel|hukouType|schoolType|eduMode|studyMode|enrollmentType|nationality|availability|willingToRelocate|acceptAdjustment)$/;
    if (optionish.test(String(e.key || '')) && a && x && a.indexOf(x) !== -1 && x.length >= 2) {
      return { key: e.key, label: label, expected: expected, actual: actual, status: 'approx', level: 'option-longer' };
    }
    return { key: e.key, label: label, expected: expected, actual: actual, status: 'mismatch' };
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
    var res = { checked: rows.length, ok: 0, approx: 0, empty: 0, mismatch: 0, problems: [], entries: rows };
    rows.forEach(function (r) {
      if (r.status === 'ok') res.ok += 1;
      else if (r.status === 'approx') res.approx += 1;
      else if (r.status === 'empty') res.empty += 1;
      else res.mismatch += 1;
      if (r.status === 'mismatch' || (r.status === 'empty' && !o.ignoreEmpty) || r.status === 'approx') {
        res.problems.push(r);
      }
    });
    res.okAll = res.mismatch === 0;
    res.wrongFill = res.mismatch;   // 红线：真填错了
    return res;
  }

  return {
    compareEntry: compareEntry,
    auditEntries: auditEntries,
    _internals: { norm: norm, tight: tight, DATE_HINT: DATE_HINT }
  };
});
