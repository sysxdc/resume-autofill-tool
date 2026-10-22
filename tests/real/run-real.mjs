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
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
// 跨平台：Windows 下 URL.pathname 是 "/D:/..."，只剥前导斜杠会留下正斜杠路径，
// 与 path.join 拼出来的反斜杠路径 startsWith 比较永远 false → 静态服务对每个文件都 404。
const HERE = path.dirname(fileURLToPath(import.meta.url));
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

const CASES = [
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
  const rel = path.relative(HERE, p);
  const outside = rel.startsWith('..') || path.isAbsolute(rel);
  if (outside || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; res.end(); return; }
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
    // 写档后必须等 storage 落盘再打开页面：否则 content script 首帧 loadProfile()
    // 读到的还是上一个用例的空档 → antd3 这种第一个用例会直接 empty_profile 失败。
    // 关键：不要用「值回填」的写法。chrome.storage.local.set 是合并写，
    // 上一轮用例留下的 262 键空档案会和新档并在一起 → profileHasData 判定为空 → empty_profile。
    // 先 clear 再 set，保证每个用例看到的是干净的一份档。
    await sw.evaluate((p) => new Promise((res) => chrome.storage.local.clear(() => chrome.storage.local.set({ profile: p }, res))), c.profile);
    const seeded = await sw.evaluate(() => new Promise((res) => chrome.storage.local.get(['profile'], (v) => {
      const p = v.profile || {};
      res(Object.keys(p).filter((k) => p[k] && String(p[k]).trim()).length);
    })));
    if (!seeded) throw new Error('档案没有写进 storage');
    await page.goto(`http://127.0.0.1:${port}/pages/${c.page}.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__state === 'function', null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const t0 = Date.now();
    // 必须精确命中「当前这个页面」：按 url 子串找 tab 会命中别的标签（或找到还没注入内容的 tab），
    // 于是 sendMessage 落到别的上下文 → 表现成 empty_profile / 字段全 undefined，非常难查。
    const tabId = await sw.evaluate(async (fullUrl) => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((x) => x.url === fullUrl);
      return t ? t.id : null;
    }, page.url());
    if (!tabId) throw new Error('找不到当前测试页对应的 tab');
    const r = await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'FILL_FORM', options: { allowAddSections: false } }, { frameId: 0 }), tabId);
    const ms = Date.now() - t0;
    await page.waitForTimeout(300);
    // 页面状态必须从「已填充的那个 frame」里取：page.evaluate 只打主 frame，
    // 而内容脚本 may be in another frame → 会读到全 undefined，看起来像没填上。
    let st = null;
    try {
      const outer = await page.evaluate(() => window.__state());
      const known = outer && Object.keys(c.expect).filter((k) => outer[k] !== '' && outer[k] != null).length;
      st = known > 0 ? outer : null;
    } catch (_) { st = null; }
    if (!st) {
      const got = await sw.evaluate(async (args) => {
        const res = await chrome.scripting.executeScript({
          target: { tabId: args.id },
          world: 'MAIN',
          func: () => (typeof window.__state === 'function' ? window.__state() : null)
        });
        return res.map((x) => x.result).find((x) => x && Object.keys(x).length) || null;
      }, { id: tabId });
      st = got || {};
    }
    const bad = [];
    Object.keys(c.expect).forEach((k) => {
      const want = c.expect[k];
      const got = st[k] === '' || st[k] === null ? undefined : st[k];
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${k}: 期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`);
    });
    if (!r || r.ok === false) bad.push('填写失败：' + JSON.stringify(r));
    if (r && r.timedOut) bad.push('超时');
    if (r && r.reason === 'empty_profile') {
      // 定位用：到底是档没写进去，还是内容脚本读不到
      const diag = await sw.evaluate(async (id) => {
        const inSw = await new Promise((res) => chrome.storage.local.get(['profile'], (v) => res(Object.keys(v.profile || {}).length)));
        const inTab = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => new Promise((res) => chrome.storage.local.get(['profile'], (v) => {
          const p = v.profile || {};
          res({ keys: Object.keys(p).length, nonEmpty: Object.keys(p).filter((k) => p[k] && String(p[k]).trim()).length });
        })) });
        return { inSw, inTab };
      }, tabId);
      bad.push('诊断：' + JSON.stringify(diag).slice(0, 200));
    }
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
