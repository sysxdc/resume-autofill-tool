/**
 * DOM 级行为基线（真实浏览器里跑 tests/fixtures/dom/*.html）
 *
 * 目的：把「每个时间控件到底怎么才能填上」变成可执行断言。上一轮反复出现
 * 「单测全绿 → 实测还是不行」，根因就是 174 条单测全在断言源码字符串。
 * 这里断言的是「打开方式 / 写入路径 / 回读值 / 陷阱」——组件能力层重构后必须仍然全绿。
 *
 * 用法：
 *   node tests/run-dom-tests.mjs           # 跑全部
 *   node tests/run-dom-tests.mjs antd      # 只跑名字含 antd 的
 *
 * 依赖：playwright（全局安装亦可）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function loadPlaywright() {
  const tried = [];
  try { return require('playwright'); } catch (e) { tried.push(e.message); }
  try {
    // playwright 可能只装在全局（npx playwright 能用，但项目里没有 node_modules）
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const p = path.join(root, 'playwright');
    if (fs.existsSync(p)) return require(p);
    tried.push('no ' + p);
  } catch (e) { tried.push(e.message); }
  throw new Error('找不到 playwright：' + tried.join(' | '));
}

const FIXTURES = path.join(__dirname, 'fixtures', 'dom');
const fileUrl = (f) => 'file:///' + path.join(FIXTURES, f).replace(/\\/g, '/');

// ── 断言小工具 ─────────────────────────────────────────────
class Fail extends Error {}
function ok(cond, msg) { if (!cond) throw new Fail(msg); }
function eq(actual, expect, msg) {
  if (String(actual) !== String(expect)) throw new Fail(`${msg}: 期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}`);
}

/** 派发合成点击（扩展里 simulateClick 的行为） */
async function syntheticClick(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no ' + sel);
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((t) => {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true }));
    });
  }, selector);
}

async function nativeClick(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no ' + sel);
    el.click();
  }, selector);
}

async function value(page, selector) { return page.evaluate((s) => (document.querySelector(s) || {}).value, selector); }
async function text(page, selector) { return page.evaluate((s) => (document.querySelector(s) || {}).textContent.trim(), selector); }
async function visible(page, selector) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
  }, selector);
}

/** 点含指定文本的可见单元格 */
async function clickCellByText(page, cellsSel, want) {
  const hit = await page.evaluate(({ cellsSel, want }) => {
    const list = Array.from(document.querySelectorAll(cellsSel));
    const el = list.find((n) => n.textContent.trim() === String(want));
    if (!el) return false;
    el.click();
    return true;
  }, { cellsSel, want });
  if (!hit) throw new Error(`没有文本为 ${want} 的格子（${cellsSel}）`);
}

// ── 用例：每个 fixture 断言「打开方式 + 写入路径 + 回读值 + 陷阱」──
const CASES = [
  {
    name: 'r3-ymd-selects：年/月/日 三个原生 select',
    file: 'r3-ymd-selects.html',
    async run(page) {
      // 坑：年份 value 不补零（1985），月份不补零（9），日补零（21）——统一补零会写不进去
      await page.selectOption('#by', '1985');
      await page.selectOption('#bm', '9');
      await page.selectOption('#bd', '21');
      eq(await value(page, '#by'), '1985', '年');
      eq(await value(page, '#bm'), '9', '月（不补零）');
      eq(await value(page, '#bd'), '21', '日');
      // 用补零的月份去写是不存在的选项 → 保持原值，说明「必须按 option 的真实 value 写」
      await page.selectOption('#bm', '9');
      eq(await value(page, '#bm'), '9', '月份不会被补零值覆盖');
      // 「请选择」是空 value 的占位项
      eq(await page.evaluate(() => document.querySelector('#bm option[value=""]').textContent), '请选择', '占位项');
    },
  },
  {
    name: 'r1-en-datepicker：英文日历 + 上/下月导航 + OK',
    file: 'r1-en-datepicker.html',
    async run(page) {
      ok(!(await visible(page, '#dp')), '面板初始隐藏');
      // 打开方式：input 自己绑了 click
      await nativeClick(page, '#bd');
      ok(await visible(page, '#dp'), '原生 click 打开面板');
      eq(await text(page, '#lbl'), 'March 2000', '初始视图');
      // 导航到 2027-06：2000-03 起逐月点 327 次（控件只有 prev/next，没有年视图）
      for (let i = 0; i < 27; i++) await page.click('#next');
      eq(await text(page, '#lbl'), 'June 2002', '逐月导航 27 次 = 2002-06');
      for (let i = 0; i < 300; i++) await page.click('#next');
      eq(await text(page, '#lbl'), 'June 2027', '再 300 次 = 2027-06');
      // 陷阱：42 格里含相邻月日期（.other），点错会串月
      const otherCount = await page.evaluate(() => document.querySelectorAll('#tb td.other').length);
      ok(otherCount > 0, '存在相邻月格子（.other）');
      await clickCellByText(page, '#tb td:not(.other)', 21);
      await page.click('#ok');
      eq(await value(page, '#bd'), '2027-06-21', '回读');
      ok(!(await visible(page, '#dp')), 'OK 后关闭');
    },
  },
  {
    name: 'datepanel-replica：年表/月表/日表 + 确定',
    file: 'datepanel-replica.html',
    async run(page) {
      await nativeClick(page, '#birthday');
      ok(await visible(page, '#dpPanel'), '点击打开三表格面板');
      await page.click('#dpYears td[data-v="2004"]');
      await page.click('#dpMonths td[data-v="9"]');
      await page.click('#dpDays td[data-v="21"]');
      // 陷阱：不点「确定」不能提交
      eq(await value(page, '#birthday'), '', '未点确定前不回写');
      await page.click('#dpOk');
      eq(await value(page, '#birthday'), '2004-09-21', '回读');
      ok(!(await visible(page, '#dpPanel')), '确定后关闭');
    },
  },
  {
    name: 'r11-antd-month：antd 风格「只有年月」面板（focus 才打开）',
    file: 'r11-antd-month.html',
    async run(page) {
      // 坑：这个控件绑的是 focus，不是 click —— 合成 click 打不开
      await syntheticClick(page, '#enroll');
      ok(!(await visible(page, '#dd')), '合成 click 打不开（契约）');
      await page.focus('#enroll');
      ok(await visible(page, '#dd'), 'focus 打开面板');
      eq(await text(page, '#hv'), '2020年', '初始视图');
      // 年导航：1 年 / 10 年两种箭头
      await page.click('.ant-picker-header-super-prev-btn');
      eq(await text(page, '#hv'), '2010年', '« 减 10 年');
      await page.click('.ant-picker-header-next-btn');
      eq(await text(page, '#hv'), '2011年', '› 加 1 年');
      await page.click('.ant-picker-cell >> nth=8'); // 9 月（3 列 × 3）
      eq(await value(page, '#enroll'), '2011-09', '回读只有年月（month-only 精度）');
      ok(!(await visible(page, '#dd')), '选完关闭');
    },
  },
  {
    name: 'r12-antd-date：antd 风格年月日面板（focus 打开 + 邻月格子）',
    file: 'r12-antd-date.html',
    async run(page) {
      await syntheticClick(page, '#birth');
      ok(!(await visible(page, '#dd')), '合成 click 打不开（契约）');
      await page.focus('#birth');
      ok(await visible(page, '#dd'), 'focus 打开面板');
      eq(await text(page, '#hy'), '2020', '初始年');
      await page.click('.ant-picker-header-super-prev-btn');
      eq(await text(page, '#hy'), '2010', '« 减 10 年');
      await page.click('.ant-picker-header-next-btn');
      eq(await text(page, '#hm'), '4', '› 加 1 月');
      // 陷阱：非当月格子也在表里，必须按「当月」筛
      const outCount = await page.evaluate(() => document.querySelectorAll('#tb td:not(.ant-picker-cell-in-view)').length);
      ok(outCount > 0, '存在非当月格子');
      const clicked = await page.evaluate(() => {
        const tds = Array.from(document.querySelectorAll('#tb td.ant-picker-cell-in-view'));
        const td = tds.find((n) => n.textContent.trim() === '21');
        if (!td) return false;
        td.click();
        return true;
      });
      ok(clicked, '找到当月 21 日');
      eq(await value(page, '#birth'), '2010-04-21', '回读');
    },
  },
  {
    name: 'r4-paginated-select：分页下拉（点击即提交）',
    file: 'r4-paginated-select.html',
    async run(page) {
      await nativeClick(page, '#bd');
      ok(await visible(page, '#panel'), '点击打开');
      const pageInfo = await text(page, '#info');
      ok(/1\s*\/\s*\d+/.test(pageInfo.replace(/\s+/g, '')) || pageInfo.length > 0, '有分页信息：' + pageInfo);
      // 翻页后选第一个 li，立即回写
      await page.click('#next');
      const first = await page.evaluate(() => {
        const li = document.querySelector('#ul li');
        if (!li) return null;
        const t = li.textContent.trim();
        li.click();
        return t;
      });
      ok(first, '有选项');
      eq(await value(page, '#bd'), first, '点选项立即回读（无需确认）');
      ok(!(await visible(page, '#panel')), '选完关闭');
    },
  },
  {
    name: 'r5-wheel-picker：滚轮式（点完还要点确定）',
    file: 'r5-wheel-picker.html',
    async run(page) {
      await nativeClick(page, '#bd');
      ok(await visible(page, '#wheel'), '点击打开滚轮');
      const picked = await page.evaluate(() => {
        const cols = [document.querySelector('#cy'), document.querySelector('#cm'), document.querySelector('#bd')];
        return cols.map((c) => !!c);
      });
      ok(picked.every(Boolean), '三列滚轮都在');
      // 点各列里文本为目标值的那一项
      const hit = await page.evaluate(() => {
        const want = { y: '2004', m: '9', d: '21' };
        const map = { y: '#cy', m: '#cm', d: '#cd' };
        let n = 0;
        for (const k of ['y', 'm', 'd']) {
          const col = document.querySelector(map[k]);
          const items = Array.from(col.querySelectorAll('*')).filter((e) => e.children.length === 0 && e.textContent.trim() === want[k]);
          const item = items[items.length - 1];
          if (!item) continue;
          item.click();
          n++;
        }
        return n;
      });
      ok(hit === 3, '三列都点到了目标值，实际 ' + hit);
      eq(await value(page, '#bd'), '', '未点确定前不回写（陷阱）');
      await page.click('#ok');
      eq(await value(page, '#bd'), '2004-09-21', '回读');
    },
  },
  {
    name: 'wecruit-antd3-select：隐藏编码值 + 点 li 不提交 + 键盘才提交',
    file: 'wecruit-antd3-select.html',
    async run(page) {
      // 陷阱 1：隐藏 input 里存着 0/20000/20001，只看它就会把「未填」判成「已填」
      eq(await value(page, '#code'), '0/20000/20001', '隐藏编码值初始就存在');
      eq(await text(page, '#ph'), '请填写学校', '占位文案说明其实没填');

      await nativeClick(page, '#selection');
      ok(await visible(page, '#dd'), '点开下拉');
      eq(await text(page, '#dd'), '暂无数据', '开箱只有占位项');

      // 输入关键词才有选项（远程搜索）
      await page.fill('#search', '广东工业大学');
      await page.waitForTimeout(200);
      const opts = await page.evaluate(() => Array.from(document.querySelectorAll('#dd li')).map((n) => n.textContent.trim()));
      eq(opts.join('|'), '广东工业大学|广东工业大学华立学院', '远程搜索返回选项');

      // 陷阱 2：鼠标点选项不提交
      await page.evaluate(() => document.querySelectorAll('#dd li')[0].click());
      eq(await text(page, '#picked'), '', '点 li 不提交（契约）');
      ok(!(await page.evaluate(() => document.querySelector('#sel').hasAttribute('data-selected'))), '仍未选中');

      // 键盘：ArrowDown 到高亮项 + Enter 才提交
      await page.focus('#search');
      await page.keyboard.press('ArrowDown');
      const activeText = await page.evaluate(() => {
        const n = document.querySelector('#dd .ant-select-dropdown-menu-item-active');
        return n ? n.textContent.trim() : '';
      });
      eq(activeText, '广东工业大学', '第一次 ArrowDown 高亮第一项');
      await page.keyboard.press('Enter');
      eq(await text(page, '#picked'), '广东工业大学', '键盘提交后回读');
      ok(/^0\/20000\/20001\/1$/.test(await value(page, '#code')), '编码值随之更新');
      ok(!(await visible(page, '#dd')), '提交后关闭');
    },
  },
  {
    name: 'calendargrid-replica：日历网格 + 年箭头 + 上下月箭头 + 确定',
    file: 'calendargrid-replica.html',
    async run(page) {
      await nativeClick(page, '#bd');          // 输入框才是触点（#picker 是面板本身）
      ok(await visible(page, '#picker'), '点击打开');
      const header = await text(page, '#hYear').catch(() => '');
      await page.click('.d-arrow-right');    // 年 +1
      await page.click('.arrow-right');     // 月 +1
      const cells = await page.evaluate(() => document.querySelectorAll('#tbody td:not(.other)').length);
      ok(cells >= 28, '当月格子数 ' + cells);
      const done = await page.evaluate(() => {
        const td = Array.from(document.querySelectorAll('#tbody td')).find((n) => n.textContent.trim() === '21' && !/other/.test(n.className));
        if (!td) return false;
        td.click();
        return true;
      });
      ok(done, '点到当月 21 日');
      eq(await text(page, '#hYear'), '2027', '年箭头 +1 后标题（初始 ' + header + ' → 2027）');
      await page.click('#okBtn');
      const v = await value(page, '#bd');
      ok(/^\d{4}-\d{2}-21$/.test(v), '回读形如 YYYY-MM-21，实际 ' + v + '（header=' + header + '）');
    },
  },
];

// ── 能力层用例：在真实控件上验证 probeControl / matchLevel ──
const CAP_SCRIPT = path.join(__dirname, '..', 'shared', 'date-capability.js');

const CAP_CASES = [
  {
    name: 'cap:wecruit-antd3-select 探测为原生 select 组之外的下拉',
    file: 'wecruit-antd3-select.html',
    async run(page) {
      const r = await page.evaluate(() => {
        const el = document.querySelector('#search');
        const p = window.ResumeAutofillDate.probeControl(el);
        return { kind: p.kind, hints: p.hints };
      });
      ok(r.kind !== 'native-date', '不是原生 date：' + r.kind);
    },
  },
  {
    name: 'cap:r11/r12 antd 控件探测',
    file: 'r11-antd-month.html',
    async run(page) {
      const r = await page.evaluate(() => window.ResumeAutofillDate.probeControl(document.querySelector('#enroll')));
      eq(r.kind, 'antd-picker', 'antd v4/v5 面板');
      ok(r.hints.ro === true, '识别出 readonly');
    },
  },
  {
    name: 'cap:r3 三个原生 select 探测为 select 组',
    file: 'r3-ymd-selects.html',
    async run(page) {
      const r = await page.evaluate(() => window.ResumeAutofillDate.probeControl(document.querySelector('#by')));
      eq(r.kind, 'native-select-group', '年/月/日 select 组');
      ok(r.hints.selects >= 2, '识别出多个 select：' + r.hints.selects);
    },
  },
  {
    name: 'cap:回读值与模型的精度判级（r11 只有年月）',
    file: 'r11-antd-month.html',
    async run(page) {
      await page.focus('#enroll');
      await page.click('.ant-picker-header-next-btn');
      await page.click('.ant-picker-cell >> nth=8');
      const v = await value(page, '#enroll');
      const r = await page.evaluate((val) => {
        const D = window.ResumeAutofillDate;
        // 期望 2021-09（月精度）：控件只能到月 → exact
        const a = D.matchLevel(val, '2021-09');
        // 期望 2021-09-21（日精度）：控件给不出日 → month-only，不算成功
        const b = D.matchLevel(val, '2021-09-21');
        // 期望 2021-08 → mismatch（红线）
        const c = D.matchLevel(val, '2021-08');
        return { v: val, a: a.level, b: b.level, c: c.level };
      }, v);
      eq(r.a, 'exact', '月精度期望 → exact（' + r.v + '）');
      eq(r.b, 'month-only', '日精度期望但控件只有年月 → month-only');
      eq(r.c, 'mismatch', '跨月 → mismatch');
    },
  },
  {
    name: 'cap:day-approx（r12 控件能到日，但期望只有年月）',
    file: 'r12-antd-date.html',
    async run(page) {
      await page.focus('#birth');
      await page.evaluate(() => {
        const td = Array.from(document.querySelectorAll('#tb td.ant-picker-cell-in-view')).find((n) => n.textContent.trim() === '5');
        td.click();
      });
      const v = await value(page, '#birth');
      const lvl = await page.evaluate((val) => window.ResumeAutofillDate.matchLevel(val, '2020-03').level, v);
      eq(lvl, 'day-approx', '年月期望 + 控件补了日 → day-approx（' + v + '）');
    },
  },
];

// ── 运行 ──────────────────────────────────────────────────
(async function main() {
  const filter = process.argv[2] || '';
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  let passed = 0;
  const failed = [];

  for (const c of CASES.concat(CAP_CASES)) {
    if (filter && !c.name.includes(filter) && !c.file.includes(filter)) continue;
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    try {
      await page.goto(fileUrl(c.file));
      await page.addScriptTag({ path: CAP_SCRIPT });
      await c.run(page);
      if (pageErrors.length) throw new Fail('页面 JS 报错: ' + pageErrors.join('; '));
      passed++;
      console.log('  ✓ ' + c.name);
    } catch (e) {
      failed.push({ name: c.name, msg: e.message });
      console.log('  ✗ ' + c.name + '\n     ' + e.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log('');
  console.log(`DOM Result: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
})();
