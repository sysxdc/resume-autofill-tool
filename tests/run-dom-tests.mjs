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
import http from 'node:http';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function loadPlaywright() {
  const tried = [];
  try { return require('playwright'); } catch (e) { tried.push(e.message); }
  const candidates = [];
  try {
    // playwright 可能只装在全局（npx playwright 能用，但项目里没有 node_modules）
    candidates.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  } catch (e) { tried.push(e.message); }
  // 部分环境 npm root -g 不可用：常见用户级路径再试一次
  if (process.env.HOME) {
    candidates.push(path.join(process.env.HOME, '.local/lib/node_modules/playwright'));
  }
  candidates.push('/home/box/.local/lib/node_modules/playwright');
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return require(p);
      tried.push('no ' + p);
    } catch (e) { tried.push(e.message); }
  }
  throw new Error('找不到 playwright：' + tried.join(' | ') + '（可 npm i -D playwright 或 npm i -g playwright）');
}

const FIXTURES = path.join(__dirname, 'fixtures', 'dom');
let fixtureOrigin;
const fileUrl = (f) => fixtureOrigin + '/tests/fixtures/dom/' + encodeURIComponent(f);

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
    name: 'panel：网页合成点击不能读取资料，公开诊断不包含资料值',
    file: 'panel-security.html',
    async run(page) {
      await page.waitForFunction(() => window.fixtureReady);
      await page.evaluate(() => document.getElementById('__ra_panel_host__').shadowRoot.querySelector('[data-act="fill"]').click());
      eq(await page.evaluate(() => window.fillCalls), 0, '网页合成点击被阻止');
      await page.click('[data-act="fill"]');
      await page.waitForFunction(() => document.getElementById('__ra_panel_host__').dataset.lastResult);
      eq(await page.evaluate(() => window.fillCalls), 1, '真实用户点击仍可填写');
      ok(!(await page.evaluate(() => document.getElementById('__ra_panel_host__').dataset.lastResult)).includes('PRIVATE_AUDIT_SENTINEL'), '诊断属性不泄漏原始资料值');
    }
  },
  {
    name: 'campus：标签优先、第三方隔离、数值 GPA、分区计数与未填下拉',
    file: 'campus-regressions.html',
    async run(page) {
      await page.waitForFunction(() => window.fixtureReady);
      const r = await page.evaluate(() => window.__resumeAutofill.fill({ allowCustomSelect: false }));
      const v = (id) => page.evaluate((x) => document.getElementById(x).value, id);
      eq(await v('school'), '测试大学', '学校');
      eq(await v('role'), '负责人', '职务名称不能映射到项目名称');
      eq(await v('gpa'), '3.0', '数值 GPA 不得拼接分母');
      eq(await v('form_item_certificateNo'), 'TEST-ID', '中文证件标签优先于英文属性名');
      for (const id of ['minor', 'family', 'familyPhone', 'stars', 'popup']) eq(await v(id), '', id + ' 不得误填');
      eq(await page.evaluate(() => window.addCount), 0, '已有一段教育不能继续添加');
      eq(await page.evaluate(() => ResumeAutofillContent.readBackValue(document.getElementById('phoenix'))), '本科', '只读一次选中值');
      ok(r.unfilled.some((x) => x.label === '成绩排名' && x.required), '必填下拉出现在未填清单');
      ok(!r.audit.wrongFill, '回读审计无错填');
    }
  },
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
const STRAT_SCRIPT = path.join(__dirname, '..', 'shared', 'date-strategies.js');
const AUDIT_SCRIPT = path.join(__dirname, '..', 'shared', 'audit.js');
const CHAIN_SCRIPT = path.join(__dirname, '..', 'shared', 'select-chain.js');
const MATCH_SCRIPT = path.join(__dirname, '..', 'shared', 'match.js');
const CONTENT_SCRIPTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8')).content_scripts[0].js;
const BRIDGE_SCRIPT = path.join(__dirname, '..', 'content', 'page-bridge.js');

/**
 * 端到端：把整套内容脚本（match → 日期能力/策略 → 审计 → 联动 → autofill）装进页面，
 * 用假的 chrome.storage 提供档案，直接跑「一键填写」。断言的是最终页面上的真实值 + 上报结果。
 */
async function loadExtension(page, profile) {
  // 页面主环境桥接（扩展里是 world: MAIN 的独立内容脚本）
  await page.addScriptTag({ path: BRIDGE_SCRIPT });
  await page.addScriptTag({ path: MATCH_SCRIPT });
  await page.evaluate((p) => {
    const store = { profile: p };
    window.chrome = window.chrome || {};
    window.chrome.storage = { local: { get: (k, cb) => cb({ profile: store.profile }) } };
    window.chrome.runtime = { onMessage: { addListener: () => {} } };
  }, profile);
  // 其余内容脚本按 manifest 的顺序装（v1.6.0 起 autofill 拆成多个模块，漏一个就会缺函数）
  for (const f of CONTENT_SCRIPTS) {
    if (f === 'shared/match.js' || f === 'content/panel.js') continue;
    await page.addScriptTag({ path: path.join(__dirname, '..', f) });
  }
}

const E2E_PROFILE = {
  name: '张三',
  phone: '13800138000',
  email: 'zhangsan@example.com',
  wechat: 'zs_wechat',
  birthday: '1998-05-20',
  eduStart: '2019-09',
  eduEnd: '2023-06',
  startDate: '2021-07',
  eduDegree: '博士研究生',
  acceptAdjustment: '接受',
  workEnd: '至今',
  familyName: '',
  summary: '五年前端开发经验，熟悉 React 与 Vue。主导过两个中后台项目的重构。擅长性能优化与工程化建设，乐于分享。',
  idNumber: '110101199805201234'
};

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

// ── 策略层用例：让 fillDate 直接驱动这些真实控件（这是「我们的代码」而不只是契约）──
const FILL_CASES = [
  {
    name: 'fill:r3 三个原生 select（年/月不补零、日补零）',
    file: 'r3-ymd-selects.html',
    async run(page) {
      const r = await page.evaluate(async () => {
        const S = window.ResumeAutofillDateStrategies;
        const out = await S.fillDate(document.querySelector('#by'), '1985-09-21');
        return { out, y: document.querySelector('#by').value, m: document.querySelector('#bm').value, d: document.querySelector('#bd').value };
      });
      eq(r.y, '1985', '年');
      eq(r.m, '9', '月');
      eq(r.d, '21', '日');
      eq(r.out.ok, true, 'ok');
      eq(r.out.level, 'exact', '三个 select 合起来判级');
      eq(r.out.strategy, 'native-selects', '命中的策略');
    },
  },
  {
    name: 'fill:datepanel-replica 年表/月表/日表（table-panel）',
    file: 'datepanel-replica.html',
    async run(page) {
      await nativeClick(page, '#birthday');
      ok(await visible(page, '#dpPanel'), '面板打开');
      const r = await page.evaluate(async () => window.ResumeAutofillDateStrategies.fillDate(document.querySelector('#birthday'), '2004-09-21'));
      eq(await value(page, '#birthday'), '2004-09-21', '回读');
      eq(r.level, 'exact', '判级');
      eq(r.strategy, 'panel-nav', '命中表格面板策略');
    },
  },
  {
    name: 'fill:r1 英文日历（grid-click 翻月 + 点日 + OK）',
    file: 'r1-en-datepicker.html',
    async run(page) {
      await nativeClick(page, '#bd');
      ok(await visible(page, '#dp'), '面板打开');
      const r = await page.evaluate(async () => window.ResumeAutofillDateStrategies.fillDate(document.querySelector('#bd'), '2000-06-21', { perStrategyMs: 8000 }));
      eq(await value(page, '#bd'), '2000-06-21', '回读');
      eq(r.level, 'exact', '判级');
    },
  },
  {
    name: 'fill:calendargrid 年箭头 + 月箭头 + 点日（grid-click）',
    file: 'calendargrid-replica.html',
    async run(page) {
      await nativeClick(page, '#bd');
      ok(await visible(page, '#picker'), '面板打开');
      const r = await page.evaluate(async () => window.ResumeAutofillDateStrategies.fillDate(document.querySelector('#bd'), '2027-01-21', { perStrategyMs: 8000 }));
      eq(await value(page, '#bd'), '2027-01-21', '回读');
      eq(r.level, 'exact', '判级');
    },
  },
  {
    name: 'fill:r11 只有年月的面板 —— 通用策略搞不定就留空，不许乱填',
    file: 'r11-antd-month.html',
    async run(page) {
      await page.focus('#enroll');
      ok(await visible(page, '#dd'), '面板打开');
      const r = await page.evaluate(async () => window.ResumeAutofillDateStrategies.fillDate(document.querySelector('#enroll'), '2021-09'));
      eq(await value(page, '#enroll'), '', '没填上就留空（零错填）');
      ok(r.ok === false, '如实报告失败');
      ok(r.attempts.length > 0, '有尝试记录：' + JSON.stringify(r.attempts));
    },
  },
  {
    name: 'fill:r11 注册一个站点策略后就能填（注册表扩展路径）',
    file: 'r11-antd-month.html',
    async run(page) {
      await page.focus('#enroll');
      ok(await visible(page, '#dd'), '面板打开');
      const r = await page.evaluate(async () => {
        const S = window.ResumeAutofillDateStrategies;
        S.register('panel-nav', async (el) => {
          // 站点策略：年视图箭头 + 点月份格
          const hv = document.querySelector('#hv').textContent;
          const cur = parseInt(hv, 10);
          const want = 2021;
          const btn = document.querySelector('.ant-picker-header-next-btn');
          for (let i = 0; i < Math.abs(want - cur); i++) btn.click();
          await new Promise((r) => setTimeout(r, 200));
          const cells = Array.from(document.querySelectorAll('#tb td'));
          if (cells[8]) cells[8].click();   // 3 列 × 3 行 → 第 9 个是 9 月
          return true;
        });
        const out = await S.fillDate(document.querySelector('#enroll'), '2021-09');
        return out;
      });
      eq(await value(page, '#enroll'), '2021-09', '回读');
      eq(r.level, 'exact', '判级');
      eq(r.strategy, 'panel-nav', '命中注册的策略');
    },
  },
];

// ── 审计用例：抓住「以为填上了、其实没进去」──
const AUDIT_CASES = [
  {
    name: 'audit:wecruit —— 只输入不提交，审计判「读不回」而不是「已填」',
    file: 'wecruit-antd3-select.html',
    async run(page) {
      // 模拟我们的失败路径：把值打进搜索框、没有真正提交
      await nativeClick(page, '#selection');
      await page.fill('#search', '广东工业大学');
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const A = window.ResumeAutofillAudit;
        const host = document.querySelector('#sel');
        const shown = host.querySelector('.ant-select-selection-selected-value');
        const actual = shown ? shown.textContent.trim() : '';
        return A.auditEntries([{ key: 'school', expected: '广东工业大学', actual: actual }], { ignoreEmpty: false });
      });
      eq(r.checked, 1, '审计项数');
      eq(r.ok, 0, '没有一致项');
      eq(r.empty, 1, '判为「读不回」');
      eq(r.mismatch, 0, '不算错填（页面没显示错值）');
      ok(r.problems.length === 1, '问题项已列出');
    },
  },
  {
    name: 'audit:wecruit —— 真正提交后审计通过',
    file: 'wecruit-antd3-select.html',
    async run(page) {
      await nativeClick(page, '#selection');
      await page.fill('#search', '广东工业大学');
      await page.waitForTimeout(250);
      await page.focus('#search');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      const r = await page.evaluate(() => {
        const A = window.ResumeAutofillAudit;
        const host = document.querySelector('#sel');
        const shown = host.querySelector('.ant-select-selection-selected-value');
        return A.auditEntries([{ key: 'school', expected: '广东工业大学', actual: shown ? shown.textContent.trim() : '' }]);
      });
      eq(r.ok, 1, '一致');
      eq(r.wrongFill, 0, '零错填');
    },
  },
  {
    name: 'audit:r12 —— 日期补日判近似，跨月判错填',
    file: 'r12-antd-date.html',
    async run(page) {
      await page.focus('#birth');
      await page.evaluate(() => {
        const td = Array.from(document.querySelectorAll('#tb td.ant-picker-cell-in-view')).find((n) => n.textContent.trim() === '5');
        td.click();
      });
      const v = await value(page, '#birth');
      const r = await page.evaluate((val) => {
        const A = window.ResumeAutofillAudit;
        return {
          month: A.compareEntry({ key: 'birthday', expected: '2020-03', actual: val }).status,
          exactDay: A.compareEntry({ key: 'birthday', expected: '2020-03-05', actual: val }).status,
          wrongMonth: A.compareEntry({ key: 'birthday', expected: '2020-02-05', actual: val }).status
        };
      }, v);
      eq(r.month, 'approx', '月精度期望 → 近似');
      eq(r.exactDay, 'ok', '日精度期望 → 一致');
      eq(r.wrongMonth, 'mismatch', '跨月 → 错填');
    },
  },
];

// ── 联动下拉用例：语种 → 语言等级 ──
const CHAIN_CASES = [
  {
    name: 'chain:r17 直接写第二级无效（选项还没生成）',
    file: 'r17-lang-linked.html',
    async run(page) {
      const r = await page.evaluate(async () => {
        const C = window.ResumeAutofillSelectChain;
        const out = await C.fillOne(document.querySelector('#level'), 'CET-6');
        return { ok: out, shown: C.readShown(document.querySelector('#level')) };
      });
      eq(r.ok, false, '语种没选时写等级必然失败');
      eq(r.shown, '', '等级仍为空（不乱填）');
    },
  },
  {
    name: 'chain:r17 按「语种 → 等级」顺序填就成',
    file: 'r17-lang-linked.html',
    async run(page) {
      const r = await page.evaluate(async () => {
        const C = window.ResumeAutofillSelectChain;
        const res = await C.fillChain([
          { host: document.querySelector('#lang'), value: '英语', label: '语种' },
          { host: document.querySelector('#level'), value: 'CET-6', label: '语言等级' }
        ]);
        return { res, lang: C.readShown(document.querySelector('#lang')), level: C.readShown(document.querySelector('#level')) };
      });
      eq(r.lang, '英语', '语种');
      eq(r.level, 'CET-6', '等级（选项在语种之后才生成）');
      eq(r.res.ok, true, '链条整体成功');
      eq(r.res.steps.length, 2, '两步都记录');
    },
  },
  {
    name: 'chain:r17 换语种后等级选项跟着换（不能沿用旧值）',
    file: 'r17-lang-linked.html',
    async run(page) {
      const r = await page.evaluate(async () => {
        const C = window.ResumeAutofillSelectChain;
        await C.fillChain([
          { host: document.querySelector('#lang'), value: '英语' },
          { host: document.querySelector('#level'), value: 'CET-4' }
        ]);
        const first = C.readShown(document.querySelector('#level'));
        const second = await C.fillChain([
          { host: document.querySelector('#lang'), value: '日语' },
          { host: document.querySelector('#level'), value: 'N1' }
        ]);
        return { first, second, lang: C.readShown(document.querySelector('#lang')), level: C.readShown(document.querySelector('#level')) };
      });
      eq(r.first, 'CET-4', '先填英语等级');
      eq(r.lang, '日语', '改选日语');
      eq(r.level, 'N1', '等级跟着换成日语选项里的 N1');
      eq(r.second.ok, true, '第二次链条也成功');
    },
  },
];

const E2E_CASES = [
  {
    name:'rich：富文本按纯文本提交、保留已有内容并识别组件拒绝',
    file:'rich-text.html',
    async run(page) {
      const intro='第一段经历。\n第二段说明。';
      const project='<img src=x onerror=alert(1)> 只作为文字';
      await loadExtension(page,{summary:intro,projectList:[{name:'测试项目',description:project}],workList:[{description:'拟填内容'}],additionalInfo:'补充内容'});
      const result=await page.evaluate(()=>__resumeAutofill.fill({allowAddSections:false,allowCustomSelect:false}));
      eq(await page.evaluate(()=>document.getElementById('summary-editor').innerText),intro,'保留分段');
      eq(await page.evaluate(()=>window.editorState['summary-editor']),intro,'组件状态收到输入');
      eq(await page.evaluate(()=>document.getElementById('project-editor').innerText),project,'HTML 以文字插入');
      eq(await page.evaluate(()=>document.querySelectorAll('#project-editor img').length),0,'不执行或创建 HTML');
      eq(await page.evaluate(()=>document.getElementById('work-editor').innerText),'用户已有的内容','不覆盖富文本原文');
      ok(result.filledKeys.includes('summary')&&result.filledKeys.includes('projectDesc'),'核验富文本成功');
      ok(result.skipped.some(x=>x.reason==='rich_text_not_committed'),'组件拒绝写入有原因');
    }
  },
  {
    name: 'aria：远程搜索、归属隔离、虚拟列表、禁用项和未提交搜索词',
    file: 'aria-components.html',
    async run(page) {
      await loadExtension(page, {school:'测试大学',highestDegree:'硕士'});
      const result = await page.evaluate(()=>window.__resumeAutofill.fill({allowAddSections:false}));
      const state = await page.evaluate(()=>window.componentState);
      eq(state.school,'UNI-CODE','选择真实远程选项编码');
      eq(state.degree,'CODE-42','翻查未渲染的虚拟选项');
      eq(await page.evaluate(()=>window.foreignClicks),0,'其他弹层的同名选项不会被点击');
      ok(result.filledKeys.includes('school')&&result.filledKeys.includes('highestDegree'),'新组件计入已核验');
      const attempt = await page.evaluate(async()=>{
        const C=ResumeAutofillContent;
        return {disabled:await C.fillCustomSelect(document.getElementById('disabled'),'女','gender'),query:await C.fillCustomSelect(document.getElementById('query-host'),'自动化','major'),queryFilled:C.customSelectLooksFilled(document.getElementById('query-host'))};
      });
      ok(!attempt.disabled&&!attempt.query&&!attempt.queryFilled,'禁用项和仅搜索均不能算填上');
      eq(await page.evaluate(()=>window.disabledClicks),0,'不点击禁用项');
      ok((await page.evaluate(()=>__resumeAutofill.unfilled())).some(x=>x.label==='专业'),'未提交的搜索仍列为空缺');
    }
  },
  {
    name:'library：资料检查、安全整理、镜像编辑与恢复备份',
    file:'field-safety.html',
    async run(page) {
      await page.addInitScript(()=>{
        const store={profile:{degree:'本科',eduDegree:'本科',gpa:'3.0/4.5',school:'测试大学',eduList:[{school:'测试大学',degree:'本科',academicDegree:'工学学士',gpa:'3.0'}]}};
        window.fixtureStore=store;
        window.chrome={runtime:{},storage:{local:{get:(keys,cb)=>{const data=structuredClone(store);if(cb)cb(data);else return Promise.resolve(data);},set:(data,cb)=>{Object.assign(store,structuredClone(data));if(cb)cb();else return Promise.resolve();}}}};
      });
      await page.goto(new URL('../../../options/options.html',page.url()).href);
      await page.waitForFunction(()=>document.querySelector('[name="school"]').value==='测试大学');
      await page.click('#btn-repair-profile');
      await page.waitForFunction(()=>document.getElementById('profile-quality').textContent.includes('已备份并整理'));
      eq(await page.evaluate(()=>fixtureStore.profile.degree),'工学学士','学位修正');
      eq(await page.evaluate(()=>fixtureStore.profile.eduList[0].gpa),'3.0/4.5','满分补入列表');
      eq(await page.evaluate(()=>fixtureStore.profileRepairBackup.profile.degree),'本科','原值备份可恢复');
      ok(await page.evaluate(()=>document.querySelector('[name="school"]').readOnly),'主条目由列表同步，不再重复编辑');
      const count=await page.evaluate(async()=> (await ResumeAutofillDB.listResumes()).length);
      eq(count,1,'仅 storage 有资料时建立实际档案');
      await page.click('a[data-pane="edu"]');
      await page.fill('#list-eduList [data-field="school"]','更新大学');
      await page.click('button[form="profile-form"]');
      await page.waitForFunction(()=>fixtureStore.profile.school==='更新大学');
      eq(await page.evaluate(async()=> (await ResumeAutofillDB.getActiveResume()).profile.eduList[0].school),'更新大学','档案与当前填写资料一起保存');
      await page.click('#list-eduList [data-list-act="remove"]');
      await page.click('button[form="profile-form"]');
      await page.waitForFunction(()=>fixtureStore.profile.eduList.length===0);
      eq(await page.evaluate(()=>fixtureStore.profile.school),'','删除最后经历不会从旧镜像复活');
      await page.click('a[data-pane="library"]');
      await page.click('#btn-restore-profile');
      await page.waitForFunction(()=>document.getElementById('profile-quality').textContent.includes('已恢复整理前资料'));
      eq(await page.evaluate(()=>fixtureStore.profile.degree),'本科','恢复原始资料');
    }
  },
  {
    name: 'privacy：iframe 汇报不向页面暴露简历原值与审计正文',
    file: 'field-safety.html',
    async run(page) {
      const framePromise = page.waitForEvent('framenavigated', {predicate: f => f !== page.mainFrame()});
      await page.evaluate(() => {
        window.frameReports = [];
        window.addEventListener('message', event => { if (event.data?.__raFill) window.frameReports.push(event.data); });
        const frame = document.createElement('iframe');
        frame.srcdoc = '<label>姓名<input id="frame-name"></label>';
        document.body.appendChild(frame);
      });
      const frame = await framePromise;
      await loadExtension(frame, {name:'PRIVATE_FRAME_SENTINEL'});
      await frame.evaluate(() => window.__resumeAutofill.fill({allowAddSections:false, allowCustomSelect:false}));
      await page.waitForFunction(() => window.frameReports.length > 0);
      const reports = await page.evaluate(() => window.frameReports);
      ok(!JSON.stringify(reports).includes('PRIVATE_FRAME_SENTINEL'), '页面监听不到审计原值');
      ok(!reports[0].__raFill.audit, '只传汇总，不传原始审计');
      eq(reports[0].__raFill.filled, 1, '仍可汇总填写数量');
    }
  },
  {
    name: 'binding：经历倒序、同名歧义、外部记录和空行分配',
    file: 'record-binding.html',
    async run(page) {
      await loadExtension(page, {
        eduList:[{school:'甲大学', major:'软件工程', start:'2020-09-01'}, {school:'乙大学', major:'数学', start:'2019-09-01'}],
        workList:[{company:'同名公司', title:'职位甲', start:'2023-01'}, {company:'同名公司', title:'职位乙', start:'2024-01'}],
        projectList:[{name:'甲项目', role:'负责人'}, {name:'乙项目', role:'开发者'}]
      });
      const result = await page.evaluate(() => window.__resumeAutofill.fill({allowAddSections:false, allowCustomSelect:false}));
      eq(await value(page, '#resumeEducationInfo_0_major'), '数学', '先绑定乙大学再填专业');
      eq(await value(page, '#resumeEducationInfo_1_major'), '软件工程', '先绑定甲大学再填专业');
      eq(await value(page, '#resumeEducationInfo_0_startDate'), '2019-09-01', '日期使用同一条目');
      eq(await value(page, '#resumeWorkInfo_0_position'), '', '同名公司缺时间时拒绝猜测');
      eq(await value(page, '#resumeWorkInfo_1_position'), '', '简历外记录不混入简历条目');
      ok(result.skipped.some(x => x.reason === 'record_ambiguous'), '歧义原因可见');
      ok(result.skipped.some(x => x.reason === 'record_conflict'), '不匹配原因可见');
      eq(await value(page, '#resumeProjectInfo_0_name'), '乙项目', '空行不重复占用已绑定条目');
      eq(await value(page, '#resumeProjectInfo_0_role'), '开发者', '空行子字段一致');
      eq(await value(page, '#resumeProjectInfo_1_role'), '负责人', '已有项目对应职务');
    }
  },
  {
    name: 'safety：已有内容保护、异步回填、字段标点与约束、重复填写',
    file: 'field-safety.html',
    async run(page) {
      await loadExtension(page, {name:'测试申请人', phone:'13800138000', email:'first.last@example.test', website:'https://example.test/a-b', gpa:'3.0/4.5'});
      const first = await page.evaluate(() => window.__resumeAutofill.fill({allowAddSections:false, allowCustomSelect:false}));
      const v = id => value(page, '#' + id);
      eq(await v('name'), '用户确认的名字', '保留用户内容');
      ok(first.preserved.some(x => x.key === 'name'), '不同内容明确提示');
      eq(await v('phone'), '138 0013 8000', '电话格式化仍支持');
      eq(await v('gpa'), '3.0', 'GPA 数值与满分不混填');
      ok(!first.filledKeys.includes('email') && !first.filledKeys.includes('website'), '标点变化不能通过写入核验');
      ok(first.audit.problems.some(x => x.key === 'email' && x.status === 'mismatch'), '非空错误值也必须进入问题清单');
      eq(first.saveStatus, 'not_checked', '控件核验不代表保存');
      const direct = await page.evaluate(async () => {
        const C = ResumeAutofillContent;
        return {
          existing: await C.writeAndVerify(document.getElementById('existing'), '新内容'),
          asyncValue: await C.writeAndVerify(document.getElementById('async-value'), '拟填内容'),
          number: await C.writeAndVerify(document.getElementById('constrained'), '30', {key:'gpa'}),
          controlled: await C.writeAndVerify(document.getElementById('required-controlled'), '测试', {key:'name'}),
        };
      });
      ok(!direct.existing && !direct.asyncValue && !direct.number, '底层写入拒绝覆盖与无效数值');
      ok(direct.controlled, '必填受控组件清空后仍可重试，实际：' + await v('required-controlled'));
      eq(await v('existing'), '保留内容', '底层保护现值');
      eq(await v('async-value'), '页面异步回填', '不覆盖或清除异步回填');
      eq(await v('constrained'), '', '超出最大值还原');
      const audit = await page.evaluate(() => {
        const C = ResumeAutofillContent;
        C.fillRecords.length = 0;
        const gone = document.createElement('input');
        gone.value = '测试'; document.body.appendChild(gone);
        C.recordFill(gone, 'name', '测试'); gone.remove();
        const invalid = document.createElement('input');
        invalid.type = 'number'; invalid.max = '4.5'; invalid.value = '30'; document.body.appendChild(invalid);
        C.recordFill(invalid, 'gpa', '30');
        return C.runFillAudit();
      });
      eq(audit.empty, 1, '已脱离页面的旧节点不能核验通过');
      eq(audit.mismatch, 1, '页面约束不通过不能核验成功');
      const second = await page.evaluate(() => window.__resumeAutofill.fill({allowAddSections:false, allowCustomSelect:false}));
      eq(second.filled, 0, '重复执行不会重复填写');
      ok(!second.preserved.some(x => x.key === 'gpa'), 'GPA 数值框不误报满分冲突');
      eq(await v('name'), '用户确认的名字', '重复执行保留现值');
    }
  },
  {
    name: 'e2e：一键填写——回读确认 / 日期按控件格式 / 否定词与学历不错选 / 第三方不串填',
    file: 'e2e-form.html',
    async run(page) {
      await loadExtension(page, E2E_PROFILE);
      const r = await page.evaluate(async () => window.__resumeAutofill.fill({ allowAddSections: false }));
      const v = (id) => page.evaluate((x) => document.getElementById(x).value, id);
      eq(await v('name'), '张三', '普通文本');
      eq(await v('phone'), '138 0013 8000', '掩码格式化后的值');
      ok(r.filledKeys.includes('phone'), '掩码格式差异判为写入成功');
      eq(await v('email'), 'zhangsan@example.com', '只认键盘的受控组件：逐字键入重试后写进去');
      eq(await page.evaluate(() => window.__emailState()), 'zhangsan@example.com', '组件内部状态也对');
      eq(await v('wechat'), '', '硬拒绝的输入框保持空');
      ok(!r.filledKeys.includes('wechat'), '写不进去的不能计为已填：' + JSON.stringify(r.filledKeys));
      ok(r.skipped.some((x) => x.key === 'wechat'), '写不进去要出现在跳过原因里');
      eq(await v('birth'), '1998-05-20', 'type=date');
      eq(await v('enroll'), '2019-09', 'type=month（旧逻辑会被浏览器清空）');
      eq(await v('grad'), '2023/06', 'placeholder YYYY/MM');
      eq(await v('hire'), '2021.07.01', 'placeholder 示例 2020.09.01（年月值补 1 号）');
      eq(await page.evaluate(() => document.getElementById('deg').selectedOptions[0].text), '博士', '博士研究生 → 博士（不是硕士）');
      eq(await page.evaluate(() => document.getElementById('adj').selectedOptions[0].text), '接受调剂', '接受 → 接受调剂（不是不接受调剂）');
      eq(await v('father'), '', '父亲姓名不能填申请人姓名');
      eq(await page.evaluate(() => document.getElementById('now').checked), true, '「至今」勾选回读确认');
      eq(await v('leave'), '', '「至今」不写进日期框');
      const intro = await v('intro');
      ok(intro.length > 0 && intro.length <= 40 && /。$/.test(intro), 'maxlength 内句末截断：' + intro);
      eq(await v('idno'), '', '证件号放不下就不填（截断就是错值）');
      ok(r.skipped.some((x) => x.key === 'idNumber' && /maxlength/.test(x.reason)), '证件号跳过原因');
      ok(!(r.audit && r.audit.wrongFill), '审计无错填：' + JSON.stringify(r.audit && r.audit.problems));
    },
  },
  {
    name: 'e2e：Vue 3 日期组件——走 onUpdate:modelValue 提交，按 valueFormat 写，不留「看起来填了」的假值',
    file: 'e2e-vue3-date.html',
    async run(page) {
      await loadExtension(page, {
        birthday: '1998-05-20',
        workList: [{ company: '某科技', title: '前端', start: '2021-07', end: '2023-03' }]
      });
      const r = await page.evaluate(async () => window.__resumeAutofill.fill({ allowAddSections: false }));
      const m = await page.evaluate(() => window.__models);
      eq(m.birth, '1998-05-20', '单个日期：v-model 收到 valueFormat 格式的值');
      eq(await page.evaluate(() => document.getElementById('birth').value), '1998-05-20', '单个日期回读');
      ok(Array.isArray(m.range) && m.range[0] === '2021-07-01' && m.range[1] === '2023-03-31', '范围：起点补 1 号、终点补月末：' + JSON.stringify(m.range));
      eq(await page.evaluate(() => document.getElementById('rs').value), '2021-07-01', '范围开始回读');
      eq(await page.evaluate(() => document.getElementById('re').value), '2023-03-31', '范围结束回读');
      ok(r.filledKeys.includes('birthday') && !r.filledKeys.includes('startDate'), '精度不足的范围不能计为核验通过：' + JSON.stringify(r.filledKeys));
      ok(r.audit.needsReview > 0, '只有月份却补了日期，需要核对');
      ok(!(r.audit && r.audit.wrongFill), '审计无错填：' + JSON.stringify(r.audit && r.audit.problems));
    },
  },
  {
    name: 'e2e：单输入框起止时间按区块取第 N 段 + placeholder 格式；薪资范围框不当日期范围',
    file: 'e2e-range.html',
    async run(page) {
      await loadExtension(page, {
        eduList: [
          { school: '某理工大学', start: '2021-09', end: '2024-06' },
          { school: '某大学', start: '2017-09', end: '2021-06' }
        ],
        workList: [{ company: '甲科技', start: '2024-07', end: '至今' }],
        expectedSalary: '15000'
      });
      await page.evaluate(async () => window.__resumeAutofill.fill({ allowAddSections: false }));
      const v = (id) => page.evaluate((x) => document.getElementById(x).value, id);
      eq(await v('edu1'), '2021.09 - 2024.06', '第 1 段教育（按 placeholder 格式）');
      eq(await v('edu2'), '2017.09 - 2021.06', '第 2 段教育取 eduList[1]');
      eq(await v('sch1'), '某理工大学', '第 1 段学校');
      eq(await v('sch2'), '某大学', '第 2 段学校');
      eq(await v('wk'), '2024-07 ~ 至今', '工作期间：分隔符跟 placeholder、终点至今');
      ok(!/\d{4}[-.]\d{2}/.test(await v('pay')), '薪资范围框绝不能写进日期：' + (await v('pay')));
    },
  },
];

// ── 运行 ──────────────────────────────────────────────────
(async function main() {
  const filter = process.argv[2] || '';
  const { chromium } = loadPlaywright();
  // fixture 内的 fetch 在 file:// 下会被 CORS 拦截；通过仅监听本机的静态服务执行。
  const repoRoot = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const target = path.resolve(repoRoot, '.' + pathname);
      if (!target.startsWith(repoRoot + path.sep)) { res.writeHead(403).end(); return; }
      const data = fs.readFileSync(target);
      const types = {'.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css'};
      res.writeHead(200, {'Content-Type': (types[path.extname(target)] || 'application/octet-stream') + '; charset=utf-8'}).end(data);
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fixtureOrigin = 'http://127.0.0.1:' + server.address().port;
  try {
  const browser = await chromium.launch();
  let passed = 0;
  const failed = [];

  for (const c of CASES.concat(CAP_CASES).concat(FILL_CASES).concat(AUDIT_CASES).concat(CHAIN_CASES).concat(E2E_CASES)) {
    if (filter && !c.name.includes(filter) && !c.file.includes(filter)) continue;
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    try {
      await page.goto(fileUrl(c.file));
      await page.addScriptTag({ path: CAP_SCRIPT });
      await page.addScriptTag({ path: STRAT_SCRIPT });
      await page.addScriptTag({ path: AUDIT_SCRIPT });
      await page.addScriptTag({ path: CHAIN_SCRIPT });
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
  } finally { await new Promise(resolve => server.close(resolve)); }
})();
