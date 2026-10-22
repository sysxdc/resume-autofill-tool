/**
 * 真组件 × 真扩展 回归测试
 *
 * 为什么要有它：tests/run-dom-tests.mjs 的夹具是手写的仿制控件，脚本也是注入到页面主环境里跑的；
 * 而真实扩展的内容脚本跑在「隔离环境」，读不到页面挂在 DOM 上的 React fiber / Vue 实例。
 * v1.5.23 之前的「直接改组件值」在仿制页面里全绿，在真实站点上一个都不生效——只有这种测试抓得住。
 *
 * 做法：Playwright 加载解压的扩展本体 → 经 service worker 写 chrome.storage → chrome.tabs.sendMessage(FILL_FORM)
 * （与用户点按钮完全同一路径）→ 断言页面里组件自己的状态（表单真正会提交的值），以及耗时 / 不超时。
 *
 * 用法：
 *   cd tests/real && npm install        # 一次性装组件库（antd 3/4/5、Element UI/Plus、ant-design-vue、layui）
 *   node tests/real/run-real.mjs        # 跑全部；node tests/real/run-real.mjs antd5,layui 只跑部分
 *   node tests/real/run-real.mjs '' /path/to/other/build   # 对比别的版本（默认测仓库根目录）
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..');
const [filter = '', extArg = ''] = process.argv.slice(2);
const EXT = path.resolve(extArg || ROOT);

function loadPlaywright() {
  try { return require('playwright'); } catch (_) { /* fall through */ }
  try { return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch (_) { /* fall through */ }
  throw new Error('找不到 playwright（npm i -g playwright 或在仓库根目录 npm i）');
}

if (!fs.existsSync(path.join(HERE, 'node_modules', 'antd5'))) {
  console.log('（跳过：没装组件库。先执行 cd tests/real && npm install）');
  process.exit(0);
}
// 北森 Phoenix 是 ESM 包，先打成浏览器包（只在缺失时）
if (!fs.existsSync(path.join(HERE, 'vendor', 'phoenix.bundle.js'))) {
  execSync(process.execPath + ' ' + JSON.stringify(path.join(HERE, 'phoenix', 'build.mjs')), { stdio: 'inherit' });
}

const SMALL = {
  name: '张三', eduDegree: '硕士', highestDegree: '硕士', birthday: '1998-05-20',
  eduStart: '2019-09', eduEnd: '2023-06', startDate: '2023-07', workEnd: '2025-03',
  eduList: [{ school: '某大学', major: '计算机', degree: '硕士', start: '2019-09', end: '2023-06' }],
  workList: [{ company: '某科技', title: '前端', start: '2023-07', end: '2025-03' }]
};
const BIG = {
  name: '张三', phone: '13800138000', email: 'zs@example.com', wechat: 'zs_wx', idNumber: '110101199805201234',
  nativePlace: '广东深圳', address: '深圳市南山区科技园', emergencyContactName: '李四', emergencyContactPhone: '13900139000',
  hobbies: '跑步', qq: '123456', expectedSalary: '15000', expectedCity: '深圳', gender: '男', politicalStatus: '中共党员',
  ethnicity: '壮族', maritalStatus: '未婚', highestDegree: '硕士', acceptAdjustment: '是', englishLevel: 'CET-6',
  referralSource: '朋友推荐', healthStatus: '良好', isFreshGraduate: '是', birthday: '1998-05-20',
  eduList: [
    { school: '某理工大学', major: '计算机科学与技术', degree: '硕士', start: '2021-09', end: '2024-06' },
    { school: '某大学', major: '软件工程', degree: '本科', start: '2017-09', end: '2021-06' }
  ],
  workList: [
    { company: '甲科技', title: '前端工程师', start: '2024-07', end: '2025-08' },
    { company: '乙网络', title: '实习生', start: '2023-07', end: '2023-12' }
  ]
};

const ANTD = { name: '张三', deg: '硕士', birth: '1998-05-20', eduRange: ['2019-09-01', '2023-06-30'], enroll: '2019-09-01', ws: '2023-07-01', we: '2025-03-01' };
const BIG_EXPECT = {
  name: '张三', phone: '13800138000', email: 'zs@example.com', wechat: 'zs_wx', idNumber: '110101199805201234',
  emName: '李四', emPhone: '13900139000', city: '深圳', birth: '1998-05-20',
  gender: '男', pol: '中共党员', mar: '未婚', hd: '硕士', adj: '是', lang: 'CET-6', health: '良好', fresh: '是',
  er0: ['2021-09-01', '2024-06-30'], er1: ['2017-09-01', '2021-06-30'],
  school0: '某理工大学', major0: '计算机科学与技术', deg0: '硕士', school1: '某大学', major1: '软件工程', deg1: '本科',
  co0: '甲科技', ti0: '前端工程师', ws0: '2024-07-01', we0: '2025-08-01',
  co1: '乙网络', ti1: '实习生', ws1: '2023-07-01', we1: '2023-12-01',
  // 零错填：选项里没有的值、第三方字段，必须留空
  eth: undefined, src: undefined, father: undefined
};

const BEISEN_PROFILE = {
  name: '张三', gender: '男', birthday: '1998-05-20', phone: '13800138000', email: 'zs@example.com',
  politicalStatus: '中共党员', highestDegree: '硕士', isFreshGraduate: '是', expectedStartDate: '2025-07',
  emergencyContactName: '李四', emergencyContactPhone: '13900139000', studyMode: '全日制',
  eduList: BIG.eduList, workList: [{ company: '甲科技', title: '前端工程师', start: '2024-07', end: '2025-08' }]
};
const BEISEN_EXPECT = {
  name: '张三', gender: '男', birth: '1998-05-20', phone: '13800138000', email: 'zs@example.com', pol: '中共党员', hd: '硕士',
  fresh: '是', report: '2025-07', emName: '李四', emPhone: '13900139000',
  school0: '某理工大学', major0: '计算机科学与技术', deg0: '硕士', mode0: '全日制', es0: '2021-09', ee0: '2024-06',
  school1: '某大学', major1: '软件工程', deg1: '本科', mode1: '全日制', es1: '2017-09', ee1: '2021-06',
  co: '甲科技', ti: '前端工程师', ws: '2024-07', we: '2025-08'
};

const MOKA_PROFILE = {
  name: '张三', phone: '13800138000', email: 'zs@example.com', gender: '男', birthday: '1998-05-20', highestDegree: '硕士',
  isFreshGraduate: '是', currentCity: '深圳', eduList: BIG.eduList,
  workList: [{ company: '甲科技', title: '前端实习生', start: '2024-07', end: '2025-08' }]
};
const MOKA_EXPECT = {
  name: '张三', phone: '13800138000', email: 'zs@example.com', gender: '男', birthy: '1998', birthm: '05', hd: '硕士',
  fresh: '应届毕业生', city: '深圳', ref: undefined,
  school0: '某理工大学', major0: '计算机科学与技术', deg0: '硕士', edu0sy: '2021', edu0sm: '09', edu0ey: '2024', edu0em: '06',
  school1: '某大学', major1: '软件工程', deg1: '本科', edu1sy: '2017', edu1sm: '09', edu1ey: '2021', edu1em: '06',
  co: '甲科技', ti: '前端实习生', worksy: '2024', worksm: '07', workey: '2025', workem: '08'
};

const CASES = [
  { page: 'moka', profile: MOKA_PROFILE, expect: MOKA_EXPECT, maxMs: 30000 },
  { page: 'beisen', profile: BEISEN_PROFILE, expect: BEISEN_EXPECT, maxMs: 30000 },
  { page: 'antd3', profile: SMALL, expect: ANTD, maxMs: 8000 },
  { page: 'antd4', profile: SMALL, expect: ANTD, maxMs: 8000 },
  { page: 'antd5', profile: SMALL, expect: ANTD, maxMs: 8000 },
  { page: 'antdv', profile: SMALL, expect: Object.assign({}, ANTD, { eduRange: ['2019-09', '2023-06'] }), maxMs: 8000 },
  {
    page: 'element-ui', profile: SMALL, maxMs: 8000,
    expect: { name: '张三', deg: '硕士', birth: '1998-05-20', eduRange: ['2019-09', '2023-06'], enroll: '2019-09', workRange: ['2023-07-01', '2025-03-31'], ws: '2023-07-01', we: '2025-03-01' }
  },
  {
    page: 'element-plus', profile: SMALL, maxMs: 8000,
    expect: { name: '张三', deg: '硕士', birth: '1998-05-20', eduRange: ['2019-09', '2023-06'], enroll: '2019-09', workRange: ['2023-07-01', '2025-03-31'], ws: '2023-07-01', we: '2025-03-01' }
  },
  {
    page: 'layui', profile: SMALL, maxMs: 8000,
    expect: { name: '张三', birth: '1998-05-20', eduRange: '2019-09 - 2023-06', enroll: '2019-09', ws: '2023-07-01', we: '2025-03-01' }
  },
  { page: 'big-antd5', profile: BIG, expect: BIG_EXPECT, maxMs: 25000 },
  { page: 'big-antd4', profile: BIG, expect: BIG_EXPECT, maxMs: 25000 }
].filter((c) => !filter || filter.split(',').includes(c.page));

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const p = path.join(HERE, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(HERE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', MIME[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const { chromium } = loadPlaywright();
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 1000 },
  args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT]
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });

let passed = 0;
const failed = [];
for (const c of CASES) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  try {
    // 写完回读确认（service worker 偶尔在写入完成前被换掉）
    for (let k = 0; k < 5; k++) {
      const ok = await sw.evaluate(async (p) => {
        await chrome.storage.local.set({ profile: p });
        const got = await chrome.storage.local.get('profile');
        return !!(got.profile && got.profile.name === p.name);
      }, c.profile);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    await page.goto(`http://127.0.0.1:${port}/pages/${c.page}.html`);
    await page.waitForFunction(() => typeof window.__state === 'function', null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const t0 = Date.now();
    const r = await sw.evaluate(async (u) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url && t.url.indexOf(u) !== -1);
      return chrome.tabs.sendMessage(tab.id, { type: 'FILL_FORM', options: { allowAddSections: false } }, { frameId: 0 });
    }, `/pages/${c.page}.html`);
    const ms = Date.now() - t0;
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => window.__state());
    const bad = [];
    Object.keys(c.expect).forEach((k) => {
      const want = c.expect[k];
      const got = st[k] === '' || st[k] === null ? undefined : st[k];
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${k}: 期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`);
    });
    if (!r || r.ok === false) bad.push('填写失败：' + JSON.stringify(r));
    if (r && r.timedOut) bad.push('超时');
    if (ms > c.maxMs) bad.push(`耗时 ${ms}ms > ${c.maxMs}ms`);
    if (errs.length) bad.push('页面报错：' + errs.join('; '));
    if (bad.length) throw new Error(bad.join('\n     '));
    passed += 1;
    console.log(`  ✓ ${c.page}  ${ms}ms  filled=${r.filled}`);
  } catch (e) {
    failed.push(c.page);
    console.log(`  ✗ ${c.page}\n     ${e.message}`);
  } finally {
    await page.close();
  }
}
await ctx.close();
server.close();
console.log('');
console.log(`Real Result: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
