/**
 * 简历填写工具 · 内容脚本 · layui laydate：自绘面板、值在 input.value 里
 * 由 content/autofill.js 拆出（v1.6.0）。模块之间通过 globalThis.ResumeAutofillContent 共享函数，
 * 加载顺序见 manifest.json content_scripts；排在后面的模块用转发函数引用（调用时才解析）。
 */
(function () {
  'use strict';

  var C = globalThis.ResumeAutofillContent || (globalThis.ResumeAutofillContent = {});
  var D = globalThis.ResumeAutofillDate || null;
  if (!globalThis.ResumeAutofillMatch) return;
  // 重复注入时整个模块跳过：保持和首次加载的编排层用同一套函数 / 本轮状态
  var loaded = C.__loaded || (C.__loaded = {});
  if (loaded['sites/laydate']) return;
  loaded['sites/laydate'] = true;

  // 依赖（已加载的模块）
  var isVisibleEl = C.isVisibleEl;
  var rawSetValue = C.rawSetValue;
  var settle = C.settle;
  var simulateClick = C.simulateClick;
  var sleep = C.sleep;

  // —————— v1.5.24：layui laydate（国内老网申很常见）——————
  // laydate 只是普通 input + 自绘面板，值就存在 input.value 里（表单提交读的也是它）。
  // 打开一次面板看类型（日期 / 年月 / 年 / 范围），按它的格式直接写：比逐格点击快且准（之前每个 2~3 秒）。
  function isLaydateInput(el) {
    return !!(el && el.hasAttribute && el.hasAttribute('lay-key'));
  }

  async function laydateKind(el) {
    var key = el.getAttribute('lay-key');
    try { el.focus(); } catch (_) { /* ignore */ }
    simulateClick(el);
    var panel = null;
    for (var w = 0; w < 10 && !panel; w++) {
      await sleep(60);
      var p = document.getElementById('layui-laydate' + key);
      if (p && isVisibleEl(p)) panel = p;
    }
    if (!panel) return null;
    var kind = {
      range: /layui-laydate-range/.test(String(panel.className || '')),
      type: panel.querySelector('.laydate-year-list') ? 'year'
        : (panel.querySelector('.laydate-month-list') ? 'month' : 'date'),
      time: !!panel.querySelector('.laydate-time-list')
    };
    // 点面板外关闭（laydate 监听 document 的 mousedown）
    try {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } catch (_) { /* ignore */ }
    try { el.blur(); } catch (_) { /* ignore */ }
    return kind;
  }

  /** laydate 的写法：placeholder 写明格式就照它，否则用 laydate 默认（yyyy-MM-dd / yyyy-MM / yyyy） */
  function laydateText(el, kind, value) {
    var mo = D && D.parseModel ? D.parseModel(value) : null;
    if (!mo || !mo.y) return '';
    var fmt = D.detectFormat ? D.detectFormat(el.getAttribute('placeholder') || '') : null;
    if (kind.type === 'year') return String(mo.y);
    if (!mo.m) return '';
    if (fmt && (kind.type === 'date' ? fmt.hasDay : !fmt.hasDay)) return D.formatModel(mo, fmt);
    return kind.type === 'month' ? D.toYm(mo) : D.toYmd(mo);
  }

  /** 写 laydate：单个日期给 startVal；范围控件给 startVal + endVal（没有终点 / 类型对不上 → false） */
  async function fillLaydate(el, startVal, endVal) {
    var kind = await laydateKind(el);
    if (!kind) return false;
    if (kind.range !== !!endVal) return false;
    var a = laydateText(el, kind, startVal);
    if (!a) return false;
    var text = a;
    if (kind.range) {
      var b = laydateText(el, kind, endVal);
      if (!b) return false;
      var sepM = String(el.getAttribute('placeholder') || '').match(/\s*(~|至|到|—|-)\s*/);
      var sep = sepM && sepM[1] !== '-' ? ' ' + sepM[1] + ' ' : ' - ';
      text = a + sep + b;
    }
    rawSetValue(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    return String(el.value || '') === text;
  }

  // 导出
  C.isLaydateInput = isLaydateInput;
  C.laydateKind = laydateKind;
  C.fillLaydate = fillLaydate;
})();
