/**
 * 简历填写工具 · 内容脚本 · 选择类控件：只读弹层、开关、自定义下拉（Element / Ant / 字典）、联动下拉
 * 由 content/autofill.js 拆出（v1.6.0）。模块之间通过 globalThis.ResumeAutofillContent 共享函数，
 * 加载顺序见 manifest.json content_scripts；排在后面的模块用转发函数引用（调用时才解析）。
 */
(function () {
  'use strict';

  var C = globalThis.ResumeAutofillContent || (globalThis.ResumeAutofillContent = {});
  var M = globalThis.ResumeAutofillMatch;
  if (!globalThis.ResumeAutofillMatch) return;
  // 重复注入时整个模块跳过：保持和首次加载的编排层用同一套函数 / 本轮状态
  var loaded = C.__loaded || (C.__loaded = {});
  if (loaded['fill/select']) return;
  loaded['fill/select'] = true;

  // 依赖（已加载的模块）
  var detectSectionContext = C.detectSectionContext;
  var fillRecords = C.fillRecords;
  var highlight = C.highlight;
  var recordFill = C.recordFill;
  var runDone = C.runDone;
  var settle = C.settle;
  var sleep = C.sleep;

  // 依赖（后加载的模块：调用时再取）
  function fillPhoenixHost() { return C.fillPhoenixHost.apply(this, arguments); }
  function isPhoenixHost() { return C.isPhoenixHost.apply(this, arguments); }
  function normalizeChoiceText() { return C.normalizeChoiceText.apply(this, arguments); }

  // ————— v1.3.1：readonly 弹层选择器 + 无名 radio 组 —————

  /** 肯定不能点的选项文案（防止误触提交类按钮） */
  var PICKER_BLOCK_RE = /^(提交|保存|取消|关闭|确定删除|删除|清除|重置|退出|submit|save|cancel|close|reset|delete)$/i;

  /** 允许自动勾选的单选组（语义容易误判的组不在此列） */
  var RADIO_SAFE_KEYS = {
    gender: 1, maritalStatus: 1, politicalStatus: 1, ethnicity: 1,
    hasRelativeAtCompany: 1, acceptAdjustment: 1, isFreshGraduate: 1,
    hasMilitaryService: 1, isVeteran: 1, willingToRelocate: 1,
    hasChronicIllness: 1, hasCriminalRecord: 1, hasStudyAbroad: 1
  };


  /** 「至今 / 现在 / present / 在职」这类不是日期，代表“当前仍在职” */
  function isCurrentJobValue(v) {
    return /^(至今|现在|今|目前|在职|实习中|在岗|present|now|current|till now|to date)$/i.test(String(v || '').trim());
  }


  /** 日期类输入框（type=date/month、placeholder 带年/月/日、只读 picker）不该写入“至今” */
  function looksLikeDateInput(el) {
    if (!el) return false;
    var type = String(el.type || '').toLowerCase();
    if (type === 'date' || type === 'month' || type === 'datetime-local') return true;
    if (el.readOnly) return true;
    var ph = String(el.getAttribute && el.getAttribute('placeholder') || '');
    if (/年|月|日|yyyy|yyyy-mm|mm\/dd|日期|date/i.test(ph)) return true;
    if (isReadonlyPicker(el)) return true;
    return false;
  }

  /** 排名 / 绩点在区间下拉里的候选写法（原始值优先） */
  function valueCandidates(key, value) {
    var out = [String(value == null ? '' : value)];
    try {
      if (M.rankValueCandidates && (key === 'majorRank' || key === 'classRank' || key === 'gpaRank')) {
        out = out.concat(M.rankValueCandidates(value));
      }
      if (M.gpaValueCandidates && key === 'gpa') {
        out = out.concat(M.gpaValueCandidates(value));
      }
    } catch (e) { /* ignore */ }
    var seen = {};
    return out.filter(function (v) {
      var k = String(v);
      if (!k || seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  /**
   * 在字段附近找「至今 / 在职 / 目前」开关并勾上。
   * 找不到就返回 false（调用方会跳过，而不是把“至今”写进日期框）。
   */
  /** 开关当前是否处于「开」：原生 checkbox / aria-checked / 各家组件库的选中类名 */
  function toggleIsOn(b, cb) {
    if (cb) return !!cb.checked;
    var aria = b.getAttribute && b.getAttribute('aria-checked');
    if (aria != null) return aria === 'true';
    var cls = String(b.className || '');
    if (/(^|\s)(is-checked|checked|ant-switch-checked|ant-checkbox-checked|el-switch--checked)(\s|$)/.test(cls)) return true;
    return !!(b.querySelector && b.querySelector('.is-checked, .ant-checkbox-checked, .ant-switch-checked'));
  }

  /**
   * 在字段附近找「至今 / 在职 / 目前」开关并勾上。
   * v1.5.23：点完必须回读确认已勾上（之前点了就算成功，组件没响应时「至今」实际没生效）；
   * 合成点击不生效时再用原生 click（antd v3 / 部分 Vue 组件只认原生 click）。
   * 找不到或勾不上就返回 false（调用方会跳过，而不是把“至今”写进日期框）。
   */
  async function clickCurrentJobToggle(el) {
    if (!el || !el.parentElement) return false;
    var node = el;
    for (var up = 0; up < 4 && node && node.parentElement; up++) {
      node = node.parentElement;
      var boxes = node.querySelectorAll('input[type="checkbox"], [role="switch"], [role="checkbox"], .ant-checkbox, .ant-switch, .el-checkbox, .el-switch');
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        var cbIn = b.tagName.toLowerCase() === 'input' ? b : null;
        // 原生 checkbox 常被样式藏起来（opacity:0），看它的包装层是否可见
        if (!isVisibleEl(b) && !(cbIn && cbIn.closest && isVisibleEl(cbIn.closest('label') || cbIn.parentElement))) continue;
        var txt = String(b.parentElement ? b.parentElement.textContent : b.textContent || '').replace(/\s+/g, '');
        var near = txt || String(b.getAttribute('aria-label') || '') + String(b.title || '');
        // 控件自身没有文案时，看它所在 label/兄弟文本
        if (!/至今|在职|目前|现在|present|current|now/i.test(near)) {
          var row = b.closest('label, .ant-checkbox-wrapper, .el-checkbox, li, div');
          var rowTxt = row ? String(row.textContent || '').replace(/\s+/g, '') : '';
          if (!/至今|在职|目前|现在|present|current|now/i.test(rowTxt)) continue;
        }
        var cb = cbIn || b.querySelector('input[type="checkbox"]');
        if (toggleIsOn(b, cb)) return true;
        simulateClick(cb || b);
        await settle();
        await sleep(60);
        if (toggleIsOn(b, cb)) return true;
        // 合成事件没被组件接住：原生 click（先点包装 label，再点控件本身）
        var wrap = (cb || b).closest ? (cb || b).closest('label, .ant-checkbox-wrapper, .el-checkbox') : null;
        try { (wrap || cb || b).click(); } catch (_) { /* ignore */ }
        await settle();
        await sleep(60);
        return toggleIsOn(b, cb);
      }
    }
    return false;
  }

  function isReadonlyPicker(el) {
    if (!el || el.disabled || !el.readOnly) return false;
    var t = (el.type || 'text').toLowerCase();
    return t === 'text' || t === 'search' || t === 'tel' || t === 'number';
  }

  /** antd v3 的日期控件（.ant-calendar-picker + .ant-calendar-picker-container 面板） */
  function isAntdV3Picker(el) {
    try { return !!(el && el.closest && el.closest('.ant-calendar-picker')); } catch (_) { return false; }
  }

  /** 当前可见的 antd v3 日历面板（返回 .ant-calendar 根节点） */
  function antdV3Panel() {
    var list = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll('.ant-calendar-picker-container'), function (n) {
        if (!isVisibleEl(n)) return;
        var cal = n.querySelector('.ant-calendar');
        if (cal) list.push(cal);
      });
    } catch (_) { /* ignore */ }
    return list.length ? list[list.length - 1] : null;
  }

  function simulateClick(el) {
    if (!el) return;
    // SVG 元素没有 el.click()，统一派发事件（北森字典/地区的勾选热区就是 svg）
    try {
      var ptr = null;
      try { ptr = new PointerEvent('pointerdown', { bubbles: true }); } catch (_) { ptr = null; }
      if (ptr) {
        el.dispatchEvent(ptr);
        try { el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); } catch (_) { /* ignore */ }
      }
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } catch (_) {
      try { el.click(); } catch (e) { /* ignore */ }
    }
  }

  // ————— v1.5.0：自定义下拉适配器（Element / Ant / dictionary / listbox）—————

  var CUSTOM_SELECT_HOST =
    '.el-select, .ant-select, .dictionary-selector, .form-select, .phoenix-select, [role="combobox"], ' +
    '[class*="sd-Select-container"]';  // Moka（app.mokahr.com）的自绘下拉
  var DROPDOWN_OPTION_SEL =
    '[role="option"], .el-select-dropdown__item, .el-option, .ant-select-item-option, ' +
    '.ant-select-item, .ant-select-dropdown-menu-item, .dictionary-option, .option-item, .select-option, ' +
    'li.el-select-dropdown__item, ' +
    '[class*="sd-Menu-content-item"]';

  /** 「广东省-阳江市-江城区」→ ['广东省', '广东省阳江市', '广东省阳江市江城区'] */
  function regionPrefixVariants(value) {
    var v = String(value || '').replace(/[-–—\s]+/g, '');
    var out = [];
    var re = /(省|自治区|特别行政区|市|自治州|区|县|旗)/g;
    var m;
    while ((m = re.exec(v))) {
      var seg = v.slice(0, m.index + m[0].length);
      if (seg && seg.length >= 2) out.push(seg);
    }
    return out;
  }

  /** 关掉已经展开的下拉，避免它的选项污染下一个字段的匹配 */
  function closeOpenDropdowns() {
    var open = Array.prototype.filter.call(
      document.querySelectorAll('.el-select-dropdown, .ant-select-dropdown'),
      isVisibleEl
    );
    if (!open.length) return;
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
      }));
    } catch (_) { /* ignore */ }
  }

  /**
   * 宿主自己的下拉节点（Element 把 .el-select-dropdown 挂在 .el-select 里）。
   * 打开瞬间外层可能还在过渡动画里（rect 为 0），但节点已经在，按 style 判断即可，
   * 不用干等它“看得见”——BYD 这类重页面要 1.5~2s，逐字段等就是卡顿的来源。
   */
  /**
   * antd 的弹层 portal 到 body，同页可能同时挂着好几个（上一轮没关干净的），
   * 猜错就会把「+82」「斯威本科技大学」这种别人家的选项点进去。
   * 用 aria-controls / aria-owns 精确找到当前这个下拉自己的那一个。
   */
  function dropdownForHost(host) {
    if (!host || !host.querySelector) return null;
    var input = host.querySelector('input[aria-controls], input[aria-owns], [aria-controls], [aria-owns]');
    if (input) {
      var id = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
      if (id) {
        var byId = document.getElementById(id);
        if (byId) {
          // antd 的 aria 目标是 listbox 空壳（0 尺寸、没有选项），真正的选项在它所属的弹层里
          var box = byId.closest ? byId.closest('.ant-select-dropdown') : null;
          if (box) return box;
          if (byId.querySelector('.ant-select-item-option')) return byId;
        }
      }
    }
    var own = host.querySelector('.el-select-dropdown, .ant-select-dropdown');
    return own || null;
  }

  function hostDropdownOptions(host) {
    if (!host || !host.querySelector) return null;
    var dd = dropdownForHost(host);
    if (!dd) return null;
    // 页面里常驻着好几个「隐藏但仍有 DOM」的下拉（antd 不会卸载），
    // 按 aria-controls 找到的那个可能已经过气：屏幕上有高度才算数
    var box = null;
    try { box = dd.getBoundingClientRect(); } catch (_) { box = null; }
    if (box && box.height === 0) dd = null;
    if (!dd) return null;
    var st = null;
    try { st = window.getComputedStyle(dd); } catch (_) { st = null; }
    if (!st || st.display === 'none' || st.visibility === 'hidden') return null;
    var items = dd.querySelectorAll('.el-select-dropdown__item, .el-option, .ant-select-item-option');
    if (!items.length) return null;
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var t = String(items[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push({ el: items[i], text: t, value: t });
    }
    return out.length ? out : null;
  }

  // 日期控件的外层也常带 role="combobox"（Element Plus：aria-haspopup="dialog"），不是下拉框：
  // 当成下拉会先空等 3~4 秒弹层选项，再轮到日期逻辑（v1.5.24 前每个日期框都白耗这几秒）
  var DATE_WIDGET_SEL = '.el-date-editor, .el-range-editor, .ant-picker, .ant-calendar-picker, ' +
    '.ivu-date-picker, .arco-picker, .t-date-picker, .t-date-range-picker, .semi-datepicker, ' +
    '.next-date-picker, .next-range-picker, .phoenix-date-picker, .layui-laydate';

  function findCustomSelectHost(el) {
    if (!el || !el.closest) return null;
    var host = el.closest(CUSTOM_SELECT_HOST);
    if (!host) return null;
    if (el.closest(DATE_WIDGET_SEL) && !isPhoenixHost(host)) return null;
    if (String(host.getAttribute && host.getAttribute('aria-haspopup') || '') === 'dialog') return null;
    // CUSTOM_SELECT_HOST 里的 [role="combobox"] 会直接命中 antd 的 input 本身（快手就是），
    // 那样 host 里既找不到 input 也读不到弹层，等于一个字段都填不动 —— 一律缩放到外层组件
    var tag = String(host.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      var wrap = host.closest(
        '.el-select, .ant-select, .dictionary-selector, .form-select, .phoenix-select, [class*="sd-Select-container"]'
      );
      return wrap || host.parentElement || host;
    }
    return host;
  }

  // 宿主里内嵌的弹层（Element UI 的 .el-select-dropdown 就挂在 .el-select 里面，隐藏时仍有选项文字）
  var INNER_DROPDOWN_SEL = '.el-select-dropdown, .ant-select-dropdown, [role="listbox"], .el-popper, ' +
    '[class*="dropdown"], [class*="Dropdown"], [class*="-popup"], [class*="menu"]';

  /** 宿主「自己显示」的文字：跳过内嵌弹层与隐藏节点（v1.5.24 前把隐藏选项「本科硕士博士」当成了已选值） */
  function hostOwnText(host) {
    if (!host || !document.createTreeWalker) return String((host && host.textContent) || '').replace(/\s+/g, ' ').trim();
    var out = '';
    var walker = document.createTreeWalker(host, 4, null);
    var tn;
    while ((tn = walker.nextNode())) {
      var p = tn.parentElement;
      if (!p) continue;
      var inner = p.closest(INNER_DROPDOWN_SEL);
      if (inner && inner !== host && host.contains(inner)) continue;
      out += tn.nodeValue;
      if (out.length > 200) break;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function customSelectLooksFilled(host) {
    if (!host) return false;
    // antd v3：只认 .ant-select-selection-selected-value，隐藏 input 里的编码值不算
    if (typeof isAntdV3SelectHost === 'function' && isAntdV3SelectHost(host)) {
      return !!antdV3SelectedText(host);
    }
    var txt = '';
    var selected = host.querySelector(
      '.el-select__selected-item:not(.el-select__input-wrapper):not(.is-transparent), .el-input__inner, .ant-select-selection-selected-value, ' +
      '.ant-select-selection-item, .ant-select-selection-search-input, .selected-text, [class*="selected"]'
    );
    if (selected) {
      txt = String(selected.textContent || selected.value || '').replace(/\s+/g, ' ').trim();
    }
    if (!txt) {
      // 只看可见的搜索框；隐藏 input 里常存的是「0/660/411987」这种编码值，不代表已选
      var inps = host.querySelectorAll('input');
      for (var ii = 0; ii < inps.length; ii++) {
        var cand = inps[ii];
        if (/hidden/i.test(String(cand.type || ''))) continue;
        var cv = String(cand.value || '').replace(/\s+/g, ' ').trim();
        if (!cv || /^\d+(\/\d+)+$/.test(cv)) continue;
        txt = cv;
        break;
      }
    }
    if (txt && !/请选择|请输入|请填写|填写|select|choose|--/i.test(txt)) return true;
    // Moka 这类自绘下拉把选中值渲染成 span，input.value 一直是空的
    var hostText = hostOwnText(host);
    // 「必填项未填写」这类校验提示不是选中值，别把它当已填
    if (hostText && hostText.length <= 24 && !/请选择|请输入|可多选|最多|select|choose|--|必填|未填写|不能为空|错误|请上传/i.test(hostText)) return true;
    return false;
  }

  /**
   * 收集「当前可见」的选项。
   * 快手的下拉失焦后不会关（页面上能同时挂着好几个可见弹层），
   * 所以多个弹层并存时只取 DOM 里最后出现的那个 —— 也就是刚点开的这个。
   */
  var DROPDOWN_BOX_SEL = '.ant-select-dropdown, .el-select-dropdown, .el-popper, [role="listbox"], ' +
    '[class*="dropdown"]:not([class*="item"]):not([class*="option"]), ' +
    '[class*="Dropdown"]:not([class*="item"]):not([class*="Item"]):not([class*="option"])';

  function collectOpenDropdownOptions() {
    var nodes = document.querySelectorAll(DROPDOWN_OPTION_SEL);
    var groups = [];
    var lastBox = null;
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!isVisibleEl(n)) continue;
      // 从父节点开始找所属弹层：closest 包含自身，而选项自己的类名（el-select-dropdown__item）就含 dropdown，
      // 之前每个选项各成一组、只剩最后一项（Element UI 下拉因此永远只看到「博士」）
      var box = n.parentElement ? n.parentElement.closest(DROPDOWN_BOX_SEL) : null;
      if (box) {
        if (box !== lastBox) { lastBox = box; groups.push([]); }
        groups[groups.length - 1].push(n);
      } else {
        out.push(n);
      }
    }
    var picked = [];
    if (groups.length) {
      picked = groups[groups.length - 1];
      if (groups.length > 1) {
        // 别的弹层还开着：留给调用方清理，但选项只用最后那组
        out = out.concat(groups.slice(0, -1).reduce(function (a, b) { return a.concat(b); }, []));
        // 别的弹层里的选项不当候选，这里只返回最后一组
        out = [];
      }
    }
    picked = picked.length ? picked : out;
    var res = [];
    for (var j = 0; j < picked.length; j++) {
      var m = picked[j];
      var txt = String(m.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 80 || PICKER_BLOCK_RE.test(txt)) continue;
      res.push({ el: m, text: txt, value: m.getAttribute('data-value') || txt });
    }
    return res;
  }

  function openCustomSelect(host) {
    if (!host) return;
    // 先找真正的输入框：antd 只认落在 input 上的 mousedown（落在外层 div 上不开弹层），
    // 快手「最高学历学校」这种远程搜索下拉就是这么点不开的
    var clickTarget =
      host.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])') ||
      host.querySelector('.el-input__inner, .ant-select-selector, .el-select__wrapper, [role="combobox"]') ||
      host;
    try { clickTarget.focus(); } catch (_) { /* ignore */ }
    simulateClick(clickTarget);
  }

  /**
   * 写自定义下拉：点击展开 → 按文案匹配选项 → 点击。
   * 纯匹配逻辑复用 M.findBestOption / matchSelectOption。
   */
  /**
   * 往自定义下拉的搜索框里输值：antd v5 的「学校 / 专业」、Moka 的可搜索下拉，
   * 都要先输入再选，光点开只有一屏默认选项。
   * 用原生 setter + input 事件，React / Vue 的受控组件才认。
   */
  /** 下拉里可输入的搜索框（只读的 input 是展示用的，往里写字只会污染页面） */
  function searchInputOf(host) {
    var list = host.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])');
    for (var i = 0; i < list.length; i++) {
      if (!list[i].readOnly && !list[i].disabled) return list[i];
    }
    return null;
  }

  function typeIntoSearch(host, text) {
    var input = searchInputOf(host);
    if (!input) return false;
    var setter = null;
    try {
      setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    } catch (_) { setter = null; }
    try {
      input.focus();
      // 只有输入框里已经有字时才先清空：清空会让 antd 重渲染、把 input 换掉，
      // 后面那次赋值就落在已经脱离文档的旧节点上，等于没输（快手学校下拉踩过）
      if (String(input.value || '')) {
        if (setter) setter.call(input, ''); else input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input = searchInputOf(host) || input;
        try { input.focus(); } catch (_) { /* ignore */ }
      }
      if (setter) setter.call(input, String(text)); else input.value = String(text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  /** 下拉当前显示的文字（antd / Element / 自绘都能读到） */
  function customSelectText(host) {
    if (!host) return '';
    // Element Plus：第一个 .el-select__selected-item 是输入框外壳（永远空），选中文字在不透明的 placeholder 里
    var sel = host.querySelector('.ant-select-selection-item, .el-select__selected-item:not(.el-select__input-wrapper):not(.is-transparent)');
    if (sel) return String(sel.textContent || '').replace(/\s+/g, ' ').trim();
    // antd 选了就有 .ant-select-selection-item；没有就是没选。
    // 别拿搜索框里的字冒充结果——点了选项但没提交时，搜索框还留着刚输的词
    if (host.className && /ant-select/.test(String(host.className))) return '';
    var inp = host.querySelector('input');
    if (inp && inp.value) return String(inp.value).replace(/\s+/g, ' ').trim();
    return hostOwnText(host).slice(0, 40);
  }

  function normText(t) {
    return String(t || '').toLowerCase().replace(/\s+/g, '').replace(/[()（）\[\]【】·,，.。/\-]/g, '');
  }

  /**
   * 选完之后核对：读回来的文字得跟要填的值对得上。
   * 快手那个学校下拉会在筛选重排的瞬间把点击落到别的行（点成了「斯威本科技大学」），
   * 与其把错值留在页面上，不如判失败、让它在「未填」清单里露出来。
   */
  function optionTextPlausible(shown, value) {
    var a = normText(shown);
    if (!a) return false;
    var w = normText(value);
    if (!w) return false;
    if (a === w) return true;
    // 「不接受」⊃「接受」这类正反相包含不算对上（之前会把「接受」当成「不接受调剂」的合理显示）
    if (negationConflict(a, w)) return false;
    if (a.indexOf(w) !== -1 || w.indexOf(a) !== -1) return true;
    // 档案值写「应届生」、选项是「应届毕业生」这类同义词，不能当选歪了撤掉
    var syns = valueSynonymVariants(value);
    for (var i = 0; i < syns.length; i++) {
      var sn = normText(syns[i]);
      if (!sn || negationConflict(a, sn)) continue;
      if (a === sn || a.indexOf(sn) !== -1 || sn.indexOf(a) !== -1) return true;
    }
    return false;
  }

  function clearCustomSelect(host) {
    if (!host) return false;
    var btn = host.querySelector('.ant-select-clear, .el-select__clear, .el-select__caret.is-reverse, [class*="clear"]');
    if (btn) {
      simulateClick(btn);
      return true;
    }
    var inp = host.querySelector('input');
    if (!inp) return false;
    try {
      inp.focus();
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', keyCode: 8, bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  /** 选项全是 +86/+1 这类区号时，别把手机号往里填 */
  function isDialCodeList(opts) {
    if (!opts || !opts.length) return false;
    for (var i = 0; i < opts.length; i++) {
      if (!/^\s*\+\d{1,4}/.test(String(opts[i].text || ''))) return false;
    }
    return true;
  }

  /** antd v3 的 Select（.ant-select 但没有 v4 的 .ant-select-selector） */
  function isAntdV3SelectHost(host) {
    if (!host || !host.classList || !host.classList.contains('ant-select')) return false;
    return !host.querySelector('.ant-select-selector');
  }

  function antdV3SelectedText(host) {
    var v = host.querySelector('.ant-select-selection-selected-value');
    return v ? String(v.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  /** antd v3 下拉：原生 click 打开 → 需要时输入搜索词 → 原生 click 选项 → 回读 */
  async function fillAntdV3Select(host, value) {
    if (!host || !value) return false;
    if (antdV3SelectedText(host)) return false;
    var want = String(value).replace(/\s+/g, '');
    var tries = [String(value)].concat(regionPrefixVariants(value)).slice(0, 3);
    var deadline = Date.now() + 4500;

    for (var t = 0; t < tries.length; t++) {
      if (Date.now() > deadline) break;
      var target = tries[t];
      if (!target) continue;
      var sel = host.querySelector('.ant-select-selection');
      if (!sel) return false;
      if (!antdV3PanelIsOpen(sel)) {
        try { sel.click(); } catch (_) { simulateClick(sel); }
        await sleep(220);
      }
      var dd = dropdownForV3Select(sel);
      var items = dd ? Array.prototype.slice.call(dd.querySelectorAll('li.ant-select-dropdown-menu-item')) : [];
      items = items.filter(function (li) {
        if (/disabled/.test(String(li.className))) return false;
        return !/暂无数据|无数据|无匹配|加载中|loading/i.test(String(li.textContent || ''));
      });

      if (!items.length) {
        // 远程搜索（学校/专业这类）：输入关键词等结果
        var search = host.querySelector('.ant-select-search__field');
        if (search) {
          try {
            search.focus();
            var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (desc && desc.set) desc.set.call(search, target);
            else search.value = target;
            search.dispatchEvent(new Event('input', { bubbles: true }));
          } catch (_) { /* ignore */ }
          await sleep(1200);
          dd = dropdownForV3Select(sel);
          items = dd ? Array.prototype.slice.call(dd.querySelectorAll('li.ant-select-dropdown-menu-item')) : [];
          items = items.filter(function (li) { return !/disabled/.test(String(li.className)); });
        }
      }
      if (!items.length) continue;

      var wantNorm = target.replace(/\s+/g, '');
      var hit = items.filter(function (li) {
        return String(li.textContent || '').replace(/\s+/g, '') === wantNorm;
      })[0];
      if (!hit) {
        // 「使用“广东工业大学”作为我的学校」这种远程搜索占位项：文案里含目标就认
        hit = items.filter(function (li) {
          var t2 = String(li.textContent || '').replace(/\s+/g, '');
          return t2.indexOf(wantNorm) !== -1;
        })[0];
      }
      if (!hit) {
        // 没有可点的项：远程搜索下拉仍然能用键选取到
        var kb = await v3KeyboardPick(host, sel, wantNorm);
        if (kb) { highlight(host); return true; }
        continue;
      }
      // 实测 wecruit 这类 v3 远程搜索下拉：点选项不提交，键盘 ArrowDown + Enter 才提交；
      // 有搜索框就先走键盘，没有再退回鼠标点
      if (await v3KeyboardPick(host, sel, wantNorm)) { highlight(host); return true; }
      try { hit.click(); } catch (_) { simulateClick(hit); }
      await sleep(320);
      if (antdV3SelectedText(host)) { highlight(host); return true; }
    }
    return false;
  }

  /** v3 下拉的键盘选中：逐条 ArrowDown，直到高亮项是目标再 Enter（盲按会选中列表第一条） */
  async function v3KeyboardPick(host, sel, wantNorm) {
    var search = host.querySelector('.ant-select-search__field');
    if (!search || !wantNorm) return false;
    try {
      search.focus();
      for (var k = 0; k < 12; k++) {
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
        await sleep(60);
        var dd = dropdownForV3Select(sel);
        var act = dd ? dd.querySelector('.ant-select-dropdown-menu-item-active') : null;
        var actText = act ? String(act.textContent || '').replace(/\s+/g, '') : '';
        if (actText && (actText === wantNorm || actText.indexOf(wantNorm) !== -1)) {
          search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          await sleep(460);
          return !!antdV3SelectedText(host);
        }
      }
    } catch (_) { /* ignore */ }
    return false;
  }

  /** 这个 select 自己那个下拉（按 aria-controls 找，找不到退回可见的那个） */
  function dropdownForV3Select(sel) {
    var ctrl = sel && sel.querySelector('[aria-controls]');
    var id = ctrl ? ctrl.getAttribute('aria-controls') : (sel && sel.getAttribute('aria-controls'));
    if (id) {
      var byId = document.getElementById(id);
      if (byId) return byId;
    }
    var list = Array.prototype.filter.call(document.querySelectorAll('.ant-select-dropdown'), isVisibleEl);
    return list.length ? list[list.length - 1] : null;
  }

  function antdV3PanelIsOpen(sel) {
    var dd = dropdownForV3Select(sel);
    return !!(dd && isVisibleEl(dd) && dd.querySelector('li.ant-select-dropdown-menu-item'));
  }

  /** 弹窗选择器：点输入框 → ant-modal 里搜关键词 → 点 .school-item → 点「选择」 */
  function visibleAntdModal() {
    var list = Array.prototype.filter.call(document.querySelectorAll('.ant-modal'), isVisibleEl);
    return list.length ? list[list.length - 1] : null;
  }

  async function fillAntdModalPicker(input, value, key) {
    if (!input || !value) return false;
    if (String(input.value || '').trim()) return false;
    try { input.click(); } catch (_) { simulateClick(input); }
    var modal = null;
    for (var w = 0; w < 12 && !modal; w++) {
      await sleep(180);
      var m = visibleAntdModal();
      if (m && m.querySelector('.school-item, .school-form, input[placeholder*="专业"], input[placeholder*="学校"]')) modal = m;
    }
    if (!modal) return false;
    var want = String(value).replace(/\s+/g, '');
    var search = modal.querySelector('.search-bar input, input[placeholder*="专业"], input[placeholder*="学校"]');
    if (search && want) {
      try {
        var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(search, want);
        else search.value = want;
        search.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (_) { /* ignore */ }
      await sleep(1300);
    }
    var items = Array.prototype.slice.call(modal.querySelectorAll('.school-item'));
    var best = null;
    var bestScore = -1;
    items.forEach(function (it) {
      var t = String(it.textContent || '').replace(/\s+/g, '');
      if (!t) return;
      var score = 0;
      if (t === want) score = 5;
      else if (t.indexOf(want) === 0) score = 4;
      else if (t.indexOf(want) !== -1) score = 3;
      if (!score) return;
      // 「计算机科学与技术(计算机类)(普通本科)」这种带补充说明的：本科/研究生要跟档案对得上
      if (/本科/.test(t)) score += 1;
      if (score > bestScore) { bestScore = score; best = it; }
    });
    if (!best) return false;
    try { best.click(); } catch (_) { simulateClick(best); }
    await sleep(260);
    var confirm = null;
    Array.prototype.forEach.call(modal.querySelectorAll('button'), function (b) {
      if (/^(选择|确定|确认)$/.test(String(b.textContent || '').trim())) confirm = b;
    });
    if (confirm) {
      try { confirm.click(); } catch (_) { simulateClick(confirm); }
      await sleep(600);
    }
    if (String(input.value || '').trim()) { highlight(input); return true; }
    return false;
  }

  /** 预扫描这类「弹窗选择器」输入框：label 是专业/学校，且 placeholder 写着「请选择」 */
  async function fillModalPickers(profile, handled, filledKeys) {
    var items = Array.prototype.slice.call(document.querySelectorAll('.ant-form-item'));
    var filled = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var lab = it.querySelector('label');
      var label = lab ? String(lab.textContent || '').replace(/\s+/g, '').replace(/\*/g, '').trim() : '';
      if (!label) continue;
      var key = M.matchFieldKey(label, { context: detectSectionContext(it) });
      if (key !== 'major' && key !== 'school') continue;
      var inp = it.querySelector('input.ant-input:not([type="hidden"])');
      if (!inp) continue;
      if (handled && handled.has(inp)) continue;
      if (String(inp.value || '').trim()) continue;
      var ph = String(inp.getAttribute('placeholder') || '');
      // 先确认是「点了弹窗选」的那种再占用：之前在这里之前就 handled.add，
      // 普通的「学校名称 / 专业」输入框被标成已处理，主循环永远跳过它们（antd 表单里学校专业一律不填）
      if (!/请选择|选择专业|选择学校/.test(ph)) continue;
      if (handled) handled.add(inp);
      var val = M.profileValueForOccurrence
        ? M.profileValueForOccurrence(profile, key, 0)
        : M.profileValue(profile, key);
      if (!val) continue;
      var ok = false;
      try { ok = await fillAntdModalPicker(inp, val, key); } catch (_) { ok = false; }
      if (ok) {
        filled += 1;
        if (filledKeys && filledKeys.indexOf(key) === -1) filledKeys.push(key);
        recordFill(inp, key, val);
      }
      // 没选中的弹窗要关掉，否则遮罩会把后面的下拉点击全吞掉
      var leftover = visibleAntdModal();
      if (leftover) {
        Array.prototype.forEach.call(leftover.querySelectorAll('button'), function (b) {
          if (/^取\s*消$/.test(String(b.textContent || '').trim())) { try { b.click(); } catch (_) { /* ignore */ } }
        });
        await sleep(220);
      }
    }
    return filled;
  }

  /**
   * v1.5.16：下拉选项和档案值常常是同义词不同写法
   * （档案写「应届生」，Moka 的选项是「应届毕业生」；写「本科」，选项是「学士」…）
   * 精确匹配失败时按同义组再找一轮。
   */
  var VALUE_SYNONYM_SETS = [
    ['应届生', '应届毕业生', '应届', '在校生', '应届毕业'],
    ['本科', '学士', '大学本科', '本科生'],
    ['硕士', '研究生', '硕士研究生', '硕士生'],
    ['博士', '博士研究生'],
    ['男', '男性', '先生'],
    ['女', '女性', '女士'],
    ['是', '接受', '同意', '可以', '服从'],
    ['否', '不接受', '不同意', '不服从']
  ];

  /**
   * v1.5.23：只取「被值包含的最长成员」所在的那一组。
   * 旧逻辑是「包含任一成员就算」：不接受调剂 ⊃ 接受 → 命中「是」组；博士研究生 ⊃ 研究生 → 命中硕士组。
   */
  function valueSynonymVariants(value) {
    var v = String(value == null ? '' : value).replace(/\s+/g, '');
    if (!v) return [];
    var bestLen = 0;
    var bestSets = [];
    VALUE_SYNONYM_SETS.forEach(function (set) {
      set.forEach(function (x) {
        if (v !== x && v.indexOf(x) === -1) return;
        var len = v === x ? 1000 : x.length;
        if (len > bestLen) { bestLen = len; bestSets = [set]; }
        else if (len === bestLen && bestSets.indexOf(set) === -1) bestSets.push(set);
      });
    });
    // 两个组打平（拿不准是哪一类）→ 不扩展
    if (bestSets.length !== 1) return [];
    var out = [];
    bestSets[0].forEach(function (x) { if (x !== v && out.indexOf(x) === -1) out.push(x); });
    return out;
  }

  function negationConflict(a, b) {
    return !!(M.hasNegationConflict && M.hasNegationConflict(a, b));
  }

  function matchOptionByVariants(opts, variants) {
    for (var i = 0; i < variants.length; i++) {
      var v = String(variants[i]).replace(/\s+/g, '');
      if (!v) continue;
      var exact = null;
      var contains = [];
      for (var j = 0; j < opts.length; j++) {
        var t = String((opts[j] && opts[j].text) || '').replace(/\s+/g, '');
        if (!t) continue;
        if (t === v) { exact = opts[j]; break; }
        if (t.indexOf(v) >= 0 && !negationConflict(t, v)) contains.push(opts[j]);
      }
      if (exact) return exact;
      // 多个选项都包含这个同义词：拿不准，换下一个同义词
      if (contains.length === 1) return contains[0];
    }
    return null;
  }

  /**
   * 联动下拉（语种 → 语言等级 / 省 → 市 / 学校 → 专业）：上一级没选，下一级根本没有选项。
   * 直接写第二级必然失败，所以按「先上一级 → 等选项刷新 → 再下一级 → 逐级回读」来做，
   * 具体实现放在 shared/select-chain.js（可被 DOM 测试直接驱动）。
   */
  async function fillLinkedSelectChains(profile, filledKeys) {
    var C = globalThis.ResumeAutofillSelectChain;
    if (!C || !C.fillChain) return 0;
    var langName = M.profileValue(profile, 'langName') || '';
    var langLevel = M.profileValue(profile, 'langLevel') || M.profileValue(profile, 'englishLevel') || '';
    if (!langName || !langLevel) return 0;
    // v1.6.0：多段外语（langList）：第 i 组「语种 → 等级」取第 i 条
    var rowLang = function (i, k, dflt) { return i === 0 ? dflt : (M.profileValueForOccurrence(profile, k, i) || ''); };

    // 收集带 label 的下拉宿主，按 label 归到「语种」/「语言等级」两桶
    var hosts = iterCustomSelectHosts();
    var langs = [];
    var levels = [];
    hosts.forEach(function (host) {
      var item = host.closest ? host.closest('.ant-form-item, .el-form-item, .form-item, .form-group, tr, .row') : null;
      if (!item) return;
      var lab = item.querySelector('.ant-form-item-label, .el-form-item__label, label');
      var label = lab ? String(lab.textContent || '').replace(/\s+/g, '').replace(/\*/g, '') : '';
      if (!label) return;
      var key = M.matchFieldKey(label, {});
      // 网申常用「语种/语言类型」作一级；旧关键词曾误落到 languages，这里再按标签兜底
      if (key === 'langName' || /^(语言类型|语种|语言种类)/.test(label)) langs.push({ host: host, label: label });
      else if (key === 'langLevel' || key === 'englishLevel' || /^(掌握程度|熟练程度|语言水平|语言等级|语言级别)/.test(label)) levels.push({ host: host, label: label });
    });

    var filled = 0;
    var n = Math.min(langs.length, levels.length);
    for (var i = 0; i < n; i++) {
      if (runDone.chain && runDone.chain.has(levels[i].host)) continue;
      var res = null;
      try {
        var ln = rowLang(i, 'langName', langName);
        var lv = rowLang(i, 'langLevel', langLevel);
        if (!ln || !lv) continue;
        res = await C.fillChain([
          { host: langs[i].host, value: ln, label: langs[i].label },
          { host: levels[i].host, value: lv, label: levels[i].label }
        ]);
      } catch (_) { res = null; }
      if (res && res.ok) {
        if (runDone.chain) runDone.chain.add(levels[i].host);
        filled += 1;
        ['langName', 'langLevel'].forEach(function (k) {
          if (filledKeys.indexOf(k) === -1) filledKeys.push(k);
        });
        recordFill(langs[i].host, 'langName', ln);
        recordFill(levels[i].host, 'langLevel', lv);
        fillRecords[fillRecords.length - 1].noCount = true;
        highlight(levels[i].host);
      }
    }
    return filled;
  }

  /** 应届/往届这类「是/否 ⇄ 两态词」的值映射 */
  var CHOICE_VALUE_MAP = {
    isFreshGraduate: { yes: '应届', no: '往届' }
  };

  function choiceValueFor(key, value, optionTexts) {
    var map = CHOICE_VALUE_MAP[key];
    var v = String(value || '').trim();
    if (!map || optionTexts.join(' ').indexOf(map.yes) === -1) return v;
    var yn = M.parseYesNo ? M.parseYesNo(v) : null;
    if (yn === 'Yes') return map.yes;
    if (yn === 'No') return map.no;
    return v;
  }

  function fillCustomSelect(host, value, key) {
    if (isPhoenixHost(host)) return fillPhoenixHost(host, value, key);
    if (isAntdV3SelectHost(host)) return fillAntdV3Select(host, value);
    return new Promise(function (resolve) {
      if (!host || !value) { resolve(false); return; }
      if (customSelectLooksFilled(host)) { resolve(false); return; }
      // 单选/多选组不是下拉：别在这里耗 2s 等一个永远不出现的弹层
      if (host.querySelector('input[type="radio"], input[type="checkbox"]')) { resolve(false); return; }
      // 先关掉别的下拉，否则会把别人家的选项当成自己的（快手的排名下拉就这么串过）
      closeOpenDropdowns();
      openCustomSelect(host);

      var waited = 0;
      var reopened = false;
      var typed = false;
      var opened = false;     // 点不开时用 ArrowDown 兜底展开（rc-select 认这个）
      var searched = false;   // 已经输过搜索词
      var retyped = false;    // 列表出来之后补输过一次
      var sigAtType = '';     // 输搜索词那一刻的选项指纹（远程搜索要等列表真的变了）
      // v1.5.24：只读（不可搜索）的下拉，选项出来、确认没有目标就立刻放弃；之前要空等 3~4 秒，
      // 一张表有几个对不上的下拉就会拖到整体超时
      var searchable = !!searchInputOf(host);
      var noMatchPolls = 0;
      var checkValue = value;

      function candidates() {
        return hostDropdownOptions(host) || collectOpenDropdownOptions();
      }

      // 记住「打开之前就在页面上的弹层」，只认新出现的那个


      function signature(opts) {
        return (opts || []).map(function (o) { return String(o.text || ''); }).join('|');
      }

      function poll() {
        var opts = candidates();
        var sig = signature(opts);
        if (opts.length && isDialCodeList(opts) && !/^\s*\+/.test(String(value))) {
          // 区号下拉（+86 / +82 …）不是给手机号用的，宁可不填
          closeOpenDropdowns();
          resolve(false);
          return;
        }
        if (opts.length) {
          var matched = M.findBestOption
            ? M.findBestOption(opts, value)
            : (M.matchSelectOption && M.matchSelectOption(opts, value));
          // 「是 / 否」遇到「应届毕业生 / 往届毕业生」这类两态选项：先换成对应的词
          if (!matched && CHOICE_VALUE_MAP[key]) {
            var cv = choiceValueFor(key, value, opts.map(function (o) { return String(o.text || ''); }));
            if (cv && cv !== value) {
              matched = M.findBestOption(opts, cv);
              if (matched) checkValue = cv;   // 选完核对时按换算后的词比（「应届毕业生」≠「是」）
            }
          }
          // 籍贯这类「省 / 市」两级下拉拿到的是整串，按行政区后缀切出能对上的那一段
          if (!matched) {
            var syns = valueSynonymVariants(value);
            if (syns.length) matched = matchOptionByVariants(opts, syns);
          }
          if (!matched) {
            var variants = regionPrefixVariants(value);
            for (var vi = variants.length - 1; vi >= 0 && !matched; vi--) {
              var text = variants[vi];
              var hit = opts.filter(function (o) { return String(o.text || '').replace(/\s+/g, '') === text; })[0];
              if (hit) matched = hit;
            }
          }
          if (matched) { pick(opts, matched); return; }
          if (!searchable) {
            noMatchPolls += 1;
            // 多等一拍防止列表还在渲染（虚拟列表 / 动画），两次都对不上就是真没有
            if (noMatchPolls >= 2) { closeOpenDropdowns(); resolve(false); return; }
          }
          if (searched && sigAtType && sig !== sigAtType) {
            // 搜过了、列表也真的变了（远程搜索回来了）还是没有 → 这个下拉确实没这个值
            closeOpenDropdowns();
            resolve(false);
            return;
          }
          // 弹层还没开就先输了搜索词：等列表出来再补输一次，否则永远等不到筛选结果
          if (searched && !sigAtType && !retyped) {
            retyped = true;
            sigAtType = sig;
            typeIntoSearch(host, value);
          }
          // 远程搜索（快手学校/专业）1.5s 才回来：输了没反应就再输一次，别提前放弃
          if (searched && sigAtType && sig === sigAtType && !retyped && waited >= 1500) {
            retyped = true;
            typeIntoSearch(host, value);
          }
        }
        // 没匹配上：试「输入搜索」（学校 / 专业这类可搜索下拉）
        // 合成点击有时打不开 antd 的下拉（快手的「专业」就是这样）：
        // 聚焦后用方向键展开，rc-select 认这个键
        if (!opened && !opts.length && waited >= 300) {
          opened = true;
          var fi = host.querySelector('input:not([type="hidden"])');
          if (fi) {
            try { fi.focus(); } catch (_) { /* ignore */ }
            ['keydown', 'keyup'].forEach(function (t) {
              try {
                fi.dispatchEvent(new KeyboardEvent(t, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
              } catch (_) { /* ignore */ }
            });
          }
        }
        // 可搜索：选项一出来没对上就马上输搜索词（之前固定等 420ms）；弹层没出来时也输（远程搜索要先输才有列表）
        if (!typed && searchable && String(value).length > 1 && (opts.length || waited >= 420)) {
          typed = true;
          sigAtType = sig;
          searched = typeIntoSearch(host, value);
        }
        if (waited >= (searched ? 3600 : (searchable ? 2400 : 1800))) {
          closeOpenDropdowns();
          resolve(false);
          return;
        }
        if (!reopened && waited >= 1200 && !typed) {
          reopened = true;
          openCustomSelect(host);
        }
        waited += 150;
        setTimeout(poll, 150);
      }
      setTimeout(poll, 180);

      function pick(opts, matched) {
        if (!opts || !opts.length) { resolve(false); return; }
        var want = matched || opts[0];
        var wantNorm = M.normalizeOptionText
          ? M.normalizeOptionText(want.text || want.value)
          : String(want.text || want.value || '').toLowerCase();
        var hit = null;
        for (var i = 0; i < opts.length; i++) {
          var tn = M.normalizeOptionText
            ? M.normalizeOptionText(opts[i].text)
            : String(opts[i].text || '').toLowerCase();
          if (tn === wantNorm || opts[i].text === want.text) { hit = opts[i]; break; }
        }
        if (!hit) hit = want;
        var wantText = String(want.text || want.value || '');
        // 点之前先核对一遍：拿不准的宁可不点，别把「斯威本科技大学」这种填进学校
        if (!optionTextPlausible(wantText, checkValue)) { closeOpenDropdowns(); resolve(false); return; }
        simulateClick(hit.el);
        setTimeout(function () {
          // 这里千万别 closeOpenDropdowns()：rc-select 的 Esc 会把旧值还原，
          // 刚选好的学校就被撤回去了（快手实测）
          var shown = customSelectText(host);
          // 只跟「要填的值」比：跟匹配到的选项比等于自证，斯威本科技大学就是这么混过去的
          if (optionTextPlausible(shown, checkValue)) { resolve(true); return; }
          // 选歪了：撤掉，按失败处理（宁可空着，也别留个错的）
          clearCustomSelect(host);
          resolve(false);
        }, 260);
      }
    });
  }

  /** 扫描页面上的自定义下拉宿主（无 native select 时） */
  function iterCustomSelectHosts() {
    // v1.5.24：归一化 + 去重 —— .el-select 里那个 role=combobox 的 input、日期控件外层的 combobox
    // 都不是独立的下拉（之前同一个下拉会被当成两个各试一遍，对不上时白耗两倍时间）
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll(CUSTOM_SELECT_HOST), function (h) {
      if (!(isVisibleEl(h) || h.offsetParent !== null)) return;
      var n = findCustomSelectHost(h);
      if (!n) return;
      var outer = n.parentElement && n.parentElement.closest(CUSTOM_SELECT_HOST);
      if (outer && findCustomSelectHost(outer) === outer && outer !== n) n = outer;
      if (out.indexOf(n) === -1) out.push(n);
    });
    return out;
  }


  /** 可见性判断：offsetParent 在 position:fixed 弹层里恒为 null，改用 rect + computedStyle */
  function isVisibleEl(n) {
    if (!n || n.nodeType !== 1) return false;
    var rect = n.getBoundingClientRect ? n.getBoundingClientRect() : null;
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    try {
      var st = window.getComputedStyle(n);
      if (!st || st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    } catch (_) { /* ignore */ }
    return true;
  }

  /** 在可见层里找与目标值匹配的选项节点（只返回容器式叶子节点） */
  function pickVisibleCandidates(desired) {
    var want = String(desired || '').replace(/\s+/g, ' ').trim();
    if (!want) return [];
    var nodes = document.querySelectorAll('[role="option"], li, dd, .option, .picker-item, .list-item, .dropdown-item, .weui-cell');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var txt = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 40 || PICKER_BLOCK_RE.test(txt)) continue;
      if (!isVisibleEl(n)) continue;
      if (n.querySelector('input, textarea, select')) continue;
      var score = 0;
      if (txt === want) score = 3;
      else if (txt.indexOf(want) === 0 || want.indexOf(txt) === 0) score = 2;
      else if (txt.indexOf(want) !== -1) score = 1;
      if (!score) continue;
      out.push({ el: n, score: score, len: txt.length });
    }
    out.sort(function (a, b) { return b.score - a.score || a.len - b.len; });
    return out.slice(0, 4);
  }

  /**
   * 点击 readonly 输入框 → 在弹出层里按文本选值 → 回读验证。
   * 失败时不强写 value（readonly 写了也不生效），并返回 false 供上层记录原因。
   */
  /** 选项值是否就是我们想要的目标值（严格比对，避免“值变了”就算成功） */
  function pickerValueMatches(actual, desired) {
    var a = normalizeChoiceText(actual);
    var w = normalizeChoiceText(desired);
    if (!a || !w) return false;
    if (a === w) return true;
    // 日期/薪资等带格式差异：允许一侧包含另一侧（至少 4 位，避免 "26" 命中 "2026"）
    if (a.length >= 4 && w.length >= 4 && (a.indexOf(w) !== -1 || w.indexOf(a) !== -1)) return true;
    return false;
  }

  // 导出
  C.RADIO_SAFE_KEYS = RADIO_SAFE_KEYS;
  C.isCurrentJobValue = isCurrentJobValue;
  C.looksLikeDateInput = looksLikeDateInput;
  C.valueCandidates = valueCandidates;
  C.clickCurrentJobToggle = clickCurrentJobToggle;
  C.isReadonlyPicker = isReadonlyPicker;
  C.isAntdV3Picker = isAntdV3Picker;
  C.antdV3Panel = antdV3Panel;
  C.simulateClick = simulateClick;
  C.findCustomSelectHost = findCustomSelectHost;
  C.hostOwnText = hostOwnText;
  C.customSelectLooksFilled = customSelectLooksFilled;
  C.customSelectText = customSelectText;
  C.fillModalPickers = fillModalPickers;
  C.negationConflict = negationConflict;
  C.fillLinkedSelectChains = fillLinkedSelectChains;
  C.choiceValueFor = choiceValueFor;
  C.fillCustomSelect = fillCustomSelect;
  C.iterCustomSelectHosts = iterCustomSelectHosts;
  C.isVisibleEl = isVisibleEl;
  C.pickVisibleCandidates = pickVisibleCandidates;
  C.pickerValueMatches = pickerValueMatches;
})();
