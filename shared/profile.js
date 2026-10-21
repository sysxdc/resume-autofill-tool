/**
 * 共享简历资料 schema：默认空 profile、字段列表、示例资料。
 * playoffer.cn 启发的扁平 schema（v1.3.0）；多段经历仅存主条目。
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

  /**
   * 全部字段键（顺序即选项页分区参考）。
   * 保留旧键名以兼容；新增 camelCase 补齐 playoffer 标签。
   */
  var PROFILE_FIELDS = [
    // —— 个人信息 / 身份 ——
    'resumeTitle',
    'name', 'firstName', 'lastName', 'namePinyin', 'englishName', 'preferredName',
    'gender', 'birthday', 'age',
    'nationality', 'ethnicity', 'politicalStatus', 'maritalStatus',
    'idType', 'idNumber',
    // —— 联系 ——
    'email', 'secondaryEmail', 'phone', 'wechat', 'qq',
    'emergencyContact', 'emergencyContactName', 'emergencyContactRelation', 'emergencyContactPhone',
    // —— 地址 / 地点 ——
    'city', 'currentCity', 'currentAddress', 'address', 'province', 'zip', 'country',
    'nativePlace', 'studentOrigin', 'hukouType', 'hukou',
    'archiveLocation', 'willingToRelocate',
    // —— 链接 ——
    'linkedin', 'github', 'website',
    // —— 个人补充 ——
    'height', 'weight', 'bloodType',
    'healthStatus', 'hasChronicIllness', 'hasCriminalRecord',
    'hasMilitaryService', 'isVeteran',
    'partyJoinDate', 'leagueOrPartyJoinDate',
    'isRecommendedPostgrad', 'hasStudyAbroad', 'isPovertyStudent', 'isColorWeak',
    'hasOverseasIdentity',
    'englishLevel', 'gaokaoDate', 'gaokaoScore', 'gaokaoSubjects',
    'professionalTitle',
    'highestDegree', 'isFreshGraduate', 'workStatus', 'years', 'lastCompany',
    'summary', 'personalStrengths', 'hobbies', 'careerPlan', 'additionalInfo',
    // —— 求职意向 ——
    'jobTarget', 'expectedIndustry', 'currentIndustry', 'expectedStartDate',
    'expectedCity', 'interviewCity', 'expectedSalary', 'expectedAnnualSalary', 'currentSalary',
    'hasRelativeAtCompany', 'referralSource', 'acceptAdjustment',
    'availability', 'noticePeriod', 'earliestStart', 'workAuth',
    // —— 教育背景（主条目） ——
    'school', 'eduDegree', 'degree', 'isUpgradeFromCollege', 'department', 'major', 'majorCategory',
    'schoolCity', 'schoolType', 'eduStatus', 'eduYears', 'studyMode', 'eduMode',
    'eduStart', 'eduEnd', 'gradYear', 'degreeAwardDate',
    'degreeType', 'degreeCategory', 'enrollmentType', 'isTongzhao',
    'gpa', 'failedCourses', 'classRank', 'majorRank', 'majorClassSize',
    'eduCertNo', 'degreeCertNo', 'studentId', 'advisorName', 'labName',
    'isNationalKeyLab', 'isJointTraining', 'counselorName', 'counselorContact', 'isOverseasSchool',
    'eduDescription', 'majorDescription', 'majorCourses', 'researchDirection', 'thesisTitle',
    'dualDegree',
    // —— 实习经历（主条目） ——
    'internCompany', 'internCompanySize', 'internOverseas', 'internDepartment', 'internTitle',
    'internStart', 'internEnd', 'internCity', 'internIndustry', 'internEmploymentType',
    'internAnnualSalary', 'internRefereeName', 'internRefereeContact', 'internRefereeTitle',
    'internDescription', 'internLeaveReason',
    // —— 工作经历（主条目） ——
    'company', 'companySize', 'workOverseas', 'title', 'startDate', 'workEnd', 'endDate',
    'workCity', 'industry', 'jobType', 'employmentType',
    'monthlySalary', 'annualSalary',
    'refereeName', 'refereeContact', 'refereeTitle',
    'achievements', 'workDescription', 'leaveReason',
    // —— 项目经历 ——
    'projectName', 'projectTeamSize', 'projectOverseas', 'projectRole', 'projectPracticeMode',
    'projectStart', 'projectEnd', 'projectCity', 'projectLink',
    'projectRefereeName', 'projectRefereeContact', 'projectRefereeTitle',
    'projectDesc', 'projectResponsibilities', 'projectOutcome',
    // —— 校园经历 ——
    'campusOrg', 'campusLevel', 'campusRole', 'campusStart', 'campusEnd',
    'campusWorkContent', 'campusDuty',
    // —— 社会实践 ——
    'socialOrg', 'socialRole', 'socialStart', 'socialEnd', 'socialContent',
    // —— 技能专长 ——
    'techSkills', 'skills', 'languages', 'softwareSkills', 'softSkills', 'certificates',
    // —— 证书（主条目） ——
    'certName', 'certType', 'certDate', 'certNo', 'certIssuer', 'certScore', 'certExpiry', 'certDescription',
    // —— 外语能力（主条目） ——
    'langName', 'langDate', 'langCertName', 'langScore', 'langLevel', 'langListenSpeak', 'langReadWrite',
    // —— 家庭情况（主成员，敏感/选填） ——
    'familyName', 'familyRelation', 'familyGender', 'familyEducation', 'familyEthnicity', 'familyIdNumber',
    'familyBirthday', 'familyPhone', 'familyEmployer', 'familyTitle', 'familyPoliticalStatus', 'familyAddress',
    // —— 获奖 ——
    'awardName', 'awardIssuer', 'awardDate', 'awardEnd', 'awardLevel', 'awardType', 'awardGrade', 'awardDescription',
    'honors',
    // —— 专利 ——
    'patentName', 'patentNo', 'patentApplyDate', 'patentStatus', 'patentInventor', 'patentDescription',
    // —— 论文 ——
    'paperTitle', 'paperJournal', 'paperAuthors', 'paperVolume', 'paperImpactFactor', 'paperJournalLevel',
    'paperAuthorOrder', 'paperDate', 'paperDoi', 'paperLink', 'paperAbstract',
    // —— 培训 ——
    'trainingName', 'trainingStart', 'trainingEnd', 'trainingOrg', 'trainingGain', 'trainingContent'
  ];

  /**
   * v1.4.0：多段经历（解析简历后可能有多条）。
   * 数组元素字段见 LIST_ITEM_FIELDS；扁平的主条目字段仍保留，自动取第一条以兼容旧匹配。
   */
  var LIST_FIELDS = ['eduList', 'workList', 'projectList'];

  var LIST_ITEM_FIELDS = {
    eduList: ['school', 'major', 'degree', 'start', 'end', 'city', 'gpa', 'description'],
    workList: ['company', 'title', 'start', 'end', 'city', 'description'],
    projectList: ['name', 'role', 'start', 'end', 'tech', 'description']
  };

  /** 数组第一条 → 扁平主条目字段名映射 */
  var MAIN_ENTRY_MAP = {
    eduList: { school: 'school', major: 'major', degree: 'eduDegree', start: 'eduStart', end: 'eduEnd', city: 'schoolCity' },
    workList: { company: 'company', title: 'title', start: 'startDate', end: 'workEnd', city: 'workCity' },
    projectList: { name: 'projectName', role: 'projectRole', start: 'projectStart', end: 'projectEnd', tech: 'techSkills', description: 'projectDesc' }
  };

  function emptyList(listKey) {
    return [];
  }

  function normalizeListItem(listKey, item) {
    var keys = LIST_ITEM_FIELDS[listKey] || [];
    var src = item || {};
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      out[k] = src[k] == null ? '' : String(src[k]).trim();
    }
    return out;
  }

  function normalizeList(listKey, list) {
    var arr = Array.isArray(list) ? list : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var it = normalizeListItem(listKey, arr[i]);
      var hasValue = false;
      for (var j = 0; j < LIST_ITEM_FIELDS[listKey].length; j++) {
        if (it[LIST_ITEM_FIELDS[listKey][j]]) hasValue = true;
      }
      if (hasValue) out.push(it);
    }
    return out;
  }

  /** 数组第一条回填扁平主条目（不覆盖已有显式值，除非 force） */
  function deriveMainEntries(profile, force) {
    var p = profile || {};
    for (var i = 0; i < LIST_FIELDS.length; i++) {
      var listKey = LIST_FIELDS[i];
      var list = p[listKey];
      if (!Array.isArray(list) || !list.length) continue;
      var map = MAIN_ENTRY_MAP[listKey];
      var first = list[0];
      for (var src in map) {
        if (!Object.prototype.hasOwnProperty.call(map, src)) continue;
        var flat = map[src];
        var val = first[src];
        if (!val) continue;
        if (force || !p[flat]) p[flat] = val;
      }
    }
    return p;
  }

  function emptyProfile() {
    var p = {};
    for (var i = 0; i < PROFILE_FIELDS.length; i++) {
      p[PROFILE_FIELDS[i]] = '';
    }
    return p;
  }

  var DEFAULT_PROFILE = emptyProfile();

  /**
   * 中文演示用示例资料（虚构人物「张三」）。
   * 敏感字段（证件号、家庭身份证、犯罪/健康等）默认留空。
   */
  var SAMPLE_PROFILE = {
    resumeTitle: '张三-前端工程师简历',
    name: '张三',
    firstName: '三',
    lastName: '张',
    namePinyin: 'Zhang San',
    englishName: 'San Zhang',
    preferredName: '小张',
    gender: '男',
    birthday: '1998-05-20',
    age: '26',
    nationality: '中国',
    ethnicity: '汉族',
    politicalStatus: '群众',
    maritalStatus: '未婚',
    idType: '',
    idNumber: '',
    email: 'zhangsan.demo@example.com',
    secondaryEmail: 'zhangsan.alt@example.com',
    phone: '13800138000',
    wechat: 'zhangsan_demo',
    qq: '10001',
    emergencyContact: '李四 13900139000',
    emergencyContactName: '李四',
    emergencyContactRelation: '朋友',
    emergencyContactPhone: '13900139000',
    city: '上海',
    currentCity: '上海',
    currentAddress: '上海市浦东新区世纪大道 1 号',
    address: '浦东新区世纪大道 1 号',
    province: '上海市',
    zip: '200120',
    country: '中国',
    nativePlace: '浙江杭州',
    studentOrigin: '浙江',
    hukouType: '非农业',
    hukou: '上海',
    archiveLocation: '上海市人才中心',
    willingToRelocate: '可接受长三角出差/调动',
    linkedin: 'https://www.linkedin.com/in/zhangsan-demo',
    github: 'https://github.com/zhangsan-demo',
    website: 'https://zhangsan.demo.dev',
    height: '175',
    weight: '65',
    bloodType: '',
    healthStatus: '健康',
    hasChronicIllness: '',
    hasCriminalRecord: '',
    hasMilitaryService: '否',
    isVeteran: '否',
    partyJoinDate: '',
    leagueOrPartyJoinDate: '',
    isRecommendedPostgrad: '否',
    hasStudyAbroad: '否',
    isPovertyStudent: '否',
    isColorWeak: '否',
    hasOverseasIdentity: '否',
    englishLevel: 'CET-6',
    gaokaoDate: '2016-06',
    gaokaoScore: '620',
    gaokaoSubjects: '理科',
    professionalTitle: '',
    honors: '校级优秀学生干部（2018）；CET-6 520 分；校级程序设计竞赛二等奖',
    highestDegree: '本科',
    isFreshGraduate: '否',
    workStatus: '在职',
    years: '4',
    lastCompany: '示例科技有限公司',
    summary: '四年前端开发经验，熟悉现代 Web 技术栈，注重用户体验与工程质量。希望加入充满挑战的团队，持续成长。',
    personalStrengths: '学习快、沟通清晰、注重细节与交付质量',
    hobbies: '阅读、徒步、开源贡献',
    careerPlan: '深耕前端工程化与全栈，三年内成长为技术负责人',
    additionalInfo: '可接受远程与弹性办公；持有本地社保。',
    jobTarget: '高级前端 / 全栈工程师',
    expectedIndustry: '互联网 / 软件',
    currentIndustry: '互联网 / 软件',
    expectedStartDate: '两周内',
    expectedCity: '上海 / 杭州',
    interviewCity: '上海',
    expectedSalary: '25K-35K',
    expectedAnnualSalary: '30-42万',
    currentSalary: '22K',
    hasRelativeAtCompany: '否',
    referralSource: '官网 / 内推',
    acceptAdjustment: '可协商',
    availability: '两周内到岗',
    noticePeriod: '两周',
    earliestStart: '两周内',
    workAuth: '中国大陆公民，可合法全职工作',
    school: '复旦大学',
    eduDegree: '本科',
    degree: '学士',
    isUpgradeFromCollege: '否',
    department: '计算机科学技术学院',
    major: '计算机科学与技术',
    majorCategory: '工学',
    schoolCity: '上海',
    schoolType: '985/211',
    eduStatus: '已毕业',
    eduYears: '4',
    studyMode: '全日制',
    eduMode: '全日制',
    eduStart: '2016-09',
    eduEnd: '2020-06',
    gradYear: '2020',
    degreeAwardDate: '2020-06',
    degreeType: '普通高等教育',
    degreeCategory: '工学学士',
    enrollmentType: '普通高考',
    isTongzhao: '是',
    gpa: '3.6/4.0',
    failedCourses: '0',
    classRank: '前 20%',
    majorRank: '15/120',
    majorClassSize: '120',
    eduCertNo: '',
    degreeCertNo: '',
    studentId: '',
    advisorName: '',
    labName: '',
    isNationalKeyLab: '否',
    isJointTraining: '否',
    counselorName: '',
    counselorContact: '',
    isOverseasSchool: '否',
    eduDescription: '系统学习数据结构、操作系统、计算机网络与软件工程。',
    majorDescription: '计算机科学与技术，偏重 Web 与分布式方向。',
    majorCourses: '数据结构、算法、操作系统、计算机网络、数据库、软件工程',
    researchDirection: '',
    thesisTitle: '基于组件化的前端表单引擎设计与实现',
    dualDegree: '',
    internCompany: '示例互联网公司',
    internCompanySize: '500-1000人',
    internOverseas: '否',
    internDepartment: '研发中心',
    internTitle: '前端实习生',
    internStart: '2019-07',
    internEnd: '2019-09',
    internCity: '上海',
    internIndustry: '互联网',
    internEmploymentType: '实习',
    internAnnualSalary: '',
    internRefereeName: '',
    internRefereeContact: '',
    internRefereeTitle: '',
    internDescription: '参与后台管理系统页面开发与组件封装，完成 3 个业务模块上线。',
    internLeaveReason: '实习期满返校',
    company: '示例科技有限公司',
    companySize: '100-499人',
    workOverseas: '否',
    title: '前端工程师',
    startDate: '2020-07',
    workEnd: '至今',
    endDate: '至今',
    workCity: '上海',
    industry: '互联网 / 软件',
    jobType: '全职',
    employmentType: '全职',
    monthlySalary: '22K',
    annualSalary: '30万',
    refereeName: '',
    refereeContact: '',
    refereeTitle: '',
    achievements: '主导组件库升级，首屏性能提升 35%；带教 2 名新人。',
    workDescription: '负责 B 端产品前端开发与工程化建设，维护设计系统与表单引擎。',
    leaveReason: '寻求更大平台与成长空间',
    projectName: '企业级表单引擎',
    projectTeamSize: '8',
    projectOverseas: '否',
    projectRole: '前端负责人',
    projectPracticeMode: '校内/工作项目',
    projectStart: '2021-03',
    projectEnd: '2022-12',
    projectCity: '上海',
    projectLink: 'https://zhangsan.demo.dev/form-engine',
    projectRefereeName: '',
    projectRefereeContact: '',
    projectRefereeTitle: '',
    projectDesc: '设计可配置表单渲染与校验体系，覆盖 20+ 业务场景，支撑日均千万级提交。',
    projectResponsibilities: '架构设计、核心渲染器、性能优化、跨端适配',
    projectOutcome: '研发效率提升约 40%，缺陷率下降 25%',
    campusOrg: '计算机协会',
    campusLevel: '校级',
    campusRole: '技术部部长',
    campusStart: '2017-09',
    campusEnd: '2019-06',
    campusWorkContent: '组织技术分享与编程竞赛',
    campusDuty: '策划活动、协调讲师、维护社团官网',
    socialOrg: '社区志愿服务队',
    socialRole: '志愿者',
    socialStart: '2018-07',
    socialEnd: '2018-08',
    socialContent: '参与暑期支教与社区信息化科普',
    techSkills: 'JavaScript, TypeScript, React, Node.js',
    skills: 'JavaScript, TypeScript, React, Node.js, 沟通协作',
    languages: '普通话（母语）、英语（流利）',
    softwareSkills: 'VS Code, Git, Figma, Chrome DevTools',
    softSkills: '沟通协作、问题拆解、文档写作',
    certificates: 'CET-6；AWS Cloud Practitioner（示例）',
    certName: '大学英语六级',
    certType: '语言类',
    certDate: '2019-06',
    certNo: '',
    certIssuer: '教育部考试中心',
    certScore: '520',
    certExpiry: '',
    certDescription: 'CET-6 合格',
    langName: '英语',
    langDate: '2019-06',
    langCertName: 'CET-6',
    langScore: '520',
    langLevel: '熟练',
    langListenSpeak: '良好',
    langReadWrite: '熟练',
    familyName: '',
    familyRelation: '',
    familyGender: '',
    familyEducation: '',
    familyEthnicity: '',
    familyIdNumber: '',
    familyBirthday: '',
    familyPhone: '',
    familyEmployer: '',
    familyTitle: '',
    familyPoliticalStatus: '',
    familyAddress: '',
    awardName: '校级优秀学生干部',
    awardIssuer: '复旦大学',
    awardDate: '2018-12',
    awardEnd: '',
    awardLevel: '校级',
    awardType: '荣誉称号',
    awardGrade: '',
    awardDescription: '因社团与学业综合表现获评',
    patentName: '',
    patentNo: '',
    patentApplyDate: '',
    patentStatus: '',
    patentInventor: '',
    patentDescription: '',
    paperTitle: '',
    paperJournal: '',
    paperAuthors: '',
    paperVolume: '',
    paperImpactFactor: '',
    paperJournalLevel: '',
    paperAuthorOrder: '',
    paperDate: '',
    paperDoi: '',
    paperLink: '',
    paperAbstract: '',
    trainingName: '前端工程化实战营',
    trainingStart: '2021-01',
    trainingEnd: '2021-02',
    trainingOrg: '示例培训机构',
    trainingGain: '掌握构建与发布流水线、性能指标监控',
    trainingContent: 'Webpack/Vite、CI/CD、可观测性基础'
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
    LIST_FIELDS: LIST_FIELDS,
    LIST_ITEM_FIELDS: LIST_ITEM_FIELDS,
    MAIN_ENTRY_MAP: MAIN_ENTRY_MAP,
    emptyList: emptyList,
    normalizeList: normalizeList,
    normalizeListItem: normalizeListItem,
    deriveMainEntries: deriveMainEntries,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    SAMPLE_PROFILE: SAMPLE_PROFILE,
    emptyProfile: emptyProfile,
    normalizeProfile: normalizeProfile,
    profileHasData: profileHasData,
    profileNonEmpty: profileNonEmpty
  };
});
