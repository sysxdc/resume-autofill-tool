/**
 * 弹窗：资料摘要、一键填写、扫描字段、编辑资料、版本号。
 */
(function () {
  'use strict';

  var P = globalThis.ResumeAutofillProfile;

  function dash(v) {
    var s = (v || '').trim();
    return s || '—';
  }

  function renderSummary(profile) {
    var p = profile || {};
    document.getElementById('s-name').textContent = dash(p.name);
    document.getElementById('s-email').textContent = dash(p.email);
    document.getElementById('s-phone').textContent = dash(p.phone);
    document.getElementById('s-city').textContent = dash(p.city);
    document.getElementById('s-company').textContent = dash(p.company);
    document.getElementById('s-title').textContent = dash(p.title);
    document.getElementById('s-school').textContent = dash(p.school);

    var hasData = P ? P.profileHasData(p) : Object.values(p).some(function (v) {
      return v && String(v).trim();
    });
    document.getElementById('empty-hint').hidden = hasData;
    document.getElementById('btn-fill').disabled = !hasData;
  }

  function setStatus(text, kind) {
    var el = document.getElementById('status');
    el.textContent = text || '';
    el.classList.remove('ok', 'err');
    if (kind) el.classList.add(kind);
  }

  function setLastFill(filled, keys) {
    var el = document.getElementById('last-fill');
    if (filled == null) {
      el.textContent = '—';
      return;
    }
    var keyPart = keys && keys.length ? '（' + keys.join(', ') + '）' : '';
    el.textContent = filled + ' 个字段' + keyPart;
  }

  function setLastScan(fields) {
    var el = document.getElementById('last-scan');
    var list = document.getElementById('scan-list');
    if (!fields) {
      el.textContent = '—';
      list.hidden = true;
      list.innerHTML = '';
      return;
    }
    el.textContent = fields.length + ' 个可识别字段';
    list.innerHTML = '';
    if (!fields.length) {
      list.hidden = true;
      return;
    }
    fields.slice(0, 12).forEach(function (f) {
      var li = document.createElement('li');
      li.textContent = f.key + ' ← ' + (f.hint || '');
      list.appendChild(li);
    });
    if (fields.length > 12) {
      var more = document.createElement('li');
      more.className = 'more';
      more.textContent = '…另有 ' + (fields.length - 12) + ' 项';
      list.appendChild(more);
    }
    list.hidden = false;
  }

  async function getActiveTab() {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  function isRestrictedUrl(url) {
    if (!url) return true;
    return (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('edge://') ||
      url.startsWith('about:') ||
      url.startsWith('devtools://')
    );
  }

  async function ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING_CONTENT' });
      return;
    } catch (_) { /* need inject */ }
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['shared/match.js', 'content/autofill.js']
    });
  }

  async function sendToTab(type) {
    var tab = await getActiveTab();
    if (!tab || !tab.id) throw new Error('无法获取当前标签页');
    if (isRestrictedUrl(tab.url)) throw new Error('当前页面无法注入脚本（浏览器内置页）');
    await ensureContentScript(tab.id);
    return chrome.tabs.sendMessage(tab.id, { type: type });
  }

  document.getElementById('link-options').addEventListener('click', function (e) {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL('options/options.html'));
  });

  document.getElementById('btn-fill').addEventListener('click', async function () {
    setStatus('正在填写…');
    try {
      var response = await sendToTab('FILL_FORM');
      if (!response || !response.ok) {
        if (response && response.reason === 'empty_profile') {
          setStatus('资料为空，请先编辑资料', 'err');
        } else {
          setStatus('填写失败，请刷新页面后重试', 'err');
        }
        return;
      }
      setLastFill(response.filled, response.filledKeys || []);
      if (response.filled === 0) {
        setStatus('未匹配到可填写字段，可先点「扫描字段」核对', 'err');
      } else {
        setStatus('已填写 ' + response.filled + ' 个字段，请核对后再提交', 'ok');
      }
    } catch (err) {
      setStatus('填写出错：' + (err.message || String(err)), 'err');
    }
  });

  document.getElementById('btn-scan').addEventListener('click', async function () {
    setStatus('正在扫描…');
    try {
      var response = await sendToTab('SCAN_FIELDS');
      if (!response || !response.ok) {
        setStatus('扫描失败，请刷新页面后重试', 'err');
        return;
      }
      setLastScan(response.fields || []);
      setStatus('扫描到 ' + (response.count || 0) + ' 个可识别字段', 'ok');
    } catch (err) {
      setStatus('扫描出错：' + (err.message || String(err)), 'err');
    }
  });

  try {
    var manifest = chrome.runtime.getManifest();
    document.getElementById('ext-version').textContent = 'v' + manifest.version;
  } catch (_) {
    document.getElementById('ext-version').textContent = '';
  }

  chrome.storage.local.get('profile', function (result) {
    renderSummary(result.profile);
  });
})();
