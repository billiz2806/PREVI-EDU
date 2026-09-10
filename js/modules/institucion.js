'use strict';

(() => {
  const currentUser = window.previEduCurrentUser;

  if (!currentUser || currentUser.role !== 'DIRECTOR') {
    return;
  }

  const client = window.supabaseClient;
  const menu = document.querySelector('#main-menu');
  const dashboard = document.querySelector('#dashboard-director');
  const institutionView = document.querySelector('#institution-view');
  const loading = document.querySelector('#institution-loading');
  const empty = document.querySelector('#institution-empty');
  const content = document.querySelector('#institution-content');
  const form = document.querySelector('#institution-form');
  const editableFields = [...form.querySelectorAll('[data-editable]')];
  const allFields = [...form.querySelectorAll('[data-field]')];
  const editButton = document.querySelector('#institution-edit-button');
  const cancelButton = document.querySelector('#institution-cancel-button');
  const actions = document.querySelector('#institution-actions');
  const feedback = document.querySelector('#institution-feedback');
  const saveButton = form.querySelector('[type="submit"]');
  const dashboardTitle = document.querySelector('#dashboard-title');
  const dashboardSubtitle = document.querySelector('#dashboard-subtitle');

  let institutionId = null;
  let originalValues = {};
  let informationLoaded = false;

  function findMenuLink(label) {
    return [...menu.querySelectorAll('.nav-link')]
      .find((link) => link.textContent.trim() === label);
  }

  const institutionLink = findMenuLink('Institución');
  const dashboardLink = findMenuLink('Dashboard');

  if (!institutionLink || !dashboardLink) {
    return;
  }

  function setActiveLink(activeLink) {
    menu.querySelectorAll('.nav-link').forEach((link) => {
      const isActive = link === activeLink;
      link.classList.toggle('active', isActive);

      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function showInstitution(event) {
    event.preventDefault();
    dashboard.classList.add('d-none');
    institutionView.classList.remove('d-none');
    dashboardTitle.textContent = 'Institución';
    dashboardSubtitle.textContent = 'Información general de la institución educativa';
    setActiveLink(institutionLink);

    if (!informationLoaded) {
      loadInstitution();
    }
  }

  function showDashboard(event) {
    event.preventDefault();
    institutionView.classList.add('d-none');
    dashboard.classList.remove('d-none');
    dashboardTitle.textContent = 'Dashboard Institucional';
    dashboardSubtitle.textContent = 'Resumen general de la institución educativa';
    setActiveLink(dashboardLink);
    window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function assertResponse(response, context) {
    if (response.error) {
      throw new Error(context, { cause: response.error });
    }

    return response.data;
  }

  function safeValue(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function readableStatus(value) {
    if (value === true) return 'Activo';
    if (value === false) return 'Inactivo';
    return safeValue(value) || 'No hay información disponible.';
  }

  function formatDate(value) {
    if (!value) return 'No hay información disponible.';
    const [year, month, day] = String(value).split('-');
    return year && month && day ? `${day}/${month}/${year}` : 'No hay información disponible.';
  }

  function fillInstitution(institution) {
    allFields.forEach((field) => {
      const key = field.dataset.field;
      field.value = key === 'estado'
        ? readableStatus(institution[key])
        : safeValue(institution[key]);
    });

    originalValues = Object.fromEntries(
      editableFields.map((field) => [field.dataset.field, field.value])
    );
  }

  function fillSchoolYear(schoolYear) {
    const schoolYearContent = document.querySelector('#school-year-content');
    const schoolYearEmpty = document.querySelector('#school-year-empty');

    if (!schoolYear) {
      schoolYearContent.classList.add('d-none');
      schoolYearEmpty.classList.remove('d-none');
      return;
    }

    document.querySelector('#school-year-value').textContent = safeValue(schoolYear.anio) || 'No hay información disponible.';
    document.querySelector('#school-year-start').textContent = formatDate(schoolYear.fecha_inicio);
    document.querySelector('#school-year-end').textContent = formatDate(schoolYear.fecha_fin);
    document.querySelector('#school-year-status').textContent = readableStatus(schoolYear.estado);
  }

  async function loadInstitution() {
    loading.classList.remove('d-none');
    empty.classList.add('d-none');

    try {
      const institution = assertResponse(
        await client
          .from('institucion_educativa')
          .select('institucion_id, codigo_modular, nombre, gestion, dre, ugel, departamento, provincia, distrito, direccion, estado')
          .eq('institucion_id', window.appContext.currentInstitution.institucion_id)
          .maybeSingle(),
        'No se pudo consultar la institución.'
      );

      if (!institution) {
        loading.classList.add('d-none');
        empty.classList.remove('d-none');
        informationLoaded = true;
        return;
      }

      institutionId = institution.institucion_id;
      fillInstitution(institution);
      loading.classList.add('d-none');
      content.classList.remove('d-none');
      informationLoaded = true;

      try {
        const schoolYear = assertResponse(
          await client
            .from('anio_escolar')
            .select('anio_escolar_id, anio, fecha_inicio, fecha_fin, estado')
            .eq('institucion_id', institutionId)
            .eq('estado', true)
            .order('anio', { ascending: false })
            .limit(1)
            .maybeSingle(),
          'No se pudo consultar el año escolar activo.'
        );

        fillSchoolYear(schoolYear);
      } catch (error) {
        console.error('[Institución] Error al cargar el año escolar:', error.cause || error);
        document.querySelector('#school-year-content').classList.add('d-none');
        const schoolYearEmpty = document.querySelector('#school-year-empty');
        schoolYearEmpty.textContent = 'No se pudo cargar la información.';
        schoolYearEmpty.classList.remove('d-none');
      }
    } catch (error) {
      console.error('[Institución] Error al cargar la información:', error.cause || error);
      loading.classList.add('d-none');
      empty.textContent = 'No se pudo cargar la información.';
      empty.classList.remove('d-none');
    }
  }

  function clearValidation() {
    editableFields.forEach((field) => field.classList.remove('is-invalid'));
  }

  function hideFeedback() {
    feedback.classList.add('d-none');
    feedback.classList.remove('alert-success', 'alert-danger');
  }

  function setEditMode(enabled) {
    editableFields.forEach((field) => {
      field.readOnly = !enabled;
    });
    form.classList.toggle('is-editing', enabled);
    editButton.classList.toggle('d-none', enabled);
    actions.classList.toggle('d-none', !enabled);
  }

  function startEditing() {
    hideFeedback();
    clearValidation();
    setEditMode(true);
    document.querySelector('#institution-name').focus();
  }

  function cancelEditing() {
    editableFields.forEach((field) => {
      field.value = originalValues[field.dataset.field] ?? '';
    });
    clearValidation();
    hideFeedback();
    setEditMode(false);
  }

  function validateForm() {
    const requiredFields = editableFields.filter((field) => field.required);
    let isValid = true;

    requiredFields.forEach((field) => {
      const fieldIsValid = field.value.trim().length > 0;
      field.classList.toggle('is-invalid', !fieldIsValid);
      isValid = isValid && fieldIsValid;
    });

    return isValid;
  }

  function showFeedback(message, type) {
    feedback.textContent = message;
    feedback.classList.remove('d-none', 'alert-success', 'alert-danger');
    feedback.classList.add(type === 'success' ? 'alert-success' : 'alert-danger');
  }

  async function saveInstitution(event) {
    event.preventDefault();
    hideFeedback();

    if (!validateForm()) {
      showFeedback('Revisa los campos obligatorios antes de guardar.', 'error');
      return;
    }

    const payload = Object.fromEntries(
      editableFields.map((field) => [field.dataset.field, field.value.trim() || null])
    );
    const originalButtonText = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.textContent = 'Guardando...';

    try {
      const updatedInstitution = assertResponse(
        await client
          .from('institucion_educativa')
          .update(payload)
          .eq('institucion_id', institutionId)
          .select('institucion_id, nombre, gestion, departamento, provincia, distrito, direccion')
          .single(),
        'No se pudo actualizar la institución.'
      );

      editableFields.forEach((field) => {
        field.value = safeValue(updatedInstitution[field.dataset.field]);
      });
      originalValues = Object.fromEntries(
        editableFields.map((field) => [field.dataset.field, field.value])
      );
      Object.assign(window.appContext.currentInstitution, updatedInstitution);
      const selector = document.querySelector('#institution-selector');
      if (selector?.selectedOptions[0]) {
        selector.selectedOptions[0].textContent = updatedInstitution.nombre;
        selector.title = updatedInstitution.nombre;
      }
      setEditMode(false);
      showFeedback('Información actualizada correctamente.', 'success');
    } catch (error) {
      console.error('[Institución] Error al actualizar la información:', error.cause || error);
      showFeedback('No se pudo actualizar la información.', 'error');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = originalButtonText;
    }
  }

  editableFields.forEach((field) => {
    field.addEventListener('input', () => field.classList.remove('is-invalid'));
  });
  institutionLink.addEventListener('click', showInstitution);
  dashboardLink.addEventListener('click', showDashboard);
  editButton.addEventListener('click', startEditing);
  cancelButton.addEventListener('click', cancelEditing);
  form.addEventListener('submit', saveInstitution);
})();
