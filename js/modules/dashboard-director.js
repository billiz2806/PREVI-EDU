'use strict';

(() => {
  const currentUser = window.previEduCurrentUser;

  if (!currentUser || currentUser.role !== 'DIRECTOR') {
    return;
  }

  const client = window.supabaseClient;
  const scope = window.appContext.scope;
  const dashboard = document.querySelector('#dashboard-director');
  const MONTHS = [
    { number: 3, name: 'Marzo' },
    { number: 4, name: 'Abril' },
    { number: 5, name: 'Mayo' },
    { number: 6, name: 'Junio' },
    { number: 7, name: 'Julio' },
    { number: 8, name: 'Agosto' }
  ];

  dashboard.classList.remove('d-none');

  function assertResponse(response, context) {
    if (response.error) {
      throw new Error(context, { cause: response.error });
    }

    return response;
  }

  function logError(context, error) {
    console.error(`[Dashboard Director] ${context}`, error.cause || error);
  }

  function setIndicator(id, value) {
    const element = document.querySelector(id);
    element.textContent = value ?? 'No hay información disponible.';
  }

  function setIndicatorError(id, context, error) {
    logError(context, error);
    setIndicator(id, 'No disponible');
    document.querySelector(id).classList.add('indicator-error');
  }

  async function getCatalogRows(table, idColumn, codes) {
    const response = await client
      .from(table)
      .select(`${idColumn}, codigo`)
      .in('codigo', codes);

    return assertResponse(response, `No se pudo consultar ${table}.`).data || [];
  }

  async function getExactCount(table, configureQuery) {
    let query = client.from(table).select('*', { count: 'exact', head: true });
    query = configureQuery ? configureQuery(query) : query;
    const response = assertResponse(await query, `No se pudo contar ${table}.`);
    return Number.isFinite(response.count) ? response.count : 0;
  }

  async function loadStudentsIndicator() {
    try {
      const count = scope.enrollmentIds.length;
      setIndicator('#indicator-students', count.toLocaleString('es-PE'));
    } catch (error) {
      setIndicatorError('#indicator-students', 'Error al cargar estudiantes.', error);
    }
  }

  async function loadAlertsIndicator() {
    try {
      const states = await getCatalogRows('estado_alerta', 'estado_alerta_id', ['NUEVA', 'SEGUIMIENTO']);
      const ids = states.map((state) => state.estado_alerta_id);
      const count = ids.length && scope.alertIds.length
        ? await getExactCount('alerta', (query) => query.in('alerta_id', scope.alertIds).in('estado_alerta_id', ids))
        : 0;
      setIndicator('#indicator-alerts', count.toLocaleString('es-PE'));
    } catch (error) {
      setIndicatorError('#indicator-alerts', 'Error al cargar alertas activas.', error);
    }
  }

  async function loadRiskIndicator() {
    try {
      const levels = await getCatalogRows('nivel_riesgo', 'nivel_riesgo_id', ['MEDIO', 'ALTO']);
      const ids = levels.map((level) => level.nivel_riesgo_id);
      const count = ids.length && scope.analysisIds.length
        ? await getExactCount('analisis_riesgo', (query) => query.in('analisis_riesgo_id', scope.analysisIds).in('nivel_riesgo_id', ids))
        : 0;
      setIndicator('#indicator-risk', count.toLocaleString('es-PE'));
    } catch (error) {
      setIndicatorError('#indicator-risk', 'Error al cargar estudiantes en riesgo.', error);
    }
  }

  async function getAttendanceStateId() {
    const response = await client
      .from('estado_asistencia')
      .select('estado_asistencia_id')
      .eq('codigo', 'A')
      .maybeSingle();

    return assertResponse(response, 'No se pudo consultar el estado de asistencia.').data?.estado_asistencia_id;
  }

  async function loadAttendanceIndicator() {
    try {
      const attendanceStateId = await getAttendanceStateId();
      const total = scope.enrollmentIds.length ? await getExactCount('asistencia', (query) => query.in('matricula_id', scope.enrollmentIds)) : 0;

      if (!attendanceStateId || total === 0) {
        setIndicator('#indicator-attendance', null);
        return;
      }

      const attended = await getExactCount(
        'asistencia',
        (query) => query.in('matricula_id', scope.enrollmentIds).eq('estado_asistencia_id', attendanceStateId)
      );
      const percentage = (attended / total) * 100;
      setIndicator('#indicator-attendance', `${percentage.toFixed(1)}%`);
    } catch (error) {
      setIndicatorError('#indicator-attendance', 'Error al cargar asistencia promedio.', error);
    }
  }

  function showSectionMessage(loadingId, messageId, message) {
    document.querySelector(loadingId).classList.add('d-none');
    const messageElement = document.querySelector(messageId);
    messageElement.textContent = message;
    messageElement.classList.remove('d-none');
  }

  async function loadRiskChart() {
    try {
      const levels = await getCatalogRows('nivel_riesgo', 'nivel_riesgo_id', ['BAJO', 'MEDIO', 'ALTO']);
      const levelByCode = new Map(levels.map((level) => [level.codigo, level.nivel_riesgo_id]));
      const values = await Promise.all(
        ['BAJO', 'MEDIO', 'ALTO'].map((code) => {
          const id = levelByCode.get(code);
          return id ? getExactCount('analisis_riesgo', (query) => query.in('analisis_riesgo_id', scope.analysisIds).eq('nivel_riesgo_id', id)) : 0;
        })
      );

      document.querySelector('#risk-chart-loading').classList.add('d-none');

      if (values.every((value) => value === 0)) {
        showSectionMessage('#risk-chart-loading', '#risk-chart-message', 'No hay información disponible.');
        return;
      }

      const chart = new ApexCharts(document.querySelector('#risk-chart'), {
        chart: { type: 'donut', height: 275, toolbar: { show: false } },
        series: values,
        labels: ['Bajo', 'Medio', 'Alto'],
        colors: ['#58a782', '#e0ae52', '#df796d'],
        legend: { position: 'bottom' },
        dataLabels: { enabled: false },
        stroke: { colors: ['#ffffff'], width: 3 },
        plotOptions: { pie: { donut: { size: '68%' } } }
      });
      await chart.render();
    } catch (error) {
      logError('Error al cargar la distribución de riesgo.', error);
      showSectionMessage('#risk-chart-loading', '#risk-chart-message', 'No se pudo cargar la información.');
    }
  }

  function dateString(year, month, day = 1) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  async function getMonthlyAttendance(year, month, attendanceStateId) {
    if (!scope.enrollmentIds.length) return null;
    const start = dateString(year, month);
    const nextMonth = month === 12 ? dateString(year + 1, 1) : dateString(year, month + 1);
    const dateFilter = (query) => query.in('matricula_id', scope.enrollmentIds).gte('fecha', start).lt('fecha', nextMonth);
    const total = await getExactCount('asistencia', dateFilter);

    if (total === 0) {
      return null;
    }

    const attended = await getExactCount(
      'asistencia',
      (query) => dateFilter(query).eq('estado_asistencia_id', attendanceStateId)
    );
    return Number(((attended / total) * 100).toFixed(1));
  }

  async function loadAttendanceChart() {
    try {
      if (!scope.enrollmentIds.length) {
        showSectionMessage('#attendance-chart-loading', '#attendance-chart-message', 'No hay información disponible.');
        return;
      }
      const attendanceStateId = await getAttendanceStateId();
      const latestResponse = assertResponse(
        await client.from('asistencia').select('fecha').in('matricula_id', scope.enrollmentIds).order('fecha', { ascending: false }).limit(1).maybeSingle(),
        'No se pudo obtener el periodo de asistencia.'
      );
      const latestDate = latestResponse.data?.fecha;

      if (!attendanceStateId || !latestDate) {
        showSectionMessage('#attendance-chart-loading', '#attendance-chart-message', 'No hay información disponible.');
        return;
      }

      const year = new Date(`${latestDate}T00:00:00`).getFullYear();
      const values = await Promise.all(
        MONTHS.map((month) => getMonthlyAttendance(year, month.number, attendanceStateId))
      );
      document.querySelector('#attendance-chart-loading').classList.add('d-none');

      if (values.every((value) => value === null)) {
        showSectionMessage('#attendance-chart-loading', '#attendance-chart-message', 'No hay información disponible.');
        return;
      }

      const chart = new ApexCharts(document.querySelector('#attendance-chart'), {
        chart: { type: 'line', height: 275, toolbar: { show: false }, zoom: { enabled: false } },
        series: [{ name: 'Asistencia', data: values }],
        colors: ['#4aa9c8'],
        stroke: { curve: 'smooth', width: 3 },
        markers: { size: 4 },
        xaxis: { categories: MONTHS.map((month) => month.name) },
        yaxis: {
          min: 0,
          max: 100,
          labels: { formatter: (value) => `${value.toFixed(0)}%` }
        },
        tooltip: { y: { formatter: (value) => Number.isFinite(value) ? `${value.toFixed(1)}%` : 'Sin datos' } },
        grid: { borderColor: '#e8eaf0' }
      });
      await chart.render();
    } catch (error) {
      logError('Error al cargar la asistencia mensual.', error);
      showSectionMessage('#attendance-chart-loading', '#attendance-chart-message', 'No se pudo cargar la información.');
    }
  }

  function relation(value) {
    return Array.isArray(value) ? value[0] : value;
  }

  function fullName(student) {
    if (!student) return 'No hay información disponible.';
    return [student.nombres, student.apellido_paterno, student.apellido_materno]
      .filter(Boolean)
      .join(' ') || 'No hay información disponible.';
  }

  function classroomName(classroom) {
    const grade = relation(classroom?.grado)?.nombre;
    const section = relation(classroom?.seccion)?.nombre;
    return [grade, section].filter(Boolean).join(' ') || 'No hay información disponible.';
  }

  function createBadge(text, className) {
    const badge = document.createElement('span');
    badge.className = `badge ${className}`;
    badge.textContent = text;
    return badge;
  }

  function appendTextCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value || 'No hay información disponible.';
    row.appendChild(cell);
  }

  function renderAttentionRows(analyses) {
    const body = document.querySelector('#attention-table-body');
    const riskPriority = { ALTO: 0, MEDIO: 1 };
    const uniqueStudents = new Set();

    const rows = analyses
      .sort((left, right) => {
        const riskDifference = riskPriority[relation(left.nivel_riesgo)?.codigo]
          - riskPriority[relation(right.nivel_riesgo)?.codigo];
        return riskDifference || String(right.fecha_analisis || '').localeCompare(String(left.fecha_analisis || ''));
      })
      .filter((analysis) => {
        const studentId = relation(analysis.matricula)?.estudiante_id;
        if (!studentId || uniqueStudents.has(studentId)) return false;
        uniqueStudents.add(studentId);
        return true;
      })
      .slice(0, 5);

    if (rows.length === 0) {
      showSectionMessage('#attention-loading', '#attention-message', 'No hay información disponible.');
      return;
    }

    rows.forEach((analysis) => {
      const enrollment = relation(analysis.matricula);
      const student = relation(enrollment?.estudiante);
      const classroom = relation(enrollment?.aula);
      const risk = relation(analysis.nivel_riesgo)?.codigo || 'Sin información';
      const factors = analysis.factor_analisis_riesgo || [];
      const factor = factors[0]?.descripcion || factors[0]?.tipo_factor || 'No hay información disponible.';
      const alerts = analysis.alerta || [];
      const activeAlert = alerts.find((alert) => ['NUEVA', 'SEGUIMIENTO'].includes(relation(alert.estado_alerta)?.codigo));
      const status = relation((activeAlert || alerts[0])?.estado_alerta)?.codigo || 'Sin alerta';
      const row = document.createElement('tr');

      appendTextCell(row, fullName(student));
      appendTextCell(row, classroomName(classroom));

      const riskCell = document.createElement('td');
      riskCell.appendChild(createBadge(risk, risk === 'ALTO' ? 'risk-high' : 'risk-medium'));
      row.appendChild(riskCell);

      appendTextCell(row, factor);

      const statusClass = status === 'NUEVA'
        ? 'status-new'
        : status === 'SEGUIMIENTO' ? 'status-follow-up' : 'status-closed';
      const statusCell = document.createElement('td');
      statusCell.appendChild(createBadge(status, statusClass));
      row.appendChild(statusCell);
      body.appendChild(row);
    });

    document.querySelector('#attention-loading').classList.add('d-none');
    document.querySelector('#attention-table-wrapper').classList.remove('d-none');
  }

  async function loadAttentionTable() {
    try {
      if (!scope.enrollmentIds.length) {
        showSectionMessage('#attention-loading', '#attention-message', 'No hay información disponible.');
        return;
      }
      const levels = await getCatalogRows('nivel_riesgo', 'nivel_riesgo_id', ['MEDIO', 'ALTO']);
      const levelByCode = new Map(levels.map((level) => [level.codigo, level.nivel_riesgo_id]));

      if (levelByCode.size === 0) {
        showSectionMessage('#attention-loading', '#attention-message', 'No hay información disponible.');
        return;
      }

      const select = `
        analisis_riesgo_id,
        fecha_analisis,
        nivel_riesgo(codigo),
        matricula(
          estudiante_id,
          estudiante(nombres, apellido_paterno, apellido_materno),
          aula(grado(nombre), seccion(nombre))
        ),
        factor_analisis_riesgo(tipo_factor, descripcion),
        alerta(fecha_generacion, estado_alerta(codigo))
      `;
      const responses = await Promise.all(
        ['ALTO', 'MEDIO'].map(async (code) => {
          const id = levelByCode.get(code);
          if (!id) return [];
          const response = await client
            .from('analisis_riesgo')
            .select(select)
            .in('matricula_id', scope.enrollmentIds)
            .eq('nivel_riesgo_id', id)
            .order('fecha_analisis', { ascending: false })
            .limit(5);
          return assertResponse(response, `No se pudo consultar el riesgo ${code}.`).data || [];
        })
      );
      const analyses = responses.flat();
      renderAttentionRows(analyses);
    } catch (error) {
      logError('Error al cargar estudiantes que requieren atención.', error);
      showSectionMessage('#attention-loading', '#attention-message', 'No se pudo cargar la información.');
    }
  }

  Promise.allSettled([
    loadStudentsIndicator(),
    loadAttendanceIndicator(),
    loadAlertsIndicator(),
    loadRiskIndicator(),
    loadRiskChart(),
    loadAttendanceChart(),
    loadAttentionTable()
  ]);
})();
