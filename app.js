(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // State (in-memory only — nothing about the photo is persisted to disk
  // or browser storage, per the app's privacy requirements).
  // ---------------------------------------------------------------------
  const state = {
    imageDataUrl: null,
    analysis: null,
    hairstyles: [],
    beards: [],
    groomingGuide: null,
    styleLibrary: null,
    analysisProviderConfigured: null,
  };

  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // ---------------------------------------------------------------------
  // Small DOM helpers
  // ---------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    const target = $(`screen-${name}`);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === name);
    });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    if (name === 'results') renderResultsScreen();
    if (name === 'styles' && state.styleLibrary) renderStyleLibrary();
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ---------------------------------------------------------------------
  // Navigation wiring
  // ---------------------------------------------------------------------
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => showScreen(el.dataset.nav));
  });
  $('btn-analyze-cta').addEventListener('click', () => showScreen('upload'));

  // ---------------------------------------------------------------------
  // Health check — shows the fallback banner if no API key is configured
  // ---------------------------------------------------------------------
  fetch('/api/health')
    .then((r) => r.json())
    .then((data) => {
      state.analysisProviderConfigured = data.analysisConfigured;
      if (!data.analysisConfigured) show($('not-configured-banner'));
    })
    .catch(() => {
      // Health check failing shouldn't block using the rest of the app.
    });

  // Pre-fetch the style library so "Explore Styles" is instant.
  fetch('/api/styles')
    .then((r) => r.json())
    .then((data) => { state.styleLibrary = data; })
    .catch(() => {});

  // ---------------------------------------------------------------------
  // UPLOAD SCREEN
  // ---------------------------------------------------------------------
  const dropzone = $('dropzone');
  const dropzoneEmpty = $('dropzone-empty');
  const previewImg = $('preview-image');
  const uploadButtons = $('upload-buttons');
  const uploadError = $('upload-error');

  function resetUploadScreen() {
    state.imageDataUrl = null;
    previewImg.src = '';
    hide(previewImg);
    show(dropzoneEmpty);
    hide(uploadButtons);
    hide(uploadError);
    $('file-camera').value = '';
    $('file-gallery').value = '';
  }

  function showUploadError(message) {
    uploadError.textContent = message;
    show(uploadError);
  }

  function validateFile(file) {
    if (!file) return 'No file was selected.';
    if (!ACCEPTED_TYPES.includes(file.type)) return 'Please upload a JPEG, PNG, or WEBP image.';
    if (file.size > MAX_IMAGE_BYTES) return 'That image is too large. Please upload a photo under 8MB.';
    return null;
  }

  function loadFile(file) {
    hide(uploadError);
    const err = validateFile(file);
    if (err) { showUploadError(err); return; }

    const reader = new FileReader();
    reader.onload = () => {
      state.imageDataUrl = reader.result;
      previewImg.src = reader.result;
      hide(dropzoneEmpty);
      show(previewImg);
      show(uploadButtons);
    };
    reader.onerror = () => showUploadError('We could not read that file. Please try another photo.');
    reader.readAsDataURL(file);
  }

  $('file-camera').addEventListener('change', (e) => loadFile(e.target.files[0]));
  $('file-gallery').addEventListener('change', (e) => loadFile(e.target.files[0]));

  ['dragover', 'dragenter'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); })
  );
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  $('btn-choose-another').addEventListener('click', resetUploadScreen);

  $('btn-analyze-photo').addEventListener('click', async () => {
    if (!state.imageDataUrl) { showUploadError('Please upload a photo first.'); return; }
    showScreen('analyzing');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: state.imageDataUrl }),
      });
      const data = await res.json();

      if (res.ok && data.configured === false) {
        showScreen('upload');
        show($('not-configured-banner'));
        toast("AI analysis isn't connected yet.");
        return;
      }

      if (!res.ok) {
        showScreen('upload');
        showUploadError(data.message || 'Something went wrong analyzing this photo. Please try another.');
        return;
      }

      state.analysis = data.analysis;
      state.hairstyles = data.hairstyles;
      state.beards = data.beards;
      state.groomingGuide = data.groomingGuide;
      showScreen('results');
    } catch (err) {
      showScreen('upload');
      showUploadError('We could not reach the server. Please check your connection and try again.');
    }
  });

  // ---------------------------------------------------------------------
  // RESULTS SCREEN
  // ---------------------------------------------------------------------
  function renderResultsScreen() {
    if (!state.analysis) {
      show($('results-empty'));
      hide($('results-content'));
      return;
    }
    hide($('results-empty'));
    show($('results-content'));

    const a = state.analysis;
    $('summary-face-shape').textContent = a.faceShape || '—';
    $('summary-confidence').textContent = a.confidence || '—';
    $('card-face-shape-reasoning').textContent = a.faceShapeReasoning || 'No details available.';
    $('card-current-hairstyle').textContent = a.currentHairstyleDescription || 'No details available.';
    $('card-beard-status').textContent = a.facialHairStatus || 'No details available.';
    $('card-jawline').textContent = a.jawlineShape || 'No details available.';

    renderRecList($('hairstyle-list'), state.hairstyles, 'hairstyle');
    renderRecList($('beard-list'), state.beards, 'beard');
    renderGroomingGuide(state.groomingGuide);
  }

  function renderRecList(container, items, kind) {
    container.innerHTML = '';
    (items || []).forEach((item) => {
      const card = document.createElement('div');
      card.className = 'rec-card';
      const label = kind === 'hairstyle' ? 'Try This Hairstyle' : 'Try This Beard';
      card.innerHTML = `
        <div class="rec-card-head">
          <h4>${escapeHtml(item.name)}</h4>
          <span class="maintenance-tag">${escapeHtml(item.maintenance || '')}</span>
        </div>
        <p>${escapeHtml(item.why || '')}</p>
        <button class="btn btn-secondary btn-block try-style-btn">${label}</button>
      `;
      card.querySelector('.try-style-btn').addEventListener('click', () => openPreviewModal(kind, item.name));
      container.appendChild(card);
    });
  }

  function renderGroomingGuide(guide) {
    if (!guide) return;
    fillList('grooming-hair', [
      `Haircut frequency: ${guide.hair.suggestedFrequency}`,
      `Styling: ${guide.hair.stylingApproach}`,
      `Maintenance: ${guide.hair.generalMaintenance}`,
    ]);
    fillList('grooming-beard', [
      guide.beard.suggestedLengthOrStyle,
      guide.beard.necklineCheeklineGuidance,
    ]);
    fillList('grooming-skin', guide.skin.tips);
    $('grooming-skin-note').textContent = guide.skin.note || '';
    fillList('grooming-appearance', guide.appearance.tips);
    $('grooming-appearance-note').textContent = guide.appearance.note || '';
  }

  function fillList(id, items) {
    const ul = $(id);
    ul.innerHTML = '';
    (items || []).forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      ul.appendChild(li);
    });
  }

  $('btn-delete-photo').addEventListener('click', () => {
    state.imageDataUrl = null;
    state.analysis = null;
    state.hairstyles = [];
    state.beards = [];
    state.groomingGuide = null;
    resetUploadScreen();
    toast('Your photo and results have been removed.');
    showScreen('home');
  });

  // ---------------------------------------------------------------------
  // EXPLORE STYLES SCREEN
  // ---------------------------------------------------------------------
  function renderStyleLibrary() {
    renderLibraryList($('library-hair'), state.styleLibrary.hair);
    renderLibraryList($('library-beard'), state.styleLibrary.beard);
  }

  function renderLibraryList(container, items) {
    container.innerHTML = '';
    (items || []).forEach((item) => {
      const card = document.createElement('div');
      card.className = 'rec-card';
      const tags = (item.suitableFaceShapes || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
      card.innerHTML = `
        <div class="rec-card-head">
          <h4>${escapeHtml(item.name)}</h4>
          <span class="maintenance-tag">${escapeHtml(item.maintenance || '')}</span>
        </div>
        <p>${escapeHtml(item.description || '')}</p>
        <div class="tag-row">${tags}</div>
      `;
      container.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------
  // PREVIEW MODAL (hairstyle / beard "try on")
  // ---------------------------------------------------------------------
  let activePreview = null; // { kind, styleName }

  function openPreviewModal(kind, styleName) {
    activePreview = { kind, styleName };
    $('modal-title').textContent = `Preview: ${styleName}`;
    show($('preview-modal'));
    hide($('modal-unavailable'));
    hide($('modal-compare'));
    show($('modal-loading'));
    requestPreview(kind, styleName);
  }

  function closePreviewModal() {
    hide($('preview-modal'));
    activePreview = null;
  }
  $('btn-close-modal').addEventListener('click', closePreviewModal);
  $('btn-try-another').addEventListener('click', closePreviewModal);

  async function requestPreview(kind, styleName) {
    const endpoint = kind === 'hairstyle' ? '/api/preview/hairstyle' : '/api/preview/beard';
    const bodyKey = kind === 'hairstyle' ? 'hairstyle' : 'beardStyle';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: state.imageDataUrl, [bodyKey]: styleName }),
      });
      const data = await res.json();
      hide($('modal-loading'));

      if (data.configured === false || !res.ok) {
        $('modal-unavailable').textContent =
          data.message || 'The style preview service is unavailable right now.';
        show($('modal-unavailable'));
        return;
      }

      // A real image-editing provider would return a data URL / base64 image here.
      renderComparison(state.imageDataUrl, data.image);
    } catch (err) {
      hide($('modal-loading'));
      $('modal-unavailable').textContent = 'We could not reach the preview service. Please try again.';
      show($('modal-unavailable'));
    }
  }

  function renderComparison(beforeSrc, afterSrc) {
    $('compare-before').src = beforeSrc;
    $('compare-after').src = afterSrc;
    show($('modal-compare'));
    const range = $('compare-range');
    const clip = $('compare-before-clip');
    const slider = $('compare-slider');

    function update() {
      const pct = range.value;
      clip.style.width = pct + '%';
      const sliderWidth = slider.getBoundingClientRect().width;
      $('compare-before').style.width = sliderWidth + 'px';
    }
    range.addEventListener('input', update);
    window.addEventListener('resize', update);
    update();
  }

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initial screen
  showScreen('home');
})();
