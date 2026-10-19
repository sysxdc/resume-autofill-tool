/**
 * 共享字段匹配逻辑：关键词、姓名拆分、profile 取值、select 模糊匹配。
 * 浏览器挂到 ResumeAutofillMatch；Node 通过 module.exports 引入。
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

  /** 更具体字段优先 */
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

  function normalize(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[\s_\-./\\:：]+/g, '')
      .replace(/[()（）\[\]【】]/g, '');
  }

  function matchFieldKey(hints) {
    var h = normalize(hints);
    if (!h) return null;
    var bestKey = null;
    var bestLen = -1;
    var bestOrder = 9999;
    for (var i = 0; i < FIELD_ORDER.length; i++) {
      var key = FIELD_ORDER[i];
      var keywords = FIELD_KEYWORDS[key] || [];
      for (var j = 0; j < keywords.length; j++) {
        var nk = normalize(keywords[j]);
        if (!nk || nk.length < 1) continue;
        // 极短 ASCII（如 org/tel）易误伤，要求整串相等或作为更长词的「独立片段」：
        // 用最长关键词优先，避免 lname ⊂ fullname、名 ⊂ 真实姓名。
        if (h.indexOf(nk) === -1) continue;
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
      // 常见复姓（简化列表）
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

  /**
   * select 选项模糊匹配：精确 value/text → 包含 → 去空格后包含
   * @param {{value:string,text:string}[]} options
   * @param {string} value
   * @returns {{value:string,text:string}|null}
   */
  function matchSelectOption(options, value) {
    if (!options || !options.length) return null;
    var raw = String(value || '').trim();
    if (!raw) return null;
    var lower = raw.toLowerCase();
    var norm = normalize(raw);

    var i, o, ot, ov, on;
    for (i = 0; i < options.length; i++) {
      o = options[i];
      ov = String(o.value || '').toLowerCase();
      ot = String(o.text || '').toLowerCase().trim();
      if (ov === lower || ot === lower) return o;
    }
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
    for (i = 0; i < options.length; i++) {
      o = options[i];
      on = normalize(String(o.text || '') + ' ' + String(o.value || ''));
      if (on && (on.indexOf(norm) !== -1 || norm.indexOf(on) !== -1)) return o;
    }
    return null;
  }

  return {
    FIELD_KEYWORDS: FIELD_KEYWORDS,
    FIELD_ORDER: FIELD_ORDER,
    MAX_FILLS_PER_KEY: MAX_FILLS_PER_KEY,
    normalize: normalize,
    matchFieldKey: matchFieldKey,
    splitName: splitName,
    profileValue: profileValue,
    matchSelectOption: matchSelectOption
  };
});
