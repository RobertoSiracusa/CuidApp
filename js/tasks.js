/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo de Tareas Diarias (js/tasks.js)
   ═══════════════════════════════════════════════════════════════ */

const TasksModule = (() => {
  'use strict';

  let selectedDate = Api.todayStr();

  const SHIFTS = [
    { id: 'morning',   label: '🌅 Mañana',  color: 'var(--accent)' },
    { id: 'afternoon', label: '☀️ Tarde',   color: 'var(--alert)' },
    { id: 'night',     label: '🌙 Noche',   color: 'var(--accent-2)' },
    { id: 'any',       label: '🔁 Cualquier turno', color: 'var(--text-muted)' }
  ];

  /**
   * Renderiza el módulo de tareas
   */
  const render = async () => {
    const el = document.getElementById('panel-tasks');
    if (!el) return;

    Ui.skeleton(el);

    try {
      const [tasksRes, rolesRes, profilesRes] = await Promise.all([
        Api.getTasksForDate(selectedDate),
        Api.getCareRoles(),
        Api.getProfiles()
      ]);

      const tasks = tasksRes.data || [];
      const roles = rolesRes.data || [];
      const profiles = (profilesRes.data || []).filter(p => p.active);

      const doneCount = tasks.filter(t => t.status === 'completed').length;
      const pct = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;
      const emergencyTasks = tasks.filter(t => t.isEmergency);

      const byShift = {};
      SHIFTS.forEach(s => {
        byShift[s.id] = tasks.filter(t => t.shift === s.id && !t.isEmergency);
      });

      el.innerHTML = `
        <div class="section-header">
          <div class="section-title">📋 Tareas</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="date" class="form-input" id="task-date-picker" value="${selectedDate}" style="padding:6px 8px;font-size:0.8125rem;width:auto;">
            <button class="btn btn-primary btn-sm" id="btn-add-task">+ Tarea</button>
          </div>
        </div>

        <!-- Progreso del día -->
        <div class="card" style="margin-bottom:16px;">
          <div class="flex items-center justify-between" style="margin-bottom:6px;">
            <span class="text-sm">${doneCount} de ${tasks.length} completadas</span>
            <span class="text-sm font-bold text-accent">${pct}%</span>
          </div>
          <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>
        </div>

        <!-- Tareas urgentes / emergencia (RF-60) -->
        ${emergencyTasks.length > 0 ? `
          <div class="task-group-hdr">
            <div class="task-group-label text-critical">🆘 Urgentes / Prioritarias</div>
            <div class="task-group-line" style="background:rgba(239,68,68,.3);"></div>
            <span class="text-xs text-muted">${emergencyTasks.filter(t => t.status === 'completed').length}/${emergencyTasks.length}</span>
          </div>
          ${emergencyTasks.map(t => renderTaskItem(t)).join('')}
        ` : ''}

        <!-- Tareas agrupadas por turno (RF-59) -->
        ${SHIFTS.map(s => {
          const shiftTasks = byShift[s.id] || [];
          if (shiftTasks.length === 0 && s.id === 'any') return '';
          return `
            <div class="task-group-hdr">
              <div class="task-group-label">${s.label}</div>
              <div class="task-group-line"></div>
              <span class="text-xs text-muted">${shiftTasks.filter(t => t.status === 'completed').length}/${shiftTasks.length}</span>
            </div>
            ${shiftTasks.length === 0 ? `
              <div class="text-xs text-muted" style="margin-bottom:12px;padding-left:4px;">Sin tareas asignadas a este turno</div>
            ` : shiftTasks.map(t => renderTaskItem(t)).join('')}
          `;
        }).join('')}

        ${tasks.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">📋</div>
            <div class="empty-text">Sin tareas registradas para esta fecha.<br>Toca "+ Tarea" para agregar una.</div>
          </div>
        ` : ''}
      `;

      bindEvents(el, roles, profiles);
    } catch (err) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar tareas: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="tasks-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('tasks-retry-btn')?.addEventListener('click', render);
    }
  };

  /**
   * Renderiza el HTML de una tarea individual
   */
  const renderTaskItem = (t) => {
    const checkIcons = { completed: '✓', 'in-progress': '→', pending: '' };
    const checkClasses = { completed: 'completed', 'in-progress': 'progress', pending: '' };
    const assignee = t.assignedProfile?.fullName || t.assignedCareRole?.name || '';

    return `
      <div class="task-item ${t.status === 'completed' ? 'completed' : ''} ${t.isEmergency ? 'emergency' : ''}" data-id="${Api.escapeHtml(t.id)}">
        <div class="task-check ${checkClasses[t.status] || ''}" data-action="cycle">
          ${checkIcons[t.status] || ''}
        </div>
        <div class="task-body" data-action="cycle">
          <div class="task-title ${t.status === 'completed' ? 'completed' : ''}">${Api.escapeHtml(t.title)}</div>
          <div class="task-sub">
            ${assignee ? `👤 ${Api.escapeHtml(assignee)}` : ''}
            ${t.templateId ? ' · 🔁 Recurrente' : ''}
          </div>
        </div>
        <div>
          <button class="btn btn-ghost btn-sm btn-task-detail" data-id="${Api.escapeHtml(t.id)}" title="Ver detalle" aria-label="Detalle de tarea">⋯</button>
        </div>
      </div>
    `;
  };

  /**
   * Enlazar eventos del panel de tareas
   */
  const bindEvents = (el, roles, profiles) => {
    // Cambio de fecha (RF-65)
    el.querySelector('#task-date-picker')?.addEventListener('change', (e) => {
      selectedDate = e.target.value;
      render();
    });

    // Botón agregar tarea
    el.querySelector('#btn-add-task')?.addEventListener('click', () => showAddModal(roles, profiles));

    // Delegación en la lista de tareas
    el.addEventListener('click', async (e) => {
      const taskItem = e.target.closest('.task-item');
      if (!taskItem) return;
      const taskId = taskItem.getAttribute('data-id');
      if (!taskId) return;

      const detailBtn = e.target.closest('.btn-task-detail');
      if (detailBtn) {
        showTaskDetail(taskId);
        return;
      }

      // Si tocó el checkbox o el cuerpo, rota el estado (RF-61)
      if (e.target.closest('[data-action="cycle"]')) {
        await cycleStatus(taskId);
      }
    });
  };

  /**
   * Rotar estado de tarea: Pendiente -> En progreso -> Completada -> Pendiente
   */
  const cycleStatus = async (taskId) => {
    const tasksRes = await Api.getTasksForDate(selectedDate);
    const task = (tasksRes.data || []).find(t => t.id === taskId);
    if (!task) return;

    const nextState = {
      pending: 'in-progress',
      'in-progress': 'completed',
      completed: 'pending'
    };
    const newStatus = nextState[task.status] || 'pending';

    const res = await Api.updateTask(taskId, { status: newStatus });
    if (res.error) {
      Ui.toast(res.error, 'error');
      return;
    }

    if (newStatus === 'completed') {
      Ui.toast('✅ Tarea completada', 'success');
    }

    render();
    DashboardModule.render();
  };

  /**
   * Ver detalle de tarea, comentarios firmados y opciones
   */
  const showTaskDetail = async (taskId) => {
    const [tasksRes, commentsRes] = await Promise.all([
      Api.getTasksForDate(selectedDate),
      Api.getTaskComments(taskId)
    ]);

    const task = (tasksRes.data || []).find(t => t.id === taskId);
    if (!task) return;

    const comments = commentsRes.data || [];
    const statusLabels = { completed: 'Completada', 'in-progress': 'En progreso', pending: 'Pendiente' };
    const assignee = task.assignedProfile?.fullName || task.assignedCareRole?.name || 'Sin asignar';

    const contentHtml = `
      <div class="card" style="margin-bottom:12px;">
        <div class="flex items-center justify-between">
          <span class="badge badge-${task.status === 'completed' ? 'completed' : task.status === 'in-progress' ? 'progress' : 'pending'}">
            ${statusLabels[task.status] || 'Pendiente'}
          </span>
          ${task.isEmergency ? '<span class="badge badge-emergency">🆘 Urgente</span>' : ''}
          ${task.templateId ? '<span class="badge badge-info">🔁 Recurrente</span>' : ''}
        </div>
        ${task.description ? `<div class="text-sm text-sec" style="margin-top:8px;">${Api.escapeHtml(task.description)}</div>` : ''}
        <div class="text-xs text-muted" style="margin-top:8px;">
          Asignado a: <strong>${Api.escapeHtml(assignee)}</strong>
        </div>
      </div>

      <!-- Comentarios firmados (RF-62) -->
      <div class="card-title">💬 Comentarios</div>
      <div id="task-comments-box" style="max-height:180px;overflow-y:auto;margin-bottom:8px;">
        ${comments.length === 0 ? `
          <div class="text-xs text-muted" style="margin-bottom:8px;">Sin comentarios aún.</div>
        ` : comments.map(c => `
          <div class="shift-note-card" style="margin-bottom:6px;padding:8px;">
            <div class="shift-note-hdr" style="font-size:0.75rem;">
              <span><strong>${Api.escapeHtml(c.author?.fullName || 'Usuario')}</strong></span>
              <span>${Api.timeAgo(c.createdAt)}</span>
            </div>
            <div class="shift-note-body" style="font-size:0.8125rem;">${Api.escapeHtml(c.comment)}</div>
          </div>
        `).join('')}
      </div>

      <div class="form-group" style="margin-bottom:12px;">
        <input class="form-input" id="new-task-comment" placeholder="Escribe un comentario..." autocomplete="off">
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" id="btn-add-comment">💬 Comentar</button>
        <button class="btn btn-secondary btn-sm" id="btn-edit-task">✏️ Editar</button>
        <button class="btn btn-danger btn-sm" id="btn-del-task">🗑 Eliminar</button>
      </div>
    `;

    Ui.showModal(`📋 ${task.title}`, contentHtml, null, false);

    // Listener para comentar
    document.getElementById('btn-add-comment')?.addEventListener('click', async () => {
      const input = document.getElementById('new-task-comment');
      const text = input?.value?.trim();
      if (!text) return;

      const res = await Api.addTaskComment(taskId, text);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return;
      }

      Ui.toast('Comentario agregado', 'success');
      showTaskDetail(taskId); // recarga el modal
    });

    // Listener para editar
    document.getElementById('btn-edit-task')?.addEventListener('click', () => {
      Ui.closeModal();
      showEditModal(task);
    });

    // Listener para eliminar
    document.getElementById('btn-del-task')?.addEventListener('click', () => {
      Ui.confirm('¿Eliminar tarea?', 'Esta acción no se puede deshacer.', async () => {
        const res = await Api.deleteTask(taskId);
        if (res.error) {
          Ui.toast(res.error, 'error');
        } else {
          Ui.toast('Tarea eliminada', 'info');
          Ui.closeModal();
          render();
          DashboardModule.render();
        }
      });
    });
  };

  /**
   * Modal para agregar nueva tarea (RF-58)
   */
  const showAddModal = async (rolesList, profilesList) => {
    const roles = rolesList || (await Api.getCareRoles()).data || [];
    const profiles = profilesList || ((await Api.getProfiles()).data || []).filter(p => p.active);

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="nt-title">Título de la tarea *</label>
        <input class="form-input" id="nt-title" placeholder="Ej: Curación de herida, paseo..." required>
      </div>
      <div class="form-group">
        <label class="form-label" for="nt-desc">Descripción (opcional)</label>
        <textarea class="form-textarea" id="nt-desc" placeholder="Instrucciones, notas..." style="min-height:60px;"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="nt-shift">Turno</label>
          <select class="form-select" id="nt-shift">
            <option value="morning">🌅 Mañana</option>
            <option value="afternoon">☀️ Tarde</option>
            <option value="night">🌙 Noche</option>
            <option value="any">🔁 Cualquier turno</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="nt-date">Fecha</label>
          <input class="form-input" id="nt-date" type="date" value="${selectedDate}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="nt-profile">Asignar a persona específica</label>
        <select class="form-select" id="nt-profile">
          <option value="">(Sin asignar persona)</option>
          ${profiles.map(p => `<option value="${Api.escapeHtml(p.id)}">${Api.escapeHtml(p.fullName)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="nt-role">O asignar a un Rol de cuidado</label>
        <select class="form-select" id="nt-role">
          <option value="">(Cualquier rol)</option>
          ${roles.map(r => `<option value="${Api.escapeHtml(r.id)}">${Api.escapeHtml(r.icon || '')} ${Api.escapeHtml(r.name)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:16px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="nt-emergency"> 🆘 Urgente
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="nt-recurring"> 🔁 Plantilla recurrente diaria
        </label>
      </div>
    `;

    Ui.showModal('➕ Nueva Tarea', contentHtml, async () => {
      const title = document.getElementById('nt-title')?.value?.trim();
      const desc = document.getElementById('nt-desc')?.value?.trim() || '';
      const shift = document.getElementById('nt-shift')?.value || 'morning';
      const taskDate = document.getElementById('nt-date')?.value || selectedDate;
      const assignedProfileId = document.getElementById('nt-profile')?.value || null;
      const assignedCareRoleId = document.getElementById('nt-role')?.value || null;
      const isEmergency = document.getElementById('nt-emergency')?.checked || false;
      const isRecurring = document.getElementById('nt-recurring')?.checked || false;

      if (!title) {
        Ui.toast('El título es requerido', 'warning');
        return false;
      }

      // Si es recurrente, crear plantilla en task_templates (RF-63)
      if (isRecurring) {
        await Api.addTaskTemplate({
          title,
          description: desc,
          shift,
          assignedCareRoleId,
          assignedProfileId,
          isEmergency,
          recurringDays: [] // todos los días
        });
      }

      const res = await Api.addTask({
        title,
        description: desc,
        shift,
        taskDate,
        assignedCareRoleId,
        assignedProfileId,
        isEmergency
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Tarea agregada con éxito', 'success');
      selectedDate = taskDate;
      render();
      DashboardModule.render();
      return true;
    });
  };

  /**
   * Modal para editar una tarea existente
   */
  const showEditModal = (task) => {
    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="et-title">Título *</label>
        <input class="form-input" id="et-title" value="${Api.escapeHtml(task.title)}" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="et-desc">Descripción</label>
        <textarea class="form-textarea" id="et-desc" style="min-height:60px;">${Api.escapeHtml(task.description || '')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="et-shift">Turno</label>
          <select class="form-select" id="et-shift">
            <option value="morning" ${task.shift === 'morning' ? 'selected' : ''}>🌅 Mañana</option>
            <option value="afternoon" ${task.shift === 'afternoon' ? 'selected' : ''}>☀️ Tarde</option>
            <option value="night" ${task.shift === 'night' ? 'selected' : ''}>🌙 Noche</option>
            <option value="any" ${task.shift === 'any' ? 'selected' : ''}>🔁 Cualquier</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="et-status">Estado</label>
          <select class="form-select" id="et-status">
            <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>Pendiente</option>
            <option value="in-progress" ${task.status === 'in-progress' ? 'selected' : ''}>En progreso</option>
            <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Completada</option>
          </select>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:16px;">
        <input type="checkbox" id="et-emergency" ${task.isEmergency ? 'checked' : ''}> 🆘 Urgente
      </label>
    `;

    Ui.showModal('✏️ Editar Tarea', contentHtml, async () => {
      const title = document.getElementById('et-title')?.value?.trim();
      const desc = document.getElementById('et-desc')?.value?.trim() || '';
      const shift = document.getElementById('et-shift')?.value || 'morning';
      const status = document.getElementById('et-status')?.value || 'pending';
      const isEmergency = document.getElementById('et-emergency')?.checked || false;

      if (!title) {
        Ui.toast('El título es requerido', 'warning');
        return false;
      }

      const res = await Api.updateTask(task.id, {
        title,
        description: desc,
        shift,
        status,
        isEmergency
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Tarea actualizada', 'success');
      render();
      DashboardModule.render();
      return true;
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
