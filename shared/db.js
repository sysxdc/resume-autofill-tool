/**
 * v1.4.0：本地简历库（IndexedDB）
 *
 * 为什么用 IndexedDB 而不是 chrome.storage：
 *  - 多份简历 + 原始文本会超过 chrome.storage.local 的配额（默认 10MB）
 *  - 支持按 id 增删改查、按更新时间排序
 *
 * 内容脚本跑在页面源（页面自己的 IndexedDB），所以填充时仍读
 * chrome.storage.local.profile —— 选项页在切换档案时把「当前档案」的
 * profile 同步写入那里，两边不耦合。
 */
(function (root) {
  'use strict';

  var DB_NAME = 'resume-autofill';
  var DB_VERSION = 1;
  var STORE_RESUMES = 'resumes';
  var STORE_META = 'meta';

  var dbPromise = null;

  function request(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('indexedDB request failed')); };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('indexedDB tx failed')); };
      tx.onabort = function () { reject(tx.error || new Error('indexedDB tx aborted')); };
    });
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前环境不支持 IndexedDB'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_RESUMES)) {
          var store = db.createObjectStore(STORE_RESUMES, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('name', 'name');
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
        void e;
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('无法打开本地简历库')); };
    });
    return dbPromise;
  }

  function newId() {
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  /** 统计非空字段数（列表项按 1 条计） */
  function fieldCount(profile) {
    if (!profile) return 0;
    var n = 0;
    for (var k in profile) {
      if (!Object.prototype.hasOwnProperty.call(profile, k)) continue;
      var v = profile[k];
      if (Array.isArray(v)) { if (v.length) n += v.length; continue; }
      if (v && String(v).trim()) n += 1;
    }
    return n;
  }

  function toMeta(rec) {
    return {
      id: rec.id,
      name: rec.name || '未命名简历',
      source: rec.source || {},
      createdAt: rec.createdAt || 0,
      updatedAt: rec.updatedAt || rec.createdAt || 0,
      fieldCount: fieldCount(rec.profile),
      hasText: !!rec.rawText,
      warnings: (rec.warnings || []).slice(0, 6)
    };
  }

  async function listResumes() {
    var db = await openDB();
    var tx = db.transaction(STORE_RESUMES, 'readonly');
    var all = await request(tx.objectStore(STORE_RESUMES).getAll());
    await txDone(tx);
    return (all || []).map(toMeta).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  async function getResume(id) {
    var db = await openDB();
    var tx = db.transaction(STORE_RESUMES, 'readonly');
    var rec = await request(tx.objectStore(STORE_RESUMES).get(id));
    await txDone(tx);
    return rec || null;
  }

  /** 新增或更新；返回元信息 */
  async function saveResume(record) {
    var rec = record || {};
    var now = Date.now();
    if (!rec.id) rec.id = newId();
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = now;
    var db = await openDB();
    var tx = db.transaction(STORE_RESUMES, 'readwrite');
    tx.objectStore(STORE_RESUMES).put(rec);
    await txDone(tx);
    return toMeta(rec);
  }

  async function deleteResume(id) {
    var db = await openDB();
    var tx = db.transaction(STORE_RESUMES, 'readwrite');
    tx.objectStore(STORE_RESUMES).delete(id);
    await txDone(tx);
    if ((await getMeta('activeId')) === id) await setMeta('activeId', null);
  }

  async function getMeta(key) {
    var db = await openDB();
    var tx = db.transaction(STORE_META, 'readonly');
    var row = await request(tx.objectStore(STORE_META).get(key));
    await txDone(tx);
    return row ? row.value : null;
  }

  async function setMeta(key, value) {
    var db = await openDB();
    var tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ key: key, value: value });
    await txDone(tx);
    return value;
  }

  async function getActiveId() {
    return await getMeta('activeId');
  }

  async function getActiveResume() {
    var id = await getActiveId();
    if (!id) return null;
    return await getResume(id);
  }

  async function exportAll() {
    var db = await openDB();
    var tx = db.transaction(STORE_RESUMES, 'readonly');
    var all = await request(tx.objectStore(STORE_RESUMES).getAll());
    await txDone(tx);
    return { version: 1, exportedAt: Date.now(), resumes: all || [] };
  }

  /** 批量导入；同 id 覆盖，无 id 新建 */
  async function importAll(payload) {
    var data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    var list = (data && data.resumes) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var rec = list[i] || {};
      if (!rec.profile) continue;
      out.push(await saveResume({
        id: rec.id || newId(),
        name: rec.name || '导入的简历',
        source: rec.source || { type: 'import' },
        createdAt: rec.createdAt || 0,
        rawText: rec.rawText || '',
        profile: rec.profile,
        warnings: rec.warnings || []
      }));
    }
    return out;
  }

  /** 清空整个库（含 meta） */
  async function clearAll() {
    var db = await openDB();
    var tx = db.transaction([STORE_RESUMES, STORE_META], 'readwrite');
    tx.objectStore(STORE_RESUMES).clear();
    tx.objectStore(STORE_META).clear();
    await txDone(tx);
  }

  var api = {
    DB_NAME: DB_NAME,
    newId: newId,
    fieldCount: fieldCount,
    toMeta: toMeta,
    openDB: openDB,
    listResumes: listResumes,
    getResume: getResume,
    saveResume: saveResume,
    deleteResume: deleteResume,
    getMeta: getMeta,
    setMeta: setMeta,
    getActiveId: getActiveId,
    getActiveResume: getActiveResume,
    exportAll: exportAll,
    importAll: importAll,
    clearAll: clearAll
  };

  root.ResumeAutofillDB = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
