'use strict';

(() => {
  if (window.appContext?.currentRole !== 'ADMINISTRADOR') return;
  const db = window.supabaseClient;
  const menu = document.querySelector('#main-menu');
  const main = document.querySelector('main .container-xl');
  const link = [...menu.querySelectorAll('.nav-link')].find((item) => item.textContent.trim() === 'Dashboard');
  if (!db || !main || !link) return;

  main.insertAdjacentHTML('beforeend', `
    <section class="admin-dashboard" id="admin-dashboard" aria-label="Dashboard Administrador">
      <div class="admin-kpi-grid" id="admin-kpis" aria-live="polite">
        ${['Instituciones activas','Directores activos','Docentes registrados','Usuarios activos'].map((label, index) => `<article class="card admin-kpi"><div class="card-body"><span class="admin-kpi-icon tone-${['violet','sky','green','coral'][index]}"><i class="ti ti-${['building','user-shield','school','users'][index]}"></i></span><div><small>${label}</small><strong><span class="placeholder col-5"></span></strong></div></div></article>`).join('')}
      </div>
      <div class="row g-3 mt-1">
        <div class="col-lg-4"><article class="card admin-panel h-100"><div class="card-header"><div><h2 class="card-title">Accesos rápidos</h2><p class="text-secondary mb-0">Administración general del sistema</p></div></div><div class="card-body admin-quick-actions"><button class="btn btn-primary" type="button" data-admin-go="institutions"><i class="ti ti-building"></i> Gestionar instituciones</button><button class="btn btn-outline-primary" type="button" data-admin-go="directors"><i class="ti ti-user-shield"></i> Gestionar directores</button><button class="btn btn-outline-primary" type="button" data-admin-go="users"><i class="ti ti-users"></i> Gestionar usuarios</button></div></article></div>
        <div class="col-lg-8"><article class="card admin-panel"><div class="card-header d-flex justify-content-between align-items-center"><div><h2 class="card-title">Instituciones registradas</h2><p class="text-secondary mb-0">Vista general de las instituciones</p></div><button class="btn btn-link btn-sm" type="button" data-admin-go="institutions">Ver todas <i class="ti ti-arrow-right"></i></button></div><div class="admin-loading" id="admin-dashboard-loading"><span class="spinner-border spinner-border-sm"></span> Cargando información...</div><div class="table-responsive d-none" id="admin-dashboard-table"><table class="table table-vcenter card-table"><thead><tr><th>Código modular</th><th>Institución</th><th>Ubicación</th><th>Gestión</th><th>Estado</th></tr></thead><tbody></tbody></table></div><p class="admin-empty d-none" id="admin-dashboard-empty">No hay instituciones registradas.</p></article></div>
      </div>
    </section>`);

  const view = document.querySelector('#admin-dashboard');
  const title = document.querySelector('#dashboard-title');
  const subtitle = document.querySelector('#dashboard-subtitle');
  const safe = (value, fallback = 'No registrado') => value === null || value === undefined || value === '' ? fallback : String(value);
  const esc = (value) => safe(value).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const active = (value) => value === true || String(value).toUpperCase() === 'ACTIVO';
  const check = (response, label) => { if (response.error) throw new Error(label, { cause: response.error }); return response.data || []; };

  function activateMenu() {
    menu.querySelectorAll('.nav-link').forEach((item) => { item.classList.toggle('active', item === link); item.toggleAttribute('aria-current', item === link); });
  }
  function show(event) {
    event?.preventDefault();
    document.querySelectorAll('#admin-institutions,#admin-directors,#admin-users').forEach((item) => item.classList.add('d-none'));
    view.classList.remove('d-none');
    title.textContent = 'Dashboard'; subtitle.textContent = 'Resumen general de la administración de PREVI-EDU.';
    activateMenu(); load();
  }
  async function load() {
    const loading = document.querySelector('#admin-dashboard-loading'); const table = document.querySelector('#admin-dashboard-table'); const empty = document.querySelector('#admin-dashboard-empty');
    loading.classList.remove('d-none'); table.classList.add('d-none'); empty.classList.add('d-none');
    try {
      const responses = await Promise.all([
        db.from('institucion_educativa').select('institucion_id,codigo_modular,nombre,gestion,departamento,provincia,distrito,estado').order('nombre'),
        db.from('director').select('director_id,estado,usuario(estado)'),
        db.from('docente').select('docente_id'),
        db.from('usuario').select('usuario_id,estado')
      ]);
      const institutions = check(responses[0], 'Instituciones'); const directors = check(responses[1], 'Directores'); const teachers = check(responses[2], 'Docentes'); const users = check(responses[3], 'Usuarios');
      const metrics = [institutions.filter((row) => active(row.estado)).length,directors.filter((row) => active(row.estado) && active(Array.isArray(row.usuario) ? row.usuario[0]?.estado : row.usuario?.estado)).length,teachers.length,users.filter((row) => active(row.estado)).length];
      document.querySelectorAll('#admin-kpis strong').forEach((element, index) => { element.textContent = metrics[index].toLocaleString('es-PE'); });
      const rows = institutions.slice(0, 5); const body = table.querySelector('tbody');
      body.innerHTML = rows.map((row) => `<tr><td>${esc(row.codigo_modular)}</td><td><strong>${esc(row.nombre)}</strong></td><td>${esc([row.distrito,row.provincia].filter(Boolean).join(', '))}</td><td>${esc(row.gestion)}</td><td><span class="badge admin-status ${active(row.estado) ? 'is-active' : 'is-inactive'}">${active(row.estado) ? 'Activo' : 'Inactivo'}</span></td></tr>`).join('');
      table.classList.toggle('d-none', !rows.length); empty.classList.toggle('d-none', Boolean(rows.length));
    } catch (error) {
      console.error('[Dashboard Administrador] Error al cargar información:', error.cause || error);
      empty.textContent = 'No se pudo cargar la información.'; empty.classList.remove('d-none');
    } finally { loading.classList.add('d-none'); }
  }
  link.addEventListener('click', show);
  view.addEventListener('click', (event) => { const action=event.target.closest('[data-admin-go]')?.dataset.adminGo;if(action==='institutions')window.previAdminShowInstitutions?.();if(action==='directors')window.previAdminShowDirectors?.();if(action==='users')window.previAdminShowUsers?.(); });
  window.addEventListener('previ:institutions-updated', load);
  window.previAdminShowDashboard = show;
  show();
})();
