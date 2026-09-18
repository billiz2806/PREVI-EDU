'use strict';

(() => {
  const user = window.previEduCurrentUser;
  if (!user || user.role !== 'DIRECTOR') return;

  const db = window.supabaseClient;
  const menu = document.querySelector('#main-menu');
  const view = document.querySelector('#academic-management-view');
  const dashboard = document.querySelector('#dashboard-director');
  const institution = document.querySelector('#institution-view');
  const title = document.querySelector('#dashboard-title');
  const subtitle = document.querySelector('#dashboard-subtitle');
  const tabs = [...document.querySelectorAll('[data-academic-tab]')];
  const modalElement = document.querySelector('#academic-record-modal');
  const modal = new window.tabler.Modal(modalElement);
  const modalForm = document.querySelector('#academic-record-form');
  const modalBody = document.querySelector('#academic-modal-body');
  const modalSave = document.querySelector('#academic-modal-save');
  const loadedTabs = new Set();
  let modalHandler = null;
  let modalSuccessMessage = null;
  let years = [];
  let levels = [];
  let sections = [];
  let grades = [];
  let areas = [];
  let areaLevels = [];
  let assignmentRelations = [];

  const link = (label) => [...menu.querySelectorAll('.nav-link')].find((item) => item.textContent.trim() === label);
  const academicLink = link('Gestión Académica');
  const dashboardLink = link('Dashboard');
  const institutionLink = link('Institución');
  if (!academicLink || !dashboardLink || !institutionLink) return;

  const one = (value) => Array.isArray(value) ? value[0] : value;
  const text = (value, fallback = 'No hay información disponible.') => value === null || value === undefined || value === '' ? fallback : String(value);
  const date = (value) => {
    if (!value) return 'No hay información disponible.';
    const [year, month, day] = String(value).split('-');
    return year && month && day ? `${day}/${month}/${year}` : 'No hay información disponible.';
  };
  const statusText = (value) => value === true ? 'Activo' : value === false ? 'Inactivo' : text(value);
  const data = (response, context) => {
    if (response.error) throw new Error(context, { cause: response.error });
    return response.data;
  };
  const technicalError = (context, error) => console.error(`[Gestión Académica] ${context}`, error.cause || error);

  function feedback(message, success = true) {
    const alert = document.querySelector('#academic-global-feedback');
    alert.textContent = message;
    alert.classList.remove('d-none', 'alert-success', 'alert-danger');
    alert.classList.add(success ? 'alert-success' : 'alert-danger');
    alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function badge(state) {
    const element = document.createElement('span');
    element.className = `badge academic-status${state === true ? '' : ' is-inactive'}`;
    element.textContent = statusText(state);
    return element;
  }

  function actionButton(label, handler, secondary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn-sm ${secondary ? 'btn-outline-secondary' : 'btn-outline-primary'}`;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function actionCell(row, edit, toggle, state) {
    const cell = document.createElement('td');
    const group = document.createElement('div');
    group.className = 'academic-inline-actions';
    group.append(actionButton('Editar', edit), actionButton(state ? 'Inactivar' : 'Activar', toggle, true));
    cell.appendChild(group);
    row.appendChild(cell);
  }

  function cell(row, value) {
    const item = document.createElement('td');
    item.textContent = text(value);
    row.appendChild(item);
  }

  function statusCell(row, state) {
    const item = document.createElement('td');
    item.appendChild(badge(state));
    row.appendChild(item);
  }

  function fillSelect(select, rows, placeholder, id, label) {
    select.replaceChildren(new Option(placeholder, ''));
    rows.forEach((row) => select.add(new Option(label(row), row[id])));
    select.disabled = false;
  }

  function fieldInput(field) {
    const wrapper = document.createElement('div');
    wrapper.className = `mb-3${field.wrapperClass ? ` ${field.wrapperClass}` : ''}`;
    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = field.label;
    wrapper.appendChild(label);

    if (field.type === 'checks') {
      const grid = document.createElement('div');
      grid.className = 'modal-check-grid';
      field.options.forEach((option) => {
        const optionLabel = document.createElement('label');
        optionLabel.className = 'form-check';
        const input = document.createElement('input');
        input.className = 'form-check-input';
        input.type = 'checkbox';
        input.name = field.name;
        input.value = option.value;
        input.checked = (field.value || []).map(String).includes(String(option.value));
        const span = document.createElement('span');
        span.className = 'form-check-label';
        span.textContent = option.label;
        optionLabel.append(input, span);
        grid.appendChild(optionLabel);
      });
      wrapper.appendChild(grid);
      return wrapper;
    }

    const input = field.type === 'select' ? document.createElement('select') : document.createElement('input');
    input.className = field.type === 'select' ? 'form-select' : 'form-control';
    input.name = field.name;
    input.required = Boolean(field.required);
    if (field.type === 'select') {
      input.add(new Option('Seleccione una opción', ''));
      field.options.forEach((option) => input.add(new Option(option.label, option.value)));
      input.value = field.value ?? '';
    } else {
      input.type = field.type || 'text';
      input.value = field.value ?? '';
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.readonly) {
        input.readOnly = true;
        input.setAttribute('aria-readonly', 'true');
        input.classList.add('academic-locked-field');
        input.title = field.title || 'Este valor se establece automáticamente.';
      }
    }
    const invalid = document.createElement('div');
    invalid.className = 'invalid-feedback';
    invalid.textContent = field.invalidMessage || `${field.label} es obligatorio.`;
    wrapper.append(input, invalid);
    return wrapper;
  }

  function openModal(config) {
    document.querySelector('#academic-modal-title').textContent = config.title;
    modalBody.replaceChildren(...config.fields.map(fieldInput));
    modalBody.classList.toggle('competency-modal-grid', config.layout === 'competency');
    modalHandler = config.save;
    modalSuccessMessage = config.successMessage || null;
    modalSave.textContent = config.submitLabel || 'Guardar';
    modalElement.dataset.submitLabel = config.submitLabel || 'Guardar';
    modalForm.classList.remove('was-validated');
    modal.show();
    if (config.onOpen) Promise.resolve(config.onOpen()).catch((error) => { technicalError('No se pudo preparar el formulario.', error); feedback('No se pudo cargar la información.', false); });
  }

  modalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!modalForm.checkValidity()) {
      modalForm.classList.add('was-validated');
      return;
    }
    const formData = new FormData(modalForm);
    const values = Object.fromEntries(formData.entries());
    modalBody.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      values[input.name] = formData.getAll(input.name);
    });
    modalSave.disabled = true;
    modalSave.textContent = 'Guardando...';
    try {
      await modalHandler(values);
      modal.hide();
      feedback(modalSuccessMessage || configMessage(modalElement.dataset.mode));
    } catch (error) {
      technicalError('No se pudo guardar el registro.', error);
      if (error.userMessage) {
        let modalFeedback = modalBody.querySelector('.academic-modal-feedback');
        if (!modalFeedback) { modalFeedback = document.createElement('div'); modalFeedback.className = 'alert alert-danger academic-modal-feedback'; modalBody.prepend(modalFeedback); }
        modalFeedback.textContent = error.userMessage;
      } else feedback('No se pudo guardar la información.', false);
    } finally {
      modalSave.disabled = false;
      modalSave.textContent = modalElement.dataset.submitLabel || 'Guardar';
    }
  });

  const configMessage = (mode) => mode === 'edit' ? 'Información actualizada correctamente.' : 'Registro guardado correctamente.';
  function setMode(mode) { modalElement.dataset.mode = mode; }
  function userError(message) { const error = new Error(message); error.userMessage = message; return error; }

  async function exists(table, filters, exclude = null) {
    let query = db.from(table).select('*', { count: 'exact', head: true });
    Object.entries(filters).forEach(([key, value]) => { query = query.eq(key, value); });
    if (exclude) query = query.neq(exclude.key, exclude.value);
    const response = await query;
    data(response, `No se pudo validar ${table}.`);
    return response.count > 0;
  }

  async function toggle(table, idColumn, id, state, refresh) {
    try {
      data(await db.from(table).update({ estado: !state }).eq(idColumn, id), `No se pudo actualizar ${table}.`);
      feedback('Información actualizada correctamente.');
      await refresh();
    } catch (error) {
      technicalError(`Error al actualizar ${table}.`, error);
      feedback('No se pudo guardar la información.', false);
    }
  }

  function setActiveMenu(active) {
    menu.querySelectorAll('.nav-link').forEach((item) => {
      item.classList.toggle('active', item === active);
      if (item === active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
  }

  function showAcademic(event) {
    event.preventDefault();
    dashboard.classList.add('d-none');
    institution.classList.add('d-none');
    view.classList.remove('d-none');
    title.textContent = 'Gestión Académica';
    subtitle.textContent = 'Estructura académica y configuración curricular';
    setActiveMenu(academicLink);
    activateTab('school-year');
  }

  function leaveAcademic() { view.classList.add('d-none'); }

  function activateTab(name) {
    tabs.forEach((button) => {
      const active = button.dataset.academicTab === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.academic-pane').forEach((pane) => pane.classList.toggle('d-none', pane.id !== `academic-pane-${name}`));
    if (!loadedTabs.has(name)) {
      loadedTabs.add(name);
      ({ 'school-year': refreshYears, grades: initializeGrades, areas: refreshAreas, competencies: initializeCompetencies, 'classroom-areas': initializeAssignments })[name]();
    }
  }

  async function fetchLevels() {
    levels = data(await db.from('nivel_educativo').select('nivel_id,nombre,estado').order('nombre'), 'No se pudieron consultar los niveles.') || [];
    return levels;
  }

  async function fetchYears() {
    years = data(await db.from('anio_escolar').select('anio_escolar_id,institucion_id,anio,fecha_inicio,fecha_fin,estado').eq('institucion_id', window.appContext.currentInstitution.institucion_id).order('anio', { ascending: false }), 'No se pudieron consultar los años.') || [];
    return years;
  }

  async function institutionId() {
    const row = window.appContext.currentInstitution;
    if (!row) throw new Error('No existe una institución disponible.');
    return row.institucion_id;
  }

  async function refreshYears(preferredId) {
    const loading = document.querySelector('#academic-year-loading');
    const content = document.querySelector('#academic-year-content');
    const message = document.querySelector('#academic-year-message');
    const empty = document.querySelector('#academic-year-empty');
    const newButton = document.querySelector('#new-school-year-button');
    const currentYear = new Date().getFullYear();
    loading.classList.remove('d-none'); content.classList.add('d-none'); empty.classList.add('d-none'); message.classList.add('d-none');
    try {
      await fetchYears();
      const currentYearExists = years.some((year) => Number(year.anio) === currentYear);
      newButton.classList.toggle('d-none', currentYearExists);
      newButton.disabled = currentYearExists;
      if (!years.length) {
        const emptyButton = document.querySelector('#create-current-school-year-button');
        emptyButton.textContent = `+ Crear año escolar ${currentYear}`;
        emptyButton.onclick = () => schoolYearModal();
        empty.classList.remove('d-none');
        refreshAssignmentYear();
        return;
      }
      const selector = document.querySelector('#school-year-selector');
      fillSelect(selector, years, 'Seleccione un año escolar', 'anio_escolar_id', (year) => `${year.anio} · ${statusText(year.estado)}`);
      const selected = years.find((year) => String(year.anio_escolar_id) === String(preferredId)) || years.find((year) => year.estado) || years[0];
      selector.value = selected.anio_escolar_id;
      await renderYear(selected);
      content.classList.remove('d-none');
      refreshAssignmentYear();
    } catch (error) { technicalError('Error al cargar años escolares.', error); message.textContent = 'No se pudo cargar la información.'; message.classList.remove('d-none'); }
    finally { loading.classList.add('d-none'); }
  }

  async function renderYear(year) {
    document.querySelector('#academic-year-value').textContent = text(year.anio);
    document.querySelector('#academic-year-start').textContent = date(year.fecha_inicio);
    document.querySelector('#academic-year-end').textContent = date(year.fecha_fin);
    const state = document.querySelector('#academic-year-status'); state.textContent = statusText(year.estado); state.classList.toggle('is-inactive', !year.estado);
    document.querySelector('#toggle-school-year-button').textContent = year.estado ? 'Inactivar' : 'Activar';
    document.querySelector('#edit-school-year-button').onclick = () => schoolYearModal(year);
    document.querySelector('#toggle-school-year-button').onclick = () => toggle('anio_escolar', 'anio_escolar_id', year.anio_escolar_id, year.estado, () => refreshYears(year.anio_escolar_id));
    document.querySelector('#new-period-button').onclick = () => periodModal(null, year.anio_escolar_id);
    await refreshPeriods(year.anio_escolar_id);
  }

  async function refreshPeriods(yearId) {
    const body = document.querySelector('#evaluation-periods-body');
    const table = document.querySelector('#evaluation-periods-table');
    const message = document.querySelector('#evaluation-periods-message');
    body.replaceChildren(); table.classList.add('d-none'); message.classList.add('d-none');
    try {
      const rows = data(await db.from('periodo_evaluacion').select('periodo_id,anio_escolar_id,nombre,orden,fecha_inicio,fecha_fin,estado').eq('anio_escolar_id', yearId).order('orden'), 'No se pudieron consultar los periodos.') || [];
      if (!rows.length) { message.textContent = 'No hay información disponible.'; message.classList.remove('d-none'); return; }
      rows.forEach((period) => {
        const row = document.createElement('tr');
        cell(row, period.nombre); cell(row, period.orden); cell(row, date(period.fecha_inicio)); cell(row, date(period.fecha_fin)); statusCell(row, period.estado);
        actionCell(row, () => periodModal(period, yearId), () => toggle('periodo_evaluacion', 'periodo_id', period.periodo_id, period.estado, () => refreshPeriods(yearId)), period.estado);
        body.appendChild(row);
      }); table.classList.remove('d-none');
    } catch (error) { technicalError('Error al cargar periodos.', error); message.textContent = 'No se pudo cargar la información.'; message.classList.remove('d-none'); }
  }

  function schoolYearModal(year = null) {
    const currentYear = new Date().getFullYear();
    setMode(year ? 'edit' : 'new');
    openModal({ title: year ? 'Editar año escolar' : 'Nuevo año escolar', fields: [
      { name: 'anio', label: 'Año escolar', type: 'number', min: 2000, required: true, value: year?.anio ?? currentYear, readonly: !year, title: `PREVI-EDU creará el año escolar ${currentYear}.` },
      { name: 'fecha_inicio', label: 'Fecha de inicio', type: 'date', required: true, value: year?.fecha_inicio },
      { name: 'fecha_fin', label: 'Fecha de fin', type: 'date', required: true, value: year?.fecha_fin },
      { name: 'estado', label: 'Estado', type: 'select', required: true, value: String(year?.estado ?? true), options: [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }] }
    ], submitLabel: year ? 'Guardar cambios' : 'Crear año escolar', successMessage: year ? 'Información actualizada correctamente.' : `Año escolar ${currentYear} creado correctamente.`, save: async (values) => {
      const selectedYear = Number(values.anio);
      if (!year && selectedYear !== currentYear) throw userError(`Solo se puede crear el año escolar correspondiente al año actual (${currentYear}).`);
      const start = values.fecha_inicio || null;
      const end = values.fecha_fin || null;
      if (start && Number(start.slice(0, 4)) !== selectedYear) throw userError(`Las fechas deben corresponder al año escolar ${selectedYear}.`);
      if (end && Number(end.slice(0, 4)) !== selectedYear) throw userError(`Las fechas deben corresponder al año escolar ${selectedYear}.`);
      if (start && end && end < start) throw userError('La fecha de fin no puede ser anterior a la fecha de inicio.');
      const payload = { anio: selectedYear, fecha_inicio: start, fecha_fin: end, estado: values.estado === 'true' };
      const instId = year?.institucion_id || await institutionId();
      if (await exists('anio_escolar', { institucion_id: instId, anio: payload.anio }, year && { key: 'anio_escolar_id', value: year.anio_escolar_id })) throw userError(`El año escolar ${payload.anio} ya se encuentra registrado para esta institución.`);
      let saved;
      if (year) saved = data(await db.from('anio_escolar').update(payload).eq('anio_escolar_id', year.anio_escolar_id).select().single(), 'No se pudo actualizar el año.');
      else saved = data(await db.from('anio_escolar').insert({ ...payload, institucion_id: instId }).select().single(), 'No se pudo crear el año.');
      if (!year && window.appContext?.scope?.yearIds && !window.appContext.scope.yearIds.some((id) => String(id) === String(saved.anio_escolar_id))) {
        window.appContext.scope.yearIds.push(saved.anio_escolar_id);
      }
      window.appContext.currentAcademicYear = saved;
      window.dispatchEvent(new CustomEvent('previ:academic-year-change', { detail: { academicYear: saved } }));
      await refreshYears(saved.anio_escolar_id);
    }});
  }

  function periodModal(period, yearId) {
    setMode(period ? 'edit' : 'new');
    openModal({ title: period ? 'Editar periodo' : 'Nuevo periodo', fields: [
      { name: 'nombre', label: 'Nombre', required: true, value: period?.nombre }, { name: 'orden', label: 'Orden', type: 'number', min: 1, required: true, value: period?.orden },
      { name: 'fecha_inicio', label: 'Fecha de inicio', type: 'date', required: true, value: period?.fecha_inicio }, { name: 'fecha_fin', label: 'Fecha de fin', type: 'date', required: true, value: period?.fecha_fin },
      { name: 'estado', label: 'Estado', type: 'select', required: true, value: String(period?.estado ?? true), options: [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }] }
    ], save: async (values) => {
      const payload = { nombre: values.nombre.trim(), orden: Number(values.orden), fecha_inicio: values.fecha_inicio, fecha_fin: values.fecha_fin, estado: values.estado === 'true' };
      if (await exists('periodo_evaluacion', { anio_escolar_id: yearId, nombre: payload.nombre }, period && { key: 'periodo_id', value: period.periodo_id })) throw new Error('El periodo ya existe.');
      if (period) data(await db.from('periodo_evaluacion').update(payload).eq('periodo_id', period.periodo_id), 'No se pudo actualizar el periodo.');
      else data(await db.from('periodo_evaluacion').insert({ ...payload, anio_escolar_id: yearId }), 'No se pudo crear el periodo.');
      await refreshPeriods(yearId);
    }});
  }

  async function initializeGrades() {
    try { await Promise.all([fetchLevels(), fetchSections(), fetchYears()]); fillSelect(document.querySelector('#grades-level-filter'), levels, 'Seleccione un nivel educativo', 'nivel_id', (level) => level.nombre); }
    catch (error) { technicalError('Error al preparar grados.', error); document.querySelector('#grades-message').textContent = 'No se pudo cargar la información.'; }
  }

  async function fetchSections() {
    sections = data(await db.from('seccion').select('seccion_id,nombre,estado').order('nombre'), 'No se pudieron consultar las secciones.') || [];
    renderSections(); return sections;
  }

  function renderSections() {
    const container = document.querySelector('#sections-content'); container.replaceChildren();
    sections.forEach((section) => {
      const item = document.createElement('div'); item.className = 'section-item';
      const name = document.createElement('strong'); name.textContent = text(section.nombre);
      const actions = document.createElement('div'); actions.className = 'academic-inline-actions'; actions.append(badge(section.estado), actionButton('Editar', () => sectionModal(section)), actionButton(section.estado ? 'Inactivar' : 'Activar', () => toggle('seccion', 'seccion_id', section.seccion_id, section.estado, fetchSections), true));
      item.append(name, actions); container.appendChild(item);
    });
    document.querySelector('#sections-message').classList.toggle('d-none', sections.length > 0);
  }

  async function refreshGrades(levelId) {
    const content = document.querySelector('#grades-content'); const message = document.querySelector('#grades-message'); content.replaceChildren(); content.classList.add('d-none'); message.classList.add('d-none');
    const classroomButton = document.querySelector('#new-classroom-button');
    classroomButton.disabled = !levelId;
    if (!levelId) { message.textContent = 'Seleccione un nivel educativo.'; message.classList.remove('d-none'); return; }
    try {
      grades = data(await db.from('grado').select('grado_id,nivel_id,nombre,orden,estado').eq('nivel_id', levelId).order('orden'), 'No se pudieron consultar los grados.') || [];
      const ids = grades.map((grade) => grade.grado_id);
      const classrooms = ids.length && window.appContext.scope.yearIds.length ? data(await db.from('aula').select('aula_id,anio_escolar_id,grado_id,seccion_id,estado,seccion(nombre),anio_escolar(anio)').in('grado_id', ids).in('anio_escolar_id', window.appContext.scope.yearIds), 'No se pudieron consultar las aulas.') || [] : [];
      classroomButton.disabled = grades.length === 0;
      if (!grades.length) { message.textContent = 'No hay información disponible.'; message.classList.remove('d-none'); return; }
      grades.forEach((grade) => {
        const card = document.createElement('article'); card.className = 'grade-card';
        const header = document.createElement('div'); header.className = 'area-card-heading'; const name = document.createElement('h3'); name.textContent = text(grade.nombre);
        const actions = document.createElement('div'); actions.className = 'academic-inline-actions'; actions.append(badge(grade.estado), actionButton('Editar', () => gradeModal(grade)), actionButton(grade.estado ? 'Inactivar' : 'Activar', () => toggle('grado', 'grado_id', grade.grado_id, grade.estado, () => refreshGrades(levelId)), true)); header.append(name, actions);
        const list = document.createElement('div'); list.className = 'classroom-list';
        classrooms.filter((room) => room.grado_id === grade.grado_id).forEach((room) => { const item = document.createElement('div'); item.className = 'classroom-row'; const label = document.createElement('span'); label.textContent = `${grade.nombre} ${text(one(room.seccion)?.nombre, '')} · ${text(one(room.anio_escolar)?.anio, '')}`; const buttons = document.createElement('div'); buttons.className = 'academic-inline-actions'; buttons.append(badge(room.estado), actionButton('Editar', () => classroomModal(room)), actionButton(room.estado ? 'Inactivar' : 'Activar', () => toggle('aula', 'aula_id', room.aula_id, room.estado, () => refreshGrades(levelId)), true)); item.append(label, buttons); list.appendChild(item); });
        card.append(header, list); content.appendChild(card);
      }); content.classList.remove('d-none');
    } catch (error) { technicalError('Error al cargar grados y aulas.', error); message.textContent = 'No se pudo cargar la información.'; message.classList.remove('d-none'); }
  }

  function gradeModal(grade = null) {
    setMode(grade ? 'edit' : 'new');
    openModal({ title: grade ? 'Editar grado' : 'Nuevo grado', fields: [
      { name: 'nivel_id', label: 'Nivel educativo', type: 'select', required: true, value: grade?.nivel_id, options: levels.map((level) => ({ value: level.nivel_id, label: level.nombre })) },
      { name: 'nombre', label: 'Nombre', required: true, value: grade?.nombre }, { name: 'orden', label: 'Orden', type: 'number', min: 1, required: true, value: grade?.orden },
      { name: 'estado', label: 'Estado', type: 'select', required: true, value: String(grade?.estado ?? true), options: [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }] }
    ], save: async (values) => { const payload = { nivel_id: values.nivel_id, nombre: values.nombre.trim(), orden: Number(values.orden), estado: values.estado === 'true' }; if (await exists('grado', { nivel_id: payload.nivel_id, nombre: payload.nombre }, grade && { key: 'grado_id', value: grade.grado_id })) throw new Error('El grado ya existe.'); if (grade) data(await db.from('grado').update(payload).eq('grado_id', grade.grado_id), 'No se pudo actualizar el grado.'); else data(await db.from('grado').insert(payload), 'No se pudo crear el grado.'); document.querySelector('#grades-level-filter').value = payload.nivel_id; await refreshGrades(payload.nivel_id); }});
  }

  function sectionModal(section = null) {
    setMode(section ? 'edit' : 'new');
    openModal({ title: section ? 'Editar sección' : 'Nueva sección', fields: [{ name: 'nombre', label: 'Nombre', required: true, value: section?.nombre }, { name: 'estado', label: 'Estado', type: 'select', required: true, value: String(section?.estado ?? true), options: [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }] }], save: async (values) => { const payload = { nombre: values.nombre.trim(), estado: values.estado === 'true' }; if (await exists('seccion', { nombre: payload.nombre }, section && { key: 'seccion_id', value: section.seccion_id })) throw new Error('La sección ya existe.'); if (section) data(await db.from('seccion').update(payload).eq('seccion_id', section.seccion_id), 'No se pudo actualizar la sección.'); else data(await db.from('seccion').insert(payload), 'No se pudo crear la sección.'); await fetchSections(); }});
  }

  function classroomModal(room = null) {
    setMode(room ? 'edit' : 'new');
    const allGrades = grades.length ? grades : [];
    openModal({ title: room ? 'Editar aula' : 'Nueva aula', fields: [
      { name: 'anio_escolar_id', label: 'Año escolar', type: 'select', required: true, value: room?.anio_escolar_id, options: years.map((year) => ({ value: year.anio_escolar_id, label: year.anio })) },
      { name: 'grado_id', label: 'Grado', type: 'select', required: true, value: room?.grado_id, options: allGrades.map((grade) => ({ value: grade.grado_id, label: grade.nombre })) },
      { name: 'seccion_id', label: 'Sección', type: 'select', required: true, value: room?.seccion_id, options: sections.map((section) => ({ value: section.seccion_id, label: section.nombre })) },
      { name: 'estado', label: 'Estado', type: 'select', required: true, value: String(room?.estado ?? true), options: [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }] }
    ], save: async (values) => { const payload = { anio_escolar_id: values.anio_escolar_id, grado_id: values.grado_id, seccion_id: values.seccion_id, estado: values.estado === 'true' }; if (await exists('aula', { anio_escolar_id: payload.anio_escolar_id, grado_id: payload.grado_id, seccion_id: payload.seccion_id }, room && { key: 'aula_id', value: room.aula_id })) throw new Error('El aula ya existe.'); if (room) data(await db.from('aula').update(payload).eq('aula_id', room.aula_id), 'No se pudo actualizar el aula.'); else data(await db.from('aula').insert(payload), 'No se pudo crear el aula.'); await refreshGrades(document.querySelector('#grades-level-filter').value); }});
  }

  async function refreshAreas() {
    const loading = document.querySelector('#areas-loading'); const content = document.querySelector('#areas-content'); const message = document.querySelector('#areas-message'); loading.classList.remove('d-none'); content.replaceChildren(); content.classList.add('d-none'); message.classList.add('d-none');
    try {
      await fetchLevels();
      [areas, areaLevels] = await Promise.all([
        db.from('area_curricular').select('area_curricular_id,nombre,descripcion,estado').order('nombre').then((r) => data(r, 'No se pudieron consultar las áreas.') || []),
        db.from('area_curricular_nivel').select('area_curricular_nivel_id,area_curricular_id,nivel_id,estado,nivel_educativo(nombre)').then((r) => data(r, 'No se pudieron consultar las relaciones de áreas.') || [])
      ]);
      if (!areas.length) { message.textContent = 'No hay información disponible.'; message.classList.remove('d-none'); return; }
      areas.forEach((area) => {
        const card = document.createElement('article'); card.className = 'area-card'; const heading = document.createElement('div'); heading.className = 'area-card-heading'; const name = document.createElement('h3'); name.textContent = text(area.nombre); const controls = document.createElement('div'); controls.className = 'academic-inline-actions'; controls.append(badge(area.estado), actionButton('Editar', () => areaModal(area)), actionButton(area.estado ? 'Inactivar' : 'Activar', () => toggle('area_curricular', 'area_curricular_id', area.area_curricular_id, area.estado, refreshAreas), true)); heading.append(name, controls); const description = document.createElement('p'); description.textContent = text(area.descripcion); const badges = document.createElement('div'); badges.className = 'level-badges'; areaLevels.filter((item) => item.area_curricular_id === area.area_curricular_id && item.estado).forEach((item) => { const tag = document.createElement('span'); tag.className = 'badge level-badge'; tag.textContent = text(one(item.nivel_educativo)?.nombre); badges.appendChild(tag); }); if (!badges.childElementCount) { const none = document.createElement('span'); none.className = 'academic-muted'; none.textContent = 'Sin niveles asociados.'; badges.appendChild(none); } card.append(heading, description, badges); content.appendChild(card);
      }); content.classList.remove('d-none');
    } catch (error) { technicalError('Error al cargar áreas.', error); message.textContent = 'No se pudo cargar la información.'; message.classList.remove('d-none'); }
    finally { loading.classList.add('d-none'); }
  }

  function areaModal(area = null) {
    setMode(area ? 'edit' : 'new');
    const selected = areaLevels.filter((item) => item.area_curricular_id === area?.area_curricular_id && item.estado).map((item) => item.nivel_id);
    openModal({ title: area ? 'Editar área curricular' : 'Nueva área curricular', fields: [{ name: 'nombre', label: 'Nombre', required: true, value: area?.nombre }, { name: 'descripcion', label: 'Descripción', value: area?.descripcion }, { name: 'niveles', label: 'Niveles educativos disponibles', type: 'checks', value: selected, options: levels.map((level) => ({ value: level.nivel_id, label: level.nombre })) }, { name: 'estado', label: 'Estado', type: 'select', required: true, value: String(area?.estado ?? true), options: [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }] }], save: async (values) => {
      const payload = { nombre: values.nombre.trim(), descripcion: values.descripcion.trim() || null, estado: values.estado === 'true' }; if (await exists('area_curricular', { nombre: payload.nombre }, area && { key: 'area_curricular_id', value: area.area_curricular_id })) throw new Error('El área ya existe.'); let areaId; if (area) { data(await db.from('area_curricular').update(payload).eq('area_curricular_id', area.area_curricular_id), 'No se pudo actualizar el área.'); areaId = area.area_curricular_id; } else { areaId = data(await db.from('area_curricular').insert(payload).select('area_curricular_id').single(), 'No se pudo crear el área.').area_curricular_id; }
      const existingRows = data(await db.from('area_curricular_nivel').select('area_curricular_nivel_id,nivel_id,estado').eq('area_curricular_id', areaId), 'No se pudieron validar los niveles del área.') || []; const selectedLevels = new Set((values.niveles || []).map(String)); const requests = levels.map((level) => { const existing = existingRows.find((item) => String(item.nivel_id) === String(level.nivel_id)); const enabled = selectedLevels.has(String(level.nivel_id)); if (existing && existing.estado !== enabled) return db.from('area_curricular_nivel').update({ estado: enabled }).eq('area_curricular_nivel_id', existing.area_curricular_nivel_id); if (!existing && enabled) return db.from('area_curricular_nivel').insert({ area_curricular_id: areaId, nivel_id: level.nivel_id, estado: true }); return Promise.resolve({ error: null }); }); const results = await Promise.all(requests); const failed = results.find((result) => result.error); if (failed) throw new Error('No se pudieron guardar los niveles.', { cause: failed.error }); await refreshAreas();
    }});
  }

  async function initializeCompetencies() { try { await fetchLevels(); fillSelect(document.querySelector('#competencies-level-filter'), levels, 'Seleccione un nivel educativo', 'nivel_id', (level) => level.nombre); } catch (error) { technicalError('Error al preparar competencias.', error); } }

  async function loadCompetencyAreas(levelId) {
    const select = document.querySelector('#competencies-area-filter'); const message = document.querySelector('#competencies-message'); select.replaceChildren(new Option('Seleccione un área curricular', '')); select.disabled = true; document.querySelector('#new-competency-button').disabled = true; document.querySelector('#competencies-table').classList.add('d-none'); message.textContent = 'Seleccione un área curricular para visualizar sus competencias.'; message.classList.remove('d-none'); if (!levelId) return;
    try { areaLevels = data(await db.from('area_curricular_nivel').select('area_curricular_nivel_id,area_curricular_id,nivel_id,estado,area_curricular(nombre,estado)').eq('nivel_id', levelId).eq('estado', true), 'No se pudieron consultar las áreas del nivel.') || []; fillSelect(select, areaLevels, 'Seleccione un área curricular', 'area_curricular_nivel_id', (item) => text(one(item.area_curricular)?.nombre)); }
    catch (error) { technicalError('Error al cargar áreas de competencias.', error); message.textContent = 'No se pudo cargar la información.'; }
  }

  async function refreshCompetencies(relationId) {
    const body = document.querySelector('#competencies-body'); const table = document.querySelector('#competencies-table'); const message = document.querySelector('#competencies-message'); body.replaceChildren(); table.classList.add('d-none'); document.querySelector('#new-competency-button').disabled = !relationId; if (!relationId) return;
    try { const rows = data(await db.from('competencia').select('competencia_id,area_curricular_nivel_id,nombre,descripcion,orden,estado').eq('area_curricular_nivel_id', relationId).order('orden'), 'No se pudieron consultar las competencias.') || []; if (!rows.length) { message.textContent = 'No hay competencias registradas para esta área.'; message.classList.remove('d-none'); return; } message.classList.add('d-none'); rows.forEach((item) => { const row = document.createElement('tr'); cell(row, item.orden); cell(row, item.nombre); cell(row, item.descripcion); statusCell(row, item.estado); actionCell(row, () => competencyModal(item, relationId), () => toggle('competencia', 'competencia_id', item.competencia_id, item.estado, () => refreshCompetencies(relationId)), item.estado); body.appendChild(row); }); table.classList.remove('d-none'); }
    catch (error) { technicalError('Error al cargar competencias.', error); message.textContent = 'No se pudo cargar la información.'; message.classList.remove('d-none'); }
  }

  async function loadModalCompetencyAreas(levelId, selectedAreaId = '') {
    const select = modalBody.querySelector('[name="area_curricular_id"]');
    select.replaceChildren(new Option('Seleccione un área curricular', ''));
    select.disabled = true;
    if (!levelId) return;
    const relations = data(await db.from('area_curricular_nivel').select('area_curricular_nivel_id,area_curricular_id,nivel_id,estado,area_curricular(nombre,estado)').eq('nivel_id', levelId).eq('estado', true), 'No se pudieron consultar las áreas del nivel.') || [];
    relations.filter((relation) => one(relation.area_curricular)?.estado !== false).forEach((relation) => select.add(new Option(text(one(relation.area_curricular)?.nombre), relation.area_curricular_id)));
    select.disabled = false;
    select.value = String(selectedAreaId || '');
  }

  async function competencyModal(item = null, relationId = document.querySelector('#competencies-area-filter').value) {
    try {
      await fetchLevels();
      let currentRelation = areaLevels.find((relation) => String(relation.area_curricular_nivel_id) === String(item?.area_curricular_nivel_id || relationId));
      if (!currentRelation && (item?.area_curricular_nivel_id || relationId)) currentRelation = data(await db.from('area_curricular_nivel').select('area_curricular_nivel_id,area_curricular_id,nivel_id,estado').eq('area_curricular_nivel_id', item?.area_curricular_nivel_id || relationId).maybeSingle(), 'No se pudo consultar la relación del área.');
      const mainLevel = document.querySelector('#competencies-level-filter').value;
      const initialLevel = currentRelation?.nivel_id || mainLevel;
      const initialArea = currentRelation?.area_curricular_id || '';
      setMode(item ? 'edit' : 'new');
      openModal({
        title: item ? 'Editar competencia' : 'Nueva competencia',
        layout: 'competency',
        successMessage: item ? 'Competencia actualizada correctamente.' : 'Competencia registrada correctamente.',
        fields: [
          { name: 'nivel_id', label: 'Nivel educativo', type: 'select', required: true, value: initialLevel, wrapperClass: 'competency-modal-half', invalidMessage: 'Seleccione un nivel educativo.', options: levels.filter((level) => level.estado !== false).map((level) => ({ value: level.nivel_id, label: level.nombre })) },
          { name: 'area_curricular_id', label: 'Área curricular', type: 'select', required: true, value: '', wrapperClass: 'competency-modal-half', invalidMessage: 'Seleccione un área curricular.', options: [] },
          { name: 'nombre', label: 'Nombre', required: true, value: item?.nombre, wrapperClass: 'competency-modal-full', invalidMessage: 'Ingrese el nombre de la competencia.' },
          { name: 'descripcion', label: 'Descripción', value: item?.descripcion, wrapperClass: 'competency-modal-full' },
          { name: 'orden', label: 'Orden', type: 'number', min: 1, required: true, value: item?.orden, wrapperClass: 'competency-modal-half', invalidMessage: 'Ingrese el orden.' },
          { name: 'estado', label: 'Estado', type: 'select', required: true, value: String(item?.estado ?? true), wrapperClass: 'competency-modal-half', options: [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }] }
        ],
        onOpen: async () => {
          const levelSelect = modalBody.querySelector('[name="nivel_id"]');
          await loadModalCompetencyAreas(levelSelect.value, initialArea);
          levelSelect.addEventListener('change', async () => {
            const areaSelect = modalBody.querySelector('[name="area_curricular_id"]');
            areaSelect.value = '';
            try { await loadModalCompetencyAreas(levelSelect.value); }
            catch (error) { technicalError('No se pudieron cargar las áreas del nivel.', error); feedback('No se pudo cargar la información.', false); }
          });
        },
        save: async (values) => {
          if (!values.nivel_id) throw userError('Seleccione un nivel educativo.');
          if (!values.area_curricular_id) throw userError('Seleccione un área curricular.');
          if (!values.nombre?.trim()) throw userError('Ingrese el nombre de la competencia.');
          if (!values.orden || Number(values.orden) < 1) throw userError('Ingrese el orden.');
          const relation = data(await db.from('area_curricular_nivel').select('area_curricular_nivel_id,nivel_id,area_curricular_id,estado').eq('nivel_id', values.nivel_id).eq('area_curricular_id', values.area_curricular_id).eq('estado', true).limit(1).maybeSingle(), 'No se pudo validar la relación entre área y nivel.');
          if (!relation) throw userError('El área curricular seleccionada no está configurada para este nivel educativo.');
          let duplicateQuery = db.from('competencia').select('competencia_id').eq('area_curricular_nivel_id', relation.area_curricular_nivel_id).ilike('nombre', values.nombre.trim()).limit(1);
          if (item) duplicateQuery = duplicateQuery.neq('competencia_id', item.competencia_id);
          if ((data(await duplicateQuery, 'No se pudo validar la competencia.') || []).length) throw userError('Ya existe una competencia con este nombre para el área y nivel seleccionados.');
          const payload = { area_curricular_nivel_id: relation.area_curricular_nivel_id, nombre: values.nombre.trim(), descripcion: values.descripcion.trim() || null, orden: Number(values.orden), estado: values.estado === 'true' };
          if (item) data(await db.from('competencia').update(payload).eq('competencia_id', item.competencia_id), 'No se pudo actualizar la competencia.');
          else data(await db.from('competencia').insert(payload), 'No se pudo crear la competencia.');
          const levelFilter = document.querySelector('#competencies-level-filter');
          levelFilter.value = String(values.nivel_id);
          await loadCompetencyAreas(values.nivel_id);
          const areaFilter = document.querySelector('#competencies-area-filter');
          areaFilter.value = String(relation.area_curricular_nivel_id);
          await refreshCompetencies(relation.area_curricular_nivel_id);
        }
      });
    } catch (error) {
      technicalError('No se pudo abrir el formulario de competencia.', error);
      feedback(error.userMessage || 'No se pudo cargar la información.', false);
    }
  }

  async function initializeAssignments() { try { await Promise.all([fetchYears(), fetchLevels()]); refreshAssignmentYear(); fillSelect(document.querySelector('#assignment-level-filter'), levels.filter((level) => level.estado), 'Seleccione un nivel educativo', 'nivel_id', (level) => level.nombre); } catch (error) { technicalError('Error al preparar asignaciones.', error); } }
  function refreshAssignmentYear() { const select = document.querySelector('#assignment-year-filter'); if (!select || !loadedTabs.has('classroom-areas')) return; const active = years.find((year) => year.estado); select.replaceChildren(new Option(active ? active.anio : 'No hay información disponible', active?.anio_escolar_id || '', true, true)); }
  async function assignmentGrades(levelId) { const select = document.querySelector('#assignment-grade-filter'); const classroom = document.querySelector('#assignment-classroom-filter'); fillSelect(select, [], 'Seleccione un grado', 'grado_id', (item) => item.nombre); select.disabled = !levelId; classroom.disabled = true; resetAssignment(levelId ? 'Seleccione un grado.' : 'Seleccione un nivel educativo.'); if (!levelId) return; try { const rows = data(await db.from('grado').select('grado_id,nombre,orden,estado').eq('nivel_id', levelId).eq('estado', true).order('orden'), 'No se pudieron consultar los grados.') || []; fillSelect(select, rows, 'Seleccione un grado', 'grado_id', (item) => item.nombre); } catch (error) { technicalError('Error al cargar grados de asignación.', error); resetAssignment('No se pudo cargar la información.'); } }
  async function assignmentClassrooms(gradeId) { const select = document.querySelector('#assignment-classroom-filter'); select.replaceChildren(new Option('Seleccione un aula', '')); select.disabled = !gradeId; resetAssignment(gradeId ? 'Seleccione un aula.' : 'Seleccione un grado.'); if (!gradeId) return; try { const yearId = document.querySelector('#assignment-year-filter').value; const gradeName = document.querySelector('#assignment-grade-filter').selectedOptions[0]?.textContent || ''; const rooms = data(await db.from('aula').select('aula_id,seccion(nombre),estado').eq('anio_escolar_id', yearId).eq('grado_id', gradeId).eq('estado', true), 'No se pudieron consultar las aulas.') || []; fillSelect(select, rooms, 'Seleccione un aula', 'aula_id', (room) => `${gradeName} ${text(one(room.seccion)?.nombre, '')}`.trim()); } catch (error) { technicalError('Error al cargar aulas de asignación.', error); resetAssignment('No se pudo cargar la información.'); } }
  function resetAssignment(message) { document.querySelector('#classroom-areas-form').classList.add('d-none'); const item = document.querySelector('#classroom-areas-message'); item.textContent = message; item.classList.remove('d-none'); }
  async function loadAssignments(classroomId) { const form = document.querySelector('#classroom-areas-form'); const list = document.querySelector('#classroom-areas-list'); const message = document.querySelector('#classroom-areas-message'); form.classList.add('d-none'); list.replaceChildren(); if (!classroomId) { resetAssignment('Seleccione un aula.'); return; } try { const levelId = document.querySelector('#assignment-level-filter').value; const [availableResponse, existingResponse] = await Promise.all([db.from('area_curricular_nivel').select('area_curricular_nivel_id,area_curricular(nombre,descripcion)').eq('nivel_id', levelId).eq('estado', true), db.from('aula_area_curricular').select('aula_area_curricular_id,aula_id,area_curricular_nivel_id,estado').eq('aula_id', classroomId)]); const available = data(availableResponse, 'No se pudieron consultar las áreas disponibles.') || []; assignmentRelations = data(existingResponse, 'No se pudieron consultar las asignaciones.') || []; if (!available.length) { resetAssignment('No hay información disponible.'); return; } const existing = new Map(assignmentRelations.map((item) => [String(item.area_curricular_nivel_id), item])); available.forEach((item) => { const area = one(item.area_curricular); const option = document.createElement('label'); option.className = 'assignment-option'; const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'form-check-input'; check.value = item.area_curricular_nivel_id; check.checked = existing.get(String(item.area_curricular_nivel_id))?.estado === true; const labels = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = text(area?.nombre); const small = document.createElement('small'); small.textContent = text(area?.descripcion, 'Área curricular disponible'); labels.append(strong, small); option.append(check, labels); list.appendChild(option); }); document.querySelector('#classroom-areas-title').textContent = `Áreas asignadas a ${document.querySelector('#assignment-classroom-filter').selectedOptions[0]?.textContent || ''}`; message.classList.add('d-none'); form.classList.remove('d-none'); } catch (error) { technicalError('Error al cargar asignaciones.', error); resetAssignment('No se pudo cargar la información.'); } }
  async function saveAssignments(event) { event.preventDefault(); const form = event.currentTarget; const classroomId = document.querySelector('#assignment-classroom-filter').value; const selected = new Set([...form.querySelectorAll('input:checked')].map((input) => input.value)); const existing = new Map(assignmentRelations.map((item) => [String(item.area_curricular_nivel_id), item])); const requests = [...form.querySelectorAll('input[type="checkbox"]')].map((input) => { const row = existing.get(input.value); const enabled = selected.has(input.value); if (row && row.estado !== enabled) return db.from('aula_area_curricular').update({ estado: enabled }).eq('aula_area_curricular_id', row.aula_area_curricular_id); if (!row && enabled) return db.from('aula_area_curricular').insert({ aula_id: classroomId, area_curricular_nivel_id: input.value, estado: true }); return Promise.resolve({ error: null }); }); try { const results = await Promise.all(requests); const failed = results.find((result) => result.error); if (failed) throw new Error('No se pudo actualizar la asignación.', { cause: failed.error }); feedback('Áreas del aula actualizadas correctamente.'); await loadAssignments(classroomId); } catch (error) { technicalError('Error al guardar asignaciones.', error); feedback('No se pudo actualizar la configuración del aula.', false); } }

  academicLink.addEventListener('click', showAcademic); dashboardLink.addEventListener('click', leaveAcademic); institutionLink.addEventListener('click', leaveAcademic);
  tabs.forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.academicTab)));
  document.querySelector('#school-year-selector').addEventListener('change', (event) => { const year = years.find((item) => String(item.anio_escolar_id) === event.target.value); if (year) renderYear(year); });
  document.querySelector('#new-school-year-button').addEventListener('click', () => schoolYearModal());
  document.querySelector('#grades-level-filter').addEventListener('change', (event) => refreshGrades(event.target.value));
  document.querySelector('#new-grade-button').addEventListener('click', () => gradeModal()); document.querySelector('#new-section-button').addEventListener('click', () => sectionModal()); document.querySelector('#new-classroom-button').addEventListener('click', () => classroomModal());
  document.querySelector('#new-area-button').addEventListener('click', () => areaModal());
  document.querySelector('#competencies-level-filter').addEventListener('change', (event) => loadCompetencyAreas(event.target.value));
  document.querySelector('#competencies-area-filter').addEventListener('change', (event) => refreshCompetencies(event.target.value));
  document.querySelector('#new-competency-button').addEventListener('click', () => competencyModal());
  document.querySelector('#assignment-level-filter').addEventListener('change', (event) => assignmentGrades(event.target.value)); document.querySelector('#assignment-grade-filter').addEventListener('change', (event) => assignmentClassrooms(event.target.value)); document.querySelector('#assignment-classroom-filter').addEventListener('change', (event) => loadAssignments(event.target.value)); document.querySelector('#classroom-areas-form').addEventListener('submit', saveAssignments);
})();
