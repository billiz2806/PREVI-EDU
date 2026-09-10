'use strict';

(() => {
  const db = window.supabaseClient;
  const sessionUser = window.previEduCurrentUser;
  const selector = document.querySelector('#institution-selector');
  const switcher = document.querySelector('#institution-switcher');
  const PREFERENCE_KEY = 'previEduInstitutionId';

  function check(response, message) {
    if (response.error) throw new Error(message, { cause: response.error });
    return response.data;
  }

  function isActive(value) {
    return value === true || String(value).toUpperCase() === 'ACTIVO';
  }

  function showBlockingMessage(message) {
    document.querySelectorAll('.page-body > .container-xl > :not(.institution-context-error)')
      .forEach((element) => element.classList.add('d-none'));
    const container = document.querySelector('.page-body > .container-xl');
    const alert = document.createElement('div');
    alert.className = 'alert alert-warning institution-context-error mt-4';
    alert.setAttribute('role', 'alert');
    alert.innerHTML = `<div class="d-flex gap-3"><i class="ti ti-building-off fs-2" aria-hidden="true"></i><div><strong>${message}</strong><div class="text-secondary mt-1">Contacte al administrador del sistema.</div></div></div>`;
    container.append(alert);
    selector.replaceChildren(new Option('Instituci\u00f3n no disponible', ''));
    selector.disabled = true;
  }

  async function resolveUser() {
    const user = check(await db.from('usuario')
      .select('usuario_id,nombre_usuario,nombres,apellidos,rol,estado')
      .eq('nombre_usuario', sessionUser.username)
      .maybeSingle(), 'No se pudo resolver el usuario actual.');
    if (user || sessionUser.role !== 'ADMINISTRADOR') return user;
    return check(await db.from('usuario')
      .select('usuario_id,nombre_usuario,nombres,apellidos,rol,estado')
      .eq('rol', 'ADMINISTRADOR')
      .eq('estado', true)
      .order('usuario_id')
      .limit(1)
      .maybeSingle(), 'No se pudo resolver el usuario Administrador.');
  }

  async function resolveDirector(user) {
    const director = check(await db.from('director')
      .select('director_id,usuario_id,institucion_id,estado')
      .eq('usuario_id', user.usuario_id)
      .maybeSingle(), 'No se pudo consultar la asignaci\u00f3n del Director.');
    if (!director) throw Object.assign(new Error('Director sin instituci\u00f3n.'), { friendly: 'No se encontr\u00f3 una instituci\u00f3n asignada para este Director.' });
    if (!isActive(director.estado)) throw Object.assign(new Error('Director inactivo.'), { friendly: 'El acceso del Director a la instituci\u00f3n se encuentra inactivo.' });
    const institution = check(await db.from('institucion_educativa')
      .select('institucion_id,nombre,codigo_modular,gestion,dre,ugel,departamento,provincia,distrito,direccion,estado')
      .eq('institucion_id', director.institucion_id)
      .maybeSingle(), 'No se pudo consultar la instituci\u00f3n asignada.');
    if (!institution) throw Object.assign(new Error('Instituci\u00f3n inexistente.'), { friendly: 'No se encontr\u00f3 la instituci\u00f3n asignada para este Director.' });
    if (!isActive(institution.estado)) throw Object.assign(new Error('Instituci\u00f3n inactiva.'), { friendly: 'La instituci\u00f3n asignada se encuentra inactiva.' });
    return { director, institutions: [institution], institution };
  }

  async function resolveTeacher(user) {
    const teacher = check(await db.from('docente').select('docente_id,usuario_id,estado').eq('usuario_id', user.usuario_id).maybeSingle(), 'No se pudo resolver el docente.');
    if (!teacher) return { teacher: null, institutions: [], institution: null };
    const assignments = check(await db.from('docente_aula_area')
      .select('aula_area_curricular!inner(aula!inner(anio_escolar!inner(institucion_educativa!inner(institucion_id,nombre,codigo_modular,estado))))')
      .eq('docente_id', teacher.docente_id).eq('estado', true)
      .eq('aula_area_curricular.estado', true), 'No se pudieron consultar las instituciones del docente.') || [];
    const unique = new Map();
    assignments.forEach((row) => {
      const institution = row.aula_area_curricular?.aula?.anio_escolar?.institucion_educativa;
      if (institution && isActive(institution.estado)) unique.set(String(institution.institucion_id), institution);
    });
    const institutions = [...unique.values()];
    const preferred = sessionStorage.getItem(PREFERENCE_KEY);
    return { teacher, institutions, institution: institutions.find((item) => String(item.institucion_id) === preferred) || institutions[0] || null };
  }

  async function loadScope(institutionId) {
    const years = check(await db.from('anio_escolar').select('anio_escolar_id').eq('institucion_id', institutionId), 'No se pudo cargar el contexto de a\u00f1os escolares.') || [];
    const yearIds = years.map((row) => row.anio_escolar_id);
    const rooms = yearIds.length ? check(await db.from('aula').select('aula_id').in('anio_escolar_id', yearIds), 'No se pudo cargar el contexto de aulas.') || [] : [];
    const classroomIds = rooms.map((row) => row.aula_id);
    const enrollments = classroomIds.length ? check(await db.from('matricula').select('matricula_id').in('aula_id', classroomIds), 'No se pudo cargar el contexto de matr\u00edculas.') || [] : [];
    const enrollmentIds = enrollments.map((row) => row.matricula_id);
    const analyses = enrollmentIds.length ? check(await db.from('analisis_riesgo').select('analisis_riesgo_id').in('matricula_id', enrollmentIds), 'No se pudo cargar el contexto de an\u00e1lisis.') || [] : [];
    const analysisIds = analyses.map((row) => row.analisis_riesgo_id);
    const alerts = analysisIds.length ? check(await db.from('alerta').select('alerta_id').in('analisis_riesgo_id', analysisIds), 'No se pudo cargar el contexto de alertas.') || [] : [];
    return { yearIds, classroomIds, enrollmentIds, analysisIds, alertIds: alerts.map((row) => row.alerta_id) };
  }

  function renderSelector(context) {
    selector.replaceChildren(...context.availableInstitutions.map((item) => new Option(item.nombre, item.institucion_id, false, item.institucion_id === context.currentInstitution?.institucion_id)));
    selector.disabled = context.currentRole === 'DIRECTOR' || context.availableInstitutions.length < 2;
    selector.title = context.currentInstitution?.nombre || 'Instituci\u00f3n actual';
    switcher.classList.toggle('d-none', !context.currentInstitution);
  }

  async function initialize() {
    if (!db || !sessionUser) return null;
    try {
      const user = await resolveUser() || (sessionUser.role === 'ADMINISTRADOR' ? {
        usuario_id: null,
        nombre_usuario: sessionUser.username,
        nombres: sessionUser.name,
        apellidos: '',
        rol: 'ADMINISTRADOR',
        estado: true
      } : null);
      if (!user) throw Object.assign(new Error('Usuario no encontrado.'), { friendly: 'No se pudo identificar al usuario actual.' });
      if (sessionUser.role === 'ADMINISTRADOR' || sessionUser.role === 'USUARIO') {
        const context = {
          currentUser: user,
          currentRole: sessionUser.role,
          currentDirector: null,
          currentTeacher: null,
          currentInstitution: null,
          availableInstitutions: [],
          scope: { yearIds: [], classroomIds: [], enrollmentIds: [], analysisIds: [], alertIds: [] }
        };
        window.appContext = context;
        switcher.classList.add('d-none');
        if (sessionUser.role === 'USUARIO') {
          const container = document.querySelector('.page-body > .container-xl');
          container.insertAdjacentHTML('beforeend', '<div class="alert alert-info mt-4"><strong>Tu cuenta está registrada correctamente, pero todavía no tienes un perfil asignado en PREVI-EDU.</strong><div class="text-secondary mt-1">Contacta al responsable de tu institución para completar la asignación.</div></div>');
        }
        return context;
      }
      const resolved = sessionUser.role === 'DIRECTOR' ? await resolveDirector(user) : await resolveTeacher(user);
      if (!resolved.institution) throw Object.assign(new Error('Sin instituci\u00f3n disponible.'), { friendly: 'No se encontr\u00f3 una instituci\u00f3n disponible para el usuario.' });
      const context = {
        currentUser: user,
        currentRole: sessionUser.role,
        currentDirector: resolved.director || null,
        currentTeacher: resolved.teacher || null,
        currentInstitution: resolved.institution,
        availableInstitutions: resolved.institutions,
        scope: await loadScope(resolved.institution.institucion_id)
      };
      window.appContext = context;
      renderSelector(context);
      selector.addEventListener('change', async () => {
        if (context.currentRole !== 'DOCENTE') return;
        const institution = context.availableInstitutions.find((item) => String(item.institucion_id) === selector.value);
        if (!institution) return;
        context.currentInstitution = institution;
        context.scope = await loadScope(institution.institucion_id);
        sessionStorage.setItem(PREFERENCE_KEY, String(institution.institucion_id));
        window.dispatchEvent(new CustomEvent('previ:institution-change', { detail: { institution } }));
      });
      return context;
    } catch (error) {
      console.error('[Contexto institucional] No se pudo cargar el contexto:', error.cause || error);
      window.appContext = null;
      showBlockingMessage(error.friendly || 'No se pudo cargar el contexto institucional.');
      return null;
    }
  }

  window.clearPreviEduContext = () => {
    window.appContext = null;
    sessionStorage.removeItem(PREFERENCE_KEY);
  };
  window.previEduContextReady = initialize();
})();
