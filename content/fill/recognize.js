/**
 * 简历填写工具 · 内容脚本 · 字段识别：标签 / 提示词 / 区块上下文 / 字段键（每轮 DOM 读缓存）
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
  if (loaded['fill/recognize']) return;
  loaded['fill/recognize'] = true;

  // 依赖（后加载的模块：调用时再取）
  function phoenixFormTitle() { return C.phoenixFormTitle.apply(this, arguments); }


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
    if (/家庭|亲友|家庭成员/.test(text)) return 'family';
    if (/语言能力|语言技能|外语能力/.test(text)) return 'lang';
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
    var cell = el && el.closest ? el.closest('.form-cell') : null;
    if (cell) {
      var cellTitle = cell.querySelector('.tit-wrap .tit p');
      if (cellTitle) return sectionContextFromText(String(cellTitle.textContent || '').trim());
    }
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

  function matchKeyForElement(el) {
    var options = {
      autocomplete: el.getAttribute('autocomplete') || '',
      context: detectSectionContext(el)
    };
    var label = getLabelText(el);
    var primary = [label, el.getAttribute('placeholder')].filter(Boolean).join(' ');
    if (M.isSkipContext && M.isSkipContext(primary)) return null;
    var scored = M.matchFieldKeyScored(primary, options);
    // 可读标签优先于不透明的 ATS 属性名（certificateNo 是证件号码，并非证书）。
    if (scored && scored.confidence >= 0.9) return scored.key;
    return M.matchFieldKey(collectHints(el), options);
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
    if (el.closest && el.closest('.ant-calendar-picker-container, .ant-picker-dropdown, .ant-select-dropdown, .phoenix-date-picker, .constant-main-selector-container, .area-selector-container')) return true;
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

  // 导出
  C.beginMemo = beginMemo;
  C.endMemo = endMemo;
  C.getLabelText = getLabelText;
  C.fieldLooksFilled = fieldLooksFilled;
  C.detectAdjacentDatePairRole = detectAdjacentDatePairRole;
  C.collectHints = collectHints;
  C.detectSectionContext = detectSectionContext;
  C.matchKeyForElement = matchKeyForElement;
  C.sectionFallbackKey = sectionFallbackKey;
  C.hintSnippet = hintSnippet;
  C.isSkippable = isSkippable;
})();
