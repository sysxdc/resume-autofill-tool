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
  function optionNodes() {
    var out = [];
    ['.ant-select-dropdown-menu-item', '.ant-select-item-option', '.el-select-dropdown__item',
      '[role="option"]', '.option-item', '.dropdown-item'].forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (n) {
        if (isVisible(n)) out.push(n);
      });
    });
    return out;
  }

  function optionTexts() {
    return optionNodes().map(function (n) { return String(n.textContent || '').trim(); });
  }

  function nativeOptions(select) {
    return Array.prototype.map.call(select.options || [], function (o) {
      return { el: o, text: String(o.textContent || '').trim(), value: String(o.value || '') };
    });
  }

  /** 在候选里挑目标：精确 > 前缀 > 包含（短的一方至少 2 个字，避免误命中） */
  function pickBest(cands, want) {
    var w = norm(want);
    if (!w) return null;
    var best = null;
    var bestScore = -1;
    cands.forEach(function (c) {
      var t = norm(c.text);
      if (!t) return;
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
    var shown = host.querySelector('.ant-select-selection-selected-value, .ant-select-selection-item, .el-select__selected-item, .selected-text');
    if (shown) return String(shown.textContent || '').replace(/\s+/g, ' ').trim();
    var inp = host.querySelector('input');
    return inp ? String(inp.value || '').trim() : '';
  }

  /**
   * 填一个下拉（打开 → 等选项 → 挑目标 → 点/选 → 回读）。
   * 已经是目标值就直接返回 true（幂等，便于整表重跑）。
   */
  async function fillOne(host, want, opts) {
    var o = opts || {};
    if (!host || !want) return false;
    var cur = readShown(host);
    if (cur && norm(cur) === norm(want)) return true;

    if (String(host.tagName || '').toLowerCase() === 'select') {
      var hit0 = pickBest(nativeOptions(host), want);
      if (!hit0) return false;
      host.value = hit0.el.value;
      host.dispatchEvent(new Event('input', { bubbles: true }));
      host.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(60);
      return norm(readShown(host)) === norm(want) || norm(readShown(host)).indexOf(norm(want)) !== -1;
    }

    var trigger = host.querySelector('.ant-select-selection, .el-select .select-trigger, .select-trigger') || host;
    if (!optionNodes().length) {
      click(trigger);
      // 等选项出现（最多 ~1.2s）
      for (var w = 0; w < 12 && !optionNodes().length; w++) await sleep(100);
    }
    var opts1 = optionNodes();
    if (!opts1.length) return false;
    var pick = pickBest(opts1.map(function (n) { return { el: n, text: String(n.textContent || '').trim() }; }), want);
    if (!pick) return false;
    click(pick.el);
    await sleep(o.afterPickMs || 260);
    var after = readShown(host);
    return norm(after) === norm(want) || (after && norm(after).indexOf(norm(want)) !== -1);
  }

  /**
   * 联动链条：按顺序填，每级都要回读通过才继续；下一级的选项以「选项集合发生变化」为就绪信号。
   * @param {Array<{host:Element, value:string, label?:string}>} chain
   */
  async function fillChain(chain, opts) {
    var o = opts || {};
    var results = [];
    for (var i = 0; i < (chain || []).length; i++) {
      var step = chain[i];
      if (!step || !step.host || !step.value) { results.push({ ok: false, reason: 'missing' }); continue; }
      var before = i === 0 ? [] : optionTexts();
      var ok = await fillOne(step.host, step.value, o);
      results.push({ label: step.label || '', value: step.value, ok: ok, shown: readShown(step.host) });
      if (!ok) break;                       // 上一级没成就别去写下一级（会写进错的列表）
      if (i < chain.length - 1) {
        // 等下一级的选项刷新：选项集合与上一级不同，或至少出现目标字样
        var nextWant = norm(chain[i + 1].value);
        var ready = false;
        for (var t = 0; t < 15 && !ready; t++) {
          await sleep(120);
          var texts = optionTexts().map(norm);
          if (!texts.length) continue;
          var changed = texts.join('|') !== before.map(norm).join('|');
          if (changed || texts.some(function (x) { return x.indexOf(nextWant) !== -1; })) ready = true;
        }
        if (!ready) await sleep(200);
        // 上一轮的下拉可能还开着，关掉免得选项混在一起
        try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch (_) { /* ignore */ }
        await sleep(120);
      }
    }
    var allOk = results.length > 0 && results.every(function (r) { return r.ok; });
    return { ok: allOk, steps: results };
  }

  return {
    fillOne: fillOne,
    fillChain: fillChain,
    readShown: readShown,
    optionTexts: optionTexts,
    pickBest: pickBest
  };
});
