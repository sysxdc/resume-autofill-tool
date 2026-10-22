/**
 * 简历填写工具 · 内容脚本 · 单选组：命名 radio、无名 radio 组、Yes/No
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
  if (loaded['fill/radios']) return;
  loaded['fill/radios'] = true;

  // 依赖（已加载的模块）
  var RADIO_SAFE_KEYS = C.RADIO_SAFE_KEYS;
  var highlight = C.highlight;
  var negationConflict = C.negationConflict;
  var recordFill = C.recordFill;
  var simulateClick = C.simulateClick;

  /** 北森分区标题：标题 div 与 .form 共用同一个 id（GUID_Recruitment_*） */
  function phoenixFormTitle(form) {
    if (!form || !form.id || form.id.indexOf('_Recruitment_') === -1) return '';
    var sel = '[id="' + (window.CSS && CSS.escape ? CSS.escape(form.id) : form.id) + '"]';
    var nodes;
    try { nodes = document.querySelectorAll(sel); } catch (_) { return ''; }
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === form) continue;
      if (n.classList && n.classList.contains('form')) continue;
      var t = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length <= 24) return t;
    }
    return '';
  }

  /** 收集 radio 组的候选标题：表单标签 → 行首兄弟文本 → 父容器去选项文本 → name */
  function radioGroupHints(first, wrap, name) {
    var hints = [];
    var pick = function (v) {
      var t = String(v || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length < 2) return;
      if (/^(是|否|男|女|其他|有|无)$/.test(t)) return;
      if (hints.indexOf(t) === -1) hints.push(t);
    };
    var node = wrap || first.parentElement;
    // ① 表单行标签 / legend
    var lab = (node && node.querySelector('legend, .el-form-item__label, .ant-form-item-label, .form-label, .item-label')) || null;
    if (lab) pick(lab.textContent);
    // ② 往上最多 3 层：取本节点前一个非空兄弟的文本，以及父容器“去掉选项后”的文本
    for (var up = 0; up < 3 && node; up++) {
      var sib = node.previousElementSibling;
      while (sib) {
        if (!/^(INPUT|BUTTON|SCRIPT|STYLE)$/.test(sib.tagName)) {
          var t = String(sib.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) { pick(t); break; }
        }
        sib = sib.previousElementSibling;
      }
      var parent = node.parentElement;
      if (!parent) break;
      var clone = parent.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('input, button, .radio-group, [role="radiogroup"], label'), function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
      pick(clone.textContent);
      node = parent;
    }
    // ③ name 兜底（is_fresh / has_relative 这类语义名）
    pick(String(name || '').replace(/[_-]+/g, ' '));
    return hints;
  }

  /** 命名 radio 组：按 name 聚合，Yes/No 与安全键可填 */
  function fillNamedRadioGroups(profile, keyCounts, filledKeys) {
    var filled = 0;
    var radios = Array.from(document.querySelectorAll('input[type=radio][name]')).filter(function (r) {
      return !r.disabled && r.offsetParent !== null;
    });
    var byName = {};
    radios.forEach(function (r) {
      if (!byName[r.name]) byName[r.name] = [];
      byName[r.name].push(r);
    });
    Object.keys(byName).forEach(function (name) {
      var group = byName[name];
      if (group.length < 2) return;
      // 已有选中则跳过
      if (group.some(function (r) { return r.checked; })) return;
      var first = group[0];
      var wrap = first.closest
        ? first.closest('fieldset, .el-form-item, .ant-form-item, .form-item, .form-group, tr, li, div')
        : first.parentElement;
      // v1.5.1: 组标题常在“行首 <span>/<td>”里，或在本组容器前一个兄弟节点
      var hints = radioGroupHints(first, wrap, name);
      var scored = null;
      for (var hi = 0; hi < hints.length && !scored; hi++) {
        scored = M.matchFieldKeyScored ? M.matchFieldKeyScored(hints[hi], {}) : null;
      }
      var gkey = scored && scored.key;
      if (!gkey) return;
      var gval = M.profileValue(profile, gkey);
      if (!gval) return;
      var opts = group.map(function (r) {
        return { value: r.value, text: radioOptionText(r), el: r };
      });
      var isYn = M.isYesNoOnlySelect && M.isYesNoOnlySelect(opts);
      if (!RADIO_SAFE_KEYS[gkey] && !isYn) return;
      if (keyCounts['radio:' + gkey]) return;
      var matched = M.findBestOption ? M.findBestOption(opts, gval) : null;
      if (!matched && isYn && M.parseYesNo) {
        var yn = M.parseYesNo(gval);
        if (yn) matched = M.findBestOption(opts, yn);
      }
      if (!matched) return;
      var target = null;
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].text === matched.text || String(opts[i].value) === String(matched.value)) {
          target = opts[i].el;
          break;
        }
      }
      if (!target) return;
      simulateClick(target);
      if (!target.checked) {
        // 合成点击没生效（antd v3 Radio 只认原生 click）：点包装 label，再点 input 本身
        var rl = target.closest ? target.closest('label') : null;
        try { (rl || target).click(); } catch (_) { /* ignore */ }
        if (!target.checked) { try { target.click(); } catch (_) { /* ignore */ } }
      }
      if (target.checked) {
        recordFill(target, gkey, gval);
        keyCounts['radio:' + gkey] = 1;
        filled += 1;
        if (filledKeys.indexOf(gkey) === -1) filledKeys.push(gkey);
        highlight(target);
      }
    });
    return filled;
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
    // v1.5.12：antd v3 的 label 在另一列（.ant-form-item-label），兄弟节点里找不到
    var item = container.closest && container.closest('.ant-form-item, .form-item, .field, .form-row, tr');
    if (item) {
      var lab = item.querySelector('label');
      if (lab) {
        var lt = String(lab.textContent || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim();
        if (lt && lt.length <= 24) return lt;
      }
    }
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
      if (opt !== want && negationConflict(opt, want)) continue;
      if (opt === want || (opt.length >= 2 && want.indexOf(opt) !== -1)) {
        var lab = radios[i].closest && radios[i].closest('label');
        if (lab && lab.classList && lab.classList.contains('ant-radio-wrapper') && typeof lab.click === 'function') {
          // antd v3 的 Radio：合成事件不触发 onChange，原生 click 才行
          lab.click();
        } else {
          simulateClick(radios[i]);
        }
        if (!radios[i].checked) { try { (lab || radios[i]).click(); } catch (_) { /* ignore */ } }
        if (radios[i].checked) { highlight(radios[i]); return true; }
        return false;   // 点了没选上：别再去点别的选项
      }
    }
    return false;
  }

  // 导出
  C.phoenixFormTitle = phoenixFormTitle;
  C.fillNamedRadioGroups = fillNamedRadioGroups;
  C.collectUnnamedRadioGroups = collectUnnamedRadioGroups;
  C.radioGroupLabelName = radioGroupLabelName;
  C.normalizeChoiceText = normalizeChoiceText;
  C.fillRadioGroup = fillRadioGroup;
})();
