/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo de Medicamentos (js/medications.js)
   ═══════════════════════════════════════════════════════════════ */

const MedicationsModule = (() => {
  'use strict';

  let filterStatus = 'all';
  let searchTerm = '';
  let cachedMeds = [];

  const STATUS_LABELS = { active: 'Activo', suspended: 'Suspendido', paused: 'Pausado' };

  /**
   * Renderiza el panel de medicamentos
   */
  const render = async () => {
    const el = document.getElementById('panel-medications');
    if (!el) return;

    Ui.skeleton(el);

    try {
      const [medsRes, schedulesRes] = await Promise.all([
        Api.getMedications(),
        Api.getMedicationSchedules()
      ]);

      cachedMeds = medsRes.data || [];
      const allSchedules = schedulesRes.data || [];

      // Mapear horarios a cada medicamento
      const schedulesByMed = new Map();
      allSchedules.forEach(s => {
        if (!schedulesByMed.has(s.medicationId)) schedulesByMed.set(s.medicationId, []);
        schedulesByMed.get(s.medicationId).push(s);
      });

      const filtered = cachedMeds
        .filter(m => filterStatus === 'all' || m.status === filterStatus)
        .filter(m => !searchTerm || m.name.toLowerCase().includes(searchTerm.toLowerCase()) || (m.prescriber || '').toLowerCase().includes(searchTerm.toLowerCase()));

      el.innerHTML = `
        <div class="section-header">
          <div class="section-title">💊 Medicamentos</div>
          <button class="btn btn-primary btn-sm" id="btn-add-med">+ Medicamento</button>
        </div>

        <!-- Búsqueda -->
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input class="search-input" id="med-search" placeholder="Buscar medicamento o prescriptor..." value="${Api.escapeHtml(searchTerm)}">
        </div>

        <!-- Filtros de estado -->
        <div class="chip-row">
          <div class="chip ${filterStatus === 'all' ? 'active' : ''}" data-status="all">Todos (${cachedMeds.length})</div>
          <div class="chip ${filterStatus === 'active' ? 'active' : ''}" data-status="active">Activos (${cachedMeds.filter(m => m.status === 'active').length})</div>
          <div class="chip ${filterStatus === 'paused' ? 'active' : ''}" data-status="paused">Pausados (${cachedMeds.filter(m => m.status === 'paused').length})</div>
          <div class="chip ${filterStatus === 'suspended' ? 'active' : ''}" data-status="suspended">Suspendidos (${cachedMeds.filter(m => m.status === 'suspended').length})</div>
        </div>

        <!-- Lista de medicamentos -->
        <div id="meds-list">
          ${filtered.length === 0 ? `
            <div class="empty-state">
              <div class="empty-icon">💊</div>
              <div class="empty-text">${cachedMeds.length === 0 ? 'No hay medicamentos registrados.<br>Toca "+ Medicamento" para agregar uno.' : 'Sin resultados para este filtro.'}</div>
            </div>
          ` : filtered.map(m => renderMedCard(m, schedulesByMed.get(m.id) || [])).join('')}
        </div>
      `;

      bindEvents(el);
    } catch (err) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar medicamentos: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="meds-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('meds-retry-btn')?.addEventListener('click', render);
    }
  };

  /**
   * Renderiza la tarjeta de un medicamento
   */
  const renderMedCard = (m, schedules) => {
    const days = m.daysRemaining;
    const daily = m.dailyAmount || m.manualDailyAmount || 0;
    const stockPct = daily > 0 ? Math.min(100, Math.round((m.currentStock / (daily * 30)) * 100)) : 100;
    const stockClass = days === null ? 'ok' : days === 0 ? 'out' : days <= 3 ? 'low' : 'ok';
    const stockLabel = days === null ? 'Sin proyección' : days === 0 ? '¡Sin stock!' : `${days} días de stock`;

    // Ordenar horarios
    schedules.sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));

    return `
      <div class="med-item ${m.needsRestock ? 'needs-restock' : ''}" data-id="${Api.escapeHtml(m.id)}">
        <div class="med-hdr">
          <div>
            <div class="med-name">${Api.escapeHtml(m.name)}</div>
            <div class="med-meta">
              ${m.prescriber ? `<span>Dr. ${Api.escapeHtml(m.prescriber)}</span>` : ''}
              ${m.indication ? `<span>${Api.escapeHtml(m.indication)}</span>` : ''}
              ${m.startDate ? `<span>Desde ${Api.formatDate(m.startDate)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
            <span class="badge badge-${Api.escapeHtml(m.status)}">${STATUS_LABELS[m.status] || 'Activo'}</span>
            ${m.needsRestock ? '<span class="badge badge-emergency">⚠️ Reponer</span>' : ''}
          </div>
        </div>

        ${m.notes ? `<div class="text-xs text-sec" style="margin:4px 0;">${Api.escapeHtml(m.notes)}</div>` : ''}

        <!-- Horarios configurados (RF-39, RF-40) -->
        <div style="margin:8px 0;padding:6px 10px;background:var(--bg-glass);border-radius:var(--radius-sm);font-size:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span class="font-bold text-muted">⏰ HORARIOS DE DOSIS</span>
            <button class="btn btn-ghost btn-sm btn-manage-schedules" data-id="${Api.escapeHtml(m.id)}" style="padding:2px 6px;font-size:0.7rem;">Gestionar horarios</button>
          </div>
          ${schedules.length === 0 ? `
            <span class="text-muted">Sin horarios programados (uso manual: ${m.manualDailyAmount || 0} ${Api.escapeHtml(m.unit || '')}/día)</span>
          ` : `
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${schedules.map(s => `
                <span class="badge ${s.active ? 'badge-info' : 'badge-inactive'}" style="font-size:0.7rem;">
                  ${Api.escapeHtml(s.scheduledTime?.slice(0, 5))} (${s.dose} ${Api.escapeHtml(m.unit || '')}) ${!s.active ? '⏸' : ''}
                </span>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Indicador de stock (RF-32) -->
        ${m.status === 'active' ? `
          <div class="stock-row">
            <div style="flex:1">
              <div class="flex items-center justify-between" style="margin-bottom:4px;">
                <span class="text-xs text-muted">Stock: ${m.currentStock} ${Api.escapeHtml(m.unit || '')} · ${daily}/día</span>
                <span class="stock-label ${stockClass}">${stockLabel}</span>
              </div>
              <div class="stock-track">
                <div class="stock-fill ${stockClass}" style="width:${stockPct}%"></div>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Acciones -->
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
          <button class="btn btn-secondary btn-sm btn-edit-med" data-id="${Api.escapeHtml(m.id)}">✏️ Editar</button>
          ${m.status === 'active' ? `
            <button class="btn btn-sm btn-toggle-restock" data-id="${Api.escapeHtml(m.id)}" data-needs="${m.needsRestock}" style="${m.needsRestock ? 'border-color:var(--alert);color:var(--alert)' : ''}">
              ${m.needsRestock ? '✓ Solicitar por WhatsApp' : '🛒 Marcar para reponer'}
            </button>
            <button class="btn btn-primary btn-sm btn-restock-med" data-id="${Api.escapeHtml(m.id)}">📦 Registrar reposición</button>
          ` : ''}
          <button class="btn btn-ghost btn-sm btn-history-med" data-id="${Api.escapeHtml(m.id)}">📋 Historial reposiciones</button>
          <button class="btn btn-danger btn-sm btn-del-med" data-id="${Api.escapeHtml(m.id)}" data-name="${Api.escapeHtml(m.name)}">🗑</button>
        </div>
      </div>
    `;
  };

  /**
   * Enlazar eventos del panel de medicamentos
   */
  const bindEvents = (el) => {
    // Búsqueda
    el.querySelector('#med-search')?.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderListOnly();
    });

    // Filtros de estado
    el.querySelectorAll('.chip[data-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        filterStatus = chip.getAttribute('data-status') || 'all';
        el.querySelectorAll('.chip[data-status]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderListOnly();
      });
    });

    // Nuevo medicamento
    el.querySelector('#btn-add-med')?.addEventListener('click', showAddMedModal);

    // Delegación en la lista
    el.querySelector('#meds-list')?.addEventListener('click', async (e) => {
      // Editar
      const btnEdit = e.target.closest('.btn-edit-med');
      if (btnEdit) {
        const id = btnEdit.getAttribute('data-id');
        if (id) showEditModal(id);
        return;
      }

      // Gestionar horarios
      const btnSched = e.target.closest('.btn-manage-schedules');
      if (btnSched) {
        const id = btnSched.getAttribute('data-id');
        if (id) showManageSchedulesModal(id);
        return;
      }

      // Reposición / WhatsApp
      const btnRestockToggle = e.target.closest('.btn-toggle-restock');
      if (btnRestockToggle) {
        const id = btnRestockToggle.getAttribute('data-id');
        const needs = btnRestockToggle.getAttribute('data-needs') === 'true';
        if (id) toggleRestock(id, needs);
        return;
      }

      // Registrar reposición modal
      const btnRestock = e.target.closest('.btn-restock-med');
      if (btnRestock) {
        const id = btnRestock.getAttribute('data-id');
        if (id) showRestockModal(id);
        return;
      }

      // Historial de reposiciones
      const btnHistory = e.target.closest('.btn-history-med');
      if (btnHistory) {
        const id = btnHistory.getAttribute('data-id');
        if (id) showRestockHistory(id);
        return;
      }

      // Eliminar
      const btnDel = e.target.closest('.btn-del-med');
      if (btnDel) {
        const id = btnDel.getAttribute('data-id');
        const name = btnDel.getAttribute('data-name');
        if (id) deleteMed(id, name);
        return;
      }
    });
  };

  /**
   * Refresca solo la lista filtrada
   */
  const renderListOnly = async () => {
    const listEl = document.getElementById('meds-list');
    if (!listEl) return;

    const schedulesRes = await Api.getMedicationSchedules();
    const allSchedules = schedulesRes.data || [];
    const schedulesByMed = new Map();
    allSchedules.forEach(s => {
      if (!schedulesByMed.has(s.medicationId)) schedulesByMed.set(s.medicationId, []);
      schedulesByMed.get(s.medicationId).push(s);
    });

    const filtered = cachedMeds
      .filter(m => filterStatus === 'all' || m.status === filterStatus)
      .filter(m => !searchTerm || m.name.toLowerCase().includes(searchTerm.toLowerCase()));

    listEl.innerHTML = filtered.length === 0
      ? '<div class="empty-state"><div class="empty-icon">💊</div><div class="empty-text">Sin resultados</div></div>'
      : filtered.map(m => renderMedCard(m, schedulesByMed.get(m.id) || [])).join('');
  };

  /**
   * Alternar marca de reposición o enviar WhatsApp (RF-34, RF-35)
   */
  const toggleRestock = async (id, isCurrentlyMarked) => {
    const med = cachedMeds.find(m => m.id === id);
    if (!med) return;

    if (isCurrentlyMarked) {
      showRestockShareModal(med);
    } else {
      const res = await Api.updateMedication(id, { needsRestock: true });
      if (res.error) {
        Ui.toast(res.error, 'error');
        return;
      }
      Ui.toast(`${med.name} marcado para reposición`, 'warning');
      render();
    }
  };

  /**
   * Modal para compartir mensaje de reposición por WhatsApp (RF-35)
   */
  const showRestockShareModal = async (med) => {
    const settingsRes = await Api.getSettings();
    const settings = settingsRes.data || {};
    const restocksRes = await Api.getMedicationRestocks(med.id);
    const lastRestock = (restocksRes.data || [])[0];

    const refText = lastRestock
      ? `(Última compra: ${lastRestock.establishment || 'Farmacia'} · $${lastRestock.cost || 0})`
      : '';

    const daily = med.dailyAmount || med.manualDailyAmount || 1;
    const msg = encodeURIComponent(
      `🏥 CuidApp - Solicitud de Reposición\n\n` +
      `Paciente: ${settings.patientName || 'Paciente'}\n` +
      `Medicamento: ${med.name}\n` +
      `Stock actual: ${med.currentStock} ${med.unit || ''}\n` +
      `Consumo diario: ${daily} ${med.unit || ''}/día\n` +
      `${refText}\n\n` +
      `Por favor gestionar la compra a la brevedad.`
    );

    const waPhone = (settings.emergencyContactWhatsapp || '').replace(/\D/g, '');
    const waLink = waPhone ? `https://wa.me/${waPhone}?text=${msg}` : `https://wa.me/?text=${msg}`;

    const contentHtml = `
      <p class="text-sm text-sec" style="margin-bottom:16px;">
        Se ha preparado el mensaje de solicitud de reposición para <strong>${Api.escapeHtml(med.name)}</strong>:
      </p>
      <div class="card" style="margin-bottom:16px;font-size:0.875rem;background:var(--bg-glass);white-space:pre-line;">
        🏥 CuidApp - Solicitud de Reposición
        Paciente: ${Api.escapeHtml(settings.patientName || 'Paciente')}
        Medicamento: ${Api.escapeHtml(med.name)}
        Stock actual: ${med.currentStock} ${Api.escapeHtml(med.unit || '')}
        Consumo diario: ${daily} ${Api.escapeHtml(med.unit || '')}/día
        ${Api.escapeHtml(refText)}
      </div>
      <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-full" style="display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;">
        📲 Abrir en WhatsApp
      </a>
    `;

    Ui.showModal('📤 Solicitar Reposición', contentHtml, null, false);
  };

  /**
   * Modal para agregar medicamento (RF-30, RF-31)
   */
  const showAddMedModal = () => {
    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="mn-name">Nombre del medicamento *</label>
        <input class="form-input" id="mn-name" placeholder="Ej: Metoprolol 50mg" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="mn-prescriber">Médico que prescribe</label>
        <input class="form-input" id="mn-prescriber" placeholder="Dr. García">
      </div>
      <div class="form-group">
        <label class="form-label" for="mn-indication">Indicación médica</label>
        <input class="form-input" id="mn-indication" placeholder="Ej: Control de hipertensión">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="mn-startdate">Fecha inicio</label>
          <input class="form-input" id="mn-startdate" type="date" value="${Api.todayStr()}">
        </div>
        <div class="form-group">
          <label class="form-label" for="mn-status">Estado</label>
          <select class="form-select" id="mn-status">
            <option value="active">Activo</option>
            <option value="paused">Pausado</option>
            <option value="suspended">Suspendido</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">📦 Stock inicial</label>
        <div class="form-row">
          <input class="form-input" id="mn-stock" type="number" placeholder="0" min="0" value="0">
          <input class="form-input" id="mn-unit" placeholder="tabletas / ml / cápsulas" value="tabletas">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="mn-daily">📅 Consumo diario manual (si no usa horarios)</label>
        <input class="form-input" id="mn-daily" type="number" placeholder="1" min="0" step="0.5" value="1">
      </div>
      <div class="form-group">
        <label class="form-label" for="mn-notes">Notas adicionales</label>
        <textarea class="form-textarea" id="mn-notes" placeholder="Tomar con alimentos, advertencias..."></textarea>
      </div>
    `;

    Ui.showModal('➕ Nuevo Medicamento', contentHtml, async () => {
      const name = document.getElementById('mn-name')?.value?.trim();
      const prescriber = document.getElementById('mn-prescriber')?.value?.trim() || null;
      const indication = document.getElementById('mn-indication')?.value?.trim() || null;
      const startDate = document.getElementById('mn-startdate')?.value || null;
      const status = document.getElementById('mn-status')?.value || 'active';
      const currentStock = parseFloat(document.getElementById('mn-stock')?.value) || 0;
      const unit = document.getElementById('mn-unit')?.value?.trim() || 'tabletas';
      const manualDailyAmount = parseFloat(document.getElementById('mn-daily')?.value) || 0;
      const notes = document.getElementById('mn-notes')?.value?.trim() || null;

      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      const res = await Api.addMedication({
        name,
        prescriber,
        indication,
        startDate,
        status,
        currentStock,
        unit,
        manualDailyAmount,
        notes
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(`${name} registrado con éxito`, 'success');
      render();
      DashboardModule?.render();
      return true;
    });
  };

  /**
   * Modal para editar medicamento
   */
  const showEditModal = (id) => {
    const med = cachedMeds.find(m => m.id === id);
    if (!med) return;

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="me-name">Nombre *</label>
        <input class="form-input" id="me-name" value="${Api.escapeHtml(med.name)}" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="me-prescriber">Médico prescriptor</label>
        <input class="form-input" id="me-prescriber" value="${Api.escapeHtml(med.prescriber || '')}">
      </div>
      <div class="form-group">
        <label class="form-label" for="me-indication">Indicación</label>
        <input class="form-input" id="me-indication" value="${Api.escapeHtml(med.indication || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="me-status">Estado</label>
          <select class="form-select" id="me-status">
            <option value="active" ${med.status === 'active' ? 'selected' : ''}>Activo</option>
            <option value="paused" ${med.status === 'paused' ? 'selected' : ''}>Pausado</option>
            <option value="suspended" ${med.status === 'suspended' ? 'selected' : ''}>Suspendido</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="me-stock">Stock actual</label>
          <input class="form-input" id="me-stock" type="number" min="0" value="${med.currentStock}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="me-unit">Unidad</label>
          <input class="form-input" id="me-unit" value="${Api.escapeHtml(med.unit || '')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="me-daily">Consumo manual/día</label>
          <input class="form-input" id="me-daily" type="number" step="0.5" value="${med.manualDailyAmount || 0}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="me-notes">Notas</label>
        <textarea class="form-textarea" id="me-notes">${Api.escapeHtml(med.notes || '')}</textarea>
      </div>
    `;

    Ui.showModal(`✏️ Editar — ${med.name}`, contentHtml, async () => {
      const name = document.getElementById('me-name')?.value?.trim();
      const prescriber = document.getElementById('me-prescriber')?.value?.trim() || null;
      const indication = document.getElementById('me-indication')?.value?.trim() || null;
      const status = document.getElementById('me-status')?.value || 'active';
      const currentStock = parseFloat(document.getElementById('me-stock')?.value) || 0;
      const unit = document.getElementById('me-unit')?.value?.trim() || 'tabletas';
      const manualDailyAmount = parseFloat(document.getElementById('me-daily')?.value) || 0;
      const notes = document.getElementById('me-notes')?.value?.trim() || null;

      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      const res = await Api.updateMedication(id, {
        name,
        prescriber,
        indication,
        status,
        currentStock,
        unit,
        manualDailyAmount,
        notes
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Medicamento actualizado', 'success');
      render();
      DashboardModule?.render();
      return true;
    });
  };

  /**
   * Modal para gestionar horarios de dosis (RF-39, RF-40)
   */
  const showManageSchedulesModal = async (medId) => {
    const med = cachedMeds.find(m => m.id === medId);
    if (!med) return;

    const schedulesRes = await Api.getMedicationSchedules(medId);
    const schedules = schedulesRes.data || [];

    const contentHtml = `
      <p class="text-sm text-sec" style="margin-bottom:12px;">
        Horarios de toma para <strong>${Api.escapeHtml(med.name)}</strong>:
      </p>

      <div id="sched-list" style="max-height:220px;overflow-y:auto;margin-bottom:12px;">
        ${schedules.length === 0 ? `
          <div class="text-xs text-muted" style="padding:8px 0;">No hay horarios registrados aún. Agrega uno abajo.</div>
        ` : schedules.map(s => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid var(--border-subtle);">
            <div>
              <span class="font-bold">${Api.escapeHtml(s.scheduledTime?.slice(0, 5))}</span>
              <span class="text-xs text-muted">· Dosis: ${s.dose} ${Api.escapeHtml(med.unit || '')}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <button class="btn btn-ghost btn-sm btn-toggle-sched" data-id="${Api.escapeHtml(s.id)}" data-active="${s.active}">
                ${s.active ? '🟢 Activo' : '⏸ Pausado'}
              </button>
              <button class="btn btn-ghost btn-sm text-critical btn-del-sched" data-id="${Api.escapeHtml(s.id)}" title="Eliminar">🗑</button>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="card" style="padding:10px;background:var(--bg-glass);margin-bottom:8px;">
        <div class="card-title" style="margin-bottom:8px;">+ AGREGAR HORARIO</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="ns-time">Hora *</label>
            <input class="form-input" id="ns-time" type="time" value="08:00" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="ns-dose">Dosis (${Api.escapeHtml(med.unit || '')}) *</label>
            <input class="form-input" id="ns-dose" type="number" step="0.5" min="0.1" value="1" required>
          </div>
        </div>
        <button class="btn btn-secondary btn-full btn-sm" id="btn-submit-new-sched">+ Agregar Horario</button>
      </div>
    `;

    Ui.showModal(`⏰ Horarios — ${med.name}`, contentHtml, null, false);

    // Eventos dentro del modal
    document.getElementById('btn-submit-new-sched')?.addEventListener('click', async () => {
      const timeVal = document.getElementById('ns-time')?.value;
      const doseVal = parseFloat(document.getElementById('ns-dose')?.value);

      if (!timeVal) {
        Ui.toast('Selecciona una hora', 'warning');
        return;
      }
      if (!doseVal || doseVal <= 0) {
        Ui.toast('Ingresa una dosis válida', 'warning');
        return;
      }

      const res = await Api.addMedicationSchedule({
        medicationId: medId,
        scheduledTime: timeVal,
        dose: doseVal,
        active: true
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return;
      }

      Ui.toast('Horario agregado', 'success');
      showManageSchedulesModal(medId); // recargar modal
      render();
    });

    // Delegación para activar/pausar o eliminar horario
    document.getElementById('sched-list')?.addEventListener('click', async (e) => {
      const btnToggle = e.target.closest('.btn-toggle-sched');
      if (btnToggle) {
        const schedId = btnToggle.getAttribute('data-id');
        const isActive = btnToggle.getAttribute('data-active') === 'true';
        const res = await Api.updateMedicationSchedule(schedId, { active: !isActive });
        if (res.error) {
          Ui.toast(res.error, 'error');
        } else {
          showManageSchedulesModal(medId);
          render();
        }
        return;
      }

      const btnDel = e.target.closest('.btn-del-sched');
      if (btnDel) {
        const schedId = btnDel.getAttribute('data-id');
        Ui.confirm('¿Eliminar horario?', 'Este horario ya no se programará.', async () => {
          const res = await Api.deleteMedicationSchedule(schedId);
          if (res.error) {
            Ui.toast(res.error, 'error');
          } else {
            showManageSchedulesModal(medId);
            render();
          }
        });
        return;
      }
    });
  };

  /**
   * Modal para registrar reposición mediante RPC record_restock (RF-36, RF-37)
   */
  const showRestockModal = (id) => {
    const med = cachedMeds.find(m => m.id === id);
    if (!med) return;

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="rs-qty">Cantidad recibida (${Api.escapeHtml(med.unit || '')}) *</label>
        <input class="form-input" id="rs-qty" type="number" placeholder="0" min="0.1" step="0.5" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="rs-est">Establecimiento / Farmacia</label>
        <input class="form-input" id="rs-est" placeholder="Ej: Farmacia San Benito">
      </div>
      <div class="form-group">
        <label class="form-label" for="rs-cost">Costo total ($)</label>
        <input class="form-input" id="rs-cost" type="number" placeholder="0.00" step="0.01" min="0" value="0.00">
        <span class="form-hint">Si el costo es mayor a 0, se creará automáticamente un gasto en Gastos.</span>
      </div>
    `;

    Ui.showModal(`📦 Registrar Reposición — ${med.name}`, contentHtml, async () => {
      const qty = parseFloat(document.getElementById('rs-qty')?.value);
      const est = document.getElementById('rs-est')?.value?.trim() || '';
      const cost = parseFloat(document.getElementById('rs-cost')?.value) || 0;

      if (!qty || isNaN(qty) || qty <= 0) {
        Ui.toast('Ingresa la cantidad recibida', 'warning');
        return false;
      }

      const res = await Api.recordRestock({
        medicationId: id,
        quantity: qty,
        establishment: est,
        cost
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(`Reposición de ${med.name} registrada con éxito`, 'success');
      render();
      DashboardModule?.render();
      return true;
    });
  };

  /**
   * Modal con historial de reposiciones de un medicamento (RF-38)
   */
  const showRestockHistory = async (id) => {
    const med = cachedMeds.find(m => m.id === id);
    if (!med) return;

    const res = await Api.getMedicationRestocks(id);
    const history = res.data || [];

    const contentHtml = `
      ${history.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-text">Sin historial de reposiciones aún.</div>
        </div>
      ` : history.map(r => `
        <div class="card" style="margin-bottom:8px;padding:10px;">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-bold">+${r.quantity} ${Api.escapeHtml(med.unit || '')}</div>
              <div class="text-xs text-muted">${Api.formatDateTime(r.createdAt)}</div>
              ${r.establishment ? `<div class="text-xs text-sec">🏪 ${Api.escapeHtml(r.establishment)}</div>` : ''}
              ${r.managedByProfile ? `<div class="text-xs text-sec">👤 ${Api.escapeHtml(r.managedByProfile.fullName)}</div>` : ''}
            </div>
            ${r.cost > 0 ? `<div class="exp-amount">$${Api.currency(r.cost)}</div>` : ''}
          </div>
        </div>
      `).join('')}
    `;

    Ui.showModal(`📋 Historial — ${med.name}`, contentHtml, null, false);
  };

  /**
   * Eliminar medicamento
   */
  const deleteMed = (id, name) => {
    Ui.confirm(`¿Eliminar ${name}?`, 'Se eliminará el medicamento, sus horarios e historial de reposiciones.', async () => {
      const res = await Api.deleteMedication(id);
      if (res.error) {
        Ui.toast(res.error, 'error');
      } else {
        Ui.toast(`${name} eliminado`, 'info');
        render();
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
    showAddMedModal,
    showEditModal,
    showRestockModal,
    showRestockHistory
  };
})();
