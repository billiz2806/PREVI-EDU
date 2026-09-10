'use strict';

(() => {
  const currentUser = window.previEduCurrentUser;
  if (!currentUser || currentUser.role !== 'DIRECTOR') return;

  const db = window.supabaseClient;
  const menu = document.querySelector('#main-menu');
  const main = document.querySelector('main .container-xl');
  const link = [...(menu?.querySelectorAll('.nav-link') || [])].find((item) => item.textContent.trim() === 'Reportes');
  if (!db || !main || !link || !window.ApexCharts || !window.XLSX) return;

  const tabs = [
    ['summary', 'Resumen institucional'],
    ['attendance', 'Asistencia'],
    ['evaluations', 'Evaluaciones'],
    ['risk', 'Riesgo y alertas'],
    ['followups', 'Seguimientos']
  ];
  const tabButtons = tabs.map(([key, label], index) => `<button class="nav-link${index ? '' : ' active'}" type="button" data-reports-tab="${key}">${label}</button>`).join('');
  const academicFilters = `<div><label>Año escolar *</label><select data-report-filter="year"></select></div><div><label>Nivel educativo</label><select data-report-filter="level"></select></div><div><label>Grado</label><select data-report-filter="grade" disabled></select></div><div><label>Sección</label><select data-report-filter="room" disabled></select></div>`;

  main.insertAdjacentHTML('beforeend', `
    <section class="d-none reports-view reports-module" id="reports-view" aria-label="Reportes">
      <div class="reports-print-header"><strong>PREVI-EDU</strong><h2 id="reports-print-title"></h2><p id="reports-print-institution"></p><p id="reports-print-meta"></p></div>
      <div class="students-tabs-wrapper reports-no-print"><div class="nav students-tabs" role="tablist">${tabButtons}</div></div>
      <div class="alert d-none students-feedback reports-no-print" id="reports-feedback" role="status"></div>
      <article class="card students-card reports-controls reports-no-print"><div class="card-body">
        <div class="reports-query-filters" id="reports-filters">${academicFilters}<div class="reports-dynamic-filters" id="reports-dynamic-filters"></div></div>
        <div class="reports-toolbar"><div class="reports-filter-actions"><button class="btn btn-outline-secondary btn-sm" id="reports-clear" type="button">Limpiar</button><button class="btn btn-primary btn-sm" id="reports-query" type="button">Consultar</button></div><div class="reports-actions d-none" id="reports-actions"><span id="reports-generated"></span><button class="btn btn-outline-primary btn-sm" id="reports-export" type="button"><i class="ti ti-file-spreadsheet"></i> Exportar Excel</button><button class="btn btn-outline-secondary btn-sm" id="reports-print" type="button"><i class="ti ti-printer"></i> Imprimir</button></div></div>
      </div></article>
      <div class="compact-initial-state" id="reports-initial"><i class="ti ti-file-analytics"></i><span>Seleccione los filtros y presione Consultar.</span></div>
      <div class="students-loading d-none" id="reports-loading"><span class="spinner-border spinner-border-sm"></span> Generando reporte...</div>
      <div class="d-none" id="reports-results"><div id="reports-context"></div><div class="reports-kpis" id="reports-kpis"></div><div id="reports-charts"></div><div id="reports-period-switcher" class="evaluation-period-switcher d-none reports-no-print"></div><article class="card students-card reports-detail-card"><div class="card-header"><h2 class="card-title" id="reports-detail-title">Detalle del reporte</h2></div><div class="table-responsive reports-table-wrap"><table class="table table-vcenter card-table reports-table" id="reports-table"><thead></thead><tbody></tbody></table></div><p class="students-message d-none" id="reports-empty">No hay información para los filtros seleccionados.</p><div class="reports-pagination reports-no-print" id="reports-pagination"></div></article></div>
    </section>`);

  const $ = (selector) => document.querySelector(selector);
  const rel = (value) => Array.isArray(value) ? value[0] : value;
  const safe = (value, fallback = 'No registrado') => value === null || value === undefined || value === '' ? fallback : String(value);
  const esc = (value, fallback) => safe(value, fallback).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const norm = (value) => safe(value, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const fullName = (student) => [student?.nombres, student?.apellido_paterno, student?.apellido_materno].filter(Boolean).join(' ') || 'No registrado';
  const teacherName = (assignment) => { const teacher = rel(assignment?.docente); const user = rel(teacher?.usuario); return user ? [user.nombres, user.apellidos].filter(Boolean).join(' ') : 'Docente no asignado'; };
  const date = (value) => value ? new Intl.DateTimeFormat('es-PE', {timeZone:'UTC'}).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`)) : 'No registrado';
  const generated = () => new Intl.DateTimeFormat('es-PE', {dateStyle:'short', timeStyle:'short'}).format(new Date());
  const check = (response, context) => { if (response.error) throw new Error(context, {cause:response.error}); return response.data || []; };
  const filterBox = $('#reports-filters');
  const get = (name) => filterBox.querySelector(`[data-report-filter="${name}"]`);
  const riskOrder = {ALTO:0, MEDIO:1, BAJO:2};
  const state = {tab:'summary', loaded:false, queried:false, catalogs:{}, institution:null, rows:[], exportRows:[], metrics:[], charts:{}, page:1, size:10, periods:[], activePeriod:null, context:{}};

  function fill(select, rows, placeholder, key, label) {
    select.replaceChildren(new Option(placeholder, ''));
    rows.forEach((row) => select.add(new Option(label(row), row[key])));
    select.disabled = false;
  }
  function filterValues() { return Object.fromEntries([...filterBox.querySelectorAll('[data-report-filter]')].map((element) => [element.dataset.reportFilter, element.value])); }
  function selectedText(name, fallback = 'Todos') { return get(name)?.selectedOptions[0]?.textContent || fallback; }
  function academicParts(enrollment) { const room = rel(enrollment?.aula); const grade = rel(room?.grado); return {enrollment, student:rel(enrollment?.estudiante), room, grade, section:rel(room?.seccion), level:rel(grade?.nivel_educativo), year:rel(room?.anio_escolar)}; }
  function badge(code, kind = 'risk') { return `<span class="badge alert-${kind} ${kind}-${norm(code)}">${esc(code || 'Sin alerta')}</span>`; }
  function literal(code) { return `<span class="report-literal literal-${norm(code || 'empty')}">${esc(code || '—')}</span>`; }
  function kpi(label, value, tone = 'violet', extra = '') { return `<article class="${extra}"><span class="report-kpi-dot report-${tone}"></span><div><small>${esc(label)}</small><strong>${esc(value)}</strong></div></article>`; }
  function queryContext(extra = {}) { state.context = {year:selectedText('year'), level:selectedText('level'), grade:selectedText('grade'), section:selectedText('room'), ...extra}; }

  async function loadCatalogs() {
    const responses = await Promise.all([
      db.from('institucion_educativa').select('institucion_id,nombre,codigo_modular,ugel,distrito').eq('institucion_id', window.appContext.currentInstitution.institucion_id).maybeSingle(),
      db.from('anio_escolar').select('anio_escolar_id,institucion_id,anio,estado').eq('institucion_id', window.appContext.currentInstitution.institucion_id).order('anio', {ascending:false}),
      db.from('nivel_educativo').select('nivel_id,nombre,estado').order('nombre'),
      db.from('grado').select('grado_id,nivel_id,nombre,orden,estado').order('orden'),
      db.from('seccion').select('seccion_id,nombre,estado').order('nombre'),
      db.from('aula').select('aula_id,anio_escolar_id,grado_id,seccion_id,estado').in('anio_escolar_id', window.appContext.scope.yearIds),
      db.from('nivel_riesgo').select('nivel_riesgo_id,codigo,nombre,estado').order('orden'),
      db.from('estado_alerta').select('estado_alerta_id,codigo,nombre,estado').order('orden'),
      db.from('tipo_seguimiento').select('tipo_seguimiento_id,codigo,nombre,estado').order('nombre'),
      db.from('estado_asistencia').select('estado_asistencia_id,codigo,nombre'),
      db.from('calificacion_literal').select('calificacion_literal_id,codigo,nombre'),
      db.from('periodo_evaluacion').select('periodo_id,anio_escolar_id,nombre,orden,estado').order('orden')
    ]);
    if (responses[0].error) throw new Error('Institución', {cause:responses[0].error});
    state.institution = responses[0].data;
    const keys = ['years','levels','grades','sections','rooms','risks','statuses','types','attendanceStatuses','literals','periods'];
    keys.forEach((key, index) => { state.catalogs[key] = check(responses[index + 1], key); });
    fill(get('year'), state.catalogs.years, 'Seleccione', 'anio_escolar_id', (row) => row.anio);
    fill(get('level'), state.catalogs.levels, 'Todos', 'nivel_id', (row) => row.nombre);
    configureDynamicFilters();
    state.loaded = true;
  }

  function updateGrades() {
    const level = get('level').value;
    fill(get('grade'), state.catalogs.grades.filter((row) => !level || String(row.nivel_id) === level), 'Todos', 'grado_id', (row) => row.nombre);
    get('grade').disabled = !level;
    updateRooms();
  }
  function updateRooms() {
    const year = get('year').value, grade = get('grade').value;
    const rooms = state.catalogs.rooms.filter((row) => (!year || String(row.anio_escolar_id) === year) && (!grade || String(row.grado_id) === grade));
    fill(get('room'), rooms, 'Todas', 'aula_id', (row) => state.catalogs.sections.find((section) => section.seccion_id === row.seccion_id)?.nombre || 'Aula');
    get('room').disabled = !grade;
  }
  function dynamicHtml() {
    if (state.tab === 'attendance') return '<div><label>Mes *</label><input type="month" data-report-filter="month"></div><div><label>Ordenar</label><select data-report-filter="order"><option value="low">Menor asistencia</option><option value="high">Mayor asistencia</option><option value="name">Nombre</option></select></div>';
    if (state.tab === 'evaluations') return '<div><label>Área curricular *</label><select data-report-filter="area" disabled></select></div><div><label>Bimestre *</label><select data-report-filter="period" disabled></select></div>';
    if (state.tab === 'risk') return '<div><label>Nivel de riesgo</label><select data-report-filter="risk"></select></div><div><label>Estado de alerta</label><select data-report-filter="status"></select></div>';
    if (state.tab === 'followups') return '<div><label>Tipo seguimiento</label><select data-report-filter="type"></select></div><div><label>Nivel de riesgo</label><select data-report-filter="risk"></select></div><div><label>Estado de alerta</label><select data-report-filter="status"></select></div><div><label>Desde</label><input type="date" data-report-filter="from"></div><div><label>Hasta</label><input type="date" data-report-filter="to"></div>';
    return '';
  }
  function configureDynamicFilters() {
    $('#reports-dynamic-filters').innerHTML = dynamicHtml();
    if (!state.loaded && !state.catalogs.risks) return;
    if (state.tab === 'risk' || state.tab === 'followups') {
      fill(get('risk'), state.catalogs.risks, 'Todos', 'codigo', (row) => row.nombre);
      fill(get('status'), state.catalogs.statuses, 'Todos', 'codigo', (row) => row.nombre);
    }
    if (state.tab === 'followups') fill(get('type'), state.catalogs.types, 'Todos', 'codigo', (row) => row.nombre);
    if (state.tab === 'evaluations') { updatePeriods(); updateAreas().catch(reportError); }
    [...$('#reports-dynamic-filters').querySelectorAll('[data-report-filter]')].forEach((element) => element.addEventListener('change', filtersChanged));
  }
  function updatePeriods() {
    if (state.tab !== 'evaluations') return;
    const periods = state.catalogs.periods.filter((row) => String(row.anio_escolar_id) === get('year').value);
    fill(get('period'), periods, 'Todos los bimestres', 'periodo_id', (row) => row.nombre);
    get('period').options[0].value = 'all';
    get('period').disabled = !get('year').value;
  }
  async function updateAreas() {
    if (state.tab !== 'evaluations' || !get('room')?.value) { if (get('area')) get('area').disabled = true; return; }
    const roomId = Number(get('room').value);
    const [roomAreasResponse, assignmentsResponse] = await Promise.all([
      db.from('aula_area_curricular').select('aula_area_curricular_id,area_curricular_nivel_id,estado,area_curricular_nivel(area_curricular_nivel_id,area_curricular(area_curricular_id,nombre,estado))').eq('aula_id', roomId).eq('estado', true),
      db.from('docente_aula_area').select('aula_area_curricular_id,estado,docente(estado,usuario(nombres,apellidos))').eq('estado', true)
    ]);
    const roomAreas = check(roomAreasResponse, 'Áreas del aula');
    const assignments = check(assignmentsResponse, 'Docentes responsables');
    state.catalogs.currentRoomAreas = roomAreas;
    state.catalogs.currentAssignments = assignments;
    fill(get('area'), roomAreas, 'Seleccione', 'aula_area_curricular_id', (row) => { const area = rel(rel(row.area_curricular_nivel)?.area_curricular); const assignment = assignments.find((item) => item.aula_area_curricular_id === row.aula_area_curricular_id && rel(item.docente)?.estado === 'ACTIVO'); return `${area?.nombre || 'Área'} — ${teacherName(assignment)}`; });
  }

  function filtersChanged(event) {
    const name = event?.target?.dataset.reportFilter;
    if (name === 'level') updateGrades();
    if (name === 'year') { updateRooms(); updatePeriods(); }
    if (name === 'grade') updateRooms();
    if (name === 'room') updateAreas().catch(reportError);
    if (state.queried) invalidate('Los filtros cambiaron. Presione Consultar para actualizar el reporte.');
  }
  function invalidate(message = 'Seleccione los filtros y presione Consultar.') {
    state.queried = false; state.rows = []; state.exportRows = []; state.page = 1;
    destroyCharts();
    $('#reports-context').innerHTML = ''; $('#reports-period-switcher').classList.add('d-none');
    $('#reports-results').classList.add('d-none'); $('#reports-actions').classList.add('d-none');
    $('#reports-initial').classList.remove('d-none'); $('#reports-initial span').textContent = message;
  }
  function clearFilters() {
    [...filterBox.querySelectorAll('select,input')].forEach((element) => { element.value = ''; });
    get('grade').disabled = true; get('room').disabled = true;
    configureDynamicFilters(); invalidate(); feedback('');
  }
  function required() {
    const values = filterValues();
    if (!values.year) return 'Seleccione un año escolar.';
    if (state.tab === 'attendance' && (!values.level || !values.grade || !values.room || !values.month)) return 'Seleccione año, nivel, grado, sección y mes.';
    if (state.tab === 'evaluations' && (!values.level || !values.grade || !values.room || !values.area || !values.period)) return 'Seleccione año, nivel, grado, sección, área y bimestre.';
    return '';
  }

  async function queryReport() {
    const validation = required(); if (validation) { feedback(validation, false); return; }
    const button = $('#reports-query'); button.disabled = true; button.textContent = 'Consultando...';
    $('#reports-loading').classList.remove('d-none'); $('#reports-initial').classList.add('d-none'); $('#reports-results').classList.add('d-none'); feedback('');
    try {
      if (state.tab === 'summary') await querySummary();
      if (state.tab === 'attendance') await queryAttendance();
      if (state.tab === 'evaluations') await queryEvaluations();
      if (state.tab === 'risk') await queryRisk();
      if (state.tab === 'followups') await queryFollowups();
      state.queried = true; state.page = 1; renderPage(); updatePrintHeader();
      const hasResults = state.tab === 'summary' ? state.metrics.length > 0 : state.tab === 'evaluations' ? Boolean(state.context.enrollments?.length && state.context.competencies?.length) : state.rows.length > 0;
      $('#reports-results').classList.remove('d-none'); $('#reports-actions').classList.toggle('d-none', !hasResults); $('#reports-generated').textContent = `Generado: ${generated()}`;
    } catch (error) { console.error('[Reportes]', error.cause || error); invalidate(); feedback('No fue posible generar el reporte.', false); }
    finally { button.disabled = false; button.textContent = 'Consultar'; $('#reports-loading').classList.add('d-none'); }
  }

  function enrollmentQuery() {
    let query = db.from('matricula').select('matricula_id,estado,estudiante(estudiante_id,codigo,nombres,apellido_paterno,apellido_materno),aula!inner(aula_id,anio_escolar_id,grado_id,seccion_id,anio_escolar(anio_escolar_id,anio),grado!inner(grado_id,nivel_id,nombre,nivel_educativo(nivel_id,nombre)),seccion(seccion_id,nombre))').eq('estado', true).eq('aula.anio_escolar_id', Number(get('year').value));
    if (get('level').value) query = query.eq('aula.grado.nivel_id', Number(get('level').value));
    if (get('grade').value) query = query.eq('aula.grado_id', Number(get('grade').value));
    if (get('room').value) query = query.eq('aula_id', Number(get('room').value));
    return query;
  }
  async function baseEnrollments() { return check(await enrollmentQuery(), 'Matrículas'); }
  async function rowsByEnrollment(table, select, enrollmentIds, configure = (query) => query) { if (!enrollmentIds.length) return []; return check(await configure(db.from(table).select(select).in('matricula_id', enrollmentIds)), table); }
  function attendanceSummary(rows) { const count = {A:0,T:0,FJ:0,FNJ:0}; rows.forEach((row) => { const code = rel(row.estado_asistencia)?.codigo; if (Object.hasOwn(count, code)) count[code] += 1; }); return {...count, total:rows.length, percent:rows.length ? count.A / rows.length * 100 : null}; }
  function studentsAttendance(enrollments, rows) { return enrollments.map((enrollment) => { const own = rows.filter((row) => row.matricula_id === enrollment.matricula_id); return {parts:academicParts(enrollment), summary:attendanceSummary(own)}; }); }

  async function querySummary() {
    const enrollments = await baseEnrollments(), ids = enrollments.map((row) => row.matricula_id);
    const [attendance, analyses, followups] = await Promise.all([
      rowsByEnrollment('asistencia', 'matricula_id,fecha,estado_asistencia(codigo)', ids),
      rowsByEnrollment('analisis_riesgo', 'analisis_riesgo_id,matricula_id,fecha_analisis,nivel_riesgo(codigo,nombre),factor_analisis_riesgo(tipo_factor,descripcion,valor),alerta(fecha_generacion,estado_alerta(codigo,nombre))', ids),
      ids.length ? check(await db.from('seguimiento').select('seguimiento_id,alerta!inner(analisis_riesgo!inner(matricula_id))').in('alerta.analisis_riesgo.matricula_id', ids), 'Seguimientos') : []
    ]);
    const risks = {BAJO:0,MEDIO:0,ALTO:0}; analyses.forEach((row) => { const code = rel(row.nivel_riesgo)?.codigo; if (Object.hasOwn(risks, code)) risks[code] += 1; });
    const alerts = analyses.flatMap((row) => row.alerta || []), active = alerts.filter((row) => ['NUEVA','SEGUIMIENTO'].includes(rel(row.estado_alerta)?.codigo)).length;
    const att = attendanceSummary(attendance);
    state.metrics = [['Estudiantes matriculados',enrollments.length,'violet'],['Asistencia promedio',att.percent === null ? 'Sin información' : `${att.percent.toFixed(1)}%`,'sky'],['Riesgo alto',risks.ALTO,'coral'],['Riesgo medio',risks.MEDIO,'amber'],['Alertas activas',active,'amber'],['Seguimientos registrados',followups.length,'violet']];
    state.rows = analyses.filter((row) => ['ALTO','MEDIO'].includes(rel(row.nivel_riesgo)?.codigo)).sort((a,b) => (riskOrder[rel(a.nivel_riesgo)?.codigo] ?? 9) - (riskOrder[rel(b.nivel_riesgo)?.codigo] ?? 9));
    state.exportRows = state.rows; queryContext(); state.context.enrollments = enrollments; state.context.risks = risks; state.context.attendance = attendance;
    renderKpis(); renderSummaryCharts(risks, attendance); setTable(['Código','Estudiante','Nivel','Grado / Sección','Nivel de riesgo','Estado de alerta','Factor principal']);
  }

  async function queryAttendance() {
    const enrollments = await baseEnrollments(), ids = enrollments.map((row) => row.matricula_id), month = get('month').value;
    const rows = await rowsByEnrollment('asistencia', 'matricula_id,fecha,estado_asistencia(codigo,nombre)', ids, (query) => query.gte('fecha', `${month}-01`).lte('fecha', `${month}-${String(new Date(...month.split('-').map(Number), 0).getDate()).padStart(2,'0')}`));
    const total = attendanceSummary(rows), students = studentsAttendance(enrollments, rows), order = get('order').value;
    students.sort((a,b) => order === 'name' ? fullName(a.parts.student).localeCompare(fullName(b.parts.student)) : order === 'high' ? (b.summary.percent ?? -1) - (a.summary.percent ?? -1) : (a.summary.percent ?? 101) - (b.summary.percent ?? 101));
    state.metrics = [['Estudiantes',students.length,'violet'],['Asistencia promedio',total.percent === null ? 'Sin registros' : `${total.percent.toFixed(1)}%`,'sky'],['Asistencias',total.A,'green'],['Tardanzas',total.T,'amber'],['Faltas justificadas',total.FJ,'sky'],['Faltas no justificadas',total.FNJ,'coral']];
    state.rows = students; state.exportRows = students; queryContext({month:selectedText('month', month)}); renderKpis(); renderAttendanceChart(total); setTable(['Código','Estudiante','Grado / Sección','% Asistencia','A','T','FJ','FNJ']);
  }

  async function queryEvaluations() {
    const enrollments = await baseEnrollments(), ids = enrollments.map((row) => row.matricula_id), roomAreaId = Number(get('area').value), roomArea = state.catalogs.currentRoomAreas.find((row) => row.aula_area_curricular_id === roomAreaId), relation = rel(roomArea?.area_curricular_nivel), area = rel(relation?.area_curricular);
    const [competencies, assignmentRows] = await Promise.all([
      check(await db.from('competencia').select('competencia_id,nombre,orden,estado').eq('area_curricular_nivel_id', relation.area_curricular_nivel_id).eq('estado', true).order('orden'), 'Competencias'),
      check(await db.from('docente_aula_area').select('estado,docente(estado,usuario(nombres,apellidos))').eq('aula_area_curricular_id', roomAreaId).eq('estado', true), 'Docente responsable')
    ]);
    const periods = state.catalogs.periods.filter((row) => String(row.anio_escolar_id) === get('year').value), selected = get('period').value, selectedPeriods = selected === 'all' ? periods : periods.filter((row) => String(row.periodo_id) === selected), competencyIds = competencies.map((row) => row.competencia_id);
    let grades = [];
    if (ids.length && competencyIds.length && selectedPeriods.length) grades = check(await db.from('calificacion').select('matricula_id,periodo_id,competencia_id,calificacion_literal(codigo,nombre)').in('matricula_id', ids).in('competencia_id', competencyIds).in('periodo_id', selectedPeriods.map((row) => row.periodo_id)), 'Calificaciones');
    state.periods = selectedPeriods; state.activePeriod = selectedPeriods[0]?.periodo_id || null;
    state.context = {area:area?.nombre || 'No registrado', teacher:teacherName(assignmentRows.find((row) => rel(row.docente)?.estado === 'ACTIVO')), room:`${selectedText('grade','')} ${selectedText('room','')}`.trim(), period:selected === 'all' ? 'Todos los bimestres' : selectedText('period'), competencies, enrollments, grades, year:selectedText('year'), level:selectedText('level'), grade:selectedText('grade'), section:selectedText('room')};
    state.exportRows = grades; renderEvaluationPeriod();
  }

  async function queryRisk() {
    const enrollments = await baseEnrollments(), ids = enrollments.map((row) => row.matricula_id);
    let analyses = await rowsByEnrollment('analisis_riesgo', 'analisis_riesgo_id,matricula_id,fecha_analisis,nivel_riesgo(codigo,nombre),factor_analisis_riesgo(tipo_factor,descripcion,valor),alerta(fecha_generacion,estado_alerta(codigo,nombre))', ids);
    const risk = get('risk').value, status = get('status').value;
    analyses = analyses.filter((row) => (!risk || rel(row.nivel_riesgo)?.codigo === risk) && (!status || rel(row.alerta?.[0]?.estado_alerta)?.codigo === status));
    analyses.forEach((row) => { row.parts = academicParts(enrollments.find((item) => item.matricula_id === row.matricula_id)); });
    analyses.sort((a,b) => (riskOrder[rel(a.nivel_riesgo)?.codigo] ?? 9) - (riskOrder[rel(b.nivel_riesgo)?.codigo] ?? 9) || String(b.fecha_analisis).localeCompare(String(a.fecha_analisis)));
    const counts = {BAJO:0,MEDIO:0,ALTO:0,NUEVA:0,SEGUIMIENTO:0,CERRADA:0}; analyses.forEach((row) => { const r = rel(row.nivel_riesgo)?.codigo, s = rel(row.alerta?.[0]?.estado_alerta)?.codigo; if (r) counts[r]++; if (s) counts[s]++; });
    state.metrics = [['Total analizados',analyses.length,'violet'],['Riesgo bajo',counts.BAJO,'green'],['Riesgo medio',counts.MEDIO,'amber'],['Riesgo alto',counts.ALTO,'coral'],['Alertas nuevas',counts.NUEVA,'coral'],['En seguimiento',counts.SEGUIMIENTO,'sky'],['Cerradas',counts.CERRADA,'green']];
    state.rows = analyses; state.exportRows = analyses; queryContext({risk:selectedText('risk'), status:selectedText('status')}); renderKpis(); clearCharts(); setTable(['Código','Estudiante','Grado / Sección','Nivel de riesgo','Factor principal','Estado de alerta','Fecha análisis','Fecha alerta']);
  }

  async function queryFollowups() {
    const enrollments = await baseEnrollments(), ids = enrollments.map((row) => row.matricula_id);
    let rows = ids.length ? check(await db.from('seguimiento').select('seguimiento_id,fecha,fecha_registro,descripcion,acuerdo,proxima_accion,fecha_proxima_accion,tipo_seguimiento(codigo,nombre),usuario(nombres,apellidos),alerta!inner(alerta_id,estado_alerta(codigo,nombre),analisis_riesgo!inner(matricula_id,nivel_riesgo(codigo,nombre)))').in('alerta.analisis_riesgo.matricula_id', ids).order('fecha', {ascending:false}), 'Seguimientos') : [];
    const values = filterValues(); rows = rows.filter((row) => { const alert = rel(row.alerta), analysis = rel(alert?.analisis_riesgo); return (!values.type || rel(row.tipo_seguimiento)?.codigo === values.type) && (!values.risk || rel(analysis?.nivel_riesgo)?.codigo === values.risk) && (!values.status || rel(alert?.estado_alerta)?.codigo === values.status) && (!values.from || row.fecha >= values.from) && (!values.to || row.fecha <= values.to); });
    rows.forEach((row) => { const analysis = rel(rel(row.alerta)?.analisis_riesgo); row.parts = academicParts(enrollments.find((item) => item.matricula_id === analysis?.matricula_id)); });
    const students = new Set(rows.map((row) => row.parts.student?.estudiante_id).filter(Boolean)), next = rows.filter((row) => row.fecha_proxima_accion).length, trackingAlerts = new Set(rows.filter((row) => rel(rel(row.alerta)?.estado_alerta)?.codigo === 'SEGUIMIENTO').map((row) => rel(row.alerta)?.alerta_id || row.seguimiento_id));
    state.metrics = [['Total seguimientos',rows.length,'violet'],['Estudiantes con seguimiento',students.size,'sky'],['Próximas acciones',next,'amber'],['Alertas en seguimiento',trackingAlerts.size,'green']];
    state.rows = rows; state.exportRows = rows; queryContext({type:selectedText('type'), risk:selectedText('risk'), status:selectedText('status')}); renderKpis(); clearCharts(); setTable(['Fecha','Código','Estudiante','Grado / Sección','Riesgo','Tipo','Responsable','Acuerdo','Próxima acción','Fecha próxima','Estado alerta']);
  }

  function renderKpis() { $('#reports-kpis').innerHTML = state.metrics.map(([label,value,tone,extra]) => kpi(label,value,tone,extra)).join(''); }
  function setTable(headings) { const table = $('#reports-table'); table.className = 'table table-vcenter card-table reports-table'; table.tHead.innerHTML = `<tr>${headings.map((heading) => `<th>${esc(heading)}</th>`).join('')}</tr>`; $('#reports-detail-title').textContent = state.tab === 'summary' ? 'Estudiantes que requieren atención' : 'Detalle del reporte'; $('#reports-period-switcher').classList.add('d-none'); }
  function renderPage() {
    if (state.tab === 'evaluations') { renderEvaluationPeriod(); return; }
    const total = state.rows.length, start = (state.page - 1) * state.size, rows = state.rows.slice(start, start + state.size);
    $('#reports-table tbody').innerHTML = rows.map(rowHtml).join('');
    $('#reports-empty').classList.toggle('d-none', total > 0); $('.reports-table-wrap').classList.toggle('d-none', total === 0); renderPagination(total);
  }
  function rowHtml(row) {
    if (state.tab === 'summary') { const enrollment = state.context.enrollments.find((item) => item.matricula_id === row.matricula_id), p = academicParts(enrollment), alert = row.alerta?.[0], factor = row.factor_analisis_riesgo?.[0]; return `<tr><td>${esc(p.student?.codigo)}</td><td>${esc(fullName(p.student))}</td><td>${esc(p.level?.nombre)}</td><td>${esc(`${p.grade?.nombre || ''} ${p.section?.nombre || ''}`.trim())}</td><td>${badge(rel(row.nivel_riesgo)?.codigo)}</td><td>${badge(rel(alert?.estado_alerta)?.codigo,'state')}</td><td>${esc(factor?.descripcion || factor?.valor || factor?.tipo_factor,'Sin factores')}</td></tr>`; }
    if (state.tab === 'attendance') { const p = row.parts, s = row.summary; return `<tr><td>${esc(p.student?.codigo)}</td><td>${esc(fullName(p.student))}</td><td>${esc(`${p.grade?.nombre || ''} ${p.section?.nombre || ''}`.trim())}</td><td>${s.percent === null ? 'Sin registros' : `${s.percent.toFixed(1)}%`}</td><td>${literal('A').replace('report-literal literal-a','attendance-status attendance-status-a')} ${s.A}</td><td>${literal('T').replace('report-literal literal-t','attendance-status attendance-status-t')} ${s.T}</td><td>${literal('FJ').replace('report-literal literal-fj','attendance-status attendance-status-fj')} ${s.FJ}</td><td>${literal('FNJ').replace('report-literal literal-fnj','attendance-status attendance-status-fnj')} ${s.FNJ}</td></tr>`; }
    if (state.tab === 'risk') { const p = row.parts, alert = row.alerta?.[0], factors = row.factor_analisis_riesgo || [], factor = factors[0]; return `<tr><td>${esc(p.student?.codigo)}</td><td>${esc(fullName(p.student))}</td><td>${esc(`${p.grade?.nombre || ''} ${p.section?.nombre || ''}`.trim())}</td><td>${badge(rel(row.nivel_riesgo)?.codigo)}</td><td>${esc(factor?.descripcion || factor?.valor || factor?.tipo_factor,'Sin factores')}${factors.length > 1 ? `<small class="report-more-factors">+${factors.length - 1} factores</small>` : ''}</td><td>${badge(rel(alert?.estado_alerta)?.codigo,'state')}</td><td>${date(row.fecha_analisis)}</td><td>${date(alert?.fecha_generacion)}</td></tr>`; }
    const p = row.parts, alert = rel(row.alerta), analysis = rel(alert?.analisis_riesgo), user = rel(row.usuario), nextState = temporal(row.fecha_proxima_accion); return `<tr><td>${date(row.fecha)}</td><td>${esc(p.student?.codigo)}</td><td>${esc(fullName(p.student))}</td><td>${esc(`${p.grade?.nombre || ''} ${p.section?.nombre || ''}`.trim())}</td><td>${badge(rel(analysis?.nivel_riesgo)?.codigo)}</td><td>${esc(rel(row.tipo_seguimiento)?.nombre)}</td><td>${esc([user?.nombres,user?.apellidos].filter(Boolean).join(' '))}</td><td>${esc(row.acuerdo)}</td><td>${esc(row.proxima_accion)}</td><td>${date(row.fecha_proxima_accion)} ${row.fecha_proxima_accion ? `<span class="badge next-${norm(nextState)}">${nextState}</span>` : ''}</td><td>${badge(rel(alert?.estado_alerta)?.codigo,'state')}</td></tr>`;
  }
  function temporal(value) { if (!value) return ''; const today = new Date().toISOString().slice(0,10), day = String(value).slice(0,10); return day < today ? 'VENCIDA' : day === today ? 'HOY' : 'PRÓXIMA'; }
  function renderPagination(total) {
    const pages = Math.max(1, Math.ceil(total / state.size)), start = total ? (state.page - 1) * state.size + 1 : 0, end = Math.min(state.page * state.size, total);
    $('#reports-pagination').innerHTML = `<span>Mostrando ${start} a ${end} de ${total} registros</span><label>Por página <select id="reports-page-size"><option>10</option><option>20</option><option>30</option></select></label><div><button class="btn btn-sm btn-outline-secondary" data-page="prev" ${state.page === 1 ? 'disabled' : ''}>‹</button><span>${state.page} / ${pages}</span><button class="btn btn-sm btn-outline-secondary" data-page="next" ${state.page === pages ? 'disabled' : ''}>›</button></div>`;
    $('#reports-page-size').value = String(state.size); $('#reports-page-size').onchange = (event) => { state.size = Number(event.target.value); state.page = 1; renderPage(); };
    $('#reports-pagination [data-page="prev"]').onclick = () => { state.page--; renderPage(); }; $('#reports-pagination [data-page="next"]').onclick = () => { state.page++; renderPage(); };
  }

  function renderEvaluationPeriod() {
    const c = state.context, periodId = state.activePeriod, period = state.periods.find((row) => row.periodo_id === periodId), grades = c.grades || [], competencies = c.competencies || [], enrollments = c.enrollments || [];
    const codes = grades.filter((row) => row.periodo_id === periodId).map((row) => rel(row.calificacion_literal)?.codigo).filter(Boolean), counts = {AD:0,A:0,B:0,C:0}; codes.forEach((code) => counts[code]++);
    state.metrics = [['Estudiantes',enrollments.length,'violet'],['Competencias',competencies.length,'violet'],['AD',counts.AD,'sky','evaluation-kpi-ad'],['A',counts.A,'green','evaluation-kpi-a'],['B',counts.B,'amber','evaluation-kpi-b'],['C',counts.C,'coral','evaluation-kpi-c']]; renderKpis();
    $('#reports-context').innerHTML = `<div class="reports-evaluation-context"><span><b>Área curricular:</b> ${esc(c.area)}</span><span><b>Docente:</b> ${esc(c.teacher)}</span><span><b>Aula:</b> ${esc(c.room)}</span><span><b>Periodo:</b> ${esc(c.period)}</span></div>`;
    const switcher = $('#reports-period-switcher'); switcher.classList.toggle('d-none', state.periods.length < 2 || c.period !== 'Todos los bimestres'); switcher.innerHTML = state.periods.map((row) => `<button class="btn btn-sm ${row.periodo_id === periodId ? 'btn-primary' : 'btn-outline-secondary'}" data-report-period="${row.periodo_id}">${esc(row.nombre)}</button>`).join(''); switcher.querySelectorAll('button').forEach((button) => button.onclick = () => { state.activePeriod = Number(button.dataset.reportPeriod); renderEvaluationPeriod(); });
    const table = $('#reports-table'); table.className = 'table table-vcenter card-table reports-table report-evaluation-matrix'; table.tHead.innerHTML = `<tr><th class="student-sticky">Estudiante</th>${competencies.map((item) => `<th>${esc(item.nombre)}</th>`).join('')}</tr>`;
    table.tBodies[0].innerHTML = enrollments.map((enrollment) => { const student = academicParts(enrollment).student; return `<tr><td class="student-sticky"><strong>${esc(fullName(student))}</strong><small>${esc(student?.codigo)}</small></td>${competencies.map((competency) => { const grade = grades.find((row) => row.periodo_id === periodId && row.matricula_id === enrollment.matricula_id && row.competencia_id === competency.competencia_id); return `<td>${literal(rel(grade?.calificacion_literal)?.codigo)}</td>`; }).join('')}</tr>`; }).join('');
    $('#reports-detail-title').textContent = `Matriz de evaluación${period ? ` — ${period.nombre}` : ''}`; $('#reports-empty').classList.toggle('d-none', !enrollments.length || !competencies.length); $('.reports-table-wrap').classList.toggle('d-none', !enrollments.length || !competencies.length); $('#reports-pagination').innerHTML = ''; clearCharts(); renderEvaluationChart(counts);
  }

  function destroyCharts() { Object.values(state.charts).forEach((chart) => chart?.destroy()); state.charts = {}; }
  function clearCharts() { destroyCharts(); $('#reports-charts').innerHTML = ''; }
  function chart(selector, options) { const element = $(selector); if (!element) return; const instance = new ApexCharts(element, options); instance.render(); state.charts[selector] = instance; }
  function renderSummaryCharts(risks, attendance) {
    clearCharts(); $('#reports-charts').innerHTML = '<div class="reports-chart-grid"><article class="card students-card"><div class="card-header"><h2 class="card-title">Distribución de riesgo</h2></div><div class="card-body report-chart" id="report-risk-chart"></div></article><article class="card students-card"><div class="card-header"><h2 class="card-title">Tendencia mensual de asistencia</h2></div><div class="card-body report-chart" id="report-attendance-chart"></div></article></div>';
    chart('#report-risk-chart',{chart:{type:'donut',height:245,toolbar:{show:false}},series:[risks.BAJO,risks.MEDIO,risks.ALTO],labels:['Bajo','Medio','Alto'],colors:['#55ad83','#e9ad47','#e9786a'],legend:{position:'right'},dataLabels:{enabled:false},stroke:{colors:['#fff']}});
    const months = new Map(); attendance.forEach((row) => { const key = row.fecha?.slice(0,7); if (!key) return; if (!months.has(key)) months.set(key,[]); months.get(key).push(row); }); const entries = [...months].sort(([a],[b]) => a.localeCompare(b));
    if (!entries.length) { $('#report-attendance-chart').innerHTML = '<p class="students-message">Sin información.</p>'; return; }
    chart('#report-attendance-chart',{chart:{type:'area',height:245,toolbar:{show:false}},series:[{name:'Asistencia',data:entries.map(([,rows]) => Number(attendanceSummary(rows).percent.toFixed(1)))}],xaxis:{categories:entries.map(([key]) => new Intl.DateTimeFormat('es-PE',{month:'short',timeZone:'UTC'}).format(new Date(`${key}-01T00:00:00Z`)))},yaxis:{min:0,max:100,labels:{formatter:(value)=>`${value.toFixed(0)}%`}},colors:['#45afd0'],stroke:{curve:'smooth',width:2.5},fill:{type:'gradient',gradient:{opacityFrom:.2,opacityTo:.02}},dataLabels:{enabled:false}});
  }
  function renderAttendanceChart(total) { clearCharts(); $('#reports-charts').innerHTML = '<div class="attendance-legend report-attendance-legend"><i class="ti ti-info-circle"></i><strong>Leyenda:</strong><span><b class="attendance-status attendance-status-a">A</b> Asistencia</span><span><b class="attendance-status attendance-status-t">T</b> Tardanza</span><span><b class="attendance-status attendance-status-fj">FJ</b> Falta justificada</span><span><b class="attendance-status attendance-status-fnj">FNJ</b> Falta no justificada</span></div><article class="card students-card report-single-chart"><div class="card-header"><h2 class="card-title">Distribución de estados</h2></div><div class="card-body report-chart" id="report-attendance-status-chart"></div></article>'; chart('#report-attendance-status-chart',{chart:{type:'bar',height:190,toolbar:{show:false}},series:[{name:'Registros',data:[total.A,total.T,total.FJ,total.FNJ]}],xaxis:{categories:['A','T','FJ','FNJ']},colors:['#55ad83','#e9ad47','#45afd0','#e9786a'],plotOptions:{bar:{distributed:true,borderRadius:5}},legend:{show:false},dataLabels:{enabled:false}}); }
  function renderEvaluationChart(counts) { $('#reports-charts').innerHTML = '<article class="card students-card report-evaluation-chart"><div class="card-header"><h2 class="card-title">Distribución de calificaciones literales</h2></div><div class="card-body" id="report-evaluation-chart"></div></article>'; chart('#report-evaluation-chart',{chart:{type:'bar',height:175,toolbar:{show:false}},series:[{name:'Calificaciones',data:[counts.AD,counts.A,counts.B,counts.C]}],xaxis:{categories:['AD','A','B','C']},colors:['#568bd4','#55ad83','#e9ad47','#e9786a'],plotOptions:{bar:{distributed:true,borderRadius:5}},legend:{show:false},dataLabels:{enabled:false}}); }

  function updatePrintHeader() { const title = tabs.find(([key]) => key === state.tab)?.[1] || 'Reporte'; $('#reports-print-title').textContent = title; $('#reports-print-institution').textContent = `${safe(state.institution?.nombre)} · Código modular: ${safe(state.institution?.codigo_modular)} · UGEL: ${safe(state.institution?.ugel)} · Distrito: ${safe(state.institution?.distrito)}`; $('#reports-print-meta').textContent = `Año: ${state.context.year || '—'} · Nivel: ${state.context.level || 'Todos'} · Grado: ${state.context.grade || 'Todos'} · Sección: ${state.context.section || 'Todas'} · Generado: ${generated()}`; }
  function excelHeader(extra = []) { return [['PREVI-EDU'],['Institución',safe(state.institution?.nombre)],['Código modular',safe(state.institution?.codigo_modular)],['UGEL',safe(state.institution?.ugel)],['Distrito',safe(state.institution?.distrito)],['Año escolar',state.context.year],['Nivel',state.context.level],['Grado',state.context.grade],['Sección',state.context.section],...extra,['Fecha de generación',generated()],[]]; }
  function appendSheet(workbook, name, rows) { const sheet = XLSX.utils.aoa_to_sheet(rows); const width = Math.max(...rows.map((row) => row.length)); sheet['!cols'] = Array.from({length:width},(_,index)=>({wch:Math.min(48,Math.max(12,...rows.map((row)=>safe(row[index],'').length+2)))})); XLSX.utils.book_append_sheet(workbook,sheet,safe(name,'Reporte').slice(0,31).replace(/[\\/?*\[\]:]/g,'-')); }
  function exportExcel() {
    if (!state.queried) return; feedback('Preparando archivo...');
    try {
      const workbook = XLSX.utils.book_new(), year = state.context.year || 'Año', fileParts = ['PREVI-EDU',tabs.find(([key])=>key===state.tab)[1],year];
      if (state.tab === 'summary') { const body = state.rows.map((row) => { const enrollment=state.context.enrollments.find((item)=>item.matricula_id===row.matricula_id),p=academicParts(enrollment),alert=row.alerta?.[0],factor=row.factor_analisis_riesgo?.[0];return[p.student?.codigo,fullName(p.student),p.level?.nombre,p.grade?.nombre,p.section?.nombre,rel(row.nivel_riesgo)?.codigo,rel(alert?.estado_alerta)?.codigo,factor?.descripcion||factor?.valor||factor?.tipo_factor];}); appendSheet(workbook,'Resumen',[...excelHeader(),...state.metrics.map(([a,b])=>[a,b]),[],['Código','Estudiante','Nivel','Grado','Sección','Nivel riesgo','Estado alerta','Factor principal'],...body]); }
      if (state.tab === 'attendance') { const body=state.rows.map(({parts:p,summary:s})=>[p.student?.codigo,fullName(p.student),p.level?.nombre,p.grade?.nombre,p.section?.nombre,s.percent===null?'Sin registros':`${s.percent.toFixed(1)}%`,s.A,s.T,s.FJ,s.FNJ]);appendSheet(workbook,'Asistencia',[...excelHeader([['Mes',state.context.month]]),['Código','Estudiante','Nivel','Grado','Sección','% Asistencia','A','T','FJ','FNJ'],...body,[],['Leyenda'],['A','Asistencia'],['T','Tardanza'],['FJ','Falta justificada'],['FNJ','Falta no justificada']]);fileParts.push(state.context.grade,state.context.section,state.context.month); }
      if (state.tab === 'evaluations') { state.periods.forEach((period)=>{const header=['Código','Estudiante',...state.context.competencies.map((item)=>item.nombre)],body=state.context.enrollments.map((enrollment)=>{const student=academicParts(enrollment).student;return[student?.codigo,fullName(student),...state.context.competencies.map((competency)=>rel(state.context.grades.find((row)=>row.periodo_id===period.periodo_id&&row.matricula_id===enrollment.matricula_id&&row.competencia_id===competency.competencia_id)?.calificacion_literal)?.codigo||'Sin calificación')];});appendSheet(workbook,period.nombre,[...excelHeader([['Área',state.context.area],['Docente',state.context.teacher],['Bimestre',period.nombre]]),header,...body]);});fileParts.push(state.context.grade,state.context.section,state.context.area); }
      if (state.tab === 'risk') { const body=state.rows.map((row)=>{const p=row.parts,alert=row.alerta?.[0],factor=row.factor_analisis_riesgo?.[0];return[p.student?.codigo,fullName(p.student),p.level?.nombre,p.grade?.nombre,p.section?.nombre,rel(row.nivel_riesgo)?.codigo,factor?.descripcion||factor?.valor||factor?.tipo_factor,rel(alert?.estado_alerta)?.codigo,date(row.fecha_analisis),date(alert?.fecha_generacion)];});appendSheet(workbook,'Riesgo y alertas',[...excelHeader(),['Código','Estudiante','Nivel','Grado','Sección','Nivel riesgo','Factor principal','Estado alerta','Fecha análisis','Fecha alerta'],...body]); }
      if (state.tab === 'followups') { const body=state.rows.map((row)=>{const p=row.parts,alert=rel(row.alerta),analysis=rel(alert?.analisis_riesgo),user=rel(row.usuario);return[date(row.fecha),p.student?.codigo,fullName(p.student),p.grade?.nombre,p.section?.nombre,rel(analysis?.nivel_riesgo)?.codigo,rel(row.tipo_seguimiento)?.nombre,[user?.nombres,user?.apellidos].filter(Boolean).join(' '),row.descripcion,row.acuerdo,row.proxima_accion,date(row.fecha_proxima_accion),rel(alert?.estado_alerta)?.codigo];});appendSheet(workbook,'Seguimientos',[...excelHeader(),['Fecha','Código','Estudiante','Grado','Sección','Riesgo','Tipo seguimiento','Responsable','Descripción','Acuerdo','Próxima acción','Fecha próxima acción','Estado alerta'],...body]); }
      const filename = fileParts.filter(Boolean).join('_').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_'); XLSX.writeFile(workbook,`${filename}.xlsx`); feedback('Archivo generado correctamente.');
    } catch (error) { console.error('[Reportes] Exportación',error); feedback('No fue posible generar el reporte.',false); }
  }
  function feedback(message, ok = true) { const element = $('#reports-feedback'); if (!message) { element.classList.add('d-none'); return; } element.textContent = message; element.className = `alert students-feedback reports-no-print ${ok ? 'alert-success' : 'alert-danger'}`; }
  function reportError(error) { console.error('[Reportes]',error.cause||error); feedback('No fue posible generar el reporte.',false); }
  function activate(tab) { state.tab = tab; document.querySelectorAll('[data-reports-tab]').forEach((button)=>button.classList.toggle('active',button.dataset.reportsTab===tab));configureDynamicFilters();clearFilters(); }
  function show(event) { event.preventDefault(); ['#dashboard-director','#institution-view','#academic-management-view','#students-view','#teachers-view','#attendance-view','#evaluations-view','#alerts-view','#followups-view'].forEach((selector)=>$(selector)?.classList.add('d-none'));$('#reports-view').classList.remove('d-none');$('#dashboard-title').textContent='REPORTES';$('#dashboard-subtitle').textContent='Consulte y exporte información institucional para el seguimiento académico y preventivo.';menu.querySelectorAll('.nav-link').forEach((item)=>item.classList.toggle('active',item===link));if(!state.loaded)init();else invalidate(); }
  async function init() { try { $('#reports-loading').classList.remove('d-none'); await loadCatalogs(); invalidate(); } catch(error) { reportError(error); } finally { $('#reports-loading').classList.add('d-none'); } }

  get('level').addEventListener('change', filtersChanged); get('grade').addEventListener('change', filtersChanged); get('year').addEventListener('change', filtersChanged); get('room').addEventListener('change', filtersChanged);
  link.addEventListener('click',show); [...menu.querySelectorAll('.nav-link')].filter((item)=>item!==link).forEach((item)=>item.addEventListener('click',()=>$('#reports-view').classList.add('d-none')));
  document.querySelectorAll('[data-reports-tab]').forEach((button)=>button.addEventListener('click',()=>activate(button.dataset.reportsTab)));
  $('#reports-query').addEventListener('click',queryReport); $('#reports-clear').addEventListener('click',clearFilters); $('#reports-export').addEventListener('click',exportExcel); $('#reports-print').addEventListener('click',()=>window.print());
})();
