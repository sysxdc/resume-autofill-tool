/**
 * 简历填写工具 · 内容脚本 · 北森 Phoenix（iTalent / zhiye.com）：下拉 / 日期 / 年月 / 字典 / 地区弹层与 div 单选
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
  if (loaded['sites/phoenix']) return;
  loaded['sites/phoenix'] = true;

  // 依赖（已加载的模块）
  var RADIO_SAFE_KEYS = C.RADIO_SAFE_KEYS;
  var choiceValueFor = C.choiceValueFor;
  var highlight = C.highlight;
  var isVisibleEl = C.isVisibleEl;
  var parseDateParts = C.parseDateParts;
  var simulateClick = C.simulateClick;
  var sleep = C.sleep;

  // ————— v1.5.5：北森 Phoenix（zhiye.com / 北森云网申）组件适配 —————
  // 页面结构：.form-root > .ux-standard-form > .form#GUID_Recruitment_* > .form-item--phoenix
  // 控件：select / date 都是 .phoenix-select（无 name/id，靠 .form-item__text 标签）；
  //       radio 是纯 div 的 .phoenix-radio-group；民族=字典弹层，籍贯=地区弹层。
  var PHOENIX_LIST_SEL = '.phoenix-selectList';
  var PHOENIX_ITEM_SEL = '.phoenix-selectList__listItem';
  var PHOENIX_DATE_SEL = '.phoenix-date-picker';
  var PHOENIX_DICT_SEL = '.constant-main-selector-container';
  var PHOENIX_AREA_SEL = '.area-selector-container';

  function isPhoenixHost(host) {
    return !!(host && host.classList && host.classList.contains('phoenix-select'));
  }

  /** 最后一个可见节点（弹层可能残留多个已关闭副本） */
  function lastVisible(sel, root) {
    var nodes = (root || document).querySelectorAll(sel);
    var hit = null;
    for (var i = 0; i < nodes.length; i++) {
      if (isVisibleEl(nodes[i])) hit = nodes[i];
    }
    return hit;
  }

  function phoenixHostFilled(host) {
    if (!host) return false;
    var input = host.querySelector('input');
    var v = input ? String(input.value || '').trim() : '';
    if (!v) {
      var tip = host.querySelector('.phoenix-select__tipEle');
      if (tip) v = String(tip.textContent || '').trim();
    }
    return !!v && !/^请选择$/.test(v);
  }

  /** 只写值 + input/change（不触发 blur，避免弹层提前关闭） */
  function setInputRaw(el, value) {
    if (!el || el.disabled || el.readOnly) return false;
    var proto = el.tagName.toLowerCase() === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function pressEnter(el) {
    try {
      el.focus();
      ['keydown', 'keypress', 'keyup'].forEach(function (t) {
        el.dispatchEvent(new KeyboardEvent(t, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
        }));
      });
    } catch (_) { /* ignore */ }
  }

  function closePhoenixPanels() {
    // 点回处于 active 的宿主最稳（合成 Escape 对部分组件无效）
    var active = document.querySelector('.phoenix-select--active');
    if (active) {
      simulateClick(active.querySelector('.phoenix-select__input') || active);
      return;
    }
    var panel = lastVisible(PHOENIX_LIST_SEL) || lastVisible(PHOENIX_DATE_SEL) ||
      lastVisible(PHOENIX_DICT_SEL) || lastVisible(PHOENIX_AREA_SEL);
    if (!panel) return;
    var target = panel.querySelector('input') || panel;
    try { target.focus(); } catch (_) { /* ignore */ }
    try {
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
      }));
    } catch (_) { /* ignore */ }
  }

  /** 弹层里的「确定」（字典 / 地区选择器） */
  function phoenixPanelConfirm(panel) {
    var nodes = panel.querySelectorAll('.phoenix-button__content');
    for (var i = 0; i < nodes.length; i++) {
      if (/^(确定|确认|完成|ok)$/i.test(String(nodes[i].textContent || '').trim())) {
        simulateClick(nodes[i]);
        return true;
      }
    }
    return false;
  }

  /** findBestOption 会去掉 el 字段，这里按文案再映射回原节点 */
  function phoenixPick(opts, value) {
    if (!opts || !opts.length) return null;
    var texts = opts.map(function (o) { return o.text; });
    var matched = M.findBestOption ? M.findBestOption(texts, value) : null;
    if (!matched) return null;
    var want = String(matched.text || matched.value || '');
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].text === want) return opts[i];
    }
    return null;
  }

  var PHOENIX_PANEL_SEL =
    '.phoenix-selectList, .phoenix-date-picker, .constant-main-selector-container, .area-selector-container';

  /** 轮询等待：弹层/选项都是异步渲染的，固定 sleep 不够稳 */
  async function waitUntil(fn, timeoutMs, stepMs) {
    var step = stepMs || 100;
    var waited = 0;
    while (waited <= timeoutMs) {
      try { if (fn()) return true; } catch (_) { /* ignore */ }
      await sleep(step);
      waited += step;
    }
    try { return !!fn(); } catch (_) { return false; }
  }

  function phoenixVisiblePanels() {
    return Array.prototype.filter.call(document.querySelectorAll(PHOENIX_PANEL_SEL), function (n) {
      return isVisibleEl(n);
    });
  }

  /** 点开宿主，返回「这次新出现的」弹层；上一个字段残留的弹层不算 */
  async function phoenixOpenPanel(host) {
    var before = phoenixVisiblePanels();
    var opener = host.querySelector('.phoenix-select__input') || host;
    simulateClick(opener);
    var found = null;
    await waitUntil(function () {
      var now = phoenixVisiblePanels();
      for (var i = 0; i < now.length; i++) {
        if (before.indexOf(now[i]) === -1) { found = now[i]; return true; }
      }
      return false;
    }, 1800, 150);
    return found;
  }

  function phoenixReadItems(root, itemSel) {
    var nodes = root.querySelectorAll(itemSel);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var t = String(nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push({ el: nodes[i], text: t });
    }
    return out;
  }

  /** 搜索后轮询直到出现匹配项（虚拟列表只渲染前几行，不搜就只能看到头部） */
  async function phoenixFindInList(root, itemSel, value) {
    var waited = 0;
    var hit = null;
    while (waited <= 1000) {
      hit = phoenixPick(phoenixReadItems(root, itemSel), value);
      if (hit) return hit;
      await sleep(150);
      waited += 150;
    }
    return null;
  }

  /** 弹层右侧的「已选 x/y」计数，用来确认勾选真的生效（-1 表示没这个区域） */
  function phoenixPanelSelectedCount(panel) {
    var right = panel.querySelector('.right-container');
    if (!right) return -1;
    var m = String(right.textContent || '').match(/已选(?:地区)?\s*(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }

  function phoenixIconOf(row) {
    return row.querySelector('.icon-container svg') ||
      row.querySelector('.icon-container') || row;
  }

  /** 字典 / 地区弹层：搜索 → 勾选图标（圆形单选） → 确定 */
  async function fillPhoenixPanel(host, value, panel, key) {
    if (!panel) return false;
    var isArea = panel.classList.contains('area-selector-container');
    var itemSel = isArea ? '.area-item-container' : '.list-item-container';
    var search = panel.querySelector('.content-search input, .area-search-input input');
    var raw = String(value).replace(/\s+/g, '');
    var texts = [raw];
    if (raw.length > 2) texts.push(raw.slice(0, 2));
    texts.push('');
    for (var s = 0; s < texts.length; s++) {
      if (search) {
        setInputRaw(search, texts[s]);
        // 等列表按搜索词重渲染，否则点到的是即将被替换的旧行
        await sleep(450);
      }
      var hit = await phoenixFindInList(panel, itemSel, value);
      if (!hit) continue;
      simulateClick(phoenixIconOf(hit.el));
      var selected = false;
      for (var t = 0; t < 5 && !selected; t++) {
        await sleep(200);
        selected = phoenixPanelSelectedCount(panel) > 0;
      }
      if (!selected) {
        // 列表刚重渲染时第一次点可能落空，重取一行再点一次
        hit = await phoenixFindInList(panel, itemSel, value);
        if (hit) {
          simulateClick(phoenixIconOf(hit.el));
          for (var t2 = 0; t2 < 5 && !selected; t2++) {
            await sleep(200);
            selected = phoenixPanelSelectedCount(panel) > 0;
          }
        }
      }
      if (!selected) continue;
      phoenixPanelConfirm(panel);
      if (await waitUntil(function () { return phoenixHostFilled(host); }, 1500, 150)) return true;
    }
    closePhoenixPanels();
    return false;
  }

  /**
   * 普通下拉：搜索 → 点选项（虚拟列表，只渲染可见行）
   * key 仅用于个别字段的保守校验（面试站点不能拿「广州」命中「广州美术学院」）。
   */
  async function fillPhoenixList(host, value, panel, key) {
    if (!panel) return false;
    var search = panel.querySelector('.phoenix-input__input');
    var raw = String(value).replace(/\s+/g, '');
    var texts = [raw];
    if (raw.length > 2) texts.push(raw.slice(0, 2));
    texts.push('');
    for (var s = 0; s < texts.length; s++) {
      if (search) {
        setInputRaw(search, texts[s]);
        await sleep(250);
      }
      var hit = await phoenixFindInList(panel, PHOENIX_ITEM_SEL, value);
      if (!hit) continue;
      if (key === 'interviewCity' && hit.text.length > raw.length + 3) continue;
      simulateClick(hit.el.querySelector('.phoenix-selectList__singleLabel') || hit.el);
      if (await waitUntil(function () { return phoenixHostFilled(host); }, 1200, 150)) return true;
    }
    closePhoenixPanels();
    return false;
  }

  /** 月份选择器（教育经历的起止时间）：翻年 → 点月份 */
  async function fillPhoenixMonth(host, value, panel) {
    var parts = parseDateParts(value);
    if (!panel || !parts) return false;
    var wantYear = parseInt(parts.y, 10);
    var wantMonth = parseInt(parts.m, 10);
    for (var guard = 0; guard < 60; guard++) {
      var yearEl = panel.querySelector('.phoenix-calendar-month-panel-year-select-content');
      var curYear = yearEl ? parseInt(String(yearEl.textContent || '').replace(/\D/g, ''), 10) : NaN;
      if (!curYear || curYear === wantYear) break;
      var btn = panel.querySelector(curYear < wantYear
        ? '.phoenix-calendar-month-panel-next-year-btn'
        : '.phoenix-calendar-month-panel-prev-year-btn');
      if (!btn) break;
      simulateClick(btn);
      await sleep(180);
    }
    var cells = panel.querySelectorAll('.phoenix-calendar-month-panel-month');
    var target = null;
    for (var i = 0; i < cells.length; i++) {
      // 「7月」「七月」「Jul」都有（随北森版本 / 语言包变）；12 格且读不出时按位置
      var n = monthNumberOfText(cells[i].textContent);
      if (n === wantMonth || (!n && cells.length === 12 && i + 1 === wantMonth)) { target = cells[i]; break; }
    }
    if (!target) { closePhoenixPanels(); return false; }
    simulateClick(target);
    var ok = await waitUntil(function () { return phoenixHostFilled(host); }, 1200, 150);
    if (ok) return true;
    closePhoenixPanels();
    return false;
  }

  /** 日期：日历面板里的 .phoenix-calendar-input 可直接键入 + Enter 提交 */
  async function fillPhoenixDate(host, value, panel) {
    var parts = parseDateParts(value);
    if (!panel || !parts) return false;
    if (panel.querySelector('.phoenix-calendar-month-calendar')) {
      return fillPhoenixMonth(host, value, panel);
    }
    var input = panel.querySelector('.phoenix-calendar-input');
    if (!input) { closePhoenixPanels(); return false; }
    // v1.6.0：日历输入框按语言包格式严格解析（zh_CN 是 YYYY/MM/DD，en_US 是 M/D/YYYY），格式不对
    // 输入框会挂上 *-input-invalid、Enter 无效。依次试常见格式，以「没被判无效」为准再回车
    var y = parts.y;
    var m = parseInt(parts.m, 10);
    var d = parseInt(parts.d || '1', 10);
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var tries = [y + '/' + p2(m) + '/' + p2(d), y + '-' + p2(m) + '-' + p2(d), y + '/' + m + '/' + d, y + '-' + m + '-' + d,
      y + '.' + p2(m) + '.' + p2(d), y + '年' + m + '月' + d + '日', m + '/' + d + '/' + y];
    for (var ti = 0; ti < tries.length; ti++) {
      setInputRaw(input, tries[ti]);
      await sleep(80);
      if (/-invalid\b/.test(String(input.className || ''))) continue;
      pressEnter(input);
      if (await waitUntil(function () { return phoenixHostFilled(host); }, 900, 100)) return true;
    }
    closePhoenixPanels();
    return false;
  }

  /**
   * 北森 Phoenix 宿主：点开 → 识别本次弹层类型（日期 / 字典 / 地区 / 普通下拉）
   */
  async function fillPhoenixHost(host, value, key) {
    if (!host || !value) return false;
    if (host.isConnected === false) return false;
    if (phoenixHostFilled(host)) return false;
    // 已经打开的先点回去，避免 toggle 反向
    if (host.classList.contains('phoenix-select--active')) {
      simulateClick(host.querySelector('.phoenix-select__input') || host);
      await waitUntil(function () { return !host.classList.contains('phoenix-select--active'); }, 700, 100);
    }
    var panel = await phoenixOpenPanel(host);
    if (!panel) return false;
    try {
      if (panel.classList.contains('phoenix-date-picker')) {
        return await fillPhoenixDate(host, value, panel);
      }
      if (panel.classList.contains('constant-main-selector-container') ||
          panel.classList.contains('area-selector-container')) {
        return await fillPhoenixPanel(host, value, panel, key);
      }
      return await fillPhoenixList(host, value, panel, key);
    } catch (e) {
      return false;
    }
  }

  var CN_MONTH_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  var EN_MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /** 月份格子的文字 → 1~12：「7月」「07」「七月」「Jul」「July」；读不出返回 0 */
  function monthNumberOfText(text) {
    var t = String(text || '').replace(/\s+/g, '').trim();
    var m = t.match(/^(\d{1,2})月?$/);
    if (m) { var n = parseInt(m[1], 10); return n >= 1 && n <= 12 ? n : 0; }
    m = t.match(/^(十一|十二|十|[一二三四五六七八九])月$/);
    if (m) return CN_MONTH_NUM[m[1]];
    m = t.toLowerCase().match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
    return m ? EN_MONTH_NUM[m[1]] : 0;
  }

  /** 北森 Phoenix radio：纯 div 组，选中态是 .phoenix-radio--checked */
  var PHOENIX_RADIO_CHECKED_SEL = '.phoenix-radio--checked, .phoenix-radio__circle--checked';

  async function fillPhoenixRadioGroups(profile, keyCounts, filledKeys) {
    var filled = 0;
    var groups = Array.from(document.querySelectorAll('.phoenix-radio-group')).filter(function (g) {
      return isVisibleEl(g);
    });
    for (var gi = 0; gi < groups.length; gi++) {
      var r = await fillOnePhoenixRadioGroup(groups[gi], profile, keyCounts, filledKeys);
      if (r) filled += 1;
    }
    return filled;
  }

  async function fillOnePhoenixRadioGroup(group, profile, keyCounts, filledKeys) {
    {
      // 选中态两个版本的写法都认：线上 .phoenix-radio--checked，npm 3.x .phoenix-radio__circle--checked
      if (group.querySelector(PHOENIX_RADIO_CHECKED_SEL)) return false;
      var item = group.closest ? group.closest('.form-item') : null;
      var labelEl = item ? item.querySelector('.form-item__text') : null;
      var label = labelEl ? String(labelEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!label) return false;
      var scored = M.matchFieldKeyScored ? M.matchFieldKeyScored(label, {}) : null;
      var key = scored && scored.key;
      if (!key || !RADIO_SAFE_KEYS[key]) return false;
      if (keyCounts['radio:' + key]) return false;
      var gval = M.profileValue(profile, key);
      if (!gval) return false;
      var opts = Array.from(group.querySelectorAll('.phoenix-radio')).map(function (r) {
        return { el: r, text: String(r.textContent || '').replace(/\s+/g, ' ').trim() };
      }).filter(function (o) { return o.text; });
      if (!opts.length) return false;
      var want = choiceValueFor(key, gval, opts.map(function (o) { return o.text; }));
      var matched = phoenixPick(opts, want);
      if (!matched) return false;
      simulateClick(matched.el);
      // 选中态由 Vue 异步渲染：等它落地再判，不能点完立刻读（之前会把成功判成失败、或反过来）
      var isOn = function () {
        return matched.el.classList.contains('phoenix-radio--checked') || !!matched.el.querySelector(PHOENIX_RADIO_CHECKED_SEL);
      };
      var on = await waitUntil(isOn, 600, 60);
      if (!on) {
        try { matched.el.click(); } catch (_) { /* ignore */ }
        on = await waitUntil(isOn, 600, 60);
      }
      if (!on) return false;
      keyCounts['radio:' + key] = 1;
      if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
      highlight(matched.el);
      return true;
    }
  }

  // 导出
  C.isPhoenixHost = isPhoenixHost;
  C.closePhoenixPanels = closePhoenixPanels;
  C.fillPhoenixHost = fillPhoenixHost;
  C.fillPhoenixRadioGroups = fillPhoenixRadioGroups;
})();
