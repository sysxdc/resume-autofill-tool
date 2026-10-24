/** DOM root 与真实控件身份。开放 Shadow DOM 和 document 使用相同扫描路径。 */
(function () {
  'use strict';
  var C = globalThis.ResumeAutofillContent || (globalThis.ResumeAutofillContent = {});
  var loaded = C.__loaded || (C.__loaded = {});
  if (loaded['fill/dom']) return;
  loaded['fill/dom'] = true;
  var roots = new WeakMap(), nodes = new WeakMap(), sequence = 0;
  var frame = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  function identity(map, node) {
    if (!map.has(node)) map.set(node, ++sequence);
    return map.get(node);
  }
  function queryAll(selector, root) {
    var found = [], seen = new Set();
    function visit(scope) {
      Array.from(scope.querySelectorAll(selector)).forEach(function (node) {
        if (!seen.has(node)) { found.push(node); seen.add(node); }
      });
      Array.from(scope.querySelectorAll('*')).forEach(function (node) {
        if (node.shadowRoot && node.id !== '__ra_panel_host__') visit(node.shadowRoot);
      });
    }
    visit(root || document);
    return found;
  }
  function control(node) {
    if (!node) return null;
    return (C.findCustomSelectHost && C.findCustomSelectHost(node)) || node;
  }
  function controls() {
    var out = [], seen = new Set();
    queryAll('input, textarea, select, [role="combobox"], [role="listbox"][aria-multiselectable="true"], [contenteditable="true"]').forEach(function (el) {
      if ((C.isSkippable && C.isSkippable(el)) || (C.isVisibleEl && !C.isVisibleEl(el))) return;
      if (el.matches('[role="combobox"]:not(input):not(textarea):not(select)') && el.querySelector('input,textarea,select') && C.findCustomSelectHost && !C.findCustomSelectHost(el)) return;
      var node = control(el);
      if (seen.has(node)) return;
      seen.add(node); out.push(node);
    });
    if (C.iterCustomSelectHosts) C.iterCustomSelectHosts().forEach(function (node) {
      if (!seen.has(node)) { seen.add(node); out.push(node); }
    });
    out.sort(function (a,b) {
      if (a.getRootNode() !== b.getRootNode()) return 0;
      var position = a.compareDocumentPosition(b);
      return position & 2 ? 1 : (position & 4 ? -1 : 0);
    });
    return out;
  }
  C.queryAll = queryAll;
  C.queryOne = function (selector, root) { return queryAll(selector, root)[0] || null; };
  C.rootId = function (node) { return 'r' + identity(roots, node.getRootNode()); };
  C.fieldId = function (node) { return frame + ':' + C.rootId(node) + ':c' + identity(nodes, node); };
  C.controlNode = control;
  C.logicalControls = controls;
  C.parentComposed = function (node) { return node.parentElement || (node.getRootNode && node.getRootNode().host) || null; };
  C.containsComposed = function (parent,node) {
    for (var current=node;current;current=C.parentComposed(current)) if (current === parent) return true;
    return false;
  };
  C.byRootId = function (el, id) {
    var scope = el.getRootNode();
    return scope.getElementById ? scope.getElementById(id) : scope.querySelector('#' + CSS.escape(id));
  };
  C.optionEnabled = function (el) { return !!el && !el.disabled && !el.closest('optgroup[disabled], [aria-disabled="true"], [disabled], .is-disabled, .disabled, .ant-select-item-option-disabled, .ant-select-dropdown-menu-item-disabled'); };
})();
