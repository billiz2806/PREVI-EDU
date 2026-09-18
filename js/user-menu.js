'use strict';

(() => {
  window.previEduContextReady.then((context) => {
    if (!context) return;
    const db = window.supabaseClient;
    const userId = context.currentUser.usuario_id;
    const profiles = context.availableProfiles || [];
    const profileLabels = { ADMINISTRADOR: 'Administrador', DIRECTOR: 'Director', DOCENTE: 'Docente', USUARIO: 'Usuario' };
    const host = document.querySelector('#user-avatar').parentElement;
    host.querySelector('.text-end')?.classList.add('d-none');
    document.querySelector('#user-avatar')?.classList.add('d-none');

    host.insertAdjacentHTML('beforeend', `<div class="dropdown user-menu"><button class="btn user-menu-toggle" data-bs-toggle="dropdown" aria-expanded="false"><span class="avatar avatar-sm">${(context.currentUser.nombres || context.currentUser.nombre_usuario || 'U')[0].toUpperCase()}</span><span class="user-menu-name">${context.currentUser.nombres || context.currentUser.nombre_usuario}</span><i class="ti ti-chevron-down"></i></button><div class="dropdown-menu dropdown-menu-end"><button class="dropdown-item" data-user-action="profile"><i class="ti ti-user"></i> Mi perfil</button><button class="dropdown-item" data-user-action="password"><i class="ti ti-key"></i> Cambiar contraseña</button>${profiles.length > 1 ? '<button class="dropdown-item" data-user-action="switch"><i class="ti ti-switch-horizontal"></i> Cambiar perfil</button>' : ''}<div class="dropdown-divider"></div><button class="dropdown-item text-danger" data-user-action="logout"><i class="ti ti-logout"></i> Cerrar sesión</button></div></div>`);

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal modal-blur fade" id="my-profile-modal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><form class="modal-content" novalidate><div class="modal-header"><div><h2 class="modal-title">Mi perfil</h2><p class="modal-subtitle">Perfiles disponibles: ${(profiles.length ? profiles : ['USUARIO']).map((profile) => profileLabels[profile]).join(' / ')}</p></div><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Cerrar"></button></div><div class="modal-body"><div class="alert alert-danger d-none" data-error></div><div class="row g-3"><div class="col-md-6"><label class="form-label">Nombres *</label><input class="form-control" name="nombres" required></div><div class="col-md-6"><label class="form-label">Apellidos *</label><input class="form-control" name="apellidos" required></div><div class="col-12"><label class="form-label">Correo *</label><input class="form-control" name="correo" type="email" required></div><div class="col-12"><label class="form-label">Nombre de usuario *</label><input class="form-control" name="nombre_usuario" required></div></div></div><div class="modal-footer"><button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary" type="submit">Guardar cambios</button></div></form></div></div>
      <div class="modal modal-blur fade" id="change-password-modal" tabindex="-1"><div class="modal-dialog modal-sm modal-dialog-centered"><form class="modal-content"><div class="modal-header"><h2 class="modal-title">Cambiar contraseña</h2><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Cerrar"></button></div><div class="modal-body"><div class="alert alert-danger d-none" data-error></div><div class="mb-3"><label class="form-label">Contraseña actual *</label><input class="form-control" name="current" type="password" required></div><div class="mb-3"><label class="form-label">Nueva contraseña *</label><input class="form-control" name="next" type="password" minlength="4" required></div><div><label class="form-label">Confirmar nueva contraseña *</label><input class="form-control" name="confirm" type="password" minlength="4" required></div></div><div class="modal-footer"><button class="btn btn-primary w-100" type="submit">Actualizar contraseña</button></div></form></div></div>
      ${profiles.length > 1 ? `<div class="modal modal-blur fade" id="session-profile-modal" tabindex="-1" aria-labelledby="session-profile-title"><div class="modal-dialog modal-lg modal-dialog-centered"><div class="modal-content profile-selection-modal"><div class="modal-header"><div><h2 class="modal-title" id="session-profile-title">Seleccionar perfil</h2><p class="modal-subtitle">Tu cuenta tiene más de un perfil disponible. Selecciona cómo deseas ingresar.</p></div><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Cerrar"></button></div><div class="modal-body"><div class="profile-choice-grid"><button class="profile-choice${context.currentRole === 'DIRECTOR' ? ' is-current' : ''}" type="button" data-session-profile="DIRECTOR"><span class="profile-choice-icon"><i class="ti ti-building-community"></i></span><strong>Director</strong><small>Gestionar la institución educativa</small></button><button class="profile-choice${context.currentRole === 'DOCENTE' ? ' is-current' : ''}" type="button" data-session-profile="DOCENTE"><span class="profile-choice-icon"><i class="ti ti-user-screen"></i></span><strong>Docente</strong><small>Gestionar tus aulas asignadas</small></button></div></div></div></div></div>` : ''}`);

    const profileModal = new window.tabler.Modal(document.querySelector('#my-profile-modal'));
    const passwordModal = new window.tabler.Modal(document.querySelector('#change-password-modal'));
    const switchModal = profiles.length > 1 ? new window.tabler.Modal(document.querySelector('#session-profile-modal')) : null;
    const profileForm = document.querySelector('#my-profile-modal form');
    const passwordForm = document.querySelector('#change-password-modal form');

    function populate() {
      ['nombres', 'apellidos', 'correo', 'nombre_usuario'].forEach((key) => { profileForm.elements[key].value = context.currentUser[key] || ''; });
      profileForm.querySelector('[data-error]').classList.add('d-none');
    }

    function changeProfile(profile) {
      if (!profiles.includes(profile)) return;
      if (profile === context.currentRole) { switchModal?.hide(); return; }
      const session = JSON.parse(sessionStorage.getItem('previEduSession'));
      Object.assign(session, { role: profile, activeProfile: profile, availableProfiles: profiles });
      window.previEduNavigation?.clear();
      window.clearPreviEduContext?.();
      sessionStorage.setItem('previEduSession', JSON.stringify(session));
      location.reload();
    }

    host.addEventListener('click', (event) => {
      const action = event.target.closest('[data-user-action]')?.dataset.userAction;
      if (action === 'profile') { populate(); profileModal.show(); }
      if (action === 'password') { passwordForm.reset(); passwordForm.querySelector('[data-error]').classList.add('d-none'); passwordModal.show(); }
      if (action === 'switch') switchModal?.show();
      if (action === 'logout') document.querySelector('#logout-button').click();
    });
    document.querySelector('#session-profile-modal')?.addEventListener('click', (event) => changeProfile(event.target.closest('[data-session-profile]')?.dataset.sessionProfile));

    profileForm.onsubmit = async (event) => {
      event.preventDefault(); if (!profileForm.checkValidity()) { profileForm.classList.add('was-validated'); return; }
      const payload = {}; ['nombres', 'apellidos', 'correo', 'nombre_usuario'].forEach((key) => { payload[key] = profileForm.elements[key].value.trim(); });
      const box = profileForm.querySelector('[data-error]');
      try {
        for (const field of ['correo', 'nombre_usuario']) {
          const response = await db.from('usuario').select('usuario_id').ilike(field, payload[field]).neq('usuario_id', userId);
          if (response.error) throw response.error;
          if (response.data.length) throw Object.assign(new Error(), { friendly: field === 'correo' ? 'Ya existe un usuario con este correo.' : 'Ya existe un usuario con este nombre de usuario.' });
        }
        const result = await db.from('usuario').update(payload).eq('usuario_id', userId); if (result.error) throw result.error;
        Object.assign(context.currentUser, payload);
        const session = JSON.parse(sessionStorage.getItem('previEduSession')); Object.assign(session, { username: payload.nombre_usuario, name: `${payload.nombres} ${payload.apellidos}`.trim() }); sessionStorage.setItem('previEduSession', JSON.stringify(session));
        host.querySelector('.user-menu-name').textContent = payload.nombres; profileModal.hide();
      } catch (error) { console.error('[Mi perfil]', error); box.textContent = error.friendly || 'No se pudo actualizar el perfil.'; box.classList.remove('d-none'); }
    };

    passwordForm.onsubmit = async (event) => {
      event.preventDefault(); const box = passwordForm.querySelector('[data-error]'), current = passwordForm.elements.current.value, next = passwordForm.elements.next.value;
      if (next !== passwordForm.elements.confirm.value) { box.textContent = 'Las contraseñas no coinciden.'; box.classList.remove('d-none'); return; }
      try {
        const response = await db.from('usuario').select('contrasena').eq('usuario_id', userId).maybeSingle(); if (response.error) throw response.error;
        if (response.data?.contrasena !== current) { box.textContent = 'La contraseña actual es incorrecta.'; box.classList.remove('d-none'); return; }
        const saved = await db.from('usuario').update({ contrasena: next }).eq('usuario_id', userId); if (saved.error) throw saved.error; passwordModal.hide();
      } catch (error) { console.error('[Contraseña]', error); box.textContent = 'No se pudo actualizar la contraseña.'; box.classList.remove('d-none'); }
    };
  });
})();
