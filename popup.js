const DEFAULTS = {
  enabled: true,
  thumbnailEnabled: true,
  checkIntervalMs: 1000,
  confidenceThreshold: 0.6,
  genderThreshold: 0.55,
  blurPx: 45,
  unblurAfter: 1000,
  sampleWidth: 260,
  targetGender: 'male',
  manualAllBlur: false
};

const enabledEl = document.getElementById('enabled');
const thumbnailEnabledEl = document.getElementById('thumbnailEnabled');
const targetGenderEl = document.getElementById('targetGender');
const genderThresholdEl = document.getElementById('genderThreshold');
const blurPxEl = document.getElementById('blurPx');
const checkIntervalMsEl = document.getElementById('checkIntervalMs');
const unblurAfterEl = document.getElementById('unblurAfter');
const allBlurBtnEl = document.getElementById('allBlurBtn');

const genderThresholdValueEl = document.getElementById('genderThresholdValue');
const blurPxValueEl = document.getElementById('blurPxValue');
const checkIntervalMsValueEl = document.getElementById('checkIntervalMsValue');
const unblurAfterValueEl = document.getElementById('unblurAfterValue');

function refreshLabels(s) {
  genderThresholdValueEl.textContent = `${Math.round(s.genderThreshold * 100)}%`;
  blurPxValueEl.textContent = `${s.blurPx}px`;
  checkIntervalMsValueEl.textContent = `${s.checkIntervalMs}ms`;
  unblurAfterValueEl.textContent = `${s.unblurAfter / 1000}s`;
}

function updateAllBlurButton(isActive) {
  allBlurBtnEl.textContent = isActive ? 'All Blur: ON' : 'All Blur: OFF';
  allBlurBtnEl.style.background = isActive ? '#ea4335' : '#1a73e8';
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  enabledEl.checked = s.enabled;
  thumbnailEnabledEl.checked = s.thumbnailEnabled;
  targetGenderEl.value = s.targetGender;
  genderThresholdEl.value = s.genderThreshold;
  blurPxEl.value = s.blurPx;
  checkIntervalMsEl.value = s.checkIntervalMs;
  unblurAfterEl.value = s.unblurAfter;
  refreshLabels(s);

  // Get current state from content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'getManualBlurState' }, (response) => {
        if (response !== undefined) {
          updateAllBlurButton(response.manualBlurActive);
        }
      });
    }
  });
});

function save() {
  const s = {
    enabled: enabledEl.checked,
    thumbnailEnabled: thumbnailEnabledEl.checked,
    targetGender: targetGenderEl.value,
    genderThreshold: parseFloat(genderThresholdEl.value),
    blurPx: parseInt(blurPxEl.value, 10),
    checkIntervalMs: parseInt(checkIntervalMsEl.value, 10),
    unblurAfter: parseInt(unblurAfterEl.value, 10)
  };
  refreshLabels(s);
  chrome.storage.sync.set(s);
}

[enabledEl, thumbnailEnabledEl, targetGenderEl, genderThresholdEl, blurPxEl, checkIntervalMsEl, unblurAfterEl].forEach((el) =>
  el.addEventListener('input', save)
);

allBlurBtnEl.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'toggleManualBlur' }, (response) => {
        if (response !== undefined) {
          updateAllBlurButton(response.manualBlurActive);
        }
      });
    }
  });
});
