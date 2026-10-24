/** 多选只接受显式数组；已有任意选择即保留。 */
(function () {
  'use strict';
  var C = globalThis.ResumeAutofillContent;
  var M = globalThis.ResumeAutofillMatch;
  if (!C) return;
  var loaded = C.__loaded || (C.__loaded = {});
  if (loaded['fill/multi-select']) return;
  loaded['fill/multi-select'] = true;
  var results = new WeakMap();
  function listbox(el, hidden) {
    if (el.matches('[role="listbox"][aria-multiselectable="true"]')) return el;
    var node = C.ariaCombobox(el), box = node && C.ariaPopup(node, hidden);
    return box && box.getAttribute('aria-multiselectable') === 'true' ? box : null;
  }
  function read(el) {
    if (el.matches('select[multiple]')) return Array.from(el.selectedOptions).filter(function (o) { return String(o.value || '').trim(); }).map(function (o) { return String(o.textContent || o.value).trim(); });
    var box = listbox(el, true);
    return box ? Array.from(box.querySelectorAll('[role="option"][aria-selected="true"]')).map(function (n) { return String(n.textContent || '').trim(); }) : [];
  }
  function same(a, b) {
    return a.length === b.length && a.every(function (v) { return b.indexOf(v) >= 0; });
  }
  async function fill(el, values) {
    results.delete(el);
    if (!Array.isArray(values) || !values.length || !C.optionEnabled(el) || read(el).length) return false;
    var native = el.matches('select[multiple]'), box;
    if (!native) {
      var node = C.ariaCombobox(el);
      if (node) { C.simulateClick(node); node.focus(); }
      var deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        box = listbox(el, false);
        if (box && C.isVisibleEl(box) && box.getAttribute('aria-busy') !== 'true') break;
        await C.sleep(60);
      }
      if (!box || !C.isVisibleEl(box) || read(el).length) return false;
    }
    var candidates = native ? Array.from(el.options).filter(C.optionEnabled).map(function (o) { return {el:o,text:o.text,value:o.value}; }) : C.ariaOptions(box);
    var hits = values.map(function (value) { return M.matchSelectOption(candidates, value); });
    if (hits.some(function (hit) { return !hit; }) || new Set(hits.map(function (hit) { return hit.el; })).size !== values.length) return false;
    var expected = hits.map(function (hit) { return String(hit.text).trim(); });
    results.set(el,{expected:expected});
    if (native) {
      hits.forEach(function (hit) { hit.el.selected = true; });
      el.dispatchEvent(new Event('input', {bubbles:true,composed:true}));
      el.dispatchEvent(new Event('change', {bubbles:true,composed:true}));
    } else {
      for (var i = 0; i < hits.length; i++) {
        if (!same(read(el),expected.slice(0,i))) return false;
        box = listbox(el,false);
        var hit = box && M.matchSelectOption(C.ariaOptions(box),values[i]);
        if (!hit || !C.optionEnabled(hit.el)) return false;
        C.simulateClick(hit.el);
        var until = Date.now() + 800;
        while (Date.now() < until && read(el).indexOf(String(hit.text).trim()) < 0) await C.sleep(40);
        if (read(el).indexOf(String(hit.text).trim()) < 0) return false;
      }
    }
    await C.sleep(100);
    return same(read(el),expected);
  }
  C.isMultiSelect = function (el) { return !!el && (el.matches('select[multiple]') || !!listbox(el, true)); };
  C.readMultiValues = read;
  C.fillMultiSelect = fill;
  C.multiSelectResult = function (el) { return results.get(el) || null; };
})();
