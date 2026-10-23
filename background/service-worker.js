/**
 * 简历填写工具 — 后台 Service Worker
 * 安装时初始化空 profile / aiSettings；处理 AI_MAP_FIELDS（CORS 友好）。
 * 注意：永不 console.log API Key。
 */
importScripts('../shared/profile.js', '../shared/match.js', '../shared/ai.js');

var P = self.ResumeAutofillProfile;
var M = self.ResumeAutofillMatch;
var AI = self.ResumeAutofillAI;

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') {
    chrome.storage.local.get(['profile', 'aiSettings'], function (result) {
      var patch = {};
      if (!result.profile) {
        patch.profile = P ? P.emptyProfile() : {};
      }
      if (!result.aiSettings) {
        patch.aiSettings = AI ? AI.DEFAULT_AI_SETTINGS : {
          enabled: false,
          apiBaseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini'
        };
      }
      if (Object.keys(patch).length) chrome.storage.local.set(patch);
    });
  }
});

function storageGet(keys) {
  return new Promise(function (resolve) {
    chrome.storage.local.get(keys, function (result) {
      resolve(result || {});
    });
  });
}

function fetchWithTimeout(url, options, ms) {
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () {
    if (controller) controller.abort();
  }, ms || 20000);
  var opts = Object.assign({}, options || {});
  if (controller) opts.signal = controller.signal;
  return fetch(url, opts).finally(function () {
    clearTimeout(timer);
  });
}

/**
 * 调用 OpenAI-compatible chat completions，返回映射数组或抛错。
 */
async function callLlmMap(settings, profile, fields) {
  var s = AI.normalizeAiSettings(settings);
  var base = s.apiBaseUrl.replace(/\/+$/, '');
  var url = base + '/chat/completions';
  // 请求体统一由 shared/ai.js 组装：默认 whitelist 模式只发字段标签/控件类型/选项文本，
  // profile 值不出本机（旧行为 'full' 需用户在选项页显式选择）。
  var body = AI.buildAiRequestBody(s, profile, fields, { ProfileApi: P });

  var resp;
  try {
    resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.apiKey
      },
      body: JSON.stringify(body)
    }, 20000);
  } catch (err) {
    var msg = err && err.name === 'AbortError' ? 'AI 请求超时（20s）' : ('AI 网络错误：' + (err.message || String(err)));
    var e = new Error(msg);
    e.code = 'network';
    throw e;
  }

  if (!resp.ok) {
    var errText = '';
    try { errText = await resp.text(); } catch (_) { /* ignore */ }
    var e2 = new Error('AI 接口返回 ' + resp.status + (errText ? '：' + errText.slice(0, 120) : ''));
    e2.code = 'http';
    throw e2;
  }

  var data = await resp.json();
  var content =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;
  var parsed = AI.parseAiMappingJson(content);
  if (!parsed) {
    var e3 = new Error('AI 返回无法解析为 JSON 映射');
    e3.code = 'parse';
    throw e3;
  }
  return parsed;
}

async function handleAiMapFields(message) {
  var store = await storageGet(['profile', 'aiSettings']);
  var profile = P ? P.normalizeProfile(store.profile) : (store.profile || {});
  var settings = AI.normalizeAiSettings(store.aiSettings);
  var fields = (message && message.fields) || [];

  // 允许 popup 覆盖（一般不传）
  if (message && message.profile) {
    profile = P ? P.normalizeProfile(message.profile) : message.profile;
  }

  var useAi = AI.aiConfigured(settings) && !(message && message.forceHeuristic);

  if (useAi) {
    try {
      var aiItems = await callLlmMap(settings, profile, fields);
      var merged = AI.mergeAiMappingWithProfile(aiItems, fields, profile, M, P, { mode: settings.mode });
      return {
        ok: true,
        source: 'ai',
        mappings: merged,
        aiEnabled: true
      };
    } catch (err) {
      var heuristic = M.heuristicMapFields(fields, profile);
      return {
        ok: true,
        source: 'heuristic_fallback',
        mappings: heuristic,
        aiEnabled: true,
        warning: err.message || 'AI 调用失败，已回退本地模糊匹配'
      };
    }
  }

  return {
    ok: true,
    source: 'heuristic',
    mappings: M.heuristicMapFields(fields, profile),
    aiEnabled: false,
    warning: settings.enabled && !settings.apiKey
      ? '已开启 AI 但未配置 API Key，使用本地匹配'
      : (!settings.enabled ? 'AI 未启用，使用本地模糊匹配' : null)
  };
}

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (message && message.type === 'ping') {
    var manifest = chrome.runtime.getManifest();
    sendResponse({ ok: true, version: manifest.version });
    return true;
  }
  if (message && message.type === 'OPEN_OPTIONS') {
    try { chrome.runtime.openOptionsPage(); } catch (_) { /* ignore */ }
    sendResponse({ ok: true });
    return false;
  }
  if (message && message.type === 'GET_AI_STATUS') {
    chrome.storage.local.get('aiSettings', function (result) {
      var s = AI.normalizeAiSettings(result.aiSettings);
      sendResponse({
        ok: true,
        enabled: s.enabled,
        configured: AI.aiConfigured(s),
        model: s.model,
        hasKey: !!s.apiKey
      });
    });
    return true;
  }
  if (message && message.type === 'AI_MAP_FIELDS') {
    handleAiMapFields(message).then(sendResponse).catch(function (err) {
      sendResponse({
        ok: false,
        error: err.message || String(err)
      });
    });
    return true;
  }
  return false;
});
