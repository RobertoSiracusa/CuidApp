/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Coordinador Principal (Router + Arranque + UI Global)
   js/app.js
   ═══════════════════════════════════════════════════════════════ */

const App = (() => {
  'use strict';

  let currentPanel = 'dashboard';

  // Módulos visibles solo para administradores
  const ADMIN_PANELS = ['stock', 'audit'];

  // ─── Enrutador y Navegación ────────────────────────────────
  const navigateTo = async (panelId, subTab) => {
    if (ADMIN_PANELS.includes(panelId) && !Auth.isAdmin()) {
      Ui.toast('Acceso exclusivo para administradores', 'warning');
      panelId = 'dashboard';
    }

    // Ocultar todos los paneles
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

    // Mostrar panel destino
    const target = document.getElementById(`panel-${panelId}`);
    if (target) target.classList.add('active');

    // Ítem activo del sidebar
    document.querySelectorAll('.side-item[data-panel]').forEach(b => {
      b.classList.toggle('active', b.dataset.panel === panelId);
    });

    closeSidebar();
    document.getElementById('main-content')?.scrollTo(0, 0);
    window.scrollTo(0, 0);

    currentPanel = panelId;

    if (panelId === 'food' && subTab) {
      const fm = window.FoodModule || (typeof FoodModule !== 'undefined' ? FoodModule : null);
      if (fm?.setTab) fm.setTab(subTab);
    }
    if (panelId === 'stock' && subTab) {
      const sm = window.StockModule || (typeof StockModule !== 'undefined' ? StockModule : null);
      if (sm?.setFilter) sm.setFilter(subTab);
    }

    // Despacho al módulo correspondiente
    const modules = {
      dashboard: () => (window.DashboardModule || (typeof DashboardModule !== 'undefined' ? DashboardModule : null))?.render(),
      food:      () => (window.FoodModule || (typeof FoodModule !== 'undefined' ? FoodModule : null))?.render(),
      stock:     () => (window.StockModule || (typeof StockModule !== 'undefined' ? StockModule : null))?.render(),
      roles:     () => (window.RolesModule || (typeof RolesModule !== 'undefined' ? RolesModule : null))?.render(),
      settings:  () => (window.SettingsModule || (typeof SettingsModule !== 'undefined' ? SettingsModule : null))?.render(),
      audit:     () => (window.AuditModule || (typeof AuditModule !== 'undefined' ? AuditModule : null))?.render()
    };

    if (modules[panelId]) {
      await modules[panelId]();
    }
  };

  // ─── Sidebar (cajón en iPhone, fijo desde 900px) ──────────
  const openSidebar = () => {
    document.getElementById('sidebar')?.classList.add('open');
    document.getElementById('sidebar-overlay')?.classList.add('open');
    document.getElementById('menu-btn')?.setAttribute('aria-expanded', 'true');
  };

  const closeSidebar = () => {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('open');
    document.getElementById('menu-btn')?.setAttribute('aria-expanded', 'false');
  };

  // Oculta los accesos de administrador y muestra quién tiene la sesión
  const applyRoleVisibility = () => {
    const isAdmin = Auth.isAdmin();
    document.querySelectorAll('#sidebar [data-admin-only]').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });
    const nameEl = document.getElementById('side-user-name');
    const profile = Auth.getProfile();
    if (nameEl) {
      const name = profile?.fullName || profile?.full_name || '';
      nameEl.textContent = name ? `${name}${isAdmin ? ' · Admin' : ''}` : '';
    }
  };

  const exportData = () => SettingsModule.exportData();

  // ─── Botón Flotante y Modal de Emergencia (RF-89 .. RF-91) ──
  const showEmergency = async () => {
    const res = await Api.getSettings();
    const settings = res.data || {};
    const emgName = settings.emergencyContactName || 'Contacto de emergencia';
    const emgPhone = settings.emergencyContactPhone || '';
    const emgWA = (settings.emergencyContactWhatsapp || emgPhone).replace(/\D/g, '');

    const nameEl = document.getElementById('emg-contact-name');
    const callBtn = document.getElementById('emg-call-btn');
    const waBtn = document.getElementById('emg-wa-btn');

    if (nameEl) nameEl.textContent = emgName;

    if (callBtn) {
      if (emgPhone) {
        callBtn.href = `tel:${emgPhone}`;
        callBtn.style.display = '';
      } else {
        callBtn.removeAttribute('href');
        callBtn.style.display = 'none';
      }
    }

    if (waBtn) {
      if (emgWA) {
        const text = encodeURIComponent('🆘 Necesitamos asistencia médica urgente para el paciente. Enviado desde CuidApp');
        waBtn.href = `https://wa.me/${emgWA}?text=${text}`;
        waBtn.style.display = '';
      } else {
        waBtn.removeAttribute('href');
        waBtn.style.display = 'none';
      }
    }

    document.getElementById('emergency-modal')?.classList.add('open');
  };

  const closeEmergency = () => {
    document.getElementById('emergency-modal')?.classList.remove('open');
  };

  // ─── Actualización del Encabezado Global ───────────────────
  const updateHeader = async () => {
    try {
      const [settingsRes, statusRes] = await Promise.all([
        Api.getSettings(),
        Api.getPatientStatus()
      ]);

      const settings = (settingsRes && settingsRes.data !== undefined) ? settingsRes.data : (settingsRes || { patientName: 'Paciente' });
      const status = (statusRes && statusRes.data !== undefined) ? statusRes.data : (statusRes || { status: 'stable' });

      const nameEl = document.getElementById('patient-name-hdr');
      const badgeEl = document.getElementById('hdr-status-badge');

      if (nameEl) nameEl.textContent = settings.patientName;

      if (badgeEl) {
        const labels = { stable: '🟢 Estable', alert: '🟡 Alerta', critical: '🔴 Crítico' };
        badgeEl.className = `status-badge ${status.status}`;
        badgeEl.innerHTML = `<span class="status-dot ${status.status === 'stable' ? 'pulse' : ''}"></span>${labels[status.status] || 'Estable'}`;
      }

      await Ui.renderAlerts();
    } catch {
      // Ignorar errores silenciosos de header periódico
    }
  };

  // ─── Pantallas de Acceso y Sesión (RF-01 .. RF-06) ────────
  const clearAuthAlerts = () => {
    const errBox = document.getElementById('auth-error-box');
    const succBox = document.getElementById('auth-success-box');
    if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
    if (succBox) { succBox.style.display = 'none'; succBox.textContent = ''; }
  };

  const showAuthError = (msg) => {
    const errBox = document.getElementById('auth-error-box');
    const succBox = document.getElementById('auth-success-box');
    if (succBox) succBox.style.display = 'none';
    if (errBox) {
      errBox.textContent = msg;
      errBox.style.display = 'block';
    }
  };

  const showAuthSuccess = (msg) => {
    const errBox = document.getElementById('auth-error-box');
    const succBox = document.getElementById('auth-success-box');
    if (errBox) errBox.style.display = 'none';
    if (succBox) {
      succBox.textContent = msg;
      succBox.style.display = 'block';
    }
  };

  const showAuthScreen = () => {
    document.getElementById('auth-screen')?.classList.remove('hidden');
    document.getElementById('pending-screen')?.classList.add('hidden');
    document.getElementById('app')?.classList.add('hidden');
    clearAuthAlerts();
  };

  const showPendingScreen = (email) => {
    document.getElementById('auth-screen')?.classList.add('hidden');
    document.getElementById('pending-screen')?.classList.remove('hidden');
    document.getElementById('app')?.classList.add('hidden');

    const emailEl = document.getElementById('pending-user-email');
    if (emailEl && email) emailEl.textContent = email;
  };

  const showAppScreen = async () => {
    document.getElementById('auth-screen')?.classList.add('hidden');
    document.getElementById('pending-screen')?.classList.add('hidden');
    document.getElementById('app')?.classList.remove('hidden');
    applyRoleVisibility();

    // Bootstrap de la aplicación con la base de datos
    try {
      await Api.bootstrap();
    } catch (e) {
      console.warn('Aviso en Api.bootstrap:', e);
    }
    try {
      await updateHeader();
    } catch (e) {
      console.warn('Aviso en updateHeader:', e);
    }
    try {
      await navigateTo('dashboard');
    } catch (e) {
      console.warn('Aviso en navigateTo dashboard:', e);
      document.getElementById('panel-dashboard')?.classList.add('active');
    }
  };

  const setupAuthUI = () => {
    const formLogin = document.getElementById('auth-form-login');
    const formReg   = document.getElementById('auth-form-register');
    const formReset = document.getElementById('auth-form-reset');

    // Pestañas Login / Registro / Reset
    document.querySelectorAll('.auth-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        clearAuthAlerts();
        const tab = btn.dataset.tab;
        document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (tab === 'login') {
          formLogin?.classList.remove('hidden');
          formReg?.classList.add('hidden');
          formReset?.classList.add('hidden');
        } else if (tab === 'register') {
          formLogin?.classList.add('hidden');
          formReg?.classList.remove('hidden');
          formReset?.classList.add('hidden');
        }
      });
    });

    document.getElementById('btn-forgot-password')?.addEventListener('click', (e) => {
      e.preventDefault();
      clearAuthAlerts();
      formLogin?.classList.add('hidden');
      formReg?.classList.add('hidden');
      formReset?.classList.remove('hidden');
    });

    document.getElementById('btn-back-to-login')?.addEventListener('click', (e) => {
      e.preventDefault();
      clearAuthAlerts();
      formReset?.classList.add('hidden');
      formLogin?.classList.remove('hidden');
      document.querySelector('.auth-tab-btn[data-tab="login"]')?.classList.add('active');
    });

    // Submit Login
    formLogin?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlerts();
      const email = document.getElementById('login-email')?.value?.trim();
      const pass  = document.getElementById('login-password')?.value;
      const btn   = document.getElementById('login-submit-btn');

      if (btn) { btn.disabled = true; btn.textContent = 'Iniciando sesión...'; }

      const res = await Auth.signIn(email, pass);
      if (btn) { btn.disabled = false; btn.textContent = 'Iniciar Sesión'; }

      if (!res.ok) {
        showAuthError(res.error);
        return;
      }

      const profile = Auth.getProfile();
      if (!profile?.active) {
        showPendingScreen(email);
      } else {
        await showAppScreen();
      }
    });

    // Submit Registro
    formReg?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlerts();
      const name  = document.getElementById('reg-name')?.value?.trim();
      const email = document.getElementById('reg-email')?.value?.trim();
      const pass  = document.getElementById('reg-password')?.value;
      const btn   = document.getElementById('reg-submit-btn');

      if (btn) { btn.disabled = true; btn.textContent = 'Creando cuenta...'; }

      const res = await Auth.signUp(email, pass, name);
      if (btn) { btn.disabled = false; btn.textContent = 'Crear Cuenta'; }

      if (!res.ok) {
        showAuthError(res.error);
        return;
      }

      showPendingScreen(email);
    });

    // Submit Recuperación
    formReset?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlerts();
      const email = document.getElementById('reset-email')?.value?.trim();
      const btn   = document.getElementById('reset-submit-btn');

      if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

      const res = await Auth.resetPassword(email);
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar enlace'; }

      if (!res.ok) {
        showAuthError(res.error);
      } else {
        showAuthSuccess('Se ha enviado un enlace de recuperación a tu correo electrónico.');
      }
    });

    // Botones de pantalla pendiente
    document.getElementById('pending-check-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('pending-check-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Comprobando...'; }
      const profile = await Auth.refreshProfile();
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Comprobar aprobación'; }

      if (profile?.active) {
        await showAppScreen();
      } else {
        alert('Tu cuenta aún no ha sido aprobada por un administrador.');
      }
    });

    document.getElementById('pending-logout-btn')?.addEventListener('click', () => {
      Auth.signOut();
    });
  };

  // ─── Arranque de la Aplicación ────────────────────────────
  const init = async () => {
    // Cablear los listeners de Ui: botones de los modales y del dialogo de
    // confirmacion. Sin esta llamada los 18 Ui.confirm de la app abren un
    // dialogo cuyos botones Confirmar y Cancelar no tienen handler.
    Ui.init();

    // Sidebar: módulos, copia de seguridad, apertura y cierre
    document.querySelectorAll('.side-item[data-panel]').forEach(item => {
      item.addEventListener('click', () => navigateTo(item.dataset.panel));
    });
    document.getElementById('side-backup-btn')?.addEventListener('click', () => {
      closeSidebar();
      exportData();
    });
    document.getElementById('menu-btn')?.addEventListener('click', openSidebar);
    document.getElementById('sidebar-close-btn')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSidebar();
    });

    // Botón de emergencia flotante y modal
    document.getElementById('emergency-fab')?.addEventListener('click', showEmergency);
    document.getElementById('emg-dismiss-btn')?.addEventListener('click', closeEmergency);
    document.getElementById('emergency-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'emergency-modal') closeEmergency();
    });

    // Configurar formularios de autenticación
    setupAuthUI();

    // Inicializar sesión (en modo local siempre pasa directo a la app principal)
    try {
      const authState = await Auth.init();
      if (window.CUIDAPP_CONFIG?.LOCAL_MODE || (authState && authState.active)) {
        await showAppScreen();
      } else if (!authState?.session) {
        showAuthScreen();
      } else if (!authState?.active) {
        showPendingScreen(authState.session.user?.email);
      } else {
        await showAppScreen();
      }
    } catch (authErr) {
      console.warn('Aviso en Auth.init, pasando directo a app:', authErr);
      await showAppScreen();
    }

    // Suscripción a cambios de sesión
    Auth.onChange((event, session, profile) => {
      if (window.CUIDAPP_CONFIG?.LOCAL_MODE) {
        showAppScreen();
      } else if (!session) {
        showAuthScreen();
      } else if (!profile?.active) {
        showPendingScreen(session.user?.email);
      } else {
        showAppScreen();
      }
    });

    // Refresco periódico del encabezado
    setInterval(() => {
      if (!document.getElementById('app')?.classList.contains('hidden')) {
        updateHeader();
      }
    }, 60000);
  };

  return {
    init,
    navigateTo,
    showModal: Ui.showModal,
    closeModal: Ui.closeModal,
    confirm: Ui.confirm,
    openSidebar,
    closeSidebar,
    exportData,
    showEmergency,
    closeEmergency,
    updateHeader
  };
})();

// ─── Arranque Seguro: si el DOM ya cargó, arrancar de inmediato ──
const bootApp = async () => {
  try {
    await App.init();
  } catch (err) {
    console.error('Error durante arranque de CuidApp:', err);
    document.getElementById('auth-screen')?.classList.add('hidden');
    document.getElementById('app')?.classList.remove('hidden');
    document.getElementById('panel-dashboard')?.classList.add('active');
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
