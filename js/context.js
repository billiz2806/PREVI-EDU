'use strict';

(() => {
  const SESSION_KEY = 'previEduSession';
  const PREFERENCE_KEY = 'previEduInstitutionId';
  const db = window.supabaseClient;
  const sessionUser = window.previEduCurrentUser;
  const selector = document.querySelector('#institution-selector');
  const switcher = document.querySelector('#institution-switcher');

  const check = (response, message) => { if (response.error) throw new Error(message, { cause: response.error }); return response.data; };
  const isActive = (value) => value === true || String(value).toUpperCase() === 'ACTIVO';

  function saveSession(values) {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
    Object.assign(session, values);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    Object.assign(sessionUser, values);
  }

  function showBlockingMessage(message) {
    document.querySelectorAll('.page-body > .container-xl > :not(.institution-context-error)').forEach((element) => element.classList.add('d-none'));
    const container = document.querySelector('.page-body > .container-xl');
    const alert = document.createElement('div');
    alert.className = 'alert alert-warning institution-context-error mt-4';
    alert.setAttribute('role', 'alert');
    alert.innerHTML = `<div class="d-flex gap-3"><i class="ti ti-building-off fs-2" aria-hidden="true"></i><div><strong>${message}</strong><div class="text-secondary mt-1">Contacte al administrador del sistema.</div></div></div>`;
    container.append(alert);
    selector.replaceChildren(new Option('Institución no disponible', ''));
    selector.disabled = true;
  }

  async function resolveUser() {
    const user = check(await db.from('usuario').select('usuario_id,nombre_usuario,nombres,apellidos,rol,estado').eq('nombre_usuario', sessionUser.username).maybeSingle(), 'No se pudo resolver el usuario actual.');
    if (user || sessionUser.role !== 'ADMINISTRADOR') return user;
    return check(await db.from('usuario').select('usuario_id,nombre_usuario,nombres,apellidos,rol,estado').eq('rol', 'ADMINISTRADOR').eq('estado', true).order('usuario_id').limit(1).maybeSingle(), 'No se pudo resolver el usuario Administrador.');
  }

  async function resolveProfiles(user) {
    const [directorResponse, teacherResponse] = await Promise.all([
      db.from('director').select('director_id,usuario_id,institucion_id,estado').eq('usuario_id', user.usuario_id).maybeSingle(),
      db.from('docente').select('docente_id,usuario_id,estado').eq('usuario_id', user.usuario_id).maybeSingle()
    ]);
    const director = check(directorResponse, 'No se pudo consultar el perfil Director.');
    const teacher = check(teacherResponse, 'No se pudo consultar el perfil Docente.');
    const availableProfiles = [];
    if (director && isActive(director.estado)) availableProfiles.push('DIRECTOR');
    if (teacher && isActive(teacher.estado)) availableProfiles.push('DOCENTE');
    return { director, teacher, availableProfiles };
  }

  async function resolveDirector(director) {
    if (!director || !isActive(director.estado)) throw Object.assign(new Error('Director inactivo o inexistente.'), { friendly: 'El perfil Director ya no se encuentra disponible.' });
    const institution = check(await db.from('institucion_educativa').select('institucion_id,nombre,codigo_modular,gestion,dre,ugel,departamento,provincia,distrito,direccion,estado').eq('institucion_id', director.institucion_id).maybeSingle(), 'No se pudo consultar la institución asignada.');
    if (!institution) throw Object.assign(new Error('Institución inexistente.'), { friendly: 'No se encontró la institución asignada para este Director.' });
    if (!isActive(institution.estado)) throw Object.assign(new Error('Institución inactiva.'), { friendly: 'La institución asignada se encuentra inactiva.' });
    return { director, teacher: null, institutions: [institution], institution };
  }

  async function resolveTeacher(teacher) {
    if (!teacher || !isActive(teacher.estado)) throw Object.assign(new Error('Docente inactivo o inexistente.'), { friendly: 'El perfil Docente ya no se encuentra disponible.' });
    const assignments = check(await db.from('docente_aula_area')
      .select('aula_area_curricular!inner(aula!inner(anio_escolar!inner(institucion_educativa!inner(institucion_id,nombre,codigo_modular,estado))))')
      .eq('docente_id', teacher.docente_id).eq('estado', true).eq('aula_area_curricular.estado', true), 'No se pudieron consultar las instituciones del docente.') || [];
    const unique = new Map();
    assignments.forEach((row) => {
      const institution = row.aula_area_curricular?.aula?.anio_escolar?.institucion_educativa;
      if (institution && isActive(institution.estado)) unique.set(String(institution.institucion_id), institution);
    });
    const institutions = [...unique.values()];
    const preferred = sessionStorage.getItem(PREFERENCE_KEY);
    return { director: null, teacher, institutions, institution: institutions.find((item) => String(item.institucion_id) === preferred) || institutions[0] || null };
  }

  async function loadScope(institutionId) {
    const years = check(await db.from('anio_escolar').select('anio_escolar_id').eq('institucion_id', institutionId), 'No se pudo cargar el contexto de años escolares.') || [];
    const yearIds = years.map((row) => row.anio_escolar_id);
    const rooms = yearIds.length ? check(await db.from('aula').select('aula_id').in('anio_escolar_id', yearIds), 'No se pudo cargar el contexto de aulas.') || [] : [];
    const classroomIds = rooms.map((row) => row.aula_id);
    const enrollments = classroomIds.length ? check(await db.from('matricula').select('matricula_id').in('aula_id', classroomIds), 'No se pudo cargar el contexto de matrículas.') || [] : [];
    const enrollmentIds = enrollments.map((row) => row.matricula_id);
    const analyses = enrollmentIds.length ? check(await db.from('analisis_riesgo').select('analisis_riesgo_id').in('matricula_id', enrollmentIds), 'No se pudo cargar el contexto de análisis.') || [] : [];
    const analysisIds = analyses.map((row) => row.analisis_riesgo_id);
    const alerts = analysisIds.length ? check(await db.from('alerta').select('alerta_id').in('analisis_riesgo_id', analysisIds), 'No se pudo cargar el contexto de alertas.') || [] : [];
    return { yearIds, classroomIds, enrollmentIds, analysisIds, alertIds: alerts.map((row) => row.alerta_id) };
  }

  function renderSelector(context) {
    selector.replaceChildren(...context.availableInstitutions.map((item) => new Option(item.nombre, item.institucion_id, false, item.institucion_id === context.currentInstitution?.institucion_id)));
    selector.disabled = context.currentRole === 'DIRECTOR' || context.availableInstitutions.length < 2;
    selector.title = context.currentRole === 'DIRECTOR' ? `${context.currentInstitution?.nombre || 'Institución actual'} · Selector bloqueado para Director` : context.currentInstitution?.nombre || 'Institución actual';
    switcher.classList.toggle('d-none', !context.currentInstitution);
  }

  function renderUnassignedAccount() {
    switcher.classList.add('d-none');
    const container = document.querySelector('.page-body > .container-xl');
    container.insertAdjacentHTML('beforeend', '<section class="unassigned-profile-state"><span><i class="ti ti-user-question"></i></span><h2>Tu cuenta todavía no tiene un perfil asignado.</h2><p>Un responsable debe asignarte como Director o Docente para acceder a las funciones académicas de PREVI-EDU.</p><button class="btn btn-primary" type="button" onclick="document.querySelector(\'#logout-button\').click()"><i class="ti ti-logout me-1"></i>Cerrar sesión</button></section>');
  }

  async function initialize() {
    if (!db || !sessionUser) return null;
    try {
      const user = await resolveUser() || (sessionUser.role === 'ADMINISTRADOR' ? { usuario_id: null, nombre_usuario: sessionUser.username, nombres: sessionUser.name, apellidos: '', rol: 'ADMINISTRADOR', estado: true } : null);
      if (!user) throw Object.assign(new Error('Usuario no encontrado.'), { friendly: 'No se pudo identificar al usuario actual.' });

      if (sessionUser.role === 'ADMINISTRADOR' || sessionUser.activeProfile === 'ADMINISTRADOR') {
        const context = { currentUser: user, currentRole: 'ADMINISTRADOR', availableProfiles: ['ADMINISTRADOR'], currentDirector: null, currentTeacher: null, currentInstitution: null, availableInstitutions: [], scope: { yearIds: [], classroomIds: [], enrollmentIds: [], analysisIds: [], alertIds: [] } };
        saveSession({ role: 'ADMINISTRADOR', activeProfile: 'ADMINISTRADOR', availableProfiles: ['ADMINISTRADOR'] });
        window.appContext = context; switcher.classList.add('d-none'); return context;
      }

      const profiles = await resolveProfiles(user);
      let activeProfile = sessionUser.activeProfile || sessionUser.role;
      if ((activeProfile && !profiles.availableProfiles.includes(activeProfile)) || (!activeProfile && profiles.availableProfiles.length)) {
        if (profiles.availableProfiles.length === 1) activeProfile = profiles.availableProfiles[0];
        else if (!profiles.availableProfiles.length) activeProfile = null;
        else {
          sessionStorage.removeItem(SESSION_KEY);
          location.replace('login.html');
          return null;
        }
        saveSession({ role: activeProfile || 'USUARIO', activeProfile, availableProfiles: profiles.availableProfiles });
        location.reload();
        return null;
      }
      saveSession({ role: activeProfile || 'USUARIO', activeProfile, availableProfiles: profiles.availableProfiles });

      if (!activeProfile) {
        const context = { currentUser: user, currentRole: 'USUARIO', availableProfiles: [], currentDirector: null, currentTeacher: null, currentInstitution: null, availableInstitutions: [], scope: { yearIds: [], classroomIds: [], enrollmentIds: [], analysisIds: [], alertIds: [] } };
        window.appContext = context; renderUnassignedAccount(); return context;
      }

      const resolved = activeProfile === 'DIRECTOR' ? await resolveDirector(profiles.director) : await resolveTeacher(profiles.teacher);
      if (!resolved.institution) throw Object.assign(new Error('Sin institución disponible.'), { friendly: 'No se encontró una institución disponible para el perfil seleccionado.' });
      const context = { currentUser: user, currentRole: activeProfile, availableProfiles: profiles.availableProfiles, currentDirector: resolved.director, currentTeacher: resolved.teacher, currentInstitution: resolved.institution, availableInstitutions: resolved.institutions, scope: await loadScope(resolved.institution.institucion_id) };
      window.appContext = context; renderSelector(context);
      selector.addEventListener('change', async () => {
        if (context.currentRole !== 'DOCENTE') return;
        const institution = context.availableInstitutions.find((item) => String(item.institucion_id) === selector.value);
        if (!institution) return;
        context.currentInstitution = institution;
        context.scope = await loadScope(institution.institucion_id);
        sessionStorage.setItem(PREFERENCE_KEY, String(institution.institucion_id));
        window.previEduNavigation?.clear();
        window.dispatchEvent(new CustomEvent('previ:institution-change', { detail: { institution } }));
      });
      return context;
    } catch (error) {
      console.error('[Contexto institucional] No se pudo cargar el contexto:', error.cause || error);
      window.appContext = null; showBlockingMessage(error.friendly || 'No se pudo cargar el contexto institucional.'); return null;
    }
  }

  window.clearPreviEduContext = () => { window.appContext = null; window.previEduNavigation?.clear(); sessionStorage.removeItem(PREFERENCE_KEY); };
  window.previEduContextReady = initialize();
})();
