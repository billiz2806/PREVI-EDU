'use strict';

(() => {
  const user = window.previEduCurrentUser;
  if (!user || user.role !== 'DIRECTOR') return;
  const db = window.supabaseClient;
  const menu = document.querySelector('#main-menu');
  const main = document.querySelector('main .container-xl');
  const link = [...menu.querySelectorAll('.nav-link')].find((item) => item.textContent.trim() === 'Aulas');
  if (!db || !link) return;

  main.insertAdjacentHTML('beforeend', `
    <section class="d-none classrooms-view" id="classrooms-view" aria-label="Aulas">
      <div class="alert d-none students-feedback" id="classrooms-feedback" role="status"></div>
      <article class="card classrooms-filter-card"><div class="card-body classrooms-filters">
        <div><label class="form-label" for="classrooms-year">Año escolar</label><select class="form-select" id="classrooms-year"></select></div>
        <div><label class="form-label" for="classrooms-level">Nivel educativo</label><select class="form-select" id="classrooms-level"></select></div>
        <div><label class="form-label" for="classrooms-search">Buscar aula</label><input class="form-control" id="classrooms-search" type="search" placeholder="Grado o sección"></div>
        <div class="classrooms-filter-actions"><button class="btn btn-outline-secondary" id="classrooms-clear" type="button">Limpiar</button><button class="btn btn-primary" id="classrooms-query" type="button"><i class="ti ti-search"></i> Consultar</button></div>
      </div></article>
      <div class="classrooms-kpis"><article><span class="classrooms-kpi-icon tone-violet"><i class="ti ti-school"></i></span><div><small>Aulas activas</small><strong id="classrooms-active-count">—</strong></div></article><article><span class="classrooms-kpi-icon tone-green"><i class="ti ti-user-check"></i></span><div><small>Con tutor</small><strong id="classrooms-tutor-count">—</strong></div></article><article><span class="classrooms-kpi-icon tone-amber"><i class="ti ti-user-question"></i></span><div><small>Sin tutor</small><strong id="classrooms-no-tutor-count">—</strong></div></article></div>
      <article class="card students-card"><div class="card-header students-card-header"><div class="students-heading"><span class="students-heading-icon icon-violet"><i class="ti ti-layout-grid"></i></span><div><h2 class="card-title">Aulas de la institución</h2><p id="classrooms-summary">Cargando información...</p></div></div></div><div class="students-loading" id="classrooms-loading"><span class="spinner-border spinner-border-sm"></span> Cargando aulas...</div><div class="table-responsive d-none" id="classrooms-table-wrapper"><table class="table table-vcenter card-table classrooms-table"><thead><tr><th>Aula</th><th>Tutor</th><th>Estudiantes</th><th>Docentes</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="classrooms-table-body"></tbody></table></div><p class="students-message d-none" id="classrooms-empty">No se encontraron aulas para los criterios seleccionados.</p></article>
    </section>
    <div class="modal modal-blur fade" id="classroom-detail-modal" tabindex="-1" aria-hidden="true"><div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable"><div class="modal-content classroom-detail"><div class="modal-header"><div><h2 class="modal-title" id="classroom-detail-title"></h2><p class="modal-subtitle" id="classroom-detail-year"></p></div><span id="classroom-detail-status"></span><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Cerrar"></button></div><div class="modal-body"><div class="classroom-detail-summary" id="classroom-detail-summary"></div><div class="students-tabs-wrapper"><div class="nav students-tabs" role="tablist"><button class="nav-link active" type="button" data-classroom-detail-tab="summary">Resumen</button><button class="nav-link" type="button" data-classroom-detail-tab="students">Estudiantes</button><button class="nav-link" type="button" data-classroom-detail-tab="teachers">Docentes y áreas</button></div></div><div id="classroom-detail-content"></div></div><div class="modal-footer"><button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal">Cerrar</button></div></div></div></div>`);

  const $ = (selector) => document.querySelector(selector);
  const one = (value) => Array.isArray(value) ? value[0] : value;
  const text = (value, fallback = 'No registrado') => value == null || value === '' ? fallback : String(value);
  const normalize = (value) => text(value, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const escapeHtml = (value) => text(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const fullStudentName = (student) => [student?.apellido_paterno, student?.apellido_materno, student?.nombres].filter(Boolean).join(' ') || 'No registrado';
  const fullTeacherName = (teacher) => { const person = one(teacher?.usuario); return [person?.nombres, person?.apellidos].filter(Boolean).join(' ') || 'No registrado'; };
  const check = (response, label) => { if (response.error) throw new Error(label, { cause: response.error }); return response.data || []; };
  const modal = new window.tabler.Modal($('#classroom-detail-modal'));
  const state = { years: [], levels: [], grades: [], sections: [], classrooms: [], enrollments: [], roomAreas: [], assignments: [], tutorings: [], teachers: [], selected: null, loaded: false };

  function classroomParts(classroom) { const grade = state.grades.find((item) => item.grado_id === classroom.grado_id); return { year: state.years.find((item) => item.anio_escolar_id === classroom.anio_escolar_id), grade, level: state.levels.find((item) => item.nivel_id === grade?.nivel_id), section: state.sections.find((item) => item.seccion_id === classroom.seccion_id) }; }
  function classroomName(classroom) { const part = classroomParts(classroom); return `${text(part.level?.nombre, '')} · ${text(part.grade?.nombre, '')} ${text(part.section?.nombre, '')}`.trim(); }
  function classroomEnrollments(id) { return state.enrollments.filter((item) => item.aula_id === id && item.estado); }
  function classroomAssignments(id) { const areaIds = new Set(state.roomAreas.filter((item) => item.aula_id === id && item.estado).map((item) => item.aula_area_curricular_id)); return state.assignments.filter((item) => item.estado && areaIds.has(item.aula_area_curricular_id)); }
  function classroomTutor(id) { const tutoring = state.tutorings.find((item) => item.aula_id === id && item.estado); return state.teachers.find((item) => item.docente_id === tutoring?.docente_id); }
  function uniqueTeachers(id) { return new Set(classroomAssignments(id).map((item) => item.docente_id)).size; }
  function contextFor(classroom) { const part = classroomParts(classroom); return { source: 'aulas', anioEscolarId: classroom.anio_escolar_id, aulaId: classroom.aula_id, nivelId: part.level?.nivel_id, gradoId: classroom.grado_id, seccionId: classroom.seccion_id }; }

  async function load() {
    const loading = $('#classrooms-loading'); loading.classList.remove('d-none'); $('#classrooms-table-wrapper').classList.add('d-none'); $('#classrooms-empty').classList.add('d-none');
    try {
      const scope = window.appContext.scope;
      const responses = await Promise.all([
        db.from('anio_escolar').select('anio_escolar_id,institucion_id,anio,fecha_inicio,fecha_fin,estado').eq('institucion_id', window.appContext.currentInstitution.institucion_id).order('anio', { ascending: false }),
        db.from('nivel_educativo').select('nivel_id,nombre,estado').order('nombre'), db.from('grado').select('grado_id,nivel_id,nombre,orden,estado').order('orden'), db.from('seccion').select('seccion_id,nombre,estado').order('nombre'),
        db.from('aula').select('aula_id,anio_escolar_id,grado_id,seccion_id,estado').in('anio_escolar_id', scope.yearIds),
        db.from('matricula').select('matricula_id,estudiante_id,aula_id,fecha_matricula,estado,estudiante(estudiante_id,codigo,dni,nombres,apellido_paterno,apellido_materno,estado)').in('aula_id', scope.classroomIds),
        db.from('aula_area_curricular').select('aula_area_curricular_id,aula_id,area_curricular_nivel_id,estado,area_curricular_nivel(area_curricular_nivel_id,area_curricular(area_curricular_id,nombre,estado))').in('aula_id', scope.classroomIds),
        db.from('docente_aula_area').select('docente_aula_area_id,docente_id,aula_area_curricular_id,estado'), db.from('docente_tutoria').select('docente_tutoria_id,docente_id,aula_id,estado').in('aula_id', scope.classroomIds),
        db.from('docente').select('docente_id,codigo,estado,usuario(usuario_id,nombres,apellidos,estado)')
      ]);
      [state.years, state.levels, state.grades, state.sections, state.classrooms, state.enrollments, state.roomAreas, state.assignments, state.tutorings, state.teachers] = responses.map((response, index) => check(response, `Consulta de aulas ${index}`));
      const activeYear = state.years.find((item) => item.estado) || state.years[0];
      fill($('#classrooms-year'), state.years, 'Seleccione un año', 'anio_escolar_id', (item) => item.anio, activeYear?.anio_escolar_id);
      fill($('#classrooms-level'), state.levels.filter((item) => item.estado), 'Todos', 'nivel_id', (item) => item.nombre);
      state.loaded = true; render();
    } catch (error) { console.error('[Aulas] Error al cargar:', error.cause || error); feedback('No se pudo cargar la información de las aulas.', false); }
    finally { loading.classList.add('d-none'); }
  }

  function fill(select, rows, placeholder, key, label, selected = '') { select.replaceChildren(new Option(placeholder, '')); rows.forEach((row) => select.add(new Option(label(row), row[key], false, String(row[key]) === String(selected)))); }
  function feedback(message, good = true) { const element = $('#classrooms-feedback'); if (!message) { element.classList.add('d-none'); return; } element.textContent = message; element.className = `alert students-feedback ${good ? 'alert-success' : 'alert-danger'}`; }

  function filtered() {
    const year = $('#classrooms-year').value; const level = $('#classrooms-level').value; const query = normalize($('#classrooms-search').value);
    return state.classrooms.filter((classroom) => { const part = classroomParts(classroom); return classroom.estado && (!year || String(classroom.anio_escolar_id) === year) && (!level || String(part.level?.nivel_id) === level) && (!query || normalize(classroomName(classroom)).includes(query)); }).sort((left, right) => { const a = classroomParts(left); const b = classroomParts(right); return text(a.level?.nombre, '').localeCompare(text(b.level?.nombre, '')) || (a.grade?.orden || 0) - (b.grade?.orden || 0) || text(a.section?.nombre, '').localeCompare(text(b.section?.nombre, '')); });
  }

  function render() {
    const rows = filtered(); const body = $('#classrooms-table-body'); body.replaceChildren(); let withTutor = 0;
    rows.forEach((classroom) => {
      const tutor = classroomTutor(classroom.aula_id); if (tutor) withTutor += 1; const enrollments = classroomEnrollments(classroom.aula_id); const teachers = uniqueTeachers(classroom.aula_id);
      const row = document.createElement('tr'); row.innerHTML = `<td><strong>${escapeHtml(classroomName(classroom))}</strong></td><td class="${tutor ? '' : 'text-secondary'}">${escapeHtml(tutor ? fullTeacherName(tutor) : 'Sin asignar')}</td><td>${enrollments.length}</td><td>${teachers}</td><td><span class="badge teacher-status">Activa</span></td><td><div class="classroom-row-actions"><button class="btn btn-sm btn-outline-primary" data-classroom-detail="${classroom.aula_id}">Detalle</button><div class="dropdown"><button class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown" type="button">Acciones</button><div class="dropdown-menu dropdown-menu-end"><button class="dropdown-item" data-classroom-go="attendance" data-classroom-id="${classroom.aula_id}">Ir a Asistencia</button><button class="dropdown-item" data-classroom-go="evaluations" data-classroom-id="${classroom.aula_id}">Ir a Evaluaciones</button><button class="dropdown-item" data-classroom-go="assignments" data-classroom-id="${classroom.aula_id}">Ir a Asignación de Aula</button><button class="dropdown-item" data-classroom-go="tutoring" data-classroom-id="${classroom.aula_id}">Ir a Asignación de Tutor</button></div></div></div></td>`; body.appendChild(row);
    });
    $('#classrooms-active-count').textContent = rows.length; $('#classrooms-tutor-count').textContent = withTutor; $('#classrooms-no-tutor-count').textContent = rows.length - withTutor; $('#classrooms-summary').textContent = `${rows.length} aulas encontradas`;
    $('#classrooms-table-wrapper').classList.toggle('d-none', !rows.length); $('#classrooms-empty').classList.toggle('d-none', Boolean(rows.length));
  }

  function assignmentDetail(item) { const roomArea = state.roomAreas.find((row) => row.aula_area_curricular_id === item.aula_area_curricular_id); const area = one(roomArea?.area_curricular_nivel)?.area_curricular; return { area: one(area), teacher: state.teachers.find((row) => row.docente_id === item.docente_id) }; }
  function openDetail(classroom) { state.selected = classroom; const part = classroomParts(classroom); const tutor = classroomTutor(classroom.aula_id); const enrollments = classroomEnrollments(classroom.aula_id); const assignments = classroomAssignments(classroom.aula_id); $('#classroom-detail-title').textContent = classroomName(classroom); $('#classroom-detail-year').textContent = `Año escolar ${text(part.year?.anio)}`; $('#classroom-detail-status').innerHTML = '<span class="badge teacher-status">Activa</span>'; $('#classroom-detail-summary').innerHTML = `<article><small>Tutor</small><strong>${escapeHtml(tutor ? fullTeacherName(tutor) : 'Sin asignar')}</strong></article><article><small>Estudiantes</small><strong>${enrollments.length}</strong></article><article><small>Docentes</small><strong>${uniqueTeachers(classroom.aula_id)}</strong></article>`; renderDetailTab('summary'); modal.show(); }
  function renderDetailTab(tab) { document.querySelectorAll('[data-classroom-detail-tab]').forEach((button) => button.classList.toggle('active', button.dataset.classroomDetailTab === tab)); const classroom = state.selected; const content = $('#classroom-detail-content'); if (tab === 'summary') { const tutor = classroomTutor(classroom.aula_id); content.innerHTML = `<div class="classroom-summary-pane"><div><h3>Responsable de tutoría</h3><p>${escapeHtml(tutor ? fullTeacherName(tutor) : 'Sin asignar')}</p></div><div class="classroom-quick-actions"><button class="btn btn-outline-primary" data-detail-go="attendance">Asistencia</button><button class="btn btn-outline-primary" data-detail-go="evaluations">Evaluaciones</button><button class="btn btn-primary" data-detail-go="assignments">Asignaciones</button></div></div>`; } else if (tab === 'students') { const rows = classroomEnrollments(classroom.aula_id); content.innerHTML = rows.length ? `<div class="table-responsive"><table class="table table-vcenter classrooms-detail-table"><thead><tr><th>Código</th><th>Estudiante</th><th>DNI</th><th>Estado</th></tr></thead><tbody>${rows.map((item) => { const student = one(item.estudiante); return `<tr><td>${escapeHtml(student?.codigo)}</td><td>${escapeHtml(fullStudentName(student))}</td><td>${escapeHtml(student?.dni || 'No registrado')}</td><td><span class="badge teacher-status">Activo</span></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="students-message">No hay estudiantes matriculados en esta aula.</p>'; } else { const rows = classroomAssignments(classroom.aula_id); content.innerHTML = rows.length ? `<div class="table-responsive"><table class="table table-vcenter classrooms-detail-table"><thead><tr><th>Área curricular</th><th>Docente</th></tr></thead><tbody>${rows.map((item) => { const part = assignmentDetail(item); return `<tr><td>${escapeHtml(part.area?.nombre)}</td><td>${escapeHtml(fullTeacherName(part.teacher))}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="students-message">No hay docentes ni áreas asignadas.</p>'; } }

  function navigate(target, classroom) { window.previEduNavigation.set(target === 'assignments' || target === 'tutoring' ? 'teachers' : target, { ...contextFor(classroom), teacherTab: target }); modal.hide(); const label = target === 'attendance' ? 'Asistencia' : target === 'evaluations' ? 'Evaluaciones' : 'Docentes'; [...menu.querySelectorAll('.nav-link')].find((item) => item.textContent.trim() === label)?.click(); }
  function show(event) { event?.preventDefault(); document.querySelectorAll('#dashboard-director,#institution-view,#academic-management-view,#students-view,#teachers-view,#attendance-view,#evaluations-view,#alerts-view,#followups-view,#reports-view,#configuration-view').forEach((section) => section?.classList.add('d-none')); $('#classrooms-view').classList.remove('d-none'); $('#dashboard-title').textContent = 'AULAS'; $('#dashboard-subtitle').textContent = 'Consulte las aulas de la institución y acceda rápidamente a su información académica.'; menu.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item === link)); if (!state.loaded) load(); }

  link.onclick = show; [...menu.querySelectorAll('.nav-link')].filter((item) => item !== link).forEach((item) => item.addEventListener('click', () => $('#classrooms-view').classList.add('d-none')));
  $('#classrooms-query').onclick = render; $('#classrooms-clear').onclick = () => { const activeYear = state.years.find((item) => item.estado) || state.years[0]; $('#classrooms-year').value = String(activeYear?.anio_escolar_id || ''); $('#classrooms-level').value = ''; $('#classrooms-search').value = ''; render(); }; $('#classrooms-search').onkeydown = (event) => { if (event.key === 'Enter') render(); };
  $('#classrooms-table-body').onclick = (event) => { const detail = event.target.closest('[data-classroom-detail]'); const action = event.target.closest('[data-classroom-go]'); if (detail) openDetail(state.classrooms.find((item) => String(item.aula_id) === detail.dataset.classroomDetail)); if (action) navigate(action.dataset.classroomGo, state.classrooms.find((item) => String(item.aula_id) === action.dataset.classroomId)); };
  document.querySelectorAll('[data-classroom-detail-tab]').forEach((button) => button.onclick = () => renderDetailTab(button.dataset.classroomDetailTab));
  $('#classroom-detail-content').onclick = (event) => { const action = event.target.closest('[data-detail-go]'); if (action) navigate(action.dataset.detailGo, state.selected); };
})();
