/**
 * 简历填写工具 — 内容脚本
 * 依赖 shared/match.js（须在 manifest content_scripts 中先于本文件加载）。
 * FILL_FORM / SCAN_FIELDS / COLLECT_FIELDS / APPLY_MAPPINGS
 * 不自动提交；不填 password/file；不盲勾 checkbox。
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

  var MAX_FILLS_PER_KEY = M.MAX_FILLS_PER_KEY;

  // 字段块里的“标签位”常见噪声词，别当字段名
  var LABEL_STOP_RE = /^(必填|选填|\*|请输入|请选择|上传|删除|添加|新增|保存|取消|确定|编辑|查看|更多|展开|收起|全部|全选|其他|以上)$/;

  /** 不像字段名的文本（校验提示、区号、按钮词、导航长文） */
  function labelNoise(text, maxLen) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > (maxLen || 24)) return true;
    if (LABEL_STOP_RE.test(t)) return true;
    if (/未填写|必填项|错误|提示|不能为空|请输入|请选择/.test(t)) return true;
    if (/^\+\d{1,4}$/.test(t)) return true;
    if (t.split(' ').length > 3) return true;
    return false;
  }

  // —————— v1.5.23：一轮填写 / 扫描内的 DOM 读缓存 ——————
  // getLabelText / detectSectionContext / collectHints 每个字段会被调 5~6 次，每次都要 closest +
  // querySelectorAll 往上爬（区块推断还会在每一层 querySelectorAll 整个子树）。
  // 轮次开始建 WeakMap、结束即丢弃：不持有 DOM 节点，也不会把上一轮的结果带进下一轮。
  var memo = null;

  function beginMemo() {
    if (memo || typeof WeakMap !== 'function') return false;
    memo = { label: new WeakMap(), section: new WeakMap(), hints: new WeakMap(), scope: new WeakMap() };
    return true;
  }

  function endMemo(owned) {
    if (owned) memo = null;
  }

  function memoGet(kind, el, compute) {
    if (!memo || !el || typeof el !== 'object') return compute();
    var m = memo[kind];
    if (m.has(el)) return m.get(el);
    var v = compute();
    m.set(el, v);
    return v;
  }

  function getLabelText(el) {
    return memoGet('label', el, function () { return computeLabelText(el); });
  }

  function computeLabelText(el) {
    // 1. label[for]
    if (el.id) {
      try {
        var label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (label) {
          var tFor = M.visibleLabelText(label);
          if (tFor) return tFor;
        }
      } catch (_) { /* ignore */ }
    }
    // 1b. wrapping label
    //     注意：不少组件库（Moka 的 sd-Input）把控件包在 <label> 里，里面的文本是当前值/错误提示，
    //     真正的字段名在更外层的 .title 里，所以这里要排掉「值 / 占位符 / 校验文案」
    var parentLabel = el.closest('label');
    if (parentLabel) {
      var tWrap = String(M.visibleLabelText(parentLabel) || '').replace(/\s+/g, ' ').trim();
      var ownValue = String(el.value || '').trim();
      var ownPh = String(el.getAttribute('placeholder') || '').trim();
      var extraControls = parentLabel.querySelectorAll('input, select, textarea').length > 1;
      if (tWrap && !extraControls && !labelNoise(tWrap) &&
          tWrap !== ownValue && tWrap !== ownPh) {
        return tWrap;
      }
    }
    // 1c. aria-label
    var aria = el.getAttribute('aria-label');
    if (aria && String(aria).trim()) return String(aria).trim();
    // 1d. aria-describedby
    var describedBy = el.getAttribute('aria-describedby');
    if (describedBy) {
      var desc = document.getElementById(describedBy);
      if (desc) {
        var tDesc = String(desc.textContent || '').replace(/\s+/g, ' ').trim();
        if (tDesc) return tDesc;
      }
    }
    // 2. aria-labelledby
    if (M.resolveAriaLabelledByText) {
      var tAria = M.resolveAriaLabelledByText(el, function (id) {
        return document.getElementById(id);
      });
      if (tAria) return tAria;
    }
    // 3. form-item container (antd / element / semi / formily)
    if (M.labelTextFromFormItem) {
      var tForm = M.labelTextFromFormItem(el);
      // 兜底规则可能抓到校验提示（Moka 的「必填项未填写」）或外层容器名，过滤掉继续往下找
      // form-item 里的是真标签，只挡校验文案，长度放宽
      if (tForm && !labelNoise(tForm, 40)) return tForm;
    }
    // 4. previousElementSibling
    var prev = el.previousElementSibling;
    if (prev && /^(LABEL|SPAN|DIV|P|STRONG)$/i.test(prev.tagName)) {
      var tPrev = M.visibleLabelText
        ? M.visibleLabelText(prev)
        : String(prev.textContent || '');
      tPrev = String(tPrev || '').replace(/\s+/g, ' ').trim();
      if (M.cleanLabelPunctuation) tPrev = M.cleanLabelPunctuation(tPrev);
      // 导航条/列表容器也会是「前一个兄弟」：文本过长或多段的不是字段名
      if (!labelNoise(tPrev)) return tPrev;
    }
    // 5. parent's previousElementSibling (label-col | control-col)
    if (M.labelTextFromParentPrevSibling) {
      var tCol = M.labelTextFromParentPrevSibling(el);
      if (tCol && !labelNoise(tCol, 40)) return tCol;
    }
    // 6. 表格布局（Redsea / 老 HR 系统）：字段名在左侧单元格
    var cell = el.closest ? el.closest('td, th') : null;
    if (cell) {
      var prevCell = cell.previousElementSibling;
      if (prevCell) {
        var tCell = M.visibleLabelText
          ? M.visibleLabelText(prevCell)
          : String(prevCell.textContent || '');
        tCell = String(tCell || '').replace(/\s+/g, ' ').trim();
        if (M.cleanLabelPunctuation) tCell = M.cleanLabelPunctuation(tCell);
        if (tCell && tCell.length <= 40 && !labelNoise(tCell)) return tCell;
      }
    }
    // 6b. 通用「字段块」：控件上方/左侧是一段短文本（Moka 的 .apply-field > .title）
    //     放在最后兜底，前面各家的规则都不命中时才用，避免把正常站点的标签带偏
    var block = el.parentElement;
    for (var bd = 0; bd < 6 && block; bd++, block = block.parentElement) {
      var blockText = String(block.textContent || '').replace(/\s+/g, ' ').trim();
      if (!blockText) continue;          // 控件外层常是只有 input 的壳，继续往上找
      if (blockText.length > 80) break;
      var bKids = block.children || [];
      for (var bi = 0; bi < bKids.length; bi++) {
        var kid = bKids[bi];
        if (!kid || kid === el || kid.contains(el)) break;
        // 同一个控件组里还有别的输入（比如 +86 区号）→ 那是控件不是标签
        if (kid.querySelector && kid.querySelector('input, select, textarea, button')) continue;
        var kidText = String(kid.textContent || '').replace(/\s+/g, ' ').trim();
        if (!kidText || kidText.length > 16) continue;
        if (labelNoise(kidText)) continue;
        if (M.cleanLabelPunctuation) kidText = M.cleanLabelPunctuation(kidText);
        if (kidText) return kidText;
      }
    }
    // 7. Element-UI 自定义下拉：标题常在控件容器的前一个兄弟节点
    var selBox = el.closest
      ? el.closest('.dictionary-selector, .el-select, .form-select, .ant-select')
      : null;
    if (selBox) {
      var pv = selBox.previousElementSibling;
      if (pv) {
        var tPv = M.visibleLabelText ? M.visibleLabelText(pv) : String(pv.textContent || '');
        tPv = String(tPv || '').replace(/\s+/g, ' ').trim();
        if (M.cleanLabelPunctuation) tPv = M.cleanLabelPunctuation(tPv);
        if (tPv && tPv.length <= 40 && !labelNoise(tPv)) return tPv;
      }
    }
    return '';
  }

  /**
   * 判断字段是否已有有效值；已填则跳过，避免覆盖用户/先前填写。
   * select：无选中、或选中项 value 空且文案像占位（Select/请选择/--）→ 空。
   * input/textarea（非 checkbox/radio）：trim 后非空 → 已填。
   * checkbox/radio：不在此改动（仍不自动勾选）。
   */
  function fieldLooksFilled(el) {
    if (!el) return false;
    var tag = el.tagName.toLowerCase();
    var type = (el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return false;
    if (tag === 'select') {
      var opt = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      if (!opt) return false;
      var v = String(opt.value || '').trim();
      var t = String(opt.text || '').trim();
      // 占位 option 不算已填：请选择 / Select / 年 / 月 / 日 / --（中英混排如「请选择 / Select」也要覆盖）
      if (!v && (!t || /^(?:-+)?\s*(?:请选择|选择|select|choose|年|月|日|year|month|day|yyyy|mm|dd)(?![a-z])/i.test(t))) return false;
      return true;
    }
    return String(el.value || '').trim() !== '';
  }

  /**
   * Moka 等：同父/祖父内仅有 placeholder「年」「月」的互补输入对。
   * @returns {'year'|'month'|null}
   */
  function detectAdjacentDatePairRole(el) {
    if (!el || !el.getAttribute) return null;
    var ph = String(el.getAttribute('placeholder') || '').trim();
    var ourRole = null;
    if (/^(年|year|yyyy)$/i.test(ph)) ourRole = 'year';
    else if (/^(月|month|mm)$/i.test(ph)) ourRole = 'month';
    else return null;
    var wantRe = ourRole === 'year' ? /^(月|month|mm)$/i : /^(年|year|yyyy)$/i;
    var containers = [];
    if (el.parentElement) containers.push(el.parentElement);
    if (el.parentElement && el.parentElement.parentElement) {
      containers.push(el.parentElement.parentElement);
    }
    var c, inputs, i, other, otherPh;
    for (c = 0; c < containers.length; c++) {
      try {
        inputs = containers[c].querySelectorAll('input');
      } catch (_) {
        continue;
      }
      for (i = 0; i < inputs.length; i++) {
        other = inputs[i];
        if (other === el) continue;
        otherPh = String(other.getAttribute('placeholder') || '').trim();
        if (wantRe.test(otherPh)) return ourRole;
      }
    }
    return null;
  }

  function collectHints(el) {
    return memoGet('hints', el, function () { return computeHints(el); });
  }

  function computeHints(el) {
    var label = getLabelText(el);
    var adjacentRole = detectAdjacentDatePairRole(el);
    var groupLabel = '';
    if ((!label || !String(label).trim()) && adjacentRole && M.findNearbyDateGroupLabelText) {
      groupLabel = M.findNearbyDateGroupLabelText(el) || '';
    }
    var primaryLabel = (label && String(label).trim()) ? label : groupLabel;
    var parts = [
      primaryLabel,
      el.getAttribute('placeholder'),
      el.name,
      el.id,
      el.getAttribute('aria-label'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-automation-id')
    ];
    // 已有有用标签时不倾倒 antd 长 className；否则仅保留语义 token
    if (!primaryLabel || !String(primaryLabel).trim()) {
      var cn = typeof el.className === 'string' ? el.className : '';
      var sem = M.semanticClassTokens ? M.semanticClassTokens(cn) : '';
      if (sem) parts.push(sem);
    }
    return parts.filter(Boolean).join(' ');
  }

  /**
   * v1.5.2：区块上下文（教育 / 实习 / 工作 / 项目 / 校园）。
   * 「城市」在同一份表单的教育块与工作块含义不同，仅靠标签无法区分。
   */
  function sectionContextFromText(text) {
    if (!text || text.length > 24) return '';
    // 「工作/实习经历」是混合段：按工作段处理（workList 是主档），只有纯实习段才算 intern
    if (/实习/.test(text) && !/工作/.test(text)) return 'intern';
    if (/教育|学历|学习经历|院校|在校|就读/.test(text)) return 'edu';
    if (/工作|职业|任职|履历|工作经验/.test(text)) return 'work';
    if (/项目/.test(text)) return 'project';
    if (/校园|社团|学生工作|社会实践/.test(text)) return 'campus';
    return '';
  }

  function detectSectionContext(el) {
    return memoGet('section', el, function () { return computeSectionContext(el); });
  }

  function computeSectionContext(el) {
    // v1.5.5：北森 Phoenix 的区块标题在 .form 的孪生 div 上（同 id），不在祖先链里
    var phoenixForm = el && el.closest ? el.closest('.form[id*="_Recruitment_"]') : null;
    if (phoenixForm) {
      var pCtx = sectionContextFromText(phoenixFormTitle(phoenixForm));
      if (pCtx) return pCtx;
    }
    var node = el;
    // v1.5.24：12 层（antd / Element 的表单项本身就套了 6~7 层，原来的 7 层够不到分区标题）
    for (var up = 0; up < 12 && node && node.parentElement; up++) {
      var text = '';
      if (node.tagName === 'FIELDSET') {
        var lg = node.querySelector('legend');
        if (lg) text = String(lg.textContent || '').trim();
      }
      if (!text && node.querySelector) {
        var head = node.querySelector(':scope > legend, :scope > h2, :scope > h3, :scope > h4, :scope > summary, :scope > .section-title, :scope > .ant-card-head-title, :scope > .el-card__header, :scope > .panel-heading');
        if (head) text = String(head.textContent || '').replace(/\s+/g, ' ').trim();
      }
      // 分区标题是容器前面的兄弟（<h3>教育经历</h3><form>…</form>）
      if (!text) text = headingBefore(node);
      if (text && text.length <= 24) {
        var ctx = sectionContextFromText(text);
        if (ctx) return ctx;
      }
      node = node.parentElement;
    }
    // v1.5.12：没有区块标题的 ATS（wecruit / antd 表单）用同一组字段里的兄弟标签推断
    var bySiblings = sectionContextBySiblingLabels(el);
    if (bySiblings) return bySiblings;
    return '';
  }

  var HEADING_CLASS_RE = /(^|\s)[\w-]*(section|block|card|group|module|part|panel)[-_]?(title|header|heading|head)(\s|$)|(^|\s)(title|header|heading)(\s|$)/i;

  /** node 前面紧挨的标题兄弟（只认标题标签 / 标题类名，表单项标签不算） */
  function headingBefore(node) {
    var prev = node.previousElementSibling;
    for (var hop = 0; hop < 2 && prev; hop++, prev = prev.previousElementSibling) {
      var tag = String(prev.tagName || '').toUpperCase();
      var cls = String(prev.className || '');
      if (/label|form-item/i.test(cls)) return '';
      if (/^(H1|H2|H3|H4|H5|LEGEND)$/.test(tag) || HEADING_CLASS_RE.test(cls)) {
        return String(prev.textContent || '').replace(/\s+/g, ' ').trim();
      }
      // 中间隔着一个输入框 / 表单项就不是本区块的标题了
      if (prev.querySelector && prev.querySelector('input, select, textarea')) return '';
    }
    return '';
  }

  /** 用「同一组字段里还有哪些标签」判断这块是教育 / 工作 / 项目 */
  function sectionContextBySiblingLabels(el) {
    if (!el || !el.closest) return '';
    var node = el.closest('.ant-form-item, .form-item, .field, .row, tr') || el.parentElement;
    for (var up = 0; up < 6 && node && node.parentElement; up++) {
      var scope = node.parentElement;
      // 同一组里的兄弟字段共享同一个 scope：结果按 scope 缓存，一组只算一次
      var cached = memo ? memo.scope.get(scope) : undefined;
      if (cached === 'stop') return '';
      if (cached) return cached;
      var items = scope.querySelectorAll('.ant-form-item, .form-item, .field, tr').length;
      // 一段通常 2~14 个字段；到 40+ 说明已经上溯到整页，别再猜
      if (items > 14) { if (memo) memo.scope.set(scope, 'stop'); return ''; }
      if (items >= 2) {
        var labels = [];
        Array.prototype.forEach.call(scope.querySelectorAll('label'), function (lab) {
          var t = String(lab.textContent || '').replace(/\s+/g, '').trim();
          if (t) labels.push(t);
        });
        var joined = labels.join('|');
        var found = '';
        if (/学校|院校|院系|所学专业|就读/.test(joined)) found = 'edu';
        else if (/企业名称|公司名称|工作描述|所在部门|工作内容|职位名称/.test(joined)) found = 'work';
        else if (/项目名称|项目描述|项目职责/.test(joined)) found = 'project';
        if (found) { if (memo) memo.scope.set(scope, found); return found; }
      }
      node = scope;
    }
    return '';
  }

  // —————— v1.5.4：按 id 的语义路径做行级映射（ATS 常见：resumeEducationInfo_0_collegeName）——————
  var STRUCT_PATH_RE = /resume(education|work|project|paper|intern)info_(\d+)_([a-z]+)/i;

  var STRUCT_FIELDS = {
    education: {
      schoolname: { field: 'school', key: 'school' },
      city: { field: 'city', key: 'schoolCity' },
      collegename: { field: 'department', key: 'department' },
      department: { field: 'department', key: 'department' },
      major: { field: 'major', key: 'major' },
      degree: { field: 'degree', key: 'eduDegree' },
      startdate: { field: 'start', key: 'eduStart' },
      enddate: { field: 'end', key: 'eduEnd' },
      scorerank: { field: 'rank', key: 'majorRank' },
      mentor: { field: 'advisor', key: 'advisorName' },
      laboratory: { field: 'laboratory', key: 'labName' },
      researchdirection: { field: 'research', key: 'researchDirection' },
      gpa: { field: 'gpa', key: 'gpa' },
      description: { field: 'description', key: 'eduDescription' },
      remark: { field: 'description', key: 'eduDescription' }
    },
    work: {
      companyname: { field: 'company', key: 'company' },
      department: { field: 'department', key: 'workDepartment' },
      position: { field: 'title', key: 'title' },
      positionname: { field: 'title', key: 'title' },
      title: { field: 'title', key: 'title' },
      startdate: { field: 'start', key: 'startDate' },
      enddate: { field: 'end', key: 'workEnd' },
      city: { field: 'city', key: 'workCity' },
      worktype: { field: 'nature', key: 'workNature' },
      employmenttype: { field: 'nature', key: 'workNature' },
      nature: { field: 'nature', key: 'workNature' },
      description: { field: 'description', key: 'workDescription' },
      workdescription: { field: 'description', key: 'workDescription' },
      workcontent: { field: 'description', key: 'workDescription' },
      jobdescription: { field: 'description', key: 'workDescription' },
      remark: { field: 'description', key: 'workDescription' }
    },
    paper: {
      name: { field: 'name', key: 'awardName' },
      rank: { field: 'rank', key: 'awardRank' },
      time: { field: 'date', key: 'awardDate' },
      remark: { field: 'description', key: 'awardDescription' }
    },
    intern: {
      companyname: { field: 'company', key: 'internCompany' },
      department: { field: 'department', key: 'internDepartment' },
      position: { field: 'title', key: 'internTitle' },
      positionname: { field: 'title', key: 'internTitle' },
      startdate: { field: 'start', key: 'internStart' },
      enddate: { field: 'end', key: 'internEnd' },
      city: { field: 'city', key: 'internCity' },
      description: { field: 'description', key: 'internDescription' }
    },
    project: {
      name: { field: 'name', key: 'projectName' },
      projectname: { field: 'name', key: 'projectName' },
      role: { field: 'role', key: 'projectRole' },
      startdate: { field: 'start', key: 'projectStart' },
      enddate: { field: 'end', key: 'projectEnd' },
      description: { field: 'description', key: 'projectDesc' }
    }
  };

  var STRUCT_LIST_KEY = { education: 'eduList', work: 'workList', project: 'projectList', paper: 'awardList', intern: 'internList' };

  /**
   * 从 id 里解析「第几段 + 哪个字段」。同一 id 的两个日期框（如 …_startDate）
   * 用 placeholder 区分入学/毕业、入职/离职。
   */
  function detectStructuredField(el) {
    if (!el || !el.id) return null;
    var m = String(el.id).match(STRUCT_PATH_RE);
    if (!m) return null;
    var section = m[1].toLowerCase();
    var index = parseInt(m[2], 10);
    var raw = m[3].toLowerCase();
    var map = STRUCT_FIELDS[section];
    if (!map) return null;
    var hit = map[raw];
    if (!hit) return null;
    var field = hit.field;
    var key = hit.key;
    if (raw === 'startdate' || raw === 'enddate') {
      var ph = String(el.getAttribute('placeholder') || '');
      if (/毕业|结束|截止|离职|离校|至今|结束时间/.test(ph)) { field = 'end'; key = section === 'education' ? 'eduEnd' : (section === 'work' ? 'workEnd' : key); }
      else if (/入学|开始|入职|起始/.test(ph)) { field = 'start'; key = section === 'education' ? 'eduStart' : (section === 'work' ? 'startDate' : key); }
    }
    return { listKey: STRUCT_LIST_KEY[section], index: index, field: field, key: key };
  }

  /** 第 N 段的值；第 0 段且条目为空时回落到扁平字段 */
  function structuredValue(profile, struct) {
    if (!struct) return '';
    var list = M.listFor ? M.listFor(profile, struct.listKey) : (profile && Array.isArray(profile[struct.listKey]) ? profile[struct.listKey] : []);
    var item = list[struct.index] || null;
    if (item) {
      var v = item[struct.field];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    if (struct.index === 0) return M.profileValue(profile, struct.key) || '';
    return '';
  }


  // —————— v1.5.5：有的网申要先把「添加教育经历 / 添加上一段工作」点出来才有输入框 ——————
  var ADD_BUTTON_RE = /(?:^|[+＋\s])(?:添加|新增|增加|继续添加|再加一?段|新增一?条|添加一?条|add\b)/i;
  var ADD_SECTION_RULES = [
    { listKey: 'eduList', key: 'edu', re: /教育|学历|院校|学校/ },
    { listKey: 'workList', key: 'work', re: /工作|任职|职业|履历|雇主/ },
    { listKey: 'internList', key: 'intern', re: /实习/ },
    { listKey: 'projectList', key: 'project', re: /项目|科研/ },
    { listKey: 'awardList', key: 'award', re: /奖项|竞赛|荣誉|获奖|奖励/ },
    { listKey: 'campusList', key: 'campus', re: /校园|社团|学生工作|组织经历/ }
  ];

  /** 按钮不可点的情形：附件 / 上传 / 视频 / 图片 这类点了会弹文件选择框 */
  function isUnsafeAddButton(text) {
    return /附件|文件|上传|视频|图片|照片|logo|简历|扫描|二维码|关注|反馈|删除|清空|移除|取消/i.test(String(text || ''));
  }

  var ADD_BUTTON_NODE_SEL = 'button, a, [role="button"], .ant-btn, .el-button, span, div, i';
  var ADD_WORD_RE = /添加|新增|增加|再加|add/i;

  /**
   * v1.5.23：只从「含添加/新增字样的文本节点」往上找候选，而不是对整页每个 span/div 取 textContent
   * （外层 div 的 textContent 是整棵子树，几千个节点就是几十毫秒，expandAddSections 还要跑多轮）。
   * 候选集合与旧实现一致：文本 ≤16 字、命中 ADD_BUTTON_RE 的元素，按文档顺序返回。
   */
  function addButtonNodes() {
    var root = document.body || document.documentElement;
    if (!root || !document.createTreeWalker) {
      return Array.prototype.slice.call(document.querySelectorAll(ADD_BUTTON_NODE_SEL));
    }
    var walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null);
    var picked = [];
    var mark = typeof Set === 'function' ? new Set() : null;
    var tn;
    while ((tn = walker.nextNode())) {
      var v = tn.nodeValue;
      if (!v || v.length > 40 || !ADD_WORD_RE.test(v)) continue;
      var n = tn.parentElement;
      for (var up = 0; up < 5 && n && n !== root; up++, n = n.parentElement) {
        var len = String(n.textContent || '').replace(/\s+/g, ' ').trim().length;
        if (len > 16) break;
        if (!n.matches || !n.matches(ADD_BUTTON_NODE_SEL)) continue;
        if (mark ? mark.has(n) : picked.indexOf(n) !== -1) continue;
        if (mark) mark.add(n);
        picked.push(n);
      }
    }
    // 图标按钮可能没有文本节点（<i class="add">），保留按钮类元素的老路径
    Array.prototype.forEach.call(document.querySelectorAll('button, [role="button"], .ant-btn, .el-button'), function (b) {
      if (mark ? mark.has(b) : picked.indexOf(b) !== -1) return;
      if (mark) mark.add(b);
      picked.push(b);
    });
    picked.sort(function (a, b) {
      if (a === b) return 0;
      return (a.compareDocumentPosition(b) & 4 /* FOLLOWING */) ? -1 : 1;
    });
    return picked;
  }

  function addButtonCandidates() {
    var nodes = addButtonNodes();
    var out = [];
    var seen = [];
    Array.prototype.forEach.call(nodes, function (n) {
      if (n.disabled || /disabled/i.test(String(n.className || ''))) return;
      var t = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 16) return;
      if (!ADD_BUTTON_RE.test(t)) return;
      if (isUnsafeAddButton(t)) return;
      if (!isVisibleEl(n)) return;
      // 文案常被 <span>/图标包一层（BYD：「增加教育经历」= button > i + span）：
      // 统一解析到真正的可点元素，避免点到没有 handler 的外层 div
      var clickable = n.closest ? n.closest('button, a, [role="button"], .ant-btn, .el-button') : null;
      var target = clickable || n;
      var targetText = String(target.textContent || '').replace(/\s+/g, ' ').trim();
      if (targetText !== t && targetText.length > 24) return;
      if (seen.indexOf(target) !== -1) return;
      seen.push(target);
      out.push({ el: target, text: t });
    });
    // 祖先 div 常和按钮同文案（querySelectorAll 先返回祖先）：只留最内层那个，
    // 否则会点到没有 handler 的外层，按钮看着被“点了”但什么都没发生
    var inner = [];
    for (var i = 0; i < out.length; i++) {
      var ancestor = false;
      for (var j = 0; j < out.length; j++) {
        if (i !== j && out[i].el !== out[j].el && out[i].el.contains(out[j].el)) { ancestor = true; break; }
      }
      if (!ancestor) inner.push(out[i]);
    }
    return inner;
  }

  /** 这段按钮属于哪个分区：先看按钮文案，再看最近的区块标题 */
  function addButtonSection(text, el) {
    for (var i = 0; i < ADD_SECTION_RULES.length; i++) {
      if (ADD_SECTION_RULES[i].re.test(text)) return ADD_SECTION_RULES[i];
    }
    var node = el;
    for (var up = 0; up < 6 && node && node.parentElement; up++) {
      var head = node.querySelector ? node.querySelector(':scope > legend, :scope > h2, :scope > h3, :scope > h4, :scope > summary, :scope > .section-title, :scope > .ant-card-head-title, :scope > .panel-heading, :scope > .edit-resume-form-item-title, :scope > [class*="form-item-title"], :scope > [class*="section-title"]') : null;
      var htxt = head ? String(head.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (htxt && htxt.length <= 24) {
        for (var j = 0; j < ADD_SECTION_RULES.length; j++) {
          if (ADD_SECTION_RULES[j].re.test(htxt)) return ADD_SECTION_RULES[j];
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  /** 该分区当前已有多少条记录（按行级 id 或列表容器判断） */
  function countSectionRows(rule) {
    var idx = {};
    var ids = document.querySelectorAll('[id*="Info_"]');
    Array.prototype.forEach.call(ids, function (n) {
      var m = String(n.id || '').match(/(education|work|intern|project|paper|campus)info_(\d+)_/i);
      if (!m) return;
      idx[m[1].toLowerCase() + ':' + m[2]] = 1;
    });
    var sectionName = { edu: 'education', work: 'work', intern: 'intern', project: 'project', award: 'paper', campus: 'campus' }[rule.key];
    var n = 0;
    for (var k in idx) {
      if (!Object.prototype.hasOwnProperty.call(idx, k)) continue;
      if (k.indexOf(sectionName + ':') === 0) n += 1;
    }
    if (n) return n;
    // v1.5.12：快手 —— educations_0_xxx / interShips_0_xxx，按前缀 + 序号去重
    var byIdPrefix = countIndexedRows(rule.key);
    if (byIdPrefix) return byIdPrefix;
    // v1.5.5：北森 Phoenix —— 每条记录是一个独立 .form，与区块标题共用一个 id
    var phoenixRows = countPhoenixRows(rule);
    if (phoenixRows) return phoenixRows;
    // v1.5.7：区块 + .list-form-container 的行式布局（BYD 校招简历）
    var listRows = countListFormRows(rule);
    if (listRows) return listRows;
    // 退路：按常见列表容器估算
    var box = document.querySelector('[class*="' + rule.key + '"][class*="list"], [data-section*="' + rule.key + '"]');
    if (box) {
      var rows = box.querySelectorAll('[class*="item"], [class*="row"], li');
      return rows ? rows.length : 0;
    }
    return 0;
  }

  // 分区记录的 id 前缀（快手：educations_0_companyName、interShips_0_companyName）
  var SECTION_ROW_PREFIX = {
    edu: /^(educations?|educationbackgrounds?)$/i,
    work: /^(workships?|workexperiences?|works?)$/i,
    intern: /^(internships?|interships?|practices?)$/i,
    project: /^(projects?|projectexperiences?)$/i,
    award: /^(awards?|competitionawards?|honors?)$/i,
    campus: /^(campusexperiences?|activities?)$/i
  };

  function countIndexedRows(key) {
    var re = SECTION_ROW_PREFIX[key];
    if (!re) return 0;
    var seen = {};
    var nodes = document.querySelectorAll('[id]');
    for (var i = 0; i < nodes.length; i++) {
      var m = String(nodes[i].id || '').match(/^(.+?)_(\d+)_/);
      if (!m || !re.test(m[1])) continue;
      seen[m[1] + ':' + m[2]] = 1;
    }
    return Object.keys(seen).length;
  }

  /** 区块标题匹配 rule，内部每条记录是一个 .list-form-container */
  function countListFormRows(rule) {
    var sections = document.querySelectorAll('.resume-section');
    for (var i = 0; i < sections.length; i++) {
      var head = sections[i].querySelector('.section-title .title') || sections[i].querySelector('.section-title');
      var t = String((head && head.textContent) || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 20) continue;
      if (!rule.re.test(t)) continue;
      var rows = sections[i].querySelectorAll('.list-form-container');
      if (rows.length) return rows.length;
    }
    return 0;
  }

  function countPhoenixRows(rule) {
    var forms = document.querySelectorAll('.form[id*="_Recruitment_"]');
    var best = 0;
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      if (!phoenixFormTitle(f) || !rule.re.test(phoenixFormTitle(f))) continue;
      var esc = window.CSS && CSS.escape ? CSS.escape(f.id) : f.id;
      var same = 0;
      try { same = document.querySelectorAll('[id="' + esc + '"].form').length; } catch (_) { same = 0; }
      if (same > best) best = same;
    }
    return best;
  }

  function desiredRowsFor(profile, rule) {
    var own = profile && Array.isArray(profile[rule.listKey]) ? profile[rule.listKey] : [];
    if (own.length) return own.length;
    // 没有多段数据时，若扁平字段有值就展开 1 条
    if (rule.key === 'intern' && Array.isArray(profile && profile.workList)) {
      var internLike = profile.workList.filter(function (w) {
        return /实习|intern/i.test(String((w && (w.nature || w.type || w.position || w.title)) || ''));
      });
      if (internLike.length) return internLike.length;
    }
    var flatBySection = { edu: 'school', work: 'company', intern: 'internCompany', project: 'projectName', award: 'awardName', campus: 'campusOrg' };
    var flat = profile ? profile[flatBySection[rule.key]] : '';
    return flat && String(flat).trim() ? 1 : 0;
  }

  /**
   * 点「添加」把分区展开到目标条数。
   * @returns {{section:string, clicks:number}[]}
   */
  // —————— v1.5.7：起止时间合在一个控件里（el-date-editor--daterange / ant-picker-range）——————
  // 这类控件的两个 input 共享同一个 label（「起止时间」），逐 input 匹配只会各写一份同样的值；
  // 必须按「分区 + 第几段」取 start/end，再走组件自己的提交路径。
  var RANGE_EDITOR_SEL = '.el-date-editor--daterange, .el-date-editor--datetimerange, ' +
    '.el-date-editor--monthrange, .ant-picker-range';

  var RANGE_SECTION_MAP = {
    edu: { listKey: 'eduList', startKey: 'eduStart', endKey: 'eduEnd' },
    work: { listKey: 'workList', startKey: 'startDate', endKey: 'workEnd' },
    intern: { listKey: 'internList', startKey: 'internStart', endKey: 'internEnd' },
    project: { listKey: 'projectList', startKey: 'projectStart', endKey: 'projectEnd' },
    campus: { listKey: 'campusList', startKey: 'campusStart', endKey: 'campusEnd' }
  };

  function nodeText(n) {
    return String((n && n.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function ruleForText(text) {
    var t = String(text || '');
    if (!t) return null;
    for (var i = 0; i < ADD_SECTION_RULES.length; i++) {
      if (ADD_SECTION_RULES[i].re.test(t)) return ADD_SECTION_RULES[i];
    }
    return null;
  }

  /** 范围控件属于哪个分区、第几段（BYD：.list-form-container + 「教育经历-1」标题） */
  function rangeContext(el) {
    var row = el.closest
      ? el.closest('.list-form-container, [class*="list-form-item"], [class*="resume-item"]')
      : null;
    var rule = null;
    var header = row
      ? row.querySelector('.list-form-header, .form-header-title, [class*="header-title"]')
      : null;
    if (header) rule = ruleForText(nodeText(header));
    var section = el.closest ? el.closest('.resume-section, .ant-card, section') : null;
    if (!rule && section) {
      var secHead = section.querySelector('.section-title .title') ||
        section.querySelector('.section-title, .ant-card-head-title, h2, h3');
      rule = ruleForText(nodeText(secHead));
    }
    if (!rule) return null;
    if (!RANGE_SECTION_MAP[rule.key]) return null;
    var index = 0;
    var explicit = false;
    var m = nodeText(header).match(/(\d+)\s*(?:$|[）)])/);
    if (m) {
      index = Math.max(0, parseInt(m[1], 10) - 1);
      explicit = true;
    } else if (row && row.parentElement) {
      var sibs = Array.prototype.filter.call(row.parentElement.children, function (n) {
        return n.classList && n.classList.contains('list-form-container');
      });
      var pos = sibs.indexOf(row);
      if (pos >= 0) { index = pos; explicit = true; }
    }
    return { rule: rule, index: index, explicit: explicit };
  }

  /** 从最近的 id 里读段序号（快手：educations_1_schoolName、interShips_0_companyName） */
  function rowIndexFromIds(el) {
    var node = el;
    for (var up = 0; up < 10 && node; up++, node = node.parentElement) {
      var own = String(node.id || '');
      var m0 = own.match(/^[A-Za-z]+_(\d+)_/);
      if (m0) return parseInt(m0[1], 10);
      var ids = node.querySelectorAll ? node.querySelectorAll('[id]') : [];
      for (var i = 0; i < ids.length; i++) {
        var m = String(ids[i].id || '').match(/^[A-Za-z]+_(\d+)_/);
        if (m) return parseInt(m[1], 10);
      }
    }
    return -1;
  }

  /** 分区标题不在 .resume-section 里时（快手 .edit-resume-form-item-title）的兜底 */
  function rangeContextLoose(el) {
    var rule = null;
    var node = el;
    for (var up = 0; up < 10 && node && !rule; up++, node = node.parentElement) {
      if (!node.querySelector) continue;
      var t = node.querySelector('.edit-resume-form-item-title, [class*="form-item-title"], .section-gorgeously-title, .section-title, legend, h2, h3');
      if (t) rule = ruleForText(nodeText(t));
    }
    if (!rule || !RANGE_SECTION_MAP[rule.key]) return null;
    var idx = rowIndexFromIds(el);
    return { rule: rule, index: idx < 0 ? 0 : idx, explicit: idx >= 0 };
  }

  /** 「2023-09」→ Date；缺日时，起点补 1 号，终点补当月最后一天 */
  function rangeDateOf(value, isEnd) {
    var parts = parseDateParts(value);
    if (!parts) return null;
    var y = parseInt(parts.y, 10);
    var m = parseInt(parts.m, 10);
    if (!y || !m) return null;
    var d = parts.d ? parseInt(parts.d, 10) : (isEnd ? new Date(y, m, 0).getDate() : 1);
    return new Date(y, m - 1, d);
  }

  function formatDateYmd(d) {
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  /**
   * 写范围控件：先落 UI 值，再用组件自己的提交路径（点日历格子走的就是 pick 事件）更新 v-model。
   * 只有提交成功（v-model 已更新）才算填上，避免「看起来有值、表单其实没收到」。
   */
  async function fillRangeEditor(editor, startVal, endVal) {
    // antd 的 RangePicker 两个 input 都是 readonly：只能点面板（快手教育经历的「起止时间」）
    if (editor.classList && editor.classList.contains('ant-calendar-picker')) {
      // antd v3 范围：调组件自己的 handleChange（与点完面板等价）
      var v3ins = editor.querySelectorAll('input.ant-calendar-range-picker-input');
      if (v3ins.length < 2 || !fillAntdPickerByModel(v3ins[0], startVal, endVal)) return false;
      await sleep(160);
      var a3 = String(v3ins[0].value || '').trim();
      var b3 = String(v3ins[1].value || '').trim();
      return !!a3 && !!b3 && dateValueMatches(a3, startVal) && dateValueMatches(b3, endVal);
    }
    if (editor.classList && editor.classList.contains('ant-picker-range')) {
      var rangeIns = editor.querySelectorAll('input');
      // ① 直接改组件值（最可靠，不依赖点击）
      try {
        if (fillAntdPickerByModel(editor, startVal, endVal)) {
          await sleep(220);
          var ra = String(rangeIns[0].value || '').trim();
          var rb = String(rangeIns[1].value || '').trim();
          if (ra && rb) return true;
        }
      } catch (_) { /* ignore */ }
      // ② 退回点日历
      try {
        if (await fillAntdRangePicker(editor, startVal, endVal)) return true;
      } catch (_) { /* ignore */ }
      return false;
    }
    var inputs = Array.prototype.filter.call(editor.querySelectorAll('input'), function (i) {
      return !i.disabled && !i.readOnly;
    });
    if (inputs.length < 2) return false;
    var start = rangeDateOf(startVal, false);
    var end = rangeDateOf(endVal, true);
    if (!start || !end) return false;
    if (end.getTime() < start.getTime()) return false;
    // 组件实例提交（Vue 2 走 emitInput，会按 value-format 转换；Vue 3 走 v-model）—— 经页面主环境桥接
    var committed = bridgeDateCommit(inputs[0], start, end);
    await sleep(160);
    // 没有组件实例可提交：不往 input 里硬塞文字（那只是「看起来填了」，表单收不到），如实报告失败
    if (!committed) return false;
    var a0 = String(inputs[0].value || '').trim();
    var b0 = String(inputs[1].value || '').trim();
    return !!a0 && !!b0 && dateValueMatches(a0, formatDateYmd(start)) && dateValueMatches(b0, formatDateYmd(end));
  }

  // —————— v1.5.16：Moka 的「年 + 月」下拉对（毕业时间 / 就读时间 / 起止时间）——————
  // 它们不是日历，是一堆 sd-Dropdown 自绘下拉，placeholder 是「年」「月」；
  // 一个字段块里可能有 4 个（起止）或 2 个（单个月）。
  var YM_SECTION_MAP = [
    { re: /教育背景/, listKey: 'eduList', startKey: 'eduStart', endKey: 'eduEnd' },
    { re: /实习经历/, listKey: 'internList', startKey: 'internStart', endKey: 'internEnd' },
    { re: /工作经历/, listKey: 'workList', startKey: 'startDate', endKey: 'workEnd' },
    { re: /项目经验|项目经历/, listKey: 'projectList', startKey: 'projectStart', endKey: 'projectEnd' },
    { re: /获奖经历/, listKey: 'awardList', startKey: 'awardDate', endKey: '', startField: 'date' }
  ];

  function ymSectionOf(blockEl) {
    var head = String((blockEl && blockEl.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 8);
    for (var i = 0; i < YM_SECTION_MAP.length; i++) {
      if (YM_SECTION_MAP[i].re.test(head)) return YM_SECTION_MAP[i];
    }
    return null;
  }

  var ymPartial = [];
  // 每轮填写内已处理过的字段块 / 联动下拉（主循环跑两遍，第二遍不能再重复计数）
  var runDone = null;
  function resetRunDone() {
    runDone = typeof WeakSet === 'function' ? { ym: new WeakSet(), chain: new WeakSet() } : null;
  }

  async function fillYearMonthPairs(profile, filledKeys) {
    var filled = 0;
    var blocks = Array.prototype.slice.call(document.querySelectorAll('[class*="apply-block"]'));
    for (var bi = 0; bi < blocks.length; bi++) {
      var blockEl = blocks[bi];
      var sec = ymSectionOf(blockEl);
      if (!sec) continue;
      var groups = blockEl.querySelectorAll('[class*="apply-fields"]');
      for (var gi = 0; gi < groups.length; gi++) {
        var group = groups[gi];
        var fields = group.querySelectorAll('[class*="apply-field"]');
        for (var fi = 0; fi < fields.length; fi++) {
          var field = fields[fi];
          if (runDone && runDone.ym.has(field)) continue;
          var title = String((field.querySelector('[class*="title-"]') || {}).textContent || '').replace(/\s+/g, ' ').trim();
          if (!/时间|起止/.test(title)) continue;
          var yms = Array.prototype.filter.call(field.querySelectorAll('input'), function (i) {
            var ph = String(i.getAttribute('placeholder') || '');
            return ph === '年' || ph === '月';
          });
          if (yms.length < 2) continue;
          var list = M.listFor(profile, sec.listKey);
          var item = list[gi] || null;
          var sf = sec.startField || 'start';
          var start = item && item[sf] ? String(item[sf]) : (gi === 0 ? (M.profileValue(profile, sec.startKey) || '') : '');
          var end = sec.endKey ? (item && item.end ? String(item.end) : (gi === 0 ? (M.profileValue(profile, sec.endKey) || '') : '')) : '';
          if (!start) continue;
          var sp = parseDateParts(start);
          var ep = end && end !== '至今' ? parseDateParts(end) : null;
          if (!sp) continue;
          var wants;
          if (yms.length >= 4) {
            wants = [sp.y, String(parseInt(sp.m, 10)), ep ? ep.y : '', ep ? String(parseInt(ep.m, 10)) : ''];
          } else {
            wants = [sp.y, String(parseInt(sp.m, 10))];
          }
          var ok = 0;
          var need = 0;
          var hostsYm = [];
          for (var wi = 0; wi < wants.length && wi < yms.length; wi++) {
            var host = findCustomSelectHost(yms[wi]);
            hostsYm[wi] = host;
            if (!wants[wi]) continue;
            need += 1;
            if (!host) continue;
            if (customSelectLooksFilled(host)) { ok += 1; continue; }
            try {
              if (await fillCustomSelect(host, wants[wi], sec.startKey)) ok += 1;
            } catch (_) { /* ignore */ }
          }
          // 只有年、月都落地才算填上（半截日期在「未填」清单里露出来，不能当成功）
          if (ok && ok === need) {
            if (runDone) runDone.ym.add(field);
            filled += 1;
            var ymText = function (a, b) {
              return function () {
                var y = a ? customSelectText(a) : '';
                var m = b ? customSelectText(b) : '';
                return y && m ? String(y).replace(/\D/g, '') + '-' + String(m).replace(/\D/g, '') : '';
              };
            };
            if (filledKeys.indexOf(sec.startKey) === -1) filledKeys.push(sec.startKey);
            recordFill(hostsYm[0], sec.startKey, start, 'date', ymText(hostsYm[0], hostsYm[1]));
            if (sec.endKey && ep && yms.length >= 4) {
              if (filledKeys.indexOf(sec.endKey) === -1) filledKeys.push(sec.endKey);
              recordFill(hostsYm[2], sec.endKey, end, 'date', ymText(hostsYm[2], hostsYm[3]));
              fillRecords[fillRecords.length - 1].noCount = true;
            }
          } else if (ok) {
            ymPartial.push(sec.startKey);
          }
        }
      }
    }
    return filled;
  }

  // —————— v1.5.24：layui laydate（国内老网申很常见）——————
  // laydate 只是普通 input + 自绘面板，值就存在 input.value 里（表单提交读的也是它）。
  // 打开一次面板看类型（日期 / 年月 / 年 / 范围），按它的格式直接写：比逐格点击快且准（之前每个 2~3 秒）。
  function isLaydateInput(el) {
    return !!(el && el.hasAttribute && el.hasAttribute('lay-key'));
  }

  async function laydateKind(el) {
    var key = el.getAttribute('lay-key');
    try { el.focus(); } catch (_) { /* ignore */ }
    simulateClick(el);
    var panel = null;
    for (var w = 0; w < 10 && !panel; w++) {
      await sleep(60);
      var p = document.getElementById('layui-laydate' + key);
      if (p && isVisibleEl(p)) panel = p;
    }
    if (!panel) return null;
    var kind = {
      range: /layui-laydate-range/.test(String(panel.className || '')),
      type: panel.querySelector('.laydate-year-list') ? 'year'
        : (panel.querySelector('.laydate-month-list') ? 'month' : 'date'),
      time: !!panel.querySelector('.laydate-time-list')
    };
    // 点面板外关闭（laydate 监听 document 的 mousedown）
    try {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } catch (_) { /* ignore */ }
    try { el.blur(); } catch (_) { /* ignore */ }
    return kind;
  }

  /** laydate 的写法：placeholder 写明格式就照它，否则用 laydate 默认（yyyy-MM-dd / yyyy-MM / yyyy） */
  function laydateText(el, kind, value) {
    var mo = D && D.parseModel ? D.parseModel(value) : null;
    if (!mo || !mo.y) return '';
    var fmt = D.detectFormat ? D.detectFormat(el.getAttribute('placeholder') || '') : null;
    if (kind.type === 'year') return String(mo.y);
    if (!mo.m) return '';
    if (fmt && (kind.type === 'date' ? fmt.hasDay : !fmt.hasDay)) return D.formatModel(mo, fmt);
    return kind.type === 'month' ? D.toYm(mo) : D.toYmd(mo);
  }

  /** 写 laydate：单个日期给 startVal；范围控件给 startVal + endVal（没有终点 / 类型对不上 → false） */
  async function fillLaydate(el, startVal, endVal) {
    var kind = await laydateKind(el);
    if (!kind) return false;
    if (kind.range !== !!endVal) return false;
    var a = laydateText(el, kind, startVal);
    if (!a) return false;
    var text = a;
    if (kind.range) {
      var b = laydateText(el, kind, endVal);
      if (!b) return false;
      var sepM = String(el.getAttribute('placeholder') || '').match(/\s*(~|至|到|—|-)\s*/);
      var sep = sepM && sepM[1] !== '-' ? ' ' + sepM[1] + ' ' : ' - ';
      text = a + sep + b;
    }
    rawSetValue(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    return String(el.value || '') === text;
  }

  // —————— v1.5.24：一个输入框装起止两个日期（「起止时间：2019-09 - 2023-06」）——————
  var STRONG_RANGE_LABEL_RE = /起止|起讫|时间段|期间|时间范围|起始.{0,4}(结束|截止)|开始.{0,4}(结束|截止)/;
  var WEAK_RANGE_LABEL_RE = /在校时间|就读时间|在读时间|在职时间|任职时间|实习时间|项目时间|学习时间|^工作时间$|经历时间/;

  function looksLikeSingleInputRange(el) {
    if (!el || el.tagName.toLowerCase() !== 'input') return false;
    var t = String(el.type || 'text').toLowerCase();
    if (t !== 'text' && t !== 'search' && t !== '') return false;
    if (el.closest && el.closest(RANGE_EDITOR_SEL + ', .ant-calendar-picker')) return false;
    var label = String(getLabelText(el) || '').replace(/\s+/g, '');
    if (/参加工作|首次工作/.test(label)) return false;
    var ph = String(el.getAttribute('placeholder') || '');
    if (STRONG_RANGE_LABEL_RE.test(label)) return true;
    // 只凭 placeholder 的「A - B」不够（「例：10k - 15k」是薪资范围）：标签或 placeholder 得像日期
    var dateish = /时间|日期|年月|年份|date|time|period/i.test(label) ||
      /yyyy|年|月|日期|时间|开始|结束|\d{4}[-/.]\d{1,2}/i.test(ph);
    if (dateish && /\S\s+(~|至|到|-)\s+\S|^\s*-\s*$|开始.{0,6}(~|至|到|-).{0,6}结束/.test(ph)) return true;
    return isLaydateInput(el) && WEAK_RANGE_LABEL_RE.test(label);
  }

  function rangeSectionFor(el) {
    var ctx = detectSectionContext(el);
    if (!ctx || !RANGE_SECTION_MAP[ctx]) {
      var label = String(getLabelText(el) || '');
      if (/实习/.test(label)) ctx = 'intern';
      else if (/在校|就读|在读|学习|教育|入学/.test(label)) ctx = 'edu';
      else if (/项目/.test(label)) ctx = 'project';
      else if (/在职|任职|工作/.test(label)) ctx = 'work';
    }
    return RANGE_SECTION_MAP[ctx] ? ctx : '';
  }

  /** 第 index 段的开始 / 结束（实习分区回落到 workList；列表空时用扁平主条目） */
  function rangeValuesFor(profile, ctxKey, index) {
    var map = RANGE_SECTION_MAP[ctxKey];
    var list = M.listFor(profile, map.listKey);
    var item = list[index] || null;
    var start = item && item.start ? String(item.start).trim() : '';
    var end = item && item.end ? String(item.end).trim() : '';
    if (!start && index === 0) start = M.profileValue(profile, map.startKey) || '';
    if (!end && index === 0) end = M.profileValue(profile, map.endKey) || '';
    return { map: map, start: start, end: end };
  }

  /**
   * 单输入框范围：laydate 按面板类型写；普通可编辑输入框按 placeholder 的格式与分隔符写。
   * @returns {Promise<boolean|null>} null = 不是 / 写不了这种控件（交还主循环按普通字段处理）
   */
  async function fillSingleInputRange(el, profile, seen) {
    var ctxKey = rangeSectionFor(el);
    if (!ctxKey) return null;
    var idx = seen[ctxKey] || 0;
    var rv = rangeValuesFor(profile, ctxKey, idx);
    if (!rv.start || !rv.end) return null;
    var endOpen = isCurrentJobValue(rv.end);
    var ok = false;
    if (isLaydateInput(el)) {
      if (endOpen) return null;
      var kind = await laydateKind(el);
      if (!kind || !kind.range) return null;
      ok = await fillLaydate(el, rv.start, rv.end);
    } else if (!el.readOnly && !el.disabled) {
      var ph = String(el.getAttribute('placeholder') || '');
      var fmt = D && D.detectFormat ? D.detectFormat(ph) : null;
      var side = function (v) {
        var mo = D.parseModel(v);
        if (!mo || !mo.y || !mo.m) return '';
        return fmt ? D.formatModel(mo, fmt) : (mo.d ? D.toYmd(mo) : D.toYm(mo));
      };
      var a = side(rv.start);
      var b = endOpen ? '至今' : side(rv.end);
      if (!a || !b) return null;
      var sepM = ph.match(/\S\s*(~|至|到|—)\s*\S/);
      var sep = sepM ? ' ' + sepM[1] + ' ' : ' - ';
      ok = await writeAndVerify(el, a + sep + b);
    } else {
      return null;
    }
    seen[ctxKey] = idx + 1;
    if (ok) return { ok: true, map: rv.map, start: rv.start, end: rv.end };
    return false;
  }

  /** 页面上的范围日期控件：按分区/段序取 eduList[i].start/end 等 */
  async function fillRangeEditors(profile, handled, filledKeys) {
    var rangeSeen = {};
    var editors = Array.prototype.filter.call(document.querySelectorAll(RANGE_EDITOR_SEL), isVisibleEl);
    // antd v3 的 RangePicker 没有专门的范围类名：认 .ant-calendar-range-picker-input 所在的 .ant-calendar-picker
    Array.prototype.forEach.call(document.querySelectorAll('.ant-calendar-range-picker-input'), function (inp) {
      var box = inp.closest('.ant-calendar-picker');
      if (box && editors.indexOf(box) === -1 && isVisibleEl(box)) editors.push(box);
    });
    editors.sort(function (a, b) { return a === b ? 0 : ((a.compareDocumentPosition(b) & 4) ? -1 : 1); });
    var filled = 0;
    for (var i = 0; i < editors.length; i++) {
      var ed = editors[i];
      var inputs = ed.querySelectorAll('input');
      if (inputs.length < 2) continue;
      var alreadyFilled = !!String(inputs[0].value || '').trim() && !!String(inputs[1].value || '').trim();
      if (handled) {
        for (var h = 0; h < inputs.length; h++) handled.add(inputs[h]);
      }
      if (alreadyFilled) continue;
      var ctx = rangeContext(ed) || rangeContextLoose(ed);
      if (!ctx) continue;
      // 没有段序号可读（无 id、无「教育经历-2」标题）时，按同分区里第几个范围控件算
      var seenN = rangeSeen[ctx.rule.key] || 0;
      rangeSeen[ctx.rule.key] = seenN + 1;
      if (!ctx.explicit) ctx.index = seenN;
      var map = RANGE_SECTION_MAP[ctx.rule.key];
      // 实习分区常常只有 workList（实习写在 workList 里）：listFor 会回落到 workList
      var list = M.listFor(profile, map.listKey);
      var item = list[ctx.index] || null;
      var start = item && item.start ? String(item.start).trim() : '';
      var end = item && item.end ? String(item.end).trim() : '';
      if (!start && ctx.index === 0) start = M.profileValue(profile, map.startKey) || '';
      if (!end && ctx.index === 0) end = M.profileValue(profile, map.endKey) || '';
      if (!start || !end) continue;
      if (!(await fillRangeEditor(ed, start, end))) continue;
      filled += 1;
      [map.startKey, map.endKey].forEach(function (k) {
        if (filledKeys.indexOf(k) === -1) filledKeys.push(k);
      });
      recordFill(inputs[0], map.startKey, start, 'date');
      if (!isCurrentJobValue(end)) {
        recordFill(inputs[1], map.endKey, end, 'date');
        fillRecords[fillRecords.length - 1].noCount = true;   // 一个范围控件只计一次「已填」
      }
    }
    return filled;
  }

  async function expandAddSections(profile) {
    var report = [];
    var stall = 0;
    // 每轮每个分区只点一次（多段档案靠多轮补齐）；连续两轮没有任何分区涨行就收手，
    // 避免按钮确实点不动时把时间全耗在等待上
    for (var round = 0; round < 6 && stall < 2; round++) {
      var cands = addButtonCandidates();
      var jobs = [];
      var seen = {};
      for (var i = 0; i < cands.length; i++) {
        var cand = cands[i];
        if (!cand.el.isConnected) continue;
        var rule = addButtonSection(cand.text, cand.el);
        if (!rule || seen[rule.key]) continue;
        var want = desiredRowsFor(profile, rule);
        if (!want) continue;
        var have = countSectionRows(rule);
        if (have >= want) continue;
        seen[rule.key] = 1;
        simulateClick(cand.el);
        jobs.push({ rule: rule, before: have });
      }
      if (!jobs.length) break;
      // 行是异步渲染的（BYD 前台 ~0.25s，后台标签页要 3s+）：一轮只点一次，统一等落地，
      // 否则会在渲染完成前连点，既慢又会多出空行
      var deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        await sleep(200);
        var settled = true;
        for (var j = 0; j < jobs.length; j++) {
          if (countSectionRows(jobs[j].rule) <= jobs[j].before) { settled = false; break; }
        }
        if (settled) break;
      }
      var moved = 0;
      for (var r = 0; r < jobs.length; r++) {
        var after = countSectionRows(jobs[r].rule);
        if (after > jobs[r].before) moved += 1;
        report.push({ section: jobs[r].rule.key, clicks: 1, before: jobs[r].before, after: after });
      }
      stall = moved ? 0 : stall + 1;
    }
    return report;
  }

  function matchKeyForElement(el) {
    return M.matchFieldKey(collectHints(el), {
      autocomplete: el.getAttribute('autocomplete') || '',
      context: detectSectionContext(el)
    });
  }

  /**
   * v1.5.8：语言技能分区里的泛化标签（「成绩」= 语言考试成绩，不是高考/绩点）。
   * 只在区块标题是「语言技能 / 外语」时兜底，避免把通用「成绩」映射到 certScore。
   */
  function sectionFallbackKey(el) {
    if (!el || !el.closest) return null;
    var sec = el.closest('.resume-section');
    if (!sec) return null;
    var head = sec.querySelector('.section-title .title') || sec.querySelector('.section-title');
    var title = String((head && head.textContent) || '').replace(/\s+/g, ' ').trim();
    if (!/语言|外语/.test(title)) return null;
    var label = String(getLabelText(el) || '').replace(/\s+/g, '');
    if (/成绩|分数|得分/.test(label)) return 'englishScore';
    if (/获得时间|取得时间|获取时间|考试时间|发证时间/.test(label)) return 'englishDate';
    if (/等级|级别/.test(label)) return 'englishLevel';
    return null;
  }

  function hintSnippet(el) {
    var raw = [
      getLabelText(el),
      el.getAttribute('placeholder'),
      el.name,
      el.id
    ].filter(Boolean).join(' | ');
    raw = String(raw || '').replace(/\s+/g, ' ').trim();
    if (raw.length > 80) raw = raw.slice(0, 77) + '…';
    return raw || (el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : ''));
  }

  /**
   * v1.3.1: 搜索框（“请输入关键字查找”类）不是简历字段，填进去只会污染命中结果。
   */
  function isSearchBox(el) {
    var ph = String((el.getAttribute && el.getAttribute('placeholder')) || '');
    var aria = String((el.getAttribute && el.getAttribute('aria-label')) || '');
    var name = String(el.name || '');
    return /搜索|查找|关键字|检索|search/i.test(ph) ||
      /搜索|查找|检索|search/i.test(aria) ||
      /search|keyword/i.test(name);
  }

  // 自定义下拉内部的搜索输入框：由 fillCustomSelect 负责「输入 + 选选项」，主循环不能再往里写
  // 注意：Moka 的 sd-Select 不要放进来 —— 它的 input 就是字段本身，
  // 放进这里会让 iterFillableFields 直接过滤掉整个字段（既填不上、也不出现在「未填」里）
  var INNER_SELECT_SEARCH_SEL =
    '.ant-select, .el-select, .ant-cascader-picker, .cascader-plugins-wrap, ' +
    '.dictionary-selector, .phoenix-select';

  function isSkippable(el) {
    var t = (el.type || '').toLowerCase();
    if (el.tagName && el.tagName.toLowerCase() === 'input' && el.closest && el.closest(INNER_SELECT_SEARCH_SEL)) {
      return true;
    }
    return (
      t === 'hidden' ||
      t === 'submit' ||
      t === 'button' ||
      t === 'image' ||
      t === 'reset' ||
      t === 'file' ||
      t === 'password' ||
      el.disabled ||
      isSearchBox(el)
    );
  }

  /**
   * Element 的 input-number / date-editor 是包装组件：直接写 input.value 不会更新 v-model，
   * 页面一重渲染值就被打回去。这里直接走组件实例的 input 事件（实测有效）。
   */
  // —————— v1.5.24：页面主环境桥接（content/page-bridge.js，manifest world: MAIN）——————
  // 内容脚本在隔离环境里读不到页面挂在 DOM 上的 React fiber / Vue 实例；组件提交统一交给桥接脚本。
  // 同步协议：在目标元素上派发 CustomEvent，桥接在捕获阶段处理完把结果写进 data-ra-bridge-out。
  var BRIDGE_EVT = 'resume-autofill-bridge';
  var BRIDGE_OUT = 'data-ra-bridge-out';

  function bridgeCall(el, op, args) {
    if (!el || typeof el.dispatchEvent !== 'function') return null;
    try {
      el.removeAttribute(BRIDGE_OUT);
      el.dispatchEvent(new CustomEvent(BRIDGE_EVT, {
        bubbles: true, composed: true, detail: JSON.stringify({ op: op, args: args || {} })
      }));
      var raw = el.getAttribute(BRIDGE_OUT);
      if (!raw) return null;     // 桥接没装（老浏览器 / 测试环境）→ 调用方走点击面板的老路
      el.removeAttribute(BRIDGE_OUT);
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function dateArr(d) { return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; }

  /** 把日期（范围给 e）交给组件自己的提交入口：antd 3/4/5、Element UI、Element Plus、ant-design-vue */
  function bridgeDateCommit(el, s, e) {
    if (!s) return false;
    var r = bridgeCall(el, 'dateCommit', { s: dateArr(s), e: e ? dateArr(e) : null });
    return !!(r && r.ok);
  }

  /**
   * Element 的 input-number / date-editor 是包装组件：直接写 input.value 不会更新 v-model，
   * 页面一重渲染值就被打回去。这里交给组件实例（Vue 2 的 emitInput / Vue 3 的 onUpdate:modelValue）。
   */
  function commitFrameworkWidget(el, value) {
    if (!el || !el.closest) return false;
    if (el.closest('.el-input-number')) {
      var raw = String(value == null ? '' : value).trim();
      var n = Number(raw.replace(/[^\d.\-]/g, ''));
      if (raw && isFinite(n)) {
        var rn = bridgeCall(el, 'numberCommit', { n: n });
        if (rn && rn.ok) return true;
      }
    }
    if (el.closest('.el-date-editor') && !el.closest('.el-range-editor')) {
      var parts = parseDateParts(value);
      if (!parts) return false;
      var d = new Date(parseInt(parts.y, 10), parseInt(parts.m, 10) - 1, parts.d ? parseInt(parts.d, 10) : 1);
      return bridgeDateCommit(el, d, null);
    }
    return false;
  }

  function setNativeValue(el, value) {
    if (el.disabled || el.readOnly) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      var opts = Array.from(el.options).map(function (o) {
        return { value: o.value, text: o.text };
      });
      var matched = M.matchSelectOption(opts, value);
      if (!matched) return false;
      el.value = matched.value;
      // 同 value 的选项有多个 / value 为空时，el.value 赋值可能落不到目标项：按下标再落一次
      if (el.value !== matched.value || (el.options[el.selectedIndex] || {}).text !== matched.text) {
        for (var si = 0; si < el.options.length; si++) {
          if (el.options[si].value === matched.value && el.options[si].text === matched.text) { el.selectedIndex = si; break; }
        }
      }
      if (el.value !== matched.value) return false;
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      return false;
    } else {
      var proto =
        tag === 'textarea'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      var setter = desc && desc.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  // —————— v1.5.23：写入必须回读确认（杜绝「点了 / 写了，但页面上没有」）——————

  /** 等框架把这次事件处理完（React 18 / Vue 的重渲染都排在微任务里） */
  function settle() {
    return Promise.resolve().then(function () { return null; }).then(function () { return null; });
  }

  /**
   * 回读值与期望是否一致：允许格式化差异（空格 / 分隔符 / 大小写 / 手机号掩码 / 日期写法），
   * 不允许内容差异（被截断、被清空、被改成别的值）。
   */
  function writtenValueMatches(actual, want) {
    var a = String(actual == null ? '' : actual).trim();
    var w = String(want == null ? '' : want).trim();
    if (a === w) return true;
    if (!a || !w) return false;
    var squash = function (t) { return t.replace(/[\s\u00a0,，\-_/.:：()（）]/g, '').toLowerCase(); };
    if (squash(a) === squash(w)) return true;
    // 数字被格式化：15000 → 15,000.00 / ¥15,000
    if (/^[\s\d,.¥$€+-]+$/.test(w) && /\d/.test(w)) {
      var nA = parseFloat(a.replace(/[^\d.\-]/g, ''));
      var nW = parseFloat(w.replace(/[^\d.\-]/g, ''));
      if (isFinite(nA) && isFinite(nW) && nA === nW) return true;
    }
    // 掩码 / 区号：「+86 138 0013 8000」包含「13800138000」的全部数字
    var da = a.replace(/\D/g, '');
    var dw = w.replace(/\D/g, '');
    if (dw.length >= 6 && da.length >= dw.length && da.slice(da.length - dw.length) === dw &&
        squash(a).replace(/\d/g, '').replace(/^\+/, '') === squash(w).replace(/\d/g, '')) return true;
    if (D && D.parseModel) {
      var mw = D.parseModel(w);
      if (mw && mw.y && mw.m) {
        var lv = D.matchLevel(a, mw).level;
        return lv === 'exact' || lv === 'day-approx' || lv === 'month-only';
      }
    }
    return false;
  }

  function rawSetValue(el, v) {
    var proto = el.tagName.toLowerCase() === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, v);
    else el.value = v;
  }

  /** 重试 1：浏览器自己生成的输入（execCommand insertText）——受控组件最认这条路 */
  function retryInsertText(el, value) {
    if (typeof document.execCommand !== 'function') return false;
    try {
      el.focus();
      // execCommand 写进的是「当前焦点」：焦点没落到目标上（被遮挡 / 不可聚焦）就绝不能执行，否则会写进别的字段
      if (document.activeElement !== el) return false;
      if (typeof el.select === 'function') el.select();
      var ok = document.execCommand('insertText', false, String(value));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return !!ok;
    } catch (_) { return false; }
  }

  /** 重试 2：逐字键入（监听 keydown / keyup / beforeinput 才更新的组件） */
  function typeLikeUser(el, value) {
    try {
      el.focus();
      try { el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); } catch (_) { /* ignore */ }
      rawSetValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      var text = String(value);
      var acc = '';
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
        try { el.dispatchEvent(new InputEvent('beforeinput', { data: ch, inputType: 'insertText', bubbles: true, cancelable: true })); } catch (_) { /* ignore */ }
        acc += ch;
        rawSetValue(el, acc);
        try {
          el.dispatchEvent(new InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true }));
        } catch (_) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      try { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); } catch (_) { /* ignore */ }
      return true;
    } catch (_) { return false; }
  }

  function restoreValue(el, before) {
    try {
      rawSetValue(el, before);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) { /* ignore */ }
  }

  /**
   * 值超过 maxlength：长文本（自我评价 / 工作描述）在句末截断；短值（证件号 / 电话 / 姓名）返回 ''（跳过）。
   */
  function fitToMaxLength(value, maxLen) {
    var v = String(value == null ? '' : value);
    if (!maxLen || v.length <= maxLen) return v;
    if (v.length <= 40 || maxLen < 20) return '';
    var head = v.slice(0, maxLen);
    var cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'),
      head.lastIndexOf('；'), head.lastIndexOf('\n'), head.lastIndexOf('. '), head.lastIndexOf('; '));
    if (cut >= maxLen * 0.5) return head.slice(0, cut + 1).trim();
    return head;
  }

  /**
   * 写入 + 回读确认。写不进去依次重试 execCommand / 逐字键入；
   * 最后仍对不上（被清空、被截断、被改成别的）→ 还原原值并返回 false，让字段出现在「未填」清单里。
   */
  async function writeAndVerify(el, value) {
    var tag = el.tagName.toLowerCase();
    var before = String(el.value || '');
    if (tag === 'select') {
      if (!setNativeValue(el, value)) return false;
      var want = el.value;
      await settle();
      return el.value === want && el.selectedIndex >= 0;
    }
    if (!setNativeValue(el, value)) return false;
    await settle();
    if (writtenValueMatches(el.value, value)) return true;
    if (retryInsertText(el, value)) {
      await settle();
      if (writtenValueMatches(el.value, value)) return true;
    }
    if (String(value).length <= 120 && typeLikeUser(el, value)) {
      await settle();
      if (writtenValueMatches(el.value, value)) return true;
    }
    if (String(el.value || '') !== before) restoreValue(el, before);
    return false;
  }

  /**
   * 日期写进普通输入框前按控件要求的格式转换：
   *   <input type=date|month|datetime-local> → 规范写法（否则浏览器直接清空）
   *   placeholder / data-format 写明格式（YYYY/MM、yyyy年mm月、MM/DD/YYYY、例：2020-09）→ 按格式写
   * 返回 null 表示不是日期场景（原样写）；返回 '' 表示是日期框但这个值写不进去（跳过）。
   */
  function dateValueForInput(el, value) {
    if (!D || !D.parseModel || !el || el.tagName.toLowerCase() !== 'input') return null;
    var type = String(el.type || '').toLowerCase();
    var mo = D.parseModel(value);
    if (type === 'date' || type === 'month' || type === 'datetime-local') {
      return D.nativeInputValue ? D.nativeInputValue(type, mo) : '';
    }
    if (!mo || !mo.y || !mo.m || !D.detectFormat) return null;
    var fmt = D.detectFormat(el.getAttribute('data-format') || el.getAttribute('format') || '') ||
      D.detectFormat(el.getAttribute('placeholder') || '');
    if (!fmt) return null;
    return D.formatModel(mo, fmt) || null;
  }

  function highlight(el) {
    el.style.outline = '2px solid #22c55e';
    setTimeout(function () {
      el.style.outline = '';
    }, 2000);
  }

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

  // ————— v1.3.1：readonly 弹层选择器 + 无名 radio 组 —————

  /** 肯定不能点的选项文案（防止误触提交类按钮） */
  var PICKER_BLOCK_RE = /^(提交|保存|取消|关闭|确定删除|删除|清除|重置|退出|submit|save|cancel|close|reset|delete)$/i;

  /** 允许自动勾选的单选组（语义容易误判的组不在此列） */
  var RADIO_SAFE_KEYS = {
    gender: 1, maritalStatus: 1, politicalStatus: 1, ethnicity: 1,
    hasRelativeAtCompany: 1, acceptAdjustment: 1, isFreshGraduate: 1,
    hasMilitaryService: 1, isVeteran: 1, willingToRelocate: 1,
    hasChronicIllness: 1, hasCriminalRecord: 1, hasStudyAbroad: 1
  };


  /** 「至今 / 现在 / present / 在职」这类不是日期，代表“当前仍在职” */
  function isCurrentJobValue(v) {
    return /^(至今|现在|今|目前|在职|实习中|在岗|present|now|current|till now|to date)$/i.test(String(v || '').trim());
  }


  /** 日期类输入框（type=date/month、placeholder 带年/月/日、只读 picker）不该写入“至今” */
  function looksLikeDateInput(el) {
    if (!el) return false;
    var type = String(el.type || '').toLowerCase();
    if (type === 'date' || type === 'month' || type === 'datetime-local') return true;
    if (el.readOnly) return true;
    var ph = String(el.getAttribute && el.getAttribute('placeholder') || '');
    if (/年|月|日|yyyy|yyyy-mm|mm\/dd|日期|date/i.test(ph)) return true;
    if (isReadonlyPicker(el)) return true;
    return false;
  }

  /** 排名 / 绩点在区间下拉里的候选写法（原始值优先） */
  function valueCandidates(key, value) {
    var out = [String(value == null ? '' : value)];
    try {
      if (M.rankValueCandidates && (key === 'majorRank' || key === 'classRank' || key === 'gpaRank')) {
        out = out.concat(M.rankValueCandidates(value));
      }
      if (M.gpaValueCandidates && key === 'gpa') {
        out = out.concat(M.gpaValueCandidates(value));
      }
    } catch (e) { /* ignore */ }
    var seen = {};
    return out.filter(function (v) {
      var k = String(v);
      if (!k || seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  /**
   * 在字段附近找「至今 / 在职 / 目前」开关并勾上。
   * 找不到就返回 false（调用方会跳过，而不是把“至今”写进日期框）。
   */
  /** 开关当前是否处于「开」：原生 checkbox / aria-checked / 各家组件库的选中类名 */
  function toggleIsOn(b, cb) {
    if (cb) return !!cb.checked;
    var aria = b.getAttribute && b.getAttribute('aria-checked');
    if (aria != null) return aria === 'true';
    var cls = String(b.className || '');
    if (/(^|\s)(is-checked|checked|ant-switch-checked|ant-checkbox-checked|el-switch--checked)(\s|$)/.test(cls)) return true;
    return !!(b.querySelector && b.querySelector('.is-checked, .ant-checkbox-checked, .ant-switch-checked'));
  }

  /**
   * 在字段附近找「至今 / 在职 / 目前」开关并勾上。
   * v1.5.23：点完必须回读确认已勾上（之前点了就算成功，组件没响应时「至今」实际没生效）；
   * 合成点击不生效时再用原生 click（antd v3 / 部分 Vue 组件只认原生 click）。
   * 找不到或勾不上就返回 false（调用方会跳过，而不是把“至今”写进日期框）。
   */
  async function clickCurrentJobToggle(el) {
    if (!el || !el.parentElement) return false;
    var node = el;
    for (var up = 0; up < 4 && node && node.parentElement; up++) {
      node = node.parentElement;
      var boxes = node.querySelectorAll('input[type="checkbox"], [role="switch"], [role="checkbox"], .ant-checkbox, .ant-switch, .el-checkbox, .el-switch');
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        var cbIn = b.tagName.toLowerCase() === 'input' ? b : null;
        // 原生 checkbox 常被样式藏起来（opacity:0），看它的包装层是否可见
        if (!isVisibleEl(b) && !(cbIn && cbIn.closest && isVisibleEl(cbIn.closest('label') || cbIn.parentElement))) continue;
        var txt = String(b.parentElement ? b.parentElement.textContent : b.textContent || '').replace(/\s+/g, '');
        var near = txt || String(b.getAttribute('aria-label') || '') + String(b.title || '');
        // 控件自身没有文案时，看它所在 label/兄弟文本
        if (!/至今|在职|目前|现在|present|current|now/i.test(near)) {
          var row = b.closest('label, .ant-checkbox-wrapper, .el-checkbox, li, div');
          var rowTxt = row ? String(row.textContent || '').replace(/\s+/g, '') : '';
          if (!/至今|在职|目前|现在|present|current|now/i.test(rowTxt)) continue;
        }
        var cb = cbIn || b.querySelector('input[type="checkbox"]');
        if (toggleIsOn(b, cb)) return true;
        simulateClick(cb || b);
        await settle();
        await sleep(60);
        if (toggleIsOn(b, cb)) return true;
        // 合成事件没被组件接住：原生 click（先点包装 label，再点控件本身）
        var wrap = (cb || b).closest ? (cb || b).closest('label, .ant-checkbox-wrapper, .el-checkbox') : null;
        try { (wrap || cb || b).click(); } catch (_) { /* ignore */ }
        await settle();
        await sleep(60);
        return toggleIsOn(b, cb);
      }
    }
    return false;
  }

  function isReadonlyPicker(el) {
    if (!el || el.disabled || !el.readOnly) return false;
    var t = (el.type || 'text').toLowerCase();
    return t === 'text' || t === 'search' || t === 'tel' || t === 'number';
  }

  /** antd v3 的日期控件（.ant-calendar-picker + .ant-calendar-picker-container 面板） */
  function isAntdV3Picker(el) {
    try { return !!(el && el.closest && el.closest('.ant-calendar-picker')); } catch (_) { return false; }
  }

  /** 当前可见的 antd v3 日历面板（返回 .ant-calendar 根节点） */
  function antdV3Panel() {
    var list = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll('.ant-calendar-picker-container'), function (n) {
        if (!isVisibleEl(n)) return;
        var cal = n.querySelector('.ant-calendar');
        if (cal) list.push(cal);
      });
    } catch (_) { /* ignore */ }
    return list.length ? list[list.length - 1] : null;
  }

  function simulateClick(el) {
    if (!el) return;
    // SVG 元素没有 el.click()，统一派发事件（北森字典/地区的勾选热区就是 svg）
    try {
      var ptr = null;
      try { ptr = new PointerEvent('pointerdown', { bubbles: true }); } catch (_) { ptr = null; }
      if (ptr) {
        el.dispatchEvent(ptr);
        try { el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); } catch (_) { /* ignore */ }
      }
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } catch (_) {
      try { el.click(); } catch (e) { /* ignore */ }
    }
  }

  // ————— v1.5.0：自定义下拉适配器（Element / Ant / dictionary / listbox）—————

  var CUSTOM_SELECT_HOST =
    '.el-select, .ant-select, .dictionary-selector, .form-select, .phoenix-select, [role="combobox"], ' +
    '[class*="sd-Select-container"]';  // Moka（app.mokahr.com）的自绘下拉
  var DROPDOWN_OPTION_SEL =
    '[role="option"], .el-select-dropdown__item, .el-option, .ant-select-item-option, ' +
    '.ant-select-item, .ant-select-dropdown-menu-item, .dictionary-option, .option-item, .select-option, ' +
    'li.el-select-dropdown__item, ' +
    '[class*="sd-Menu-content-item"]';

  /** 「广东省-阳江市-江城区」→ ['广东省', '广东省阳江市', '广东省阳江市江城区'] */
  function regionPrefixVariants(value) {
    var v = String(value || '').replace(/[-–—\s]+/g, '');
    var out = [];
    var re = /(省|自治区|特别行政区|市|自治州|区|县|旗)/g;
    var m;
    while ((m = re.exec(v))) {
      var seg = v.slice(0, m.index + m[0].length);
      if (seg && seg.length >= 2) out.push(seg);
    }
    return out;
  }

  /** 关掉已经展开的下拉，避免它的选项污染下一个字段的匹配 */
  function closeOpenDropdowns() {
    var open = Array.prototype.filter.call(
      document.querySelectorAll('.el-select-dropdown, .ant-select-dropdown'),
      isVisibleEl
    );
    if (!open.length) return;
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
      }));
    } catch (_) { /* ignore */ }
  }

  /**
   * 宿主自己的下拉节点（Element 把 .el-select-dropdown 挂在 .el-select 里）。
   * 打开瞬间外层可能还在过渡动画里（rect 为 0），但节点已经在，按 style 判断即可，
   * 不用干等它“看得见”——BYD 这类重页面要 1.5~2s，逐字段等就是卡顿的来源。
   */
  /**
   * antd 的弹层 portal 到 body，同页可能同时挂着好几个（上一轮没关干净的），
   * 猜错就会把「+82」「斯威本科技大学」这种别人家的选项点进去。
   * 用 aria-controls / aria-owns 精确找到当前这个下拉自己的那一个。
   */
  function dropdownForHost(host) {
    if (!host || !host.querySelector) return null;
    var input = host.querySelector('input[aria-controls], input[aria-owns], [aria-controls], [aria-owns]');
    if (input) {
      var id = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
      if (id) {
        var byId = document.getElementById(id);
        if (byId) {
          // antd 的 aria 目标是 listbox 空壳（0 尺寸、没有选项），真正的选项在它所属的弹层里
          var box = byId.closest ? byId.closest('.ant-select-dropdown') : null;
          if (box) return box;
          if (byId.querySelector('.ant-select-item-option')) return byId;
        }
      }
    }
    var own = host.querySelector('.el-select-dropdown, .ant-select-dropdown');
    return own || null;
  }

  function hostDropdownOptions(host) {
    if (!host || !host.querySelector) return null;
    var dd = dropdownForHost(host);
    if (!dd) return null;
    // 页面里常驻着好几个「隐藏但仍有 DOM」的下拉（antd 不会卸载），
    // 按 aria-controls 找到的那个可能已经过气：屏幕上有高度才算数
    var box = null;
    try { box = dd.getBoundingClientRect(); } catch (_) { box = null; }
    if (box && box.height === 0) dd = null;
    if (!dd) return null;
    var st = null;
    try { st = window.getComputedStyle(dd); } catch (_) { st = null; }
    if (!st || st.display === 'none' || st.visibility === 'hidden') return null;
    var items = dd.querySelectorAll('.el-select-dropdown__item, .el-option, .ant-select-item-option');
    if (!items.length) return null;
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var t = String(items[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push({ el: items[i], text: t, value: t });
    }
    return out.length ? out : null;
  }

  // 日期控件的外层也常带 role="combobox"（Element Plus：aria-haspopup="dialog"），不是下拉框：
  // 当成下拉会先空等 3~4 秒弹层选项，再轮到日期逻辑（v1.5.24 前每个日期框都白耗这几秒）
  var DATE_WIDGET_SEL = '.el-date-editor, .el-range-editor, .ant-picker, .ant-calendar-picker, ' +
    '.ivu-date-picker, .arco-picker, .t-date-picker, .t-date-range-picker, .semi-datepicker, ' +
    '.next-date-picker, .next-range-picker, .phoenix-date-picker, .layui-laydate';

  function findCustomSelectHost(el) {
    if (!el || !el.closest) return null;
    var host = el.closest(CUSTOM_SELECT_HOST);
    if (!host) return null;
    if (el.closest(DATE_WIDGET_SEL) && !isPhoenixHost(host)) return null;
    if (String(host.getAttribute && host.getAttribute('aria-haspopup') || '') === 'dialog') return null;
    // CUSTOM_SELECT_HOST 里的 [role="combobox"] 会直接命中 antd 的 input 本身（快手就是），
    // 那样 host 里既找不到 input 也读不到弹层，等于一个字段都填不动 —— 一律缩放到外层组件
    var tag = String(host.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      var wrap = host.closest(
        '.el-select, .ant-select, .dictionary-selector, .form-select, .phoenix-select, [class*="sd-Select-container"]'
      );
      return wrap || host.parentElement || host;
    }
    return host;
  }

  // 宿主里内嵌的弹层（Element UI 的 .el-select-dropdown 就挂在 .el-select 里面，隐藏时仍有选项文字）
  var INNER_DROPDOWN_SEL = '.el-select-dropdown, .ant-select-dropdown, [role="listbox"], .el-popper, ' +
    '[class*="dropdown"], [class*="Dropdown"], [class*="-popup"], [class*="menu"]';

  /** 宿主「自己显示」的文字：跳过内嵌弹层与隐藏节点（v1.5.24 前把隐藏选项「本科硕士博士」当成了已选值） */
  function hostOwnText(host) {
    if (!host || !document.createTreeWalker) return String((host && host.textContent) || '').replace(/\s+/g, ' ').trim();
    var out = '';
    var walker = document.createTreeWalker(host, 4, null);
    var tn;
    while ((tn = walker.nextNode())) {
      var p = tn.parentElement;
      if (!p) continue;
      var inner = p.closest(INNER_DROPDOWN_SEL);
      if (inner && inner !== host && host.contains(inner)) continue;
      out += tn.nodeValue;
      if (out.length > 200) break;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function customSelectLooksFilled(host) {
    if (!host) return false;
    // antd v3：只认 .ant-select-selection-selected-value，隐藏 input 里的编码值不算
    if (typeof isAntdV3SelectHost === 'function' && isAntdV3SelectHost(host)) {
      return !!antdV3SelectedText(host);
    }
    var txt = '';
    var selected = host.querySelector(
      '.el-select__selected-item:not(.el-select__input-wrapper):not(.is-transparent), .el-input__inner, .ant-select-selection-selected-value, ' +
      '.ant-select-selection-item, .ant-select-selection-search-input, .selected-text, [class*="selected"]'
    );
    if (selected) {
      txt = String(selected.textContent || selected.value || '').replace(/\s+/g, ' ').trim();
    }
    if (!txt) {
      // 只看可见的搜索框；隐藏 input 里常存的是「0/660/411987」这种编码值，不代表已选
      var inps = host.querySelectorAll('input');
      for (var ii = 0; ii < inps.length; ii++) {
        var cand = inps[ii];
        if (/hidden/i.test(String(cand.type || ''))) continue;
        var cv = String(cand.value || '').replace(/\s+/g, ' ').trim();
        if (!cv || /^\d+(\/\d+)+$/.test(cv)) continue;
        txt = cv;
        break;
      }
    }
    if (txt && !/请选择|请输入|请填写|填写|select|choose|--/i.test(txt)) return true;
    // Moka 这类自绘下拉把选中值渲染成 span，input.value 一直是空的
    var hostText = hostOwnText(host);
    // 「必填项未填写」这类校验提示不是选中值，别把它当已填
    if (hostText && hostText.length <= 24 && !/请选择|请输入|可多选|最多|select|choose|--|必填|未填写|不能为空|错误|请上传/i.test(hostText)) return true;
    return false;
  }

  /**
   * 收集「当前可见」的选项。
   * 快手的下拉失焦后不会关（页面上能同时挂着好几个可见弹层），
   * 所以多个弹层并存时只取 DOM 里最后出现的那个 —— 也就是刚点开的这个。
   */
  var DROPDOWN_BOX_SEL = '.ant-select-dropdown, .el-select-dropdown, .el-popper, [role="listbox"], ' +
    '[class*="dropdown"]:not([class*="item"]):not([class*="option"]), ' +
    '[class*="Dropdown"]:not([class*="item"]):not([class*="Item"]):not([class*="option"])';

  function collectOpenDropdownOptions() {
    var nodes = document.querySelectorAll(DROPDOWN_OPTION_SEL);
    var groups = [];
    var lastBox = null;
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!isVisibleEl(n)) continue;
      // 从父节点开始找所属弹层：closest 包含自身，而选项自己的类名（el-select-dropdown__item）就含 dropdown，
      // 之前每个选项各成一组、只剩最后一项（Element UI 下拉因此永远只看到「博士」）
      var box = n.parentElement ? n.parentElement.closest(DROPDOWN_BOX_SEL) : null;
      if (box) {
        if (box !== lastBox) { lastBox = box; groups.push([]); }
        groups[groups.length - 1].push(n);
      } else {
        out.push(n);
      }
    }
    var picked = [];
    if (groups.length) {
      picked = groups[groups.length - 1];
      if (groups.length > 1) {
        // 别的弹层还开着：留给调用方清理，但选项只用最后那组
        out = out.concat(groups.slice(0, -1).reduce(function (a, b) { return a.concat(b); }, []));
        // 别的弹层里的选项不当候选，这里只返回最后一组
        out = [];
      }
    }
    picked = picked.length ? picked : out;
    var res = [];
    for (var j = 0; j < picked.length; j++) {
      var m = picked[j];
      var txt = String(m.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 80 || PICKER_BLOCK_RE.test(txt)) continue;
      res.push({ el: m, text: txt, value: m.getAttribute('data-value') || txt });
    }
    return res;
  }

  function openCustomSelect(host) {
    if (!host) return;
    // 先找真正的输入框：antd 只认落在 input 上的 mousedown（落在外层 div 上不开弹层），
    // 快手「最高学历学校」这种远程搜索下拉就是这么点不开的
    var clickTarget =
      host.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])') ||
      host.querySelector('.el-input__inner, .ant-select-selector, .el-select__wrapper, [role="combobox"]') ||
      host;
    try { clickTarget.focus(); } catch (_) { /* ignore */ }
    simulateClick(clickTarget);
  }

  /**
   * 写自定义下拉：点击展开 → 按文案匹配选项 → 点击。
   * 纯匹配逻辑复用 M.findBestOption / matchSelectOption。
   */
  /**
   * 往自定义下拉的搜索框里输值：antd v5 的「学校 / 专业」、Moka 的可搜索下拉，
   * 都要先输入再选，光点开只有一屏默认选项。
   * 用原生 setter + input 事件，React / Vue 的受控组件才认。
   */
  /** 下拉里可输入的搜索框（只读的 input 是展示用的，往里写字只会污染页面） */
  function searchInputOf(host) {
    var list = host.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])');
    for (var i = 0; i < list.length; i++) {
      if (!list[i].readOnly && !list[i].disabled) return list[i];
    }
    return null;
  }

  function typeIntoSearch(host, text) {
    var input = searchInputOf(host);
    if (!input) return false;
    var setter = null;
    try {
      setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    } catch (_) { setter = null; }
    try {
      input.focus();
      // 只有输入框里已经有字时才先清空：清空会让 antd 重渲染、把 input 换掉，
      // 后面那次赋值就落在已经脱离文档的旧节点上，等于没输（快手学校下拉踩过）
      if (String(input.value || '')) {
        if (setter) setter.call(input, ''); else input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input = searchInputOf(host) || input;
        try { input.focus(); } catch (_) { /* ignore */ }
      }
      if (setter) setter.call(input, String(text)); else input.value = String(text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  /** 下拉当前显示的文字（antd / Element / 自绘都能读到） */
  function customSelectText(host) {
    if (!host) return '';
    // Element Plus：第一个 .el-select__selected-item 是输入框外壳（永远空），选中文字在不透明的 placeholder 里
    var sel = host.querySelector('.ant-select-selection-item, .el-select__selected-item:not(.el-select__input-wrapper):not(.is-transparent)');
    if (sel) return String(sel.textContent || '').replace(/\s+/g, ' ').trim();
    // antd 选了就有 .ant-select-selection-item；没有就是没选。
    // 别拿搜索框里的字冒充结果——点了选项但没提交时，搜索框还留着刚输的词
    if (host.className && /ant-select/.test(String(host.className))) return '';
    var inp = host.querySelector('input');
    if (inp && inp.value) return String(inp.value).replace(/\s+/g, ' ').trim();
    return hostOwnText(host).slice(0, 40);
  }

  function normText(t) {
    return String(t || '').toLowerCase().replace(/\s+/g, '').replace(/[()（）\[\]【】·,，.。/\-]/g, '');
  }

  /**
   * 选完之后核对：读回来的文字得跟要填的值对得上。
   * 快手那个学校下拉会在筛选重排的瞬间把点击落到别的行（点成了「斯威本科技大学」），
   * 与其把错值留在页面上，不如判失败、让它在「未填」清单里露出来。
   */
  function optionTextPlausible(shown, value) {
    var a = normText(shown);
    if (!a) return false;
    var w = normText(value);
    if (!w) return false;
    if (a === w) return true;
    // 「不接受」⊃「接受」这类正反相包含不算对上（之前会把「接受」当成「不接受调剂」的合理显示）
    if (negationConflict(a, w)) return false;
    if (a.indexOf(w) !== -1 || w.indexOf(a) !== -1) return true;
    // 档案值写「应届生」、选项是「应届毕业生」这类同义词，不能当选歪了撤掉
    var syns = valueSynonymVariants(value);
    for (var i = 0; i < syns.length; i++) {
      var sn = normText(syns[i]);
      if (!sn || negationConflict(a, sn)) continue;
      if (a === sn || a.indexOf(sn) !== -1 || sn.indexOf(a) !== -1) return true;
    }
    return false;
  }

  function clearCustomSelect(host) {
    if (!host) return false;
    var btn = host.querySelector('.ant-select-clear, .el-select__clear, .el-select__caret.is-reverse, [class*="clear"]');
    if (btn) {
      simulateClick(btn);
      return true;
    }
    var inp = host.querySelector('input');
    if (!inp) return false;
    try {
      inp.focus();
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', keyCode: 8, bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  /** 选项全是 +86/+1 这类区号时，别把手机号往里填 */
  function isDialCodeList(opts) {
    if (!opts || !opts.length) return false;
    for (var i = 0; i < opts.length; i++) {
      if (!/^\s*\+\d{1,4}/.test(String(opts[i].text || ''))) return false;
    }
    return true;
  }

  /** antd v3 的 Select（.ant-select 但没有 v4 的 .ant-select-selector） */
  function isAntdV3SelectHost(host) {
    if (!host || !host.classList || !host.classList.contains('ant-select')) return false;
    return !host.querySelector('.ant-select-selector');
  }

  function antdV3SelectedText(host) {
    var v = host.querySelector('.ant-select-selection-selected-value');
    return v ? String(v.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  /** antd v3 下拉：原生 click 打开 → 需要时输入搜索词 → 原生 click 选项 → 回读 */
  async function fillAntdV3Select(host, value) {
    if (!host || !value) return false;
    if (antdV3SelectedText(host)) return false;
    var want = String(value).replace(/\s+/g, '');
    var tries = [String(value)].concat(regionPrefixVariants(value)).slice(0, 3);
    var deadline = Date.now() + 4500;

    for (var t = 0; t < tries.length; t++) {
      if (Date.now() > deadline) break;
      var target = tries[t];
      if (!target) continue;
      var sel = host.querySelector('.ant-select-selection');
      if (!sel) return false;
      if (!antdV3PanelIsOpen(sel)) {
        try { sel.click(); } catch (_) { simulateClick(sel); }
        await sleep(220);
      }
      var dd = dropdownForV3Select(sel);
      var items = dd ? Array.prototype.slice.call(dd.querySelectorAll('li.ant-select-dropdown-menu-item')) : [];
      items = items.filter(function (li) {
        if (/disabled/.test(String(li.className))) return false;
        return !/暂无数据|无数据|无匹配|加载中|loading/i.test(String(li.textContent || ''));
      });

      if (!items.length) {
        // 远程搜索（学校/专业这类）：输入关键词等结果
        var search = host.querySelector('.ant-select-search__field');
        if (search) {
          try {
            search.focus();
            var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (desc && desc.set) desc.set.call(search, target);
            else search.value = target;
            search.dispatchEvent(new Event('input', { bubbles: true }));
          } catch (_) { /* ignore */ }
          await sleep(1200);
          dd = dropdownForV3Select(sel);
          items = dd ? Array.prototype.slice.call(dd.querySelectorAll('li.ant-select-dropdown-menu-item')) : [];
          items = items.filter(function (li) { return !/disabled/.test(String(li.className)); });
        }
      }
      if (!items.length) continue;

      var wantNorm = target.replace(/\s+/g, '');
      var hit = items.filter(function (li) {
        return String(li.textContent || '').replace(/\s+/g, '') === wantNorm;
      })[0];
      if (!hit) {
        // 「使用“广东工业大学”作为我的学校」这种远程搜索占位项：文案里含目标就认
        hit = items.filter(function (li) {
          var t2 = String(li.textContent || '').replace(/\s+/g, '');
          return t2.indexOf(wantNorm) !== -1;
        })[0];
      }
      if (!hit) {
        // 没有可点的项：远程搜索下拉仍然能用键选取到
        var kb = await v3KeyboardPick(host, sel, wantNorm);
        if (kb) { highlight(host); return true; }
        continue;
      }
      // 实测 wecruit 这类 v3 远程搜索下拉：点选项不提交，键盘 ArrowDown + Enter 才提交；
      // 有搜索框就先走键盘，没有再退回鼠标点
      if (await v3KeyboardPick(host, sel, wantNorm)) { highlight(host); return true; }
      try { hit.click(); } catch (_) { simulateClick(hit); }
      await sleep(320);
      if (antdV3SelectedText(host)) { highlight(host); return true; }
    }
    return false;
  }

  /** v3 下拉的键盘选中：逐条 ArrowDown，直到高亮项是目标再 Enter（盲按会选中列表第一条） */
  async function v3KeyboardPick(host, sel, wantNorm) {
    var search = host.querySelector('.ant-select-search__field');
    if (!search || !wantNorm) return false;
    try {
      search.focus();
      for (var k = 0; k < 12; k++) {
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
        await sleep(60);
        var dd = dropdownForV3Select(sel);
        var act = dd ? dd.querySelector('.ant-select-dropdown-menu-item-active') : null;
        var actText = act ? String(act.textContent || '').replace(/\s+/g, '') : '';
        if (actText && (actText === wantNorm || actText.indexOf(wantNorm) !== -1)) {
          search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          await sleep(460);
          return !!antdV3SelectedText(host);
        }
      }
    } catch (_) { /* ignore */ }
    return false;
  }

  /** 这个 select 自己那个下拉（按 aria-controls 找，找不到退回可见的那个） */
  function dropdownForV3Select(sel) {
    var ctrl = sel && sel.querySelector('[aria-controls]');
    var id = ctrl ? ctrl.getAttribute('aria-controls') : (sel && sel.getAttribute('aria-controls'));
    if (id) {
      var byId = document.getElementById(id);
      if (byId) return byId;
    }
    var list = Array.prototype.filter.call(document.querySelectorAll('.ant-select-dropdown'), isVisibleEl);
    return list.length ? list[list.length - 1] : null;
  }

  function antdV3PanelIsOpen(sel) {
    var dd = dropdownForV3Select(sel);
    return !!(dd && isVisibleEl(dd) && dd.querySelector('li.ant-select-dropdown-menu-item'));
  }

  /** 弹窗选择器：点输入框 → ant-modal 里搜关键词 → 点 .school-item → 点「选择」 */
  function visibleAntdModal() {
    var list = Array.prototype.filter.call(document.querySelectorAll('.ant-modal'), isVisibleEl);
    return list.length ? list[list.length - 1] : null;
  }

  async function fillAntdModalPicker(input, value, key) {
    if (!input || !value) return false;
    if (String(input.value || '').trim()) return false;
    try { input.click(); } catch (_) { simulateClick(input); }
    var modal = null;
    for (var w = 0; w < 12 && !modal; w++) {
      await sleep(180);
      var m = visibleAntdModal();
      if (m && m.querySelector('.school-item, .school-form, input[placeholder*="专业"], input[placeholder*="学校"]')) modal = m;
    }
    if (!modal) return false;
    var want = String(value).replace(/\s+/g, '');
    var search = modal.querySelector('.search-bar input, input[placeholder*="专业"], input[placeholder*="学校"]');
    if (search && want) {
      try {
        var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(search, want);
        else search.value = want;
        search.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (_) { /* ignore */ }
      await sleep(1300);
    }
    var items = Array.prototype.slice.call(modal.querySelectorAll('.school-item'));
    var best = null;
    var bestScore = -1;
    items.forEach(function (it) {
      var t = String(it.textContent || '').replace(/\s+/g, '');
      if (!t) return;
      var score = 0;
      if (t === want) score = 5;
      else if (t.indexOf(want) === 0) score = 4;
      else if (t.indexOf(want) !== -1) score = 3;
      if (!score) return;
      // 「计算机科学与技术(计算机类)(普通本科)」这种带补充说明的：本科/研究生要跟档案对得上
      if (/本科/.test(t)) score += 1;
      if (score > bestScore) { bestScore = score; best = it; }
    });
    if (!best) return false;
    try { best.click(); } catch (_) { simulateClick(best); }
    await sleep(260);
    var confirm = null;
    Array.prototype.forEach.call(modal.querySelectorAll('button'), function (b) {
      if (/^(选择|确定|确认)$/.test(String(b.textContent || '').trim())) confirm = b;
    });
    if (confirm) {
      try { confirm.click(); } catch (_) { simulateClick(confirm); }
      await sleep(600);
    }
    if (String(input.value || '').trim()) { highlight(input); return true; }
    return false;
  }

  /** 预扫描这类「弹窗选择器」输入框：label 是专业/学校，且 placeholder 写着「请选择」 */
  async function fillModalPickers(profile, handled, filledKeys) {
    var items = Array.prototype.slice.call(document.querySelectorAll('.ant-form-item'));
    var filled = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var lab = it.querySelector('label');
      var label = lab ? String(lab.textContent || '').replace(/\s+/g, '').replace(/\*/g, '').trim() : '';
      if (!label) continue;
      var key = M.matchFieldKey(label, { context: detectSectionContext(it) });
      if (key !== 'major' && key !== 'school') continue;
      var inp = it.querySelector('input.ant-input:not([type="hidden"])');
      if (!inp) continue;
      if (handled && handled.has(inp)) continue;
      if (String(inp.value || '').trim()) continue;
      var ph = String(inp.getAttribute('placeholder') || '');
      // 先确认是「点了弹窗选」的那种再占用：之前在这里之前就 handled.add，
      // 普通的「学校名称 / 专业」输入框被标成已处理，主循环永远跳过它们（antd 表单里学校专业一律不填）
      if (!/请选择|选择专业|选择学校/.test(ph)) continue;
      if (handled) handled.add(inp);
      var val = M.profileValueForOccurrence
        ? M.profileValueForOccurrence(profile, key, 0)
        : M.profileValue(profile, key);
      if (!val) continue;
      var ok = false;
      try { ok = await fillAntdModalPicker(inp, val, key); } catch (_) { ok = false; }
      if (ok) {
        filled += 1;
        if (filledKeys && filledKeys.indexOf(key) === -1) filledKeys.push(key);
        recordFill(inp, key, val);
      }
      // 没选中的弹窗要关掉，否则遮罩会把后面的下拉点击全吞掉
      var leftover = visibleAntdModal();
      if (leftover) {
        Array.prototype.forEach.call(leftover.querySelectorAll('button'), function (b) {
          if (/^取\s*消$/.test(String(b.textContent || '').trim())) { try { b.click(); } catch (_) { /* ignore */ } }
        });
        await sleep(220);
      }
    }
    return filled;
  }

  /**
   * v1.5.16：下拉选项和档案值常常是同义词不同写法
   * （档案写「应届生」，Moka 的选项是「应届毕业生」；写「本科」，选项是「学士」…）
   * 精确匹配失败时按同义组再找一轮。
   */
  var VALUE_SYNONYM_SETS = [
    ['应届生', '应届毕业生', '应届', '在校生', '应届毕业'],
    ['本科', '学士', '大学本科', '本科生'],
    ['硕士', '研究生', '硕士研究生', '硕士生'],
    ['博士', '博士研究生'],
    ['男', '男性', '先生'],
    ['女', '女性', '女士'],
    ['是', '接受', '同意', '可以', '服从'],
    ['否', '不接受', '不同意', '不服从']
  ];

  /**
   * v1.5.23：只取「被值包含的最长成员」所在的那一组。
   * 旧逻辑是「包含任一成员就算」：不接受调剂 ⊃ 接受 → 命中「是」组；博士研究生 ⊃ 研究生 → 命中硕士组。
   */
  function valueSynonymVariants(value) {
    var v = String(value == null ? '' : value).replace(/\s+/g, '');
    if (!v) return [];
    var bestLen = 0;
    var bestSets = [];
    VALUE_SYNONYM_SETS.forEach(function (set) {
      set.forEach(function (x) {
        if (v !== x && v.indexOf(x) === -1) return;
        var len = v === x ? 1000 : x.length;
        if (len > bestLen) { bestLen = len; bestSets = [set]; }
        else if (len === bestLen && bestSets.indexOf(set) === -1) bestSets.push(set);
      });
    });
    // 两个组打平（拿不准是哪一类）→ 不扩展
    if (bestSets.length !== 1) return [];
    var out = [];
    bestSets[0].forEach(function (x) { if (x !== v && out.indexOf(x) === -1) out.push(x); });
    return out;
  }

  function negationConflict(a, b) {
    return !!(M.hasNegationConflict && M.hasNegationConflict(a, b));
  }

  function matchOptionByVariants(opts, variants) {
    for (var i = 0; i < variants.length; i++) {
      var v = String(variants[i]).replace(/\s+/g, '');
      if (!v) continue;
      var exact = null;
      var contains = [];
      for (var j = 0; j < opts.length; j++) {
        var t = String((opts[j] && opts[j].text) || '').replace(/\s+/g, '');
        if (!t) continue;
        if (t === v) { exact = opts[j]; break; }
        if (t.indexOf(v) >= 0 && !negationConflict(t, v)) contains.push(opts[j]);
      }
      if (exact) return exact;
      // 多个选项都包含这个同义词：拿不准，换下一个同义词
      if (contains.length === 1) return contains[0];
    }
    return null;
  }

  /**
   * 联动下拉（语种 → 语言等级 / 省 → 市 / 学校 → 专业）：上一级没选，下一级根本没有选项。
   * 直接写第二级必然失败，所以按「先上一级 → 等选项刷新 → 再下一级 → 逐级回读」来做，
   * 具体实现放在 shared/select-chain.js（可被 DOM 测试直接驱动）。
   */
  async function fillLinkedSelectChains(profile, filledKeys) {
    var C = globalThis.ResumeAutofillSelectChain;
    if (!C || !C.fillChain) return 0;
    var langName = M.profileValue(profile, 'langName') || '';
    var langLevel = M.profileValue(profile, 'langLevel') || M.profileValue(profile, 'englishLevel') || '';
    if (!langName || !langLevel) return 0;
    // v1.6.0：多段外语（langList）：第 i 组「语种 → 等级」取第 i 条
    var rowLang = function (i, k, dflt) { return i === 0 ? dflt : (M.profileValueForOccurrence(profile, k, i) || ''); };

    // 收集带 label 的下拉宿主，按 label 归到「语种」/「语言等级」两桶
    var hosts = iterCustomSelectHosts();
    var langs = [];
    var levels = [];
    hosts.forEach(function (host) {
      var item = host.closest ? host.closest('.ant-form-item, .el-form-item, .form-item, .form-group, tr, .row') : null;
      if (!item) return;
      var lab = item.querySelector('.ant-form-item-label, .el-form-item__label, label');
      var label = lab ? String(lab.textContent || '').replace(/\s+/g, '').replace(/\*/g, '') : '';
      if (!label) return;
      var key = M.matchFieldKey(label, {});
      // 网申常用「语种/语言类型」作一级；旧关键词曾误落到 languages，这里再按标签兜底
      if (key === 'langName' || /^(语言类型|语种|语言种类)/.test(label)) langs.push({ host: host, label: label });
      else if (key === 'langLevel' || key === 'englishLevel' || /^(掌握程度|熟练程度|语言水平|语言等级|语言级别)/.test(label)) levels.push({ host: host, label: label });
    });

    var filled = 0;
    var n = Math.min(langs.length, levels.length);
    for (var i = 0; i < n; i++) {
      if (runDone && runDone.chain.has(levels[i].host)) continue;
      var res = null;
      try {
        var ln = rowLang(i, 'langName', langName);
        var lv = rowLang(i, 'langLevel', langLevel);
        if (!ln || !lv) continue;
        res = await C.fillChain([
          { host: langs[i].host, value: ln, label: langs[i].label },
          { host: levels[i].host, value: lv, label: levels[i].label }
        ]);
      } catch (_) { res = null; }
      if (res && res.ok) {
        if (runDone) runDone.chain.add(levels[i].host);
        filled += 1;
        ['langName', 'langLevel'].forEach(function (k) {
          if (filledKeys.indexOf(k) === -1) filledKeys.push(k);
        });
        recordFill(langs[i].host, 'langName', ln);
        recordFill(levels[i].host, 'langLevel', lv);
        fillRecords[fillRecords.length - 1].noCount = true;
        highlight(levels[i].host);
      }
    }
    return filled;
  }

  function fillCustomSelect(host, value, key) {
    if (isPhoenixHost(host)) return fillPhoenixHost(host, value, key);
    if (isAntdV3SelectHost(host)) return fillAntdV3Select(host, value);
    return new Promise(function (resolve) {
      if (!host || !value) { resolve(false); return; }
      if (customSelectLooksFilled(host)) { resolve(false); return; }
      // 单选/多选组不是下拉：别在这里耗 2s 等一个永远不出现的弹层
      if (host.querySelector('input[type="radio"], input[type="checkbox"]')) { resolve(false); return; }
      // 先关掉别的下拉，否则会把别人家的选项当成自己的（快手的排名下拉就这么串过）
      closeOpenDropdowns();
      openCustomSelect(host);

      var waited = 0;
      var reopened = false;
      var typed = false;
      var opened = false;     // 点不开时用 ArrowDown 兜底展开（rc-select 认这个）
      var searched = false;   // 已经输过搜索词
      var retyped = false;    // 列表出来之后补输过一次
      var sigAtType = '';     // 输搜索词那一刻的选项指纹（远程搜索要等列表真的变了）
      // v1.5.24：只读（不可搜索）的下拉，选项出来、确认没有目标就立刻放弃；之前要空等 3~4 秒，
      // 一张表有几个对不上的下拉就会拖到整体超时
      var searchable = !!searchInputOf(host);
      var noMatchPolls = 0;
      var checkValue = value;

      function candidates() {
        return hostDropdownOptions(host) || collectOpenDropdownOptions();
      }

      // 记住「打开之前就在页面上的弹层」，只认新出现的那个


      function signature(opts) {
        return (opts || []).map(function (o) { return String(o.text || ''); }).join('|');
      }

      function poll() {
        var opts = candidates();
        var sig = signature(opts);
        if (opts.length && isDialCodeList(opts) && !/^\s*\+/.test(String(value))) {
          // 区号下拉（+86 / +82 …）不是给手机号用的，宁可不填
          closeOpenDropdowns();
          resolve(false);
          return;
        }
        if (opts.length) {
          var matched = M.findBestOption
            ? M.findBestOption(opts, value)
            : (M.matchSelectOption && M.matchSelectOption(opts, value));
          // 「是 / 否」遇到「应届毕业生 / 往届毕业生」这类两态选项：先换成对应的词
          if (!matched && CHOICE_VALUE_MAP[key]) {
            var cv = phoenixChoiceValue(key, value, opts.map(function (o) { return String(o.text || ''); }));
            if (cv && cv !== value) {
              matched = M.findBestOption(opts, cv);
              if (matched) checkValue = cv;   // 选完核对时按换算后的词比（「应届毕业生」≠「是」）
            }
          }
          // 籍贯这类「省 / 市」两级下拉拿到的是整串，按行政区后缀切出能对上的那一段
          if (!matched) {
            var syns = valueSynonymVariants(value);
            if (syns.length) matched = matchOptionByVariants(opts, syns);
          }
          if (!matched) {
            var variants = regionPrefixVariants(value);
            for (var vi = variants.length - 1; vi >= 0 && !matched; vi--) {
              var text = variants[vi];
              var hit = opts.filter(function (o) { return String(o.text || '').replace(/\s+/g, '') === text; })[0];
              if (hit) matched = hit;
            }
          }
          if (matched) { pick(opts, matched); return; }
          if (!searchable) {
            noMatchPolls += 1;
            // 多等一拍防止列表还在渲染（虚拟列表 / 动画），两次都对不上就是真没有
            if (noMatchPolls >= 2) { closeOpenDropdowns(); resolve(false); return; }
          }
          if (searched && sigAtType && sig !== sigAtType) {
            // 搜过了、列表也真的变了（远程搜索回来了）还是没有 → 这个下拉确实没这个值
            closeOpenDropdowns();
            resolve(false);
            return;
          }
          // 弹层还没开就先输了搜索词：等列表出来再补输一次，否则永远等不到筛选结果
          if (searched && !sigAtType && !retyped) {
            retyped = true;
            sigAtType = sig;
            typeIntoSearch(host, value);
          }
          // 远程搜索（快手学校/专业）1.5s 才回来：输了没反应就再输一次，别提前放弃
          if (searched && sigAtType && sig === sigAtType && !retyped && waited >= 1500) {
            retyped = true;
            typeIntoSearch(host, value);
          }
        }
        // 没匹配上：试「输入搜索」（学校 / 专业这类可搜索下拉）
        // 合成点击有时打不开 antd 的下拉（快手的「专业」就是这样）：
        // 聚焦后用方向键展开，rc-select 认这个键
        if (!opened && !opts.length && waited >= 300) {
          opened = true;
          var fi = host.querySelector('input:not([type="hidden"])');
          if (fi) {
            try { fi.focus(); } catch (_) { /* ignore */ }
            ['keydown', 'keyup'].forEach(function (t) {
              try {
                fi.dispatchEvent(new KeyboardEvent(t, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
              } catch (_) { /* ignore */ }
            });
          }
        }
        // 可搜索：选项一出来没对上就马上输搜索词（之前固定等 420ms）；弹层没出来时也输（远程搜索要先输才有列表）
        if (!typed && searchable && String(value).length > 1 && (opts.length || waited >= 420)) {
          typed = true;
          sigAtType = sig;
          searched = typeIntoSearch(host, value);
        }
        if (waited >= (searched ? 3600 : (searchable ? 2400 : 1800))) {
          closeOpenDropdowns();
          resolve(false);
          return;
        }
        if (!reopened && waited >= 1200 && !typed) {
          reopened = true;
          openCustomSelect(host);
        }
        waited += 150;
        setTimeout(poll, 150);
      }
      setTimeout(poll, 180);

      function pick(opts, matched) {
        if (!opts || !opts.length) { resolve(false); return; }
        var want = matched || opts[0];
        var wantNorm = M.normalizeOptionText
          ? M.normalizeOptionText(want.text || want.value)
          : String(want.text || want.value || '').toLowerCase();
        var hit = null;
        for (var i = 0; i < opts.length; i++) {
          var tn = M.normalizeOptionText
            ? M.normalizeOptionText(opts[i].text)
            : String(opts[i].text || '').toLowerCase();
          if (tn === wantNorm || opts[i].text === want.text) { hit = opts[i]; break; }
        }
        if (!hit) hit = want;
        var wantText = String(want.text || want.value || '');
        // 点之前先核对一遍：拿不准的宁可不点，别把「斯威本科技大学」这种填进学校
        if (!optionTextPlausible(wantText, checkValue)) { closeOpenDropdowns(); resolve(false); return; }
        simulateClick(hit.el);
        setTimeout(function () {
          // 这里千万别 closeOpenDropdowns()：rc-select 的 Esc 会把旧值还原，
          // 刚选好的学校就被撤回去了（快手实测）
          var shown = customSelectText(host);
          // 只跟「要填的值」比：跟匹配到的选项比等于自证，斯威本科技大学就是这么混过去的
          if (optionTextPlausible(shown, checkValue)) { resolve(true); return; }
          // 选歪了：撤掉，按失败处理（宁可空着，也别留个错的）
          clearCustomSelect(host);
          resolve(false);
        }, 260);
      }
    });
  }

  // ————— v1.5.5：北森 Phoenix（zhiye.com / 北森云网申）组件适配 —————
  // 页面结构：.form-root > .ux-standard-form > .form#GUID_Recruitment_* > .form-item--phoenix
  // 控件：select / date 都是 .phoenix-select（无 name/id，靠 .form-item__text 标签）；
  //       radio 是纯 div 的 .phoenix-radio-group；民族=字典弹层，籍贯=地区弹层。
  var PHOENIX_LIST_SEL = '.phoenix-selectList';
  var PHOENIX_ITEM_SEL = '.phoenix-selectList__listItem';
  var PHOENIX_DATE_SEL = '.phoenix-date-picker';
  var PHOENIX_DICT_SEL = '.constant-main-selector-container';
  var PHOENIX_AREA_SEL = '.area-selector-container';

  function isPhoenixHost(host) {
    return !!(host && host.classList && host.classList.contains('phoenix-select'));
  }

  /** 最后一个可见节点（弹层可能残留多个已关闭副本） */
  function lastVisible(sel, root) {
    var nodes = (root || document).querySelectorAll(sel);
    var hit = null;
    for (var i = 0; i < nodes.length; i++) {
      if (isVisibleEl(nodes[i])) hit = nodes[i];
    }
    return hit;
  }

  function phoenixHostFilled(host) {
    if (!host) return false;
    var input = host.querySelector('input');
    var v = input ? String(input.value || '').trim() : '';
    if (!v) {
      var tip = host.querySelector('.phoenix-select__tipEle');
      if (tip) v = String(tip.textContent || '').trim();
    }
    return !!v && !/^请选择$/.test(v);
  }

  /** 只写值 + input/change（不触发 blur，避免弹层提前关闭） */
  function setInputRaw(el, value) {
    if (!el || el.disabled || el.readOnly) return false;
    var proto = el.tagName.toLowerCase() === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function pressEnter(el) {
    try {
      el.focus();
      ['keydown', 'keypress', 'keyup'].forEach(function (t) {
        el.dispatchEvent(new KeyboardEvent(t, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
        }));
      });
    } catch (_) { /* ignore */ }
  }

  function closePhoenixPanels() {
    // 点回处于 active 的宿主最稳（合成 Escape 对部分组件无效）
    var active = document.querySelector('.phoenix-select--active');
    if (active) {
      simulateClick(active.querySelector('.phoenix-select__input') || active);
      return;
    }
    var panel = lastVisible(PHOENIX_LIST_SEL) || lastVisible(PHOENIX_DATE_SEL) ||
      lastVisible(PHOENIX_DICT_SEL) || lastVisible(PHOENIX_AREA_SEL);
    if (!panel) return;
    var target = panel.querySelector('input') || panel;
    try { target.focus(); } catch (_) { /* ignore */ }
    try {
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
      }));
    } catch (_) { /* ignore */ }
  }

  /** 弹层里的「确定」（字典 / 地区选择器） */
  function phoenixPanelConfirm(panel) {
    var nodes = panel.querySelectorAll('.phoenix-button__content');
    for (var i = 0; i < nodes.length; i++) {
      if (/^(确定|确认|完成|ok)$/i.test(String(nodes[i].textContent || '').trim())) {
        simulateClick(nodes[i]);
        return true;
      }
    }
    return false;
  }

  /** findBestOption 会去掉 el 字段，这里按文案再映射回原节点 */
  function phoenixPick(opts, value) {
    if (!opts || !opts.length) return null;
    var texts = opts.map(function (o) { return o.text; });
    var matched = M.findBestOption ? M.findBestOption(texts, value) : null;
    if (!matched) return null;
    var want = String(matched.text || matched.value || '');
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].text === want) return opts[i];
    }
    return null;
  }

  var PHOENIX_PANEL_SEL =
    '.phoenix-selectList, .phoenix-date-picker, .constant-main-selector-container, .area-selector-container';

  /** 轮询等待：弹层/选项都是异步渲染的，固定 sleep 不够稳 */
  async function waitUntil(fn, timeoutMs, stepMs) {
    var step = stepMs || 100;
    var waited = 0;
    while (waited <= timeoutMs) {
      try { if (fn()) return true; } catch (_) { /* ignore */ }
      await sleep(step);
      waited += step;
    }
    try { return !!fn(); } catch (_) { return false; }
  }

  function phoenixVisiblePanels() {
    return Array.prototype.filter.call(document.querySelectorAll(PHOENIX_PANEL_SEL), function (n) {
      return isVisibleEl(n);
    });
  }

  /** 点开宿主，返回「这次新出现的」弹层；上一个字段残留的弹层不算 */
  async function phoenixOpenPanel(host) {
    var before = phoenixVisiblePanels();
    var opener = host.querySelector('.phoenix-select__input') || host;
    simulateClick(opener);
    var found = null;
    await waitUntil(function () {
      var now = phoenixVisiblePanels();
      for (var i = 0; i < now.length; i++) {
        if (before.indexOf(now[i]) === -1) { found = now[i]; return true; }
      }
      return false;
    }, 1800, 150);
    return found;
  }

  function phoenixReadItems(root, itemSel) {
    var nodes = root.querySelectorAll(itemSel);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var t = String(nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push({ el: nodes[i], text: t });
    }
    return out;
  }

  /** 搜索后轮询直到出现匹配项（虚拟列表只渲染前几行，不搜就只能看到头部） */
  async function phoenixFindInList(root, itemSel, value) {
    var waited = 0;
    var hit = null;
    while (waited <= 1000) {
      hit = phoenixPick(phoenixReadItems(root, itemSel), value);
      if (hit) return hit;
      await sleep(150);
      waited += 150;
    }
    return null;
  }

  /** 弹层右侧的「已选 x/y」计数，用来确认勾选真的生效（-1 表示没这个区域） */
  function phoenixPanelSelectedCount(panel) {
    var right = panel.querySelector('.right-container');
    if (!right) return -1;
    var m = String(right.textContent || '').match(/已选(?:地区)?\s*(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }

  function phoenixIconOf(row) {
    return row.querySelector('.icon-container svg') ||
      row.querySelector('.icon-container') || row;
  }

  /** 字典 / 地区弹层：搜索 → 勾选图标（圆形单选） → 确定 */
  async function fillPhoenixPanel(host, value, panel, key) {
    if (!panel) return false;
    var isArea = panel.classList.contains('area-selector-container');
    var itemSel = isArea ? '.area-item-container' : '.list-item-container';
    var search = panel.querySelector('.content-search input, .area-search-input input');
    var raw = String(value).replace(/\s+/g, '');
    var texts = [raw];
    if (raw.length > 2) texts.push(raw.slice(0, 2));
    texts.push('');
    for (var s = 0; s < texts.length; s++) {
      if (search) {
        setInputRaw(search, texts[s]);
        // 等列表按搜索词重渲染，否则点到的是即将被替换的旧行
        await sleep(450);
      }
      var hit = await phoenixFindInList(panel, itemSel, value);
      if (!hit) continue;
      simulateClick(phoenixIconOf(hit.el));
      var selected = false;
      for (var t = 0; t < 5 && !selected; t++) {
        await sleep(200);
        selected = phoenixPanelSelectedCount(panel) > 0;
      }
      if (!selected) {
        // 列表刚重渲染时第一次点可能落空，重取一行再点一次
        hit = await phoenixFindInList(panel, itemSel, value);
        if (hit) {
          simulateClick(phoenixIconOf(hit.el));
          for (var t2 = 0; t2 < 5 && !selected; t2++) {
            await sleep(200);
            selected = phoenixPanelSelectedCount(panel) > 0;
          }
        }
      }
      if (!selected) continue;
      phoenixPanelConfirm(panel);
      if (await waitUntil(function () { return phoenixHostFilled(host); }, 1500, 150)) return true;
    }
    closePhoenixPanels();
    return false;
  }

  /**
   * 普通下拉：搜索 → 点选项（虚拟列表，只渲染可见行）
   * key 仅用于个别字段的保守校验（面试站点不能拿「广州」命中「广州美术学院」）。
   */
  async function fillPhoenixList(host, value, panel, key) {
    if (!panel) return false;
    var search = panel.querySelector('.phoenix-input__input');
    var raw = String(value).replace(/\s+/g, '');
    var texts = [raw];
    if (raw.length > 2) texts.push(raw.slice(0, 2));
    texts.push('');
    for (var s = 0; s < texts.length; s++) {
      if (search) {
        setInputRaw(search, texts[s]);
        await sleep(250);
      }
      var hit = await phoenixFindInList(panel, PHOENIX_ITEM_SEL, value);
      if (!hit) continue;
      if (key === 'interviewCity' && hit.text.length > raw.length + 3) continue;
      simulateClick(hit.el.querySelector('.phoenix-selectList__singleLabel') || hit.el);
      if (await waitUntil(function () { return phoenixHostFilled(host); }, 1200, 150)) return true;
    }
    closePhoenixPanels();
    return false;
  }

  /** 月份选择器（教育经历的起止时间）：翻年 → 点月份 */
  async function fillPhoenixMonth(host, value, panel) {
    var parts = parseDateParts(value);
    if (!panel || !parts) return false;
    var wantYear = parseInt(parts.y, 10);
    var wantMonth = parseInt(parts.m, 10);
    for (var guard = 0; guard < 60; guard++) {
      var yearEl = panel.querySelector('.phoenix-calendar-month-panel-year-select-content');
      var curYear = yearEl ? parseInt(String(yearEl.textContent || '').replace(/\D/g, ''), 10) : NaN;
      if (!curYear || curYear === wantYear) break;
      var btn = panel.querySelector(curYear < wantYear
        ? '.phoenix-calendar-month-panel-next-year-btn'
        : '.phoenix-calendar-month-panel-prev-year-btn');
      if (!btn) break;
      simulateClick(btn);
      await sleep(180);
    }
    var cells = panel.querySelectorAll('.phoenix-calendar-month-panel-month');
    var target = null;
    for (var i = 0; i < cells.length; i++) {
      // 「7月」「七月」「Jul」都有（随北森版本 / 语言包变）；12 格且读不出时按位置
      var n = monthNumberOfText(cells[i].textContent);
      if (n === wantMonth || (!n && cells.length === 12 && i + 1 === wantMonth)) { target = cells[i]; break; }
    }
    if (!target) { closePhoenixPanels(); return false; }
    simulateClick(target);
    var ok = await waitUntil(function () { return phoenixHostFilled(host); }, 1200, 150);
    if (ok) return true;
    closePhoenixPanels();
    return false;
  }

  /** 日期：日历面板里的 .phoenix-calendar-input 可直接键入 + Enter 提交 */
  async function fillPhoenixDate(host, value, panel) {
    var parts = parseDateParts(value);
    if (!panel || !parts) return false;
    if (panel.querySelector('.phoenix-calendar-month-calendar')) {
      return fillPhoenixMonth(host, value, panel);
    }
    var input = panel.querySelector('.phoenix-calendar-input');
    if (!input) { closePhoenixPanels(); return false; }
    // v1.6.0：日历输入框按语言包格式严格解析（zh_CN 是 YYYY/MM/DD，en_US 是 M/D/YYYY），格式不对
    // 输入框会挂上 *-input-invalid、Enter 无效。依次试常见格式，以「没被判无效」为准再回车
    var y = parts.y;
    var m = parseInt(parts.m, 10);
    var d = parseInt(parts.d || '1', 10);
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var tries = [y + '/' + p2(m) + '/' + p2(d), y + '-' + p2(m) + '-' + p2(d), y + '/' + m + '/' + d, y + '-' + m + '-' + d,
      y + '.' + p2(m) + '.' + p2(d), y + '年' + m + '月' + d + '日', m + '/' + d + '/' + y];
    for (var ti = 0; ti < tries.length; ti++) {
      setInputRaw(input, tries[ti]);
      await sleep(80);
      if (/-invalid\b/.test(String(input.className || ''))) continue;
      pressEnter(input);
      if (await waitUntil(function () { return phoenixHostFilled(host); }, 900, 100)) return true;
    }
    closePhoenixPanels();
    return false;
  }

  /**
   * 北森 Phoenix 宿主：点开 → 识别本次弹层类型（日期 / 字典 / 地区 / 普通下拉）
   */
  async function fillPhoenixHost(host, value, key) {
    if (!host || !value) return false;
    if (host.isConnected === false) return false;
    if (phoenixHostFilled(host)) return false;
    // 已经打开的先点回去，避免 toggle 反向
    if (host.classList.contains('phoenix-select--active')) {
      simulateClick(host.querySelector('.phoenix-select__input') || host);
      await waitUntil(function () { return !host.classList.contains('phoenix-select--active'); }, 700, 100);
    }
    var panel = await phoenixOpenPanel(host);
    if (!panel) return false;
    try {
      if (panel.classList.contains('phoenix-date-picker')) {
        return await fillPhoenixDate(host, value, panel);
      }
      if (panel.classList.contains('constant-main-selector-container') ||
          panel.classList.contains('area-selector-container')) {
        return await fillPhoenixPanel(host, value, panel, key);
      }
      return await fillPhoenixList(host, value, panel, key);
    } catch (e) {
      return false;
    }
  }

  var CN_MONTH_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  var EN_MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /** 月份格子的文字 → 1~12：「7月」「07」「七月」「Jul」「July」；读不出返回 0 */
  function monthNumberOfText(text) {
    var t = String(text || '').replace(/\s+/g, '').trim();
    var m = t.match(/^(\d{1,2})月?$/);
    if (m) { var n = parseInt(m[1], 10); return n >= 1 && n <= 12 ? n : 0; }
    m = t.match(/^(十一|十二|十|[一二三四五六七八九])月$/);
    if (m) return CN_MONTH_NUM[m[1]];
    m = t.toLowerCase().match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
    return m ? EN_MONTH_NUM[m[1]] : 0;
  }

  /** 应届/往届这类「是/否 ⇄ 两态词」的值映射 */
  var CHOICE_VALUE_MAP = {
    isFreshGraduate: { yes: '应届', no: '往届' }
  };

  function phoenixChoiceValue(key, value, optionTexts) {
    var map = CHOICE_VALUE_MAP[key];
    var v = String(value || '').trim();
    if (!map || optionTexts.join(' ').indexOf(map.yes) === -1) return v;
    var yn = M.parseYesNo ? M.parseYesNo(v) : null;
    if (yn === 'Yes') return map.yes;
    if (yn === 'No') return map.no;
    return v;
  }

  /** 北森 Phoenix radio：纯 div 组，选中态是 .phoenix-radio--checked */
  var PHOENIX_RADIO_CHECKED_SEL = '.phoenix-radio--checked, .phoenix-radio__circle--checked';

  async function fillPhoenixRadioGroups(profile, keyCounts, filledKeys) {
    var filled = 0;
    var groups = Array.from(document.querySelectorAll('.phoenix-radio-group')).filter(function (g) {
      return isVisibleEl(g);
    });
    for (var gi = 0; gi < groups.length; gi++) {
      var r = await fillOnePhoenixRadioGroup(groups[gi], profile, keyCounts, filledKeys);
      if (r) filled += 1;
    }
    return filled;
  }

  async function fillOnePhoenixRadioGroup(group, profile, keyCounts, filledKeys) {
    {
      // 选中态两个版本的写法都认：线上 .phoenix-radio--checked，npm 3.x .phoenix-radio__circle--checked
      if (group.querySelector(PHOENIX_RADIO_CHECKED_SEL)) return false;
      var item = group.closest ? group.closest('.form-item') : null;
      var labelEl = item ? item.querySelector('.form-item__text') : null;
      var label = labelEl ? String(labelEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!label) return false;
      var scored = M.matchFieldKeyScored ? M.matchFieldKeyScored(label, {}) : null;
      var key = scored && scored.key;
      if (!key || !RADIO_SAFE_KEYS[key]) return false;
      if (keyCounts['radio:' + key]) return false;
      var gval = M.profileValue(profile, key);
      if (!gval) return false;
      var opts = Array.from(group.querySelectorAll('.phoenix-radio')).map(function (r) {
        return { el: r, text: String(r.textContent || '').replace(/\s+/g, ' ').trim() };
      }).filter(function (o) { return o.text; });
      if (!opts.length) return false;
      var want = phoenixChoiceValue(key, gval, opts.map(function (o) { return o.text; }));
      var matched = phoenixPick(opts, want);
      if (!matched) return false;
      simulateClick(matched.el);
      // 选中态由 Vue 异步渲染：等它落地再判，不能点完立刻读（之前会把成功判成失败、或反过来）
      var isOn = function () {
        return matched.el.classList.contains('phoenix-radio--checked') || !!matched.el.querySelector(PHOENIX_RADIO_CHECKED_SEL);
      };
      var on = await waitUntil(isOn, 600, 60);
      if (!on) {
        try { matched.el.click(); } catch (_) { /* ignore */ }
        on = await waitUntil(isOn, 600, 60);
      }
      if (!on) return false;
      keyCounts['radio:' + key] = 1;
      if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
      highlight(matched.el);
      return true;
    }
  }

  /** 北森分区标题：标题 div 与 .form 共用同一个 id（GUID_Recruitment_*） */
  function phoenixFormTitle(form) {
    if (!form || !form.id || form.id.indexOf('_Recruitment_') === -1) return '';
    var sel = '[id="' + (window.CSS && CSS.escape ? CSS.escape(form.id) : form.id) + '"]';
    var nodes;
    try { nodes = document.querySelectorAll(sel); } catch (_) { return ''; }
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === form) continue;
      if (n.classList && n.classList.contains('form')) continue;
      var t = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length <= 24) return t;
    }
    return '';
  }

  /** 收集 radio 组的候选标题：表单标签 → 行首兄弟文本 → 父容器去选项文本 → name */
  function radioGroupHints(first, wrap, name) {
    var hints = [];
    var pick = function (v) {
      var t = String(v || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length < 2) return;
      if (/^(是|否|男|女|其他|有|无)$/.test(t)) return;
      if (hints.indexOf(t) === -1) hints.push(t);
    };
    var node = wrap || first.parentElement;
    // ① 表单行标签 / legend
    var lab = (node && node.querySelector('legend, .el-form-item__label, .ant-form-item-label, .form-label, .item-label')) || null;
    if (lab) pick(lab.textContent);
    // ② 往上最多 3 层：取本节点前一个非空兄弟的文本，以及父容器“去掉选项后”的文本
    for (var up = 0; up < 3 && node; up++) {
      var sib = node.previousElementSibling;
      while (sib) {
        if (!/^(INPUT|BUTTON|SCRIPT|STYLE)$/.test(sib.tagName)) {
          var t = String(sib.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) { pick(t); break; }
        }
        sib = sib.previousElementSibling;
      }
      var parent = node.parentElement;
      if (!parent) break;
      var clone = parent.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('input, button, .radio-group, [role="radiogroup"], label'), function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
      pick(clone.textContent);
      node = parent;
    }
    // ③ name 兜底（is_fresh / has_relative 这类语义名）
    pick(String(name || '').replace(/[_-]+/g, ' '));
    return hints;
  }

  /** 命名 radio 组：按 name 聚合，Yes/No 与安全键可填 */
  function fillNamedRadioGroups(profile, keyCounts, filledKeys) {
    var filled = 0;
    var radios = Array.from(document.querySelectorAll('input[type=radio][name]')).filter(function (r) {
      return !r.disabled && r.offsetParent !== null;
    });
    var byName = {};
    radios.forEach(function (r) {
      if (!byName[r.name]) byName[r.name] = [];
      byName[r.name].push(r);
    });
    Object.keys(byName).forEach(function (name) {
      var group = byName[name];
      if (group.length < 2) return;
      // 已有选中则跳过
      if (group.some(function (r) { return r.checked; })) return;
      var first = group[0];
      var wrap = first.closest
        ? first.closest('fieldset, .el-form-item, .ant-form-item, .form-item, .form-group, tr, li, div')
        : first.parentElement;
      // v1.5.1: 组标题常在“行首 <span>/<td>”里，或在本组容器前一个兄弟节点
      var hints = radioGroupHints(first, wrap, name);
      var scored = null;
      for (var hi = 0; hi < hints.length && !scored; hi++) {
        scored = M.matchFieldKeyScored ? M.matchFieldKeyScored(hints[hi], {}) : null;
      }
      var gkey = scored && scored.key;
      if (!gkey) return;
      var gval = M.profileValue(profile, gkey);
      if (!gval) return;
      var opts = group.map(function (r) {
        return { value: r.value, text: radioOptionText(r), el: r };
      });
      var isYn = M.isYesNoOnlySelect && M.isYesNoOnlySelect(opts);
      if (!RADIO_SAFE_KEYS[gkey] && !isYn) return;
      if (keyCounts['radio:' + gkey]) return;
      var matched = M.findBestOption ? M.findBestOption(opts, gval) : null;
      if (!matched && isYn && M.parseYesNo) {
        var yn = M.parseYesNo(gval);
        if (yn) matched = M.findBestOption(opts, yn);
      }
      if (!matched) return;
      var target = null;
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].text === matched.text || String(opts[i].value) === String(matched.value)) {
          target = opts[i].el;
          break;
        }
      }
      if (!target) return;
      simulateClick(target);
      if (!target.checked) {
        // 合成点击没生效（antd v3 Radio 只认原生 click）：点包装 label，再点 input 本身
        var rl = target.closest ? target.closest('label') : null;
        try { (rl || target).click(); } catch (_) { /* ignore */ }
        if (!target.checked) { try { target.click(); } catch (_) { /* ignore */ } }
      }
      if (target.checked) {
        recordFill(target, gkey, gval);
        keyCounts['radio:' + gkey] = 1;
        filled += 1;
        if (filledKeys.indexOf(gkey) === -1) filledKeys.push(gkey);
        highlight(target);
      }
    });
    return filled;
  }

  /** 扫描页面上的自定义下拉宿主（无 native select 时） */
  function iterCustomSelectHosts() {
    // v1.5.24：归一化 + 去重 —— .el-select 里那个 role=combobox 的 input、日期控件外层的 combobox
    // 都不是独立的下拉（之前同一个下拉会被当成两个各试一遍，对不上时白耗两倍时间）
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll(CUSTOM_SELECT_HOST), function (h) {
      if (!(isVisibleEl(h) || h.offsetParent !== null)) return;
      var n = findCustomSelectHost(h);
      if (!n) return;
      var outer = n.parentElement && n.parentElement.closest(CUSTOM_SELECT_HOST);
      if (outer && findCustomSelectHost(outer) === outer && outer !== n) n = outer;
      if (out.indexOf(n) === -1) out.push(n);
    });
    return out;
  }


  /** 可见性判断：offsetParent 在 position:fixed 弹层里恒为 null，改用 rect + computedStyle */
  function isVisibleEl(n) {
    if (!n || n.nodeType !== 1) return false;
    var rect = n.getBoundingClientRect ? n.getBoundingClientRect() : null;
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    try {
      var st = window.getComputedStyle(n);
      if (!st || st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    } catch (_) { /* ignore */ }
    return true;
  }

  /** 在可见层里找与目标值匹配的选项节点（只返回容器式叶子节点） */
  function pickVisibleCandidates(desired) {
    var want = String(desired || '').replace(/\s+/g, ' ').trim();
    if (!want) return [];
    var nodes = document.querySelectorAll('[role="option"], li, dd, .option, .picker-item, .list-item, .dropdown-item, .weui-cell');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var txt = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 40 || PICKER_BLOCK_RE.test(txt)) continue;
      if (!isVisibleEl(n)) continue;
      if (n.querySelector('input, textarea, select')) continue;
      var score = 0;
      if (txt === want) score = 3;
      else if (txt.indexOf(want) === 0 || want.indexOf(txt) === 0) score = 2;
      else if (txt.indexOf(want) !== -1) score = 1;
      if (!score) continue;
      out.push({ el: n, score: score, len: txt.length });
    }
    out.sort(function (a, b) { return b.score - a.score || a.len - b.len; });
    return out.slice(0, 4);
  }

  /**
   * 点击 readonly 输入框 → 在弹出层里按文本选值 → 回读验证。
   * 失败时不强写 value（readonly 写了也不生效），并返回 false 供上层记录原因。
   */
  /** 选项值是否就是我们想要的目标值（严格比对，避免“值变了”就算成功） */
  function pickerValueMatches(actual, desired) {
    var a = normalizeChoiceText(actual);
    var w = normalizeChoiceText(desired);
    if (!a || !w) return false;
    if (a === w) return true;
    // 日期/薪资等带格式差异：允许一侧包含另一侧（至少 4 位，避免 "26" 命中 "2026"）
    if (a.length >= 4 && w.length >= 4 && (a.indexOf(w) !== -1 || w.indexOf(a) !== -1)) return true;
    return false;
  }


  // ————— v1.3.3：多表格日期面板（年/月/日 分栏）—————

  var lastDateTries = [];

  // 填写审计：记下每次「以为填上了」的元素与期望值，整轮结束后回读核对
  // （这几轮最常见的失败不是填错内容，而是以为填上了其实没进去：值进了搜索框、
  //   点 li 不提交、受控组件重渲染把值吞掉。审计是唯一能抓住它的本地手段。）
  var fillRecords = [];

  function recordFill(el, key, expected, kind, read) {
    try {
      fillRecords.push({
        el: el,
        read: typeof read === 'function' ? read : null,
        key: String(key || ''),
        label: String((el && (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'))) ) || ''),
        expected: String(expected == null ? '' : expected),
        kind: String(kind || '')
      });
    } catch (_) { /* ignore */ }
  }

  /** 回读一个控件当前显示的值（覆盖 input / textarea / select / antd 宿主 / 单选组） */
  function readBackValue(el) {
    if (!el || el.nodeType !== 1) return '';
    var tag = String(el.tagName || '').toLowerCase();
    try {
      if (tag === 'select') {
        var opt = el.options && el.options[el.selectedIndex];
        return opt ? String(opt.textContent || opt.text || opt.value || '').trim() : '';
      }
      if (tag === 'input' || tag === 'textarea') {
        var t = String(el.getAttribute('type') || 'text').toLowerCase();
        if (t === 'radio' || t === 'checkbox') {
          var lab = el.closest && el.closest('label');
          return el.checked ? String((lab && lab.textContent) || el.value || '').replace(/\s+/g, ' ').trim() : '';
        }
        return String(el.value || '').trim();
      }
      // 自定义下拉宿主
      var shown = el.querySelector('.ant-select-selection-selected-value, .ant-select-selection-item, .el-select__selected-item:not(.el-select__input-wrapper):not(.is-transparent), .selected-text');
      if (shown) return String(shown.textContent || '').replace(/\s+/g, ' ').trim();
      var inner = el.querySelector('input.ant-input, input[type="text"]');
      if (inner && String(inner.value || '').trim()) return String(inner.value || '').trim();
      return hostOwnText(el).slice(0, 60);
    } catch (_) { return ''; }
  }

  /** 整轮填写后核对：期望值 vs 页面真实值 */
  function runFillAudit() {
    var A = globalThis.ResumeAutofillAudit;
    if (!A || !fillRecords.length) return null;
    try {
      var entries = fillRecords.map(function (r) {
        var actual = '';
        try { actual = r.read ? String(r.read() || '') : readBackValue(r.el); } catch (_) { actual = ''; }
        return { key: r.key, label: r.label, expected: r.expected, actual: actual, kind: r.kind };
      });
      return A.auditEntries(entries, { ignoreEmpty: false });
    } catch (_) { return null; }
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function parseDateParts(value) {
    if (D && D.parseModel) {
      var mo = D.parseModel(value);
      if (!mo || !mo.y) return null;
      return { y: mo.y, m: mo.m, d: mo.d };
    }
    var str = String(value || '');
    // 完整日期：必须有分隔符，且月/日数值合法
    var m = str.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (m) {
      var mm = parseInt(m[2], 10);
      var dd = parseInt(m[3], 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        return { y: m[1], m: String(mm), d: String(dd) };
      }
    }
    // 只有年月（入学时间 / 毕业时间 这类）
    var ym = str.match(/^\s*(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?\s*$/);
    if (ym) {
      var m2 = parseInt(ym[2], 10);
      if (m2 >= 1 && m2 <= 12) return { y: ym[1], m: String(m2), d: null };
    }
    return null;
  }

  /** 列表容器常与“确定/箭头”同父：往上找带按钮的容器，最多 2 层 */
  function expandToActionableHost(host) {
    if (!S) return false;
    return S.expandToActionableHost(host);

  }

  /** 可见的日期面板：先按常见类名找；找不到就按“含年份文本的可见 table/ul”兜底 */
  function findDatePanel(yearText) {
    if (!S) return false;
    return S.findDatePanel(yearText);

  }

  /** 在面板里点一个“文本等于目标数字”的叶子项（年/月/日通用） */
  function clickPanelItem(scope, text, hintRe) {
    if (!S) return false;
    return S.clickPanelItem(scope, text, hintRe);

  }

  /** 面板里的确认按钮（确定/确认/完成/OK）——有些日期面板点完还要确认 */
  function clickPanelConfirm(scope) {
    if (!S) return false;
    return S.clickPanelConfirm(scope);

  }

  // ————— v1.3.5：年 / 月 / 日 三件套（原生 select 或只读框混合）—————

  function maxOptionNumber(sel) {
    var max = -Infinity;
    if (!sel || !sel.options) return max;
    for (var i = 0; i < sel.options.length; i++) {
      var raw = String(sel.options[i].value !== '' ? sel.options[i].value : sel.options[i].text || '');
      var v = parseInt(raw.replace(/\D/g, ''), 10);
      if (!isNaN(v)) max = Math.max(max, v);
    }
    return max;
  }

  function setSelectByNumber(sel, want) {
    var wantNum = parseInt(want, 10);
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      var raw = String(o.value !== '' ? o.value : o.text || '').trim();
      var num = parseInt(raw.replace(/\D/g, ''), 10);
      if (raw === String(want) || (!isNaN(num) && num === wantNum)) {
        sel.selectedIndex = i;
        try { sel.value = o.value; } catch (_) { /* ignore */ }
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  /** 找同组的「年 / 月 / 日」控件；找不到或不确信就返回 null */
  function collectDateGroup(el) {
    var box = el.closest
      ? el.closest('td, tr, .el-form-item, .ant-form-item, .form-item, .field, .form-group, .row, li')
      : null;
    if (!box) box = el.parentElement;
    if (!box) return null;
    var nodes = [];
    Array.prototype.forEach.call(box.querySelectorAll('select, input'), function (n) {
      if (n.disabled) return;
      if (/^(hidden|file|checkbox|radio|submit|button)$/i.test(n.type)) return;
      if (!isVisibleEl(n)) return;
      // 整日期控件（入学时间/毕业时间/请选择日期/RangePicker 两端）不是年/月/日部件
      var ph = String(n.getAttribute('placeholder') || '');
      if (/入学时间|毕业时间|开始时间|结束时间|起始|截止|入职时间|离职时间|请选择日期|yyyy-mm|yyyy年/i.test(ph)) return;
      nodes.push(n);
    });
    if (nodes.length < 2 || nodes.length > 4) return null;

    var parts = {};
    var explicit = { y: false, m: false, d: false };
    var yearSelect = false;
    nodes.forEach(function (n, idx) {
      var hint = [n.name, n.id, n.placeholder, n.getAttribute('aria-label')].join(' ');
      var part = null;
      if (/year|\by\b|年/i.test(hint)) part = 'y';
      else if (/month|\bm\b|月/i.test(hint)) part = 'm';
      else if (/day|\bd\b|日期|日$/i.test(hint)) part = 'd';
      if (part) explicit[part] = true;
      // select 的选项区间也用来判断年/月/日（hint 已命中 year 时同样要置位，否则年月双下拉会被误判非日期组）
      if (n.tagName === 'SELECT') {
        var mx = maxOptionNumber(n);
        if (mx >= 1900) { yearSelect = true; if (!part) part = 'y'; }
        else if (!part && mx <= 12 && n.options.length >= 2) part = 'm';
        else if (!part && mx <= 31 && n.options.length >= 2) part = 'd';
      }
      if (!part) part = ['y', 'm', 'd'][idx] || null;
      if (part && !parts[part]) parts[part] = n;
    });

    // 没有年份的「日期组」一律不认：宁可整组不填，也不要把月/日单独塞进去
    if (!parts.y) return null;
    var has = (parts.m ? 1 : 0) + (parts.d ? 1 : 0);
    if (has < 1) return null;
    // 必须能确认年份身份：年份是 select（选项含 19xx/20xx），或标签明确写了“年”
    if (!yearSelect && !explicit.y) return null;
    return parts;
  }

  /** 按 年/月/日 分别填一组控件；返回 { members, ok } 或 null（不是日期组） */
  async function fillDateGroup(el, desired) {
    var parts = parseDateParts(desired);
    if (!parts) return null;
    var grp = collectDateGroup(el);
    if (!grp) return null;
    var want = { y: parts.y, m: parts.m, d: parts.d };
    var members = [];
    var keys = Object.keys(grp);
    var needY = !!grp.y;
    var needM = !!grp.m && !!want.m;
    var yearOk = false;
    var monthOk = false;
    var dayOk = false;
    // 先只做「能不能填」的预检：年份不存在就别动任何一个控件（避免半截日期）
    if (needY && grp.y.tagName === 'SELECT' && !selectHasNumber(grp.y, want.y)) {
      return { members: keys.map(function (k) { return grp[k]; }), ok: false, reason: 'year_not_available' };
    }
    if (needM && grp.m.tagName === 'SELECT' && !selectHasNumber(grp.m, want.m)) {
      return { members: keys.map(function (k) { return grp[k]; }), ok: false, reason: 'month_not_available' };
    }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var node = grp[k];
      members.push(node);
      if (k === 'd' && !want.d) continue;
      var wantVal = k === 'y' ? want.y : (k === 'm' ? want.m : want.d);
      var okOne = false;
      if (node.tagName === 'SELECT') {
        okOne = setSelectByNumber(node, wantVal) && selectHasNumber(node, wantVal);
      } else if (isReadonlyPicker(node)) {
        okOne = !!(await fillReadonlyPicker(node, wantVal));
      } else {
        okOne = setNativeValue(node, wantVal) && readNumber(node) === parseInt(wantVal, 10);
      }
      if (k === 'y') yearOk = okOne;
      else if (k === 'm') monthOk = okOne;
      else if (k === 'd') dayOk = okOne;
    }
    var ok = (!needY || yearOk) && (!needM || monthOk) && (!grp.d || !want.d || dayOk);
    return { members: members, parts: grp, ok: ok, reason: ok ? '' : 'date_group_incomplete' };
  }

  /** 年 / 月 / 日 三件套合起来回读（单读年份那一格，审计会误判成「只填了年」） */
  function dateGroupReader(grp) {
    return function () {
      if (!grp || !grp.y) return '';
      var y = readNumber(grp.y);
      var m = grp.m ? readNumber(grp.m) : NaN;
      var d = grp.d ? readNumber(grp.d) : NaN;
      if (!y) return '';
      return y + (m ? '-' + m : '') + (m && d ? '-' + d : '');
    };
  }

  function readNumber(node) {
    if (!node) return NaN;
    var raw = node.tagName === 'SELECT'
      ? String(node.options[node.selectedIndex] ? node.options[node.selectedIndex].text : node.value)
      : String(node.value || '');
    return parseInt(String(raw).replace(/\D/g, ''), 10);
  }

  function selectHasNumber(sel, want) {
    if (!sel || sel.tagName !== 'SELECT') return false;
    var wantNum = parseInt(want, 10);
    for (var i = 0; i < sel.options.length; i++) {
      var raw = String(sel.options[i].value !== '' ? sel.options[i].value : sel.options[i].text || '').trim();
      var num = parseInt(raw.replace(/\D/g, ''), 10);
      if (raw === String(want) || (!isNaN(num) && num === wantNum)) return true;
    }
    return false;
  }

  /** 附近是否还有同组的年/月/日控件（用于 fail-closed：不写碎片） */
  function hasSiblingDateParts(el) {
    var box = el.closest
      ? el.closest('td, tr, .el-form-item, .ant-form-item, .form-item, .field, .form-group, .row, li, label')
      : null;
    if (!box) box = el.parentElement;
    if (!box) return false;
    var nodes = box.querySelectorAll('select, input');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === el) continue;
      var hint = [n.name, n.id, n.placeholder, n.getAttribute('aria-label'), String(n.className || '')].join(' ');
      if (/年|月|日|year|month|day/i.test(hint)) return true;
      if (n.tagName === 'SELECT' && maxOptionNumber(n) >= 1900) return true;
    }
    return false;
  }

  // ————— v1.3.4：日历网格型日期面板（‹‹ ‹ 十月 2026 › ›› + 星期表头 + 单月网格）—————


  function looksLikeWeekHeader(txt) {
    if (!S) return false;
    return S.looksLikeWeekHeader(txt);

  }

  function isCalendarGrid(panel) {
    if (!S) return false;
    return S.isCalendarGrid(panel);

  }

  function gridHeader(panel) {
    if (!S) return false;
    return S.gridHeader(panel);

  }

  /** 找翻页箭头：unit=year 用双箭头(d-arrow-*)，unit=month 用单箭头(arrow-*) */
  function pickArrow(panel, dir, unit) {
    if (!S) return false;
    return S.pickArrow(panel, dir, unit);

  }

  /** 面板自带「年 / 月」下拉或年份输入框时直接设值（flatpickr / laydate 风格） */
  function setPanelPeriod(panel, y, m) {
    if (!S) return false;
    return S.setPanelPeriod(panel, y, m);

  }

  /** 翻到目标年月：大差距用“十年”箭头，接近后逐月推进；12 秒硬预算防卡死 */
  async function gridNavigate(panel, y, m) {
    if (!S) return Promise.resolve(false);
    return S.gridNavigate(panel, y, m);

  }

  function gridClickDay(panel, day) {
    if (!S) return false;
    return S.gridClickDay(panel, day);

  }

  async function tryCalendarGrid(el, desired) {
    return S ? S.fillDate(el, desired, { order: ['grid-click'] }).then(function (r) { return !!r.ok; }) : false;
  }

  /** 把面板里的数字列表分组：年份组(>=1900) / 月份组(<=12) / 日期组(<=31) */
  function numericGroups(root) {
    if (!S) return false;
    return S.numericGroups(root);

  }

  /** 依次点 年 → 月 → 日；每步按“分组类型”重新定位（面板常被整体重渲染） */
  async function tryDatePanel(el, desired) {
    return S ? S.fillDate(el, desired, { order: ['panel-nav'] }).then(function (r) { return !!r.ok; }) : false;
  }

  /** 目标是否已是完整日期（允许 1998-05-20 / 1998/5/20 / 1998年05月20日） */
  /** 回读值的精度等级：exact / day-approx / month-only / mismatch（能力层缺失时退回布尔） */
  function dateMatchLevel(actual, desired) {
    if (D && D.matchLevel) return D.matchLevel(actual, desired).level;
    var a = parseDateParts(actual);
    var w = parseDateParts(desired);
    if (a && w && a.y === w.y && parseInt(a.m, 10) === parseInt(w.m, 10)) {
      if (!w.d || !a.d) return 'exact';
      return parseInt(a.d, 10) === parseInt(w.d, 10) ? 'exact' : 'mismatch';
    }
    return pickerValueMatches(actual, desired) ? 'exact' : 'mismatch';
  }

  function dateValueMatches(actual, desired) {
    // 零错填是红线（mismatch）；month-only 属于「日被控件吃掉」的降级，仍算填上但在 degraded 里标注
    var lv = dateMatchLevel(actual, desired);
    return lv === 'exact' || lv === 'day-approx' || lv === 'month-only';
  }

  function _legacyDateValueMatches(actual, desired) {
    var a = parseDateParts(actual);
    var w = parseDateParts(desired);
    if (a && w) {
      if (a.y !== w.y || parseInt(a.m, 10) !== parseInt(w.m, 10)) return false;
      if (!w.d || !a.d) return true;   // 只到年月的字段
      return parseInt(a.d, 10) === parseInt(w.d, 10);
    }
    return pickerValueMatches(actual, desired);
  }

  function findPagerNext() {
    var nodes = document.querySelectorAll('a, button, span, div, i, li');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.childElementCount) continue;
      var t = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^(下一页|下页|后一页|next|›|»|>)$/i.test(t)) continue;
      if (!isVisibleEl(n)) continue;
      if (n.disabled || /disabled/i.test(String(n.className || ''))) continue;
      return n;
    }
    return null;
  }

  /** 分页/翻页式下拉：点「下一页」直到出现目标项 */
  async function pageUntilFound(desired) {
    for (var i = 0; i < 20; i++) {
      var next = findPagerNext();
      if (!next) return [];
      simulateClick(next);
      await sleep(260);
      var c = pickVisibleCandidates(desired);
      if (c.length) return c;
    }
    return [];
  }

  // ————— v1.3.7：Ant Design DatePicker（年面板 / 月面板 / 日面板）—————

  var ANTD_DROPDOWN = '.ant-picker-dropdown';

  /** 关掉已打开的 antd 面板：同一表单里多个日期框的弹层会同时挂在 body 上 */
  function closeAllAntdPanels() {
    try {
      // antd v3 的日历不吃 Escape，点一下 body 才会走「点击外部关闭」
      if (antdV3Panel()) {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    } catch (_) { /* ignore */ }
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }));
    } catch (_) { /* ignore */ }
  }

  function antdPanel() {
    var list = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll(ANTD_DROPDOWN), function (n) {
        if (isVisibleEl(n)) list.push(n);
      });
    } catch (_) { /* ignore */ }
    return list.length ? list[list.length - 1] : null;
  }

  function antdHeaderView(panel) {
    var hv = panel.querySelector('.ant-picker-header-view');
    var txt = String((hv && hv.textContent) || '').replace(/\s+/g, ' ').trim();
    var y = txt.match(/(\d{4})/);
    var m = txt.match(/(\d{1,2})\s*月/);
    return { txt: txt, y: y ? parseInt(y[1], 10) : null, m: m ? parseInt(m[1], 10) : null };
  }

  function antdCells(panel) {
    var out = [];
    Array.prototype.forEach.call(panel.querySelectorAll('.ant-picker-cell'), function (td) {
      var inner = td.querySelector('.ant-picker-cell-inner') || td;
      var t = String(inner.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push({ td: td, text: t, inView: /ant-picker-cell-in-view/.test(String(td.className)), disabled: /ant-picker-cell-disabled/.test(String(td.className)) });
    });
    return out;
  }

  function antdNav(panel, dir, kind) {
    var sel = kind === 'year'
      ? (dir < 0 ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-super-next-btn')
      : (dir < 0 ? '.ant-picker-header-prev-btn' : '.ant-picker-header-next-btn');
    var b = panel.querySelector(sel);
    if (b && isVisibleEl(b)) return b;
    // 月/年面板没有 prev/next，只有 super 按钮（月面板的 super = ±1 年）
    var sel2 = dir < 0 ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-super-next-btn';
    var b2 = panel.querySelector(sel2);
    return b2 && isVisibleEl(b2) ? b2 : null;
  }

  function antdClickCell(panel, text) {
    var cells = antdCells(panel);
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].disabled) continue;
      if (cells[i].text === text) { simulateClick(cells[i].td); return true; }
    }
    return false;
  }

  /** 把视图翻到目标年（年面板按 10 年跳，月/日面板按 1 年跳） */
  async function antdGotoYear(panel, year, yearStep) {
    for (var guard = 0; guard < 40; guard++) {
      // React 每次翻页都会重建面板 DOM，必须每轮重新取，否则点的是已脱离文档的按钮
      var cur = antdPanel() || panel;
      var hv = antdHeaderView(cur);
      if (!hv.y) return false;
      if (hv.y === year) return true;
      var diff = year - hv.y;
      var btn = null;
      if (yearStep >= 10 && Math.abs(diff) >= 10) {
        btn = antdNav(cur, diff < 0 ? -1 : 1, 'year');
      }
      if (!btn) btn = antdNav(cur, diff < 0 ? -1 : 1, 'month');
      if (!btn) return false;
      simulateClick(btn);
      await sleep(yearStep >= 10 ? 140 : 120);
    }
    return false;
  }

  /**
   * Ant Design v3 日历（.ant-calendar）：面板自带 .ant-calendar-input 可直接键入；
   * 退化路径走「年份面板 → 月份面板 → 日格」。v3 的超级箭头只按年，翻上百个月点不动，
   * 所以不能用通用 gridNavigate。
   */
  async function tryAntdV3Calendar(el, desired) {
    var parts = parseDateParts(desired);
    if (!parts) return false;
    var panel = antdV3Panel();
    if (!panel) return false;
    var y = parseInt(parts.y, 10);
    var m = parseInt(parts.m, 10);
    var day = String(parts.d ? parseInt(parts.d, 10) : 1);

    // (1) 面板输入框直写：v3 的 CalendarInput 认 Enter
    var input = panel.querySelector('.ant-calendar-input');
    if (input) {
      var want = parts.y + '-' + ('0' + m).slice(-2) + '-' + ('0' + day).slice(-2);
      try {
        input.focus();
        var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(input, want);
        else input.value = want;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) { /* ignore */ }
      await sleep(120);
      try {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      } catch (_) { /* ignore */ }
      await sleep(320);
      if (dateValueMatches(el.value, desired)) return true;
    }

    // (2) 年份 → 月份 → 日
    panel = antdV3Panel() || panel;
    var header = String((panel.querySelector('.ant-calendar-header') || {}).textContent || '');
    var hm = header.match(/(\d{4})\s*年/);
    if (!hm || parseInt(hm[1], 10) !== y) {
      var yearSelect = panel.querySelector('.ant-calendar-year-select');
      if (yearSelect) {
        simulateClick(yearSelect);
        await sleep(220);
        var yearPanel = Array.prototype.filter.call(document.querySelectorAll('.ant-calendar-year-panel'), isVisibleEl).pop();
        var yearCell = yearPanel && Array.prototype.filter.call(
          yearPanel.querySelectorAll('.ant-calendar-year-panel-year'),
          function (n) { return String(n.textContent || '').trim() === String(y) && !/disabled/.test(String(n.className)); }
        )[0];
        if (yearCell) { simulateClick(yearCell); await sleep(260); }
      }
    }

    panel = antdV3Panel() || panel;
    var h2 = String((panel.querySelector('.ant-calendar-header') || {}).textContent || '');
    var mm = h2.match(/(\d{1,2})\s*月/);
    if (!mm || parseInt(mm[1], 10) !== m) {
      var monthSelect = panel.querySelector('.ant-calendar-month-select');
      if (monthSelect) {
        simulateClick(monthSelect);
        await sleep(220);
        var monthPanel = Array.prototype.filter.call(document.querySelectorAll('.ant-calendar-month-panel'), isVisibleEl).pop();
        var monthCell = monthPanel && Array.prototype.filter.call(
          monthPanel.querySelectorAll('.ant-calendar-month-panel-month'),
          function (n) { return String(n.textContent || '').trim() === (m + '月') && !/disabled/.test(String(n.className)); }
        )[0];
        if (monthCell) { simulateClick(monthCell); await sleep(260); }
      }
    }

    panel = antdV3Panel() || panel;
    var dayCell = Array.prototype.filter.call(
      panel.querySelectorAll('td.ant-calendar-cell'),
      function (td) {
        var cls = String(td.className || '');
        return !/last-month|next-month|disabled/.test(cls) && isVisibleEl(td);
      }
    ).filter(function (td) {
      return String((td.querySelector('.ant-calendar-date') || td).textContent || '').trim() === day;
    })[0];
    if (dayCell) {
      simulateClick(dayCell);
      await sleep(280);
      return dateValueMatches(el.value, desired);
    }
    return false;
  }

  /** Ant Design 日期面板（年 / 月 / 日三种模式） */
  async function tryAntdPanel(el, desired) {
    var parts = parseDateParts(desired);
    if (!parts) return false;
    var panel = antdPanel();
    if (!panel) return false;
    var y = parseInt(parts.y, 10);
    var m = parseInt(parts.m, 10);
    var cells = antdCells(panel);
    var monthMode = cells.some(function (c) { return /^\d{1,2}\s*月$/.test(c.text); });
    var yearMode = cells.some(function (c) { return /^\d{4}\s*年$/.test(c.text); });
    if (yearMode) {
      await antdGotoYear(panel, y, 10);
      if (!antdClickCell(panel, y + '年')) return false;
      await sleep(220);
      panel = antdPanel() || panel;
      cells = antdCells(panel);
      monthMode = cells.some(function (c) { return /^\d{1,2}\s*月$/.test(c.text); });
    }
    if (monthMode) {
      var want = y + '-' + ('0' + m).slice(-2);

      function monthCellReady() {
        var pp = antdPanel() || panel;
        var cell = pp.querySelector('.ant-picker-cell[title="' + want + '"]');
        return cell && !/ant-picker-cell-disabled/.test(String(cell.className)) ? cell : null;
      }

      var hit = monthCellReady();
      if (!hit) {
        // 月面板只有 super-prev/super-next（= ±1 年）：逐年翻到目标年。
        // 每轮重新取面板，点击后立刻检查目标格子，避免 React 重建 DOM 后的陈旧引用。
        for (var gy = 0; gy < 40; gy++) {
          var py = antdPanel() || panel;
          var hvy = antdHeaderView(py);
          if (!hvy.y || hvy.y === y) break;
          var nvy = antdNav(py, hvy.y < y ? 1 : -1, 'month');
          if (!nvy) break;
          simulateClick(nvy);
          await sleep(90);
          if (monthCellReady()) break;
        }
        hit = monthCellReady();
      }
      if (hit) {
        simulateClick(hit);
        await sleep(260);
        if (dateValueMatches(el.value, desired)) return true;
      }
      // 最后：按文字点月（老版本 antd 无 title）
      panel = antdPanel() || panel;
      if (!antdClickCell(panel, m + '月')) return false;
      await sleep(260);
      return dateValueMatches(el.value, desired);
    }

    return false;   // 日面板交给通用网格逻辑
  }

  /** antd 范围选择器里左右两个面板 */
  function antdSubPanels() {
    var dd = antdPanel();
    if (!dd) return [];
    return Array.prototype.filter.call(dd.querySelectorAll('.ant-picker-panel'), isVisibleEl);
  }

  /**
   * 在 antd 日历里点上某一天。
   * antd v5 的日格子带 title="YYYY-MM-DD"，按 title 找最省事；
   * 当前不在那一页时先翻年/月（年面板点年、月面板点月、日面板翻月）。
   * @param {Element|null} scope 指定面板（范围选择器有左右两个），null = 取最后打开的弹层
   */
  async function antdPickDay(scope, y, m, d) {
    var target = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
    var pinned = !!scope;
    for (var guard = 0; guard < 40; guard++) {
      var panel = (pinned && scope && scope.isConnected) ? scope : antdPanel();
      if (!panel) return false;
      var cell = panel.querySelector('.ant-picker-cell[title="' + target + '"]');
      if (cell) {
        if (/ant-picker-cell-disabled/.test(String(cell.className))) return false;
        simulateClick(cell);
        await sleep(260);
        return true;
      }
      var cells = antdCells(panel);
      if (cells.some(function (c) { return /^\d{4}\s*年$/.test(c.text); })) {
        if (!(await antdGotoYear(panel, y, 10))) return false;
        var py = (pinned && scope && scope.isConnected) ? scope : antdPanel();
        if (!py || !antdClickCell(py, y + '年')) return false;
        await sleep(240);
        continue;
      }
      if (cells.some(function (c) { return /^\d{1,2}\s*月$/.test(c.text); })) {
        var hv = antdHeaderView(panel);
        if (hv.y && hv.y !== y) await antdGotoYear(panel, y, 1);
        var pm = (pinned && scope && scope.isConnected) ? scope : antdPanel();
        if (!pm || !antdClickCell(pm, m + '月')) return false;
        await sleep(240);
        continue;
      }
      var hv2 = antdHeaderView(panel);
      if (!hv2.y) return false;
      // 跨年时先点「年份」进年面板，一下跳到位；逐月翻 3 年得点 30 多次，太慢
      var yearBtn = panel.querySelector('.ant-picker-header-year-btn');
      if (yearBtn && isVisibleEl(yearBtn) && hv2.y !== y) {
        simulateClick(yearBtn);
        await sleep(200);
        continue;
      }
      var wantIdx = y * 12 + m;
      var curIdx = hv2.y * 12 + (hv2.m || 1);
      if (wantIdx === curIdx) return false;   // 已经在目标月却没有这一天
      var btn = panel.querySelector(wantIdx > curIdx ? '.ant-picker-header-next-btn' : '.ant-picker-header-prev-btn');
      if (!btn || !isVisibleEl(btn)) return false;
      simulateClick(btn);
      await sleep(140);
    }
    return false;
  }

  /** 单个 antd 日期框：打开弹层 → 点到目标日 → 核对输入框 */
  async function tryAntdDayCell(el, desired) {
    var p = parseDateParts(desired);
    if (!p) return false;
    var y = parseInt(p.y, 10);
    var m = parseInt(p.m, 10);
    var d = p.d ? parseInt(p.d, 10) : 1;
    if (!y || !m) return false;
    if (!antdPanel()) {
      openPicker(el);
      if (!(await waitForAntdPanel(1000))) return false;
    }
    var ok = await antdPickDay(null, y, m, d);
    if (!ok) return false;
    return dateValueMatches(el.value, desired);
  }

  /**
   * antd 范围选择器（.ant-picker-range，快手教育经历的「起止时间」）：
   * 两个 input 都是 readonly，只能点面板：先在左面板点开始日，再在右面板点结束日。
   */
  async function fillAntdRangePicker(editor, startVal, endVal) {
    var ins = editor.querySelectorAll('input');
    if (ins.length < 2) return false;
    var start = rangeDateOf(startVal, false);
    var end = rangeDateOf(endVal, true);
    if (!start || !end || end.getTime() < start.getTime()) return false;
    closeAllAntdPanels();
    await sleep(160);
    openPicker(ins[0]);
    if (!(await waitForAntdPanel(1100))) return false;
    var okStart = await antdPickDay(antdSubPanels()[0] || null, start.getFullYear(), start.getMonth() + 1, start.getDate());
    if (!okStart) return false;
    // 选完开始日，焦点会自动跳到结束日，右面板跟着翻页
    await sleep(240);
    var panels = antdSubPanels();
    var right = panels.length > 1 ? panels[panels.length - 1] : null;
    var okEnd = await antdPickDay(right, end.getFullYear(), end.getMonth() + 1, end.getDate());
    await sleep(200);
    closeAllAntdPanels();
    if (!okEnd) return false;
    var a = String(ins[0].value || '').trim();
    var b = String(ins[1].value || '').trim();
    return !!a && !!b && dateValueMatches(a, formatDateYmd(start)) && dateValueMatches(b, formatDateYmd(end));
  }

  /**
   * 绕开日历直接改组件值：调它自己的 onChange（Form 就是靠这个存值的）。
   * v1.5.24：实现搬到 content/page-bridge.js（页面主环境）——隔离环境里根本读不到 fiber / Vue 实例。
   * 桥接按 antd 3（handleChange）→ antd 4/5（最外层 rc-picker 的 onChange）→ Vue 2 → Vue 3 依次尝试。
   */
  function fillAntdPickerByModel(el, startVal, endVal) {
    var isRange = !!(el.closest && (el.closest('.ant-picker-range') ||
      (el.classList && el.classList.contains('ant-calendar-range-picker-input'))));
    var s = rangeDateOf(startVal, false);
    if (!s) return false;
    var e = isRange ? rangeDateOf(endVal, true) : null;
    if (isRange && (!e || e.getTime() < s.getTime())) return false;
    return bridgeDateCommit(el, s, e);
  }

  /** 打开只读控件的弹层：先 focus（Element 的 el-date-picker 监听 focus），再 click，再点右侧日历图标 */
  function openPicker(el) {
    // antd v3：只认「原生 click」（合成事件它不接）；面板开着时再点会关掉，所以先判重
    if (isAntdV3Picker(el)) {
      try { if (el.focus) el.focus(); } catch (_) { /* ignore */ }
      if (antdV3Panel()) return;
      try { el.click(); } catch (_) { simulateClick(el); }
      return;
    }
    // antd：合成事件打不开日历，直接调它自己的 onMouseDown（等于真点击）
    if (isAntdPickerEl(el)) {
      try { if (el.focus) el.focus(); } catch (_) { /* ignore */ }
      var root = (el.closest && el.closest('.ant-picker, .ant-calendar-picker')) || el;
      var rh = bridgeCall(root, 'reactHandler', { name: 'onMouseDown' });
      if (rh && rh.ok) return;
    }
    try { if (el.focus) el.focus(); } catch (_) { /* ignore */ }
    try {
      el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    } catch (_) { /* 老浏览器不支持 FocusEvent */ }
    // antd 5 的 Picker 监听 pointerdown；其它站点多派发一次会被当成二次点击（开了又关）
    try {
      if (isAntdPickerEl(el) && typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
      }
    } catch (_) { /* ignore */ }
    simulateClick(el);
    var box = el.parentElement;
    if (box) {
      var icon = box.querySelector('i[class*="date"], .el-input__icon, [class*="date-icon"]');
      if (icon) {
        setTimeout(function () { try { simulateClick(icon); } catch (_) { /* ignore */ } }, 140);
      }
    }
  }

  /** 按 data-fmt / placeholder 格式化日期 */
  function formatDateByHint(el, desired) {
    var p = parseDateParts(desired);
    if (!p) return String(desired);
    var fmt = String(el.getAttribute('data-fmt') || el.getAttribute('format') || el.getAttribute('data-format') || '');
    // v1.5.23：统一走能力层的格式识别（含 placeholder 写明的 YYYY/MM、yyyy年mm月、例：2020-09）
    if (D && D.detectFormat) {
      var f2 = D.detectFormat(fmt) || D.detectFormat(el.getAttribute('placeholder') || '');
      if (f2) return D.formatModel(D.parseModel(desired), f2);
    }
    var mm = ('0' + p.m).slice(-2);
    var dd = ('0' + p.d).slice(-2);
    if (/yyyy\/MM\/dd/i.test(fmt)) return p.y + '/' + mm + '/' + dd;
    if (/yyyy年MM月dd日/.test(fmt)) return p.y + '年' + mm + '月' + dd + '日';
    if (/yyyy-MM-dd/i.test(fmt)) return p.y + '-' + mm + '-' + dd;
    if (/yyyy-MM/i.test(fmt)) return p.y + '-' + mm;
    if (/^yyyy$/i.test(fmt)) return p.y;
    return desired;
  }

  /** 最后一招：只读框直接写值（readonly 只挡用户输入，挡不住脚本），并派发 input/change/blur */
  function forceSetReadonly(el, desired) {
    var v = formatDateByHint(el, desired);
    try {
      var desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (desc && desc.set) desc.set.call(el, v);
      else el.value = v;
    } catch (_) {
      el.value = v;
    }
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (_) { /* ignore */ }
    return String(el.value || '').trim() !== '';
  }

  function isAntdPickerEl(el) {
    try { return !!(el && el.closest && el.closest('.ant-picker, .ant-calendar-picker')); } catch (_) { return false; }
  }

  /** 等 antd 弹层真正挂上 DOM（首帧可能还没渲染） */
  function waitForAntdPanel(ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var p = antdPanel() || antdV3Panel();
        if (p) return resolve(p);
        if (Date.now() - t0 > ms) return resolve(null);
        setTimeout(poll, 60);
      })();
    });
  }

  function fillReadonlyPicker(el, desired) {
    return isAntdPickerEl(el) ? fillReadonlyPickerAntd(el, desired) : fillReadonlyPickerLegacy(el, desired);
  }

  /** antd（受控组件）专用：等弹层 → 年/月/日面板 → 不做只读直写 */
  function fillReadonlyPickerAntd(el, desired) {
    var before = String(el.value || '');
    return new Promise(function (resolve) {
      // Escape 关掉上一个弹层后要给它一点时间收尾，否则紧接着的 mousedown 会被吞掉
      closeAllAntdPanels();
      setTimeout(function () { openPicker(el); }, 160);
      setTimeout(async function () {
        try {
        // ⓿ Ant Design 面板：先等弹层挂载再判定年/月/日模式
        var waited = await waitForAntdPanel(900);
        if (!waited) {
          // 二次尝试：上一个下拉关闭时可能抢回焦点，导致首次点击被吞
          closeAllAntdPanels();
          await sleep(260);
          openPicker(el);
          waited = await waitForAntdPanel(1100);
        }
        // 只有 antd 控件才要求弹层；其它站点（Element/自定义面板）走下面的老路径
        if (!waited && isAntdPickerEl(el)) {
          try { el.blur(); } catch (_) { /* ignore */ }
          closeAllAntdPanels();
          resolve(false);
          return;
        }
        var parts = parseDateParts(desired);
        // 面板已打开：按策略层固定顺序试（fiber 直写 → v3 面板 → antd 面板 → 日格 → 通用面板/网格），
        // 每步写完立刻回读判级，exact 即停；顺序由 STRATEGY_ORDER 决定，这里不再硬编码先后。
        if (waited && S && S.fillDate) {
          var res = null;
          try {
            res = await S.fillDate(el, desired, {
              order: ['fiber-props', 'panel-input', 'panel-nav', 'grid-click'],
              budgetMs: 9000
            });
          } catch (_) { res = null; }
          if (res) lastDateTries = res.attempts || [];
          if (res && res.ok) { resolve(true); return; }
          // 策略层没搞定：antd 受控组件直写不可靠，重开面板再走候选路径
          openPicker(el);
          await sleep(300);
        }
        var cands = pickVisibleCandidates(desired);
        if (!cands.length) {
          cands = await pageUntilFound(desired);
        }
        if (!cands.length) {
          resolve(isAntdPickerEl(el) ? false : (forceSetReadonly(el, desired) ? 'forced' : false));
          return;
        }
        var i = 0;
        var tryNext = function () {
          if (i >= cands.length) {
            // 全部失败：尽量还原原值，避免留下错值
            if (String(el.value || '') !== before) {
              try { openPicker(el); } catch (_) { /* ignore */ }
            }
            // 最后一招：只读框直写（jQuery 表单可以，antd 受控组件不行）
            resolve(isAntdPickerEl(el) ? false : (forceSetReadonly(el, desired) ? 'forced' : false));
            return;
          }
          simulateClick(cands[i].el);
          i += 1;
          setTimeout(function () {
            if (dateValueMatches(el.value, desired)) { resolve(true); return; }
            // 弹层可能已被关闭，重新打开再试下一个候选
            if (i < cands.length) simulateClick(el);
            setTimeout(tryNext, i < cands.length ? 260 : 0);
          }, 300);
        };
        tryNext();
        } catch (err) {
          // 策略链里任何异常都不许挂死整轮填充（之前少这层，抛错后 resolve 永不调用 → 「正在填写…」卡死）
          try { if (S) lastDateTries.push({ id: 'error', level: String((err && err.message) || err).slice(0, 60) }); } catch (_) { /* ignore */ }
          try { el.blur(); } catch (_) { /* ignore */ }
          try { closeAllAntdPanels(); } catch (_) { /* ignore */ }
          resolve(false);
        }
      }, 640);
    });
  }

  /** 非 antd 站点：沿用 v1.5.3 的原有流程 */
  function fillReadonlyPickerLegacy(el, desired) {
    var before = String(el.value || '');
    openPicker(el);
    return new Promise(function (resolve) {
      setTimeout(async function () {
        // ① 先试「年 / 月 / 日」多表格日期面板
        var parts = parseDateParts(desired);
        // ⓿ Ant Design 面板（年/月/日三种模式）
        var antdOk = await tryAntdPanel(el, desired);
        if (antdOk && dateValueMatches(el.value, desired)) { resolve(true); return; }
        var pid = parts ? findDatePanel(parts.y) : null;
        if (parts && pid) {
          // ② 日历网格（‹‹ ‹ 十月 2026 › ›› + 星期表头）走翻月 + 点日；其余走年/月/日分栏
          var panelOk = isCalendarGrid(pid)
            ? await tryCalendarGrid(el, desired)
            : await tryDatePanel(el, desired);
          if (panelOk && dateValueMatches(el.value, desired)) { resolve(true); return; }
          // 面板路径失败：重开再走普通候选路径
          openPicker(el);
          await sleep(300);
        }
        var cands = pickVisibleCandidates(desired);
        if (!cands.length) {
          cands = await pageUntilFound(desired);
        }
        if (!cands.length) { resolve(forceSetReadonly(el, desired) ? 'forced' : false); return; }
        var i = 0;
        var tryNext = function () {
          if (i >= cands.length) {
            // 全部失败：尽量还原原值，避免留下错值
            if (String(el.value || '') !== before) {
              try { openPicker(el); } catch (_) { /* ignore */ }
            }
            // 最后一招：只读框直写（该站点是 jQuery 表单，保存时读 input.value）
            resolve(forceSetReadonly(el, desired) ? 'forced' : false);
            return;
          }
          simulateClick(cands[i].el);
          i += 1;
          setTimeout(function () {
            if (dateValueMatches(el.value, desired)) { resolve(true); return; }
            // 弹层可能已被关闭，重新打开再试下一个候选
            if (i < cands.length) simulateClick(el);
            setTimeout(tryNext, i < cands.length ? 260 : 0);
          }, 300);
        };
        tryNext();
      }, 420);
    });
  }

  /** 取 radio 的选项文案 */
  function radioOptionText(radio) {
    var lab = radio.closest ? radio.closest('label') : null;
    if (lab) {
      var t = M.visibleLabelText ? M.visibleLabelText(lab) : lab.textContent;
      t = String(t || '').replace(/\s+/g, ' ').trim();
      if (t) return t.slice(0, 30);
    }
    var p = radio.parentElement;
    return String((p && p.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  }

  /** 无名 radio 分组：同一容器内 ≥2 个无 name 的 radio */
  function collectUnnamedRadioGroups() {
    var radios = Array.from(document.querySelectorAll('input[type=radio]')).filter(function (r) {
      return !r.disabled && !r.name && r.offsetParent;
    });
    var groups = [];
    var used = {};
    radios.forEach(function (r) {
      if (used[r.id || ''] && r.id) return;
      var node = r.parentElement;
      for (var up = 0; up < 4 && node; up++, node = node.parentElement) {
        var inside = Array.from(node.querySelectorAll('input[type=radio]')).filter(function (x) {
          return !x.disabled && !x.name && x.offsetParent;
        });
        if (inside.length >= 2 && String(node.textContent || '').length < 180) {
          if (groups.indexOf(node) === -1) groups.push(node);
          return;
        }
      }
    });
    return groups;
  }

  /** 组文案：容器内非选项文本的首段，或前一个兄弟节点 */
  function radioGroupLabelName(container) {
    var texts = [];
    var walk = function (node, depth) {
      if (depth > 2 || !node) return;
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (!kid || kid.nodeType !== 1) continue;
        if (/^(INPUT|LABEL)$/i.test(kid.tagName)) continue;
        var t = String(kid.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 24 && !/^[男女是否]$/.test(t)) { texts.push(t); return; }
        walk(kid, depth + 1);
        if (texts.length) return;
      }
    };
    walk(container, 0);
    if (texts.length) return texts[0];
    // v1.5.12：antd v3 的 label 在另一列（.ant-form-item-label），兄弟节点里找不到
    var item = container.closest && container.closest('.ant-form-item, .form-item, .field, .form-row, tr');
    if (item) {
      var lab = item.querySelector('label');
      if (lab) {
        var lt = String(lab.textContent || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim();
        if (lt && lt.length <= 24) return lt;
      }
    }
    var prev = container.previousElementSibling;
    if (prev) {
      var t2 = String(prev.textContent || '').replace(/\s+/g, ' ').trim();
      if (t2 && t2.length <= 24) return t2;
    }
    return '';
  }

  function normalizeChoiceText(s) {
    return String(s || '').replace(/[\s\u3000:：*]/g, '').toLowerCase();
  }

  /** 在组内按 profile 值选中对应 radio（只点，不伪造 value） */
  function fillRadioGroup(container, key, value) {
    var want = normalizeChoiceText(value);
    if (!want) return false;
    var radios = Array.from(container.querySelectorAll('input[type=radio]')).filter(function (r) {
      return !r.disabled && !r.name && r.offsetParent;
    });
    for (var i = 0; i < radios.length; i++) {
      var opt = normalizeChoiceText(radioOptionText(radios[i]));
      if (!opt) continue;
      if (opt !== want && negationConflict(opt, want)) continue;
      if (opt === want || (opt.length >= 2 && want.indexOf(opt) !== -1)) {
        var lab = radios[i].closest && radios[i].closest('label');
        if (lab && lab.classList && lab.classList.contains('ant-radio-wrapper') && typeof lab.click === 'function') {
          // antd v3 的 Radio：合成事件不触发 onChange，原生 click 才行
          lab.click();
        } else {
          simulateClick(radios[i]);
        }
        if (!radios[i].checked) { try { (lab || radios[i]).click(); } catch (_) { /* ignore */ } }
        if (radios[i].checked) { highlight(radios[i]); return true; }
        return false;   // 点了没选上：别再去点别的选项
      }
    }
    return false;
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
    lastDateTries = [];
    fillRecords = [];
    ymPartial = [];
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
    fillRecords = [];
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
