/**
 * 共享简历资料 schema：默认空 profile、字段列表、示例资料。
 * 同时支持浏览器全局（ResumeAutofillProfile）与 Node（module.exports）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ResumeAutofillProfile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 全部字段键（顺序即表单展示顺序参考） */
  var PROFILE_FIELDS = [
    // 基本 / 身份
    'name', 'firstName', 'lastName', 'englishName', 'preferredName',
    'gender', 'birthday', 'idType', 'idNumber',
    // 联系
    'email', 'secondaryEmail', 'phone', 'wechat', 'qq', 'emergencyContact',
    // 地址 / 地点
    'city', 'currentCity', 'address', 'province', 'zip', 'country',
    'hukou', 'nativePlace', 'willingToRelocate',
    // 链接
    'linkedin', 'github', 'website',
    // 教育
    'school', 'degree', 'major', 'gradYear', 'gpa', 'eduStart', 'eduEnd', 'dualDegree',
    // 工作
    'company', 'title', 'years', 'startDate', 'industry', 'department',
    'jobType', 'leaveReason', 'achievements',
    // 项目
    'projectName', 'projectRole', 'projectDesc',
    // 求职偏好
    'expectedSalary', 'expectedCity', 'jobTarget', 'availability',
    'noticePeriod', 'earliestStart', 'workAuth',
    // 语言与证书
    'languages', 'certificates',
    // 其他
    'skills', 'summary', 'referralSource', 'additionalInfo'
  ];

  function emptyProfile() {
    var p = {};
    for (var i = 0; i < PROFILE_FIELDS.length; i++) {
      p[PROFILE_FIELDS[i]] = '';
    }
    return p;
  }

  var DEFAULT_PROFILE = emptyProfile();

  /** 中文演示用示例资料（非真实个人信息） */
  var SAMPLE_PROFILE = {
    name: '张三',
    firstName: '三',
    lastName: '张',
    englishName: 'San Zhang',
    preferredName: '小张',
    gender: '男',
    birthday: '1998-05-20',
    idType: '',
    idNumber: '',
    email: 'zhangsan.demo@example.com',
    secondaryEmail: 'zhangsan.alt@example.com',
    phone: '13800138000',
    wechat: 'zhangsan_demo',
    qq: '10001',
    emergencyContact: '李四 13900139000',
    city: '上海',
    currentCity: '上海',
    address: '浦东新区世纪大道 1 号',
    province: '上海市',
    zip: '200120',
    country: '中国',
    hukou: '上海',
    nativePlace: '浙江杭州',
    willingToRelocate: '可接受长三角出差/调动',
    linkedin: 'https://www.linkedin.com/in/zhangsan-demo',
    github: 'https://github.com/zhangsan-demo',
    website: 'https://zhangsan.demo.dev',
    school: '复旦大学',
    degree: '本科',
    major: '计算机科学与技术',
    gradYear: '2020',
    gpa: '3.6/4.0',
    eduStart: '2016-09',
    eduEnd: '2020-06',
    dualDegree: '',
    company: '示例科技有限公司',
    title: '前端工程师',
    years: '4',
    startDate: '2020-07',
    industry: '互联网 / 软件',
    department: '产品研发部',
    jobType: '全职',
    leaveReason: '寻求更大平台与成长空间',
    achievements: '主导组件库升级，首屏性能提升 35%；带教 2 名新人。',
    projectName: '企业级表单引擎',
    projectRole: '前端负责人',
    projectDesc: '设计可配置表单渲染与校验体系，覆盖 20+ 业务场景，支撑日均千万级提交。',
    expectedSalary: '25K-35K',
    expectedCity: '上海 / 杭州',
    jobTarget: '高级前端 / 全栈工程师',
    availability: '两周内到岗',
    noticePeriod: '两周',
    earliestStart: '两周内',
    workAuth: '中国大陆公民，可合法全职工作',
    languages: '普通话（母语）、英语（流利）',
    certificates: 'CET-6；AWS Cloud Practitioner（示例）',
    skills: 'JavaScript, TypeScript, React, Node.js, 沟通协作',
    summary: '四年前端开发经验，熟悉现代 Web 技术栈，注重用户体验与工程质量。希望加入充满挑战的团队，持续成长。',
    referralSource: '官网 / 内推',
    additionalInfo: '可接受远程与弹性办公；持有本地社保。'
  };

  function normalizeProfile(raw) {
    var out = emptyProfile();
    var src = raw || {};
    for (var i = 0; i < PROFILE_FIELDS.length; i++) {
      var k = PROFILE_FIELDS[i];
      if (src[k] != null) out[k] = String(src[k]).trim();
    }
    return out;
  }

  function profileHasData(profile) {
    var p = profile || {};
    for (var i = 0; i < PROFILE_FIELDS.length; i++) {
      var v = p[PROFILE_FIELDS[i]];
      if (v && String(v).trim()) return true;
    }
    return false;
  }

  /** 仅非空字段，供 AI prompt 使用，避免泄露空键噪音 */
  function profileNonEmpty(profile) {
    var p = normalizeProfile(profile);
    var out = {};
    for (var i = 0; i < PROFILE_FIELDS.length; i++) {
      var k = PROFILE_FIELDS[i];
      if (p[k]) out[k] = p[k];
    }
    return out;
  }

  return {
    PROFILE_FIELDS: PROFILE_FIELDS,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    SAMPLE_PROFILE: SAMPLE_PROFILE,
    emptyProfile: emptyProfile,
    normalizeProfile: normalizeProfile,
    profileHasData: profileHasData,
    profileNonEmpty: profileNonEmpty
  };
});
