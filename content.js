/* eslint-disable no-undef */
/**
 * YouTube Male Face Blur - content script
 * Runs on youtube.com and m.youtube.com (Firefox Android too, same DOM).
 *
 * Strategy:
 * 1. Find the active <video> element.
 * 2. Every CHECK_INTERVAL_MS, draw the current frame onto a small hidden
 *    canvas and run face-api.js (tiny face detector + age/gender model) on it.
 * 3. If any detected face is classified "male" above the confidence
 *    threshold, blur the real <video> element with a CSS filter.
 *    Otherwise remove the blur.
 * 4. Re-attach whenever YouTube swaps videos via its SPA navigation.
 */

(() => {
  const DEFAULTS = {
    enabled: true,
    thumbnailEnabled: true,
    checkIntervalMs: 1000,
    confidenceThreshold: 0.6, // how sure the face detector must be a face exists
    genderThreshold: 0.55,    // how sure the gender classifier must be
    blurPx: 45,
    unblurAfter: 1000,
    targetGender: 'male'      // 'male' | 'female' | 'both'
  };

  let settings = { ...DEFAULTS };
  let modelsLoaded = false;
  let loopHandle = null;
  let thumbnailLoopHandle = null;
  let blurTimeoutHandle = null;
  let blurStartedAt = null;
  let blurTimedOut = false;
  let currentVideo = null;
  let sampleCanvas = null;
  let sampleCtx = null;
  let running = false;
  let thumbnailDetectionRunning = false;
  let manualBlurActive = false;
  let blurOverlay = null;

  const MODEL_URL = chrome.runtime.getURL('models');

  function log(...args) {
    console.log('[MaleFaceBlur]', ...args);
  }

  async function loadModels() {
    if (modelsLoaded) return;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL)
    ]);
    modelsLoaded = true;
    log('models loaded');
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULTS, (stored) => {
        settings = { ...DEFAULTS, ...stored };
        resolve(settings);
      });
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const key of Object.keys(changes)) {
      settings[key] = changes[key].newValue;
    }
    if (changes.unblurAfter && blurStartedAt !== null && blurTimeoutHandle) {
      scheduleBlurExpiry(currentVideo);
    }
    if (!settings.enabled) clearBlur();
    if (!settings.thumbnailEnabled) clearThumbnailBlur();
    // Update blur strength if overlay is active
    if (changes.blurPx && blurOverlay && manualBlurActive) {
      blurOverlay.style.backdropFilter = `blur(${settings.blurPx}px)`;
      blurOverlay.style.webkitBackdropFilter = `blur(${settings.blurPx}px)`;
    }
  });

  function findVideo() {
    // YouTube: prefers the main HTML5 video
    const ytVideo = document.querySelector('video.html5-main-video');
    if (ytVideo && ytVideo.videoWidth > 0) return ytVideo;

    // JioHotstar/Hotstar: target the main video in #video-container, not the ad video
    const hotstarContainer = document.querySelector('#video-container');
    if (hotstarContainer) {
      const hotstarVideo = hotstarContainer.querySelector('video');
      if (hotstarVideo && hotstarVideo.videoWidth > 0) return hotstarVideo;
    }

    // Fallback: any visible video element
    return document.querySelector('video');
  }

  function applyBlur(video) {
    video.style.filter = `blur(${settings.blurPx}px)`;
    video.dataset.maleFaceBlurActive = 'true';
    ensureBadge(video);
  }

  function scheduleBlurExpiry(video) {
    if (blurTimeoutHandle) clearTimeout(blurTimeoutHandle);
    const elapsed = Date.now() - blurStartedAt;
    const remaining = Math.max(0, settings.unblurAfter - elapsed);
    blurTimeoutHandle = setTimeout(() => {
      blurTimeoutHandle = null;
      clearBlur(video);
      blurTimedOut = true;
    }, remaining);
  }

  function clearBlur(video) {
    if (blurTimeoutHandle) clearTimeout(blurTimeoutHandle);
    blurTimeoutHandle = null;
    blurStartedAt = null;
    blurTimedOut = false;
    const v = video || currentVideo;
    if (v) {
      v.style.filter = '';
      delete v.dataset.maleFaceBlurActive;
    }
    removeBadge();
  }

  function ensureBadge(video) {
    let badge = document.getElementById('face-blur-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'face-blur-badge';
      badge.textContent = 'Blurred';
      document.body.appendChild(badge);
    }
    positionBadge(video);
    badge.style.display = 'block';
  }

  function positionBadge(video) {
    const badge = document.getElementById('face-blur-badge');
    if (!badge || !video) return;
    const rect = video.getBoundingClientRect();
    badge.style.top = `${rect.top + 12 + window.scrollY}px`;
    badge.style.left = `${rect.left + 12 + window.scrollX}px`;
  }

  function removeBadge() {
    const badge = document.getElementById('face-blur-badge');
    if (badge) badge.style.display = 'none';
  }

  function findThumbnails() {
    // More comprehensive selector to catch various YouTube thumbnail formats
    return [...document.querySelectorAll(
      'ytd-thumbnail img, ytd-rich-grid-media img, ytd-video-renderer img, ' +
      'yt-img-shadow img, #thumbnail img, ytd-compact-video-renderer img'
    )].filter((image) => {
      const rect = image.getBoundingClientRect();
      // Check image is loaded and visible
      return image.complete && 
             image.naturalWidth > 0 && 
             rect.width > 40 && 
             rect.height > 40;
    });
  }

  function clearThumbnailBlur() {
    document.querySelectorAll('img.face-blur-thumbnail').forEach((image) => {
      image.classList.remove('face-blur-thumbnail');
      image.style.removeProperty('--face-blur-px');
      delete image.dataset.maleFaceBlurActive;
    });
  }

  function applyThumbnailBlur(image) {
    image.classList.add('face-blur-thumbnail');
    image.style.setProperty('--face-blur-px', `${settings.blurPx}px`);
    image.dataset.maleFaceBlurActive = 'true';
  }

  async function detectOnce(video) {
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;

    const isShortVideo = location.pathname.startsWith('/shorts/') ||
      video.videoHeight > video.videoWidth;
    const targetWidth = isShortVideo ? 260 : 416;
    const w = Math.min(targetWidth, video.videoWidth);
    const scale = w / video.videoWidth;
    const h = Math.round(video.videoHeight * scale);

    if (!sampleCanvas) {
      sampleCanvas = document.createElement('canvas');
      sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (sampleCanvas.width !== w || sampleCanvas.height !== h) {
      sampleCanvas.width = w;
      sampleCanvas.height = h;
    }
    sampleCtx.drawImage(video, 0, 0, w, h);

    let detections;
    try {
      detections = await faceapi
        .detectAllFaces(sampleCanvas, new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: settings.confidenceThreshold
        }))
        .withAgeAndGender();
    } catch (err) {
      // Hotstar uses blob URLs which may cause taint errors; silently skip frame
      if (err.name === 'SecurityError' || err.message.includes('tainted')) {
        log('canvas tainted by CORS, skipping frame');
        return;
      }
      log('detection error', err);
      return;
    }

    const matchesTarget = (gender) =>
      settings.targetGender === 'both' || gender === settings.targetGender;

    const targetDetected = detections.some(
      (d) => matchesTarget(d.gender) && d.genderProbability >= settings.genderThreshold
    );

    if (targetDetected) {
      if (video.dataset.maleFaceBlurActive !== 'true' && !blurTimedOut) {
        applyBlur(video);
        blurStartedAt = Date.now();
        scheduleBlurExpiry(video);
      }
    } else {
      blurTimedOut = false;
    }
  }

  async function detectThumbnail(image) {
    if (!settings.thumbnailEnabled || !image.isConnected) return;

    // Wait for image to be fully loaded if needed
    if (!image.complete || image.naturalWidth === 0) {
      await new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 2000);
      });
    }
    
    if (!image.complete || image.naturalWidth === 0 || !image.isConnected) return;

    // Draw image to canvas to avoid CORS issues with YouTube's CDN
    const w = Math.min(image.naturalWidth, 224);
    const h = Math.round(image.naturalHeight * (w / image.naturalWidth));
    
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, w, h);

    let detections;
    try {
      detections = await faceapi
        .detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({
          inputSize: 224,
          scoreThreshold: settings.confidenceThreshold
        }))
        .withAgeAndGender();
    } catch (err) {
      log('thumbnail detection error', err);
      return;
    }

    log(`thumbnail detections:`, detections.length, detections.map(d => ({ gender: d.gender, prob: d.genderProbability })));

    const targetDetected = detections.some(
      (d) => (settings.targetGender === 'both' || d.gender === settings.targetGender) &&
        d.genderProbability >= settings.genderThreshold
    );

    if (targetDetected) {
      applyThumbnailBlur(image);
    } else {
      image.classList.remove('face-blur-thumbnail');
      image.style.removeProperty('--face-blur-px');
      delete image.dataset.maleFaceBlurActive;
    }
  }

  async function detectThumbnails() {
    if (!settings.thumbnailEnabled || thumbnailDetectionRunning) return;
    thumbnailDetectionRunning = true;
    try {
      const thumbnails = findThumbnails().slice(0, 20);
      await thumbnails.reduce(
        (chain, image) => chain.then(() => detectThumbnail(image)),
        Promise.resolve()
      );
    } finally {
      thumbnailDetectionRunning = false;
    }
  }

  function startLoop() {
    if (running) return;
    running = true;
    const tick = async () => {
      if (!running) return;
      if (settings.enabled) {
        currentVideo = findVideo();
        if (currentVideo) {
          await detectOnce(currentVideo);
        }
      } else {
        clearBlur();
      }
      loopHandle = setTimeout(tick, settings.checkIntervalMs);
    };
    const tickThumbnails = async () => {
      if (!running) return;
      if (settings.thumbnailEnabled) {
        await detectThumbnails();
      } else {
        clearThumbnailBlur();
      }
      thumbnailLoopHandle = setTimeout(tickThumbnails, Math.max(settings.checkIntervalMs, 5000));
    };
    tick();
    tickThumbnails();
  }

  function stopLoop() {
    running = false;
    if (loopHandle) clearTimeout(loopHandle);
    if (thumbnailLoopHandle) clearTimeout(thumbnailLoopHandle);
    clearBlur();
  }

  // Reposition badge on scroll/resize since YouTube's player can move/resize.
  window.addEventListener('scroll', () => positionBadge(currentVideo), { passive: true });
  window.addEventListener('resize', () => positionBadge(currentVideo));

  // YouTube is a single-page app; it fires this custom event on navigation.
  document.addEventListener('yt-navigate-finish', () => {
    clearBlur();
    currentVideo = null;
    // Clear manual blur overlay too
    if (manualBlurActive && blurOverlay) {
      blurOverlay.remove();
      blurOverlay = null;
    }
  });

  // Hotstar/JioHotstar SPA navigation detection via URL changes
  let lastHotstarUrl = location.href;
  const hotstarUrlObserver = new MutationObserver(() => {
    if (location.href !== lastHotstarUrl) {
      lastHotstarUrl = location.href;
      clearBlur();
      currentVideo = null;
    }
  });
  hotstarUrlObserver.observe(document.body, { childList: true, subtree: true });

  // Also listen for popstate (browser back/forward)
  window.addEventListener('popstate', () => {
    if (!location.href.includes('hotstar.com') && !location.href.includes('jiohotstar.com')) return;
    clearBlur();
    currentVideo = null;
  });

  // Manual blur toggle with "A" key - blurs everything regardless of gender
  function toggleManualBlur() {
    if (manualBlurActive) {
      // Turn off manual blur
      manualBlurActive = false;
      if (blurOverlay) {
        blurOverlay.remove();
        blurOverlay = null;
      }
      removeBadge();
      log('manual blur off');
    } else {
      // Turn on manual blur - blur the entire screen
      manualBlurActive = true;
      // Check if we're in fullscreen
      const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
      const zIndex = isFullscreen ? 2147483647 : 9999;
      if (!blurOverlay) {
        blurOverlay = document.createElement('div');
        blurOverlay.id = 'face-blur-overlay';
        blurOverlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: transparent;
          backdrop-filter: blur(${settings.blurPx}px);
          -webkit-backdrop-filter: blur(${settings.blurPx}px);
          z-index: ${zIndex};
          pointer-events: none;
        `;
        document.body.appendChild(blurOverlay);
      } else {
        blurOverlay.style.zIndex = zIndex;
      }
      ensureBadge(null);
      log('manual blur on - entire screen blurred');
    }
  }

  // Use capture phase to catch key events even when video is focused
  document.addEventListener('keydown', (e) => {
    // Press "A" to toggle manual blur (only if no input is focused)
    if (e.key === 'a' || e.key === 'A') {
      if (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA' ||
          document.activeElement.isContentEditable) {
        return;
      }
      toggleManualBlur();
    }
  }, true); // true = capture phase

  // Also listen on window for fullscreen scenarios
  window.addEventListener('keydown', (e) => {
    if (e.key === 'a' || e.key === 'A') {
      if (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA' ||
          document.activeElement.isContentEditable) {
        return;
      }
      toggleManualBlur();
    }
  }, true);

  // Handle fullscreen changes
  document.addEventListener('fullscreenchange', updateOverlayFullscreen);
  document.addEventListener('webkitfullscreenchange', updateOverlayFullscreen);

  function updateOverlayFullscreen() {
    if (blurOverlay && manualBlurActive) {
      const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
      blurOverlay.style.zIndex = isFullscreen ? '2147483647' : '9999';
      log('fullscreen changed, z-index:', isFullscreen ? 'max' : '9999');
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'toggleManualBlur') {
      toggleManualBlur();
      sendResponse({ manualBlurActive });
    } else if (message.type === 'getManualBlurState') {
      sendResponse({ manualBlurActive });
    }
    return true;
  });

  async function init() {
    await loadSettings();
    try {
      await loadModels();
    } catch (err) {
      log('failed to load models - did you download them into /models? See README.', err);
      return;
    }
    startLoop();
  }

  init();
})();
