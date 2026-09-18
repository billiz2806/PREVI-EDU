'use strict';

(() => {
  if (window.appContext?.currentRole !== 'DOCENTE') return;
  const menu = document.querySelector('#main-menu');
  const main = document.querySelector('main .container-xl');
  const link = [...menu.querySelectorAll('.nav-link')].find((item) => item.textContent.trim() === 'Dashboard');
  if (!link) return;

  main.insertAdjacentHTML('beforeend', `<section class="teacher-dashboard" id="dashboard-teacher" aria-label="Dashboard del docente">
    <div class="teacher-kpis">
      <article><span class="classrooms-kpi-icon tone-violet"><i class="ti ti-school"></i></span><div><small>Aulas asignadas</small><strong id="teacher-kpi-classrooms">—</strong></div></article>
      <article><span class="classrooms-kpi-icon tone-green"><i class="ti ti-users"></i></span><div><small>Estudiantes</small><strong id="teacher-kpi-students">—</strong></div></article>
      <article><span class="classrooms-kpi-icon tone-amber"><i class="ti ti-alert-triangle"></i></span><div><small>Alertas activas</small><strong id="teacher-kpi-alerts">—</strong></div></article>
      <article><span class="classrooms-kpi-icon tone-sky"><i class="ti ti-books"></i></span><div><small>Áreas asignadas</small><strong id="teacher-kpi-areas">—</strong></div></article>
    </div>
    <div class="teacher-dashboard-grid">
      <article class="card students-card"><div class="card-header students-card-header"><div class="students-heading"><span class="students-heading-icon icon-violet"><i class="ti ti-bolt"></i></span><div><h2 class="card-title">Accesos rápidos</h2><p>Funciones académicas frecuentes</p></div></div></div><div class="card-body teacher-quick-actions" id="teacher-quick-actions"></div></article>
      <article class="card students-card"><div class="card-header students-card-header"><div class="students-heading"><span class="students-heading-icon icon-green"><i class="ti ti-school"></i></span><div><h2 class="card-title">Mis aulas</h2><p id="teacher-dashboard-year">Año escolar actual</p></div></div><button class="btn btn-sm btn-outline-primary" data-teacher-go="Aulas">Ver todas</button></div><div class="card-body teacher-room-list" id="teacher-dashboard-rooms"></div></article>
    </div>
    <article class="card students-card mt-3"><div class="card-header students-card-header"><div class="students-heading"><span class="students-heading-icon icon-coral"><i class="ti ti-alert-circle"></i></span><div><h2 class="card-title">Alertas que requieren atención</h2><p>Estudiantes dentro de tus aulas asignadas</p></div></div></div><div class="card-body teacher-alert-list" id="teacher-dashboard-alerts"></div></article>
  </section>`);

  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? 'No registrado').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const studentName = (student) => [student?.nombres, student?.apellido_paterno, student?.apellido_materno].filter(Boolean).join(' ') || 'No registrado';
  const roomName = (room) => `${room?.grade?.nombre || ''} ${room?.section?.nombre || ''}`.trim() || 'Aula';

  function go(label, context = null) {
    const targets = { Aulas: 'teacher-classrooms', Asistencia: 'attendance', Evaluaciones: 'evaluations', Alertas: 'alerts' };
    if (context) window.previEduNavigation?.set(targets[label], context);
    [...menu.querySelectorAll('.nav-link')].find((item) => item.textContent.trim() === label)?.click();
  }

  function render(scope) {
    const studentIds = new Set(scope.enrollments.map((item) => item.estudiante_id).filter(Boolean));
    const areaIds = new Set(scope.assignments.map((item) => window.previEduTeacherScope.assignmentParts(item).area?.area_curricular_id).filter(Boolean));
    $('#teacher-kpi-classrooms').textContent = scope.classrooms.length;
    $('#teacher-kpi-students').textContent = studentIds.size;
    $('#teacher-kpi-alerts').textContent = scope.activeAlerts.length;
    $('#teacher-kpi-areas').textContent = areaIds.size;
    $('#teacher-dashboard-year').textContent = scope.academicYear ? `Año escolar ${scope.academicYear.anio}` : 'Sin año escolar disponible';
    $('#teacher-quick-actions').innerHTML = [['Aulas', 'Mis aulas', 'school'], ['Asistencia', 'Registrar asistencia', 'calendar-check'], ['Evaluaciones', 'Registrar evaluaciones', 'clipboard-check'], ['Alertas', 'Revisar alertas', 'alert-triangle']].map(([target, label, icon]) => `<button type="button" data-teacher-go="${target}"><i class="ti ti-${icon}"></i><span>${label}</span></button>`).join('');
    $('#teacher-dashboard-rooms').innerHTML = scope.classrooms.length ? scope.classrooms.slice(0, 4).map((room) => `<article class="teacher-room-summary"><div><strong>${esc(roomName(room))}</strong><small>${esc(room.level?.nombre)} · ${room.enrollments.length} estudiantes</small><p>${esc(room.areas.map((area) => area.nombre).join(', '))}</p></div><button class="btn btn-sm btn-outline-primary" data-room-id="${room.classroom.aula_id}">Ver aula</button></article>`).join('') : '<div class="teacher-empty"><i class="ti ti-school-off"></i><strong>Aún no tienes aulas asignadas en esta institución.</strong><p>Cuando el Director realice una asignación académica, tus aulas aparecerán aquí.</p></div>';
    $('#teacher-dashboard-alerts').innerHTML = scope.activeAlerts.length ? scope.activeAlerts.slice(0, 5).map((alert) => { const student = Array.isArray(alert.enrollment?.estudiante) ? alert.enrollment.estudiante[0] : alert.enrollment?.estudiante; const room = scope.classrooms.find((item) => item.classroom.aula_id === alert.enrollment?.aula_id); const risk = Array.isArray(alert.analysis.nivel_riesgo) ? alert.analysis.nivel_riesgo[0] : alert.analysis.nivel_riesgo; return `<article><div><strong>${esc(studentName(student))}</strong><small>${esc(roomName(room))} · ${esc(alert.titulo)}</small></div><div class="d-flex align-items-center gap-2"><span class="badge risk-badge risk-${String(risk?.codigo || '').toLowerCase()}">${esc(risk?.codigo || 'Sin nivel')}</span><button class="btn btn-sm btn-outline-primary" data-alert-id="${alert.alerta_id}">Ver alerta</button></div></article>`; }).join('') : '<p class="students-message mb-0">No tienes alertas activas en esta institución.</p>';
  }

  async function load(force = false) {
    try { render(await window.previEduTeacherScope.load(force)); }
    catch (error) { console.error('[Dashboard Docente] No se pudo cargar:', error.cause || error); $('#teacher-dashboard-rooms').innerHTML = '<p class="students-message">No se pudo cargar el resumen de tus aulas.</p>'; }
  }
  function show(event) { event?.preventDefault(); document.querySelectorAll('main .container-xl > section').forEach((section) => section.classList.add('d-none')); $('#dashboard-teacher').classList.remove('d-none'); $('#dashboard-title').textContent = 'Dashboard'; $('#dashboard-subtitle').textContent = 'Resumen de tus actividades académicas y estudiantes asignados.'; menu.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item === link)); load(); }
  link.onclick = show;
  $('#dashboard-teacher').onclick = (event) => { const target = event.target.closest('[data-teacher-go]'); const room = event.target.closest('[data-room-id]'); const alert = event.target.closest('[data-alert-id]'); if (target) go(target.dataset.teacherGo); if (room) go('Aulas', { aulaId: Number(room.dataset.roomId) }); if (alert) go('Alertas', { alertaId: Number(alert.dataset.alertId) }); };
  window.addEventListener('previ:institution-change', () => { window.previEduTeacherScope.invalidate(); show(); });
  show();
})();
