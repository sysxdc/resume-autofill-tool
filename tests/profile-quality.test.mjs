import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require = createRequire(import.meta.url);
const P = require('../shared/profile.js');
const M = require('../shared/match.js');

test('字段映射的目标都能保存，语言证书与熟练程度分开', () => {
  for (const map of Object.values(P.MAIN_ENTRY_MAP)) for (const key of Object.values(map)) assert.ok(P.PROFILE_FIELDS.includes(key), key);
  const p = P.normalizeProfile({workDepartment:'测试部门', langList:[{name:'英语',level:'良好',certName:'CET-4'}]});
  assert.equal(p.workDepartment,'测试部门');
  assert.equal(p.langList[0].certName,'CET-4');
  assert.equal(M.profileValue(p,'langLevel'),'良好');
  assert.equal(M.profileValue(p,'langCertName'),'CET-4');
  assert.equal(P.profileHasData({eduList:[{school:'测试大学'}]}),true);
  assert.equal(P.profileHasData({eduList:[{school:''}]}),false);
});

test('整理修复错误类型、补足 GPA 精度，不覆盖真实冲突且不修改输入', () => {
  const source = {degree:'本科',eduDegree:'本科',gpa:'3.0/4.5',school:'另一个学校',eduList:[{school:'测试大学',degree:'本科',academicDegree:'工学学士',gpa:'3.0'}],customRetained:'保留扩展数据'};
  const copy = structuredClone(source);
  const result = P.repairProfile(source);
  assert.deepEqual(source,copy);
  assert.equal(result.profile.degree,'工学学士');
  assert.equal(result.profile.eduList[0].gpa,'3.0/4.5');
  assert.equal(result.profile.school,'另一个学校');
  assert.equal(result.profile.customRetained,'保留扩展数据');
  assert.ok(result.report.issues.some(x=>x.path==='school'));
  assert.equal(M.profileValue(result.profile,'school'),'测试大学');
  assert.equal(M.profileValue({degree:'本科'},'degree'),'');
  assert.equal(M.profileValue({eduList:[{degree:'本科'}]},'degree'),'');
});

test('仅去除完整重复；不同时间、内容和未知信息都保留', () => {
  const p = {projectList:[{name:'同名',start:'2024-01'}, {start:'2024-01',name:'同名'}, {name:'同名',start:'2024-02'}, {name:'同名',start:'2024-01',extra:'不同信息'}]};
  const result = P.repairProfile(p);
  assert.equal(result.profile.projectList.length,3);
  assert.equal(result.changes.filter(x=>x.code==='duplicate_record').length,1);
  assert.equal(P.repairProfile(result.profile).changes.length,0);
});

test('明确标记实习才迁移，保留全部子字段，冲突记录不合并', () => {
  const intern = {company:'测试公司',nature:'实习',start:'2024-01',end:'2024-02',title:'实习开发',description:'工作内容',extra:'原始附加信息'};
  const source = {company:'测试公司',title:'实习开发',workDescription:'工作内容',workList:[intern,{company:'正式公司',nature:'全职'}]};
  const p = P.repairProfile(source).profile;
  assert.equal(p.workList.length,1);
  assert.equal(p.internList[0].extra,'原始附加信息');
  assert.equal(p.company,'正式公司');
  assert.equal(p.internTitle,'实习开发');
  assert.equal(p.workDescription,'');
  assert.equal(P.repairProfile({workList:[{company:'推断不得',title:'实习生'}]}).profile.workList.length,1);
  assert.equal(P.repairProfile({workList:[intern],internList:[{...intern,title:'另一职位'}]}).profile.workList.length,1);
  const refined=P.repairProfile({company:'测试公司',title:'实习生',internCompany:'测试公司',internTitle:'技术支持实习生',workList:[{company:'测试公司',nature:'实习',title:'实习生'}]}).profile;
  assert.equal(refined.internList[0].title,'技术支持实习生');
  assert.equal(M.profileValue(refined,'title'),'');
  assert.equal(M.profileValue(refined,'workNature'),'');
});

test('英语成绩不借用其他证书成绩，工作内容不借用实习或业绩', () => {
  assert.equal(M.profileValue({certName:'软件设计师',certScore:'80',certDate:'2024-01'},'englishScore'),'');
  assert.equal(M.profileValue({certName:'软件设计师',certScore:'80',certDate:'2024-01'},'englishDate'),'');
  assert.equal(M.profileValue({certName:'CET-4',certScore:'510'},'englishScore'),'510');
  assert.equal(M.profileValue({langList:[{name:'英语',score:'510',date:'2024-01'}]},'englishScore'),'510');
  assert.equal(M.profileValue({internList:[{description:'实习内容'}],achievements:'业绩'},'workDescription'),'');
  assert.equal(M.profileValue({jobType:'全职'},'workNature'),'');
});
