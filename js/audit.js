/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo de Auditoría (js/audit.js)
   RF-100 .. RF-106 · Solo lectura · Exclusivo Administradores
   ═══════════════════════════════════════════════════════════════ */

const AuditModule = (() => {
  'use strict';

  // ─── Estado interno ────────────────────────────────────────
  let currentPage = 0;
  const pageSize = 50;
  let totalCount = 0;
  let filterTable = '';
  let filterActor = '';
  let filterFromDate = '';
  let filterToDate = '';
  let profilesList = [];

  // ─── Diccionarios de traducción (RF-105) ────────────────────
  const TABLAS = {
    medications: 'Medicamentos',
    inventory_items: 'Inventario',
    tasks: 'Tareas',
    shifts: 'Turnos',
    expenses: 'Gastos',
    medication_administrations: 'Dosis administradas',
    profiles: 'Usuarios',
    care_roles: 'Roles de cuidado',
    settings: 'Configuración',
    patient_status: 'Estado del paciente',
    shift_notes: 'Notas de turno',
    medication_schedules: 'Horarios de medicación',
    medication_restocks: 'Reposiciones de medicinas',
    inventory_categories: 'Categorías de inventario',
    inventory_movements: 'Movimientos de inventario',
    task_templates: 'Plantillas de tareas',
    task_comments: 'Comentarios de tareas',
    appointments: 'Citas médicas',
    recipes: 'Recetas',
    recipe_ingredients: 'Ingredientes de recetas',
    weekly_plan: 'Plan semanal',
    complementos: 'Complementos',
    complemento_ingredients: 'Ingredientes de complementos',
    shopping_list: 'Lista de compras',
    stock_items: 'Control de insumos',
    stock_checks: 'Revisiones de stock'
  };

  const CAMPOS = {
    current_stock: 'stock',
    full_name: 'nombre completo',
    task_date: 'fecha de tarea',
    needs_restock: 'marca de reposición',
    app_role: 'rol de permisos',
    phone: 'teléfono',
    active: 'activo',
    notes: 'notas',
    dose: 'dosis',
    time_of_day: 'hora programada',
    scheduled_date: 'fecha programada',
    scheduled_time: 'hora programada',
    administered_at: 'hora de administración',
    administered_by: 'administrado por',
    status: 'estado',
    title: 'título',
    description: 'descripción',
    amount: 'importe',
    cost: 'costo',
    establishment: 'establecimiento',
    category: 'categoría',
    unit: 'unidad',
    min_threshold: 'umbral mínimo',
    name: 'nombre',
    doctor: 'médico',
    specialty: 'especialidad',
    location: 'lugar / consultorio',
    appt_date: 'fecha de cita',
    appt_time: 'hora de cita',
    result_notes: 'resultado / observaciones',
    day_of_week: 'día de la semana',
    meal_type: 'tipo de comida',
    quantity: 'cantidad',
    patient_name: 'nombre del paciente',
    emergency_contact_name: 'contacto de emergencia',
    emergency_contact_phone: 'teléfono de emergencia',
    emergency_contact_whatsapp: 'whatsapp de emergencia',
    shift_type: 'tipo de turno',
    start_time: 'hora de inicio',
    end_time: 'hora de fin',
    checked: 'comprado',
    is_emergency: 'marca de urgencia',
    assigned_to: 'asignado a',
    category_id: 'categoría',
    care_role_id: 'rol de personal',
    weight_kg: 'peso (kg)',
    blood_pressure_sys: 'tensión sistólica',
    blood_pressure_dia: 'tensión diastólica',
    heart_rate: 'frecuencia cardíaca',
    temperature: 'temperatura',
    oxygen_saturation: 'saturación de oxígeno',
    target_stock: 'stock objetivo',
    priority: 'nivel de prioridad',
    last_checked_at: 'última revisión'
  };

  /**
   * Formatea un valor para presentación humana
   */
  const formatValue = (val) => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'boolean') return val ? 'Sí' : 'No';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  /**
   * Genera una descripción narrativa en lenguaje llano (RF-105)
   * Ejemplo: "María González cambió el stock de Gasas de 12 a 8 · Inventario · hace 2 horas"
   */
  const formatActionSentence = (entry) => {
    const actor = Api.escapeHtml(entry.actorName || 'Sistema');
    const tabla = TABLAS[entry.tableName] || entry.tableName;
    const oldV = entry.oldValues || {};
    const newV = entry.newValues || {};
    const changed = entry.changedFields || [];

    let sentence = '';

    if (entry.action === 'INSERT') {
      if (entry.tableName === 'medication_administrations') {
        const doseStr = newV.dose ? ` (${newV.dose})` : '';
        const st = newV.status;
        const stLabel = st === 'given' ? 'administrada' : (st === 'skipped' ? 'omitida' : (st === 'refused' ? 'rechazada' : st));
        sentence = `<strong>${actor}</strong> registró dosis como <strong>${stLabel}</strong>${doseStr}`;
      } else if (entry.tableName === 'medications') {
        const medName = newV.name ? ` "${Api.escapeHtml(newV.name)}"` : '';
        sentence = `<strong>${actor}</strong> dio de alta el medicamento${medName}`;
      } else if (entry.tableName === 'inventory_items') {
        const itemName = newV.name ? ` "${Api.escapeHtml(newV.name)}"` : '';
        sentence = `<strong>${actor}</strong> agregó el insumo${itemName}`;
      } else if (entry.tableName === 'stock_items') {
        const itemName = newV.name ? ` "${Api.escapeHtml(newV.name)}"` : '';
        sentence = `<strong>${actor}</strong> registró el insumo${itemName} (objetivo ${Api.escapeHtml(newV.target_stock ?? '—')}, nivel ${Api.escapeHtml(newV.priority ?? '—')})`;
      } else if (entry.tableName === 'stock_checks') {
        sentence = `<strong>${actor}</strong> revisó stock: <strong>${Api.escapeHtml(newV.quantity ?? '—')}</strong> (antes ${Api.escapeHtml(newV.previous_quantity ?? 'sin conteo')})`;
      } else if (entry.tableName === 'tasks') {
        const taskTitle = newV.title ? ` "${Api.escapeHtml(newV.title)}"` : '';
        sentence = `<strong>${actor}</strong> creó la tarea${taskTitle}`;
      } else if (entry.tableName === 'shifts') {
        sentence = `<strong>${actor}</strong> inició un nuevo turno`;
      } else if (entry.tableName === 'expenses') {
        const amtStr = newV.amount ? ` de ${Api.currency(newV.amount)}` : '';
        const descStr = newV.description ? ` (${Api.escapeHtml(newV.description)})` : '';
        sentence = `<strong>${actor}</strong> registró un gasto${amtStr}${descStr}`;
      } else if (entry.tableName === 'appointments') {
        const apptTitle = newV.title ? ` "${Api.escapeHtml(newV.title)}"` : '';
        sentence = `<strong>${actor}</strong> agendó la cita médica${apptTitle}`;
      } else {
        const descriptor = newV.name || newV.title || newV.description || newV.full_name;
        const descStr = descriptor ? ` "${Api.escapeHtml(descriptor)}"` : '';
        sentence = `<strong>${actor}</strong> creó un registro${descStr} en <strong>${tabla}</strong>`;
      }
    } else if (entry.action === 'DELETE') {
      const descriptor = oldV.name || oldV.title || oldV.description || oldV.full_name;
      const descStr = descriptor ? ` "${Api.escapeHtml(descriptor)}"` : ' un registro';
      sentence = `<strong>${actor}</strong> eliminó${descStr} de <strong>${tabla}</strong>`;
    } else if (entry.action === 'UPDATE') {
      if (changed.includes('current_stock')) {
        const oldStock = oldV.current_stock !== undefined ? oldV.current_stock : '—';
        const newStock = newV.current_stock !== undefined ? newV.current_stock : '—';
        const itemLabel = (newV.name || oldV.name) ? ` de "${Api.escapeHtml(newV.name || oldV.name)}"` : '';
        sentence = `<strong>${actor}</strong> cambió el stock${itemLabel} de <strong>${oldStock}</strong> a <strong>${newStock}</strong>`;
      } else if (changed.includes('status') && entry.tableName === 'tasks') {
        const oldSt = oldV.status || '—';
        const newSt = newV.status || '—';
        sentence = `<strong>${actor}</strong> cambió el estado de tarea de <strong>${oldSt}</strong> a <strong>${newSt}</strong>`;
      } else if (changed.includes('app_role')) {
        sentence = `<strong>${actor}</strong> cambió el rol de permisos a <strong>${newV.app_role || '—'}</strong>`;
      } else if (changed.includes('active') && entry.tableName === 'profiles') {
        const actLabel = newV.active ? 'activó la cuenta de usuario' : 'desactivó la cuenta de usuario';
        const userName = newV.full_name || oldV.full_name ? ` de "${Api.escapeHtml(newV.full_name || oldV.full_name)}"` : '';
        sentence = `<strong>${actor}</strong> ${actLabel}${userName}`;
      } else if (changed.length === 1) {
        const f = changed[0];
        const fLabel = CAMPOS[f] || f;
        const oldVal = formatValue(oldV[f]);
        const newVal = formatValue(newV[f]);
        sentence = `<strong>${actor}</strong> modificó <strong>${fLabel}</strong> de "${Api.escapeHtml(oldVal)}" a "${Api.escapeHtml(newVal)}"`;
      } else if (changed.length > 1) {
        const fieldsStr = changed.map(f => CAMPOS[f] || f).join(', ');
        sentence = `<strong>${actor}</strong> modificó: <em>${Api.escapeHtml(fieldsStr)}</em> en <strong>${tabla}</strong>`;
      } else {
        sentence = `<strong>${actor}</strong> actualizó datos en <strong>${tabla}</strong>`;
      }
    } else {
      sentence = `<strong>${actor}</strong> realizó acción ${entry.action} en <strong>${tabla}</strong>`;
    }

    return {
      sentence,
      tabla,
      timeAgo: Api.timeAgo(entry.createdAt),
      dateTimeFull: Api.formatDateTime(entry.createdAt)
    };
  };

  /**
   * Renderiza el panel de auditoría
   */
  const render = async () => {
    const el = document.getElementById('panel-audit');
    if (!el) return;

    // Guarda de seguridad: Solo admin (RF-103)
    if (!Auth.isAdmin()) {
      el.innerHTML = `
        <div class="section-header">
          <div class="section-title">🔍 Registro de Auditoría</div>
        </div>
        <div class="card" style="text-align:center; padding:36px 16px;">
          <div style="font-size:2.5rem; margin-bottom:12px;">🛡️</div>
          <div style="font-size:1.125rem; font-weight:700; margin-bottom:8px; color:var(--text);">Acceso Restringido</div>
          <div style="font-size:0.875rem; color:var(--text-sec); margin-bottom:20px; max-width:340px; margin-left:auto; margin-right:auto;">
            El registro de auditoría es confidencial y está reservado exclusivamente para administradores de CuidApp.
          </div>
          <button class="btn btn-secondary btn-sm" onclick="App.navigateTo('dashboard')">Volver al Inicio</button>
        </div>
      `;
      return;
    }

    // Cargar perfiles si no están cargados para el filtro de usuario
    if (!profilesList.length) {
      try {
        const profiles = await Api.getProfiles();
        profilesList = profiles || [];
      } catch (e) {
        console.warn('No se pudieron cargar perfiles para auditoría:', e);
      }
    }

    // Construir estructura base del módulo
    el.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🔍 Registro de Auditoría</div>
          <div class="section-sub">Trazabilidad inmutable de todas las acciones en la base de datos</div>
        </div>
        <div>
          <button id="audit-purge-btn" class="btn btn-danger btn-sm" title="Mantenimiento: eliminar registros con más de 24 meses">
            🧹 Purgar > 24m
          </button>
        </div>
      </div>

      <!-- Filtros (RF-104) -->
      <div class="card" style="margin-bottom:var(--sp-4);">
        <div class="card-title">FILTRAR REGISTROS</div>
        <div class="form-row" style="margin-bottom:var(--sp-2);">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="audit-filter-table">Módulo</label>
            <select id="audit-filter-table" class="form-select">
              <option value="">Todos los módulos</option>
              ${Object.entries(TABLAS)
                .sort((a, b) => a[1].localeCompare(b[1], 'es'))
                .map(([tbl, label]) => `<option value="${tbl}" ${filterTable === tbl ? 'selected' : ''}>${label}</option>`)
                .join('')}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="audit-filter-actor">Usuario</label>
            <select id="audit-filter-actor" class="form-select">
              <option value="">Todos los usuarios</option>
              ${profilesList
                .map(p => `<option value="${p.id}" ${filterActor === p.id ? 'selected' : ''}>${Api.escapeHtml(p.fullName || 'Usuario')}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="form-row" style="margin-bottom:var(--sp-3);">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="audit-filter-from">Desde</label>
            <input type="date" id="audit-filter-from" class="form-input" value="${filterFromDate}">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="audit-filter-to">Hasta</label>
            <input type="date" id="audit-filter-to" class="form-input" value="${filterToDate}">
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:var(--sp-2);">
          <button id="audit-clear-filters-btn" class="btn btn-ghost btn-sm">Limpiar filtros</button>
          <button id="audit-apply-filters-btn" class="btn btn-primary btn-sm">Aplicar filtros</button>
        </div>
      </div>

      <!-- Barra de Estado y Paginación (RF-106) -->
      <div id="audit-pagination-top" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:var(--sp-3); font-size:0.8125rem; color:var(--text-sec);">
        <span id="audit-counter-text">Cargando registros...</span>
        <div style="display:flex; gap:6px;">
          <button id="audit-prev-btn" class="btn btn-secondary btn-sm" disabled>◀ Anterior</button>
          <button id="audit-next-btn" class="btn btn-secondary btn-sm" disabled>Siguiente ▶</button>
        </div>
      </div>

      <!-- Contenedor de la lista de auditoría -->
      <div id="audit-list-container"></div>
    `;

    // Vincular eventos de filtros
    document.getElementById('audit-filter-table')?.addEventListener('change', (e) => {
      filterTable = e.target.value;
    });

    document.getElementById('audit-filter-actor')?.addEventListener('change', (e) => {
      filterActor = e.target.value;
    });

    document.getElementById('audit-filter-from')?.addEventListener('change', (e) => {
      filterFromDate = e.target.value;
    });

    document.getElementById('audit-filter-to')?.addEventListener('change', (e) => {
      filterToDate = e.target.value;
    });

    document.getElementById('audit-apply-filters-btn')?.addEventListener('click', () => {
      currentPage = 0;
      loadAuditEntries();
    });

    document.getElementById('audit-clear-filters-btn')?.addEventListener('click', () => {
      filterTable = '';
      filterActor = '';
      filterFromDate = '';
      filterToDate = '';
      const t = document.getElementById('audit-filter-table');
      const a = document.getElementById('audit-filter-actor');
      const f = document.getElementById('audit-filter-from');
      const to = document.getElementById('audit-filter-to');
      if (t) t.value = '';
      if (a) a.value = '';
      if (f) f.value = '';
      if (to) to.value = '';
      currentPage = 0;
      loadAuditEntries();
    });

    document.getElementById('audit-prev-btn')?.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        loadAuditEntries();
      }
    });

    document.getElementById('audit-next-btn')?.addEventListener('click', () => {
      if ((currentPage + 1) * pageSize < totalCount) {
        currentPage++;
        loadAuditEntries();
      }
    });

    // Acción de mantenimiento: purga > 24 meses (RNF-37)
    document.getElementById('audit-purge-btn')?.addEventListener('click', () => {
      Ui.confirm(
        'Purgar auditoría antigua',
        '¿Deseas eliminar permanentemente los registros de auditoría anteriores a 24 meses? Esta acción libera espacio de almacenamiento y no se puede deshacer.',
        async () => {
          Ui.showButtonLoading(document.getElementById('audit-purge-btn'), 'Purgando...');
          const res = await Api.purgeOldAudit(24);
          Ui.hideButtonLoading(document.getElementById('audit-purge-btn'));

          if (res.ok) {
            Ui.toast(`Se eliminaron ${res.deletedCount || 0} registros antiguos`, 'success');
            currentPage = 0;
            loadAuditEntries();
          } else {
            Ui.toast(res.error || 'Error al purgar registros', 'error');
          }
        }
      );
    });

    // Cargar primera página de auditoría
    await loadAuditEntries();
  };

  /**
   * Carga los registros de la base de datos con paginación
   */
  const loadAuditEntries = async () => {
    const container = document.getElementById('audit-list-container');
    const counterText = document.getElementById('audit-counter-text');
    const prevBtn = document.getElementById('audit-prev-btn');
    const nextBtn = document.getElementById('audit-next-btn');

    if (!container) return;
    Ui.skeleton(container, 4);

    try {
      const res = await Api.getAuditLog({
        tableName: filterTable || undefined,
        actorId: filterActor || undefined,
        fromDate: filterFromDate || undefined,
        toDate: filterToDate || undefined,
        page: currentPage,
        pageSize: pageSize
      });

      const entries = res.entries || [];
      totalCount = res.totalCount || 0;
      const totalPages = Math.ceil(totalCount / pageSize) || 1;

      // Actualizar paginador
      if (counterText) {
        if (totalCount === 0) {
          counterText.textContent = 'Sin registros coincidentes';
        } else {
          const from = currentPage * pageSize + 1;
          const to = Math.min((currentPage + 1) * pageSize, totalCount);
          counterText.textContent = `Mostrando ${from}–${to} de ${totalCount} (pág. ${currentPage + 1}/${totalPages})`;
        }
      }

      if (prevBtn) prevBtn.disabled = currentPage === 0;
      if (nextBtn) nextBtn.disabled = (currentPage + 1) * pageSize >= totalCount;

      if (entries.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="padding:32px 16px;">
            <div class="empty-icon">🛡️</div>
            <div class="empty-text">No se encontraron registros de auditoría con los filtros seleccionados.</div>
          </div>
        `;
        return;
      }

      // Renderizar tarjetas de auditoría
      container.innerHTML = entries.map(entry => {
        const info = formatActionSentence(entry);

        // Badge de acción
        let badgeHtml = '';
        if (entry.action === 'INSERT') {
          badgeHtml = '<span class="badge" style="background:rgba(16,185,129,0.15); color:var(--stable); border:1px solid rgba(16,185,129,0.3);">🟢 Alta</span>';
        } else if (entry.action === 'DELETE') {
          badgeHtml = '<span class="badge" style="background:rgba(239,68,68,0.15); color:var(--critical); border:1px solid rgba(239,68,68,0.3);">🗑️ Borrado</span>';
        } else {
          badgeHtml = '<span class="badge" style="background:rgba(56,178,168,0.15); color:var(--accent); border:1px solid rgba(56,178,168,0.3);">✏️ Cambio</span>';
        }

        // Construir tabla de campos modificados si aplica
        let diffTableHtml = '';
        if (entry.action === 'UPDATE' && entry.changedFields && entry.changedFields.length > 0) {
          const rows = entry.changedFields.map(field => {
            const fieldLabel = CAMPOS[field] || field;
            const oldVal = formatValue(entry.oldValues?.[field]);
            const newVal = formatValue(entry.newValues?.[field]);

            return `
              <tr>
                <td>
                  <strong>${Api.escapeHtml(fieldLabel)}</strong>
                  <div style="font-size:0.7rem; color:var(--text-muted);">${Api.escapeHtml(field)}</div>
                </td>
                <td><span class="audit-diff-old">${Api.escapeHtml(oldVal)}</span></td>
                <td><span class="audit-diff-new">${Api.escapeHtml(newVal)}</span></td>
              </tr>
            `;
          }).join('');

          diffTableHtml = `
            <div style="margin-top:var(--sp-2);">
              <div style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px;">Campos modificados:</div>
              <table class="audit-diff-table">
                <thead>
                  <tr>
                    <th>Campo</th>
                    <th>Valor Anterior</th>
                    <th>Valor Nuevo</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `;
        }

        // JSON de valores completos para inspección técnica
        const oldJson = entry.oldValues && Object.keys(entry.oldValues).length ? JSON.stringify(entry.oldValues, null, 2) : null;
        const newJson = entry.newValues && Object.keys(entry.newValues).length ? JSON.stringify(entry.newValues, null, 2) : null;

        return `
          <div class="audit-card" id="audit-entry-${entry.id}">
            <div class="audit-header">
              <div class="audit-sentence">
                ${info.sentence}
                <div class="audit-meta">
                  <span>📂 ${Api.escapeHtml(info.tabla)}</span>
                  <span>·</span>
                  <span title="${Api.escapeHtml(info.dateTimeFull)}">⏱️ ${Api.escapeHtml(info.timeAgo)}</span>
                  <span>·</span>
                  <span>👤 ${Api.escapeHtml(entry.actorName)}</span>
                </div>
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                ${badgeHtml}
                <button type="button" class="btn btn-ghost btn-sm audit-toggle-detail-btn" data-entry-id="${entry.id}" style="padding:4px 8px; font-size:0.75rem;">
                  Detalle ▾
                </button>
              </div>
            </div>

            <!-- Detalle técnico desplegable (RF-105) -->
            <div id="audit-detail-${entry.id}" class="audit-detail hidden">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--sp-2); font-size:0.75rem; color:var(--text-sec); margin-bottom:var(--sp-2);">
                <div><strong>ID Registro:</strong> ${Api.escapeHtml(entry.recordId || 'N/A')}</div>
                <div><strong>Tabla Postgres:</strong> <code>${Api.escapeHtml(entry.tableName)}</code></div>
                <div><strong>Fecha y hora exacta:</strong> ${Api.escapeHtml(info.dateTimeFull)}</div>
                <div><strong>Actor UUID:</strong> <span style="font-family:monospace; font-size:0.7rem;">${Api.escapeHtml(entry.actorId || 'N/A')}</span></div>
              </div>

              ${diffTableHtml}

              <!-- Volcado JSON colapsable -->
              <details style="margin-top:var(--sp-2); font-size:0.75rem; color:var(--text-muted);">
                <summary style="cursor:pointer; user-select:none;">Ver datos crudos JSON</summary>
                ${oldJson ? `<div style="margin-top:4px;"><strong>Valores anteriores:</strong><pre class="audit-json-box"><code>${Api.escapeHtml(oldJson)}</code></pre></div>` : ''}
                ${newJson ? `<div style="margin-top:4px;"><strong>Valores nuevos:</strong><pre class="audit-json-box"><code>${Api.escapeHtml(newJson)}</code></pre></div>` : ''}
              </details>
            </div>
          </div>
        `;
      }).join('');

      // Agregar listener para toggles de detalle
      container.querySelectorAll('.audit-toggle-detail-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const entryId = btn.getAttribute('data-entry-id');
          const detail = document.getElementById(`audit-detail-${entryId}`);
          if (!detail) return;
          const isHidden = detail.classList.contains('hidden');
          detail.classList.toggle('hidden', !isHidden);
          btn.textContent = isHidden ? 'Ocultar ▴' : 'Detalle ▾';
        });
      });

    } catch (err) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al consultar registros de auditoría: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="audit-retry-load-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('audit-retry-load-btn')?.addEventListener('click', loadAuditEntries);
    }
  };

  // Exponer API pública
  const moduleApi = {
    render,
    loadAuditEntries
  };

  // Asignar en window para facilitar interoperabilidad
  if (typeof window !== 'undefined') {
    window.AuditModule = moduleApi;
  }

  return moduleApi;
})();
