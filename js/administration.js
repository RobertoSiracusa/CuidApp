/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo de Administración de Dosis (js/administration.js)
   RF-39 .. RF-48
   ═══════════════════════════════════════════════════════════════ */

const AdministrationModule = (() => {
  'use strict';

  let currentTab = 'today'; // 'today' | 'history'
  let filterMedicationId = '';
  let filterStartDate = '';
  let filterEndDate = '';

  const STATUS_LABELS = {
    given:   { label: 'Administrada', icon: '✅', color: 'var(--stable)', bg: 'rgba(16,185,129,0.12)' },
    skipped: { label: 'Omitida',      icon: '⏭', color: 'var(--alert)',  bg: 'rgba(245,158,11,0.12)' },
    refused: { label: 'Rechazada',    icon: '🚫', color: 'var(--critical)', bg: 'rgba(239,68,68,0.12)' }
  };

  /**
   * Renderiza el panel principal de administración de dosis
   */
  const render = async () => {
    const el = document.getElementById('panel-administration');
    if (!el) return;

    Ui.skeleton(el);

    try {
      if (currentTab === 'today') {
        await renderTodayTab(el);
      } else {
        await renderHistoryTab(el);
      }
    } catch (err) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar administración de dosis: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="admin-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('admin-retry-btn')?.addEventListener('click', render);
    }
  };

  /**
   * Pestaña "Hoy" — Pantalla principal de registro de dosis
   */
  const renderTodayTab = async (el) => {
    const todayStr = Api.todayStr();

    const [meds, todayAdmins] = await Promise.all([
      Api.getMedications(),
      Api.getTodayAdministrations()
    ]);

    const activeMeds = (meds || []).filter(m => m.status === 'active');
    const adminMap = new Map();
    (todayAdmins || []).forEach(a => {
      if (a.scheduleId) adminMap.set(a.scheduleId, a);
    });

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Extraer todos los horarios activos de medicamentos activos
    const doses = [];
    activeMeds.forEach(med => {
      (med.schedules || []).filter(s => s.active).forEach(sched => {
        const admin = adminMap.get(sched.id);
        const timeStr = sched.timeOfDay || sched.scheduledTime || '00:00';
        const [h, m] = timeStr.split(':').map(Number);
        const schedMinutes = (h || 0) * 60 + (m || 0);

        const isLate = !admin && schedMinutes < currentMinutes;
        const isPending = !admin && schedMinutes >= currentMinutes;
        const isDone = !!admin;

        doses.push({
          schedule: sched,
          medication: med,
          admin,
          schedMinutes,
          time: timeStr.slice(0, 5),
          isLate,
          isPending,
          isDone
        });
      });
    });

    // Ordenar: primero Atrasadas (por hora), luego Pendientes (por hora), luego Registradas
    const lateDoses = doses.filter(d => d.isLate).sort((a, b) => a.schedMinutes - b.schedMinutes);
    const pendingDoses = doses.filter(d => d.isPending).sort((a, b) => a.schedMinutes - b.schedMinutes);
    const doneDoses = doses.filter(d => d.isDone).sort((a, b) => a.schedMinutes - b.schedMinutes);

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">💊 Administración de Dosis</div>
      </div>

      <!-- Advertencia clínica permanente (R-7) -->
      <div class="card" style="margin-bottom:12px;padding:10px 12px;background:var(--bg-glass);border-left:3px solid var(--accent);font-size:0.75rem;line-height:1.4;">
        <span style="font-weight:700;">ℹ️ Aviso clínico:</span> CuidApp registra las dosis administradas; no envía recordatorios ni notificaciones push.
      </div>

      <!-- Pestañas -->
      <div class="tabs" id="admin-nav-tabs">
        <button class="tab-btn active" data-tab="today">Hoy (${doses.length})</button>
        <button class="tab-btn" data-tab="history">Historial</button>
      </div>

      ${doses.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">💊</div>
          <div class="empty-text">
            No hay horarios de dosis configurados para hoy.<br>
            Configura horarios en el módulo de <strong>Medicamentos</strong>.
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-goto-meds" style="margin-top:12px;">Ir a Medicamentos</button>
        </div>
      ` : `
        <!-- 1. Dosis Atrasadas (RF-44) -->
        ${lateDoses.length > 0 ? `
          <div class="task-group-hdr">
            <div class="task-group-label text-critical">⚠️ Dosis Atrasadas (${lateDoses.length})</div>
            <div class="task-group-line" style="background:rgba(239,68,68,.3);"></div>
          </div>
          ${lateDoses.map(d => renderPendingDoseCard(d, true)).join('')}
        ` : ''}

        <!-- 2. Dosis Pendientes -->
        ${pendingDoses.length > 0 ? `
          <div class="task-group-hdr">
            <div class="task-group-label text-accent">⏰ Próximas Dosis de Hoy (${pendingDoses.length})</div>
            <div class="task-group-line"></div>
          </div>
          ${pendingDoses.map(d => renderPendingDoseCard(d, false)).join('')}
        ` : ''}

        <!-- 3. Dosis Ya Registradas -->
        ${doneDoses.length > 0 ? `
          <div class="task-group-hdr">
            <div class="task-group-label text-stable">✅ Registradas Hoy (${doneDoses.length})</div>
            <div class="task-group-line" style="background:rgba(16,185,129,.3);"></div>
          </div>
          ${doneDoses.map(d => renderDoneDoseCard(d)).join('')}
        ` : ''}
      `}
    `;

    bindTabEvents(el);
    bindTodayEvents(el);
  };

  /**
   * Renderiza una tarjeta de dosis pendiente o atrasada con 3 botones de acción (RF-42)
   */
  const renderPendingDoseCard = (d, isLate) => {
    const med = d.medication;
    const sched = d.schedule;
    const stock = med.currentStock;
    const unit = med.unit || 'unid.';

    return `
      <div class="card ${isLate ? 'emergency' : ''}" style="margin-bottom:12px;padding:12px;border-left:4px solid ${isLate ? 'var(--critical)' : 'var(--accent)'};" data-sched-id="${Api.escapeHtml(sched.id)}" data-med-id="${Api.escapeHtml(med.id)}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="font-bold" style="font-size:1.05rem;">${Api.escapeHtml(med.name)}</span>
              ${isLate ? '<span class="badge" style="background:var(--critical-subtle);color:var(--critical);font-size:0.65rem;font-weight:700;">¡Atrasada!</span>' : ''}
            </div>
            <div class="text-xs text-muted" style="margin-top:2px;">
              Hora programada: <strong>${Api.escapeHtml(d.time)}</strong> · Dosis: <strong>${sched.dose} ${Api.escapeHtml(unit)}</strong>
            </div>
            <div class="text-xs text-sec" style="margin-top:2px;">
              Stock disponible: ${stock} ${Api.escapeHtml(unit)}
              ${med.indication ? ` · <em>${Api.escapeHtml(med.indication)}</em>` : ''}
            </div>
          </div>
        </div>

        <!-- 3 botones táctiles grandes >= 44px (RF-42, RNF-14) -->
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-record-action" data-action="given" data-sched-id="${Api.escapeHtml(sched.id)}" data-med-id="${Api.escapeHtml(med.id)}" data-dose="${sched.dose}" data-time="${Api.escapeHtml(d.time)}" style="flex:1;min-height:44px;min-width:110px;">
            ✅ Administrada
          </button>
          <button class="btn btn-secondary btn-record-action" data-action="skipped" data-sched-id="${Api.escapeHtml(sched.id)}" data-med-id="${Api.escapeHtml(med.id)}" data-dose="${sched.dose}" data-time="${Api.escapeHtml(d.time)}" style="flex:1;min-height:44px;min-width:90px;">
            ⏭ Omitida
          </button>
          <button class="btn btn-secondary btn-record-action" data-action="refused" data-sched-id="${Api.escapeHtml(sched.id)}" data-med-id="${Api.escapeHtml(med.id)}" data-dose="${sched.dose}" data-time="${Api.escapeHtml(d.time)}" style="flex:1;min-height:44px;min-width:90px;color:var(--critical);">
            🚫 Rechazada
          </button>
        </div>
      </div>
    `;
  };

  /**
   * Renderiza una tarjeta de dosis registrada hoy
   */
  const renderDoneDoseCard = (d) => {
    const med = d.medication;
    const admin = d.admin;
    const info = STATUS_LABELS[admin.status] || STATUS_LABELS.given;

    return `
      <div class="card" style="margin-bottom:8px;padding:10px 12px;background:var(--bg-glass);" data-admin-id="${Api.escapeHtml(admin.id)}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="font-bold">${Api.escapeHtml(med.name)}</span>
              <span class="badge" style="background:${info.bg};color:${info.color};font-size:0.65rem;">
                ${info.icon} ${info.label}
              </span>
            </div>
            <div class="text-xs text-muted" style="margin-top:2px;">
              Programada: ${Api.escapeHtml(d.time)} · Dosis: ${admin.dose} ${Api.escapeHtml(med.unit || '')}
            </div>
            <div class="text-xs text-sec" style="margin-top:2px;">
              Registrada por <strong>${Api.escapeHtml(admin.administeredByName || 'Usuario')}</strong>
              ${admin.administeredAt ? ` · ${Api.timeAgo(admin.administeredAt)}` : ''}
              ${admin.notes ? ` · <span style="font-style:italic;">"${Api.escapeHtml(admin.notes)}"</span>` : ''}
            </div>
          </div>
          <div>
            <!-- Botón para corregir dosis registrada (RF-46) -->
            <button class="btn btn-ghost btn-sm text-alert btn-undo-admin" data-admin-id="${Api.escapeHtml(admin.id)}" data-med-name="${Api.escapeHtml(med.name)}" title="Deshacer / Corregir registro">
              ↩ Corregir
            </button>
          </div>
        </div>
      </div>
    `;
  };

  /**
   * Pestaña "Historial" — Registro de dosis por medicamento y fecha (RF-47)
   */
  const renderHistoryTab = async (el) => {
    const [meds, history] = await Promise.all([
      Api.getMedications(),
      Api.getAdministrationHistory({
        medicationId: filterMedicationId || null,
        fromDate: filterStartDate || null,
        toDate: filterEndDate || null,
        limit: 50
      })
    ]);

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">💊 Administración de Dosis</div>
      </div>

      <!-- Pestañas -->
      <div class="tabs" id="admin-nav-tabs">
        <button class="tab-btn" data-tab="today">Hoy</button>
        <button class="tab-btn active" data-tab="history">Historial (${history.length})</button>
      </div>

      <!-- Filtros de historial -->
      <div class="card" style="margin-bottom:12px;padding:10px;">
        <div class="form-row" style="margin-bottom:6px;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="hf-med">Medicamento</label>
            <select class="form-select" id="hf-med" style="font-size:0.8rem;padding:4px 8px;">
              <option value="">(Todos los medicamentos)</option>
              ${meds.map(m => `
                <option value="${Api.escapeHtml(m.id)}" ${filterMedicationId === m.id ? 'selected' : ''}>
                  ${Api.escapeHtml(m.name)}
                </option>
              `).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="hf-start">Desde</label>
            <input class="form-input" id="hf-start" type="date" value="${filterStartDate}" style="font-size:0.8rem;padding:4px 8px;">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="hf-end">Hasta</label>
            <input class="form-input" id="hf-end" type="date" value="${filterEndDate}" style="font-size:0.8rem;padding:4px 8px;">
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px;">
          <button class="btn btn-ghost btn-sm" id="btn-reset-history-filters">Limpiar</button>
          <button class="btn btn-primary btn-sm" id="btn-apply-history-filters">Filtrar</button>
        </div>
      </div>

      <!-- Lista de historial -->
      <div id="admin-history-list">
        ${history.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">📋</div>
            <div class="empty-text">Sin registros de administración en el período seleccionado.</div>
          </div>
        ` : history.map(a => {
          const info = STATUS_LABELS[a.status] || STATUS_LABELS.given;
          return `
            <div class="card" style="margin-bottom:8px;padding:10px 12px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                  <div style="display:flex;align-items:center;gap:6px;">
                    <span class="font-bold">${Api.escapeHtml(a.medicationName || 'Medicamento')}</span>
                    <span class="badge" style="background:${info.bg};color:${info.color};font-size:0.65rem;">
                      ${info.icon} ${info.label}
                    </span>
                  </div>
                  <div class="text-xs text-muted" style="margin-top:2px;">
                    Fecha: <strong>${Api.formatDate(a.scheduledDate)}</strong> · Hora: <strong>${Api.escapeHtml(a.scheduledTime?.slice(0, 5) || '')}</strong>
                    · Dosis: ${a.dose} ${Api.escapeHtml(a.unit || '')}
                  </div>
                  <div class="text-xs text-sec" style="margin-top:2px;">
                    Registrado por: <strong>${Api.escapeHtml(a.administeredByName || 'Usuario')}</strong>
                    ${a.administeredAt ? ` (${Api.formatDateTime(a.administeredAt)})` : ''}
                  </div>
                  ${a.notes ? `
                    <div class="text-xs" style="margin-top:4px;font-style:italic;color:var(--text-muted);">
                      Nota: "${Api.escapeHtml(a.notes)}"
                    </div>
                  ` : ''}
                </div>
                <button class="btn btn-ghost btn-sm text-alert btn-undo-admin" data-admin-id="${Api.escapeHtml(a.id)}" data-med-name="${Api.escapeHtml(a.medicationName || 'la dosis')}" title="Corregir dosis">
                  ↩ Corregir
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    bindTabEvents(el);
    bindHistoryEvents(el);
  };

  /**
   * Enlazar eventos de pestañas
   */
  const bindTabEvents = (el) => {
    el.querySelectorAll('#admin-nav-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab && tab !== currentTab) {
          currentTab = tab;
          render();
        }
      });
    });

    el.querySelector('#btn-goto-meds')?.addEventListener('click', () => {
      App.navigateTo('medications');
    });
  };

  /**
   * Enlazar eventos de la pestaña "Hoy"
   */
  const bindTodayEvents = (el) => {
    el.querySelectorAll('.btn-record-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        const schedId = btn.getAttribute('data-sched-id');
        const medId = btn.getAttribute('data-med-id');
        const dose = parseFloat(btn.getAttribute('data-dose')) || 1;
        const time = btn.getAttribute('data-time') || '00:00';
        showRecordActionModal(medId, schedId, action, dose, time);
      });
    });

    el.querySelectorAll('.btn-undo-admin').forEach(btn => {
      btn.addEventListener('click', () => {
        const adminId = btn.getAttribute('data-admin-id');
        const medName = btn.getAttribute('data-med-name');
        if (adminId) undoAdministration(adminId, medName);
      });
    });
  };

  /**
   * Enlazar eventos de la pestaña "Historial"
   */
  const bindHistoryEvents = (el) => {
    el.querySelector('#btn-apply-history-filters')?.addEventListener('click', () => {
      filterMedicationId = document.getElementById('hf-med')?.value || '';
      filterStartDate = document.getElementById('hf-start')?.value || '';
      filterEndDate = document.getElementById('hf-end')?.value || '';
      render();
    });

    el.querySelector('#btn-reset-history-filters')?.addEventListener('click', () => {
      filterMedicationId = '';
      filterStartDate = '';
      filterEndDate = '';
      render();
    });

    el.querySelectorAll('.btn-undo-admin').forEach(btn => {
      btn.addEventListener('click', () => {
        const adminId = btn.getAttribute('data-admin-id');
        const medName = btn.getAttribute('data-med-name');
        if (adminId) undoAdministration(adminId, medName);
      });
    });
  };

  /**
   * Modal para confirmar registro de administración con notas opcionales (RF-42, RF-43)
   */
  const showRecordActionModal = async (medId, schedId, action, dose, scheduledTime) => {
    const meds = await Api.getMedications();
    const med = (meds || []).find(m => m.id === medId);
    if (!med) return;

    const actionInfo = STATUS_LABELS[action] || STATUS_LABELS.given;
    const title = `${actionInfo.icon} Marcar como ${actionInfo.label}`;

    const contentHtml = `
      <div style="margin-bottom:12px;">
        <div class="font-bold" style="font-size:1rem;">${Api.escapeHtml(med.name)}</div>
        <div class="text-xs text-muted" style="margin-top:2px;">
          Hora: <strong>${Api.escapeHtml(scheduledTime)}</strong> · Dosis: <strong>${dose} ${Api.escapeHtml(med.unit || '')}</strong>
        </div>
        ${action === 'given' ? `
          <div class="text-xs text-stable" style="margin-top:6px;">
            ℹ️ El stock se descontará automáticamente (${med.currentStock} $\\rightarrow$ ${Math.max(0, med.currentStock - dose)} ${Api.escapeHtml(med.unit || '')}).
          </div>
        ` : `
          <div class="text-xs text-alert" style="margin-top:6px;">
            ℹ️ Al marcarse como ${actionInfo.label.toLowerCase()}, el stock actual no se modificará.
          </div>
        `}
      </div>

      <div class="form-group">
        <label class="form-label" for="admin-notes">Notas / Observaciones (opcional)</label>
        <textarea class="form-textarea" id="admin-notes" rows="3" placeholder="Ej: Tomado con agua, paciente refiere leve mareo, etc."></textarea>
      </div>
    `;

    Ui.showModal(title, contentHtml, async () => {
      const notes = document.getElementById('admin-notes')?.value?.trim() || '';

      const res = await Api.recordAdministration({
        medicationId: medId,
        scheduleId: schedId,
        scheduledDate: Api.todayStr(),
        scheduledTime,
        status: action,
        dose,
        notes
      });

      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(`Dosis de ${med.name} registrada como ${actionInfo.label}`, 'success');
      render();
      Ui.renderAlerts();
      DashboardModule?.render();
      return true;
    });
  };

  /**
   * Corregir / Deshacer dosis registrada (RF-46)
   */
  const undoAdministration = (adminId, medName) => {
    Ui.confirm(`¿Corregir registro de ${medName}?`, 'Si la dosis fue administrada, el stock se devolverá automáticamente y la acción quedará registrada en la auditoría.', async () => {
      const res = await Api.undoAdministration(adminId);
      if (res && res.error) {
        Ui.toast(res.error, 'error');
      } else {
        Ui.toast('Registro corregido y stock restaurado', 'info');
        render();
        Ui.renderAlerts();
        DashboardModule?.render();
      }
    });
  };

  const init = () => {
    render();
  };

  return {
    init,
    render,
    showRecordActionModal,
    undoAdministration
  };
})();
