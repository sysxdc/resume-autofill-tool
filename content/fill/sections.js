/**
 * 简历填写工具 · 内容脚本 · 分区与多段：按 id 语义路径的行级映射、「添加 XX 经历」按钮、段数统计
 * 由 content/autofill.js 拆出（v1.6.0）。模块之间通过 globalThis.ResumeAutofillContent 共享函数，
 * 加载顺序见 manifest.json content_scripts；排在后面的模块用转发函数引用（调用时才解析）。
 */
(function () {
  'use strict';

  var C = globalThis.ResumeAutofillContent || (globalThis.ResumeAutofillContent = {});
  var M = globalThis.ResumeAutofillMatch;
  if (!globalThis.ResumeAutofillMatch) return;
  // 重复注入时整个模块跳过：保持和首次加载的编排层用同一套函数 / 本轮状态
  var loaded = C.__loaded || (C.__loaded = {});
  if (loaded['fill/sections']) return;
  loaded['fill/sections'] = true;

  // 依赖（已加载的模块）
  var sleep = C.sleep;

  // 依赖（后加载的模块：调用时再取）
  function isVisibleEl() { return C.isVisibleEl.apply(this, arguments); }
  function phoenixFormTitle() { return C.phoenixFormTitle.apply(this, arguments); }
  function simulateClick() { return C.simulateClick.apply(this, arguments); }

  // —————— v1.5.4：按 id 的语义路径做行级映射（ATS 常见：resumeEducationInfo_0_collegeName）——————
  var STRUCT_PATH_RE = /resume(education|work|employment|project|paper|intern)info_(\d+)_([a-z]+)/i;

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
    if (section === 'employment') section = 'work';
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
    return { listKey: STRUCT_LIST_KEY[section], index: index, field: field, key: key, rowPrefix: String(el.id).slice(0, String(el.id).lastIndexOf('_') + 1) };
  }

  /** 先把整行绑定到资料条目，再填该行子字段；已有内容优先于页面行号。 */
  function buildStructuredBindings(profile) {
    var A = globalThis.ResumeAutofillAudit;
    var groups = {};
    var result = {};
    var identity = {eduList:'school', workList:'company', internList:'company', projectList:'name', awardList:'name'};
    Array.prototype.forEach.call(document.querySelectorAll('input[id], textarea[id], select[id]'), function (el) {
      var s = detectStructuredField(el);
      if (!s || !identity[s.listKey] || !isVisibleEl(el) || el.type === 'hidden') return;
      var group = groups[s.listKey] || (groups[s.listKey] = {});
      var row = group[s.rowPrefix] || (group[s.rowPrefix] = {index:s.index, anchors:[]});
      if ([identity[s.listKey], 'start', 'end'].indexOf(s.field) === -1 || !C.fieldLooksFilled(el)) return;
      row.anchors.push({field:s.field, key:s.key, value:C.readBackValue(el)});
    });
    Object.keys(groups).forEach(function (listKey) {
      var list = M.listFor(profile, listKey);
      if (!list.length) return; // 无列表时继续兼容第 0 段的扁平资料。
      var rows = groups[listKey], reserved = {}, owners = {};
      Object.keys(rows).forEach(function (prefix) {
        var row = rows[prefix];
        if (!row.anchors.length) return;
        var matches = [];
        list.forEach(function (item, index) {
          if (row.anchors.every(function (a) {
            var expected = item[a.field];
            if (expected == null || !A) return false;
            var comparison = A.compareEntry({key:a.key, expected:String(expected), actual:a.value});
            return comparison.accepted || (/^(start|end)$/.test(a.field) && comparison.status === 'approx');
          })) matches.push(index);
        });
        matches.forEach(function (index) { reserved[index] = true; });
        if (matches.length === 1) {
          var index = matches[0];
          result[prefix] = {index:index};
          if (owners[index]) {
            result[prefix] = {reason:'duplicate_record'};
            result[owners[index]] = {reason:'duplicate_record'};
          } else owners[index] = prefix;
        } else result[prefix] = {reason:matches.length ? 'record_ambiguous' : 'record_conflict'};
      });
      Object.keys(rows).sort(function (a, b) { return rows[a].index - rows[b].index; }).forEach(function (prefix) {
        if (result[prefix]) return;
        var index = rows[prefix].index;
        if (index >= list.length || reserved[index]) {
          index = list.findIndex(function (_, i) { return !reserved[i]; });
        }
        if (index < 0) result[prefix] = {reason:'no_record_available'};
        else { result[prefix] = {index:index}; reserved[index] = true; }
      });
    });
    return result;
  }

  function boundStructuredField(el, bindings) {
    var s = detectStructuredField(el);
    var bound = s && bindings && bindings[s.rowPrefix];
    return bound ? Object.assign({}, s, bound) : s;
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
    { listKey: 'campusList', key: 'campus', re: /校园|社团|学生工作|组织经历/ },
    { listKey: 'langList', key: 'lang', re: /语言能力|语言技能|外语能力/ }
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
    var cells = document.querySelectorAll('.form-cell');
    for (var ci = 0; ci < cells.length; ci++) {
      var heading = cells[ci].querySelector('.tit-wrap .tit p');
      if (heading && rule.re.test(String(heading.textContent || '').trim())) {
        return cells[ci].querySelectorAll('.form-cell-inner').length;
      }
    }
    var idx = {};
    var ids = document.querySelectorAll('[id*="Info_"]');
    Array.prototype.forEach.call(ids, function (n) {
      var m = String(n.id || '').match(/(education|work|employment|intern|project|paper|campus)info_(\d+)_/i);
      if (!m) return;
      idx[m[1].toLowerCase() + ':' + m[2]] = 1;
    });
    var sectionName = { edu: 'education', work: 'work', intern: 'intern', project: 'project', award: 'paper', campus: 'campus' }[rule.key];
    var n = 0;
    for (var k in idx) {
      if (!Object.prototype.hasOwnProperty.call(idx, k)) continue;
      if (k.indexOf(sectionName + ':') === 0 ||
          ((rule.key === 'work' || rule.key === 'intern') && k.indexOf('employment:') === 0)) n += 1;
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
    campus: /^(campusexperiences?|activities?)$/i,
    lang: /^languages?$/i
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
    var flatBySection = { edu: 'school', work: 'company', intern: 'internCompany', project: 'projectName', award: 'awardName', campus: 'campusOrg', lang: 'langName' };
    var flat = profile ? profile[flatBySection[rule.key]] : '';
    return flat && String(flat).trim() ? 1 : 0;
  }

  /**
   * 点「添加」把分区展开到目标条数。
   * @returns {{section:string, clicks:number}[]}
   */
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

  // 导出
  C.detectStructuredField = detectStructuredField;
  C.structuredValue = structuredValue;
  C.buildStructuredBindings = buildStructuredBindings;
  C.boundStructuredField = boundStructuredField;
  C.ADD_SECTION_RULES = ADD_SECTION_RULES;
  C.expandAddSections = expandAddSections;
})();
