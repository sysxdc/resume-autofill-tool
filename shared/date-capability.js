/**
 * 日期能力层：统一模型 + 精度判级 + 控件探测 + 策略顺序
 *
 * 为什么单独成文件：`content/autofill.js` 里日期逻辑已经堆了 20 多个站点分支
 * （antd v3 日历 / antd v4-v5 面板 / fiber 直写 / Element 网格 / ymd 三下拉 / 滚动轮 /
 * 只读 picker / 弹窗选择器…），每个新站点都是「发现不行 → 再写一个 tryXxx」。
 * 这里把三件与站点无关的事固定下来，页面侧只负责「按顺序试 + 回读」：
 *
 *   1. 统一模型      parseModel('2023-09' | '2023/9/21' | '2023年9月' | '至今') → { y, m, d, precision, open }
 *   2. 精度判级      matchLevel(actualText, model) → exact | day-approx | month-only | mismatch
 *                    （降级必须标注：2023-09 被写成 2023-09-01 是允许的，但要标 day-approx）
 *   3. 控件探测      probeControl(el) → { kind, hints }（纯 DOM 观察，不点击、不写值）
 *   4. 策略顺序      STRATEGY_ORDER（先精确后降级：fiber 直写 → 面板输入框 → 面板导航 →
 *                    键盘选中 → 网格点击），页面侧按它迭代，不再各处硬编码 tryXxx 顺序
 *
 * 浏览器：ResumeAutofillDate；Node：module.exports（供单测与 Playwright 注入）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ResumeAutofillDate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 值里表示「没有终点」的写法 */
  var OPEN_WORDS = /^(至今|迄今|現在|现在|目前|今|present|now|current|till\s*now|to\s*date|n\/?a|无)$/i;

  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? '0' + s : s;
  }

  var EN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  var CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12, 〇: 0 };

  /** 全角数字/标点 → 半角（２０２０年９月、２０２０／０９） */
  function toHalf(s) {
    return String(s).replace(/[！-～]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    }).replace(/　/g, ' ');
  }

  function validDay(y, m, d) {
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return false;
    var dim = new Date(Number(y), m, 0).getDate();
    return !(dim && d > dim);
  }

  function setDay(out, y, m, d) {
    out.y = String(y); out.m = String(m); out.d = String(d); out.precision = 'day';
    return out;
  }

  function setMonth(out, y, m) {
    out.y = String(y); out.m = String(m); out.d = null; out.precision = 'month';
    return out;
  }

  /**
   * 解析成统一模型。
   * v1.5.23 起额外支持：英文月份（Sep 2020 / 15 Sep 2020 / September 15, 2020）、
   * 月/年（09/2020）、紧凑写法（202009 / 20200915）、全角数字、中文月份（2020年九月）、
   * 美式 / 欧式 月日年（9/15/2020、15/09/2020；两个都 ≤12 时按美式并标 ambiguous）。
   * @returns {{y:string|null,m:string|null,d:string|null,precision:'day'|'month'|'open'|'unknown',open:boolean,raw:string,ambiguous?:boolean}}
   */
  function parseModel(value) {
    var raw = String(value == null ? '' : value).trim();
    var out = { y: null, m: null, d: null, precision: 'unknown', open: false, raw: raw };
    if (!raw) return out;
    var half = toHalf(raw);
    if (OPEN_WORDS.test(half.replace(/\s+/g, ''))) {
      out.precision = 'open';
      out.open = true;
      return out;
    }
    // 去掉时间尾巴（2023-09-01T00:00:00 / 2023-09-01 00:00:00）
    var s = half.replace(/[T\s]+\d{1,2}:\d{2}(:\d{2})?.*$/, '');

    // 年月日
    var m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
    if (m) {
      var mm = parseInt(m[2], 10);
      var dd = parseInt(m[3], 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return setDay(out, m[1], mm, dd);
    }
    // 年月
    var ym = s.match(/^\s*(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?\s*$/);
    if (ym) {
      var m2 = parseInt(ym[2], 10);
      if (m2 >= 1 && m2 <= 12) return setMonth(out, ym[1], m2);
    }
    // 紧凑：20200915 / 202009
    var cp = s.match(/^\s*((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])?\s*$/);
    if (cp) {
      if (cp[3] && validDay(cp[1], parseInt(cp[2], 10), parseInt(cp[3], 10))) {
        return setDay(out, cp[1], parseInt(cp[2], 10), parseInt(cp[3], 10));
      }
      if (!cp[3]) return setMonth(out, cp[1], parseInt(cp[2], 10));
    }
    // 中文月份：2020年九月 / 2020年十二月
    var cn = s.match(/^\s*(\d{4})\s*年\s*(十一|十二|十|[一二三四五六七八九])\s*月\s*$/);
    if (cn) return setMonth(out, cn[1], CN_NUM[cn[2]]);
    // 英文月份
    var en = s.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?/);
    var yy = s.match(/\b((?:19|20)\d{2})\b/);
    if (en && yy) {
      var em = EN_MONTHS[en[1]];
      // 日：月份词前后紧挨的 1~2 位数（15 Sep 2020 / Sep 15, 2020 / Sep 15th 2020）
      var rest = s.replace(yy[0], ' ');
      var dm = rest.match(/(?:^|\D)(\d{1,2})(?:st|nd|rd|th)?(?:\D|$)/i);
      if (dm && validDay(yy[1], em, parseInt(dm[1], 10))) return setDay(out, yy[1], em, parseInt(dm[1], 10));
      return setMonth(out, yy[1], em);
    }
    // 月/日/年 或 日/月/年
    var mdy = s.match(/^\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*((?:19|20)\d{2})\s*$/);
    if (mdy) {
      var a = parseInt(mdy[1], 10);
      var b = parseInt(mdy[2], 10);
      if (a > 12 && validDay(mdy[3], b, a)) return setDay(out, mdy[3], b, a);
      if (b > 12 && validDay(mdy[3], a, b)) return setDay(out, mdy[3], a, b);
      if (validDay(mdy[3], a, b)) {
        setDay(out, mdy[3], a, b);
        if (a !== b) out.ambiguous = true;
        return out;
      }
    }
    // 月/年：09/2020
    var my = s.match(/^\s*(\d{1,2})\s*[-/.]\s*((?:19|20)\d{2})\s*$/);
    if (my) {
      var m3 = parseInt(my[1], 10);
      if (m3 >= 1 && m3 <= 12) return setMonth(out, my[2], m3);
    }
    // 只有年
    var yOnly = s.match(/^\s*(\d{4})\s*年?\s*$/);
    if (yOnly) {
      out.y = yOnly[1]; out.precision = 'month';   // 只到年，按「月精度以下」处理
      return out;
    }
    return out;
  }

  /** 期望值里「日」的占位：模型只有年月时，写 1 号是被允许的降级 */
  var DEFAULT_DAY = '1';

  /**
   * 回读值与期望模型的匹配等级。
   *   exact     年月日都对上（期望本身只有年月时，回读也只有年月）
   *   day-approx 期望只有年月，控件只能选到具体某天 → 回读是「同年月 + 补默认日」
   *   month-only 期望有日，控件只给年月 → 日被丢掉（需要标注，通常不该算成功）
   *   mismatch   年或月不一致（真正的错填，红线）
   */
  function matchLevel(actualText, modelOrText) {
    var want = typeof modelOrText === 'string' ? parseModel(modelOrText) : (modelOrText || parseModel(''));
    var got = parseModel(actualText);
    // 回读是「03/04/2021」这种月日都 ≤12 的写法：美式不对就按欧式再判一次
    if (got.ambiguous && want && want.y && want.m) {
      var r1 = matchLevelParsed(got, want);
      if (r1.level !== 'mismatch') return r1;
      var swapped = { y: got.y, m: got.d, d: got.m, precision: 'day', open: false, raw: got.raw };
      return matchLevelParsed(swapped, want);
    }
    return matchLevelParsed(got, want, actualText);
  }

  function matchLevelParsed(got, want, actualText) {
    if (!want || !want.y || !got.y) {
      // 解析不出来就退回文本比较（保守：只有完全相同才算 exact）
      var a = String(actualText == null ? (got && got.raw) || '' : actualText).replace(/\s+/g, '');
      var w = String(want && want.raw ? want.raw : '').replace(/\s+/g, '');
      return { level: a && a === w ? 'exact' : 'mismatch', got: got, want: want };
    }
    if (want.open) {
      // 「至今」：控件通常写成空 / 勾选「至今」/ 取当前年月
      if (!got.y) return { level: 'exact', got: got, want: want };
      return { level: 'mismatch', got: got, want: want };
    }
    if (String(got.y) !== String(want.y)) return { level: 'mismatch', got: got, want: want };
    if (!want.m) return { level: 'month-only', got: got, want: want };
    if (!got.m || parseInt(got.m, 10) !== parseInt(want.m, 10)) return { level: 'mismatch', got: got, want: want };
    if (!want.d) {
      // 期望只到年月：回读也只有年月 → exact；回读带了日 → day-approx（合法降级）
      return { level: got.d ? 'day-approx' : 'exact', got: got, want: want };
    }
    if (!got.d) return { level: 'month-only', got: got, want: want };
    return { level: parseInt(got.d, 10) === parseInt(want.d, 10) ? 'exact' : 'mismatch', got: got, want: want };
  }

  /** 判级是否可接受（mismatch = 红线，必须回滚/留空） */
  function isAcceptable(level) {
    return level === 'exact' || level === 'day-approx';
  }

  /** 把模型折成面板/下拉需要的形式 */
  function toParts(model) {
    // 只有年（连月份都没有）时不可写：控件至少要选到月
    if (!model || !model.y || !model.m) return null;
    return {
      y: String(model.y),
      m: model.m ? String(parseInt(model.m, 10)) : null,
      d: model.d ? String(parseInt(model.d, 10)) : DEFAULT_DAY
    };
  }

  function toYmd(model, sep) {
    var p = toParts(model);
    if (!p) return '';
    var s = sep || '-';
    return p.y + s + pad2(p.m) + s + pad2(p.d);
  }

  function toYm(model, sep) {
    var p = toParts(model);
    if (!p || !p.m) return '';
    return p.y + (sep || '-') + pad2(p.m);
  }

  // ── 格式：从 placeholder / data-format 读出控件要的写法 ─────────────
  // 文本型日期框常要求固定格式（YYYY/MM、yyyy年mm月、MM/DD/YYYY），写成 2020-09 会被校验打回或解析错。
  var FMT_TOKEN_RE = /y{4}|y{2}|m{1,2}|d{1,2}/gi;
  var FMT_PATTERNS = [
    /y{4}[^a-z0-9]{0,2}m{1,2}(?:[^a-z0-9]{0,2}d{1,2})?[月日]?/i,  // Y-M(-D)
    /m{1,2}[^a-z0-9]{1,2}d{1,2}[^a-z0-9]{1,2}y{4}/i,            // M/D/Y
    /d{1,2}[^a-z0-9]{1,2}m{1,2}[^a-z0-9]{1,2}y{4}/i,            // D/M/Y
    /m{1,2}[^a-z0-9]{1,2}y{4}/i                                 // M/Y
  ];

  /**
   * @returns {{template:string, hasDay:boolean}|null}  template 里 {Y}{MM}{M}{DD}{D} 是占位
   */
  function detectFormat(hint) {
    var h = toHalf(String(hint == null ? '' : hint)).trim();
    if (!h) return null;
    var best = null;
    for (var i = 0; i < FMT_PATTERNS.length; i++) {
      var m = h.match(FMT_PATTERNS[i]);
      if (m && (!best || m[0].length > best.length)) best = m[0];
    }
    // dd/mm 两种顺序同时出现（MM/DD/YYYY 里也能找到 DD/MM… 的子串）时，取最长的那个即可
    if (best) {
      // 「mm」在 MDY 里既是月；在 Y-M-D 里也是月：小写 mm 不当分钟用
      var tpl = best.replace(FMT_TOKEN_RE, function (t) {
        var c = t.charAt(0).toLowerCase();
        if (c === 'y') return t.length === 4 ? '{Y}' : '{YY}';
        if (c === 'm') return t.length === 2 ? '{MM}' : '{M}';
        return t.length === 2 ? '{DD}' : '{D}';
      });
      if (tpl.indexOf('{YY}') !== -1) return null;   // 两位年份不写，避免世纪歧义
      return { template: tpl, hasDay: /\{D{1,2}\}/.test(tpl) };
    }
    // 示例式：「例：2020-09」「如 2020.09.01」「2020年09月」
    var ex = h.match(/((?:19|20)\d{2})\s*([-/.年])\s*(\d{1,2})(?:\s*([-/.月])\s*(\d{1,2})\s*(日)?|\s*(月))?/);
    if (ex) {
      var mm = ex[3].length === 2 ? '{MM}' : '{M}';
      if (ex[5] != null) {
        var dd = ex[5].length === 2 ? '{DD}' : '{D}';
        return { template: '{Y}' + ex[2] + mm + ex[4] + dd + (ex[6] || ''), hasDay: true };
      }
      return { template: '{Y}' + ex[2] + mm + (ex[7] || ''), hasDay: false };
    }
    return null;
  }

  /** 按 detectFormat 的模板写日期；模型只有年月而模板要日 → 补 1 号（day-approx，合法降级） */
  function formatModel(model, fmt) {
    var mo = typeof model === 'string' ? parseModel(model) : model;
    if (!fmt || !mo || !mo.y || !mo.m) return '';
    var d = mo.d || DEFAULT_DAY;
    return fmt.template
      .replace('{Y}', String(mo.y))
      .replace('{MM}', pad2(parseInt(mo.m, 10)))
      .replace('{M}', String(parseInt(mo.m, 10)))
      .replace('{DD}', pad2(parseInt(d, 10)))
      .replace('{D}', String(parseInt(d, 10)));
  }

  /** 原生 <input type=date|month|datetime-local> 只认规范写法，写别的会被浏览器清空 */
  function nativeInputValue(type, model) {
    var mo = typeof model === 'string' ? parseModel(model) : model;
    var t = String(type || '').toLowerCase();
    if (!mo || !mo.y || !mo.m) return '';
    if (t === 'date') return toYmd(mo);
    if (t === 'month') return toYm(mo);
    if (t === 'datetime-local') return toYmd(mo) + 'T00:00';
    return '';
  }

  // ── 控件探测（纯观察，不产生副作用）────────────────────────
  var KINDS = {
    NATIVE_DATE: 'native-date',
    NATIVE_SELECT_GROUP: 'native-select-group',
    ANTD_V3_CALENDAR: 'antd-v3-calendar',
    ANTD_PICKER: 'antd-picker',           // v4/v5：.ant-picker + .ant-picker-dropdown
    PANEL_ON_CLICK: 'panel-on-click',      // 自研面板：点击输入框后出现年/月/日表格
    PANEL_ON_FOCUS: 'panel-on-focus',      // focus 才打开（合成 click 无效）
    WHEEL: 'wheel',
    PAGINATED_SELECT: 'paginated-select',
    UNKNOWN: 'unknown'
  };

  function closest(el, sel) {
    try { return el && el.closest ? el.closest(sel) : null; } catch (_) { return null; }
  }

  function hasAncestorClass(el, part) {
    var n = el;
    for (var i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (n.classList && Array.prototype.some.call(n.classList, function (c) { return c.indexOf(part) !== -1; })) return true;
    }
    return false;
  }

  /**
   * 控件类型探测。
   * @param {Element} el 输入框（或宿主）
   * @returns {{kind:string, hints:object}}
   */
  function probeControl(el) {
    var hints = {};
    if (!el || el.nodeType !== 1) return { kind: KINDS.UNKNOWN, hints: hints };
    var tag = el.tagName.toLowerCase();
    var type = String(el.getAttribute && el.getAttribute('type') || '').toLowerCase();

    if (tag === 'input' && type === 'date') return { kind: KINDS.NATIVE_DATE, hints: hints };

    var g = closest(el, '.ant-calendar-picker');
    if (g) {
      hints.antd = 'v3';
      hints.ro = !!el.readOnly;
      return { kind: KINDS.ANTD_V3_CALENDAR, hints: hints };
    }
    var p = closest(el, '.ant-picker');
    if (p) {
      hints.antd = p.querySelector('.ant-picker-range') || /range/.test(String(p.className)) ? 'range' : 'single';
      hints.ro = !!el.readOnly;
      return { kind: KINDS.ANTD_PICKER, hints: hints };
    }

    // 年/月/日 三个原生 select 并列
    var box = closest(el, 'td, .field, .form-item, .ant-form-item, tr, .row') || el.parentElement;
    if (box) {
      var selects = box.querySelectorAll('select');
      if (selects.length >= 2) {
        hints.selects = selects.length;
        return { kind: KINDS.NATIVE_SELECT_GROUP, hints: hints };
      }
    }

    if (hasAncestorClass(el, 'wheel') || hasAncestorClass(el, 'picker-column')) {
      return { kind: KINDS.WHEEL, hints: hints };
    }
    if (hasAncestorClass(el, 'pager') || (el.parentElement && el.parentElement.querySelector && el.parentElement.querySelector('.pager'))) {
      return { kind: KINDS.PAGINATED_SELECT, hints: hints };
    }
    if (el.readOnly) {
      hints.ro = true;
      return { kind: KINDS.PANEL_ON_CLICK, hints: hints };
    }
    return { kind: KINDS.UNKNOWN, hints: hints };
  }

  /**
   * 策略顺序：越靠前越精确、副作用越小。页面侧按序尝试，任一步 matchLevel 达到 exact 就停。
   * 值为策略 id；mismatch 是红线，任何策略产出 mismatch 都必须回滚。
   */
  var STRATEGY_ORDER = [
    'native-input',      // 原生 <input type=date> / 可直接赋值的输入框
    'native-selects',    // 年/月/日 三个原生 select
    'fiber-props',       // React props 直写组件值（antd v4/v5 等受控组件）
    'panel-input',       // 面板自带输入框（antd v3 .ant-calendar-input）
    'panel-nav',         // 面板导航：年视图 → 月视图 → 日格
    'keyboard-pick',     // 下拉键盘选中（ArrowDown 到高亮项 + Enter）
    'grid-click',        // 日历网格点格
    'confirm',           // 补点「确定 / OK」
    'give-up'            // 留空 + 记录 probe
  ];

  return {
    parseModel: parseModel,
    matchLevel: matchLevel,
    isAcceptable: isAcceptable,
    toParts: toParts,
    toYmd: toYmd,
    toYm: toYm,
    probeControl: probeControl,
    STRATEGY_ORDER: STRATEGY_ORDER,
    KINDS: KINDS,
    pad2: pad2,
    toHalf: toHalf,
    detectFormat: detectFormat,
    formatModel: formatModel,
    nativeInputValue: nativeInputValue,
    _internals: { OPEN_WORDS: OPEN_WORDS, DEFAULT_DAY: DEFAULT_DAY }
  };
});
