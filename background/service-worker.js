/**
 * 简历填写工具 — 后台 Service Worker（最小化）
 * 负责扩展安装时的初始化，以及 popup / content 之间的消息中转（如需）。
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.get('profile', (result) => {
      if (!result.profile) {
        chrome.storage.local.set({
          profile: {
            name: '',
            email: '',
            phone: '',
            city: '',
            linkedin: '',
            school: '',
            degree: '',
            major: '',
            company: '',
            title: '',
            years: '',
            summary: '',
            skills: ''
          }
        });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ ok: true, version: '1.0.0' });
    return true;
  }
  return false;
});
