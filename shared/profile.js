/**
 * 共享简历资料 schema：默认空 profile、字段列表、示例资料。
 * playoffer.cn 启发的扁平 schema（v1.3.0+）；v1.5.0 选项页可编辑多段经历。
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
    'name', 'firstName', 'lastName', 'namePinyin', 'pinyinLastName', 'pinyinFirstName', 'englishName', 'preferredName',
    'gender', 'birthday', 'age',
    'nationality', 'ethnicity', 'politicalStatus', 'maritalStatus',
    'idType', 'idNumber',
    // —— 联系 ——
    'email', 'secondaryEmail', 'phoneCountryCode', 'phone', 'wechat', 'qq',
    'emergencyContact', 'emergencyContactName', 'emergencyContactRelation', 'emergencyContactPhone',
    // —— 地址 / 地点 ——
    // v1.6.0：省 / 市 / 区 细分（网申常把籍贯、户籍、现居地拆成两三级下拉）；不填时从整串自动拆
    'city', 'currentProvince', 'currentCity', 'currentDistrict', 'currentAddress', 'address', 'province', 'zip', 'country',
    'nativePlace', 'nativeProvince', 'nativeCity', 'studentOrigin', 'hukouType', 'hukou', 'hukouProvince', 'hukouCity',
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
    'englishLevel', 'englishScore', 'englishDate', 'gaokaoDate', 'gaokaoScore', 'gaokaoSubjects',
    'professionalTitle',
    'highestDegree', 'isFreshGraduate', 'workStatus', 'years', 'lastCompany',
    'summary', 'personalStrengths', 'hobbies', 'careerPlan', 'additionalInfo',
    // —— 求职意向 ——
    // v1.6.0：校招常见第二志愿 / 第二意向城市
    'jobTarget', 'jobTarget2', 'expectedIndustry', 'currentIndustry', 'expectedStartDate',
    'expectedCity', 'expectedCity2', 'interviewCity', 'expectedSalary', 'expectedAnnualSalary', 'currentSalary',
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
    'workCity', 'workDepartment', 'industry', 'workNature', 'jobType', 'employmentType',
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
    'awardName', 'awardRank', 'awardIssuer', 'awardDate', 'awardEnd', 'awardLevel', 'awardType', 'awardGrade', 'awardDescription',
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
   * v1.6.0：从 3 种扩到 9 种，并细分每段的字段 —— 网申的「实习 / 校园 / 获奖 / 证书 / 语言 / 家庭」
   * 都是按段填的（填写代码早就按 internList / awardList / campusList 取值，但之前 schema 里没有这些列表，
   * 永远是空的；workList 的 department / nature 也不在条目字段里，保存时被丢掉）。
   * 数组元素字段见 LIST_ITEM_FIELDS；扁平的主条目字段仍保留，自动取第一条以兼容旧匹配。
   */
  var LIST_FIELDS = ['eduList', 'internList', 'workList', 'projectList', 'campusList', 'awardList', 'certList', 'langList', 'familyList'];

  var LIST_ITEM_FIELDS = {
    // degree = 学历（本科 / 硕士），academicDegree = 学位（工学学士），两者在网申里是两个不同的下拉
    eduList: ['school', 'department', 'major', 'majorCategory', 'degree', 'academicDegree', 'studyMode', 'start', 'end',
      'city', 'gpa', 'rank', 'courses', 'advisor', 'research', 'thesis', 'description'],
    internList: ['company', 'department', 'title', 'nature', 'industry', 'start', 'end', 'city', 'salary', 'achievements', 'description', 'leaveReason',
      'refereeName', 'refereeContact'],
    workList: ['company', 'department', 'title', 'nature', 'industry', 'start', 'end', 'city', 'salary', 'description',
      'achievements', 'leaveReason', 'refereeName', 'refereeContact'],
    projectList: ['name', 'role', 'start', 'end', 'link', 'tech', 'description', 'responsibilities', 'outcome'],
    campusList: ['org', 'role', 'level', 'start', 'end', 'description'],
    awardList: ['name', 'level', 'rank', 'issuer', 'date', 'description'],
    certList: ['name', 'issuer', 'no', 'date', 'score'],
    langList: ['name', 'level', 'certName', 'score', 'date', 'listenSpeak', 'readWrite'],
    familyList: ['name', 'relation', 'employer', 'title', 'phone', 'politicalStatus']
  };

  /** 选项页多段编辑：字段中文标签 */
  var LIST_ITEM_LABELS = {
    eduList: {
      school: '学校', department: '院系', major: '专业', majorCategory: '专业类别', degree: '学历（本科/硕士）',
      academicDegree: '学位（如 工学学士）', studyMode: '学习形式（全日制）', start: '开始', end: '结束',
      city: '城市（学校所在）', gpa: 'GPA', rank: '排名（如 5/120）', courses: '主修课程', advisor: '导师',
      research: '研究方向', thesis: '毕业论文', description: '描述'
    },
    internList: {
      company: '公司', department: '部门', title: '职位', nature: '经历性质', salary: '薪资（原记录）', achievements: '成果', industry: '行业', start: '开始', end: '结束', city: '城市',
      description: '实习内容', leaveReason: '离职原因', refereeName: '证明人', refereeContact: '证明人电话'
    },
    workList: {
      company: '公司', department: '部门', title: '职位', nature: '工作性质（全职/实习）', industry: '行业',
      start: '开始', end: '结束', city: '城市', salary: '月薪', description: '工作内容', achievements: '业绩',
      leaveReason: '离职原因', refereeName: '证明人', refereeContact: '证明人电话'
    },
    projectList: {
      name: '项目名称', role: '角色', start: '开始', end: '结束', link: '项目链接',
      tech: '技术栈', description: '描述', responsibilities: '本人职责', outcome: '项目成果'
    },
    campusList: { org: '组织 / 社团', role: '职务', level: '级别（校级/院级）', start: '开始', end: '结束', description: '内容' },
    awardList: { name: '奖项名称', level: '级别（国家级/省级）', rank: '名次 / 等级', issuer: '颁发机构', date: '获奖时间', description: '描述' },
    certList: { name: '证书名称', issuer: '颁发机构', no: '证书编号', date: '获得时间', score: '成绩' },
    langList: { name: '语种', level: '熟练程度 / 原有等级', certName: '考试 / 证书名称（CET-4、N1）', score: '成绩', date: '获得时间', listenSpeak: '听说', readWrite: '读写' },
    familyList: { name: '姓名', relation: '关系', employer: '工作单位', title: '职务', phone: '电话', politicalStatus: '政治面貌' }
  };

  var LIST_SECTION_TITLES = {
    eduList: '教育经历（多段）',
    internList: '实习经历（多段）',
    workList: '工作经历（多段）',
    projectList: '项目经历（多段）',
    campusList: '校园经历（多段）',
    awardList: '获奖（多段）',
    certList: '证书（多段）',
    langList: '外语（多段）',
    familyList: '家庭成员（多段）'
  };

  /** 数组第一条 → 扁平主条目字段名映射 */
  var MAIN_ENTRY_MAP = {
    eduList: {
      school: 'school', department: 'department', major: 'major', majorCategory: 'majorCategory', degree: 'eduDegree',
      academicDegree: 'degree', studyMode: 'studyMode', start: 'eduStart', end: 'eduEnd', city: 'schoolCity', gpa: 'gpa',
      rank: 'majorRank', courses: 'majorCourses', advisor: 'advisorName', research: 'researchDirection', thesis: 'thesisTitle', description: 'eduDescription'
    },
    internList: {
      company: 'internCompany', department: 'internDepartment', title: 'internTitle', industry: 'internIndustry',
      start: 'internStart', end: 'internEnd', city: 'internCity', description: 'internDescription',
      leaveReason: 'internLeaveReason', refereeName: 'internRefereeName', refereeContact: 'internRefereeContact'
    },
    workList: {
      company: 'company', department: 'workDepartment', title: 'title', nature: 'workNature', industry: 'industry',
      start: 'startDate', end: 'workEnd', city: 'workCity', salary: 'monthlySalary', description: 'workDescription',
      achievements: 'achievements', leaveReason: 'leaveReason', refereeName: 'refereeName', refereeContact: 'refereeContact'
    },
    projectList: {
      name: 'projectName', role: 'projectRole', start: 'projectStart', end: 'projectEnd', link: 'projectLink',
      description: 'projectDesc', responsibilities: 'projectResponsibilities', outcome: 'projectOutcome'
    },
    campusList: { org: 'campusOrg', role: 'campusRole', level: 'campusLevel', start: 'campusStart', end: 'campusEnd', description: 'campusWorkContent' },
    awardList: { name: 'awardName', level: 'awardLevel', rank: 'awardRank', issuer: 'awardIssuer', date: 'awardDate', description: 'awardDescription' },
    certList: { name: 'certName', issuer: 'certIssuer', no: 'certNo', date: 'certDate', score: 'certScore' },
    langList: { name: 'langName', level: 'langLevel', certName: 'langCertName', score: 'langScore', date: 'langDate', listenSpeak: 'langListenSpeak', readWrite: 'langReadWrite' },
    familyList: {
      name: 'familyName', relation: 'familyRelation', employer: 'familyEmployer', title: 'familyTitle',
      phone: 'familyPhone', politicalStatus: 'familyPoliticalStatus'
    }
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
    for (var j = 0; j < LIST_FIELDS.length; j++) {
      p[LIST_FIELDS[j]] = [];
    }
    return p;
  }

  function text(value) { return value == null ? '' : String(value).trim(); }
  function stableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ':' + stableJson(value[k]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function gpaParts(value) {
    var m = text(value).match(/^(\d+(?:\.\d+)?)(?:\s*[/／]\s*(\d+(?:\.\d+)?))?$/);
    return m && (!m[2] || (Number(m[2]) > 0 && Number(m[1]) <= Number(m[2]))) ? m : null;
  }

  /** 只返回字段路径和原因，不把资料值复制到诊断中。 */
  function auditProfile(profile) {
    var p = profile || {}, issues = [], mirrors = 0;
    LIST_FIELDS.forEach(function (lk) {
      var rows = Array.isArray(p[lk]) ? p[lk] : [], seen = {};
      rows.forEach(function (row, index) {
        var signature = stableJson(row);
        if (seen[signature] != null) issues.push({code:'duplicate_record', path:lk + '[' + index + ']', related:lk + '[' + seen[signature] + ']'});
        else seen[signature] = index;
      });
      if (!rows.length) return;
      Object.keys(MAIN_ENTRY_MAP[lk]).forEach(function (field) {
        var flat = MAIN_ENTRY_MAP[lk][field], a = text(p[flat]), b = text(rows[0][field]);
        if (!a || !b) return;
        if (a === b) mirrors += 1;
        else issues.push({code:'mirror_conflict', path:flat, related:lk + '[0].' + field});
      });
    });
    (Array.isArray(p.workList) ? p.workList : []).forEach(function (row, index) {
      if (/^(实习|intern|internship)$/i.test(text(row.nature))) issues.push({code:'intern_in_work',path:'workList[' + index + ']'});
    });
    [['studyMode','eduMode'],['workEnd','endDate']].forEach(function (pair) {
      if (text(p[pair[0]]) && text(p[pair[1]]) && text(p[pair[0]]) !== text(p[pair[1]])) issues.push({code:'alias_conflict',path:pair[0],related:pair[1]});
    });
    if (/^(本科|专科|大专|高中|硕士研究生|博士研究生)$/.test(text(p.degree))) issues.push({code:'degree_is_education',path:'degree',related:'eduDegree'});
    if (text(p.langName) && !(p.langList || []).length) issues.push({code:'language_flat_only',path:'langName',related:'langList'});
    return {issues:issues, mirrorCount:mirrors};
  }

  /** 可安全整理的项目；不修改输入，保留未识别字段和所有不同内容。 */
  function repairProfile(profile) {
    var p = JSON.parse(JSON.stringify(profile || {})), changes = [];
    function changed(code, path, related) { changes.push({code:code,path:path,related:related || ''}); }
    LIST_FIELDS.forEach(function (lk) {
      var rows = Array.isArray(p[lk]) ? p[lk] : [], seen = {};
      p[lk] = rows.filter(function (row, index) {
        var signature = stableJson(row);
        if (seen[signature]) { changed('duplicate_record',lk + '[' + index + ']'); return false; }
        seen[signature] = true; return true;
      });
    });
    var education = p.eduList[0];
    if (education) {
      var flatGpa = gpaParts(p.gpa), rowGpa = gpaParts(education.gpa);
      if (flatGpa && rowGpa && Number(flatGpa[1]) === Number(rowGpa[1])) {
        if (flatGpa[2] && !rowGpa[2]) { education.gpa = text(p.gpa); changed('gpa_scale_completed','eduList[0].gpa','gpa'); }
        else if (rowGpa[2] && !flatGpa[2]) { p.gpa = text(education.gpa); changed('gpa_scale_completed','gpa','eduList[0].gpa'); }
      }
      if (/^(本科|专科|大专|高中|硕士研究生|博士研究生)$/.test(text(p.degree)) && /学士|硕士|博士|bachelor|master|doctor/i.test(text(education.academicDegree))) {
        p.degree = text(education.academicDegree); changed('degree_corrected','degree','eduList[0].academicDegree');
      }
    }
    if (text(p.studyMode) && text(p.eduMode) === '普通' + text(p.studyMode)) {
      p.eduMode = text(p.studyMode); changed('alias_normalized','eduMode','studyMode');
    }
    if (!p.langList.length && text(p.langName)) {
      var language = {};
      Object.keys(MAIN_ENTRY_MAP.langList).forEach(function (field) { language[field] = text(p[MAIN_ENTRY_MAP.langList[field]]); });
      if (!language.certName && /^(英语|english)$/i.test(language.name)) language.certName = text(p.englishLevel);
      p.langList.push(language); changed('language_structured','langList','langName');
    }
    p.workList = p.workList.filter(function (row) {
      if (!/^(实习|intern|internship)$/i.test(text(row.nature))) return true;
      var beforeChanges = changes.length;
      var originalRow = JSON.parse(JSON.stringify(row));
      if (/^(实习生|intern)$/i.test(text(row.title)) && /实习|intern/i.test(text(p.internTitle)) &&
          text(p.internCompany) === text(row.company) && text(row.company) &&
          (!text(p.internStart) || text(p.internStart) === text(row.start)) &&
          (!text(p.internEnd) || text(p.internEnd) === text(row.end))) {
        row.title = text(p.internTitle); changed('title_refined','internList.title','internTitle');
      }
      var same = p.internList.find(function (other) {
        return text(row.company) && text(row.company) === text(other.company) && text(row.start) === text(other.start) && text(row.end) === text(other.end);
      });
      if (same) {
        if (Object.keys(row).some(function (key) { return text(row[key]) && text(same[key]) && text(row[key]) !== text(same[key]); })) {
          if (changes.length > beforeChanges) { row.title = originalRow.title; changes.length = beforeChanges; }
          return true;
        }
        Object.keys(row).forEach(function (key) { if (key !== '__proto__' && key !== 'constructor' && !same[key]) same[key] = row[key]; });
      } else p.internList.push(row);
      var map = MAIN_ENTRY_MAP.workList;
      Object.keys(map).forEach(function (field) {
        if (text(p[map[field]]) && (text(p[map[field]]) === text(row[field]) || text(p[map[field]]) === text(originalRow[field]))) p[map[field]] = '';
      });
      if (text(p.endDate) === text(row.end)) p.endDate = '';
      changed('intern_reclassified','internList','workList'); return false;
    });
    deriveMainEntries(p, false);
    return {profile:p,changes:changes,report:auditProfile(p)};
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
    englishScore: '520',
    englishDate: '2023-06',
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
    trainingContent: 'Webpack/Vite、CI/CD、可观测性基础',
    eduList: [
      {
        school: '复旦大学', major: '计算机科学与技术', degree: '本科',
        start: '2016-09', end: '2020-06', city: '上海', gpa: '3.6/4.0',
        description: '系统学习数据结构、操作系统、计算机网络与软件工程。'
      },
      {
        school: '示例高中', major: '理科', degree: '高中',
        start: '2013-09', end: '2016-06', city: '杭州', gpa: '',
        description: ''
      }
    ],
    workList: [
      {
        company: '示例科技有限公司', title: '前端工程师',
        start: '2020-07', end: '至今', city: '上海',
        description: '负责 B 端产品前端开发与工程化建设，维护设计系统与表单引擎。'
      },
      {
        company: '示例互联网公司', title: '前端实习生',
        start: '2019-07', end: '2019-09', city: '上海',
        description: '参与后台管理系统页面开发与组件封装。'
      }
    ],
    projectList: [
      {
        name: '企业级表单引擎', role: '前端负责人',
        start: '2021-03', end: '2022-12', tech: 'React, TypeScript',
        description: '设计可配置表单渲染与校验体系，覆盖 20+ 业务场景。'
      },
      {
        name: '内部组件库', role: '核心开发',
        start: '2020-09', end: '2021-02', tech: 'React, Storybook',
        description: '搭建基础组件与文档站点，统一交互规范。'
      }
    ]
  };

  function normalizeProfile(raw) {
    var out = emptyProfile();
    var src = raw || {};
    for (var i = 0; i < PROFILE_FIELDS.length; i++) {
      var k = PROFILE_FIELDS[i];
      if (src[k] != null) out[k] = String(src[k]).trim();
    }
    for (var j = 0; j < LIST_FIELDS.length; j++) {
      var lk = LIST_FIELDS[j];
      out[lk] = normalizeList(lk, src[lk] || []);
    }
    return out;
  }

  /**
   * 表单只编辑扁平字段；保存时用此函数把现有档案的多段经历拼回去，避免误清空。
   */
  function mergeFlatOntoProfile(flat, existing) {
    var base = existing && typeof existing === 'object' ? existing : {};
    var overlay = flat && typeof flat === 'object' ? flat : {};
    var merged = {};
    var i, k;
    for (i = 0; i < PROFILE_FIELDS.length; i++) {
      k = PROFILE_FIELDS[i];
      if (Object.prototype.hasOwnProperty.call(overlay, k)) merged[k] = overlay[k];
      else if (Object.prototype.hasOwnProperty.call(base, k)) merged[k] = base[k];
    }
    for (i = 0; i < LIST_FIELDS.length; i++) {
      k = LIST_FIELDS[i];
      // 选项页多段编辑器显式提交数组时优先用 overlay；否则保留已有档案列表
      if (Object.prototype.hasOwnProperty.call(overlay, k) && Array.isArray(overlay[k])) {
        merged[k] = overlay[k];
      } else {
        merged[k] = base[k];
      }
    }
    return normalizeProfile(merged);
  }

  function profileHasData(profile) {
    var p = profile || {};
    for (var i = 0; i < PROFILE_FIELDS.length; i++) {
      var v = p[PROFILE_FIELDS[i]];
      if (v && String(v).trim()) return true;
    }
    if (LIST_FIELDS.some(function (key) { return Array.isArray(p[key]) && p[key].some(function (row) { return Object.keys(row || {}).some(function (field) { return !!text(row[field]); }); }); })) return true;
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
    LIST_ITEM_LABELS: LIST_ITEM_LABELS,
    LIST_SECTION_TITLES: LIST_SECTION_TITLES,
    MAIN_ENTRY_MAP: MAIN_ENTRY_MAP,
    emptyList: emptyList,
    normalizeList: normalizeList,
    normalizeListItem: normalizeListItem,
    deriveMainEntries: deriveMainEntries,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    SAMPLE_PROFILE: SAMPLE_PROFILE,
    emptyProfile: emptyProfile,
    normalizeProfile: normalizeProfile,
    mergeFlatOntoProfile: mergeFlatOntoProfile,
    auditProfile: auditProfile,
    repairProfile: repairProfile,
    profileHasData: profileHasData,
    profileNonEmpty: profileNonEmpty
  };
});
