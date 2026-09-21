/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo de Gastos (js/expenses.js)
   ═══════════════════════════════════════════════════════════════ */

const ExpensesModule = (() => {
  'use strict';

  let currentPage = 0;
  const PAGE_SIZE = 50;
  let hasMore = false;
  let allLoadedExpenses = [];

  const CATEGORIES = [
    'Medicamentos',
    'Insumos Médicos',
    'Alimentos/Suplementos',
    'Equipos',
    'Servicios',
    'Higiene Personal',
    'Otros'
  ];

  /**
   * Renderiza el panel de gastos con paginación
   */
  const render = async () => {
    const el = document.getElementById('panel-expenses');
    if (!el) return;

    Ui.skeleton(el);

    try {
      currentPage = 0;
      const [thisMonthRes, pageRes] = await Promise.all([
        Api.getExpensesThisMonth(),
        Api.getExpenses({ page: 0, pageSize: PAGE_SIZE })
      ]);

      const thisMonth = thisMonthRes.data || [];
      const monthTotal = Api.getExpenseTotal(thisMonth);

      const expenses = pageRes.data || [];
      allLoadedExpenses = expenses;
      hasMore = expenses.length === PAGE_SIZE;

      drawUI(el, monthTotal, thisMonth.length, allLoadedExpenses, hasMore);
    } catch (err) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar gastos: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="exp-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('exp-retry-btn')?.addEventListener('click', render);
    }
  };

  /**
   * Carga la siguiente página de gastos
   */
  const loadNextPage = async () => {
    const btn = document.getElementById('exp-load-more-btn');
    if (btn) Ui.setLoading(btn, true);

    try {
      const nextPage = currentPage + 1;
      const res = await Api.getExpenses({ page: nextPage, pageSize: PAGE_SIZE });
      if (res.error) {
        Ui.toast(res.error, 'error');
        if (btn) Ui.setLoading(btn, false);
        return;
      }

      const newItems = res.data || [];
      currentPage = nextPage;
      allLoadedExpenses = allLoadedExpenses.concat(newItems);
      hasMore = newItems.length === PAGE_SIZE;

      const el = document.getElementById('panel-expenses');
      if (el) {
        const thisMonthRes = await Api.getExpensesThisMonth();
        const thisMonth = thisMonthRes.data || [];
        const monthTotal = Api.getExpenseTotal(thisMonth);
        drawUI(el, monthTotal, thisMonth.length, allLoadedExpenses, hasMore);
      }
    } catch (err) {
      Ui.toast('Error al cargar más gastos', 'error');
      if (btn) Ui.setLoading(btn, false);
    }
  };

  /**
   * Pinta la interfaz completa de gastos
   */
  const drawUI = (el, monthTotal, monthCount, expenses, showLoadMore) => {
    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">💰 Gastos</div>
        <button class="btn btn-primary btn-sm" id="btn-add-expense">+ Gasto</button>
      </div>

      <div class="exp-total">
        <div class="exp-total-label">Total este mes</div>
        <div class="exp-total-amount">$${Api.currency(monthTotal)}</div>
        <div class="text-xs text-muted" style="margin-top:8px;">${monthCount} transacciones este mes</div>
      </div>

      ${expenses.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">💰</div>
          <div class="empty-text">Sin gastos registrados aún.</div>
        </div>
      ` : `
        <div class="card-title">📋 HISTORIAL DE GASTOS</div>
        <div class="card" id="exp-list" style="overflow:hidden;">
          ${expenses.map(e => `
            <div class="exp-item" data-id="${Api.escapeHtml(e.id)}">
              <div class="exp-info">
                <div class="exp-desc">${Api.escapeHtml(e.description)}</div>
                <div class="exp-meta">
                  ${Api.escapeHtml(e.category)} · ${Api.formatDate(e.date)}
                  ${e.managedBy ? ' · ' + Api.escapeHtml(e.managedBy) : ''}
                  ${e.linkedRestockId ? ' <span class="badge" style="font-size:0.65rem;background:var(--border-subtle);color:var(--text-muted);">Reposición</span>' : ''}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <div class="exp-amount">$${Api.currency(e.amount)}</div>
                <button class="btn btn-ghost btn-sm text-critical btn-del-expense" data-id="${Api.escapeHtml(e.id)}" title="Eliminar gasto" aria-label="Eliminar gasto">🗑</button>
              </div>
            </div>
          `).join('')}
        </div>

        ${showLoadMore ? `
          <div style="margin-top:16px;text-align:center;">
            <button class="btn btn-secondary btn-full" id="exp-load-more-btn">Cargar más gastos</button>
          </div>
        ` : ''}
      `}
    `;

    // Listeners
    document.getElementById('btn-add-expense')?.addEventListener('click', showAddModal);
    document.getElementById('exp-load-more-btn')?.addEventListener('click', loadNextPage);

    // Event delegation para eliminar
    const listEl = document.getElementById('exp-list');
    listEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-del-expense');
      if (btn) {
        const id = btn.getAttribute('data-id');
        if (id) deleteExpense(id);
      }
    });
  };

  /**
   * Modal para registrar un nuevo gasto
   */
  const showAddModal = async () => {
    let currentShiftUser = '';
    const shiftRes = await Api.getCurrentShift();
    if (shiftRes?.data?.profile?.fullName) {
      currentShiftUser = shiftRes.data.profile.fullName;
    } else {
      const myProfile = Auth.getProfile();
      if (myProfile?.fullName) currentShiftUser = myProfile.fullName;
    }

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="ex-desc">Descripción *</label>
        <input class="form-input" id="ex-desc" placeholder="Ej: Compra Metoprolol" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="ex-amount">Monto ($) *</label>
          <input class="form-input" id="ex-amount" type="number" placeholder="0.00" step="0.01" min="0.01" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="ex-date">Fecha</label>
          <input class="form-input" id="ex-date" type="date" value="${Api.todayStr()}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="ex-cat">Categoría</label>
        <select class="form-select" id="ex-cat">
          ${CATEGORIES.map(c => `<option value="${Api.escapeHtml(c)}">${Api.escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ex-by">Gestionado por</label>
        <input class="form-input" id="ex-by" value="${Api.escapeHtml(currentShiftUser)}" placeholder="Nombre de quien realizó el gasto">
      </div>
    `;

    Ui.showModal('➕ Registrar Gasto', contentHtml, async () => {
      const desc = document.getElementById('ex-desc')?.value?.trim();
      const amountVal = document.getElementById('ex-amount')?.value;
      const amount = parseFloat(amountVal);
      const date = document.getElementById('ex-date')?.value || Api.todayStr();
      const category = document.getElementById('ex-cat')?.value || 'Otros';
      const managedBy = document.getElementById('ex-by')?.value?.trim() || null;

      if (!desc) {
        Ui.toast('La descripción es requerida', 'warning');
        return false;
      }
      if (!amount || isNaN(amount) || amount <= 0) {
        Ui.toast('Ingresa un monto válido mayor a 0', 'warning');
        return false;
      }

      const res = await Api.addExpense({
        description: desc,
        amount,
        date,
        category,
        managedBy
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false; // RNF-19: no cerrar el modal en error
      }

      Ui.toast('Gasto registrado con éxito', 'success');
      render();
      return true;
    });
  };

  /**
   * Eliminar un gasto
   */
  const deleteExpense = (id) => {
    Ui.confirm('¿Eliminar gasto?', 'Esta acción no se puede deshacer.', async () => {
      const res = await Api.deleteExpense(id);
      if (res.error) {
        Ui.toast(res.error, 'error');
      } else {
        Ui.toast('Gasto eliminado', 'info');
        render();
      }
    });
  };

  return {
    render,
    showAddModal,
    deleteExpense
  };
})();
