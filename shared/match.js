/**
 * 共享字段匹配逻辑：关键词、同义、模糊评分、姓名拆分、profile 取值、select 匹配、label 可见文本。
 * 浏览器挂到 ResumeAutofillMatch；Node 通过 module.exports 引入。
 *
 * v1.3.0: playoffer 全量字段关键词 / FIELD_ORDER；紧急联系人拆分；地址/技能别名；证明人/家庭 denylist。
 * v1.2.4: D9 毕业时间→eduEnd + 拆分失败跳过；D10 相邻年/月 placeholder 与附近日期组标签。
 * v1.2.3: antd/form-item 标签发现；上司联系人 denylist；年/月日期拆分 extractDatePart。
 * v1.2.2: visibleLabelText — 跳过 select/option/input 等控件子树，避免 option 文案污染标签匹配。
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
    namePinyin: [
      'namepinyin', 'name_pinyin', 'pinyinname', '姓名拼音', '拼音姓名'
    ],
    englishName: [
      'englishname', 'english_name', 'english-name', 'nameinenGLISH', 'name_en', 'enname',
      '英文名', '英文姓名'
    ],
    preferredName: [
      'preferredname', 'preferred_name', 'preferred-name', 'nickname', 'nick_name',
      '常用名', '昵称', '希望称呼', '偏好姓名'
    ],
    resumeTitle: [
      'resumetitle', 'resume_title', '简历名称', '简历标题', 'resume name'
    ],
    name: [
      'fullname', 'full_name', 'full-name', 'yourname', 'your_name', 'applicantname',
      'candidate_name', 'legalname', '真实姓名', '申请人姓名', '姓名', '称呼'
    ],
    gender: [
      '性别', '男女'
    ],
    birthday: [
      'birthday', 'birthdate', 'birth_date', 'dateofbirth', 'date_of_birth', 'dob',
      '出生日期', '生日', '出生年月'
    ],
    age: [
      'age', '年龄', '周岁'
    ],
    nationality: [
      'nationality', '国籍', 'citizen'
    ],
    ethnicity: [
      '民族', 'ethnic'
    ],
    politicalStatus: [
      'politicalstatus', 'political_status', '政治面貌', '党派'
    ],
    maritalStatus: [
      'maritalstatus', 'marital_status', '婚姻状况', '婚否', '婚姻'
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
      '电话', '联系电话', '移动电话', '手机', '座机'
    ],
    wechat: [
      'wechat', 'weixin', 'wei_xin', '微信号', '微信'
    ],
    qq: [
      'qq号', 'qq号码', '腾讯qq', 'qq'
    ],
    emergencyContactName: [
      'emergencycontactname', 'emergency_contact_name', '紧急联系人姓名', '紧急联络人姓名'
    ],
    emergencyContactRelation: [
      'emergencycontactrelation', 'emergency_contact_relation', '紧急联系人关系', '与紧急联系人关系'
    ],
    emergencyContactPhone: [
      'emergencycontactphone', 'emergency_contact_phone', '紧急联系人电话', '紧急联系人手机',
      '紧急联络人电话'
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
    currentAddress: [
      'currentaddress', 'current_address', '现居住地址', '现住址', '目前住址'
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
      'country', '国家', '所在国家'
    ],
    hukouType: [
      'hukoutype', 'hukou_type', '户口性质', '户籍性质'
    ],
    hukou: [
      'hukou', 'householdregister', '户籍', '户口所在地', '户口'
    ],
    nativePlace: [
      'nativeplace', 'native_place', 'hometown', '籍贯', '出生地'
    ],
    studentOrigin: [
      'studentorigin', 'student_origin', '生源地', '生源'
    ],
    archiveLocation: [
      'archivelocation', 'archive_location', '档案所在地', '档案存放地', '人事档案'
    ],
    willingToRelocate: [
      'willingtorelocate', 'willing_to_relocate', 'relocate', 'relocation',
      '接受调动', '是否愿意异地', '可接受调迁', '异地工作', '愿意搬迁'
    ],
    linkedin: [
      'linkedin', 'linked-in', 'linkedinurl', 'linkedin_url', 'linked_in', '领英'
    ],
    github: [
      'github', 'githuburl', 'github_url', 'git hub', 'git-hub'
    ],
    website: [
      'website', 'portfolio', 'personalwebsite', 'personal_website', 'homepage',
      'blog', '个人网站', '作品集', '个人主页', '作品链接', '主页', '博客'
    ],
    height: ['height', '身高'],
    weight: ['weight', '体重'],
    bloodType: ['bloodtype', 'blood_type', '血型'],
    healthStatus: ['healthstatus', 'health_status', '健康状况', '身体状况'],
    hasChronicIllness: ['chronicillness', 'chronic_illness', '是否有慢性病', '慢性病'],
    hasCriminalRecord: ['criminalrecord', 'criminal_record', '有无犯罪记录', '犯罪记录'],
    hasMilitaryService: ['militaryservice', 'military_service', '是否服兵役', '服兵役'],
    isVeteran: ['是否退伍军人', '退伍军人', 'isveteran'],
    partyJoinDate: ['partyjoindate', 'party_join_date', '入党时间', '入党日期'],
    leagueOrPartyJoinDate: ['leagueorpartyjoindate', '入团入党时间', '入团/入党时间', '入团时间'],
    isRecommendedPostgrad: ['isrecommendedpostgrad', '是否保研', '保研'],
    hasStudyAbroad: ['hasstudyabroad', '是否有留学经历', '留学经历', '海外学习经历'],
    isPovertyStudent: ['ispovertystudent', '是否贫困生', '贫困生'],
    isColorWeak: ['iscolorweak', '是否色弱', '色弱', '色盲'],
    hasOverseasIdentity: ['hasoverseasidentity', '是否具有境外身份', '境外身份'],
    englishLevel: ['englishlevel', 'english_level', '英语等级', '英语水平'],
    gaokaoDate: ['gaokaodate', 'gaokao_date', '高考时间', '高考日期'],
    gaokaoScore: ['gaokaoscore', 'gaokao_score', '高考分数', '高考成绩'],
    gaokaoSubjects: ['gaokaosubjects', 'gaokao_subjects', '高考科目', '高考科类'],
    professionalTitle: ['professionaltitle', 'professional_title', '专业技术职级', '职称', '专业技术职务'],
    highestDegree: ['highestdegree', 'highest_degree', '最高学历'],
    isFreshGraduate: ['isfreshgraduate', 'freshgraduate', '是否应届生', '应届生', '应届'],
    workStatus: ['workstatus', 'work_status', '工作状态', '在职状态', '求职状态'],
    lastCompany: ['lastcompany', 'last_company', '上一家公司', '上家公司', '前一家公司', '最近一家公司'],
    personalStrengths: ['personalstrengths', 'personal_strengths', '个人优势', '优势亮点'],
    hobbies: ['hobbies', 'hobby', '兴趣爱好', '爱好'],
    careerPlan: ['careerplan', 'career_plan', '职业规划', '职业目标'],
    school: [
      'school', 'university', 'college', 'institution', 'edu_school', 'campus',
      '毕业院校', '就读院校', '学校', '大学', '院校', '教育机构'
    ],
    eduDegree: [
      'eduDegree', 'edu_degree', '学历'
    ],
    degree: [
      'degree', 'educationlevel', 'education_level', 'edu_level', 'qualification',
      '学位', '教育程度'
    ],
    isUpgradeFromCollege: ['isupgradefromcollege', '是否专升本', '专升本'],
    department: [
      'department', 'dept', '所在部门', '部门', '科室', '院系', '所在院系'
    ],
    major: [
      'major', 'fieldofstudy', 'field_of_study', 'discipline', 'studyfield',
      '所学专业', '毕业专业', '专业', '主修'
    ],
    majorCategory: ['majorcategory', 'major_category', '专业类别', '学科门类'],
    schoolCity: ['schoolcity', 'school_city', '学校城市', '院校所在城市'],
    schoolType: ['schooltype', 'school_type', '院校类型', '学校类型'],
    eduStatus: ['edustatus', 'edu_status', '学历状态', '就读状态'],
    eduYears: ['eduyears', 'edu_years', '学制'],
    studyMode: ['studymode', 'study_mode', '学习形式'],
    eduMode: ['edumode', 'edu_mode', '教育方式'],
    eduStart: [
      'edustart', 'edu_start', 'enrollmentdate', 'enrollment', '入学时间', '入学日期', '就读开始'
    ],
    eduEnd: [
      'eduend', 'edu_end', 'graduationdate', '毕业日期', '毕业时间', '就读结束', '学业结束'
    ],
    gradYear: [
      'graduationyear', 'gradyear', 'grad_year', 'yearofgraduation', 'endyear',
      '毕业年份', '毕业年'
    ],
    degreeAwardDate: ['degreeawarddate', 'degree_award_date', '学位授予时间', '获学位时间'],
    degreeType: ['degreetype', 'degree_type', '学位类型'],
    degreeCategory: ['degreecategory', 'degree_category', '学位类别'],
    enrollmentType: ['enrollmenttype', 'enrollment_type', '招生类别'],
    isTongzhao: ['istongzhao', '是否统招', '统招'],
    gpa: [
      'gpa', 'grade point', '平均绩点', '学分绩点', '成绩绩点'
    ],
    failedCourses: ['failedcourses', 'failed_courses', '挂科数', '不及格门数'],
    classRank: ['classrank', 'class_rank', '班级排名', '年级排名'],
    majorRank: ['majorrank', 'major_rank', '专业排名'],
    majorClassSize: ['majorclasssize', 'major_class_size', '专业人数', '专业总人数'],
    eduCertNo: ['educertno', 'edu_cert_no', '学历证书编号', '毕业证编号'],
    degreeCertNo: ['degreecertno', 'degree_cert_no', '学位证书编号', '学位证编号'],
    studentId: ['studentid', 'student_id', '学号'],
    advisorName: ['advisorname', 'advisor_name', '导师姓名', '指导教师', '导师'],
    labName: ['labname', 'lab_name', '实验室名称', '实验室'],
    isNationalKeyLab: ['isnationalkeylab', '是否国家重点实验室', '国家重点实验室'],
    isJointTraining: ['isjointtraining', '是否联合培养', '联合培养'],
    counselorName: ['counselorname', 'counselor_name', '辅导员姓名', '辅导员'],
    counselorContact: ['counselorcontact', 'counselor_contact', '辅导员联系方式', '辅导员电话'],
    isOverseasSchool: ['isoverseasschool', '是否海外院校', '海外院校'],
    eduDescription: ['edudescription', 'edu_description', '教育经历描述', '在校经历'],
    majorDescription: ['majordescription', 'major_description', '专业描述', '专业介绍'],
    majorCourses: ['majorcourses', 'major_courses', '主修课程', '专业课程'],
    researchDirection: ['researchdirection', 'research_direction', '研究方向'],
    thesisTitle: ['thesistitle', 'thesis_title', '毕业论文', '论文题目', '毕业设计题目'],
    dualDegree: [
      'dualdegree', 'dual_degree', 'doublemajor', 'double_major', '辅修', '双学位', '第二学位'
    ],
    internCompany: [
      'interncompany', 'intern_company', 'internshipcompany', '实习公司', '实习单位', '实习企业'
    ],
    internCompanySize: ['interncompanysize', 'intern_company_size', '实习公司规模'],
    internOverseas: ['internoverseas', 'intern_overseas', '实习是否海外', '实习海外'],
    internDepartment: ['interndepartment', 'intern_department', '实习部门'],
    internTitle: ['interntitle', 'intern_title', '实习职位', '实习岗位', '实习职务'],
    internStart: ['internstart', 'intern_start', '实习开始', '实习开始时间'],
    internEnd: ['internend', 'intern_end', '实习结束', '实习结束时间'],
    internCity: ['interncity', 'intern_city', '实习城市'],
    internIndustry: ['internindustry', 'intern_industry', '实习行业'],
    internEmploymentType: ['internemploymenttype', '实习用工性质', '实习工作性质'],
    internAnnualSalary: ['internannualsalary', '实习年薪'],
    internRefereeName: ['internrefereename', '实习证明人姓名', '实习证明人'],
    internRefereeContact: ['internrefereecontact', '实习证明人联系方式', '实习证明人电话'],
    internRefereeTitle: ['internrefereetitle', '实习证明人职位', '实习证明人职务'],
    internDescription: ['interndescription', 'intern_description', '实习描述', '实习内容', '实习经历描述'],
    internLeaveReason: ['internleavereason', '实习离职原因', '实习离开原因'],
    company: [
      'company', 'employer', 'organization', 'org', 'currentcompany', 'current_company',
      'companyname', '工作单位', '现任公司', '就职公司', '公司', '雇主', '单位名称'
    ],
    companySize: ['companysize', 'company_size', '公司规模', '企业规模'],
    workOverseas: ['workoverseas', 'work_overseas', '是否海外工作', '工作是否海外'],
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
      '入职时间', '任职开始', '开始日期', '工作开始'
    ],
    workEnd: [
      'workend', 'work_end', '工作结束', '任职结束', '工作结束时间'
    ],
    endDate: [
      'enddate', 'end_date', '结束日期', '结束时间'
    ],
    workCity: ['workcity', 'work_city', '工作城市', '工作地点'],
    industry: [
      'industry', 'sector', '所属行业', '行业', '从事行业', '工作行业'
    ],
    jobType: [
      'jobtype', 'job_type', 'worktype',
      '工作性质', '职位类型', '全职兼职', '用工类型'
    ],
    employmentType: [
      'employmenttype', 'employment_type', '用工性质'
    ],
    monthlySalary: ['monthlysalary', 'monthly_salary', '月薪', '月收入'],
    annualSalary: ['annualsalary', 'annual_salary', '年薪', '年收入'],
    refereeName: ['refereename', 'referee_name', '证明人姓名', '证明人'],
    refereeContact: ['refereecontact', 'referee_contact', '证明人联系方式', '证明人电话', '证明人手机'],
    refereeTitle: ['refereetitle', 'referee_title', '证明人职位', '证明人职务'],
    leaveReason: [
      'leavereason', 'leave_reason', 'reasonforleaving', '离职原因', '离职理由', '离开原因'
    ],
    achievements: [
      'achievements', 'accomplishment', 'highlights', 'keyachievements',
      '工作业绩', '主要成就', '业绩亮点', '工作成果'
    ],
    workDescription: [
      'workdescription', 'work_description', '工作描述', '工作内容', '工作职责描述', '职责描述'
    ],
    projectName: [
      'projectname', 'project_name', 'projecttitle', '项目名称', '项目名'
    ],
    projectTeamSize: ['projectteamsize', 'project_team_size', '项目人数', '项目团队规模'],
    projectOverseas: ['projectoverseas', 'project_overseas', '项目是否海外'],
    projectRole: [
      'projectrole', 'project_role', '项目角色', '项目职务', '在项目中担任'
    ],
    projectPracticeMode: ['projectpracticemode', '项目实践形式', '实践形式'],
    projectStart: ['projectstart', 'project_start', '项目开始', '项目开始时间'],
    projectEnd: ['projectend', 'project_end', '项目结束', '项目结束时间'],
    projectCity: ['projectcity', 'project_city', '项目城市'],
    projectLink: ['projectlink', 'project_link', '项目链接', '项目地址'],
    projectRefereeName: ['projectrefereename', '项目证明人姓名', '项目证明人'],
    projectRefereeContact: ['projectrefereecontact', '项目证明人联系方式'],
    projectRefereeTitle: ['projectrefereetitle', '项目证明人职位'],
    projectDesc: [
      'projectdesc', 'project_desc', 'projectdescription', 'project_description',
      'projectexperience', 'project_experience', '项目经历', '项目描述', '项目介绍', '项目说明'
    ],
    projectResponsibilities: ['projectresponsibilities', '项目职责', '项目责任'],
    projectOutcome: ['projectoutcome', '项目成果', '项目结果', '项目产出'],
    campusOrg: ['campusorg', 'campus_org', '组织名称', '校园组织', '社团名称'],
    campusLevel: ['campuslevel', 'campus_level', '组织级别', '校园级别'],
    campusRole: ['campusrole', 'campus_role', '校园职位', '社团职位'],
    campusStart: ['campusstart', 'campus_start', '校园经历开始'],
    campusEnd: ['campusend', 'campus_end', '校园经历结束'],
    campusWorkContent: ['campusworkcontent', '校园工作内容', '组织工作内容'],
    campusDuty: ['campusduty', '本人职责', '校园职责', '在组织中职责'],
    socialOrg: ['socialorg', 'social_org', '实践单位', '社会实践单位'],
    socialRole: ['socialrole', 'social_role', '实践岗位', '实践身份'],
    socialStart: ['socialstart', 'social_start', '实践开始'],
    socialEnd: ['socialend', 'social_end', '实践结束'],
    socialContent: ['socialcontent', '实践内容', '社会实践内容'],
    techSkills: [
      'techskills', 'tech_skills', 'technicalskills', '技术技能', '硬技能'
    ],
    skills: [
      'skills', 'skill', 'expertise', 'competencies', 'techstack',
      '专业技能', '掌握技能', '技术栈', '技能特长', '技能', '技能专长'
    ],
    softwareSkills: ['softwareskills', 'software_skills', '软件技能', '办公软件'],
    softSkills: ['softskills', 'soft_skills', '软技能', '综合素质'],
    summary: [
      'summary', 'about', 'bio', 'introduction', 'coverletter', 'cover_letter',
      'objective', 'selfintro', '自我介绍', '个人简介', '自我评价', '求职信',
      '个人总结', '简介', '补充说明', 'whyjoin', 'why_join', 'whydoyouwant'
    ],
    expectedSalary: [
      'expectedsalary', 'expected_salary', 'salaryexpectation', 'salary', 'compensation',
      '期望薪资', '期望月薪', '薪资期望', '期望待遇', '薪资要求'
    ],
    expectedAnnualSalary: [
      'expectedannualsalary', 'expected_annual_salary', '期望年薪'
    ],
    currentSalary: [
      'currentsalary', 'current_salary', '目前薪资', '当前薪资', '现薪资'
    ],
    expectedCity: [
      'expectedcity', 'expected_city', 'preferredcity', 'preferred_location', 'preferredlocation',
      'intentioncity', '期望城市', '意向城市', '期望工作地', '意向工作城市', '目标城市'
    ],
    interviewCity: [
      'interviewcity', 'interview_city', '面试城市', '面试地点'
    ],
    expectedIndustry: [
      'expectedindustry', 'expected_industry', '期望行业', '意向行业'
    ],
    currentIndustry: [
      'currentindustry', 'current_industry', '目前行业', '当前行业'
    ],
    expectedStartDate: [
      'expectedstartdate', 'expected_start_date', '预计入职时间', '期望入职时间'
    ],
    jobTarget: [
      'jobtarget', 'job_target', 'desiredposition', 'desired_position', 'targetrole',
      '求职意向', '目标职位', '目标岗位', '期望职位', '意向岗位'
    ],
    hasRelativeAtCompany: [
      'hasrelativeatcompany', '是否有亲属在本公司', '是否有亲属在公司', '公司亲属'
    ],
    acceptAdjustment: [
      'acceptadjustment', 'accept_adjustment', '是否接受调剂', '接受调剂'
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
    certName: ['certname', 'cert_name', '证书名称', '资质证书名称'],
    certType: ['certtype', 'cert_type', '证书类型', '资质证书类型'],
    certDate: ['certdate', 'cert_date', '证书获取时间', '获证时间', '发证日期', '资质获取时间'],
    certNo: ['certno', 'cert_no', '证书编号', '资质证书编号'],
    certIssuer: ['certissuer', 'cert_issuer', '颁发机构', '发证机构'],
    certScore: ['certscore', 'cert_score', '证书成绩'],
    certExpiry: ['certexpiry', 'cert_expiry', '证书有效期', '有效期'],
    certDescription: ['certdescription', 'cert_description', '证书描述'],
    langName: ['langname', 'lang_name', '语言种类', '语种名称'],
    langDate: ['langdate', 'lang_date', '语言证书获得时间', '外语获得时间'],
    langCertName: ['langcertname', 'lang_cert_name', '语言证书名称'],
    langScore: ['langscore', 'lang_score', '语言成绩'],
    langLevel: ['langlevel', 'lang_level', '语言掌握程度', '外语掌握程度'],
    langListenSpeak: ['langlistenspeak', '听说能力', '外语听说'],
    langReadWrite: ['langreadwrite', '读写能力', '外语读写'],
    familyName: ['familyname', 'family_name_member', '家庭成员姓名', '家人姓名'],
    familyRelation: ['familyrelation', 'family_relation', '家庭关系', '家庭成员关系', '与本人关系'],
    familyGender: ['familygender', 'family_gender', '家庭成员性别'],
    familyEducation: ['familyeducation', 'family_education', '家庭成员教育程度', '家人学历'],
    familyEthnicity: ['familyethnicity', 'family_ethnicity', '家庭成员民族'],
    familyIdNumber: ['familyidnumber', 'family_id_number', '家庭成员身份证号', '家人身份证'],
    familyBirthday: ['familybirthday', 'family_birthday', '家庭成员出生日期'],
    familyPhone: ['familyphone', 'family_phone', '家庭成员联系电话', '家人电话'],
    familyEmployer: ['familyemployer', 'family_employer', '家庭成员工作单位', '家人工作单位'],
    familyTitle: ['familytitle', 'family_title', '家庭成员职位'],
    familyPoliticalStatus: ['familypoliticalstatus', '家庭成员政治面貌'],
    familyAddress: ['familyaddress', 'family_address', '家庭成员联系地址', '家人地址'],
    awardName: ['awardname', 'award_name', '奖项名称', '获奖名称'],
    awardIssuer: ['awardissuer', 'award_issuer', '颁奖机构', '奖励颁发机构'],
    awardDate: ['awarddate', 'award_date', '获奖时间', '获奖日期'],
    awardEnd: ['awardend', 'award_end', '奖项结束时间'],
    awardLevel: ['awardlevel', 'award_level', '奖项级别'],
    awardType: ['awardtype', 'award_type', '奖励类型'],
    awardGrade: ['awardgrade', 'award_grade', '奖励等级'],
    awardDescription: ['awarddescription', 'award_description', '获奖描述'],
    patentName: ['patentname', 'patent_name', '专利名称'],
    patentNo: ['patentno', 'patent_no', '专利号'],
    patentApplyDate: ['patentapplydate', 'patent_apply_date', '专利申请日期'],
    patentStatus: ['patentstatus', 'patent_status', '专利状态'],
    patentInventor: ['patentinventor', 'patent_inventor', '专利发明人', '发明人'],
    patentDescription: ['patentdescription', 'patent_description', '专利描述'],
    paperTitle: ['papertitle', 'paper_title', '论文标题', '论文题目'],
    paperJournal: ['paperjournal', 'paper_journal', '发表期刊', '期刊名称'],
    paperAuthors: ['paperauthors', 'paper_authors', '论文作者'],
    paperVolume: ['papervolume', 'paper_volume', '期刊卷期', '卷期'],
    paperImpactFactor: ['paperimpactfactor', '影响因子'],
    paperJournalLevel: ['paperjournallevel', '刊物等级', '期刊等级'],
    paperAuthorOrder: ['paperauthororder', '作者顺序'],
    paperDate: ['paperdate', 'paper_date', '发表时间', '论文发表时间'],
    paperDoi: ['paperdoi', 'paper_doi', 'doi'],
    paperLink: ['paperlink', 'paper_link', '论文链接'],
    paperAbstract: ['paperabstract', 'paper_abstract', '论文摘要'],
    trainingName: ['trainingname', 'training_name', '培训名称'],
    trainingStart: ['trainingstart', 'training_start', '培训开始'],
    trainingEnd: ['trainingend', 'training_end', '培训结束'],
    trainingOrg: ['trainingorg', 'training_org', '培训机构'],
    trainingGain: ['traininggain', 'training_gain', '培训收获'],
    trainingContent: ['trainingcontent', 'training_content', '培训内容'],
    referralSource: [
      'referralsource', 'referral_source', '招聘渠道', '应聘渠道', '投递来源', '获知渠道',
      '招聘信息来源', '信息来源'
    ],
    additionalInfo: [
      'additionalinfo', 'additional_info', 'otherinfo', 'remarks', 'notes',
      '其他信息', '补充信息', '备注', '其他说明'
    ]
  };

  /** 更具体字段优先（同长度时参考） */
  var FIELD_ORDER = [
    // 更具体 / 易冲突优先
    'emergencyContactName', 'emergencyContactRelation', 'emergencyContactPhone', 'emergencyContact',
    'namePinyin', 'englishName', 'preferredName', 'firstName', 'lastName', 'resumeTitle',
    'secondaryEmail', 'email', 'wechat', 'qq', 'phone',
    'birthday', 'age', 'idType', 'idNumber', 'gender',
    'nationality', 'ethnicity', 'politicalStatus', 'maritalStatus',
    'linkedin', 'github', 'website',
    'expectedCity', 'interviewCity', 'currentCity', 'currentAddress',
    'hukouType', 'hukou', 'nativePlace', 'studentOrigin', 'archiveLocation',
    'willingToRelocate', 'acceptAdjustment',
    'highestDegree', 'eduDegree', 'isFreshGraduate', 'workStatus', 'lastCompany',
    'englishLevel', 'gaokaoDate', 'gaokaoScore', 'gaokaoSubjects', 'professionalTitle',
    'healthStatus', 'hasChronicIllness', 'hasCriminalRecord', 'hasMilitaryService', 'isVeteran',
    'bloodType', 'partyJoinDate', 'leagueOrPartyJoinDate',
    'isRecommendedPostgrad', 'hasStudyAbroad', 'isPovertyStudent', 'isColorWeak', 'hasOverseasIdentity',
    'height', 'weight',
    'personalStrengths', 'hobbies', 'careerPlan',
    'expectedIndustry', 'currentIndustry', 'expectedStartDate',
    'expectedAnnualSalary', 'currentSalary', 'expectedSalary',
    'hasRelativeAtCompany', 'jobTarget',
    'gradYear', 'gpa', 'eduStart', 'eduEnd', 'degreeAwardDate', 'dualDegree',
    'isUpgradeFromCollege', 'majorCategory', 'schoolCity', 'schoolType', 'eduStatus', 'eduYears',
    'studyMode', 'eduMode', 'enrollmentType', 'isTongzhao',
    'failedCourses', 'classRank', 'majorRank', 'majorClassSize',
    'eduCertNo', 'degreeCertNo', 'studentId', 'advisorName', 'labName',
    'isNationalKeyLab', 'isJointTraining', 'counselorName', 'counselorContact', 'isOverseasSchool',
    'eduDescription', 'majorDescription', 'majorCourses', 'researchDirection', 'thesisTitle',
    'school', 'degree', 'major', 'department',
    'internRefereeName', 'internRefereeContact', 'internRefereeTitle',
    'internCompany', 'internCompanySize', 'internOverseas', 'internDepartment', 'internTitle',
    'internStart', 'internEnd', 'internCity', 'internIndustry', 'internEmploymentType',
    'internAnnualSalary', 'internDescription', 'internLeaveReason',
    'projectRefereeName', 'projectRefereeContact', 'projectRefereeTitle',
    'projectName', 'projectTeamSize', 'projectOverseas', 'projectRole', 'projectPracticeMode',
    'projectStart', 'projectEnd', 'projectCity', 'projectLink',
    'projectDesc', 'projectResponsibilities', 'projectOutcome',
    'campusOrg', 'campusLevel', 'campusRole', 'campusStart', 'campusEnd', 'campusWorkContent', 'campusDuty',
    'socialOrg', 'socialRole', 'socialStart', 'socialEnd', 'socialContent',
    'refereeName', 'refereeContact', 'refereeTitle',
    'leaveReason', 'achievements', 'workDescription', 'companySize', 'workOverseas',
    'workCity', 'industry', 'employmentType', 'jobType',
    'monthlySalary', 'annualSalary', 'workEnd', 'endDate',
    'company', 'title', 'years', 'startDate',
    'noticePeriod', 'earliestStart', 'availability', 'workAuth', 'referralSource',
    'certName', 'certType', 'certDate', 'certNo', 'certIssuer', 'certScore', 'certExpiry', 'certDescription',
    'langName', 'langDate', 'langCertName', 'langScore', 'langLevel', 'langListenSpeak', 'langReadWrite',
    'languages', 'certificates',
    'techSkills', 'softwareSkills', 'softSkills', 'skills',
    'familyIdNumber', 'familyName', 'familyRelation', 'familyGender', 'familyEducation', 'familyEthnicity',
    'familyBirthday', 'familyPhone', 'familyEmployer', 'familyTitle', 'familyPoliticalStatus', 'familyAddress',
    'awardName', 'awardIssuer', 'awardDate', 'awardEnd', 'awardLevel', 'awardType', 'awardGrade', 'awardDescription',
    'patentName', 'patentNo', 'patentApplyDate', 'patentStatus', 'patentInventor', 'patentDescription',
    'paperTitle', 'paperJournal', 'paperAuthors', 'paperVolume', 'paperImpactFactor', 'paperJournalLevel',
    'paperAuthorOrder', 'paperDate', 'paperDoi', 'paperLink', 'paperAbstract',
    'trainingName', 'trainingStart', 'trainingEnd', 'trainingOrg', 'trainingGain', 'trainingContent',
    'summary', 'additionalInfo',
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
    'race', 'sexualorientation', 'lgbtq',
    // 上司/他人联系人（避免把申请人微信/电话填进「直接上司…」）
    '直接上司', '直属上级', '直属领导', '上级领导', '汇报对象',
    'supervisor', 'reportingto', 'linemanager', 'managername',
    'managerphone', 'managercontact', 'reportingmanager'
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

  /**
   * 是否「他人联系方式」语境（上司/直属上级/汇报对象等），不应填申请人 wechat/qq/phone。
   * 紧急联系人仍允许映射到 emergencyContact*。
   * 证明人/家庭成员不走此函数（有独立 referee / family 键），见 isApplicantOnlyKeyBlocked。
   */
  function isOtherPersonContactContext(hints) {
    var raw = String(hints || '');
    var rawLower = raw.toLowerCase();
    var h = normalize(raw);
    if (!h && !rawLower) return false;

    // 紧急联系人属于申请人侧，不算「他人」
    if (h.indexOf('紧急联系人') !== -1 || h.indexOf('紧急联络') !== -1 ||
        h.indexOf('应急联系') !== -1 || h.indexOf('emergencycontact') !== -1 ||
        h.indexOf('emergencyphone') !== -1) {
      return false;
    }

    // 证明人有专用键，不在此一律跳过
    if (h.indexOf('证明人') !== -1 || h.indexOf('referee') !== -1) {
      return false;
    }

    var zhMarkers = [
      '直接上司', '直属上级', '直属领导', '上级领导', '汇报对象',
      '上司', '直属上级', '上级的', '经理的联系', '领导的联系'
    ];
    var i;
    for (i = 0; i < zhMarkers.length; i++) {
      if (h.indexOf(normalize(zhMarkers[i])) !== -1 || raw.indexOf(zhMarkers[i]) !== -1) {
        // 「上司」单独出现时需与联系方式共现，避免误伤无关字段
        if (zhMarkers[i] === '上司') {
          if (/微信|电话|手机|qq|联系|wechat|phone|mobile|tel/i.test(raw)) return true;
          continue;
        }
        return true;
      }
    }

    if (/\bsupervisors?\b/i.test(rawLower)) return true;
    if (/reporting\s*managers?/i.test(rawLower)) return true;
    if (/line\s*managers?/i.test(rawLower)) return true;
    if (/manager'?s?\s*(phone|contact|wechat|mobile|email|name)/i.test(rawLower)) return true;
    if (/\breporting\s*to\b/i.test(rawLower)) return true;
    if (h.indexOf('reportingmanager') !== -1 || h.indexOf('linemanager') !== -1 ||
        h.indexOf('managerphone') !== -1 || h.indexOf('managercontact') !== -1 ||
        h.indexOf('managername') !== -1 || h.indexOf('reportingto') !== -1) {
      return true;
    }
    return false;
  }

  /** 申请人身份/联系键：在证明人/家庭成员语境下不应被误填 */
  var APPLICANT_ONLY_KEYS = {
    name: 1, firstName: 1, lastName: 1, namePinyin: 1, englishName: 1, preferredName: 1,
    phone: 1, wechat: 1, qq: 1, email: 1, secondaryEmail: 1,
    idNumber: 1, idType: 1, birthday: 1, gender: 1
  };

  /**
   * 证明人 / 家庭成员语境下，禁止把申请人 name/phone/wechat/idNumber 等填进去。
   * referee / family / emergency 键放行。
   */
  function isApplicantOnlyKeyBlocked(key, hints) {
    if (!key || !APPLICANT_ONLY_KEYS[key]) return false;
    var raw = String(hints || '');
    var h = normalize(raw);
    if (!h) return false;
    if (h.indexOf('紧急联系人') !== -1 || h.indexOf('紧急联络') !== -1 ||
        h.indexOf('emergencycontact') !== -1) {
      return false;
    }
    if (h.indexOf('证明人') !== -1 || h.indexOf('referee') !== -1) return true;
    if (h.indexOf('家庭成员') !== -1 || h.indexOf('家人') !== -1 ||
        h.indexOf('family') !== -1) {
      // family_name 作为姓氏 autocomplete 不在此；有「家庭」中文或 family member 才拦
      if (h.indexOf('家庭') !== -1 || h.indexOf('家人') !== -1 ||
          h.indexOf('familymember') !== -1 || h.indexOf('family_member') !== -1 ||
          h.indexOf('familymember') !== -1) {
        return true;
      }
      if (/family\s*(name|phone|id|member|relation|gender|address)/i.test(raw)) return true;
    }
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
    if (isOtherPersonContactContext(raw)) return null;

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
    if (bestKey) {
      if (isApplicantOnlyKeyBlocked(bestKey, raw)) return null;
      return { key: bestKey, confidence: bestScore, method: bestMethod };
    }

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
      if (isApplicantOnlyKeyBlocked(bestKey, raw)) return null;
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
    // 现居住地址 ↔ 详细地址
    if (key === 'currentAddress') {
      var ca = profile.currentAddress && String(profile.currentAddress).trim();
      if (ca) return ca;
      return (profile.address && String(profile.address).trim()) || '';
    }
    if (key === 'address') {
      var ad = profile.address && String(profile.address).trim();
      if (ad) return ad;
      return (profile.currentAddress && String(profile.currentAddress).trim()) || '';
    }
    // 技术技能 ↔ 技能
    if (key === 'techSkills') {
      var ts = profile.techSkills && String(profile.techSkills).trim();
      if (ts) return ts;
      return (profile.skills && String(profile.skills).trim()) || '';
    }
    if (key === 'skills') {
      var sk = profile.skills && String(profile.skills).trim();
      if (sk) return sk;
      return (profile.techSkills && String(profile.techSkills).trim()) || '';
    }
    // 国籍 ↔ 国家（仅单向：nationality 可回退 country）
    if (key === 'nationality') {
      var nat = profile.nationality && String(profile.nationality).trim();
      if (nat) return nat;
      return (profile.country && String(profile.country).trim()) || '';
    }
    // 学习形式 ↔ 教育方式
    if (key === 'studyMode') {
      var sm = profile.studyMode && String(profile.studyMode).trim();
      if (sm) return sm;
      return (profile.eduMode && String(profile.eduMode).trim()) || '';
    }
    if (key === 'eduMode') {
      var em = profile.eduMode && String(profile.eduMode).trim();
      if (em) return em;
      return (profile.studyMode && String(profile.studyMode).trim()) || '';
    }
    // 用工性质 ↔ 工作性质
    if (key === 'employmentType') {
      var et = profile.employmentType && String(profile.employmentType).trim();
      if (et) return et;
      return (profile.jobType && String(profile.jobType).trim()) || '';
    }
    if (key === 'jobType') {
      var jt = profile.jobType && String(profile.jobType).trim();
      if (jt) return jt;
      return (profile.employmentType && String(profile.employmentType).trim()) || '';
    }
    // 工作描述 ↔ 业绩
    if (key === 'workDescription') {
      var wd = profile.workDescription && String(profile.workDescription).trim();
      if (wd) return wd;
      return (profile.achievements && String(profile.achievements).trim()) || '';
    }
    // 紧急联系人：组合回退
    if (key === 'emergencyContact') {
      var ec = profile.emergencyContact && String(profile.emergencyContact).trim();
      if (ec) return ec;
      var en = profile.emergencyContactName && String(profile.emergencyContactName).trim();
      var ep = profile.emergencyContactPhone && String(profile.emergencyContactPhone).trim();
      if (en && ep) return en + ' ' + ep;
      return en || ep || '';
    }
    if (key === 'emergencyContactName') {
      var ecn = profile.emergencyContactName && String(profile.emergencyContactName).trim();
      if (ecn) return ecn;
      // 无法可靠从组合串拆分时不回退，避免污染
      return '';
    }
    if (key === 'emergencyContactPhone') {
      var ecp = profile.emergencyContactPhone && String(profile.emergencyContactPhone).trim();
      if (ecp) return ecp;
      return '';
    }
    // endDate ↔ workEnd
    if (key === 'endDate') {
      var ed = profile.endDate && String(profile.endDate).trim();
      if (ed) return ed;
      return (profile.workEnd && String(profile.workEnd).trim()) || '';
    }
    if (key === 'workEnd') {
      var we = profile.workEnd && String(profile.workEnd).trim();
      if (we) return we;
      return (profile.endDate && String(profile.endDate).trim()) || '';
    }
    // highestDegree ↔ eduDegree ↔ degree 轻度回退
    if (key === 'highestDegree') {
      var hd = profile.highestDegree && String(profile.highestDegree).trim();
      if (hd) return hd;
      var edg = profile.eduDegree && String(profile.eduDegree).trim();
      if (edg) return edg;
      return (profile.degree && String(profile.degree).trim()) || '';
    }
    if (key === 'eduDegree') {
      var ed2 = profile.eduDegree && String(profile.eduDegree).trim();
      if (ed2) return ed2;
      var hd2 = profile.highestDegree && String(profile.highestDegree).trim();
      if (hd2) return hd2;
      return (profile.degree && String(profile.degree).trim()) || '';
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


  /**
   * 提取 label 可见文本：递归 childNodes，跳过表单控件子树（select/option/input/textarea/button/datalist），
   * 避免 option 文案（如 "High School"）污染标签匹配。兼容真实 DOM 与最小 Node mock。
   * @param {{nodeType?:number,nodeValue?:string,tagName?:string,childNodes?:*}|null|undefined} labelEl
   * @returns {string}
   */
  function visibleLabelText(labelEl) {
    if (!labelEl) return '';
    var SKIP_TAGS = {
      SELECT: 1, OPTION: 1, INPUT: 1, TEXTAREA: 1, BUTTON: 1, DATALIST: 1
    };
    function walk(node) {
      if (!node) return '';
      var t = node.nodeType;
      if (t === 3) {
        return node.nodeValue != null ? String(node.nodeValue) : '';
      }
      if (t === 1) {
        var tag = node.tagName ? String(node.tagName).toUpperCase() : '';
        if (SKIP_TAGS[tag]) return '';
        var out = '';
        var kids = node.childNodes || [];
        var i;
        for (i = 0; i < kids.length; i++) {
          out += walk(kids[i]);
        }
        return out;
      }
      return '';
    }
    return walk(labelEl).replace(/\s+/g, ' ').trim();
  }

  function getElClassName(el) {
    if (!el) return '';
    var c = el.className;
    if (typeof c === 'string') return c;
    if (c && typeof c.baseVal === 'string') return c.baseVal;
    return '';
  }

  function getElAttr(el, name) {
    if (!el) return '';
    if (typeof el.getAttribute === 'function') {
      var v = el.getAttribute(name);
      return v == null ? '' : String(v);
    }
    if (el.attributes && el.attributes[name] != null) return String(el.attributes[name]);
    if (el[name] != null && typeof el[name] !== 'function') return String(el[name]);
    return '';
  }

  function cleanLabelPunctuation(s) {
    var t = String(s || '')
      .replace(/[*＊✱ ass]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    if (/^[:：\-\/\\|·•.。,，、]+$/.test(t)) return '';
    return t;
  }

  function looksLikeOptionPollution(text) {
    var s = String(text || '');
    if (s.length > 80) return true;
    if (/\b(high\s*school|bachelor|master|phd|select\s*one|please\s*select)\b/i.test(s) &&
        /\/|,/.test(s) && s.length > 40) return true;
    return false;
  }

  /**
   * 从 aria-labelledby 解析可见标签文本。
   * @param {object} el
   * @param {(id:string)=>object|null} [getElementById]
   */
  function resolveAriaLabelledByText(el, getElementById) {
    var raw = getElAttr(el, 'aria-labelledby');
    if (!raw) return '';
    var ids = String(raw).split(/\s+/).filter(Boolean);
    if (!ids.length) return '';
    var getter = getElementById;
    if (typeof getter !== 'function' && typeof document !== 'undefined' && document.getElementById) {
      getter = function (id) { return document.getElementById(id); };
    }
    if (typeof getter !== 'function') return '';
    var parts = [];
    var i, node, tag, piece;
    for (i = 0; i < ids.length; i++) {
      node = getter(ids[i]);
      if (!node) continue;
      tag = node.tagName ? String(node.tagName).toUpperCase() : '';
      if (tag === 'LABEL') piece = visibleLabelText(node);
      else piece = String(node.textContent || visibleLabelText(node) || '').replace(/\s+/g, ' ').trim();
      piece = cleanLabelPunctuation(piece);
      if (piece && !looksLikeOptionPollution(piece)) parts.push(piece);
    }
    return parts.join(' ').trim();
  }

  function classHasToken(className, token) {
    return String(className || '').split(/\s+/).indexOf(token) !== -1;
  }

  function classIncludes(className, substr) {
    return String(className || '').indexOf(substr) !== -1;
  }

  function findChildByClassOrTag(root, predicates) {
    if (!root) return null;
    var queue = [root];
    var seen = 0;
    while (queue.length && seen < 80) {
      var cur = queue.shift();
      seen += 1;
      if (cur !== root) {
        var tag = cur.tagName ? String(cur.tagName).toUpperCase() : '';
        var cn = getElClassName(cur);
        var p;
        for (p = 0; p < predicates.length; p++) {
          if (predicates[p](cur, tag, cn)) return cur;
        }
      }
      var kids = cur.children || cur.childNodes || [];
      var i;
      for (i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k && (k.nodeType === 1 || k.tagName)) queue.push(k);
      }
    }
    return null;
  }

  function extractTextFromLabelContainer(labelContainer) {
    if (!labelContainer) return '';
    var labelEl = null;
    if (labelContainer.tagName && String(labelContainer.tagName).toUpperCase() === 'LABEL') {
      labelEl = labelContainer;
    } else {
      labelEl = findChildByClassOrTag(labelContainer, [
        function (el, tag) { return tag === 'LABEL'; }
      ]);
    }
    var raw;
    if (labelEl) raw = visibleLabelText(labelEl) || String(labelEl.textContent || '');
    else raw = visibleLabelText(labelContainer) || String(labelContainer.textContent || '');
    return cleanLabelPunctuation(raw);
  }

  /**
   * 从 antd/element-ui/semi/formily 等 form-item 容器取标签文本。
   * 兼容真实 DOM（closest/parentElement）与最小 Node mock（parentElement + className）。
   */
  function labelTextFromFormItem(el) {
    if (!el) return '';

    function walkUp(start, maxDepth, testFn) {
      var cur = start;
      var depth = 0;
      while (cur && depth < maxDepth) {
        if (testFn(cur)) return cur;
        cur = cur.parentElement || cur.parentNode || null;
        if (cur && cur.nodeType && cur.nodeType !== 1) cur = cur.parentElement || null;
        depth += 1;
      }
      return null;
    }

    var namedSelectors = [
      function (node) { return classHasToken(getElClassName(node), 'ant-form-item'); },
      function (node) { return classHasToken(getElClassName(node), 'el-form-item'); },
      function (node) { return classHasToken(getElClassName(node), 'semi-form-field'); },
      function (node) { return classIncludes(getElClassName(node), 'formily-item'); },
      function (node) {
        var cn = getElClassName(node);
        return classIncludes(cn, 'form-item') && !classIncludes(cn, 'form-item-label') &&
          !classIncludes(cn, 'form-item-control');
      }
    ];

    var container = null;
    if (typeof el.closest === 'function') {
      try {
        container = el.closest('.ant-form-item') ||
          el.closest('.el-form-item') ||
          el.closest('.semi-form-field') ||
          el.closest('.formily-item') ||
          el.closest('[class*="form-item"]');
      } catch (_) { container = null; }
    }
    if (!container) {
      var si;
      for (si = 0; si < namedSelectors.length && !container; si++) {
        container = walkUp(el, 8, namedSelectors[si]);
      }
    }

    if (container) {
      var labelBox = findChildByClassOrTag(container, [
        function (node, tag, cn) {
          return classHasToken(cn, 'ant-form-item-label') ||
            classHasToken(cn, 'el-form-item__label') ||
            classIncludes(cn, '-form-item-label') ||
            tag === 'LABEL';
        }
      ]);
      var t = extractTextFromLabelContainer(labelBox || container);
      if (t) return t;
    }

    // Bounded walk ≤6 parents looking for a child label container
    var parent = el.parentElement || el.parentNode || null;
    var depth = 0;
    while (parent && depth < 6) {
      if (parent.nodeType && parent.nodeType !== 1) {
        parent = parent.parentElement || null;
        depth += 1;
        continue;
      }
      var childLabel = findChildByClassOrTag(parent, [
        function (node, tag, cn) {
          return classHasToken(cn, 'ant-form-item-label') ||
            classHasToken(cn, 'el-form-item__label') ||
            classIncludes(cn, '-form-item-label') ||
            (tag === 'LABEL' && node !== el);
        }
      ]);
      if (childLabel) {
        var t2 = extractTextFromLabelContainer(childLabel);
        if (t2) return t2;
      }
      parent = parent.parentElement || parent.parentNode || null;
      depth += 1;
    }
    return '';
  }

  /**
   * 父节点的 previousElementSibling 是否像标签列（label-col | control-col）。
   */
  function labelTextFromParentPrevSibling(el) {
    if (!el) return '';
    var parent = el.parentElement || el.parentNode || null;
    if (!parent) return '';
    var prev = parent.previousElementSibling;
    if (!prev) return '';
    var tag = prev.tagName ? String(prev.tagName).toUpperCase() : '';
    var cn = getElClassName(prev);
    var looksLabel =
      tag === 'LABEL' ||
      classIncludes(cn, 'label') ||
      classIncludes(cn, 'form-item-label') ||
      /^(LABEL|SPAN|DIV|P|STRONG|TD|TH)$/i.test(tag);
    if (!looksLabel) return '';
    var t = extractTextFromLabelContainer(prev);
    if (t) return t;
    return cleanLabelPunctuation(String(prev.textContent || visibleLabelText(prev) || ''));
  }

  /** 可拆分的日期类 profile 键 */
  var DATE_PART_KEYS = {
    birthday: 1,
    startDate: 1,
    eduStart: 1,
    eduEnd: 1,
    gradYear: 1,
    earliestStart: 1,
    availability: 1
  };

  /**
   * 从完整日期字符串提取年/月/日。
   * @param {string} value
   * @param {'year'|'month'|'day'} part
   * @returns {string}
   */
  function extractDatePart(value, part) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    var p = String(part || '').toLowerCase();
    if (p !== 'year' && p !== 'month' && p !== 'day') return '';

    // Already a bare 4-digit year
    if (/^\d{4}$/.test(raw)) {
      if (p === 'year') return raw;
      return '';
    }
    // Bare month 1–12
    if (/^(0?[1-9]|1[0-2])$/.test(raw)) {
      if (p === 'month') return String(parseInt(raw, 10));
      return '';
    }

    var year = '';
    var month = '';
    var day = '';

    var m;
    // 2020年6月12日 / 2020年6月
    m = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/);
    if (m) {
      year = m[1];
      month = m[2];
      day = m[3] || '';
    }
    if (!year) {
      // ISO / dash / slash / dot: 2020-06-12, 2020/6, 2020.06
      m = raw.match(/(\d{4})[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?/);
      if (m) {
        year = m[1];
        month = m[2];
        day = m[3] || '';
      }
    }
    if (!year) {
      // year only with 年
      m = raw.match(/(\d{4})\s*年/);
      if (m) year = m[1];
    }
    if (!year) {
      m = raw.match(/\b(\d{4})\b/);
      if (m) year = m[1];
    }
    if (!month) {
      m = raw.match(/(\d{1,2})\s*月/);
      if (m) month = m[1];
    }

    if (p === 'year') return year || '';
    if (p === 'month') {
      if (!month) return '';
      var mi = parseInt(month, 10);
      if (!(mi >= 1 && mi <= 12)) return '';
      return String(mi);
    }
    if (p === 'day') {
      if (!day) return '';
      var di = parseInt(day, 10);
      if (!(di >= 1 && di <= 31)) return '';
      return String(di);
    }
    return '';
  }

  /**
   * 检测字段是否为年/月/日分栏。
   * 保守：裸「年」「月」不够，需 name/id/placeholder 或上下文暗示日期字段。
   * options.adjacentPairRole: 同组互补 placeholder（年+月）时，允许无 dateContext 也返回角色。
   * @returns {'year'|'month'|'day'|null}
   */
  function detectDatePartRole(hints, options) {
    var raw = String(hints || '');
    var rawLower = raw.toLowerCase();
    var h = normalize(raw);
    var opts = options || {};
    var adj = opts.adjacentPairRole || '';
    if (!h && !raw && adj !== 'year' && adj !== 'month') return null;

    // Explicit name/id patterns
    if (/(?:^|[^a-z])(birth|start|end|edu|grad|enroll|hire|avail|earliest)[_\-]?year(?:[^a-z]|$)/i.test(rawLower) ||
        /(?:^|[^a-z])year(?:of)?(?:birth|grad|start|end)(?:[^a-z]|$)/i.test(rawLower) ||
        h.indexOf('出生年') !== -1 || h.indexOf('入学年') !== -1 || h.indexOf('毕业年') !== -1 ||
        h.indexOf('开始年') !== -1 || h.indexOf('结束年') !== -1) {
      return 'year';
    }
    if (/(?:^|[^a-z])(birth|start|end|edu|grad|enroll|hire|avail|earliest)[_\-]?month(?:[^a-z]|$)/i.test(rawLower) ||
        /(?:^|[^a-z])month(?:of)?(?:birth|grad|start|end)(?:[^a-z]|$)/i.test(rawLower) ||
        h.indexOf('出生月') !== -1 || h.indexOf('入学月') !== -1 || h.indexOf('毕业月') !== -1 ||
        h.indexOf('开始月') !== -1 || h.indexOf('结束月') !== -1) {
      return 'month';
    }
    if (/(?:^|[^a-z])(birth|start|end|edu)[_\-]?day(?:[^a-z]|$)/i.test(rawLower) ||
        h.indexOf('出生日') !== -1) {
      return 'day';
    }

    var dateContext =
      /开始|结束|入学|毕业|在职|出生|入职|到岗|任职|就读|年月日|年月/.test(raw) ||
      /\b(birthday|birth|start\s*date|end\s*date|grad|enrol|education|employ|available|earliest)\b/i.test(rawLower) ||
      h.indexOf('startdate') !== -1 || h.indexOf('edustart') !== -1 || h.indexOf('eduend') !== -1 ||
      h.indexOf('birthday') !== -1 || h.indexOf('gradyear') !== -1 || h.indexOf('earlieststart') !== -1;

    // placeholder / short label year or month with date context
    var yearOnly =
      (/^(年|year|yyyy|年\/年)$/i.test(raw.trim()) ||
        /\b(yyyy|year)\b/i.test(rawLower) && !/\b(month|day|mm|dd)\b/i.test(rawLower) ||
        /(^|[\s\|])年([\s\|]|$)/.test(raw) ||
        /placeholder[^|]{0,20}年/.test(rawLower) ||
        /(?:^|[^a-z\u4e00-\u9fff])年(?:[^a-z\u4e00-\u9fff]|$)/.test(raw) &&
          !/年月|年份|年度|年限|年薪|年级|年假/.test(raw));

    var monthOnly =
      (/^(月|month|mm|月\/月)$/i.test(raw.trim()) ||
        /\b(mm|month)\b/i.test(rawLower) && !/\b(year|day|yyyy|dd)\b/i.test(rawLower) ||
        /(^|[\s\|])月([\s\|]|$)/.test(raw) ||
        /placeholder[^|]{0,20}月/.test(rawLower));

    if (dateContext && yearOnly && !monthOnly) return 'year';
    if (dateContext && monthOnly && !yearOnly) return 'month';

    // Combined label like "入学时间 年" / "开始日期 年"
    if (dateContext && /年/.test(raw) && !/月/.test(raw) &&
        (h.indexOf('年') !== -1) && raw.length < 40) {
      if (/开始|结束|入学|毕业|出生|入职|到岗|任职|就读/.test(raw) ||
          /\b(start|end|birth|grad|enrol)/i.test(rawLower)) {
        return 'year';
      }
    }
    if (dateContext && /月/.test(raw) && !/年/.test(raw) && raw.length < 40) {
      if (/开始|结束|入学|毕业|出生|入职|到岗|任职|就读/.test(raw) ||
          /\b(start|end|birth|grad|enrol)/i.test(rawLower)) {
        return 'month';
      }
    }

    // "入学 年" style with sibling context already in hints
    if ((/入学|毕业|出生|开始|结束|在职/.test(raw)) &&
        (/(?:^|[\s\|\/])年(?:[\s\|\/]|$)/.test(raw) || /\byear\b/i.test(rawLower))) {
      if (!/月|month|mm/i.test(raw)) return 'year';
    }
    if ((/入学|毕业|出生|开始|结束|在职/.test(raw)) &&
        (/(?:^|[\s\|\/])月(?:[\s\|\/]|$)/.test(raw) || /\bmonth\b|\bmm\b/i.test(rawLower))) {
      if (!/年|year|yyyy/i.test(raw) || /年月/.test(raw) === false) {
        // if both 年 and 月 present as "年月", don't treat as month-only
        if (!/年/.test(raw) && !/\byear\b|yyyy/i.test(rawLower)) return 'month';
      }
    }

    // D10: adjacent complementary placeholder pair (年+月) without dateContext
    if (adj === 'year' || adj === 'month') {
      var bareYear =
        yearOnly ||
        /^(年|year|yyyy)$/i.test(raw.trim()) ||
        (!String(raw).trim() && adj === 'year');
      var bareMonth =
        monthOnly ||
        /^(月|month|mm)$/i.test(raw.trim()) ||
        (!String(raw).trim() && adj === 'month');
      if (adj === 'year' && bareYear && !monthOnly) return 'year';
      if (adj === 'month' && bareMonth && !yearOnly) return 'month';
    }

    return null;
  }

  var DATE_GROUP_LABEL_RE = /入学|毕业|开始|结束|出生|入职|就读|在职/;
  var DATE_GROUP_LABEL_CLASS = /form-item-label|ant-form-item-label|el-form-item__label|semi-form-field-label|formily-item-label/i;

  /**
   * 在祖先链（约 8 层）中查找含入学/毕业/开始/结束等的短标签文案。
   * 用于 Moka 等仅有 placeholder「年」「月」、getLabelText 为空的配对输入。
   */
  function findNearbyDateGroupLabelText(el) {
    if (!el) return '';
    var node = el.parentElement || el.parentNode || null;
    var depth, i, kid, cls, tag, t, prev, hops, kids;
    for (depth = 0; depth < 8 && node; depth++) {
      kids = node.children || [];
      for (i = 0; i < kids.length; i++) {
        kid = kids[i];
        if (!kid || kid.nodeType !== 1) continue;
        cls = String(kid.className || '');
        tag = String(kid.tagName || '').toUpperCase();
        if (tag === 'LABEL' || DATE_GROUP_LABEL_CLASS.test(cls)) {
          t = cleanLabelPunctuation(
            visibleLabelText(kid) || String(kid.textContent || '')
          );
          t = String(t || '').replace(/\s+/g, ' ').trim();
          if (t && t.length < 48 && DATE_GROUP_LABEL_RE.test(t)) return t;
        }
      }
      prev = node.previousElementSibling || null;
      hops = 0;
      while (prev && hops < 4) {
        cls = String(prev.className || '');
        tag = String(prev.tagName || '').toUpperCase();
        t = cleanLabelPunctuation(
          visibleLabelText(prev) || String(prev.textContent || '')
        );
        t = String(t || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 48 && DATE_GROUP_LABEL_RE.test(t)) {
          if (tag === 'LABEL' || DATE_GROUP_LABEL_CLASS.test(cls) ||
              /^(LABEL|SPAN|DIV|P|STRONG|DT|LEGEND)$/i.test(tag)) {
            return t;
          }
        }
        prev = prev.previousElementSibling || null;
        hops++;
      }
      node = node.parentElement || node.parentNode || null;
    }
    return '';
  }

  function isDatePartProfileKey(key) {
    return !!(key && DATE_PART_KEYS[key]);
  }

  /**
   * 若字段是年/月分栏且值为完整日期，则拆分；否则原样返回。
   * 有 role 但拆不出对应部分时返回 ''（跳过），绝不把整年塞进月份格。
   * zeroPadMonth: maxlength=2 或 placeholder 暗示时补零。
   * options.adjacentPairRole 会传给 detectDatePartRole。
   */
  function maybeExtractDatePartValue(value, hints, options) {
    var opts = options || {};
    var role = detectDatePartRole(hints, opts);
    if (!role) return String(value == null ? '' : value);
    var key = opts.profileKey || '';
    // 无明确 role 时已返回；有 role 时允许对日期键或 hints 含日期上下文拆分
    if (key && !isDatePartProfileKey(key) && !detectDatePartRole(hints, opts)) {
      return String(value == null ? '' : value);
    }
    var part = extractDatePart(value, role);
    if (!part) {
      // value already looks like the part for this role
      if (role === 'year' && /^\d{4}$/.test(String(value).trim())) return String(value).trim();
      if (role === 'month' && /^(0?[1-9]|1[0-2])$/.test(String(value).trim())) {
        part = String(parseInt(String(value).trim(), 10));
      } else if (role === 'day' && /^(0?[1-9]|[12]\d|3[01])$/.test(String(value).trim())) {
        part = String(parseInt(String(value).trim(), 10));
      } else {
        // D9: never fall back to the original full/wrong value
        return '';
      }
    }
    if (role === 'month' && (opts.zeroPadMonth || opts.maxLength === 2)) {
      var n = parseInt(part, 10);
      if (n >= 1 && n <= 12) part = (n < 10 ? '0' : '') + n;
    }
    return part;
  }

  /** 仅保留语义相关的 className token，避免 antd 长类名淹没关键词 */
  function semanticClassTokens(className) {
    var raw = String(className || '');
    if (!raw) return '';
    var tokens = raw.split(/\s+/);
    var keep = [];
    var i, t, n;
    var SEM = /name|email|phone|mobile|tel|wechat|weixin|qq|address|city|school|degree|major|company|title|salary|birth|date|year|month|gender|github|linkedin|resume|skill/i;
    for (i = 0; i < tokens.length; i++) {
      t = tokens[i];
      if (!t || t.length > 48) continue;
      if (/^(ant-|el-|semi-|css-|Mui|chakra)/i.test(t)) continue;
      n = normalize(t);
      if (SEM.test(t) || SEM.test(n)) keep.push(t);
    }
    return keep.join(' ');
  }

  return {
    FIELD_KEYWORDS: FIELD_KEYWORDS,
    FIELD_ORDER: FIELD_ORDER,
    MAX_FILLS_PER_KEY: MAX_FILLS_PER_KEY,
    FUZZY_THRESHOLD: FUZZY_THRESHOLD,
    AUTOCOMPLETE_MAP: AUTOCOMPLETE_MAP,
    SKIP_SUBSTRINGS: SKIP_SUBSTRINGS,
    DATE_PART_KEYS: DATE_PART_KEYS,
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
    visibleLabelText: visibleLabelText,
    resolveAriaLabelledByText: resolveAriaLabelledByText,
    labelTextFromFormItem: labelTextFromFormItem,
    labelTextFromParentPrevSibling: labelTextFromParentPrevSibling,
    cleanLabelPunctuation: cleanLabelPunctuation,
    isOtherPersonContactContext: isOtherPersonContactContext,
    isApplicantOnlyKeyBlocked: isApplicantOnlyKeyBlocked,
    extractDatePart: extractDatePart,
    detectDatePartRole: detectDatePartRole,
    findNearbyDateGroupLabelText: findNearbyDateGroupLabelText,
    isDatePartProfileKey: isDatePartProfileKey,
    maybeExtractDatePartValue: maybeExtractDatePartValue,
    semanticClassTokens: semanticClassTokens,
    isSkipContext: function (hints) {
      var raw = String(hints || '');
      return isSkipContext(raw.toLowerCase(), normalize(raw));
    }
  };
});

