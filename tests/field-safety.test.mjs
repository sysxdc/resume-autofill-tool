import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require = createRequire(import.meta.url);
const Audit = require('../shared/audit.js');
const Match = require('../shared/match.js');
const check = (key, expected, actual) => Audit.compareEntry({key, expected, actual});

test('GPA 拒绝残缺分母和超范围分数，不推算百分制成绩', () => {
  for (const value of ['3.0/4..5', '3/0', '5/4.5', 'GPA 3.0x', '-3/4.5']) assert.equal(Match.parseGpa(value), null);
  const candidates = Match.gpaValueCandidates('3.0/4.5');
  assert.ok(candidates.includes('3') && !candidates.includes('67'));
});

test('标点、大小写、前导零具有字段语义，不能通用剥离', () => {
  for (const [key, expected, actual] of [
    ['email', 'first.last@example.test', 'firstlast@example.test'],
    ['email', 'First@example.test', 'first@example.test'],
    ['github', 'https://example.test/a-b', 'https://example.test/ab'],
    ['website', 'https://example.test/Case', 'https://example.test/case'],
    ['gpa', '3.0', '30'], ['gpa', '3.0/4.5', '30/45'],
    ['gpa', '3.0/4.5', '3.0/4.0'], ['gpa', '3.0/4.5', '3.0'],
    ['idNumber', '001234', '1234'], ['zip', '001234', '1234'],
    ['school', '测试理工大学', '测试理工'],
    ['school', '测试理工大学', '测试理工大学（独立学院）'],
    ['company', '甲乙科技', '乙科技'],
    ['studyMode', '全日制', '非全日制'],
    ['enrollmentType', '统招', '非统招'],
    ['idType', '身份证', '香港居民身份证'],
    ['projectName', '2024-01.方案', '2024-01方案'],
  ]) assert.equal(check(key, expected, actual).status, 'mismatch', key + ': ' + actual);
});

test('有字段依据的格式等价仍可验证', () => {
  for (const [key, expected, actual] of [
    ['phone', '13800138000', '+86 138 0013 8000'],
    ['email', 'a@EXAMPLE.test', 'a@example.test'],
    ['idNumber', '00123x', '00123X'],
    ['gpa', '3.0', '3.00'], ['gpa', '3.0/4.5', '3/4.50'],
    ['expectedSalary', '15000', '¥15,000.00'],
    ['englishLevel', 'CET-4', '四级'], ['gradYear', '2027', '2027届'],
    ['major', '自动化', '自动化(自动化类)(普通本科)'],
    ['eduDegree', '本科', '本科（学士）'],
  ]) assert.equal(check(key, expected, actual).accepted, true, key + ': ' + actual);
  assert.equal(check('phone', '13800138000', '+1 13800138000').accepted, false);
});

test('精度不足和空值不会使整轮核验通过，等价标签可以通过', () => {
  const partial = Audit.auditEntries([
    {key:'eduStart', expected:'2023-09', actual:'2023-09-01'},
    {key:'eduEnd', expected:'2024-06-30', actual:'2024-06'},
    {key:'nativePlace', expected:'广东省阳江市', actual:'阳江市'},
  ]);
  assert.equal(partial.needsReview, 3);
  assert.equal(partial.verified, 0);
  assert.equal(partial.okAll, false);
  assert.equal(partial.wrongFill, 0);
  assert.equal(Audit.auditEntries([{key:'phone', expected:'13800138000', actual:''}]).okAll, false);
  assert.equal(Audit.auditEntries([{key:'englishLevel', expected:'CET-4', actual:'四级'}]).okAll, true);
});
