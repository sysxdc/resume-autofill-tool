/**
 * 共享字段匹配逻辑：关键词、姓名拆分、profile 取值、select 模糊匹配。
 * 浏览器挂到 ResumeAutofillMatch；Node 通过 module.exports 引入。
 *
 * v1.1.1: autocomplete 优先、短词词界、误匹配 denylist、学历同义、Yes/No select 保护。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ResumeAutofillMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 每个语义键最多填写次数，避免同一值刷满整页 */
  var MAX_FILLS_PER_KEY = 2;

  /**
   * HTML autocomplete → 语义键（优先于关键词子串匹配）
   * @see https://html.spec.whatwg.org/multipage/form-control-infrastructure.html
   */
  var AUTOCOMPLETE_MAP = {
    'given-name': 'firstName',
    'additional-name': 'firstName',
    'family-name': 'lastName',
    'name': 'name',
    'nickname': 'name',
    'email': 'email',
    'tel': 'phone',
    'tel-national': 'phone',
    'tel-local': 'phone',
    'street-address': 'address',
    'address-line1': 'address',
    'address-line2': 'address',
    'address-level2': 'city',
    'address-level1': 'province',
    'postal-code': 'zip',
    'country': 'country',
    'country-name': 'country',
    'organization': 'company',
    'organization-title': 'title',
    'url': 'website'
  };

  /**
   * 字段键 → 匹配关键词（中英双语，覆盖 Boss直聘 / 智联 / 前程 / Greenhouse / Lever 常见标签）
   */
  var FIELD_KEYWORDS = {
    firstName: [
      'firstname', 'first_name', 'first-name', 'givenname', 'given_name', 'given-name',
      'fname', 'preferredname', '名', '名字', '名（', '名)'
    ],
    lastName: [
      'lastname', 'last_name', 'last-name', 'surname', 'familyname', 'family_name', 'family-name',
      'lname', '姓', '姓氏', '姓（', '姓)'
    ],
    name: [
      'fullname', 'full_name', 'full-name', 'yourname', 'your_name', 'applicantname',
      'candidate_name', 'legalname', '真实姓名', '申请人姓名', '姓名', '称呼'
    ],
    email: [
      'email', 'e-mail', 'mail', 'emailaddress', 'email_address', 'workemail',
      '邮箱', '电子邮件', '电子邮箱', '邮件地址', '联系邮箱'
    ],
    phone: [
      'phone', 'mobile', 'tel', 'telephone', 'cellphone', 'cell', 'phonenumber',
      'phone_number', 'phone-number', 'contactnumber', '手机号', '手机号码',
      '电话', '联系电话', '移动电话', '座机'
    ],
    city: [
      'city', 'locality', 'addresscity', 'address_city', 'currentcity', 'current_city',
      '所在城市', '居住城市', '现居城市', '城市', '意向城市', '工作城市'
    ],
    address: [
      'streetaddress', 'street_address', 'address1', 'address_line', 'mailingaddress',
      '详细地址', '通讯地址', '居住地址', '住址', '街道地址', 'address', 'street', 'addr'
    ],
    province: [
      'province', 'state', 'region', '州', '省', '省份', '省市', '所在省'
    ],
    zip: [
      'zip', 'zipcode', 'zip_code', 'postal', 'postalcode', 'postal_code', 'postcode',
      '邮编', '邮政编码'
    ],
    country: [
      'country', 'nation', '国籍', '国家', '所在国家'
    ],
    linkedin: [
      'linkedin', 'linked-in', 'linkedinurl', 'linkedin_url', 'linked_in', '领英'
    ],
    github: [
      'github', 'githuburl', 'github_url', 'git hub', 'git-hub'
    ],
    website: [
      'website', 'portfolio', 'personalwebsite', 'personal_website', 'homepage',
      'blog', '个人网站', '作品集', '主页', '博客'
    ],
    school: [
      'school', 'university', 'college', 'institution', 'edu_school', 'campus',
      '毕业院校', '就读院校', '学校', '大学', '院校', '教育机构'
    ],
    degree: [
      'degree', 'educationlevel', 'education_level', 'edu_level', 'qualification',
      'highestdegree', '学历', '学位', '教育程度', '最高学历'
    ],
    major: [
      'major', 'fieldofstudy', 'field_of_study', 'discipline', 'studyfield',
      '所学专业', '专业', '主修', '研究方向'
    ],
    gradYear: [
      'graduationyear', 'gradyear', 'grad_year', 'yearofgraduation', 'endyear',
      '毕业年份', '毕业时间', '毕业年'
    ],
    company: [
      'company', 'employer', 'organization', 'org', 'currentcompany', 'current_company',
      'companyname', '工作单位', '现任公司', '就职公司', '公司', '雇主', '单位名称'
    ],
    title: [
      'jobtitle', 'job_title', 'job-title', 'position', 'currenttitle', 'current_title',
      'role', '职位名称', '现任职位', '岗位', '职务', '职位', 'title'
    ],
    years: [
      'yearsofexperience', 'years_of_experience', 'yoe', 'workyears', 'work_years',
      'experienceyears', '工作年限', '经验年限', '工龄', '从业年限', '年限'
    ],
    startDate: [
      'startdate', 'start_date', 'start-date', 'availablefrom', 'dateavailable',
      '入职时间', '到岗时间', '开始日期', '任职开始'
    ],
    skills: [
      'skills', 'skill', 'expertise', 'competencies', 'techstack',
      '专业技能', '掌握技能', '技术栈', '技能特长', '技能'
    ],
    summary: [
      'summary', 'about', 'bio', 'introduction', 'coverletter', 'cover_letter',
      'objective', 'selfintro', '自我介绍', '个人简介', '自我评价', '求职信',
      '个人总结', '简介', '补充说明'
    ],
    expectedSalary: [
      'expectedsalary', 'expected_salary', 'salaryexpectation', 'salary', 'compensation',
      '期望薪资', '期望月薪', '薪资期望', '期望待遇', '薪资要求'
    ],
    availability: [
      'availability', 'availabledate', 'noticeperiod', 'notice_period',
      '到岗', '可到岗', '入职时间', '离职通知期', '到岗时间'
    ],
    workAuth: [
      'workauthorization', 'work_authorization', 'workauth', 'visa', 'sponsorship',
      'eligibletowork', '工作许可', '签证', '工作签证', '合法工作', '用工资格'
    ]
  };

  /** 更具体字段优先（同长度时参考） */
  var FIELD_ORDER = [
    'firstName', 'lastName', 'email', 'phone',
    'linkedin', 'github', 'website',
    'gradYear', 'school', 'degree', 'major',
    'company', 'title', 'years', 'startDate',
    'expectedSalary', 'availability', 'workAuth',
    'skills', 'summary',
    'zip', 'province', 'country', 'city', 'address',
    'name'
  ];

  /**
   * 短 ASCII 关键词：必须词界/整 token 匹配，禁止裸子串
   * （避免 org⊂forgitlab、city⊂ethnicity/capacity、about⊂hear about 误伤需配合 denylist）
   */
  var SHORT_BOUNDARY_KEYWORDS = {
    org: 1, city: 1, about: 1, employer: 1, addr: 1, tel: 1, mail: 1,
    role: 1, bio: 1, skill: 1, nation: 1, state: 1, region: 1, title: 1,
    years: 1, zip: 1, cell: 1, blog: 1, name: 1, phone: 1, email: 1
  };

  /** 整段跳过：EEO / 法律问卷 / 听说来源 / 是否曾任职 等，不得映射到资料字段 */
  var SKIP_SUBSTRINGS = [
    'ethnicity', 'hispanic', 'latino', 'gender', 'veteran', 'disability',
    'howdidyouhear', 'hearaboutthis', 'heardabout',
    'previouslyworked', 'workedatorconsulted', 'consultedfor',
    'employmentagreement', 'postemployment', 'postemploymentrestriction',
    'subjecttoanyemployment',
    'incapacity', 'anycapacity',
    'prefernottosay', 'declinetoself'
  ];

  /** 学历中英同义，便于 select 模糊匹配 */
  var DEGREE_SYNONYM_GROUPS = [
    ['本科', '学士', 'bachelor', 'bachelors', 'bachelor\'s', 'bs', 'ba', 'b.s.', 'b.a.', 'undergraduate'],
    ['硕士', '研究生', 'master', 'masters', 'master\'s', 'ms', 'ma', 'm.s.', 'm.a.', 'mba', 'graduate'],
    ['博士', 'phd', 'ph.d', 'ph.d.', 'doctor', 'doctorate', 'doctoral'],
    ['大专', '专科', 'associate', 'associates', 'college diploma'],
    ['高中', '中学', 'high school', 'highschool', 'secondary', 'secondary school']
  ];

  var YES_NO_RE = /^(yes|no|y|n|true|false|是|否|有|无|可以|不可以)$/i;
  var YES_NO_OPTION_RE = /^(yes|no|y|n|是|否|有|无|prefer not to say|prefer not to answer|decline to self[- ]?identify|不愿透露|不想说|不方便透露)$/i;

  function normalize(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[\s_\-./\\:：]+/g, '')
      .replace(/[()（）\[\]【】]/g, '');
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isShortAsciiKeyword(nk) {
    if (!nk) return false;
    if (SHORT_BOUNDARY_KEYWORDS[nk]) return true;
    // 长度 ≤ 3 的纯 ASCII 一律按词界处理
    return nk.length <= 3 && /^[a-z0-9]+$/.test(nk);
  }

  /**
   * 短词：在原始（保留分隔符）文本上要求词界；
   * 长词：在 normalize 后的串上子串匹配。
   */
  function keywordOccurs(rawLower, normalizedHints, keyword) {
    var nk = normalize(keyword);
    if (!nk) return false;
    if (isShortAsciiKeyword(nk)) {
      var kw = String(keyword).toLowerCase().replace(/[\s_\-]+/g, '');
      // 词界：非字母数字为边界（覆盖 id=city、label "City *"、camelCase 拆出的 token）
      var re = new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(kw) + '(?:[^a-z0-9]|$)', 'i');
      if (re.test(rawLower)) return true;
      // camelCase / PascalCase：FooCityBar、hispanicEthnicity 中的 City 段
      var camel = rawLower.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      if (camel !== rawLower && re.test(camel)) return true;
      // tokenize on non-alnum
      var tokens = rawLower.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
      for (var t = 0; t < tokens.length; t++) {
        if (tokens[t] === kw || normalize(tokens[t]) === nk) return true;
      }
      return false;
    }
    return normalizedHints.indexOf(nk) !== -1;
  }

  function mapAutocomplete(autocomplete) {
    if (!autocomplete) return null;
    var parts = String(autocomplete).toLowerCase().trim().split(/\s+/);
    // 取最后一个有意义的 token（如 "section-billing shipping street-address"）
    var i;
    for (i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      if (!p || p === 'on' || p === 'off' || p === 'new-password' || p === 'current-password') continue;
      if (AUTOCOMPLETE_MAP[p]) return AUTOCOMPLETE_MAP[p];
    }
    return null;
  }

  /**
   * 从 hints 文本中识别「带连字符」的 autocomplete token（如 address-level2）。
   * 短 token（name/url/tel/email）只通过 options.autocomplete 传入，避免 linkedin_url → website。
   */
  function mapAutocompleteFromHints(rawLower) {
    var keys = Object.keys(AUTOCOMPLETE_MAP).filter(function (k) {
      return k.indexOf('-') !== -1;
    });
    keys.sort(function (a, b) { return b.length - a.length; });
    var i;
    for (i = 0; i < keys.length; i++) {
      var token = keys[i];
      var re = new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(token) + '(?:[^a-z0-9]|$)', 'i');
      if (re.test(rawLower)) return AUTOCOMPLETE_MAP[token];
    }
    return null;
  }

  function isSkipContext(rawLower, normalizedHints) {
    var i;
    for (i = 0; i < SKIP_SUBSTRINGS.length; i++) {
      if (normalizedHints.indexOf(SKIP_SUBSTRINGS[i]) !== -1) return true;
    }
    // capacity 单独：city ⊂ capacity；仅当整词 capacity 出现时跳过
    if (/(?:^|[^a-z0-9])capacity(?:[^a-z0-9]|$)/i.test(rawLower)) return true;
    // "how did you hear about …"
    if (/how\s+did\s+you\s+hear/i.test(rawLower)) return true;
    if (/hear\s+about\s+(this|us|the|our)/i.test(rawLower)) return true;
    // 法律/竞业：employment agreement(s) … employer
    if (/employment\s+agreements?/i.test(rawLower)) return true;
    if (/post[\s-]?employment/i.test(rawLower)) return true;
    // 是否曾在本公司任职
    if (/previously\s+worked/i.test(rawLower)) return true;
    if (/worked\s+at\s+or\s+consulted/i.test(rawLower)) return true;
    if (/ever\s+worked\s+for/i.test(rawLower)) return true;
    return false;
  }

  /**
   * @param {string} hints - name/id/label/placeholder 等拼接（原始或已轻度处理均可）
   * @param {{autocomplete?: string}|string} [options] - autocomplete 属性；若为 string 则视为 autocomplete
   * @returns {string|null}
   */
  function matchFieldKey(hints, options) {
    var autocomplete = '';
    if (typeof options === 'string') {
      autocomplete = options;
    } else if (options && typeof options === 'object') {
      autocomplete = options.autocomplete || '';
    }

    var acKey = mapAutocomplete(autocomplete);
    if (acKey) return acKey;

    var raw = String(hints || '');
    var rawLower = raw.toLowerCase();
    var h = normalize(raw);
    if (!h && !autocomplete) return null;

    // hints 里若直接带了 autocomplete token（如测试串），优先映射
    var embedded = mapAutocompleteFromHints(rawLower);
    if (embedded) return embedded;

    if (isSkipContext(rawLower, h)) return null;

    var bestKey = null;
    var bestLen = -1;
    var bestOrder = 9999;
    for (var i = 0; i < FIELD_ORDER.length; i++) {
      var key = FIELD_ORDER[i];
      var keywords = FIELD_KEYWORDS[key] || [];
      for (var j = 0; j < keywords.length; j++) {
        var kw = keywords[j];
        var nk = normalize(kw);
        if (!nk || nk.length < 1) continue;
        if (!keywordOccurs(rawLower, h, kw)) continue;
        // 禁止裸 address 压过明确的 city id/label（无 street/详细 等更长地址信号时）
        if (key === 'address' && nk === 'address') {
          if (keywordOccurs(rawLower, h, 'city') || /\bcity\b/i.test(rawLower)) {
            // 若同时有更长的地址信号则仍可计 address
            var strongAddr =
              keywordOccurs(rawLower, h, 'street') ||
              h.indexOf('streetaddress') !== -1 ||
              h.indexOf('详细地址') !== -1 ||
              h.indexOf('addressline') !== -1 ||
              h.indexOf('mailingaddress') !== -1;
            if (!strongAddr) continue;
          }
        }
        if (nk.length > bestLen || (nk.length === bestLen && i < bestOrder)) {
          bestLen = nk.length;
          bestKey = key;
          bestOrder = i;
        }
      }
    }
    return bestKey;
  }

  /**
   * 拆分姓名：中文 → last=姓 first=名；英文空白分隔 → last=末词 first=其余
   */
  function splitName(fullName) {
    var n = String(fullName || '').trim();
    if (!n) return { first: '', last: '' };
    if (/^[\u4e00-\u9fff]+$/.test(n)) {
      var compound = ['欧阳', '司马', '上官', '诸葛', '司徒', '皇甫', '夏侯', '东方'];
      for (var i = 0; i < compound.length; i++) {
        if (n.indexOf(compound[i]) === 0 && n.length > compound[i].length) {
          return { first: n.slice(compound[i].length), last: compound[i] };
        }
      }
      return { first: n.slice(1), last: n.slice(0, 1) };
    }
    var parts = n.split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: '' };
    return {
      first: parts.slice(0, -1).join(' '),
      last: parts[parts.length - 1]
    };
  }

  /**
   * 从 profile 取填表值：显式 firstName/lastName 优先于从 name 拆分；
   * address 使用 profile.address（不再误用 city）。
   */
  function profileValue(profile, key) {
    if (!profile) return '';
    if (key === 'firstName') {
      if (profile.firstName && String(profile.firstName).trim()) {
        return String(profile.firstName).trim();
      }
      return splitName(profile.name).first;
    }
    if (key === 'lastName') {
      if (profile.lastName && String(profile.lastName).trim()) {
        return String(profile.lastName).trim();
      }
      return splitName(profile.name).last;
    }
    if (key === 'name') {
      return (profile.name && String(profile.name).trim()) || '';
    }
    var v = profile[key];
    return v != null ? String(v).trim() : '';
  }

  function expandDegreeSynonyms(value) {
    var raw = String(value || '').trim();
    if (!raw) return [];
    var lower = raw.toLowerCase();
    var norm = normalize(raw);
    var out = [raw];
    var seen = {};
    seen[lower] = 1;
    var g, i, syn, sl;
    for (g = 0; g < DEGREE_SYNONYM_GROUPS.length; g++) {
      var group = DEGREE_SYNONYM_GROUPS[g];
      var hit = false;
      for (i = 0; i < group.length; i++) {
        syn = group[i];
        sl = syn.toLowerCase();
        if (lower === sl || norm === normalize(syn) ||
            lower.indexOf(sl) !== -1 || sl.indexOf(lower) !== -1) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      for (i = 0; i < group.length; i++) {
        syn = group[i];
        sl = syn.toLowerCase();
        if (!seen[sl]) {
          seen[sl] = 1;
          out.push(syn);
        }
      }
    }
    return out;
  }

  function optionLooksEmpty(o) {
    var t = String(o.text || '').trim();
    var v = String(o.value || '').trim();
    if (!t && !v) return true;
    if (/^(please\s*select|select|选择|请选择|—+|-+|\.+)$/i.test(t)) return true;
    return false;
  }

  /**
   * 选项是否基本都是 Yes/No / Prefer not to say 一类
   */
  function isYesNoOnlySelect(options) {
    if (!options || !options.length) return false;
    var meaningful = 0;
    var yn = 0;
    var i, o, t;
    for (i = 0; i < options.length; i++) {
      o = options[i];
      if (optionLooksEmpty(o)) continue;
      meaningful += 1;
      t = String(o.text || o.value || '').trim();
      if (YES_NO_OPTION_RE.test(t) || YES_NO_RE.test(String(o.value || '').trim())) {
        yn += 1;
      }
    }
    return meaningful >= 2 && yn >= 2 && yn === meaningful;
  }

  function valueClearlyYesNo(value) {
    var raw = String(value || '').trim();
    if (!raw) return false;
    if (YES_NO_RE.test(raw)) return true;
    // 短肯定/否定短语
    if (/^(yes[,.]?\s|no[,.]?\s)/i.test(raw) && raw.length <= 24) return true;
    return false;
  }

  function matchAgainstCandidates(options, candidates) {
    var i, o, ot, ov, on, c, lower, norm;
    for (c = 0; c < candidates.length; c++) {
      var raw = String(candidates[c] || '').trim();
      if (!raw) continue;
      lower = raw.toLowerCase();
      norm = normalize(raw);
      for (i = 0; i < options.length; i++) {
        o = options[i];
        ov = String(o.value || '').toLowerCase();
        ot = String(o.text || '').toLowerCase().trim();
        if (ov === lower || ot === lower) return o;
      }
    }
    for (c = 0; c < candidates.length; c++) {
      lower = String(candidates[c] || '').trim().toLowerCase();
      if (!lower) continue;
      for (i = 0; i < options.length; i++) {
        o = options[i];
        ot = String(o.text || '').toLowerCase().trim();
        ov = String(o.value || '').toLowerCase();
        if (!ot && !ov) continue;
        if ((ot && (ot.indexOf(lower) !== -1 || lower.indexOf(ot) !== -1)) ||
            (ov && (ov.indexOf(lower) !== -1 || lower.indexOf(ov) !== -1))) {
          return o;
        }
      }
    }
    for (c = 0; c < candidates.length; c++) {
      norm = normalize(candidates[c]);
      if (!norm) continue;
      for (i = 0; i < options.length; i++) {
        o = options[i];
        on = normalize(String(o.text || '') + ' ' + String(o.value || ''));
        if (on && (on.indexOf(norm) !== -1 || norm.indexOf(on) !== -1)) return o;
      }
    }
    return null;
  }

  /**
   * select 选项模糊匹配：精确 value/text → 包含 → 去空格后包含；
   * 学历同义扩展；Yes/No 仅选在资料值可明确映射时才匹配。
   * @param {{value:string,text:string}[]} options
   * @param {string} value
   * @returns {{value:string,text:string}|null}
   */
  function matchSelectOption(options, value) {
    if (!options || !options.length) return null;
    var raw = String(value || '').trim();
    if (!raw) return null;

    if (isYesNoOnlySelect(options)) {
      if (!valueClearlyYesNo(raw)) return null;
    }

    var candidates = [raw];
    var degreeExtra = expandDegreeSynonyms(raw);
    var i;
    for (i = 0; i < degreeExtra.length; i++) {
      if (candidates.indexOf(degreeExtra[i]) === -1) candidates.push(degreeExtra[i]);
    }

    return matchAgainstCandidates(options, candidates);
  }

  return {
    FIELD_KEYWORDS: FIELD_KEYWORDS,
    FIELD_ORDER: FIELD_ORDER,
    MAX_FILLS_PER_KEY: MAX_FILLS_PER_KEY,
    AUTOCOMPLETE_MAP: AUTOCOMPLETE_MAP,
    normalize: normalize,
    matchFieldKey: matchFieldKey,
    mapAutocomplete: mapAutocomplete,
    splitName: splitName,
    profileValue: profileValue,
    matchSelectOption: matchSelectOption,
    isYesNoOnlySelect: isYesNoOnlySelect,
    expandDegreeSynonyms: expandDegreeSynonyms
  };
});
