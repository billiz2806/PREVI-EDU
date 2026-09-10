'use strict';

(() => {
  const user = window.previEduCurrentUser;
  if (!user || user.role !== 'DIRECTOR') return;

  const db = window.supabaseClient;
  const menu = document.querySelector('#main-menu');
  const view = document.querySelector('#students-view');
  const dashboard = document.querySelector('#dashboard-director');
  const institution = document.querySelector('#institution-view');
  const academic = document.querySelector('#academic-management-view');
  const title = document.querySelector('#dashboard-title');
  const subtitle = document.querySelector('#dashboard-subtitle');
  const tabs = [...document.querySelectorAll('[data-students-tab]')];
  const studentsLink = [...menu.querySelectorAll('.nav-link')].find((link) => link.textContent.trim() === 'Estudiantes');
  const otherLinks = [...menu.querySelectorAll('.nav-link')].filter((link) => ['Dashboard', 'Institución', 'Gestión Académica'].includes(link.textContent.trim()));
  if (!studentsLink || !view) return;

  const editModal = new window.tabler.Modal(document.querySelector('#student-edit-modal'));
  const profileModal = new window.tabler.Modal(document.querySelector('#student-profile-modal'));
  const state = { enrollments: [], filtered: [], years: [], levels: [], grades: [], classrooms: [], sections: [], page: 1, size: 10, loaded: false, importRows: [], editing: null };
  const relation = (value) => Array.isArray(value) ? value[0] : value;
  const safe = (value, fallback = 'No registrado') => value === null || value === undefined || value === '' ? fallback : String(value);
  const escapeHtml = (value) => safe(value, '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const fullName = (student) => [student?.nombres, student?.apellido_paterno, student?.apellido_materno].filter(Boolean).join(' ') || 'No hay información disponible.';
  const date = (value) => value ? new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : 'No registrado';
  const normalize = (value) => safe(value, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const responseData = (response, context) => { if (response.error) throw new Error(context, { cause: response.error }); return response.data; };
  const logError = (context, error) => console.error(`[Estudiantes] ${context}`, error.cause || error);

  function feedback(message, success = true) {
    const element = document.querySelector('#students-feedback');
    element.textContent = message;
    element.className = `alert students-feedback ${success ? 'alert-success' : 'alert-danger'}`;
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function activeMenu(link) {
    menu.querySelectorAll('.nav-link').forEach((item) => {
      item.classList.toggle('active', item === link);
      if (item === link) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
  }

  function showStudents(event) {
    event.preventDefault();
    dashboard?.classList.add('d-none'); institution?.classList.add('d-none'); academic?.classList.add('d-none');
    view.classList.remove('d-none'); title.textContent = 'ESTUDIANTES'; subtitle.textContent = 'Gestione los estudiantes matriculados en la institución'; activeMenu(studentsLink);
    activateTab('list');
    if (!state.loaded) initialize();
  }

  function hideStudents() { view.classList.add('d-none'); }

  function activateTab(name) {
    tabs.forEach((tab) => { const selected = tab.dataset.studentsTab === name; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); });
    document.querySelectorAll('.students-pane').forEach((pane) => pane.classList.toggle('d-none', pane.id !== `students-pane-${name}`));
  }

  function fill(select, rows, placeholder, key, label, selected = '') {
    select.replaceChildren(new Option(placeholder, ''));
    rows.forEach((row) => select.add(new Option(label(row), row[key], false, String(row[key]) === String(selected))));
    select.disabled = false;
  }

  async function loadCatalogs() {
    const [years, levels, grades, sections, classrooms] = await Promise.all([
      db.from('anio_escolar').select('anio_escolar_id,anio,estado').eq('institucion_id', window.appContext.currentInstitution.institucion_id).order('anio', { ascending: false }),
      db.from('nivel_educativo').select('nivel_id,nombre,estado').order('nombre'),
      db.from('grado').select('grado_id,nivel_id,nombre,orden,estado').order('orden'),
      db.from('seccion').select('seccion_id,nombre,estado').order('nombre'),
      db.from('aula').select('aula_id,anio_escolar_id,grado_id,seccion_id,estado').in('anio_escolar_id', window.appContext.scope.yearIds).order('aula_id')
    ]);
    state.years = responseData(years, 'No se pudieron consultar los años escolares.') || [];
    state.levels = responseData(levels, 'No se pudieron consultar los niveles.') || [];
    state.grades = responseData(grades, 'No se pudieron consultar los grados.') || [];
    state.sections = responseData(sections, 'No se pudieron consultar las secciones.') || [];
    state.classrooms = responseData(classrooms, 'No se pudieron consultar las aulas.') || [];
    configureFilters(); configureEnrollmentForms();
  }

  function configureFilters() {
    const year = document.querySelector('#students-year-filter'); const level = document.querySelector('#students-level-filter');
    fill(year, state.years, 'Todos los años', 'anio_escolar_id', (item) => item.anio);
    fill(level, state.levels, 'Todos los niveles', 'nivel_id', (item) => item.nombre);
  }

  function configureEnrollmentForms() {
    document.querySelectorAll('[data-enrollment-year]').forEach((select) => {
      const active = state.years.find((item) => item.estado);
      fill(select, state.years.filter((item) => item.estado), 'Seleccione un año', 'anio_escolar_id', (item) => item.anio, active?.anio_escolar_id);
    });
    document.querySelectorAll('[data-enrollment-level]').forEach((select) => fill(select, state.levels.filter((item) => item.estado), 'Seleccione un nivel', 'nivel_id', (item) => item.nombre));
  }

  async function loadEnrollments() {
    const loading = document.querySelector('#students-loading'); loading.classList.remove('d-none');
    try {
      const select = 'matricula_id,estudiante_id,aula_id,fecha_matricula,estado,estudiante(estudiante_id,codigo,dni,nombres,apellido_paterno,apellido_materno,fecha_nacimiento,sexo,estado),aula(aula_id,anio_escolar_id,grado_id,seccion_id,estado,anio_escolar(anio_escolar_id,anio,estado),grado(grado_id,nivel_id,nombre,orden,estado,nivel_educativo(nivel_id,nombre,estado)),seccion(seccion_id,nombre,estado))';
      state.enrollments = responseData(await db.from('matricula').select(select).in('aula_id', window.appContext.scope.classroomIds).order('matricula_id'), 'No se pudieron consultar los estudiantes.') || [];
      state.loaded = true; applyFilters();
    } catch (error) { logError('Error al cargar estudiantes.', error); showListError('No se pudo cargar la información.'); }
    finally { loading.classList.add('d-none'); }
  }

  function enrollmentParts(enrollment) {
    const student = relation(enrollment.estudiante); const classroom = relation(enrollment.aula); const grade = relation(classroom?.grado); const level = relation(grade?.nivel_educativo); const section = relation(classroom?.seccion); const year = relation(classroom?.anio_escolar);
    return { student, classroom, grade, level, section, year };
  }

  function applyFilters() {
    const yearId = document.querySelector('#students-year-filter').value; const levelId = document.querySelector('#students-level-filter').value; const gradeId = document.querySelector('#students-grade-filter').value; const classroomId = document.querySelector('#students-section-filter').value; const query = normalize(document.querySelector('#students-search').value);
    state.filtered = state.enrollments.filter((enrollment) => {
      const { student, classroom, grade, level, year } = enrollmentParts(enrollment);
      const searchable = normalize([student?.codigo, student?.nombres, student?.apellido_paterno, student?.apellido_materno].filter(Boolean).join(' '));
      return (!yearId || String(year?.anio_escolar_id) === yearId) && (!levelId || String(level?.nivel_id) === levelId) && (!gradeId || String(grade?.grado_id) === gradeId) && (!classroomId || String(classroom?.aula_id) === classroomId) && (!query || searchable.includes(query));
    });
    state.page = 1; renderList();
  }

  function renderList() {
    const body = document.querySelector('#students-table-body'); const wrapper = document.querySelector('#students-table-wrapper'); const empty = document.querySelector('#students-empty'); const pagination = document.querySelector('#students-pagination'); body.replaceChildren();
    if (!state.filtered.length) { wrapper.classList.add('d-none'); pagination.classList.add('d-none'); empty.textContent = 'No se encontraron estudiantes.'; empty.classList.remove('d-none'); return; }
    const pages = Math.ceil(state.filtered.length / state.size); state.page = Math.min(state.page, pages); const start = (state.page - 1) * state.size; const rows = state.filtered.slice(start, start + state.size);
    rows.forEach((enrollment) => {
      const { student, grade, level, section } = enrollmentParts(enrollment); const row = document.createElement('tr');
      [student?.codigo, fullName(student), level?.nombre, grade?.nombre, section?.nombre, date(enrollment.fecha_matricula)].forEach((value) => { const cell = document.createElement('td'); cell.textContent = safe(value, 'No registrado'); row.appendChild(cell); });
      const status = document.createElement('td'); status.innerHTML = `<span class="badge student-status ${enrollment.estado && student?.estado ? '' : 'is-inactive'}">${enrollment.estado && student?.estado ? 'Activo' : 'Inactivo'}</span>`; row.appendChild(status);
      const actions = document.createElement('td'); const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn btn-sm btn-outline-primary'; edit.textContent = 'Editar'; edit.addEventListener('click', () => openEdit(enrollment)); actions.appendChild(edit); row.appendChild(actions);
      const profile = document.createElement('td'); const profileButton = document.createElement('button'); profileButton.type = 'button'; profileButton.className = 'btn btn-sm btn-primary'; profileButton.textContent = 'Ver perfil'; profileButton.addEventListener('click', () => openProfile(enrollment)); profile.appendChild(profileButton); row.appendChild(profile); body.appendChild(row);
    });
    wrapper.classList.remove('d-none'); empty.classList.add('d-none'); pagination.classList.remove('d-none');
    document.querySelector('#students-page-summary').textContent = `Mostrando ${start + 1} a ${start + rows.length} de ${state.filtered.length} estudiantes`;
    renderPages(pages);
  }

  function renderPages(total) {
    const container = document.querySelector('#students-page-buttons'); container.replaceChildren();
    const add = (label, page, disabled = false, active = false) => { const button = document.createElement('button'); button.type = 'button'; button.className = `btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`; button.textContent = label; button.disabled = disabled; button.addEventListener('click', () => { state.page = page; renderList(); }); container.appendChild(button); };
    add('«', 1, state.page === 1); add('‹', state.page - 1, state.page === 1);
    const first = Math.max(1, state.page - 2); const last = Math.min(total, first + 4); for (let page = Math.max(1, last - 4); page <= last; page += 1) add(String(page), page, false, page === state.page);
    add('›', state.page + 1, state.page === total); add('»', total, state.page === total);
  }

  function showListError(message) { document.querySelector('#students-table-wrapper').classList.add('d-none'); document.querySelector('#students-pagination').classList.add('d-none'); const empty = document.querySelector('#students-empty'); empty.textContent = message; empty.classList.remove('d-none'); }

  function updateListGrades() {
    const levelId = document.querySelector('#students-level-filter').value; const select = document.querySelector('#students-grade-filter');
    fill(select, state.grades.filter((item) => !levelId || String(item.nivel_id) === levelId), 'Todos los grados', 'grado_id', (item) => item.nombre); select.disabled = !levelId; updateListClassrooms();
  }

  function updateListClassrooms() {
    const yearId = document.querySelector('#students-year-filter').value; const gradeId = document.querySelector('#students-grade-filter').value; const select = document.querySelector('#students-section-filter');
    const rows = state.classrooms.filter((item) => (!yearId || String(item.anio_escolar_id) === yearId) && (!gradeId || String(item.grado_id) === gradeId));
    fill(select, rows, 'Todas las secciones', 'aula_id', (item) => state.sections.find((section) => section.seccion_id === item.seccion_id)?.nombre || 'Aula'); select.disabled = !gradeId; applyFilters();
  }

  function bindDependentForm(form) {
    const year = form.querySelector('[data-enrollment-year]'); const level = form.querySelector('[data-enrollment-level]'); const grade = form.querySelector('[data-enrollment-grade]'); const classroom = form.querySelector('[data-enrollment-classroom]');
    level.addEventListener('change', () => { fill(grade, state.grades.filter((item) => item.estado && String(item.nivel_id) === level.value), 'Seleccione un grado', 'grado_id', (item) => item.nombre); grade.disabled = !level.value; classroom.replaceChildren(new Option('Seleccione un aula', '')); classroom.disabled = true; });
    const loadRooms = () => { const rows = state.classrooms.filter((item) => item.estado && String(item.anio_escolar_id) === year.value && String(item.grado_id) === grade.value); fill(classroom, rows, 'Seleccione un aula', 'aula_id', (item) => { const section = state.sections.find((row) => row.seccion_id === item.seccion_id); const selectedGrade = state.grades.find((row) => row.grado_id === item.grado_id); return `${selectedGrade?.nombre || ''} ${section?.nombre || ''}`.trim(); }); classroom.disabled = !(year.value && grade.value); };
    year.addEventListener('change', loadRooms); grade.addEventListener('change', loadRooms);
  }

  async function duplicate(column, value, excludeId) {
    if (!value) return false; let query = db.from('estudiante').select('estudiante_id', { count: 'exact', head: true }).eq(column, value); if (excludeId) query = query.neq('estudiante_id', excludeId); const response = await query; if (response.error) throw new Error('No se pudo validar duplicados.', { cause: response.error }); return response.count > 0;
  }

  function studentPayload(formData) { return { codigo: formData.get('codigo').trim(), dni: formData.get('dni').trim() || null, nombres: formData.get('nombres').trim(), apellido_paterno: formData.get('apellido_paterno').trim(), apellido_materno: formData.get('apellido_materno').trim(), fecha_nacimiento: formData.get('fecha_nacimiento') || null, sexo: formData.get('sexo') || null }; }

  async function registerStudent(event) {
    event.preventDefault(); const form = event.currentTarget; if (!form.checkValidity()) { form.classList.add('was-validated'); return; } const values = new FormData(form); const student = studentPayload(values); let createdId = null; const button = form.querySelector('[type="submit"]'); button.disabled = true; button.textContent = 'Guardando...';
    try {
      if (await duplicate('codigo', student.codigo)) { feedback('Ya existe un estudiante con este código.', false); return; }
      if (student.dni && await duplicate('dni', student.dni)) { feedback('Ya existe un estudiante con este DNI.', false); return; }
      const created = responseData(await db.from('estudiante').insert({ ...student, estado: true }).select('estudiante_id').single(), 'No se pudo registrar el estudiante.'); createdId = created.estudiante_id;
      responseData(await db.from('matricula').insert({ estudiante_id: createdId, aula_id: Number(values.get('aula_id')), fecha_matricula: values.get('fecha_matricula'), estado: true }), 'No se pudo registrar la matrícula.');
      feedback('Estudiante registrado correctamente.'); form.reset(); form.classList.remove('was-validated'); configureEnrollmentForms(); await loadEnrollments(); activateTab('list');
    } catch (error) { if (createdId) await db.from('estudiante').update({ estado: false }).eq('estudiante_id', createdId); logError('Error al registrar estudiante.', error); feedback('No se pudo guardar la información.', false); }
    finally { button.disabled = false; button.textContent = 'Registrar estudiante'; }
  }

  function allClassroomOptions(selected) {
    const select = document.querySelector('#student-edit-form [name="aula_id"]'); fill(select, state.classrooms, 'Seleccione un aula', 'aula_id', (room) => { const grade = state.grades.find((item) => item.grado_id === room.grado_id); const section = state.sections.find((item) => item.seccion_id === room.seccion_id); const year = state.years.find((item) => item.anio_escolar_id === room.anio_escolar_id); return `${year?.anio || ''} · ${grade?.nombre || ''} ${section?.nombre || ''}`; }, selected);
  }

  function openEdit(enrollment) {
    state.editing = enrollment; const student = relation(enrollment.estudiante); const form = document.querySelector('#student-edit-form');
    ['codigo', 'dni', 'nombres', 'apellido_paterno', 'apellido_materno', 'fecha_nacimiento', 'sexo'].forEach((name) => { form.elements[name].value = student?.[name] || ''; });
    form.elements.estudiante_estado.value = String(student?.estado === true); form.elements.fecha_matricula.value = enrollment.fecha_matricula || ''; form.elements.matricula_estado.value = String(enrollment.estado === true); allClassroomOptions(enrollment.aula_id); form.classList.remove('was-validated'); editModal.show();
  }

  async function saveEdit(event) {
    event.preventDefault(); const form = event.currentTarget; if (!form.checkValidity() || !state.editing) { form.classList.add('was-validated'); return; } const values = new FormData(form); const student = studentPayload(values); const studentId = state.editing.estudiante_id; const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = 'Guardando...';
    try {
      if (await duplicate('codigo', student.codigo, studentId)) { feedback('Ya existe un estudiante con este código.', false); return; }
      if (student.dni && await duplicate('dni', student.dni, studentId)) { feedback('Ya existe un estudiante con este DNI.', false); return; }
      responseData(await db.from('estudiante').update({ ...student, estado: values.get('estudiante_estado') === 'true' }).eq('estudiante_id', studentId), 'No se pudo actualizar el estudiante.');
      responseData(await db.from('matricula').update({ aula_id: Number(values.get('aula_id')), fecha_matricula: values.get('fecha_matricula'), estado: values.get('matricula_estado') === 'true' }).eq('matricula_id', state.editing.matricula_id), 'No se pudo actualizar la matrícula.');
      editModal.hide(); feedback('Información del estudiante actualizada correctamente.'); await loadEnrollments();
    } catch (error) { logError('Error al editar estudiante.', error); feedback('No se pudo guardar la información.', false); }
    finally { submit.disabled = false; submit.textContent = 'Guardar cambios'; }
  }

  const monthName = (month) => new Intl.DateTimeFormat('es-PE', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month - 1, 1))).replace(/^./, (letter) => letter.toUpperCase());
  function attendanceSummary(rows) {
    const months = new Map(); rows.forEach((row) => { const month = Number(row.fecha.slice(5, 7)); const code = relation(row.estado_asistencia)?.codigo; if (!months.has(month)) months.set(month, { A: 0, FJ: 0, FNJ: 0, T: 0, total: 0 }); const item = months.get(month); item.total += 1; if (Object.hasOwn(item, code)) item[code] += 1; });
    if (!months.size) return '<p class="students-message">Sin registros de asistencia.</p>';
    return `<div class="table-responsive"><table class="table table-sm profile-table"><thead><tr><th>Mes</th><th>%</th><th>A</th><th>FJ</th><th>FNJ</th><th>T</th></tr></thead><tbody>${[...months].sort(([a], [b]) => a - b).map(([month, item]) => `<tr><td>${monthName(month)}</td><td>${((item.A / item.total) * 100).toFixed(1)}%</td><td>${item.A}</td><td>${item.FJ}</td><td>${item.FNJ}</td><td>${item.T}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function gradeSummary(rows) {
    const periods = new Map(); rows.forEach((row) => { const period = relation(row.periodo_evaluacion); const literal = relation(row.calificacion_literal)?.codigo; const id = period?.periodo_id; if (!id) return; if (!periods.has(id)) periods.set(id, { name: period.nombre, order: period.orden, AD: 0, A: 0, B: 0, C: 0 }); if (['AD', 'A', 'B', 'C'].includes(literal)) periods.get(id)[literal] += 1; });
    if (!periods.size) return '<p class="students-message">No hay información académica disponible.</p>';
    return `<div class="table-responsive"><table class="table table-sm profile-table"><thead><tr><th>Bimestre</th><th>AD</th><th>A</th><th>B</th><th>C</th></tr></thead><tbody>${[...periods.values()].sort((a, b) => a.order - b.order).map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.AD}</td><td>${item.A}</td><td>${item.B}</td><td>${item.C}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function riskSummary(analysis) {
    if (!analysis) return { code: 'Sin información', html: '<p class="students-message">No hay información preventiva disponible.</p>' };
    const risk = relation(analysis.nivel_riesgo); const factors = analysis.factor_analisis_riesgo || []; const alerts = analysis.alerta || []; const alert = alerts[0]; const alertState = relation(alert?.estado_alerta)?.codigo; const followups = alert?.seguimiento || []; const last = [...followups].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
    const factorsHtml = factors.length ? `<ul>${factors.map((factor) => `<li>${escapeHtml(factor.descripcion || factor.valor || factor.tipo_factor)}</li>`).join('')}</ul>` : '<p>No hay factores registrados.</p>';
    return { code: risk?.codigo || 'Sin información', html: `<div class="risk-current"><span>Nivel actual</span><strong class="risk-${normalize(risk?.codigo)}">${escapeHtml(risk?.codigo || 'Sin información')}</strong></div>${factorsHtml}<p>Se recomienda realizar seguimiento preventivo según las señales registradas.</p>${alertState ? `<p>Estado de alerta: <span class="badge profile-alert">${escapeHtml(alertState)}</span></p>` : '<p>Sin alerta asociada.</p>'}${alert ? `<p>Seguimientos registrados: <strong>${followups.length}</strong>${last ? ` · Último seguimiento: ${date(last.fecha)}` : ''}</p>` : ''}` };
  }

  async function openProfile(enrollment) {
    profileModal.show(); const loading = document.querySelector('#student-profile-loading'); const content = document.querySelector('#student-profile-content'); const errorElement = document.querySelector('#student-profile-error'); loading.classList.remove('d-none'); content.classList.add('d-none'); errorElement.classList.add('d-none');
    try {
      const [attendanceResponse, gradesResponse, analysisResponse] = await Promise.all([
        db.from('asistencia').select('fecha,estado_asistencia(codigo)').eq('matricula_id', enrollment.matricula_id).order('fecha'),
        db.from('calificacion').select('calificacion_literal(codigo),periodo_evaluacion(periodo_id,nombre,orden),competencia(nombre)').eq('matricula_id', enrollment.matricula_id),
        db.from('analisis_riesgo').select('analisis_riesgo_id,fecha_analisis,descripcion,nivel_riesgo(codigo,nombre),factor_analisis_riesgo(tipo_factor,descripcion,valor),alerta(alerta_id,fecha_generacion,estado_alerta(codigo),seguimiento(fecha))').eq('matricula_id', enrollment.matricula_id).order('fecha_analisis', { ascending: false }).limit(1).maybeSingle()
      ]);
      const attendance = responseData(attendanceResponse, 'No se pudo consultar la asistencia.') || []; const gradesRows = responseData(gradesResponse, 'No se pudieron consultar las calificaciones.') || []; const analysis = responseData(analysisResponse, 'No se pudo consultar el riesgo.'); const risk = riskSummary(analysis); const { student, grade, level, section, year } = enrollmentParts(enrollment);
      content.innerHTML = `<div class="profile-summary"><div><span>Estudiante</span><strong>${escapeHtml(fullName(student))}</strong></div><div><span>Código</span><strong>${escapeHtml(student?.codigo)}</strong></div><div><span>Nivel</span><strong>${escapeHtml(level?.nombre)}</strong></div><div><span>Grado y sección</span><strong>${escapeHtml(`${grade?.nombre || ''} ${section?.nombre || ''}`.trim())}</strong></div><div><span>Nivel de riesgo</span><strong class="risk-${normalize(risk.code)}">${escapeHtml(risk.code)}</strong></div></div><div class="profile-two-columns"><section class="profile-card"><h3>Datos personales</h3><dl><div><dt>Código</dt><dd>${escapeHtml(student?.codigo)}</dd></div><div><dt>DNI</dt><dd>${escapeHtml(student?.dni)}</dd></div><div><dt>Fecha de nacimiento</dt><dd>${date(student?.fecha_nacimiento)}</dd></div><div><dt>Sexo</dt><dd>${escapeHtml(student?.sexo)}</dd></div><div><dt>Estado</dt><dd>${student?.estado ? 'Activo' : 'Inactivo'}</dd></div></dl></section><section class="profile-card"><h3>Información académica</h3><dl><div><dt>Año escolar</dt><dd>${escapeHtml(year?.anio)}</dd></div><div><dt>Nivel educativo</dt><dd>${escapeHtml(level?.nombre)}</dd></div><div><dt>Grado</dt><dd>${escapeHtml(grade?.nombre)}</dd></div><div><dt>Sección</dt><dd>${escapeHtml(section?.nombre)}</dd></div><div><dt>Fecha de matrícula</dt><dd>${date(enrollment.fecha_matricula)}</dd></div><div><dt>Estado matrícula</dt><dd>${enrollment.estado ? 'Activa' : 'Inactiva'}</dd></div></dl></section></div><section class="profile-card"><h3>Resumen de asistencia</h3>${attendanceSummary(attendance)}</section><section class="profile-card"><h3>Resumen académico</h3>${gradeSummary(gradesRows)}</section><section class="profile-card preventive-card"><h3>Interpretación preventiva</h3>${risk.html}</section>`;
      content.classList.remove('d-none');
    } catch (error) { logError('Error al cargar el perfil.', error); errorElement.textContent = 'No se pudo cargar la información del estudiante.'; errorElement.classList.remove('d-none'); }
    finally { loading.classList.add('d-none'); }
  }

  function excelDate(value) {
    if (!value) return null; if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10); if (typeof value === 'number' && window.XLSX?.SSF) { const parsed = window.XLSX.SSF.parse_date_code(value); return parsed ? `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}` : null; } const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
  }

  async function readExcel(event) {
    const file = event.target.files[0]; if (!file) return; const preview = document.querySelector('#students-import-preview'); preview.classList.add('d-none');
    try {
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); const raw = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: true }); const meaningful = raw.filter((row) => Object.values(row).some((value) => safe(value, '').trim())); const codes = meaningful.map((row) => safe(row.codigo, '').trim()).filter(Boolean); const dnis = meaningful.map((row) => safe(row.dni, '').trim()).filter(Boolean);
      const [codesResponse, dnisResponse] = await Promise.all([codes.length ? db.from('estudiante').select('codigo').in('codigo', [...new Set(codes)]) : Promise.resolve({ data: [], error: null }), dnis.length ? db.from('estudiante').select('dni').in('dni', [...new Set(dnis)]) : Promise.resolve({ data: [], error: null })]);
      const existingCodes = new Set((responseData(codesResponse, 'No se pudieron validar códigos.') || []).map((row) => normalize(row.codigo))); const existingDnis = new Set((responseData(dnisResponse, 'No se pudieron validar DNI.') || []).map((row) => normalize(row.dni))); const codeFrequency = new Map(); const dniFrequency = new Map(); codes.forEach((value) => codeFrequency.set(normalize(value), (codeFrequency.get(normalize(value)) || 0) + 1)); dnis.forEach((value) => dniFrequency.set(normalize(value), (dniFrequency.get(normalize(value)) || 0) + 1));
      state.importRows = meaningful.map((row, index) => { const item = { row: index + 2, codigo: safe(row.codigo, '').trim(), dni: safe(row.dni, '').trim() || null, nombres: safe(row.nombres, '').trim(), apellido_paterno: safe(row.apellido_paterno, '').trim(), apellido_materno: safe(row.apellido_materno, '').trim(), fecha_nacimiento: excelDate(row.fecha_nacimiento), sexo: safe(row.sexo, '').trim() || null }; const missing = !item.codigo || !item.nombres || !item.apellido_paterno || !item.apellido_materno; const repeated = codeFrequency.get(normalize(item.codigo)) > 1 || (item.dni && dniFrequency.get(normalize(item.dni)) > 1); const existing = existingCodes.has(normalize(item.codigo)) || (item.dni && existingDnis.has(normalize(item.dni))); item.validation = missing ? 'Error' : repeated || existing ? 'Duplicado' : 'Válido'; return item; }); renderImport();
    } catch (error) { logError('Error al leer Excel.', error); feedback('No se pudo leer o validar el archivo.', false); }
  }

  function renderImport() {
    const body = document.querySelector('#students-import-body'); body.replaceChildren(); state.importRows.forEach((item) => { const row = document.createElement('tr'); [item.row, item.codigo, fullName(item), item.dni || 'No registrado', date(item.fecha_nacimiento), item.sexo || 'No registrado'].forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); }); const status = document.createElement('td'); status.innerHTML = `<span class="badge import-${normalize(item.validation)}">${item.validation}</span>`; row.appendChild(status); body.appendChild(row); }); const valid = state.importRows.filter((row) => row.validation === 'Válido').length; const duplicated = state.importRows.filter((row) => row.validation === 'Duplicado').length; const invalid = state.importRows.length - valid - duplicated; document.querySelector('#students-import-summary').textContent = `${state.importRows.length} registros encontrados · ${valid} válidos · ${duplicated} duplicados · ${invalid} con error`; document.querySelector('#students-import-button').disabled = valid === 0; document.querySelector('#students-import-preview').classList.remove('d-none');
  }

  async function importStudents() {
    const form = document.querySelector('#students-import-form'); if (!form.checkValidity()) { form.classList.add('was-validated'); feedback('Seleccione el aula y la fecha de matrícula.', false); return; } const values = new FormData(form); const rows = state.importRows.filter((row) => row.validation === 'Válido'); const button = document.querySelector('#students-import-button'); button.disabled = true; button.textContent = 'Importando estudiantes...'; let imported = 0; let failed = 0;
    for (const row of rows) {
      let studentId = null;
      try { const created = responseData(await db.from('estudiante').insert({ codigo: row.codigo, dni: row.dni, nombres: row.nombres, apellido_paterno: row.apellido_paterno, apellido_materno: row.apellido_materno, fecha_nacimiento: row.fecha_nacimiento, sexo: row.sexo, estado: true }).select('estudiante_id').single(), 'No se pudo importar el estudiante.'); studentId = created.estudiante_id; responseData(await db.from('matricula').insert({ estudiante_id: studentId, aula_id: Number(values.get('aula_id')), fecha_matricula: values.get('fecha_matricula'), estado: true }), 'No se pudo importar la matrícula.'); imported += 1; } catch (error) { failed += 1; if (studentId) await db.from('estudiante').update({ estado: false }).eq('estudiante_id', studentId); logError(`Error al importar fila ${row.row}.`, error); }
    }
    button.disabled = false; button.textContent = 'Importar registros válidos'; feedback(`${imported} estudiantes importados correctamente.${failed ? ` ${failed} registros no pudieron importarse.` : ''}`, failed === 0); await loadEnrollments(); state.importRows = []; document.querySelector('#students-import-preview').classList.add('d-none'); document.querySelector('#students-excel-file').value = '';
  }

  async function initialize() {
    try { await loadCatalogs(); await loadEnrollments(); } catch (error) { logError('Error al iniciar el módulo.', error); showListError('No se pudo cargar la información.'); }
  }

  studentsLink.addEventListener('click', showStudents); otherLinks.forEach((link) => link.addEventListener('click', hideStudents)); tabs.forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.studentsTab)));
  document.querySelector('#students-year-filter').addEventListener('change', () => { updateListClassrooms(); }); document.querySelector('#students-level-filter').addEventListener('change', updateListGrades); document.querySelector('#students-grade-filter').addEventListener('change', updateListClassrooms); document.querySelector('#students-section-filter').addEventListener('change', applyFilters); document.querySelector('#students-search').addEventListener('input', applyFilters);
  document.querySelector('#students-page-size').addEventListener('change', (event) => { state.size = Number(event.target.value); state.page = 1; renderList(); });
  document.querySelectorAll('[data-enrollment-year]').forEach((select) => bindDependentForm(select.closest('form')));
  document.querySelector('#student-register-form').addEventListener('submit', registerStudent); document.querySelector('#student-edit-form').addEventListener('submit', saveEdit); document.querySelector('#students-excel-file').addEventListener('change', readExcel); document.querySelector('#students-import-button').addEventListener('click', importStudents);
})();
