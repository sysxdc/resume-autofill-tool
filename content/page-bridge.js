/**
 * 页面主环境桥接（manifest 里以 "world": "MAIN" 注入）。
 *
 * 为什么需要它：内容脚本（content/autofill.js）跑在 Chrome 的「隔离环境」里，和页面共享 DOM，
 * 但看不到页面 JS 挂在 DOM 节点上的东西——React 的 __reactFiber$ / __reactProps$、Vue 2 的 __vue__、
 * Vue 3 的 _vnode / __vue_app__ 全都读不到。所以「直接调组件 onChange / v-model」这条路
 * 在真实扩展里从来没生效过（只在把脚本注入页面的测试里有效），日期控件只能退回去点面板：
 * 慢（每个 4~9 秒，整表超时）、点不准（起止时间、月份面板），还会把值点进别的控件。
 *
 * 协议（同步）：隔离侧在目标元素上 dispatch CustomEvent('resume-autofill-bridge', { detail: JSON 字符串 })，
 * 这里在 window 捕获阶段同步处理，把结果 JSON 写到目标元素的 data-ra-bridge-out 属性，隔离侧读完即删。
 * 只做「把一个日期 / 数字交给组件自己的提交入口」，不读取、不保存任何简历数据。
 *
 * 也可被 Node / Playwright 测试直接注入页面（与扩展里的 MAIN world 等价）。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__resumeAutofillBridge) return;
  try {
    Object.defineProperty(window, '__resumeAutofillBridge', { value: 1, enumerable: false });
  } catch (_) { window.__resumeAutofillBridge = 1; }

  var EVT = 'resume-autofill-bridge';
  var OUT = 'data-ra-bridge-out';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function dateOf(a) {
    if (!a || !a[0]) return null;
    return new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2] || 1));
  }

  function ymd(d, monthOnly) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + (monthOnly ? '' : '-' + pad2(d.getDate()));
  }

  /** 按 valueFormat（dayjs / moment / Element 的 yyyy-MM-dd 都行）把 Date 写成字符串 */
  function formatBy(fmt, d) {
    var f = String(fmt || '');
    if (!f) return null;
    if (f === 'x') return d.getTime();
    if (f === 'X') return Math.floor(d.getTime() / 1000);
    return f
      .replace(/YYYY|yyyy/g, String(d.getFullYear()))
      .replace(/MM/g, pad2(d.getMonth() + 1))
      .replace(/DD|dd/g, pad2(d.getDate()))
      .replace(/(^|[^A-Za-z])M(?![A-Za-z])/g, '$1' + (d.getMonth() + 1))
      .replace(/(^|[^A-Za-z])[Dd](?![A-Za-z])/g, '$1' + d.getDate());
  }

  // ── React ───────────────────────────────────────────────
  function fiberOfNode(node) {
    if (!node) return null;
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0) return node[k];
    }
    return null;
  }

  function reactPropsOf(node) {
    if (!node) return null;
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf('__reactProps$') === 0 || k.indexOf('__reactEventHandlers$') === 0) {
        var p = node[k];
        if (p && typeof p === 'object') return p;
      }
    }
    return null;
  }

  /**
   * 最外层带 generateConfig + onChange 的 fiber（antd 4 / 5 的 rc-picker）。
   * antd 5 里两层都带：内层 SinglePicker 的 onChange 只改输入框文字、不通知表单；外层才是表单的入口。
   */
  function pickerFiberProps(el) {
    var fiber = fiberOfNode(el);
    var hit = null;
    for (var i = 0; i < 30 && fiber; i++, fiber = fiber.return) {
      var p = fiber.memoizedProps;
      if (p && p.generateConfig && typeof p.onChange === 'function') hit = p;
    }
    return hit;
  }

  function makePickerDate(gc, d) {
    var out = gc.setYear(gc.getNow(), d.getFullYear());
    out = gc.setDate(out, 1);
    out = gc.setMonth(out, d.getMonth());
    out = gc.setDate(out, d.getDate());
    return out;
  }

  function reactGcCommit(el, s, e) {
    var props = pickerFiberProps(el);
    if (!props) return false;
    var gc = props.generateConfig;
    var monthOnly = props.picker === 'month';
    if (e) props.onChange([makePickerDate(gc, s), makePickerDate(gc, e)], [ymd(s, monthOnly), ymd(e, monthOnly)]);
    else props.onChange(makePickerDate(gc, s), ymd(s, monthOnly));
    return true;
  }

  /** antd 3（rc-calendar）：组件实例的 handleChange（点完面板走的就是它），moment 从实例状态里 clone */
  function antd3Commit(el, s, e) {
    var fiber = fiberOfNode(el);
    var inst = null;
    for (var i = 0; i < 14 && fiber; i++, fiber = fiber.return) {
      var sn = fiber.stateNode;
      if (sn && typeof sn === 'object' && !sn.nodeType && typeof sn.handleChange === 'function' && sn.state &&
          ('showDate' in sn.state || 'value' in sn.state)) { inst = sn; break; }
    }
    if (!inst) return false;
    var seed = null;
    var st = inst.state || {};
    [].concat(st.showDate, st.value, inst.props && inst.props.defaultPickerValue).some(function (v) {
      if (v && v._isAMomentObject && typeof v.clone === 'function') { seed = v; return true; }
      return false;
    });
    if (!seed && typeof window.moment === 'function') seed = window.moment();
    if (!seed) return false;
    var m = function (d) { return seed.clone().startOf('day').date(1).year(d.getFullYear()).month(d.getMonth()).date(d.getDate()); };
    var isRange = typeof inst.handleRangeClick === 'function' || Array.isArray(st.showDate) || Array.isArray(st.hoverValue);
    if (isRange) {
      if (!e) return false;
      inst.handleChange([m(s), m(e)]);
    } else {
      inst.handleChange(m(s));
    }
    return true;
  }

  // ── Vue 2 ───────────────────────────────────────────────
  function vue2Vm(el) {
    for (var n = el, i = 0; n && i < 8; n = n.parentElement, i++) {
      if (n.__vue__) return n.__vue__;
    }
    return null;
  }

  /** Element UI 的日期组件：带 emitInput（会按 value-format 转换）的那个实例 */
  function vue2DateCommit(el, s, e) {
    var vm = vue2Vm(el);
    for (var i = 0; i < 5 && vm; i++, vm = vm.$parent) {
      if (typeof vm.emitInput === 'function' && ('pickerVisible' in vm || 'valueFormat' in vm || vm.type)) {
        var val = e ? [s, e] : s;
        vm.emitInput(val);
        if (typeof vm.emitChange === 'function') {
          try { vm.emitChange(typeof vm.formatToValue === 'function' ? vm.formatToValue(val) : val); } catch (_) { /* ignore */ }
        }
        return true;
      }
    }
    return false;
  }

  function vue2NumberCommit(el, n) {
    var vm = vue2Vm(el);
    for (var i = 0; i < 4 && vm; i++, vm = vm.$parent) {
      var name = (vm.$options && vm.$options.name) || '';
      if (/InputNumber/i.test(name)) {
        vm.$emit('input', n);
        vm.$emit('change', n);
        return true;
      }
    }
    return false;
  }

  // ── Vue 3 ───────────────────────────────────────────────
  /**
   * 目标节点所在的组件链（根 → 最深）。生产构建 DOM 上没有 __vueParentComponent，
   * 只能从挂载容器的 _vnode 往下找 el === 目标 的节点。
   */
  function vue3Chain(target) {
    if (target.__vueParentComponent) {
      var dev = [];
      for (var c = target.__vueParentComponent; c && dev.length < 60; c = c.parent) dev.unshift(c);
      return dev;
    }
    var host = target;
    while (host && !(host.__vue_app__ && host._vnode)) host = host.parentElement;
    if (!host) return null;
    var found = null;
    var seen = 0;
    var visit = function (vnode, chain) {
      if (!vnode || found || ++seen > 30000) return;
      if (vnode.component) { visit(vnode.component.subTree, chain.concat([vnode.component])); return; }
      if (vnode.el === target) { found = chain; return; }
      if (typeof vnode.type === 'string' && vnode.el && vnode.el.nodeType === 1 && !vnode.el.contains(target)) return;
      var ch = vnode.children;
      if (Array.isArray(ch)) for (var i = 0; i < ch.length && !found; i++) visit(ch[i], chain);
      if (vnode.suspense && vnode.suspense.activeBranch) visit(vnode.suspense.activeBranch, chain);
    };
    visit(host._vnode, []);
    return found;
  }

  function compName(inst) {
    var t = (inst && inst.type) || {};
    return String(t.name || t.__name || '');
  }

  function vue3DateCommit(el, s, e) {
    var chain = vue3Chain(el);
    if (!chain) return false;
    for (var i = chain.length - 1; i >= 0; i--) {
      var inst = chain[i];
      var name = compName(inst);
      var props = inst.props || {};
      var vp = (inst.vnode && inst.vnode.props) || {};
      var monthOnly = /month/i.test(String(props.picker || props.type || ''));
      // ant-design-vue（vc-picker）：内层 Picker 的 onChange = 外层「按 valueFormat 转换 + emit + 通知表单校验」
      if (props.generateConfig && typeof vp.onChange === 'function' && /Picker/i.test(name)) {
        var gc = props.generateConfig;
        if (e) vp.onChange([makePickerDate(gc, s), makePickerDate(gc, e)], [ymd(s, monthOnly), ymd(e, monthOnly)]);
        else vp.onChange(makePickerDate(gc, s), ymd(s, monthOnly));
        return true;
      }
      // Element Plus：ElDatePicker 的 v-model
      if (/DatePicker|TimePicker/i.test(name)) {
        var fn = vp['onUpdate:modelValue'] || vp['onUpdate:value'];
        if (typeof fn !== 'function') continue;
        var vf = props.valueFormat;
        var conv = function (d) { var f = formatBy(vf, d); return f == null ? d : f; };
        var val = e ? [conv(s), conv(e)] : conv(s);
        fn(val);
        if (typeof vp.onChange === 'function') { try { vp.onChange(val); } catch (_) { /* ignore */ } }
        return true;
      }
    }
    return false;
  }

  function vue3NumberCommit(el, n) {
    var chain = vue3Chain(el);
    if (!chain) return false;
    for (var i = chain.length - 1; i >= 0; i--) {
      var vp = (chain[i].vnode && chain[i].vnode.props) || {};
      var fn = vp['onUpdate:modelValue'] || vp['onUpdate:value'];
      if (/InputNumber/i.test(compName(chain[i])) && typeof fn === 'function') {
        fn(n);
        if (typeof vp.onChange === 'function') { try { vp.onChange(n); } catch (_) { /* ignore */ } }
        return true;
      }
    }
    return false;
  }

  // ── 分发 ────────────────────────────────────────────────
  function handle(el, op, args) {
    if (op === 'ping') return { ok: true, v: 1 };
    if (op === 'dateCommit') {
      var s = dateOf(args.s);
      var e = args.e ? dateOf(args.e) : null;
      if (!s) return { ok: false, err: 'no date' };
      if (el.closest && el.closest('.ant-calendar-picker') && antd3Commit(el, s, e)) return { ok: true, via: 'antd3' };
      if (reactGcCommit(el, s, e)) return { ok: true, via: 'react-picker' };
      if (vue2DateCommit(el, s, e)) return { ok: true, via: 'vue2' };
      if (vue3DateCommit(el, s, e)) return { ok: true, via: 'vue3' };
      return { ok: false, err: 'no component' };
    }
    if (op === 'numberCommit') {
      var n = Number(args.n);
      if (!isFinite(n)) return { ok: false };
      if (vue2NumberCommit(el, n)) return { ok: true, via: 'vue2' };
      if (vue3NumberCommit(el, n)) return { ok: true, via: 'vue3' };
      return { ok: false };
    }
    if (op === 'reactHandler') {
      // antd 的 Picker 只在「真点击」的 mousedown 里 open()，合成事件不认；调它注册的 handler 等价于真点击
      var props = reactPropsOf(el);
      var h = props && props[args.name];
      if (typeof h !== 'function') return { ok: false };
      h({
        bubbles: true, cancelable: true, target: el, currentTarget: el, nativeEvent: {},
        preventDefault: function () {}, stopPropagation: function () {},
        isDefaultPrevented: function () { return false; }, isPropagationStopped: function () { return false; },
        persist: function () {}
      });
      return { ok: true };
    }
    return { ok: false, err: 'unknown op' };
  }

  window.addEventListener(EVT, function (ev) {
    var el = ev.target;
    if (!el || el.nodeType !== 1) return;
    var req = null;
    try { req = JSON.parse(String(ev.detail || '')); } catch (_) { return; }
    if (!req || !req.op) return;
    var res;
    try { res = handle(el, req.op, req.args || {}) || { ok: false }; } catch (err) {
      res = { ok: false, err: String((err && err.message) || err).slice(0, 120) };
    }
    try { el.setAttribute(OUT, JSON.stringify(res)); } catch (_) { /* ignore */ }
    ev.stopImmediatePropagation();
  }, true);
})();
