/**
 * 简历填写工具 — 内容脚本
 * 依赖 shared/match.js（须在 manifest content_scripts 中先于本文件加载）。
 * FILL_FORM / SCAN_FIELDS / COLLECT_FIELDS / APPLY_MAPPINGS
 * 不自动提交；不填 password/file；不盲勾 checkbox。
 * v1.3.5: 年/月/日 三件套（原生 select 组）、分页下拉、滚轮选列、英文表头。
 * v1.3.4: 日历网格型日期面板（翻月 + 点日，最外层面板判定）。
 * v1.3.3: 多表格日期面板（年/月/日 分组识别 + 确定按钮）。
 * v1.3.2: 表格布局（td/th 左列）与 Element-UI 下拉的标签发现，修复下拉选单填不上。
 * v1.3.1: 搜索框跳过 + readonly 弹层选择器点击 + 无名 radio 白名单；skipped 原因上报。
 * v1.3.0: D10 相邻年/月 placeholder 对 + 附近日期组标签；D9 拆分失败跳过。
 * v1.2.3: getLabelText 支持 antd/form-item、aria-labelledby；年/月日期拆分；hints 优先标签。
 * v1.2.2: getLabelText 用 visibleLabelText；已填字段 skip-if-filled（不覆盖）。
 */
(function () {
  'use strict';

  var M = globalThis.ResumeAutofillMatch;
  if (!M) {
    console.warn('[简历填写工具] ResumeAutofillMatch 未加载');
    return;
  }

  var MAX_FILLS_PER_KEY = M.MAX_FILLS_PER_KEY;

  function getLabelText(el) {
    // 1. label[for]
    if (el.id) {
      try {
        var label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (label) {
          var tFor = M.visibleLabelText(label);
          if (tFor) return tFor;
        }
      } catch (_) { /* ignore */ }
    }
    // 1b. wrapping label
    var parentLabel = el.closest('label');
    if (parentLabel) {
      var tWrap = M.visibleLabelText(parentLabel);
      if (tWrap) return tWrap;
    }
    // 1c. aria-label
    var aria = el.getAttribute('aria-label');
    if (aria && String(aria).trim()) return String(aria).trim();
    // 1d. aria-describedby
    var describedBy = el.getAttribute('aria-describedby');
    if (describedBy) {
      var desc = document.getElementById(describedBy);
      if (desc) {
        var tDesc = String(desc.textContent || '').replace(/\s+/g, ' ').trim();
        if (tDesc) return tDesc;
      }
    }
    // 2. aria-labelledby
    if (M.resolveAriaLabelledByText) {
      var tAria = M.resolveAriaLabelledByText(el, function (id) {
        return document.getElementById(id);
      });
      if (tAria) return tAria;
    }
    // 3. form-item container (antd / element / semi / formily)
    if (M.labelTextFromFormItem) {
      var tForm = M.labelTextFromFormItem(el);
      if (tForm) return tForm;
    }
    // 4. previousElementSibling
    var prev = el.previousElementSibling;
    if (prev && /^(LABEL|SPAN|DIV|P|STRONG)$/i.test(prev.tagName)) {
      var tPrev = M.visibleLabelText
        ? M.visibleLabelText(prev)
        : String(prev.textContent || '');
      tPrev = String(tPrev || '').replace(/\s+/g, ' ').trim();
      if (M.cleanLabelPunctuation) tPrev = M.cleanLabelPunctuation(tPrev);
      if (tPrev) return tPrev;
    }
    // 5. parent's previousElementSibling (label-col | control-col)
    if (M.labelTextFromParentPrevSibling) {
      var tCol = M.labelTextFromParentPrevSibling(el);
      if (tCol) return tCol;
    }
    // 6. 表格布局（Redsea / 老 HR 系统）：字段名在左侧单元格
    var cell = el.closest ? el.closest('td, th') : null;
    if (cell) {
      var prevCell = cell.previousElementSibling;
      if (prevCell) {
        var tCell = M.visibleLabelText
          ? M.visibleLabelText(prevCell)
          : String(prevCell.textContent || '');
        tCell = String(tCell || '').replace(/\s+/g, ' ').trim();
        if (M.cleanLabelPunctuation) tCell = M.cleanLabelPunctuation(tCell);
        if (tCell && tCell.length <= 40) return tCell;
      }
    }
    // 7. Element-UI 自定义下拉：标题常在控件容器的前一个兄弟节点
    var selBox = el.closest
      ? el.closest('.dictionary-selector, .el-select, .form-select, .ant-select')
      : null;
    if (selBox) {
      var pv = selBox.previousElementSibling;
      if (pv) {
        var tPv = M.visibleLabelText ? M.visibleLabelText(pv) : String(pv.textContent || '');
        tPv = String(tPv || '').replace(/\s+/g, ' ').trim();
        if (M.cleanLabelPunctuation) tPv = M.cleanLabelPunctuation(tPv);
        if (tPv && tPv.length <= 40) return tPv;
      }
    }
    return '';
  }

  /**
   * 判断字段是否已有有效值；已填则跳过，避免覆盖用户/先前填写。
   * select：无选中、或选中项 value 空且文案像占位（Select/请选择/--）→ 空。
   * input/textarea（非 checkbox/radio）：trim 后非空 → 已填。
   * checkbox/radio：不在此改动（仍不自动勾选）。
   */
  function fieldLooksFilled(el) {
    if (!el) return false;
    var tag = el.tagName.toLowerCase();
    var type = (el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return false;
    if (tag === 'select') {
      var opt = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      if (!opt) return false;
      var v = String(opt.value || '').trim();
      var t = String(opt.text || '').trim();
      if (!v && (!t || /select|choose|请选择|选择|--/i.test(t))) return false;
      return true;
    }
    return String(el.value || '').trim() !== '';
  }

  /**
   * Moka 等：同父/祖父内仅有 placeholder「年」「月」的互补输入对。
   * @returns {'year'|'month'|null}
   */
  function detectAdjacentDatePairRole(el) {
    if (!el || !el.getAttribute) return null;
    var ph = String(el.getAttribute('placeholder') || '').trim();
    var ourRole = null;
    if (/^(年|year|yyyy)$/i.test(ph)) ourRole = 'year';
    else if (/^(月|month|mm)$/i.test(ph)) ourRole = 'month';
    else return null;
    var wantRe = ourRole === 'year' ? /^(月|month|mm)$/i : /^(年|year|yyyy)$/i;
    var containers = [];
    if (el.parentElement) containers.push(el.parentElement);
    if (el.parentElement && el.parentElement.parentElement) {
      containers.push(el.parentElement.parentElement);
    }
    var c, inputs, i, other, otherPh;
    for (c = 0; c < containers.length; c++) {
      try {
        inputs = containers[c].querySelectorAll('input');
      } catch (_) {
        continue;
      }
      for (i = 0; i < inputs.length; i++) {
        other = inputs[i];
        if (other === el) continue;
        otherPh = String(other.getAttribute('placeholder') || '').trim();
        if (wantRe.test(otherPh)) return ourRole;
      }
    }
    return null;
  }

  function collectHints(el) {
    var label = getLabelText(el);
    var adjacentRole = detectAdjacentDatePairRole(el);
    var groupLabel = '';
    if ((!label || !String(label).trim()) && adjacentRole && M.findNearbyDateGroupLabelText) {
      groupLabel = M.findNearbyDateGroupLabelText(el) || '';
    }
    var primaryLabel = (label && String(label).trim()) ? label : groupLabel;
    var parts = [
      primaryLabel,
      el.getAttribute('placeholder'),
      el.name,
      el.id,
      el.getAttribute('aria-label'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-automation-id')
    ];
    // 已有有用标签时不倾倒 antd 长 className；否则仅保留语义 token
    if (!primaryLabel || !String(primaryLabel).trim()) {
      var cn = typeof el.className === 'string' ? el.className : '';
      var sem = M.semanticClassTokens ? M.semanticClassTokens(cn) : '';
      if (sem) parts.push(sem);
    }
    return parts.filter(Boolean).join(' ');
  }

  function matchKeyForElement(el) {
    return M.matchFieldKey(collectHints(el), {
      autocomplete: el.getAttribute('autocomplete') || ''
    });
  }

  function hintSnippet(el) {
    var raw = [
      getLabelText(el),
      el.getAttribute('placeholder'),
      el.name,
      el.id
    ].filter(Boolean).join(' | ');
    raw = String(raw || '').replace(/\s+/g, ' ').trim();
    if (raw.length > 80) raw = raw.slice(0, 77) + '…';
    return raw || (el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : ''));
  }

  /**
   * v1.3.1: 搜索框（“请输入关键字查找”类）不是简历字段，填进去只会污染命中结果。
   */
  function isSearchBox(el) {
    var ph = String((el.getAttribute && el.getAttribute('placeholder')) || '');
    var aria = String((el.getAttribute && el.getAttribute('aria-label')) || '');
    var name = String(el.name || '');
    return /搜索|查找|关键字|检索|search/i.test(ph) ||
      /搜索|查找|检索|search/i.test(aria) ||
      /search|keyword/i.test(name);
  }

  function isSkippable(el) {
    var t = (el.type || '').toLowerCase();
    return (
      t === 'hidden' ||
      t === 'submit' ||
      t === 'button' ||
      t === 'image' ||
      t === 'reset' ||
      t === 'file' ||
      t === 'password' ||
      el.disabled ||
      isSearchBox(el)
    );
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

  function highlight(el) {
    el.style.outline = '2px solid #22c55e';
    setTimeout(function () {
      el.style.outline = '';
    }, 2000);
  }

  function iterFillableFields() {
    return Array.from(document.querySelectorAll('input, textarea, select')).filter(
      function (el) { return !isSkippable(el); }
    );
  }

  function scanFields() {
    var results = [];
    var seen = {};
    iterFillableFields().forEach(function (el) {
      var scored = M.matchFieldKeyScored
        ? M.matchFieldKeyScored(collectHints(el), {
            autocomplete: el.getAttribute('autocomplete') || ''
          })
        : null;
      var key = scored ? scored.key : matchKeyForElement(el);
      if (!key) return;
      var sig = key + '|' + (el.name || el.id || hintSnippet(el));
      if (seen[sig]) return;
      seen[sig] = true;
      results.push({
        key: key,
        hint: hintSnippet(el),
        confidence: scored ? scored.confidence : 1,
        method: scored ? scored.method : 'keyword'
      });
    });
    return results;
  }

  /**
   * 收集可填字段描述，供 AI / 启发式映射。
   */
  function collectFieldsDetailed() {
    var els = iterFillableFields();
    return els.map(function (el, index) {
      var tag = el.tagName.toLowerCase();
      var type = (el.type || '').toLowerCase();
      var label = String(getLabelText(el) || '').replace(/\s+/g, ' ').trim();
      if (label.length > 120) label = label.slice(0, 117) + '…';
      var item = {
        index: index,
        tag: tag,
        type: type,
        name: el.name || '',
        id: el.id || '',
        label: label,
        placeholder: el.getAttribute('placeholder') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        currentValue: ''
      };
      try {
        if (tag === 'select') {
          item.currentValue = el.value || '';
          item.options = Array.from(el.options).slice(0, 40).map(function (o) {
            return { value: o.value, text: String(o.text || '').trim() };
          });
        } else if (type !== 'checkbox' && type !== 'radio') {
          item.currentValue = el.value || '';
        }
      } catch (_) { /* ignore */ }
      return item;
    });
  }

  // ————— v1.3.1：readonly 弹层选择器 + 无名 radio 组 —————

  /** 肯定不能点的选项文案（防止误触提交类按钮） */
  var PICKER_BLOCK_RE = /^(提交|保存|取消|关闭|确定删除|删除|清除|重置|退出|submit|save|cancel|close|reset|delete)$/i;

  /** 允许自动勾选的单选组（语义容易误判的组不在此列） */
  var RADIO_SAFE_KEYS = { gender: 1, maritalStatus: 1, politicalStatus: 1, ethnicity: 1 };

  function isReadonlyPicker(el) {
    if (!el || el.disabled || !el.readOnly) return false;
    var t = (el.type || 'text').toLowerCase();
    return t === 'text' || t === 'search' || t === 'tel' || t === 'number';
  }

  function simulateClick(el) {
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.click();
    } catch (_) {
      try { el.click(); } catch (e) { /* ignore */ }
    }
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


  // ————— v1.3.3：多表格日期面板（年/月/日 分栏）—————

  var DATE_PANEL_SEL = '.layui-laydate, .laydate, .el-picker-panel, .el-date-picker, ' +
    '.ant-picker-dropdown, .flatpickr-calendar, [class*="datepicker"], [class*="date-picker"], ' +
    '[class*="datePicker"], [class*="calendar"], [class*="DatePicker"]';

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function parseDateParts(value) {
    var m = String(value || '').match(/(\d{4})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
    if (!m) return null;
    return { y: m[1], m: String(parseInt(m[2], 10)), d: String(parseInt(m[3], 10)) };
  }

  /** 列表容器常与“确定/箭头”同父：往上找带按钮的容器，最多 2 层 */
  function expandToActionableHost(host) {
    var h = host;
    for (var up = 0; up < 2 && h && h.parentElement; up++) {
      var hasBtn = h.querySelectorAll('button, [class*="arrow"], [role="button"]').length > 0;
      var txt = String(h.textContent || '');
      var hasConfirm = /确定|确认|完成|OK|ok/.test(txt);
      if (hasBtn || hasConfirm) return h;
      var parent = h.parentElement;
      // 只在“仍像弹层”的范围内上溯，避免退到 body 把整页当面板
      if (String(parent.textContent || '').length > 2000) break;
      h = parent;
    }
    return h || host;
  }

  /** 可见的日期面板：先按常见类名找；找不到就按“含年份文本的可见 table/ul”兜底 */
  function findDatePanel(yearText) {
    var byClass = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll(DATE_PANEL_SEL), function (n) {
        if (!isVisibleEl(n)) return;
        var b = n.getBoundingClientRect();
        // 排除标题/图标等碎片（如 .el-date-picker__header-label 也含 date-picker 字样）
        if (b.width < 150 || b.height < 90) return;
        byClass.push(n);
      });
    } catch (_) { /* ignore */ }
    if (byClass.length) {
      // 只保留最外层，避免抓到面板内部的子块
      var roots = byClass.filter(function (n) {
        return !byClass.some(function (m) { return m !== n && m.contains(n); });
      });
      var list = roots.length ? roots : byClass;
      return expandToActionableHost(list[list.length - 1]);
    }
    // 兜底 1：没有 class 线索时，找可见的日历网格（星期表头或可用日格）
    var grids = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll('table'), function (t) {
        if (!isVisibleEl(t)) return;
        var txt = String(t.textContent || '');
        var isGrid = looksLikeWeekHeader(txt) ||
          !!t.querySelector('td[class*="available"], td[class*="prev-month"], td[class*="next-month"]');
        if (!isGrid) return;
        var host = t.closest('[class*="picker"], [class*="panel"], [class*="popup"], [class*="dropdown"], [class*="calendar"], [class*="date"]') || t;
        // 翻页箭头常在表格外的 header 里：往上找带按钮的容器
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
    // 兜底 0：滚轮/分栏（div + ul 列），找同时含 年/月/日 三组数字的最内层容器
    var numericHost = null;
    try {
      var pool = document.querySelectorAll('div, section, dl, table');
      for (var pi = 0; pi < pool.length && pi < 800; pi++) {
        var n = pool[pi];
        if (!isVisibleEl(n)) continue;
        if (String(n.textContent || '').length > 3000) continue;
        var leaves = n.querySelectorAll('li, td, dd').length;
        if (leaves < 6 || leaves > 400) continue;
        var gs = numericGroups(n);
        var types = {};
        gs.forEach(function (g) { types[g.type] = 1; });
        if (types.year && types.month && types.day) {
          if (!numericHost || numericHost.contains(n)) numericHost = n;
        }
      }
    } catch (_) { /* ignore */ }
    if (numericHost) return expandToActionableHost(numericHost);

    if (!yearText) return null;
    var generic = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll('table, ul, [class*="list"], [class*="panel"], [class*="popup"], [class*="dropdown"]'), function (n) {
        if (!isVisibleEl(n)) return;
        var txt = String(n.textContent || '');
        if (txt.indexOf(yearText) === -1) return;
        generic.push(n);
      });
    } catch (_) { /* ignore */ }
    return generic.length ? expandToActionableHost(generic[generic.length - 1]) : null;
  }

  /** 在面板里点一个“文本等于目标数字”的叶子项（年/月/日通用） */
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

  /** 面板里的确认按钮（确定/确认/完成/OK）——有些日期面板点完还要确认 */
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
      if (!part && n.tagName === 'SELECT') {
        var mx = maxOptionNumber(n);
        if (mx >= 1900) { part = 'y'; yearSelect = true; }
        else if (mx <= 12 && n.options.length >= 2) part = 'm';
        else if (mx <= 31 && n.options.length >= 2) part = 'd';
      }
      if (!part) part = ['y', 'm', 'd'][idx] || null;
      if (part && !parts[part]) parts[part] = n;
    });

    var has = (parts.y ? 1 : 0) + (parts.m ? 1 : 0) + (parts.d ? 1 : 0);
    if (has < 2) return null;
    // 收紧：必须「有年份 select」或「三段都有明确年/月/日字样」，避免把普通两个输入框当日期组
    if (!yearSelect && !(explicit.y && explicit.m && explicit.d)) {
      if (!(parts.y && parts.m && parts.d && explicit.y + explicit.m + explicit.d >= 2)) return null;
    }
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
    var okCount = 0;
    var needCount = 0;
    var keys = Object.keys(grp);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var node = grp[k];
      members.push(node);
      needCount += 1;
      if (node.tagName === 'SELECT') {
        if (setSelectByNumber(node, want[k])) okCount += 1;
      } else if (isReadonlyPicker(node)) {
        var pickOk = await fillReadonlyPicker(node, k === 'y' ? want.y : (k === 'm' ? want.m : want.d));
        if (pickOk) okCount += 1;
      } else if (setNativeValue(node, want[k])) {
        okCount += 1;
      }
    }
    return { members: members, ok: needCount > 0 && okCount === needCount };
  }

  // ————— v1.3.4：日历网格型日期面板（‹‹ ‹ 十月 2026 › ›› + 星期表头 + 单月网格）—————

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

  function isCalendarGrid(panel) {
    if (!panel) return false;
    if (panel.querySelector('td.prev-month, td.next-month, td.current, .el-date-table, .laydate-theme-grid')) return true;
    var dayBtn = panel.querySelector('td[class*="available"], td[class*="disabled"]');
    if (dayBtn) return true;
    var t = String(panel.textContent || '');
    if (looksLikeWeekHeader(t)) return true;
    // 7 列、≥28 个 1~31 的数字格也当网格
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

  /** 找翻页箭头：unit=year 用双箭头(d-arrow-*)，unit=month 用单箭头(arrow-*) */
  function pickArrow(panel, dir, unit) {
    var suffix = dir < 0 ? 'left' : 'right';
    var cls = unit === 'year' ? '.d-arrow-' + suffix : '.arrow-' + suffix;
    var byCls = panel.querySelector(cls);
    if (byCls && isVisibleEl(byCls)) return byCls;
    // 兜底：按方向 + 文本/属性猜
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

  /** 面板自带「年 / 月」下拉或年份输入框时直接设值（flatpickr / laydate 风格） */
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

  /** 翻到目标年月（先按整年跳，再按月跳） */
  async function gridNavigate(panel, y, m) {
    // ① 面板里若有「年 / 月」下拉或年份输入框，直接设值（跳得更准）
    if (setPanelPeriod(panel, y, m)) await sleep(180);
    var monthOnly = false;
    var maxIter = 60;
    for (var guard = 0; guard < maxIter; guard++) {
      var cur = gridHeader(panel);
      if (!cur.year || !cur.month) return false;
      var d = (y * 12 + m) - (cur.year * 12 + cur.month);
      if (d === 0) return true;
      var unit = Math.abs(d) >= 12 ? 'year' : 'month';
      var btn = pickArrow(panel, d < 0 ? -1 : 1, unit);
      if (!btn) {
        // 没有年份箭头：只按月翻，放宽上限（最多 ~320 次）
        if (!monthOnly) { monthOnly = true; maxIter = 320; }
        btn = pickArrow(panel, d < 0 ? -1 : 1, 'month');
        if (!btn) return false;
      }
      var beforeHdr = cur;
      simulateClick(btn);
      await sleep(unit === 'year' ? 140 : (monthOnly ? 70 : 120));
      // 期望跳一年却只挪了一个月 → 说明那其实是月份箭头
      if (unit === 'year' && !monthOnly) {
        var afterHdr = gridHeader(panel);
        var moved = (afterHdr.year && beforeHdr.year) ? ((beforeHdr.year * 12 + beforeHdr.month) - (afterHdr.year * 12 + afterHdr.month)) : 0;
        var want = d < 0 ? 12 : -12;
        if (moved !== want) { monthOnly = true; maxIter = 320; }
      }
    }
    return false;
  }

  /** 在网格里点当月的那一天（排除上/下月补位与禁用格） */
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

  async function tryCalendarGrid(el, desired) {
    var parts = parseDateParts(desired);
    if (!parts) return false;
    var panel = findDatePanel(parts.y);
    if (!panel) return false;
    var navOk = await gridNavigate(panel, parseInt(parts.y, 10), parseInt(parts.m, 10));
    if (!navOk) return false;
    await sleep(150);
    panel = findDatePanel(parts.y) || panel;
    var dayOk = gridClickDay(panel, parseInt(parts.d, 10));
    if (!dayOk) return false;
    await sleep(220);
    if (!dateValueMatches(el.value, desired)) {
      var again = findDatePanel(parts.y);
      if (again) clickPanelConfirm(again);
      await sleep(260);
    }
    return true;
  }

  /** 把面板里的数字列表分组：年份组(>=1900) / 月份组(<=12) / 日期组(<=31) */
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

  /** 依次点 年 → 月 → 日；每步按“分组类型”重新定位（面板常被整体重渲染） */
  async function tryDatePanel(el, desired) {
    var parts = parseDateParts(desired);
    if (!parts) return false;
    var root = findDatePanel(parts.y);
    if (!root) return false;
    // 上溯到能同时看到多组数字列表的祖先（多表格面板的公共容器）
    var scope = root;
    for (var u = 0; u < 4 && scope.parentElement; u++) {
      var types = {};
      numericGroups(scope).forEach(function (g) { types[g.type] = 1; });
      if (Object.keys(types).length >= 2) break;
      scope = scope.parentElement;
    }
    var step = function (text, type) {
      var groups = numericGroups(scope).filter(function (g) { return g.type === type; });
      for (var i = 0; i < groups.length; i++) {
        if (clickPanelItem(groups[i].el, text, null)) return true;
      }
      return false;
    };
    var g0 = numericGroups(scope).map(function (g) { return g.type + ':' + g.count; });
    var okY = step(parts.y, 'year');
    if (!okY) return false;
    await sleep(220);
    var okM = step(parts.m, 'month');
    if (!okM) return false;
    await sleep(220);
    var okD = step(parts.d, 'day');
    if (!okD) return false;
    await sleep(180);
    if (!dateValueMatches(el.value, desired)) {
      if (!clickPanelConfirm(scope)) clickPanelConfirm(findDatePanel(parts.y) || scope);
    }
    await sleep(300);
    return true;
  }

  /** 目标是否已是完整日期（允许 1998-05-20 / 1998/5/20 / 1998年05月20日） */
  function dateValueMatches(actual, desired) {
    var a = parseDateParts(actual);
    var w = parseDateParts(desired);
    if (a && w) {
      return a.y === w.y && parseInt(a.m, 10) === parseInt(w.m, 10) && parseInt(a.d, 10) === parseInt(w.d, 10);
    }
    return pickerValueMatches(actual, desired);
  }

  function findPagerNext() {
    var nodes = document.querySelectorAll('a, button, span, div, i, li');
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

  function fillReadonlyPicker(el, desired) {
    var before = String(el.value || '');
    simulateClick(el);
    return new Promise(function (resolve) {
      setTimeout(async function () {
        // ① 先试「年 / 月 / 日」多表格日期面板
        var parts = parseDateParts(desired);
        var pid = parts ? findDatePanel(parts.y) : null;
        if (parts && pid) {
          // ② 日历网格（‹‹ ‹ 十月 2026 › ›› + 星期表头）走翻月 + 点日；其余走年/月/日分栏
          var panelOk = isCalendarGrid(pid)
            ? await tryCalendarGrid(el, desired)
            : await tryDatePanel(el, desired);
          if (panelOk && dateValueMatches(el.value, desired)) { resolve(true); return; }
          // 面板路径失败：重开再走普通候选路径
          simulateClick(el);
          await sleep(300);
        }
        var cands = pickVisibleCandidates(desired);
        if (!cands.length) {
          cands = await pageUntilFound(desired);
        }
        if (!cands.length) { resolve(false); return; }
        var i = 0;
        var tryNext = function () {
          if (i >= cands.length) {
            // 全部失败：尽量还原原值，避免留下错值
            if (String(el.value || '') !== before) {
              try { simulateClick(el); } catch (_) { /* ignore */ }
            }
            resolve(false);
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

  /** 取 radio 的选项文案 */
  function radioOptionText(radio) {
    var lab = radio.closest ? radio.closest('label') : null;
    if (lab) {
      var t = M.visibleLabelText ? M.visibleLabelText(lab) : lab.textContent;
      t = String(t || '').replace(/\s+/g, ' ').trim();
      if (t) return t.slice(0, 30);
    }
    var p = radio.parentElement;
    return String((p && p.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  }

  /** 无名 radio 分组：同一容器内 ≥2 个无 name 的 radio */
  function collectUnnamedRadioGroups() {
    var radios = Array.from(document.querySelectorAll('input[type=radio]')).filter(function (r) {
      return !r.disabled && !r.name && r.offsetParent;
    });
    var groups = [];
    var used = {};
    radios.forEach(function (r) {
      if (used[r.id || ''] && r.id) return;
      var node = r.parentElement;
      for (var up = 0; up < 4 && node; up++, node = node.parentElement) {
        var inside = Array.from(node.querySelectorAll('input[type=radio]')).filter(function (x) {
          return !x.disabled && !x.name && x.offsetParent;
        });
        if (inside.length >= 2 && String(node.textContent || '').length < 180) {
          if (groups.indexOf(node) === -1) groups.push(node);
          return;
        }
      }
    });
    return groups;
  }

  /** 组文案：容器内非选项文本的首段，或前一个兄弟节点 */
  function radioGroupLabelName(container) {
    var texts = [];
    var walk = function (node, depth) {
      if (depth > 2 || !node) return;
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (!kid || kid.nodeType !== 1) continue;
        if (/^(INPUT|LABEL)$/i.test(kid.tagName)) continue;
        var t = String(kid.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 24 && !/^[男女是否]$/.test(t)) { texts.push(t); return; }
        walk(kid, depth + 1);
        if (texts.length) return;
      }
    };
    walk(container, 0);
    if (texts.length) return texts[0];
    var prev = container.previousElementSibling;
    if (prev) {
      var t2 = String(prev.textContent || '').replace(/\s+/g, ' ').trim();
      if (t2 && t2.length <= 24) return t2;
    }
    return '';
  }

  function normalizeChoiceText(s) {
    return String(s || '').replace(/[\s\u3000:：*]/g, '').toLowerCase();
  }

  /** 在组内按 profile 值选中对应 radio（只点，不伪造 value） */
  function fillRadioGroup(container, key, value) {
    var want = normalizeChoiceText(value);
    if (!want) return false;
    var radios = Array.from(container.querySelectorAll('input[type=radio]')).filter(function (r) {
      return !r.disabled && !r.name && r.offsetParent;
    });
    for (var i = 0; i < radios.length; i++) {
      var opt = normalizeChoiceText(radioOptionText(radios[i]));
      if (!opt) continue;
      if (opt === want || (opt.length >= 2 && want.indexOf(opt) !== -1)) {
        simulateClick(radios[i]);
        if (radios[i].checked) { highlight(radios[i]); return true; }
      }
    }
    return false;
  }

  async function fillFromProfile(profile, options) {
    var opts = options || {};
    var filled = 0;
    var filledKeys = [];
    var skipped = [];
    var keyCounts = {};
    var els = iterFillableFields();
    var groupHandled = typeof WeakSet === 'function' ? new WeakSet() : null;

    for (var idx = 0; idx < els.length; idx++) {
      var el = els[idx];
      if (groupHandled && groupHandled.has(el)) continue;
      var key = matchKeyForElement(el);
      if (!key) continue;
      var count = keyCounts[key] || 0;
      if (count >= MAX_FILLS_PER_KEY) continue;
      var value = M.profileValue(profile, key);
      if (!value) {
        if (skipped.length < 12) skipped.push({ key: key, reason: 'no_profile_value' });
        continue;
      }
      if (fieldLooksFilled(el)) continue;
      var hints = collectHints(el);
      var adjacentRole = detectAdjacentDatePairRole(el);
      var dateOpts = {
        profileKey: key,
        adjacentPairRole: adjacentRole || undefined
      };
      if (M.maybeExtractDatePartValue && (M.isDatePartProfileKey(key) || M.detectDatePartRole(hints, dateOpts))) {
        var maxLen = el.getAttribute('maxlength');
        var ph = el.getAttribute('placeholder') || '';
        value = M.maybeExtractDatePartValue(value, hints, {
          profileKey: key,
          maxLength: maxLen ? parseInt(maxLen, 10) : 0,
          zeroPadMonth: maxLen === '2' || /^(mm|月)$/i.test(String(ph).trim()),
          adjacentPairRole: adjacentRole || undefined
        });
      }
      if (!value) continue;

      // 年 / 月 / 日 三件套：整组一次性填，避免每个控件都塞完整日期
      if (parseDateParts(value)) {
        var grpRes = await fillDateGroup(el, value);
        if (grpRes) {
          grpRes.members.forEach(function (m) { if (groupHandled) groupHandled.add(m); });
          if (grpRes.ok) {
            filled += 1;
            keyCounts[key] = count + 1;
            if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
            grpRes.members.forEach(function (m) { highlight(m); });
          } else if (skipped.length < 12) {
            skipped.push({ key: key, reason: 'date_group_failed' });
          }
          continue;
        }
      }

      var ok = false;
      if (isReadonlyPicker(el)) {
        // 只读展示框：真值需要点击弹层选择；默认开启，可用 options.allowPickerClick=false 关闭
        if (opts.allowPickerClick === false) {
          skipped.push({ key: key, reason: 'readonly_picker_disabled' });
          continue;
        }
        ok = await fillReadonlyPicker(el, value);
        if (!ok) skipped.push({ key: key, reason: 'readonly_picker_not_found' });
      } else {
        ok = setNativeValue(el, value);
        if (!ok) skipped.push({ key: key, reason: 'set_value_failed' });
      }

      if (ok) {
        filled += 1;
        keyCounts[key] = count + 1;
        if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
        highlight(el);
      }
    }

    // 无名单选组（性别/婚姻/政治面貌/民族）：语义明确才勾
    if (opts.allowRadio !== false) {
      collectUnnamedRadioGroups().forEach(function (container) {
        var labelName = radioGroupLabelName(container);
        if (!labelName) return;
        var scored = M.matchFieldKeyScored ? M.matchFieldKeyScored(labelName, {}) : null;
        var gkey = scored && scored.key;
        if (!gkey || !RADIO_SAFE_KEYS[gkey]) return;
        if (scored.confidence < 0.9) return;
        var gval = M.profileValue(profile, gkey);
        if (!gval) return;
        var before = (keyCounts['radio:' + gkey] || 0);
        if (before) return;
        if (fillRadioGroup(container, gkey, gval)) {
          keyCounts['radio:' + gkey] = 1;
          filled += 1;
          if (filledKeys.indexOf(gkey) === -1) filledKeys.push(gkey);
        }
      });
    }

    return { filled: filled, filledKeys: filledKeys, skipped: skipped };
  }

  /**
   * 按映射结果填写（AI 巡查后的 AI 填写）。
   * mappings: { index, action, suggestedValue }[]
   */
  function applyMappings(mappings) {
    var els = iterFillableFields();
    var filled = 0;
    var filledKeys = [];
    var list = mappings || [];
    list.forEach(function (m) {
      if (!m || (m.action !== 'fill' && m.action !== 'custom_answer')) return;
      var value = String(m.suggestedValue || '').trim();
      if (!value) return;
      var el = els[m.index];
      if (!el) return;
      if (fieldLooksFilled(el)) return;
      var hints = collectHints(el);
      var adjacentRole = detectAdjacentDatePairRole(el);
      var dateOpts = { adjacentPairRole: adjacentRole || undefined };
      var role = M.detectDatePartRole ? M.detectDatePartRole(hints, dateOpts) : null;
      // AI 已给纯年/月则保留；完整日期且字段为年/月分栏时再拆
      if (role && M.extractDatePart) {
        var alreadyPart =
          (role === 'year' && /^\d{4}$/.test(value)) ||
          (role === 'month' && /^(0?[1-9]|1[0-2])$/.test(value)) ||
          (role === 'day' && /^(0?[1-9]|[12]\d|3[01])$/.test(value));
        if (!alreadyPart && M.extractDatePart(value, role)) {
          var maxLen = el.getAttribute('maxlength');
          var ph = el.getAttribute('placeholder') || '';
          value = M.maybeExtractDatePartValue(value, hints, {
            profileKey: m.profileKey || '',
            maxLength: maxLen ? parseInt(maxLen, 10) : 0,
            zeroPadMonth: maxLen === '2' || /^(mm|月)$/i.test(String(ph).trim()),
            adjacentPairRole: adjacentRole || undefined
          });
        }
      }
      if (!value) return;
      if (setNativeValue(el, value)) {
        filled += 1;
        var k = m.profileKey || ('custom:' + m.index);
        if (filledKeys.indexOf(k) === -1) filledKeys.push(k);
        highlight(el);
      }
    });
    return { filled: filled, filledKeys: filledKeys };
  }

  function loadProfile() {
    return new Promise(function (resolve) {
      chrome.storage.local.get('profile', function (result) {
        resolve(result.profile || {});
      });
    });
  }

  function profileHasData(profile) {
    if (!profile) return false;
    return Object.keys(profile).some(function (k) {
      var v = profile[k];
      return v && String(v).trim();
    });
  }

  async function handleFill(options) {
    var profile = await loadProfile();
    if (!profileHasData(profile)) {
      return { ok: false, filled: 0, filledKeys: [], reason: 'empty_profile' };
    }
    var result = await fillFromProfile(profile, options || {});
    return {
      ok: true,
      filled: result.filled,
      filledKeys: result.filledKeys,
      skipped: result.skipped || []
    };
  }

  async function handleScan() {
    var fields = scanFields();
    return { ok: true, fields: fields, count: fields.length };
  }

  async function handleCollect() {
    var fields = collectFieldsDetailed();
    return { ok: true, fields: fields, count: fields.length };
  }

  async function handleApply(message) {
    var result = applyMappings(message.mappings || []);
    return { ok: true, filled: result.filled, filledKeys: result.filledKeys };
  }

  var IS_TOP_FRAME = (function () {
    try { return window.top === window; } catch (_) { return false; }
  })();

  /**
   * v1.3.1（iframe 支持）：all_frames 后每个子 frame 都会收到 FILL_FORM 广播。
   * 子 frame 自己填完 → 用 postMessage 把统计结果汇报给父 frame，并且**不**调用
   * sendResponse，这样消息通道里只有顶层 frame 应答，popup 拿到的是汇总结果。
   */
  function reportToParent(payload) {
    try {
      if (IS_TOP_FRAME) return;
      (window.top || window.parent).postMessage({ __raFill: payload }, '*');
    } catch (_) { /* ignore */ }
  }

  function collectFrameResults(ms) {
    return new Promise(function (resolve) {
      var agg = { filled: 0, filledKeys: [], frames: 0, skipped: [] };
      var onMsg = function (e) {
        var d = e && e.data;
        if (!d || !d.__raFill) return;
        agg.filled += Number(d.__raFill.filled) || 0;
        agg.frames += 1;
        (d.__raFill.filledKeys || []).forEach(function (k) {
          if (agg.filledKeys.indexOf(k) === -1) agg.filledKeys.push(k);
        });
        (d.__raFill.skipped || []).forEach(function (x) {
          if (agg.skipped.length < 20) agg.skipped.push(x);
        });
      };
      try { window.addEventListener('message', onMsg); } catch (_) { /* ignore */ }
      setTimeout(function () {
        try { window.removeEventListener('message', onMsg); } catch (_) { /* ignore */ }
        resolve(agg);
      }, ms);
    });
  }

  async function handleFillMultiFrame(options) {
    var own = await handleFill(options || {});
    if (!IS_TOP_FRAME) {
      reportToParent(own);
      return own;
    }
    // 顶层：留一点时间收集子 frame 的汇报
    var agg = await collectFrameResults(900);
    if (!agg.frames) return own;
    return {
      ok: own.ok !== false,
      filled: own.filled + agg.filled,
      filledKeys: own.filledKeys.concat(agg.filledKeys.filter(function (k) {
        return own.filledKeys.indexOf(k) === -1;
      })),
      skipped: (own.skipped || []).concat(agg.skipped).slice(0, 20),
      frames: agg.frames + 1
    };
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message && message.type === 'FILL_FORM') {
      handleFillMultiFrame(message.options || {}).then(function (r) {
        // 子 frame 不应答，只把结果 postMessage 给顶层
        if (IS_TOP_FRAME) sendResponse(r);
      });
      return true;
    }
    if (message && message.type === 'SCAN_FIELDS') {
      handleScan().then(sendResponse);
      return true;
    }
    if (message && message.type === 'COLLECT_FIELDS') {
      handleCollect().then(sendResponse);
      return true;
    }
    if (message && message.type === 'APPLY_MAPPINGS') {
      handleApply(message).then(sendResponse);
      return true;
    }
    if (message && message.type === 'PING_CONTENT') {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
