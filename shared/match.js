/**
 * 共享字段匹配逻辑：关键词、同义、模糊评分、姓名拆分、profile 取值、select 匹配、label 可见文本。
 * 浏览器挂到 ResumeAutofillMatch；Node 通过 module.exports 引入。
 *
 * v1.5.6: 北森 Phoenix —— form-item 精确容器 token、预计报到时间、紧急联系电话专键。
 * v1.5.0: 更多 CN ATS 同义、标签噪声归一、选项/YesNo 纯函数导出；多段 occurrence 取值。
 * v1.3.0: playoffer 全量字段关键词 / FIELD_ORDER；紧急联系人拆分；地址/技能别名；证明人/家庭 denylist。
 * v1.2.4: D9 毕业时间→eduEnd + 拆分失败跳过；D10 相邻年/月 placeholder 与附近日期组标签。
 * v1.3.1: honors 键；应聘职位归 jobTarget（不再被 summary 抢）；
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
      'fname', '名字'],
    lastName: [
      'lastname', 'last_name', 'last-name', 'surname', 'familyname', 'family_name', 'family-name',
      'lname', '姓', '姓氏'],
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
      '民族', 'ethnic', 'ethnicity', '民族成分'
    ],
    politicalStatus: [
      'politicalstatus', 'political_status', '政治面貌', '党派'
    ],
    maritalStatus: [
      'maritalstatus', 'marital_status', '婚姻状况', '婚否', '婚姻', '是否已婚', '婚姻情况'
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
    phoneCountryCode: [
      'phonecountrycode', 'phone_code', 'dialcode', 'dial_code', 'countrycode',
      '电话所在区域', '手机区号', '电话区号', '国家区号', '国际区号'
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
      'emergencycontactname', 'emergency_contact_name', '紧急联系人姓名', '紧急联络人姓名',
      '紧急联系人名字', '应急联系人姓名'
    ],
    emergencyContactRelation: [
      'emergencycontactrelation', 'emergency_contact_relation', '紧急联系人关系', '与紧急联系人关系',
      '紧急联络人关系', '与应急联系人关系'
    ],
    emergencyContactPhone: [
      'emergencycontactphone', 'emergency_contact_phone', '紧急联系人电话', '紧急联系人手机',
      '紧急联络人电话', '紧急联系人号码', '应急联系人电话', '紧急联系电话', '紧急联络电话',
      '紧急联系手机', '应急联系电话'
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
      '现居城市', '目前城市', '当前城市', '现所在城市', '现居住城市',
      '现居地', '现居住地', '居住地', '常住地', '所在地'
    ],
    currentAddress: [
      'currentaddress', 'current_address', '现居住地址', '现住址', '目前住址'
    ],
    address: [
      'streetaddress', 'street_address', 'address1', 'address_line', 'mailingaddress',
      '详细地址', '通讯地址', '居住地址', '住址', '街道地址', 'address', 'street', 'addr',
      '邮寄地址', '联系地址', '收件地址', '通信地址'
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
      'hukou', 'householdregister', '户籍', '户口所在地', '户口', '户籍所在地', '户口地址',
      '户口所在城市', '户籍所在城市', '户籍城市', '户口城市', '户籍地'
    ],
    nativePlace: [
      'nativeplace', 'native_place', 'hometown', '籍贯', '出生地', '籍贯所在地', '祖籍'
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
    englishLevel: [
      'englishlevel', 'english_level', '英语等级', '英语水平', '外语等级',
      '外语水平等级', 'cet等级', 'ielts', 'toefl'
    ],
    englishScore: [
      'englishscore', 'english_score', '英语成绩', '外语成绩', '语言成绩', '英语分数',
      '四六级成绩', 'cet成绩', '雅思成绩', '托福成绩',
      '四级成绩', '六级成绩', '四级分数', '六级分数', '雅思分数', '托福分数', 'cet4成绩', 'cet6成绩',
      'cet-4成绩', 'cet-6成绩', 'cet4分数', 'cet6分数'
    ],
    englishDate: [
      'englishdate', 'english_date', '英语考试时间', '外语考试时间', '语言考试时间',
      '四六级时间', '英语获得时间', '雅思考试时间', '托福考试时间'
    ],
    gaokaoDate: ['gaokaodate', 'gaokao_date', '高考时间', '高考日期'],
    gaokaoScore: ['gaokaoscore', 'gaokao_score', '高考分数', '高考成绩'],
    gaokaoSubjects: ['gaokaosubjects', 'gaokao_subjects', '高考科目', '高考科类'],
    professionalTitle: ['professionaltitle', 'professional_title', '专业技术职级', '职称', '专业技术职务'],
    highestDegree: ['highestdegree', 'highest_degree', '最高学历', '最高学位', '最终学历'],
    isFreshGraduate: ['isfreshgraduate', 'freshgraduate', '是否应届生', '应届生', '应届'],
    workStatus: ['workstatus', 'work_status', '工作状态', '在职状态', '求职状态'],
    lastCompany: ['lastcompany', 'last_company', '上一家公司', '上家公司', '前一家公司', '最近一家公司'],
    personalStrengths: ['personalstrengths', 'personal_strengths', '个人优势', '优势亮点'],
    hobbies: ['hobbies', 'hobby', '兴趣爱好', '爱好'],
    careerPlan: ['careerplan', 'career_plan', '职业规划', '职业目标'],
    school: [
      'school', 'university', 'college', 'institution', 'edu_school', 'campus',
      '毕业院校', '就读院校', '学校', '大学', '院校', '教育机构', '毕业学校', '所在院校', '就读学校'
    ],
    eduDegree: [
      'eduDegree', 'edu_degree', '学历', '教育学历', '学历层次'
    ],
    degree: [
      'degree', 'educationlevel', 'education_level', 'edu_level', 'qualification',
      '学位', '教育程度'
    ],
    isUpgradeFromCollege: ['isupgradefromcollege', '是否专升本', '专升本'],
    department: [
      'department', 'dept', '所在部门', '部门', '科室', '院系', '所在院系',
      '院系名称', '系别', '所在系', '院系/专业', '学院名称', '所在学院', '就读院系', 'faculty'
    ],
    major: [
      'major', 'fieldofstudy', 'field_of_study', 'discipline', 'studyfield',
      '所学专业', '毕业专业', '专业', '主修'
    ],
    majorCategory: ['majorcategory', 'major_category', '专业类别', '学科门类'],
    schoolCity: [
      'schoolcity', 'school_city', '学校城市', '院校所在城市', '学校所在城市', '院校所在地',
      '院校城市', '就读城市', '学校所在地', '所属城市', 'school city', 'campus city'
    ],
    schoolType: ['schooltype', 'school_type', '院校类型', '学校类型'],
    eduStatus: ['edustatus', 'edu_status', '学历状态', '就读状态'],
    eduYears: ['eduyears', 'edu_years', '学制'],
    studyMode: ['studymode', 'study_mode', '学习形式'],
    eduMode: ['edumode', 'edu_mode', '教育方式'],
    eduStart: [
      'edustart', 'edu_start', 'enrollmentdate', 'enrollment', '入学时间', '入学日期', '就读开始',
      '入学年月', '入学年份', '开学时间'
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
      'gpa', 'grade point', '平均绩点', '学分绩点', '成绩绩点', '绩点', '平均分', '加权平均分', 'average score'
    ],
    failedCourses: ['failedcourses', 'failed_courses', '挂科数', '不及格门数'],
    classRank: ['classrank', 'class_rank', '班级排名', '班排名'],
    majorRank: [
      'majorrank', 'major_rank', '专业排名', '成绩排名', '学业排名', '综合排名', '综测排名',
      '年级排名', '排名', '名次', 'rank in major', 'class rank'
    ],
    gpaRank: [
      'gparank', 'gpa_rank', 'gpa排名', '绩点排名', '学分绩排名', '绩点名次', 'gpa percentile'
    ],
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
    , '任职单位', '就职单位', '工作单位', '所在单位'],
    companySize: ['companysize', 'company_size', '公司规模', '企业规模'],
    workOverseas: ['workoverseas', 'work_overseas', '是否海外工作', '工作是否海外'],
    title: [
      'jobtitle', 'job_title', 'job-title', 'position', 'currenttitle', 'current_title',
      'role', '职位名称', '现任职位', '岗位', '职务', '职位', 'title'
    ],
    years: [
      'yearsofexperience', 'years_of_experience', 'yoe', 'workyears', 'work_years',
      'experienceyears', '工作年限', '工作经验', '经验年限', '工龄', '从业年限', '年限'
    ],
    startDate: [
      'startdate', 'start_date', 'start-date', 'availablefrom', 'dateavailable',
      '入职时间', '任职开始', '开始日期', '工作开始', '入职日期', '到职时间'
    ],
    workEnd: [
      'workend', 'work_end', '工作结束', '任职结束', '工作结束时间', '离职时间', '离职日期'
    ],
    endDate: [
      'enddate', 'end_date', '结束日期', '结束时间'
    ],
    workCity: ['workcity', 'work_city', '工作城市', '工作地点'],
    workDepartment: [
      'workdepartment', 'work_department', 'dept', 'departmentname',
      '部门', '所在部门', '所属部门', '任职部门', '工作部门', '部门名称'
    ],
    industry: [
      'industry', 'sector', '所属行业', '行业', '从事行业', '工作行业'
    ],
    workNature: [
      'worknature', 'work_nature', '工作性质', '任职性质', '工作形式', '用工形式',
      '雇佣形式', '全职/实习/兼职', '在职状态'
    ],
    jobType: [
      'jobtype', 'job_type', 'worktype',
      '职位类型', '全职兼职', '用工类型', '工作类型', '雇佣类型', '任职类型'
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
      'workdescription', 'work_description', '工作描述', '工作内容', '工作职责描述', '职责描述',
      '岗位职责', '工作职责', '主要职责', '职责说明', '主要工作内容', '具体工作内容',
      '工作经历描述', '工作任务', '工作事项', '主要工作', '工作说明', '工作简述',
      'roledescription', 'jobdescription', 'responsibilities', 'duties',
      '职位描述', '工作职责与业绩'
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
      'projectexperience', 'project_experience', '项目经历', '项目描述', '项目介绍', '项目说明',
      '项目内容', '项目详情', '项目背景', '项目简介', '项目工作内容'
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
    honors: [
      'honors', 'honor', 'honour', 'awardsummary', 'ext_honor', 'ext_honors',
      '所获荣誉', '荣誉奖项', '获奖情况', '获奖经历', '主要荣誉', '荣誉奖励', '在校荣誉'
    ],
    summary: [
      'summary', 'about', 'bio', 'introduction', 'coverletter', 'cover_letter',
      'selfintro', '自我介绍', '个人简介', '自我评价', '求职信',
      '个人总结', '简介', '补充说明', 'whyjoin', 'why_join', 'whydoyouwant'
    ],
    expectedSalary: [
      'expectedsalary', 'expected_salary', 'salaryexpectation', 'salary', 'compensation',
      '期望薪资', '期望月薪', '薪资期望', '期望待遇', '薪资要求', '期望薪水', '希望薪资', '意向薪资'
    ],
    expectedAnnualSalary: [
      'expectedannualsalary', 'expected_annual_salary', '期望年薪'
    ],
    currentSalary: [
      'currentsalary', 'current_salary', '目前薪资', '当前薪资', '现薪资', '目前月薪', '当前月薪', '现月薪'
    ],
    expectedCity: [
      'expectedcity', 'expected_city', 'preferredcity', 'preferred_location', 'preferredlocation',
      'intentioncity', '期望城市', '意向城市', '期望工作地', '意向工作城市', '目标城市',
      '期望工作城市', '期望工作地点', '意向工作地点', '意向工作地', '期望工作地区', '工作地点偏好',
      '意向工作地区', 'preferredworklocation'
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
      'expectedstartdate', 'expected_start_date', '预计入职时间', '期望入职时间', '预计到岗', '期望到岗时间',
      '预计报到时间', '报到时间', '预计报到'
    ],
    jobTarget: [
      'jobtarget', 'job_target', 'desiredposition', 'desired_position', 'targetrole',
      'jobobjective', 'job_objective', 'positionapplied', 'appliedposition', 'applyposition',
      '求职意向', '目标职位', '目标岗位', '期望职位', '意向岗位', '应聘职位', '应聘岗位',
      '投递志愿', '志愿岗位', '志愿',
      '申请职位', '意向职位', '应征职位', '应聘岗位名称', '意向工作', '期望岗位', '申请岗位'
    ],
    hasRelativeAtCompany: [
      'hasrelativeatcompany', '是否有亲属在本公司', '是否有亲属在公司', '公司亲属'
    ],
    acceptAdjustment: [
      'acceptadjustment', 'accept_adjustment', '是否接受调剂', '接受调剂',
      '是否服从调剂', '服从调剂', '是否服从分配', '服从分配', '是否接受岗位调剂',
      '是否服从城市分配', '服从城市分配', '能否服从城市分配', '城市选择能否服从分配', '能否服从分配'
    ],
    availability: [
      'availability', 'availabledate', '到岗', '可到岗', '到岗时间', '可到岗时间', '入职时间安排'
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
      'languages', 'language', 'languageskills', '语言能力', '外语水平', '掌握语言', '会说的语言'
    ],
    certificates: [
      'certificates', 'certifications', 'certificate', 'license', '资质证书',
      '证书', '资格证', '认证'
    ],
    certName: ['certname', 'cert_name', '证书名称', '资质证书名称'],
    certType: ['certtype', 'cert_type', '证书类型', '资质证书类型'],
    certDate: ['certdate', 'cert_date', '证书获取时间', '获证时间', '发证日期', '资质获取时间',
      '证书获得时间', '证书获得日期', '证书取得时间', '获得证书时间', '获证日期', '发证时间',
      '获得时间', '获得日期', '取得时间', '取得日期'],
    certNo: ['certno', 'cert_no', '证书编号', '资质证书编号'],
    certIssuer: ['certissuer', 'cert_issuer', '颁发机构', '发证机构'],
    certScore: ['certscore', 'cert_score', '证书成绩'],
    certExpiry: ['certexpiry', 'cert_expiry', '证书有效期', '有效期'],
    certDescription: ['certdescription', 'cert_description', '证书描述'],
    langName: ['langname', 'lang_name', '语言种类', '语种名称', '语种', '语言类型'],
    langDate: ['langdate', 'lang_date', '语言证书获得时间', '外语获得时间'],
    langCertName: ['langcertname', 'lang_cert_name', '语言证书名称'],
    langScore: ['langscore', 'lang_score', '语言成绩'],
    langLevel: [
      'langlevel', 'lang_level', '语言掌握程度', '外语掌握程度',
      '掌握程度', '熟练程度', '语言水平', '语言等级', '语言级别'
    ],
    langListenSpeak: ['langlistenspeak', '听说能力', '外语听说'],
    langReadWrite: ['langreadwrite', '读写能力', '外语读写'],
    familyName: ['familyname', 'family_name_member', '家庭成员姓名', '家人姓名'],
    familyRelation: ['familyrelation', 'family_relation', '家庭关系', '家庭成员关系', '与本人关系'],
    familyGender: ['familygender', 'family_gender', '家庭成员性别'],
    familyEducation: ['familyeducation', 'family_education', '家庭成员教育程度', '家人学历'],
    familyEthnicity: ['familyethnicity', 'family_ethnicity', '家庭成员民族'],
    familyIdNumber: ['familyidnumber', 'family_id_number', '家庭成员身份证号', '家人身份证'],
    familyBirthday: ['familybirthday', 'family_birthday', '家庭成员出生日期'],
    familyPhone: ['familyphone', 'family_phone', '家庭成员联系电话', '家人电话', '家庭成员电话',
      '家庭成员手机', '家人手机', '家人联系电话'],
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
    awardRank: ['awardrank', 'award_rank', '获奖名次', '比赛名次', '名次', '奖项名次'],
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
    paperDate: ['paperdate', 'paper_date', '发表时间', '论文发表时间', '发表日期', '论文发表日期'],
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
    'secondaryEmail', 'email', 'wechat', 'qq', 'phoneCountryCode', 'phone',
    'englishScore', 'englishDate',
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
    'gradYear', 'gpaRank', 'gpa', 'eduStart', 'eduEnd', 'degreeAwardDate', 'dualDegree',
    'isUpgradeFromCollege', 'majorCategory', 'schoolCity', 'schoolType', 'eduStatus', 'eduYears',
    'studyMode', 'eduMode', 'enrollmentType', 'isTongzhao',
    'failedCourses', 'classRank', 'majorRank', 'majorClassSize',
    'eduCertNo', 'degreeCertNo', 'studentId', 'advisorName', 'labName',
    'isNationalKeyLab', 'isJointTraining', 'counselorName', 'counselorContact', 'isOverseasSchool',
    'eduDescription', 'majorDescription', 'majorCourses', 'researchDirection', 'thesisTitle',
    'degreeType', 'degreeCategory',
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
    'workCity', 'workDepartment', 'industry', 'workNature', 'employmentType', 'jobType',
    'monthlySalary', 'annualSalary', 'workEnd', 'endDate',
    'company', 'title', 'years', 'startDate',
    'noticePeriod', 'earliestStart', 'availability', 'workAuth', 'referralSource',
    'certName', 'certType', 'certDate', 'certNo', 'certIssuer', 'certScore', 'certExpiry', 'certDescription',
    'langName', 'langDate', 'langCertName', 'langScore', 'langLevel', 'langListenSpeak', 'langReadWrite',
    'languages', 'certificates',
    'techSkills', 'softwareSkills', 'softSkills', 'skills',
    'familyIdNumber', 'familyName', 'familyRelation', 'familyGender', 'familyEducation', 'familyEthnicity',
    'familyBirthday', 'familyPhone', 'familyEmployer', 'familyTitle', 'familyPoliticalStatus', 'familyAddress',
    'honors',
    'awardName', 'awardRank', 'awardIssuer', 'awardDate', 'awardEnd', 'awardLevel', 'awardType', 'awardGrade', 'awardDescription',
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
    'managerphone', 'managercontact', 'reportingmanager',
    // v1.5.11：不该自动填的表单（附件/视频/授权声明/验证码/推荐码）
    '自我介绍视频', '视频', '上传附件', '附件简历', '附件', '上传简历', '作品集',
    'legallyauthorized', 'authorizedtowork', 'workauthorization', 'righttowork',
    '验证码', 'captcha', '推荐码'
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

  // v1.5.23：关键词匹配是每个字段 × 1400+ 关键词的热路径。
  // 短词边界正则 / normalize 结果 / hints 的 token 切分都只算一次（之前每次调用都 new RegExp）。
  var SHORT_RE_CACHE = {};
  var NORM_CACHE = {};
  var NORM_CACHE_SIZE = 0;

  function normalizeCached(kw) {
    var k = String(kw);
    var v = NORM_CACHE[k];
    if (v === undefined) {
      if (NORM_CACHE_SIZE > 4000) { NORM_CACHE = {}; NORM_CACHE_SIZE = 0; }
      v = normalize(k);
      NORM_CACHE[k] = v;
      NORM_CACHE_SIZE += 1;
    }
    return v;
  }

  function shortKeywordRe(keyword) {
    var kw = String(keyword).toLowerCase().replace(/[\s_\-]+/g, '');
    var hit = SHORT_RE_CACHE[kw];
    if (!hit) {
      hit = { kw: kw, re: new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(kw) + '(?:[^a-z0-9]|$)', 'i') };
      SHORT_RE_CACHE[kw] = hit;
    }
    return hit;
  }

  var lastTokenSrc = null;
  var lastTokens = null;
  function hintTokens(rawLower) {
    if (rawLower !== lastTokenSrc) {
      lastTokenSrc = rawLower;
      lastTokens = rawLower.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean).map(function (t) {
        return { raw: t, norm: normalize(t) };
      });
    }
    return lastTokens;
  }

  /** camelCase 拆词：userEmail → user email（之前在已小写的串上拆，永远拆不开） */
  function splitCamel(raw) {
    return String(raw || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  }

  function keywordOccurs(rawLower, normalizedHints, keyword) {
    var nk = normalizeCached(keyword);
    if (!nk) return false;
    if (isShortAsciiKeyword(nk)) {
      var sk = shortKeywordRe(keyword);
      if (sk.re.test(rawLower)) return true;
      var tokens = hintTokens(rawLower);
      for (var t = 0; t < tokens.length; t++) {
        if (tokens[t].raw === sk.kw || tokens[t].norm === nk) return true;
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

  var EMBEDDED_AC = null;
  function mapAutocompleteFromHints(rawLower) {
    if (!EMBEDDED_AC) {
      EMBEDDED_AC = Object.keys(AUTOCOMPLETE_MAP).filter(function (k) {
        return k.indexOf('-') !== -1;
      }).sort(function (a, b) { return b.length - a.length; }).map(function (token) {
        return { token: token, re: new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(token) + '(?:[^a-z0-9]|$)', 'i') };
      });
    }
    // 快速排除：内嵌 autocomplete token 一定带连字符
    if (rawLower.indexOf('-') === -1) return null;
    for (var i = 0; i < EMBEDDED_AC.length; i++) {
      if (EMBEDDED_AC[i].re.test(rawLower)) return AUTOCOMPLETE_MAP[EMBEDDED_AC[i].token];
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
    // v1.5.23：父母/配偶/亲属/推荐人/（非紧急）联系人 —— 都是别人，不能写申请人的姓名电话
    if (THIRD_PARTY_RE.test(h)) return true;
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

  /** 第三方人物（不是申请人本人）的称谓 */
  var THIRD_PARTY_RE = /父亲|母亲|父母|配偶|爱人|丈夫|妻子|子女|兄弟|姐妹|亲属姓名|亲属电话|推荐人|内推人|介绍人|联系人(?!邮箱)|担保人|监护人|father|mother|spouse|guardian|referrer/;

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

  /**
   * 模糊评分：includes / token overlap / Levenshtein，返回 0–1
   */
  var CJK_RE = /[\u4e00-\u9fff]/;

  /** 字符级预筛：关键词里至少 60% 的字符出现在 hints 里，才值得算编辑距离（剪掉 99% 的关键词） */
  function charOverlapEnough(nk, charSet) {
    if (!charSet) return true;
    var need = Math.ceil(nk.length * 0.6);
    var hit = 0;
    for (var i = 0; i < nk.length; i++) {
      if (charSet[nk.charAt(i)]) {
        hit += 1;
        if (hit >= need) return true;
      }
    }
    return false;
  }

  function scoreKeywordAgainstHints(rawLower, normalizedHints, keyword, charSet) {
    var nk = normalizeCached(keyword);
    if (!nk) return 0;
    if (keywordOccurs(rawLower, normalizedHints, keyword)) return 1;

    // 短 ASCII / 词界关键词：禁止模糊子串（避免 org⊂forgot / forgitlab）
    if (isShortAsciiKeyword(nk)) return 0;

    var score = 0;
    if (!normalizedHints || nk.length < 4) return 0;
    if (!charOverlapEnough(nk, charSet)) return 0;

    // v1.5.23：中文关键词换一个字往往就是另一个字段（入职↔入党、邮寄↔邮件、入学↔入职），
    // 4 字中文关键词差 1 字 = 0.75，必须拦下；中文模糊至少 0.8（5 字以上才允许差 1 字）
    var cjk = CJK_RE.test(nk);
    var minScore = cjk ? 0.8 : FUZZY_THRESHOLD;

    var tokens = hintTokens(rawLower);
    var hi, tn, incl, sim, pos, slice, s2;
    for (hi = 0; hi < tokens.length; hi++) {
      tn = tokens[hi].norm;
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
        // 首尾字都不同的窗口不可能达到阈值，跳过编辑距离
        if (slice.charAt(0) !== nk.charAt(0) && slice.charAt(nk.length - 1) !== nk.charAt(nk.length - 1)) continue;
        s2 = similarity(slice, nk);
        if (s2 >= FUZZY_THRESHOLD) score = Math.max(score, s2);
      }
      // 也允许 hints 明显包含较长关键词
      if (normalizedHints.indexOf(nk) !== -1) score = Math.max(score, 1);
    }
    return score >= minScore ? score : 0;
  }


  /**
   * v1.5.2：区块上下文规则。
   * 同一个「城市」在教育区块里是学校所在城市，在工作区块里是工作城市 ——
   * 仅靠标签无法区分，必须带上最近区块标题（教育经历 / 工作经历 / 项目经历）。
   */
  var CONTEXT_RULES = {
    edu: [
      { re: /院系|系别|所在系|department|faculty/i, key: 'department' },
      { re: /城市|所在地|地点|city|location/i, key: 'schoolCity' },
      // 「毕业院校」是学校名，不是毕业时间 → 学校规则排在入学/毕业之前
      { re: /学校|院校|校名|university|college|school/i, key: 'school' },
      { re: /入学|开始|起始|就读起|start/i, key: 'eduStart' },
      { re: /毕业|结束|截止|graduat|\bend\b/i, key: 'eduEnd' },
      { re: /班级排名|班排名/, key: 'classRank' },
      // 绩点排名必须排在泛「绩点」/泛「排名」之前，否则 绩点排名 会被判成 gpa 或 majorRank
      { re: /绩点排名|gpa排名|学分绩排名|gpa\s*rank/i, key: 'gpaRank' },
      { re: /专业排名|年级排名|综合排名|成绩排名|排名|rank/i, key: 'majorRank' },
      { re: /专业|major/i, key: 'major' },
      { re: /学位|学位$|degree|bachelor|master|phd/i, key: 'degree' },
      { re: /学历|educationlevel|education_level/i, key: 'eduDegree' },
      { re: /学院/, key: 'department' },
      { re: /绩点|gpa/i, key: 'gpa' }
    ],
    intern: [
      { re: /单位|公司|企业|employer|company/i, key: 'internCompany' },
      { re: /职位|岗位|职务|title|position/i, key: 'internTitle' },
      { re: /城市|地点|city|location/i, key: 'internCity' },
      { re: /(入职|开始|起始|start)/i, key: 'internStart' },
      { re: /(离职|结束|截止|end)/i, key: 'internEnd' }
    ],
    work: [
      { re: /部门|dept|department/i, key: 'workDepartment' },
      { re: /离职原因|离职理由|离开原因|leavingreason|reasonforleaving/i, key: 'leaveReason' },
      { re: /证明人职位|证明人职务|referee\s*title/i, key: 'refereeTitle' },
      { re: /证明人联系方式|证明人电话|referee\s*contact/i, key: 'refereeContact' },
      { re: /证明人(姓名|名字)?$|referee/i, key: 'refereeName' },
      { re: /单位|公司|企业|雇主|employer|company|organi[sz]ation/i, key: 'company' },
      { re: /职位|岗位|职务|头衔|title|position/i, key: 'title' },
      { re: /城市|地点|city|location/i, key: 'workCity' },
      { re: /(入职|开始|起始|start)/i, key: 'startDate' },
      { re: /(离职|结束|截止|end)/i, key: 'workEnd' }
    ],
    project: [
      { re: /名称|项目名|project\s*name/i, key: 'projectName' },
      { re: /角色|担任|role/i, key: 'projectRole' },
      { re: /(开始|起始|start)/i, key: 'projectStart' },
      { re: /(结束|截止|end)/i, key: 'projectEnd' },
      { re: /技术|栈|tech/i, key: 'techSkills' },
      { re: /(描述|职责|内容|desc)/i, key: 'projectDesc' }
    ],
    campus: [
      { re: /组织|社团|机构|organi[sz]ation/i, key: 'campusOrg' },
      { re: /角色|职务|担任|role/i, key: 'campusRole' },
      { re: /(开始|起始|start)/i, key: 'campusStart' },
      { re: /(结束|截止|end)/i, key: 'campusEnd' }
    ]
  };

  /** 命中区块规则时返回 key（不信但可用：confidence 0.95） */
  function contextKeyFor(rawLower, normalizedHints, context) {
    var rules = CONTEXT_RULES[context];
    if (!rules || (!rawLower && !normalizedHints)) return null;
    // 联系方式 / 户籍类不受区块影响，先让位（避免“户口所在城市”被判成 schoolCity）
    if (/邮箱|email|手机|电话|phone|wechat|微信|身份证|idcard/i.test(rawLower)) return null;
    // 是非题（“是否有亲属在本公司任职”）里的“公司”不是 company 字段，交给正常匹配
    if (/是否|有无|有没有|曾否|能否|有没有过/.test(rawLower)) return null;
    if (/户籍|户口|生源|籍贯|现居|现住|居住|家庭住址|邮编|邮政编码/.test(rawLower)) return null;
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].re.test(rawLower) || rules[i].re.test(normalizedHints)) return rules[i].key;
    }
    return null;
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
    // 「是否服从城市分配」含「城市」字样，但不能落到 city
    if (key === 'city' && /服从|调剂|分配/.test(rawLower)) return false;
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
   * v1.5.23：实体 + 属性组合识别。
   * 「父亲姓名 / 母亲工作单位 / 紧急联系人与本人关系 / 家庭成员手机号」——
   * 关键词表逐条穷举不完，而且旧逻辑会把「父亲姓名」命中成申请人的 name（错填红线）。
   * 先认出「这是谁的」，再认「这是什么属性」，组合成专用键；认不出属性就整体放弃。
   */
  var ENTITY_RULES = [
    {
      id: 'family',
      re: /家庭成员|家庭关系|家人|父亲|母亲|父母|配偶|爱人|丈夫|妻子|子女|兄弟|姐妹|familymember|father|mother|spouse/,
      strict: true,   // 认不出属性 → 不填（不能落回申请人的 company/title/address）
      attrs: [
        [/关系|称谓|relation/, 'familyRelation'],
        [/身份证|证件号/, 'familyIdNumber'],
        [/电话|手机|联系方式|phone|mobile|tel/, 'familyPhone'],
        [/出生|生日|birth/, 'familyBirthday'],
        [/政治面貌/, 'familyPoliticalStatus'],
        [/工作单位|单位|公司|employer|company/, 'familyEmployer'],
        [/职位|职务|岗位|职业|title|position|occupation/, 'familyTitle'],
        [/学历|文化程度|教育程度|education/, 'familyEducation'],
        [/民族/, 'familyEthnicity'],
        [/性别|gender/, 'familyGender'],
        [/地址|住址|address/, 'familyAddress'],
        [/姓名|名字|称呼|name/, 'familyName']
      ]
    },
    {
      id: 'emergency',
      re: /紧急联系人|紧急联络人|应急联系人|紧急联系|emergencycontact|^(其他|备用)?联系人/,
      strict: false,
      attrs: [
        [/关系|称谓|relation/, 'emergencyContactRelation'],
        [/电话|手机|号码|联系方式|phone|mobile|tel/, 'emergencyContactPhone'],
        [/姓名|名字|称呼|name/, 'emergencyContactName']
      ]
    },
    {
      id: 'internReferee',
      re: /实习证明人/,
      strict: false,
      attrs: [
        [/职位|职务|title/, 'internRefereeTitle'],
        [/电话|手机|联系方式|phone|contact/, 'internRefereeContact'],
        [/姓名|名字|name/, 'internRefereeName']
      ]
    },
    {
      id: 'projectReferee',
      re: /项目证明人/,
      strict: false,
      attrs: [
        [/职位|职务|title/, 'projectRefereeTitle'],
        [/电话|手机|联系方式|phone|contact/, 'projectRefereeContact'],
        [/姓名|名字|name/, 'projectRefereeName']
      ]
    },
    {
      id: 'referee',
      re: /证明人|referee/,
      strict: false,
      attrs: [
        [/职位|职务|title/, 'refereeTitle'],
        [/电话|手机|联系方式|phone|contact/, 'refereeContact'],
        [/姓名|名字|name/, 'refereeName']
      ]
    },
    {
      // 推荐人 / 内推人 不是工作证明人，也不是申请人：一律不填
      id: 'referrer',
      re: /推荐人|内推人|介绍人|担保人|监护人|referrer|guardian/,
      strict: true,
      attrs: []
    }
  ];

  /** @returns {{key:string|null, strict:boolean, id:string}|null} 没有第三方实体时返回 null */
  function entityKeyFor(h) {
    if (!h) return null;
    // 「是否有亲属在本公司」「家庭住址」「家庭电话」是申请人自己的信息，不是家庭成员
    if (/是否|有无|有没有/.test(h)) return null;
    for (var i = 0; i < ENTITY_RULES.length; i++) {
      var rule = ENTITY_RULES[i];
      if (!rule.re.test(h)) continue;
      // 「家庭关系」本身就是 familyRelation；其余去掉实体词再判属性，避免「家庭成员」里的「成员」干扰
      var rest = h.replace(rule.re, '|');
      for (var j = 0; j < rule.attrs.length; j++) {
        if (rule.attrs[j][0].test(rest)) return { key: rule.attrs[j][1], strict: rule.strict, id: rule.id };
      }
      if (rule.id === 'family' && /家庭关系/.test(h)) return { key: 'familyRelation', strict: true, id: rule.id };
      return { key: null, strict: rule.strict, id: rule.id };
    }
    return null;
  }

  /**
   * v1.5.23：同义归一（只在原样关键词匹配失败后才用）。
   * 「入职日期」=「入职时间」，「手机号码」=「手机号」，「六级分数」=「六级成绩」——
   * 把两侧都折成同一写法再做一次精确包含，比编辑距离安全得多（不会把入职折成入党）。
   */
  var CANON_RULES = [
    [/日期|年月日|年月|年份/g, '时间'],
    [/号码/g, '号'],
    [/分数|得分/g, '成绩'],
    [/全称|名字/g, '名称'],
    [/地区|地点/g, '城市'],
    [/您的|你的|本人的|请填写|请输入|请选择/g, ''],
    [/e-?mail|电子邮件|电子邮箱|邮件地址/g, '邮箱'],
    [/移动电话|手机号|手机/g, '手机'],
    [/取得|获取|获得/g, '获得']
  ];

  function canonical(s) {
    var t = String(s || '');
    for (var i = 0; i < CANON_RULES.length; i++) t = t.replace(CANON_RULES[i][0], CANON_RULES[i][1]);
    return t;
  }

  var CANON_INDEX = null;
  function canonIndex() {
    if (CANON_INDEX) return CANON_INDEX;
    CANON_INDEX = [];
    for (var i = 0; i < FIELD_ORDER.length; i++) {
      var key = FIELD_ORDER[i];
      var kws = FIELD_KEYWORDS[key] || [];
      for (var j = 0; j < kws.length; j++) {
        var nk = normalize(kws[j]);
        // 只收中文关键词：英文 id 走词界匹配，归一对它没意义还会放大误命中
        if (!nk || !CJK_RE.test(nk)) continue;
        var ck = canonical(nk);
        if (ck.length < 2) continue;
        CANON_INDEX.push({ key: key, order: i, ck: ck, nk: nk });
      }
    }
    return CANON_INDEX;
  }

  /** 关键词命中之后的语义护栏：哪些「看起来像」其实不是 */
  function semanticGuard(key, h) {
    // 户口/户籍/籍贯/生源/出生所在城市 不是现居城市
    if ((key === 'city' || key === 'currentCity' || key === 'address') && /户口|户籍|籍贯|生源|出生地|档案/.test(h)) return false;
    // 「期望/意向」的城市不是工作城市（工作经历里的那个）
    if ((key === 'workCity' || key === 'city' || key === 'currentCity') && /期望|意向|偏好|希望|目标/.test(h)) return false;
    // 「邮寄地址」是地址，不是邮箱
    if (key === 'email' && /地址|address/.test(h) && !/邮箱|email|mail地址|邮件地址/.test(h)) return false;
    // 证书/语言/奖项的「时间」不是证书本身（证书获得日期 → certDate 而非 certificates）
    if ((key === 'certificates' || key === 'languages') && /时间|日期|编号|成绩|分数|机构|类型|名称|等级|级别/.test(h)) return false;
    return true;
  }

  // 匹配结果缓存：同一页同一标签反复查（扫描 / 填写 / 未填清单各一遍），上限防止长会话涨内存
  var MATCH_CACHE = {};
  var MATCH_CACHE_SIZE = 0;
  var MATCH_CACHE_MAX = 1500;

  function cloneScored(r) {
    return r ? { key: r.key, confidence: r.confidence, method: r.method } : null;
  }

  /**
   * 带置信度的匹配：{ key, confidence, method }
   * method: autocomplete | context | entity | keyword | canonical | fuzzy | null
   */
  function matchFieldKeyScored(hints, options) {
    var autocomplete = '';
    if (typeof options === 'string') {
      autocomplete = options;
    } else if (options && typeof options === 'object') {
      autocomplete = options.autocomplete || '';
    }
    var context = (options && typeof options === 'object' && options.context) || '';
    var cacheKey = String(hints || '') + '\u0001' + autocomplete + '\u0001' + context;
    if (Object.prototype.hasOwnProperty.call(MATCH_CACHE, cacheKey)) return cloneScored(MATCH_CACHE[cacheKey]);
    var res = matchFieldKeyScoredUncached(hints, autocomplete, context);
    if (MATCH_CACHE_SIZE >= MATCH_CACHE_MAX) { MATCH_CACHE = {}; MATCH_CACHE_SIZE = 0; }
    MATCH_CACHE[cacheKey] = res;
    MATCH_CACHE_SIZE += 1;
    return cloneScored(res);
  }

  function matchFieldKeyScoredUncached(hints, autocomplete, context) {
    var acKey = mapAutocomplete(autocomplete);
    if (acKey) return { key: acKey, confidence: 1, method: 'autocomplete' };

    var raw = String(hints || '');
    var rawLower = splitCamel(raw).toLowerCase();
    var h = normalize(raw);
    if (!h && !autocomplete) return null;

    var embedded = mapAutocompleteFromHints(rawLower);
    if (embedded) return { key: embedded, confidence: 1, method: 'autocomplete' };

    if (isSkipContext(rawLower, h)) return null;
    if (isOtherPersonContactContext(raw)) return null;

    // 第三方实体（家庭成员 / 紧急联系人 / 证明人 / 推荐人）：先认人，再认属性
    var ent = entityKeyFor(h);
    if (ent && ent.key) return { key: ent.key, confidence: 0.95, method: 'entity' };
    if (ent && ent.strict) return null;

    // 区块上下文优先（教育块的「城市」= 学校城市；工作块的「城市」= 工作城市）
    var ctxKey = contextKeyFor(rawLower, h, context);
    if (ctxKey) {
      if (isApplicantOnlyKeyBlocked(ctxKey, raw)) return null;
      return { key: ctxKey, confidence: 0.95, method: 'context' };
    }

    var bestKey = null;
    var bestLen = -1;
    var bestOrder = 9999;
    var bestScore = 0;

    var i, j, key, keywords, kw, nk, sc;
    // Pass 1: exact keyword（最长关键词优先，同长按 FIELD_ORDER）
    for (i = 0; i < FIELD_ORDER.length; i++) {
      key = FIELD_ORDER[i];
      keywords = FIELD_KEYWORDS[key] || [];
      for (j = 0; j < keywords.length; j++) {
        kw = keywords[j];
        nk = normalizeCached(kw);
        if (!nk) continue;
        if (nk.length < bestLen) continue;          // 不可能胜出，省掉匹配
        if (!keywordOccurs(rawLower, h, kw)) continue;
        if (!addressCityGuard(key, nk, rawLower, h)) continue;
        if (!semanticGuard(key, h)) continue;
        if (nk.length > bestLen || (nk.length === bestLen && i < bestOrder)) {
          bestLen = nk.length;
          bestKey = key;
          bestOrder = i;
        }
      }
    }
    if (bestKey) {
      if (isApplicantOnlyKeyBlocked(bestKey, raw)) return null;
      return { key: bestKey, confidence: 1, method: 'keyword' };
    }

    // Pass 1b: 同义归一后的精确包含（入职日期 → 入职时间、六级分数 → 六级成绩）
    if (CJK_RE.test(h)) {
      var ch = canonical(h);
      var idx = canonIndex();
      for (i = 0; i < idx.length; i++) {
        var ent2 = idx[i];
        if (ent2.ck.length < bestLen) continue;
        if (ch.indexOf(ent2.ck) === -1) continue;
        if (!semanticGuard(ent2.key, h)) continue;
        if (!addressCityGuard(ent2.key, ent2.nk, rawLower, h)) continue;
        if (ent2.ck.length > bestLen || (ent2.ck.length === bestLen && ent2.order < bestOrder)) {
          bestLen = ent2.ck.length;
          bestKey = ent2.key;
          bestOrder = ent2.order;
        }
      }
      // 归一后只剩 2 个字的命中太泛（「时间」「名称」），不算
      if (bestKey && bestLen >= 3) {
        if (isApplicantOnlyKeyBlocked(bestKey, raw)) return null;
        return { key: bestKey, confidence: 0.92, method: 'canonical' };
      }
      bestKey = null;
      bestLen = -1;
      bestOrder = 9999;
    }

    // Pass 2: fuzzy synonym / token / Levenshtein
    var charSet = {};
    for (i = 0; i < h.length; i++) charSet[h.charAt(i)] = 1;
    bestKey = null;
    bestScore = 0;
    bestOrder = 9999;
    for (i = 0; i < FIELD_ORDER.length; i++) {
      key = FIELD_ORDER[i];
      keywords = FIELD_KEYWORDS[key] || [];
      for (j = 0; j < keywords.length; j++) {
        kw = keywords[j];
        nk = normalizeCached(kw);
        if (!nk || nk.length < 2) continue;
        sc = scoreKeywordAgainstHints(rawLower, h, kw, charSet);
        if (sc < FUZZY_THRESHOLD) continue;
        if (!addressCityGuard(key, nk, rawLower, h)) continue;
        if (!semanticGuard(key, h)) continue;
        if (sc > bestScore || (sc === bestScore && i < bestOrder)) {
          bestScore = sc;
          bestKey = key;
          bestOrder = i;
        }
      }
    }
    if (bestKey && bestScore >= FUZZY_THRESHOLD) {
      if (isApplicantOnlyKeyBlocked(bestKey, raw)) return null;
      return { key: bestKey, confidence: Math.round(bestScore * 1000) / 1000, method: 'fuzzy' };
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

  /**
   * 同标签多行时：第 n 次出现取 list[n]（n 从 0）。
   * 仅映射教育/工作/项目主字段；未映射键走扁平 profileValue。
   */
  var LIST_OCCURRENCE_MAP = {
    school: ['eduList', 'school'],
    major: ['eduList', 'major'],
    eduDegree: ['eduList', 'degree'],
    degree: ['eduList', 'degree'],
    eduStart: ['eduList', 'start'],
    eduEnd: ['eduList', 'end'],
    schoolCity: ['eduList', 'city'],
    department: ['eduList', 'department'],
    gpa: ['eduList', 'gpa'],
    eduDescription: ['eduList', 'description'],
    company: ['workList', 'company'],
    title: ['workList', 'title'],
    startDate: ['workList', 'start'],
    workEnd: ['workList', 'end'],
    endDate: ['workList', 'end'],
    workCity: ['workList', 'city'],
    workDepartment: ['workList', 'department'],
    workNature: ['workList', 'nature'],
    workDescription: ['workList', 'description'],
    projectName: ['projectList', 'name'],
    projectRole: ['projectList', 'role'],
    projectStart: ['projectList', 'start'],
    projectEnd: ['projectList', 'end'],
    projectDesc: ['projectList', 'description']
  };

  function profileValueForOccurrence(profile, key, occurrence) {
    var idx = occurrence | 0;
    if (idx > 0) {
      var map = LIST_OCCURRENCE_MAP[key];
      if (map) {
        var list = profile && profile[map[0]];
        if (Array.isArray(list) && list[idx] && list[idx][map[1]]) {
          return String(list[idx][map[1]]).trim();
        }
        return '';
      }
    }
    return profileValue(profile, key);
  }


  /**
   * 排名解析：把任意写法归一成 {ordinal, total, percent, band}
   * 支持 "15/120" "15名/共120人" "第15名" "12.5%" "前20%" "top 50%" "50%".
   */
  function parseRank(input) {
    var raw = String(input == null ? '' : input).trim();
    if (!raw) return null;
    var out = { raw: raw, ordinal: 0, total: 0, percent: 0, band: '' };
    var m = raw.match(/(\d+(?:\.\d+)?)\s*(?:名)?\s*[/／]\s*(?:共)?\s*(\d+(?:\.\d+)?)\s*(?:名|人)?/);
    if (m) {
      out.ordinal = parseFloat(m[1]);
      out.total = parseFloat(m[2]);
      if (out.total > 0) out.percent = (out.ordinal / out.total) * 100;
      return out;
    }
    m = raw.match(/(?:前|top\s*|约)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (m) {
      out.percent = parseFloat(m[1]);
      if (out.percent >= 100) out.percent = 99.9;
      return out;
    }
    m = raw.match(/第\s*(\d+(?:\.\d+)?)\s*名/);
    if (m) {
      out.ordinal = parseFloat(m[1]);
      return out;
    }
    m = raw.match(/(\d+(?:\.\d+)?)\s*名/);
    if (m) {
      out.ordinal = parseFloat(m[1]);
      return out;
    }
    return out.ordinal || out.percent ? out : null;
  }

  /** 把百分比归到常见区间文案：前10% / 10%-20% / 前20% / 前50% ... */
  function rankBandTexts(percent) {
    var p = Number(percent);
    if (!isFinite(p) || p <= 0) return [];
    var bands = [10, 20, 30, 50];
    var out = [];
    bands.forEach(function (b) {
      if (p <= b) {
        out.push('前' + b + '%');
        out.push('Top ' + b + '%');
        out.push('top' + b + '%');
      }
    });
    // 命中所在的区间（10%-20% 这类），两个方向都试
    for (var i = 1; i < bands.length; i++) {
      if (p > bands[i - 1] && p <= bands[i]) {
        out.push(bands[i - 1] + '%-' + bands[i] + '%');
        out.push(bands[i - 1] + '% - ' + bands[i] + '%');
        out.push(bands[i - 1] + '~' + bands[i] + '%');
      }
    }
    out.push(p + '%');
    out.push(String(Math.round(p)) + '%');
    return out;
  }

  /**
   * 同一份排名在不同控件里的候选写法（按「先精确、后换算」排序）。
   * 用于：下拉区间 / 纯数字框 / "x/y" 文本框 / 百分比框。
   */
  function rankValueCandidates(input) {
    var r = parseRank(input);
    if (!r) return [];
    var out = [r.raw];
    if (r.ordinal && r.total) {
      out.push(r.ordinal + '/' + r.total);
      out.push(r.ordinal + '/共' + r.total);
      out.push('第' + r.ordinal + '名');
      out.push(String(r.ordinal));
    }
    if (r.percent) {
      out = out.concat(rankBandTexts(r.percent));
    }
    var seen = {};
    return out.filter(function (v) {
      var k = String(v);
      if (!k || seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  /** GPA 解析：3.0/4.5 → {value:3, scale:4.5}；3.8 → {value:3.8}；85/100 → {value:85, scale:100} */
  function parseGpa(input) {
    var raw = String(input == null ? '' : input).trim();
    if (!raw) return null;
    var m = raw.match(/(\d+(?:\.\d+)?)\s*[/／]\s*(\d+(?:\.\d+)?)/);
    if (m) return { raw: raw, value: parseFloat(m[1]), scale: parseFloat(m[2]) };
    m = raw.match(/(\d+(?:\.\d+)?)/);
    if (m) return { raw: raw, value: parseFloat(m[1]), scale: 0 };
    return null;
  }

  function gpaValueCandidates(input) {
    var g = parseGpa(input);
    if (!g) return [];
    var out = [g.raw];
    if (g.scale) {
      out.push(String(g.value));
      out.push(String(g.value) + '/' + String(g.scale));
    }
    // 满分 4.5 的 3.0 → 百分制 66.7，只在页面要百分制时才有意义，放最后
    if (g.scale && g.scale !== 100) {
      out.push(String(Math.round((g.value / g.scale) * 100)));
    }
    var seen = {};
    return out.filter(function (v) {
      var k = String(v);
      if (!k || seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  /**
   * v1.5.24：扁平值取不到就回落到列表第一条。
   * 之前 workEnd / endDate / eduDegree 等有专门分支的键会提前 return ''，
   * 只填了多段经历（workList）的档案，第一段的结束时间、学历永远取不到。
   */
  function profileValue(profile, key) {
    var v = profileValueFlat(profile, key);
    if (v || !profile) return v;
    var lm = LIST_OCCURRENCE_MAP[key];
    if (lm) {
      var arr = profile[lm[0]];
      if (Array.isArray(arr) && arr.length && arr[0] && arr[0][lm[1]]) return String(arr[0][lm[1]]).trim();
    }
    return '';
  }

  function profileValueFlat(profile, key) {
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
    // 外语成绩 / 取得时间：单独没填时回退到证书的成绩 / 时间（老档案只有 certScore/certDate）
    if (key === 'englishScore') {
      var esc = profile.englishScore && String(profile.englishScore).trim();
      if (esc) return esc;
      return (profile.certScore && String(profile.certScore).trim()) || '';
    }
    if (key === 'englishDate') {
      var edt = profile.englishDate && String(profile.englishDate).trim();
      if (edt) return edt;
      return (profile.certDate && String(profile.certDate).trim()) || '';
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
    // 工作性质：显式值 > 该段写的是实习 > 求职意向的工作类型
    if (key === 'workNature') {
      var wn = profile.workNature && String(profile.workNature).trim();
      if (wn) return wn;
      var wl = Array.isArray(profile.workList) ? profile.workList : [];
      var first = wl[0] || null;
      if (first) {
        if (first.nature && String(first.nature).trim()) return String(first.nature).trim();
        if (/实习/.test(String(first.title || '')) || /实习/.test(String(first.company || ''))) return '实习';
      }
      if (/实习/.test(String(profile.title || ''))) return '实习';
      return (profile.jobType && String(profile.jobType).trim()) || '';
    }
    // 工作描述 ↔ 业绩
    if (key === 'workDescription') {
      var wd = profile.workDescription && String(profile.workDescription).trim();
      if (wd) return wd;
      var wl0 = Array.isArray(profile.workList) ? profile.workList[0] : null;
      if (wl0 && wl0.description && String(wl0.description).trim()) return String(wl0.description).trim();
      var il0 = Array.isArray(profile.internList) ? profile.internList[0] : null;
      if (il0 && il0.description && String(il0.description).trim()) return String(il0.description).trim();
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
    var flat = v != null ? String(v).trim() : '';
    if (flat) return flat;
    // 扁平字段为空时，回落到列表首条（工作描述这类值只存在 workList[0] 里很常见）
    var lm = LIST_OCCURRENCE_MAP[key];
    if (lm) {
      var arr = profile[lm[0]];
      if (Array.isArray(arr) && arr.length && arr[0] && arr[0][lm[1]]) {
        return String(arr[0][lm[1]]).trim();
      }
    }
    return '';
  }

  // 「研究生 / graduate」既可能是硕士也可能泛指研究生阶段：只在没有更具体的词时才用来归组，
  // 否则「博士研究生」会同时落进硕士组，选项只有「硕士 / 博士」时就选成硕士（v1.5.23 前的错填）
  var WEAK_DEGREE_TOKENS = { '研究生': 1, 'graduate': 1 };

  function degreeTokenHit(lower, norm, syn) {
    var sl = syn.toLowerCase();
    if (lower === sl || norm === normalize(syn)) return true;
    if (/^[a-z.' ]+$/.test(sl)) {
      // 英文缩写（ba / ms / ma）只认整词，避免 ma ⊂ diploma
      var tokens = lower.split(/[^a-z.']+/);
      if (sl.length <= 4) return tokens.indexOf(sl) !== -1 || tokens.indexOf(sl.replace(/\./g, '')) !== -1;
      return new RegExp('(?:^|[^a-z])' + escapeRegExp(sl) + '(?:[^a-z]|$)').test(lower);
    }
    return lower.indexOf(sl) !== -1;
  }

  /** 学历值所属的同义组（只取一个组；拿不准返回 -1） */
  function degreeGroupOf(value) {
    var raw = String(value || '').trim();
    if (!raw) return -1;
    var lower = raw.toLowerCase();
    var norm = normalize(raw);
    var best = -1;
    var bestLen = 0;
    var tie = false;
    var weak = -1;
    for (var g = 0; g < DEGREE_SYNONYM_GROUPS.length; g++) {
      var group = DEGREE_SYNONYM_GROUPS[g];
      for (var i = 0; i < group.length; i++) {
        var syn = group[i];
        if (!degreeTokenHit(lower, norm, syn)) continue;
        if (WEAK_DEGREE_TOKENS[syn.toLowerCase()]) { if (weak === -1) weak = g; continue; }
        var len = syn.length;
        if (len > bestLen) { best = g; bestLen = len; tie = false; }
        else if (len === bestLen && best !== g) tie = true;
      }
    }
    if (best !== -1) return tie ? -1 : best;
    return weak;
  }

  function expandDegreeSynonyms(value) {
    var raw = String(value || '').trim();
    if (!raw) return [];
    var out = [raw];
    var g = degreeGroupOf(raw);
    if (g === -1) return out;
    var seen = {};
    seen[raw.toLowerCase()] = 1;
    var group = DEGREE_SYNONYM_GROUPS[g];
    for (var i = 0; i < group.length; i++) {
      var sl = group[i].toLowerCase();
      if (!seen[sl]) {
        seen[sl] = 1;
        out.push(group[i]);
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
    // v1.5.23：调剂 / 分配 / 出差这类是非题的常见答法（否定写法必须先判）
    // 整句匹配：「能源行业」「需要沟通」这类不是是非答案
    if (/^(不接受|不同意|不服从|不愿意|不能|不可以|不需要|拒绝)(调剂|分配|调配|安排|出差|加班|外派)?$/.test(raw)) return 'No';
    if (/^(接受|同意|服从|愿意|能|可以接受|可接受|需要)(调剂|分配|调配|安排|出差|加班|外派)?$/.test(raw)) return 'Yes';

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

  // ── v1.5.23：选项匹配改为「打分 + 歧义拒填」────────────────────────
  // 旧实现按「第一个包含就选」：接受 → 不接受调剂、可以 → 不可以、北京 → 北京大学、
  // 党员 → 中共预备党员、选项编码 "3" ⊂ "3.8" 都会命中。现在：
  //   精确 > 归一精确 > 包含（按长度占比打分）> 数值区间；否定词不一致直接拒绝；
  //   最高分并列且不是同一项 → 拿不准，不填。
  var NEG_BEFORE_RE = /(?:不|非|未|无需|没有|無|免|not\s*|no\s*|non[-\s]?|un)$/i;
  var NEG_START_RE = /^(?:不|非|未|无需|没有|無|not\b|no\b|non[-\s]?)/i;

  /**
   * 长串 a 在 idx 处包含短串 b 时，b 前面紧挨着否定词、而 b 自己不带否定 → 语义相反。
   * 「不接受调剂」⊃「接受」、「非全日制」⊃「全日制」、「unwilling」⊃「willing」。
   */
  function negatedAt(a, idx, b) {
    if (idx <= 0) return false;
    if (NEG_START_RE.test(b)) return false;
    return NEG_BEFORE_RE.test(a.slice(Math.max(0, idx - 4), idx));
  }

  /** 两段文本是否一正一反（供页面侧的同义词 / 单选组复用） */
  function hasNegationConflict(a, b) {
    var x = String(a || '').toLowerCase().replace(/\s+/g, '');
    var y = String(b || '').toLowerCase().replace(/\s+/g, '');
    if (!x || !y || x === y) return false;
    var i = x.indexOf(y);
    if (i !== -1) return negatedAt(x, i, y);
    i = y.indexOf(x);
    if (i !== -1) return negatedAt(y, i, x);
    return NEG_START_RE.test(x) !== NEG_START_RE.test(y) &&
      x.replace(NEG_START_RE, '') === y.replace(NEG_START_RE, '');
  }

  function isAsciiWordish(s) { return /^[a-z0-9.'+#\s-]+$/i.test(s); }

  /** 包含关系打分：短的一方在长的一方里，且不是被否定的那半截 */
  function containScore(longer, shorter) {
    if (!longer || !shorter || shorter.length >= longer.length) return 0;
    var idx = longer.indexOf(shorter);
    if (idx === -1) return 0;
    if (negatedAt(longer, idx, shorter)) return -1;
    // 「本科以下 / 北京以外」语义相反
    if (/^(?:以下|以外|除外|之外|及以下)/.test(longer.slice(idx + shorter.length))) return -1;
    // 英文短词只认整词（ma ⊂ diploma、us ⊂ business 不算）
    if (isAsciiWordish(shorter)) {
      var before = idx > 0 ? longer.charAt(idx - 1) : '';
      var after = longer.charAt(idx + shorter.length);
      if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) return 0;
    }
    // 单个汉字太泛（「男」⊂「男女不限」可以，「本」⊂「本地」不行）：至少占一半
    var ratio = shorter.length / longer.length;
    if (shorter.length < 2 && ratio < 0.5) return 0;
    return ratio;
  }

  /** 纯数字候选落进「3.5-4.0 / 3年以上 / 60以下」这类区间选项 */
  function numericRangeScore(text, num) {
    var t = String(text || '').replace(/\s+/g, '');
    var m = t.match(/^[^\d]*(\d+(?:\.\d+)?)[^\d.]{0,3}?[-~～至到](\d+(?:\.\d+)?)/);
    if (m) {
      var lo = parseFloat(m[1]);
      var hi = parseFloat(m[2]);
      if (lo > hi) { var tmp = lo; lo = hi; hi = tmp; }
      if (num > lo && num < hi) return 2;
      if (num === lo || num === hi) return 1;   // 落在边界：两个相邻区间都会命中，留给歧义判断
      return 0;
    }
    m = t.match(/(\d+(?:\.\d+)?)[^\d]{0,2}(及以上|以上|或以上|\+)$/) || t.match(/^(?:>=?|≥|大于|高于)(\d+(?:\.\d+)?)/);
    if (m) return num >= parseFloat(m[1]) ? (num > parseFloat(m[1]) ? 2 : 1) : 0;
    m = t.match(/(\d+(?:\.\d+)?)[^\d]{0,2}(及以下|以下|或以下)$/) || t.match(/^(?:<=?|≤|小于|低于)(\d+(?:\.\d+)?)/);
    if (m) return num <= parseFloat(m[1]) ? (num < parseFloat(m[1]) ? 2 : 1) : 0;
    return 0;
  }

  /** 选项 value 是否像内部编码（"1" / "03" / "a1b2"），这种 value 不参与包含匹配 */
  function looksLikeCode(v) {
    return /^\d{1,6}$/.test(v) || (/^[a-z0-9_-]{1,12}$/i.test(v) && /\d/.test(v));
  }

  /** 去掉行政区 / 民族这类修饰后缀：北京市 ≈ 北京，汉族 ≈ 汉 */
  function stripDecorSuffix(n) {
    return String(n || '').replace(/(特别行政区|自治区|自治州|省|市|地区|县|族)$/, '');
  }

  // 包含类命中（< 90 分）只在「唯一一个选项包含它」时才算数：
  // 计算机 → [计算机科学与技术, 计算机应用]、党员 → [中共党员, 中共预备党员] 都是猜，宁可不填
  var CONTAIN_TIER = 90;
  var CONTAIN_MIN = 45;

  function matchAgainstCandidates(options, candidates) {
    var best = null;
    var bestScore = 0;
    var bestTie = false;
    var perOption = typeof Map === 'function' ? new Map() : null;
    function consider(o, score) {
      if (score <= 0) return;
      if (perOption) {
        var prev = perOption.get(o);
        if (prev == null || score > prev) perOption.set(o, score);
      }
      if (score > bestScore + 1e-9) { best = o; bestScore = score; bestTie = false; }
      else if (Math.abs(score - bestScore) <= 1e-9 && best !== o &&
               String(best.text || '').trim() !== String(o.text || '').trim()) {
        bestTie = true;
      }
    }
    function runnerUp() {
      if (!perOption) return 0;
      var second = 0;
      perOption.forEach(function (sc, o) {
        if (o === best || String(o.text || '').trim() === String(best.text || '').trim()) return;
        if (sc > second) second = sc;
      });
      return second;
    }
    var c, i, o, ot, ov, on, raw, lower, norm, penalty, sc, sc2;
    var ranged = [];
    for (c = 0; c < candidates.length; c++) {
      raw = String(candidates[c] == null ? '' : candidates[c]).trim();
      if (!raw) continue;
      lower = raw.toLowerCase();
      norm = normalize(raw);
      // 原值优先于同义扩展：同一档里第 n 个候选稍微降一点分
      penalty = Math.min(c, 20) * 0.1;
      var longFree = lower.length > 48;   // 段落不做包含匹配（永不把段落贴进 select）
      for (i = 0; i < options.length; i++) {
        o = options[i];
        if (optionLooksEmpty(o)) continue;
        ot = String(o.text || '').toLowerCase().trim();
        ov = String(o.value || '').toLowerCase().trim();
        if ((ot && ot === lower) || (ov && ov === lower)) { consider(o, 100 - penalty); continue; }
        on = normalize(o.text || '');
        if (on && norm && on === norm) { consider(o, 95 - penalty); continue; }
        if (on && norm && stripDecorSuffix(on) && stripDecorSuffix(on) === stripDecorSuffix(norm)) {
          consider(o, 92 - penalty);
          continue;
        }
        if (longFree || !norm) continue;
        if (on) {
          // 英文对英文：保留空格做整词包含（normalize 会把 Master of Arts 粘成 masterofarts）
          var ascii = isAsciiWordish(lower) && isAsciiWordish(ot);
          var a1 = ascii ? ot.replace(/\s+/g, ' ') : on;
          var b1 = ascii ? lower.replace(/\s+/g, ' ') : norm;
          sc = containScore(a1, b1);
          sc2 = containScore(b1, a1);
          if (sc < 0 || sc2 < 0) continue;     // 否定词冲突：这项绝对不选
          if (sc > 0) consider(o, 60 + 30 * sc - penalty);
          if (sc2 > 0) consider(o, 50 + 30 * sc2 - penalty);
        }
        if (ov && !looksLikeCode(ov)) {
          var nv = normalize(ov);
          var vs = containScore(nv, norm);
          if (vs > 0) consider(o, 45 + 20 * vs - penalty);
        }
      }
      if (c === 0 && /^\d+(\.\d+)?$/.test(raw)) ranged.push(parseFloat(raw));
    }
    if (best && bestTie) return null;   // 两个不同选项同分：拿不准，不填
    if (best && bestScore < CONTAIN_TIER && runnerUp() >= CONTAIN_MIN) return null;
    if (best && bestScore >= 50) return best;
    // 数值区间兜底（GPA 3.8 → 「3.5-4.0」、工作年限 4 → 「3-5年」）；落在两个区间边界上 → 不填
    if ((!best || bestScore < 50) && ranged.length) {
      var num = ranged[0];
      var hits = [];
      var top = 0;
      for (i = 0; i < options.length; i++) {
        if (optionLooksEmpty(options[i])) continue;
        sc = numericRangeScore(options[i].text, num);
        if (!sc) continue;
        if (sc > top) { top = sc; hits = [options[i]]; }
        else if (sc === top) hits.push(options[i]);
      }
      if (hits.length === 1) return hits[0];
    }
    return bestTie ? null : (bestScore >= 50 ? best : null);
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
      // 原值也作为候选（「接受」直接对上「接受调剂」）；否定冲突由打分里的护栏挡掉
      if (raw.length <= 12 && raw.toLowerCase() !== yn.toLowerCase()) candidates.push(raw);
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

  function toHalfWidth(s) {
    return String(s || '').replace(/[！-～]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    }).replace(/\u3000/g, ' ');
  }

  /**
   * 去掉 ATS 常见标签噪声：请选择 / 请输入 / 必填星号 / 全角标点。
   */
  function stripLabelNoise(s) {
    var t = toHalfWidth(String(s || ''));
    t = t
      .replace(/[*＊✱☆]/g, '')
      .replace(/^(请选择|请输入|请填写|请选择或输入|select|please\s*select|please\s*enter)\s*/i, '')
      .replace(/\s*(请选择|请输入|请填写)\s*$/i, '')
      .replace(/[（(]\s*(必填|选填|可选|optional|required)\s*[）)]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return t;
  }

  function cleanLabelPunctuation(s) {
    var t = stripLabelNoise(s)
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    if (/^[:：\-\/\\|·•.。,，、]+$/.test(t)) return '';
    t = t.replace(/[:：]+$/g, '').trim();
    return t;
  }

  /** 下拉选项文案归一：全角→半角、去空白与占位前缀 */
  function normalizeOptionText(s) {
    var t = stripLabelNoise(s)
      .replace(/[\s\u3000]+/g, '')
      .toLowerCase();
    return t;
  }

  /**
   * 在选项列表中找最佳匹配（纯函数，便于单测）。
   * options: [{value,text}|string]；返回命中项或 null。
   */
  function findBestOption(options, value) {
    if (!options || !options.length) return null;
    var normalized = [];
    var i, o;
    for (i = 0; i < options.length; i++) {
      o = options[i];
      if (typeof o === 'string') normalized.push({ value: o, text: o });
      else normalized.push({ value: o.value != null ? o.value : '', text: o.text != null ? o.text : '' });
    }
    return matchSelectOption(normalized, value);
  }

  /** parseYesNo：normalizeToYesNo 别名，测试/适配器统一入口 */
  function parseYesNo(value) {
    return normalizeToYesNo(value);
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
      // 北森 Phoenix：容器类名就是 form-item，标签在 .form-item__title > label 里
      function (node) { return classHasToken(getElClassName(node), 'form-item'); },
      function (node) {
        var cn = getElClassName(node);
        return classIncludes(cn, 'form-item') && !classIncludes(cn, 'form-item-label') &&
          !classIncludes(cn, 'form-item-control') && !classIncludes(cn, 'form-item__');
      }
    ];

    var container = null;
    if (typeof el.closest === 'function') {
      try {
        container = el.closest('.ant-form-item') ||
          el.closest('.el-form-item') ||
          el.closest('.semi-form-field') ||
          el.closest('.formily-item') ||
          el.closest('.form-item') ||
          el.closest('[class*="form-item"]:not([class*="form-item__"])');
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

  /** 日期能力层（浏览器里是全局；Node 单测里按相对路径加载） */
  function dateCapability() {
    var g = typeof globalThis !== 'undefined' ? globalThis : null;
    if (g && g.ResumeAutofillDate) return g.ResumeAutofillDate;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try { return require('./date-capability.js'); } catch (_) { return null; }
    }
    return null;
  }

  /** 可拆分的日期类 profile 键 */
  var DATE_PART_KEYS = {
    birthday: 1,
    startDate: 1,
    eduStart: 1,
    eduEnd: 1,
    gradYear: 1,
    earliestStart: 1,
    availability: 1,
    // v1.5.23：实习 / 项目 / 工作结束 / 证书 / 获奖 等日期也会被拆成年、月两栏
    workEnd: 1, endDate: 1, internStart: 1, internEnd: 1, projectStart: 1, projectEnd: 1,
    campusStart: 1, campusEnd: 1, socialStart: 1, socialEnd: 1, trainingStart: 1, trainingEnd: 1,
    awardDate: 1, certDate: 1, englishDate: 1, langDate: 1, degreeAwardDate: 1, expectedStartDate: 1,
    partyJoinDate: 1, leagueOrPartyJoinDate: 1, gaokaoDate: 1, paperDate: 1
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
    // v1.5.23：先交给日期能力层（英文月份 / 09/2020 / 202009 / 全角数字都认），认不出再走老规则
    var cap = dateCapability();
    if (cap && cap.parseModel) {
      var mo = cap.parseModel(raw);
      if (mo && mo.y) {
        year = mo.y;
        month = mo.m || '';
        day = mo.d || '';
      }
    }
    // 2020年6月12日 / 2020年6月
    m = year ? null : raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/);
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

    // 「出生年月 / 入学年月 / 毕业年月」是年月字段（YYYY-MM），必须早于“年”规则
    if (/年月/.test(h) && h.indexOf('年月日') === -1) return 'ym';

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
    // “出生日期 / 出生时间”是完整日期字段，不能当“日”拆分；只有单独的“出生日/日”才是 day
    var birthDayOnly = h.indexOf('出生日') !== -1 &&
      h.indexOf('出生日期') === -1 && h.indexOf('出生时间') === -1 && h.indexOf('出生年月日') === -1;
    // 必须带分隔符：birth_day / start-day；裸 “birthday” 是完整日期字段，不是 day 分栏
    if (/(?:^|[^a-z])(birth|start|end|edu)[_\-]day(?:[^a-z]|$)/i.test(rawLower) || birthDayOnly) {
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
    if (role === 'ym') {
      var ymParts = extractDatePart(value, 'year') || '';
      var ymMonth = extractDatePart(value, 'month') || '';
      if (!ymParts || !ymMonth) {
        var mv = String(value == null ? '' : value).match(/^\s*(\d{4})\D{1,3}(\d{1,2})\s*$/);
        if (mv) { ymParts = mv[1]; ymMonth = mv[2]; }
      }
      if (!ymParts || !ymMonth) return '';
      var mm2 = parseInt(ymMonth, 10);
      return ymParts + '-' + (mm2 < 10 ? '0' : '') + mm2;
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
    degreeGroupOf: degreeGroupOf,
    hasNegationConflict: hasNegationConflict,
    visibleLabelText: visibleLabelText,
    resolveAriaLabelledByText: resolveAriaLabelledByText,
    labelTextFromFormItem: labelTextFromFormItem,
    labelTextFromParentPrevSibling: labelTextFromParentPrevSibling,
    cleanLabelPunctuation: cleanLabelPunctuation,
    stripLabelNoise: stripLabelNoise,
    toHalfWidth: toHalfWidth,
    normalizeOptionText: normalizeOptionText,
    findBestOption: findBestOption,
    parseYesNo: parseYesNo,
    LIST_OCCURRENCE_MAP: LIST_OCCURRENCE_MAP,
    profileValueForOccurrence: profileValueForOccurrence,
    parseRank: parseRank,
    rankBandTexts: rankBandTexts,
    rankValueCandidates: rankValueCandidates,
    parseGpa: parseGpa,
    gpaValueCandidates: gpaValueCandidates,
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

