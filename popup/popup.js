/**
 * 弹窗：展示资料摘要，并向当前标签页发送填写指令。
 */

function dash(v) {
  const s = (v || '').trim();
  return s || '—';
}

function renderSummary(profile) {
  const p = profile || {};
  document.getElementById('s-name').textContent = dash(p.name);
  document.getElementById('s-email').textContent = dash(p.email);
  document.getElementById('s-phone').textContent = dash(p.phone);
  document.getElementById('s-city').textContent = dash(p.city);
  document.getElementById('s-title').textContent = dash(p.title);

  const hasData = Object.values(p).some((v) => v && String(v).trim());
  document.getElementById('empty-hint').hidden = hasData;
  document.getElementById('btn-fill').disabled = !hasData;
}

function setStatus(text, kind) {
  const el = document.getElementById('status');
  el.textContent = text || '';
  el.classList.remove('ok', 'err');
  if (kind) el.classList.add(kind);
}

document.getElementById('link-options').addEventListener('click', (e) => {
  e.preventDefault();
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options/options.html'));
  }
});

document.getElementById('btn-fill').addEventListener('click', async () => {
  setStatus('正在填写…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus('无法获取当前标签页', 'err');
      return;
    }
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
      setStatus('当前页面无法注入脚本（浏览器内置页）', 'err');
      return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: 'FILL_FORM' });
    } catch {
      // 内容脚本可能尚未注入（例如刚安装），用 scripting 注入后再发
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/autofill.js']
      });
      response = await chrome.tabs.sendMessage(tab.id, { type: 'FILL_FORM' });
    }

    if (!response?.ok) {
      if (response?.reason === 'empty_profile') {
        setStatus('资料为空，请先编辑简历资料', 'err');
      } else {
        setStatus('填写失败，请刷新页面后重试', 'err');
      }
      return;
    }

    if (response.filled === 0) {
      setStatus('未匹配到可填写字段，可手动核对页面表单', 'err');
    } else {
      setStatus(`已填写 ${response.filled} 个字段，请核对后再提交`, 'ok');
    }
  } catch (err) {
    setStatus('填写出错：' + (err.message || String(err)), 'err');
  }
});

chrome.storage.local.get('profile', (result) => {
  renderSummary(result.profile);
});
