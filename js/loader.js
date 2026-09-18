'use strict';

(() => {
  if (window.previEduLoader) return;

  const MIN_VISIBLE_TIME = 600;
  const TRANSITION_TIME = 200;
  let loadingCount = 0;
  let shownAt = 0;
  let hideTimer = null;
  let transitionTimer = null;

  const overlay = document.createElement('div');
  overlay.id = 'global-loader';
  overlay.className = 'previ-global-loader';
  overlay.hidden = true;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', 'Cargando información');
  overlay.innerHTML = `
    <div class="previ-loader-panel">
      <div class="previ-loader-symbol" aria-hidden="true">
        <span class="previ-loader-ring"></span>
        <span class="previ-loader-mark"><i class="ti ti-school"></i></span>
      </div>
      <strong>PREVI-EDU</strong>
      <span class="previ-loader-message">Cargando información...</span>
    </div>`;
  document.body.append(overlay);

  const message = overlay.querySelector('.previ-loader-message');
  const clearTimers = () => {
    if (hideTimer) window.clearTimeout(hideTimer);
    if (transitionTimer) window.clearTimeout(transitionTimer);
    hideTimer = null;
    transitionTimer = null;
  };

  function showLoader(text = 'Cargando información...') {
    loadingCount += 1;
    message.textContent = text || 'Cargando información...';
    overlay.setAttribute('aria-label', message.textContent);
    clearTimers();
    if (!overlay.hidden) return loadingCount;
    overlay.hidden = false;
    shownAt = performance.now();
    document.documentElement.setAttribute('aria-busy', 'true');
    document.body.classList.add('global-loading');
    window.requestAnimationFrame(() => overlay.classList.add('is-visible'));
    return loadingCount;
  }

  function finishHiding() {
    overlay.hidden = true;
    document.documentElement.removeAttribute('aria-busy');
    document.body.classList.remove('global-loading');
    transitionTimer = null;
  }

  function hideLoader() {
    loadingCount = Math.max(0, loadingCount - 1);
    if (loadingCount > 0 || overlay.hidden) return;
    const remaining = Math.max(0, MIN_VISIBLE_TIME - (performance.now() - shownAt));
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      if (loadingCount > 0) return;
      overlay.classList.remove('is-visible');
      transitionTimer = window.setTimeout(finishHiding, TRANSITION_TIME);
    }, remaining);
  }

  async function withLoader(text, operation) {
    showLoader(text);
    try {
      return await operation();
    } finally {
      hideLoader();
    }
  }

  function pulse(text) {
    showLoader(text);
    window.requestAnimationFrame(() => window.requestAnimationFrame(hideLoader));
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const target = String(args[0]?.url || args[0] || '');
    const isSupabaseRequest = /\.supabase\.co\/(rest|auth|storage|functions)\/v\d?/i.test(target);
    if (!isSupabaseRequest) return originalFetch(...args);
    showLoader(message.textContent || 'Cargando información...');
    try {
      return await originalFetch(...args);
    } finally {
      hideLoader();
    }
  };

  const actionMessages = new Map([
    ['attendance-query', 'Cargando asistencia...'],
    ['attendance-save', 'Guardando asistencia...'],
    ['evaluations-query', 'Consultando evaluaciones...'],
    ['evaluations-save', 'Guardando evaluaciones...'],
    ['reports-query', 'Generando reporte...'],
    ['reports-export', 'Preparando archivo...']
  ]);

  document.addEventListener('click', (event) => {
    const navigation = event.target.closest('#main-menu .nav-link');
    if (navigation) pulse(`Cargando ${navigation.textContent.trim()}...`);
    const action = event.target.closest('[id]');
    if (actionMessages.has(action?.id)) pulse(actionMessages.get(action.id));
  }, true);

  window.showLoader = showLoader;
  window.hideLoader = hideLoader;
  window.withLoader = withLoader;
  window.previEduLoader = {
    show: showLoader,
    hide: hideLoader,
    withLoader,
    pulse,
    setMessage(text) { message.textContent = text || 'Cargando información...'; },
    get activeOperations() { return loadingCount; },
    minimumVisibleTime: MIN_VISIBLE_TIME
  };
})();
