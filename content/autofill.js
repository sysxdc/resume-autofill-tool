/**
 * 简历填写工具 — 内容脚本
 * 依赖 shared/match.js（须在 manifest content_scripts 中先于本文件加载）。
 * 根据 name / id / autocomplete / placeholder / label 启发式匹配表单字段。
 * 不自动提交；不填 password/file；不盲勾 checkbox。
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
    if (el.id) {
      try {
        var label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (label) return label.textContent || '';
      } catch (_) { /* ignore */ }
    }
    var parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent || '';
    var aria = el.getAttribute('aria-label');
    if (aria) return aria;
    var describedBy = el.getAttribute('aria-describedby');
    if (describedBy) {
      var desc = document.getElementById(describedBy);
      if (desc) return desc.textContent || '';
    }
    // 邻近文本：前一个兄弟或父级上一行标签
    var prev = el.previousElementSibling;
    if (prev && /^(LABEL|SPAN|DIV|P|STRONG)$/i.test(prev.tagName)) {
      return prev.textContent || '';
    }
    return '';
  }

  function collectHints(el) {
    var parts = [
      el.name,
      el.id,
      el.getAttribute('autocomplete'),
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-automation-id'),
      typeof el.className === 'string' ? el.className : '',
      getLabelText(el)
    ];
    return M.normalize(parts.filter(Boolean).join(' '));
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
      return false; // 不自动勾选
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

  /**
   * 扫描可识别字段，不填写。
   * @returns {{key:string,hint:string}[]}
   */
  function scanFields() {
    var results = [];
    var seen = {};
    iterFillableFields().forEach(function (el) {
      var hints = collectHints(el);
      var key = M.matchFieldKey(hints);
      if (!key) return;
      var sig = key + '|' + (el.name || el.id || hintSnippet(el));
      if (seen[sig]) return;
      seen[sig] = true;
      results.push({ key: key, hint: hintSnippet(el) });
    });
    return results;
  }

  /**
   * @returns {{filled:number,filledKeys:string[]}}
   */
  function fillFromProfile(profile) {
    var filled = 0;
    var filledKeys = [];
    var keyCounts = {};

    iterFillableFields().forEach(function (el) {
      var hints = collectHints(el);
      var key = M.matchFieldKey(hints);
      if (!key) return;
      var count = keyCounts[key] || 0;
      if (count >= MAX_FILLS_PER_KEY) return;
      var value = M.profileValue(profile, key);
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

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message && message.type === 'FILL_FORM') {
      handleFill().then(sendResponse);
      return true;
    }
    if (message && message.type === 'SCAN_FIELDS') {
      handleScan().then(sendResponse);
      return true;
    }
    if (message && message.type === 'PING_CONTENT') {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
