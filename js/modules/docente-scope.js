'use strict';

(() => {
  if (window.previEduTeacherScope) return;
  const db = window.supabaseClient;
  let cache = null;

  const one = (value) => Array.isArray(value) ? value[0] : value;
  const check = (response, message) => {
    if (response.error) throw new Error(message, { cause: response.error });
    return response.data || [];
  };
  const active = (value) => value === true || String(value).toUpperCase() === 'ACTIVO';

  function assignmentParts(assignment) {
    const roomArea = one(assignment.aula_area_curricular);
    const classroom = one(roomArea?.aula);
    const grade = one(classroom?.grado);
    const section = one(classroom?.seccion);
    const level = one(grade?.nivel_educativo);
    const year = one(classroom?.anio_escolar);
    const area = one(one(roomArea?.area_curricular_nivel)?.area_curricular);
    return { roomArea, classroom, grade, section, level, year, area };
  }

  async function load(force = false) {
    const context = window.appContext;
    const teacherId = context?.currentTeacher?.docente_id;
    const institutionId = context?.currentInstitution?.institucion_id;
    const key = `${teacherId || ''}:${institutionId || ''}`;
    if (!teacherId || !institutionId) throw new Error('No se pudo identificar el contexto del docente.');
    if (!force && cache?.key === key) return cache.value;

    const years = check(await db.from('anio_escolar').select('anio_escolar_id,institucion_id,anio,fecha_inicio,fecha_fin,estado').eq('institucion_id', institutionId).order('anio', { ascending: false }), 'No se pudieron consultar los años escolares.');
    const currentCalendarYear = new Date().getFullYear();
    const academicYear = years.find((item) => active(item.estado) && Number(item.anio) === currentCalendarYear) || years.find((item) => active(item.estado)) || years[0] || null;
    const yearIds = new Set(years.map((item) => String(item.anio_escolar_id)));
    const assignmentSelect = 'docente_aula_area_id,docente_id,aula_area_curricular_id,estado,aula_area_curricular(aula_area_curricular_id,aula_id,estado,aula(aula_id,anio_escolar_id,grado_id,seccion_id,estado,anio_escolar(anio_escolar_id,institucion_id,anio,estado),grado(grado_id,nivel_id,nombre,orden,estado,nivel_educativo(nivel_id,nombre,estado)),seccion(seccion_id,nombre,estado)),area_curricular_nivel(area_curricular_nivel_id,estado,area_curricular(area_curricular_id,nombre,estado)))';
    const allAssignments = check(await db.from('docente_aula_area').select(assignmentSelect).eq('docente_id', teacherId).eq('estado', true), 'No se pudieron consultar las asignaciones del docente.');
    const assignments = allAssignments.filter((item) => {
      const part = assignmentParts(item);
      return active(part.roomArea?.estado) && active(part.classroom?.estado) && yearIds.has(String(part.classroom?.anio_escolar_id));
    });
    const yearAssignments = academicYear ? assignments.filter((item) => String(assignmentParts(item).classroom?.anio_escolar_id) === String(academicYear.anio_escolar_id)) : [];
    const classroomIds = [...new Set(yearAssignments.map((item) => assignmentParts(item).classroom?.aula_id).filter(Boolean))];

    const [enrollments, tutorings] = classroomIds.length ? await Promise.all([
      db.from('matricula').select('matricula_id,estudiante_id,aula_id,estado,estudiante(estudiante_id,codigo,nombres,apellido_paterno,apellido_materno,estado)').in('aula_id', classroomIds),
      db.from('docente_tutoria').select('docente_tutoria_id,docente_id,aula_id,estado,docente(docente_id,usuario(nombres,apellidos))').in('aula_id', classroomIds).eq('estado', true)
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    const enrollmentRows = check(enrollments, 'No se pudieron consultar los estudiantes del docente.').filter((item) => active(item.estado));
    const tutoringRows = check(tutorings, 'No se pudieron consultar los tutores de las aulas.');
    const enrollmentIds = enrollmentRows.map((item) => item.matricula_id);
    const analyses = enrollmentIds.length ? check(await db.from('analisis_riesgo').select('analisis_riesgo_id,matricula_id,fecha_analisis,nivel_riesgo(codigo,nombre),alerta(alerta_id,titulo,descripcion,fecha_generacion,estado_alerta(codigo,nombre))').in('matricula_id', enrollmentIds), 'No se pudieron consultar las alertas del docente.') : [];

    const grouped = new Map();
    yearAssignments.forEach((assignment) => {
      const part = assignmentParts(assignment);
      const id = part.classroom.aula_id;
      if (!grouped.has(id)) grouped.set(id, { classroom: part.classroom, grade: part.grade, section: part.section, level: part.level, year: part.year, areas: [], assignments: [] });
      const group = grouped.get(id);
      group.assignments.push(assignment);
      if (part.area && !group.areas.some((area) => area.area_curricular_id === part.area.area_curricular_id)) group.areas.push(part.area);
    });
    const classrooms = [...grouped.values()].map((group) => ({
      ...group,
      enrollments: enrollmentRows.filter((item) => item.aula_id === group.classroom.aula_id),
      tutoring: tutoringRows.find((item) => item.aula_id === group.classroom.aula_id) || null
    })).sort((left, right) => (left.grade?.orden || 0) - (right.grade?.orden || 0) || String(left.section?.nombre || '').localeCompare(String(right.section?.nombre || '')));
    const enrollmentById = new Map(enrollmentRows.map((item) => [item.matricula_id, item]));
    const alertsById = new Map();
    analyses.forEach((analysis) => (analysis.alerta || []).filter((alert) => ['NUEVA', 'SEGUIMIENTO'].includes(one(alert.estado_alerta)?.codigo)).forEach((alert) => alertsById.set(alert.alerta_id, { ...alert, analysis, enrollment: enrollmentById.get(analysis.matricula_id) })));
    const activeAlerts = [...alertsById.values()].sort((a, b) => String(b.fecha_generacion || '').localeCompare(String(a.fecha_generacion || '')));
    const value = { teacherId, institutionId, years, academicYear, assignments: yearAssignments, classrooms, enrollments: enrollmentRows, analyses, activeAlerts };
    cache = { key, value };
    return value;
  }

  function invalidate() { cache = null; }
  window.addEventListener('previ:institution-change', invalidate);
  window.addEventListener('previ:academic-year-change', invalidate);
  window.previEduTeacherScope = { load, invalidate, assignmentParts };
})();
