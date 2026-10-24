/**
 * 简历填写工具 · 内容脚本 · 日期控件：年月日三件套、多表格面板、日历网格、只读日期框
 * 由 content/autofill.js 拆出（v1.6.0）。模块之间通过 globalThis.ResumeAutofillContent 共享函数，
 * 加载顺序见 manifest.json content_scripts；排在后面的模块用转发函数引用（调用时才解析）。
 */
(function () {
  'use strict';

  var C = globalThis.ResumeAutofillContent || (globalThis.ResumeAutofillContent = {});
  var D = globalThis.ResumeAutofillDate || null;
  var S = globalThis.ResumeAutofillDateStrategies || null;
  if (!globalThis.ResumeAutofillMatch) return;
  // 重复注入时整个模块跳过：保持和首次加载的编排层用同一套函数 / 本轮状态
  var loaded = C.__loaded || (C.__loaded = {});
  if (loaded['fill/dates']) return;
  loaded['fill/dates'] = true;

  // 依赖（已加载的模块）
  var antdV3Panel = C.antdV3Panel;
  var bridgeCall = C.bridgeCall;
  var isAntdV3Picker = C.isAntdV3Picker;
  var isReadonlyPicker = C.isReadonlyPicker;
  var isVisibleEl = C.isVisibleEl;
  var pickVisibleCandidates = C.pickVisibleCandidates;
  var pickerValueMatches = C.pickerValueMatches;
  var setNativeValue = C.setNativeValue;
  var simulateClick = C.simulateClick;
  var sleep = C.sleep;

  // 依赖（后加载的模块：调用时再取）
  function antdPanel() { return C.antdPanel.apply(this, arguments); }
  function closeAllAntdPanels() { return C.closeAllAntdPanels.apply(this, arguments); }
  function tryAntdPanel() { return C.tryAntdPanel.apply(this, arguments); }

  // ————— v1.3.3：多表格日期面板（年/月/日 分栏）—————

  var lastDateTries = [];

  function parseDateParts(value) {
    if (D && D.parseModel) {
      var mo = D.parseModel(value);
      if (!mo || !mo.y) return null;
      return { y: mo.y, m: mo.m, d: mo.d };
    }
    var str = String(value || '');
    // 完整日期：必须有分隔符，且月/日数值合法
    var m = str.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (m) {
      var mm = parseInt(m[2], 10);
      var dd = parseInt(m[3], 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        return { y: m[1], m: String(mm), d: String(dd) };
      }
    }
    // 只有年月（入学时间 / 毕业时间 这类）
    var ym = str.match(/^\s*(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?\s*$/);
    if (ym) {
      var m2 = parseInt(ym[2], 10);
      if (m2 >= 1 && m2 <= 12) return { y: ym[1], m: String(m2), d: null };
    }
    return null;
  }

  /** 可见的日期面板：先按常见类名找；找不到就按“含年份文本的可见 table/ul”兜底 */
  function findDatePanel(yearText) {
    if (!S) return false;
    return S.findDatePanel(yearText);
  }

  // ————— v1.3.5：年 / 月 / 日 三件套（原生 select 或只读框混合）—————

  function maxOptionNumber(sel) {
    var max = -Infinity;
    if (!sel || !sel.options) return max;
    for (var i = 0; i < sel.options.length; i++) {
      var raw = String(sel.options[i].value !== '' ? sel.options[i].value : sel.options[i].text || '');
      var v = parseInt(raw.replace(/\D/g, ''), 10);
      if (!isNaN(v)) max = Math.max(max, v);
    }
    return max;
  }

  function setSelectByNumber(sel, want) {
    if (!sel || sel.disabled) return false;
    var wantNum = parseInt(want, 10);
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      if (!C.optionEnabled(o)) continue;
      var raw = String(o.value !== '' ? o.value : o.text || '').trim();
      var num = parseInt(raw.replace(/\D/g, ''), 10);
      if (raw === String(want) || (!isNaN(num) && num === wantNum)) {
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  /** 找同组的「年 / 月 / 日」控件；找不到或不确信就返回 null */
  function collectDateGroup(el) {
    var box = el.closest
      ? el.closest('td, tr, .el-form-item, .ant-form-item, .form-item, .field, .form-group, .row, li')
      : null;
    if (!box) box = el.parentElement;
    if (!box) return null;
    var nodes = [];
    Array.prototype.forEach.call(box.querySelectorAll('select, input'), function (n) {
      if (n.disabled) return;
      if (/^(hidden|file|checkbox|radio|submit|button)$/i.test(n.type)) return;
      if (!isVisibleEl(n)) return;
      // 整日期控件（入学时间/毕业时间/请选择日期/RangePicker 两端）不是年/月/日部件
      var ph = String(n.getAttribute('placeholder') || '');
      if (/入学时间|毕业时间|开始时间|结束时间|起始|截止|入职时间|离职时间|请选择日期|yyyy-mm|yyyy年/i.test(ph)) return;
      nodes.push(n);
    });
    if (nodes.length < 2 || nodes.length > 4) return null;

    var parts = {};
    var explicit = { y: false, m: false, d: false };
    var yearSelect = false;
    nodes.forEach(function (n, idx) {
      var hint = [n.name, n.id, n.placeholder, n.getAttribute('aria-label')].join(' ');
      var part = null;
      if (/year|\by\b|年/i.test(hint)) part = 'y';
      else if (/month|\bm\b|月/i.test(hint)) part = 'm';
      else if (/day|\bd\b|日期|日$/i.test(hint)) part = 'd';
      if (part) explicit[part] = true;
      // select 的选项区间也用来判断年/月/日（hint 已命中 year 时同样要置位，否则年月双下拉会被误判非日期组）
      if (n.tagName === 'SELECT') {
        var mx = maxOptionNumber(n);
        if (mx >= 1900) { yearSelect = true; if (!part) part = 'y'; }
        else if (!part && mx <= 12 && n.options.length >= 2) part = 'm';
        else if (!part && mx <= 31 && n.options.length >= 2) part = 'd';
      }
      if (!part) part = ['y', 'm', 'd'][idx] || null;
      if (part && !parts[part]) parts[part] = n;
    });

    // 没有年份的「日期组」一律不认：宁可整组不填，也不要把月/日单独塞进去
    if (!parts.y) return null;
    var has = (parts.m ? 1 : 0) + (parts.d ? 1 : 0);
    if (has < 1) return null;
    // 必须能确认年份身份：年份是 select（选项含 19xx/20xx），或标签明确写了“年”
    if (!yearSelect && !explicit.y) return null;
    return parts;
  }

  /** 按 年/月/日 分别填一组控件；返回 { members, ok } 或 null（不是日期组） */
  async function fillDateGroup(el, desired) {
    var parts = parseDateParts(desired);
    if (!parts) return null;
    var grp = collectDateGroup(el);
    if (!grp) return null;
    var want = { y: parts.y, m: parts.m, d: parts.d };
    var members = [];
    var keys = Object.keys(grp);
    var needY = !!grp.y;
    var needM = !!grp.m && !!want.m;
    var yearOk = false;
    var monthOk = false;
    var dayOk = false;
    // 先只做「能不能填」的预检：年份不存在就别动任何一个控件（避免半截日期）
    if (needY && grp.y.tagName === 'SELECT' && !selectHasNumber(grp.y, want.y)) {
      return { members: keys.map(function (k) { return grp[k]; }), ok: false, reason: 'year_not_available' };
    }
    if (needM && grp.m.tagName === 'SELECT' && !selectHasNumber(grp.m, want.m)) {
      return { members: keys.map(function (k) { return grp[k]; }), ok: false, reason: 'month_not_available' };
    }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var node = grp[k];
      members.push(node);
      if (k === 'd' && !want.d) continue;
      var wantVal = k === 'y' ? want.y : (k === 'm' ? want.m : want.d);
      var okOne = false;
      if (node.tagName === 'SELECT') {
        okOne = setSelectByNumber(node, wantVal) && selectHasNumber(node, wantVal);
      } else if (isReadonlyPicker(node)) {
        okOne = !!(await fillReadonlyPicker(node, wantVal));
      } else {
        okOne = setNativeValue(node, wantVal) && readNumber(node) === parseInt(wantVal, 10);
      }
      if (k === 'y') yearOk = okOne;
      else if (k === 'm') monthOk = okOne;
      else if (k === 'd') dayOk = okOne;
    }
    var ok = (!needY || yearOk) && (!needM || monthOk) && (!grp.d || !want.d || dayOk);
    return { members: members, parts: grp, ok: ok, reason: ok ? '' : 'date_group_incomplete' };
  }

  /** 年 / 月 / 日 三件套合起来回读（单读年份那一格，审计会误判成「只填了年」） */
  function dateGroupReader(grp) {
    return function () {
      if (!grp || !grp.y) return '';
      var y = readNumber(grp.y);
      var m = grp.m ? readNumber(grp.m) : NaN;
      var d = grp.d ? readNumber(grp.d) : NaN;
      if (!y) return '';
      return y + (m ? '-' + m : '') + (m && d ? '-' + d : '');
    };
  }

  function readNumber(node) {
    if (!node) return NaN;
    var raw = node.tagName === 'SELECT'
      ? String(node.options[node.selectedIndex] ? node.options[node.selectedIndex].text : node.value)
      : String(node.value || '');
    return parseInt(String(raw).replace(/\D/g, ''), 10);
  }

  function selectHasNumber(sel, want) {
    if (!sel || sel.tagName !== 'SELECT') return false;
    var wantNum = parseInt(want, 10);
    for (var i = 0; i < sel.options.length; i++) {
      if (!C.optionEnabled(sel.options[i])) continue;
      var raw = String(sel.options[i].value !== '' ? sel.options[i].value : sel.options[i].text || '').trim();
      var num = parseInt(raw.replace(/\D/g, ''), 10);
      if (raw === String(want) || (!isNaN(num) && num === wantNum)) return true;
    }
    return false;
  }

  /** 附近是否还有同组的年/月/日控件（用于 fail-closed：不写碎片） */
  function hasSiblingDateParts(el) {
    var box = el.closest
      ? el.closest('td, tr, .el-form-item, .ant-form-item, .form-item, .field, .form-group, .row, li, label')
      : null;
    if (!box) box = el.parentElement;
    if (!box) return false;
    var nodes = box.querySelectorAll('select, input');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === el) continue;
      var hint = [n.name, n.id, n.placeholder, n.getAttribute('aria-label'), String(n.className || '')].join(' ');
      if (/年|月|日|year|month|day/i.test(hint)) return true;
      if (n.tagName === 'SELECT' && maxOptionNumber(n) >= 1900) return true;
    }
    return false;
  }

  // ————— v1.3.4：日历网格型日期面板（‹‹ ‹ 十月 2026 › ›› + 星期表头 + 单月网格）—————

  function isCalendarGrid(panel) {
    if (!S) return false;
    return S.isCalendarGrid(panel);
  }

  async function tryCalendarGrid(el, desired) {
    return S ? S.fillDate(el, desired, { order: ['grid-click'] }).then(function (r) { return !!r.ok; }) : false;
  }

  /** 依次点 年 → 月 → 日；每步按“分组类型”重新定位（面板常被整体重渲染） */
  async function tryDatePanel(el, desired) {
    return S ? S.fillDate(el, desired, { order: ['panel-nav'] }).then(function (r) { return !!r.ok; }) : false;
  }

  /** 回读值的精度等级：exact / day-approx / month-only / mismatch（能力层缺失时退回布尔） */
  function dateMatchLevel(actual, desired) {
    if (D && D.matchLevel) return D.matchLevel(actual, desired).level;
    var a = parseDateParts(actual);
    var w = parseDateParts(desired);
    if (a && w && a.y === w.y && parseInt(a.m, 10) === parseInt(w.m, 10)) {
      if (!w.d || !a.d) return 'exact';
      return parseInt(a.d, 10) === parseInt(w.d, 10) ? 'exact' : 'mismatch';
    }
    return pickerValueMatches(actual, desired) ? 'exact' : 'mismatch';
  }

  function dateValueMatches(actual, desired) {
    // 零错填是红线（mismatch）；month-only 属于「日被控件吃掉」的降级，仍算填上但在 degraded 里标注
    var lv = dateMatchLevel(actual, desired);
    return lv === 'exact' || lv === 'day-approx' || lv === 'month-only';
  }

  function findPagerNext() {
    var nodes = C.queryAll('a, button, span, div, i, li');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.childElementCount) continue;
      var t = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^(下一页|下页|后一页|next|›|»|>)$/i.test(t)) continue;
      if (!isVisibleEl(n)) continue;
      if (n.disabled || /disabled/i.test(String(n.className || ''))) continue;
      return n;
    }
    return null;
  }

  /** 分页/翻页式下拉：点「下一页」直到出现目标项 */
  async function pageUntilFound(desired) {
    for (var i = 0; i < 20; i++) {
      var next = findPagerNext();
      if (!next) return [];
      simulateClick(next);
      await sleep(260);
      var c = pickVisibleCandidates(desired);
      if (c.length) return c;
    }
    return [];
  }

  /** 打开只读控件的弹层：先 focus（Element 的 el-date-picker 监听 focus），再 click，再点右侧日历图标 */
  function openPicker(el) {
    // antd v3：只认「原生 click」（合成事件它不接）；面板开着时再点会关掉，所以先判重
    if (isAntdV3Picker(el)) {
      try { if (el.focus) el.focus(); } catch (_) { /* ignore */ }
      if (antdV3Panel()) return;
      try { el.click(); } catch (_) { simulateClick(el); }
      return;
    }
    // antd：合成事件打不开日历，直接调它自己的 onMouseDown（等于真点击）
    if (isAntdPickerEl(el)) {
      try { if (el.focus) el.focus(); } catch (_) { /* ignore */ }
      var root = (el.closest && el.closest('.ant-picker, .ant-calendar-picker')) || el;
      var rh = bridgeCall(root, 'reactHandler', { name: 'onMouseDown' });
      if (rh && rh.ok) return;
    }
    try { if (el.focus) el.focus(); } catch (_) { /* ignore */ }
    try {
      el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    } catch (_) { /* 老浏览器不支持 FocusEvent */ }
    // antd 5 的 Picker 监听 pointerdown；其它站点多派发一次会被当成二次点击（开了又关）
    try {
      if (isAntdPickerEl(el) && typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
      }
    } catch (_) { /* ignore */ }
    simulateClick(el);
    var box = el.parentElement;
    if (box) {
      var icon = box.querySelector('i[class*="date"], .el-input__icon, [class*="date-icon"]');
      if (icon) {
        setTimeout(function () { try { simulateClick(icon); } catch (_) { /* ignore */ } }, 140);
      }
    }
  }

  /** 按 data-fmt / placeholder 格式化日期 */
  function formatDateByHint(el, desired) {
    var p = parseDateParts(desired);
    if (!p) return String(desired);
    var fmt = String(el.getAttribute('data-fmt') || el.getAttribute('format') || el.getAttribute('data-format') || '');
    // v1.5.23：统一走能力层的格式识别（含 placeholder 写明的 YYYY/MM、yyyy年mm月、例：2020-09）
    if (D && D.detectFormat) {
      var f2 = D.detectFormat(fmt) || D.detectFormat(el.getAttribute('placeholder') || '');
      if (f2) return D.formatModel(D.parseModel(desired), f2);
    }
    var mm = ('0' + p.m).slice(-2);
    var dd = ('0' + p.d).slice(-2);
    if (/yyyy\/MM\/dd/i.test(fmt)) return p.y + '/' + mm + '/' + dd;
    if (/yyyy年MM月dd日/.test(fmt)) return p.y + '年' + mm + '月' + dd + '日';
    if (/yyyy-MM-dd/i.test(fmt)) return p.y + '-' + mm + '-' + dd;
    if (/yyyy-MM/i.test(fmt)) return p.y + '-' + mm;
    if (/^yyyy$/i.test(fmt)) return p.y;
    return desired;
  }

  /** 最后一招：只读框直接写值（readonly 只挡用户输入，挡不住脚本），并派发 input/change/blur */
  function forceSetReadonly(el, desired) {
    var v = formatDateByHint(el, desired);
    try {
      var desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (desc && desc.set) desc.set.call(el, v);
      else el.value = v;
    } catch (_) {
      el.value = v;
    }
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (_) { /* ignore */ }
    return String(el.value || '').trim() !== '';
  }

  function isAntdPickerEl(el) {
    try { return !!(el && el.closest && el.closest('.ant-picker, .ant-calendar-picker')); } catch (_) { return false; }
  }

  /** 等 antd 弹层真正挂上 DOM（首帧可能还没渲染） */
  function waitForAntdPanel(ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var p = antdPanel() || antdV3Panel();
        if (p) return resolve(p);
        if (Date.now() - t0 > ms) return resolve(null);
        setTimeout(poll, 60);
      })();
    });
  }

  function fillReadonlyPicker(el, desired) {
    return isAntdPickerEl(el) ? fillReadonlyPickerAntd(el, desired) : fillReadonlyPickerLegacy(el, desired);
  }

  /** antd（受控组件）专用：等弹层 → 年/月/日面板 → 不做只读直写 */
  function fillReadonlyPickerAntd(el, desired) {
    var before = String(el.value || '');
    return new Promise(function (resolve) {
      // Escape 关掉上一个弹层后要给它一点时间收尾，否则紧接着的 mousedown 会被吞掉
      closeAllAntdPanels();
      setTimeout(function () { openPicker(el); }, 160);
      setTimeout(async function () {
        try {
        // ⓿ Ant Design 面板：先等弹层挂载再判定年/月/日模式
        var waited = await waitForAntdPanel(900);
        if (!waited) {
          // 二次尝试：上一个下拉关闭时可能抢回焦点，导致首次点击被吞
          closeAllAntdPanels();
          await sleep(260);
          openPicker(el);
          waited = await waitForAntdPanel(1100);
        }
        // 只有 antd 控件才要求弹层；其它站点（Element/自定义面板）走下面的老路径
        if (!waited && isAntdPickerEl(el)) {
          try { el.blur(); } catch (_) { /* ignore */ }
          closeAllAntdPanels();
          resolve(false);
          return;
        }
        var parts = parseDateParts(desired);
        // 面板已打开：按策略层固定顺序试（fiber 直写 → v3 面板 → antd 面板 → 日格 → 通用面板/网格），
        // 每步写完立刻回读判级，exact 即停；顺序由 STRATEGY_ORDER 决定，这里不再硬编码先后。
        if (waited && S && S.fillDate) {
          var res = null;
          try {
            res = await S.fillDate(el, desired, {
              order: ['fiber-props', 'panel-input', 'panel-nav', 'grid-click'],
              budgetMs: 9000
            });
          } catch (_) { res = null; }
          if (res) { lastDateTries.length = 0; Array.prototype.push.apply(lastDateTries, res.attempts || []); }
          if (res && res.ok) { resolve(true); return; }
          // 策略层没搞定：antd 受控组件直写不可靠，重开面板再走候选路径
          openPicker(el);
          await sleep(300);
        }
        var cands = pickVisibleCandidates(desired);
        if (!cands.length) {
          cands = await pageUntilFound(desired);
        }
        if (!cands.length) {
          resolve(isAntdPickerEl(el) ? false : (forceSetReadonly(el, desired) ? 'forced' : false));
          return;
        }
        var i = 0;
        var tryNext = function () {
          if (i >= cands.length) {
            // 全部失败：尽量还原原值，避免留下错值
            if (String(el.value || '') !== before) {
              try { openPicker(el); } catch (_) { /* ignore */ }
            }
            // 最后一招：只读框直写（jQuery 表单可以，antd 受控组件不行）
            resolve(isAntdPickerEl(el) ? false : (forceSetReadonly(el, desired) ? 'forced' : false));
            return;
          }
          simulateClick(cands[i].el);
          i += 1;
          setTimeout(function () {
            if (dateValueMatches(el.value, desired)) { resolve(true); return; }
            // 弹层可能已被关闭，重新打开再试下一个候选
            if (i < cands.length) simulateClick(el);
            setTimeout(tryNext, i < cands.length ? 260 : 0);
          }, 300);
        };
        tryNext();
        } catch (err) {
          // 策略链里任何异常都不许挂死整轮填充（之前少这层，抛错后 resolve 永不调用 → 「正在填写…」卡死）
          try { if (S) lastDateTries.push({ id: 'error', level: String((err && err.message) || err).slice(0, 60) }); } catch (_) { /* ignore */ }
          try { el.blur(); } catch (_) { /* ignore */ }
          try { closeAllAntdPanels(); } catch (_) { /* ignore */ }
          resolve(false);
        }
      }, 640);
    });
  }

  /** 非 antd 站点：沿用 v1.5.3 的原有流程 */
  function fillReadonlyPickerLegacy(el, desired) {
    var before = String(el.value || '');
    openPicker(el);
    return new Promise(function (resolve) {
      setTimeout(async function () {
        // ① 先试「年 / 月 / 日」多表格日期面板
        var parts = parseDateParts(desired);
        // ⓿ Ant Design 面板（年/月/日三种模式）
        var antdOk = await tryAntdPanel(el, desired);
        if (antdOk && dateValueMatches(el.value, desired)) { resolve(true); return; }
        var pid = parts ? findDatePanel(parts.y) : null;
        if (parts && pid) {
          // ② 日历网格（‹‹ ‹ 十月 2026 › ›› + 星期表头）走翻月 + 点日；其余走年/月/日分栏
          var panelOk = isCalendarGrid(pid)
            ? await tryCalendarGrid(el, desired)
            : await tryDatePanel(el, desired);
          if (panelOk && dateValueMatches(el.value, desired)) { resolve(true); return; }
          // 面板路径失败：重开再走普通候选路径
          openPicker(el);
          await sleep(300);
        }
        var cands = pickVisibleCandidates(desired);
        if (!cands.length) {
          cands = await pageUntilFound(desired);
        }
        if (!cands.length) { resolve(forceSetReadonly(el, desired) ? 'forced' : false); return; }
        var i = 0;
        var tryNext = function () {
          if (i >= cands.length) {
            // 全部失败：尽量还原原值，避免留下错值
            if (String(el.value || '') !== before) {
              try { openPicker(el); } catch (_) { /* ignore */ }
            }
            // 最后一招：只读框直写（该站点是 jQuery 表单，保存时读 input.value）
            resolve(forceSetReadonly(el, desired) ? 'forced' : false);
            return;
          }
          simulateClick(cands[i].el);
          i += 1;
          setTimeout(function () {
            if (dateValueMatches(el.value, desired)) { resolve(true); return; }
            // 弹层可能已被关闭，重新打开再试下一个候选
            if (i < cands.length) simulateClick(el);
            setTimeout(tryNext, i < cands.length ? 260 : 0);
          }, 300);
        };
        tryNext();
      }, 420);
    });
  }

  // 导出
  C.lastDateTries = lastDateTries;
  C.parseDateParts = parseDateParts;
  C.fillDateGroup = fillDateGroup;
  C.dateGroupReader = dateGroupReader;
  C.hasSiblingDateParts = hasSiblingDateParts;
  C.dateMatchLevel = dateMatchLevel;
  C.dateValueMatches = dateValueMatches;
  C.openPicker = openPicker;
  C.waitForAntdPanel = waitForAntdPanel;
  C.fillReadonlyPicker = fillReadonlyPicker;
  C.fillReadonlyPickerAntd = fillReadonlyPickerAntd;
})();
