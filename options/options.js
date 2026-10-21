/**
 * 选项页：编辑并保存简历 profile + AI 设置；导入/导出 JSON、示例资料、清空确认。
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

  function readForm() {
    var data = P.emptyProfile();
    FIELDS.forEach(function (key) {
      var el = form.elements.namedItem(key);
      data[key] = el ? String(el.value || '').trim() : '';
    });
    return data;
  }

  function writeForm(profile) {
    var p = P.normalizeProfile(profile);
    FIELDS.forEach(function (key) {
      var el = form.elements.namedItem(key);
      if (el) el.value = p[key] || '';
    });
  }

  function showStatus(el, text, ms) {
    el.textContent = text || '';
    if (ms) {
      setTimeout(function () {
        if (el.textContent === text) el.textContent = '';
      }, ms);
    }
  }

  function readAiForm() {
    return AI.normalizeAiSettings({
      enabled: document.getElementById('ai-enabled').checked,
      apiBaseUrl: document.getElementById('ai-base').value,
      apiKey: document.getElementById('ai-key').value,
      model: document.getElementById('ai-model').value
    });
  }

  function writeAiForm(settings) {
    var s = AI.normalizeAiSettings(settings);
    document.getElementById('ai-enabled').checked = !!s.enabled;
    document.getElementById('ai-base').value = s.apiBaseUrl || '';
    document.getElementById('ai-key').value = s.apiKey || '';
    document.getElementById('ai-model').value = s.model || '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var profile = readForm();
    chrome.storage.local.set({ profile: profile }, function () {
      showStatus(saveStatus, '已保存 ✓', 2500);
    });
    // 同步写回当前档案（库里那份也要跟着变）
    if (DB) {
      DB.getActiveResume().then(function (rec) {
        if (!rec) return;
        rec.profile = profile;
        return DB.saveResume(rec).then(refreshResumeList);
      }).catch(function () { /* 无档案时忽略 */ });
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
    if (!confirm('确定清空所有本地简历资料？此操作不可撤销。（不影响 AI 设置）')) return;
    var empty = P.emptyProfile();
    chrome.storage.local.set({ profile: empty }, function () {
      writeForm(empty);
      showStatus(saveStatus, '已清空', 2500);
    });
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
    } catch (err) {
      if (listEl) listEl.innerHTML = '<p class="warn">简历库不可用：' + esc(err && err.message) + '</p>';
    }
  }

  /** 把档案写入 chrome.storage（内容脚本读 profile）+ 表单 */
  function applyResume(rec) {
    var src = rec.profile || {};
    var profile = P.normalizeProfile(src);
    P.LIST_FIELDS.forEach(function (k) {
      profile[k] = P.normalizeList(k, src[k] || []);
    });
    return new Promise(function (resolve) {
      chrome.storage.local.set({ profile: profile }, function () {
        writeForm(profile);
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
          var rec = await DB.getResume(id);
          if (!rec) return;
          await DB.setMeta('activeId', id);
          await applyResume(rec);
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
  });
})();
