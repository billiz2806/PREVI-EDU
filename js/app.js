'use strict';

const SESSION_KEY = 'previEduSession';
const sessionData = sessionStorage.getItem(SESSION_KEY);

if (!sessionData) {
  window.location.replace('login.html');
} else {
  let currentUser;

  try {
    currentUser = JSON.parse(sessionData);
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.replace('login.html');
  }

  const roleSettings = {
    DIRECTOR: {
      menu: ['Dashboard', 'Institución', 'Gestión Académica', 'Estudiantes', 'Docentes', 'Asistencia', 'Evaluaciones', 'Alertas', 'Seguimientos', 'Reportes', 'Configuración'],
      title: 'Dashboard Institucional',
      subtitle: 'Resumen general de la institución educativa'
    },
    DOCENTE: {
      menu: ['Dashboard', 'Mis aulas', 'Mis estudiantes', 'Asistencia', 'Evaluaciones', 'Alertas', 'Seguimientos'],
      title: 'Mi Dashboard',
      subtitle: 'Resumen de mis estudiantes y aulas asignadas'
    },
    ADMINISTRADOR: {
      menu: ['Dashboard', 'Instituciones', 'Directores', 'Usuarios'],
      title: 'Dashboard',
      subtitle: 'Resumen general de la administración de PREVI-EDU.'
    },
    USUARIO: {
      menu: [],
      title: 'Cuenta registrada',
      subtitle: 'Tu cuenta todavía no tiene un perfil funcional asignado.'
    }
  };

  const settings = currentUser && roleSettings[currentUser.role];

  if (!settings) {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.replace('login.html');
  } else {
    window.previEduCurrentUser = currentUser;
    const menu = document.querySelector('#main-menu');

    settings.menu.forEach((item, index) => {
      const menuItem = document.createElement('li');
      menuItem.className = 'nav-item';
      menuItem.innerHTML = `
        <a class="nav-link${index === 0 ? ' active' : ''}" href="#" aria-label="${item}" title="${item}"${index === 0 ? ' aria-current="page"' : ''}>
          <span class="nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M9 12h6M12 9v6"></path></svg>
          </span>
          <span>${item}</span>
        </a>`;
      menu.appendChild(menuItem);
    });

    document.querySelector('#user-name').textContent = currentUser.name;
    document.querySelector('#user-role').textContent = currentUser.role;
    document.querySelector('#user-avatar').textContent = currentUser.name.charAt(0).toUpperCase();
    document.querySelector('#dashboard-title').textContent = settings.title;
    document.querySelector('#dashboard-subtitle').textContent = settings.subtitle;

    document.querySelector('#logout-button').addEventListener('click', () => {
      window.clearPreviEduContext?.();
      window.previEduCurrentUser = null;
      sessionStorage.removeItem(SESSION_KEY);
      window.location.replace('login.html');
    });
  }
}

const SIDEBAR_STORAGE_KEY = 'previSidebarCollapsed';
const DESKTOP_MEDIA_QUERY = '(min-width: 992px)';

function initializeSidebar() {
  const body = document.body;
  const desktopToggle = document.querySelector('#sidebar-collapse-toggle');
  const mobileToggle = document.querySelector('#sidebar-mobile-toggle');
  const overlay = document.querySelector('#sidebar-overlay');
  const menu = document.querySelector('#main-menu');
  const desktopMedia = window.matchMedia(DESKTOP_MEDIA_QUERY);

  function updateDesktopToggle() {
    const isCollapsed = body.classList.contains('sidebar-collapsed');
    desktopToggle.setAttribute('aria-expanded', String(!isCollapsed));
    desktopToggle.setAttribute('aria-label', isCollapsed ? 'Expandir menú' : 'Contraer menú');
  }

  function updateMobileToggle(isOpen) {
    mobileToggle.setAttribute('aria-expanded', String(isOpen));
    mobileToggle.setAttribute('aria-label', isOpen ? 'Cerrar menú principal' : 'Abrir menú principal');
    overlay.tabIndex = isOpen ? 0 : -1;
  }

  function closeMobileSidebar() {
    body.classList.remove('sidebar-mobile-open');
    updateMobileToggle(false);
  }

  function toggleMobileSidebar() {
    const willOpen = !body.classList.contains('sidebar-mobile-open');
    body.classList.toggle('sidebar-mobile-open', willOpen);
    updateMobileToggle(willOpen);
  }

  function toggleDesktopSidebar() {
    const isCollapsed = body.classList.toggle('sidebar-collapsed');

    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isCollapsed));
    } catch (error) {
      console.warn('No se pudo guardar la preferencia del menú lateral.', error);
    }

    updateDesktopToggle();
  }

  function handleBreakpointChange() {
    closeMobileSidebar();
    updateDesktopToggle();
  }

  try {
    body.classList.toggle(
      'sidebar-collapsed',
      localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
    );
  } catch (error) {
    console.warn('No se pudo recuperar la preferencia del menú lateral.', error);
  }

  desktopToggle.addEventListener('click', toggleDesktopSidebar);
  mobileToggle.addEventListener('click', toggleMobileSidebar);
  overlay.addEventListener('click', closeMobileSidebar);
  menu.addEventListener('click', (event) => {
    if (!desktopMedia.matches && event.target.closest('.nav-link')) {
      closeMobileSidebar();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && body.classList.contains('sidebar-mobile-open')) {
      closeMobileSidebar();
      mobileToggle.focus();
    }
  });
  desktopMedia.addEventListener('change', handleBreakpointChange);

  updateDesktopToggle();
  updateMobileToggle(false);
}

initializeSidebar();
