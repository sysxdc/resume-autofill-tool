/**
 * 简历填写工具 · 内容脚本 · Ant Design / antd v3 日期面板与范围选择器（组件值走页面主环境桥接）
 * 由 content/autofill.js 拆出（v1.6.0）。模块之间通过 globalThis.ResumeAutofillContent 共享函数，
 * 加载顺序见 manifest.json content_scripts；排在后面的模块用转发函数引用（调用时才解析）。
 */
(function () {
  'use strict';

  var C = globalThis.ResumeAutofillContent || (globalThis.ResumeAutofillContent = {});
  if (!globalThis.ResumeAutofillMatch) return;
  // 重复注入时整个模块跳过：保持和首次加载的编排层用同一套函数 / 本轮状态
  var loaded = C.__loaded || (C.__loaded = {});
  if (loaded['sites/antd-date']) return;
  loaded['sites/antd-date'] = true;

  // 依赖（已加载的模块）
  var antdV3Panel = C.antdV3Panel;
  var bridgeDateCommit = C.bridgeDateCommit;
  var dateValueMatches = C.dateValueMatches;
  var isVisibleEl = C.isVisibleEl;
  var openPicker = C.openPicker;
  var parseDateParts = C.parseDateParts;
  var simulateClick = C.simulateClick;
  var sleep = C.sleep;
  var waitForAntdPanel = C.waitForAntdPanel;

  // 依赖（后加载的模块：调用时再取）
  function formatDateYmd() { return C.formatDateYmd.apply(this, arguments); }
  function rangeDateOf() { return C.rangeDateOf.apply(this, arguments); }

  // ————— v1.3.7：Ant Design DatePicker（年面板 / 月面板 / 日面板）—————

  var ANTD_DROPDOWN = '.ant-picker-dropdown';

  /** 关掉已打开的 antd 面板：同一表单里多个日期框的弹层会同时挂在 body 上 */
  function closeAllAntdPanels() {
    try {
      // antd v3 的日历不吃 Escape，点一下 body 才会走「点击外部关闭」
      if (antdV3Panel()) {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    } catch (_) { /* ignore */ }
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }));
    } catch (_) { /* ignore */ }
  }

  function antdPanel() {
    var list = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll(ANTD_DROPDOWN), function (n) {
        if (isVisibleEl(n)) list.push(n);
      });
    } catch (_) { /* ignore */ }
    return list.length ? list[list.length - 1] : null;
  }

  function antdHeaderView(panel) {
    var hv = panel.querySelector('.ant-picker-header-view');
    var txt = String((hv && hv.textContent) || '').replace(/\s+/g, ' ').trim();
    var y = txt.match(/(\d{4})/);
    var m = txt.match(/(\d{1,2})\s*月/);
    return { txt: txt, y: y ? parseInt(y[1], 10) : null, m: m ? parseInt(m[1], 10) : null };
  }

  function antdCells(panel) {
    var out = [];
    Array.prototype.forEach.call(panel.querySelectorAll('.ant-picker-cell'), function (td) {
      var inner = td.querySelector('.ant-picker-cell-inner') || td;
      var t = String(inner.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push({ td: td, text: t, inView: /ant-picker-cell-in-view/.test(String(td.className)), disabled: /ant-picker-cell-disabled/.test(String(td.className)) });
    });
    return out;
  }

  function antdNav(panel, dir, kind) {
    var sel = kind === 'year'
      ? (dir < 0 ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-super-next-btn')
      : (dir < 0 ? '.ant-picker-header-prev-btn' : '.ant-picker-header-next-btn');
    var b = panel.querySelector(sel);
    if (b && isVisibleEl(b)) return b;
    // 月/年面板没有 prev/next，只有 super 按钮（月面板的 super = ±1 年）
    var sel2 = dir < 0 ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-super-next-btn';
    var b2 = panel.querySelector(sel2);
    return b2 && isVisibleEl(b2) ? b2 : null;
  }

  function antdClickCell(panel, text) {
    var cells = antdCells(panel);
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].disabled) continue;
      if (cells[i].text === text) { simulateClick(cells[i].td); return true; }
    }
    return false;
  }

  /** 把视图翻到目标年（年面板按 10 年跳，月/日面板按 1 年跳） */
  async function antdGotoYear(panel, year, yearStep) {
    for (var guard = 0; guard < 40; guard++) {
      // React 每次翻页都会重建面板 DOM，必须每轮重新取，否则点的是已脱离文档的按钮
      var cur = antdPanel() || panel;
      var hv = antdHeaderView(cur);
      if (!hv.y) return false;
      if (hv.y === year) return true;
      var diff = year - hv.y;
      var btn = null;
      if (yearStep >= 10 && Math.abs(diff) >= 10) {
        btn = antdNav(cur, diff < 0 ? -1 : 1, 'year');
      }
      if (!btn) btn = antdNav(cur, diff < 0 ? -1 : 1, 'month');
      if (!btn) return false;
      simulateClick(btn);
      await sleep(yearStep >= 10 ? 140 : 120);
    }
    return false;
  }

  /**
   * Ant Design v3 日历（.ant-calendar）：面板自带 .ant-calendar-input 可直接键入；
   * 退化路径走「年份面板 → 月份面板 → 日格」。v3 的超级箭头只按年，翻上百个月点不动，
   * 所以不能用通用 gridNavigate。
   */
  async function tryAntdV3Calendar(el, desired) {
    var parts = parseDateParts(desired);
    if (!parts) return false;
    var panel = antdV3Panel();
    if (!panel) return false;
    var y = parseInt(parts.y, 10);
    var m = parseInt(parts.m, 10);
    var day = String(parts.d ? parseInt(parts.d, 10) : 1);

    // (1) 面板输入框直写：v3 的 CalendarInput 认 Enter
    var input = panel.querySelector('.ant-calendar-input');
    if (input) {
      var want = parts.y + '-' + ('0' + m).slice(-2) + '-' + ('0' + day).slice(-2);
      try {
        input.focus();
        var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(input, want);
        else input.value = want;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) { /* ignore */ }
      await sleep(120);
      try {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      } catch (_) { /* ignore */ }
      await sleep(320);
      if (dateValueMatches(el.value, desired)) return true;
    }

    // (2) 年份 → 月份 → 日
    panel = antdV3Panel() || panel;
    var header = String((panel.querySelector('.ant-calendar-header') || {}).textContent || '');
    var hm = header.match(/(\d{4})\s*年/);
    if (!hm || parseInt(hm[1], 10) !== y) {
      var yearSelect = panel.querySelector('.ant-calendar-year-select');
      if (yearSelect) {
        simulateClick(yearSelect);
        await sleep(220);
        var yearPanel = Array.prototype.filter.call(document.querySelectorAll('.ant-calendar-year-panel'), isVisibleEl).pop();
        var yearCell = yearPanel && Array.prototype.filter.call(
          yearPanel.querySelectorAll('.ant-calendar-year-panel-year'),
          function (n) { return String(n.textContent || '').trim() === String(y) && !/disabled/.test(String(n.className)); }
        )[0];
        if (yearCell) { simulateClick(yearCell); await sleep(260); }
      }
    }

    panel = antdV3Panel() || panel;
    var h2 = String((panel.querySelector('.ant-calendar-header') || {}).textContent || '');
    var mm = h2.match(/(\d{1,2})\s*月/);
    if (!mm || parseInt(mm[1], 10) !== m) {
      var monthSelect = panel.querySelector('.ant-calendar-month-select');
      if (monthSelect) {
        simulateClick(monthSelect);
        await sleep(220);
        var monthPanel = Array.prototype.filter.call(document.querySelectorAll('.ant-calendar-month-panel'), isVisibleEl).pop();
        var monthCell = monthPanel && Array.prototype.filter.call(
          monthPanel.querySelectorAll('.ant-calendar-month-panel-month'),
          function (n) { return String(n.textContent || '').trim() === (m + '月') && !/disabled/.test(String(n.className)); }
        )[0];
        if (monthCell) { simulateClick(monthCell); await sleep(260); }
      }
    }

    panel = antdV3Panel() || panel;
    var dayCell = Array.prototype.filter.call(
      panel.querySelectorAll('td.ant-calendar-cell'),
      function (td) {
        var cls = String(td.className || '');
        return !/last-month|next-month|disabled/.test(cls) && isVisibleEl(td);
      }
    ).filter(function (td) {
      return String((td.querySelector('.ant-calendar-date') || td).textContent || '').trim() === day;
    })[0];
    if (dayCell) {
      simulateClick(dayCell);
      await sleep(280);
      return dateValueMatches(el.value, desired);
    }
    return false;
  }

  /** Ant Design 日期面板（年 / 月 / 日三种模式） */
  async function tryAntdPanel(el, desired) {
    var parts = parseDateParts(desired);
    if (!parts) return false;
    var panel = antdPanel();
    if (!panel) return false;
    var y = parseInt(parts.y, 10);
    var m = parseInt(parts.m, 10);
    var cells = antdCells(panel);
    var monthMode = cells.some(function (c) { return /^\d{1,2}\s*月$/.test(c.text); });
    var yearMode = cells.some(function (c) { return /^\d{4}\s*年$/.test(c.text); });
    if (yearMode) {
      await antdGotoYear(panel, y, 10);
      if (!antdClickCell(panel, y + '年')) return false;
      await sleep(220);
      panel = antdPanel() || panel;
      cells = antdCells(panel);
      monthMode = cells.some(function (c) { return /^\d{1,2}\s*月$/.test(c.text); });
    }
    if (monthMode) {
      var want = y + '-' + ('0' + m).slice(-2);

      function monthCellReady() {
        var pp = antdPanel() || panel;
        var cell = pp.querySelector('.ant-picker-cell[title="' + want + '"]');
        return cell && !/ant-picker-cell-disabled/.test(String(cell.className)) ? cell : null;
      }

      var hit = monthCellReady();
      if (!hit) {
        // 月面板只有 super-prev/super-next（= ±1 年）：逐年翻到目标年。
        // 每轮重新取面板，点击后立刻检查目标格子，避免 React 重建 DOM 后的陈旧引用。
        for (var gy = 0; gy < 40; gy++) {
          var py = antdPanel() || panel;
          var hvy = antdHeaderView(py);
          if (!hvy.y || hvy.y === y) break;
          var nvy = antdNav(py, hvy.y < y ? 1 : -1, 'month');
          if (!nvy) break;
          simulateClick(nvy);
          await sleep(90);
          if (monthCellReady()) break;
        }
        hit = monthCellReady();
      }
      if (hit) {
        simulateClick(hit);
        await sleep(260);
        if (dateValueMatches(el.value, desired)) return true;
      }
      // 最后：按文字点月（老版本 antd 无 title）
      panel = antdPanel() || panel;
      if (!antdClickCell(panel, m + '月')) return false;
      await sleep(260);
      return dateValueMatches(el.value, desired);
    }

    return false;   // 日面板交给通用网格逻辑
  }

  /** antd 范围选择器里左右两个面板 */
  function antdSubPanels() {
    var dd = antdPanel();
    if (!dd) return [];
    return Array.prototype.filter.call(dd.querySelectorAll('.ant-picker-panel'), isVisibleEl);
  }

  /**
   * 在 antd 日历里点上某一天。
   * antd v5 的日格子带 title="YYYY-MM-DD"，按 title 找最省事；
   * 当前不在那一页时先翻年/月（年面板点年、月面板点月、日面板翻月）。
   * @param {Element|null} scope 指定面板（范围选择器有左右两个），null = 取最后打开的弹层
   */
  async function antdPickDay(scope, y, m, d) {
    var target = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
    var pinned = !!scope;
    for (var guard = 0; guard < 40; guard++) {
      var panel = (pinned && scope && scope.isConnected) ? scope : antdPanel();
      if (!panel) return false;
      var cell = panel.querySelector('.ant-picker-cell[title="' + target + '"]');
      if (cell) {
        if (/ant-picker-cell-disabled/.test(String(cell.className))) return false;
        simulateClick(cell);
        await sleep(260);
        return true;
      }
      var cells = antdCells(panel);
      if (cells.some(function (c) { return /^\d{4}\s*年$/.test(c.text); })) {
        if (!(await antdGotoYear(panel, y, 10))) return false;
        var py = (pinned && scope && scope.isConnected) ? scope : antdPanel();
        if (!py || !antdClickCell(py, y + '年')) return false;
        await sleep(240);
        continue;
      }
      if (cells.some(function (c) { return /^\d{1,2}\s*月$/.test(c.text); })) {
        var hv = antdHeaderView(panel);
        if (hv.y && hv.y !== y) await antdGotoYear(panel, y, 1);
        var pm = (pinned && scope && scope.isConnected) ? scope : antdPanel();
        if (!pm || !antdClickCell(pm, m + '月')) return false;
        await sleep(240);
        continue;
      }
      var hv2 = antdHeaderView(panel);
      if (!hv2.y) return false;
      // 跨年时先点「年份」进年面板，一下跳到位；逐月翻 3 年得点 30 多次，太慢
      var yearBtn = panel.querySelector('.ant-picker-header-year-btn');
      if (yearBtn && isVisibleEl(yearBtn) && hv2.y !== y) {
        simulateClick(yearBtn);
        await sleep(200);
        continue;
      }
      var wantIdx = y * 12 + m;
      var curIdx = hv2.y * 12 + (hv2.m || 1);
      if (wantIdx === curIdx) return false;   // 已经在目标月却没有这一天
      var btn = panel.querySelector(wantIdx > curIdx ? '.ant-picker-header-next-btn' : '.ant-picker-header-prev-btn');
      if (!btn || !isVisibleEl(btn)) return false;
      simulateClick(btn);
      await sleep(140);
    }
    return false;
  }

  /** 单个 antd 日期框：打开弹层 → 点到目标日 → 核对输入框 */
  async function tryAntdDayCell(el, desired) {
    var p = parseDateParts(desired);
    if (!p) return false;
    var y = parseInt(p.y, 10);
    var m = parseInt(p.m, 10);
    var d = p.d ? parseInt(p.d, 10) : 1;
    if (!y || !m) return false;
    if (!antdPanel()) {
      openPicker(el);
      if (!(await waitForAntdPanel(1000))) return false;
    }
    var ok = await antdPickDay(null, y, m, d);
    if (!ok) return false;
    return dateValueMatches(el.value, desired);
  }

  /**
   * antd 范围选择器（.ant-picker-range，快手教育经历的「起止时间」）：
   * 两个 input 都是 readonly，只能点面板：先在左面板点开始日，再在右面板点结束日。
   */
  async function fillAntdRangePicker(editor, startVal, endVal) {
    var ins = editor.querySelectorAll('input');
    if (ins.length < 2) return false;
    var start = rangeDateOf(startVal, false);
    var end = rangeDateOf(endVal, true);
    if (!start || !end || end.getTime() < start.getTime()) return false;
    closeAllAntdPanels();
    await sleep(160);
    openPicker(ins[0]);
    if (!(await waitForAntdPanel(1100))) return false;
    var okStart = await antdPickDay(antdSubPanels()[0] || null, start.getFullYear(), start.getMonth() + 1, start.getDate());
    if (!okStart) return false;
    // 选完开始日，焦点会自动跳到结束日，右面板跟着翻页
    await sleep(240);
    var panels = antdSubPanels();
    var right = panels.length > 1 ? panels[panels.length - 1] : null;
    var okEnd = await antdPickDay(right, end.getFullYear(), end.getMonth() + 1, end.getDate());
    await sleep(200);
    closeAllAntdPanels();
    if (!okEnd) return false;
    var a = String(ins[0].value || '').trim();
    var b = String(ins[1].value || '').trim();
    return !!a && !!b && dateValueMatches(a, formatDateYmd(start)) && dateValueMatches(b, formatDateYmd(end));
  }

  /**
   * 绕开日历直接改组件值：调它自己的 onChange（Form 就是靠这个存值的）。
   * v1.5.24：实现搬到 content/page-bridge.js（页面主环境）——隔离环境里根本读不到 fiber / Vue 实例。
   * 桥接按 antd 3（handleChange）→ antd 4/5（最外层 rc-picker 的 onChange）→ Vue 2 → Vue 3 依次尝试。
   */
  function fillAntdPickerByModel(el, startVal, endVal) {
    var isRange = !!(el.closest && (el.closest('.ant-picker-range') ||
      (el.classList && el.classList.contains('ant-calendar-range-picker-input'))));
    var s = rangeDateOf(startVal, false);
    if (!s) return false;
    var e = isRange ? rangeDateOf(endVal, true) : null;
    if (isRange && (!e || e.getTime() < s.getTime())) return false;
    return bridgeDateCommit(el, s, e);
  }

  // 导出
  C.closeAllAntdPanels = closeAllAntdPanels;
  C.antdPanel = antdPanel;
  C.tryAntdV3Calendar = tryAntdV3Calendar;
  C.tryAntdPanel = tryAntdPanel;
  C.tryAntdDayCell = tryAntdDayCell;
  C.fillAntdRangePicker = fillAntdRangePicker;
  C.fillAntdPickerByModel = fillAntdPickerByModel;
})();
