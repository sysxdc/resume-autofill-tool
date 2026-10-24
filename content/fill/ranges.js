/**
 * 简历填写工具 · 内容脚本 · 起止时间：范围控件、Moka 年 + 月下拉对、单输入框装两个日期
 * 由 content/autofill.js 拆出（v1.6.0）。模块之间通过 globalThis.ResumeAutofillContent 共享函数，
 * 加载顺序见 manifest.json content_scripts；排在后面的模块用转发函数引用（调用时才解析）。
 */
(function () {
  'use strict';

  var C = globalThis.ResumeAutofillContent || (globalThis.ResumeAutofillContent = {});
  var M = globalThis.ResumeAutofillMatch;
  var D = globalThis.ResumeAutofillDate || null;
  var S = globalThis.ResumeAutofillDateStrategies || null;
  if (!globalThis.ResumeAutofillMatch) return;
  // 重复注入时整个模块跳过：保持和首次加载的编排层用同一套函数 / 本轮状态
  var loaded = C.__loaded || (C.__loaded = {});
  if (loaded['fill/ranges']) return;
  loaded['fill/ranges'] = true;

  // 依赖（已加载的模块）
  var ADD_SECTION_RULES = C.ADD_SECTION_RULES;
  var bridgeDateCommit = C.bridgeDateCommit;
  var customSelectLooksFilled = C.customSelectLooksFilled;
  var customSelectText = C.customSelectText;
  var dateValueMatches = C.dateValueMatches;
  var detectSectionContext = C.detectSectionContext;
  var fillAntdPickerByModel = C.fillAntdPickerByModel;
  var fillAntdRangePicker = C.fillAntdRangePicker;
  var fillCustomSelect = C.fillCustomSelect;
  var fillLaydate = C.fillLaydate;
  var fillRecords = C.fillRecords;
  var findCustomSelectHost = C.findCustomSelectHost;
  var getLabelText = C.getLabelText;
  var isCurrentJobValue = C.isCurrentJobValue;
  var isLaydateInput = C.isLaydateInput;
  var isVisibleEl = C.isVisibleEl;
  var laydateKind = C.laydateKind;
  var parseDateParts = C.parseDateParts;
  var recordFill = C.recordFill;
  var runDone = C.runDone;
  var sleep = C.sleep;
  var writeAndVerify = C.writeAndVerify;

  // —————— v1.5.7：起止时间合在一个控件里（el-date-editor--daterange / ant-picker-range）——————
  // 这类控件的两个 input 共享同一个 label（「起止时间」），逐 input 匹配只会各写一份同样的值；
  // 必须按「分区 + 第几段」取 start/end，再走组件自己的提交路径。
  var RANGE_EDITOR_SEL = '.el-date-editor--daterange, .el-date-editor--datetimerange, ' +
    '.el-date-editor--monthrange, .ant-picker-range';

  var RANGE_SECTION_MAP = {
    edu: { listKey: 'eduList', startKey: 'eduStart', endKey: 'eduEnd' },
    work: { listKey: 'workList', startKey: 'startDate', endKey: 'workEnd' },
    intern: { listKey: 'internList', startKey: 'internStart', endKey: 'internEnd' },
    project: { listKey: 'projectList', startKey: 'projectStart', endKey: 'projectEnd' },
    campus: { listKey: 'campusList', startKey: 'campusStart', endKey: 'campusEnd' }
  };

  function nodeText(n) {
    return String((n && n.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function ruleForText(text) {
    var t = String(text || '');
    if (!t) return null;
    for (var i = 0; i < ADD_SECTION_RULES.length; i++) {
      if (ADD_SECTION_RULES[i].re.test(t)) return ADD_SECTION_RULES[i];
    }
    return null;
  }

  /** 范围控件属于哪个分区、第几段（BYD：.list-form-container + 「教育经历-1」标题） */
  function rangeContext(el) {
    var row = el.closest
      ? el.closest('.list-form-container, [class*="list-form-item"], [class*="resume-item"]')
      : null;
    var rule = null;
    var header = row
      ? row.querySelector('.list-form-header, .form-header-title, [class*="header-title"]')
      : null;
    if (header) rule = ruleForText(nodeText(header));
    var section = el.closest ? el.closest('.resume-section, .ant-card, section') : null;
    if (!rule && section) {
      var secHead = section.querySelector('.section-title .title') ||
        section.querySelector('.section-title, .ant-card-head-title, h2, h3');
      rule = ruleForText(nodeText(secHead));
    }
    if (!rule) return null;
    if (!RANGE_SECTION_MAP[rule.key]) return null;
    var index = 0;
    var explicit = false;
    var m = nodeText(header).match(/(\d+)\s*(?:$|[）)])/);
    if (m) {
      index = Math.max(0, parseInt(m[1], 10) - 1);
      explicit = true;
    } else if (row && row.parentElement) {
      var sibs = Array.prototype.filter.call(row.parentElement.children, function (n) {
        return n.classList && n.classList.contains('list-form-container');
      });
      var pos = sibs.indexOf(row);
      if (pos >= 0) { index = pos; explicit = true; }
    }
    return { rule: rule, index: index, explicit: explicit };
  }

  /** 从最近的 id 里读段序号（快手：educations_1_schoolName、interShips_0_companyName） */
  function rowIndexFromIds(el) {
    var node = el;
    for (var up = 0; up < 10 && node; up++, node = node.parentElement) {
      var own = String(node.id || '');
      var m0 = own.match(/^[A-Za-z]+_(\d+)_/);
      if (m0) return parseInt(m0[1], 10);
      var ids = node.querySelectorAll ? node.querySelectorAll('[id]') : [];
      for (var i = 0; i < ids.length; i++) {
        var m = String(ids[i].id || '').match(/^[A-Za-z]+_(\d+)_/);
        if (m) return parseInt(m[1], 10);
      }
    }
    return -1;
  }

  /** 分区标题不在 .resume-section 里时（快手 .edit-resume-form-item-title）的兜底 */
  function rangeContextLoose(el) {
    var rule = null;
    var node = el;
    for (var up = 0; up < 10 && node && !rule; up++, node = node.parentElement) {
      if (!node.querySelector) continue;
      var t = node.querySelector('.edit-resume-form-item-title, [class*="form-item-title"], .section-gorgeously-title, .section-title, legend, h2, h3');
      if (t) rule = ruleForText(nodeText(t));
    }
    if (!rule || !RANGE_SECTION_MAP[rule.key]) return null;
    var idx = rowIndexFromIds(el);
    return { rule: rule, index: idx < 0 ? 0 : idx, explicit: idx >= 0 };
  }

  /** 「2023-09」→ Date；缺日时，起点补 1 号，终点补当月最后一天 */
  function rangeDateOf(value, isEnd) {
    var parts = parseDateParts(value);
    if (!parts) return null;
    var y = parseInt(parts.y, 10);
    var m = parseInt(parts.m, 10);
    if (!y || !m) return null;
    var d = parts.d ? parseInt(parts.d, 10) : (isEnd ? new Date(y, m, 0).getDate() : 1);
    return new Date(y, m - 1, d);
  }

  function formatDateYmd(d) {
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  /**
   * 写范围控件：先落 UI 值，再用组件自己的提交路径（点日历格子走的就是 pick 事件）更新 v-model。
   * 只有提交成功（v-model 已更新）才算填上，避免「看起来有值、表单其实没收到」。
   */
  async function fillRangeEditor(editor, startVal, endVal) {
    // antd 的 RangePicker 两个 input 都是 readonly：只能点面板（快手教育经历的「起止时间」）
    if (editor.classList && editor.classList.contains('ant-calendar-picker')) {
      // antd v3 范围：调组件自己的 handleChange（与点完面板等价）
      var v3ins = editor.querySelectorAll('input.ant-calendar-range-picker-input');
      if (v3ins.length < 2 || !fillAntdPickerByModel(v3ins[0], startVal, endVal)) return false;
      await sleep(160);
      var a3 = String(v3ins[0].value || '').trim();
      var b3 = String(v3ins[1].value || '').trim();
      return !!a3 && !!b3 && dateValueMatches(a3, startVal) && dateValueMatches(b3, endVal);
    }
    if (editor.classList && editor.classList.contains('ant-picker-range')) {
      var rangeIns = editor.querySelectorAll('input');
      // ① 直接改组件值（最可靠，不依赖点击）
      try {
        if (fillAntdPickerByModel(editor, startVal, endVal)) {
          await sleep(220);
          var ra = String(rangeIns[0].value || '').trim();
          var rb = String(rangeIns[1].value || '').trim();
          if (ra && rb) return true;
        }
      } catch (_) { /* ignore */ }
      // ② 退回点日历
      try {
        if (await fillAntdRangePicker(editor, startVal, endVal)) return true;
      } catch (_) { /* ignore */ }
      return false;
    }
    var inputs = Array.prototype.filter.call(editor.querySelectorAll('input'), function (i) {
      return !i.disabled && !i.readOnly;
    });
    if (inputs.length < 2) return false;
    var start = rangeDateOf(startVal, false);
    var end = rangeDateOf(endVal, true);
    if (!start || !end) return false;
    if (end.getTime() < start.getTime()) return false;
    // 组件实例提交（Vue 2 走 emitInput，会按 value-format 转换；Vue 3 走 v-model）—— 经页面主环境桥接
    var committed = bridgeDateCommit(inputs[0], start, end);
    await sleep(160);
    // 没有组件实例可提交：不往 input 里硬塞文字（那只是「看起来填了」，表单收不到），如实报告失败
    if (!committed) return false;
    var a0 = String(inputs[0].value || '').trim();
    var b0 = String(inputs[1].value || '').trim();
    return !!a0 && !!b0 && dateValueMatches(a0, formatDateYmd(start)) && dateValueMatches(b0, formatDateYmd(end));
  }

  // —————— v1.5.16：Moka 的「年 + 月」下拉对（毕业时间 / 就读时间 / 起止时间）——————
  // 它们不是日历，是一堆 sd-Dropdown 自绘下拉，placeholder 是「年」「月」；
  // 一个字段块里可能有 4 个（起止）或 2 个（单个月）。
  var YM_SECTION_MAP = [
    { re: /教育背景/, listKey: 'eduList', startKey: 'eduStart', endKey: 'eduEnd' },
    { re: /实习经历/, listKey: 'internList', startKey: 'internStart', endKey: 'internEnd' },
    { re: /工作经历/, listKey: 'workList', startKey: 'startDate', endKey: 'workEnd' },
    { re: /项目经验|项目经历/, listKey: 'projectList', startKey: 'projectStart', endKey: 'projectEnd' },
    { re: /获奖经历/, listKey: 'awardList', startKey: 'awardDate', endKey: '', startField: 'date' }
  ];

  function ymSectionOf(blockEl) {
    var head = String((blockEl && blockEl.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 8);
    for (var i = 0; i < YM_SECTION_MAP.length; i++) {
      if (YM_SECTION_MAP[i].re.test(head)) return YM_SECTION_MAP[i];
    }
    return null;
  }

  var ymPartial = [];

  async function fillYearMonthPairs(profile, filledKeys, bindings) {
    var filled = 0;
    var blocks = Array.prototype.slice.call(C.queryAll('[class*="apply-block"]'));
    for (var bi = 0; bi < blocks.length; bi++) {
      var blockEl = blocks[bi];
      var sec = ymSectionOf(blockEl);
      if (!sec) continue;
      var groups = blockEl.querySelectorAll('[class*="apply-fields"]');
      for (var gi = 0; gi < groups.length; gi++) {
        var group = groups[gi];
        var fields = group.querySelectorAll('[class*="apply-field"]');
        for (var fi = 0; fi < fields.length; fi++) {
          var field = fields[fi];
          if (runDone.ym && runDone.ym.has(field)) continue;
          var title = String((field.querySelector('[class*="title-"]') || {}).textContent || '').replace(/\s+/g, ' ').trim();
          if (!/时间|起止/.test(title)) continue;
          var yms = Array.prototype.filter.call(field.querySelectorAll('input'), function (i) {
            var ph = String(i.getAttribute('placeholder') || '');
            return ph === '年' || ph === '月';
          });
          if (yms.length < 2) continue;
          var list = M.listFor(profile, sec.listKey);
          var bound = C.boundStructuredField(yms[0], bindings);
          if (bound && bound.reason) continue;
          var rowIndex = bound && bound.listKey === sec.listKey ? bound.index : gi;
          var item = list[rowIndex] || null;
          var sf = sec.startField || 'start';
          var start = M.profileValueForOccurrence(profile,sec.startKey,rowIndex);
          var end = sec.endKey ? M.profileValueForOccurrence(profile,sec.endKey,rowIndex) : '';
          if (!start) continue;
          var sp = parseDateParts(start);
          var ep = end && end !== '至今' ? parseDateParts(end) : null;
          if (!sp) continue;
          var wants;
          if (yms.length >= 4) {
            wants = [sp.y, String(parseInt(sp.m, 10)), ep ? ep.y : '', ep ? String(parseInt(ep.m, 10)) : ''];
          } else {
            wants = [sp.y, String(parseInt(sp.m, 10))];
          }
          var ok = 0;
          var need = 0;
          var hostsYm = [];
          for (var wi = 0; wi < wants.length && wi < yms.length; wi++) {
            var host = findCustomSelectHost(yms[wi]);
            hostsYm[wi] = host;
            if (!wants[wi]) continue;
            need += 1;
            if (!host) continue;
            if (customSelectLooksFilled(host)) { ok += 1; continue; }
            try {
              if (await fillCustomSelect(host, wants[wi], sec.startKey)) ok += 1;
            } catch (_) { /* ignore */ }
          }
          // 只有年、月都落地才算填上（半截日期在「未填」清单里露出来，不能当成功）
          if (ok && ok === need) {
            if (runDone.ym) runDone.ym.add(field);
            filled += 1;
            var ymText = function (a, b) {
              return function () {
                var y = a ? customSelectText(a) : '';
                var m = b ? customSelectText(b) : '';
                return y && m ? String(y).replace(/\D/g, '') + '-' + String(m).replace(/\D/g, '') : '';
              };
            };
            if (filledKeys.indexOf(sec.startKey) === -1) filledKeys.push(sec.startKey);
            recordFill(hostsYm[0], sec.startKey, start, 'date', ymText(hostsYm[0], hostsYm[1]));
            if (sec.endKey && ep && yms.length >= 4) {
              if (filledKeys.indexOf(sec.endKey) === -1) filledKeys.push(sec.endKey);
              recordFill(hostsYm[2], sec.endKey, end, 'date', ymText(hostsYm[2], hostsYm[3]));
              fillRecords[fillRecords.length - 1].noCount = true;
            }
          } else if (ok) {
            ymPartial.push(sec.startKey);
          }
        }
      }
    }
    return filled;
  }

  // —————— v1.5.24：一个输入框装起止两个日期（「起止时间：2019-09 - 2023-06」）——————
  var STRONG_RANGE_LABEL_RE = /起止|起讫|时间段|期间|时间范围|起始.{0,4}(结束|截止)|开始.{0,4}(结束|截止)/;
  var WEAK_RANGE_LABEL_RE = /在校时间|就读时间|在读时间|在职时间|任职时间|实习时间|项目时间|学习时间|^工作时间$|经历时间/;

  function looksLikeSingleInputRange(el) {
    if (!el || el.tagName.toLowerCase() !== 'input') return false;
    var t = String(el.type || 'text').toLowerCase();
    if (t !== 'text' && t !== 'search' && t !== '') return false;
    if (el.closest && el.closest(RANGE_EDITOR_SEL + ', .ant-calendar-picker')) return false;
    var label = String(getLabelText(el) || '').replace(/\s+/g, '');
    if (/参加工作|首次工作/.test(label)) return false;
    var ph = String(el.getAttribute('placeholder') || '');
    if (STRONG_RANGE_LABEL_RE.test(label)) return true;
    // 只凭 placeholder 的「A - B」不够（「例：10k - 15k」是薪资范围）：标签或 placeholder 得像日期
    var dateish = /时间|日期|年月|年份|date|time|period/i.test(label) ||
      /yyyy|年|月|日期|时间|开始|结束|\d{4}[-/.]\d{1,2}/i.test(ph);
    if (dateish && /\S\s+(~|至|到|-)\s+\S|^\s*-\s*$|开始.{0,6}(~|至|到|-).{0,6}结束/.test(ph)) return true;
    return isLaydateInput(el) && WEAK_RANGE_LABEL_RE.test(label);
  }

  function rangeSectionFor(el) {
    var ctx = detectSectionContext(el);
    if (!ctx || !RANGE_SECTION_MAP[ctx]) {
      var label = String(getLabelText(el) || '');
      if (/实习/.test(label)) ctx = 'intern';
      else if (/在校|就读|在读|学习|教育|入学/.test(label)) ctx = 'edu';
      else if (/项目/.test(label)) ctx = 'project';
      else if (/在职|任职|工作/.test(label)) ctx = 'work';
    }
    return RANGE_SECTION_MAP[ctx] ? ctx : '';
  }

  /** 第 index 段的开始 / 结束（实习分区回落到 workList；列表空时用扁平主条目） */
  function rangeValuesFor(profile, ctxKey, index) {
    var map = RANGE_SECTION_MAP[ctxKey];
    var list = M.listFor(profile, map.listKey);
    var item = list[index] || null;
    var start = item && item.start ? String(item.start).trim() : '';
    var end = item && item.end ? String(item.end).trim() : '';
    if (!start && index === 0) start = M.profileValue(profile, map.startKey) || '';
    if (!end && index === 0) end = M.profileValue(profile, map.endKey) || '';
    return { map: map, start: start, end: end };
  }

  /**
   * 单输入框范围：laydate 按面板类型写；普通可编辑输入框按 placeholder 的格式与分隔符写。
   * @returns {Promise<boolean|null>} null = 不是 / 写不了这种控件（交还主循环按普通字段处理）
   */
  async function fillSingleInputRange(el, profile, seen, bindings) {
    var ctxKey = rangeSectionFor(el);
    if (!ctxKey) return null;
    var idx = seen[ctxKey] || 0;
    var bound = C.boundStructuredField(el, bindings);
    if (bound && bound.reason) return false;
    if (bound && bound.listKey === RANGE_SECTION_MAP[ctxKey].listKey) idx = bound.index;
    var rv = rangeValuesFor(profile, ctxKey, idx);
    if (!rv.start || !rv.end) return null;
    var endOpen = isCurrentJobValue(rv.end);
    var ok = false;
    if (isLaydateInput(el)) {
      if (endOpen) return null;
      var kind = await laydateKind(el);
      if (!kind || !kind.range) return null;
      ok = await fillLaydate(el, rv.start, rv.end);
    } else if (!el.readOnly && !el.disabled) {
      var ph = String(el.getAttribute('placeholder') || '');
      var fmt = D && D.detectFormat ? D.detectFormat(ph) : null;
      var side = function (v) {
        var mo = D.parseModel(v);
        if (!mo || !mo.y || !mo.m) return '';
        return fmt ? D.formatModel(mo, fmt) : (mo.d ? D.toYmd(mo) : D.toYm(mo));
      };
      var a = side(rv.start);
      var b = endOpen ? '至今' : side(rv.end);
      if (!a || !b) return null;
      var sepM = ph.match(/\S\s*(~|至|到|—)\s*\S/);
      var sep = sepM ? ' ' + sepM[1] + ' ' : ' - ';
      ok = await writeAndVerify(el, a + sep + b);
    } else {
      return null;
    }
    seen[ctxKey] = idx + 1;
    if (ok) return { ok: true, map: rv.map, start: rv.start, end: rv.end };
    return false;
  }

  /** 页面上的范围日期控件：按分区/段序取 eduList[i].start/end 等 */
  async function fillRangeEditors(profile, handled, filledKeys, bindings) {
    var rangeSeen = {};
    var editors = Array.prototype.filter.call(C.queryAll(RANGE_EDITOR_SEL), isVisibleEl);
    // antd v3 的 RangePicker 没有专门的范围类名：认 .ant-calendar-range-picker-input 所在的 .ant-calendar-picker
    Array.prototype.forEach.call(C.queryAll('.ant-calendar-range-picker-input'), function (inp) {
      var box = inp.closest('.ant-calendar-picker');
      if (box && editors.indexOf(box) === -1 && isVisibleEl(box)) editors.push(box);
    });
    editors.sort(function (a, b) { return a === b ? 0 : ((a.compareDocumentPosition(b) & 4) ? -1 : 1); });
    var filled = 0;
    for (var i = 0; i < editors.length; i++) {
      var ed = editors[i];
      var inputs = ed.querySelectorAll('input');
      if (inputs.length < 2) continue;
      var alreadyFilled = !!String(inputs[0].value || '').trim() || !!String(inputs[1].value || '').trim();
      if (handled) {
        for (var h = 0; h < inputs.length; h++) handled.add(inputs[h]);
      }
      if (alreadyFilled) continue;
      var ctx = rangeContext(ed) || rangeContextLoose(ed);
      if (!ctx) continue;
      // 没有段序号可读（无 id、无「教育经历-2」标题）时，按同分区里第几个范围控件算
      var seenN = rangeSeen[ctx.rule.key] || 0;
      rangeSeen[ctx.rule.key] = seenN + 1;
      if (!ctx.explicit) ctx.index = seenN;
      var map = RANGE_SECTION_MAP[ctx.rule.key];
      var bound = C.boundStructuredField(inputs[0], bindings);
      if (bound && bound.reason) continue;
      if (bound && bound.listKey === map.listKey) ctx.index = bound.index;
      // 实习分区常常只有 workList（实习写在 workList 里）：listFor 会回落到 workList
      var list = M.listFor(profile, map.listKey);
      var item = list[ctx.index] || null;
      var start = item && item.start ? String(item.start).trim() : '';
      var end = item && item.end ? String(item.end).trim() : '';
      if (!start && ctx.index === 0) start = M.profileValue(profile, map.startKey) || '';
      if (!end && ctx.index === 0) end = M.profileValue(profile, map.endKey) || '';
      if (!start || !end) continue;
      if (!(await fillRangeEditor(ed, start, end))) continue;
      filled += 1;
      [map.startKey, map.endKey].forEach(function (k) {
        if (filledKeys.indexOf(k) === -1) filledKeys.push(k);
      });
      recordFill(inputs[0], map.startKey, start, 'date');
      if (!isCurrentJobValue(end)) {
        recordFill(inputs[1], map.endKey, end, 'date');
        fillRecords[fillRecords.length - 1].noCount = true;   // 一个范围控件只计一次「已填」
      }
    }
    return filled;
  }

  // 导出
  C.RANGE_EDITOR_SEL = RANGE_EDITOR_SEL;
  C.rangeDateOf = rangeDateOf;
  C.formatDateYmd = formatDateYmd;
  C.ymPartial = ymPartial;
  C.fillYearMonthPairs = fillYearMonthPairs;
  C.looksLikeSingleInputRange = looksLikeSingleInputRange;
  C.fillSingleInputRange = fillSingleInputRange;
  C.fillRangeEditors = fillRangeEditors;
})();
