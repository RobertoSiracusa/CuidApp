/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo Dashboard (js/dashboard.js)
   ═══════════════════════════════════════════════════════════════ */

const DashboardModule = (() => {
  'use strict';

  /**
   * Renderiza la pantalla principal del panel de control
   */
  const render = async () => {
    const el = document.getElementById('panel-dashboard');
    if (!el) return;

    Ui.skeleton(el);

    try {
      const todayStr = Api.todayStr();
      const isAdmin = Auth.isAdmin();

      // Semana ISO actual para consultar el menú planificado
      const now = new Date();
      const dUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      const dNum = dUtc.getUTCDay() || 7;
      dUtc.setUTCDate(dUtc.getUTCDate() + 4 - dNum);
      const yStart = new Date(Date.UTC(dUtc.getUTCFullYear(), 0, 1));
      const curWeekNo = Math.ceil((((dUtc - yStart) / 86400000) + 1) / 7);
      const curWeekKey = `${dUtc.getUTCFullYear()}-W${String(curWeekNo).padStart(2, '0')}`;

      const [
        statusRes,
        settingsRes,
        shiftRes,
        notesRes,
        alertsRes,
        planRes,
        recipesRes,
        shoppingRes,
        stockRes
      ] = await Promise.all([
        Api.getPatientStatus(),
        Api.getSettings(),
        Api.getCurrentShift(),
        Api.getShiftNotes({ limit: 5 }),
        Api.getActiveAlerts(),
        Api.getWeeklyPlan(curWeekKey),
        Api.getRecipes(),
        Api.getShoppingList(),
        isAdmin ? Api.getStockItems() : Promise.resolve({ ok: true, data: [] })
      ]);

      const status = statusRes.data || { status: 'stable', notes: '' };
      const settings = settingsRes.data || { patientName: 'Paciente' };
      const shift = shiftRes.data;
      const notes = (notesRes.data || []).filter(n => !n.isRead);
      const alerts = alertsRes || [];
      const plan = Array.isArray(planRes?.data || planRes) ? (planRes?.data || planRes) : [];
      const recipes = recipesRes?.data || [];
      const shopping = shoppingRes?.data || [];
      const pendingShoppingCount = shopping.filter(i => !i.checked).length;

      // Control de insumos (solo admin): revisiones vencidas y faltantes
      const stockItems = stockRes?.ok ? (stockRes.data || []) : [];
      const stockRows = stockItems.map(item => ({ item, st: Api.stockItemStatus(item, now) }));
      const dueRows = stockRows.filter(r => r.st.checkDue);
      const lowRows = stockRows.filter(r => r.st.stockState === 'low' || r.st.stockState === 'empty');
      const dueCritical = dueRows.filter(r => r.item.priority === 1).length;

      // Menú de hoy (RF-74)
      const recipeMap = new Map(recipes.map(r => [r.id, r]));
      // Cuadrícula semanal usa 0 = Lunes ... 6 = Domingo
      const todayDayIndex = (now.getDay() + 6) % 7;
      const todayDate = todayStr;
      const mealTypes = [
        { id: 'desayuno', legacyId: 'breakfast', label: 'Desayuno', icon: '🌅' },
        { id: 'almuerzo', legacyId: 'lunch',     label: 'Almuerzo', icon: '🍽️' },
        { id: 'cena',     legacyId: 'dinner',    label: 'Cena',     icon: '🌙' }
      ];
      const todayMeals = [];
      let totalTodayRecipesCount = 0;
      mealTypes.forEach(mt => {
        const slot = plan.find(s => (
          s &&
          ((s.date && s.date === todayDate) || (!s.date && Number(s.dayIndex ?? s.dayOfWeek) === todayDayIndex && (s.weekKey === curWeekKey || !s.weekKey))) &&
          (s.mealType === mt.id || s.mealType === mt.legacyId)
        ));
        const rNames = (slot?.recipeIds || []).map(id => recipeMap.get(id)?.name).filter(Boolean);
        totalTodayRecipesCount += rNames.length;
        if (rNames.length > 0) {
          todayMeals.push({
            icon: mt.icon,
            label: mt.label,
            recipesCount: rNames.length,
            text: rNames.join(', ')
          });
        }
      });

      const statusLabels = { stable: '🟢 Estable', alert: '🟡 Alerta', critical: '🔴 Crítico' };

      el.innerHTML = `
        <!-- Alerta visible de revisión de insumos (solo admin) -->
        ${isAdmin && dueRows.length > 0 ? `
          <div class="card" style="margin-bottom:16px;background:var(--critical-bg);border-left:4px solid var(--critical);">
            <div class="flex items-center justify-between" style="flex-wrap:wrap;gap:8px;">
              <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                <span style="font-size:1.6rem;">⚠️</span>
                <div>
                  <div style="font-weight:800;color:var(--critical);font-size:0.9rem;">
                    ${dueRows.length} INSUMO${dueRows.length === 1 ? '' : 'S'} POR REVISAR
                  </div>
                  <div class="text-xs text-muted">
                    ${dueCritical > 0 ? `${dueCritical} de nivel 1 (crítico) · ` : ''}Anota el stock actual para ponerlos al día.
                  </div>
                </div>
              </div>
              <button class="btn btn-danger btn-sm" id="dash-btn-stock-due">Revisar ahora</button>
            </div>
          </div>
        ` : ''}

        <!-- Estado del paciente (RF-12, RF-13) -->
        <div class="db-status-card">
          <div class="flex items-center justify-between" style="margin-bottom:10px;">
            <div>
              <div class="card-title">ESTADO DEL PACIENTE</div>
              <div style="font-size:1.25rem;font-weight:900;letter-spacing:-.02em;">${Api.escapeHtml(settings.patientName)}</div>
            </div>
            <span class="status-badge ${status.status}">
              <span class="status-dot ${status.status === 'stable' ? 'pulse' : ''}"></span>
              ${statusLabels[status.status] || 'Estable'}
            </span>
          </div>
          <div class="text-xs text-muted" style="margin-bottom:12px;">
            Actualizado ${Api.timeAgo(status.updatedAt)}
            ${status.updatedByProfile ? ` · por ${Api.escapeHtml(status.updatedByProfile.fullName)}` : ''}
            ${status.notes ? `<br><em>${Api.escapeHtml(status.notes)}</em>` : ''}
          </div>
          <div class="status-controls">
            <button class="status-btn stable ${status.status === 'stable' ? 'selected' : ''}" data-status="stable">🟢 Estable</button>
            <button class="status-btn alert ${status.status === 'alert' ? 'selected' : ''}" data-status="alert">🟡 Alerta</button>
            <button class="status-btn critical ${status.status === 'critical' ? 'selected' : ''}" data-status="critical">🔴 Crítico</button>
          </div>
        </div>

        <!-- A cargo ahora (RF-14) -->
        <div class="card-title">👤 A CARGO AHORA</div>
        ${shift ? `
          <div class="shift-card" style="margin-bottom:16px;">
            <div class="shift-person">
              <div class="shift-avatar">${Api.escapeHtml(shift.careRole?.icon || '👤')}</div>
              <div class="shift-info">
                <div class="shift-name">${Api.escapeHtml(shift.profile?.fullName || 'Desconocido')}</div>
                <div class="shift-role">${Api.escapeHtml(shift.careRole?.name || 'Cuidador')}</div>
                <div class="shift-time">Desde ${Api.timeAgo(shift.startedAt)} · ${Api.shiftDuration(shift.startedAt)}</div>
              </div>
              <button class="btn btn-secondary btn-sm" id="dash-btn-roles">Ceder turno</button>
            </div>
          </div>
        ` : `
          <div class="card" style="text-align:center;padding:20px;margin-bottom:16px;">
            <div style="font-size:2rem;margin-bottom:8px;opacity:.5">👤</div>
            <div class="text-muted text-sm" style="margin-bottom:12px;">Nadie está a cargo del turno ahora</div>
            <button class="btn btn-primary btn-sm" id="dash-btn-take-shift">Tomar turno</button>
          </div>
        `}

        <!-- Control de insumos (solo admin) -->
        ${isAdmin ? `
          <div class="card" style="margin-bottom:16px;cursor:pointer;background:var(--bg-glass);border-left:3px solid ${dueRows.length || lowRows.length ? 'var(--critical)' : 'var(--stable)'};" id="dash-stock-card" role="button" tabindex="0">
            <div class="flex items-center justify-between" style="margin-bottom:10px;">
              <div class="card-title" style="margin-bottom:0;">📦 CONTROL DE INSUMOS</div>
              <span class="btn btn-ghost btn-xs text-accent">Ver insumos →</span>
            </div>
            ${stockRes?.ok ? `
              <div class="stock-summary" style="margin-bottom:0;">
                <div class="stock-kpi">
                  <div class="stock-kpi-val" style="color:${dueRows.length ? 'var(--critical)' : 'var(--stable)'}">${dueRows.length}</div>
                  <div class="stock-kpi-label">Por revisar</div>
                </div>
                <div class="stock-kpi">
                  <div class="stock-kpi-val" style="color:${lowRows.length ? 'var(--alert)' : 'var(--stable)'}">${lowRows.length}</div>
                  <div class="stock-kpi-label">Por reponer</div>
                </div>
                <div class="stock-kpi">
                  <div class="stock-kpi-val">${stockItems.length}</div>
                  <div class="stock-kpi-label">Registrados</div>
                </div>
              </div>
            ` : `<div class="text-xs text-muted">${Api.escapeHtml(stockRes?.error || 'No se pudo cargar el control de insumos.')}</div>`}
          </div>
        ` : ''}

        <!-- Menú de Hoy (RF-74: Prominente en Inicio, siempre visible) -->
        <div class="card" style="margin-bottom:16px;cursor:pointer;background:var(--bg-glass);border-left:3px solid var(--accent);" onclick="App.navigateTo('food', 'planificacion')">
          <div class="flex items-center justify-between" style="margin-bottom:8px;">
            <div class="flex items-center gap-2">
              <div class="card-title" style="margin-bottom:0;">🍽️ MENÚ DE HOY</div>
              <span class="badge" style="font-size:0.72rem;background:rgba(14, 165, 233, 0.15);color:var(--accent);font-weight:700;padding:2px 8px;border-radius:var(--r-full);">
                ${totalTodayRecipesCount} receta${totalTodayRecipesCount === 1 ? '' : 's'}
              </span>
            </div>
            <span class="btn btn-ghost btn-xs text-accent">Ver planificación →</span>
          </div>
          ${totalTodayRecipesCount > 0 ? `
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${todayMeals.map(m => `
                <div style="display:flex;align-items:center;gap:8px;font-size:0.85rem;">
                  <span>${m.icon}</span>
                  <strong style="color:var(--text);min-width:70px;">${Api.escapeHtml(m.label)}:</strong>
                  <span class="text-primary font-bold" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Api.escapeHtml(m.text)}</span>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="text-xs text-muted" style="margin-bottom:8px;">0 recetas planificadas para hoy. Toca para planificar desayuno, almuerzo o cena en la cuadrícula semanal.</div>
            <button class="btn btn-secondary btn-xs" onclick="event.stopPropagation(); App.navigateTo('food', 'planificacion');">
              📅 Planificar comidas de hoy
            </button>
          `}
        </div>

        <!-- Lista de compra (Siempre visible: pendientes o cero pendientes) -->
        <div class="card" style="margin-bottom:16px;cursor:pointer;background:var(--bg-glass);border-left:3px solid ${pendingShoppingCount > 0 ? 'var(--primary)' : 'var(--stable)'};" onclick="App.navigateTo('food', 'compras')">
          <div class="flex items-center justify-between">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:1.6rem;">🛒</span>
              <div>
                <div class="card-title" style="margin-bottom:2px;font-size:0.8rem;">LISTA DE COMPRA</div>
                <div class="font-bold text-sm" style="color:${pendingShoppingCount > 0 ? 'var(--text)' : 'var(--stable)'};">
                  ${pendingShoppingCount > 0
                    ? `${pendingShoppingCount} ingrediente${pendingShoppingCount === 1 ? '' : 's'} pendiente${pendingShoppingCount === 1 ? '' : 's'} por comprar`
                    : '0 pendientes · Lista de compra al día'}
                </div>
              </div>
            </div>
            <span class="btn btn-ghost btn-xs text-primary">Ver compras →</span>
          </div>
        </div>

        <!-- Notas de turno no leídas (RF-18) -->
        ${notes.length > 0 ? `
          <div class="card-title">📝 NOTAS DEL TURNO ANTERIOR</div>
          ${notes.slice(0, 3).map(note => `
            <div class="shift-note-card">
              <div class="shift-note-hdr">
                <span>✍️ ${Api.escapeHtml(note.author?.fullName || 'Cuidador')}</span>
                <span>${Api.timeAgo(note.createdAt)}</span>
              </div>
              <div class="shift-note-body">${Api.escapeHtml(note.note)}</div>
              <button class="btn btn-ghost btn-sm btn-mark-note-read" data-id="${Api.escapeHtml(note.id)}" style="margin-top:8px;">Marcar leída ✓</button>
            </div>
          `).join('')}
        ` : ''}

        <!-- Alertas activas (RF-19) -->
        ${alerts.length > 0 ? `
          <div class="card-title">⚠️ ALERTAS ACTIVAS</div>
          ${alerts.slice(0, 4).map(a => `
            <div class="card" style="border-color:${a.type === 'critical' ? 'var(--critical)' : 'var(--alert)'};margin-bottom:8px;">
              <div class="flex items-center gap-sm">
                <span>${a.type === 'critical' ? '🔴' : '⚠️'}</span>
                <div style="flex:1">
                  <div class="font-bold text-sm">${Api.escapeHtml(a.title)}</div>
                  <div class="text-xs text-muted">${Api.escapeHtml(a.message)}</div>
                </div>
                <button class="btn btn-sm btn-secondary" onclick="App.navigateTo('${Api.escapeHtml(a.module)}')">Ver</button>
              </div>
            </div>
          `).join('')}
        ` : ''}

        <!-- Acceso rápido -->
        <div class="card-title">⚡ ACCESO RÁPIDO</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
          <button class="card" style="cursor:pointer;text-align:left;background:var(--bg-glass);" id="dash-quick-note">
            <div style="font-size:1.25rem;margin-bottom:4px;">📝</div>
            <div class="font-bold text-sm">Nota de relevo</div>
            <div class="text-xs text-muted">Mensaje al siguiente turno</div>
          </button>
          <button class="card" style="cursor:pointer;text-align:left;background:var(--bg-glass);" onclick="App.navigateTo('food', 'planificacion')">
            <div style="font-size:1.25rem;margin-bottom:4px;">🍽️</div>
            <div class="font-bold text-sm">Menú del día</div>
            <div class="text-xs text-muted">${totalTodayRecipesCount > 0 ? `${totalTodayRecipesCount} receta${totalTodayRecipesCount === 1 ? '' : 's'} para hoy` : 'Plan de alimentación'}</div>
          </button>
        </div>
      `;

      bindEvents(el);
    } catch (err) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar el panel principal: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="dash-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('dash-retry-btn')?.addEventListener('click', render);
    }
  };

  /**
   * Enlazar eventos del dashboard
   */
  const bindEvents = (el) => {
    // Cambio de estado del paciente (RF-13)
    el.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newStatus = btn.getAttribute('data-status');
        if (newStatus) await updatePatientStatus(newStatus);
      });
    });

    // Botones de turno
    el.querySelector('#dash-btn-roles')?.addEventListener('click', () => App.navigateTo('roles'));
    el.querySelector('#dash-btn-take-shift')?.addEventListener('click', () => App.navigateTo('roles'));

    // Control de insumos
    el.querySelector('#dash-btn-stock-due')?.addEventListener('click', () => App.navigateTo('stock', 'due'));
    el.querySelector('#dash-stock-card')?.addEventListener('click', () => App.navigateTo('stock'));

    // Marcar nota de relevo como leída (RF-18)
    el.querySelectorAll('.btn-mark-note-read').forEach(btn => {
      btn.addEventListener('click', async () => {
        const noteId = btn.getAttribute('data-id');
        if (noteId) {
          const res = await Api.markShiftNotesRead([noteId]);
          if (!res.error) {
            Ui.toast('Nota marcada como leída', 'info');
            render();
          }
        }
      });
    });

    // Nota rápida de relevo
    el.querySelector('#dash-quick-note')?.addEventListener('click', () => {
      RolesModule.showAddShiftNoteModal();
    });
  };

  /**
   * Actualizar estado del paciente
   */
  const updatePatientStatus = async (status) => {
    const res = await Api.updatePatientStatus(status);
    if (res.error) {
      Ui.toast(res.error, 'error');
      return;
    }

    Ui.toast('Estado del paciente actualizado', 'success');
    if (status === 'critical') {
      Ui.toast('🔴 Estado CRÍTICO activado', 'error');
    }

    render();
    Ui.renderAlerts();
  };

  const init = () => {
    render();
  };

  return {
    init,
    render,
    updatePatientStatus
  };
})();

window.DashboardModule = DashboardModule;
