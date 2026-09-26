/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo de Roles y Personal (js/roles.js)
   ═══════════════════════════════════════════════════════════════ */

const RolesModule = (() => {
  'use strict';

  let currentTab = 'roles'; // 'roles' | 'history' | 'users'

  /**
   * Renderiza el panel principal según la pestaña activa
   */
  const render = async () => {
    const el = document.getElementById('panel-roles');
    if (!el) return;

    Ui.skeleton(el);

    try {
      const isAdmin = Auth.isAdmin();
      if (currentTab === 'users' && !isAdmin) {
        currentTab = 'roles';
      }

      if (currentTab === 'roles') {
        await renderRolesTab(el);
      } else if (currentTab === 'history') {
        await renderHistoryTab(el);
      } else if (currentTab === 'users') {
        await renderUsersTab(el);
      }
    } catch (err) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar el equipo: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="roles-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('roles-retry-btn')?.addEventListener('click', render);
    }
  };

  /**
   * Pestaña 1: Personal y Turno Activo
   */
  const renderRolesTab = async (el) => {
    const [rolesRes, profilesRes, shiftRes, notesRes] = await Promise.all([
      Api.getCareRoles(),
      Api.getProfiles(),
      Api.getCurrentShift(),
      Api.getShiftNotes({ limit: 5 })
    ]);

    const roles = rolesRes.data || [];
    const profiles = (profilesRes.data || []).filter(p => p.active);
    const shift = shiftRes.data;
    const notes = notesRes.data || [];
    const isAdmin = Auth.isAdmin();
    const myProfile = Auth.getProfile();

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">👥 Roles y Personal</div>
        ${isAdmin ? '<button class="btn btn-primary btn-sm" id="btn-add-role">+ Rol</button>' : ''}
      </div>

      <div class="tabs" id="roles-nav-tabs">
        <button class="tab-btn active" data-tab="roles">Personal</button>
        <button class="tab-btn" data-tab="history">Historial</button>
        ${isAdmin ? '<button class="tab-btn" data-tab="users">Usuarios</button>' : ''}
      </div>

      <!-- Turno actual -->
      <div class="card-title">🔄 TURNO ACTIVO</div>
      ${shift ? `
        <div class="shift-card" style="margin-bottom:16px;">
          <div class="shift-person">
            <div class="shift-avatar">${shift.careRole?.icon || '👤'}</div>
            <div class="shift-info">
              <div class="shift-name">${Api.escapeHtml(shift.profile?.fullName || 'Desconocido')}</div>
              <div class="shift-role">${Api.escapeHtml(shift.careRole?.name || 'Cuidador')}</div>
              <div class="shift-time">Activo desde ${Api.timeAgo(shift.startedAt)} · ${Api.shiftDuration(shift.startedAt)}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" style="flex:1;" id="btn-take-shift">🔄 Cambiar turno</button>
            <button class="btn btn-secondary btn-sm" style="flex:1;" id="btn-add-shift-note">📝 Nota de entrega</button>
            <button class="btn btn-danger btn-sm" style="flex:1;" id="btn-end-shift">⏹ Fin de turno</button>
          </div>
        </div>
      ` : `
        <div class="card" style="text-align:center;padding:20px;margin-bottom:16px;">
          <div style="font-size:2rem;margin-bottom:8px;opacity:.5">👤</div>
          <div class="text-muted text-sm" style="margin-bottom:12px;">Nadie está a cargo del turno en este momento</div>
          <button class="btn btn-primary" id="btn-take-shift">Tomar turno ahora</button>
        </div>
      `}

      <!-- Notas de relevo recientes -->
      ${notes.length > 0 ? `
        <div class="card-title">📝 NOTAS DE RELEVO RECIENTES</div>
        <div class="card" style="margin-bottom:16px;padding:12px;">
          ${notes.map(n => `
            <div style="border-bottom:1px solid var(--border-subtle);padding:8px 0;">
              <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-muted);margin-bottom:4px;">
                <span class="font-bold">${Api.escapeHtml(n.author?.fullName || 'Usuario')}</span>
                <span>${Api.timeAgo(n.createdAt)}</span>
              </div>
              <div style="font-size:0.875rem;">${Api.escapeHtml(n.note)}</div>
            </div>
          `).join('')}
          <div style="text-align:right;margin-top:8px;">
            <button class="btn btn-ghost btn-sm" id="btn-quick-add-note">+ Nueva nota</button>
          </div>
        </div>
      ` : ''}

      <!-- Lista de roles y personas -->
      <div class="card-title">👥 EQUIPO DE CUIDADO</div>
      <div id="roles-list">
        ${roles.map(role => {
          const roleProfiles = profiles.filter(p => p.careRoleId === role.id);
          const totalPeople = roleProfiles.length;
          return `
            <div class="role-section open" id="role-${Api.escapeHtml(role.id)}">
              <div class="role-hdr" data-role-id="${Api.escapeHtml(role.id)}">
                <div class="role-hdr-icon">${Api.escapeHtml(role.icon || '👤')}</div>
                <div class="role-hdr-info">
                  <div class="role-hdr-name">${Api.escapeHtml(role.name)}</div>
                  <div class="role-hdr-count">${totalPeople} integrante${totalPeople !== 1 ? 's' : ''}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  ${isAdmin && !role.isDefault ? `
                    <button class="btn btn-ghost btn-sm text-critical btn-del-role" data-id="${Api.escapeHtml(role.id)}" data-name="${Api.escapeHtml(role.name)}" title="Eliminar rol">🗑</button>
                  ` : ''}
                </div>
                <span class="role-chevron">▼</span>
              </div>
              <div class="role-people">
                ${totalPeople === 0 ? `
                  <div class="text-muted text-sm" style="padding:8px 0;">Sin personas asignadas a este rol</div>
                ` : roleProfiles.map(p => {
                  const isOnShift = shift && shift.profileId === p.id;
                  const isMe = myProfile && myProfile.id === p.id;
                  return `
                    <div class="person-item" data-id="${Api.escapeHtml(p.id)}">
                      <div class="person-avatar" style="background:${role.color || '#6e8efb'}22;color:${role.color || '#6e8efb'};border-color:${role.color || '#6e8efb'}55;">
                        ${Api.escapeHtml((p.fullName || '?').charAt(0).toUpperCase())}
                      </div>
                      <div class="person-info">
                        <div class="person-name">
                          ${Api.escapeHtml(p.fullName)}
                          ${isMe ? ' <span class="badge" style="font-size:0.65rem;background:var(--primary-subtle);color:var(--primary);">Tú</span>' : ''}
                          ${isOnShift ? ' <span class="badge badge-active">En turno</span>' : ''}
                        </div>
                        ${p.phone ? `<div class="person-phone"><a href="tel:${Api.escapeHtml(p.phone)}" class="text-sec" style="text-decoration:none;">📞 ${Api.escapeHtml(p.phone)}</a></div>` : ''}
                      </div>
                      <div style="display:flex;align-items:center;gap:6px;">
                        ${p.phone ? `
                          <a href="tel:${Api.escapeHtml(p.phone)}" class="btn btn-ghost btn-sm" aria-label="Llamar a ${Api.escapeHtml(p.fullName)}" title="Llamar">📞</a>
                        ` : ''}
                        ${isMe && !isOnShift ? `
                          <button class="take-shift-btn btn-take-my-shift" data-role-id="${Api.escapeHtml(role.id)}">Tomar turno</button>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    bindRolesTabEvents(el, roles);
  };

  /**
   * Pestaña 2: Historial de Turnos
   */
  const renderHistoryTab = async (el) => {
    const historyRes = await Api.getShiftHistory({ limit: 30 });
    const history = historyRes.data || [];
    const isAdmin = Auth.isAdmin();

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">👥 Roles y Personal</div>
      </div>
      <div class="tabs" id="roles-nav-tabs">
        <button class="tab-btn" data-tab="roles">Personal</button>
        <button class="tab-btn active" data-tab="history">Historial</button>
        ${isAdmin ? '<button class="tab-btn" data-tab="users">Usuarios</button>' : ''}
      </div>
      <div class="card-title">📋 HISTORIAL DE TURNOS</div>
      ${history.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">🕐</div>
          <div class="empty-text">Sin historial de turnos registrado</div>
        </div>
      ` : history.map(s => `
        <div class="card" style="margin-bottom:8px;">
          <div class="flex items-center gap-sm">
            <div class="shift-avatar" style="width:36px;height:36px;">${Api.escapeHtml(s.careRole?.icon || '👤')}</div>
            <div style="flex:1">
              <div class="font-bold">${Api.escapeHtml(s.profile?.fullName || 'Usuario')}</div>
              <div class="text-xs text-muted">${Api.escapeHtml(s.careRole?.name || 'Turno')}</div>
            </div>
            <div style="text-align:right;">
              <div class="text-sm">${Api.formatDate(s.startedAt)}</div>
              <div class="text-xs text-muted">${Api.shiftDuration(s.startedAt, s.endedAt)}</div>
            </div>
          </div>
        </div>
      `).join('')}
    `;

    bindTabSwitchEvents(el);
  };

  /**
   * Pestaña 3: Gestión de Usuarios (Solo Admin RF-07..RF-11)
   */
  const renderUsersTab = async (el) => {
    const [profilesRes, rolesRes] = await Promise.all([
      Api.getProfiles(),
      Api.getCareRoles()
    ]);

    const profiles = profilesRes.data || [];
    const roles = rolesRes.data || [];
    const myProfile = Auth.getProfile();

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">👥 Gestión de Usuarios</div>
      </div>
      <div class="tabs" id="roles-nav-tabs">
        <button class="tab-btn" data-tab="roles">Personal</button>
        <button class="tab-btn" data-tab="history">Historial</button>
        <button class="tab-btn active" data-tab="users">Usuarios</button>
      </div>

      <div class="card-title">🛡️ CUENTAS REGISTRADAS</div>
      <div class="card" style="padding:0;overflow:hidden;">
        ${profiles.map(p => {
          const isSelf = myProfile && myProfile.id === p.id;
          const assignedRole = roles.find(r => r.id === p.careRoleId);

          return `
            <div class="exp-item" style="flex-direction:column;align-items:flex-start;gap:8px;padding:12px;border-bottom:1px solid var(--border-subtle);" data-user-id="${Api.escapeHtml(p.id)}">
              <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                <div>
                  <span class="font-bold">${Api.escapeHtml(p.fullName)}</span>
                  ${isSelf ? ' <span class="badge" style="font-size:0.65rem;background:var(--primary-subtle);color:var(--primary);">Tú</span>' : ''}
                  <div class="text-xs text-muted">${p.phone ? '📞 ' + Api.escapeHtml(p.phone) : 'Sin teléfono'}</div>
                </div>
                <div>
                  <span class="badge ${p.active ? 'badge-active' : 'badge-inactive'}">
                    ${p.active ? 'Activo' : 'Pendiente'}
                  </span>
                  <span class="badge" style="margin-left:4px;background:var(--border-subtle);">
                    ${p.appRole === 'admin' ? '🛡️ Admin' : 'Cuidador'}
                  </span>
                </div>
              </div>

              <!-- Controles de Admin (RF-07..RF-11) -->
              <div style="display:flex;gap:6px;width:100%;flex-wrap:wrap;align-items:center;margin-top:4px;">
                <!-- Asignar rol de cuidado -->
                <select class="form-select user-care-role-sel" data-id="${Api.escapeHtml(p.id)}" style="flex:1;min-width:140px;font-size:0.8rem;padding:4px 8px;">
                  <option value="">(Sin rol de cuidado)</option>
                  ${roles.map(r => `
                    <option value="${Api.escapeHtml(r.id)}" ${p.careRoleId === r.id ? 'selected' : ''}>${Api.escapeHtml(r.icon || '')} ${Api.escapeHtml(r.name)}</option>
                  `).join('')}
                </select>

                ${!isSelf ? `
                  <!-- Cambiar Rol Admin/Caregiver -->
                  <button class="btn btn-secondary btn-sm btn-toggle-admin" data-id="${Api.escapeHtml(p.id)}" data-role="${Api.escapeHtml(p.appRole)}">
                    ${p.appRole === 'admin' ? 'Hacer Cuidador' : 'Hacer Admin'}
                  </button>

                  <!-- Activar / Desactivar -->
                  <button class="btn ${p.active ? 'btn-danger' : 'btn-primary'} btn-sm btn-toggle-active" data-id="${Api.escapeHtml(p.id)}" data-active="${p.active}">
                    ${p.active ? 'Desactivar' : 'Aprobar'}
                  </button>
                ` : `
                  <span class="text-xs text-muted" style="font-style:italic;">No puedes modificar tu propia cuenta aquí.</span>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    bindUsersTabEvents(el);
  };

  /**
   * Eventos de la pestaña Personal
   */
  const bindRolesTabEvents = (el, roles) => {
    bindTabSwitchEvents(el);

    // Accordions
    el.querySelectorAll('.role-hdr').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        if (e.target.closest('.btn-del-role')) return;
        const roleId = hdr.getAttribute('data-role-id');
        const sec = document.getElementById(`role-${roleId}`);
        sec?.classList.toggle('open');
      });
    });

    // Botones de turno
    el.querySelector('#btn-take-shift')?.addEventListener('click', showTakeShiftModal);
    el.querySelector('#btn-end-shift')?.addEventListener('click', endShift);
    el.querySelector('#btn-add-shift-note')?.addEventListener('click', showAddShiftNoteModal);
    el.querySelector('#btn-quick-add-note')?.addEventListener('click', showAddShiftNoteModal);

    // Tomar turno directo en mi rol
    el.querySelectorAll('.btn-take-my-shift').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const roleId = btn.getAttribute('data-role-id');
        if (roleId) await takeShift(roleId);
      });
    });

    // Nuevo rol (Admin)
    el.querySelector('#btn-add-role')?.addEventListener('click', showAddRoleModal);

    // Eliminar rol (Admin)
    el.querySelectorAll('.btn-del-role').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        if (id) deleteRole(id, name);
      });
    });
  };

  /**
   * Eventos de pestañas
   */
  const bindTabSwitchEvents = (el) => {
    el.querySelectorAll('#roles-nav-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab && tab !== currentTab) {
          currentTab = tab;
          render();
        }
      });
    });
  };

  /**
   * Eventos de la pestaña Usuarios
   */
  const bindUsersTabEvents = (el) => {
    bindTabSwitchEvents(el);

    // Asignar rol de cuidado
    el.querySelectorAll('.user-care-role-sel').forEach(sel => {
      sel.addEventListener('change', async () => {
        const userId = sel.getAttribute('data-id');
        const careRoleId = sel.value || null;
        const res = await Api.updateProfile(userId, { careRoleId });
        if (res.error) {
          Ui.toast(res.error, 'error');
        } else {
          Ui.toast('Rol de cuidado actualizado', 'success');
        }
      });
    });

    // Cambiar app_role (admin/caregiver)
    el.querySelectorAll('.btn-toggle-admin').forEach(btn => {
      btn.addEventListener('click', () => {
        const userId = btn.getAttribute('data-id');
        const currentRole = btn.getAttribute('data-role');
        const newRole = currentRole === 'admin' ? 'caregiver' : 'admin';
        const label = newRole === 'admin' ? 'administrador' : 'cuidador';

        Ui.confirm(`¿Cambiar rol a ${label}?`, 'Los administradores tienen acceso completo a la configuración y auditoría.', async () => {
          const res = await Api.updateProfile(userId, { appRole: newRole });
          if (res.error) {
            Ui.toast(res.error, 'error');
          } else {
            Ui.toast(`Rol cambiado a ${label}`, 'success');
            render();
          }
        });
      });
    });

    // Activar / Desactivar cuenta
    el.querySelectorAll('.btn-toggle-active').forEach(btn => {
      btn.addEventListener('click', () => {
        const userId = btn.getAttribute('data-id');
        const isActive = btn.getAttribute('data-active') === 'true';
        const newActive = !isActive;
        const actionText = newActive ? 'Aprobar y activar cuenta' : 'Desactivar cuenta';

        Ui.confirm(`¿${actionText}?`, newActive ? 'El usuario podrá acceder inmediatamente a la app.' : 'El usuario perderá el acceso a la app hasta ser reactivado.', async () => {
          const res = await Api.updateProfile(userId, { active: newActive });
          if (res.error) {
            Ui.toast(res.error, 'error');
          } else {
            Ui.toast(`Cuenta ${newActive ? 'activada' : 'desactivada'}`, 'success');
            render();
          }
        });
      });
    });
  };

  /**
   * Modal para tomar turno
   */
  const showTakeShiftModal = async () => {
    const rolesRes = await Api.getCareRoles();
    const roles = rolesRes.data || [];

    if (roles.length === 0) {
      Ui.toast('No hay roles configurados', 'warning');
      return;
    }

    const myProfile = Auth.getProfile();
    const defaultRoleId = myProfile?.careRoleId || roles[0]?.id;

    const contentHtml = `
      <p class="text-sm text-sec" style="margin-bottom:16px;">
        Selecciona el rol con el que vas a desempeñar tu turno actual:
      </p>
      <div class="form-group">
        <label class="form-label" for="shift-role-sel">Rol para este turno *</label>
        <select class="form-select" id="shift-role-sel">
          ${roles.map(r => `
            <option value="${Api.escapeHtml(r.id)}" ${r.id === defaultRoleId ? 'selected' : ''}>
              ${Api.escapeHtml(r.icon || '👤')} ${Api.escapeHtml(r.name)}
            </option>
          `).join('')}
        </select>
      </div>
    `;

    Ui.showModal('🔄 Tomar Turno', contentHtml, async () => {
      const sel = document.getElementById('shift-role-sel');
      const roleId = sel?.value;
      if (!roleId) return false;

      const res = await Api.takeShift(roleId);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Turno iniciado con éxito', 'success');
      render();
      DashboardModule?.render();
      setTimeout(() => {
        Ui.confirm(
          '🔄 Relevo de Habitación',
          '¿Deseas realizar el Relevo de Habitación ahora para verificar los insumos críticos en el punto de uso?',
          () => {
            App.navigateTo('inventory');
            if (typeof InventoryModule !== 'undefined' && InventoryModule.switchTab) {
              InventoryModule.switchTab('relay');
            }
          }
        );
      }, 350);
      return true;
    });
  };

  /**
   * Tomar turno directo
   */
  const takeShift = async (careRoleId) => {
    const res = await Api.takeShift(careRoleId);
    if (res.error) {
      Ui.toast(res.error, 'error');
    } else {
      Ui.toast('Turno iniciado con éxito', 'success');
      render();
      DashboardModule?.render();
      setTimeout(() => {
        Ui.confirm(
          '🔄 Relevo de Habitación',
          '¿Deseas realizar el Relevo de Habitación ahora para verificar los insumos críticos en el punto de uso?',
          () => {
            App.navigateTo('inventory');
            if (typeof InventoryModule !== 'undefined' && InventoryModule.switchTab) {
              InventoryModule.switchTab('relay');
            }
          }
        );
      }, 350);
    }
  };

  /**
   * Finalizar turno actual
   */
  const endShift = () => {
    Ui.confirm('¿Finalizar turno?', 'Se registrará el fin de tu turno. El sistema quedará sin nadie a cargo hasta que alguien tome el relevo.', async () => {
      const res = await Api.endShift();
      if (res.error) {
        Ui.toast(res.error, 'error');
      } else {
        Ui.toast('Turno finalizado', 'info');
        render();
        DashboardModule?.render();
      }
    });
  };

  /**
   * Modal para agregar nota de entrega / relevo
   */
  const showAddShiftNoteModal = () => {
    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="shift-note-txt">Nota de relevo *</label>
        <textarea class="form-input" id="shift-note-txt" rows="4" placeholder="Ej: Queda cena preparada, paciente tranquilo, medicamento de las 20:00 listo..." required></textarea>
      </div>
    `;

    Ui.showModal('📝 Nota de Relevo', contentHtml, async () => {
      const note = document.getElementById('shift-note-txt')?.value?.trim();
      if (!note) {
        Ui.toast('Escribe el texto de la nota', 'warning');
        return false;
      }

      const res = await Api.addShiftNote(note);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Nota registrada', 'success');
      render();
      DashboardModule?.render();
      return true;
    });
  };

  /**
   * Crear nuevo rol de cuidado (solo admin)
   */
  const showAddRoleModal = () => {
    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="nr-name">Nombre del rol *</label>
        <input class="form-input" id="nr-name" placeholder="Ej: Terapeuta Ocupacional" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="nr-icon">Emoji / Ícono</label>
          <input class="form-input" id="nr-icon" placeholder="🧑‍⚕️" maxlength="4" value="👤">
        </div>
        <div class="form-group">
          <label class="form-label" for="nr-color">Color</label>
          <input class="form-input" id="nr-color" type="color" value="#3fb4a0" style="padding:2px 4px;height:42px;">
        </div>
      </div>
    `;

    Ui.showModal('➕ Nuevo Rol de Cuidado', contentHtml, async () => {
      const name = document.getElementById('nr-name')?.value?.trim();
      const icon = document.getElementById('nr-icon')?.value?.trim() || '👤';
      const color = document.getElementById('nr-color')?.value || '#3fb4a0';

      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      const res = await Api.addCareRole({ name, icon, color });
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(`Rol "${name}" creado`, 'success');
      render();
      return true;
    });
  };

  /**
   * Eliminar rol de cuidado (solo admin)
   */
  const deleteRole = (roleId, name) => {
    Ui.confirm(`¿Eliminar el rol "${name}"?`, 'Las personas asignadas a este rol quedarán sin rol de cuidado.', async () => {
      const res = await Api.deleteCareRole(roleId);
      if (res.error) {
        Ui.toast(res.error, 'error');
      } else {
        Ui.toast('Rol eliminado', 'info');
        render();
      }
    });
  };

  return {
    render,
    takeShift,
    endShift,
    showTakeShiftModal,
    showAddShiftNoteModal
  };
})();
