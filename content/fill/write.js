/**
 * 简历填写工具 · 内容脚本 · 写入与回读：页面主环境桥接、受控组件写值、写后回读、填写审计记录
 * 由 content/autofill.js 拆出（v1.6.0）。模块之间通过 globalThis.ResumeAutofillContent 共享函数，
 * 加载顺序见 manifest.json content_scripts；排在后面的模块用转发函数引用（调用时才解析）。
 */
(function () {
  'use strict';

  var C = globalThis.ResumeAutofillContent || (globalThis.ResumeAutofillContent = {});
  var M = globalThis.ResumeAutofillMatch;
  var D = globalThis.ResumeAutofillDate || null;
  if (!globalThis.ResumeAutofillMatch) return;
  // 重复注入时整个模块跳过：保持和首次加载的编排层用同一套函数 / 本轮状态
  var loaded = C.__loaded || (C.__loaded = {});
  if (loaded['fill/write']) return;
  loaded['fill/write'] = true;

  // 依赖（后加载的模块：调用时再取）
  function hostOwnText() { return C.hostOwnText.apply(this, arguments); }
  function parseDateParts() { return C.parseDateParts.apply(this, arguments); }

  /**
   * Element 的 input-number / date-editor 是包装组件：直接写 input.value 不会更新 v-model，
   * 页面一重渲染值就被打回去。这里直接走组件实例的 input 事件（实测有效）。
   */
  // —————— v1.5.24：页面主环境桥接（content/page-bridge.js，manifest world: MAIN）——————
  // 内容脚本在隔离环境里读不到页面挂在 DOM 上的 React fiber / Vue 实例；组件提交统一交给桥接脚本。
  // 同步协议：在目标元素上派发 CustomEvent，桥接在捕获阶段处理完把结果写进 data-ra-bridge-out。
  var BRIDGE_EVT = 'resume-autofill-bridge';
  var BRIDGE_OUT = 'data-ra-bridge-out';

  function bridgeCall(el, op, args) {
    if (!el || typeof el.dispatchEvent !== 'function') return null;
    try {
      el.removeAttribute(BRIDGE_OUT);
      el.dispatchEvent(new CustomEvent(BRIDGE_EVT, {
        bubbles: true, composed: true, detail: JSON.stringify({ op: op, args: args || {} })
      }));
      var raw = el.getAttribute(BRIDGE_OUT);
      if (!raw) return null;     // 桥接没装（老浏览器 / 测试环境）→ 调用方走点击面板的老路
      el.removeAttribute(BRIDGE_OUT);
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function dateArr(d) { return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; }

  /** 把日期（范围给 e）交给组件自己的提交入口：antd 3/4/5、Element UI、Element Plus、ant-design-vue */
  function bridgeDateCommit(el, s, e) {
    if (!s) return false;
    var r = bridgeCall(el, 'dateCommit', { s: dateArr(s), e: e ? dateArr(e) : null });
    return !!(r && r.ok);
  }

  /**
   * Element 的 input-number / date-editor 是包装组件：直接写 input.value 不会更新 v-model，
   * 页面一重渲染值就被打回去。这里交给组件实例（Vue 2 的 emitInput / Vue 3 的 onUpdate:modelValue）。
   */
  function commitFrameworkWidget(el, value) {
    if (!el || !el.closest) return false;
    if (el.closest('.el-input-number')) {
      var raw = String(value == null ? '' : value).trim();
      var n = Number(raw.replace(/[^\d.\-]/g, ''));
      if (raw && isFinite(n)) {
        var rn = bridgeCall(el, 'numberCommit', { n: n });
        if (rn && rn.ok) return true;
      }
    }
    if (el.closest('.el-date-editor') && !el.closest('.el-range-editor')) {
      var parts = parseDateParts(value);
      if (!parts) return false;
      var d = new Date(parseInt(parts.y, 10), parseInt(parts.m, 10) - 1, parts.d ? parseInt(parts.d, 10) : 1);
      return bridgeDateCommit(el, d, null);
    }
    return false;
  }

  function setNativeValue(el, value) {
    if (el.disabled || el.readOnly) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      var opts = Array.from(el.options).map(function (o) {
        return { value: o.value, text: o.text };
      });
      var matched = M.matchSelectOption(opts, value);
      if (!matched) return false;
      el.value = matched.value;
      // 同 value 的选项有多个 / value 为空时，el.value 赋值可能落不到目标项：按下标再落一次
      if (el.value !== matched.value || (el.options[el.selectedIndex] || {}).text !== matched.text) {
        for (var si = 0; si < el.options.length; si++) {
          if (el.options[si].value === matched.value && el.options[si].text === matched.text) { el.selectedIndex = si; break; }
        }
      }
      if (el.value !== matched.value) return false;
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      return false;
    } else {
      var proto =
        tag === 'textarea'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      var setter = desc && desc.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  // —————— v1.5.23：写入必须回读确认（杜绝「点了 / 写了，但页面上没有」）——————

  /** 等框架把这次事件处理完（React 18 / Vue 的重渲染都排在微任务里） */
  function settle() {
    return Promise.resolve().then(function () { return null; }).then(function () { return null; });
  }

  /**
   * 回读值与期望是否一致：允许格式化差异（空格 / 分隔符 / 大小写 / 手机号掩码 / 日期写法），
   * 不允许内容差异（被截断、被清空、被改成别的值）。
   */
  function writtenValueMatches(actual, want) {
    var a = String(actual == null ? '' : actual).trim();
    var w = String(want == null ? '' : want).trim();
    if (a === w) return true;
    if (!a || !w) return false;
    var squash = function (t) { return t.replace(/[\s\u00a0,，\-_/.:：()（）]/g, '').toLowerCase(); };
    if (squash(a) === squash(w)) return true;
    // 数字被格式化：15000 → 15,000.00 / ¥15,000
    if (/^[\s\d,.¥$€+-]+$/.test(w) && /\d/.test(w)) {
      var nA = parseFloat(a.replace(/[^\d.\-]/g, ''));
      var nW = parseFloat(w.replace(/[^\d.\-]/g, ''));
      if (isFinite(nA) && isFinite(nW) && nA === nW) return true;
    }
    // 掩码 / 区号：「+86 138 0013 8000」包含「13800138000」的全部数字
    var da = a.replace(/\D/g, '');
    var dw = w.replace(/\D/g, '');
    if (dw.length >= 6 && da.length >= dw.length && da.slice(da.length - dw.length) === dw &&
        squash(a).replace(/\d/g, '').replace(/^\+/, '') === squash(w).replace(/\d/g, '')) return true;
    if (D && D.parseModel) {
      var mw = D.parseModel(w);
      if (mw && mw.y && mw.m) {
        var lv = D.matchLevel(a, mw).level;
        return lv === 'exact' || lv === 'day-approx' || lv === 'month-only';
      }
    }
    return false;
  }

  function rawSetValue(el, v) {
    var proto = el.tagName.toLowerCase() === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, v);
    else el.value = v;
  }

  /** 重试 1：浏览器自己生成的输入（execCommand insertText）——受控组件最认这条路 */
  function retryInsertText(el, value) {
    if (typeof document.execCommand !== 'function') return false;
    try {
      el.focus();
      // execCommand 写进的是「当前焦点」：焦点没落到目标上（被遮挡 / 不可聚焦）就绝不能执行，否则会写进别的字段
      if (document.activeElement !== el) return false;
      if (typeof el.select === 'function') el.select();
      var ok = document.execCommand('insertText', false, String(value));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return !!ok;
    } catch (_) { return false; }
  }

  /** 重试 2：逐字键入（监听 keydown / keyup / beforeinput 才更新的组件） */
  function typeLikeUser(el, value) {
    try {
      el.focus();
      try { el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); } catch (_) { /* ignore */ }
      rawSetValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      var text = String(value);
      var acc = '';
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
        try { el.dispatchEvent(new InputEvent('beforeinput', { data: ch, inputType: 'insertText', bubbles: true, cancelable: true })); } catch (_) { /* ignore */ }
        acc += ch;
        rawSetValue(el, acc);
        try {
          el.dispatchEvent(new InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true }));
        } catch (_) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      try { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); } catch (_) { /* ignore */ }
      return true;
    } catch (_) { return false; }
  }

  function restoreValue(el, before) {
    try {
      rawSetValue(el, before);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) { /* ignore */ }
  }

  /**
   * 值超过 maxlength：长文本（自我评价 / 工作描述）在句末截断；短值（证件号 / 电话 / 姓名）返回 ''（跳过）。
   */
  function fitToMaxLength(value, maxLen) {
    var v = String(value == null ? '' : value);
    if (!maxLen || v.length <= maxLen) return v;
    if (v.length <= 40 || maxLen < 20) return '';
    var head = v.slice(0, maxLen);
    var cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'),
      head.lastIndexOf('；'), head.lastIndexOf('\n'), head.lastIndexOf('. '), head.lastIndexOf('; '));
    if (cut >= maxLen * 0.5) return head.slice(0, cut + 1).trim();
    return head;
  }

  /**
   * 写入 + 回读确认。写不进去依次重试 execCommand / 逐字键入；
   * 最后仍对不上（被清空、被截断、被改成别的）→ 还原原值并返回 false，让字段出现在「未填」清单里。
   */
  async function writeAndVerify(el, value) {
    var tag = el.tagName.toLowerCase();
    var before = String(el.value || '');
    if (tag === 'select') {
      if (!setNativeValue(el, value)) return false;
      var want = el.value;
      await settle();
      return el.value === want && el.selectedIndex >= 0;
    }
    if (!setNativeValue(el, value)) return false;
    await settle();
    if (writtenValueMatches(el.value, value)) return true;
    if (retryInsertText(el, value)) {
      await settle();
      if (writtenValueMatches(el.value, value)) return true;
    }
    if (String(value).length <= 120 && typeLikeUser(el, value)) {
      await settle();
      if (writtenValueMatches(el.value, value)) return true;
    }
    if (String(el.value || '') !== before) restoreValue(el, before);
    return false;
  }

  /**
   * 日期写进普通输入框前按控件要求的格式转换：
   *   <input type=date|month|datetime-local> → 规范写法（否则浏览器直接清空）
   *   placeholder / data-format 写明格式（YYYY/MM、yyyy年mm月、MM/DD/YYYY、例：2020-09）→ 按格式写
   * 返回 null 表示不是日期场景（原样写）；返回 '' 表示是日期框但这个值写不进去（跳过）。
   */
  function dateValueForInput(el, value) {
    if (!D || !D.parseModel || !el || el.tagName.toLowerCase() !== 'input') return null;
    var type = String(el.type || '').toLowerCase();
    var mo = D.parseModel(value);
    if (type === 'date' || type === 'month' || type === 'datetime-local') {
      return D.nativeInputValue ? D.nativeInputValue(type, mo) : '';
    }
    if (!mo || !mo.y || !mo.m || !D.detectFormat) return null;
    var fmt = D.detectFormat(el.getAttribute('data-format') || el.getAttribute('format') || '') ||
      D.detectFormat(el.getAttribute('placeholder') || '');
    if (!fmt) return null;
    return D.formatModel(mo, fmt) || null;
  }

  function highlight(el) {
    el.style.outline = '2px solid #22c55e';
    setTimeout(function () {
      el.style.outline = '';
    }, 2000);
  }

  // 填写审计：记下每次「以为填上了」的元素与期望值，整轮结束后回读核对
  // （这几轮最常见的失败不是填错内容，而是以为填上了其实没进去：值进了搜索框、
  //   点 li 不提交、受控组件重渲染把值吞掉。审计是唯一能抓住它的本地手段。）
  var fillRecords = [];

  // 每轮填写内已处理过的字段块 / 联动下拉（主循环跑两遍，第二遍不能再重复计数）
  var runDone = { ym: null, chain: null };
  function resetRunDone() {
    var ok = typeof WeakSet === 'function';
    runDone.ym = ok ? new WeakSet() : null;
    runDone.chain = ok ? new WeakSet() : null;
  }

  function recordFill(el, key, expected, kind, read) {
    try {
      fillRecords.push({
        el: el,
        read: typeof read === 'function' ? read : null,
        key: String(key || ''),
        label: String((el && (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'))) ) || ''),
        expected: String(expected == null ? '' : expected),
        kind: String(kind || '')
      });
    } catch (_) { /* ignore */ }
  }

  /** 回读一个控件当前显示的值（覆盖 input / textarea / select / antd 宿主 / 单选组） */
  function readBackValue(el) {
    if (!el || el.nodeType !== 1) return '';
    var tag = String(el.tagName || '').toLowerCase();
    try {
      if (tag === 'select') {
        var opt = el.options && el.options[el.selectedIndex];
        return opt ? String(opt.textContent || opt.text || opt.value || '').trim() : '';
      }
      if (tag === 'input' || tag === 'textarea') {
        var t = String(el.getAttribute('type') || 'text').toLowerCase();
        if (t === 'radio' || t === 'checkbox') {
          var lab = el.closest && el.closest('label');
          return el.checked ? String((lab && lab.textContent) || el.value || '').replace(/\s+/g, ' ').trim() : '';
        }
        return String(el.value || '').trim();
      }
      // 自定义下拉宿主
      var shown = el.querySelector('.phoenix-select__tipEle, .ant-select-selection-selected-value, .ant-select-selection-item, .el-select__selected-item:not(.el-select__input-wrapper):not(.is-transparent), .selected-text');
      if (shown) return String(shown.textContent || '').replace(/\s+/g, ' ').trim();
      var inner = el.querySelector('input.ant-input, input[type="text"]');
      if (inner && String(inner.value || '').trim()) return String(inner.value || '').trim();
      return hostOwnText(el).slice(0, 60);
    } catch (_) { return ''; }
  }

  /** 整轮填写后核对：期望值 vs 页面真实值 */
  function runFillAudit() {
    var A = globalThis.ResumeAutofillAudit;
    if (!A || !fillRecords.length) return null;
    try {
      var entries = fillRecords.map(function (r) {
        var actual = '';
        try { actual = r.read ? String(r.read() || '') : readBackValue(r.el); } catch (_) { actual = ''; }
        return { key: r.key, label: r.label, expected: r.expected, actual: actual, kind: r.kind };
      });
      return A.auditEntries(entries, { ignoreEmpty: false });
    } catch (_) { return null; }
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // 导出
  C.bridgeCall = bridgeCall;
  C.bridgeDateCommit = bridgeDateCommit;
  C.commitFrameworkWidget = commitFrameworkWidget;
  C.setNativeValue = setNativeValue;
  C.settle = settle;
  C.writtenValueMatches = writtenValueMatches;
  C.rawSetValue = rawSetValue;
  C.fitToMaxLength = fitToMaxLength;
  C.writeAndVerify = writeAndVerify;
  C.dateValueForInput = dateValueForInput;
  C.highlight = highlight;
  C.fillRecords = fillRecords;
  C.runDone = runDone;
  C.resetRunDone = resetRunDone;
  C.recordFill = recordFill;
  C.readBackValue = readBackValue;
  C.runFillAudit = runFillAudit;
  C.sleep = sleep;
})();
