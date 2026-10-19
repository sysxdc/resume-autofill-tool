/**
 * 选项页：编辑并保存简历 profile 到 chrome.storage.local
 */

const FIELDS = [
  'name', 'email', 'phone', 'city', 'linkedin',
  'school', 'degree', 'major',
  'company', 'title', 'years',
  'skills', 'summary'
];

const form = document.getElementById('profile-form');
const saveStatus = document.getElementById('save-status');

function readForm() {
  const data = {};
  FIELDS.forEach((key) => {
    const el = form.elements.namedItem(key);
    data[key] = el ? String(el.value || '').trim() : '';
  });
  return data;
}

function writeForm(profile) {
  const p = profile || {};
  FIELDS.forEach((key) => {
    const el = form.elements.namedItem(key);
    if (el) el.value = p[key] || '';
  });
}

function showSaved() {
  saveStatus.textContent = '已保存';
  setTimeout(() => {
    saveStatus.textContent = '';
  }, 2000);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const profile = readForm();
  chrome.storage.local.set({ profile }, () => {
    showSaved();
  });
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('确定清空所有本地简历资料？')) return;
  const empty = {};
  FIELDS.forEach((k) => { empty[k] = ''; });
  chrome.storage.local.set({ profile: empty }, () => {
    writeForm(empty);
    saveStatus.textContent = '已清空';
    setTimeout(() => { saveStatus.textContent = ''; }, 2000);
  });
});

chrome.storage.local.get('profile', (result) => {
  writeForm(result.profile);
});
