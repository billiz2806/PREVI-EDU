'use strict';

(() => {
  const directorModules = ['dashboard-director', 'institucion', 'gestion-academica', 'estudiantes', 'docentes', 'asistencia', 'evaluaciones', 'alertas', 'seguimientos', 'reportes', 'configuracion'];
  const adminModules = ['dashboard-admin', 'instituciones', 'directores', 'usuarios'];
  window.previEduContextReady.then((context) => {
    if (!context) return;
    const modules = context.currentRole === 'ADMINISTRADOR' ? adminModules : context.currentRole === 'DIRECTOR' ? directorModules : [];
    modules.forEach((name) => {
      const script = document.createElement('script');
      script.src = `js/modules/${name}.js`;
      script.async = false;
      document.body.append(script);
    });
  });
})();
