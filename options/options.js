/**
 * 选项页：编辑并保存简历 profile；支持导入/导出 JSON、示例资料、清空确认。
 */
(function () {
  'use strict';

  var P = globalThis.ResumeAutofillProfile;
  var FIELDS = P.PROFILE_FIELDS;
  var form = document.getElementById('profile-form');
  var saveStatus = document.getElementById('save-status');

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

  function showStatus(text, ms) {
    saveStatus.textContent = text || '';
    if (ms) {
      setTimeout(function () {
        if (saveStatus.textContent === text) saveStatus.textContent = '';
      }, ms);
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var profile = readForm();
    chrome.storage.local.set({ profile: profile }, function () {
      showStatus('已保存 ✓', 2500);
    });
  });

  document.getElementById('btn-clear').addEventListener('click', function () {
    if (!confirm('确定清空所有本地简历资料？此操作不可撤销。')) return;
    var empty = P.emptyProfile();
    chrome.storage.local.set({ profile: empty }, function () {
      writeForm(empty);
      showStatus('已清空', 2500);
    });
  });

  document.getElementById('btn-sample').addEventListener('click', function () {
    if (!confirm('加载示例资料将覆盖当前表单内容（尚未写入存储，需再点保存）。继续？')) return;
    writeForm(P.SAMPLE_PROFILE);
    showStatus('已载入示例，请点击「保存资料」写入本地', 4000);
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
    showStatus('已导出 JSON', 2000);
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
        showStatus('已导入到表单，请点击「保存资料」写入本地', 4000);
      } catch (err) {
        showStatus('导入失败：JSON 无效', 4000);
      }
    };
    reader.readAsText(file, 'utf-8');
  });

  chrome.storage.local.get('profile', function (result) {
    writeForm(result.profile);
  });
})();
