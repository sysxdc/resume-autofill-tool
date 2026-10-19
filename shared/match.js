/**
 * 共享字段匹配逻辑：关键词、同义、模糊评分、姓名拆分、profile 取值、select 匹配。
 * 浏览器挂到 ResumeAutofillMatch；Node 通过 module.exports 引入。
 *
 * v1.2.1: select 仅匹配 option；Yes/No 归一；地区枚举禁止城市硬填。
 * v1.2.0: 拓展字段同义、Levenshtein/token 模糊匹配；保留 v1.1.1 denylist / autocomplete 优先。
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

  /** 模糊匹配最低分数（0–1）；exact 关键词命中视为 1.0 */
  var FUZZY_THRESHOLD = 0.72;

  /**
   * HTML autocomplete → 语义键（优先于关键词子串匹配）
   * @see https://html.spec.whatwg.org/multipage/form-control-infrastructure.html
   */
  var AUTOCOMPLETE_MAP = {
    'given-name': 'firstName',
    'additional-name': 'firstName',
    'family-name': 'lastName',
    'name': 'name',
    'nickname': 'preferredName',
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
    'url': 'website',
    'bday': 'birthday',
    'bday-year': 'birthday',
    'sex': 'gender'
  };

  /**
   * 字段键 → 匹配关键词（中英双语 + 同义拓展）
   */
  var FIELD_KEYWORDS = {
    firstName: [
      'firstname', 'first_name', 'first-name', 'givenname', 'given_name', 'given-name',
      'fname', '名', '名字', '名（', '名)'
    ],
    lastName: [
      'lastname', 'last_name', 'last-name', 'surname', 'familyname', 'family_name', 'family-name',
      'lname', '姓', '姓氏', '姓（', '姓)'
    ],
    name: [
      'fullname', 'full_name', 'full-name', 'yourname', 'your_name', 'applicantname',
      'candidate_name', 'legalname', '真实姓名', '申请人姓名', '姓名', '称呼'
    ],
    englishName: [
      'englishname', 'english_name', 'english-name', 'nameinenGLISH', 'name_en', 'enname',
      '英文名', '英文姓名', '拼音名'
    ],
    preferredName: [
      'preferredname', 'preferred_name', 'preferred-name', 'nickname', 'nick_name',
      '常用名', '昵称', '希望称呼', '偏好姓名'
    ],
    gender: [
      '性别', '男女'
    ],
    birthday: [
      'birthday', 'birthdate', 'birth_date', 'dateofbirth', 'date_of_birth', 'dob',
      '出生日期', '生日', '出生年月'
    ],
    idType: [
      'idtype', 'id_type', 'documenttype', 'doctype', '证件类型', '证件种类'
    ],
    idNumber: [
      'idnumber', 'id_number', 'idcard', 'id_card', 'nationalid', '身份证号',
      '证件号码', '身份证', '证件号'
    ],
    email: [
      'email', 'e-mail', 'mail', 'emailaddress', 'email_address', 'workemail',
      '邮箱', '电子邮件', '电子邮箱', '邮件地址', '联系邮箱'
    ],
    secondaryEmail: [
      'secondaryemail', 'secondary_email', 'alternateemail', 'alt_email', 'backupemail',
      '备用邮箱', '第二邮箱', '其他邮箱'
    ],
    phone: [
      'phone', 'mobile', 'tel', 'telephone', 'cellphone', 'cell', 'phonenumber',
      'phone_number', 'phone-number', 'contactnumber', '手机号', '手机号码',
      '电话', '联系电话', '移动电话', '座机'
    ],
    wechat: [
      'wechat', 'weixin', 'wei_xin', '微信号', '微信'
    ],
    qq: [
      'qq号', 'qq号码', '腾讯qq', 'qq'
    ],
    emergencyContact: [
      'emergencycontact', 'emergency_contact', 'emergencyphone', '紧急联系人',
      '紧急联络', '应急联系'
    ],
    city: [
      'city', 'locality', 'addresscity', 'address_city',
      '所在城市', '居住城市', '城市'
    ],
    currentCity: [
      'currentcity', 'current_city', 'current-city', 'livingcity', 'presentcity',
      '现居城市', '目前城市', '当前城市', '现所在城市'
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
    hukou: [
      'hukou', 'householdregister', '户籍', '户口所在地', '户口'
    ],
    nativePlace: [
      'nativeplace', 'native_place', 'hometown', '籍贯', '出生地'
    ],
    willingToRelocate: [
      'willingtorelocate', 'willing_to_relocate', 'relocate', 'relocation',
      '是否接受调剂', '接受调动', '是否愿意异地', '可接受调迁', '异地工作', '愿意搬迁'
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
    gpa: [
      'gpa', 'grade point', '平均绩点', '学分绩点', '成绩绩点'
    ],
    eduStart: [
      'edustart', 'edu_start', 'enrollmentdate', 'enrollment', '入学时间', '入学日期', '就读开始'
    ],
    eduEnd: [
      'eduend', 'edu_end', 'graduationdate', '毕业日期', '就读结束', '学业结束'
    ],
    dualDegree: [
      'dualdegree', 'dual_degree', 'doublemajor', 'double_major', '辅修', '双学位', '第二学位'
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
      '入职时间', '任职开始', '开始日期'
    ],
    industry: [
      'industry', 'sector', '所属行业', '行业', '从事行业'
    ],
    department: [
      'department', 'dept', '所在部门', '部门', '科室'
    ],
    jobType: [
      'jobtype', 'job_type', 'employmenttype', 'employment_type', 'worktype',
      '工作性质', '职位类型', '全职兼职', '用工类型'
    ],
    leaveReason: [
      'leavereason', 'leave_reason', 'reasonforleaving', '离职原因', '离职理由', '离开原因'
    ],
    achievements: [
      'achievements', 'accomplishment', 'highlights', 'keyachievements',
      '工作业绩', '主要成就', '业绩亮点', '工作成果'
    ],
    projectName: [
      'projectname', 'project_name', 'projecttitle', '项目名称', '项目名'
    ],
    projectRole: [
      'projectrole', 'project_role', 'projecttitle_role', '项目角色', '项目职务', '在项目中担任'
    ],
    projectDesc: [
      'projectdesc', 'project_desc', 'projectdescription', 'project_description',
      'projectexperience', 'project_experience', '项目经历', '项目描述', '项目介绍', '项目说明'
    ],
    skills: [
      'skills', 'skill', 'expertise', 'competencies', 'techstack',
      '专业技能', '掌握技能', '技术栈', '技能特长', '技能'
    ],
    summary: [
      'summary', 'about', 'bio', 'introduction', 'coverletter', 'cover_letter',
      'objective', 'selfintro', '自我介绍', '个人简介', '自我评价', '求职信',
      '个人总结', '简介', '补充说明', 'whyjoin', 'why_join', 'whydoyouwant'
    ],
    expectedSalary: [
      'expectedsalary', 'expected_salary', 'salaryexpectation', 'salary', 'compensation',
      '期望薪资', '期望月薪', '薪资期望', '期望待遇', '薪资要求'
    ],
    expectedCity: [
      'expectedcity', 'expected_city', 'preferredcity', 'preferred_location', 'preferredlocation',
      'intentioncity', '期望城市', '意向城市', '期望工作地', '意向工作城市', '目标城市'
    ],
    jobTarget: [
      'jobtarget', 'job_target', 'desiredposition', 'desired_position', 'targetrole',
      '求职意向', '目标职位', '期望职位', '意向岗位'
    ],
    availability: [
      'availability', 'availabledate', '到岗', '可到岗', '到岗时间'
    ],
    noticePeriod: [
      'noticeperiod', 'notice_period', '通知期', '离职通知期', '辞呈期', 'notice'
    ],
    earliestStart: [
      'earlieststart', 'earliest_start', 'startdateavailable', '最早到岗', '最早入职', '可开始日期'
    ],
    workAuth: [
      'workauthorization', 'work_authorization', 'workauth', 'visa', 'sponsorship',
      'eligibletowork', '工作许可', '签证', '工作签证', '合法工作', '用工资格'
    ],
    languages: [
      'languages', 'language', 'languageskills', '语言能力', '外语水平', '掌握语言', '语种'
    ],
    certificates: [
      'certificates', 'certifications', 'certificate', 'license', '资质证书',
      '证书', '资格证', '认证'
    ],
    referralSource: [
      'referralsource', 'referral_source', '招聘渠道', '应聘渠道', '投递来源', '获知渠道'
    ],
    additionalInfo: [
      'additionalinfo', 'additional_info', 'otherinfo', 'remarks', 'notes',
      '其他信息', '补充信息', '备注', '其他说明'
    ]
  };

  /** 更具体字段优先（同长度时参考） */
  var FIELD_ORDER = [
    'englishName', 'preferredName', 'firstName', 'lastName',
    'secondaryEmail', 'email', 'wechat', 'qq', 'emergencyContact', 'phone',
    'birthday', 'idType', 'idNumber', 'gender',
    'linkedin', 'github', 'website',
    'expectedCity', 'currentCity',
    'hukou', 'nativePlace', 'willingToRelocate',
    'gradYear', 'gpa', 'eduStart', 'eduEnd', 'dualDegree', 'school', 'degree', 'major',
    'projectName', 'projectRole', 'projectDesc',
    'leaveReason', 'achievements', 'industry', 'department', 'jobType',
    'company', 'title', 'years', 'startDate',
    'expectedSalary', 'jobTarget', 'noticePeriod', 'earliestStart', 'availability', 'workAuth',
    'languages', 'certificates',
    'skills', 'summary', 'referralSource', 'additionalInfo',
    'zip', 'province', 'country', 'city', 'address',
    'name'
  ];

  /**
   * 短 ASCII 关键词：必须词界/整 token 匹配，禁止裸子串
   */
  var SHORT_BOUNDARY_KEYWORDS = {
    org: 1, city: 1, about: 1, employer: 1, addr: 1, tel: 1, mail: 1,
    role: 1, bio: 1, skill: 1, nation: 1, state: 1, region: 1, title: 1,
    years: 1, zip: 1, cell: 1, blog: 1, name: 1, phone: 1, email: 1,
    qq: 1, gpa: 1, dob: 1, dept: 1, sex: 1, notice: 1
  };

  /** 整段跳过：EEO / 法律问卷 / 听说来源 / 是否曾任职 等 */
  var SKIP_SUBSTRINGS = [
    'ethnicity', 'hispanic', 'latino', 'gender', 'veteran', 'disability',
    'howdidyouhear', 'hearaboutthis', 'heardabout',
    'previouslyworked', 'workedatorconsulted', 'consultedfor',
    'employmentagreement', 'postemployment', 'postemploymentrestriction',
    'subjecttoanyemployment',
    'incapacity', 'anycapacity',
    'prefernottosay', 'declinetoself',
    'race', 'sexualorientation', 'lgbtq'
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

  /** 地区/国家枚举常见选项（不含具体城市名时，禁止把 city 填进 based/region select） */
  var REGION_ENUM_OPTION_RE = /^(united\s*states|usa|u\.s\.a?\.?|us|canada|ca|united\s*kingdom|uk|great\s*britain|australia|au|located\s*elsewhere|elsewhere|other|outside|rest\s*of\s*(the\s*)?world|欧洲|亚洲|北美|其他|其他地区|其他国家)$/i;

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
    return nk.length <= 3 && /^[a-z0-9]+$/.test(nk);
  }

  function keywordOccurs(rawLower, normalizedHints, keyword) {
    var nk = normalize(keyword);
    if (!nk) return false;
    if (isShortAsciiKeyword(nk)) {
      var kw = String(keyword).toLowerCase().replace(/[\s_\-]+/g, '');
      var re = new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(kw) + '(?:[^a-z0-9]|$)', 'i');
      if (re.test(rawLower)) return true;
      var camel = rawLower.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      if (camel !== rawLower && re.test(camel)) return true;
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
    var i;
    for (i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      if (!p || p === 'on' || p === 'off' || p === 'new-password' || p === 'current-password') continue;
      if (AUTOCOMPLETE_MAP[p]) return AUTOCOMPLETE_MAP[p];
    }
    return null;
  }

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
    if (/(?:^|[^a-z0-9])capacity(?:[^a-z0-9]|$)/i.test(rawLower)) return true;
    if (/how\s+did\s+you\s+hear/i.test(rawLower)) return true;
    if (/hear\s+about\s+(this|us|the|our)/i.test(rawLower)) return true;
    if (/employment\s+agreements?/i.test(rawLower)) return true;
    if (/post[\s-]?employment/i.test(rawLower)) return true;
    if (/previously\s+worked/i.test(rawLower)) return true;
    if (/worked\s+at\s+or\s+consulted/i.test(rawLower)) return true;
    if (/ever\s+worked\s+for/i.test(rawLower)) return true;
    return false;
  }

  /** Levenshtein distance */
  function levenshtein(a, b) {
    var s = String(a || '');
    var t = String(b || '');
    var n = s.length;
    var m = t.length;
    if (!n) return m;
    if (!m) return n;
    var i, j, prev, cur, tmp;
    var row = new Array(m + 1);
    for (j = 0; j <= m; j++) row[j] = j;
    for (i = 1; i <= n; i++) {
      prev = i;
      for (j = 1; j <= m; j++) {
        if (s.charAt(i - 1) === t.charAt(j - 1)) cur = row[j - 1];
        else cur = Math.min(row[j - 1], prev, row[j]) + 1;
        row[j - 1] = prev;
        prev = cur;
      }
      row[m] = prev;
    }
    return row[m];
  }

  function similarity(a, b) {
    var s = String(a || '');
    var t = String(b || '');
    if (!s && !t) return 1;
    if (!s || !t) return 0;
    var maxLen = Math.max(s.length, t.length);
    if (!maxLen) return 1;
    return 1 - levenshtein(s, t) / maxLen;
  }

  function tokenize(str) {
    return String(str || '')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .filter(function (t) { return t && t.length > 0; });
  }

  /**
   * 模糊评分：includes / token overlap / Levenshtein，返回 0–1
   */
  function scoreKeywordAgainstHints(rawLower, normalizedHints, keyword) {
    var nk = normalize(keyword);
    if (!nk) return 0;
    if (keywordOccurs(rawLower, normalizedHints, keyword)) return 1;

    // 短 ASCII / 词界关键词：禁止模糊子串（避免 org⊂forgot / forgitlab）
    if (isShortAsciiKeyword(nk)) return 0;

    var score = 0;
    if (!normalizedHints || nk.length < 4) return 0;

    var tokens = tokenize(rawLower);
    var hi, tn, incl, sim, pos, slice, s2;
    for (hi = 0; hi < tokens.length; hi++) {
      tn = normalize(tokens[hi]);
      if (!tn || tn.length < 3) continue;
      if (tn === nk) return 1;
      // 仅当较短一方长度 ≥ 4，且为整词级包含，才给 includes 分
      if (tn.length >= 4 && nk.length >= 4) {
        if (tn.indexOf(nk) !== -1 || nk.indexOf(tn) !== -1) {
          incl = Math.min(nk.length, tn.length) / Math.max(nk.length, tn.length);
          // 要求包含比例较高，避免 org 类短词漏网（已在上方拦截）
          if (incl >= 0.7) score = Math.max(score, 0.6 + 0.4 * incl);
        } else {
          sim = similarity(tn, nk);
          if (sim >= 0.8) score = Math.max(score, sim * 0.95);
        }
      }
    }

    // 中文/长短语：在 normalize 串上滑窗相似度
    if (nk.length >= 4 && normalizedHints.length >= 4) {
      for (pos = 0; pos + nk.length <= normalizedHints.length; pos++) {
        slice = normalizedHints.substr(pos, nk.length);
        s2 = similarity(slice, nk);
        if (s2 >= FUZZY_THRESHOLD) score = Math.max(score, s2);
      }
      // 也允许 hints 明显包含较长关键词
      if (normalizedHints.indexOf(nk) !== -1) score = Math.max(score, 1);
    }
    return score;
  }

  function addressCityGuard(key, nk, rawLower, h) {
    if (key === 'address' && nk === 'address') {
      if (keywordOccurs(rawLower, h, 'city') || /\bcity\b/i.test(rawLower)) {
        var strongAddr =
          keywordOccurs(rawLower, h, 'street') ||
          h.indexOf('streetaddress') !== -1 ||
          h.indexOf('详细地址') !== -1 ||
          h.indexOf('addressline') !== -1 ||
          h.indexOf('mailingaddress') !== -1;
        if (!strongAddr) return false;
      }
    }
    return true;
  }

  /**
   * @param {string} hints
   * @param {{autocomplete?: string}|string} [options]
   * @returns {string|null}
   */
  function matchFieldKey(hints, options) {
    var scored = matchFieldKeyScored(hints, options);
    return scored ? scored.key : null;
  }

  /**
   * 带置信度的匹配：{ key, confidence, method }
   * method: autocomplete | keyword | fuzzy | null
   */
  function matchFieldKeyScored(hints, options) {
    var autocomplete = '';
    if (typeof options === 'string') {
      autocomplete = options;
    } else if (options && typeof options === 'object') {
      autocomplete = options.autocomplete || '';
    }

    var acKey = mapAutocomplete(autocomplete);
    if (acKey) return { key: acKey, confidence: 1, method: 'autocomplete' };

    var raw = String(hints || '');
    var rawLower = raw.toLowerCase();
    var h = normalize(raw);
    if (!h && !autocomplete) return null;

    var embedded = mapAutocompleteFromHints(rawLower);
    if (embedded) return { key: embedded, confidence: 1, method: 'autocomplete' };

    if (isSkipContext(rawLower, h)) return null;

    var bestKey = null;
    var bestLen = -1;
    var bestOrder = 9999;
    var bestScore = 0;
    var bestMethod = 'keyword';

    var i, j, key, keywords, kw, nk, sc;
    // Pass 1: exact keyword
    for (i = 0; i < FIELD_ORDER.length; i++) {
      key = FIELD_ORDER[i];
      keywords = FIELD_KEYWORDS[key] || [];
      for (j = 0; j < keywords.length; j++) {
        kw = keywords[j];
        nk = normalize(kw);
        if (!nk || nk.length < 1) continue;
        if (!keywordOccurs(rawLower, h, kw)) continue;
        if (!addressCityGuard(key, nk, rawLower, h)) continue;
        if (nk.length > bestLen || (nk.length === bestLen && i < bestOrder)) {
          bestLen = nk.length;
          bestKey = key;
          bestOrder = i;
          bestScore = 1;
          bestMethod = 'keyword';
        }
      }
    }
    if (bestKey) return { key: bestKey, confidence: bestScore, method: bestMethod };

    // Pass 2: fuzzy synonym / token / Levenshtein
    bestKey = null;
    bestScore = 0;
    bestOrder = 9999;
    for (i = 0; i < FIELD_ORDER.length; i++) {
      key = FIELD_ORDER[i];
      keywords = FIELD_KEYWORDS[key] || [];
      for (j = 0; j < keywords.length; j++) {
        kw = keywords[j];
        nk = normalize(kw);
        if (!nk || nk.length < 2) continue;
        sc = scoreKeywordAgainstHints(rawLower, h, kw);
        if (sc < FUZZY_THRESHOLD) continue;
        if (!addressCityGuard(key, nk, rawLower, h)) continue;
        if (sc > bestScore || (sc === bestScore && i < bestOrder)) {
          bestScore = sc;
          bestKey = key;
          bestOrder = i;
          bestMethod = 'fuzzy';
        }
      }
    }
    if (bestKey && bestScore >= FUZZY_THRESHOLD) {
      return { key: bestKey, confidence: Math.round(bestScore * 1000) / 1000, method: bestMethod };
    }
    return null;
  }

  /**
   * 启发式：把 content 收集的字段列表映射到 profile key / skip
   * @returns {{index:number, profileKey:string|null, action:string, confidence:number, suggestedValue:string, method:string}[]}
   */
  function heuristicMapFields(fields, profile) {
    var list = fields || [];
    var keyCounts = {};
    var out = [];
    var i, f, scored, key, conf, value, action;
    for (i = 0; i < list.length; i++) {
      f = list[i] || {};
      var hints = [f.label, f.placeholder, f.name, f.id, f.autocomplete].filter(Boolean).join(' ');
      scored = matchFieldKeyScored(hints, { autocomplete: f.autocomplete || '' });
      if (!scored) {
        out.push({
          index: typeof f.index === 'number' ? f.index : i,
          profileKey: null,
          action: 'skip',
          confidence: 0,
          suggestedValue: '',
          method: 'none',
          label: f.label || f.placeholder || f.name || f.id || ''
        });
        continue;
      }
      key = scored.key;
      conf = scored.confidence;
      var count = keyCounts[key] || 0;
      if (count >= MAX_FILLS_PER_KEY) {
        out.push({
          index: typeof f.index === 'number' ? f.index : i,
          profileKey: key,
          action: 'skip',
          confidence: conf,
          suggestedValue: '',
          method: scored.method,
          label: f.label || f.placeholder || f.name || f.id || '',
          reason: 'cap'
        });
        continue;
      }
      value = profileValue(profile, key);
      action = value ? 'fill' : 'skip';
      var label = f.label || f.placeholder || f.name || f.id || '';
      var opts = f.options || null;

      // 地区枚举 select（US/Canada/Elsewhere）：禁止用城市名强行填写
      if (action === 'fill' && opts && opts.length) {
        if ((key === 'city' || key === 'currentCity' || key === 'province' || key === 'country') &&
            (isRegionCountryEnumSelect(opts) || isBasedRegionQuestion(label))) {
          if (!matchSelectOption(opts, value)) {
            action = 'skip';
            value = '';
          }
        } else {
          // 任意带 options 的字段：填前必须能匹配 option
          var resolved = resolveSelectFillValue(opts, value);
          if (!resolved) {
            action = 'skip';
            value = '';
          } else {
            value = resolved;
          }
        }
      } else if (action === 'fill' && isBasedRegionQuestion(label) &&
                 (key === 'city' || key === 'currentCity')) {
        // 无 options 时：based 问题不要用城市启发式硬填
        action = 'skip';
        value = '';
      }

      if (value && action === 'fill') keyCounts[key] = count + 1;
      out.push({
        index: typeof f.index === 'number' ? f.index : i,
        profileKey: key,
        action: action,
        confidence: conf,
        suggestedValue: value || '',
        method: scored.method,
        label: label
      });
    }
    return out;
  }

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
    // currentCity 可回退到 city
    if (key === 'currentCity') {
      var cc = profile.currentCity && String(profile.currentCity).trim();
      if (cc) return cc;
      return (profile.city && String(profile.city).trim()) || '';
    }
    if (key === 'city') {
      var c = profile.city && String(profile.city).trim();
      if (c) return c;
      return (profile.currentCity && String(profile.currentCity).trim()) || '';
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
    // Select... / Please select / — 等占位项
    if (/^(please\s*select|select|选择|请选择)\b/i.test(t)) return true;
    if (/^(—+|-+|\.+)\$/i.test(t)) return true;
    if (!v && /^(please\s*select|select|选择|请选择)/i.test(t)) return true;
    return false;
  }

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
    return normalizeToYesNo(value) != null;
  }

  /**
   * 把自由文本归一成 Yes / No（匹配 option 文案），无法判断则 null。
   * 支持：yes/是/true、no/否/false；句首 Yes/No；签证/赞助意图（No I am citizen…）。
   * 长段落且无明确 Yes/No 意图 → null（绝不把段落贴进 select）。
   */
  function normalizeToYesNo(value) {
    var raw = String(value || '').trim();
    if (!raw) return null;

    if (YES_NO_RE.test(raw)) {
      if (/^(yes|y|true|是|有|可以)$/i.test(raw)) return 'Yes';
      return 'No';
    }

    // 句首 Yes / No（含 "No I am citizen…" / "Yes, I need sponsorship"）
    if (/^(yes|y)\b/i.test(raw)) return 'Yes';
    if (/^(no|n)\b/i.test(raw)) return 'No';
    if (/^(是|有|可以)[，,、\s]/.test(raw)) return 'Yes';
    if (/^(否|无|不可以)[，,、\s]/.test(raw)) return 'No';

    var lower = raw.toLowerCase();
    // 签证/赞助意图
    if (/\b(do\s*not|don't|dont|no)\b.{0,40}\b(need|require|request)\b.{0,40}\b(sponsor|sponsorship|visa)\b/i.test(raw) ||
        /\b(no)\b.{0,20}\b(sponsor|sponsorship)\b/i.test(raw) ||
        /\b(citizen|permanent\s*resident|do\s*not\s*need\s*(a\s*)?visa)\b/i.test(raw) &&
          /\b(no|not|don't|do\s*not)\b/i.test(raw)) {
      return 'No';
    }
    if (/\b(need|require|request)\b.{0,40}\b(sponsor|sponsorship|visa)\b/i.test(raw) &&
        !/\b(do\s*not|don't|dont|no)\b/i.test(raw.slice(0, Math.min(48, raw.length)))) {
      return 'Yes';
    }
    if (/不需要.{0,8}(签证|赞助)|无需.{0,8}(签证|赞助)|不需要担保/.test(raw)) return 'No';
    if (/需要.{0,8}(签证|赞助|担保)/.test(raw) && !/不需要/.test(raw)) return 'Yes';

    // 中等长度且整句像 yes/no 短语
    if (raw.length <= 24 && /^(yes|no)\b/i.test(raw)) {
      return /^(yes)\b/i.test(raw) ? 'Yes' : 'No';
    }

    // 长段落无明确意图 → 跳过
    return null;
  }

  /**
   * 选项是否像「国家/大区」枚举（US / Canada / Located Elsewhere），而非城市列表。
   */
  function isRegionCountryEnumSelect(options) {
    if (!options || !options.length) return false;
    var meaningful = 0;
    var regionish = 0;
    var i, o, t;
    for (i = 0; i < options.length; i++) {
      o = options[i];
      if (optionLooksEmpty(o)) continue;
      meaningful += 1;
      t = String(o.text || o.value || '').trim();
      if (REGION_ENUM_OPTION_RE.test(t) ||
          /\b(united\s*states|canada|located\s*elsewhere|elsewhere|other\s*country|rest\s*of\s*world)\b/i.test(t)) {
        regionish += 1;
      }
    }
    return meaningful >= 2 && regionish >= 2 && regionish >= Math.ceil(meaningful * 0.6);
  }

  /**
   * 标签是否像「当前所在地区 / based」类问题（易被误映射到 city）。
   */
  function isBasedRegionQuestion(label) {
    var s = String(label || '');
    if (/where\s+are\s+you\s+(currently\s+)?based/i.test(s)) return true;
    if (/currently\s+based/i.test(s)) return true;
    if (/which\s+(region|country|area)\s+(are\s+you|do\s+you)/i.test(s)) return true;
    if (/所在(地区|区域|国家|大区)/.test(s) && !/城市/.test(s)) return true;
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
      // 禁止用很长的自由文本去做 includes 子串匹配（避免段落误命中短 option）
      if (lower.length > 48) continue;
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
      var cand = String(candidates[c] || '').trim();
      if (cand.length > 48) continue;
      norm = normalize(cand);
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
   * 仅当 value 与某 option 的 text/value 明确匹配时返回该 option；否则 null。
   * Yes/No 选项集会先 normalizeToYesNo，再匹配；无法归一则跳过（永不贴段落）。
   */
  function matchSelectOption(options, value) {
    if (!options || !options.length) return null;
    var raw = String(value || '').trim();
    if (!raw) return null;

    var candidates = [];
    if (isYesNoOnlySelect(options)) {
      var yn = normalizeToYesNo(raw);
      if (!yn) return null;
      candidates = [yn, yn.toLowerCase()];
      if (yn === 'Yes') candidates.push('是', '有', '可以', 'true', 'Y', 'y', '1');
      if (yn === 'No') candidates.push('否', '无', '不可以', 'false', 'N', 'n', '0');
    } else {
      candidates = [raw];
      var degreeExtra = expandDegreeSynonyms(raw);
      var i;
      for (i = 0; i < degreeExtra.length; i++) {
        if (candidates.indexOf(degreeExtra[i]) === -1) candidates.push(degreeExtra[i]);
      }
    }

    return matchAgainstCandidates(options, candidates);
  }

  /**
   * 在填写前校验：有 options 时必须 matchSelectOption 成功。
   * 返回应用的值（通常是 option.text 或归一后的 Yes/No），失败返回 ''。
   */
  function resolveSelectFillValue(options, value) {
    if (!options || !options.length) return String(value || '').trim();
    var matched = matchSelectOption(options, value);
    if (!matched) return '';
    var t = String(matched.text || '').trim();
    var v = String(matched.value || '').trim();
    // 优先可读 text；空 text 则用 value
    if (t && !optionLooksEmpty({ text: t, value: v })) return t;
    return v || t;
  }

  return {
    FIELD_KEYWORDS: FIELD_KEYWORDS,
    FIELD_ORDER: FIELD_ORDER,
    MAX_FILLS_PER_KEY: MAX_FILLS_PER_KEY,
    FUZZY_THRESHOLD: FUZZY_THRESHOLD,
    AUTOCOMPLETE_MAP: AUTOCOMPLETE_MAP,
    SKIP_SUBSTRINGS: SKIP_SUBSTRINGS,
    normalize: normalize,
    levenshtein: levenshtein,
    similarity: similarity,
    matchFieldKey: matchFieldKey,
    matchFieldKeyScored: matchFieldKeyScored,
    heuristicMapFields: heuristicMapFields,
    mapAutocomplete: mapAutocomplete,
    splitName: splitName,
    profileValue: profileValue,
    matchSelectOption: matchSelectOption,
    resolveSelectFillValue: resolveSelectFillValue,
    isYesNoOnlySelect: isYesNoOnlySelect,
    normalizeToYesNo: normalizeToYesNo,
    valueClearlyYesNo: valueClearlyYesNo,
    isRegionCountryEnumSelect: isRegionCountryEnumSelect,
    isBasedRegionQuestion: isBasedRegionQuestion,
    expandDegreeSynonyms: expandDegreeSynonyms,
    isSkipContext: function (hints) {
      var raw = String(hints || '');
      return isSkipContext(raw.toLowerCase(), normalize(raw));
    }
  };
});
