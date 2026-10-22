/**
 * 简历填写工具 — 内容脚本（编排层）
 * FILL_FORM / SCAN_FIELDS / COLLECT_FIELDS / APPLY_MAPPINGS。不自动提交；不填 password/file；不盲勾 checkbox。
 *
 * v1.6.0 起按职责拆成多个文件（manifest content_scripts 按下面的顺序加载，共享 globalThis.ResumeAutofillContent）：
 *   content/fill/recognize.js  字段识别：标签 / 提示词 / 区块上下文 / 字段键（每轮 DOM 读缓存）
 *   content/fill/write.js      写入与回读：页面主环境桥接、受控组件写值、写后回读、填写审计记录、本轮状态
 *   content/fill/sections.js   分区与多段：id 语义路径行级映射、「添加 XX 经历」按钮、段数统计
 *   content/fill/select.js     选择类控件：只读弹层、开关、自定义下拉、联动下拉、是/否两态词映射
 *   content/fill/dates.js      日期控件：年月日三件套、多表格面板、日历网格、只读日期框（策略在 shared/date-strategies.js）
 *   content/sites/antd-date.js Ant Design / antd v3 日期面板与范围选择器
 *   content/sites/laydate.js   layui laydate
 *   content/fill/ranges.js     起止时间：范围控件、Moka 年 + 月下拉对、单输入框装两个日期
 *   content/sites/phoenix.js   北森 Phoenix：下拉 / 日期 / 年月 / 字典 / 地区弹层与 div 单选
 *   content/fill/radios.js     单选组：命名 radio、无名 radio 组、Yes/No
 *   content/autofill.js        本文件：扫描 / 主填写循环 / 未填字段 / 多 frame 汇总 / 消息入口
 * 页面主环境桥接（React fiber / Vue 实例提交）在 content/page-bridge.js（world: MAIN）。
 *
 * 早期版本记录（完整更新日志见 README）：
 * v1.5.7: 「增加 XX 经历」按钮解析到真正的可点元素 + 等异步渲染；起止时间合体控件（el daterange）按分区/段序填。
 * v1.5.8: 语言技能栏位（语言等级/成绩/获得时间）；加行候选只留最内层可点元素；下拉改轮询；
 *         el-input-number / el-date-editor 走组件实例提交；电话所在区域 → phoneCountryCode。
 * v1.5.6: 北森 Phoenix 补齐（svg 勾选热区、弹层差集判定、年月面板、搜索重渲染等待、计数按 key+标签 分桶）。
 * v1.5.5: 北森 Phoenix 网申（phoenix-select 下拉/日期、字典与地区弹层、div radio）+ 按需点「添加」展开分区。
 * v1.3.7: Ant Design DatePicker（年/月面板 + 年月值 YYYY-MM）。
 * v1.3.6: focus 展开弹层（Element el-date-picker）+ 只读框直写兜底。
 * v1.3.5: 年/月/日 三件套（原生 select 组）、分页下拉、滚轮选列、英文表头。
 * v1.3.4: 日历网格型日期面板（翻月 + 点日，最外层面板判定）。
 * v1.3.3: 多表格日期面板（年/月/日 分组识别 + 确定按钮）。
 * v1.3.2: 表格布局（td/th 左列）与 Element-UI 下拉的标签发现，修复下拉选单填不上。
 * v1.5.0: 自定义下拉写路径（native/el-select/ant-select/dictionary-selector）+ Yes/No radio；多段 list occurrence。
 * v1.3.1: 搜索框跳过 + readonly 弹层选择器点击 + 无名 radio 白名单；skipped 原因上报。
 * v1.3.0: D10 相邻年/月 placeholder 对 + 附近日期组标签；D9 拆分失败跳过。
 * v1.2.3: getLabelText 支持 antd/form-item、aria-labelledby；年/月日期拆分；hints 优先标签。
 * v1.2.2: getLabelText 用 visibleLabelText；已填字段 skip-if-filled（不覆盖）。
 */
(function () {
  'use strict';

  var M = globalThis.ResumeAutofillMatch;
  // 日期能力层：统一模型 / 精度判级 / 控件探测 / 策略顺序（shared/date-capability.js）
  var D = globalThis.ResumeAutofillDate || null;
  // 日期策略层：按固定顺序试 + 每步回读判级（shared/date-strategies.js）
  var S = globalThis.ResumeAutofillDateStrategies || null;
  if (!M) {
    console.warn('[简历填写工具] ResumeAutofillMatch 未加载');
    return;
  }

  // 弹窗兜底注入（标签页早于安装 / 更新打开）时可能再跑一遍：消息监听只能挂一次
  if (globalThis.__resumeAutofillContentReady) return;
  globalThis.__resumeAutofillContentReady = true;

  var MAX_FILLS_PER_KEY = M.MAX_FILLS_PER_KEY;

  var C = globalThis.ResumeAutofillContent || {};
  // 依赖（content/fill/*、content/sites/* 模块）
  var RADIO_SAFE_KEYS = C.RADIO_SAFE_KEYS;
  var RANGE_EDITOR_SEL = C.RANGE_EDITOR_SEL;
  var beginMemo = C.beginMemo;
  var clickCurrentJobToggle = C.clickCurrentJobToggle;
  var closePhoenixPanels = C.closePhoenixPanels;
  var collectHints = C.collectHints;
  var collectUnnamedRadioGroups = C.collectUnnamedRadioGroups;
  var commitFrameworkWidget = C.commitFrameworkWidget;
  var customSelectLooksFilled = C.customSelectLooksFilled;
  var dateGroupReader = C.dateGroupReader;
  var dateMatchLevel = C.dateMatchLevel;
  var dateValueForInput = C.dateValueForInput;
  var dateValueMatches = C.dateValueMatches;
  var detectAdjacentDatePairRole = C.detectAdjacentDatePairRole;
  var detectSectionContext = C.detectSectionContext;
  var detectStructuredField = C.detectStructuredField;
  var endMemo = C.endMemo;
  var expandAddSections = C.expandAddSections;
  var fieldLooksFilled = C.fieldLooksFilled;
  var fillAntdPickerByModel = C.fillAntdPickerByModel;
  var fillCustomSelect = C.fillCustomSelect;
  var fillDateGroup = C.fillDateGroup;
  var fillLaydate = C.fillLaydate;
  var fillLinkedSelectChains = C.fillLinkedSelectChains;
  var fillModalPickers = C.fillModalPickers;
  var fillNamedRadioGroups = C.fillNamedRadioGroups;
  var fillPhoenixRadioGroups = C.fillPhoenixRadioGroups;
  var fillRadioGroup = C.fillRadioGroup;
  var fillRangeEditors = C.fillRangeEditors;
  var fillReadonlyPicker = C.fillReadonlyPicker;
  var fillReadonlyPickerAntd = C.fillReadonlyPickerAntd;
  var fillRecords = C.fillRecords;
  var fillSingleInputRange = C.fillSingleInputRange;
  var fillYearMonthPairs = C.fillYearMonthPairs;
  var findCustomSelectHost = C.findCustomSelectHost;
  var fitToMaxLength = C.fitToMaxLength;
  var getLabelText = C.getLabelText;
  var hasSiblingDateParts = C.hasSiblingDateParts;
  var highlight = C.highlight;
  var hintSnippet = C.hintSnippet;
  var isAntdV3Picker = C.isAntdV3Picker;
  var isCurrentJobValue = C.isCurrentJobValue;
  var isLaydateInput = C.isLaydateInput;
  var isPhoenixHost = C.isPhoenixHost;
  var isReadonlyPicker = C.isReadonlyPicker;
  var isSkippable = C.isSkippable;
  var isVisibleEl = C.isVisibleEl;
  var iterCustomSelectHosts = C.iterCustomSelectHosts;
  var lastDateTries = C.lastDateTries;
  var looksLikeDateInput = C.looksLikeDateInput;
  var looksLikeSingleInputRange = C.looksLikeSingleInputRange;
  var matchKeyForElement = C.matchKeyForElement;
  var parseDateParts = C.parseDateParts;
  var pickerValueMatches = C.pickerValueMatches;
  var radioGroupLabelName = C.radioGroupLabelName;
  var readBackValue = C.readBackValue;
  var recordFill = C.recordFill;
  var resetRunDone = C.resetRunDone;
  var runFillAudit = C.runFillAudit;
  var sectionFallbackKey = C.sectionFallbackKey;
  var settle = C.settle;
  var sleep = C.sleep;
  var structuredValue = C.structuredValue;
  var tryAntdDayCell = C.tryAntdDayCell;
  var tryAntdPanel = C.tryAntdPanel;
  var tryAntdV3Calendar = C.tryAntdV3Calendar;
  var valueCandidates = C.valueCandidates;
  var writeAndVerify = C.writeAndVerify;
  var writtenValueMatches = C.writtenValueMatches;
  var ymPartial = C.ymPartial;

  function iterFillableFields() {
    return Array.from(document.querySelectorAll('input, textarea, select')).filter(
      function (el) { return !isSkippable(el); }
    );
  }

  function scanFields() {
    var owned = beginMemo();
    try { return scanFieldsInner(); } finally { endMemo(owned); }
  }

  function scanFieldsInner() {
    var results = [];
    var seen = {};
    iterFillableFields().forEach(function (el) {
      var scored = M.matchFieldKeyScored
        ? M.matchFieldKeyScored(collectHints(el), {
            autocomplete: el.getAttribute('autocomplete') || ''
          })
        : null;
      var key = scored ? scored.key : matchKeyForElement(el);
      if (!key) return;
      var sig = key + '|' + (el.name || el.id || hintSnippet(el));
      if (seen[sig]) return;
      seen[sig] = true;
      results.push({
        key: key,
        hint: hintSnippet(el),
        confidence: scored ? scored.confidence : 1,
        method: scored ? scored.method : 'keyword'
      });
    });
    return results;
  }

  /**
   * 收集可填字段描述，供 AI / 启发式映射。
   */
  function collectFieldsDetailed() {
    var owned = beginMemo();
    try { return collectFieldsDetailedInner(); } finally { endMemo(owned); }
  }

  function collectFieldsDetailedInner() {
    var els = iterFillableFields();
    return els.map(function (el, index) {
      var tag = el.tagName.toLowerCase();
      var type = (el.type || '').toLowerCase();
      var label = String(getLabelText(el) || '').replace(/\s+/g, ' ').trim();
      if (label.length > 120) label = label.slice(0, 117) + '…';
      var item = {
        index: index,
        tag: tag,
        type: type,
        name: el.name || '',
        id: el.id || '',
        label: label,
        placeholder: el.getAttribute('placeholder') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        currentValue: ''
      };
      try {
        if (tag === 'select') {
          item.currentValue = el.value || '';
          item.options = Array.from(el.options).slice(0, 40).map(function (o) {
            return { value: o.value, text: String(o.text || '').trim() };
          });
        } else if (type !== 'checkbox' && type !== 'radio') {
          item.currentValue = el.value || '';
        }
      } catch (_) { /* ignore */ }
      return item;
    });
  }

  /**
   * v1.5.16：有些站点的标签 match.js 还没收（或收到的 key 档案里是空的）。
   * 只在这些情况下补一层别名，不覆盖已有的匹配结果。
   */
  var EXTRA_LABEL_KEYS = [
    [/^(所在地|现居地|当前所在地|当前城市|现居住地)$/, 'currentCity'],
    [/^(工作经验|工作年限)$/, 'years'],
    [/^职责$/, 'projectRole'],
    [/^(语言类型|语种|语言种类)$/, 'langName'],
    [/^(掌握程度|熟练程度|语言水平|语言等级)$/, 'langLevel'],
    [/^(期望城市|意向城市|期望工作城市)$/, 'expectedCity'],
    [/^(是否服从调剂|是否接受调剂.*|是否服从.*调配)$/, 'acceptAdjustment'],
    [/^(城市选择能否服从分配|能否服从分配|是否服从城市分配)$/, 'acceptAdjustment']
  ];

  function aliasKeyForLabel(label, currentKey) {
    var t = String(label || '').replace(/[*＊\s]/g, '');
    if (!t) return '';
    for (var i = 0; i < EXTRA_LABEL_KEYS.length; i++) {
      if (!EXTRA_LABEL_KEYS[i][0].test(t)) continue;
      var k = EXTRA_LABEL_KEYS[i][1];
      return k === currentKey ? '' : k;
    }
    return '';
  }

  /**
   * v1.5.16：有些网申（Moka 这种）表单是分块懒挂载的，
   * 一键填写点太早会漏掉下半截字段。这里等输入框数量稳定下来再开始。
   */
  async function waitForFormSettle(maxMs) {
    var last = -1;
    var stable = 0;
    var waited = 0;
    var limit = typeof maxMs === 'number' ? maxMs : 1500;
    while (waited < limit) {
      var n = document.querySelectorAll('input, textarea, select').length;
      if (n === last) {
        stable += 1;
        if (stable >= 2) return;
      } else {
        stable = 0;
        last = n;
      }
      await sleep(150);
      waited += 150;
    }
  }

  /**
   * v1.5.24：快字段先填、慢控件后置（同类内保持页面顺序）。
   * 文本框 / 原生下拉毫秒级；自定义下拉、只读日期弹层要开弹层等渲染。按页面顺序处理时，
   * 前面几个慢控件就能把 45s 预算吃光，后面的姓名电话都没机会填（「超时 + 填得比以前少」）。
   */
  function fastFirst(list) {
    var fast = [];
    var slow = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var tag = el.tagName.toLowerCase();
      var isSlow = tag !== 'select' && (isReadonlyPicker(el) || !!findCustomSelectHost(el) ||
        !!(el.closest && el.closest('.ant-picker, .ant-calendar-picker, .el-date-editor, .phoenix-select')));
      (isSlow ? slow : fast).push(el);
    }
    return fast.concat(slow);
  }

  async function fillFromProfile(profile, options) {
    var owned = beginMemo();
    try {
      return await fillFromProfileInner(profile, options);
    } finally {
      endMemo(owned);
    }
  }

  async function fillFromProfileInner(profile, options) {
    var opts = options || {};
    var filled = 0;
    var filledKeys = [];
    var degradedDates = [];
    lastDateTries.length = 0;
    fillRecords.length = 0;
    ymPartial.length = 0;
    resetRunDone();
    var forced = [];
    var skipped = [];
    var keyCounts = {};
    /**
     * 同一个 key 可能被两个不同字段命中：基础信息的「毕业时间」和教育经历的「结束时间」
     * 都映射到 eduEnd，若共用一个计数，「结束时间」会被当成第 2 段而取空值。
     * 计数按 key + 标签 分桶：同名列（多段教育）仍按顺序取第 1/2 段。
     */
    function occurrenceKey(key, label) {
      return key + '|' + String(label || '').replace(/\s+/g, '');
    }
    var groupHandled = typeof WeakSet === 'function' ? new WeakSet() : null;
    // 站点会在填入后重建 DOM：第二遍重新扫描，把被替换过的新节点补填上
    var handled = typeof WeakSet === 'function' ? new WeakSet() : null;
    // 有的网申要先点「添加」才有输入框：先按档案里的条数把分区展开
    var expanded = [];
    if (opts.allowAddSections !== false) {
      try { expanded = await expandAddSections(profile); } catch (e) { expanded = []; }
    }

    try { await waitForFormSettle(1500); } catch (_) { /* ignore */ }
    var startedAt = Date.now();
    var timedOut = false;
    var singleRangeSeen = {};
    var occurSeen = {};
    var triedHosts = typeof WeakSet === 'function' ? new WeakSet() : null;
    for (var pass = 0; pass < 2; pass++) {
      if (timedOut) break;
    // 起止时间合体的控件要在逐 input 匹配之前处理，否则两个 input 会被各写一份
    if (opts.allowCustomSelect !== false) {
      try { filled += await fillRangeEditors(profile, handled, filledKeys); } catch (_) { /* ignore */ }
      // Moka 的年/月自绘下拉对（毕业时间 / 就读时间 / 起止时间）
      try { filled += await fillYearMonthPairs(profile, filledKeys); } catch (_) { /* ignore */ }
      // antd 弹窗选择器（专业 / 学校）：点输入框弹 modal，常规写值写不进去
      try { filled += await fillModalPickers(profile, handled, filledKeys); } catch (_) { /* ignore */ }
      // 联动下拉（语种 → 语言等级）：第二级选项由第一级决定，必须按顺序写
      try { filled += await fillLinkedSelectChains(profile, filledKeys); } catch (_) { /* ignore */ }
    }
    var els = fastFirst(iterFillableFields());
    var pageKeys = null;
    var pageHasKey = function (k) {
      if (!pageKeys) {
        pageKeys = {};
        els.forEach(function (x) { var kk = matchKeyForElement(x); if (kk) pageKeys[kk] = 1; });
      }
      return !!pageKeys[k];
    };
    for (var idx = 0; idx < els.length; idx++) {
      if (Date.now() - startedAt > 45000) { timedOut = true; break; }
      var el = els[idx];
      if (handled) { if (handled.has(el)) continue; handled.add(el); }
      if (groupHandled && groupHandled.has(el)) continue;
      // 范围日期控件由 fillRangeEditors 负责（两个 input 共享一个 label）
      if (el.classList && el.classList.contains('el-range-input')) continue;
      if (el.closest && el.closest(RANGE_EDITOR_SEL)) continue;
      if (el.classList && el.classList.contains('ant-calendar-range-picker-input')) continue;   // antd v3 范围
      // 一个输入框装起止两个日期：按区块取对应那段经历的开始 + 结束
      if (looksLikeSingleInputRange(el) && !fieldLooksFilled(el)) {
        var sr = null;
        try { sr = await fillSingleInputRange(el, profile, singleRangeSeen); } catch (_) { sr = null; }
        if (sr && sr.ok) {
          filled += 1;
          [sr.map.startKey, sr.map.endKey].forEach(function (k) { if (filledKeys.indexOf(k) === -1) filledKeys.push(k); });
          recordFill(el, sr.map.startKey, String(el.value || ''), '');
          highlight(el);
          continue;
        }
        if (sr === false) {
          if (skipped.length < 30) skipped.push({ key: 'range', reason: 'single_input_range_failed' });
          continue;
        }
      }
      var struct = detectStructuredField(el);
      // 分区兜底优先：语言技能里的「获得时间」全局会落到 certDate（证书时间），
      // 在这种分区里应该用 englishDate
      var key = struct
        ? struct.key
        : (compoundEduKey(getLabelText(el)) || sectionFallbackKey(el) || matchKeyForElement(el));
      if (!key) key = aliasKeyForLabel(getLabelText(el), null);
      if (!key) continue;
      // 「紧急联系人」单框：同页另有「紧急联系电话」时它就是姓名栏，别填「姓名 + 电话」组合串
      if (key === 'emergencyContact' && pageHasKey('emergencyContactPhone')) key = 'emergencyContactName';
      var counterKey = occurrenceKey(key, getLabelText(el));
      // v1.5.24：第几段按「出现位置」算，不按「成功次数」算 —— 第 1 段没填上（已有值 / 写失败），
      // 第 2 段也必须拿 list[1]，否则会把第 1 段的值填进第 2 段（错位）
      var count = 0;
      if (!struct) {
        count = occurSeen[counterKey] || 0;
        if (isVisibleEl(el)) occurSeen[counterKey] = count + 1;   // 隐藏的模板行不占位
        if ((keyCounts[counterKey] || 0) >= MAX_FILLS_PER_KEY && !M.LIST_OCCURRENCE_MAP[key]) continue;
      }
      var value = struct
        ? structuredValue(profile, struct)
        : (M.profileValueForOccurrence
          ? M.profileValueForOccurrence(profile, key, count)
          : M.profileValue(profile, key));
      if (!value) {
        // 主 key 取不到值：试一下别名（所在地 / 工作经验 / 职责 / 语言类型 ...）
        var aliasKey = aliasKeyForLabel(getLabelText(el), key);
        if (aliasKey) {
          value = M.profileValueForOccurrence
            ? M.profileValueForOccurrence(profile, aliasKey, count)
            : M.profileValue(profile, aliasKey);
          if (value) key = aliasKey;
        }
      }
      if (!value) {
        if (skipped.length < 30) skipped.push({ key: key, reason: 'no_profile_value' });
        continue;
      }
      if (fieldLooksFilled(el)) continue;
      // antd 的日期框是受控组件：往 input 里写字不会提交，只能点面板选日期
      if (el.closest && el.closest('.ant-picker, .ant-calendar-picker') && !el.closest('.ant-picker-range')) {
        var dOk = false;
        try {
          if (fillAntdPickerByModel(el, value)) {
            await sleep(180);
            dOk = dateValueMatches(el.value, value);
          }
        } catch (_) { dOk = false; }
        if (!dOk) { try { dOk = await fillReadonlyPickerAntd(el, value); } catch (_) { dOk = false; } }
        if (dOk) {
          filled += 1;
          keyCounts[counterKey] = (keyCounts[counterKey] || 0) + 1;
          if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
          recordFill(el, key, value, 'date');
          continue;
        }
      }
      // 「年」「月」成对的下拉（Moka 的出生年月 / 毕业年月）：先拆出这一格要的年或月，别拿整串日期去匹配选项
      var pairRole = detectAdjacentDatePairRole(el);
      if (pairRole) {
        var pp = parseDateParts(value);
        if (pp) value = pairRole === 'year' ? String(pp.y) : String(parseInt(pp.m, 10));
        else if (!/^\d{1,4}$/.test(String(value).trim())) continue;
      }
      // 自定义下拉宿主：走 click → option 路径
      var customHost = findCustomSelectHost(el);
      if (customHost && isPhoenixHost(customHost) && customHost.isConnected === false) continue;
      if (customHost && el.tagName.toLowerCase() !== 'select') {
        if (customSelectLooksFilled(customHost)) continue;
        if (triedHosts) triedHosts.add(customHost);
        try {
          var cOk = await fillCustomSelect(customHost, value, key);
          if (!cOk) {
            var cAlts = valueCandidates(key, value);
            for (var ci = 1; ci < cAlts.length && !cOk; ci++) {
              cOk = await fillCustomSelect(customHost, cAlts[ci], key);
              if (cOk) value = cAlts[ci];
            }
          }
          if (cOk) {
            filled += 1;
            keyCounts[counterKey] = (keyCounts[counterKey] || 0) + 1;
            if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
            recordFill(customHost, key, value);
            highlight(el);
            continue;
          }
          // Phoenix 宿主的真值只在 React 状态里，绝不能直接写 input.value
          if (isPhoenixHost(customHost)) {
            if (skipped.length < 30) skipped.push({ key: key, reason: 'phoenix_fill_failed' });
            continue;
          }
        } catch (_) { /* fall through */ }
      }
      var hints = collectHints(el);
      var adjacentRole = detectAdjacentDatePairRole(el);
      var dateOpts = {
        profileKey: key,
        adjacentPairRole: adjacentRole || undefined
      };

      // 「至今 / 在职 / present」不是日期：找附近的开关（checkbox / switch）勾上，绝不写进日期框
      if (isCurrentJobValue(value)) {
        var toggled = await clickCurrentJobToggle(el);
        if (toggled) {
          filled += 1;
          keyCounts[counterKey] = (keyCounts[counterKey] || 0) + 1;
          if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
          highlight(el);
        } else if (!looksLikeDateInput(el) && (await writeAndVerify(el, String(value).trim()))) {
          // 没有「至今」开关、但这是个普通文本框（结束时间）→ 直接写“至今”
          filled += 1;
          keyCounts[counterKey] = (keyCounts[counterKey] || 0) + 1;
          if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
          highlight(el);
        } else if (skipped.length < 30) {
          skipped.push({ key: key, reason: 'current_job_no_toggle' });
        }
        continue;
      }

      // v1.5.2：整组优先 —— 在把值拆成“年/月/日部件”之前，先用完整日期尝试年/月/日控件，
      // 否则部件值（如 "9"）无法组成日期，整组永远不会被尝试，只剩半截填充。
      if (parseDateParts(value)) {
        var grpFirst = await fillDateGroup(el, value);
        if (grpFirst) {
          grpFirst.members.forEach(function (m) { if (groupHandled) groupHandled.add(m); });
          if (grpFirst.ok) {
            filled += 1;
            keyCounts[counterKey] = (keyCounts[counterKey] || 0) + 1;
            if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
            recordFill(grpFirst.members && grpFirst.members[0] ? grpFirst.members[0] : el, key, value, 'date',
              dateGroupReader(grpFirst.parts));
            grpFirst.members.forEach(function (m) { highlight(m); });
          } else if (skipped.length < 30) {
            skipped.push({ key: key, reason: grpFirst.reason || 'date_group_failed' });
          }
          continue;
        }
      }
      if (M.maybeExtractDatePartValue && (M.isDatePartProfileKey(key) || M.detectDatePartRole(hints, dateOpts))) {
        var maxLen = el.getAttribute('maxlength');
        var ph = el.getAttribute('placeholder') || '';
        value = M.maybeExtractDatePartValue(value, hints, {
          profileKey: key,
          maxLength: maxLen ? parseInt(maxLen, 10) : 0,
          zeroPadMonth: maxLen === '2' || /^(mm|月)$/i.test(String(ph).trim()),
          adjacentPairRole: adjacentRole || undefined
        });
      }
      if (!value) continue;

      // 年 / 月 / 日 三件套：整组一次性填，避免每个控件都塞完整日期
      if (parseDateParts(value)) {
        var grpRes = await fillDateGroup(el, value);
        if (grpRes) {
          grpRes.members.forEach(function (m) { if (groupHandled) groupHandled.add(m); });
          if (grpRes.ok) {
            filled += 1;
            keyCounts[counterKey] = (keyCounts[counterKey] || 0) + 1;
            if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
            recordFill(grpRes.members[0] || el, key, value, 'date', dateGroupReader(grpRes.parts));
            grpRes.members.forEach(function (m) { highlight(m); });
          } else if (skipped.length < 30) {
            skipped.push({ key: key, reason: grpRes.reason || 'date_group_failed' });
          }
          continue;
        }
      }

      // fail-closed：是年/月/日部件、但组不成完整日期 → 宁可不填，也不写半截日期
      if (M.detectDatePartRole && M.detectDatePartRole(hints, dateOpts) && hasSiblingDateParts(el)) {
        if (skipped.length < 30) skipped.push({ key: key, reason: 'date_part_no_group' });
        continue;
      }

      var ok = false;
      var dateText = null;
      if (isReadonlyPicker(el)) {
        // 只读展示框：真值需要点击弹层选择；默认开启，可用 options.allowPickerClick=false 关闭
        if (opts.allowPickerClick === false) {
          skipped.push({ key: key, reason: 'readonly_picker_disabled' });
          continue;
        }
        try {
          // laydate：看一眼面板类型就能按格式直接写，不用逐格点
          ok = isLaydateInput(el) ? await fillLaydate(el, value, null) : false;
          if (!ok) ok = await fillReadonlyPicker(el, value);
        } catch (err) {
          ok = false;
          if (skipped.length < 30) {
            skipped.push({ key: key, reason: 'picker_error: ' + String((err && err.message) || err).slice(0, 60) });
          }
        }
        if (ok) {
          // 弹层点完 / 直写之后再等一拍回读：被框架重渲染吞掉的值不算填上
          await settle();
          if (!dateValueMatches(el.value, value) && !pickerValueMatches(el.value, value)) {
            ok = false;
            if (skipped.length < 30) skipped.push({ key: key, reason: 'picker_not_committed' });
          }
        }
        if (ok === 'forced') forced.push(key);
        if (ok) {
          var lvl = dateMatchLevel(el.value, value);
          if (lvl === 'day-approx' || lvl === 'month-only') {
            degradedDates.push({ key: key, actual: String(el.value || ''), want: String(value || ''), level: lvl });
          }
        }
        if (!ok && !skipped.some(function (x) { return x.key === key && x.reason === 'picker_not_committed'; })) {
          skipped.push({ key: key, reason: 'readonly_picker_not_found' });
        }
      } else {
        // 日期写进普通输入框：按控件要求的格式（type=date/month、placeholder 的 YYYY/MM…）
        dateText = dateValueForInput(el, value);
        if (dateText === '') {
          if (skipped.length < 30) skipped.push({ key: key, reason: 'date_value_unsupported' });
          continue;
        }
        if (dateText) value = dateText;
        // maxlength 放不下：长文本在句末截断；身份证 / 电话这类短值截断就是错值，直接跳过
        var maxL = el.maxLength > 0 ? el.maxLength : 0;
        if (maxL && String(value).length > maxL) {
          var cut = fitToMaxLength(value, maxL);
          if (!cut) {
            if (skipped.length < 30) skipped.push({ key: key, reason: 'value_exceeds_maxlength' });
            continue;
          }
          value = cut;
        }
        if (commitFrameworkWidget(el, value)) {
          await settle();
          ok = writtenValueMatches(el.value, value);
          // 数字框提交的是「3年」里的 3：按数值比
          if (!ok && el.closest && el.closest('.el-input-number')) {
            var nWant = Number(String(value).replace(/[^\d.\-]/g, ''));
            ok = isFinite(nWant) && parseFloat(el.value) === nWant;
          }
          if (!ok && skipped.length < 30) skipped.push({ key: key, reason: 'widget_not_committed' });
        } else {
          ok = await writeAndVerify(el, value);
          if (!ok && el.tagName && el.tagName.toLowerCase() === 'select') {
            // 排名/绩点常常是区间下拉：15/120 要换算成「前20%」才匹配得上
            var alts = valueCandidates(key, value);
            for (var ai = 0; ai < alts.length && !ok; ai++) {
              if (alts[ai] === value) continue;
              ok = await writeAndVerify(el, alts[ai]);
              if (ok) value = alts[ai];
            }
          }
          if (!ok) skipped.push({ key: key, reason: 'set_value_failed' });
        }
      }

      if (ok) {
        filled += 1;
        keyCounts[counterKey] = (keyCounts[counterKey] || 0) + 1;
        if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
        // 已逐项回读确认过（含格式化差异）：审计只需确认它一直留到本轮结束、没被后续重渲染吞掉
        var landed = el.tagName.toLowerCase() === 'select' ? readBackValue(el) : String(el.value || '');
        recordFill(el, key, landed || value, isReadonlyPicker(el) || dateText ? 'date' : '');
        highlight(el);
      }
    }

    }

    // 无名单选组（性别/婚姻/政治面貌/民族）：语义明确才勾
    if (opts.allowRadio !== false) {
      collectUnnamedRadioGroups().forEach(function (container) {
        var labelName = radioGroupLabelName(container);
        if (!labelName) return;
        var scored = M.matchFieldKeyScored ? M.matchFieldKeyScored(labelName, {}) : null;
        var gkey = scored && scored.key;
        if (!gkey || !RADIO_SAFE_KEYS[gkey]) return;
        if (scored.confidence < 0.9) return;
        var gval = M.profileValue(profile, gkey);
        if (!gval) return;
        var before = (keyCounts['radio:' + gkey] || 0);
        if (before) return;
        if (fillRadioGroup(container, gkey, gval)) {
          keyCounts['radio:' + gkey] = 1;
          filled += 1;
          if (filledKeys.indexOf(gkey) === -1) filledKeys.push(gkey);
          var checkedRadio = container.querySelector('input[type=radio]:checked');
          if (checkedRadio) recordFill(checkedRadio, gkey, gval);
        }
      });
      filled += fillNamedRadioGroups(profile, keyCounts, filledKeys);
      filled += await fillPhoenixRadioGroups(profile, keyCounts, filledKeys);
    }

    // 无关联 input 的自定义下拉宿主（仅展示层）
    if (opts.allowCustomSelect !== false) {
      var hosts = iterCustomSelectHosts();
      for (var hi = 0; hi < hosts.length; hi++) {
        // 与主循环共用 45s 总预算（之前这一段不受限，点不开的下拉每个耗 3~4s，整轮能拖到 70s）
        if (Date.now() - startedAt > 45000) { timedOut = true; break; }
        var host = hosts[hi];
        if (triedHosts && triedHosts.has(host)) continue;   // 主循环已经试过（对不上的下拉别再耗一遍）
        var hostFilled = customSelectLooksFilled(host);
        var hLabel = '';
        var prev = host.previousElementSibling;
        if (prev) {
          hLabel = M.visibleLabelText ? M.visibleLabelText(prev) : String(prev.textContent || '');
          hLabel = String(hLabel || '').replace(/\s+/g, ' ').trim();
          if (M.cleanLabelPunctuation) hLabel = M.cleanLabelPunctuation(hLabel);
        }
        if (!hLabel) {
          var formItem = host.closest
            ? host.closest('.el-form-item, .ant-form-item, .form-item, .form-group')
            : null;
          if (formItem) {
            var fl = formItem.querySelector('.el-form-item__label, .ant-form-item-label, label');
            if (fl) hLabel = String(fl.textContent || '').replace(/\s+/g, ' ').trim();
          }
        }
        if (!hLabel) continue;
        // antd 的必填星号在 label 里（"学校*"），不清理会匹配不上
        hLabel = String(hLabel).replace(/\*/g, '').replace(/（必填）|\(必填\)|必填/g, '').replace(/\s+/g, ' ').trim();
        // 带上区块上下文（教育块的「城市」是学校城市，不是申请人城市）
        var hKey = M.matchFieldKey(hLabel, { context: detectSectionContext(host) });
        if (!hKey) continue;
        var hCounterKey = occurrenceKey(hKey, hLabel);
        // 与主循环一致：第几段按出现位置算（已经有值的那一段也占位）
        var hCount = occurSeen[hCounterKey] || 0;
        occurSeen[hCounterKey] = hCount + 1;
        if (hostFilled) continue;
        if ((keyCounts[hCounterKey] || 0) >= MAX_FILLS_PER_KEY && !M.LIST_OCCURRENCE_MAP[hKey]) continue;
        var hVal = M.profileValueForOccurrence
          ? M.profileValueForOccurrence(profile, hKey, hCount)
          : M.profileValue(profile, hKey);
        if (!hVal) continue;
        try {
          var hOk = await fillCustomSelect(host, hVal, hKey);
          if (hOk) {
            filled += 1;
            keyCounts[hCounterKey] = (keyCounts[hCounterKey] || 0) + 1;
            recordFill(host, hKey, hVal);
            if (filledKeys.indexOf(hKey) === -1) filledKeys.push(hKey);
            highlight(host);
          }
        } catch (_) { /* ignore */ }
      }
    }

    // 别把弹层留在页面上
    try { closePhoenixPanels(); } catch (_) { /* ignore */ }

    // 半截的「年 + 月」下拉对：报出来，别让它悄悄混在已填里
    ymPartial.forEach(function (k) {
      if (skipped.length < 20) skipped.push({ key: k, reason: 'date_pair_partial' });
    });

    // 填完审计：期望值 vs 页面真实值（本地比较，不发网络）。
    // 先等一拍：有的组件在失焦 / 下一帧重渲染时才把值吞掉，立刻读会漏掉
    try { await sleep(150); } catch (_) { /* ignore */ }
    var audit = runFillAudit();
    var auditCount = fillRecords.length;
    // v1.5.23：审计结果回写到统计 —— 写了但读不回来（empty）/ 页面显示别的值（mismatch）都不算填上
    var notWritten = [];
    if (audit && audit.entries && audit.entries.length === fillRecords.length) {
      var goodKeys = {};
      audit.entries.forEach(function (r) {
        if (r.status === 'ok' || r.status === 'approx') goodKeys[r.key] = 1;
      });
      audit.entries.forEach(function (r, ri) {
        if (r.status !== 'empty' && r.status !== 'mismatch') return;
        // 只有回读可靠的才扣：原生 input / select / textarea，或带专用读法的（年月日三件套、年月下拉对）。
        // 自定义下拉宿主的回读是「猜显示文字」，扣了会把选上的字段误报成没填（v1.5.23 的回退之一）
        var rec = fillRecords[ri];
        var reliable = !!(rec.read || (rec.el && /^(INPUT|SELECT|TEXTAREA)$/.test(String(rec.el.tagName || ''))));
        if (!reliable) return;
        if (!rec.noCount) filled = Math.max(0, filled - 1);
        if (!goodKeys[r.key]) {
          var fk = filledKeys.indexOf(r.key);
          if (fk !== -1) filledKeys.splice(fk, 1);
        }
        if (r.status === 'empty') {
          notWritten.push(r.key);
          if (skipped.length < 20) skipped.push({ key: r.key, reason: 'not_written: 点了 / 写了但页面上没有值' });
        }
      });
    }
    // 审计完就放掉对 DOM 节点的引用（SPA 换页后旧节点不会被这份列表钉在内存里）
    fillRecords.length = 0;
    if (audit && audit.wrongFill) {
      // 有错填：宁可把这些字段报出来，也不能让它们静默进提交
      (audit.problems || []).forEach(function (p) {
        if (p.status === 'mismatch' && skipped.length < 20) {
          skipped.push({ key: p.key, reason: 'audit_mismatch: 页面显示「' + String(p.actual).slice(0, 20) + '」' });
        }
      });
    }

    return {
      filled: filled, expanded: expanded, filledKeys: filledKeys, skipped: skipped,
      degradedDates: degradedDates, dateTries: lastDateTries, audit: audit,
      auditRecords: auditCount, notWritten: notWritten,
      forced: forced, timedOut: timedOut
    };
  }

  /**
   * 按映射结果填写（AI 巡查后的 AI 填写）。
   * mappings: { index, action, suggestedValue }[]
   */
  async function applyMappings(mappings) {
    var els = iterFillableFields();
    var filled = 0;
    var filledKeys = [];
    var list = mappings || [];
    for (var li = 0; li < list.length; li++) {
      await applyOneMapping(list[li]);
    }
    return { filled: filled, filledKeys: filledKeys };

    async function applyOneMapping(m) {
      if (!m || (m.action !== 'fill' && m.action !== 'custom_answer')) return;
      var value = String(m.suggestedValue || '').trim();
      if (!value) return;
      var el = els[m.index];
      if (!el) return;
      if (fieldLooksFilled(el)) return;
      var hints = collectHints(el);
      var adjacentRole = detectAdjacentDatePairRole(el);
      var dateOpts = { adjacentPairRole: adjacentRole || undefined };
      var role = M.detectDatePartRole ? M.detectDatePartRole(hints, dateOpts) : null;
      // AI 已给纯年/月则保留；完整日期且字段为年/月分栏时再拆
      if (role && M.extractDatePart) {
        var alreadyPart =
          (role === 'year' && /^\d{4}$/.test(value)) ||
          (role === 'month' && /^(0?[1-9]|1[0-2])$/.test(value)) ||
          (role === 'day' && /^(0?[1-9]|[12]\d|3[01])$/.test(value));
        if (!alreadyPart && M.extractDatePart(value, role)) {
          var maxLen = el.getAttribute('maxlength');
          var ph = el.getAttribute('placeholder') || '';
          value = M.maybeExtractDatePartValue(value, hints, {
            profileKey: m.profileKey || '',
            maxLength: maxLen ? parseInt(maxLen, 10) : 0,
            zeroPadMonth: maxLen === '2' || /^(mm|月)$/i.test(String(ph).trim()),
            adjacentPairRole: adjacentRole || undefined
          });
        }
      }
      if (!value) return;
      var dv = dateValueForInput(el, value);
      if (dv === '') return;
      if (dv) value = dv;
      if (await writeAndVerify(el, value)) {
        filled += 1;
        var k = m.profileKey || ('custom:' + m.index);
        if (filledKeys.indexOf(k) === -1) filledKeys.push(k);
        highlight(el);
      }
    }
  }

  function loadProfile() {
    return new Promise(function (resolve) {
      chrome.storage.local.get('profile', function (result) {
        resolve(result.profile || {});
      });
    });
  }

  function profileHasData(profile) {
    if (!profile) return false;
    return Object.keys(profile).some(function (k) {
      var v = profile[k];
      return v && String(v).trim();
    });
  }

  async function handleFill(options) {
    var profile = await loadProfile();
    if (!profileHasData(profile)) {
      return { ok: false, filled: 0, filledKeys: [], reason: 'empty_profile' };
    }
    var result;
    try {
      result = await fillFromProfile(profile, options || {});
    } catch (err) {
      return { ok: false, filled: 0, filledKeys: [], skipped: [], reason: 'fill_error: ' + String(err && err.message || err).slice(0, 120) };
    }
    return {
      ok: true,
      filled: result.filled,
      expanded: result.expanded || [],
      filledKeys: result.filledKeys,
      skipped: result.skipped || [],
      forced: result.forced || [],
      // 诊断/审计字段必须原样透传：handleFill 是「白名单式」重组结果，
      // 漏一个就等于该字段永远为 undefined（degradedDates / audit 之前就是这么丢的）
      degradedDates: result.degradedDates || [],
      dateTries: result.dateTries || [],
      audit: result.audit || null,
      auditRecords: result.auditRecords || 0,
      notWritten: result.notWritten || [],
      timedOut: !!result.timedOut
    };
  }

  // ————— v1.5.9：填完之后还剩哪些字段空着（给悬浮窗 / 弹窗提示） —————

  var LABEL_NOISE_RE = /^(请选择|请输入|select|choose|please select|--|-)$/i;

  function fieldRequired(el) {
    if (!el) return false;
    if (el.required) return true;
    var label = String(getLabelText(el) || '');
    if (/^\s*[*＊]/.test(label)) return true;
    var item = el.closest ? el.closest('.el-form-item, .form-item, .field, .form-group, tr') : null;
    if (item && item.className && /(^|\s)(is-)?required(\s|$)/.test(String(item.className))) return true;
    var lab = item && item.querySelector ? item.querySelector('.el-form-item__label, label') : null;
    if (lab && /^\s*[*＊]/.test(String(lab.textContent || ''))) return true;
    return false;
  }

  /**
   * 「最高学历学校 / 最高学历专业 / 最高学历毕业日期」这类组合标签，
   * 关键词匹配会先撞到「学历」→ highestDegree（快手实测：学校被塞了「本科」）。
   * 组合词优先，先按后半截判断。
   */
  function compoundEduKey(label) {
    var t = String(label || '').replace(/\s+/g, '');
    if (!t) return '';
    if (/最高学历|最高学位|学历信息/.test(t)) {
      if (/学校|院校/.test(t)) return 'school';
      if (/专业/.test(t)) return 'major';
      if (/学院/.test(t)) return 'college';
      if (/日期|时间|毕业/.test(t)) return 'eduEnd';
      return '';
    }
    if (/^(毕业|就读)(学校|院校)$/.test(t)) return 'school';
    if (/^(毕业|就读)专业$/.test(t)) return 'major';
    return '';
  }

  var SECTION_WORD_RE = /个人|基本信息|教育|工作|实习|项目|校园|语言|获奖|证书|技能|附件|上传|申请|授权|说明|经历|背景|其他|自我评价|联系方式|家庭/;

  function sectionTitleFor(el) {
    var sec = el.closest
      ? el.closest('.resume-section, fieldset, .form-section, .ant-card, .el-card, section, .card')
      : null;
    if (sec) {
      var head = sec.querySelector(
        '.section-title .title, legend, h1, h2, h3, h4, .ant-card-head-title, .el-card__header, .card-title'
      );
      var t = head ? String(head.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (t && t.length <= 24) return t;
    }
    // Moka 这类：分区标题是「字段块」前一个兄弟节点里的短文本
    var node = el.parentElement;
    for (var up = 0; up < 8 && node; up++, node = node.parentElement) {
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (!kid || kid === el || kid.contains(el)) break;
        var kt = String(kid.textContent || '').replace(/\s+/g, ' ').trim();
        if (!kt || kt.length > 12) continue;
        if (!SECTION_WORD_RE.test(kt)) continue;
        // 字段名也会混进来（获奖时间 / 学校名称），别当分区标题
        if (/名称|时间|日期|号码|编号|地址|邮箱|电话|分数|描述$/.test(kt)) continue;
        return kt.replace(/添加$|新增$/, '');
      }
    }
    return '';
  }

  function cleanFieldLabel(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^[*＊\s]+/, '').replace(/[:：]\s*$/, '').trim();
    if (!t || t.length > 30) return '';
    if (LABEL_NOISE_RE.test(t)) return '';
    return t;
  }

  var UNFILLED_ELS = {};

  /** 页面上还空着、且能认出标签的字段（供「未填字段」清单 + 点击定位） */
  function unfilledFields() {
    var owned = beginMemo();
    try { return unfilledFieldsInner(); } finally { endMemo(owned); }
  }

  function unfilledFieldsInner() {
    var out = [];
    var seen = {};
    UNFILLED_ELS = {};
    iterFillableFields().forEach(function (el) {
      if (!el || el.disabled) return;
      if (!isVisibleEl(el)) return;
      var host = findCustomSelectHost(el);
      if (host && customSelectLooksFilled(host)) return;
      if (fieldLooksFilled(el)) return;
      var label = cleanFieldLabel(getLabelText(el));
      if (!label) return;
      var section = sectionTitleFor(el);
      var sig = section + '|' + label;
      var row = seen[sig] ? seen[sig] + 1 : 1;
      seen[sig] = row;
      var id = 'f' + out.length;
      UNFILLED_ELS[id] = el;
      out.push({
        id: id,
        label: label,
        required: fieldRequired(el),
        section: section,
        row: row > 1 ? row : 0
      });
    });
    return out.slice(0, 60);
  }

  /** 点「未填字段」清单 → 滚到那个字段并闪一下 */
  function revealField(id) {
    var el = UNFILLED_ELS[id];
    if (!el || !el.isConnected) return false;
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (_) {
      try { el.scrollIntoView(); } catch (__) { /* ignore */ }
    }
    highlight(el);
    try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    return true;
  }

  async function handleScan() {
    var fields = scanFields();
    return { ok: true, fields: fields, count: fields.length };
  }

  async function handleCollect() {
    var fields = collectFieldsDetailed();
    return { ok: true, fields: fields, count: fields.length };
  }

  async function handleApply(message) {
    var result = await applyMappings(message.mappings || []);
    return { ok: true, filled: result.filled, filledKeys: result.filledKeys };
  }

  var IS_TOP_FRAME = (function () {
    try { return window.top === window; } catch (_) { return false; }
  })();

  /**
   * v1.3.1（iframe 支持）：all_frames 后每个子 frame 都会收到 FILL_FORM 广播。
   * 子 frame 自己填完 → 用 postMessage 把统计结果汇报给父 frame，并且**不**调用
   * sendResponse，这样消息通道里只有顶层 frame 应答，popup 拿到的是汇总结果。
   */
  function reportToParent(payload) {
    try {
      if (IS_TOP_FRAME) return;
      (window.top || window.parent).postMessage({ __raFill: payload }, '*');
    } catch (_) { /* ignore */ }
  }

  function collectFrameResults(ms) {
    return new Promise(function (resolve) {
      var agg = { filled: 0, filledKeys: [], frames: 0, skipped: [] };
      // v1.5.23：页面里没有 iframe 就不用干等 900ms；有的话全部汇报完就提前结束
      var frameCount = 0;
      try { frameCount = document.querySelectorAll('iframe, frame').length; } catch (_) { frameCount = 0; }
      if (!frameCount) { resolve(agg); return; }
      var timer = null;
      var finish = function () {
        try { window.removeEventListener('message', onMsg); } catch (_) { /* ignore */ }
        if (timer) clearTimeout(timer);
        resolve(agg);
      };
      var onMsg = function (e) {
        var d = e && e.data;
        if (!d || !d.__raFill) return;
        agg.filled += Number(d.__raFill.filled) || 0;
        agg.frames += 1;
        (d.__raFill.filledKeys || []).forEach(function (k) {
          if (agg.filledKeys.indexOf(k) === -1) agg.filledKeys.push(k);
        });
        (d.__raFill.skipped || []).forEach(function (x) {
          if (agg.skipped.length < 20) agg.skipped.push(x);
        });
        if (agg.frames >= frameCount) finish();
      };
      try { window.addEventListener('message', onMsg); } catch (_) { /* ignore */ }
      timer = setTimeout(finish, ms);
    });
  }

  async function handleFillMultiFrame(options) {
    var own = await handleFill(options || {});
    if (!IS_TOP_FRAME) {
      reportToParent(own);
      return own;
    }
    // 顶层：留一点时间收集子 frame 的汇报
    var agg = await collectFrameResults(900);
    var blanks = unfilledFields();
    if (!agg.frames) return Object.assign({}, own, { unfilled: blanks });
    return {
      ok: own.ok !== false,
      expanded: own.expanded || [],
      filled: own.filled + agg.filled,
      filledKeys: own.filledKeys.concat(agg.filledKeys.filter(function (k) {
        return own.filledKeys.indexOf(k) === -1;
      })),
      skipped: (own.skipped || []).concat(agg.skipped).slice(0, 20),
      frames: agg.frames + 1,
      unfilled: blanks
    };
  }

  // 悬浮窗（content/panel.js）与这里同处一个隔离世界，直接暴露一个内部 API，省掉消息中转
  try {
    window.__resumeAutofill = {
      fill: function (options) { return handleFillMultiFrame(options || {}); },
      unfilled: function () { return unfilledFields(); },
      revealField: function (id) { return revealField(id); },
      scan: function () { return handleScan(); }
    };
  } catch (_) { /* ignore */ }

  // ── 站点特有日期策略注册（顺序表槽位：fiber-props / panel-input / panel-nav / grid-click）──
  // 通用实现（年/月/日表格、日历网格、原生 select）在 shared/date-strategies.js 里；
  // 这里只补 antd 系需要「组件内部值」和「框架类名」的部分。
  if (S && S.register) {
    S.register('fiber-props', function (el, desired) {
      try { return fillAntdPickerByModel(el, desired, desired); } catch (_) { return false; }
    });
    S.register('panel-input', function (el, desired) {
      if (!isAntdV3Picker(el)) return false;
      return tryAntdV3Calendar(el, desired);
    });
    S.register('panel-nav', function (el, desired) {
      try { return tryAntdPanel(el, desired); } catch (_) { return false; }
    });
    S.register('grid-click', function (el, desired) {
      try { return tryAntdDayCell(el, desired); } catch (_) { return false; }
    });
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message && message.type === 'FILL_FORM') {

      handleFillMultiFrame(message.options || {}).then(function (r) {
        // 子 frame 不应答，只把结果 postMessage 给顶层
        if (IS_TOP_FRAME) sendResponse(r);
      }).catch(function (err) {
        if (IS_TOP_FRAME) {
          sendResponse({ ok: false, filled: 0, filledKeys: [], skipped: [], reason: 'exception: ' + String(err && err.message || err).slice(0, 160) });
        }
      });
      return true;
    }
    if (message && message.type === 'SCAN_FIELDS') {
      handleScan().then(sendResponse);
      return true;
    }
    if (message && message.type === 'COLLECT_FIELDS') {
      handleCollect().then(sendResponse);
      return true;
    }
    if (message && message.type === 'APPLY_MAPPINGS') {
      handleApply(message).then(sendResponse);
      return true;
    }
    if (message && message.type === 'PING_CONTENT') {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
