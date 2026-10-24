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
    model: 'gpt-4o-mini',
    // 'whitelist'（默认）：只发字段标签 / 控件类型 / 选项文本，**项目值一律不出本机**
    // 'full'：旧行为，会把整份非空 profile（含证件号、手机、住址）发给模型，需要用户显式选择
    mode: 'whitelist'
  };

  var AI_MODES = ['whitelist', 'full'];

  function normalizeAiSettings(raw) {
    var src = raw || {};
    return {
      enabled: !!src.enabled,
      apiBaseUrl: String(src.apiBaseUrl || DEFAULT_AI_SETTINGS.apiBaseUrl).trim().replace(/\/+$/, '') ||
        DEFAULT_AI_SETTINGS.apiBaseUrl,
      apiKey: String(src.apiKey || '').trim(),
      model: String(src.model || DEFAULT_AI_SETTINGS.model).trim() || DEFAULT_AI_SETTINGS.model,
      mode: AI_MODES.indexOf(String(src.mode || '').toLowerCase()) !== -1
        ? String(src.mode).toLowerCase()
        : DEFAULT_AI_SETTINGS.mode
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

  /**
   * 允许模型看到的键目录：**只有非空键名**（值一律不发）。
   * 只列这个用户真正填过的键，既缩短 payload，也让模型少猜。
   */
  function buildKeyCatalog(ProfileApi, profileObj) {
    var P = ProfileApi || Profile;
    var all = (P && P.PROFILE_FIELDS) || [];
    var prof = profileObj || {};
    var out = [];
    all.forEach(function (k) {
      var v = prof[k];
      if (v === undefined || v === null) return;
      var filled = Array.isArray(v) ? v.length > 0 : String(v).trim() !== '';
      if (!filled) return;
      out.push({ key: k });
    });
    ((P && P.MULTI_VALUE_KEYS) || []).forEach(function (key) {
      if (Match.multiValuesFor(prof,key).length && !out.some(function (item) { return item.key === key; })) out.push({key:key});
    });
    // 列表资料展开成可用语义键；目录不含记录值。
    var mappings = (Match && Match.LIST_OCCURRENCE_MAP) || {};
    Object.keys(mappings).forEach(function (key) {
      var map = mappings[key], rows = prof[map[0]];
      if (!Array.isArray(rows) || !rows.some(function (row) { return row && String(row[map[1]] || '').trim(); })) return;
      if (!out.some(function (item) { return item.key === key; })) {
        out.push({key:key, label:((P.LIST_ITEM_LABELS || {})[map[0]] || {})[map[1]] || key});
      }
    });
    return out;
  }

  /**
   * 白名单模式的 system prompt：只做「字段 → profileKey」映射，不允许返回任何值。
   * 值由本地 mergeAiMappingWithProfile 从 profile 取，模型拿不到也编不出。
   */
  function buildWhitelistSystemPrompt() {
    return [
      '你是求职表单字段映射助手。输入是「候选人资料里有哪些字段（只有键名和中文标签）」和「页面上有哪些表单字段」。',
      '任务：为每个页面字段返回它对应的资料键（profileKey）。',
      '严格只输出 JSON 数组，不要 markdown，不要解释。每个元素形如：',
      '{"index":0,"action":"fill"|"skip","profileKey":"email"|null,"confidence":0.0-1.0,"reason":"..."}',
      '规则：',
      '1. **不要输出任何字段值**，你也不会收到任何值；值由本地按 profileKey 填充。',
      '2. profileKey 必须是「可用键目录」里出现过的键，不确定就 action=skip。',
      '3. 开放题（自我介绍 / 为什么加入 / 职业规划）→ skip（本模式不生成文本）。',
      '4. EEO / 种族 / 残疾 / 性别自认 / veteran / how did you hear / 法律竞业 / 是否曾在本公司任职 → skip。',
      '5. 证件号、银行账号、紧急联系人电话这类敏感字段 → 低置信时 skip。',
      '6. confidence：高 ≥0.85，中 0.6–0.85，低 <0.6；低于 0.6 会被本地直接丢弃。',
      '7. 同一语义可用于多段经历；只确定语义，记录来源由本地绑定。'
    ].join('\n');
  }

  /** 白名单模式的 user payload：只有标签、控件类型、选项文本 */
  function buildWhitelistUserPrompt(fields, keyCatalog) {
    var clean = (fields || []).map(function (f, i) {
      var item = {
        index: typeof f.index === 'number' ? f.index : i,
        label: String(f.label || f.placeholder || f.name || f.id || '').slice(0, 80)
      };
      if (f.fieldId) item.fieldId = f.fieldId;
      var type = String(f.controlKind || f.controlType || f.tag || f.type || '').toLowerCase();
      if (type) item.controlType = type;
      var opts = f.options || [];
      if (opts.length) {
        item.options = opts.slice(0, 60).map(function (o) {
          return String((o && (o.text || o.value || o)) || '').slice(0, 60);
        });
      }
      return item;
    });
    return JSON.stringify({ keys: keyCatalog || [], fields: clean });
  }

  /**
   * 组装请求体。whitelist 模式下 profile 值绝不进入 body（这是隐私边界，别再改回去）。
   */
  function buildAiRequestBody(settings, profile, fields, opts) {
    var s = normalizeAiSettings(settings);
    var o = opts || {};
    var P = o.ProfileApi || Profile;
    var system = s.mode === 'full' ? buildSystemPrompt() : buildWhitelistSystemPrompt();
    var user;
    if (s.mode === 'full') {
      var profileObj = P && P.profileNonEmpty ? P.profileNonEmpty(profile) : profile;
      user = buildUserPrompt(profileObj, fields);
    } else {
      var profObj = profile || {};
      user = buildWhitelistUserPrompt(fields, buildKeyCatalog(P, profObj));
    }
    return {
      model: s.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    };
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
  function mergeAiMappingWithProfile(aiItems, fields, profile, MatchApi, ProfileApi, options) {
    var M = MatchApi || Match, P = ProfileApi || Profile;
    var known = new Set((P && P.PROFILE_FIELDS) || []);
    function semanticKey(key) {
      if (known.has(key)) return key;
      return Object.keys(M.LIST_OCCURRENCE_MAP).find(function (candidate) {
        var map = M.LIST_OCCURRENCE_MAP[candidate];
        return key === map[0] + '[].' + map[1];
      }) || key;
    }
    var fallback = M.heuristicMapFields(fields, profile);
    var byIndex = {}, byId = {}, counts = {};
    (aiItems || []).forEach(function (item) {
      if (!item) return;
      if (item.fieldId) byId[item.fieldId] = item;
      if (Number.isInteger(item.index)) byIndex[item.index] = item;
    });
    return (fields || []).map(function (f, i) {
      var idx = Number.isInteger(f.index) ? f.index : i;
      var item = (f.fieldId && byId[f.fieldId]) || byIndex[idx];
      var local = fallback[i];
      var occurrenceKey = semanticKey(item && item.profileKey || local.profileKey);
      var occurrence = counts[occurrenceKey] || 0;
      counts[occurrenceKey] = occurrence + 1;
      var metadata = {index:idx, fieldId:f.fieldId, recordRef:f.recordRef, controlKind:f.controlKind, frameId:f.frameId,
        label:f.label || f.placeholder || f.name || f.id || ''};
      if (!item) return Object.assign({}, local, metadata, {method:(local.method || 'heuristic') + '+fallback'});
      var out = Object.assign({profileKey:null,action:'skip',confidence:0,suggestedValue:'',method:'ai'}, metadata);
      if (M.isSkipContext([f.label,f.placeholder,f.name,f.id].filter(Boolean).join(' '))) return Object.assign(out,{method:'denylist',reason:'denylist',confidence:1});
      var conf = Number.isFinite(item.confidence) ? Math.max(0,Math.min(1,item.confidence)) : 0;
      out.confidence = conf;
      if (conf < 0.6) return out;
      if (item.action === 'custom_answer' && options && options.mode === 'full' &&
          /^(textarea|text)$/.test(String(f.type || f.tag || '').toLowerCase()) && !(f.options || []).length) {
        return Object.assign(out,{action:'custom_answer',suggestedValue:String(item.value || '').trim()});
      }
      var key = semanticKey(item.profileKey);
      // 兼容列表路径形式的语义键；不允许模型决定数组下标。
      if (item.action !== 'fill' || !known.has(key)) return out;
      out.profileKey = key;
      var count = occurrence;
      if (!f.recordRef && !M.LIST_OCCURRENCE_MAP[key] && count >= M.MAX_FILLS_PER_KEY) return out;
      if (f.controlKind === 'multi') {
        var multi = M.multiValuesFor(profile,key);
        if (multi.length && (!(f.options || []).length || multi.every(function (v) { return M.matchSelectOption(f.options,v); }))) return Object.assign(out,{action:'fill',suggestedValue:multi.join('、'),multiValues:multi});
        return Object.assign(out,{reason:'no_multi_values'});
      }
      var value = M.valueForField(profile,key,f,count);
      if (!value) return Object.assign(out,{reason:'no_profile_value'});
      var coerced = coerceSelectValue(M,f,value);
      if (!coerced.ok) return Object.assign(out,{reason:coerced.reason});
      return Object.assign(out,{action:'fill',suggestedValue:coerced.value});
    });
  }

  return {
    DEFAULT_AI_SETTINGS: DEFAULT_AI_SETTINGS,
    normalizeAiSettings: normalizeAiSettings,
    aiConfigured: aiConfigured,
    buildSystemPrompt: buildSystemPrompt,
    buildUserPrompt: buildUserPrompt,
    buildKeyCatalog: buildKeyCatalog,
    buildWhitelistSystemPrompt: buildWhitelistSystemPrompt,
    buildWhitelistUserPrompt: buildWhitelistUserPrompt,
    buildAiRequestBody: buildAiRequestBody,
    AI_MODES: AI_MODES,
    parseAiMappingJson: parseAiMappingJson,
    mergeAiMappingWithProfile: mergeAiMappingWithProfile
  };
});
