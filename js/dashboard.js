/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo Dashboard (js/dashboard.js)
   ═══════════════════════════════════════════════════════════════ */

const DashboardModule = (() => {
  'use strict';

  let cachedSupplyCtx = null;

  /**
   * Renderiza la pantalla principal del panel de control
   */
  const render = async () => {
    const el = document.getElementById('panel-dashboard');
    if (!el) return;

    Ui.skeleton(el);

    try {
      const todayStr = Api.todayStr();

      // Carga paralela de todos los datos necesarios para el dashboard
      const now = new Date();
      // Semana ISO actual para consultar el menú planificado
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
        tasksRes,
        medsRes,
        schedulesRes,
        adminsRes,
        invRes,
        apptsRes,
        notesRes,
        alertsRes,
        planRes,
        recipesRes,
        shoppingRes,
        supplyRes
      ] = await Promise.all([
        Api.getPatientStatus(),
        Api.getSettings(),
        Api.getCurrentShift(),
        Api.getTasksForDate(todayStr),
        Api.getMedications(),
        Api.getMedicationSchedules(),
        Api.getAdministrations({ date: todayStr }),
        Api.getInventory(),
        Api.getUpcomingAppointments(7),
        Api.getShiftNotes({ limit: 5 }),
        Api.getActiveAlerts(),
        Api.getWeeklyPlan(curWeekKey),
        Api.getRecipes(),
        Api.getShoppingList(),
        Api.getSupplyPlanContext()
      ]);

      const status = statusRes.data || { status: 'stable', notes: '' };
      const settings = settingsRes.data || { patientName: 'Paciente' };
      const shift = shiftRes.data;
      const tasks = tasksRes.data || [];
      const meds = medsRes.data || [];
      const schedules = schedulesRes.data || [];
      const admins = adminsRes.data || [];
      const inv = invRes.data || [];
      const appts = apptsRes.data || [];
      const notes = (notesRes.data || []).filter(n => !n.isRead);
      const alerts = alertsRes || [];
      const plan = Array.isArray(planRes?.data || planRes) ? (planRes?.data || planRes) : [];
      const recipes = recipesRes?.data || [];
      const shopping = shoppingRes?.data || [];
      const pendingShoppingCount = shopping.filter(i => !i.checked).length;
      const supplyCtx = supplyRes || { items: [], locations: [], stockRows: [], openOrderLines: [], suppliers: [] };
      cachedSupplyCtx = supplyCtx;

      // Cálculo de reposición e insumos críticos (Fase 10)
      let supplyPlan = { rows: [], counts: {} };
      try {
        if (typeof InventoryCalc !== 'undefined' && InventoryCalc.buildSupplyPlan) {
          supplyPlan = InventoryCalc.buildSupplyPlan(supplyCtx, { now: Api.nowISO() });
        }
      } catch (err) {
        console.warn('Aviso al calcular plan de insumos:', err);
      }

      const supplyItems = supplyCtx.items || [];
      const habLoc = (supplyCtx.locations || []).find(l => l.isUsagePoint) || { id: 'loc_hab', name: 'Habitación' };
      const criticalItems = supplyItems.filter(i => i.isCritical && (i.primaryLocationId || 'loc_hab') === habLoc.id);

      const nowMs = now.getTime();
      let criticalOverdueCount = 0;
      criticalItems.forEach(item => {
        const row = (supplyPlan.rows || []).find(r => r.item.id === item.id);
        const lastReview = row?.summary?.lastCountedAt ? new Date(row.summary.lastCountedAt).getTime() : 0;
        const freqHours = item.reviewEveryHours || 26; // 26h regla para críticos
        const elapsedHours = lastReview ? (nowMs - lastReview) / 3600000 : Infinity;
        if (elapsedHours >= (freqHours - 2)) {
          criticalOverdueCount++;
        }
      });

      const reorderRows = (supplyPlan.rows || []).filter(r => r.suggestedLine != null || r.status?.status === 'urgent' || r.status?.status === 'reorder');
      const reorderCount = reorderRows.length;
      const openOrders = supplyCtx.openOrderLines || [];
      const inTransitCount = openOrders.filter(ol => ol.status === 'ordered' || ol.status === 'partially_received').length;

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

      // Cálculo de tareas
      const doneTasks = tasks.filter(t => t.status === 'completed').length;
      const pendingTasks = tasks.filter(t => t.status !== 'completed').length;
      const taskPct = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;

      // Cálculo de dosis del día (RF-15)
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      // Map de administraciones registradas hoy por scheduleId
      const adminMap = new Map();
      admins.forEach(a => {
        if (a.scheduleId) adminMap.set(a.scheduleId, a);
      });

      // Dosis programadas de medicamentos activos y horarios activos
      const activeMedsMap = new Map(meds.filter(m => m.status === 'active').map(m => [m.id, m]));
      const todayDoses = [];

      schedules.filter(s => s.active && activeMedsMap.has(s.medicationId)).forEach(s => {
        const med = activeMedsMap.get(s.medicationId);
        const admin = adminMap.get(s.id);
        const [h, m] = (s.scheduledTime || '00:00').split(':').map(Number);
        const schedMinutes = h * 60 + m;
        const isLate = !admin && (schedMinutes < currentMinutes);
        const isPending = !admin && (schedMinutes >= currentMinutes);

        todayDoses.push({
          schedule: s,
          medication: med,
          admin,
          time: s.scheduledTime,
          schedMinutes,
          isLate,
          isPending,
          isDone: !!admin
        });
      });

      // Ordenar por hora programada
      todayDoses.sort((a, b) => a.schedMinutes - b.schedMinutes);

      const lateDoses = todayDoses.filter(d => d.isLate);
      const pendingDoses = todayDoses.filter(d => d.isPending);
      const totalPendingOrLateDoses = lateDoses.length + pendingDoses.length;

      // KPIs
      const lowMeds = meds.filter(m => m.status === 'active' && m.daysRemaining !== null && m.daysRemaining <= 3);
      const lowInv = inv.filter(i => i.isLow);

      const statusLabels = { stable: '🟢 Estable', alert: '🟡 Alerta', critical: '🔴 Crítico' };

      el.innerHTML = `
        <!-- Aviso destacado de revisión de insumos críticos (RF y Decisiones 4 y 5) -->
        ${criticalOverdueCount > 0 ? `
          <div class="card" style="margin-bottom:16px;background:rgba(239, 68, 68, 0.12);border-left:4px solid var(--critical);padding:12px 14px;">
            <div class="flex items-center justify-between" style="flex-wrap:wrap;gap:8px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:1.6rem;">⚠️</span>
                <div>
                  <div style="font-weight:800;color:var(--critical);font-size:0.9rem;letter-spacing:-0.01em;">
                    REVISIÓN DE INSUMOS CRÍTICOS PENDIENTE
                  </div>
                  <div class="text-xs text-muted">
                    ${criticalOverdueCount} insumo(s) crítico(s) en Habitación requieren conteo de guardia (límite 26h).
                  </div>
                </div>
              </div>
              <button class="btn btn-primary btn-sm" id="dash-btn-quick-critical" style="background:var(--critical);border-color:var(--critical);font-weight:700;">
                ⚡ Conteo Rápido
              </button>
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

        <!-- Dosis pendientes y atrasadas de hoy (RF-15) -->
        ${(lateDoses.length > 0 || pendingDoses.length > 0) ? `
          <div class="section-header" style="margin-top:16px;">
            <div class="card-title" style="margin-bottom:0;">💊 DOSIS PENDIENTES DE HOY</div>
            <button class="btn btn-ghost btn-sm" id="dash-btn-all-doses">Ir a Dosis →</button>
          </div>
          <div class="card" style="margin-bottom:16px;padding:8px 12px;">
            ${lateDoses.map(d => `
              <div class="exp-item" style="padding:8px 0;border-bottom:1px solid var(--border-subtle);cursor:pointer;" onclick="App.navigateTo('administration')">
                <div class="exp-info">
                  <div class="font-bold text-critical" style="display:flex;align-items:center;gap:6px;">
                    <span>⚠️ ${Api.escapeHtml(d.medication?.name)}</span>
                    <span class="badge" style="background:var(--critical-subtle);color:var(--critical);font-size:0.65rem;">Atrasada</span>
                  </div>
                  <div class="text-xs text-muted">Hora: ${Api.escapeHtml(d.time?.slice(0, 5))} · Dosis: ${d.schedule.dose} ${Api.escapeHtml(d.medication?.unit || '')}</div>
                </div>
                <button class="btn btn-primary btn-sm">Registrar</button>
              </div>
            `).join('')}

            ${pendingDoses.slice(0, 4).map(d => `
              <div class="exp-item" style="padding:8px 0;border-bottom:1px solid var(--border-subtle);cursor:pointer;" onclick="App.navigateTo('administration')">
                <div class="exp-info">
                  <div class="font-bold">${Api.escapeHtml(d.medication?.name)}</div>
                  <div class="text-xs text-muted">Hora: ${Api.escapeHtml(d.time?.slice(0, 5))} · Dosis: ${d.schedule.dose} ${Api.escapeHtml(d.medication?.unit || '')}</div>
                </div>
                <button class="btn btn-secondary btn-sm">Registrar</button>
              </div>
            `).join('')}

            ${pendingDoses.length > 4 ? `
              <div class="text-xs text-muted text-center" style="padding-top:6px;">
                + ${pendingDoses.length - 4} dosis pendientes más
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- Stats rápidas clicables (RF-16) -->
        <div class="quick-grid">
          <div class="quick-item" data-goto="administration" role="button" tabindex="0">
            <div class="quick-icon">💊</div>
            <div class="quick-val" style="color:${totalPendingOrLateDoses > 0 ? 'var(--alert)' : 'var(--stable)'}">
              ${totalPendingOrLateDoses}
            </div>
            <div class="quick-label">Dosis hoy</div>
          </div>
          <div class="quick-item" data-goto="tasks" role="button" tabindex="0">
            <div class="quick-icon">📋</div>
            <div class="quick-val" style="color:${pendingTasks > 0 ? 'var(--alert)' : 'var(--stable)'}">
              ${pendingTasks}
            </div>
            <div class="quick-label">Tareas pend.</div>
          </div>
          <div class="quick-item" data-goto="tasks" role="button" tabindex="0">
            <div class="quick-icon">✅</div>
            <div class="quick-val text-stable">${doneTasks}</div>
            <div class="quick-label">Tareas listas</div>
          </div>
          <div class="quick-item" data-goto="medications" role="button" tabindex="0">
            <div class="quick-icon">⚠️</div>
            <div class="quick-val" style="color:${lowMeds.length > 0 ? 'var(--critical)' : 'var(--stable)'}">
              ${lowMeds.length}
            </div>
            <div class="quick-label">Poco stock</div>
          </div>
          <div class="quick-item" data-goto="inventory" role="button" tabindex="0">
            <div class="quick-icon">📦</div>
            <div class="quick-val" style="color:${(criticalOverdueCount > 0 || reorderCount > 0) ? 'var(--critical)' : 'var(--stable)'}">
              ${reorderCount > 0 ? reorderCount : lowInv.length}
            </div>
            <div class="quick-label">${reorderCount > 0 ? 'Por pedir' : 'Insumo bajo'}</div>
          </div>
          <div class="quick-item" data-goto="food" data-subtab="planificacion" role="button" tabindex="0">
            <div class="quick-icon">🍽️</div>
            <div class="quick-val text-primary">
              ${totalTodayRecipesCount}
            </div>
            <div class="quick-label">Menú del día</div>
          </div>
        </div>

        <!-- Gestión de Insumos y Oxígeno (Fase 10) -->
        <div class="card" style="margin-bottom:16px;background:var(--bg-glass);border-left:3px solid var(--primary);">
          <div class="flex items-center justify-between" style="margin-bottom:10px;">
            <div class="flex items-center gap-2">
              <span style="font-size:1.25rem;">📦</span>
              <div class="card-title" style="margin-bottom:0;">GESTIÓN DE INSUMOS Y OXÍGENO</div>
            </div>
            <span class="btn btn-ghost btn-xs text-primary" style="cursor:pointer;" onclick="App.navigateTo('inventory')">Ver todo →</span>
          </div>

          <!-- Badges de estado -->
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-bottom:12px;">
            <div style="text-align:center;padding:8px 4px;background:var(--bg-subtle);border-radius:var(--r-sm);cursor:pointer;" onclick="App.navigateTo('inventory', 'relay')">
              <div style="font-size:1.1rem;font-weight:800;color:${criticalOverdueCount > 0 ? 'var(--critical)' : 'var(--stable)'};">
                ${criticalOverdueCount > 0 ? `⚠️ ${criticalOverdueCount}` : '✓ Al día'}
              </div>
              <div class="text-xs text-muted" style="font-size:0.7rem;">Críticos hab.</div>
            </div>
            <div style="text-align:center;padding:8px 4px;background:var(--bg-subtle);border-radius:var(--r-sm);cursor:pointer;" onclick="App.navigateTo('inventory', 'kanban')">
              <div style="font-size:1.1rem;font-weight:800;color:${reorderCount > 0 ? 'var(--alert)' : 'var(--stable)'};">
                ${reorderCount}
              </div>
              <div class="text-xs text-muted" style="font-size:0.7rem;">Por pedir</div>
            </div>
            <div style="text-align:center;padding:8px 4px;background:var(--bg-subtle);border-radius:var(--r-sm);cursor:pointer;" onclick="App.navigateTo('inventory', 'kanban')">
              <div style="font-size:1.1rem;font-weight:800;color:var(--accent);">
                ${inTransitCount}
              </div>
              <div class="text-xs text-muted" style="font-size:0.7rem;">En camino</div>
            </div>
          </div>

          <!-- Acciones rápidas de insumos -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button class="btn btn-secondary btn-sm" id="dash-btn-empty-oxygen" style="font-size:0.8rem;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;">
              <span>💨</span> <span>Se vació cilindro O₂</span>
            </button>
            <button class="btn btn-secondary btn-sm" id="dash-btn-start-relay" style="font-size:0.8rem;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;">
              <span>📋</span> <span>Relevo de Guardia</span>
            </button>
          </div>
        </div>

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

        <!-- Progreso del día (RF-17) -->
        <div class="card" style="margin-bottom:16px;">
          <div class="flex items-center justify-between" style="margin-bottom:8px;">
            <div class="card-title" style="margin-bottom:0;">📊 PROGRESO DE TAREAS HOY</div>
            <span class="text-sm font-bold text-accent">${taskPct}%</span>
          </div>
          <div class="flex items-center justify-between text-xs text-muted" style="margin-bottom:6px;">
            <span>${doneTasks} completadas de ${tasks.length}</span>
            <span>${pendingTasks} pendientes</span>
          </div>
          <div class="prog-track">
            <div class="prog-fill" style="width:${taskPct}%"></div>
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

        <!-- Próximas citas (RF-20) -->
        ${appts.length > 0 ? `
          <div class="section-header">
            <div class="card-title" style="margin-bottom:0;">📅 PRÓXIMAS CITAS (7 DÍAS)</div>
            <button class="btn btn-ghost btn-sm" onclick="App.navigateTo('agenda')">Ver todas</button>
          </div>
          ${appts.slice(0, 3).map(a => `
            <div class="appt-item" onclick="App.navigateTo('agenda')" style="cursor:pointer;">
              <div class="appt-date">📅 ${Api.formatDateShort(a.apptDate)}${a.apptTime ? ' · ' + Api.escapeHtml(a.apptTime.slice(0, 5)) : ''}</div>
              <div class="appt-title">${Api.escapeHtml(a.title)}</div>
              <div class="appt-details">
                ${a.doctor ? `<span class="appt-detail">👨‍⚕️ ${Api.escapeHtml(a.doctor)}</span>` : ''}
                <span class="badge badge-${Api.escapeHtml(a.modality)}">${Api.escapeHtml(a.modality)}</span>
                ${a.preparation ? `<span class="appt-detail text-alert">⚠️ Preparación requerida</span>` : ''}
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
          <button class="card" style="cursor:pointer;text-align:left;background:var(--bg-glass);" onclick="App.showWhatNow()">
            <div style="font-size:1.25rem;margin-bottom:4px;">💡</div>
            <div class="font-bold text-sm">¿Qué hago ahora?</div>
            <div class="text-xs text-muted">Modo cuidador nuevo</div>
          </button>
          <button class="card" style="cursor:pointer;text-align:left;background:var(--bg-glass);" onclick="App.navigateTo('agenda')">
            <div style="font-size:1.25rem;margin-bottom:4px;">📅</div>
            <div class="font-bold text-sm">Agenda médica</div>
            <div class="text-xs text-muted">Citas y preparaciones</div>
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
    el.querySelector('#dash-btn-all-doses')?.addEventListener('click', () => App.navigateTo('administration'));

    // Grid KPIs tocables (RF-16)
    el.querySelectorAll('.quick-item[data-goto]').forEach(item => {
      item.addEventListener('click', () => {
        const panel = item.getAttribute('data-goto');
        const subTab = item.getAttribute('data-subtab');
        if (panel) App.navigateTo(panel, subTab);
      });
    });

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

    // Conteo Rápido de Críticos desde banner o widget
    el.querySelector('#dash-btn-quick-critical')?.addEventListener('click', () => {
      if (window.InventoryModule?.showQuickCriticalModal) {
        window.InventoryModule.showQuickCriticalModal();
      }
    });

    // Iniciar relevo de guardia desde dashboard
    el.querySelector('#dash-btn-start-relay')?.addEventListener('click', () => {
      App.navigateTo('inventory', 'relay');
      if (window.InventoryModule?.switchTab) {
        window.InventoryModule.switchTab('relay');
      }
    });

    // Botón rápido: Se vació cilindro de O₂
    el.querySelector('#dash-btn-empty-oxygen')?.addEventListener('click', async () => {
      const items = cachedSupplyCtx?.items || [];
      const locations = cachedSupplyCtx?.locations || [];
      const stockRows = cachedSupplyCtx?.stockRows || [];
      const habLoc = locations.find(l => l.isUsagePoint) || { id: 'loc_hab', name: 'Habitación' };

      // Encontrar ítem de oxígeno
      const oxygenItem = items.find(i =>
        i.oxygenFlowLpm != null ||
        i.cylinderCapacityLiters != null ||
        i.categoryId === 'cat_oxigeno' ||
        /ox[ií]geno/i.test(i.name)
      );

      if (!oxygenItem) {
        Ui.toast('No se encontró ningún ítem de oxígeno configurado en el inventario', 'warning');
        return;
      }

      Ui.confirm(`¿Confirmas que se vació 1 cilindro de ${oxygenItem.name} en ${habLoc.name}?\nSe registrará como vacío (lleno -1, vacío +1).`, async () => {
        const movements = InventoryCalc.buildEmptiedMovements(
          oxygenItem.id,
          habLoc.id,
          Api.nowISO(),
          () => LocalStore.uuid()
        );

        const res = await Api.recordSupplyMovements(movements);
        if (res && res.error) {
          Ui.toast(res.error, 'error');
          return;
        }

        // Verificar si hay cilindros llenos en reserva
        const reserveLocId = oxygenItem.reserveLocationId || 'loc_arm';
        const fullInReserve = stockRows.find(s => s.itemId === oxygenItem.id && s.locationId === reserveLocId && s.stockState === 'full')?.effectiveStock ?? 0;
        const reserveLoc = locations.find(l => l.id === reserveLocId) || { name: 'Armario Central' };

        if (fullInReserve > 0) {
          Ui.confirm(`Cilindro vacío registrado.\nHay ${fullInReserve} cilindro(s) lleno(s) en ${reserveLoc.name}.\n¿Deseas registrar el traslado de 1 cilindro lleno a la Habitación ahora?`, async () => {
            const transferMovs = InventoryCalc.buildTransferMovements(
              oxygenItem.id,
              reserveLocId,
              habLoc.id,
              1,
              Api.nowISO(),
              () => LocalStore.uuid()
            );
            const trRes = await Api.recordSupplyMovements(transferMovs);
            if (trRes && trRes.error) {
              Ui.toast(trRes.error, 'error');
            } else {
              Ui.toast('Cilindro lleno trasladado a Habitación', 'success');
            }
            render();
          });
        } else {
          Ui.toast('Cilindro registrado como vacío. ⚠️ No quedan cilindros llenos en reserva.', 'warning');
          render();
        }
      });
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
