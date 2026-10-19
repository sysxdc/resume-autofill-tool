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
    'name', 'firstName', 'lastName',
    'email', 'phone', 'city', 'address', 'province', 'zip', 'country',
    'linkedin', 'github', 'website',
    'school', 'degree', 'major', 'gradYear',
    'company', 'title', 'years', 'startDate',
    'skills', 'summary',
    'expectedSalary', 'availability', 'workAuth'
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
    email: 'zhangsan.demo@example.com',
    phone: '13800138000',
    city: '上海',
    address: '浦东新区世纪大道 1 号',
    province: '上海市',
    zip: '200120',
    country: '中国',
    linkedin: 'https://www.linkedin.com/in/zhangsan-demo',
    github: 'https://github.com/zhangsan-demo',
    website: 'https://zhangsan.demo.dev',
    school: '复旦大学',
    degree: '本科',
    major: '计算机科学与技术',
    gradYear: '2020',
    company: '示例科技有限公司',
    title: '前端工程师',
    years: '4',
    startDate: '2020-07',
    skills: 'JavaScript, TypeScript, React, Node.js, 沟通协作',
    summary: '四年前端开发经验，熟悉现代 Web 技术栈，注重用户体验与工程质量。希望加入充满挑战的团队，持续成长。',
    expectedSalary: '25K-35K',
    availability: '两周内到岗',
    workAuth: '中国大陆公民，可合法全职工作'
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

  return {
    PROFILE_FIELDS: PROFILE_FIELDS,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    SAMPLE_PROFILE: SAMPLE_PROFILE,
    emptyProfile: emptyProfile,
    normalizeProfile: normalizeProfile,
    profileHasData: profileHasData
  };
});
