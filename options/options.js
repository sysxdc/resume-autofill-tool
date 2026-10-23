/**
 * 选项页：编辑并保存简历 profile + AI 设置；导入/导出 JSON、示例资料、清空确认。
 * v1.5.0：eduList/workList/projectList 多段可折叠编辑（增删改排序）。
 */
(function () {
  'use strict';

  var P = globalThis.ResumeAutofillProfile;
  var AI = globalThis.ResumeAutofillAI;
  var DB = globalThis.ResumeAutofillDB;
  var RP = globalThis.ResumeAutofillParser;
  var FIELDS = P.PROFILE_FIELDS;
  var form = document.getElementById('profile-form');
  var aiForm = document.getElementById('ai-form');
  var saveStatus = document.getElementById('save-status');
  var aiSaveStatus = document.getElementById('ai-save-status');

  var LIST_KEYS = P.LIST_FIELDS || ['eduList', 'workList', 'projectList'];
  var LIST_LABELS = P.LIST_ITEM_LABELS || {};
  var LIST_ITEM_FIELDS = P.LIST_ITEM_FIELDS || {};

  function emptyListItem(listKey) {
    var keys = LIST_ITEM_FIELDS[listKey] || [];
    var item = {};
    keys.forEach(function (k) { item[k] = ''; });
    return item;
  }

  function readListFromDom(listKey) {
    var root = document.getElementById('list-' + listKey);
    if (!root) return [];
    var rows = root.querySelectorAll('.list-row');
    var out = [];
    Array.prototype.forEach.call(rows, function (row) {
      var item = emptyListItem(listKey);
      var keys = LIST_ITEM_FIELDS[listKey] || [];
      keys.forEach(function (k) {
        var inp = row.querySelector('[data-field="' + k + '"]');
        item[k] = inp ? String(inp.value || '').trim() : '';
      });
      out.push(item);
    });
    return P.normalizeList ? P.normalizeList(listKey, out) : out;
  }

  function readAllLists() {
    var lists = {};
    LIST_KEYS.forEach(function (k) { lists[k] = readListFromDom(k); });
    return lists;
  }

  function renderListEditor(listKey, items) {
    var root = document.getElementById('list-' + listKey);
    if (!root) return;
    var keys = LIST_ITEM_FIELDS[listKey] || [];
    var labels = LIST_LABELS[listKey] || {};
    var arr = Array.isArray(items) ? items : [];
    if (!arr.length) {
      root.innerHTML = '<p class="muted" style="font-size:12px;color:#94a3b8">暂无记录，点击下方按钮添加。</p>';
      refreshMirrors(listKey);
      return;
    }
    root.innerHTML = arr.map(function (item, idx) {
      var fields = keys.map(function (k) {
        var lab = labels[k] || k;
        var isLong = /^(description|tech|courses|achievements|responsibilities|outcome|research)$/.test(k);
        var val = item && item[k] != null ? String(item[k]) : '';
        if (isLong) {
          return '<label class="full">' + lab +
            '<textarea rows="2" data-field="' + k + '">' + esc(val) + '</textarea></label>';
        }
        return '<label>' + lab +
          '<input type="text" data-field="' + k + '" value="' + esc(val).replace(/"/g, '&quot;') + '" /></label>';
      }).join('');
      return '' +
        '<div class="list-row" data-index="' + idx + '">' +
          '<div class="list-row-head">' +
            '<span class="list-row-title">第 ' + (idx + 1) + ' 段</span>' +
            '<div class="list-row-actions">' +
              '<button type="button" class="btn ghost" data-list-act="up" data-list="' + listKey + '" data-index="' + idx + '">上移</button>' +
              '<button type="button" class="btn ghost" data-list-act="down" data-list="' + listKey + '" data-index="' + idx + '">下移</button>' +
              '<button type="button" class="btn ghost" data-list-act="remove" data-list="' + listKey + '" data-index="' + idx + '">删除</button>' +
            '</div>' +
          '</div>' +
          '<div class="grid">' + fields + '</div>' +
        '</div>';
    }).join('');
    refreshMirrors(listKey);
  }

  function refreshMirrors(listKey) {
    var rows = readListFromDom(listKey), map = P.MAIN_ENTRY_MAP[listKey] || {};
    Object.keys(map).forEach(function (field) {
      var input = form.elements.namedItem(map[field]);
      if (!input) return;
      if (rows.length) {
        var value = rows[0][field] || '';
        // 满分尚未录入列表的旧 GPA，不能在展示镜像时丢掉已有满分。
        if (map[field] === 'gpa' && !String(value).includes('/') && String(input.value).startsWith(value + '/')) value = input.value;
        input.value = value;
        input.dataset.mirror = 'true';
        input.readOnly = true;
        if (input.tagName === 'SELECT') input.disabled = true;
        input.title = '由第1条经历同步，请在多段经历中修改';
      } else if (input.dataset.mirror) {
        input.value = ''; input.readOnly = false; input.disabled = false;
        delete input.dataset.mirror; input.title = '';
      }
    });
  }

  function writeLists(profile) {
    var p = profile || {};
    LIST_KEYS.forEach(function (k) {
      renderListEditor(k, p[k] || []);
    });
  }

  function readForm() {
    var data = P.emptyProfile();
    FIELDS.forEach(function (key) {
      var el = form.elements.namedItem(key);
      data[key] = el ? String(el.value || '').trim() : '';
    });
    var lists = readAllLists();
    LIST_KEYS.forEach(function (k) { data[k] = lists[k]; });
    return data;
  }

  function writeForm(profile) {
    var p = P.normalizeProfile(profile);
    FIELDS.forEach(function (key) {
      var el = form.elements.namedItem(key);
      if (el) {
        delete el.dataset.mirror; el.readOnly = false; el.disabled = false; el.title = '';
        el.value = p[key] || '';
      }
    });
    writeLists(p);
  }

  var qualityEl = document.getElementById('profile-quality');
  function qualityPath(path) {
    var match = String(path || '').match(/^(\w+)\[(\d+)\](?:\.(\w+))?$/);
    if (match) return (P.LIST_SECTION_TITLES[match[1]] || '经历') + ' 第' + (Number(match[2]) + 1) + '条' + (match[3] ? ' · ' + ((LIST_LABELS[match[1]] || {})[match[3]] || '字段') : '');
    var field = form.elements.namedItem(path);
    return field && field.closest('label') ? field.closest('label').textContent.trim() : (P.LIST_SECTION_TITLES[path] || '资料字段');
  }
  function showQuality(report, prefix) {
    if (!qualityEl) return;
    var labels = {mirror_conflict:'与对应经历内容不同', alias_conflict:'同义字段内容不同',duplicate_record:'与另一条记录完全重复',degree_is_education:'学历被写入学位',intern_in_work:'实习放在工作列表中',language_flat_only:'外语资料尚未整理为多段记录'};
    qualityEl.textContent = '';
    var summary = document.createElement('p');
    summary.textContent = (prefix || '') + '发现 ' + report.issues.length + ' 项待处理；' + report.mirrorCount + ' 项为与经历一致的兼容字段，不是重复经历。';
    qualityEl.appendChild(summary);
    var list = document.createElement('ul');
    report.issues.forEach(function (issue) {
      var li = document.createElement('li');
      li.textContent = qualityPath(issue.path) + '：' + (labels[issue.code] || '需要核对') + (issue.related ? '（' + qualityPath(issue.related) + '）' : '');
      list.appendChild(li);
    });
    qualityEl.appendChild(list);
  }
  var qualityBusy = false, saveInProgress = false;
  async function repairCurrentProfile(restore) {
    if (qualityBusy || saveInProgress) return;
    qualityBusy = true;
    try {
      var stored = await chrome.storage.local.get(['profile','profileRepairBackup']);
      if (restore) {
        var backup = stored.profileRepairBackup;
        if (!backup) { qualityEl.textContent = '尚无整理备份。'; return; }
        if (backup.activeRecord && DB) await DB.saveResume(backup.activeRecord);
        if (DB) await DB.setMeta('activeId', backup.activeId || null);
        await chrome.storage.local.set({profile:backup.profile});
        writeForm(backup.profile); markFormClean(); await refreshResumeList();
        showQuality(P.auditProfile(backup.profile), '已恢复整理前资料。'); return;
      }
      if (isFormDirty()) { qualityEl.textContent = '请先保存当前编辑，再整理资料。'; return; }
      var before = stored.profile || {}, result = P.repairProfile(before);
      var activeRecord = DB ? await DB.getActiveResume() : null;
      var activeId = DB ? await DB.getActiveId() : null;
      // 备份成功之后才修改档案；原值只保存在扩展私有存储。
      await chrome.storage.local.set({profileRepairBackup:{profile:before,activeRecord:activeRecord,activeId:activeId,createdAt:Date.now()}});
      if (DB) {
        var record = activeRecord || {name:before.resumeTitle || '本地简历',source:{type:'local'},rawText:''};
        record.profile = result.profile;
        var meta = await DB.saveResume(record);
        await DB.setMeta('activeId',meta.id);
      }
      await chrome.storage.local.set({profile:result.profile});
      writeForm(result.profile); markFormClean(); await refreshResumeList();
      showQuality(result.report, '已备份并整理 ' + result.changes.length + ' 项。');
    } catch (err) { if (qualityEl) qualityEl.textContent = '整理未完成：' + String(err.message || err); }
    finally { qualityBusy = false; }
  }
  var auditButton = document.getElementById('btn-audit-profile');
  if (auditButton) auditButton.addEventListener('click', async function () {
    var stored = await chrome.storage.local.get('profile');
    showQuality(P.auditProfile(isFormDirty() ? readForm() : stored.profile || {}));
  });
  var repairButton = document.getElementById('btn-repair-profile');
  if (repairButton) repairButton.addEventListener('click', function () { repairCurrentProfile(false); });
  var restoreButton = document.getElementById('btn-restore-profile');
  if (restoreButton) restoreButton.addEventListener('click', function () { repairCurrentProfile(true); });

  function showStatus(el, text, ms) {
    el.textContent = text || '';
    if (ms) {
      setTimeout(function () {
        if (el.textContent === text) el.textContent = '';
      }, ms);
    }
  }

  /** 未保存表单改动检测：切换档案前确认，避免静默丢改 */
  var formBaseline = '';
  var applyGen = 0;
  function snapshotForm() {
    try { return JSON.stringify(readForm()); } catch (err) { return ''; }
  }
  function markFormClean() {
    formBaseline = snapshotForm();
  }
  function isFormDirty() {
    return snapshotForm() !== formBaseline;
  }

  function readAiForm() {
    return AI.normalizeAiSettings({
      enabled: document.getElementById('ai-enabled').checked,
      apiBaseUrl: document.getElementById('ai-base').value,
      apiKey: document.getElementById('ai-key').value,
      model: document.getElementById('ai-model').value,
      mode: (document.getElementById('ai-mode') || {}).value || 'whitelist'
    });
  }

  function writeAiForm(settings) {
    var s = AI.normalizeAiSettings(settings);
    document.getElementById('ai-enabled').checked = !!s.enabled;
    document.getElementById('ai-base').value = s.apiBaseUrl || '';
    document.getElementById('ai-key').value = s.apiKey || '';
    document.getElementById('ai-model').value = s.model || '';
    var modeSel = document.getElementById('ai-mode');
    if (modeSel) modeSel.value = s.mode || 'whitelist';
  }


  // ————— v1.6.0：侧栏导航（单区块渲染 + #hash + 未保存提示 + 完成数）—————
  var panes = Array.prototype.slice.call(document.querySelectorAll('.pane'));
  var navItems = Array.prototype.slice.call(document.querySelectorAll('.nav-item'));
  var topbarTitle = document.getElementById('topbar-title');
  var topbarCode = document.getElementById('topbar-code');
  var saveState = document.getElementById('save-state');
  var currentPaneId = 'library';

  function paneById(id) {
    for (var i = 0; i < panes.length; i++) {
      if (panes[i].getAttribute('data-pane-id') === id) return panes[i];
    }
    return null;
  }

  function countFilled(pane) {
    var n = 0;
    pane.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.type === 'file' || el.type === 'hidden' || el.disabled || el.dataset.mirror) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked) n += 1;
        return;
      }
      if (String(el.value || '').trim()) n += 1;
    });
    return n;
  }

  function refreshCounts() {
    navItems.forEach(function (a) {
      var pane = paneById(a.getAttribute('data-pane'));
      if (!pane) return;
      var filled = countFilled(pane);
      var badge = a.querySelector('[data-nav-count]');
      if (badge) {
        badge.textContent = filled ? String(filled) : '·';
        badge.setAttribute('data-filled', filled ? 'true' : 'false');
      }
      var stat = pane.querySelector('[data-pane-filled]');
      if (stat) {
        var unit = stat.parentElement && stat.parentElement.querySelector('span');
        var paneId = pane.getAttribute('data-pane-id');
        if (paneId === 'library') {
          var archives = pane.querySelectorAll('.resume-item').length;
          stat.textContent = String(archives);
          stat.setAttribute('data-zero', archives ? 'false' : 'true');
          if (unit) unit.textContent = '份档案';
        } else if (paneId === 'ai') {
          var on = !!document.getElementById('ai-enabled') && document.getElementById('ai-enabled').checked;
          stat.textContent = on ? 'ON' : 'OFF';
          stat.setAttribute('data-zero', on ? 'false' : 'true');
          if (unit) unit.textContent = 'AI 状态';
        } else {
          stat.textContent = String(filled);
          stat.setAttribute('data-zero', filled ? 'false' : 'true');
          if (unit) unit.textContent = '已填字段';
        }
      }
    });
  }

  function showPane(id, opts) {
    var target = paneById(id) || paneById('library');
    if (!target) return;
    currentPaneId = target.getAttribute('data-pane-id');
    panes.forEach(function (p) { p.hidden = p !== target; });
    navItems.forEach(function (a) {
      var on = a.getAttribute('data-pane') === currentPaneId;
      a.setAttribute('aria-current', on ? 'true' : 'false');
    });
    var title = target.getAttribute('data-title') || '';
    var code = target.getAttribute('data-code') || '';
    if (topbarTitle) topbarTitle.textContent = title;
    if (topbarCode) topbarCode.textContent = code;
    var seq = target.querySelector('.pane-seq');
    if (seq) {
      var idx = panes.indexOf(target) + 1;
      seq.textContent = String(idx).padStart(2, '0') + ' / ' + String(panes.length).padStart(2, '0');
    }
    document.title = title + ' — 简历填写工具';
    if (!opts || opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'auto' : 'auto' });
    if (history.replaceState) history.replaceState(null, '', '#' + currentPaneId);
  }

  navItems.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      showPane(a.getAttribute('data-pane'));
    });
  });

  function markDirty() {
    if (!saveState) return;
    if (saveState.getAttribute('data-state') === 'dirty') return;
    saveState.setAttribute('data-state', 'dirty');
    saveState.textContent = '未保存';
  }

  function markClean() {
    if (!saveState) return;
    saveState.setAttribute('data-state', 'clean');
    saveState.textContent = '已保存';
  }

  document.addEventListener('input', function (e) {
    if (e.target && e.target.closest && e.target.closest('#profile-form')) markDirty();
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.closest && e.target.closest('#profile-form')) markDirty();
  });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 's') {
      e.preventDefault();
      if (form && form.requestSubmit) form.requestSubmit();
      else if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  window.addEventListener('hashchange', function () {
    var id = String(location.hash || '').replace('#', '');
    if (id && id !== currentPaneId) showPane(id);
  });

  // 保存成功后同步状态：showStatus 里会调用 markFormClean
  var _markFormClean = markFormClean;
  markFormClean = function () {
    _markFormClean();
    markClean();
    refreshCounts();
  };

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    // 表单只有扁平字段；必须从当前档案 / storage 拼回 eduList 等，否则一点保存就清空多段经历
    var saveWithLists = async function (existing) {
      if (saveInProgress || qualityBusy) return;
      saveInProgress = true;
      var profile = P.mergeFlatOntoProfile
        ? P.mergeFlatOntoProfile(readForm(), existing || {})
        : readForm();
      var formAtSave = snapshotForm();
      try {
        var stored = await chrome.storage.local.get('profile');
        var rec = DB ? await DB.getActiveResume() : null;
        await chrome.storage.local.set({profileBeforeSave:{profile:stored.profile,activeRecord:rec,createdAt:Date.now()}});
        if (DB) {
          rec = rec || {name:profile.resumeTitle || '本地简历',source:{type:'manual'},rawText:''};
          rec.profile = profile;
          var meta = await DB.saveResume(rec);
          await DB.setMeta('activeId',meta.id);
        }
        await chrome.storage.local.set({profile:profile});
        if (snapshotForm() === formAtSave) { writeForm(profile); markFormClean(); showStatus(saveStatus,'已保存 ✓',2500); }
        else showStatus(saveStatus,'已保存提交时的资料；页面仍有未保存修改',4000);
        await refreshResumeList();
      } catch (err) { showStatus(saveStatus,'保存未完成：' + String(err.message || err),6000); }
      finally { saveInProgress = false; }
    };
    if (DB) {
      DB.getActiveResume().then(function (rec) {
        if (rec && rec.profile) {
          saveWithLists(rec.profile);
          return;
        }
        chrome.storage.local.get(['profile'], function (result) {
          saveWithLists(result.profile || {});
        });
      }).catch(function () {
        chrome.storage.local.get(['profile'], function (result) {
          saveWithLists(result.profile || {});
        });
      });
    } else {
      chrome.storage.local.get(['profile'], function (result) {
        saveWithLists(result.profile || {});
      });
    }
  });

  aiForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var aiSettings = readAiForm();
    chrome.storage.local.set({ aiSettings: aiSettings }, function () {
      showStatus(aiSaveStatus, 'AI 设置已保存 ✓', 2500);
    });
  });

  document.getElementById('btn-clear').addEventListener('click', function () {
    if (!confirm('确定清空当前表单，并删除本地简历库中的全部档案？此操作不可撤销。（不影响 AI 设置）')) return;
    var empty = P.emptyProfile();
    chrome.storage.local.set({ profile: empty }, function () {
      writeForm(empty);
      markFormClean();
      showStatus(saveStatus, '已清空', 2500);
    });
    if (DB) {
      DB.clearAll().then(function () {
        return refreshResumeList();
      }).catch(function (err) {
        showStatus(saveStatus, '表单已清空，但简历库清理失败：' + String(err && err.message || err), 6000);
      });
    }
  });

  document.getElementById('btn-sample').addEventListener('click', function () {
    if (!confirm('加载示例资料将覆盖当前表单内容（尚未写入存储，需再点保存）。继续？')) return;
    writeForm(P.SAMPLE_PROFILE);
    showStatus(saveStatus, '已载入示例，请点击「保存资料」写入本地', 4000);
  });

  document.getElementById('btn-export').addEventListener('click', function () {
    var profile = readForm();
    var blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'resume-profile.json';
    a.click();
    URL.revokeObjectURL(url);
    showStatus(saveStatus, '已导出 JSON', 2000);
  });

  document.getElementById('btn-import').addEventListener('click', function () {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var raw = JSON.parse(String(reader.result || '{}'));
        var profile = P.normalizeProfile(raw);
        writeForm(profile);
        showStatus(saveStatus, '已导入到表单，请点击「保存资料」写入本地', 4000);
      } catch (err) {
        showStatus(saveStatus, '导入失败：JSON 无效', 4000);
      }
    };
    reader.readAsText(file, 'utf-8');
  });


  var expandBtn = document.getElementById('btn-expand-all');
  var collapseBtn = document.getElementById('btn-collapse-all');
  if (expandBtn) {
    expandBtn.addEventListener('click', function () {
      document.querySelectorAll('details.section').forEach(function (d) { d.open = true; });
    });
  }
  if (collapseBtn) {
    collapseBtn.addEventListener('click', function () {
      document.querySelectorAll('details.section').forEach(function (d) { d.open = false; });
    });
  }


  // ————— v1.5.0：多段经历编辑器事件 —————
  function moveListItem(listKey, index, delta) {
    var items = readListFromDom(listKey);
    // readListFromDom normalizes and may drop empties — re-read raw from DOM without normalize for reorder
    var root = document.getElementById('list-' + listKey);
    if (!root) return;
    var keys = LIST_ITEM_FIELDS[listKey] || [];
    var raw = [];
    Array.prototype.forEach.call(root.querySelectorAll('.list-row'), function (row) {
      var item = emptyListItem(listKey);
      keys.forEach(function (k) {
        var inp = row.querySelector('[data-field="' + k + '"]');
        item[k] = inp ? String(inp.value || '') : '';
      });
      raw.push(item);
    });
    var j = index + delta;
    if (j < 0 || j >= raw.length) return;
    var tmp = raw[index];
    raw[index] = raw[j];
    raw[j] = tmp;
    renderListEditor(listKey, raw);
  }

  document.querySelectorAll('button.list-add').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var listKey = btn.getAttribute('data-list');
      var root = document.getElementById('list-' + listKey);
      if (!root) return;
      var keys = LIST_ITEM_FIELDS[listKey] || [];
      var raw = [];
      Array.prototype.forEach.call(root.querySelectorAll('.list-row'), function (row) {
        var item = emptyListItem(listKey);
        keys.forEach(function (k) {
          var inp = row.querySelector('[data-field="' + k + '"]');
          item[k] = inp ? String(inp.value || '') : '';
        });
        raw.push(item);
      });
      raw.push(emptyListItem(listKey));
      renderListEditor(listKey, raw);
    });
  });

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button[data-list-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-list-act');
    var listKey = btn.getAttribute('data-list');
    var index = parseInt(btn.getAttribute('data-index'), 10);
    if (!listKey || isNaN(index)) return;
    if (act === 'up') moveListItem(listKey, index, -1);
    else if (act === 'down') moveListItem(listKey, index, 1);
    else if (act === 'remove') {
      var root = document.getElementById('list-' + listKey);
      if (!root) return;
      var keys = LIST_ITEM_FIELDS[listKey] || [];
      var raw = [];
      Array.prototype.forEach.call(root.querySelectorAll('.list-row'), function (row, i) {
        if (i === index) return;
        var item = emptyListItem(listKey);
        keys.forEach(function (k) {
          var inp = row.querySelector('[data-field="' + k + '"]');
          item[k] = inp ? String(inp.value || '') : '';
        });
        raw.push(item);
      });
      renderListEditor(listKey, raw);
    }
  });

  // ————— v1.4.0：简历库（IndexedDB 多档案） —————

  var pendingResume = null;   // 解析后待保存的结果
  var listEl = document.getElementById('resume-list');
  var previewWrap = document.getElementById('resume-preview-wrap');
  var previewEl = document.getElementById('resume-preview');
  var nameEl = document.getElementById('resume-name');
  var resumeStatus = document.getElementById('resume-status');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  function renderResumeList(items, activeId) {
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = '<p class="muted">还没有档案。导入一份 PDF / DOCX 简历即可自动解析入库。</p>';
      return;
    }
    listEl.innerHTML = items.map(function (it) {
      var badge = it.id === activeId ? '<span class="badge">当前使用</span>' : '';
      var warn = (it.warnings && it.warnings.length) ? '<span class="warn">' + esc(it.warnings.join('；')) + '</span>' : '';
      return '' +
        '<div class="resume-item">' +
          '<div class="resume-main">' +
            '<div class="resume-title">' + esc(it.name) + badge + '</div>' +
            '<div class="muted">' + esc((it.source && it.source.fileName) || '手工创建') +
              ' · ' + it.fieldCount + ' 项字段 · ' + fmtTime(it.updatedAt) + '</div>' +
            warn +
          '</div>' +
          '<div class="resume-actions">' +
            '<button type="button" class="btn ghost" data-act="apply" data-id="' + esc(it.id) + '">应用</button>' +
            '<button type="button" class="btn ghost" data-act="rename" data-id="' + esc(it.id) + '">重命名</button>' +
            '<button type="button" class="btn ghost" data-act="delete" data-id="' + esc(it.id) + '">删除</button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  async function refreshResumeList() {
    if (!DB) return;
    try {
      var items = await DB.listResumes();
      var activeId = await DB.getActiveId();
      renderResumeList(items, activeId);
      refreshCounts();
    } catch (err) {
      if (listEl) listEl.innerHTML = '<p class="warn">简历库不可用：' + esc(err && err.message) + '</p>';
    }
  }

  /** 把档案写入 chrome.storage（内容脚本读 profile）+ 表单 */
  function applyResume(rec) {
    var src = rec.profile || {};
    // normalizeProfile（1.4.1+）已保留列表；旧版兼容再抄一遍
    var profile = P.normalizeProfile(src);
    if (P.LIST_FIELDS) {
      P.LIST_FIELDS.forEach(function (k) {
        if (!profile[k] || !profile[k].length) {
          profile[k] = P.normalizeList(k, src[k] || []);
        }
      });
    }
    return new Promise(function (resolve) {
      chrome.storage.local.set({ profile: profile }, function () {
        writeForm(profile);
        markFormClean();
        resolve();
      });
    });
  }

  function renderPreview(parsed, fileName) {
    pendingResume = parsed;
    var p = parsed.profile;
    var rows = [
      ['姓名 / 性别', [p.name, p.gender].filter(Boolean).join(' / ')],
      ['手机 / 邮箱', [p.phone, p.email].filter(Boolean).join(' / ')],
      ['求职意向', [p.jobTarget, p.expectedCity, p.expectedSalary].filter(Boolean).join(' / ')],
      ['教育（' + parsed.stats.edu + ' 段）', p.eduList.map(function (e) { return [e.school, e.major, e.degree, e.start && (e.start + '~' + e.end)].filter(Boolean).join(' '); }).join('；')],
      ['工作（' + parsed.stats.work + ' 段）', p.workList.map(function (w) { return [w.company, w.title, w.start && (w.start + '~' + w.end)].filter(Boolean).join(' '); }).join('；')],
      ['项目（' + parsed.stats.project + ' 段）', p.projectList.map(function (x) { return [x.name, x.tech].filter(Boolean).join(' '); }).join('；')],
      ['技能', p.techSkills]
    ];
    previewEl.innerHTML = rows.map(function (r) {
      return '<div class="preview-row"><span class="k">' + esc(r[0]) + '</span><span class="v">' + esc(r[1] || '—') + '</span></div>';
    }).join('') +
      '<div class="preview-meta">置信度 ' + parsed.confidence + '% · ' + parsed.stats.chars + ' 字' +
      (parsed.warnings.length ? ' · <span class="warn">' + esc(parsed.warnings.join('；')) + '</span>' : '') + '</div>';

    var fallback = (fileName || '').replace(/\.[^.]+$/, '');
    nameEl.value = (p.name ? p.name + '-' + (p.jobTarget || '简历') : '') || fallback || '新档案';
    previewWrap.hidden = false;
    previewWrap.open = true;
    previewWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function handleResumeFile(file) {
    if (!file) return;
    var label = document.getElementById('resume-file-name');
    if (label) label.textContent = '解析中：' + file.name + ' …';
    RP.extractTextFromFile(file).then(function (res) {
      var parsed = RP.parseResumeText(res.text);
      parsed.kind = res.kind;
      parsed.fileName = file.name;
      parsed.fileSize = file.size;
      renderPreview(parsed, file.name);
      if (label) label.textContent = '已解析：' + file.name + (res.pages ? '（' + res.pages + ' 页）' : '');
    }).catch(function (err) {
      var msg = String(err && err.message || err);
      if (label) label.textContent = '解析失败：' + msg;
      showStatus(resumeStatus, '解析失败：' + msg, 6000);
    });
  }

  var fileInput = document.getElementById('resume-file');
  if (fileInput) {
    fileInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) handleResumeFile(f);
    });
  }

  var saveResumeBtn = document.getElementById('btn-save-resume');
  if (saveResumeBtn) {
    saveResumeBtn.addEventListener('click', async function () {
      if (!pendingResume) return;
      try {
        var meta = await DB.saveResume({
          name: nameEl.value.trim() || '未命名简历',
          source: {
            kind: pendingResume.kind,
            fileName: pendingResume.fileName,
            fileSize: pendingResume.fileSize
          },
          rawText: pendingResume.text,
          profile: pendingResume.profile,
          warnings: pendingResume.warnings
        });
        await DB.setMeta('activeId', meta.id);
        await applyResume(await DB.getResume(meta.id));
        pendingResume = null;
        previewWrap.hidden = true;
        showStatus(resumeStatus, '已保存并应用 ✓', 3000);
        await refreshResumeList();
      } catch (err) {
        showStatus(resumeStatus, '保存失败：' + String(err && err.message || err), 6000);
      }
    });
  }

  var discardBtn = document.getElementById('btn-discard-resume');
  if (discardBtn) {
    discardBtn.addEventListener('click', function () {
      pendingResume = null;
      previewWrap.hidden = true;
    });
  }

  if (listEl) {
    listEl.addEventListener('click', async function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');
      try {
        if (act === 'apply') {
          if (isFormDirty() && !confirm('当前表单有未保存修改，切换档案将丢弃这些修改。继续？')) return;
          var myGen = ++applyGen;
          var rec = await DB.getResume(id);
          if (!rec) return;
          if (myGen !== applyGen) return; // 快速连点时只应用最后一次
          await DB.setMeta('activeId', id);
          if (myGen !== applyGen) return;
          await applyResume(rec);
          if (myGen !== applyGen) return;
          showStatus(saveStatus, '已应用「' + rec.name + '」到当前表单', 3000);
          await refreshResumeList();
        } else if (act === 'rename') {
          var rec2 = await DB.getResume(id);
          if (!rec2) return;
          var next = prompt('新的档案名称', rec2.name);
          if (!next) return;
          rec2.name = next.trim();
          await DB.saveResume(rec2);
          await refreshResumeList();
        } else if (act === 'delete') {
          var rec3 = await DB.getResume(id);
          if (!rec3) return;
          if (!confirm('删除档案「' + rec3.name + '」？不可撤销。')) return;
          await DB.deleteResume(id);
          await refreshResumeList();
        }
      } catch (err) {
        alert('操作失败：' + String(err && err.message || err));
      }
    });
  }

  var exportLibBtn = document.getElementById('btn-export-lib');
  if (exportLibBtn) {
    exportLibBtn.addEventListener('click', async function () {
      try {
        var data = await DB.exportAll();
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'resume-library.json';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert('导出失败：' + String(err && err.message || err));
      }
    });
  }

  var importLibBtn = document.getElementById('btn-import-lib');
  var importLibFile = document.getElementById('import-lib-file');
  if (importLibBtn && importLibFile) {
    importLibBtn.addEventListener('click', function () { importLibFile.click(); });
    importLibFile.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onload = async function () {
        try {
          if (!confirm('导入将写入本地简历库（相同 id 会覆盖）。继续？')) return;
          var added = await DB.importAll(String(reader.result || '{}'));
          await refreshResumeList();
          alert('已导入 ' + added.length + ' 份档案');
        } catch (err) {
          alert('导入失败：' + String(err && err.message || err));
        }
      };
      reader.readAsText(f, 'utf-8');
    });
  }

  refreshResumeList();

  chrome.storage.local.get(['profile', 'aiSettings'], function (result) {
    writeForm(result.profile);
    writeAiForm(result.aiSettings || (AI && AI.DEFAULT_AI_SETTINGS));
    markFormClean();
  });

  // ————— v1.6.0 初始化：按 hash 恢复分区、刷新完成数 —————
  window.addEventListener('load', function () {
    refreshCounts();
    var initial = String(location.hash || '').replace('#', '');
    showPane(initial || currentPaneId, { scroll: false });
  });
  document.addEventListener('input', refreshCounts);
  document.addEventListener('input', function (event) {
    var editor = event.target.closest && event.target.closest('.list-editor[data-list]');
    if (editor) refreshMirrors(editor.getAttribute('data-list'));
  });
  document.addEventListener('change', refreshCounts);

})();
