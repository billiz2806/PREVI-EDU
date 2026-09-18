'use strict';

(() => {
  if (window.appContext?.currentRole !== 'ADMINISTRADOR') return;
  const db = window.supabaseClient;
  const main = document.querySelector('main .container-xl');
  const menu = document.querySelector('#main-menu');
  const link = [...menu.querySelectorAll('.nav-link')].find((item) => item.textContent.trim() === 'Directores');

  main.insertAdjacentHTML('beforeend', `
    <section class="d-none" id="admin-directors"><div class="card admin-panel">
      <div class="card-header admin-section-header"><div><h2 class="card-title">Directores</h2><p class="text-secondary mb-0">Gestione la asignación funcional de usuarios como Directores.</p></div><button class="btn btn-primary" data-new type="button">+ Nuevo director</button></div>
      <div class="card-body admin-filters admin-filters-wide"><div><label class="form-label">Buscar</label><input class="form-control" data-search placeholder="Nombre, correo o usuario"></div><div><label class="form-label">Institución</label><select class="form-select" data-institution></select></div><div><label class="form-label">Estado</label><select class="form-select" data-status><option value="">Todos</option><option value="1">Activos</option><option value="0">Inactivos</option></select></div><button class="btn btn-outline-secondary" data-clear type="button">Limpiar</button></div>
      <div class="alert d-none mx-3 mt-3 mb-0" data-feedback></div><div class="admin-loading" data-loading>Cargando Directores...</div>
      <div class="table-responsive" data-table><table class="table table-vcenter card-table"><thead><tr><th>Director</th><th>Correo</th><th>Usuario</th><th>Institución</th><th>Estado</th><th>Acciones</th></tr></thead><tbody></tbody></table></div><div class="admin-empty d-none" data-empty>No hay Directores registrados.</div>
    </div></section>
    <div class="modal modal-blur fade" id="director-modal" tabindex="-1" aria-hidden="true"><div class="modal-dialog modal-dialog-centered"><form class="modal-content" novalidate>
      <div class="modal-header"><div><h2 class="modal-title">Nuevo director</h2><p class="modal-subtitle" data-reference>Asigne una cuenta existente.</p></div><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
      <div class="modal-body"><div class="alert alert-danger d-none" data-error></div>
        <div class="mb-3"><label class="form-label">Usuario *</label><select class="form-select" name="usuario_id" required></select><div class="form-hint">Un usuario Docente también puede recibir el perfil Director.</div></div>
        <div class="mb-3"><label class="form-label">Institución *</label><select class="form-select" name="institucion_id" required></select></div>
        <div><label class="form-label">Estado</label><select class="form-select" name="estado"><option value="true">Activo</option><option value="false">Inactivo</option></select></div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary" type="submit">Guardar director</button></div>
    </form></div></div>
    <div class="modal modal-blur fade" id="director-delete-modal" tabindex="-1" aria-hidden="true"><div class="modal-dialog modal-dialog-centered modal-sm"><div class="modal-content">
      <div class="modal-header"><div><h2 class="modal-title">Eliminar asignación de Director</h2><p class="modal-subtitle">Esta acción no elimina la cuenta.</p></div><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
      <div class="modal-body"><div class="director-delete-icon"><i class="ti ti-user-minus"></i></div><p id="director-delete-question"></p><p class="text-secondary mb-0">Esta acción eliminará únicamente su asignación como Director. La cuenta de usuario no será eliminada y, si también es Docente, ese perfil tampoco será modificado.</p><div class="alert alert-danger d-none mt-3 mb-0" data-delete-error></div></div>
      <div class="modal-footer"><button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-danger" type="button" data-confirm-delete>Eliminar asignación</button></div>
    </div></div></div>`);

  const view = document.querySelector('#admin-directors');
  const form = document.querySelector('#director-modal form');
  const modal = new window.tabler.Modal(document.querySelector('#director-modal'));
  const deleteModal = new window.tabler.Modal(document.querySelector('#director-delete-modal'));
  const state = { rows: [], users: [], institutions: [], editing: null, deleting: null };
  const one = (value) => Array.isArray(value) ? value[0] : value;
  const active = (value) => value === true || String(value).toUpperCase() === 'ACTIVO';
  const safe = (value, fallback = 'No registrado') => value == null || value === '' ? fallback : String(value);
  const norm = (value) => safe(value, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const esc = (value) => safe(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const check = (response, message) => { if (response.error) throw new Error(message, { cause: response.error }); return response.data || []; };
  const fullName = (user) => [user?.nombres, user?.apellidos].filter(Boolean).join(' ') || user?.nombre_usuario || 'Usuario';

  function message(text, ok = true) {
    const element = view.querySelector('[data-feedback]');
    element.textContent = text;
    element.className = `alert mx-3 mt-3 mb-0 ${ok ? 'alert-success' : 'alert-danger'}`;
  }

  async function load() {
    view.querySelector('[data-loading]').classList.remove('d-none');
    try {
      const [directors, users, institutions] = await Promise.all([
        db.from('director').select('director_id,usuario_id,institucion_id,estado,usuario(usuario_id,nombre_usuario,nombres,apellidos,correo,estado),institucion_educativa(institucion_id,nombre,estado)').order('director_id'),
        db.from('usuario').select('usuario_id,nombre_usuario,nombres,apellidos,correo,estado').order('nombres'),
        db.from('institucion_educativa').select('institucion_id,nombre,estado').order('nombre')
      ]);
      state.rows = check(directors, 'Directores');
      state.users = check(users, 'Usuarios');
      state.institutions = check(institutions, 'Instituciones');
      const institutionFilter = view.querySelector('[data-institution]');
      const previous = institutionFilter.value;
      institutionFilter.replaceChildren(new Option('Todas', ''));
      state.institutions.filter((item) => active(item.estado)).forEach((item) => institutionFilter.add(new Option(item.nombre, item.institucion_id)));
      institutionFilter.value = previous;
      render();
    } catch (error) {
      console.error('[Directores]', error.cause || error);
      message('No se pudo cargar la información.', false);
    } finally { view.querySelector('[data-loading]').classList.add('d-none'); }
  }

  function render() {
    const query = norm(view.querySelector('[data-search]').value);
    const institutionId = view.querySelector('[data-institution]').value;
    const status = view.querySelector('[data-status]').value;
    const rows = state.rows.filter((row) => {
      const user = one(row.usuario);
      return (!query || norm(`${user?.nombres} ${user?.apellidos} ${user?.correo} ${user?.nombre_usuario}`).includes(query)) && (!institutionId || String(row.institucion_id) === institutionId) && (!status || (status === '1') === active(row.estado));
    });
    view.querySelector('tbody').innerHTML = rows.map((row) => {
      const user = one(row.usuario), institution = one(row.institucion_educativa);
      return `<tr><td><strong>${esc(fullName(user))}</strong></td><td>${esc(user?.correo)}</td><td>${esc(user?.nombre_usuario)}</td><td>${esc(institution?.nombre)}${institution && !active(institution.estado) ? ' <span class="badge admin-status is-inactive">Inactiva</span>' : ''}</td><td><span class="badge admin-status ${active(row.estado) ? 'is-active' : 'is-inactive'}">${active(row.estado) ? 'Activo' : 'Inactivo'}</span></td><td><div class="admin-row-actions"><button class="btn btn-sm btn-outline-primary" type="button" data-edit="${row.director_id}">Editar</button><button class="btn btn-sm btn-outline-secondary" type="button" data-toggle="${row.director_id}">${active(row.estado) ? 'Inactivar' : 'Activar'}</button><button class="btn btn-sm btn-outline-danger" type="button" data-delete="${row.director_id}">Eliminar</button></div></td></tr>`;
    }).join('');
    view.querySelector('[data-table]').classList.toggle('d-none', !rows.length);
    view.querySelector('[data-empty]').classList.toggle('d-none', Boolean(rows.length));
  }

  function fillUserSelect(row) {
    const select = form.elements.usuario_id;
    select.replaceChildren(new Option('Seleccione', ''));
    state.users.filter((user) => active(user.estado) || user.usuario_id === row?.usuario_id).forEach((user) => {
      const assignedElsewhere = state.rows.some((director) => director.usuario_id === user.usuario_id && director.director_id !== row?.director_id);
      const option = new Option(`${fullName(user)} — ${user.correo || user.nombre_usuario}${assignedElsewhere ? ' · Ya es Director' : ''}`, user.usuario_id);
      select.add(option);
    });
    select.value = row?.usuario_id || '';
  }

  function open(row = null) {
    state.editing = row;
    form.reset();
    form.classList.remove('was-validated');
    form.querySelector('[data-error]').classList.add('d-none');
    form.querySelector('.modal-title').textContent = row ? 'Editar director' : 'Nuevo director';
    form.querySelector('[data-reference]').textContent = row ? 'Cambie el usuario, la institución o el estado de esta asignación.' : 'Asigne una cuenta existente como Director.';
    fillUserSelect(row);
    const institutions = state.institutions.filter((institution) => active(institution.estado) || institution.institucion_id === row?.institucion_id);
    const select = form.elements.institucion_id;
    select.replaceChildren(new Option('Seleccione', ''));
    institutions.forEach((institution) => select.add(new Option(`${institution.nombre}${active(institution.estado) ? '' : ' (Inactiva)'}`, institution.institucion_id)));
    select.value = row?.institucion_id || '';
    form.elements.estado.value = String(row ? active(row.estado) : true);
    form.querySelector('[type="submit"]').textContent = row ? 'Guardar cambios' : 'Guardar director';
    modal.show();
  }

  async function save(event) {
    event.preventDefault();
    if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
    const row = state.editing;
    const userId = Number(form.elements.usuario_id.value);
    const institutionId = Number(form.elements.institucion_id.value);
    const nextState = form.elements.estado.value === 'true';
    const box = form.querySelector('[data-error]');
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = 'Guardando...';
    try {
      if (state.rows.some((director) => director.usuario_id === userId && director.director_id !== row?.director_id)) throw Object.assign(new Error('Director duplicado.'), { friendly: 'El usuario seleccionado ya tiene una asignación como Director.' });
      if (row && (userId !== row.usuario_id || institutionId !== row.institucion_id)) {
        const user = state.users.find((item) => item.usuario_id === userId);
        const institution = state.institutions.find((item) => item.institucion_id === institutionId);
        if (!confirm(`Está por cambiar la asignación de Director a ${fullName(user)} en ${institution?.nombre || 'la institución seleccionada'}.\n\nLa cuenta del usuario anterior no será eliminada.`)) return;
      }
      const payload = { usuario_id: userId, institucion_id: institutionId, estado: nextState };
      if (row) check(await db.from('director').update(payload).eq('director_id', row.director_id), 'Director');
      else check(await db.from('director').insert(payload), 'Director');
      modal.hide();
      message(row ? 'Director actualizado correctamente.' : 'Director registrado correctamente.');
      await load();
      window.dispatchEvent(new Event('previ:institutions-updated'));
    } catch (error) {
      console.error('[Directores]', error.cause || error);
      box.textContent = error.friendly || 'No se pudo completar la operación.';
      box.classList.remove('d-none');
    } finally {
      button.disabled = false;
      button.textContent = row ? 'Guardar cambios' : 'Guardar director';
    }
  }

  async function toggle(row) {
    try {
      check(await db.from('director').update({ estado: !active(row.estado) }).eq('director_id', row.director_id), 'Estado');
      message(`Director ${active(row.estado) ? 'inactivado' : 'reactivado'} correctamente.`);
      await load();
    } catch (error) { console.error('[Directores]', error.cause || error); message('No se pudo completar la operación.', false); }
  }

  function requestDelete(row) {
    state.deleting = row;
    const user = one(row.usuario);
    document.querySelector('#director-delete-question').textContent = `¿Está seguro de eliminar la asignación de Director de ${fullName(user)}?`;
    document.querySelector('#director-delete-modal [data-delete-error]').classList.add('d-none');
    deleteModal.show();
  }

  async function removeAssignment() {
    if (!state.deleting) return;
    const button = document.querySelector('#director-delete-modal [data-confirm-delete]');
    const errorBox = document.querySelector('#director-delete-modal [data-delete-error]');
    button.disabled = true;
    button.textContent = 'Eliminando...';
    try {
      const response = await db.from('director').delete().eq('director_id', state.deleting.director_id).select('director_id');
      const removed = check(response, 'Eliminar Director');
      if (!removed.length) throw new Error('Supabase no devolvió la fila eliminada. Verifique la policy DELETE de director.');
      deleteModal.hide();
      state.deleting = null;
      message('Asignación de Director eliminada correctamente.');
      await load();
      window.dispatchEvent(new Event('previ:institutions-updated'));
    } catch (error) {
      console.error('[Directores] No se pudo eliminar la asignación.', error.cause || error);
      errorBox.textContent = 'No se pudo eliminar la asignación.';
      errorBox.classList.remove('d-none');
    } finally { button.disabled = false; button.textContent = 'Eliminar asignación'; }
  }

  function show() {
    document.querySelectorAll('#admin-dashboard,#admin-institutions,#admin-users').forEach((element) => element?.classList.add('d-none'));
    view.classList.remove('d-none');
    document.querySelector('#dashboard-title').textContent = 'Directores';
    document.querySelector('#dashboard-subtitle').textContent = 'Gestione la asignación funcional de usuarios como Directores.';
    menu.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item === link));
    load();
  }

  link.onclick = (event) => { event.preventDefault(); show(); };
  view.querySelector('[data-new]').onclick = () => open();
  view.querySelectorAll('[data-search],[data-institution],[data-status]').forEach((element) => element.addEventListener(element.tagName === 'INPUT' ? 'input' : 'change', render));
  view.querySelector('[data-clear]').onclick = () => { view.querySelectorAll('[data-search],[data-institution],[data-status]').forEach((element) => { element.value = ''; }); render(); };
  view.querySelector('tbody').onclick = (event) => {
    const button = event.target.closest('[data-edit],[data-toggle],[data-delete]');
    if (!button) return;
    const id = button.dataset.edit || button.dataset.toggle || button.dataset.delete;
    const row = state.rows.find((item) => String(item.director_id) === id);
    if (button.dataset.edit) open(row);
    else if (button.dataset.toggle) toggle(row);
    else requestDelete(row);
  };
  form.onsubmit = save;
  document.querySelector('#director-delete-modal [data-confirm-delete]').onclick = removeAssignment;
  window.previAdminShowDirectors = show;
})();
