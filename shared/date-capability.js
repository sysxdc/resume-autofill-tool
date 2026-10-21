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

  /**
   * 解析成统一模型。
   * @returns {{y:string|null,m:string|null,d:string|null,precision:'day'|'month'|'open'|'unknown',open:boolean,raw:string}}
   */
  function parseModel(value) {
    var raw = String(value == null ? '' : value).trim();
    var out = { y: null, m: null, d: null, precision: 'unknown', open: false, raw: raw };
    if (!raw) return out;
    if (OPEN_WORDS.test(raw.replace(/\s+/g, ''))) {
      out.precision = 'open';
      out.open = true;
      return out;
    }
    // 去掉时间尾巴（2023-09-01T00:00:00 / 2023-09-01 00:00:00）
    var s = raw.replace(/[T\s]+\d{1,2}:\d{2}(:\d{2})?.*$/, '');

    // 年月日
    var m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
    if (m) {
      var mm = parseInt(m[2], 10);
      var dd = parseInt(m[3], 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        out.y = m[1]; out.m = String(mm); out.d = String(dd); out.precision = 'day';
        return out;
      }
    }
    // 年月
    var ym = s.match(/^\s*(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?\s*$/);
    if (ym) {
      var m2 = parseInt(ym[2], 10);
      if (m2 >= 1 && m2 <= 12) {
        out.y = ym[1]; out.m = String(m2); out.d = null; out.precision = 'month';
        return out;
      }
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
    if (!want || !want.y || !got.y) {
      // 解析不出来就退回文本比较（保守：只有完全相同才算 exact）
      var a = String(actualText == null ? '' : actualText).replace(/\s+/g, '');
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
    _internals: { OPEN_WORDS: OPEN_WORDS, DEFAULT_DAY: DEFAULT_DAY }
  };
});
