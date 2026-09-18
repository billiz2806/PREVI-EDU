'use strict';

(() => {
  const directorModules = ['dashboard-director', 'institucion', 'gestion-academica', 'estudiantes', 'docentes', 'aulas', 'asistencia', 'evaluaciones', 'excel-mass-import', 'alertas', 'seguimientos', 'reportes', 'configuracion'];
  const adminModules = ['dashboard-admin', 'instituciones', 'directores', 'usuarios'];
  const teacherModules = ['docente-scope', 'dashboard-docente', 'aulas-docente', 'asistencia', 'evaluaciones', 'excel-mass-import', 'alertas', 'seguimientos', 'reportes'];
  window.previEduContextReady.then((context) => {
    if (!context) return;
    const modules = context.currentRole === 'ADMINISTRADOR' ? adminModules : context.currentRole === 'DIRECTOR' ? directorModules : context.currentRole === 'DOCENTE' ? teacherModules : [];
    modules.forEach((name) => {
      const script = document.createElement('script');
      script.src = `js/modules/${name}.js`;
      script.async = false;
      document.body.append(script);
    });
  });
})();
