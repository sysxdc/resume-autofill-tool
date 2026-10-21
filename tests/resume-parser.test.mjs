/**
 * v1.4.0 简历解析 + 多档案 schema 单测（Node，无需浏览器）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const Parser = require(path.join(root, 'shared/resume-parser.js'));
const Profile = require(path.join(root, 'shared/profile.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (err) {
    failed += 1;
    console.log('  ✗ ' + name + '\n    ' + (err && err.message));
  }
}

const text = fs.readFileSync(path.join(root, 'tests/fixtures/resume-zh.txt'), 'utf8');
const parsed = Parser.parseResumeText(text);
const p = parsed.profile;

console.log('简历解析（中文 TXT 夹具）');

test('基础字段：姓名/性别/生日/城市/电话/邮箱', () => {
  assert.equal(p.name, '张三');
  assert.equal(p.gender, '男');
  assert.equal(p.birthday, '1998-05-20');
  assert.equal(p.city, '杭州');
  assert.equal(p.phone, '13812345678');
  assert.equal(p.email, 'zhangsan@example.com');
});

test('链接与求职意向', () => {
  assert.equal(p.github, 'https://github.com/zhangsan');
  assert.equal(p.jobTarget, '高级前端工程师');
  assert.equal(p.expectedCity, '杭州');
  assert.equal(p.expectedSalary, '35-45K');
});

test('教育：2 段，最新/最高学历在前，字段齐全', () => {
  assert.equal(p.eduList.length, 2);
  assert.deepEqual(
    p.eduList.map((e) => [e.school, e.major, e.degree, e.start, e.end]),
    [
      ['浙江大学', '软件工程', '硕士', '2020-09', '2023-06'],
      ['浙江大学', '计算机科学与技术', '本科', '2016-09', '2020-06']
    ]
  );
});

test('工作：2 段，公司取全称、职位含“高级前端”', () => {
  assert.equal(p.workList.length, 2);
  assert.equal(p.workList[0].company, '字节跳动科技有限公司');
  assert.equal(p.workList[0].title, '高级前端工程师');
  assert.equal(p.workList[0].start, '2023-07');
  assert.equal(p.workList[0].end, '至今');
  assert.equal(p.workList[0].city, '杭州');
  assert.equal(p.workList[1].company, '阿里巴巴(中国)有限公司');
});

test('项目：2 段，技术栈单独抽出', () => {
  assert.equal(p.projectList.length, 2);
  assert.equal(p.projectList[0].name, '简历自动填写浏览器扩展');
  assert.match(p.projectList[0].tech, /Chrome Extension/);
  assert.equal(p.projectList[0].role, '负责人');
});

test('主条目由数组第一条派生（兼容旧扁平匹配）', () => {
  assert.equal(p.school, '浙江大学');
  assert.equal(p.major, '软件工程');
  assert.equal(p.eduDegree, '硕士');
  assert.equal(p.company, '字节跳动科技有限公司');
  assert.equal(p.title, '高级前端工程师');
  assert.equal(p.lastCompany, '字节跳动科技有限公司');
});

test('最高学历取最高（硕士），年限按最早起算', () => {
  assert.equal(p.highestDegree, '硕士');
  assert.equal(p.years, String(new Date().getFullYear() - 2021));
});

test('技能与自我评价', () => {
  assert.match(p.techSkills, /TypeScript/);
  assert.match(p.summary, /前端开发经验/);
});

test('置信度与 warnings 结构', () => {
  assert.equal(parsed.confidence, 100);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.stats, { chars: parsed.stats.chars, edu: 2, work: 2, project: 2 });
});

console.log('\n分段与日期解析');

test('标题识别：一、教育背景 / 【工作经历】', () => {
  assert.equal(Parser.headingKey('一、教育背景'), 'education');
  assert.equal(Parser.headingKey('【工作经历】'), 'work');
  assert.equal(Parser.headingKey('专业技能'), 'skills');
  assert.equal(Parser.headingKey('负责教育背景相关的产品设计'), null);
});

test('日期区间：多分隔符 + 至今', () => {
  assert.deepEqual(Parser.parseRange('2019.09-2023.06'), { start: '2019-09', end: '2023-06', raw: '2019.09-2023.06' });
  assert.deepEqual(Parser.parseRange('2019/09 - 2023/06'), { start: '2019-09', end: '2023-06', raw: '2019/09 - 2023/06' });
  assert.equal(Parser.parseRange('2019年9月—至今').start, '2019-09');
  assert.equal(Parser.parseRange('2019年9月—至今').end, '至今');
  assert.equal(Parser.parseRange('本周完成三件事'), null);
});

test('空简历：字段全空且给出 warnings', () => {
  const empty = Parser.parseResumeText('');
  assert.equal(empty.profile.name, '');
  assert.equal(empty.profile.eduList.length, 0);
  assert.ok(empty.warnings.length >= 3);
});

console.log('\n多档案 schema');

test('normalizeList 丢弃空记录、补齐字段', () => {
  const list = Profile.normalizeList('eduList', [{ school: 'A' }, {}, { school: '' }]);
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), Profile.LIST_ITEM_FIELDS.eduList.slice().sort());
});

test('deriveMainEntries 不覆盖已有显式值', () => {
  const prof = Profile.emptyProfile();
  prof.company = '显式公司';
  prof.workList = [{ company: '数组公司', title: '工程师' }];
  Profile.deriveMainEntries(prof);
  assert.equal(prof.company, '显式公司');
  assert.equal(prof.title, '工程师');
  Profile.deriveMainEntries(prof, true);
  assert.equal(prof.company, '数组公司');
});

console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
