/**
 * 弹窗：资料摘要、一键填写、AI 巡查/填写、扫描字段、编辑资料。
 */
(function () {
  'use strict';

  var P = globalThis.ResumeAutofillProfile;
  var lastMappings = null;

  function dash(v) {
    var s = (v || '').trim();
    return s || '—';
  }

  function renderSummary(profile) {
    var p = profile || {};
    document.getElementById('s-name').textContent = dash(p.name);
    document.getElementById('s-email').textContent = dash(p.email);
    document.getElementById('s-phone').textContent = dash(p.phone);
    document.getElementById('s-city').textContent = dash(p.city || p.currentCity);
    document.getElementById('s-company').textContent = dash(p.company);
    document.getElementById('s-title').textContent = dash(p.title);
    document.getElementById('s-school').textContent = dash(p.school);

    var hasData = P ? P.profileHasData(p) : Object.values(p).some(function (v) {
      return v && String(v).trim();
    });
    document.getElementById('empty-hint').hidden = hasData;
    document.getElementById('btn-fill').disabled = !hasData;
    document.getElementById('btn-ai-fill').disabled = !hasData;
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
    var keyPart = keys && keys.length ? '（' + keys.slice(0, 8).join(', ') + (keys.length > 8 ? '…' : '') + '）' : '';
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
      var conf = f.confidence != null ? ' [' + Math.round(f.confidence * 100) + '%]' : '';
      li.textContent = f.key + conf + ' ← ' + (f.hint || '');
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

  function renderPatrol(mappings, meta) {
    var wrap = document.getElementById('patrol-wrap');
    var summary = document.getElementById('patrol-summary');
    var list = document.getElementById('patrol-list');
    wrap.hidden = false;
    list.innerHTML = '';
    var fillable = (mappings || []).filter(function (m) {
      return m.action === 'fill' || m.action === 'custom_answer';
    });
    var low = fillable.filter(function (m) { return (m.confidence || 0) < 0.72; });
    var src = (meta && meta.source) || '';
    summary.textContent =
      fillable.length + ' 可填 / ' + (mappings || []).length + ' 字段' +
      (src ? ' · ' + src : '') +
      (low.length ? ' · ' + low.length + ' 低置信' : '');

    (mappings || []).slice(0, 20).forEach(function (m) {
      var li = document.createElement('li');
      var conf = Math.round((m.confidence || 0) * 100);
      var keyPart = m.profileKey || (m.action === 'custom_answer' ? '自定义' : '—');
      var val = m.suggestedValue ? String(m.suggestedValue).slice(0, 40) : '';
      if (m.suggestedValue && m.suggestedValue.length > 40) val += '…';
      li.textContent =
        (m.label || ('#' + m.index)) + ' → ' + keyPart +
        (val ? ' = ' + val : '') +
        ' (' + m.action + ', ' + conf + '%)';
      if ((m.confidence || 0) < 0.72 && m.action !== 'skip') {
        li.classList.add('low-conf');
      }
      if (m.action === 'skip') li.classList.add('skip');
      list.appendChild(li);
    });
    if ((mappings || []).length > 20) {
      var more = document.createElement('li');
      more.className = 'more';
      more.textContent = '…另有 ' + (mappings.length - 20) + ' 项';
      list.appendChild(more);
    }
  }

  function setAiStatus(status) {
    var el = document.getElementById('ai-status');
    if (!status || !status.ok) {
      el.textContent = '未知';
      return;
    }
    if (status.configured) {
      el.textContent = '已启用' + (status.model ? ' · ' + status.model : '');
      el.classList.add('ai-on');
    } else if (status.enabled && !status.hasKey) {
      el.textContent = '未配置（缺 Key）';
      el.classList.remove('ai-on');
    } else {
      el.textContent = '未配置';
      el.classList.remove('ai-on');
    }
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
    // 文件清单以 manifest 为准：只注入 match + autofill 会缺日期层 / 审计 / 拆出去的模块，
    // 页面主环境桥接（world: MAIN）也得单独注入，否则 React / Vue 受控组件写不进去
    var scripts = (chrome.runtime.getManifest().content_scripts || []);
    for (var i = 0; i < scripts.length; i++) {
      var cs = scripts[i];
      if (!cs.js || !cs.js.length) continue;
      var opts = { target: { tabId: tabId, allFrames: !!cs.all_frames }, files: cs.js };
      if (cs.world === 'MAIN') opts.world = 'MAIN';
      await chrome.scripting.executeScript(opts);
    }
  }

  async function sendToTab(type, payload) {
    var tab = await getActiveTab();
    if (!tab || !tab.id) throw new Error('无法获取当前标签页');
    if (isRestrictedUrl(tab.url)) throw new Error('当前页面无法注入脚本（浏览器内置页）');
    await ensureContentScript(tab.id);
    var msg = Object.assign({ type: type }, payload || {});
    var routes = {FILL_FORM:'RUN_FILL',COLLECT_FIELDS:'RUN_COLLECT',APPLY_MAPPINGS:'RUN_APPLY',SCAN_FIELDS:'RUN_SCAN'};
    if (routes[type]) return chrome.runtime.sendMessage(Object.assign({},msg,{type:routes[type],tabId:tab.id}));
    return chrome.tabs.sendMessage(tab.id,msg,{frameId:0});
  }

  async function runMapping() {
    var collected = await sendToTab('COLLECT_FIELDS');
    if (!collected || !collected.ok) throw new Error('无法收集页面字段');
    var fields = collected.fields || [];
    if (!fields.length) {
      return { ok: true, mappings: [], source: 'empty', warning: '页面未发现可填字段' };
    }
    var mapped = await chrome.runtime.sendMessage({
      type: 'AI_MAP_FIELDS',
      fields: fields
    });
    if (!mapped || !mapped.ok) {
      throw new Error((mapped && mapped.error) || '映射失败');
    }
    lastMappings = mapped.mappings || [];
    return mapped;
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
          setStatus((response && response.unverifiedFrames || []).length ? '部分 iframe 未验证，请核对后重试' : '填写失败，请刷新页面后重试', 'err');
        }
        return;
      }
      setLastFill(response.filled, response.filledKeys || []);
      if ((response.unverifiedFrames || []).length) response.warning = '部分 iframe 未验证';
      if (response.filled === 0) {
        setStatus((response.warning ? response.warning + '；' : '') + '未匹配到可填写字段，可先点「扫描字段」或「AI 巡查」', 'err');
      } else {
        setStatus('已填写 ' + response.filled + ' 个字段' + (response.warning ? '；' + response.warning : '') + '；保存结果未验证，请核对后再提交', response.warning ? 'err' : 'ok');
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

  document.getElementById('btn-ai-patrol').addEventListener('click', async function () {
    setStatus('正在 AI 巡查…');
    try {
      var mapped = await runMapping();
      renderPatrol(mapped.mappings || [], mapped);
      if (mapped.warning) {
        setStatus(mapped.warning, mapped.source === 'heuristic_fallback' ? 'err' : 'ok');
      } else if (mapped.source === 'ai') {
        setStatus('AI 巡查完成（模型映射）', 'ok');
      } else {
        setStatus('本地模糊匹配巡查完成', 'ok');
      }
    } catch (err) {
      setStatus('巡查出错：' + (err.message || String(err)), 'err');
    }
  });

  document.getElementById('btn-ai-fill').addEventListener('click', async function () {
    setStatus('正在 AI 填写…');
    try {
      var mapped = await runMapping();
      renderPatrol(mapped.mappings || [], mapped);
      var toApply = (mapped.mappings || []).filter(function (m) {
        return (m.action === 'fill' || m.action === 'custom_answer') && m.suggestedValue;
      });
      if (!toApply.length) {
        setStatus((mapped.warning ? mapped.warning + '；' : '') + '没有可填写的映射结果', 'err');
        return;
      }
      var response = await sendToTab('APPLY_MAPPINGS', { mappings: mapped.mappings });
      if (!response || !response.ok) {
        setStatus('AI 填写失败，请刷新后重试', 'err');
        return;
      }
      setLastFill(response.filled, response.filledKeys || []);
      if ((response.unverifiedFrames || []).length) response.warning = '部分 iframe 未验证';
      var prefix = [mapped.warning,response.warning].filter(Boolean).join('；');
      if (prefix) prefix += '。';
      if (response.filled === 0) {
        setStatus(prefix + '映射完成但未能写入字段（可能是 select 无匹配项）', 'err');
      } else {
        setStatus(prefix + 'AI 已填写 ' + response.filled + ' 个字段，请核对后再提交', 'ok');
      }
    } catch (err) {
      setStatus('AI 填写出错：' + (err.message || String(err)), 'err');
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

  chrome.runtime.sendMessage({ type: 'GET_AI_STATUS' }).then(setAiStatus).catch(function () {
    setAiStatus(null);
  });
})();
