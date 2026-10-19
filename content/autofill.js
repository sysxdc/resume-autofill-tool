/**
 * 简历填写工具 — 内容脚本
 * 根据 name / id / autocomplete / placeholder / label 启发式匹配表单字段，
 * 从 chrome.storage.local 读取 profile 并填写。不自动提交，由用户确认。
 */

(function () {
  'use strict';

  /** @type {Record<string, string[]>} 字段键 → 匹配关键词（小写） */
  const FIELD_KEYWORDS = {
    name: [
      'name', 'fullname', 'full_name', 'full-name', 'yourname', 'your_name',
      'applicant', 'candidate', '姓名', '名字', '真实姓名', '申请人'
    ],
    firstName: [
      'firstname', 'first_name', 'first-name', 'givenname', 'given_name',
      'fname', '名', '名字'
    ],
    lastName: [
      'lastname', 'last_name', 'last-name', 'surname', 'familyname', 'family_name',
      'lname', '姓', '姓氏'
    ],
    email: [
      'email', 'e-mail', 'mail', '邮箱', '电子邮件', '电子邮箱', '邮件'
    ],
    phone: [
      'phone', 'mobile', 'tel', 'telephone', 'cellphone', 'cell',
      'phone_number', 'phonenumber', '电话', '手机', '联系电话', '手机号'
    ],
    city: [
      'city', 'location', 'address_city', 'current_city', '城市', '所在城市',
      '居住城市', '现居城市', '地点'
    ],
    address: [
      'address', 'street', 'addr', 'mailing', '住址', '地址', '详细地址', '通讯地址'
    ],
    linkedin: [
      'linkedin', 'linked-in', 'linkedin_url', 'linkedinurl', 'linked_in'
    ],
    school: [
      'school', 'university', 'college', 'institution', 'edu_school',
      '学校', '大学', '院校', '毕业院校'
    ],
    degree: [
      'degree', 'education', 'edu_level', 'qualification',
      '学历', '学位', '教育程度'
    ],
    major: [
      'major', 'field', 'fieldofstudy', 'field_of_study', 'discipline',
      '专业', '所学专业', '主修'
    ],
    company: [
      'company', 'employer', 'organization', 'org', 'current_company',
      '公司', '工作单位', '现任公司', '雇主'
    ],
    title: [
      'title', 'jobtitle', 'job_title', 'position', 'role', 'current_title',
      '职位', '岗位', '职务', '现任职位'
    ],
    years: [
      'years', 'experience', 'yoe', 'years_of_experience', 'work_years',
      '年限', '工作年限', '经验年限', '工龄'
    ],
    summary: [
      'summary', 'about', 'bio', 'introduction', 'coverletter', 'cover_letter',
      'objective', '自我介绍', '个人简介', '简介', '自我评价', '求职信'
    ],
    skills: [
      'skills', 'skill', 'expertise', 'competencies',
      '技能', '专业技能', '掌握技能', '技术栈'
    ]
  };

  function normalize(str) {
    return (str || '').toLowerCase().replace(/[\s_\-]+/g, '');
  }

  function getLabelText(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent || '';
    }
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent || '';
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const describedBy = el.getAttribute('aria-describedby');
    if (describedBy) {
      const desc = document.getElementById(describedBy);
      if (desc) return desc.textContent || '';
    }
    return '';
  }

  function collectHints(el) {
    const parts = [
      el.name,
      el.id,
      el.getAttribute('autocomplete'),
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('data-testid'),
      el.className,
      getLabelText(el)
    ];
    return normalize(parts.filter(Boolean).join(' '));
  }

  function matchFieldKey(hints) {
    // 更具体的字段优先（firstName/lastName 在 name 之前检查）
    const order = [
      'firstName', 'lastName', 'email', 'phone', 'linkedin',
      'school', 'degree', 'major', 'company', 'title', 'years',
      'skills', 'summary', 'city', 'address', 'name'
    ];
    for (const key of order) {
      const keywords = FIELD_KEYWORDS[key];
      for (const kw of keywords) {
        if (hints.includes(normalize(kw))) return key;
      }
    }
    return null;
  }

  function splitName(fullName) {
    const n = (fullName || '').trim();
    if (!n) return { first: '', last: '' };
    // 中文名：姓 1 字（或少数 2 字复姓简化为第 1 字），名其后
    if (/^[\u4e00-\u9fff]+$/.test(n)) {
      return { first: n.slice(1), last: n.slice(0, 1) };
    }
    const parts = n.split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
  }

  function profileValue(profile, key) {
    if (!profile) return '';
    if (key === 'firstName') return splitName(profile.name).first;
    if (key === 'lastName') return splitName(profile.name).last;
    if (key === 'address') return profile.city || '';
    return profile[key] || '';
  }

  function setNativeValue(el, value) {
    if (el.disabled || el.readOnly) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      const opts = Array.from(el.options);
      const lower = value.toLowerCase();
      let opt =
        opts.find((o) => o.value.toLowerCase() === lower) ||
        opts.find((o) => o.text.toLowerCase() === lower) ||
        opts.find((o) => o.text.toLowerCase().includes(lower) || lower.includes(o.text.toLowerCase()));
      if (!opt) return false;
      el.value = opt.value;
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      return false; // 不自动勾选，避免误操作
    } else {
      const proto =
        tag === 'textarea'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function fillFromProfile(profile) {
    const fields = document.querySelectorAll('input, textarea, select');
    let filled = 0;
    const used = new Set();

    fields.forEach((el) => {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'file' || el.type === 'password') {
        return;
      }
      const hints = collectHints(el);
      const key = matchFieldKey(hints);
      if (!key || used.has(key + '|' + (el.name || el.id))) return;
      const value = profileValue(profile, key);
      if (!value) return;
      if (setNativeValue(el, value)) {
        filled += 1;
        used.add(key + '|' + (el.name || el.id));
        el.style.outline = '2px solid #22c55e';
        setTimeout(() => {
          el.style.outline = '';
        }, 2000);
      }
    });

    return filled;
  }

  async function loadProfileAndFill() {
    return new Promise((resolve) => {
      chrome.storage.local.get('profile', (result) => {
        const profile = result.profile || {};
        const hasData = Object.values(profile).some((v) => v && String(v).trim());
        if (!hasData) {
          resolve({ ok: false, filled: 0, reason: 'empty_profile' });
          return;
        }
        const filled = fillFromProfile(profile);
        resolve({ ok: true, filled });
      });
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'FILL_FORM') {
      loadProfileAndFill().then(sendResponse);
      return true; // 异步响应
    }
    if (message?.type === 'PING_CONTENT') {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
