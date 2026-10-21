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
  if (!M) {
    console.warn('[简历填写工具] ResumeAutofillMatch 未加载');
    return;
  }

  var MAX_FILLS_PER_KEY = M.MAX_FILLS_PER_KEY;

  function getLabelText(el) {
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
    var parentLabel = el.closest('label');
    if (parentLabel) {
      var tWrap = M.visibleLabelText(parentLabel);
      if (tWrap) return tWrap;
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
      if (tForm) return tForm;
    }
    // 4. previousElementSibling
    var prev = el.previousElementSibling;
    if (prev && /^(LABEL|SPAN|DIV|P|STRONG)$/i.test(prev.tagName)) {
      var tPrev = M.visibleLabelText
        ? M.visibleLabelText(prev)
        : String(prev.textContent || '');
      tPrev = String(tPrev || '').replace(/\s+/g, ' ').trim();
      if (M.cleanLabelPunctuation) tPrev = M.cleanLabelPunctuation(tPrev);
      if (tPrev) return tPrev;
    }
    // 5. parent's previousElementSibling (label-col | control-col)
    if (M.labelTextFromParentPrevSibling) {
      var tCol = M.labelTextFromParentPrevSibling(el);
      if (tCol) return tCol;
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
        if (tCell && tCell.length <= 40) return tCell;
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
        if (tPv && tPv.length <= 40) return tPv;
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
    // v1.5.5：北森 Phoenix 的区块标题在 .form 的孪生 div 上（同 id），不在祖先链里
    var phoenixForm = el && el.closest ? el.closest('.form[id*="_Recruitment_"]') : null;
    if (phoenixForm) {
      var pCtx = sectionContextFromText(phoenixFormTitle(phoenixForm));
      if (pCtx) return pCtx;
    }
    var node = el;
    for (var up = 0; up < 7 && node && node.parentElement; up++) {
      var text = '';
      if (node.tagName === 'FIELDSET') {
        var lg = node.querySelector('legend');
        if (lg) text = String(lg.textContent || '').trim();
      }
      if (!text && node.querySelector) {
        var head = node.querySelector(':scope > legend, :scope > h2, :scope > h3, :scope > h4, :scope > summary, :scope > .section-title, :scope > .ant-card-head-title, :scope > .el-card__header, :scope > .panel-heading');
        if (head) text = String(head.textContent || '').replace(/\s+/g, ' ').trim();
      }
      if (text && text.length <= 24) {
        var ctx = sectionContextFromText(text);
        if (ctx) return ctx;
      }
      node = node.parentElement;
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
      mentor: { field: 'mentor', key: 'advisorName' },
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
      time: { field: 'time', key: 'awardDate' },
      remark: { field: 'desc', key: 'awardDescription' }
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

  var STRUCT_LIST_KEY = { education: 'eduList', work: 'workList', project: 'projectList', paper: 'awardList' };

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
    var list = profile && Array.isArray(profile[struct.listKey]) ? profile[struct.listKey] : [];
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

  function addButtonCandidates() {
    var nodes = document.querySelectorAll('button, a, [role="button"], .ant-btn, .el-button, span, div, i');
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
      var head = node.querySelector ? node.querySelector(':scope > legend, :scope > h2, :scope > h3, :scope > h4, :scope > summary, :scope > .section-title, :scope > .ant-card-head-title, :scope > .panel-heading') : null;
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
    var list = profile && Array.isArray(profile[rule.listKey]) ? profile[rule.listKey] : [];
    if (list.length) return list.length;
    // 没有多段数据时，若扁平字段有值就展开 1 条
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
    var m = nodeText(header).match(/(\d+)\s*(?:$|[）)])/);
    if (m) {
      index = Math.max(0, parseInt(m[1], 10) - 1);
    } else if (row && row.parentElement) {
      var sibs = Array.prototype.filter.call(row.parentElement.children, function (n) {
        return n.classList && n.classList.contains('list-form-container');
      });
      var pos = sibs.indexOf(row);
      if (pos > 0) index = pos;
    }
    return { rule: rule, index: index };
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
    var inputs = Array.prototype.filter.call(editor.querySelectorAll('input'), function (i) {
      return !i.disabled && !i.readOnly;
    });
    if (inputs.length < 2) return false;
    var start = rangeDateOf(startVal, false);
    var end = rangeDateOf(endVal, true);
    if (!start || !end) return false;
    if (end.getTime() < start.getTime()) return false;
    var vm = editor.__vue__ || (editor.querySelector('.el-range-input') || {}).__vue__;
    var committed = false;
    try {
      if (vm && vm.picker && vm.picker.$emit) {
        // 点日历格子走的就是这个 pick 事件：v-model 与两个 input 一起更新
        vm.picker.$emit('pick', [start, end], true);
        committed = true;
      } else if (vm && vm.$emit) {
        vm.$emit('input', [start, end]);
        committed = true;
      }
    } catch (_) { /* ignore */ }
    if (!committed) {
      // 没有 Vue 实例的兜底：只派发 input（el-range-input 派发 change 会触发
      // Element 的 handleStartChange/handleEndChange，未提交时读 this.value 直接抛错）
      setInputRaw(inputs[0], formatDateYmd(start));
      setInputRaw(inputs[1], formatDateYmd(end));
    }
    await sleep(120);
    try { if (vm && typeof vm.handleClose === 'function') vm.handleClose(); } catch (_) { /* ignore */ }
    await sleep(120);
    if (!committed) return false;
    return !!String(inputs[0].value || '').trim() && !!String(inputs[1].value || '').trim();
  }

  /** 页面上的范围日期控件：按分区/段序取 eduList[i].start/end 等 */
  async function fillRangeEditors(profile, handled, filledKeys) {
    var editors = Array.prototype.filter.call(document.querySelectorAll(RANGE_EDITOR_SEL), isVisibleEl);
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
      var ctx = rangeContext(ed);
      if (!ctx) continue;
      var map = RANGE_SECTION_MAP[ctx.rule.key];
      var list = profile && Array.isArray(profile[map.listKey]) ? profile[map.listKey] : [];
      var item = list[ctx.index] || null;
      var start = item && item.start ? String(item.start).trim() : '';
      var end = item && item.end ? String(item.end).trim() : '';
      if (!start) start = M.profileValue(profile, map.startKey) || '';
      if (!end) end = M.profileValue(profile, map.endKey) || '';
      if (!start || !end) continue;
      if (!(await fillRangeEditor(ed, start, end))) continue;
      filled += 1;
      [map.startKey, map.endKey].forEach(function (k) {
        if (filledKeys.indexOf(k) === -1) filledKeys.push(k);
      });
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

  function isSkippable(el) {
    var t = (el.type || '').toLowerCase();
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
  function commitFrameworkWidget(el, value) {
    if (!el || !el.closest) return false;
    var numBox = el.closest('.el-input-number');
    if (numBox && numBox.__vue__) {
      var raw = String(value == null ? '' : value).trim();
      var n = Number(raw.replace(/[^\d.\-]/g, ''));
      if (raw && isFinite(n)) {
        try { numBox.__vue__.$emit('input', n); return true; } catch (_) { /* ignore */ }
      }
    }
    var dateBox = el.closest('.el-date-editor');
    if (dateBox && dateBox.__vue__ && !/el-range-editor/.test(String(dateBox.className))) {
      var parts = parseDateParts(value);
      if (!parts) return false;
      var d = new Date(parseInt(parts.y, 10), parseInt(parts.m, 10) - 1,
        parts.d ? parseInt(parts.d, 10) : 1);
      var vf = String(dateBox.__vue__.valueFormat || '');
      var out = d;
      if (vf) out = /月/.test(vf) ? (parts.y + '-' + ('0' + parts.m).slice(-2)) : formatDateYmd(d);
      try { dateBox.__vue__.$emit('input', out); return true; } catch (_) { /* ignore */ }
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
  function clickCurrentJobToggle(el) {
    if (!el || !el.parentElement) return false;
    var node = el;
    for (var up = 0; up < 4 && node && node.parentElement; up++) {
      node = node.parentElement;
      var boxes = node.querySelectorAll('input[type="checkbox"], [role="switch"], [role="checkbox"], .ant-checkbox, .ant-switch, .el-checkbox');
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (!isVisibleEl(b)) continue;
        var txt = String(b.parentElement ? b.parentElement.textContent : b.textContent || '').replace(/\s+/g, '');
        var near = txt || String(b.getAttribute('aria-label') || '') + String(b.title || '');
        // 控件自身没有文案时，看它所在 label/兄弟文本
        if (!/至今|在职|目前|现在|present|current|now/i.test(near)) {
          var row = b.closest('label, .ant-checkbox-wrapper, .el-checkbox, li, div');
          var rowTxt = row ? String(row.textContent || '').replace(/\s+/g, '') : '';
          if (!/至今|在职|目前|现在|present|current|now/i.test(rowTxt)) continue;
        }
        var cb = b.tagName.toLowerCase() === 'input' ? b : b.querySelector('input[type="checkbox"]');
        if (cb) {
          if (cb.checked) return true;
          simulateClick(cb);
          return true;
        }
        simulateClick(b);
        return true;
      }
    }
    return false;
  }

  function isReadonlyPicker(el) {
    if (!el || el.disabled || !el.readOnly) return false;
    var t = (el.type || 'text').toLowerCase();
    return t === 'text' || t === 'search' || t === 'tel' || t === 'number';
  }

  function simulateClick(el) {
    if (!el) return;
    // SVG 元素没有 el.click()，统一派发 click 事件（北森字典/地区的勾选热区就是 svg）
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } catch (_) {
      try { el.click(); } catch (e) { /* ignore */ }
    }
  }

  // ————— v1.5.0：自定义下拉适配器（Element / Ant / dictionary / listbox）—————

  var CUSTOM_SELECT_HOST =
    '.el-select, .ant-select, .dictionary-selector, .form-select, .phoenix-select, [role="combobox"]';
  var DROPDOWN_OPTION_SEL =
    '[role="option"], .el-select-dropdown__item, .el-option, .ant-select-item-option, ' +
    '.ant-select-item, .dictionary-option, .option-item, .select-option, li.el-select-dropdown__item';

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
  function hostDropdownOptions(host) {
    if (!host || !host.querySelector) return null;
    var dd = host.querySelector('.el-select-dropdown, .ant-select-dropdown');
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

  function findCustomSelectHost(el) {
    if (!el || !el.closest) return null;
    return el.closest(CUSTOM_SELECT_HOST);
  }

  function customSelectLooksFilled(host) {
    if (!host) return false;
    var txt = '';
    var selected = host.querySelector(
      '.el-select__selected-item, .el-input__inner, .ant-select-selection-item, .ant-select-selection-search-input, .selected-text, [class*="selected"]'
    );
    if (selected) {
      txt = String(selected.textContent || selected.value || '').replace(/\s+/g, ' ').trim();
    }
    if (!txt) {
      var inp = host.querySelector('input');
      if (inp) txt = String(inp.value || '').replace(/\s+/g, ' ').trim();
    }
    if (!txt || /请选择|请输入|select|choose|--/i.test(txt)) return false;
    return true;
  }

  function collectOpenDropdownOptions() {
    var nodes = document.querySelectorAll(DROPDOWN_OPTION_SEL);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!isVisibleEl(n)) continue;
      var txt = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 80 || PICKER_BLOCK_RE.test(txt)) continue;
      out.push({ el: n, text: txt, value: n.getAttribute('data-value') || txt });
    }
    return out;
  }

  function openCustomSelect(host) {
    if (!host) return;
    var clickTarget =
      host.querySelector('.el-input__inner, .ant-select-selector, .el-select__wrapper, [role="combobox"], input') ||
      host;
    simulateClick(clickTarget);
  }

  /**
   * 写自定义下拉：点击展开 → 按文案匹配选项 → 点击。
   * 纯匹配逻辑复用 M.findBestOption / matchSelectOption。
   */
  function fillCustomSelect(host, value, key) {
    if (isPhoenixHost(host)) return fillPhoenixHost(host, value, key);
    return new Promise(function (resolve) {
      if (!host || !value) { resolve(false); return; }
      if (customSelectLooksFilled(host)) { resolve(false); return; }
      // 单选/多选组不是下拉：别在这里耗 2s 等一个永远不出现的弹层
      if (host.querySelector('input[type=radio], input[type=checkbox]')) { resolve(false); return; }
      openCustomSelect(host);
      // 弹层是异步渲染的，慢页面（BYD 实测）要 1.5s 才可见：轮询到选项出现为止，
      // 固定等 320ms 会让每次下拉都白等一轮、直接失败
      var waited = 0;
      var reopened = false;
      function poll() {
        var scoped = hostDropdownOptions(host);
        if (scoped) { finish(scoped); return; }
        var opts = collectOpenDropdownOptions();
        if (opts.length) { finish(opts); return; }
        if (waited >= 2600) { closeOpenDropdowns(); resolve(false); return; }
        if (!reopened && waited >= 900) {
          reopened = true;
          openCustomSelect(host);
        }
        waited += 150;
        setTimeout(poll, 150);
      }
      setTimeout(poll, 180);

      function finish(opts) {
        if (!opts || !opts.length) { resolve(false); return; }
        var matched = M.findBestOption
          ? M.findBestOption(opts, value)
          : (M.matchSelectOption && M.matchSelectOption(opts, value));
        if (!matched) { resolve(false); return; }
        var wantNorm = M.normalizeOptionText
          ? M.normalizeOptionText(matched.text || matched.value)
          : String(matched.text || matched.value || '').toLowerCase();
        var hit = null;
        for (var i = 0; i < opts.length; i++) {
          var tn = M.normalizeOptionText
            ? M.normalizeOptionText(opts[i].text)
            : String(opts[i].text || '').toLowerCase();
          if (tn === wantNorm || opts[i].text === matched.text) { hit = opts[i]; break; }
        }
        if (!hit) hit = opts[0];
        simulateClick(hit.el);
        setTimeout(function () {
          resolve(customSelectLooksFilled(host) || true);
        }, 200);
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
      var t = String(cells[i].textContent || '').replace(/\s+/g, '').trim();
      if (t === wantMonth + '月') { target = cells[i]; break; }
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
    var mm = ('0' + parts.m).slice(-2);
    var dd = ('0' + (parts.d || '1')).slice(-2);
    setInputRaw(input, parts.y + '-' + mm + '-' + dd);
    await sleep(200);
    pressEnter(input);
    if (await waitUntil(function () { return phoenixHostFilled(host); }, 1200, 150)) return true;
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
  function fillPhoenixRadioGroups(profile, keyCounts, filledKeys) {
    var filled = 0;
    var groups = Array.from(document.querySelectorAll('.phoenix-radio-group')).filter(function (g) {
      return isVisibleEl(g);
    });
    groups.forEach(function (group) {
      if (group.querySelector('.phoenix-radio--checked')) return;
      var item = group.closest ? group.closest('.form-item') : null;
      var labelEl = item ? item.querySelector('.form-item__text') : null;
      var label = labelEl ? String(labelEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!label) return;
      var scored = M.matchFieldKeyScored ? M.matchFieldKeyScored(label, {}) : null;
      var key = scored && scored.key;
      if (!key || !RADIO_SAFE_KEYS[key]) return;
      if (keyCounts['radio:' + key]) return;
      var gval = M.profileValue(profile, key);
      if (!gval) return;
      var opts = Array.from(group.querySelectorAll('.phoenix-radio')).map(function (r) {
        return { el: r, text: String(r.textContent || '').replace(/\s+/g, ' ').trim() };
      }).filter(function (o) { return o.text; });
      if (!opts.length) return;
      var want = phoenixChoiceValue(key, gval, opts.map(function (o) { return o.text; }));
      var matched = phoenixPick(opts, want);
      if (!matched) return;
      simulateClick(matched.el);
      if (matched.el.classList.contains('phoenix-radio--checked')) {
        keyCounts['radio:' + key] = 1;
        filled += 1;
        if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
        highlight(matched.el);
      }
    });
    return filled;
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
      if (target.checked) {
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
    return Array.from(document.querySelectorAll(CUSTOM_SELECT_HOST)).filter(function (h) {
      return isVisibleEl(h) || (h.offsetParent !== null);
    });
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

  var DATE_PANEL_SEL = '.layui-laydate, .laydate, .el-picker-panel, .el-date-picker, ' +
    '.ant-picker-dropdown, .flatpickr-calendar, [class*="datepicker"], [class*="date-picker"], ' +
    '[class*="datePicker"], [class*="calendar"], [class*="DatePicker"]';

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function parseDateParts(value) {
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
    var h = host;
    for (var up = 0; up < 2 && h && h.parentElement; up++) {
      var hasBtn = h.querySelectorAll('button, [class*="arrow"], [role="button"]').length > 0;
      var txt = String(h.textContent || '');
      var hasConfirm = /确定|确认|完成|OK|ok/.test(txt);
      if (hasBtn || hasConfirm) return h;
      var parent = h.parentElement;
      // 只在“仍像弹层”的范围内上溯，避免退到 body 把整页当面板
      if (String(parent.textContent || '').length > 2000) break;
      h = parent;
    }
    return h || host;
  }

  /** 可见的日期面板：先按常见类名找；找不到就按“含年份文本的可见 table/ul”兜底 */
  function findDatePanel(yearText) {
    var byClass = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll(DATE_PANEL_SEL), function (n) {
        if (!isVisibleEl(n)) return;
        var b = n.getBoundingClientRect();
        // 排除标题/图标等碎片（如 .el-date-picker__header-label 也含 date-picker 字样）
        if (b.width < 150 || b.height < 90) return;
        byClass.push(n);
      });
    } catch (_) { /* ignore */ }
    if (byClass.length) {
      // 只保留最外层，避免抓到面板内部的子块
      var roots = byClass.filter(function (n) {
        return !byClass.some(function (m) { return m !== n && m.contains(n); });
      });
      var list = roots.length ? roots : byClass;
      return expandToActionableHost(list[list.length - 1]);
    }
    // 兜底 1：没有 class 线索时，找可见的日历网格（星期表头或可用日格）
    var grids = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll('table'), function (t) {
        if (!isVisibleEl(t)) return;
        var txt = String(t.textContent || '');
        var isGrid = looksLikeWeekHeader(txt) ||
          !!t.querySelector('td[class*="available"], td[class*="prev-month"], td[class*="next-month"]');
        if (!isGrid) return;
        var host = t.closest('[class*="picker"], [class*="panel"], [class*="popup"], [class*="dropdown"], [class*="calendar"], [class*="date"]') || t;
        // 翻页箭头常在表格外的 header 里：往上找带按钮的容器
        for (var up = 0; up < 3 && host && host.parentElement &&
             host.querySelectorAll('button, [class*="arrow"]').length === 0; up++) {
          host = host.parentElement;
        }
        if (isVisibleEl(host)) grids.push(host);
      });
    } catch (_) { /* ignore */ }
    if (grids.length) {
      var gridRoots = grids.filter(function (n) {
        return !grids.some(function (m) { return m !== n && m.contains(n); });
      });
      var gl = gridRoots.length ? gridRoots : grids;
      return expandToActionableHost(gl[gl.length - 1]);
    }
    // 兜底 0：滚轮/分栏（div + ul 列），找同时含 年/月/日 三组数字的最内层容器
    var numericHost = null;
    try {
      var pool = document.querySelectorAll('div, section, dl, table');
      for (var pi = 0; pi < pool.length && pi < 800; pi++) {
        var n = pool[pi];
        if (!isVisibleEl(n)) continue;
        if (String(n.textContent || '').length > 3000) continue;
        var leaves = n.querySelectorAll('li, td, dd').length;
        if (leaves < 6 || leaves > 400) continue;
        var gs = numericGroups(n);
        var types = {};
        gs.forEach(function (g) { types[g.type] = 1; });
        if (types.year && types.month && types.day) {
          if (!numericHost || numericHost.contains(n)) numericHost = n;
        }
      }
    } catch (_) { /* ignore */ }
    if (numericHost) return expandToActionableHost(numericHost);

    if (!yearText) return null;
    var generic = [];
    try {
      Array.prototype.forEach.call(document.querySelectorAll('table, ul, [class*="list"], [class*="panel"], [class*="popup"], [class*="dropdown"]'), function (n) {
        if (!isVisibleEl(n)) return;
        var txt = String(n.textContent || '');
        if (txt.indexOf(yearText) === -1) return;
        generic.push(n);
      });
    } catch (_) { /* ignore */ }
    return generic.length ? expandToActionableHost(generic[generic.length - 1]) : null;
  }

  /** 在面板里点一个“文本等于目标数字”的叶子项（年/月/日通用） */
  function clickPanelItem(scope, text, hintRe) {
    if (!scope) return false;
    var want = String(text || '').trim();
    if (!want) return false;
    var wantNum = parseInt(want, 10);
    var nodes = scope.querySelectorAll('td, li, dd, span, div, a');
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.childElementCount) continue;          // 只点叶子，避免点到容器
      var t = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      var same = (t === want) || (!isNaN(wantNum) && !isNaN(parseInt(t, 10)) && String(parseInt(t, 10)) === String(wantNum));
      if (!same) continue;
      if (!isVisibleEl(n)) continue;
      var bonus = 0;
      var p = n;
      for (var u = 0; u < 4 && p; u++, p = p.parentElement) {
        var cls = String((p.className || ''));
        if (hintRe && hintRe.test(cls)) { bonus = 1; break; }
      }
      if (!best || bonus > best.bonus) best = { el: n, bonus: bonus };
      if (bonus) break;
    }
    if (!best) return false;
    simulateClick(best.el);
    return true;
  }

  /** 面板里的确认按钮（确定/确认/完成/OK）——有些日期面板点完还要确认 */
  function clickPanelConfirm(scope) {
    var root = scope || document;
    var nodes = root.querySelectorAll('button, a, span, div, input[type=button]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var t = String(n.textContent || n.value || '').replace(/\s+/g, ' ').trim();
      if (!/^(确定|确认|完成|ok|OK|Ok)$/.test(t)) continue;
      if (n.disabled) continue;
      if (!isVisibleEl(n)) continue;
      simulateClick(n);
      return true;
    }
    return false;
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
    return { members: members, ok: ok, reason: ok ? '' : 'date_group_incomplete' };
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

  var CN_MONTH = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  var EN_MONTH = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];

  function looksLikeWeekHeader(txt) {
    var t = String(txt || '');
    if (/日\s*一\s*二\s*三\s*四\s*五\s*六/.test(t)) return true;
    var m = t.match(/sun|mon|tue|wed|thu|fri|sat|su|mo|tu|we|th|fr|sa/gi) || [];
    var uniq = {};
    m.forEach(function (x) { uniq[x.toLowerCase()] = 1; });
    return Object.keys(uniq).length >= 5;
  }

  function isCalendarGrid(panel) {
    if (!panel) return false;
    if (panel.querySelector('td.prev-month, td.next-month, td.current, .el-date-table, .laydate-theme-grid')) return true;
    var dayBtn = panel.querySelector('td[class*="available"], td[class*="disabled"]');
    if (dayBtn) return true;
    var t = String(panel.textContent || '');
    if (looksLikeWeekHeader(t)) return true;
    // 7 列、≥28 个 1~31 的数字格也当网格
    var tables = panel.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var rows = tables[i].querySelectorAll('tr');
      if (rows.length < 4) continue;
      var wideRows = 0;
      Array.prototype.forEach.call(rows, function (tr) {
        if (tr.querySelectorAll('td').length >= 5) wideRows += 1;
      });
      if (wideRows < 4) continue;   // 单列列表（年表/月表）不算网格
      var nums = 0;
      Array.prototype.forEach.call(tables[i].querySelectorAll('td'), function (td) {
        var v = parseInt(String(td.textContent || '').trim(), 10);
        if (!isNaN(v) && v >= 1 && v <= 31) nums += 1;
      });
      if (nums >= 28) return true;
    }
    return false;
  }

  function gridHeader(panel) {
    var txt = '';
    var heads = panel.querySelectorAll('[class*="header"], [class*="title"], .laydate-header');
    for (var i = 0; i < heads.length; i++) txt += ' ' + String(heads[i].textContent || '');
    if (!txt.replace(/\s+/g, '')) txt = String(panel.textContent || '').slice(0, 160);
    txt = txt.replace(/\s+/g, ' ');
    var ym = txt.match(/(19|20)\d{2}/);
    var year = ym ? parseInt(ym[0], 10) : null;
    var month = null;
    var zh = txt.match(/(十一|十二|十|[一二三四五六七八九])月/);
    if (zh && CN_MONTH[zh[1]]) month = CN_MONTH[zh[1]];
    if (!month) {
      var lower = txt.toLowerCase();
      for (var k = 0; k < EN_MONTH.length; k++) {
        if (lower.indexOf(EN_MONTH[k]) !== -1) { month = k + 1; break; }
      }
    }
    if (!month) {
      var num = txt.match(/(\d{1,2})\s*月/);
      if (num) month = parseInt(num[1], 10);
    }
    if (!month) {
      var iso = txt.match(/(19|20)\d{2}\s*[-/.年]\s*(\d{1,2})/) || txt.match(/(\d{1,2})\s*[-/.]\s*(19|20)\d{2}/);
      if (iso) month = parseInt(iso[2], 10);
    }
    return { year: year, month: month };
  }

  /** 找翻页箭头：unit=year 用双箭头(d-arrow-*)，unit=month 用单箭头(arrow-*) */
  function pickArrow(panel, dir, unit) {
    var suffix = dir < 0 ? 'left' : 'right';
    var cls = unit === 'year' ? '.d-arrow-' + suffix : '.arrow-' + suffix;
    var byCls = panel.querySelector(cls);
    if (byCls && isVisibleEl(byCls)) return byCls;
    // 兜底：按方向 + 文本/属性猜
    var nodes = Array.prototype.slice.call(panel.querySelectorAll('button, i, span, div'));
    var hits = [];
    nodes.forEach(function (n) {
      if (!isVisibleEl(n)) return;
      var m = (String(n.className || '') + ' ' + (n.getAttribute('title') || '') + ' ' +
        (n.getAttribute('aria-label') || '') + ' ' + String(n.textContent || '')).toLowerCase();
      var dirOk = dir < 0 ? /left|prev|上|‹|«/.test(m) : /right|next|下|›|»/.test(m);
      if (!dirOk) return;
      if (String(n.textContent || '').trim().length > 6) return;
      hits.push(n);
    });
    if (!hits.length) return null;
    if (unit === 'year') return dir < 0 ? hits[0] : hits[hits.length - 1];
    return dir < 0 ? hits[hits.length - 1] : hits[0];
  }

  /** 面板自带「年 / 月」下拉或年份输入框时直接设值（flatpickr / laydate 风格） */
  function setPanelPeriod(panel, y, m) {
    var changed = false;
    try {
      Array.prototype.forEach.call(panel.querySelectorAll('select'), function (sel) {
        var nums = [];
        for (var i = 0; i < sel.options.length; i++) {
          var v = parseInt(String(sel.options[i].value !== '' ? sel.options[i].value : sel.options[i].text || '').replace(/\D/g, ''), 10);
          if (!isNaN(v)) nums.push(v);
        }
        if (!nums.length) return;
        var mx = Math.max.apply(null, nums);
        if (mx >= 1900) { if (setSelectByNumber(sel, y)) changed = true; }
        else if (mx <= 12 && sel.options.length >= 2) { if (setSelectByNumber(sel, m)) changed = true; }
      });
      var yin = panel.querySelector('input.cur-year, input[class*="year"], input[class*="Year"]');
      if (yin && /^\d{4}$/.test(String(yin.value || '').trim())) {
        if (setNativeValue(yin, String(y))) changed = true;
      }
    } catch (_) { /* ignore */ }
    return changed;
  }

  /** 翻到目标年月：大差距用“十年”箭头，接近后逐月推进；12 秒硬预算防卡死 */
  async function gridNavigate(panel, y, m) {
    if (setPanelPeriod(panel, y, m)) await sleep(180);
    var deadline = Date.now() + 12000;
    var superUsable = true;
    for (var guard = 0; guard < 420; guard++) {
      if (Date.now() > deadline) return false;
      var cur = gridHeader(panel);
      if (!cur.year || !cur.month) return false;
      var d = (y * 12 + m) - (cur.year * 12 + cur.month);
      if (d === 0) return true;
      var dir = d < 0 ? -1 : 1;
      if (superUsable && Math.abs(d) >= 120) {
        var superBtn = pickArrow(panel, dir, 'year');
        if (superBtn) {
          var before = cur;
          simulateClick(superBtn);
          await sleep(150);
          var after = gridHeader(panel);
          var movedMonths = (after.year && before.year)
            ? Math.abs((before.year * 12 + before.month) - (after.year * 12 + after.month)) : 0;
          if (movedMonths < 12) superUsable = false;   // 那个箭头只走一个月/一年，别再当十年用
          continue;
        }
        superUsable = false;
      }
      var monthBtn = pickArrow(panel, dir, 'month');
      if (!monthBtn) return false;
      var step = Math.min(Math.abs(d), 12);
      for (var k = 0; k < step; k++) {
        if (Date.now() > deadline) return false;
        simulateClick(monthBtn);
        await sleep(30);
      }
      await sleep(80);
    }
    return false;
  }

  function gridClickDay(panel, day) {
    var cells = panel.querySelectorAll('td');
    var fallback = null;
    for (var i = 0; i < cells.length; i++) {
      var td = cells[i];
      var cls = String(td.className || '');
      if (/prev-month|next-month|disabled|not-current/.test(cls)) continue;
      var txt = String(td.textContent || '').replace(/\s+/g, ' ').trim();
      if (parseInt(txt, 10) !== day) continue;
      if (!isVisibleEl(td)) continue;
      if (/\bavailable\b|\bcurrent\b/.test(cls)) { simulateClick(td); return true; }
      if (!fallback) fallback = td;
    }
    if (fallback) { simulateClick(fallback); return true; }
    return false;
  }

  async function tryCalendarGrid(el, desired) {
    var parts = parseDateParts(desired);
    if (!parts) return false;
    var panel = findDatePanel(parts.y);
    if (!panel) return false;
    var navOk = await gridNavigate(panel, parseInt(parts.y, 10), parseInt(parts.m, 10));
    if (!navOk) return false;
    await sleep(150);
    panel = findDatePanel(parts.y) || panel;
    if (parts.d) {
      var dayOk = gridClickDay(panel, parseInt(parts.d, 10));
      if (!dayOk) return false;
    }
    await sleep(220);
    if (!dateValueMatches(el.value, desired)) {
      var again = findDatePanel(parts.y);
      if (again) clickPanelConfirm(again);
      await sleep(260);
    }
    return true;
  }

  /** 把面板里的数字列表分组：年份组(>=1900) / 月份组(<=12) / 日期组(<=31) */
  function numericGroups(root) {
    var groups = [];
    if (!root || !root.querySelectorAll) return groups;
    var sel = 'table, ul, ol, dl, [class*="list"], [role="listbox"], [class*="column"], [class*="col"]';
    Array.prototype.forEach.call(root.querySelectorAll(sel), function (n) {
      if (!isVisibleEl(n)) return;
      var cells = n.querySelectorAll('td, li, dd, span, div, a');
      var vals = [];
      Array.prototype.forEach.call(cells, function (c) {
        if (c.childElementCount) return;
        var t = String(c.textContent || '').trim();
        if (!/^\d{1,4}$/.test(t)) return;
        vals.push(parseInt(t, 10));
      });
      if (vals.length < 2) return;
      var max = Math.max.apply(null, vals);
      var type = max >= 1900 ? 'year' : (max <= 12 ? 'month' : (max <= 31 ? 'day' : null));
      if (type) groups.push({ el: n, type: type, count: vals.length });
    });
    return groups;
  }

  /** 依次点 年 → 月 → 日；每步按“分组类型”重新定位（面板常被整体重渲染） */
  async function tryDatePanel(el, desired) {
    var parts = parseDateParts(desired);
    if (!parts) return false;
    var root = findDatePanel(parts.y);
    if (!root) return false;
    // 上溯到能同时看到多组数字列表的祖先（多表格面板的公共容器）
    var scope = root;
    for (var u = 0; u < 4 && scope.parentElement; u++) {
      var types = {};
      numericGroups(scope).forEach(function (g) { types[g.type] = 1; });
      if (Object.keys(types).length >= 2) break;
      scope = scope.parentElement;
    }
    var step = function (text, type) {
      var groups = numericGroups(scope).filter(function (g) { return g.type === type; });
      for (var i = 0; i < groups.length; i++) {
        if (clickPanelItem(groups[i].el, text, null)) return true;
      }
      return false;
    };
    var g0 = numericGroups(scope).map(function (g) { return g.type + ':' + g.count; });
    var okY = step(parts.y, 'year');
    if (!okY) return false;
    await sleep(220);
    var okM = step(parts.m, 'month');
    if (!okM) return false;
    await sleep(220);
    if (parts.d) {
      var okD = step(parts.d, 'day');
      if (!okD) return false;
    }
    await sleep(180);
    if (!dateValueMatches(el.value, desired)) {
      if (!clickPanelConfirm(scope)) clickPanelConfirm(findDatePanel(parts.y) || scope);
    }
    await sleep(300);
    return true;
  }

  /** 目标是否已是完整日期（允许 1998-05-20 / 1998/5/20 / 1998年05月20日） */
  function dateValueMatches(actual, desired) {
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

  /** 打开只读控件的弹层：先 focus（Element 的 el-date-picker 监听 focus），再 click，再点右侧日历图标 */
  function openPicker(el) {
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
    try { return !!(el && el.closest && el.closest('.ant-picker')); } catch (_) { return false; }
  }

  /** 等 antd 弹层真正挂上 DOM（首帧可能还没渲染） */
  function waitForAntdPanel(ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var p = antdPanel();
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
        // ① 先试「年 / 月 / 日」多表格日期面板
        var parts = parseDateParts(desired);
        var antdOk = false;
        try { antdOk = await tryAntdPanel(el, desired); } catch (e) { antdOk = false; }
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
      if (opt === want || (opt.length >= 2 && want.indexOf(opt) !== -1)) {
        simulateClick(radios[i]);
        if (radios[i].checked) { highlight(radios[i]); return true; }
      }
    }
    return false;
  }

  async function fillFromProfile(profile, options) {
    var opts = options || {};
    var filled = 0;
    var filledKeys = [];
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

    for (var pass = 0; pass < 2; pass++) {
    // 起止时间合体的控件要在逐 input 匹配之前处理，否则两个 input 会被各写一份
    if (opts.allowCustomSelect !== false) {
      try { filled += await fillRangeEditors(profile, handled, filledKeys); } catch (_) { /* ignore */ }
    }
    var els = iterFillableFields();
    for (var idx = 0; idx < els.length; idx++) {
      var el = els[idx];
      if (handled) { if (handled.has(el)) continue; handled.add(el); }
      if (groupHandled && groupHandled.has(el)) continue;
      // 范围日期控件由 fillRangeEditors 负责（两个 input 共享一个 label）
      if (el.classList && el.classList.contains('el-range-input')) continue;
      if (el.closest && el.closest(RANGE_EDITOR_SEL)) continue;
      var struct = detectStructuredField(el);
      // 分区兜底优先：语言技能里的「获得时间」全局会落到 certDate（证书时间），
      // 在这种分区里应该用 englishDate
      var key = struct ? struct.key : (sectionFallbackKey(el) || matchKeyForElement(el));
      if (!key) continue;
      var counterKey = occurrenceKey(key, getLabelText(el));
      var count = struct ? 0 : (keyCounts[counterKey] || 0);
      if (!struct && count >= MAX_FILLS_PER_KEY) continue;
      var value = struct
        ? structuredValue(profile, struct)
        : (M.profileValueForOccurrence
          ? M.profileValueForOccurrence(profile, key, count)
          : M.profileValue(profile, key));
      if (!value) {
        if (skipped.length < 12) skipped.push({ key: key, reason: 'no_profile_value' });
        continue;
      }
      if (fieldLooksFilled(el)) continue;
      // 自定义下拉宿主：走 click → option 路径
      var customHost = findCustomSelectHost(el);
      if (customHost && isPhoenixHost(customHost) && customHost.isConnected === false) continue;
      if (customHost && el.tagName.toLowerCase() !== 'select') {
        if (customSelectLooksFilled(customHost)) continue;
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
            keyCounts[counterKey] = count + 1;
            if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
            highlight(el);
            continue;
          }
          // Phoenix 宿主的真值只在 React 状态里，绝不能直接写 input.value
          if (isPhoenixHost(customHost)) {
            if (skipped.length < 12) skipped.push({ key: key, reason: 'phoenix_fill_failed' });
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
        var toggled = clickCurrentJobToggle(el);
        if (toggled) {
          filled += 1;
          keyCounts[counterKey] = count + 1;
          if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
          highlight(el);
        } else if (!looksLikeDateInput(el) && setNativeValue(el, String(value).trim())) {
          // 没有「至今」开关、但这是个普通文本框（结束时间）→ 直接写“至今”
          filled += 1;
          keyCounts[counterKey] = count + 1;
          if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
          highlight(el);
        } else if (skipped.length < 12) {
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
            keyCounts[counterKey] = count + 1;
            if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
            grpFirst.members.forEach(function (m) { highlight(m); });
          } else if (skipped.length < 12) {
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
            keyCounts[counterKey] = count + 1;
            if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
            grpRes.members.forEach(function (m) { highlight(m); });
          } else if (skipped.length < 12) {
            skipped.push({ key: key, reason: grpRes.reason || 'date_group_failed' });
          }
          continue;
        }
      }

      // fail-closed：是年/月/日部件、但组不成完整日期 → 宁可不填，也不写半截日期
      if (M.detectDatePartRole && M.detectDatePartRole(hints, dateOpts) && hasSiblingDateParts(el)) {
        if (skipped.length < 12) skipped.push({ key: key, reason: 'date_part_no_group' });
        continue;
      }

      var ok = false;
      if (isReadonlyPicker(el)) {
        // 只读展示框：真值需要点击弹层选择；默认开启，可用 options.allowPickerClick=false 关闭
        if (opts.allowPickerClick === false) {
          skipped.push({ key: key, reason: 'readonly_picker_disabled' });
          continue;
        }
        try {
          ok = await fillReadonlyPicker(el, value);
        } catch (err) {
          ok = false;
          if (skipped.length < 12) skipped.push({ key: key, reason: 'picker_error' });
        }
        if (ok === 'forced') forced.push(key);
        if (!ok) skipped.push({ key: key, reason: 'readonly_picker_not_found' });
      } else {
        ok = commitFrameworkWidget(el, value) || setNativeValue(el, value);
        if (!ok && el.tagName && el.tagName.toLowerCase() === 'select') {
          // 排名/绩点常常是区间下拉：15/120 要换算成「前20%」才匹配得上
          var alts = valueCandidates(key, value);
          for (var ai = 0; ai < alts.length && !ok; ai++) {
            if (alts[ai] === value) continue;
            ok = setNativeValue(el, alts[ai]);
            if (ok) value = alts[ai];
          }
        }
        if (!ok) skipped.push({ key: key, reason: 'set_value_failed' });
      }

      if (ok) {
        filled += 1;
        keyCounts[counterKey] = count + 1;
        if (filledKeys.indexOf(key) === -1) filledKeys.push(key);
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
        }
      });
      filled += fillNamedRadioGroups(profile, keyCounts, filledKeys);
      filled += fillPhoenixRadioGroups(profile, keyCounts, filledKeys);
    }

    // 无关联 input 的自定义下拉宿主（仅展示层）
    if (opts.allowCustomSelect !== false) {
      var hosts = iterCustomSelectHosts();
      for (var hi = 0; hi < hosts.length; hi++) {
        var host = hosts[hi];
        if (customSelectLooksFilled(host)) continue;
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
        var hKey = M.matchFieldKey(hLabel, {});
        if (!hKey) continue;
        var hCounterKey = occurrenceKey(hKey, hLabel);
        var hCount = keyCounts[hCounterKey] || 0;
        if (hCount >= MAX_FILLS_PER_KEY) continue;
        var hVal = M.profileValueForOccurrence
          ? M.profileValueForOccurrence(profile, hKey, hCount)
          : M.profileValue(profile, hKey);
        if (!hVal) continue;
        try {
          var hOk = await fillCustomSelect(host, hVal, hKey);
          if (hOk) {
            filled += 1;
            keyCounts[hCounterKey] = hCount + 1;
            if (filledKeys.indexOf(hKey) === -1) filledKeys.push(hKey);
            highlight(host);
          }
        } catch (_) { /* ignore */ }
      }
    }

    // 别把弹层留在页面上
    try { closePhoenixPanels(); } catch (_) { /* ignore */ }

    return { filled: filled, expanded: expanded, filledKeys: filledKeys, skipped: skipped, forced: forced };
  }

  /**
   * 按映射结果填写（AI 巡查后的 AI 填写）。
   * mappings: { index, action, suggestedValue }[]
   */
  function applyMappings(mappings) {
    var els = iterFillableFields();
    var filled = 0;
    var filledKeys = [];
    var list = mappings || [];
    list.forEach(function (m) {
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
      if (setNativeValue(el, value)) {
        filled += 1;
        var k = m.profileKey || ('custom:' + m.index);
        if (filledKeys.indexOf(k) === -1) filledKeys.push(k);
        highlight(el);
      }
    });
    return { filled: filled, filledKeys: filledKeys };
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
      forced: result.forced || []
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

  function sectionTitleFor(el) {
    var sec = el.closest
      ? el.closest('.resume-section, fieldset, .form-section, .ant-card, .el-card, section, .card')
      : null;
    if (!sec) return '';
    var head = sec.querySelector(
      '.section-title .title, legend, h1, h2, h3, h4, .ant-card-head-title, .el-card__header, .card-title'
    );
    var t = head ? String(head.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return t.length > 24 ? '' : t;
  }

  function cleanFieldLabel(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^[*＊\s]+/, '').replace(/[:：]\s*$/, '').trim();
    if (!t || t.length > 30) return '';
    if (LABEL_NOISE_RE.test(t)) return '';
    return t;
  }

  /** 页面上还空着、且能认出标签的字段（供「未填字段」清单） */
  function unfilledFields() {
    var out = [];
    var seen = {};
    iterFillableFields().forEach(function (el) {
      if (!el || el.disabled) return;
      if (!isVisibleEl(el)) return;
      if (fieldLooksFilled(el)) return;
      var label = cleanFieldLabel(getLabelText(el));
      if (!label) return;
      var section = sectionTitleFor(el);
      var sig = section + '|' + label;
      if (seen[sig]) return;
      seen[sig] = 1;
      out.push({ label: label, required: fieldRequired(el), section: section });
    });
    return out.slice(0, 60);
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
    var result = applyMappings(message.mappings || []);
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
      };
      try { window.addEventListener('message', onMsg); } catch (_) { /* ignore */ }
      setTimeout(function () {
        try { window.removeEventListener('message', onMsg); } catch (_) { /* ignore */ }
        resolve(agg);
      }, ms);
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
      scan: function () { return handleScan(); }
    };
  } catch (_) { /* ignore */ }

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
