'use strict';

(() => {
  const currentUser = window.previEduCurrentUser;
  if (!currentUser || currentUser.role !== 'DIRECTOR') return;

  const db = window.supabaseClient;
  const menu = document.querySelector('#main-menu');
  const view = document.querySelector('#teachers-view');
  const title = document.querySelector('#dashboard-title');
  const subtitle = document.querySelector('#dashboard-subtitle');
  const teachersLink = [...menu.querySelectorAll('.nav-link')].find((link) => link.textContent.trim() === 'Docentes');
  const tabs = [...document.querySelectorAll('[data-teachers-tab]')];
  if (!teachersLink || !view) return;

  const recordModal = new window.tabler.Modal(document.querySelector('#teacher-record-modal'));
  const profileModal = new window.tabler.Modal(document.querySelector('#teacher-profile-modal'));
  const assignmentModal = new window.tabler.Modal(document.querySelector('#teacher-assignment-modal'));
  const state = { teachers: [], assignments: [], years: [], levels: [], grades: [], sections: [], classrooms: [], classroomAreas: [], editing: null, loaded: false };
  document.querySelector('#teacher-record-form .modal-body').insertAdjacentHTML('afterbegin', '<div class="mb-3 d-none" id="teacher-user-selector-wrap"><label class="form-label">Usuario registrado *</label><select class="form-select" name="usuario_id"></select><div class="form-hint">Puede seleccionar un usuario que también sea Director.</div></div>');
  const relation = (value) => Array.isArray(value) ? value[0] : value;
  const value = (item, fallback = 'No registrado') => item === null || item === undefined || item === '' ? fallback : String(item);
  const normalize = (item) => value(item, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const escapeHtml = (item) => value(item).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const teacherName = (teacher) => { const user = relation(teacher?.usuario); return [user?.nombres, user?.apellidos].filter(Boolean).join(' ') || 'No registrado'; };
  const data = (response, context) => { if (response.error) throw new Error(context, { cause: response.error }); return response.data; };
  const logError = (context, error) => console.error(`[Docentes] ${context}`, error.cause || error);

  function feedback(message, success = true) {
    const alert = document.querySelector('#teachers-feedback'); alert.textContent = message; alert.className = `alert students-feedback ${success ? 'alert-success' : 'alert-danger'}`; alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setActiveMenu(active) { menu.querySelectorAll('.nav-link').forEach((link) => { link.classList.toggle('active', link === active); if (link === active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }); }
  function hideOtherViews() { ['#dashboard-director', '#institution-view', '#academic-management-view', '#students-view'].forEach((selector) => document.querySelector(selector)?.classList.add('d-none')); }
  function showTeachers(event) { event.preventDefault(); hideOtherViews(); view.classList.remove('d-none'); title.textContent = 'DOCENTES'; subtitle.textContent = 'Gestione los docentes y sus asignaciones académicas'; setActiveMenu(teachersLink); activateTab('registered'); if (!state.loaded) initialize(); }
  function hideTeachers() { view.classList.add('d-none'); }
  function activateTab(name) { tabs.forEach((tab) => { const active = tab.dataset.teachersTab === name; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); }); document.querySelectorAll('.teachers-pane').forEach((pane) => pane.classList.toggle('d-none', pane.id !== `teachers-pane-${name}`)); }

  function fill(select, rows, placeholder, key, label, selected = '') { select.replaceChildren(new Option(placeholder, '')); rows.forEach((row) => select.add(new Option(label(row), row[key], false, String(row[key]) === String(selected)))); select.disabled = false; }
  function badge(text, inactive = false) { const element = document.createElement('span'); element.className = `badge teacher-status${inactive ? ' is-inactive' : ''}`; element.textContent = value(text); return element; }
  function button(label, handler, secondary = false) { const element = document.createElement('button'); element.type = 'button'; element.className = `btn btn-sm ${secondary ? 'btn-outline-secondary' : 'btn-outline-primary'}`; element.textContent = label; element.addEventListener('click', handler); return element; }
  function assignmentParts(item) { const classroomArea = relation(item.aula_area_curricular); const classroom = relation(classroomArea?.aula); const grade = relation(classroom?.grado); const level = relation(grade?.nivel_educativo) || relation(relation(classroomArea?.area_curricular_nivel)?.nivel_educativo); const section = relation(classroom?.seccion); const year = relation(classroom?.anio_escolar); const area = relation(relation(classroomArea?.area_curricular_nivel)?.area_curricular); return { classroomArea, classroom, grade, level, section, year, area }; }

  async function loadAll() {
    const teacherSelect = 'docente_id,usuario_id,codigo,dni,telefono,estado,usuario(usuario_id,nombre_usuario,nombres,apellidos,correo,rol,estado)';
    const assignmentSelect = 'docente_aula_area_id,docente_id,aula_area_curricular_id,estado,docente(docente_id,codigo,estado,usuario(nombre_usuario,nombres,apellidos,correo,estado)),aula_area_curricular(aula_area_curricular_id,aula_id,estado,aula(aula_id,anio_escolar_id,grado_id,seccion_id,estado,anio_escolar(anio_escolar_id,anio,estado),grado(grado_id,nivel_id,nombre,orden,estado,nivel_educativo(nivel_id,nombre,estado)),seccion(seccion_id,nombre,estado)),area_curricular_nivel(area_curricular_nivel_id,nivel_id,estado,nivel_educativo(nivel_id,nombre),area_curricular(area_curricular_id,nombre,estado)))';
    const responses = await Promise.all([
      db.from('docente').select(teacherSelect).order('codigo'), db.from('docente_aula_area').select(assignmentSelect).order('docente_aula_area_id'),
      db.from('anio_escolar').select('anio_escolar_id,anio,estado').eq('institucion_id', window.appContext.currentInstitution.institucion_id).order('anio', { ascending: false }), db.from('nivel_educativo').select('nivel_id,nombre,estado').order('nombre'),
      db.from('grado').select('grado_id,nivel_id,nombre,orden,estado').order('orden'), db.from('seccion').select('seccion_id,nombre,estado').order('nombre'), db.from('aula').select('aula_id,anio_escolar_id,grado_id,seccion_id,estado').in('anio_escolar_id', window.appContext.scope.yearIds),
      db.from('aula_area_curricular').select('aula_area_curricular_id,aula_id,area_curricular_nivel_id,estado,area_curricular_nivel(area_curricular_nivel_id,nivel_id,estado,area_curricular(area_curricular_id,nombre,estado))').in('aula_id', window.appContext.scope.classroomIds)
    ]);
    state.teachers = data(responses[0], 'No se pudieron consultar los docentes.') || []; state.assignments = (data(responses[1], 'No se pudieron consultar las asignaciones.') || []).filter((item) => window.appContext.scope.classroomIds.includes(assignmentParts(item).classroom?.aula_id)); state.years = data(responses[2], 'No se pudieron consultar los años.') || []; state.levels = data(responses[3], 'No se pudieron consultar los niveles.') || []; state.grades = data(responses[4], 'No se pudieron consultar los grados.') || []; state.sections = data(responses[5], 'No se pudieron consultar las secciones.') || []; state.classrooms = data(responses[6], 'No se pudieron consultar las aulas.') || []; state.classroomAreas = data(responses[7], 'No se pudieron consultar las áreas por aula.') || [];
    state.loaded = true; configureAreaFilter(); renderTeachers(); renderPending(); renderAssignments();
  }

  function configureAreaFilter() { const areas = new Map(); state.assignments.forEach((assignment) => { const area = assignmentParts(assignment).area; if (area) areas.set(area.area_curricular_id, area); }); fill(document.querySelector('#teachers-area-filter'), [...areas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)), 'Todas las áreas', 'area_curricular_id', (area) => area.nombre); }
  function activeAssignments(teacherId) { return state.assignments.filter((item) => item.docente_id === teacherId && item.estado); }

  function renderTeachers() {
    const query = normalize(document.querySelector('#teachers-search').value); const status = document.querySelector('#teachers-status-filter').value; const areaId = document.querySelector('#teachers-area-filter').value;
    const rows = state.teachers.filter((teacher) => { const user = relation(teacher.usuario); const searchable = normalize([teacher.codigo, user?.nombres, user?.apellidos, user?.nombre_usuario].join(' ')); const hasArea = !areaId || activeAssignments(teacher.docente_id).some((assignment) => String(assignmentParts(assignment).area?.area_curricular_id) === areaId); return (!query || searchable.includes(query)) && (!status || teacher.estado === status) && hasArea; });
    const body = document.querySelector('#teachers-table-body'); const wrapper = document.querySelector('#teachers-table-wrapper'); const empty = document.querySelector('#teachers-empty'); body.replaceChildren(); document.querySelector('#teachers-counter').textContent = `${state.teachers.length} docentes registrados`;
    rows.forEach((teacher) => { const user = relation(teacher.usuario); const row = document.createElement('tr'); [teacher.codigo, teacherName(teacher), user?.nombre_usuario, user?.correo].forEach((text) => { const cell = document.createElement('td'); cell.textContent = value(text); row.appendChild(cell); }); const statusCell = document.createElement('td'); statusCell.appendChild(badge(teacher.estado, teacher.estado !== 'ACTIVO')); row.appendChild(statusCell); const count = document.createElement('td'); count.textContent = String(activeAssignments(teacher.docente_id).length); row.appendChild(count); const actions = document.createElement('td'); const group = document.createElement('div'); group.className = 'academic-inline-actions'; group.append(button('Ver', () => showProfile(teacher)), button('Editar', () => openTeacherForm(teacher), true)); actions.appendChild(group); row.appendChild(actions); body.appendChild(row); });
    wrapper.classList.toggle('d-none', !rows.length); empty.classList.toggle('d-none', rows.length > 0);
  }

  function renderPending() {
    const pending = state.teachers.filter((teacher) => teacher.estado === 'PENDIENTE'); const body = document.querySelector('#pending-teachers-body'); body.replaceChildren(); document.querySelector('#pending-teachers-count').textContent = pending.length;
    pending.forEach((teacher) => { const user = relation(teacher.usuario); const row = document.createElement('tr'); [teacher.codigo, teacherName(teacher), user?.nombre_usuario, user?.correo].forEach((text) => { const cell = document.createElement('td'); cell.textContent = value(text); row.appendChild(cell); }); const statusCell = document.createElement('td'); statusCell.appendChild(badge('PENDIENTE', true)); row.appendChild(statusCell); const action = document.createElement('td'); action.appendChild(button('Activar docente', () => activateTeacher(teacher))); row.appendChild(action); body.appendChild(row); });
    document.querySelector('#pending-teachers-table').classList.toggle('d-none', !pending.length); document.querySelector('#pending-teachers-empty').classList.toggle('d-none', pending.length > 0);
  }

  function renderAssignments() {
    const body = document.querySelector('#teacher-assignments-body'); body.replaceChildren();
    state.assignments.forEach((assignment) => { const teacher = relation(assignment.docente); const { year, level, grade, section, area } = assignmentParts(assignment); const row = document.createElement('tr'); [teacherName(teacher), year?.anio, level?.nombre, grade?.nombre, section?.nombre, area?.nombre].forEach((text) => { const cell = document.createElement('td'); cell.textContent = value(text); row.appendChild(cell); }); const status = document.createElement('td'); status.appendChild(badge(assignment.estado ? 'ACTIVA' : 'INACTIVA', !assignment.estado)); row.appendChild(status); const action = document.createElement('td'); action.appendChild(button(assignment.estado ? 'Inactivar' : 'Reactivar', () => toggleAssignment(assignment), true)); row.appendChild(action); body.appendChild(row); });
    document.querySelector('#teacher-assignments-table').classList.toggle('d-none', !state.assignments.length); document.querySelector('#teacher-assignments-empty').classList.toggle('d-none', state.assignments.length > 0);
  }

  function showProfile(teacher) {
    const user = relation(teacher.usuario); const assignments = state.assignments.filter((item) => item.docente_id === teacher.docente_id); const assignmentsHtml = assignments.length ? `<div class="table-responsive"><table class="table table-vcenter teachers-table"><thead><tr><th>Año</th><th>Nivel</th><th>Grado</th><th>Sección</th><th>Área</th><th>Estado</th></tr></thead><tbody>${assignments.map((item) => { const part = assignmentParts(item); return `<tr><td>${escapeHtml(part.year?.anio)}</td><td>${escapeHtml(part.level?.nombre)}</td><td>${escapeHtml(part.grade?.nombre)}</td><td>${escapeHtml(part.section?.nombre)}</td><td>${escapeHtml(part.area?.nombre)}</td><td><span class="badge teacher-status ${item.estado ? '' : 'is-inactive'}">${item.estado ? 'ACTIVA' : 'INACTIVA'}</span></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="students-message">No tiene asignaciones académicas registradas.</p>';
    document.querySelector('#teacher-profile-content').innerHTML = `<div class="profile-summary teacher-summary"><div><span>Docente</span><strong>${escapeHtml(teacherName(teacher))}</strong></div><div><span>Código</span><strong>${escapeHtml(teacher.codigo)}</strong></div><div><span>Usuario</span><strong>${escapeHtml(user?.nombre_usuario)}</strong></div><div><span>Estado</span><strong>${escapeHtml(teacher.estado)}</strong></div></div><section class="profile-card"><h3>Datos personales</h3><dl><div><dt>Código</dt><dd>${escapeHtml(teacher.codigo)}</dd></div><div><dt>Nombres</dt><dd>${escapeHtml(user?.nombres)}</dd></div><div><dt>Apellidos</dt><dd>${escapeHtml(user?.apellidos)}</dd></div><div><dt>Usuario</dt><dd>${escapeHtml(user?.nombre_usuario)}</dd></div><div><dt>Correo</dt><dd>${escapeHtml(user?.correo)}</dd></div><div><dt>DNI</dt><dd>${escapeHtml(teacher.dni)}</dd></div><div><dt>Teléfono</dt><dd>${escapeHtml(teacher.telefono)}</dd></div><div><dt>Estado</dt><dd>${escapeHtml(teacher.estado)}</dd></div></dl></section><section class="profile-card"><h3>Asignaciones actuales</h3>${assignmentsHtml}</section>`; profileModal.show();
  }

  async function duplicate(table, column, fieldValue, exclude) { if (!fieldValue) return false; let query = db.from(table).select('*', { count: 'exact', head: true }).eq(column, fieldValue); if (exclude) query = query.neq(exclude.column, exclude.value); const response = await query; if (response.error) throw new Error('No se pudieron validar duplicados.', { cause: response.error }); return response.count > 0; }

  async function openTeacherForm(teacher = null) {
    state.editing = teacher; const form = document.querySelector('#teacher-record-form'); form.reset(); form.classList.remove('was-validated'); const user = relation(teacher?.usuario); document.querySelector('#teacher-record-title').textContent = teacher ? 'Editar docente' : 'Registrar docente';
    const selectorWrap=document.querySelector('#teacher-user-selector-wrap'); selectorWrap.classList.toggle('d-none',Boolean(teacher)); const identity=['nombre_usuario','nombres','apellidos','correo','usuario_estado']; identity.forEach((name)=>{const field=form.elements[name];field.disabled=!teacher;field.closest('.col-md-4, .col-md-6')?.classList.toggle('d-none',!teacher);});
    if(!teacher){const users=data(await db.from('usuario').select('usuario_id,nombres,apellidos,correo,estado').eq('estado',true).order('nombres'),'No se pudieron consultar los usuarios.')||[];const assigned=new Set(state.teachers.map(item=>item.usuario_id));fill(form.elements.usuario_id,users.filter(item=>!assigned.has(item.usuario_id)),'Seleccione un usuario','usuario_id',(item)=>`${item.nombres||''} ${item.apellidos||''} — ${item.correo||'Sin correo'}`);form.elements.usuario_id.required=true;}else form.elements.usuario_id.required=false;
    ['nombre_usuario', 'nombres', 'apellidos', 'correo'].forEach((name) => { form.elements[name].value = user?.[name] || ''; }); ['codigo', 'dni', 'telefono'].forEach((name) => { form.elements[name].value = teacher?.[name] || ''; }); form.elements.usuario_estado.value = String(user?.estado ?? true); form.elements.docente_estado.value = teacher?.estado || 'PENDIENTE'; form.elements.docente_estado.disabled = !teacher; recordModal.show();
  }

  async function saveTeacher(event) {
    event.preventDefault(); const form = event.currentTarget; if (!form.checkValidity()) { form.classList.add('was-validated'); return; } const values = new FormData(form); const user = relation(state.editing?.usuario); const code = values.get('codigo').trim(); const dni = values.get('dni').trim() || null; const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = 'Guardando información...';
    try {
      if (await duplicate('docente', 'codigo', code, state.editing && { column: 'docente_id', value: state.editing.docente_id })) { feedback('Ya existe un docente con este código.', false); return; }
      if (dni && await duplicate('docente', 'dni', dni, state.editing && { column: 'docente_id', value: state.editing.docente_id })) { feedback('Ya existe un docente con este DNI.', false); return; }
      const teacherPayload = { codigo: code, dni, telefono: values.get('telefono').trim() || null, estado: values.get('docente_estado') };
      if (state.editing) { data(await db.from('docente').update(teacherPayload).eq('docente_id', state.editing.docente_id), 'No se pudo actualizar el docente.'); }
      else { const userId=Number(values.get('usuario_id')); if(state.teachers.some((item)=>item.usuario_id===userId))throw new Error('El usuario ya tiene un perfil docente.'); data(await db.from('docente').insert({ usuario_id:userId, ...teacherPayload, estado: 'PENDIENTE' }), 'No se pudo registrar el docente.'); }
      recordModal.hide(); feedback(state.editing ? 'Información del docente actualizada correctamente.' : 'Docente registrado correctamente.'); await loadAll();
    } catch (error) { logError('Error al guardar docente.', error); feedback('No se pudo guardar la información.', false); }
    finally { submit.disabled = false; submit.textContent = 'Guardar información'; }
  }

  async function activateTeacher(teacher) { try { data(await db.from('docente').update({ estado: 'ACTIVO' }).eq('docente_id', teacher.docente_id), 'No se pudo activar el docente.'); data(await db.from('usuario').update({ estado: true }).eq('usuario_id', teacher.usuario_id), 'No se pudo activar el usuario.'); feedback('Docente activado correctamente.'); await loadAll(); } catch (error) { logError('Error al activar docente.', error); feedback('No se pudo guardar la información.', false); } }

  function openAssignment() {
    const form = document.querySelector('#teacher-assignment-form'); form.reset(); form.classList.remove('was-validated'); fill(form.elements.docente_id, state.teachers.filter((item) => item.estado === 'ACTIVO'), 'Seleccione un docente', 'docente_id', teacherName); const activeYear = state.years.find((item) => item.estado); fill(form.elements.anio_escolar_id, state.years.filter((item) => item.estado), 'Seleccione un año', 'anio_escolar_id', (item) => item.anio, activeYear?.anio_escolar_id); fill(form.elements.nivel_id, state.levels.filter((item) => item.estado), 'Seleccione un nivel', 'nivel_id', (item) => item.nombre); form.elements.grado_id.replaceChildren(new Option('Seleccione un grado', '')); form.elements.aula_id.replaceChildren(new Option('Seleccione un aula', '')); form.elements.aula_area_curricular_id.replaceChildren(new Option('Seleccione un área', '')); form.elements.grado_id.disabled = true; form.elements.aula_id.disabled = true; form.elements.aula_area_curricular_id.disabled = true; hideRule(); assignmentModal.show();
  }

  function assignmentGrades() { const form = document.querySelector('#teacher-assignment-form'); const rows = state.grades.filter((item) => item.estado && String(item.nivel_id) === form.elements.nivel_id.value); fill(form.elements.grado_id, rows, 'Seleccione un grado', 'grado_id', (item) => item.nombre); form.elements.grado_id.disabled = !form.elements.nivel_id.value; form.elements.aula_id.replaceChildren(new Option('Seleccione un aula', '')); form.elements.aula_id.disabled = true; form.elements.aula_area_curricular_id.replaceChildren(new Option('Seleccione un área', '')); form.elements.aula_area_curricular_id.disabled = true; hideRule(); }
  function assignmentClassrooms() { const form = document.querySelector('#teacher-assignment-form'); const rows = state.classrooms.filter((item) => item.estado && String(item.anio_escolar_id) === form.elements.anio_escolar_id.value && String(item.grado_id) === form.elements.grado_id.value); fill(form.elements.aula_id, rows, 'Seleccione un aula', 'aula_id', (item) => { const grade = state.grades.find((row) => row.grado_id === item.grado_id); const section = state.sections.find((row) => row.seccion_id === item.seccion_id); return `${grade?.nombre || ''} ${section?.nombre || ''}`.trim(); }); form.elements.aula_id.disabled = !(form.elements.anio_escolar_id.value && form.elements.grado_id.value); form.elements.aula_area_curricular_id.disabled = true; hideRule(); }
  function assignmentAreas() { const form = document.querySelector('#teacher-assignment-form'); const rows = state.classroomAreas.filter((item) => item.estado && String(item.aula_id) === form.elements.aula_id.value && relation(item.area_curricular_nivel)?.estado && relation(relation(item.area_curricular_nivel)?.area_curricular)?.estado); fill(form.elements.aula_area_curricular_id, rows, 'Seleccione un área', 'aula_area_curricular_id', (item) => value(relation(relation(item.area_curricular_nivel)?.area_curricular)?.nombre)); form.elements.aula_area_curricular_id.disabled = !form.elements.aula_id.value; checkSecondaryRule(); }
  function hideRule() { const message = document.querySelector('#teacher-assignment-rule'); message.classList.add('d-none'); message.textContent = ''; }

  function selectedContext() {
    const form = document.querySelector('#teacher-assignment-form'); const teacher = state.teachers.find((item) => String(item.docente_id) === form.elements.docente_id.value); const classroom = state.classrooms.find((item) => String(item.aula_id) === form.elements.aula_id.value); const grade = state.grades.find((item) => item.grado_id === classroom?.grado_id); const level = state.levels.find((item) => item.nivel_id === grade?.nivel_id); const section = state.sections.find((item) => item.seccion_id === classroom?.seccion_id); return { form, teacher, classroom, grade, level, section };
  }

  function activeInClassroom(teacherId, classroomId, exceptAssignmentId = null) { return state.assignments.find((item) => item.estado && item.docente_id === teacherId && assignmentParts(item).classroom?.aula_id === classroomId && item.docente_aula_area_id !== exceptAssignmentId); }
  function checkSecondaryRule() { hideRule(); const { form, teacher, classroom, grade, level, section } = selectedContext(); if (!teacher || !classroom || normalize(level?.nombre) !== 'secundaria') return null; const current = activeInClassroom(teacher.docente_id, classroom.aula_id); if (!current) return null; const area = assignmentParts(current).area; const message = document.querySelector('#teacher-assignment-rule'); message.textContent = `${teacherName(teacher)} ya tiene ${value(area?.nombre)} asignada en ${value(grade?.nombre)} ${value(section?.nombre)}.`; message.classList.remove('d-none'); return current; }

  async function validateAssignment(teacherId, classroomAreaId, reactivatingId = null) {
    const classroomArea = state.classroomAreas.find((item) => item.aula_area_curricular_id === classroomAreaId); const classroom = state.classrooms.find((item) => item.aula_id === classroomArea?.aula_id); const grade = state.grades.find((item) => item.grado_id === classroom?.grado_id); const level = state.levels.find((item) => item.nivel_id === grade?.nivel_id);
    if (normalize(level?.nombre) === 'secundaria' && activeInClassroom(teacherId, classroom.aula_id, reactivatingId)) throw new Error('SECONDARY_RULE');
  }

  async function saveAssignment(event) {
    event.preventDefault(); const form = event.currentTarget; if (!form.checkValidity()) { form.classList.add('was-validated'); return; } const teacherId = Number(form.elements.docente_id.value); const classroomAreaId = Number(form.elements.aula_area_curricular_id.value); const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = 'Guardando información...';
    try {
      const existing = state.assignments.find((item) => item.docente_id === teacherId && item.aula_area_curricular_id === classroomAreaId);
      if (existing?.estado) { feedback('El docente ya tiene esta asignación.', false); return; }
      await validateAssignment(teacherId, classroomAreaId, existing?.docente_aula_area_id);
      if (existing) data(await db.from('docente_aula_area').update({ estado: true }).eq('docente_aula_area_id', existing.docente_aula_area_id), 'No se pudo reactivar la asignación.'); else data(await db.from('docente_aula_area').insert({ docente_id: teacherId, aula_area_curricular_id: classroomAreaId, estado: true }), 'No se pudo registrar la asignación.');
      assignmentModal.hide(); feedback('Asignación registrada correctamente.'); await loadAll(); activateTab('assignments');
    } catch (error) { if (error.message === 'SECONDARY_RULE') feedback('Este docente ya tiene un área curricular asignada en esta aula de secundaria.', false); else { logError('Error al guardar asignación.', error); feedback('No se pudo guardar la información.', false); } }
    finally { submit.disabled = false; submit.textContent = 'Guardar asignación'; }
  }

  async function toggleAssignment(assignment) { try { if (!assignment.estado) await validateAssignment(assignment.docente_id, assignment.aula_area_curricular_id, assignment.docente_aula_area_id); data(await db.from('docente_aula_area').update({ estado: !assignment.estado }).eq('docente_aula_area_id', assignment.docente_aula_area_id), 'No se pudo actualizar la asignación.'); feedback('Información actualizada correctamente.'); await loadAll(); } catch (error) { if (error.message === 'SECONDARY_RULE') feedback('Este docente ya tiene un área curricular asignada en esta aula de secundaria.', false); else { logError('Error al actualizar asignación.', error); feedback('No se pudo guardar la información.', false); } } }

  async function initialize() { document.querySelector('#teachers-loading').classList.remove('d-none'); try { await loadAll(); } catch (error) { logError('Error al iniciar el módulo.', error); document.querySelector('#teachers-empty').textContent = 'No se pudo cargar la información.'; document.querySelector('#teachers-empty').classList.remove('d-none'); } finally { document.querySelector('#teachers-loading').classList.add('d-none'); } }

  teachersLink.addEventListener('click', showTeachers); [...menu.querySelectorAll('.nav-link')].filter((link) => link !== teachersLink).forEach((link) => link.addEventListener('click', hideTeachers)); tabs.forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.teachersTab)));
  document.querySelector('#teachers-search').addEventListener('input', renderTeachers); document.querySelector('#teachers-status-filter').addEventListener('change', renderTeachers); document.querySelector('#teachers-area-filter').addEventListener('change', renderTeachers); document.querySelector('#new-teacher-button').addEventListener('click', () => openTeacherForm()); document.querySelector('#teacher-record-form').addEventListener('submit', saveTeacher); document.querySelector('#new-teacher-assignment-button').addEventListener('click', openAssignment); document.querySelector('#teacher-assignment-form').addEventListener('submit', saveAssignment);
  const assignmentForm = document.querySelector('#teacher-assignment-form'); assignmentForm.elements.nivel_id.addEventListener('change', assignmentGrades); assignmentForm.elements.anio_escolar_id.addEventListener('change', assignmentClassrooms); assignmentForm.elements.grado_id.addEventListener('change', assignmentClassrooms); assignmentForm.elements.aula_id.addEventListener('change', assignmentAreas); assignmentForm.elements.docente_id.addEventListener('change', checkSecondaryRule);
})();
