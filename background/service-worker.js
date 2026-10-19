/**
 * 简历填写工具 — 后台 Service Worker
 * 安装时初始化空 profile；提供版本 ping。
 */
importScripts('../shared/profile.js');

var P = self.ResumeAutofillProfile;

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') {
    chrome.storage.local.get('profile', function (result) {
      if (!result.profile) {
        chrome.storage.local.set({
          profile: P ? P.emptyProfile() : {}
        });
      }
    });
  }
});

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (message && message.type === 'ping') {
    var manifest = chrome.runtime.getManifest();
    sendResponse({ ok: true, version: manifest.version });
    return true;
  }
  return false;
});
