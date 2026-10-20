/**
 * 简历填写工具 — 内容脚本
 * 依赖 shared/match.js（须在 manifest content_scripts 中先于本文件加载）。
 * FILL_FORM / SCAN_FIELDS / COLLECT_FIELDS / APPLY_MAPPINGS
 * 不自动提交；不填 password/file；不盲勾 checkbox。
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

  function collectHints(el) {
    var label = getLabelText(el);
    var parts = [
      label,
      el.getAttribute('placeholder'),
      el.name,
      el.id,
      el.getAttribute('aria-label'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-automation-id')
    ];
    // 已有有用标签时不倾倒 antd 长 className；否则仅保留语义 token
    if (!label || !String(label).trim()) {
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
      el.disabled
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

  function fillFromProfile(profile) {
    var filled = 0;
    var filledKeys = [];
    var keyCounts = {};

    iterFillableFields().forEach(function (el) {
      var key = matchKeyForElement(el);
      if (!key) return;
      var count = keyCounts[key] || 0;
      if (count >= MAX_FILLS_PER_KEY) return;
      var value = M.profileValue(profile, key);
      if (!value) return;
      if (fieldLooksFilled(el)) return;
      var hints = collectHints(el);
      if (M.maybeExtractDatePartValue && (M.isDatePartProfileKey(key) || M.detectDatePartRole(hints))) {
        var maxLen = el.getAttribute('maxlength');
        var ph = el.getAttribute('placeholder') || '';
        value = M.maybeExtractDatePartValue(value, hints, {
          profileKey: key,
          maxLength: maxLen ? parseInt(maxLen, 10) : 0,
          zeroPadMonth: maxLen === '2' || /^(mm|月)$/i.test(String(ph).trim())
        });
      }
      if (!value) return;
      if (setNativeValue(el, value)) {
        filled += 1;
        keyCounts[key] = count + 1;
        if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
        highlight(el);
      }
    });

    return { filled: filled, filledKeys: filledKeys };
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
      var role = M.detectDatePartRole ? M.detectDatePartRole(hints) : null;
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
            zeroPadMonth: maxLen === '2' || /^(mm|月)$/i.test(String(ph).trim())
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

  async function handleFill() {
    var profile = await loadProfile();
    if (!profileHasData(profile)) {
      return { ok: false, filled: 0, filledKeys: [], reason: 'empty_profile' };
    }
    var result = fillFromProfile(profile);
    return { ok: true, filled: result.filled, filledKeys: result.filledKeys };
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

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message && message.type === 'FILL_FORM') {
      handleFill().then(sendResponse);
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
