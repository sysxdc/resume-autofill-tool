/** 通用 ARIA 单选：关联弹层、远程搜索、虚拟列表与提交回读。 */
(function () {
  'use strict';
  var C = globalThis.ResumeAutofillContent || (globalThis.ResumeAutofillContent = {});
  var M = globalThis.ResumeAutofillMatch;
  var loaded = C.__loaded || (C.__loaded = {});
  if (!M) return;
  if (loaded['fill/aria-select']) return;
  loaded['fill/aria-select'] = true;
  var committed = new WeakMap(), results = new WeakMap();
  function controller(host) {
    if (!host || !host.querySelector) return null;
    var node = host.matches('[role="combobox"]') ? host : host.querySelector('[role="combobox"]');
    if (!node || node.closest('.ant-select, .el-select, .phoenix-select, [class*="sd-Select-container"]')) return null;
    return node.hasAttribute('aria-controls') || node.hasAttribute('aria-owns') ? node : null;
  }
  function popup(node) {
    var ids = String(node.getAttribute('aria-controls') || node.getAttribute('aria-owns') || '').split(/\s+/);
    var root = node.getRootNode();
    for (var i = 0; i < ids.length; i++) {
      var found = (root.getElementById && root.getElementById(ids[i])) || document.getElementById(ids[i]);
      if (found) return found;
    }
    return null;
  }
  function selectedText(host, node, allowInput) {
    var selected = host.querySelector('[data-selected-value], .selected-text');
    if (selected && C.isVisibleEl(selected)) return String(selected.getAttribute('data-selected-value') || selected.textContent || '').trim();
    if (node.getAttribute('aria-expanded') !== 'false') return '';
    if (/^(INPUT|TEXTAREA)$/.test(node.tagName)) return allowInput ? String(node.value || '').trim() : '';
    return String(node.textContent || '').trim().replace(/^(请选择|select|choose)$/i, '');
  }
  function equivalent(actual, wanted, key) {
    var A = globalThis.ResumeAutofillAudit;
    return !!(A && A.compareEntry({key:key || '',expected:String(wanted),actual:String(actual)}).accepted);
  }
  function options(box) {
    if (!box) return [];
    return Array.from(box.querySelectorAll('[role="option"]')).filter(function (node) {
      return C.isVisibleEl(node) && !node.closest('[aria-disabled="true"], [disabled], .is-disabled, .disabled');
    }).map(function (node) { return {el:node,text:String(node.textContent || '').replace(/\s+/g,' ').trim(),value:node.getAttribute('data-value') || node.textContent}; });
  }
  function busy(node, box) {
    return node.getAttribute('aria-busy') === 'true' || (box && (box.getAttribute('aria-busy') === 'true' || box.querySelector('[aria-busy="true"], [data-loading="true"]')));
  }
  function scrollBox(box) {
    return [box].concat(Array.from(box.querySelectorAll('*'))).find(function (n) { return n.scrollHeight > n.clientHeight + 2 && n.clientHeight > 0 && /auto|scroll/.test(getComputedStyle(n).overflowY); });
  }
  async function fill(host, wanted, key) {
    var node = controller(host);
    function finish(ok, reason) { results.set(host,{ok:ok,reason:reason,adapter:'aria-listbox'}); return ok; }
    if (!node || node.disabled || node.closest('[aria-disabled="true"], [disabled], .is-disabled')) return finish(false,'component_disabled');
    var existing = selectedText(host,node,committed.has(host));
    if (existing) return finish(equivalent(existing,wanted,key),equivalent(existing,wanted,key) ? 'already_selected' : 'existing_value_conflict');
    if (node.value && node.getAttribute('aria-expanded') === 'false') return finish(false,'existing_unverified_value');
    var editable = node.tagName === 'INPUT' && !node.readOnly;
    C.simulateClick(node); node.focus();
    var end = Date.now() + 4500, typed = false, queryAt = 0, lastSignature = '', stable = 0, pages = 0;
    while (Date.now() < end && node.isConnected && host.isConnected) {
      var box = popup(node);
      if (box && box.getAttribute('role') !== 'listbox') return finish(false,'popup_type_unsupported');
      if (box && box.getAttribute('aria-multiselectable') === 'true') return finish(false,'multiselect_unsupported');
      if (box && C.isVisibleEl(box) && !busy(node,box)) {
        var candidates = options(box), signature = candidates.map(function (o) { return o.text + ':' + o.value; }).join('|');
        stable = signature === lastSignature ? stable + 1 : 0; lastSignature = signature;
        var hit = M.matchSelectOption(candidates,wanted);
        if (hit && equivalent(hit.text,wanted,key) && stable >= 1 && (!typed || Date.now() - queryAt >= 200)) {
          C.simulateClick(hit.el);
          var commitEnd = Date.now() + 900;
          while (Date.now() < commitEnd) {
            await C.sleep(80);
            var shown = selectedText(host,node,true);
            if (equivalent(shown,wanted,key) && !busy(node,popup(node))) {
              committed.set(host,shown); return finish(true,'committed');
            }
          }
          return finish(false,'selection_not_committed');
        }
        if (!editable && stable >= 1) {
          var scroller = scrollBox(box);
          if (scroller && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1 && pages < 30) {
            scroller.scrollTop = Math.min(scroller.scrollTop + Math.max(scroller.clientHeight - 16,16),scroller.scrollHeight - scroller.clientHeight);
            scroller.dispatchEvent(new Event('scroll',{bubbles:true})); pages += 1; stable = 0;
          } else if (stable >= 3) return finish(false,'no_matching_option');
        }
      }
      if (editable && !typed && Date.now() > end - 4300) {
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        setter.call(node,String(wanted)); node.dispatchEvent(new Event('input',{bubbles:true}));
        typed = true; queryAt = Date.now(); stable = 0;
      }
      await C.sleep(80);
    }
    return finish(false,node.isConnected ? 'options_timeout' : 'component_replaced');
  }
  C.ariaCombobox = controller;
  C.fillAriaSelect = fill;
  C.ariaSelectionText = function (host) {
    var node = controller(host);
    if (!node) return '';
    var shown = selectedText(host,node,committed.has(host));
    if (committed.has(host) && !equivalent(shown,committed.get(host),'')) committed.delete(host);
    return shown;
  };
  C.ariaSelectResult = function (host) { return results.get(host); };
})();
