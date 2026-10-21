/**
 * 零依赖 Node 测试：匹配、模糊同义、denylist、AI merge、profile。
 * 运行：node tests/run-tests.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const Match = require(path.join(root, 'shared/match.js'));
const Profile = require(path.join(root, 'shared/profile.js'));
const AI = require(path.join(root, 'shared/ai.js'));

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

test('autocomplete address-level2 → city not address', () => {
  assert.equal(
    Match.matchFieldKey('city', { autocomplete: 'address-level2' }),
    'city'
  );
  assert.equal(
    Match.matchFieldKey('#city city', { autocomplete: 'address-level2' }),
    'city'
  );
  assert.equal(Match.matchFieldKey('id_city address-level2'), 'city');
});

test('autocomplete street-address / postal-code / address-level1 / country', () => {
  assert.equal(
    Match.matchFieldKey('addr1', { autocomplete: 'street-address' }),
    'address'
  );
  assert.equal(
    Match.matchFieldKey('zip', { autocomplete: 'postal-code' }),
    'zip'
  );
  assert.equal(
    Match.matchFieldKey('region', { autocomplete: 'address-level1' }),
    'province'
  );
  assert.equal(
    Match.matchFieldKey('nation', { autocomplete: 'country-name' }),
    'country'
  );
  assert.equal(
    Match.matchFieldKey('x', { autocomplete: 'country' }),
    'country'
  );
});

test('hispanic_ethnicity → null (not city)', () => {
  assert.equal(Match.matchFieldKey('hispanic_ethnicity'), null);
  assert.equal(
    Match.matchFieldKey('hispanic_ethnicity Are you Hispanic/Latino?'),
    null
  );
});

test('current employer in legal / employment agreement → not company', () => {
  const legal =
    'Are you subject to any employment agreements and/or post-employment restrictions with your current employer';
  assert.equal(Match.matchFieldKey(legal), null);
  assert.equal(
    Match.matchFieldKey('Who is your current or previous employer?'),
    'company'
  );
});

test('how did you hear about → null (not summary)', () => {
  assert.equal(Match.matchFieldKey('How did you hear about this job?'), null);
  assert.equal(Match.matchFieldKey('how_did_you_hear_about_us'), null);
});

test('forgitlab / previously worked → not company', () => {
  assert.equal(
    Match.matchFieldKey('Have you previously worked at or consulted for GitLab?'),
    null
  );
  assert.equal(Match.matchFieldKey('question_forgitlab consulted for GitLab'), null);
  assert.equal(Match.matchFieldKey('forgitlab'), null);
  assert.equal(Match.matchFieldKey('organization'), 'company');
  assert.equal(Match.matchFieldKey('current_company'), 'company');
});

test('capacity question → null (not city)', () => {
  assert.equal(
    Match.matchFieldKey(
      'Are you currently or have you ever worked for Airbnb in any capacity?'
    ),
    null
  );
});

test('short keyword org requires word boundary', () => {
  assert.equal(Match.matchFieldKey('org'), 'company');
  assert.equal(Match.matchFieldKey('my_org_name'), 'company');
  assert.equal(Match.matchFieldKey('forgot'), null);
});

test('explicit city id beats bare address substring', () => {
  assert.equal(Match.matchFieldKey('city'), 'city');
  assert.equal(Match.matchFieldKey('candidate-location Location (City)'), 'city');
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

test('degree select 本科 matches profile.degree', () => {
  const opts = [
    { value: '', text: '请选择 / Select' },
    { value: '高中', text: '高中 / High School' },
    { value: '大专', text: '大专 / Associate' },
    { value: '本科', text: '本科 / Bachelor' },
    { value: '硕士', text: '硕士 / Master' },
    { value: '博士', text: '博士 / PhD' }
  ];
  const m = Match.matchSelectOption(opts, Profile.SAMPLE_PROFILE.degree);
  assert.ok(m);
  assert.equal(m.value, '本科');
  assert.equal(Match.matchSelectOption(opts, 'Bachelor').value, '本科');
  assert.equal(Match.matchSelectOption(opts, '硕士').value, '硕士');
  assert.equal(Match.matchSelectOption(opts, 'Master').value, '硕士');
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

test('Yes/No select rejects long free-text workAuth', () => {
  const opts = [
    { value: '', text: 'Select...' },
    { value: '1', text: 'Yes' },
    { value: '0', text: 'No' },
    { value: '2', text: 'Prefer not to say' }
  ];
  assert.equal(
    Match.matchSelectOption(opts, '中国大陆公民，可合法全职工作'),
    null
  );
  assert.equal(Match.matchSelectOption(opts, Profile.SAMPLE_PROFILE.workAuth), null);
  assert.equal(Match.matchSelectOption(opts, 'Yes').value, '1');
  assert.equal(Match.matchSelectOption(opts, 'No').value, '0');
});

test('Yes/No select rejects paragraph custom_answer', () => {
  const opts = [
    { value: '', text: 'Please select' },
    { value: 'Yes', text: 'Yes' },
    { value: 'No', text: 'No' }
  ];
  const paragraph =
    'I have strong scripting and automation experience with Python and shell, ' +
    'and I enjoy building reliable CI pipelines for large engineering orgs.';
  assert.equal(Match.matchSelectOption(opts, paragraph), null);
  assert.equal(Match.normalizeToYesNo(paragraph), null);
  assert.equal(Match.matchSelectOption(opts, '是').value, 'Yes');
  assert.equal(Match.matchSelectOption(opts, '否').value, 'No');
  assert.equal(Match.matchSelectOption(opts, 'true').value, 'Yes');
  assert.equal(Match.matchSelectOption(opts, 'false').value, 'No');
});

test('region select rejects city when options are US/Canada/Elsewhere', () => {
  const opts = [
    { value: '', text: 'Select...' },
    { value: 'us', text: 'United States' },
    { value: 'ca', text: 'Canada' },
    { value: 'elsewhere', text: 'Located Elsewhere' }
  ];
  assert.ok(Match.isRegionCountryEnumSelect(opts));
  assert.ok(Match.isBasedRegionQuestion('Where are you currently based?'));
  assert.equal(Match.matchSelectOption(opts, '上海'), null);
  assert.equal(Match.matchSelectOption(opts, 'Shanghai'), null);
  assert.equal(Match.matchSelectOption(opts, Profile.SAMPLE_PROFILE.city), null);
  assert.equal(Match.matchSelectOption(opts, 'Canada').value, 'ca');
  assert.equal(Match.matchSelectOption(opts, 'United States').value, 'us');

  const fields = [
    {
      index: 0,
      label: 'Where are you currently based?',
      name: 'region',
      tag: 'select',
      options: opts
    }
  ];
  const mapped = Match.heuristicMapFields(fields, {
    ...Profile.SAMPLE_PROFILE,
    city: '上海',
    currentCity: '上海'
  });
  assert.equal(mapped[0].action, 'skip', 'city must not fill region enum');
});

test('visa sponsorship sentence normalizes to No when options include No', () => {
  const opts = [
    { value: '', text: 'Select...' },
    { value: 'Yes', text: 'Yes' },
    { value: 'No', text: 'No' }
  ];
  const visaNo = 'No I am a citizen and do not need visa sponsorship';
  assert.equal(Match.normalizeToYesNo(visaNo), 'No');
  assert.equal(Match.matchSelectOption(opts, visaNo).value, 'No');
  assert.equal(
    Match.matchSelectOption(opts, 'No, I do not require sponsorship.').value,
    'No'
  );
  assert.equal(Match.normalizeToYesNo('Yes, I will need visa sponsorship'), 'Yes');
  assert.equal(Match.matchSelectOption(opts, 'Yes, I will need visa sponsorship').value, 'Yes');
});

test('MAX_FILLS_PER_KEY is 1 or 2', () => {
  assert.ok(Match.MAX_FILLS_PER_KEY >= 1 && Match.MAX_FILLS_PER_KEY <= 2);
});

test('visibleLabelText strips select options so degree matches', () => {
  // Minimal DOM mock: <label>学历 / Degree <select><option>...</option></select></label>
  function text(v) {
    return { nodeType: 3, nodeValue: v };
  }
  function el(tag, kids) {
    return { nodeType: 1, tagName: tag, childNodes: kids || [] };
  }
  const label = el('LABEL', [
    text('学历 / Degree '),
    el('SELECT', [
      el('OPTION', [text('高中 / High School')]),
      el('OPTION', [text('本科 / Bachelor')])
    ])
  ]);
  const visible = Match.visibleLabelText(label);
  assert.ok(!/High School/i.test(visible), 'must not include option text');
  assert.ok(/学历/.test(visible) || /Degree/i.test(visible), 'must keep label text');
  assert.equal(Match.matchFieldKey(visible), 'degree');

  const polluted = '学历 / Degree 高中 / High School 本科 / Bachelor';
  assert.equal(Match.matchFieldKey(polluted), 'school', 'polluted text wrongly matches school');
  assert.notEqual(Match.matchFieldKey(polluted), 'degree');
});

test('visibleLabelText null-safe and skips form controls', () => {
  assert.equal(Match.visibleLabelText(null), '');
  assert.equal(Match.visibleLabelText(undefined), '');
  const withInput = {
    nodeType: 1,
    tagName: 'LABEL',
    childNodes: [
      { nodeType: 3, nodeValue: '  姓名  ' },
      { nodeType: 1, tagName: 'INPUT', childNodes: [] },
      { nodeType: 3, nodeValue: ' 备注' }
    ]
  };
  assert.equal(Match.visibleLabelText(withInput), '姓名 备注');
});

console.log('shared/match.js fuzzy & synonyms v1.2');

test('synonym: 微信 → wechat', () => {
  assert.equal(Match.matchFieldKey('微信号'), 'wechat');
  assert.equal(Match.matchFieldKey('wechat_id'), 'wechat');
});

test('synonym: 期望城市 → expectedCity', () => {
  assert.equal(Match.matchFieldKey('期望城市'), 'expectedCity');
  assert.equal(Match.matchFieldKey('preferred_location'), 'expectedCity');
});

test('synonym: 到岗 / noticePeriod', () => {
  assert.equal(Match.matchFieldKey('到岗时间'), 'availability');
  assert.equal(Match.matchFieldKey('notice_period'), 'noticePeriod');
  assert.equal(Match.matchFieldKey('离职通知期'), 'noticePeriod');
});

test('synonym: 项目经历 → projectDesc', () => {
  assert.equal(Match.matchFieldKey('项目经历'), 'projectDesc');
  assert.equal(Match.matchFieldKey('project_description'), 'projectDesc');
  assert.equal(Match.matchFieldKey('项目名称'), 'projectName');
});

test('synonym: 现居城市 / 户籍 / 籍贯', () => {
  assert.equal(Match.matchFieldKey('现居城市'), 'currentCity');
  assert.equal(Match.matchFieldKey('户籍'), 'hukou');
  assert.equal(Match.matchFieldKey('籍贯'), 'nativePlace');
});

test('synonym: GPA / 语言 / 证书', () => {
  assert.equal(Match.matchFieldKey('GPA'), 'gpa');
  assert.equal(Match.matchFieldKey('语言能力'), 'languages');
  assert.equal(Match.matchFieldKey('资质证书'), 'certificates');
});

test('Chinese 性别 matches gender; English gender EEO skipped', () => {
  assert.equal(Match.matchFieldKey('性别'), 'gender');
  assert.equal(Match.matchFieldKey('Gender (EEO)'), null);
  assert.equal(Match.matchFieldKey('gender'), null);
});

test('fuzzy: levenshtein similarity helper', () => {
  assert.equal(Match.levenshtein('kitten', 'sitting'), 3);
  assert.ok(Match.similarity('expectedcity', 'expectedcity') === 1);
  assert.ok(Match.similarity('weixin', 'wechat') < 0.9);
});

test('fuzzy: scored match returns confidence', () => {
  const s = Match.matchFieldKeyScored('期望城市 Expected City');
  assert.ok(s);
  assert.equal(s.key, 'expectedCity');
  assert.ok(s.confidence >= Match.FUZZY_THRESHOLD);
});

test('fuzzy: near-miss typo still maps when close enough', () => {
  // normalized includes expectedsalary-like token with small edit distance path via includes
  assert.equal(Match.matchFieldKey('expected_salary_cny'), 'expectedSalary');
});

test('denylist still holds after fuzzy expansion', () => {
  const fps = [
    'hispanic_ethnicity Are you Hispanic/Latino?',
    'How did you hear about this job?',
    'Are you subject to any employment agreements and/or post-employment restrictions with your current employer',
    'Have you previously worked at or consulted for GitLab?',
    'Are you currently or have you ever worked for Airbnb in any capacity?',
    'race ethnicity voluntary self identify',
    'disability status'
  ];
  for (const h of fps) {
    assert.equal(Match.matchFieldKey(h), null, 'should skip: ' + h.slice(0, 40));
  }
});

test('heuristicMapFields maps and caps', () => {
  const fields = [
    { index: 0, label: '邮箱', name: 'email' },
    { index: 1, label: 'Email confirm', name: 'email2' },
    { index: 2, label: 'Work Email', name: 'email3' },
    { index: 3, label: 'How did you hear about us?', name: 'hear' }
  ];
  const mapped = Match.heuristicMapFields(fields, Profile.SAMPLE_PROFILE);
  assert.equal(mapped.length, 4);
  assert.equal(mapped[0].action, 'fill');
  assert.equal(mapped[0].profileKey, 'email');
  const emailFills = mapped.filter((m) => m.profileKey === 'email' && m.action === 'fill');
  assert.equal(emailFills.length, Match.MAX_FILLS_PER_KEY);
  assert.equal(mapped[3].action, 'skip');
});

console.log('shared/profile.js');

test('PROFILE_FIELDS includes expanded keys', () => {
  const need = [
    'name', 'firstName', 'lastName', 'englishName', 'preferredName', 'gender', 'birthday',
    'idType', 'idNumber', 'email', 'secondaryEmail', 'phone', 'wechat', 'qq', 'emergencyContact',
    'city', 'currentCity', 'address', 'province', 'zip', 'country', 'hukou', 'nativePlace',
    'willingToRelocate', 'linkedin', 'github', 'website',
    'school', 'degree', 'major', 'gradYear', 'gpa', 'eduStart', 'eduEnd', 'dualDegree',
    'company', 'title', 'years', 'startDate', 'industry', 'department', 'jobType',
    'leaveReason', 'achievements', 'projectName', 'projectRole', 'projectDesc',
    'expectedSalary', 'expectedCity', 'jobTarget', 'availability', 'noticePeriod',
    'earliestStart', 'workAuth', 'languages', 'certificates',
    'skills', 'summary', 'referralSource', 'additionalInfo',
    // v1.3.0 playoffer
    'resumeTitle', 'namePinyin', 'nationality', 'ethnicity', 'politicalStatus', 'maritalStatus',
    'currentAddress', 'highestDegree', 'isFreshGraduate', 'lastCompany',
    'emergencyContactName', 'emergencyContactPhone',
    'internCompany', 'workEnd', 'techSkills', 'certName', 'langName',
    'familyName', 'familyIdNumber', 'awardName', 'patentName', 'paperTitle', 'trainingName',
    'campusOrg', 'socialOrg', 'acceptAdjustment', 'eduDegree'
  ];
  need.forEach((k) => assert.ok(Profile.PROFILE_FIELDS.includes(k), 'missing ' + k));
  assert.ok(Profile.PROFILE_FIELDS.length >= 200, 'expected large playoffer schema, got ' + Profile.PROFILE_FIELDS.length);
});

test('emptyProfile has all keys empty', () => {
  const p = Profile.emptyProfile();
  Profile.PROFILE_FIELDS.forEach((k) => assert.equal(p[k], ''));
});

test('SAMPLE_PROFILE has Chinese demo data', () => {
  assert.ok(Profile.SAMPLE_PROFILE.name);
  assert.equal(Profile.SAMPLE_PROFILE.name, '张三');
  assert.ok(Profile.SAMPLE_PROFILE.email.includes('@'));
  assert.ok(Profile.SAMPLE_PROFILE.email.includes('example.com'));
  assert.ok(Profile.SAMPLE_PROFILE.wechat);
  assert.ok(Profile.SAMPLE_PROFILE.projectDesc);
  assert.ok(Profile.profileHasData(Profile.SAMPLE_PROFILE));
  assert.equal(Profile.profileHasData(Profile.emptyProfile()), false);
  // 敏感字段默认空；禁止真实 PII
  assert.equal(Profile.SAMPLE_PROFILE.idNumber, '');
  assert.equal(Profile.SAMPLE_PROFILE.familyIdNumber, '');
  assert.ok(!/戴远升/.test(JSON.stringify(Profile.SAMPLE_PROFILE)));
});

test('normalizeProfile drops unknown keys and trims', () => {
  const n = Profile.normalizeProfile({ name: '  A  ', hacker: 'nope', email: 'a@b.c', wechat: ' wx ' });
  assert.equal(n.name, 'A');
  assert.equal(n.email, 'a@b.c');
  assert.equal(n.wechat, 'wx');
  assert.equal(n.hacker, undefined);
  assert.equal(n.phone, '');
});

test('profileNonEmpty omits blanks', () => {
  const ne = Profile.profileNonEmpty({ name: '张三', email: '', wechat: 'abc' });
  assert.equal(ne.name, '张三');
  assert.equal(ne.wechat, 'abc');
  assert.equal(ne.email, undefined);
});

console.log('shared/ai.js');

test('normalizeAiSettings defaults', () => {
  const s = AI.normalizeAiSettings({});
  assert.equal(s.enabled, false);
  assert.equal(s.apiBaseUrl, 'https://api.openai.com/v1');
  assert.equal(s.model, 'gpt-4o-mini');
  assert.equal(s.apiKey, '');
  assert.equal(AI.aiConfigured(s), false);
});

test('aiConfigured requires enabled+key', () => {
  assert.equal(AI.aiConfigured({ enabled: true, apiKey: '', model: 'x' }), false);
  assert.equal(AI.aiConfigured({
    enabled: true,
    apiKey: 'sk-test',
    apiBaseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  }), true);
});

test('parseAiMappingJson strips fences', () => {
  const arr = AI.parseAiMappingJson('```json\n[{"index":0,"action":"skip"}]\n```');
  assert.ok(Array.isArray(arr));
  assert.equal(arr[0].index, 0);
});

test('mergeAiMappingWithProfile: fill from profile, no invent', () => {
  const fields = [
    { index: 0, label: 'Email', name: 'email' },
    { index: 1, label: 'Why do you want to join?', name: 'why' },
    { index: 2, label: 'Fake employer years', name: 'fake' }
  ];
  const aiItems = [
    { index: 0, action: 'fill', profileKey: 'email', confidence: 0.95 },
    {
      index: 1,
      action: 'custom_answer',
      value: '基于四年前端经验，希望加入贵团队持续成长。',
      confidence: 0.8
    },
    { index: 2, action: 'fill', profileKey: 'notARealKey', value: 'Acme Corp', confidence: 0.9 }
  ];
  const merged = AI.mergeAiMappingWithProfile(
    aiItems,
    fields,
    Profile.SAMPLE_PROFILE,
    Match,
    Profile
  );
  assert.equal(merged[0].action, 'fill');
  assert.equal(merged[0].suggestedValue, Profile.SAMPLE_PROFILE.email);
  assert.equal(merged[1].action, 'custom_answer');
  assert.ok(merged[1].suggestedValue.includes('前端'));
  assert.equal(merged[2].action, 'skip');
});

test('mergeAiMappingWithProfile: denylist overrides AI fill', () => {
  const fields = [
    { index: 0, label: 'How did you hear about this job?', name: 'source' }
  ];
  const aiItems = [
    { index: 0, action: 'fill', profileKey: 'referralSource', confidence: 0.99 }
  ];
  const merged = AI.mergeAiMappingWithProfile(
    aiItems,
    fields,
    Profile.SAMPLE_PROFILE,
    Match,
    Profile
  );
  assert.equal(merged[0].action, 'skip');
  assert.equal(merged[0].method, 'denylist');
});

test('mergeAiMappingWithProfile: empty profile value → skip fill', () => {
  const fields = [{ index: 0, label: '微信号', name: 'wechat' }];
  const aiItems = [{ index: 0, action: 'fill', profileKey: 'wechat', confidence: 0.9 }];
  const merged = AI.mergeAiMappingWithProfile(
    aiItems,
    fields,
    { email: 'a@b.c' },
    Match,
    Profile
  );
  assert.equal(merged[0].action, 'skip');
});

test('mergeAiMappingWithProfile: yes/no select rejects paragraph custom_answer', () => {
  const fields = [
    {
      index: 0,
      label: 'Will you now or in the future require visa sponsorship?',
      name: 'visa',
      tag: 'select',
      options: [
        { value: '', text: 'Select...' },
        { value: 'Yes', text: 'Yes' },
        { value: 'No', text: 'No' }
      ]
    },
    {
      index: 1,
      label: 'Do you have scripting experience?',
      name: 'scripting',
      tag: 'select',
      options: [
        { value: 'Yes', text: 'Yes' },
        { value: 'No', text: 'No' }
      ]
    }
  ];
  const aiItems = [
    {
      index: 0,
      action: 'custom_answer',
      value: 'No I am a citizen and do not need visa sponsorship',
      confidence: 0.9
    },
    {
      index: 1,
      action: 'custom_answer',
      value:
        'I have written extensive automation scripts in Python and Bash across multiple production systems over four years.',
      confidence: 0.85
    }
  ];
  const merged = AI.mergeAiMappingWithProfile(
    aiItems,
    fields,
    Profile.SAMPLE_PROFILE,
    Match,
    Profile
  );
  assert.equal(merged[0].action, 'fill');
  assert.equal(merged[0].suggestedValue, 'No');
  assert.equal(merged[1].action, 'skip');
});

test('mergeAiMappingWithProfile: region select rejects city fill', () => {
  const fields = [
    {
      index: 0,
      label: 'Where are you currently based?',
      name: 'based',
      tag: 'select',
      options: [
        { value: 'us', text: 'United States' },
        { value: 'ca', text: 'Canada' },
        { value: 'elsewhere', text: 'Located Elsewhere' }
      ]
    }
  ];
  const aiItems = [
    { index: 0, action: 'fill', profileKey: 'city', confidence: 0.95 }
  ];
  const merged = AI.mergeAiMappingWithProfile(
    aiItems,
    fields,
    { ...Profile.SAMPLE_PROFILE, city: '上海', currentCity: '上海' },
    Match,
    Profile
  );
  assert.equal(merged[0].action, 'skip');
  assert.equal(merged[0].suggestedValue, '');
});

test('buildSystemPrompt mentions select option matching', () => {
  const p = AI.buildSystemPrompt();
  assert.ok(p.includes('SELECT') || p.includes('select'));
  assert.ok(/Yes\/No|Yes\/No/.test(p) || p.includes('Yes/No'));
  assert.ok(p.includes('skip'));
});

console.log('repo integrity');

test('manifest is MV3 1.4+/1.5.x with icons', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(/^1\.[45]\.\d+$/.test(manifest.version), `version=${manifest.version}`);
  assert.ok(manifest.icons['16']);
  assert.ok(manifest.action.default_icon['48']);
  assert.ok(manifest.content_scripts[0].js.includes('shared/match.js'));
  assert.ok(fs.existsSync(path.join(root, 'icons/icon16.png')));
  assert.ok(fs.existsSync(path.join(root, 'shared/ai.js')));
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

test('options page has AI section and new fields', () => {
  const html = fs.readFileSync(path.join(root, 'options/options.html'), 'utf8');
  assert.ok(html.includes('AI 设置'));
  assert.ok(html.includes('name="wechat"'));
  assert.ok(html.includes('name="expectedCity"'));
  assert.ok(html.includes('name="projectDesc"'));
  assert.ok(html.includes('选填'));
  assert.ok(html.includes('name="namePinyin"'));
  assert.ok(html.includes('name="internCompany"'));
  assert.ok(html.includes('name="familyIdNumber"'));
  assert.ok(html.includes('个人信息'));
  assert.ok(html.includes('求职意向'));
  assert.ok(html.includes('details class="section"'));
});

test('popup has AI buttons', () => {
  const html = fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8');
  assert.ok(html.includes('AI 巡查'));
  assert.ok(html.includes('AI 填写'));
  assert.ok(html.includes('一键填写'));
});

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
    { hints: 'email_work', keyExpect: 'email' },
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

test('simulate Greenhouse FP fields stay unmatched', () => {
  const fps = [
    'hispanic_ethnicity Are you Hispanic/Latino?',
    'How did you hear about this job?',
    'Are you subject to any employment agreements and/or post-employment restrictions with your current employer',
    'Have you previously worked at or consulted for GitLab?',
    'Are you currently or have you ever worked for Airbnb in any capacity?'
  ];
  for (const h of fps) {
    assert.equal(Match.matchFieldKey(h), null, 'should skip: ' + h.slice(0, 40));
  }
});

console.log('v1.2.2 source guards');

test('autofill.js uses visibleLabelText; no parentLabel.textContent', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(src.includes('visibleLabelText'), 'must call visibleLabelText');
  assert.ok(!src.includes('parentLabel.textContent'), 'must not use parentLabel.textContent');
  assert.ok(src.includes('fieldLooksFilled'), 'must implement skip-if-filled');
});

console.log('v1.2.3 D3 other-person contact');

test('D3: supervisor wechat/phone labels → null', () => {
  assert.equal(Match.matchFieldKey('直接上司电话/微信/QQ'), null);
  assert.equal(Match.matchFieldKey('直属上级微信'), null);
  assert.equal(Match.matchFieldKey('直属领导手机号'), null);
  assert.equal(Match.matchFieldKey('上级领导联系电话'), null);
  assert.equal(Match.matchFieldKey('汇报对象微信'), null);
  assert.equal(Match.matchFieldKey("Supervisor's phone / WeChat"), null);
  assert.equal(Match.matchFieldKey('reporting_manager_wechat'), null);
  assert.equal(Match.isOtherPersonContactContext('直接上司电话/微信/QQ'), true);
});

test('D3: bare 微信 still wechat; 紧急联系人 → emergencyContact', () => {
  assert.equal(Match.matchFieldKey('微信号'), 'wechat');
  assert.equal(Match.matchFieldKey('微信'), 'wechat');
  assert.equal(Match.matchFieldKey('紧急联系人'), 'emergencyContact');
  assert.equal(Match.matchFieldKey('紧急联络人电话'), 'emergencyContactPhone');
  assert.equal(Match.matchFieldKey('紧急联系人姓名'), 'emergencyContactName');
  assert.equal(Match.isOtherPersonContactContext('紧急联系人微信'), false);
});

console.log('v1.2.3 D4 extractDatePart');

test('extractDatePart: ISO slash dot and Chinese', () => {
  assert.equal(Match.extractDatePart('2020-06', 'year'), '2020');
  assert.equal(Match.extractDatePart('2020-06', 'month'), '6');
  assert.equal(Match.extractDatePart('2020/6', 'year'), '2020');
  assert.equal(Match.extractDatePart('2020/6', 'month'), '6');
  assert.equal(Match.extractDatePart('2020.06', 'year'), '2020');
  assert.equal(Match.extractDatePart('2020.06', 'month'), '6');
  assert.equal(Match.extractDatePart('2020年6月', 'year'), '2020');
  assert.equal(Match.extractDatePart('2020年6月', 'month'), '6');
  assert.equal(Match.extractDatePart('2020-06-15', 'day'), '15');
  assert.equal(Match.extractDatePart('2020年6月15日', 'day'), '15');
});

test('extractDatePart: bare year / empty / invalid part', () => {
  assert.equal(Match.extractDatePart('2021', 'year'), '2021');
  assert.equal(Match.extractDatePart('2021', 'month'), '');
  assert.equal(Match.extractDatePart('', 'year'), '');
  assert.equal(Match.extractDatePart('2020-06', 'quarter'), '');
  assert.equal(Match.extractDatePart(null, 'year'), '');
});

test('detectDatePartRole: conservative year/month', () => {
  assert.equal(Match.detectDatePartRole('edu_start_year'), 'year');
  assert.equal(Match.detectDatePartRole('birth_month'), 'month');
  assert.equal(Match.detectDatePartRole('入学时间 年'), 'year');
  assert.equal(Match.detectDatePartRole('入学时间 月'), 'month');
  assert.equal(Match.detectDatePartRole('开始日期 year yyyy'), 'year');
  assert.equal(Match.detectDatePartRole('年'), null, 'bare 年 alone is dangerous');
  assert.equal(Match.detectDatePartRole('月'), null, 'bare 月 alone is dangerous');
  assert.equal(Match.detectDatePartRole('工作年限'), null);
});

test('maybeExtractDatePartValue zero-pads month when maxlength 2', () => {
  const v = Match.maybeExtractDatePartValue('2020-06', '入学时间 月 edu_start_month', {
    profileKey: 'eduStart',
    maxLength: 2,
    zeroPadMonth: true
  });
  assert.equal(v, '06');
  const y = Match.maybeExtractDatePartValue('2020年6月', '毕业年份 年 gradYear', {
    profileKey: 'gradYear'
  });
  assert.equal(y, '2020');
});

console.log('v1.2.3 D2 antd form-item labels');

test('labelTextFromFormItem: ant-form-item sibling label', () => {
  function text(v) {
    return { nodeType: 3, nodeValue: v };
  }
  function el(tag, opts, kids) {
    if (Array.isArray(opts)) {
      kids = opts;
      opts = {};
    }
    opts = opts || {};
    const node = {
      nodeType: 1,
      tagName: tag,
      className: opts.className || '',
      childNodes: kids || [],
      children: (kids || []).filter((k) => k && k.nodeType === 1),
      parentElement: null,
      parentNode: null,
      previousElementSibling: null,
      textContent: '',
      getAttribute(n) {
        return opts.attrs && opts.attrs[n] != null ? String(opts.attrs[n]) : null;
      }
    };
    function tc(n) {
      if (!n) return '';
      if (n.nodeType === 3) return n.nodeValue || '';
      return (n.childNodes || []).map(tc).join('');
    }
    node.textContent = tc(node);
    return node;
  }
  function wire(n, p) {
    if (!n || n.nodeType !== 1) return;
    n.parentElement = p;
    n.parentNode = p;
    (n.children || []).forEach((c) => wire(c, n));
  }

  const labelInner = el('LABEL', {}, [text('真实姓名'), text(' *')]);
  const labelCol = el('DIV', { className: 'ant-form-item-label' }, [labelInner]);
  const input = el('INPUT', { className: 'ant-input ant-input-lg', attrs: { name: '', id: '' } }, []);
  const control = el('DIV', { className: 'ant-form-item-control' }, [input]);
  const item = el('DIV', { className: 'ant-form-item' }, [labelCol, control]);
  wire(item, null);

  const label = Match.labelTextFromFormItem(input);
  assert.equal(label, '真实姓名');
  assert.equal(Match.matchFieldKey(label), 'name');
});

test('labelTextFromFormItem: el-form-item__label', () => {
  function text(v) {
    return { nodeType: 3, nodeValue: v };
  }
  function el(tag, opts, kids) {
    if (Array.isArray(opts)) {
      kids = opts;
      opts = {};
    }
    opts = opts || {};
    const node = {
      nodeType: 1,
      tagName: tag,
      className: opts.className || '',
      childNodes: kids || [],
      children: (kids || []).filter((k) => k && k.nodeType === 1),
      parentElement: null,
      parentNode: null,
      textContent: ''
    };
    function tc(n) {
      if (!n) return '';
      if (n.nodeType === 3) return n.nodeValue || '';
      return (n.childNodes || []).map(tc).join('');
    }
    node.textContent = tc(node);
    return node;
  }
  function wire(n, p) {
    if (!n || n.nodeType !== 1) return;
    n.parentElement = p;
    n.parentNode = p;
    (n.children || []).forEach((c) => wire(c, n));
  }
  const lab = el('LABEL', { className: 'el-form-item__label' }, [text('微信号')]);
  const input = el('INPUT', { className: 'el-input__inner' }, []);
  const content = el('DIV', { className: 'el-form-item__content' }, [input]);
  const item = el('DIV', { className: 'el-form-item' }, [lab, content]);
  wire(item, null);
  assert.equal(Match.labelTextFromFormItem(input), '微信号');
  assert.equal(Match.matchFieldKey(Match.labelTextFromFormItem(input)), 'wechat');
});

test('resolveAriaLabelledByText via mock getElementById', () => {
  const labelNode = {
    nodeType: 1,
    tagName: 'LABEL',
    childNodes: [{ nodeType: 3, nodeValue: '邮箱地址' }],
    textContent: '邮箱地址'
  };
  const input = {
    getAttribute(n) {
      return n === 'aria-labelledby' ? 'lbl-email' : null;
    }
  };
  const text = Match.resolveAriaLabelledByText(input, (id) =>
    id === 'lbl-email' ? labelNode : null
  );
  assert.equal(text, '邮箱地址');
  assert.equal(Match.matchFieldKey(text), 'email');
});

test('semanticClassTokens drops ant- noise keeps name-like', () => {
  const sem = Match.semanticClassTokens(
    'ant-input ant-input-lg css-dev-only-do-not-override-1x email-field phone_input'
  );
  assert.ok(/email/i.test(sem));
  assert.ok(/phone/i.test(sem));
  assert.ok(!/ant-input/.test(sem));
});

test('autofill.js v1.3.0 uses form-item + date part + adjacent pair helpers', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(src.includes('labelTextFromFormItem'), 'must use form-item labels');
  assert.ok(src.includes('resolveAriaLabelledByText'), 'must use aria-labelledby');
  assert.ok(src.includes('maybeExtractDatePartValue'), 'must extract date parts');
  assert.ok(src.includes('detectAdjacentDatePairRole'), 'must detect adjacent year/month pair');
  assert.ok(src.includes('findNearbyDateGroupLabelText'), 'must use nearby date group label');
  assert.ok(src.includes('fieldLooksFilled'), 'skip-if-filled intact');
  assert.ok(src.includes('visibleLabelText'), 'visibleLabelText intact');
  assert.ok(src.includes('1.3.0') || src.includes('v1.3.0'), 'version comment');
});


console.log('v1.2.4 D9 gradYear/eduEnd + month extract skip');

test('D9: 毕业时间 → eduEnd; 毕业年份/毕业年 → gradYear', () => {
  assert.equal(Match.matchFieldKey('毕业时间'), 'eduEnd');
  assert.equal(Match.matchFieldKey('毕业年份'), 'gradYear');
  assert.equal(Match.matchFieldKey('毕业年'), 'gradYear');
  assert.equal(Match.matchFieldKey('入学时间'), 'eduStart');
});

test('D9: maybeExtractDatePartValue skips bare year into month box', () => {
  assert.equal(
    Match.maybeExtractDatePartValue('2020', '毕业时间 月', { profileKey: 'gradYear' }),
    ''
  );
  const m = Match.maybeExtractDatePartValue('2020-06', '毕业时间 月', {
    profileKey: 'eduEnd'
  });
  assert.ok(m === '6' || m === '06', 'month should be 6 or 06, got ' + m);
  assert.equal(
    Match.maybeExtractDatePartValue('2020-06', '毕业时间 月', {
      profileKey: 'eduEnd',
      zeroPadMonth: true
    }),
    '06'
  );
  assert.equal(
    Match.maybeExtractDatePartValue('2020-06', '毕业时间 年', { profileKey: 'eduEnd' }),
    '2020'
  );
});

console.log('v1.2.4 D10 adjacent placeholder year/month');

test('D10: detectDatePartRole adjacentPairRole', () => {
  assert.equal(Match.detectDatePartRole('年'), null, 'bare 年 alone still dangerous');
  assert.equal(Match.detectDatePartRole('年', { adjacentPairRole: 'year' }), 'year');
  assert.equal(Match.detectDatePartRole('月', { adjacentPairRole: 'month' }), 'month');
  assert.equal(
    Match.detectDatePartRole('placeholder 月', { adjacentPairRole: 'month' }),
    'month'
  );
});

test('D10: findNearbyDateGroupLabelText with mock nodes', () => {
  function text(v) {
    return { nodeType: 3, nodeValue: v };
  }
  function el(tag, opts, kids) {
    if (Array.isArray(opts)) {
      kids = opts;
      opts = {};
    }
    opts = opts || {};
    const node = {
      nodeType: 1,
      tagName: tag,
      className: opts.className || '',
      childNodes: kids || [],
      children: (kids || []).filter((k) => k && k.nodeType === 1),
      parentElement: null,
      parentNode: null,
      previousElementSibling: null,
      textContent: '',
      getAttribute(n) {
        return opts.attrs && opts.attrs[n] != null ? String(opts.attrs[n]) : null;
      }
    };
    function tc(n) {
      if (!n) return '';
      if (n.nodeType === 3) return n.nodeValue || '';
      return (n.childNodes || []).map(tc).join('');
    }
    node.textContent = tc(node);
    return node;
  }
  function wire(n, p) {
    if (!n || n.nodeType !== 1) return;
    n.parentElement = p;
    n.parentNode = p;
    (n.children || []).forEach((c) => wire(c, n));
  }

  const labelCol = el('DIV', { className: 'ant-form-item-label' }, [
    el('LABEL', {}, [text('毕业时间')])
  ]);
  const yearIn = el('INPUT', { attrs: { placeholder: '年' } }, []);
  const monthIn = el('INPUT', { attrs: { placeholder: '月' } }, []);
  const control = el('DIV', { className: 'ant-form-item-control' }, [yearIn, monthIn]);
  const item = el('DIV', { className: 'ant-form-item' }, [labelCol, control]);
  wire(item, null);
  // sibling links for children of item
  labelCol.previousElementSibling = null;
  control.previousElementSibling = labelCol;

  const found = Match.findNearbyDateGroupLabelText(yearIn);
  assert.equal(found, '毕业时间');
  assert.equal(Match.matchFieldKey(found), 'eduEnd');
});


console.log('v1.3.0 playoffer schema');

test('v1.3.0 matchKey: critical CN labels', () => {
  assert.equal(Match.matchFieldKey('姓名拼音'), 'namePinyin');
  assert.equal(Match.matchFieldKey('政治面貌'), 'politicalStatus');
  assert.equal(Match.matchFieldKey('是否应届生'), 'isFreshGraduate');
  assert.equal(Match.matchFieldKey('实习公司'), 'internCompany');
  assert.equal(Match.matchFieldKey('上一家公司'), 'lastCompany');
  assert.equal(Match.matchFieldKey('紧急联系人姓名'), 'emergencyContactName');
  assert.equal(Match.matchFieldKey('现居住地址'), 'currentAddress');
  assert.equal(Match.matchFieldKey('最高学历'), 'highestDegree');
  assert.equal(Match.matchFieldKey('目标岗位'), 'jobTarget');
  assert.equal(Match.matchFieldKey('是否接受调剂'), 'acceptAdjustment');
  assert.equal(Match.matchFieldKey('技术技能'), 'techSkills');
  assert.equal(Match.matchFieldKey('国籍'), 'nationality');
});

test('v1.3.0 denylist: supervisor null; 证明人 not applicant name', () => {
  assert.equal(Match.matchFieldKey('直接上司电话/微信/QQ'), null);
  assert.equal(Match.matchFieldKey('证明人姓名'), 'refereeName');
  assert.notEqual(Match.matchFieldKey('证明人姓名'), 'name');
  assert.equal(Match.matchFieldKey('证明人电话'), 'refereeContact');
  assert.notEqual(Match.matchFieldKey('证明人电话'), 'phone');
});

test('v1.3.0 profileValue aliases and emergency compose', () => {
  assert.equal(Match.profileValue({ currentAddress: '浦东路1号' }, 'address'), '浦东路1号');
  assert.equal(Match.profileValue({ address: '详细地址' }, 'currentAddress'), '详细地址');
  assert.equal(Match.profileValue({ skills: 'JS,TS' }, 'techSkills'), 'JS,TS');
  assert.equal(
    Match.profileValue({ emergencyContactName: '李四', emergencyContactPhone: '13900139000' }, 'emergencyContact'),
    '李四 13900139000'
  );
});

test('v1.3.0 normalizeProfile roundtrip keeps new keys', () => {
  const raw = { name: '张三', namePinyin: 'Zhang San', internCompany: '示例', unknown: 'x' };
  const n = Profile.normalizeProfile(raw);
  assert.equal(n.name, '张三');
  assert.equal(n.namePinyin, 'Zhang San');
  assert.equal(n.internCompany, '示例');
  assert.equal(n.unknown, undefined);
  assert.equal(n.familyIdNumber, '');
});

test('v1.3.0 FIELD_ORDER: specific keys before generic', () => {
  const order = Match.FIELD_ORDER;
  assert.ok(order.indexOf('emergencyContactName') < order.indexOf('name'));
  assert.ok(order.indexOf('internCompany') < order.indexOf('company'));
  assert.ok(order.indexOf('lastCompany') < order.indexOf('company'));
  assert.ok(order.indexOf('highestDegree') < order.indexOf('degree'));
});

test('v1.3.0 docs playoffer-field-map exists', () => {
  assert.ok(fs.existsSync(path.join(root, 'docs/playoffer-field-map.md')));
  const md = fs.readFileSync(path.join(root, 'docs/playoffer-field-map.md'), 'utf8');
  assert.ok(md.includes('namePinyin'));
  assert.ok(/姓名拼音|拼音姓名/.test(md));
  assert.ok(md.includes('实习公司') || md.includes('internCompany'));
});


console.log('v1.3.1 真实站点修正：关键词 / 搜索框 / readonly 弹层 / 无名 radio');

test('v1.3.1: 应聘职位归 jobTarget，不再被 summary 抢', () => {
  assert.equal(Match.matchFieldKey('应聘职位'), 'jobTarget');
  assert.equal(Match.matchFieldKey('JOB_OBJECTIVE'), 'jobTarget');
  assert.equal(Match.matchFieldKey('应聘岗位'), 'jobTarget');
  // 自我评价仍应命中 summary
  assert.equal(Match.matchFieldKey('自我评价'), 'summary');
});

test('v1.3.1: 所获荣誉 / ext_honor 归 honors', () => {
  assert.equal(Match.matchFieldKey('所获荣誉'), 'honors');
  assert.equal(Match.matchFieldKey('ext_honor'), 'honors');
  assert.equal(Match.matchFieldKey('获奖情况'), 'honors');
});

test('v1.3.1: profile 新增 honors 字段（schema / 空档 / 样例）', () => {
  assert.ok(Profile.PROFILE_FIELDS.includes('honors'));
  assert.equal(Profile.emptyProfile().honors, '');
  assert.ok(String(Profile.SAMPLE_PROFILE.honors || '').length > 0);
  const round = Profile.normalizeProfile({ honors: '校级优秀学生干部' });
  assert.equal(round.honors, '校级优秀学生干部');
});

test('v1.3.1: autofill 源守卫（搜索框跳过 / readonly 弹层 / radio 白名单 / 不提交）', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/function isSearchBox/.test(src), 'isSearchBox 应存在');
  assert.ok(/搜索\|查找\|关键字/.test(src), '搜索框关键词应存在');
  assert.ok(/function fillReadonlyPicker/.test(src), 'fillReadonlyPicker 应存在');
  assert.ok(/RADIO_SAFE_KEYS/.test(src), 'radio 白名单应存在');
  assert.ok(/allowPickerClick/.test(src), 'picker 开关应存在');
  assert.ok(!/\.submit\s*\(/.test(src), '内容脚本不得调用 form.submit()');
  assert.ok(!/requestSubmit/.test(src), '内容脚本不得调用 requestSubmit');
});


test('v1.3.1: 出生日期是整日期，不被拆成 day', () => {
  const hints = '出生日期 出生日期 BIRTHDAY';
  assert.equal(Match.detectDatePartRole(hints), null, '出生日期不应被判为 day');
  assert.equal(Match.maybeExtractDatePartValue('1998-05-20', hints, { profileKey: 'birthday' }), '1998-05-20');
  // 真正的“出生日”单栏仍应识别
  assert.equal(Match.detectDatePartRole('出生日'), 'day');
});


console.log('v1.3.2 表格布局 / Element-UI 下拉标签');

test('v1.3.2: getLabelText 支持表格布局与 el-select 兄弟标签', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/closest\('td, th'\)/.test(src), '应支持 td/th 左列取标签');
  assert.ok(/previousElementSibling/.test(src), '应读取前一个兄弟/单元格');
  assert.ok(/dictionary-selector/.test(src), '应识别 Element-UI 下拉容器');
  assert.ok(/el-select/.test(src), '应覆盖 el-select');
});

test('v1.3.2: manifest 版本已递增', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.ok(/^1\.[45]\.\d+$/.test(manifest.version), manifest.version);
  assert.equal(manifest.content_scripts[0].all_frames, true);
});


console.log('v1.3.3 多表格日期面板');

test('v1.3.3: 日期面板分段选择 + 确认按钮', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/function parseDateParts/.test(src), '应有日期拆分');
  assert.ok(/function findDatePanel/.test(src), '应有面板探测');
  assert.ok(/function numericGroups/.test(src), '应有年/月/日分组识别');
  assert.ok(/function tryDatePanel/.test(src), '应有分段点选');
  assert.ok(/function clickPanelConfirm/.test(src), '应处理“确定”按钮');
  assert.ok(/async function tryDatePanel\(el, desired\)/.test(src), '分段点选应能读回值判断是否需要确定');
});

test('v1.3.3: 日期比较按年月日（容忍分隔符差异）', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/function dateValueMatches/.test(src));
  assert.ok(/parseInt\(a\.m, 10\) !== parseInt\(w\.m, 10\)/.test(src), '月应按数值比较');
  assert.ok(/parseInt\(a\.d, 10\) === parseInt\(w\.d, 10\)/.test(src), '日应按数值比较');
  assert.ok(/!w\.d \|\| !a\.d/.test(src), '只到年月的字段应只比年月');
});


console.log('v1.3.4 日历网格日期面板');

test('v1.3.4: 网格面板翻月 + 点日 + 面板取最外层', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/function isCalendarGrid/.test(src), '应识别日历网格');
  assert.ok(/function gridHeader/.test(src), '应解析表头年月');
  assert.ok(/function gridNavigate/.test(src), '应能翻月/翻年');
  assert.ok(/\.d-arrow-/.test(src), '应识别 Element 年份双箭头');
  assert.ok(/\.arrow-/.test(src), '应识别 Element 月份单箭头');
  assert.ok(/function gridClickDay/.test(src), '应点当月日格');
  assert.ok(/prev-month|next-month/.test(src), '应排除上/下月补位格');
  assert.ok(/b\.width < 150 \|\| b\.height < 90/.test(src), '面板探测应排除标题等碎片');
  assert.ok(/!byClass\.some\(function \(m\) \{ return m !== n && m\.contains\(n\); \}\)/.test(src), '应只取最外层容器');
});

test('v1.3.4: 表头支持 2026年10月 / 十月 2026 / 2026-10 三种写法', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/CN_MONTH/.test(src), '应有中文月份映射');
  assert.ok(/EN_MONTH/.test(src), '应有英文月份映射');
  assert.ok(/\(19\|20\)\\d\{2\}\\s\*\[-\/\.年\]/.test(src), '应支持 2026-10 / 2026.10 / 2026年10');
});


console.log('v1.3.5 六类日期组件');

test('v1.3.5: 年/月/日 三件套（原生 select 组）', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/function collectDateGroup/.test(src), '应识别日期组');
  assert.ok(/function maxOptionNumber/.test(src), '应按选项范围判断年/月/日');
  assert.ok(/function setSelectByNumber/.test(src), '应能按数字选中 select 选项');
  assert.ok(/function fillDateGroup/.test(src), '应整组填写');
  assert.ok(/yearSelect/.test(src), '应要求存在年份 select 或显式三标签，避免误判');
  assert.ok(/groupHandled/.test(src), '组内控件填完后应跳过逐个填充');
});

test('v1.3.5: 分页下拉 / 滚轮 / 英文表头', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/function findPagerNext/.test(src), '应找“下一页”');
  assert.ok(/function pageUntilFound/.test(src), '应翻页找目标项');
  assert.ok(/function looksLikeWeekHeader/.test(src), '应识别中英文星期表头');
  assert.ok(/function expandToActionableHost/.test(src), '应把列表容器上溯到带确定/箭头的容器');
  assert.ok(/function setPanelPeriod/.test(src), '应支持面板内 年/月 下拉（flatpickr 风格）');
  assert.ok(/Date\.now\(\) \+ 12000/.test(src), '日期翻页要有硬超时预算');
  assert.ok(/superUsable/.test(src), '十年箭头不能死循环，需降级判定');
});


console.log('v1.3.6 focus 展开 + 直写兜底');

test('v1.3.6: 打开弹层要 focus（Element el-date-picker 监听 focus）', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/function openPicker/.test(src), '应有统一的 openPicker');
  assert.ok(/el\.focus\(\)/.test(src), '应先 focus');
  assert.ok(/FocusEvent\('focusin'/.test(src), '应派发 focusin');
  assert.ok(/el-icon-date|\[class\*="date-icon"\]/.test(src), '应点右侧日历图标兜底');
  assert.ok(/openPicker\(el\)/.test(src), '打开/重开弹层都应走 openPicker');
});

test('v1.3.6: 只读框按 data-fmt 直写兜底', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/function formatDateByHint/.test(src), '应按 data-fmt 格式化');
  assert.ok(/data-fmt/.test(src), '应读取 data-fmt');
  assert.ok(/function forceSetReadonly/.test(src), '应有直写兜底');
  assert.ok(/getOwnPropertyDescriptor\(Object\.getPrototypeOf\(el\), 'value'\)/.test(src), '应用原生 setter 以触达框架');
  assert.ok(/resolve\(forceSetReadonly\(el, desired\) \? 'forced' : false\)/.test(src), '失败时返回 forced 标记');
  assert.ok(/forced: result\.forced \|\| \[\]/.test(src), '应答应透传 forced');
});

console.log('v1.3.7 Ant Design DatePicker');
test('v1.3.7: antd 年/月/日面板 + 年月字段', () => {
  const html = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/function tryAntdPanel/.test(html), '应有 antd 面板专用分支');
  assert.ok(/\.ant-picker-dropdown/.test(html), '应认得 antd 弹层');
  assert.ok(/ant-picker-header-super-prev-btn/.test(html), '应认得十年箭头');
  assert.ok(/ant-picker-header-view/.test(html), '应读 antd 头部年月');
  assert.ok(/ant-picker-cell-inner/.test(html), '应按 antd 单元格取文本');
  assert.ok(/monthMode/.test(html) && /yearMode/.test(html), '应区分年面板/月面板');
  assert.ok(/ym/.test(html), '应支持“出生年月”这类年月字段');

  // 年月值解析：2016-09 不能被拆成 月=0 日=9
  const matcher = fs.readFileSync(path.join(root, 'shared/match.js'), 'utf8');
  assert.ok(/年月/.test(matcher) && matcher.indexOf("return 'ym'") !== -1, 'detectDatePartRole 应识别 ym');
  assert.ok(/ymParts/.test(matcher), 'maybeExtractDatePartValue 应输出 YYYY-MM');
});

console.log('v1.4.0 简历库 / 解析器');
test('v1.4.0: manifest 版本与资源接线', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.ok(/^1\.[45]\.\d+$/.test(pkg.version), 'manifest 应为 1.4+/1.5.x，实际 ' + pkg.version);
  const html = fs.readFileSync(path.join(root, 'options/options.html'), 'utf8');
  ['../lib/pdf.min.js', '../lib/mammoth.browser.min.js', '../shared/db.js', '../shared/resume-parser.js'].forEach((src) => {
    assert.ok(html.indexOf(src) !== -1, 'options.html 应加载 ' + src);
  });
  assert.ok(fs.existsSync(path.join(root, 'lib/pdf.worker.min.js')), 'pdf worker 必须随包发布');
});

test('v1.4.0: profile 支持多段经历', () => {
  const P = require(path.join(root, 'shared/profile.js'));
  assert.deepEqual(P.LIST_FIELDS, ['eduList', 'workList', 'projectList']);
  assert.ok(P.LIST_ITEM_FIELDS.eduList.includes('school'));
  const prof = P.emptyProfile();
  prof.eduList = [{ school: 'A大学' }, { school: 'B大学' }];
  P.deriveMainEntries(prof);
  assert.strictEqual(prof.school, 'A大学');
});


console.log('v1.4.1 回归：列表保留 / 合并 / 解析护栏');
test('v1.4.1: emptyProfile 含空列表；normalizeProfile 保留 eduList', () => {
  const empty = Profile.emptyProfile();
  assert.deepEqual(empty.eduList, []);
  assert.deepEqual(empty.workList, []);
  assert.deepEqual(empty.projectList, []);
  const raw = {
    name: '张三',
    eduList: [{ school: '浙江大学', major: '软件工程', degree: '硕士' }],
    workList: [{ company: '示例公司', title: '工程师' }],
    projectList: [{ name: '项目A', tech: 'JS' }],
    unknownKey: 'drop-me'
  };
  const n = Profile.normalizeProfile(raw);
  assert.equal(n.name, '张三');
  assert.equal(n.unknownKey, undefined);
  assert.equal(n.eduList.length, 1);
  assert.equal(n.eduList[0].school, '浙江大学');
  assert.equal(n.workList[0].company, '示例公司');
  assert.equal(n.projectList[0].name, '项目A');
});

test('v1.4.1/1.5.0: mergeFlatOntoProfile 省略列表键时保留多段经历', () => {
  const existing = Profile.normalizeProfile({
    name: '旧名',
    phone: '13800000000',
    eduList: [{ school: 'A大学', degree: '本科' }, { school: 'B大学', degree: '硕士' }],
    workList: [{ company: '旧公司', title: '开发' }],
    projectList: [{ name: '旧项目' }]
  });
  // 仅扁平字段、不带列表键 → 保留档案列表（兼容旧保存路径）
  const flat = { name: '新名', phone: '13900000000' };
  const merged = Profile.mergeFlatOntoProfile(flat, existing);
  assert.equal(merged.name, '新名');
  assert.equal(merged.phone, '13900000000');
  assert.equal(merged.eduList.length, 2);
  assert.equal(merged.eduList[0].school, 'A大学');
  assert.equal(merged.workList[0].company, '旧公司');
  assert.equal(merged.projectList[0].name, '旧项目');
});

test('v1.5.0: mergeFlatOntoProfile 显式列表覆盖（含清空）', () => {
  const existing = Profile.normalizeProfile({
    name: '旧名',
    eduList: [{ school: 'A大学', degree: '本科' }],
    workList: [{ company: '旧公司', title: '开发' }],
    projectList: [{ name: '旧项目' }]
  });
  const flat = Profile.emptyProfile();
  flat.name = '新名';
  flat.eduList = [{ school: 'C大学', major: 'CS', degree: '硕士', start: '2020-09', end: '2023-06', city: '', gpa: '', description: '' }];
  flat.workList = [];
  flat.projectList = [{ name: '新项目', role: '开发', start: '', end: '', tech: 'TS', description: '' }];
  const merged = Profile.mergeFlatOntoProfile(flat, existing);
  assert.equal(merged.name, '新名');
  assert.equal(merged.eduList.length, 1);
  assert.equal(merged.eduList[0].school, 'C大学');
  assert.equal(merged.workList.length, 0, '显式空数组应清空工作经历');
  assert.equal(merged.projectList[0].name, '新项目');
});

test('v1.4.1: options 源守卫（脏表单确认 / 清空库 / 合并保存）', () => {
  const src = fs.readFileSync(path.join(root, 'options/options.js'), 'utf8');
  assert.ok(/mergeFlatOntoProfile/.test(src), '保存应走 mergeFlatOntoProfile');
  assert.ok(/isFormDirty/.test(src) && /未保存修改/.test(src), '切换档案应确认未保存修改');
  assert.ok(/DB\.clearAll/.test(src), '清空应清理 IndexedDB');
  assert.ok(/applyGen/.test(src), '应用档案应有代数号防竞态');
  assert.ok(/相同 id 会覆盖/.test(src), '整库导入应确认覆盖');
});

test('v1.4.1: db.openDB 失败可重试；resume-parser 有文件上限', () => {
  const dbSrc = fs.readFileSync(path.join(root, 'shared/db.js'), 'utf8');
  assert.ok(/dbPromise = null/.test(dbSrc), '打开失败应重置 dbPromise');
  assert.ok(/onversionchange/.test(dbSrc), '应处理 versionchange');
  const Parser = require(path.join(root, 'shared/resume-parser.js'));
  assert.equal(Parser.MAX_FILE_BYTES, 20 * 1024 * 1024);
  assert.ok(/1\.[45]\.\d+/.test(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')));
});


console.log('v1.5.0 多段编辑 / 下拉适配 / 语义模糊');

test('v1.5.0: SAMPLE_PROFILE 含多段虚构经历', () => {
  const s = Profile.SAMPLE_PROFILE;
  assert.ok(Array.isArray(s.eduList) && s.eduList.length >= 1);
  assert.ok(Array.isArray(s.workList) && s.workList.length >= 1);
  assert.ok(Array.isArray(s.projectList) && s.projectList.length >= 1);
  assert.equal(s.name, '张三');
  assert.ok(!/api[_-]?key|sk-/i.test(JSON.stringify(s)), '样例不得含密钥');
});

test('v1.5.0: LIST_ITEM_LABELS / SECTION_TITLES 导出', () => {
  assert.ok(Profile.LIST_ITEM_LABELS.eduList.school);
  assert.ok(Profile.LIST_SECTION_TITLES.eduList);
  assert.deepEqual(Profile.LIST_ITEM_FIELDS.eduList, [
    'school', 'major', 'degree', 'start', 'end', 'city', 'gpa', 'description'
  ]);
});

test('v1.5.0: normalizeProfile + merge 多段 roundtrip', () => {
  const raw = {
    name: '张三',
    eduList: [
      { school: '复旦大学', major: '计算机', degree: '本科', start: '2016-09', end: '2020-06' },
      { school: '示例高中', major: '理科', degree: '高中', start: '2013-09', end: '2016-06' }
    ],
    workList: [
      { company: '示例科技', title: '前端', start: '2020-07', end: '至今' }
    ],
    projectList: [
      { name: '表单引擎', role: '负责人', tech: 'React' }
    ]
  };
  const n = Profile.normalizeProfile(raw);
  assert.equal(n.eduList.length, 2);
  const flat = { name: '张三改' };
  const kept = Profile.mergeFlatOntoProfile(flat, n);
  assert.equal(kept.name, '张三改');
  assert.equal(kept.eduList.length, 2);
  const overlay = Profile.normalizeProfile({
    name: '张三改',
    eduList: n.eduList,
    workList: n.workList,
    projectList: n.projectList
  });
  const again = Profile.normalizeProfile(overlay);
  assert.deepEqual(again.eduList.map((e) => e.school), ['复旦大学', '示例高中']);
});

test('v1.5.0: 语义模糊 — 新 CN ATS 同义', () => {
  assert.equal(Match.matchFieldKey('意向岗位'), 'jobTarget');
  assert.equal(Match.matchFieldKey('应聘岗位'), 'jobTarget');
  assert.equal(Match.matchFieldKey('期望岗位'), 'jobTarget');
  assert.equal(Match.matchFieldKey('毕业学校'), 'school');
  assert.equal(Match.matchFieldKey('最高学历'), 'highestDegree');
  assert.equal(Match.matchFieldKey('目前月薪'), 'currentSalary');
  assert.equal(Match.matchFieldKey('希望薪资'), 'expectedSalary');
  assert.equal(Match.matchFieldKey('籍贯'), 'nativePlace');
  assert.equal(Match.matchFieldKey('祖籍'), 'nativePlace');
  assert.equal(Match.matchFieldKey('户口所在地'), 'hukou');
  assert.equal(Match.matchFieldKey('婚姻状况'), 'maritalStatus');
  assert.equal(Match.matchFieldKey('民族'), 'ethnicity');
  assert.equal(Match.matchFieldKey('紧急联系人姓名'), 'emergencyContactName');
  assert.equal(Match.matchFieldKey('应急联系人电话'), 'emergencyContactPhone');
  assert.equal(Match.matchFieldKey('到岗时间'), 'availability');
  assert.equal(Match.matchFieldKey('工作性质'), 'jobType');
  assert.equal(Match.matchFieldKey('雇佣类型'), 'jobType');
});

test('v1.5.0: denylist 仍拦截上司/微信误匹配', () => {
  assert.equal(Match.matchFieldKey('直接上司微信'), null);
  assert.equal(Match.matchFieldKey('直属上级电话'), null);
  assert.equal(Match.matchFieldKey('supervisor wechat'), null);
  assert.equal(Match.matchFieldKey('微信'), 'wechat');
});

test('v1.5.0: stripLabelNoise / normalizeOptionText / parseYesNo / findBestOption', () => {
  assert.equal(Match.stripLabelNoise('请选择性别'), '性别');
  assert.equal(Match.stripLabelNoise('请输入姓名'), '姓名');
  assert.ok(Match.cleanLabelPunctuation('请选择：意向岗位').indexOf('意向岗位') !== -1);
  assert.equal(Match.parseYesNo('是'), 'Yes');
  assert.equal(Match.parseYesNo('否'), 'No');
  assert.equal(Match.parseYesNo('可以'), 'Yes');
  assert.equal(Match.normalizeToYesNo('是'), Match.parseYesNo('是'));
  const hit = Match.findBestOption(
    [{ value: '1', text: '本科' }, { value: '2', text: '硕士' }, { value: '', text: '请选择' }],
    '本科'
  );
  assert.ok(hit);
  assert.equal(hit.text, '本科');
  const yn = Match.findBestOption(
    [{ value: 'Y', text: '是' }, { value: 'N', text: '否' }],
    '否'
  );
  assert.equal(yn.text, '否');
  assert.equal(Match.normalizeOptionText('　本　科　'), '本科');
});

test('v1.5.0: profileValueForOccurrence 多段按序取值', () => {
  const p = Profile.normalizeProfile({
    school: '扁平校',
    eduList: [
      { school: '一段校', major: 'CS', degree: '本科' },
      { school: '二段校', major: 'SE', degree: '硕士' }
    ],
    workList: [
      { company: '公司A', title: '前端' },
      { company: '公司B', title: '全栈' }
    ],
    projectList: [
      { name: '项目一', role: '负责人' },
      { name: '项目二', role: '成员' }
    ]
  });
  assert.equal(Match.profileValueForOccurrence(p, 'school', 0), '扁平校');
  assert.equal(Match.profileValueForOccurrence(p, 'school', 1), '二段校');
  assert.equal(Match.profileValueForOccurrence(p, 'company', 1), '公司B');
  assert.equal(Match.profileValueForOccurrence(p, 'projectName', 1), '项目二');
  assert.equal(Match.profileValueForOccurrence(p, 'school', 9), '');
  assert.equal(Match.profileValueForOccurrence(p, 'email', 1), p.email || '');
});

test('v1.5.0: options 多段编辑器源守卫', () => {
  const src = fs.readFileSync(path.join(root, 'options/options.js'), 'utf8');
  assert.ok(/renderListEditor/.test(src), '应有列表渲染');
  assert.ok(/readListFromDom/.test(src), '应有列表读取');
  assert.ok(/data-list-act/.test(src), '应有上移下移删除');
  assert.ok(/list-eduList|list-workList|list-projectList/.test(
    fs.readFileSync(path.join(root, 'options/options.html'), 'utf8')
  ), 'options.html 应有多段容器');
  assert.ok(/list-editor/.test(fs.readFileSync(path.join(root, 'options/options.css'), 'utf8')));
});

test('v1.5.0: autofill 下拉适配器源守卫', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/fillCustomSelect/.test(src));
  assert.ok(/el-select/.test(src) && /ant-select/.test(src));
  assert.ok(/dictionary-selector/.test(src));
  assert.ok(/fillNamedRadioGroups/.test(src));
  assert.ok(/profileValueForOccurrence/.test(src));
  assert.ok(/findBestOption/.test(src));
});

test('v1.5.0: demo/dropdowns.html 存在且含四类组件', () => {
  const html = fs.readFileSync(path.join(root, 'demo/dropdowns.html'), 'utf8');
  assert.ok(/el-select/.test(html));
  assert.ok(/ant-select/.test(html));
  assert.ok(/dictionary-selector/.test(html));
  assert.ok(/<select/.test(html));
  assert.ok(/type="radio"/.test(html));
  assert.ok(/活体验证|手动/.test(html));
});

test('v1.5.0: manifest 1.5.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(pkg.version, '1.5.1');
});


console.log('v1.5.1 命名 radio 组标题发现');
test('v1.5.1: radio 组标题支持行首 span / 前兄弟文本', () => {
  const src = fs.readFileSync(path.join(root, 'content/autofill.js'), 'utf8');
  assert.ok(/function radioGroupHints/.test(src), '应有 radioGroupHints');
  assert.ok(/previousElementSibling/.test(src), '应尝试前一个兄弟节点的文本');
  assert.ok(/radio-group/.test(src), '克隆父容器时应剔除 .radio-group');
  assert.ok(/for \(var hi = 0; hi < hints\.length/.test(src), '应逐个候选标题做匹配');
});

console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// 串联简历解析套件（独立计数，失败则整体非零退出）
{
  console.log('');
  console.log('—— resume-parser.test.mjs ——');
  const child = spawnSync(process.execPath, [path.join(__dirname, 'resume-parser.test.mjs')], {
    encoding: 'utf8',
    cwd: root
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status) process.exit(child.status);
}
