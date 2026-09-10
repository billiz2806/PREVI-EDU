'use strict';

(() => {
  const currentUser = window.previEduCurrentUser;
  if (!currentUser || currentUser.role !== 'DIRECTOR') return;

  const db = window.supabaseClient;
  const menu = document.querySelector('#main-menu');
  const main = document.querySelector('main .container-xl');
  const link = [...(menu?.querySelectorAll('.nav-link') || [])].find((item) => item.textContent.trim() === 'Configuración');
  if (!db || !main || !link) return;

  main.insertAdjacentHTML('beforeend', `
    <section class="d-none settings-view" id="settings-view" aria-label="Configuración">
      <div class="alert d-none students-feedback" id="settings-feedback" role="status"></div>
      <div class="students-tabs-wrapper"><div class="nav students-tabs settings-tabs" role="tablist">
        <button class="nav-link active" type="button" data-settings-tab="preventive"><i class="ti ti-shield-check"></i> Análisis preventivo</button>
        <button class="nav-link" type="button" data-settings-tab="catalogs"><i class="ti ti-list-details"></i> Catálogos</button>
        <button class="nav-link" type="button" data-settings-tab="system"><i class="ti ti-info-circle"></i> Sistema</button>
      </div></div>
      <div class="settings-loading d-none" id="settings-loading"><span class="spinner-border spinner-border-sm"></span> Cargando configuración...</div>
      <div class="d-none" id="settings-content">
        <div class="settings-pane" id="settings-pane-preventive">
          <div class="settings-preventive-grid">
            <article class="card students-card settings-main-card"><div class="card-header settings-card-heading"><div><span class="academic-icon icon-violet"><i class="ti ti-shield-check"></i></span><div><h2 class="card-title">Configuración activa</h2><p>Configuración preventiva utilizada por el prototipo</p></div></div><span class="badge settings-active-badge" id="settings-config-status"></span></div><div class="card-body" id="settings-config-body"></div></article>
            <aside class="settings-explanation"><i class="ti ti-info-circle"></i><div><strong>Análisis preventivo</strong><p>PREVI-EDU considera múltiples factores académicos y de asistencia para apoyar la identificación preventiva de estudiantes que podrían requerir atención.</p><small>Los factores se utilizan con fines demostrativos dentro del prototipo.</small></div></aside>
          </div>
          <div class="settings-section-heading"><div><h2>Factores considerados en el análisis preventivo</h2><p>Active únicamente los factores que serán considerados conceptualmente.</p></div><button class="btn btn-primary btn-sm" id="settings-save" type="button" disabled><i class="ti ti-device-floppy"></i> Guardar cambios</button></div>
          <div class="settings-parameters" id="settings-parameters"></div>
          <p class="students-message d-none" id="settings-preventive-empty">No se encontró una configuración preventiva activa.</p>
        </div>
        <div class="settings-pane d-none" id="settings-pane-catalogs"><div class="settings-catalog-grid" id="settings-catalogs"></div></div>
        <div class="settings-pane d-none" id="settings-pane-system"><div class="settings-system-grid" id="settings-system"></div></div>
      </div>
    </section>`);

  const $ = (selector) => document.querySelector(selector);
  const safe = (value, fallback = 'No registrado') => value === null || value === undefined || value === '' ? fallback : String(value);
  const esc = (value, fallback) => safe(value, fallback).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const norm = (value) => safe(value, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const formatDate = (value) => value ? new Intl.DateTimeFormat('es-PE', {timeZone:'UTC'}).format(new Date(`${String(value).slice(0,10)}T00:00:00Z`)) : 'No registrado';
  const check = (response, context) => { if (response.error) throw new Error(context, {cause:response.error}); return response.data; };
  const state = {loaded:false, loading:false, tab:'preventive', config:null, parameters:[], catalogs:{attendance:[],risks:[],alerts:[]}, institution:null, schoolYear:null, original:null, dirty:false};

  function feedback(message, ok = true) {
    const element = $('#settings-feedback');
    if (!message) { element.classList.add('d-none'); return; }
    element.textContent = message;
    element.className = `alert students-feedback ${ok ? 'alert-success' : 'alert-danger'}`;
  }
  function snapshot() {
    state.original = {
      name: $('#settings-config-name')?.value || '',
      description: $('#settings-config-description')?.value || '',
      parameters: Object.fromEntries(state.parameters.map((row) => [row.parametro_riesgo_id, Boolean(row.activo)]))
    };
  }
  function setDirty(value = true) { state.dirty = value; $('#settings-save').disabled = !value; }
  function confirmDiscard() {
    if (!state.dirty) return true;
    if (!window.confirm('Tiene cambios sin guardar. ¿Desea continuar y descartarlos?')) return false;
    restoreOriginal(); return true;
  }
  function restoreOriginal() {
    if (!state.original) return;
    if ($('#settings-config-name')) $('#settings-config-name').value = state.original.name;
    if ($('#settings-config-description')) $('#settings-config-description').value = state.original.description;
    state.parameters.forEach((row) => { const input = $(`[data-parameter-id="${row.parametro_riesgo_id}"]`); if (input) input.checked = state.original.parameters[row.parametro_riesgo_id]; });
    setDirty(false); feedback('');
  }

  async function load() {
    if (state.loading) return;
    state.loading = true; $('#settings-loading').classList.remove('d-none'); $('#settings-content').classList.add('d-none'); feedback('');
    try {
      const [configResponse, attendanceResponse, riskResponse, alertResponse, institutionResponse] = await Promise.all([
        db.from('configuracion_riesgo').select('configuracion_riesgo_id,nombre,descripcion,version,activo').eq('activo',true).limit(1).maybeSingle(),
        db.from('estado_asistencia').select('*').order('estado_asistencia_id'),
        db.from('nivel_riesgo').select('*').order('orden'),
        db.from('estado_alerta').select('*').order('orden'),
        db.from('institucion_educativa').select('institucion_id,nombre,codigo_modular,ugel,distrito').eq('institucion_id', window.appContext.currentInstitution.institucion_id).maybeSingle()
      ]);
      state.config = check(configResponse,'Configuración preventiva');
      state.catalogs.attendance = check(attendanceResponse,'Estados de asistencia') || [];
      state.catalogs.risks = check(riskResponse,'Niveles de riesgo') || [];
      state.catalogs.alerts = check(alertResponse,'Estados de alerta') || [];
      state.institution = check(institutionResponse,'Institución');
      if (state.config) state.parameters = check(await db.from('parametro_riesgo').select('parametro_riesgo_id,configuracion_riesgo_id,codigo,nombre,descripcion,activo,orden').eq('configuracion_riesgo_id',state.config.configuracion_riesgo_id).order('orden'), 'Parámetros preventivos') || [];
      if (state.institution) state.schoolYear = check(await db.from('anio_escolar').select('anio_escolar_id,anio,fecha_inicio,fecha_fin,estado').eq('institucion_id',state.institution.institucion_id).eq('estado',true).order('anio',{ascending:false}).limit(1).maybeSingle(), 'Año escolar activo');
      render(); state.loaded = true; $('#settings-content').classList.remove('d-none');
    } catch (error) {
      console.error('[Configuración] Error al cargar:',error.cause||error);
      feedback('No fue posible cargar la configuración.',false);
    } finally { state.loading=false; $('#settings-loading').classList.add('d-none'); }
  }

  function parameterIcon(code) {
    const value = norm(code);
    if (value.includes('tard')) return 'ti-clock';
    if (value.includes('falta')) return 'ti-alert-circle';
    if (value.includes('rend')) return value.includes('tend') ? 'ti-trending-up' : 'ti-school';
    if (value.includes('tend')) return 'ti-chart-line';
    return 'ti-calendar-check';
  }
  function renderPreventive() {
    const empty = $('#settings-preventive-empty'), card = $('.settings-main-card'), heading = $('.settings-section-heading');
    if (!state.config) { empty.classList.remove('d-none'); card.classList.add('d-none'); heading.classList.add('d-none'); $('#settings-parameters').innerHTML=''; return; }
    empty.classList.add('d-none'); card.classList.remove('d-none'); heading.classList.remove('d-none');
    $('#settings-config-status').textContent = state.config.activo ? 'ACTIVA' : 'INACTIVA';
    $('#settings-config-status').classList.toggle('is-inactive',!state.config.activo);
    $('#settings-config-body').innerHTML = `<div class="settings-config-form"><div><label for="settings-config-name">Nombre</label><input class="form-control" id="settings-config-name" value="${esc(state.config.nombre,'')}"></div><div><label>Versión</label><input class="form-control" value="${esc(state.config.version)}" readonly></div><div class="settings-description-field"><label for="settings-config-description">Descripción</label><textarea class="form-control" id="settings-config-description" rows="3">${esc(state.config.descripcion,'')}</textarea></div></div>`;
    $('#settings-parameters').innerHTML = state.parameters.length ? state.parameters.map((row,index) => `<article class="settings-parameter"><span class="settings-parameter-icon tone-${index%4}"><i class="ti ${parameterIcon(row.codigo)}"></i></span><div><div class="settings-parameter-title"><strong>${esc(row.nombre)}</strong><code>${esc(row.codigo)}</code></div><p>${esc(row.descripcion,'Sin descripción')}</p></div><label class="form-check form-switch"><input class="form-check-input" type="checkbox" data-parameter-id="${row.parametro_riesgo_id}" ${row.activo?'checked':''} aria-label="${row.activo?'Desactivar':'Activar'} ${esc(row.nombre)}"><span class="form-check-label">${row.activo?'Activo':'Inactivo'}</span></label></article>`).join('') : '<p class="students-message">No hay parámetros registrados para esta configuración.</p>';
    $('#settings-config-name').addEventListener('input',()=>setDirty()); $('#settings-config-description').addEventListener('input',()=>setDirty());
    document.querySelectorAll('[data-parameter-id]').forEach((input)=>input.addEventListener('change',()=>{input.nextElementSibling.textContent=input.checked?'Activo':'Inactivo';input.setAttribute('aria-label',`${input.checked?'Desactivar':'Activar'} parámetro`);setDirty();}));
    snapshot(); setDirty(false);
  }
  function catalogItems(rows,type) {
    if (!rows.length) return '<p class="students-message">No hay información disponible.</p>';
    return `<div class="settings-catalog-list">${rows.map((row)=>{const code=row.codigo||row.nombre;return `<div><span class="settings-catalog-code ${type}-${norm(code)}">${esc(code)}</span><p><strong>${esc(row.nombre||code)}</strong><small>${esc(row.descripcion,'Catálogo estructural del prototipo')}</small></p></div>`;}).join('')}</div>`;
  }
  function renderCatalogs() {
    $('#settings-catalogs').innerHTML = `<article class="card students-card"><div class="card-header"><h2 class="card-title"><i class="ti ti-calendar-check"></i> Estados de asistencia</h2></div><div class="card-body">${catalogItems(state.catalogs.attendance,'attendance-status')}</div></article><article class="card students-card"><div class="card-header"><h2 class="card-title"><i class="ti ti-alert-triangle"></i> Niveles de riesgo</h2></div><div class="card-body">${catalogItems(state.catalogs.risks,'risk')}</div></article><article class="card students-card"><div class="card-header"><h2 class="card-title"><i class="ti ti-bell"></i> Estados de alerta</h2></div><div class="card-body">${catalogItems(state.catalogs.alerts,'state')}</div></article>`;
  }
  function infoCard(title,icon,rows) { return `<article class="card students-card settings-info-card"><div class="card-header"><h2 class="card-title"><i class="ti ${icon}"></i> ${esc(title)}</h2></div><div class="card-body"><dl>${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></div></article>`; }
  function renderSystem() {
    $('#settings-system').innerHTML = `${infoCard('PREVI-EDU','ti-app-window',[['Aplicación','PREVI-EDU'],['Tipo','Prototipo académico'],['Versión','1.0'],['Año',state.schoolYear?.anio||'No registrado'],['Entorno','Prototipo de evaluación']])}${infoCard('Institución','ti-building',[['Institución',state.institution?.nombre],['Código modular',state.institution?.codigo_modular],['UGEL',state.institution?.ugel],['Distrito',state.institution?.distrito]])}${infoCard('Año escolar activo','ti-calendar-event',[['Año',state.schoolYear?.anio],['Fecha de inicio',formatDate(state.schoolYear?.fecha_inicio)],['Fecha de fin',formatDate(state.schoolYear?.fecha_fin)]])}<article class="settings-ml-note"><i class="ti ti-bulb"></i><div><strong>Análisis preventivo</strong><p>PREVI-EDU simula la aplicación de técnicas de Machine Learning para apoyar la identificación preventiva del riesgo de deserción escolar.</p><small>Los resultados del prototipo tienen fines demostrativos y no representan la validación de un modelo predictivo real.</small></div></article>`;
  }
  function render() { renderPreventive(); renderCatalogs(); renderSystem(); activatePane(state.tab,false); }

  function activatePane(tab,confirmChange=true) {
    if (confirmChange && !confirmDiscard()) return;
    state.tab=tab; document.querySelectorAll('[data-settings-tab]').forEach((button)=>button.classList.toggle('active',button.dataset.settingsTab===tab));
    document.querySelectorAll('.settings-pane').forEach((pane)=>pane.classList.add('d-none')); $(`#settings-pane-${tab}`).classList.remove('d-none');
  }
  async function save() {
    if (!state.dirty || !state.config) return;
    const name=$('#settings-config-name').value.trim(),description=$('#settings-config-description').value.trim();
    if (!name) { feedback('El nombre de la configuración es obligatorio.',false); $('#settings-config-name').focus(); return; }
    const button=$('#settings-save');button.disabled=true;button.textContent='Guardando...';
    try {
      const operations=[db.from('configuracion_riesgo').update({nombre:name,descripcion:description||null}).eq('configuracion_riesgo_id',state.config.configuracion_riesgo_id)];
      state.parameters.forEach((row)=>{const active=$(`[data-parameter-id="${row.parametro_riesgo_id}"]`).checked;if(active!==Boolean(row.activo))operations.push(db.from('parametro_riesgo').update({activo:active}).eq('parametro_riesgo_id',row.parametro_riesgo_id));});
      const responses=await Promise.all(operations);const failed=responses.find((response)=>response.error);if(failed)throw new Error('Actualización',{cause:failed.error});
      state.config.nombre=name;state.config.descripcion=description||null;state.parameters.forEach((row)=>{row.activo=$(`[data-parameter-id="${row.parametro_riesgo_id}"]`).checked;});snapshot();setDirty(false);feedback('Configuración actualizada correctamente.');
    } catch(error) { console.error('[Configuración] Error al guardar:',error.cause||error);feedback('No fue posible guardar la configuración.',false);setDirty(true); }
    finally { button.textContent='Guardar cambios';button.disabled=!state.dirty; }
  }
  function show(event) {
    event.preventDefault();
    ['#dashboard-director','#institution-view','#academic-management-view','#students-view','#teachers-view','#attendance-view','#evaluations-view','#alerts-view','#followups-view','#reports-view'].forEach((selector)=>$(selector)?.classList.add('d-none'));
    $('#settings-view').classList.remove('d-none');$('#dashboard-title').textContent='CONFIGURACIÓN';$('#dashboard-subtitle').textContent='Administre los parámetros generales utilizados por PREVI-EDU para el seguimiento preventivo.';
    menu.querySelectorAll('.nav-link').forEach((item)=>item.classList.toggle('active',item===link));activatePane('preventive',false);if(!state.loaded)load();
  }

  menu.addEventListener('click',(event)=>{const target=event.target.closest('.nav-link');if(target&&target!==link&&!$('#settings-view').classList.contains('d-none')&&!confirmDiscard()){event.preventDefault();event.stopImmediatePropagation();}},true);
  link.addEventListener('click',show);[...menu.querySelectorAll('.nav-link')].filter((item)=>item!==link).forEach((item)=>item.addEventListener('click',()=>$('#settings-view').classList.add('d-none')));
  document.querySelectorAll('[data-settings-tab]').forEach((button)=>button.addEventListener('click',()=>activatePane(button.dataset.settingsTab)));
  $('#settings-save').addEventListener('click',save);
})();
