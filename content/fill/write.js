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
   * 比较遵循字段类型，不接受标点丢失、截断或精度不足。
   */
  function writtenValueMatches(actual, want, options) {
    var a = String(actual == null ? '' : actual).trim();
    var w = String(want == null ? '' : want).trim();
    if (a === w) return true;
    if (!a || !w) return false;
    var A = globalThis.ResumeAutofillAudit;
    var opts = typeof options === 'string' ? { key: options } : (options || {});
    return !!(A && A.compareEntry({ key: opts.key || '', kind: opts.kind || '', expected: w, actual: a }).accepted);
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
   * 仍对不上返回 false；新出现的不同非空值保留供核对，避免覆盖页面异步回填。
   */
  async function writeAndVerify(el, value, options) {
    var opts = options || {};
    var tag = el.tagName.toLowerCase();
    var before = String(el.value || '');
    var comparison = { key: opts.key || '', kind: opts.kind || (/^(number|email|tel|date|month)$/.test(el.type || '') ? (/^(date|month)$/.test(el.type) ? 'date' : el.type) : '') };
    var hasValue = C.fieldLooksFilled ? C.fieldLooksFilled(el) : !!before.trim();
    if (el.disabled || el.readOnly || el.isConnected === false) return false;
    if (hasValue && !opts.overwrite) return writtenValueMatches(before, value, comparison);
    if (el.maxLength > 0 && String(value).length > el.maxLength) return false;
    if (el.type === 'number' && !/^[+-]?\d+(?:\.\d+)?$/.test(String(value).trim())) return false;
    if (tag === 'select') {
      if (!setNativeValue(el, value)) return false;
      var want = el.value;
      await settle();
      return el.value === want && el.selectedIndex >= 0;
    }
    var userEdited = false;
    var performingWrite = false;
    function onUserInput(event) { if (event.isTrusted && !performingWrite) userEdited = true; }
    function ownWrite(fn) {
      performingWrite = true;
      try { return fn(); } finally { performingWrite = false; }
    }
    el.addEventListener('input', onUserInput);
    try {
      if (!ownWrite(function () { return setNativeValue(el, value); })) return false;
      await settle();
      if (userEdited || el.isConnected === false) return false;
      if (String(el.value || '').trim() && el.validity && !el.validity.valid) { restoreValue(el, before); return false; }
      if (writtenValueMatches(el.value, value, comparison)) return true;
      // 新的非空值可能来自页面异步回填；不继续覆盖，也不还原成旧值。
      if (String(el.value || '').trim()) return false;
      if (ownWrite(function () { return retryInsertText(el, value); })) {
        await settle();
        if (userEdited || el.isConnected === false) return false;
        if ((!el.validity || el.validity.valid) && writtenValueMatches(el.value, value, comparison)) return true;
        if (String(el.value || '').trim()) return false;
      }
      if (String(value).length <= 120 && ownWrite(function () { return typeLikeUser(el, value); })) {
        await settle();
        if (userEdited || el.isConnected === false) return false;
        if ((!el.validity || el.validity.valid) && writtenValueMatches(el.value, value, comparison)) return true;
      }
      if (!userEdited && String(el.value || '') === String(value)) restoreValue(el, before);
      return false;
    } finally { el.removeEventListener('input', onUserInput); }
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
        label: String((C.getLabelText && C.getLabelText(el)) || (el && el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'))) || key || ''),
        expected: String(expected == null ? '' : expected),
        kind: String(kind || '')
      });
    } catch (_) { /* ignore */ }
  }

  /** 回读一个控件当前显示的值（覆盖 input / textarea / select / antd 宿主 / 单选组） */
  function readBackValue(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.isContentEditable) return String(el.innerText || '').trim();
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
      if (C.ariaCombobox && C.ariaCombobox(el)) return C.ariaSelectionText(el);
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
        try { if (!r.el || r.el.isConnected !== false) actual = r.read ? String(r.read() || '') : readBackValue(r.el); } catch (_) { actual = ''; }
        return { key: r.key, label: r.label, expected: r.expected, actual: actual, kind: r.kind };
      });
      var audit = A.auditEntries(entries, { ignoreEmpty: false });
      audit.entries.forEach(function (entry, index) {
        var el = fillRecords[index].el;
        if (!el || !el.validity || el.validity.valid || !entry.accepted) return;
        if (entry.status === 'ok') audit.ok -= 1;
        else audit.approx -= 1;
        audit.verified -= 1;
        audit.mismatch += 1;
        entry.status = 'mismatch'; entry.accepted = false; entry.level = 'constraint-invalid';
        if (audit.problems.indexOf(entry) < 0) audit.problems.push(entry);
      });
      audit.wrongFill = audit.mismatch;
      audit.okAll = audit.mismatch === 0 && audit.empty === 0 && audit.needsReview === 0;
      return audit;
    } catch (_) { return null; }
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function writeRichText(el, value, key) {
    if (!el || !el.isContentEditable || !el.isConnected || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true') return false;
    var before = readBackValue(el);
    if (before) return writtenValueMatches(before,value,key);
    el.focus();
    if (el.ownerDocument.activeElement !== el) return false;
    var selection = el.ownerDocument.getSelection(), range = el.ownerDocument.createRange();
    if (!selection) return false;
    range.selectNodeContents(el); selection.removeAllRanges(); selection.addRange(range);
    var inserted = false;
    try {
      inserted = true;
      var lines = String(value).split(/\r?\n/);
      for (var i = 0; i < lines.length && inserted; i++) {
        if (i) inserted = el.ownerDocument.execCommand('insertLineBreak',false);
        if (inserted && lines[i]) inserted = el.ownerDocument.execCommand('insertText',false,lines[i]);
      }
    } catch (_) { inserted = false; }
    if (!inserted) {
      el.textContent = String(value);
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));
    }
    el.dispatchEvent(new Event('change',{bubbles:true})); el.blur();
    await sleep(80);
    return el.isConnected && writtenValueMatches(readBackValue(el),value,key);
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
  C.writeRichText = writeRichText;
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
