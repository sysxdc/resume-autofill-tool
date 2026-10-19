/**
 * AI 设置默认值、归一化、以及纯函数：合并 LLM JSON 映射与 profile。
 * 浏览器：ResumeAutofillAI；Node：module.exports。
 */
(function (root, factory) {
  var Profile = root.ResumeAutofillProfile;
  var Match = root.ResumeAutofillMatch;
  if (typeof module === 'object' && module.exports) {
    try {
      var path = require('path');
      if (!Profile) Profile = require(path.join(__dirname, 'profile.js'));
      if (!Match) Match = require(path.join(__dirname, 'match.js'));
    } catch (_) { /* bundler / non-node */ }
  }
  var api = factory(Profile, Match);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ResumeAutofillAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Profile, Match) {
  'use strict';

  var DEFAULT_AI_SETTINGS = {
    enabled: false,
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini'
  };

  function normalizeAiSettings(raw) {
    var src = raw || {};
    return {
      enabled: !!src.enabled,
      apiBaseUrl: String(src.apiBaseUrl || DEFAULT_AI_SETTINGS.apiBaseUrl).trim().replace(/\/+$/, '') ||
        DEFAULT_AI_SETTINGS.apiBaseUrl,
      apiKey: String(src.apiKey || '').trim(),
      model: String(src.model || DEFAULT_AI_SETTINGS.model).trim() || DEFAULT_AI_SETTINGS.model
    };
  }

  function aiConfigured(settings) {
    var s = normalizeAiSettings(settings);
    return !!(s.enabled && s.apiKey && s.apiBaseUrl && s.model);
  }

  function buildSystemPrompt() {
    return [
      '你是求职表单字段映射助手。根据候选人 resume profile（JSON）与页面字段列表，',
      '为每个字段返回映射。严格只输出 JSON 数组，不要 markdown。',
      '每个元素形如：',
      '{"index":0,"action":"fill"|"skip"|"custom_answer","profileKey":"email"|null,"value":"...","confidence":0.0-1.0,"reason":"..."}',
      '规则：',
      '1. action=fill 时 profileKey 必须是 profile 中存在的键，value 取自 profile。',
      '2. action=custom_answer 仅用于开放题（textarea/text，如 why join / 自我介绍），value 须基于 summary/skills/achievements 改写，不得编造雇主经历。',
      '3. EEO / 种族 / 残疾 / 性别自认 / veteran / how did you hear / 法律竞业 / 是否曾在本公司任职 → action=skip。',
      '4. SELECT 字段（带 options）：value 必须与某一个 option 的 text 或 value 完全一致或明显同义；若 profile 城市/地区与 options 无一匹配 → action=skip。禁止为 select 发明自由文本或粘贴长段落。',
      '5. Yes/No（或 Yes/No/Prefer not）select：只返回与 option 匹配的 Yes 或 No（或 Prefer not…）；不可把 custom_answer / workAuth 长句写入 select。签证/赞助题根据意图映射为 Yes/No，无法判断则 skip。',
      '6. 「Where are you currently based?」类地区枚举（US/Canada/Located Elsewhere）不可填城市名；城市不在 options 中则 skip。',
      '7. 不要发明虚假公司、职位、学历；profile 没有的敏感证件号可 skip。',
      '8. confidence：高确信 ≥0.85，中等 0.6–0.85，低 <0.6。'
    ].join('');
  }

  function buildUserPrompt(profileObj, fields) {
    return JSON.stringify({
      profile: profileObj,
      fields: fields
    });
  }

  function parseAiMappingJson(text) {
    var raw = String(text || '').trim();
    if (!raw) return null;
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      var data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.mappings)) return data.mappings;
      if (data && Array.isArray(data.fields)) return data.fields;
      return null;
    } catch (_) {
      var m = raw.match(/\[[\s\S]*\]/);
      if (!m) return null;
      try {
        var arr = JSON.parse(m[0]);
        return Array.isArray(arr) ? arr : null;
      } catch (_2) {
        return null;
      }
    }
  }

  /**
   * 对带 options 的 select：必须能 matchSelectOption，否则 skip。
   * Yes/No 集先 normalizeToYesNo；custom_answer 长文不可写入 select。
   */
  function coerceSelectValue(M, field, rawValue) {
    var opts = field && field.options;
    if (!opts || !opts.length) return { ok: true, value: String(rawValue || '').trim() };
    var raw = String(rawValue || '').trim();
    if (!raw) return { ok: false, value: '' };

    if (M && M.isYesNoOnlySelect && M.isYesNoOnlySelect(opts)) {
      var yn = M.normalizeToYesNo ? M.normalizeToYesNo(raw) : null;
      if (!yn) return { ok: false, value: '', reason: 'yesno-unmapped' };
      raw = yn;
    }

    if (M && M.matchSelectOption) {
      var matched = M.matchSelectOption(opts, raw);
      if (!matched) return { ok: false, value: '', reason: 'select-no-match' };
      var t = String(matched.text || '').trim();
      var v = String(matched.value || '').trim();
      return { ok: true, value: t || v || raw };
    }
    return { ok: true, value: raw };
  }

  /**
   * 纯函数：把 AI JSON 条目与 profile 合并为统一映射结果（无网络）。
   */
  function mergeAiMappingWithProfile(aiItems, fields, profile, MatchApi, ProfileApi) {
    var M = MatchApi || Match;
    var P = ProfileApi || Profile;
    var knownKeys = {};
    if (P && P.PROFILE_FIELDS) {
      P.PROFILE_FIELDS.forEach(function (k) { knownKeys[k] = 1; });
    }
    var byIndex = {};
    (aiItems || []).forEach(function (item) {
      if (item && typeof item.index === 'number') byIndex[item.index] = item;
    });

    var keyCounts = {};
    var out = [];
    var i, f, item, idx, action, profileKey, value, conf, label, coerced;

    for (i = 0; i < (fields || []).length; i++) {
      f = fields[i] || {};
      idx = typeof f.index === 'number' ? f.index : i;
      item = byIndex[idx] || null;
      label = f.label || f.placeholder || f.name || f.id || '';

      var hints = [f.label, f.placeholder, f.name, f.id].filter(Boolean).join(' ');
      if (M && M.isSkipContext && M.isSkipContext(hints)) {
        out.push({
          index: idx,
          profileKey: null,
          action: 'skip',
          confidence: 1,
          suggestedValue: '',
          method: 'denylist',
          label: label,
          reason: 'denylist'
        });
        continue;
      }

      if (!item) {
        if (M && M.heuristicMapFields) {
          var h = M.heuristicMapFields([f], profile)[0];
          if (h) {
            h.method = (h.method || 'heuristic') + '+fallback';
            out.push(h);
            continue;
          }
        }
        out.push({
          index: idx,
          profileKey: null,
          action: 'skip',
          confidence: 0,
          suggestedValue: '',
          method: 'ai-missing',
          label: label
        });
        continue;
      }

      action = String(item.action || 'skip').toLowerCase();
      profileKey = item.profileKey || null;
      conf = typeof item.confidence === 'number' ? item.confidence : 0.7;
      if (conf > 1) conf = 1;
      if (conf < 0) conf = 0;

      if (action === 'custom_answer') {
        value = String(item.value || '').trim();
        if (!value) {
          action = 'skip';
        } else if (f.options && f.options.length) {
          // select 禁止粘贴 custom_answer 段落；尝试 Yes/No 归一或 option 匹配
          coerced = coerceSelectValue(M, f, value);
          if (!coerced.ok) {
            action = 'skip';
            value = '';
          } else {
            // 成功映射到 option 时降为 fill（短 Yes/No），不再当开放题
            action = 'fill';
            value = coerced.value;
            profileKey = null;
          }
        }
        out.push({
          index: idx,
          profileKey: profileKey,
          action: action,
          confidence: conf,
          suggestedValue: value || '',
          method: 'ai',
          label: label,
          reason: item.reason || (action === 'skip' ? 'select-reject-custom' : '')
        });
        continue;
      }

      if (action === 'fill') {
        if (profileKey && knownKeys[profileKey]) {
          value = M && M.profileValue
            ? M.profileValue(profile, profileKey)
            : String((profile && profile[profileKey]) || '').trim();
          // AI 也可直接给 value（如已是 Yes/No）；优先 profile，空则用 item.value
          if (!value && item.value) value = String(item.value).trim();
          if (!value) {
            action = 'skip';
            value = '';
          } else {
            var count = keyCounts[profileKey] || 0;
            var cap = (M && M.MAX_FILLS_PER_KEY) || 2;
            if (count >= cap) {
              action = 'skip';
              value = '';
            } else if (f.options && f.options.length) {
              coerced = coerceSelectValue(M, f, value);
              if (!coerced.ok) {
                action = 'skip';
                value = '';
              } else {
                value = coerced.value;
                keyCounts[profileKey] = count + 1;
              }
            } else {
              keyCounts[profileKey] = count + 1;
            }
          }
        } else if (item.value && f.options && f.options.length) {
          // 无合法 profileKey 但给了 value：仅允许匹配 select option（如纯 Yes/No）
          coerced = coerceSelectValue(M, f, item.value);
          if (coerced.ok) {
            action = 'fill';
            profileKey = null;
            value = coerced.value;
          } else {
            action = 'skip';
            profileKey = null;
            value = '';
          }
        } else {
          action = 'skip';
          profileKey = null;
          value = '';
        }
        out.push({
          index: idx,
          profileKey: profileKey,
          action: action,
          confidence: conf,
          suggestedValue: value || '',
          method: 'ai',
          label: label,
          reason: item.reason || (action === 'skip' ? 'select-no-match' : '')
        });
        continue;
      }

      out.push({
        index: idx,
        profileKey: profileKey,
        action: 'skip',
        confidence: conf,
        suggestedValue: '',
        method: 'ai',
        label: label,
        reason: item.reason || 'skip'
      });
    }
    return out;
  }

  return {
    DEFAULT_AI_SETTINGS: DEFAULT_AI_SETTINGS,
    normalizeAiSettings: normalizeAiSettings,
    aiConfigured: aiConfigured,
    buildSystemPrompt: buildSystemPrompt,
    buildUserPrompt: buildUserPrompt,
    parseAiMappingJson: parseAiMappingJson,
    mergeAiMappingWithProfile: mergeAiMappingWithProfile
  };
});
