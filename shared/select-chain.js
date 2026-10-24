/**
 * 联动下拉：上一级选完，下一级的选项才会出来（语种 → 语言等级、省 → 市、学校 → 专业…）。
 *
 * 这类控件的坑是同一个：**直接写第二级没用**，因为选项列表还没生成。
 * 正确顺序必须是「先写第一级 → 等选项真的换了一批 → 再写第二级 → 回读校验」，
 * 而"等"的判据不是固定 sleep，而是「选项数变化 / 出现目标项」。
 *
 * 浏览器：ResumeAutofillSelectChain；Node：module.exports
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ResumeAutofillSelectChain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null) return false;
    var b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  }

  function click(el) {
    if (!el) return false;
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(function (t) {
      try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })); } catch (_) { /* ignore */ }
    });
    return true;
  }

  function norm(t) {
    return String(t == null ? '' : t).replace(/\s+/g, '').toLowerCase();
  }

  /** 可见的选项节点（antd v3 / v4-v5 / Element / 原生 select 都覆盖） */
  function enabled(node) { return !!node && !node.disabled && !node.closest('[disabled], [aria-disabled="true"], .disabled, .is-disabled, optgroup[disabled]'); }
  function popupFor(host) {
    if (!host) return null;
    var node = host.matches('[aria-controls], [aria-owns]') ? host : host.querySelector('[aria-controls], [aria-owns]');
    if (!node) return null;
    var ids = ((node.getAttribute('aria-controls') || '') + ' ' + (node.getAttribute('aria-owns') || '')).trim().split(/\s+/);
    var root = node.getRootNode(), boxes = [];
    ids.forEach(function (id) { var box = root.getElementById && root.getElementById(id); if (box && boxes.indexOf(box) < 0 && box.querySelector('[role="option"], li, option')) boxes.push(box); });
    var visible = boxes.filter(isVisible);
    return visible.length === 1 ? visible[0] : (visible.length ? null : (boxes.length === 1 ? boxes[0] : null));
  }
  function optionNodes(host) {
    var box = popupFor(host);
    return box ? Array.from(box.querySelectorAll('[role="option"], .ant-select-dropdown-menu-item, .ant-select-item-option, .el-select-dropdown__item, .option-item, .dropdown-item')).filter(function (node) { return isVisible(node) && enabled(node); }) : [];
  }
  function optionTexts(host) { return optionNodes(host).map(function (node) { return String(node.textContent || '').trim(); }); }

  function nativeOptions(select) {
    return Array.from(select.options || []).filter(enabled).map( function (o) {
      return { el: o, text: String(o.textContent || '').trim(), value: String(o.value || '') };
    });
  }

  /** 在候选里挑目标：精确 > 前缀 > 包含（短的一方至少 2 个字，避免误命中） */
  function pickBest(cands, want) {
    var w = norm(want);
    if (!w) return null;
    var best = null;
    var bestScore = -1;
    var NEG = /(?:不|非|未|无需|没有|not|no|non|un)$/;
    cands.forEach(function (c) {
      var t = norm(c.text);
      if (!t) return;
      // 「不熟练」⊃「熟练」：正反相包含，绝不选
      var at = t.indexOf(w);
      if (at > 0 && t !== w && NEG.test(t.slice(Math.max(0, at - 4), at))) return;
      var score = 0;
      if (t === w) score = 5;
      else if (t.indexOf(w) === 0) score = 4;
      else if (t.indexOf(w) !== -1) score = 3;
      else if (w.indexOf(t) !== -1 && t.length >= 2) score = 2;
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return bestScore > 0 ? best : null;
  }

  function readShown(host) {
    if (!host) return '';
    if (String(host.tagName || '').toLowerCase() === 'select') {
      var o = host.options && host.options[host.selectedIndex];
      return o ? String(o.textContent || '').trim() : '';
    }
    var shown = host.querySelector('.ant-select-selection-selected-value, .ant-select-selection-item, .el-select__selected-item:not(.el-select__input-wrapper):not(.is-transparent), .selected-text');
    if (shown) return String(shown.textContent || '').replace(/\s+/g, ' ').trim();
    var inp = host.querySelector('input');
    return inp ? String(inp.value || '').trim() : '';
  }

  /**
   * 填一个下拉（打开 → 等选项 → 挑目标 → 点/选 → 回读）。
   * 已经是目标值就直接返回 true（幂等，便于整表重跑）。
   */
  async function fillOne(host, want, opts) {
    if (!host || !want || !enabled(host)) return false;
    var C = globalThis.ResumeAutofillContent;
    var cur = C && C.readBackValue ? C.readBackValue(host) : readShown(host);
    if (cur && !/请选择|请先选择|select|choose/i.test(cur)) return norm(cur) === norm(want);
    var key = (opts && opts.key) || '';
    if (C && C.fillCustomSelect && host.tagName !== 'SELECT') return C.fillCustomSelect(host,want,key);
    if (host.tagName === 'SELECT') {
      var hit = pickBest(nativeOptions(host),want);
      if (!hit) return false;
      host.selectedIndex = Array.from(host.options).indexOf(hit.el);
      host.dispatchEvent(new Event('input',{bubbles:true})); host.dispatchEvent(new Event('change',{bubbles:true}));
      await sleep(60);
      return norm(readShown(host)) === norm(want);
    }
    // 独立测试/使用只支持具有明确 ARIA 归属的菜单；生产选择交给组件适配器。
    click(host.querySelector('.ant-select-selection, .select-trigger') || host);
    var deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      var pick = pickBest(optionNodes(host).map(function (n) { return {el:n,text:n.textContent}; }),want);
      if (pick) { click(pick.el); await sleep(100); return norm(readShown(host)) === norm(want); }
      await sleep(80);
    }
    return false;
  }

  function fingerprint(host) {
    var box = host.tagName === 'SELECT' ? host : popupFor(host);
    var items = box ? Array.from(box.querySelectorAll('option,[role="option"],.ant-select-dropdown-menu-item,.ant-select-item-option,.el-select-dropdown__item')).map(function (node) {
      return [node.value || node.getAttribute('data-value') || '',node.textContent,enabled(node)].join(':');
    }) : [];
    return [enabled(host),host.getAttribute('aria-busy'),items.join(';'),box ? box.getAttribute('aria-busy') : ''].join('|');
  }
  async function fillChain(chain, opts) {
    var results = [], steps = chain || [];
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i], next = steps[i + 1];
      if (!step || !step.host || !step.value) return {ok:false,steps:results,reason:'missing'};
      var before = next ? fingerprint(next.host) : '';
      var unchanged = norm(readShown(step.host)) === norm(step.value);
      var ok = await fillOne(step.host,step.value,Object.assign({},opts || {},{key:step.key || ''}));
      results.push({label:step.label || '',ok:ok,shown:readShown(step.host)});
      if (!ok) break;
      if (next && !unchanged) {
        if (next.host.tagName !== 'SELECT') {
          var C = globalThis.ResumeAutofillContent;
          if (C && C.openCustomSelect) C.openCustomSelect(next.host);
          else click(next.host.querySelector('.ant-select-selection, .select-trigger') || next.host);
        }
        var deadline = Date.now() + 3000, stable = 0, last = '', ready = false;
        while (Date.now() < deadline) {
          await sleep(100);
          var signature = fingerprint(next.host), box = next.host.tagName === 'SELECT' ? next.host : popupFor(next.host);
          var busy = next.host.getAttribute('aria-busy') === 'true' || (box && box.getAttribute('aria-busy') === 'true');
          stable = signature === last ? stable + 1 : 0; last = signature;
          if (enabled(next.host) && !busy && stable >= 2 && (signature !== before || !box)) { ready = true; break; }
        }
        if (!ready) return {ok:false,steps:results,reason:'next_not_refreshed'};
      }
    }
    return {ok:results.length === steps.length && results.every(function (r) { return r.ok; }),steps:results};
  }

  return {
    fillOne: fillOne,
    fillChain: fillChain,
    readShown: readShown,
    optionTexts: optionTexts,
    pickBest: pickBest
  };
});
