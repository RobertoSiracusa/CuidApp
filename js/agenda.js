/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo de Agenda Médica (js/agenda.js)
   ═══════════════════════════════════════════════════════════════ */

const AgendaModule = (() => {
  'use strict';

  let activeTab = 'upcoming'; // 'upcoming' | 'history'
  let cachedUpcoming = [];
  let cachedPast = [];

  /**
   * Renderiza el módulo de agenda médica
   */
  const render = async () => {
    const el = document.getElementById('panel-agenda');
    if (!el) return;

    Ui.skeleton(el);

    try {
      if (activeTab === 'upcoming') {
        const res = await Api.getUpcomingAppointments(90);
        cachedUpcoming = res.data || [];
        renderTabContent(el, cachedUpcoming, false);
      } else {
        const res = await Api.getPastAppointments();
        cachedPast = res.data || [];
        renderTabContent(el, cachedPast, true);
      }
    } catch (err) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar la agenda médica: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="agenda-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('agenda-retry-btn')?.addEventListener('click', render);
    }
  };

  /**
   * Renderiza la vista de citas (Próximas o Historial)
   */
  const renderTabContent = (el, appointments, isPast) => {
    const todayStr = Api.todayStr();

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">📅 Agenda Médica</div>
        <button class="btn btn-primary btn-sm" id="btn-add-appt">+ Cita</button>
      </div>

      <div class="tabs" id="agenda-nav-tabs">
        <button class="tab-btn ${!isPast ? 'active' : ''}" data-tab="upcoming">Próximas (${!isPast ? appointments.length : cachedUpcoming.length})</button>
        <button class="tab-btn ${isPast ? 'active' : ''}" data-tab="history">Historial (${isPast ? appointments.length : cachedPast.length})</button>
      </div>

      <div id="appt-list">
        ${appointments.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">${isPast ? '🕐' : '📅'}</div>
            <div class="empty-text">${isPast ? 'Sin historial de citas médicas realizadas.' : 'Sin citas médicas próximas programadas.<br>Toca "+ Cita" para registrar una.'}</div>
          </div>
        ` : appointments.map(a => renderApptCard(a, todayStr, isPast)).join('')}
      </div>
    `;

    bindEvents(el);
  };

  /**
   * Renderiza la tarjeta de una cita médica
   */
  const renderApptCard = (a, todayStr, isPast) => {
    let daysUntil = null;
    let countdownBadge = '';
    let urgencyColor = 'var(--accent)';

    if (!isPast && a.apptDate) {
      const today = new Date(todayStr + 'T00:00:00');
      const apptD = new Date(a.apptDate + 'T00:00:00');
      daysUntil = Math.round((apptD - today) / (1000 * 60 * 60 * 24));

      if (daysUntil <= 0) {
        urgencyColor = 'var(--critical)';
        countdownBadge = '<span class="badge" style="background:var(--critical-subtle);color:var(--critical);font-weight:700;">¡HOY!</span>';
      } else if (daysUntil === 1) {
        urgencyColor = 'var(--critical)';
        countdownBadge = '<span class="badge" style="background:var(--critical-subtle);color:var(--critical);font-weight:700;">¡Mañana!</span>';
      } else if (daysUntil <= 3) {
        urgencyColor = 'var(--alert)';
        countdownBadge = `<span class="badge" style="background:var(--alert-subtle);color:var(--alert);">En ${daysUntil} días</span>`;
      } else {
        countdownBadge = `<span class="badge" style="background:var(--border-subtle);color:var(--text-muted);">En ${daysUntil} días</span>`;
      }
    }

    return `
      <div class="appt-item" style="border-left-color:${urgencyColor};margin-bottom:12px;" data-id="${Api.escapeHtml(a.id)}">
        <div class="appt-date" style="display:flex;justify-content:space-between;align-items:center;">
          <span>📅 ${Api.formatDateShort(a.apptDate)}${a.apptTime ? ` · ${Api.escapeHtml(a.apptTime.slice(0, 5))}` : ''}</span>
          ${countdownBadge}
        </div>
        <div class="appt-title" style="margin:4px 0;">${Api.escapeHtml(a.title)}</div>
        <div class="appt-details">
          ${a.specialty ? `<span class="appt-detail">🏥 ${Api.escapeHtml(a.specialty)}</span>` : ''}
          ${a.doctor ? `<span class="appt-detail">👨‍⚕️ ${Api.escapeHtml(a.doctor)}</span>` : ''}
          ${a.location ? `<span class="appt-detail">📍 ${Api.escapeHtml(a.location)}</span>` : ''}
          <span class="badge badge-${Api.escapeHtml(a.modality || 'presencial')}">${Api.escapeHtml(a.modality || 'presencial')}</span>
        </div>

        ${a.preparation ? `
          <div class="text-xs text-alert" style="margin-top:8px;font-weight:600;padding:4px 8px;background:rgba(245,158,11,.1);border-radius:var(--radius-sm);">
            ⚠️ Preparación: ${Api.escapeHtml(a.preparation)}
          </div>
        ` : ''}

        ${a.notes ? `
          <div class="text-xs text-sec" style="margin-top:6px;">${Api.escapeHtml(a.notes)}</div>
        ` : ''}

        ${a.resultNotes ? `
          <div class="text-xs text-stable" style="margin-top:6px;padding:4px 8px;background:rgba(16,185,129,.1);border-radius:var(--radius-sm);">
            ✅ Resultado: ${Api.escapeHtml(a.resultNotes)}
          </div>
        ` : ''}

        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm btn-edit-appt" data-id="${Api.escapeHtml(a.id)}">✏️ Editar</button>
          ${!isPast ? `
            <button class="btn btn-primary btn-sm btn-complete-appt" data-id="${Api.escapeHtml(a.id)}">✅ Realizada</button>
          ` : ''}
          <button class="btn btn-danger btn-sm btn-del-appt" data-id="${Api.escapeHtml(a.id)}" data-title="${Api.escapeHtml(a.title)}">🗑</button>
        </div>
      </div>
    `;
  };

  /**
   * Enlazar eventos del panel de agenda
   */
  const bindEvents = (el) => {
    // Cambio de pestaña
    el.querySelectorAll('#agenda-nav-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab && tab !== activeTab) {
          activeTab = tab;
          render();
        }
      });
    });

    // Agregar cita
    el.querySelector('#btn-add-appt')?.addEventListener('click', showAddModal);

    // Delegación en la lista
    el.querySelector('#appt-list')?.addEventListener('click', (e) => {
      // Editar
      const btnEdit = e.target.closest('.btn-edit-appt');
      if (btnEdit) {
        const id = btnEdit.getAttribute('data-id');
        if (id) showEditModal(id);
        return;
      }

      // Marcar realizada (RF-71)
      const btnComplete = e.target.closest('.btn-complete-appt');
      if (btnComplete) {
        const id = btnComplete.getAttribute('data-id');
        if (id) markCompleted(id);
        return;
      }

      // Eliminar
      const btnDel = e.target.closest('.btn-del-appt');
      if (btnDel) {
        const id = btnDel.getAttribute('data-id');
        const title = btnDel.getAttribute('data-title');
        if (id) deleteAppt(id, title);
        return;
      }
    });
  };

  /**
   * Marcar cita como realizada capturando resultado (RF-71)
   */
  const markCompleted = (id) => {
    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="res-notes">Notas del resultado / seguimiento médico *</label>
        <textarea class="form-textarea" id="res-notes" rows="4" placeholder="Diagnóstico, nuevas indicaciones, cambios de medicamento, fecha de próximo control..." required></textarea>
      </div>
    `;

    Ui.showModal('✅ Resultado de la Cita Médica', contentHtml, async () => {
      const notes = document.getElementById('res-notes')?.value?.trim();
      if (!notes) {
        Ui.toast('Por favor registra las indicaciones o resultado de la cita', 'warning');
        return false;
      }

      const res = await Api.updateAppointment(id, {
        status: 'completed',
        resultNotes: notes
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Cita marcada como realizada', 'success');
      render();
      DashboardModule?.render();
      Ui.renderAlerts();
      return true;
    });
  };

  /**
   * Modal para agregar cita médica (RF-67)
   */
  const showAddModal = () => {
    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="na-title">Título / Motivo de la consulta *</label>
        <input class="form-input" id="na-title" placeholder="Ej: Control cardiología, análisis de sangre..." required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="na-date">Fecha *</label>
          <input class="form-input" id="na-date" type="date" value="${Api.todayStr()}" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="na-time">Hora</label>
          <input class="form-input" id="na-time" type="time">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="na-spec">Especialidad</label>
          <input class="form-input" id="na-spec" placeholder="Cardiología, Neurología...">
        </div>
        <div class="form-group">
          <label class="form-label" for="na-mode">Modalidad</label>
          <select class="form-select" id="na-mode">
            <option value="presencial">Presencial</option>
            <option value="telemedicina">Telemedicina</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="na-doc">Médico / Especialista</label>
        <input class="form-input" id="na-doc" placeholder="Dr. Roberto García">
      </div>
      <div class="form-group">
        <label class="form-label" for="na-loc">Lugar / Clínica / Enlace</label>
        <input class="form-input" id="na-loc" placeholder="Hospital de Diagnóstico, Clínica Central...">
      </div>
      <div class="form-group">
        <label class="form-label" for="na-prep">⚠️ Preparación previa requerida</label>
        <input class="form-input" id="na-prep" placeholder="Ej: En ayunas 8h, llevar exámenes previos, suspender diurético...">
        <span class="form-hint">Se destacará con alerta visual antes de la cita.</span>
      </div>
      <div class="form-group">
        <label class="form-label" for="na-notes">Notas u observaciones</label>
        <textarea class="form-textarea" id="na-notes" style="min-height:60px;" placeholder="Preguntas para el doctor, acompañante asignado..."></textarea>
      </div>
    `;

    Ui.showModal('➕ Nueva Cita Médica', contentHtml, async () => {
      const title = document.getElementById('na-title')?.value?.trim();
      const apptDate = document.getElementById('na-date')?.value;
      const apptTime = document.getElementById('na-time')?.value || null;
      const specialty = document.getElementById('na-spec')?.value?.trim() || null;
      const modality = document.getElementById('na-mode')?.value || 'presencial';
      const doctor = document.getElementById('na-doc')?.value?.trim() || null;
      const location = document.getElementById('na-loc')?.value?.trim() || null;
      const preparation = document.getElementById('na-prep')?.value?.trim() || null;
      const notes = document.getElementById('na-notes')?.value?.trim() || null;

      if (!title) {
        Ui.toast('El título es requerido', 'warning');
        return false;
      }
      if (!apptDate) {
        Ui.toast('La fecha es requerida', 'warning');
        return false;
      }

      const res = await Api.addAppointment({
        title,
        apptDate,
        apptTime,
        specialty,
        modality,
        doctor,
        location,
        preparation,
        notes,
        status: 'upcoming'
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Cita médica programada', 'success');
      activeTab = 'upcoming';
      render();
      DashboardModule?.render();
      Ui.renderAlerts();
      return true;
    });
  };

  /**
   * Modal para editar cita médica
   */
  const showEditModal = async (id) => {
    const all = cachedUpcoming.concat(cachedPast);
    const a = all.find(x => x.id === id);
    if (!a) return;

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="ea-title">Título / Motivo *</label>
        <input class="form-input" id="ea-title" value="${Api.escapeHtml(a.title)}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="ea-date">Fecha *</label>
          <input class="form-input" id="ea-date" type="date" value="${a.apptDate}" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="ea-time">Hora</label>
          <input class="form-input" id="ea-time" type="time" value="${a.apptTime ? a.apptTime.slice(0, 5) : ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="ea-spec">Especialidad</label>
          <input class="form-input" id="ea-spec" value="${Api.escapeHtml(a.specialty || '')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="ea-mode">Modalidad</label>
          <select class="form-select" id="ea-mode">
            <option value="presencial" ${a.modality === 'presencial' ? 'selected' : ''}>Presencial</option>
            <option value="telemedicina" ${a.modality === 'telemedicina' ? 'selected' : ''}>Telemedicina</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="ea-doc">Médico</label>
        <input class="form-input" id="ea-doc" value="${Api.escapeHtml(a.doctor || '')}">
      </div>
      <div class="form-group">
        <label class="form-label" for="ea-loc">Lugar</label>
        <input class="form-input" id="ea-loc" value="${Api.escapeHtml(a.location || '')}">
      </div>
      <div class="form-group">
        <label class="form-label" for="ea-prep">Preparación previa</label>
        <input class="form-input" id="ea-prep" value="${Api.escapeHtml(a.preparation || '')}">
      </div>
      <div class="form-group">
        <label class="form-label" for="ea-notes">Notas</label>
        <textarea class="form-textarea" id="ea-notes" style="min-height:60px;">${Api.escapeHtml(a.notes || '')}</textarea>
      </div>
    `;

    Ui.showModal('✏️ Editar Cita Médica', contentHtml, async () => {
      const title = document.getElementById('ea-title')?.value?.trim();
      const apptDate = document.getElementById('ea-date')?.value;
      const apptTime = document.getElementById('ea-time')?.value || null;
      const specialty = document.getElementById('ea-spec')?.value?.trim() || null;
      const modality = document.getElementById('ea-mode')?.value || 'presencial';
      const doctor = document.getElementById('ea-doc')?.value?.trim() || null;
      const location = document.getElementById('ea-loc')?.value?.trim() || null;
      const preparation = document.getElementById('ea-prep')?.value?.trim() || null;
      const notes = document.getElementById('ea-notes')?.value?.trim() || null;

      if (!title) {
        Ui.toast('El título es requerido', 'warning');
        return false;
      }
      if (!apptDate) {
        Ui.toast('La fecha es requerida', 'warning');
        return false;
      }

      const res = await Api.updateAppointment(id, {
        title,
        apptDate,
        apptTime,
        specialty,
        modality,
        doctor,
        location,
        preparation,
        notes
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Cita actualizada', 'success');
      render();
      DashboardModule?.render();
      Ui.renderAlerts();
      return true;
    });
  };

  /**
   * Eliminar cita médica
   */
  const deleteAppt = (id, title) => {
    Ui.confirm(`¿Eliminar la cita "${title}"?`, 'Se borrará de la agenda permanentemente.', async () => {
      const res = await Api.deleteAppointment(id);
      if (res.error) {
        Ui.toast(res.error, 'error');
      } else {
        Ui.toast('Cita eliminada', 'info');
        render();
        DashboardModule?.render();
        Ui.renderAlerts();
      }
    });
  };

  const init = () => {
    render();
  };

  return {
    init,
    render,
    showAddModal
  };
})();
