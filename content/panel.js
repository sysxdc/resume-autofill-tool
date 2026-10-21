/**
 * 悬浮窗（v1.5.9）：页面右下角一张可拖动的小卡片，直接一键填写、看还有哪些字段空着。
 * - 只在顶层 frame 注入（子 frame 不显示）
 * - 样式全部在 shadow DOM 里，不污染页面；位置 / 收起状态存 chrome.storage.local
 * - 填完后直接把「未填字段」列出来，省得用户自己一行行找
 */
(function () {
  'use strict';
  if (window.top !== window) return;
  var api = window.__resumeAutofill;
  if (!api) return;
  if (document.getElementById('__ra_panel_host__')) return;

  var STORE_KEY = 'panelState';
  var state = { left: null, top: null, collapsed: false };
  var busy = false;

  var host = document.createElement('div');
  host.id = '__ra_panel_host__';
  host.style.cssText =
    'all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;';
  (document.body || document.documentElement).appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  // 不用 innerHTML：BYD 这类站点开了 Trusted Types，字符串赋值会被拦下来
  var CSS = [
    ':host, * { box-sizing: border-box; }',
    '.card {',
    '  width: 256px; background: #1c1915; color: #ece6da;',
    '  border: 1px solid rgba(236,230,218,.14); border-radius: 5px;',
    '  box-shadow: 0 12px 32px rgba(0,0,0,.45), 0 1px 0 rgba(255,255,255,.04) inset;',
    '  font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;',
    '  overflow: hidden; user-select: none;',
    '}',
    '.head { display: flex; align-items: center; gap: 7px; padding: 9px 8px 9px 10px;',
    '  border-bottom: 1px solid rgba(236,230,218,.09); cursor: grab; }',
    '.head.dragging { cursor: grabbing; }',
    '.grip { color: #8d857a; font-size: 11px; letter-spacing: 2px; }',
    '.title { font: 14px/1.2 "Songti SC", "Noto Serif SC", Georgia, serif; letter-spacing: .06em; color: #ece6da; }',
    '.spacer { flex: 1; }',
    '.mini { width: 20px; height: 20px; border: 0; border-radius: 3px; background: transparent;',
    '  color: #8d857a; cursor: pointer; font-size: 14px; line-height: 1; padding: 0; }',
    '.mini:hover { background: rgba(236,230,218,.08); color: #ece6da; }',
    '.body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }',
    '.row { display: flex; gap: 6px; }',
    '.btn { flex: 1; height: 30px; border-radius: 3px; cursor: pointer; font-size: 13px;',
    '  border: 1px solid transparent; transition: background .12s ease, opacity .12s ease; }',
    '.btn[disabled] { opacity: .55; cursor: default; }',
    '.btn.primary { background: #c0492b; color: #fdf7f2; font-weight: 500; }',
    '.btn.primary:hover:not([disabled]) { background: #cc5334; }',
    '.btn.ghost { background: transparent; border-color: rgba(236,230,218,.18); color: #c9c1b2; }',
    '.btn.ghost:hover:not([disabled]) { background: rgba(236,230,218,.07); color: #ece6da; }',
    '.status { margin: 0; font-size: 12px; color: #8d857a; min-height: 18px; }',
    '.status.err { color: #e08a72; }',
    '.list { list-style: none; margin: 0; padding: 0; max-height: 170px; overflow: auto;',
    '  border-top: 1px solid rgba(236,230,218,.08); }',
    '.list.empty { display: none; }',
    '.list li { display: flex; gap: 6px; padding: 5px 2px; font-size: 12px; color: #c9c1b2;',
    '  border-bottom: 1px solid rgba(236,230,218,.05); }',
    '.list li:last-child { border-bottom: 0; }',
    '.list li { cursor: pointer; border-radius: 3px; }',
    '.list li:hover { background: rgba(236,230,218,.06); }',
    '.row-n { color: #6f675c; }',
    '.req { color: #e0674a; width: 8px; flex: none; }',
    '.sec { color: #6f675c; flex: none; max-width: 88px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.label { flex: 1; word-break: break-all; }',
    '.foot { display: flex; align-items: center; justify-content: space-between; }',
    '.link { font-size: 12px; color: #8d857a; cursor: pointer; }',
    '.link:hover { color: #ece6da; }',
    '.pill { display: none; align-items: center; gap: 6px; height: 34px; padding: 0 12px;',
    '  background: #1c1915; color: #ece6da; border: 1px solid rgba(236,230,218,.14); border-radius: 17px;',
    '  box-shadow: 0 8px 24px rgba(0,0,0,.4); cursor: pointer;',
    '  font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }',
    '.pill:hover { border-color: rgba(236,230,218,.28); }',
    '.dot { width: 7px; height: 7px; border-radius: 50%; background: #c0492b; }',
    ':host(.collapsed) .card { display: none; }',
    ':host(.collapsed) .pill { display: flex; }'
  ].join(String.fromCharCode(10));

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  root.appendChild(styleEl);

  var card = el('div', 'card');

  var head = el('div', 'head');
  head.id = 'head';
  head.appendChild(el('span', 'grip', '⣿'));
  head.appendChild(el('span', 'title', '简历填写'));
  head.appendChild(el('span', 'spacer'));

  var collapseBtn = el('button', 'mini', '–');
  collapseBtn.setAttribute('data-act', 'collapse');
  collapseBtn.title = '收起';
  var hideBtn = el('button', 'mini', '×');
  hideBtn.setAttribute('data-act', 'hide');
  hideBtn.title = '本次隐藏';
  head.appendChild(collapseBtn);
  head.appendChild(hideBtn);

  var body = el('div', 'body');
  var row = el('div', 'row');
  var fillBtn = el('button', 'btn primary', '一键填写');
  fillBtn.setAttribute('data-act', 'fill');
  var unfilledBtn = el('button', 'btn ghost', '未填字段');
  unfilledBtn.setAttribute('data-act', 'unfilled');
  unfilledBtn.title = '列出页面上还空着的字段';
  row.appendChild(fillBtn);
  row.appendChild(unfilledBtn);

  var statusEl = el('p', 'status', '就绪');
  statusEl.id = 'status';

  var listEl = el('ul', 'list empty');
  listEl.id = 'list';

  var foot = el('div', 'foot');
  var optionsLink = el('a', 'link', '编辑资料');
  optionsLink.setAttribute('data-act', 'options');
  var hint = el('span', 'link', '拖动标题可挪位置');
  hint.id = 'hint';
  foot.appendChild(optionsLink);
  foot.appendChild(hint);

  body.appendChild(row);
  body.appendChild(statusEl);
  body.appendChild(listEl);
  body.appendChild(foot);

  card.appendChild(head);
  card.appendChild(body);
  root.appendChild(card);

  // 拖动时铺一层透明遮罩：否则鼠标划过 iframe / 视频会丢 pointermove，拖到一半卡住
  var shield = el('div');
  shield.style.cssText = 'position: fixed; inset: 0; display: none; cursor: grabbing; z-index: 1;';
  root.appendChild(shield);

  var pill = el('div', 'pill');
  pill.id = 'pill';
  pill.appendChild(el('span', 'dot'));
  pill.appendChild(el('span', null, '简历填写'));
  root.appendChild(pill);


  function setStatus(text, isErr) {
    statusEl.textContent = text;
    statusEl.classList.toggle('err', !!isErr);
  }

  function setBusy(on) {
    busy = on;
    fillBtn.disabled = on;
    fillBtn.textContent = on ? '填写中…' : '一键填写';
  }

  function reasonText(r) {
    var reason = String((r && r.reason) || '');
    if (reason === 'empty_profile') return '还没有资料，先点「编辑资料」填一份';
    if (/^fill_error/.test(reason) || /^exception/.test(reason)) return '填写出错：' + reason.replace(/^[a-z_]+:\s*/i, '');
    if (r && r.ok === false) return '没填成功，换个页面状态再试一次';
    return '完成';
  }

  function renderList(items) {
    listEl.textContent = '';
    var list = (items || []).slice(0, 40);
    listEl.classList.toggle('empty', !list.length);
    list.forEach(function (it) {
      var li = document.createElement('li');
      li.title = '点一下跳到这个字段';
      if (it.id) li.setAttribute('data-field', it.id);
      var req = document.createElement('span');
      req.className = 'req';
      req.textContent = it.required ? '*' : '';
      li.appendChild(req);
      if (it.section) {
        var sec = document.createElement('span');
        sec.className = 'sec';
        sec.textContent = it.section + (it.row ? ' ' + it.row : '');
        li.appendChild(sec);
      }
      var label = document.createElement('span');
      label.className = 'label';
      label.textContent = it.label || '';
      li.appendChild(label);
      listEl.appendChild(li);
    });
  }

  function jumpTo(item) {
    var id = item && item.getAttribute('data-field');
    if (!id || !api.revealField) return;
    try { api.revealField(id); } catch (_) { /* ignore */ }
  }

  function summary(blanks) {
    if (!blanks.length) return '没发现明显空缺';
    var required = blanks.filter(function (x) { return x.required; }).length;
    return blanks.length + ' 处空着' + (required ? '（其中 ' + required + ' 处必填）' : '');
  }

  async function doFill() {
    if (busy) return;
    setBusy(true);
    setStatus('正在填写…');
    renderList([]);
    try {
      var r = await api.fill();
      if (!r || r.ok === false) {
        setStatus(reasonText(r), true);
        return;
      }
      var blanks = (r.unfilled && r.unfilled.length !== undefined) ? r.unfilled : api.unfilled();
      setStatus('已填 ' + (r.filled || 0) + ' 项' + (r.timedOut ? '（超时，部分字段没处理完）' : '') + '，' + summary(blanks));
      renderList(blanks);
    } catch (err) {
      setStatus('填写失败：' + String((err && err.message) || err).slice(0, 80), true);
    } finally {
      setBusy(false);
    }
  }

  function showUnfilled() {
    if (busy) return;
    try {
      var blanks = api.unfilled();
      setStatus(summary(blanks));
      renderList(blanks);
    } catch (err) {
      setStatus('读取失败：' + String((err && err.message) || err).slice(0, 60), true);
    }
  }

  // ————— 位置 / 收起状态 —————

  function applyState() {
    if (state.left != null && state.top != null) {
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      host.style.left = clampX(state.left) + 'px';
      host.style.top = clampY(state.top) + 'px';
    }
    host.classList.toggle('collapsed', !!state.collapsed);
  }

  function saveState() {
    try {
      chrome.storage.local.set({ panelState: state });
    } catch (_) { /* ignore */ }
  }

  function clampX(x) {
    var w = host.getBoundingClientRect().width || 256;
    return Math.max(4, Math.min(x, window.innerWidth - w - 4));
  }

  function clampY(y) {
    var h = host.getBoundingClientRect().height || 160;
    return Math.max(4, Math.min(y, window.innerHeight - h - 4));
  }

  var drag = null;
  var moved = false;
  var dragFrom = '';

  function onDown(e, fromPill) {
    if (e.button !== 0) return;
    if (e.target.closest('[data-act]')) return;
    dragFrom = fromPill ? 'pill' : 'head';
    var rect = host.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
    moved = false;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = rect.left + 'px';
    host.style.top = rect.top + 'px';
    head.classList.add('dragging');
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    // 胶囊要靠 click 展开：pointerdown 上 preventDefault 会把后续 click 一起吞掉
    if (!fromPill) e.preventDefault();
  }

  function onMove(e) {
    if (!drag) return;
    if (Math.abs(e.clientX - (drag.dx + host.getBoundingClientRect().left)) > 3) moved = true;
    // 遮罩只在真的拖起来之后才铺：否则它会盖住胶囊，把 click 吞掉（点不开就是这个问题）
    if (moved) shield.style.display = 'block';
    var x = Math.max(4, Math.min(e.clientX - drag.dx, window.innerWidth - drag.w - 4));
    var y = Math.max(4, Math.min(e.clientY - drag.dy, window.innerHeight - drag.h - 4));
    host.style.left = x + 'px';
    host.style.top = y + 'px';
    state.left = x;
    state.top = y;
  }

  function onUp() {
    if (!drag) return;
    drag = null;
    var wasPill = dragFrom === 'pill';
    dragFrom = '';
    head.classList.remove('dragging');
    shield.style.display = 'none';
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    saveState();
    // 胶囊上的“点一下展开”放在 pointerup 里处理：遮罩 / 重渲染都可能把 click 吞掉
    if (wasPill && !moved) expand();
    moved = false;
  }

  head.addEventListener('pointerdown', onDown);
  pill.addEventListener('pointerdown', function (e) { onDown(e, true); });
  function expand() {
    if (!state.collapsed) return;
    state.collapsed = false;
    applyState();
    saveState();
  }

  pill.addEventListener('click', function (e) {
    e.stopPropagation();
    expand();
  });

  window.addEventListener('resize', function () {
    if (state.left != null) {
      state.left = clampX(state.left);
      state.top = clampY(state.top);
      applyState();
    }
  });

  listEl.addEventListener('click', function (e) {
    var li = e.target.closest('li');
    if (li) jumpTo(li);
  });

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    var act = btn.getAttribute('data-act');
    if (act === 'fill') doFill();
    else if (act === 'unfilled') showUnfilled();
    else if (act === 'options') {
      try { chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }); } catch (_) { /* ignore */ }
    } else if (act === 'collapse') {
      state.collapsed = true;
      applyState();
      saveState();
    } else if (act === 'hide') {
      host.remove();
    }
  });

  try {
    chrome.storage.local.get(STORE_KEY, function (r) {
      var saved = r && r[STORE_KEY];
      if (saved) {
        if (typeof saved.left === 'number' && typeof saved.top === 'number') {
          state.left = saved.left;
          state.top = saved.top;
        }
        state.collapsed = !!saved.collapsed;
      }
      applyState();
    });
  } catch (_) {
    applyState();
  }

  // 探测一下资料是否为空，给个更准的首屏提示（不阻塞）
  setTimeout(function () {
    try {
      unfilledBtn && (unfilledBtn.title = '列出页面上还空着的字段');
    } catch (_) { /* ignore */ }
  }, 0);
})();
