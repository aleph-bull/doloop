// Background service worker (Manifest V3). Phase 4 adds timer sync, badge, idle, and blocking.

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeText({ text: '' });
});
