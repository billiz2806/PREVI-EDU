'use strict';

(() => {
  const SESSION_KEY = 'previEduSession';
  const db = window.supabaseClient;
  const login = document.querySelector('#login-form');
  const notice = document.querySelector('#login-error');
  let pendingAccount = null;

  if (sessionStorage.getItem(SESSION_KEY)) { location.replace('index.html'); return; }

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal modal-blur fade" id="register-modal" tabindex="-1" aria-hidden="true"><div class="modal-dialog modal-dialog-centered"><form class="modal-content" id="register-form" novalidate>
      <div class="modal-header"><div><h2 class="modal-title">Crear cuenta</h2><p class="modal-subtitle">Registro básico en PREVI-EDU</p></div><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
      <div class="modal-body"><div class="alert alert-danger d-none" data-error></div><div class="row g-3">
        <div class="col-md-6"><label class="form-label">Nombres *</label><input class="form-control" name="nombres" required></div><div class="col-md-6"><label class="form-label">Apellidos *</label><input class="form-control" name="apellidos" required></div>
        <div class="col-12"><label class="form-label">Correo *</label><input class="form-control" name="correo" type="email" required></div><div class="col-12"><label class="form-label">Nombre de usuario *</label><input class="form-control" name="nombre_usuario" required></div>
        <div class="col-md-6"><label class="form-label">Contraseña *</label><input class="form-control" name="contrasena" type="password" minlength="4" required></div><div class="col-md-6"><label class="form-label">Confirmar contraseña *</label><input class="form-control" name="confirmar" type="password" minlength="4" required></div>
        <p class="text-secondary mb-0">Tu cuenta será creada como Usuario. Posteriormente un responsable podrá asignarte el perfil de Director o Docente.</p>
      </div></div><div class="modal-footer"><button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary" type="submit">Registrarse</button></div>
    </form></div></div>
    <div class="modal modal-blur fade" id="access-profile-modal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false" aria-labelledby="access-profile-title" aria-modal="true"><div class="modal-dialog modal-lg modal-dialog-centered"><div class="modal-content profile-selection-modal">
      <div class="modal-header"><div><h2 class="modal-title" id="access-profile-title">Seleccionar perfil</h2><p class="modal-subtitle">Tu cuenta tiene más de un perfil disponible. Selecciona cómo deseas ingresar.</p></div></div>
      <div class="modal-body"><div class="profile-choice-grid">
        <button class="profile-choice" type="button" data-profile="DIRECTOR"><span class="profile-choice-icon"><i class="ti ti-building-community"></i></span><strong>Director</strong><small>Gestionar la institución educativa</small></button>
        <button class="profile-choice" type="button" data-profile="DOCENTE"><span class="profile-choice-icon"><i class="ti ti-user-screen"></i></span><strong>Docente</strong><small>Gestionar tus aulas asignadas</small></button>
      </div></div>
    </div></div></div>`);

  const registerModal = new window.tabler.Modal(document.querySelector('#register-modal'));
  const profileModal = new window.tabler.Modal(document.querySelector('#access-profile-modal'), { backdrop: 'static', keyboard: false });
  const isActive = (value) => value === true || String(value).toUpperCase() === 'ACTIVO';
  const check = (response, message) => { if (response.error) throw new Error(message, { cause: response.error }); return response.data; };
  const feedback = (text, ok = false) => { notice.textContent = text; notice.className = `alert ${ok ? 'alert-success' : 'alert-danger'}`; };

  async function resolveAccount(username) {
    const user = check(await db.from('usuario').select('usuario_id,nombre_usuario,nombres,apellidos,rol,estado,contrasena').eq('nombre_usuario', username).maybeSingle(), 'Usuario');
    if (!user) return null;
    const [directorResponse, teacherResponse] = await Promise.all([
      db.from('director').select('director_id,institucion_id,estado').eq('usuario_id', user.usuario_id).maybeSingle(),
      db.from('docente').select('docente_id,estado').eq('usuario_id', user.usuario_id).maybeSingle()
    ]);
    return { user, director: check(directorResponse, 'Director'), teacher: check(teacherResponse, 'Docente') };
  }

  function getAvailableProfiles(account) {
    const profiles = [];
    if (account.director && isActive(account.director.estado)) profiles.push('DIRECTOR');
    if (account.teacher && isActive(account.teacher.estado)) profiles.push('DOCENTE');
    return profiles;
  }

  function enter(account, activeProfile, profiles) {
    sessionStorage.removeItem('previEduInstitutionId');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      username: account.user.nombre_usuario,
      name: [account.user.nombres, account.user.apellidos].filter(Boolean).join(' ') || account.user.nombre_usuario,
      usuario_id: account.user.usuario_id,
      availableProfiles: profiles,
      activeProfile,
      role: activeProfile || 'USUARIO'
    }));
    location.replace('index.html');
  }

  login.onsubmit = async (event) => {
    event.preventDefault(); notice.classList.add('d-none');
    try {
      const account = await resolveAccount(login.username.value.trim().toLowerCase());
      if (!account || account.user.contrasena == null || account.user.contrasena !== login.password.value) { feedback('Usuario o contraseña incorrectos.'); return; }
      if (!isActive(account.user.estado)) { feedback('Tu cuenta se encuentra inactiva. Contacta al administrador.'); return; }
      if (account.user.rol === 'ADMINISTRADOR') { enter(account, 'ADMINISTRADOR', ['ADMINISTRADOR']); return; }
      const profiles = getAvailableProfiles(account);
      if (profiles.length === 2) { pendingAccount = { account, profiles }; profileModal.show(); return; }
      enter(account, profiles[0] || null, profiles);
    } catch (error) { console.error('[Login]', error.cause || error); feedback('No se pudo validar el acceso.'); }
  };

  document.querySelector('#access-profile-modal').addEventListener('click', (event) => {
    const profile = event.target.closest('[data-profile]')?.dataset.profile;
    if (profile && pendingAccount?.profiles.includes(profile)) enter(pendingAccount.account, profile, pendingAccount.profiles);
  });

  document.querySelector('#open-register').onclick = () => { const form = document.querySelector('#register-form'); form.reset(); form.classList.remove('was-validated'); form.querySelector('[data-error]').classList.add('d-none'); registerModal.show(); };
  document.querySelector('#register-form').onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget, values = new FormData(form), box = form.querySelector('[data-error]');
    if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
    if (values.get('contrasena') !== values.get('confirmar')) { box.textContent = 'Las contraseñas no coinciden.'; box.classList.remove('d-none'); return; }
    const payload = { nombres: values.get('nombres').trim(), apellidos: values.get('apellidos').trim(), correo: values.get('correo').trim(), nombre_usuario: values.get('nombre_usuario').trim().toLowerCase(), contrasena: values.get('contrasena'), rol: 'USUARIO', estado: true };
    const button = form.querySelector('[type="submit"]'); button.disabled = true; button.textContent = 'Registrando...';
    try {
      const [mail, username] = await Promise.all([db.from('usuario').select('usuario_id').ilike('correo', payload.correo), db.from('usuario').select('usuario_id').ilike('nombre_usuario', payload.nombre_usuario)]);
      if (check(mail, 'Correo').length) throw Object.assign(new Error(), { friendly: 'Ya existe un usuario con este correo.' });
      if (check(username, 'Usuario').length) throw Object.assign(new Error(), { friendly: 'Ya existe un usuario con este nombre de usuario.' });
      check(await db.from('usuario').insert(payload), 'Registro'); registerModal.hide(); feedback('Cuenta creada correctamente. Ya puedes iniciar sesión.', true);
    } catch (error) { console.error('[Registro]', error.cause || error); box.textContent = error.friendly || 'No se pudo crear la cuenta.'; box.classList.remove('d-none'); }
    finally { button.disabled = false; button.textContent = 'Registrarse'; }
  };
})();
