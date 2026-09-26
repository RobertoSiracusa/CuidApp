/* ============================================================
   CuidApp v2 — Módulo de Interfaz de Usuario y Alertas (js/ui.js)
   Modales, Confirmaciones, Toasts, Skeletons, Alertas Derivadas y Offline
   RF-84 .. RF-88 · RNF-18, RNF-19, RNF-21
   ============================================================ */

const Ui = (() => {
  'use strict';

  let modalCallback = null;
  let confirmCallback = null;

  // ─── Toasts (Avisos efímeros) ─────────────────────────────
  const toast = (message, type = 'info', duration = 3500) => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;

    const icons = {
      success: '✅',
      error:   '❌',
      warning: '⚠️',
      info:    'ℹ️'
    };

    el.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <span class="toast-msg">${Api.escapeHtml(message)}</span>
    `;

    container.appendChild(el);

    // Animación de entrada
    requestAnimationFrame(() => el.classList.add('show'));

    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, duration);
  };

  // ─── Modal Universal ───────────────────────────────────────
  const showModal = (title, contentHtml, onConfirm, showConfirmBtn = true) => {
    const overlay    = document.getElementById('modal-overlay');
    const body       = document.getElementById('modal-body');
    const titleEl    = document.getElementById('modal-title');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn  = document.getElementById('modal-cancel-btn');

    if (!overlay || !body) return;

    titleEl.textContent = title;
    body.innerHTML = contentHtml;
    modalCallback = onConfirm;

    // Restablecer botones: algunos módulos cambian su texto o los ocultan
    if (confirmBtn) {
      confirmBtn.textContent = 'Guardar';
      confirmBtn.style.display = showConfirmBtn ? 'inline-flex' : 'none';
    }
    if (cancelBtn) cancelBtn.style.display = '';
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Autofocus en el primer campo
    setTimeout(() => {
      const firstInput = body.querySelector('input:not([type="hidden"]), select, textarea');
      if (firstInput) firstInput.focus();
    }, 100);
  };

  const closeModal = () => {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    modalCallback = null;
  };

  const confirmModal = async () => {
    if (modalCallback) {
      // RNF-19: si onConfirm devuelve false o lanza error, el modal NO se cierra
      try {
        const res = await modalCallback();
        if (res !== false) closeModal();
      } catch (err) {
        toast(Api.traducirError(err), 'error');
      }
    } else {
      closeModal();
    }
  };

  // ─── Diálogo de Confirmación ──────────────────────────────
  const confirm = (title, message, onOk) => {
    const dialog  = document.getElementById('confirm-dialog');
    const titleEl = document.getElementById('confirm-title');
    const msgEl   = document.getElementById('confirm-msg');

    if (!dialog) {
      if (window.confirm(`${title}\n\n${message}`)) {
        if (onOk) onOk();
      }
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (msgEl)   msgEl.textContent = message;
    confirmCallback = onOk;

    dialog.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  const closeConfirm = () => {
    const dialog = document.getElementById('confirm-dialog');
    if (dialog) dialog.classList.remove('open');
    document.body.style.overflow = '';
    confirmCallback = null;
  };

  const doConfirm = async () => {
    const cb = confirmCallback;
    closeConfirm();
    if (cb) {
      try {
        await cb();
      } catch (err) {
        toast(Api.traducirError(err), 'error');
      }
    }
  };

  // ─── Estados de Carga (RNF-18, RNF-21) ────────────────────
  const skeleton = (container, count = 3, type = 'card') => {
    if (!container) return;
    const items = [];
    for (let i = 0; i < count; i++) {
      if (type === 'card') {
        items.push('<div class="skeleton skeleton-card"></div>');
      } else {
        items.push('<div class="skeleton skeleton-line"></div>');
      }
    }
    container.innerHTML = items.join('');
  };

  const setLoading = (btn, isLoading, loadingText = 'Guardando...') => {
    if (!btn) return;
    if (isLoading) {
      btn.dataset.origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="status-dot pulse" style="margin-right:6px;"></span>${loadingText}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      }
    }
  };

  // ─── Alertas Derivadas en Vivo (RF-84 .. RF-87) ───────────
  let alertsOpen = false;

  const renderAlerts = async () => {
    const listEl  = document.getElementById('notif-list');
    const countEl = document.getElementById('notif-count');
    if (!listEl) return;

    const alerts = await Api.getActiveAlerts();

    // Actualizar contador en la campana
    if (countEl) {
      if (alerts.length > 0) {
        countEl.textContent = alerts.length > 9 ? '9+' : String(alerts.length);
        countEl.style.display = 'inline-flex';
        countEl.className = alerts.some(a => a.type === 'critical') ? 'badge-critical' : 'badge-alert';
      } else {
        countEl.textContent = '';
        countEl.style.display = 'none';
      }
    }

    // Contador de revisiones pendientes junto a "Insumos" en el sidebar
    const stockBadge = document.querySelector('.side-badge[data-for="stock"]');
    if (stockBadge) {
      const due = alerts.filter(a => a.id.startsWith('stock_check_')).length;
      stockBadge.textContent = due > 9 ? '9+' : String(due);
      stockBadge.hidden = due === 0;
    }

    if (!alerts.length) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:32px 16px; color:var(--text-sec);">
          <div style="font-size:2rem; margin-bottom:8px;">✨</div>
          <div style="font-weight:600; font-size:0.9375rem; color:var(--text);">Todo en orden</div>
          <div style="font-size:0.8125rem; color:var(--text-muted); margin-top:4px;">
            No hay revisiones de insumos pendientes ni insumos por reponer
          </div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = alerts.map(a => `
      <div class="notif-item ${a.type}" data-module="${a.module}" role="button" tabindex="0"
           style="cursor:pointer; padding:12px 16px; border-bottom:1px solid var(--border); transition:background var(--ease);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
          <div style="font-weight:600; font-size:0.875rem; color:${a.type === 'critical' ? 'var(--critical)' : 'var(--alert)'};">
            ${a.type === 'critical' ? '🔴' : '🟡'} ${Api.escapeHtml(a.title)}
          </div>
          <span style="font-size:0.75rem; color:var(--text-muted);">Ir →</span>
        </div>
        <div style="font-size:0.8125rem; color:var(--text-sec); line-height:1.4;">
          ${Api.escapeHtml(a.message)}
        </div>
      </div>
    `).join('');

    // Delegación de clic para navegar al módulo correspondiente
    listEl.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', () => {
        const mod = item.dataset.module;
        if (mod && typeof App !== 'undefined' && App.navigateTo) {
          toggleAlertsPanel(false);
          App.navigateTo(mod);
        }
      });
    });
  };

  const toggleAlertsPanel = (forceState) => {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    alertsOpen = typeof forceState === 'boolean' ? forceState : !alertsOpen;
    if (alertsOpen) {
      panel.classList.add('open');
      renderAlerts();
    } else {
      panel.classList.remove('open');
    }
  };

  // ─── Inicialización de Eventos Globales de UI ──────────────
  const init = () => {
    // Modal buttons
    document.getElementById('modal-confirm-btn')?.addEventListener('click', confirmModal);
    document.getElementById('modal-cancel-btn')?.addEventListener('click', closeModal);
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    // Confirm dialog buttons
    document.getElementById('confirm-ok-btn')?.addEventListener('click', doConfirm);
    document.getElementById('confirm-cancel-btn')?.addEventListener('click', closeConfirm);
    document.getElementById('confirm-dialog')?.addEventListener('click', (e) => {
      if (e.target.id === 'confirm-dialog') closeConfirm();
    });

    // Campana de alertas
    document.getElementById('notif-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAlertsPanel();
    });

    // Cerrar panel de alertas al hacer clic fuera
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('notif-panel');
      const btn = document.getElementById('notif-btn');
      if (panel && alertsOpen && !panel.contains(e.target) && !btn?.contains(e.target)) {
        toggleAlertsPanel(false);
      }
    });

    // Recalcular alertas al volver de segundo plano (RF-85)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderAlerts();
    });

    // Detección de conectividad (RNF-05)
    const offlineBanner = document.getElementById('offline-banner');
    const updateOnlineStatus = () => {
      if (offlineBanner) {
        if (window.CUIDAPP_CONFIG?.LOCAL_MODE) {
          offlineBanner.classList.add('hidden');
          return;
        }
        if (navigator.onLine) {
          offlineBanner.classList.add('hidden');
        } else {
          offlineBanner.classList.remove('hidden');
        }
      }
    };
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
  };

  return {
    init,
    toast,
    showModal,
    closeModal,
    confirmModal,
    confirm,
    closeConfirm,
    skeleton,
    setLoading,
    showButtonLoading: (btn, text) => setLoading(btn, true, text),
    hideButtonLoading: (btn) => setLoading(btn, false),
    renderAlerts,
    toggleAlertsPanel
  };
})();

