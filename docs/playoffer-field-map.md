# Playoffer 字段映射（CN → key）

> 简历填写工具 **v1.3.0**。扁平 `chrome.storage.local` profile；多段经历仅存**主条目**。  
> 示例资料为虚构「张三」，敏感字段（证件号、家庭身份证等）默认留空。  
> 匹配逻辑见 `shared/match.js`（`FIELD_KEYWORDS` + `FIELD_ORDER`）。

共 **255** 个键。

## 个人信息

| 中文标签（参考） | 键 |
|---|---|
| 简历名称 | `resumeTitle` |
| 真实姓名 | `name` |
| 名 | `firstName` |
| 姓 | `lastName` |
| 姓名拼音 | `namePinyin` |
| 英文名 | `englishName` |
| 常用名 | `preferredName` |
| 性别 | `gender` |
| 出生日期 | `birthday` |
| 年龄 | `age` |
| 国籍 | `nationality` |
| 民族 | `ethnicity` |
| 政治面貌 | `politicalStatus` |
| 婚姻状况 | `maritalStatus` |
| 证件类型 | `idType` |
| 身份证号 | `idNumber` |
| 邮箱 | `email` |
| 备用邮箱 | `secondaryEmail` |
| 手机号 | `phone` |
| 微信号 | `wechat` |
| qq号 | `qq` |
| 紧急联系人 | `emergencyContact` |
| 紧急联系人姓名 | `emergencyContactName` |
| 紧急联系人关系 | `emergencyContactRelation` |
| 紧急联系人电话 | `emergencyContactPhone` |
| 所在城市 | `city` |
| 现居城市 | `currentCity` |
| 现居住地址 | `currentAddress` |
| 详细地址 | `address` |
| 州 | `province` |
| 邮编 | `zip` |
| 国家 | `country` |
| 籍贯 | `nativePlace` |
| 生源地 | `studentOrigin` |
| 户口性质 | `hukouType` |
| 户籍 | `hukou` |
| 档案所在地 | `archiveLocation` |
| 接受调动 | `willingToRelocate` |
| 领英 | `linkedin` |
| github | `github` |
| 个人网站 | `website` |
| 身高 | `height` |
| 体重 | `weight` |
| 血型 | `bloodType` |
| 健康状况 | `healthStatus` |
| 是否有慢性病 | `hasChronicIllness` |
| 有无犯罪记录 | `hasCriminalRecord` |
| 是否服兵役 | `hasMilitaryService` |
| 是否退伍军人 | `isVeteran` |
| 入党时间 | `partyJoinDate` |
| 入团入党时间 | `leagueOrPartyJoinDate` |
| 是否保研 | `isRecommendedPostgrad` |
| 是否有留学经历 | `hasStudyAbroad` |
| 是否贫困生 | `isPovertyStudent` |
| 是否色弱 | `isColorWeak` |
| 是否具有境外身份 | `hasOverseasIdentity` |
| 英语等级 | `englishLevel` |
| 高考时间 | `gaokaoDate` |
| 高考分数 | `gaokaoScore` |
| 高考科目 | `gaokaoSubjects` |
| 专业技术职级 | `professionalTitle` |
| 最高学历 | `highestDegree` |
| 是否应届生 | `isFreshGraduate` |
| 工作状态 | `workStatus` |
| 工作年限 | `years` |
| 上一家公司 | `lastCompany` |
| 自我介绍 | `summary` |
| 个人优势 | `personalStrengths` |
| 兴趣爱好 | `hobbies` |
| 职业规划 | `careerPlan` |
| 其他信息 | `additionalInfo` |

## 求职意向

| 中文标签（参考） | 键 |
|---|---|
| 求职意向 | `jobTarget` |
| 期望行业 | `expectedIndustry` |
| 目前行业 | `currentIndustry` |
| 预计入职时间 | `expectedStartDate` |
| 期望城市 | `expectedCity` |
| 面试城市 | `interviewCity` |
| 期望薪资 | `expectedSalary` |
| 期望年薪 | `expectedAnnualSalary` |
| 目前薪资 | `currentSalary` |
| 是否有亲属在本公司 | `hasRelativeAtCompany` |
| 招聘渠道 | `referralSource` |
| 是否接受调剂 | `acceptAdjustment` |
| 到岗 | `availability` |
| 通知期 | `noticePeriod` |
| 最早到岗 | `earliestStart` |
| 工作许可 | `workAuth` |

## 教育背景

| 中文标签（参考） | 键 |
|---|---|
| 毕业院校 | `school` |
| 学历 | `eduDegree` |
| 学位 | `degree` |
| 是否专升本 | `isUpgradeFromCollege` |
| 所在部门 | `department` |
| 所学专业 | `major` |
| 专业类别 | `majorCategory` |
| 学校城市 | `schoolCity` |
| 院校类型 | `schoolType` |
| 学历状态 | `eduStatus` |
| 学制 | `eduYears` |
| 学习形式 | `studyMode` |
| 教育方式 | `eduMode` |
| 入学时间 | `eduStart` |
| 毕业日期 | `eduEnd` |
| 毕业年份 | `gradYear` |
| 学位授予时间 | `degreeAwardDate` |
| 学位类型 | `degreeType` |
| 学位类别 | `degreeCategory` |
| 招生类别 | `enrollmentType` |
| 是否统招 | `isTongzhao` |
| 平均绩点 | `gpa` |
| 挂科数 | `failedCourses` |
| 班级排名 | `classRank` |
| 专业排名 | `majorRank` |
| 专业人数 | `majorClassSize` |
| 学历证书编号 | `eduCertNo` |
| 学位证书编号 | `degreeCertNo` |
| 学号 | `studentId` |
| 导师姓名 | `advisorName` |
| 实验室名称 | `labName` |
| 是否国家重点实验室 | `isNationalKeyLab` |
| 是否联合培养 | `isJointTraining` |
| 辅导员姓名 | `counselorName` |
| 辅导员联系方式 | `counselorContact` |
| 是否海外院校 | `isOverseasSchool` |
| 教育经历描述 | `eduDescription` |
| 专业描述 | `majorDescription` |
| 主修课程 | `majorCourses` |
| 研究方向 | `researchDirection` |
| 毕业论文 | `thesisTitle` |
| 辅修 | `dualDegree` |

## 实习经历

| 中文标签（参考） | 键 |
|---|---|
| 实习公司 | `internCompany` |
| 实习公司规模 | `internCompanySize` |
| 实习是否海外 | `internOverseas` |
| 实习部门 | `internDepartment` |
| 实习职位 | `internTitle` |
| 实习开始 | `internStart` |
| 实习结束 | `internEnd` |
| 实习城市 | `internCity` |
| 实习行业 | `internIndustry` |
| 实习用工性质 | `internEmploymentType` |
| 实习年薪 | `internAnnualSalary` |
| 实习证明人姓名 | `internRefereeName` |
| 实习证明人联系方式 | `internRefereeContact` |
| 实习证明人职位 | `internRefereeTitle` |
| 实习描述 | `internDescription` |
| 实习离职原因 | `internLeaveReason` |

## 工作经历

| 中文标签（参考） | 键 |
|---|---|
| 工作单位 | `company` |
| 公司规模 | `companySize` |
| 是否海外工作 | `workOverseas` |
| 职位名称 | `title` |
| 入职时间 | `startDate` |
| 工作结束 | `workEnd` |
| 结束日期 | `endDate` |
| 工作城市 | `workCity` |
| 所属行业 | `industry` |
| 工作性质 | `jobType` |
| 用工性质 | `employmentType` |
| 月薪 | `monthlySalary` |
| 年薪 | `annualSalary` |
| 证明人姓名 | `refereeName` |
| 证明人联系方式 | `refereeContact` |
| 证明人职位 | `refereeTitle` |
| 工作业绩 | `achievements` |
| 工作描述 | `workDescription` |
| 离职原因 | `leaveReason` |

## 项目经历

| 中文标签（参考） | 键 |
|---|---|
| 项目名称 | `projectName` |
| 项目人数 | `projectTeamSize` |
| 项目是否海外 | `projectOverseas` |
| 项目角色 | `projectRole` |
| 项目实践形式 | `projectPracticeMode` |
| 项目开始 | `projectStart` |
| 项目结束 | `projectEnd` |
| 项目城市 | `projectCity` |
| 项目链接 | `projectLink` |
| 项目证明人姓名 | `projectRefereeName` |
| 项目证明人联系方式 | `projectRefereeContact` |
| 项目证明人职位 | `projectRefereeTitle` |
| 项目经历 | `projectDesc` |
| 项目职责 | `projectResponsibilities` |
| 项目成果 | `projectOutcome` |

## 校园经历

| 中文标签（参考） | 键 |
|---|---|
| 组织名称 | `campusOrg` |
| 组织级别 | `campusLevel` |
| 校园职位 | `campusRole` |
| 校园经历开始 | `campusStart` |
| 校园经历结束 | `campusEnd` |
| 校园工作内容 | `campusWorkContent` |
| 本人职责 | `campusDuty` |

## 社会实践

| 中文标签（参考） | 键 |
|---|---|
| 实践单位 | `socialOrg` |
| 实践岗位 | `socialRole` |
| 实践开始 | `socialStart` |
| 实践结束 | `socialEnd` |
| 实践内容 | `socialContent` |

## 技能专长

| 中文标签（参考） | 键 |
|---|---|
| 技术技能 | `techSkills` |
| 专业技能 | `skills` |
| 语言能力 | `languages` |
| 软件技能 | `softwareSkills` |
| 软技能 | `softSkills` |
| 资质证书 | `certificates` |

## 证书

| 中文标签（参考） | 键 |
|---|---|
| 证书名称 | `certName` |
| 证书类型 | `certType` |
| 证书获取时间 | `certDate` |
| 证书编号 | `certNo` |
| 颁发机构 | `certIssuer` |
| 证书成绩 | `certScore` |
| 证书有效期 | `certExpiry` |
| 证书描述 | `certDescription` |

## 外语能力

| 中文标签（参考） | 键 |
|---|---|
| 语言种类 | `langName` |
| 语言证书获得时间 | `langDate` |
| 语言证书名称 | `langCertName` |
| 语言成绩 | `langScore` |
| 语言掌握程度 | `langLevel` |
| 听说能力 | `langListenSpeak` |
| 读写能力 | `langReadWrite` |

## 家庭情况

| 中文标签（参考） | 键 |
|---|---|
| 家庭成员姓名 | `familyName` |
| 家庭关系 | `familyRelation` |
| 家庭成员性别 | `familyGender` |
| 家庭成员教育程度 | `familyEducation` |
| 家庭成员民族 | `familyEthnicity` |
| 家庭成员身份证号 | `familyIdNumber` |
| 家庭成员出生日期 | `familyBirthday` |
| 家庭成员联系电话 | `familyPhone` |
| 家庭成员工作单位 | `familyEmployer` |
| 家庭成员职位 | `familyTitle` |
| 家庭成员政治面貌 | `familyPoliticalStatus` |
| 家庭成员联系地址 | `familyAddress` |

## 获奖

| 中文标签（参考） | 键 |
|---|---|
| 奖项名称 | `awardName` |
| 颁奖机构 | `awardIssuer` |
| 获奖时间 | `awardDate` |
| 奖项结束时间 | `awardEnd` |
| 奖项级别 | `awardLevel` |
| 奖励类型 | `awardType` |
| 奖励等级 | `awardGrade` |
| 获奖描述 | `awardDescription` |

## 专利

| 中文标签（参考） | 键 |
|---|---|
| 专利名称 | `patentName` |
| 专利号 | `patentNo` |
| 专利申请日期 | `patentApplyDate` |
| 专利状态 | `patentStatus` |
| 专利发明人 | `patentInventor` |
| 专利描述 | `patentDescription` |

## 论文

| 中文标签（参考） | 键 |
|---|---|
| 论文标题 | `paperTitle` |
| 发表期刊 | `paperJournal` |
| 论文作者 | `paperAuthors` |
| 期刊卷期 | `paperVolume` |
| 影响因子 | `paperImpactFactor` |
| 刊物等级 | `paperJournalLevel` |
| 作者顺序 | `paperAuthorOrder` |
| 发表时间 | `paperDate` |
| paperDoi | `paperDoi` |
| 论文链接 | `paperLink` |
| 论文摘要 | `paperAbstract` |

## 培训

| 中文标签（参考） | 键 |
|---|---|
| 培训名称 | `trainingName` |
| 培训开始 | `trainingStart` |
| 培训结束 | `trainingEnd` |
| 培训机构 | `trainingOrg` |
| 培训收获 | `trainingGain` |
| 培训内容 | `trainingContent` |

## 别名与回退（profileValue）

| 场景 | 行为 |
|---|---|
| `currentAddress` ↔ `address` | 互为回退 |
| `techSkills` ↔ `skills` | 互为回退 |
| `nationality` ← `country` | 国籍空时回退国家 |
| `studyMode` ↔ `eduMode` | 互为回退 |
| `employmentType` ↔ `jobType` | 互为回退 |
| `workEnd` ↔ `endDate` | 互为回退 |
| `emergencyContact` | 可由姓名+电话拼接 |
| `highestDegree` / `eduDegree` | 可回退到彼此或 `degree` |

## 安全说明

- `idNumber`、`familyIdNumber`、健康/犯罪相关字段在选项页标为**选填**。
- 「直接上司」联系方式 denylist，不填申请人微信/电话。
- 「证明人」映射到 `referee*`，不会填申请人 `name`/`phone`。
- 空白模板行在「只填空」策略下仍可能被填入主条目示例；提交前请核对并删除多余段。
