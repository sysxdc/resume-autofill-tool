/**
 * 日期策略层：把「怎么把日期写进控件」变成一组有序、可验证、可扩展的策略。
 *
 * 分工：
 *   date-capability.js  —— 只回答「期望值/回读值是什么、差到什么程度」（模型 + 精度判级 + 探测）
 *   date-strategies.js（本文件）—— 只回答「按什么顺序试、每步怎么验、失败了记什么」
 *   content/autofill.js —— 站点特有的策略（antd v3 日历 / antd fiber 直写 / 键盘选中）注册进来
 *
 * 为什么值得单独一层：`autofill.js` 里日期逻辑原本是 20 多个并列 tryXxx，
 * 谁先谁后、失败了要不要继续、什么算成功，散落在各处；同一份判断被复制三四份。
 * 这里只保留一条链：STRATEGY_ORDER 顺序 → 每步执行 → 立刻回读判级 → exact 即停 →
 * 可接受但非 exact 记 best 并继续找更精确的 → 全失败则如实报告（留空）。
 *
 * 浏览器：ResumeAutofillDateStrategies；Node：module.exports（单测与 Playwright 注入）
 */
(function (root, factory) {
  var Cap = root.ResumeAutofillDate;
  if (typeof module === 'object' && module.exports) {
    try { if (!Cap) Cap = require(require('path').join(__dirname, 'date-capability.js')); } catch (_) { /* ignore */ }
  }
  var api = factory(Cap);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ResumeAutofillDateStrategies = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cap) {
  'use strict';

  var STRATEGY_ORDER = (Cap && Cap.STRATEGY_ORDER) || [
    'native-input', 'native-selects', 'fiber-props', 'panel-input',
    'panel-nav', 'keyboard-pick', 'grid-click', 'confirm', 'give-up'
  ];

  // ── 基础工具（与站点无关）────────────────────────────────
  // 活动预算：fillDate 每次执行前设定，翻月/翻年这类长循环必须尊重它，
  // 否则一个难缠的控件就能吃掉整轮填充的时间预算（曾把 7 个日期字段拖到超时）。
  var activeDeadline = 0;
  function overBudget() { return activeDeadline > 0 && Date.now() > activeDeadline; }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function isVisibleEl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null) return false;
    var b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return false;
    var cs = (el.ownerDocument && el.ownerDocument.defaultView || window).getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  function simulateClick(el) {
    if (!el) return false;
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(function (t) {
      var Ev = t === 'pointerdown' || t === 'pointerup' ? (window.PointerEvent || window.MouseEvent) : window.MouseEvent;
      try { el.dispatchEvent(new Ev(t, { bubbles: true, cancelable: true })); } catch (_) { /* ignore */ }
    });
    return true;
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    try {
      var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (desc && desc.set && el.tagName === 'INPUT') desc.set.call(el, value);
      else if (el.tagName === 'TEXTAREA') {
        var tdesc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (tdesc && tdesc.set) tdesc.set.call(el, value); else el.value = value;
      } else el.value = value;
    } catch (_) {
      try { el.value = value; } catch (__) { return false; }
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return String(el.value || '') === String(value);
  }

  function setSelectByNumber(sel, want) {
    var wantNum = parseInt(want, 10);
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      var raw = String(o.value !== '' ? o.value : o.text || '').trim();
      var num = parseInt(raw.replace(/\D/g, ''), 10);
      if (raw === String(want) || (!isNaN(num) && num === wantNum)) {
        sel.selectedIndex = i;
        try { sel.value = o.value; } catch (_) { /* ignore */ }
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  // ── 面板/网格识别（结构 + 文本，不认框架类名）──────────────
  var DATE_PANEL_SEL = '.layui-laydate, .laydate, .el-picker-panel, .el-date-picker, ' +
    '.ant-picker-dropdown, .flatpickr-calendar, [class*="datepicker"], [class*="date-picker"], ' +
    '[class*="datePicker"], [class*="calendar"], [class*="DatePicker"]';

  var CN_MONTH = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  var EN_MONTH = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];

  function looksLikeWeekHeader(txt) {
    var t = String(txt || '');
    if (/日\s*一\s*二\s*三\s*四\s*五\s*六/.test(t)) return true;
    var m = t.match(/sun|mon|tue|wed|thu|fri|sat|su|mo|tu|we|th|fr|sa/gi) || [];
    var uniq = {};
    m.forEach(function (x) { uniq[x.toLowerCase()] = 1; });
    return Object.keys(uniq).length >= 5;
  }

  /** 列表容器常与「确定/箭头」同父：往上找带按钮的容器，最多 2 层 */
  function expandToActionableHost(host) {
    var h = host;
    for (var up = 0; up < 2 && h && h.parentElement; up++) {
      var hasBtn = h.querySelectorAll('button, [class*="arrow"], [role="button"]').length > 0;
      var txt = String(h.textContent || '');
      var hasConfirm = /确定|确认|完成|OK|ok/.test(txt);
      if (hasBtn || hasConfirm) return h;
      var parent = h.parentElement;
      if (String(parent.textContent || '').length > 2000) break;
      h = parent;
    }
    return h || host;
  }

  function numericGroups(root) {
    var groups = [];
    if (!root || !root.querySelectorAll) return groups;
    var sel = 'table, ul, ol, dl, [class*="list"], [role="listbox"], [class*="column"], [class*="col"]';
    Array.prototype.forEach.call(root.querySelectorAll(sel), function (n) {
      if (!isVisibleEl(n)) return;
      var cells = n.querySelectorAll('td, li, dd, span, div, a');
      var vals = [];
      Array.prototype.forEach.call(cells, function (c) {
        if (c.childElementCount) return;
        var t = String(c.textContent || '').trim();
        if (!/^\d{1,4}$/.test(t)) return;
        vals.push(parseInt(t, 10));
      });
      if (vals.length < 2) return;
      var max = Math.max.apply(null, vals);
      var type = max >= 1900 ? 'year' : (max <= 12 ? 'month' : (max <= 31 ? 'day' : null));
      if (type) groups.push({ el: n, type: type, count: vals.length });
    });
    return groups;
  }

  /** 可见日期面板：先按常见类名，再按日历网格，最后按「含年/月/日三组数字」兜底 */
  function findDatePanel(yearText) {
    var byClass = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll(DATE_PANEL_SEL), function (n) {
        if (!isVisibleEl(n)) return;
        var b = n.getBoundingClientRect();
        if (b.width < 150 || b.height < 90) return;   // 排除标题/图标碎片
        byClass.push(n);
      });
    } catch (_) { /* ignore */ }
    if (byClass.length) {
      var roots = byClass.filter(function (n) {
        return !byClass.some(function (m) { return m !== n && m.contains(n); });
      });
      var list = roots.length ? roots : byClass;
      return expandToActionableHost(list[list.length - 1]);
    }
    var grids = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll('table'), function (t) {
        if (!isVisibleEl(t)) return;
        var txt = String(t.textContent || '');
        var isGrid = looksLikeWeekHeader(txt) ||
          !!t.querySelector('td[class*="available"], td[class*="prev-month"], td[class*="next-month"]');
        if (!isGrid) return;
        var host = t.closest('[class*="picker"], [class*="panel"], [class*="popup"], [class*="dropdown"], [class*="calendar"], [class*="date"]') || t;
        for (var up = 0; up < 3 && host && host.parentElement &&
             host.querySelectorAll('button, [class*="arrow"]').length === 0; up++) {
          host = host.parentElement;
        }
        if (isVisibleEl(host)) grids.push(host);
      });
    } catch (_) { /* ignore */ }
    if (grids.length) {
      var gridRoots = grids.filter(function (n) {
        return !grids.some(function (m) { return m !== n && m.contains(n); });
      });
      var gl = gridRoots.length ? gridRoots : grids;
      return expandToActionableHost(gl[gl.length - 1]);
    }
    var numericHost = null;
    try {
      var pool = document.querySelectorAll('div, section, dl, table');
      for (var pi = 0; pi < pool.length && pi < 800; pi++) {
        var n2 = pool[pi];
        if (!isVisibleEl(n2)) continue;
        if (String(n2.textContent || '').length > 3000) continue;
        var leaves = n2.querySelectorAll('li, td, dd').length;
        if (leaves < 6 || leaves > 400) continue;
        var types = {};
        numericGroups(n2).forEach(function (g) { types[g.type] = 1; });
        if (types.year && types.month && types.day) {
          if (!numericHost || numericHost.contains(n2)) numericHost = n2;
        }
      }
    } catch (_) { /* ignore */ }
    if (numericHost) return expandToActionableHost(numericHost);

    if (!yearText) return null;
    var generic = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll('table, ul, [class*="list"], [class*="panel"], [class*="popup"], [class*="dropdown"]'), function (n) {
        if (!isVisibleEl(n)) return;
        if (String(n.textContent || '').indexOf(yearText) === -1) return;
        generic.push(n);
      });
    } catch (_) { /* ignore */ }
    return generic.length ? expandToActionableHost(generic[generic.length - 1]) : null;
  }

  function clickPanelItem(scope, text, hintRe) {
    if (!scope) return false;
    var want = String(text || '').trim();
    if (!want) return false;
    var wantNum = parseInt(want, 10);
    var nodes = scope.querySelectorAll('td, li, dd, span, div, a');
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.childElementCount) continue;          // 只点叶子，避免点到容器
      var t = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      var same = (t === want) || (!isNaN(wantNum) && !isNaN(parseInt(t, 10)) && String(parseInt(t, 10)) === String(wantNum));
      if (!same) continue;
      if (!isVisibleEl(n)) continue;
      var bonus = 0;
      var p = n;
      for (var u = 0; u < 4 && p; u++, p = p.parentElement) {
        var cls = String((p.className || ''));
        if (hintRe && hintRe.test(cls)) { bonus = 1; break; }
      }
      if (!best || bonus > best.bonus) best = { el: n, bonus: bonus };
      if (bonus) break;
    }
    if (!best) return false;
    simulateClick(best.el);
    return true;
  }

  function clickPanelConfirm(scope) {
    var root = scope || document;
    var nodes = root.querySelectorAll('button, a, span, div, input[type=button]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var t = String(n.textContent || n.value || '').replace(/\s+/g, ' ').trim();
      if (!/^(确定|确认|完成|ok|OK|Ok)$/.test(t)) continue;
      if (n.disabled) continue;
      if (!isVisibleEl(n)) continue;
      simulateClick(n);
      return true;
    }
    return false;
  }

  function gridHeader(panel) {
    var txt = '';
    var heads = panel.querySelectorAll('[class*="header"], [class*="title"], .laydate-header');
    for (var i = 0; i < heads.length; i++) txt += ' ' + String(heads[i].textContent || '');
    if (!txt.replace(/\s+/g, '')) txt = String(panel.textContent || '').slice(0, 160);
    txt = txt.replace(/\s+/g, ' ');
    var ym = txt.match(/(19|20)\d{2}/);
    var year = ym ? parseInt(ym[0], 10) : null;
    var month = null;
    var zh = txt.match(/(十一|十二|十|[一二三四五六七八九])月/);
    if (zh && CN_MONTH[zh[1]]) month = CN_MONTH[zh[1]];
    if (!month) {
      var lower = txt.toLowerCase();
      for (var k = 0; k < EN_MONTH.length; k++) {
        if (lower.indexOf(EN_MONTH[k]) !== -1) { month = k + 1; break; }
      }
    }
    if (!month) {
      var num = txt.match(/(\d{1,2})\s*月/);
      if (num) month = parseInt(num[1], 10);
    }
    if (!month) {
      var iso = txt.match(/(19|20)\d{2}\s*[-/.年]\s*(\d{1,2})/) || txt.match(/(\d{1,2})\s*[-/.]\s*(19|20)\d{2}/);
      if (iso) month = parseInt(iso[2], 10);
    }
    return { year: year, month: month };
  }

  function pickArrow(panel, dir, unit) {
    var suffix = dir < 0 ? 'left' : 'right';
    var cls = unit === 'year' ? '.d-arrow-' + suffix : '.arrow-' + suffix;
    var byCls = panel.querySelector(cls);
    if (byCls && isVisibleEl(byCls)) return byCls;
    var nodes = Array.prototype.slice.call(panel.querySelectorAll('button, i, span, div'));
    var hits = [];
    nodes.forEach(function (n) {
      if (!isVisibleEl(n)) return;
      var m = (String(n.className || '') + ' ' + (n.getAttribute('title') || '') + ' ' +
        (n.getAttribute('aria-label') || '') + ' ' + String(n.textContent || '')).toLowerCase();
      var dirOk = dir < 0 ? /left|prev|上|‹|«/.test(m) : /right|next|下|›|»/.test(m);
      if (!dirOk) return;
      if (String(n.textContent || '').trim().length > 6) return;
      hits.push(n);
    });
    if (!hits.length) return null;
    if (unit === 'year') return dir < 0 ? hits[0] : hits[hits.length - 1];
    return dir < 0 ? hits[hits.length - 1] : hits[0];
  }

  function setPanelPeriod(panel, y, m) {
    var changed = false;
    try {
      Array.prototype.forEach.call(panel.querySelectorAll('select'), function (sel) {
        var nums = [];
        for (var i = 0; i < sel.options.length; i++) {
          var v = parseInt(String(sel.options[i].value !== '' ? sel.options[i].value : sel.options[i].text || '').replace(/\D/g, ''), 10);
          if (!isNaN(v)) nums.push(v);
        }
        if (!nums.length) return;
        var mx = Math.max.apply(null, nums);
        if (mx >= 1900) { if (setSelectByNumber(sel, y)) changed = true; }
        else if (mx <= 12 && sel.options.length >= 2) { if (setSelectByNumber(sel, m)) changed = true; }
      });
      var yin = panel.querySelector('input.cur-year, input[class*="year"], input[class*="Year"]');
      if (yin && /^\d{4}$/.test(String(yin.value || '').trim())) {
        if (setNativeValue(yin, String(y))) changed = true;
      }
    } catch (_) { /* ignore */ }
    return changed;
  }

  async function gridNavigate(panel, y, m) {
    if (setPanelPeriod(panel, y, m)) await sleep(180);
    var deadline = Math.min(Date.now() + 12000, activeDeadline || Infinity);
    var superUsable = true;
    for (var guard = 0; guard < 420; guard++) {
      if (Date.now() > deadline) return false;
      var cur = gridHeader(panel);
      if (!cur.year || !cur.month) return false;
      var d = (y * 12 + m) - (cur.year * 12 + cur.month);
      if (d === 0) return true;
      var dir = d < 0 ? -1 : 1;
      if (superUsable && Math.abs(d) >= 120) {
        var superBtn = pickArrow(panel, dir, 'year');
        if (superBtn) {
          var before = cur;
          simulateClick(superBtn);
          await sleep(150);
          var after = gridHeader(panel);
          var movedMonths = (after.year && before.year)
            ? Math.abs((before.year * 12 + before.month) - (after.year * 12 + after.month)) : 0;
          if (movedMonths < 12) superUsable = false;   // 那个箭头只走一个月/一年，别再当十年用
          continue;
        }
        superUsable = false;
      }
      var monthBtn = pickArrow(panel, dir, 'month');
      if (!monthBtn) return false;
      var step = Math.min(Math.abs(d), 12);
      for (var k = 0; k < step; k++) {
        if (Date.now() > deadline) return false;
        simulateClick(monthBtn);
        await sleep(30);
      }
      await sleep(80);
    }
    return false;
  }

  function gridClickDay(panel, day) {
    var cells = panel.querySelectorAll('td');
    var fallback = null;
    for (var i = 0; i < cells.length; i++) {
      var td = cells[i];
      var cls = String(td.className || '');
      if (/prev-month|next-month|disabled|not-current/.test(cls)) continue;
      var txt = String(td.textContent || '').replace(/\s+/g, ' ').trim();
      if (parseInt(txt, 10) !== day) continue;
      if (!isVisibleEl(td)) continue;
      if (/\bavailable\b|\bcurrent\b/.test(cls)) { simulateClick(td); return true; }
      if (!fallback) fallback = td;
    }
    if (fallback) { simulateClick(fallback); return true; }
    return false;
  }

  function isCalendarGrid(panel) {
    if (!panel) return false;
    if (panel.querySelector('td.prev-month, td.next-month, td.current, .el-date-table, .laydate-theme-grid')) return true;
    if (panel.querySelector('td[class*="available"], td[class*="disabled"]')) return true;
    if (looksLikeWeekHeader(String(panel.textContent || ''))) return true;
    var tables = panel.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var rows = tables[i].querySelectorAll('tr');
      if (rows.length < 4) continue;
      var wideRows = 0;
      Array.prototype.forEach.call(rows, function (tr) {
        if (tr.querySelectorAll('td').length >= 5) wideRows += 1;
      });
      if (wideRows < 4) continue;   // 单列列表（年表/月表）不算网格
      var nums = 0;
      Array.prototype.forEach.call(tables[i].querySelectorAll('td'), function (td) {
        var v = parseInt(String(td.textContent || '').trim(), 10);
        if (!isNaN(v) && v >= 1 && v <= 31) nums += 1;
      });
      if (nums >= 28) return true;
    }
    return false;
  }

  // ── 内置策略实现 ──────────────────────────────────────────
  var parts = function (desired) {
    if (Cap && Cap.parseModel) {
      var mo = Cap.parseModel(desired);
      if (!mo || !mo.y) return null;
      return { y: mo.y, m: mo.m, d: mo.d };
    }
    return null;
  };

  function matches(el, desired) {
    if (Cap && Cap.matchLevel) return Cap.matchLevel(el && el.value, desired).level;
    return String((el && el.value) || '') === String(desired) ? 'exact' : 'mismatch';
  }

  /** 年表/月表/日表（多表格面板，如 中华英才网 生日） */
  async function tablePanelFill(el, desired) {
    var p = parts(desired);
    if (!p || !p.m) return false;
    var root = findDatePanel(p.y);
    if (!root) return false;
    var scope = root;
    for (var u = 0; u < 4 && scope.parentElement; u++) {
      var types = {};
      numericGroups(scope).forEach(function (g) { types[g.type] = 1; });
      if (Object.keys(types).length >= 2) break;
      scope = scope.parentElement;
    }
    if (overBudget()) return false;
    var step = function (text, type) {
      var groups = numericGroups(scope).filter(function (g) { return g.type === type; });
      for (var i = 0; i < groups.length; i++) {
        if (clickPanelItem(groups[i].el, text, null)) return true;
      }
      return false;
    };
    if (!step(p.y, 'year')) return false;
    await sleep(220);
    if (!step(p.m, 'month')) return false;
    await sleep(220);
    if (p.d && !step(p.d, 'day')) return false;
    await sleep(180);
    if (!Cap.isAcceptable(matches(el, desired))) {
      if (!clickPanelConfirm(scope)) clickPanelConfirm(findDatePanel(p.y) || scope);
      await sleep(300);
    }
    return true;
  }

  /** 日历网格（表头翻年/翻月 + 点日格） */
  async function gridFill(el, desired) {
    var p = parts(desired);
    if (!p || !p.m) return false;
    var panel = findDatePanel(p.y);
    if (!panel) return false;
    if (overBudget()) return false;
    var navOk = await gridNavigate(panel, parseInt(p.y, 10), parseInt(p.m, 10));
    if (!navOk) return false;
    await sleep(150);
    panel = findDatePanel(p.y) || panel;
    if (p.d) {
      if (!gridClickDay(panel, parseInt(p.d, 10))) return false;
    }
    await sleep(220);
    if (!Cap.isAcceptable(matches(el, desired))) {
      var again = findDatePanel(p.y);
      if (again) clickPanelConfirm(again);
      await sleep(260);
    }
    return true;
  }

  /** 原生输入框直写（<input type=date> 或普通文本框） */
  function nativeInputFill(el, desired) {
    if (!el || String(el.tagName).toUpperCase() !== 'INPUT') return false;
    if (el.readOnly || el.disabled) return false;
    var p = parts(desired);
    if (!p || !p.m) return false;
    var type = String(el.getAttribute('type') || 'text').toLowerCase();
    var text = type === 'date' ? Cap.toYmd(desired)
      : (p.d ? Cap.toYmd(desired) : Cap.toYm(desired));
    return setNativeValue(el, text);
  }

  /** 年/月/日 三个原生 select */
  async function nativeSelectsFill(el, desired) {
    var p = parts(desired);
    if (!p || !p.m) return false;
    var box = el && el.closest ? el.closest('td, .field, .form-item, .ant-form-item, tr, .row') : null;
    var scope = box || (el && el.parentElement);
    if (!scope) return false;
    var selects = Array.prototype.slice.call(scope.querySelectorAll('select')).filter(function (s) {
      return !s.disabled && s.options && s.options.length >= 2;
    });
    if (selects.length < 2) return false;
    var done = 0;
    selects.forEach(function (sel) {
      var nums = [];
      for (var i = 0; i < sel.options.length; i++) {
        var v = parseInt(String(sel.options[i].value !== '' ? sel.options[i].value : sel.options[i].text || '').replace(/\D/g, ''), 10);
        if (!isNaN(v)) nums.push(v);
      }
      if (!nums.length) return;
      var mx = Math.max.apply(null, nums);
      if (mx >= 1900) { if (setSelectByNumber(sel, p.y)) done++; }
      else if (mx <= 12) { if (setSelectByNumber(sel, p.m)) done++; }
      else if (mx <= 31 && p.d) { if (setSelectByNumber(sel, p.d)) done++; }
    });
    await sleep(60);
    if (done < 2) return false;
    // 合起来回读：单个 select 的 value 只有年（或只有月），必须拼成完整日期再判级
    var got = { y: null, m: null, d: null };
    scope.querySelectorAll('select').forEach(function (sel) {
      var nums = [];
      for (var i = 0; i < sel.options.length; i++) {
        var v = parseInt(String(sel.options[i].value !== '' ? sel.options[i].value : sel.options[i].text || '').replace(/\D/g, ''), 10);
        if (!isNaN(v)) nums.push(v);
      }
      if (!nums.length) return;
      var mx = Math.max.apply(null, nums);
      var chosen = parseInt(String(sel.value || '').replace(/\D/g, ''), 10);
      if (isNaN(chosen)) return;
      if (mx >= 1900) got.y = chosen;
      else if (mx <= 12) got.m = chosen;
      else if (mx <= 31 && !got.d) got.d = chosen;
    });
    var text = got.y ? (got.y + '-' + (got.m || '') + (got.d ? '-' + got.d : '')) : '';
    return { level: matches({ value: text }, desired) };
  }

  // ── 策略注册与执行 ───────────────────────────────────────
  var BUILTIN = {
    'native-input': { id: 'native-input', run: nativeInputFill },
    'native-selects': { id: 'native-selects', run: nativeSelectsFill },
    'panel-nav': { id: 'panel-nav', run: tablePanelFill },
    'grid-click': { id: 'grid-click', run: gridFill }
  };
  var registered = {};

  /**
   * 站点特有策略（antd v3 日历 / fiber 直写 / antd 面板…）由 autofill.js 注册。
   * 同一个槽位可以有多个实现：内置实现先跑，返回 false 才继续跑注册进来的，
   * 这样 antd 的 panel-nav 不会被通用「年/月/日表格」顶掉，反之亦然。
   */
  function register(id, run) {
    if (!id || typeof run !== 'function') return false;
    if (STRATEGY_ORDER.indexOf(id) === -1) return false;   // 顺序表里没有的 id 不收
    if (!registered[id]) registered[id] = [];
    registered[id].push(run);
    return true;
  }

  /** 某个槽位要依次尝试的实现列表（内置在前，注册的在后面） */
  function runsFor(id) {
    var out = [];
    if (BUILTIN[id]) out.push(BUILTIN[id].run);
    (registered[id] || []).forEach(function (fn) { out.push(fn); });
    return out;
  }

  function available() {
    var out = {};
    STRATEGY_ORDER.forEach(function (id) {
      var runs = runsFor(id);
      if (runs.length) out[id] = runs;
    });
    return out;
  }

  /**
   * 按 STRATEGY_ORDER 依次尝试，每步立刻回读判级。
   * exact 即停；可接受但非 exact 记 best 继续找更精确的；全部失败 → ok:false（留空）。
   */
  async function fillDate(el, desired, opts) {
    var o = opts || {};
    var pool = available();
    var order = o.order || STRATEGY_ORDER;
    var attempts = [];
    var best = null;
    var budget = o.deadline || (Date.now() + (o.budgetMs || 20000));

    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      var runs = pool[id];
      if (!runs || !runs.length) continue;
      if (Date.now() > budget) { attempts.push({ id: id, level: 'timeout' }); break; }
      // 单个策略最多花 perStrategyMs，避免一个难缠控件吃掉整轮时间
      activeDeadline = Math.min(budget, Date.now() + (o.perStrategyMs || 4000));
      var ran = false;
      for (var r = 0; r < runs.length && !ran; r++) {
        if (Date.now() > activeDeadline) break;
        try { ran = await runs[r](el, desired, o.ctx || {}); } catch (e) { ran = false; }
      }
      activeDeadline = 0;
      if (ran === false) { attempts.push({ id: id, level: 'n/a' }); continue; }
      // 策略可以自带判级（年/月/日三个 select 得合起来读才知道对不对）
      var lvl = (ran && typeof ran === 'object' && ran.level) ? ran.level : matches(el, desired);
      attempts.push({ id: id, level: lvl });
      if (lvl === 'exact') return { ok: true, level: 'exact', strategy: id, attempts: attempts, value: String(el.value || '') };
      if (Cap.isAcceptable(lvl) && !best) best = { id: id, level: lvl };
      if (lvl === 'mismatch' && o.stopOnMismatch) break;
    }
    if (best) {
      return { ok: true, level: best.level, strategy: best.id, attempts: attempts, value: String(el.value || '') };
    }
    return { ok: false, level: matches(el, desired), strategy: null, attempts: attempts, value: String(el.value || '') };
  }

  /** 供页面侧复用：探测这个输入框归哪类（委托能力层，缺了就按 readonly 猜） */
  function probe(el) {
    if (Cap && Cap.probeControl) return Cap.probeControl(el);
    return { kind: el && el.readOnly ? 'panel-on-click' : 'unknown', hints: {} };
  }

  return {
    fillDate: fillDate,
    register: register,
    available: available,
    probe: probe,
    STRATEGY_ORDER: STRATEGY_ORDER,
    // 面板工具（autofill.js 复用，不再各自实现一份）
    findDatePanel: findDatePanel,
    numericGroups: numericGroups,
    clickPanelItem: clickPanelItem,
    clickPanelConfirm: clickPanelConfirm,
    gridHeader: gridHeader,
    gridNavigate: gridNavigate,
    gridClickDay: gridClickDay,
    pickArrow: pickArrow,
    setPanelPeriod: setPanelPeriod,
    isCalendarGrid: isCalendarGrid,
    expandToActionableHost: expandToActionableHost,
    looksLikeWeekHeader: looksLikeWeekHeader,
    setNativeValue: setNativeValue,
    setSelectByNumber: setSelectByNumber,
    simulateClick: simulateClick,
    isVisibleEl: isVisibleEl,
    sleep: sleep,
    DATE_PANEL_SEL: DATE_PANEL_SEL
  };
});
