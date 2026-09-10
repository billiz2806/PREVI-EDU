'use strict';

(() => {
  if (window.appContext?.currentRole !== 'ADMINISTRADOR') return;
  const db = window.supabaseClient;
  const main = document.querySelector('main .container-xl');
  const menu = document.querySelector('#main-menu');
  const link = [...menu.querySelectorAll('.nav-link')].find((item) => item.textContent.trim() === 'Usuarios');
  if (!link) return;

  main.insertAdjacentHTML('beforeend', `
    <section class="d-none" id="admin-users"><div class="card admin-panel">
      <div class="card-header"><div><h2 class="card-title">Usuarios</h2><p class="text-secondary mb-0">Consulte y actualice las cuentas generales del prototipo.</p></div></div>
      <div class="card-body admin-filters admin-filters-wide">
        <div><label class="form-label">Buscar</label><input class="form-control" data-filter="search" placeholder="Nombre, correo o usuario"></div>
        <div><label class="form-label">Perfil</label><select class="form-select" data-filter="profile"><option value="">Todos</option><option>Administrador</option><option>Usuario</option><option>Director</option><option>Docente</option></select></div>
        <div><label class="form-label">Estado</label><select class="form-select" data-filter="status"><option value="">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></div>
        <button class="btn btn-outline-secondary" type="button" data-clear>Limpiar</button>
      </div>
      <div class="alert d-none mx-3 mt-3 mb-0" data-feedback></div>
      <div class="admin-loading" data-loading><span class="spinner-border spinner-border-sm"></span> Cargando usuarios...</div>
      <div class="table-responsive d-none" data-table><table class="table table-vcenter card-table"><thead><tr><th>Usuario</th><th>Nombre completo</th><th>Correo</th><th>Perfil(es)</th><th>Estado</th><th>Acciones</th></tr></thead><tbody></tbody></table></div>
      <div class="admin-empty d-none" data-empty>No hay usuarios registrados.</div><div class="admin-pagination" data-pagination></div>
    </div></section>
    <div class="modal modal-blur fade" id="admin-user-modal"><div class="modal-dialog modal-lg modal-dialog-centered"><form class="modal-content" novalidate>
      <div class="modal-header"><div><h2 class="modal-title">Editar usuario</h2><p class="modal-subtitle">El perfil y las relaciones especializadas no se modifican aquí.</p></div><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
      <div class="modal-body"><div class="alert alert-danger d-none" data-error></div><div class="row g-3">
        <div class="col-md-6"><label class="form-label">Nombres *</label><input class="form-control" name="nombres" required></div><div class="col-md-6"><label class="form-label">Apellidos *</label><input class="form-control" name="apellidos" required></div>
        <div class="col-md-6"><label class="form-label">Correo *</label><input class="form-control" name="correo" type="email" required></div><div class="col-md-6"><label class="form-label">Nombre de usuario *</label><input class="form-control" name="nombre_usuario" required></div>
        <div class="col-md-6"><label class="form-label">Perfil(es)</label><input class="form-control" name="profile" readonly></div><div class="col-md-6 d-flex align-items-end"><label class="form-check form-switch mb-2"><input class="form-check-input" name="estado" type="checkbox"><span class="form-check-label">Usuario activo</span></label></div>
        <div class="col-12"><div class="alert alert-info mb-0 d-none" data-specialized></div></div>
      </div></div><div class="modal-footer"><button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary" type="submit">Guardar cambios</button></div>
    </form></div></div>`);

  const view = document.querySelector('#admin-users');
  const form = document.querySelector('#admin-user-modal form');
  const modal = new window.tabler.Modal(document.querySelector('#admin-user-modal'));
  const state = { rows: [], editing: null, page: 1, size: 10 };
  const safe = (value, fallback = 'No registrado') => value == null || value === '' ? fallback : String(value);
  const normalize = (value) => safe(value, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const isActive = (value) => value === true || String(value).toUpperCase() === 'ACTIVO';
  const check = (response, label) => { if (response.error) throw new Error(label, { cause: response.error }); return response.data || []; };
  const escapeHtml = (value) => safe(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

  function feedback(message, ok = true) {
    const element = view.querySelector('[data-feedback]');
    if (!message) { element.classList.add('d-none'); return; }
    element.textContent = message;
    element.className = `alert mx-3 mt-3 mb-0 ${ok ? 'alert-success' : 'alert-danger'}`;
  }

  function filteredRows() {
    const query = normalize(view.querySelector('[data-filter="search"]').value);
    const profile = view.querySelector('[data-filter="profile"]').value;
    const status = view.querySelector('[data-filter="status"]').value;
    return state.rows.filter((user) => (!query || normalize(`${user.nombre_usuario} ${user.nombres} ${user.apellidos} ${user.correo}`).includes(query)) && (!profile || user.profiles.includes(profile)) && (!status || (status === 'active') === isActive(user.estado)));
  }

  async function load() {
    const loading = view.querySelector('[data-loading]');
    const table = view.querySelector('[data-table]');
    const empty = view.querySelector('[data-empty]');
    loading.classList.remove('d-none'); table.classList.add('d-none'); empty.classList.add('d-none'); feedback('');
    try {
      const [usersResponse, directorsResponse, teachersResponse] = await Promise.all([
        db.from('usuario').select('usuario_id,nombre_usuario,nombres,apellidos,correo,rol,estado').order('nombres'),
        db.from('director').select('usuario_id,estado'),
        db.from('docente').select('usuario_id,estado')
      ]);
      const users = check(usersResponse, 'Usuarios');
      const directorIds = new Set(check(directorsResponse, 'Directores').map((row) => String(row.usuario_id)));
      const teacherIds = new Set(check(teachersResponse, 'Docentes').map((row) => String(row.usuario_id)));
      state.rows = users.map((user) => {
        const profiles = [];
        if (user.rol === 'ADMINISTRADOR') profiles.push('Administrador');
        if (directorIds.has(String(user.usuario_id))) profiles.push('Director');
        if (teacherIds.has(String(user.usuario_id))) profiles.push('Docente');
        if (!profiles.length) profiles.push('Usuario');
        return { ...user, profiles, profileLabel: profiles.join(' / ') };
      });
      state.page = 1; render();
    } catch (error) {
      console.error('[Usuarios] Error al cargar usuarios y perfiles:', error.cause || error);
      state.rows = []; feedback('No se pudo cargar la información.', false);
    } finally { loading.classList.add('d-none'); }
  }

  function render() {
    const all = filteredRows();
    const pages = Math.max(1, Math.ceil(all.length / state.size));
    if (state.page > pages) state.page = pages;
    const rows = all.slice((state.page - 1) * state.size, state.page * state.size);
    const table = view.querySelector('[data-table]');
    table.querySelector('tbody').innerHTML = rows.map((user) => {
      const hasDirector = user.profiles.includes('Director');
      const specialized = hasDirector || user.profiles.includes('Docente');
      return `<tr><td><strong>${escapeHtml(user.nombre_usuario)}</strong></td><td>${escapeHtml(`${user.nombres || ''} ${user.apellidos || ''}`.trim())}</td><td>${escapeHtml(user.correo)}</td><td><span class="badge admin-role">${escapeHtml(user.profileLabel)}</span></td><td><span class="badge admin-status ${isActive(user.estado) ? 'is-active' : 'is-inactive'}">${isActive(user.estado) ? 'Activo' : 'Inactivo'}</span></td><td><div class="admin-row-actions"><button class="btn btn-sm btn-outline-primary" data-edit="${user.usuario_id}">Editar</button>${hasDirector ? `<button class="btn btn-sm btn-outline-secondary" data-director="${user.usuario_id}">Gestionar Director</button>` : specialized ? '' : `<button class="btn btn-sm btn-outline-secondary" data-toggle="${user.usuario_id}">${isActive(user.estado) ? 'Inactivar' : 'Activar'}</button>`}</div></td></tr>`;
    }).join('');
    table.classList.toggle('d-none', !all.length);
    view.querySelector('[data-empty]').classList.toggle('d-none', Boolean(all.length));
    renderPagination(all.length, pages);
  }

  function renderPagination(total, pages) {
    const box = view.querySelector('[data-pagination]');
    box.innerHTML = `<span>${total} usuarios</span><div><select class="form-select form-select-sm">${[10, 20, 30].map((size) => `<option ${size === state.size ? 'selected' : ''}>${size}</option>`).join('')}</select><button class="btn btn-sm btn-outline-secondary" data-page="-1" ${state.page === 1 ? 'disabled' : ''}>‹</button><span>${state.page} / ${pages}</span><button class="btn btn-sm btn-outline-secondary" data-page="1" ${state.page >= pages ? 'disabled' : ''}>›</button></div>`;
    box.querySelector('select').onchange = (event) => { state.size = Number(event.target.value); state.page = 1; render(); };
    box.querySelectorAll('[data-page]').forEach((button) => { button.onclick = () => { state.page += Number(button.dataset.page); render(); }; });
  }

  function open(user) {
    state.editing = user; form.reset(); form.classList.remove('was-validated'); form.querySelector('[data-error]').classList.add('d-none');
    ['nombres', 'apellidos', 'correo', 'nombre_usuario'].forEach((field) => { form.elements[field].value = user[field] || ''; });
    form.elements.profile.value = user.profileLabel; form.elements.estado.checked = isActive(user.estado);
    const specialized = form.querySelector('[data-specialized]');
    const hasDirector = user.profiles.includes('Director'); const hasTeacher = user.profiles.includes('Docente');
    specialized.classList.toggle('d-none', !hasDirector && !hasTeacher);
    specialized.textContent = hasDirector ? 'La institución y el estado especializado se gestionan desde Directores.' : hasTeacher ? 'El estado especializado del docente se gestiona desde Docentes.' : '';
    form.elements.estado.disabled = hasDirector || hasTeacher; modal.show();
  }

  async function isDuplicate(field, value, id) { return check(await db.from('usuario').select('usuario_id').ilike(field, value).neq('usuario_id', id), 'Duplicados').length > 0; }

  async function save(event) {
    event.preventDefault(); form.classList.add('was-validated'); if (!form.checkValidity()) return;
    const user = state.editing;
    const payload = { nombres: form.elements.nombres.value.trim(), apellidos: form.elements.apellidos.value.trim(), correo: form.elements.correo.value.trim(), nombre_usuario: form.elements.nombre_usuario.value.trim() };
    const errorBox = form.querySelector('[data-error]'); const button = form.querySelector('[type="submit"]');
    if (!form.elements.estado.disabled) payload.estado = form.elements.estado.checked;
    if (user.usuario_id === window.appContext.currentUser.usuario_id && payload.estado === false) { errorBox.textContent = 'No puede inactivar el usuario con el que inició sesión.'; errorBox.classList.remove('d-none'); return; }
    button.disabled = true; button.textContent = 'Guardando...';
    try {
      if (await isDuplicate('correo', payload.correo, user.usuario_id)) throw Object.assign(new Error(), { friendly: 'Ya existe un usuario con este correo.' });
      if (await isDuplicate('nombre_usuario', payload.nombre_usuario, user.usuario_id)) throw Object.assign(new Error(), { friendly: 'Ya existe un usuario con este nombre de usuario.' });
      check(await db.from('usuario').update(payload).eq('usuario_id', user.usuario_id), 'Usuario');
      modal.hide(); feedback('Usuario actualizado correctamente.'); await load();
    } catch (error) {
      console.error('[Usuarios] Error al guardar:', error.cause || error); errorBox.textContent = error.friendly || 'No se pudo completar la operación.'; errorBox.classList.remove('d-none');
    } finally { button.disabled = false; button.textContent = 'Guardar cambios'; }
  }

  async function toggle(user) {
    const next = !isActive(user.estado);
    if (user.usuario_id === window.appContext.currentUser.usuario_id && !next) { feedback('No puede inactivar el usuario con el que inició sesión.', false); return; }
    try { check(await db.from('usuario').update({ estado: next }).eq('usuario_id', user.usuario_id), 'Estado'); feedback(`Usuario ${next ? 'reactivado' : 'inactivado'} correctamente.`); await load(); }
    catch (error) { console.error('[Usuarios] Error al cambiar estado:', error.cause || error); feedback('No se pudo completar la operación.', false); }
  }

  function show() {
    document.querySelectorAll('#admin-dashboard,#admin-institutions,#admin-directors').forEach((section) => section?.classList.add('d-none'));
    view.classList.remove('d-none'); document.querySelector('#dashboard-title').textContent = 'Usuarios'; document.querySelector('#dashboard-subtitle').textContent = 'Administración general de cuentas del prototipo.';
    menu.querySelectorAll('.nav-link').forEach((item) => { item.classList.toggle('active', item === link); item.toggleAttribute('aria-current', item === link); }); load();
  }

  link.onclick = (event) => { event.preventDefault(); show(); };
  view.querySelectorAll('[data-filter]').forEach((element) => element.addEventListener(element.tagName === 'INPUT' ? 'input' : 'change', () => { state.page = 1; render(); }));
  view.querySelector('[data-clear]').onclick = () => { view.querySelectorAll('[data-filter]').forEach((element) => { element.value = ''; }); state.page = 1; render(); };
  view.querySelector('tbody').onclick = (event) => { const button = event.target.closest('[data-edit],[data-toggle],[data-director]'); if (!button) return; const id = button.dataset.edit || button.dataset.toggle || button.dataset.director; const user = state.rows.find((item) => String(item.usuario_id) === id); if (button.dataset.edit) open(user); else if (button.dataset.director) window.previAdminShowDirectors?.(); else toggle(user); };
  form.onsubmit = save; window.previAdminShowUsers = show;
})();
