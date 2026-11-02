const DEFAULTS = {
  enabled: true,
  thumbnailEnabled: true,
  checkIntervalMs: 1000,
  confidenceThreshold: 0.6,
  genderThreshold: 0.55,
  blurPx: 45,
  unblurAfter: 1000,
  sampleWidth: 260,
  targetGender: 'female',
  thumbnailEnabled: true,
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    chrome.storage.sync.set({ ...DEFAULTS, ...stored });
  });
});
