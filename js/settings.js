/* ============================================================
   CuidApp v2 — Módulo de Configuración y Perfil (js/settings.js)
   RF-95 .. RF-98 · RNF-19, RNF-53
   ============================================================ */

const SettingsModule = (() => {
  'use strict';

  const render = async () => {
    const el = document.getElementById('panel-settings');
    if (!el) return;

    Ui.skeleton(el, 3);

    try {
      const [settings, userProfile, careRoles] = await Promise.all([
        Api.getSettings(),
        Auth.getProfile(),
        Api.getCareRoles()
      ]);

      const isAdmin = Auth.isAdmin();

      el.innerHTML = `
        <div class="section-title" style="margin-bottom:16px;">⚙️ Configuración y Perfil</div>

        <!-- 👤 MI PERFIL (RF-96: para todos los usuarios) -->
        <div class="card" style="margin-bottom:16px;">
          <div class="card-title">👤 MI PERFIL DE CUIDADOR</div>
          <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
            <div class="form-group">
              <label class="form-label" for="my-profile-name">Mi Nombre Completo</label>
              <input class="form-input" id="my-profile-name" value="${Api.escapeHtml(userProfile?.fullName || '')}" placeholder="Tu nombre">
            </div>
            <div class="form-group">
              <label class="form-label" for="my-profile-phone">Teléfono / WhatsApp</label>
              <input class="form-input" id="my-profile-phone" type="tel" value="${Api.escapeHtml(userProfile?.phone || '')}" placeholder="+503 7000 0000">
            </div>
            <div class="form-group">
              <label class="form-label" for="my-profile-role">Mi Rol de Cuidado</label>
              <select class="form-select" id="my-profile-role">
                <option value="">(Sin rol asignado)</option>
                ${careRoles.map(r => `
                  <option value="${r.id}" ${userProfile?.careRoleId === r.id ? 'selected' : ''}>
                    ${r.icon} ${Api.escapeHtml(r.name)}
                  </option>
                `).join('')}
              </select>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
              <span style="font-size:0.75rem; color:var(--text-muted);">
                Permisos: <strong style="color:var(--text);">${isAdmin ? 'Administrador' : 'Cuidador'}</strong>
              </span>
              <button id="save-my-profile-btn" class="btn btn-primary btn-sm">
                Guardar mi perfil
              </button>
            </div>
          </div>
        </div>

        ${isAdmin ? `
          <!-- 🏥 CONFIGURACIÓN GLOBAL DEL PACIENTE (RF-95: solo admin) -->
          <div class="card" style="margin-bottom:16px;">
            <div class="card-title">🏥 EXPEDIENTE DEL PACIENTE (SOLO ADMIN)</div>
            <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
              <div class="form-group">
                <label class="form-label" for="set-patient-name">Nombre del Paciente</label>
                <input class="form-input" id="set-patient-name" value="${Api.escapeHtml(settings.patientName)}">
              </div>
            </div>

            <div class="card-title" style="margin-top:20px; margin-bottom:8px;">🆘 CONTACTO DE EMERGENCIA</div>
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div class="form-group">
                <label class="form-label" for="set-emg-name">Nombre del Contacto / Médico</label>
                <input class="form-input" id="set-emg-name" value="${Api.escapeHtml(settings.emergencyContactName)}" placeholder="Dr. García">
              </div>
              <div class="form-group">
                <label class="form-label" for="set-emg-phone">Teléfono (Llamada)</label>
                <input class="form-input" id="set-emg-phone" type="tel" value="${Api.escapeHtml(settings.emergencyContactPhone)}" placeholder="+503 2222 0000">
              </div>
              <div class="form-group">
                <label class="form-label" for="set-emg-wa">WhatsApp (con código de país)</label>
                <input class="form-input" id="set-emg-wa" type="tel" value="${Api.escapeHtml(settings.emergencyContactWhatsapp)}" placeholder="50370000000">
              </div>
              <button id="save-patient-settings-btn" class="btn btn-primary btn-sm" style="align-self:flex-end;">
                Guardar cambios globales
              </button>
            </div>
          </div>

          <!-- 💾 COPIA DE SEGURIDAD (RF-98: solo admin) -->
          <div class="card" style="margin-bottom:16px;">
            <div class="card-title">💾 RESPALDO DEL EXPEDIENTE</div>
            <p style="font-size:0.8125rem; color:var(--text-sec); margin-bottom:12px; line-height:1.5;">
              Descarga una copia completa en formato JSON con todos los datos del paciente (turnos, dosis, inventario, tareas y gastos).
            </p>
            <button id="export-json-btn" class="btn btn-secondary btn-full">
              📥 Exportar todo a JSON
            </button>
          </div>

          <!-- 🔧 MANTENIMIENTO LOCAL Y MENÚS -->
          <div class="card" style="margin-bottom:16px; border:1px solid var(--border-subtle);">
            <div class="card-title">🔧 MANTENIMIENTO Y MENÚS LOCALES</div>
            <p style="font-size:0.8125rem; color:var(--text-sec); margin-bottom:12px; line-height:1.5;">
              Repara o sincroniza la base de datos local y el planificador de alimentación de 7 días.
            </p>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <button id="repair-db-btn" class="btn btn-secondary btn-sm" style="width:100%;">
                🔄 Reparar y Sincronizar Menús Locales
              </button>
              <button id="reset-db-btn" class="btn btn-ghost text-critical btn-sm" style="width:100%; border:1px dashed var(--critical-subtle);">
                ⚠️ Restablecer Datos de Demostración
              </button>
            </div>
          </div>
        ` : ''}

        <!-- 🚪 SESIÓN (RF-97) -->
        <div class="card" style="margin-bottom:24px;">
          <div class="card-title">🚪 SESIÓN</div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:0.875rem; font-weight:600;">${Api.escapeHtml(Auth.getUser()?.email || '')}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">Sesión activa en este dispositivo</div>
            </div>
            <button id="logout-btn" class="btn btn-danger btn-sm">
              Cerrar sesión
            </button>
          </div>
        </div>
      `;

      // Eventos
      document.getElementById('save-my-profile-btn')?.addEventListener('click', saveMyProfile);
      document.getElementById('save-patient-settings-btn')?.addEventListener('click', savePatientSettings);
      document.getElementById('export-json-btn')?.addEventListener('click', exportData);
      document.getElementById('repair-db-btn')?.addEventListener('click', () => {
        if (typeof LocalStore !== 'undefined' && LocalStore.sanitizeAndMigrate) {
          LocalStore.sanitizeAndMigrate();
          Ui.toast('Base de datos y menús reparados con éxito', 'success');
          setTimeout(() => window.location.reload(), 600);
        } else {
          Ui.toast('Operación disponible en modo local', 'info');
        }
      });
      document.getElementById('reset-db-btn')?.addEventListener('click', () => {
        Ui.confirm('¿Restablecer datos de prueba?', 'Se recargarán los 7 días de menús completos, recetas e insumos iniciales.', () => {
          if (typeof LocalStore !== 'undefined' && LocalStore.resetToDefaults) {
            LocalStore.resetToDefaults();
            Ui.toast('Datos restablecidos a valores iniciales', 'success');
            setTimeout(() => window.location.reload(), 600);
          }
        });
      });
      document.getElementById('logout-btn')?.addEventListener('click', () => {
        Ui.confirm('¿Cerrar sesión?', 'Tendrás que introducir tu correo y contraseña para volver a entrar.', () => {
          Auth.signOut();
        });
      });

    } catch (e) {
      el.innerHTML = `<div class="card" style="color:var(--critical);">${Api.escapeHtml(Api.traducirError(e))}</div>`;
    }
  };

  const saveMyProfile = async () => {
    const btn = document.getElementById('save-my-profile-btn');
    const fullName   = document.getElementById('my-profile-name')?.value?.trim();
    const phone      = document.getElementById('my-profile-phone')?.value?.trim();
    const careRoleId = document.getElementById('my-profile-role')?.value || null;

    if (!fullName) {
      Ui.toast('El nombre es obligatorio', 'warning');
      return;
    }

    Ui.setLoading(btn, true, 'Guardando...');
    const user = Auth.getUser();
    const res = await Api.updateProfile(user.id, { fullName, phone, careRoleId });
    Ui.setLoading(btn, false);

    if (!res.ok) {
      Ui.toast(res.error, 'error');
    } else {
      Ui.toast('Perfil actualizado correctamente', 'success');
      App.updateHeader();
    }
  };

  const savePatientSettings = async () => {
    const btn = document.getElementById('save-patient-settings-btn');
    const patientName               = document.getElementById('set-patient-name')?.value?.trim();
    const emergencyContactName      = document.getElementById('set-emg-name')?.value?.trim();
    const emergencyContactPhone     = document.getElementById('set-emg-phone')?.value?.trim();
    const emergencyContactWhatsapp  = document.getElementById('set-emg-wa')?.value?.trim();

    if (!patientName) {
      Ui.toast('El nombre del paciente es requerido', 'warning');
      return;
    }

    Ui.setLoading(btn, true, 'Guardando...');
    const res = await Api.saveSettings({
      patientName,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactWhatsapp
    });
    Ui.setLoading(btn, false);

    if (!res.ok) {
      Ui.toast(res.error, 'error');
    } else {
      Ui.toast('Configuración guardada', 'success');
      App.updateHeader();
    }
  };

  const exportData = async () => {
    const btn = document.getElementById('export-json-btn');
    Ui.setLoading(btn, true, 'Generando respaldo...');

    try {
      const json = await Api.exportAllData();
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `CuidApp_backup_${Api.todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      Ui.toast('Copia de seguridad descargada', 'success');
    } catch (e) {
      Ui.toast(Api.traducirError(e), 'error');
    } finally {
      Ui.setLoading(btn, false);
    }
  };

  return {
    render,
    exportData
  };
})();
