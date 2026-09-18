'use strict';

(() => {
  const currentUser = window.previEduCurrentUser;
  const db = window.supabaseClient;
  if (!db || !['DIRECTOR', 'DOCENTE'].includes(currentUser?.role)) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const one = (value) => Array.isArray(value) ? value[0] : value;
  const clean = (value) => String(value ?? '').trim();
  const esc = (value) => clean(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const folded = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const studentName = (student) => [student?.apellido_paterno, student?.apellido_materno, student?.nombres].filter(Boolean).join(' ') || 'No registrado';
  const getFilter = (prefix, name) => $(`#${prefix}-filters [data-f="${name}"]`);
  const selectedText = (element) => element?.selectedOptions?.[0]?.textContent?.trim() || '';
  const responseData = (response, context) => {
    if (response.error) throw new Error(context, { cause: response.error });
    return response.data || [];
  };
  const formatCode = (value) => {
    const raw = clean(value).replace(/\.0+$/, '');
    return /^\d{1,12}$/.test(raw) ? raw.padStart(12, '0') : raw;
  };
  const isValidCode = (value) => /^\d{12}$/.test(value);
  const excelSafe = (value) => ({ t: 's', v: clean(value), z: '@' });

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal modal-blur fade" id="mass-import-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content excel-import-modal">
          <div class="modal-header">
            <div><h2 class="modal-title" id="mass-import-title">Importar Excel</h2><p class="modal-subtitle" id="mass-import-context"></p></div>
            <button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>
          <div class="modal-body">
            <div class="excel-import-steps" aria-label="Proceso de importación"><span class="active">1. Seleccionar</span><span>2. Validar</span><span>3. Revisar</span><span>4. Importar</span></div>
            <div class="excel-drop-zone" id="mass-import-drop-zone">
              <i class="ti ti-file-spreadsheet" aria-hidden="true"></i>
              <strong>Seleccione un archivo Excel</strong>
              <span>Formatos permitidos: .xlsx y .xls</span>
              <input class="form-control" id="mass-import-file" type="file" accept=".xlsx,.xls">
            </div>
            <div class="excel-import-help" id="mass-import-help"></div>
            <div class="excel-import-status d-none" id="mass-import-status"></div>
            <div class="d-none" id="mass-import-preview">
              <div class="excel-preview-summary" id="mass-import-summary"></div>
              <div class="table-responsive excel-preview-table"><table class="table table-vcenter table-sm"><thead id="mass-import-head"></thead><tbody id="mass-import-body"></tbody></table></div>
            </div>
          </div>
          <div class="modal-footer"><button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-outline-primary" id="mass-import-validate" type="button" disabled>Validar archivo</button><button class="btn btn-primary" id="mass-import-confirm" type="button" disabled>Confirmar importación</button></div>
        </div>
      </div>
    </div>`);

  const modalElement = $('#mass-import-modal');
  if (!modalElement || !window.tabler?.Modal) {
    console.error('[Excel] No fue posible inicializar el modal de importación.');
    return;
  }
  const modal = new window.tabler.Modal(modalElement);
  const importState = { type: null, context: null, rows: [], changes: [], valid: false };

  function feedback(prefix, message, good = true) {
    const element = $(`#${prefix}-feedback`);
    if (!element) return;
    element.textContent = message;
    element.className = `alert students-feedback ${good ? 'alert-success' : 'alert-danger'}`;
  }

  function setStatus(message, kind = 'info') {
    const element = $('#mass-import-status');
    element.className = `excel-import-status alert alert-${kind}`;
    element.innerHTML = message;
  }

  function setStep(step) {
    document.querySelectorAll('.excel-import-steps span').forEach((element, index) => element.classList.toggle('active', index < step));
  }

  function resetModal(type, context) {
    importState.type = type;
    importState.context = context;
    importState.rows = [];
    importState.changes = [];
    importState.valid = false;
    $('#mass-import-title').textContent = type === 'attendance' ? 'Importar asistencia' : 'Importar evaluaciones';
    $('#mass-import-context').textContent = `Carga masiva mediante archivo Excel compatible · ${context.summary}`;
    $('#mass-import-help').innerHTML = type === 'attendance'
      ? '<strong>Valores admitidos:</strong> . / A = Asistió · T = Tardanza · F / FNJ = Falta no justificada · J / FJ = Falta justificada · U = tardanza justificada (se considera asistencia).'
      : '<strong>Valores admitidos:</strong> AD, A, B y C. El año, aula, área, bimestre y las competencias deben coincidir completamente con la selección actual.';
    $('#mass-import-file').value = '';
    $('#mass-import-preview').classList.add('d-none');
    $('#mass-import-status').classList.add('d-none');
    $('#mass-import-confirm').disabled = true;
    $('#mass-import-validate').disabled = true;
    $('#mass-import-confirm').textContent = 'Confirmar importación';
    setStep(1);
  }

  function context(prefix) {
    const values = Object.fromEntries(['year', 'level', 'grade', 'room'].map((name) => [name, getFilter(prefix, name)?.value || '']));
    const labels = Object.fromEntries(['year', 'level', 'grade', 'room'].map((name) => [name, selectedText(getFilter(prefix, name))]));
    return { ...values, labels, roomId: Number(values.room) };
  }

  async function authorizedContext(type, ctx) {
    if (window.appContext?.currentRole !== 'DOCENTE') return true;
    const scope = await window.previEduTeacherScope.load();
    const classroom = scope.classrooms.find((item) => String(item.classroom.aula_id) === String(ctx.roomId));
    if (!classroom) return false;
    if (type === 'attendance') return true;
    return classroom.areas.some((area) => String(area.area_curricular_id) === String(ctx.area));
  }

  function attendanceContext(requireMonthly = true) {
    const value = context('attendance');
    value.view = getFilter('attendance', 'view')?.value;
    value.month = getFilter('attendance', 'month')?.value;
    if (!value.year || !value.level || !value.grade || !value.room || !window.appContext?.scope?.classroomIds?.map(String).includes(String(value.room)) || (requireMonthly && (value.view !== 'monthly' || !value.month))) return null;
    value.summary = `${value.labels.year} · ${value.labels.level} · ${value.labels.grade} ${value.labels.room} · ${value.month}`;
    return value;
  }

  function evaluationContext() {
    const value = context('evaluations');
    value.area = getFilter('evaluations', 'area')?.value || '';
    value.period = getFilter('evaluations', 'period')?.value || '';
    value.labels.area = selectedText(getFilter('evaluations', 'area')).split(' — ')[0];
    value.labels.period = selectedText(getFilter('evaluations', 'period'));
    if (!value.year || !value.level || !value.grade || !value.room || !value.area || !value.period || value.period === 'all' || !window.appContext?.scope?.classroomIds?.map(String).includes(String(value.room))) return null;
    value.summary = `${value.labels.year} · ${value.labels.level} · ${value.labels.grade} ${value.labels.room} · ${value.labels.area} · ${value.labels.period}`;
    return value;
  }

  async function enrollments(roomId) {
    return responseData(await db.from('matricula').select('matricula_id,estudiante(estudiante_id,codigo,dni,nombres,apellido_paterno,apellido_materno)').eq('aula_id', roomId).eq('estado', true), 'Matrículas')
      .sort((left, right) => studentName(one(left.estudiante)).localeCompare(studentName(one(right.estudiante))));
  }

  function addSheet(workbook, name, rows, widths = []) {
    const sheet = window.XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = widths.map((wch) => ({ wch }));
    window.XLSX.utils.book_append_sheet(workbook, sheet, name);
    return sheet;
  }

  function forceTextColumn(sheet, rowCount, column = 0) {
    for (let row = 1; row < rowCount; row += 1) {
      const address = window.XLSX.utils.encode_cell({ r: row, c: column });
      if (sheet[address]) sheet[address] = excelSafe(sheet[address].v);
    }
  }

  function metadataRows(data) {
    return [['CAMPO', 'VALOR'], ...Object.entries(data).map(([key, value]) => [key, clean(value)])];
  }

  function monthDates(month) {
    const [year, monthNumber] = month.split('-').map(Number);
    const count = new Date(year, monthNumber, 0).getDate();
    return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  }

  async function downloadAttendance() {
    const ctx = attendanceContext();
    if (!ctx) return feedback('attendance', 'Seleccione la vista mensual, el aula y el mes antes de descargar la plantilla.', false);
    try {
      if (!await authorizedContext('attendance', ctx)) return feedback('attendance', 'No tienes una asignación activa para registrar asistencia en esta aula.', false);
      const rows = await enrollments(ctx.roomId);
      const dates = monthDates(ctx.month);
      const ids = rows.map((item) => item.matricula_id);
      const records = ids.length ? responseData(await db.from('asistencia').select('matricula_id,fecha,estado_asistencia(codigo)').in('matricula_id', ids).gte('fecha', dates[0]).lte('fecha', dates.at(-1)), 'Asistencia') : [];
      const recordMap = new Map(records.map((item) => [`${item.matricula_id}|${item.fecha}`, one(item.estado_asistencia)?.codigo || '']));
      const dataRows = [['codigo', 'documento', 'apellidos_nombres', ...dates.map((date) => date.slice(-2))], ...rows.map((item) => {
        const student = one(item.estudiante);
        return [formatCode(student?.codigo), clean(student?.dni), studentName(student), ...dates.map((date) => recordMap.get(`${item.matricula_id}|${date}`) || '')];
      })];
      const workbook = window.XLSX.utils.book_new();
      const sheet = addSheet(workbook, 'Asistencia', dataRows, [16, 14, 38, ...dates.map(() => 5)]);
      forceTextColumn(sheet, dataRows.length);
      addSheet(workbook, 'Metadatos', metadataRows({ TIPO: 'ASISTENCIA', ANIO_ESCOLAR: ctx.labels.year, NIVEL: ctx.labels.level, GRADO: ctx.labels.grade, SECCION: ctx.labels.room, AULA_ID: ctx.room, MES: ctx.month }), [24, 35]);
      window.XLSX.writeFile(workbook, `PREVI-EDU_Asistencia_${ctx.labels.grade}_${ctx.labels.room}_${ctx.month}.xlsx`);
      feedback('attendance', 'Plantilla de asistencia generada correctamente.');
    } catch (error) {
      console.error('[Excel Asistencia] Plantilla', error.cause || error);
      feedback('attendance', 'No se pudo generar la plantilla.', false);
    }
  }

  async function evaluationData(ctx) {
    const [studentRows, areaLevelsResponse, roomAreaResponse] = await Promise.all([
      enrollments(ctx.roomId),
      db.from('area_curricular_nivel').select('area_curricular_nivel_id,nivel_id,area_curricular_id').eq('nivel_id', Number(ctx.level)).eq('area_curricular_id', Number(ctx.area)).limit(1),
      db.from('aula_area_curricular').select('aula_area_curricular_id,area_curricular_nivel_id').eq('aula_id', ctx.roomId).eq('estado', true)
    ]);
    const relation = responseData(areaLevelsResponse, 'Área curricular por nivel')[0];
    if (!relation) throw new Error('El área no corresponde al nivel seleccionado.');
    const roomAreas = responseData(roomAreaResponse, 'Áreas del aula');
    if (!roomAreas.some((item) => String(item.area_curricular_nivel_id) === String(relation.area_curricular_nivel_id))) throw new Error('El área no está activa en el aula seleccionada.');
    const competencies = responseData(await db.from('competencia').select('competencia_id,nombre,orden').eq('area_curricular_nivel_id', relation.area_curricular_nivel_id).eq('estado', true).order('orden'), 'Competencias');
    return { studentRows, competencies };
  }

  async function downloadEvaluations() {
    const ctx = evaluationContext();
    if (!ctx) return feedback('evaluations', 'Seleccione un bimestre específico y consulte la matriz antes de descargar la plantilla.', false);
    try {
      if (!await authorizedContext('evaluations', ctx)) return feedback('evaluations', 'No tienes asignada esta área curricular en el aula seleccionada.', false);
      const { studentRows, competencies } = await evaluationData(ctx);
      const ids = studentRows.map((item) => item.matricula_id);
      const competenceIds = competencies.map((item) => item.competencia_id);
      const grades = ids.length && competenceIds.length ? responseData(await db.from('calificacion').select('matricula_id,competencia_id,calificacion_literal(codigo)').in('matricula_id', ids).eq('periodo_id', Number(ctx.period)).in('competencia_id', competenceIds), 'Calificaciones') : [];
      const gradeMap = new Map(grades.map((item) => [`${item.matricula_id}|${item.competencia_id}`, one(item.calificacion_literal)?.codigo || '']));
      const headers = competencies.map((item) => `competencia_${item.competencia_id} | ${item.nombre}`);
      const dataRows = [['codigo', 'documento', 'apellidos_nombres', ...headers], ...studentRows.map((item) => {
        const student = one(item.estudiante);
        return [formatCode(student?.codigo), clean(student?.dni), studentName(student), ...competencies.map((competence) => gradeMap.get(`${item.matricula_id}|${competence.competencia_id}`) || '')];
      })];
      const workbook = window.XLSX.utils.book_new();
      const sheet = addSheet(workbook, 'Evaluaciones', dataRows, [16, 14, 38, ...competencies.map(() => 32)]);
      forceTextColumn(sheet, dataRows.length);
      addSheet(workbook, 'Metadatos', metadataRows({ TIPO: 'EVALUACIONES', ANIO_ESCOLAR: ctx.labels.year, NIVEL: ctx.labels.level, GRADO: ctx.labels.grade, SECCION: ctx.labels.room, AULA_ID: ctx.room, AREA_CURRICULAR: ctx.labels.area, AREA_CURRICULAR_ID: ctx.area, BIMESTRE: ctx.labels.period, PERIODO_ID: ctx.period }), [24, 42]);
      window.XLSX.writeFile(workbook, `PREVI-EDU_Evaluaciones_${ctx.labels.area}_${ctx.labels.period}.xlsx`);
      feedback('evaluations', 'Plantilla de evaluaciones generada correctamente.');
    } catch (error) {
      console.error('[Excel Evaluaciones] Plantilla', error.cause || error);
      feedback('evaluations', 'No se pudo generar la plantilla.', false);
    }
  }

  function workbookRows(workbook, sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`No se encontró la hoja ${sheetName}.`);
    return window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }).filter((row) => row.some((cell) => clean(cell)));
  }

  function workbookMetadata(workbook) {
    if (!workbook.Sheets.Metadatos) return {};
    return Object.fromEntries(window.XLSX.utils.sheet_to_json(workbook.Sheets.Metadatos, { header: 1, defval: '', raw: false }).slice(1).filter((row) => clean(row[0])).map((row) => [folded(row[0]), clean(row[1])]));
  }

  function validateMetadata(metadata, expected, required) {
    if (!Object.keys(metadata).length) return required ? ['La hoja Metadatos es obligatoria.'] : [];
    return Object.entries(expected).filter(([key, value]) => clean(metadata[key]) !== clean(value)).map(([key, value]) => `El contexto ${key.toLowerCase().replaceAll('_', ' ')} no coincide (esperado: ${clean(value)}, archivo: ${clean(metadata[key]) || 'sin dato'}).`);
  }

  function normalizeAttendance(value) {
    const code = folded(value);
    return ({ '.': 'A', A: 'A', U: 'A', T: 'T', F: 'FNJ', FNJ: 'FNJ', J: 'FJ', FJ: 'FJ' })[code] || (code ? null : '');
  }

  async function executeBatches(factories, size = 25) {
    const responses = [];
    for (let index = 0; index < factories.length; index += size) {
      responses.push(...await Promise.all(factories.slice(index, index + size).map((factory) => factory())));
    }
    return responses;
  }

  function preview(rows, headers, summary, valid) {
    $('#mass-import-head').innerHTML = `<tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr>`;
    $('#mass-import-body').innerHTML = rows.map((row) => `<tr>${row.cells.map((cell) => `<td>${esc(cell) || '—'}</td>`).join('')}<td><span class="badge ${row.valid ? 'bg-green-lt' : 'bg-red-lt'}">${row.valid ? 'Válido' : 'Error'}</span>${row.messages.length ? `<small class="excel-row-message">${esc(row.messages.join(' '))}</small>` : ''}</td></tr>`).join('');
    $('#mass-import-summary').innerHTML = summary;
    $('#mass-import-preview').classList.remove('d-none');
    $('#mass-import-confirm').disabled = !valid;
    $('#mass-import-confirm').textContent = importState.type === 'attendance' ? 'Importar asistencia' : 'Importar evaluaciones';
    importState.valid = valid;
    setStep(3);
  }

  async function validateAttendance(workbook, ctx) {
    const matrix = workbookRows(workbook, 'Asistencia');
    const headers = matrix[0].map(clean);
    const dates = monthDates(ctx.month);
    const dayHeaders = headers.slice(3);
    const errors = validateMetadata(workbookMetadata(workbook), { ANIO_ESCOLAR: ctx.labels.year, NIVEL: ctx.labels.level, GRADO: ctx.labels.grade, SECCION: ctx.labels.room, AULA_ID: ctx.room, MES: ctx.month }, false);
    if (folded(headers[0]) !== 'CODIGO' || folded(headers[1]) !== 'DOCUMENTO' || folded(headers[2]) !== 'APELLIDOS_NOMBRES') errors.push('La estructura de columnas no corresponde a la plantilla de asistencia.');
    const validDays = new Set(dates.map((date) => date.slice(-2)));
    const normalizedDays = dayHeaders.map((day) => String(day).padStart(2, '0'));
    if (normalizedDays.join(',') !== dates.map((date) => date.slice(-2)).join(',') || normalizedDays.some((day) => !validDays.has(day))) errors.push('Las columnas de días no corresponden completamente al mes seleccionado.');
    const studentRows = await enrollments(ctx.roomId);
    const studentMap = new Map(studentRows.map((item) => [formatCode(one(item.estudiante)?.codigo), item]));
    const documentMap = new Map(studentRows.filter((item) => clean(one(item.estudiante)?.dni)).map((item) => [clean(one(item.estudiante).dni), item]));
    const enrollmentIds = studentRows.map((item) => item.matricula_id);
    const existingRecords = enrollmentIds.length ? responseData(await db.from('asistencia').select('matricula_id,fecha').in('matricula_id', enrollmentIds).gte('fecha', dates[0]).lte('fecha', dates.at(-1)), 'Asistencia existente') : [];
    const existingKeys = new Set(existingRecords.map((item) => `${item.matricula_id}|${item.fecha}`));
    const seen = new Set();
    const previewRows = [];
    const changes = [];
    matrix.slice(1).forEach((source, index) => {
      if (!source.some((cell) => clean(cell))) return;
      const code = formatCode(source[0]);
      const document = clean(source[1]).replace(/\.0+$/, '');
      const enrollment = studentMap.get(code);
      const messages = [];
      const notes = [];
      if (!isValidCode(code) && !enrollment) messages.push('Código inválido: debe tener 12 dígitos.');
      if (seen.has(code)) messages.push('Código duplicado en el archivo.');
      seen.add(code);
      if (!enrollment) messages.push('El estudiante no pertenece al aula seleccionada.');
      const student = one(enrollment?.estudiante);
      const documentOwner = documentMap.get(document);
      if (document && ((clean(student?.dni) && document !== clean(student.dni)) || (documentOwner && documentOwner !== enrollment))) messages.push('Inconsistencia en la identificación del estudiante.');
      dayHeaders.forEach((header, dayIndex) => {
        const normalized = normalizeAttendance(source[dayIndex + 3]);
        if (normalized === null) messages.push(`Valor no permitido en el día ${header}.`);
        if (normalized && enrollment) {
          const day = String(header).padStart(2, '0');
          const date = `${ctx.month}-${day}`;
          const utc = new Date(`${date}T00:00:00Z`);
          if (![0, 6].includes(utc.getUTCDay()) || existingKeys.has(`${enrollment.matricula_id}|${date}`)) changes.push({ matricula_id: enrollment.matricula_id, fecha: date, codigo: normalized, row: index + 2 });
          else notes.push(`Día ${day} omitido por no corresponder a un día procesable.`);
        }
      });
      previewRows.push({ valid: !messages.length, messages: [...messages, ...notes], cells: [index + 2, code, studentName(student || { nombres: source[2] }), document] });
    });
    if (!previewRows.length) errors.push('El archivo no contiene estudiantes.');
    if (errors.length) previewRows.unshift({ valid: false, messages: errors, cells: ['—', 'Archivo', 'Contexto o estructura incompatible', '—'] });
    importState.rows = previewRows;
    importState.changes = changes;
    const invalid = previewRows.filter((row) => !row.valid).length;
    const observations = previewRows.filter((row) => row.valid && row.messages.length).length;
    preview(previewRows, ['Fila', 'Código', 'Estudiante', 'Documento', 'Validación'], `${previewRows.length - (errors.length ? 1 : 0)} estudiantes revisados · ${changes.length} registros de asistencia preparados · ${observations} con observación · ${invalid} con error`, !invalid && changes.length > 0);
    setStatus(!invalid ? 'Archivo compatible con el contexto seleccionado.' : 'Archivo incompatible. Corrija los errores indicados antes de importar.', !invalid ? 'success' : 'danger');
  }

  function competenceId(header) {
    const match = clean(header).match(/^competencia_(\d+)\s*\|/i);
    return match ? Number(match[1]) : null;
  }

  async function validateEvaluations(workbook, ctx) {
    const matrix = workbookRows(workbook, 'Evaluaciones');
    const headers = matrix[0].map(clean);
    const metadata = workbookMetadata(workbook);
    const errors = validateMetadata(metadata, { ANIO_ESCOLAR: ctx.labels.year, NIVEL: ctx.labels.level, GRADO: ctx.labels.grade, SECCION: ctx.labels.room, AULA_ID: ctx.room, AREA_CURRICULAR: ctx.labels.area, AREA_CURRICULAR_ID: ctx.area, BIMESTRE: ctx.labels.period, PERIODO_ID: ctx.period }, true);
    if (folded(headers[0]) !== 'CODIGO' || folded(headers[1]) !== 'DOCUMENTO' || folded(headers[2]) !== 'APELLIDOS_NOMBRES') errors.push('La estructura de columnas no corresponde a la plantilla de evaluaciones.');
    const { studentRows, competencies } = await evaluationData(ctx);
    const expectedIds = competencies.map((item) => item.competencia_id).sort((a, b) => a - b);
    const suppliedIds = headers.slice(3).map(competenceId);
    if (suppliedIds.some((id) => !id) || suppliedIds.slice().sort((a, b) => a - b).join(',') !== expectedIds.join(',')) {
      const expectedNames = competencies.map((item) => item.nombre).join(' | ') || 'ninguna';
      const suppliedNames = headers.slice(3).map((header) => clean(header).replace(/^competencia_\d+\s*\|\s*/i, '')).filter(Boolean).join(' | ') || 'ninguna';
      errors.push(`Las competencias no corresponden al área seleccionada. Esperadas: ${expectedNames}. Encontradas: ${suppliedNames}.`);
    }
    const competenceMap = new Map(competencies.map((item) => [item.competencia_id, item]));
    headers.slice(3).forEach((header, index) => {
      const id = suppliedIds[index];
      const visibleName = clean(header).replace(/^competencia_\d+\s*\|\s*/i, '');
      if (id && competenceMap.has(id) && folded(visibleName).replace(/\s+/g, ' ') !== folded(competenceMap.get(id).nombre).replace(/\s+/g, ' ')) errors.push(`El nombre visible de la competencia ${id} no coincide.`);
    });
    const studentMap = new Map(studentRows.map((item) => [formatCode(one(item.estudiante)?.codigo), item]));
    const documentMap = new Map(studentRows.filter((item) => clean(one(item.estudiante)?.dni)).map((item) => [clean(one(item.estudiante).dni), item]));
    const seen = new Set();
    const previewRows = [];
    const changes = [];
    matrix.slice(1).forEach((source, index) => {
      if (!source.some((cell) => clean(cell))) return;
      const code = formatCode(source[0]);
      const document = clean(source[1]).replace(/\.0+$/, '');
      const enrollment = studentMap.get(code);
      const messages = [];
      if (!isValidCode(code) && !enrollment) messages.push('Código inválido: debe tener 12 dígitos.');
      if (seen.has(code)) messages.push('Código duplicado en el archivo.');
      seen.add(code);
      if (!enrollment) messages.push('El estudiante no pertenece al aula seleccionada.');
      const student = one(enrollment?.estudiante);
      const documentOwner = documentMap.get(document);
      if (document && ((clean(student?.dni) && document !== clean(student.dni)) || (documentOwner && documentOwner !== enrollment))) messages.push('Inconsistencia en la identificación del estudiante.');
      suppliedIds.forEach((id, competenceIndex) => {
        const value = folded(source[competenceIndex + 3]);
        if (value && !['AD', 'A', 'B', 'C'].includes(value)) messages.push(`Calificación no permitida en la competencia ${id || '?'}.`);
        if (value && id && enrollment) changes.push({ matricula_id: enrollment.matricula_id, periodo_id: Number(ctx.period), competencia_id: id, codigo: value, row: index + 2 });
      });
      previewRows.push({ valid: !messages.length, messages, cells: [index + 2, code, studentName(student || { nombres: source[2] }), document] });
    });
    if (!previewRows.length) errors.push('El archivo no contiene estudiantes.');
    if (errors.length) previewRows.unshift({ valid: false, messages: errors, cells: ['—', 'Archivo', 'Contexto o estructura incompatible', '—'] });
    importState.rows = previewRows;
    importState.changes = changes;
    const invalid = previewRows.filter((row) => !row.valid).length;
    preview(previewRows, ['Fila', 'Código', 'Estudiante', 'Documento', 'Validación'], `${previewRows.length - (errors.length ? 1 : 0)} estudiantes revisados · ${changes.length} calificaciones preparadas · ${invalid} filas con observaciones`, !invalid && changes.length > 0);
    setStatus(!invalid ? 'Archivo compatible con el contexto seleccionado.' : 'Archivo incompatible. Corrija los errores indicados antes de importar.', !invalid ? 'success' : 'danger');
  }

  async function readFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) return setStatus('Seleccione un archivo con extensión .xlsx o .xls.', 'danger');
    setStep(2);
    setStatus('<span class="spinner-border spinner-border-sm me-2"></span>Validando archivo...', 'info');
    $('#mass-import-confirm').disabled = true;
    $('#mass-import-preview').classList.add('d-none');
    try {
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      if (importState.type === 'attendance') await validateAttendance(workbook, importState.context);
      else await validateEvaluations(workbook, importState.context);
    } catch (error) {
      console.error('[Excel] Validación', error.cause || error);
      setStatus('El archivo no es compatible con la plantilla o no pudo ser leído.', 'danger');
      setStep(2);
    }
  }

  async function importAttendance() {
    const changes = importState.changes;
    const statuses = responseData(await db.from('estado_asistencia').select('estado_asistencia_id,codigo').in('codigo', ['A', 'T', 'FJ', 'FNJ']), 'Estados de asistencia');
    const ids = [...new Set(changes.map((item) => item.matricula_id))];
    const dates = changes.map((item) => item.fecha).sort();
    const existing = responseData(await db.from('asistencia').select('asistencia_id,matricula_id,fecha').in('matricula_id', ids).gte('fecha', dates[0]).lte('fecha', dates.at(-1)), 'Asistencia existente');
    const existingMap = new Map(existing.map((item) => [`${item.matricula_id}|${item.fecha}`, item]));
    const now = new Date().toISOString();
    const responses = await executeBatches(changes.map((item) => () => {
      const old = existingMap.get(`${item.matricula_id}|${item.fecha}`);
      const status = statuses.find((entry) => entry.codigo === item.codigo);
      if (!status) return Promise.resolve({ error: new Error(`Estado ${item.codigo} no disponible.`) });
      const payload = { matricula_id: item.matricula_id, fecha: item.fecha, estado_asistencia_id: status.estado_asistencia_id, observacion: null, fecha_actualizacion: now };
      return old ? db.from('asistencia').update(payload).eq('asistencia_id', old.asistencia_id) : db.from('asistencia').insert({ ...payload, fecha_registro: now });
    }));
    const failed = responses.filter((response) => response.error);
    if (failed.length) throw new Error('No se importaron todos los registros.', { cause: failed[0].error });
    return changes.length;
  }

  async function importEvaluations() {
    const changes = importState.changes;
    const literals = responseData(await db.from('calificacion_literal').select('calificacion_literal_id,codigo').in('codigo', ['AD', 'A', 'B', 'C']), 'Calificaciones literales');
    const ids = [...new Set(changes.map((item) => item.matricula_id))];
    const competenceIds = [...new Set(changes.map((item) => item.competencia_id))];
    const existing = responseData(await db.from('calificacion').select('calificacion_id,matricula_id,periodo_id,competencia_id').in('matricula_id', ids).eq('periodo_id', Number(importState.context.period)).in('competencia_id', competenceIds), 'Calificaciones existentes');
    const existingMap = new Map(existing.map((item) => [`${item.matricula_id}|${item.periodo_id}|${item.competencia_id}`, item]));
    const now = new Date().toISOString();
    const responses = await executeBatches(changes.map((item) => () => {
      const old = existingMap.get(`${item.matricula_id}|${item.periodo_id}|${item.competencia_id}`);
      const literal = literals.find((entry) => entry.codigo === item.codigo);
      if (!literal) return Promise.resolve({ error: new Error(`Calificación ${item.codigo} no disponible.`) });
      const payload = { matricula_id: item.matricula_id, periodo_id: item.periodo_id, competencia_id: item.competencia_id, calificacion_literal_id: literal.calificacion_literal_id, fecha_actualizacion: now };
      return old ? db.from('calificacion').update(payload).eq('calificacion_id', old.calificacion_id) : db.from('calificacion').insert({ ...payload, fecha_registro: now });
    }));
    const failed = responses.filter((response) => response.error);
    if (failed.length) throw new Error('No se importaron todas las calificaciones.', { cause: failed[0].error });
    return changes.length;
  }

  async function confirmImport() {
    if (!importState.valid || !importState.changes.length) return;
    const button = $('#mass-import-confirm');
    button.disabled = true;
    button.textContent = 'Importando...';
    setStep(4);
    setStatus('<span class="spinner-border spinner-border-sm me-2"></span>Importando información...', 'info');
    try {
      if (!await authorizedContext(importState.type, importState.context)) {
        setStatus(importState.type === 'attendance' ? 'No tienes una asignación activa para registrar asistencia en esta aula.' : 'No tienes asignada esta área curricular en el aula seleccionada.', 'danger');
        button.disabled = false;
        button.textContent = 'Confirmar importación';
        return;
      }
      const count = importState.type === 'attendance' ? await importAttendance() : await importEvaluations();
      const prefix = importState.type === 'attendance' ? 'attendance' : 'evaluations';
      modal.hide();
      const queryButton = $(`#${prefix}-query`);
      if (typeof queryButton?.onclick === 'function') await queryButton.onclick();
      feedback(prefix, `${count} ${importState.type === 'attendance' ? 'registros de asistencia importados' : 'calificaciones importadas'} correctamente.`);
    } catch (error) {
      console.error('[Excel] Importación', error.cause || error);
      setStatus('No se pudo completar la importación.', 'danger');
      button.disabled = false;
      button.textContent = 'Confirmar importación';
    }
  }

  async function openAttendanceImport() {
    const ctx = attendanceContext();
    if (!ctx) return feedback('attendance', 'Seleccione la vista mensual, el aula y el mes antes de importar.', false);
    if (!await authorizedContext('attendance', ctx)) return feedback('attendance', 'No tienes una asignación activa para registrar asistencia en esta aula.', false);
    resetModal('attendance', ctx);
    modal.show();
  }

  async function openEvaluationsImport() {
    const ctx = evaluationContext();
    if (!ctx) return feedback('evaluations', 'Seleccione un bimestre específico antes de importar.', false);
    if (!await authorizedContext('evaluations', ctx)) return feedback('evaluations', 'No tienes asignada esta área curricular en el aula seleccionada.', false);
    resetModal('evaluations', ctx);
    modal.show();
  }

  function mountActions() {
    const attendanceActions = $('#attendance-results .compact-actions');
    if (attendanceActions && !$('#attendance-template')) {
      attendanceActions.insertAdjacentHTML('afterbegin', '<button class="btn btn-outline-secondary btn-sm excel-action" id="attendance-template" type="button"><i class="ti ti-download"></i> Descargar plantilla</button><button class="btn btn-outline-primary btn-sm excel-action" id="attendance-import" type="button"><i class="ti ti-file-upload"></i> Importar Excel</button>');
      $('#attendance-template').onclick = downloadAttendance;
      $('#attendance-import').onclick = openAttendanceImport;
    }
    const evaluationHeader = $('#evaluations-results .compact-results-header');
    if (evaluationHeader && !$('#evaluations-template')) {
      const save = $('#evaluations-save');
      const actions = document.createElement('div');
      actions.className = 'compact-actions';
      actions.innerHTML = '<button class="btn btn-outline-secondary btn-sm excel-action" id="evaluations-template" type="button"><i class="ti ti-download"></i> Descargar plantilla</button><button class="btn btn-outline-primary btn-sm excel-action" id="evaluations-import" type="button"><i class="ti ti-file-upload"></i> Importar Excel</button>';
      if (save) actions.append(save);
      evaluationHeader.append(actions);
      $('#evaluations-template').onclick = downloadEvaluations;
      $('#evaluations-import').onclick = openEvaluationsImport;
    }
    updateActionAvailability();
  }

  function updateActionAvailability() {
    const attendanceReady = Boolean(attendanceContext());
    const evaluationReady = Boolean(evaluationContext());
    ['attendance-template', 'attendance-import'].forEach((id) => { if ($(`#${id}`)) $(`#${id}`).disabled = !attendanceReady; });
    ['evaluations-template', 'evaluations-import'].forEach((id) => { if ($(`#${id}`)) $(`#${id}`).disabled = !evaluationReady; });
  }

  $('#mass-import-file').addEventListener('change', () => {
    $('#mass-import-preview').classList.add('d-none');
    $('#mass-import-status').classList.add('d-none');
    $('#mass-import-confirm').disabled = true;
    $('#mass-import-validate').disabled = !$('#mass-import-file').files[0];
    setStep(1);
  });
  $('#mass-import-validate').onclick = () => readFile($('#mass-import-file').files[0]);
  $('#mass-import-confirm').onclick = confirmImport;
  modalElement.addEventListener('hidden.bs.modal', () => { $('#mass-import-file').value = ''; });
  mountActions();
  ['attendance-filters', 'evaluations-filters'].forEach((id) => $(`#${id}`)?.addEventListener('change', () => setTimeout(updateActionAvailability)));
  ['attendance-query', 'evaluations-query'].forEach((id) => $(`#${id}`)?.addEventListener('click', () => setTimeout(updateActionAvailability, 250)));
  if (window.appContext?.currentRole === 'DOCENTE') window.addEventListener('previ:institution-change', () => { importState.valid = false; importState.context = null; importState.rows = []; importState.changes = []; modal.hide(); updateActionAvailability(); });
})();
