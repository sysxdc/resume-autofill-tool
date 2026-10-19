/**
 * 零依赖 Node 测试：匹配关键词、姓名拆分、profileValue、select 模糊匹配。
 * 运行：node tests/run-tests.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const Match = require(path.join(root, 'shared/match.js'));
const Profile = require(path.join(root, 'shared/profile.js'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓', name);
  } catch (err) {
    failed += 1;
    console.error('  ✗', name);
    console.error('   ', err.message);
  }
}

console.log('shared/match.js');

test('normalize strips spaces underscores hyphens', () => {
  assert.equal(Match.normalize('First_Name'), 'firstname');
  assert.equal(Match.normalize('e-mail'), 'email');
  assert.equal(Match.normalize('工作 年限'), '工作年限');
});

test('matchFieldKey: English email / phone / linkedin', () => {
  assert.equal(Match.matchFieldKey('user_email'), 'email');
  assert.equal(Match.matchFieldKey('mobile_phone'), 'phone');
  assert.equal(Match.matchFieldKey('linkedin_url'), 'linkedin');
});

test('matchFieldKey: Chinese Boss/智联-ish labels', () => {
  assert.equal(Match.matchFieldKey('真实姓名'), 'name');
  assert.equal(Match.matchFieldKey('手机号'), 'phone');
  assert.equal(Match.matchFieldKey('毕业院校'), 'school');
  assert.equal(Match.matchFieldKey('期望薪资'), 'expectedSalary');
  assert.equal(Match.matchFieldKey('工作许可'), 'workAuth');
  assert.equal(Match.matchFieldKey('详细地址'), 'address');
});

test('matchFieldKey: firstName before name', () => {
  assert.equal(Match.matchFieldKey('first_name'), 'firstName');
  assert.equal(Match.matchFieldKey('last_name'), 'lastName');
  assert.equal(Match.matchFieldKey('full_name'), 'name');
});

test('matchFieldKey: Greenhouse/Lever-like', () => {
  assert.equal(Match.matchFieldKey('job_title'), 'title');
  assert.equal(Match.matchFieldKey('years_of_experience'), 'years');
  assert.equal(Match.matchFieldKey('cover_letter'), 'summary');
  assert.equal(Match.matchFieldKey('github_url'), 'github');
  assert.equal(Match.matchFieldKey('portfolio'), 'website');
  assert.equal(Match.matchFieldKey('graduation_year'), 'gradYear');
});

test('matchFieldKey: unknown returns null', () => {
  assert.equal(Match.matchFieldKey('xyzzy_unknown_widget'), null);
});

test('splitName Chinese simple', () => {
  assert.deepEqual(Match.splitName('张三'), { first: '三', last: '张' });
});

test('splitName Chinese compound surname', () => {
  assert.deepEqual(Match.splitName('欧阳娜娜'), { first: '娜娜', last: '欧阳' });
});

test('splitName English', () => {
  assert.deepEqual(Match.splitName('Ada Lovelace'), { first: 'Ada', last: 'Lovelace' });
  assert.deepEqual(Match.splitName('Jean Luc Picard'), {
    first: 'Jean Luc',
    last: 'Picard'
  });
});

test('splitName empty', () => {
  assert.deepEqual(Match.splitName(''), { first: '', last: '' });
  assert.deepEqual(Match.splitName(null), { first: '', last: '' });
});

test('profileValue uses explicit first/last over split', () => {
  const p = { name: '张三', firstName: 'San', lastName: 'Zhang' };
  assert.equal(Match.profileValue(p, 'firstName'), 'San');
  assert.equal(Match.profileValue(p, 'lastName'), 'Zhang');
  assert.equal(Match.profileValue(p, 'name'), '张三');
});

test('profileValue falls back to split when no explicit', () => {
  const p = { name: '李四' };
  assert.equal(Match.profileValue(p, 'firstName'), '四');
  assert.equal(Match.profileValue(p, 'lastName'), '李');
});

test('profileValue address uses address not city', () => {
  const p = { city: '上海', address: '浦东新区世纪大道 1 号' };
  assert.equal(Match.profileValue(p, 'address'), '浦东新区世纪大道 1 号');
  assert.equal(Match.profileValue(p, 'city'), '上海');
});

test('profileValue returns empty for missing', () => {
  assert.equal(Match.profileValue({}, 'email'), '');
  assert.equal(Match.profileValue(null, 'email'), '');
});

test('matchSelectOption exact value and text', () => {
  const opts = [
    { value: '', text: '请选择' },
    { value: 'bachelor', text: '本科 / Bachelor' },
    { value: 'master', text: '硕士 / Master' }
  ];
  assert.equal(Match.matchSelectOption(opts, 'bachelor').value, 'bachelor');
  assert.equal(Match.matchSelectOption(opts, '硕士 / Master').value, 'master');
});

test('matchSelectOption fuzzy includes', () => {
  const opts = [
    { value: '', text: 'Select' },
    { value: '本科', text: '本科 / Bachelor' },
    { value: '硕士', text: '硕士 / Master' }
  ];
  assert.equal(Match.matchSelectOption(opts, '本科').value, '本科');
  assert.equal(Match.matchSelectOption(opts, 'Bachelor').value, '本科');
});

test('matchSelectOption normalized fuzzy', () => {
  const opts = [
    { value: 'full_time', text: 'Full Time' },
    { value: 'part_time', text: 'Part Time' }
  ];
  const m = Match.matchSelectOption(opts, 'fulltime');
  assert.ok(m);
  assert.equal(m.value, 'full_time');
});

test('matchSelectOption no match', () => {
  const opts = [{ value: 'a', text: 'Alpha' }];
  assert.equal(Match.matchSelectOption(opts, 'zzz'), null);
  assert.equal(Match.matchSelectOption([], 'a'), null);
});

test('MAX_FILLS_PER_KEY is 1 or 2', () => {
  assert.ok(Match.MAX_FILLS_PER_KEY >= 1 && Match.MAX_FILLS_PER_KEY <= 2);
});

console.log('shared/profile.js');

test('PROFILE_FIELDS includes expanded keys', () => {
  const need = [
    'name', 'firstName', 'lastName', 'email', 'phone', 'city', 'address',
    'province', 'zip', 'country', 'linkedin', 'github', 'website',
    'school', 'degree', 'major', 'gradYear', 'company', 'title', 'years',
    'startDate', 'skills', 'summary', 'expectedSalary', 'availability', 'workAuth'
  ];
  need.forEach((k) => assert.ok(Profile.PROFILE_FIELDS.includes(k), 'missing ' + k));
});

test('emptyProfile has all keys empty', () => {
  const p = Profile.emptyProfile();
  Profile.PROFILE_FIELDS.forEach((k) => assert.equal(p[k], ''));
});

test('SAMPLE_PROFILE has Chinese demo data', () => {
  assert.ok(Profile.SAMPLE_PROFILE.name);
  assert.ok(Profile.SAMPLE_PROFILE.email.includes('@'));
  assert.ok(Profile.profileHasData(Profile.SAMPLE_PROFILE));
  assert.equal(Profile.profileHasData(Profile.emptyProfile()), false);
});

test('normalizeProfile drops unknown keys and trims', () => {
  const n = Profile.normalizeProfile({ name: '  A  ', hacker: 'nope', email: 'a@b.c' });
  assert.equal(n.name, 'A');
  assert.equal(n.email, 'a@b.c');
  assert.equal(n.hacker, undefined);
  assert.equal(n.phone, '');
});

console.log('repo integrity');

test('manifest is MV3 version 1.1.0 with icons', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.1.0');
  assert.ok(manifest.icons['16']);
  assert.ok(manifest.action.default_icon['48']);
  assert.ok(manifest.content_scripts[0].js.includes('shared/match.js'));
  assert.ok(fs.existsSync(path.join(root, 'icons/icon16.png')));
  assert.ok(fs.existsSync(path.join(root, 'icons/icon48.png')));
  assert.ok(fs.existsSync(path.join(root, 'icons/icon128.png')));
});

test('demo page exists with key form fields', () => {
  const html = fs.readFileSync(path.join(root, 'demo/job-application.html'), 'utf8');
  assert.ok(html.includes('full_name'));
  assert.ok(html.includes('street_address'));
  assert.ok(html.includes('years_of_experience'));
  assert.ok(html.includes('work_authorization'));
  assert.ok(html.includes('type="password"'));
  assert.ok(html.includes('type="file"'));
});

// Lightweight fill simulation without Chrome / jsdom
test('simulate fill: cap per key and address vs city', () => {
  const profile = Profile.SAMPLE_PROFILE;
  const fakeFields = [
    { hints: 'full_name', keyExpect: 'name' },
    { hints: 'first_name', keyExpect: 'firstName' },
    { hints: 'last_name', keyExpect: 'lastName' },
    { hints: 'street_address', keyExpect: 'address' },
    { hints: 'city', keyExpect: 'city' },
    { hints: 'email', keyExpect: 'email' },
    { hints: 'email_confirm', keyExpect: 'email' },
    { hints: 'email_work', keyExpect: 'email' }, // third email should be capped
    { hints: 'job_title', keyExpect: 'title' }
  ];
  const keyCounts = {};
  const filled = [];
  for (const f of fakeFields) {
    const key = Match.matchFieldKey(f.hints);
    assert.equal(key, f.keyExpect);
    const count = keyCounts[key] || 0;
    if (count >= Match.MAX_FILLS_PER_KEY) continue;
    const value = Match.profileValue(profile, key);
    if (!value) continue;
    keyCounts[key] = count + 1;
    filled.push({ key, value });
  }
  const emailFills = filled.filter((x) => x.key === 'email');
  assert.equal(emailFills.length, Match.MAX_FILLS_PER_KEY);
  const addr = filled.find((x) => x.key === 'address');
  assert.ok(addr);
  assert.equal(addr.value, profile.address);
  assert.notEqual(addr.value, profile.city);
});

console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
