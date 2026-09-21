/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo de Inventario Inteligente (js/inventory.js)
   ═══════════════════════════════════════════════════════════════ */

const InventoryModule = (() => {
  'use strict';

  let activeCategory = 'all';
  let searchTerm = '';
  let cachedItems = [];

  /**
   * Renderiza el panel de inventario
   */
  const render = async () => {
    const el = document.getElementById('panel-inventory');
    if (!el) return;

    Ui.skeleton(el);

    try {
      const [invRes, catsRes, rolesRes] = await Promise.all([
        Api.getInventory(),
        Api.getInventoryCategories(),
        Api.getCareRoles()
      ]);

      cachedItems = invRes.data || [];
      const cats = catsRes.data || [];
      const roles = rolesRes.data || [];
      const lowCount = cachedItems.filter(i => i.isLow).length;

      const filtered = cachedItems
        .filter(i => activeCategory === 'all' || i.categoryName === activeCategory)
        .filter(i => !searchTerm || i.name.toLowerCase().includes(searchTerm.toLowerCase()));

      el.innerHTML = `
        <div class="section-header">
          <div class="section-title">📦 Inventario</div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${lowCount > 0 ? `<span class="badge badge-emergency">⚠️ ${lowCount} bajo mín.</span>` : ''}
            <button class="btn btn-primary btn-sm" id="btn-add-inv-item">+ Ítem</button>
          </div>
        </div>

        <!-- Barra de búsqueda -->
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input class="search-input" id="inv-search" placeholder="Buscar insumo..." value="${Api.escapeHtml(searchTerm)}">
        </div>

        <!-- Chips de categorías -->
        <div class="chip-row" style="overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;padding-bottom:4px;">
          <div class="chip ${activeCategory === 'all' ? 'active' : ''}" data-cat="all">Todos (${cachedItems.length})</div>
          ${cats.map(c => {
            const count = cachedItems.filter(i => i.categoryName === c.name).length;
            const lowC = cachedItems.filter(i => i.categoryName === c.name && i.isLow).length;
            return `
              <div class="chip ${activeCategory === c.name ? 'active' : ''}" data-cat="${Api.escapeHtml(c.name)}">
                ${Api.escapeHtml(c.name)} (${count})${lowC > 0 ? ' ⚠️' : ''}
              </div>
            `;
          }).join('')}
          <div class="chip" id="btn-add-inv-cat">+ Categoría</div>
        </div>

        <!-- Lista de ítems -->
        <div id="inv-list">
          ${filtered.length === 0 ? `
            <div class="empty-state">
              <div class="empty-icon">📦</div>
              <div class="empty-text">${cachedItems.length === 0 ? 'Sin ítems en inventario.<br>Toca "+ Ítem" para agregar.' : 'Sin resultados para la búsqueda.'}</div>
            </div>
          ` : filtered.map(item => renderItem(item)).join('')}
        </div>
      `;

      bindEvents(el, cats, roles);
    } catch (err) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar inventario: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="inv-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('inv-retry-btn')?.addEventListener('click', render);
    }
  };

  /**
   * Renderiza un ítem individual de inventario
   */
  const renderItem = (item) => {
    const isEmpty = item.currentStock === 0;
    const isLow = item.isLow;
    const cls = isEmpty ? 'empty' : isLow ? 'low' : '';
    const numCls = isEmpty ? 'empty' : isLow ? 'low' : 'ok';

    // RF-55: Con < 7 días de historial muestra "Recopilando datos", nunca 0 ni -
    const projectionText = item.daysRemaining !== null
      ? `~${item.daysRemaining}d restantes`
      : 'Recopilando datos';

    return `
      <div class="inv-item ${cls}" data-id="${Api.escapeHtml(item.id)}">
        <div class="inv-hdr">
          <div>
            <div class="inv-name">${Api.escapeHtml(item.name)}</div>
            <div class="inv-cat">
              ${Api.escapeHtml(item.categoryName || 'General')}
              ${item.responsibleRole ? ` · ${Api.escapeHtml(item.responsibleRole)}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm btn-edit-inv" data-id="${Api.escapeHtml(item.id)}" title="Editar">✏️</button>
            <button class="btn btn-ghost btn-sm text-critical btn-del-inv" data-id="${Api.escapeHtml(item.id)}" data-name="${Api.escapeHtml(item.name)}" title="Eliminar">🗑</button>
          </div>
        </div>

        <div class="inv-stock-row">
          <div>
            <div class="inv-stock-num ${numCls}">${item.currentStock}</div>
            <div class="inv-stock-unit">${Api.escapeHtml(item.unit || 'unid.')}</div>
            ${item.minThreshold > 0 ? `<div class="text-xs text-muted">Mínimo: ${item.minThreshold} ${Api.escapeHtml(item.unit || '')}</div>` : ''}
            <div class="text-xs ${numCls === 'ok' ? 'text-muted' : numCls === 'low' ? 'text-alert' : 'text-critical'}" style="font-weight:500;margin-top:2px;">
              ${Api.escapeHtml(projectionText)}
            </div>
          </div>
          <div class="inv-stepper">
            <button class="inv-step-btn btn-step-down" data-id="${Api.escapeHtml(item.id)}" title="Restar 1" aria-label="Restar una unidad">−</button>
            <div class="inv-step-val">1 ${Api.escapeHtml(item.unit || '')}</div>
            <button class="inv-step-btn btn-step-up" data-id="${Api.escapeHtml(item.id)}" title="Sumar 1" aria-label="Sumar una unidad">+</button>
          </div>
        </div>

        ${item.notes ? `<div class="text-xs text-muted" style="margin-top:6px;">${Api.escapeHtml(item.notes)}</div>` : ''}
      </div>
    `;
  };

  /**
   * Refresca solo la lista filtrada
   */
  const renderListOnly = () => {
    const filtered = cachedItems
      .filter(i => activeCategory === 'all' || i.categoryName === activeCategory)
      .filter(i => !searchTerm || i.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const listEl = document.getElementById('inv-list');
    if (listEl) {
      listEl.innerHTML = filtered.length === 0
        ? '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">Sin resultados</div></div>'
        : filtered.map(i => renderItem(i)).join('');
    }
  };

  /**
   * Enlazar eventos del panel de inventario
   */
  const bindEvents = (el, cats, roles) => {
    // Búsqueda
    el.querySelector('#inv-search')?.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderListOnly();
    });

    // Chips de categoría
    el.querySelectorAll('.chip[data-cat]').forEach(chip => {
      chip.addEventListener('click', () => {
        activeCategory = chip.getAttribute('data-cat') || 'all';
        el.querySelectorAll('.chip[data-cat]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderListOnly();
      });
    });

    // Nueva categoría
    el.querySelector('#btn-add-inv-cat')?.addEventListener('click', showAddCategoryModal);

    // Nuevo ítem
    el.querySelector('#btn-add-inv-item')?.addEventListener('click', () => showAddModal(cats, roles));

    // Delegación en la lista (stepper + / -, editar, eliminar)
    el.querySelector('#inv-list')?.addEventListener('click', async (e) => {
      // Ajuste stepper -1 (RF-51, RF-52)
      const btnDown = e.target.closest('.btn-step-down');
      if (btnDown) {
        const id = btnDown.getAttribute('data-id');
        if (id) await adjustStock(id, -1);
        return;
      }

      // Ajuste stepper +1 (RF-51)
      const btnUp = e.target.closest('.btn-step-up');
      if (btnUp) {
        const id = btnUp.getAttribute('data-id');
        if (id) await adjustStock(id, +1);
        return;
      }

      // Editar
      const btnEdit = e.target.closest('.btn-edit-inv');
      if (btnEdit) {
        const id = btnEdit.getAttribute('data-id');
        if (id) showEditModal(id, cats, roles);
        return;
      }

      // Eliminar
      const btnDel = e.target.closest('.btn-del-inv');
      if (btnDel) {
        const id = btnDel.getAttribute('data-id');
        const name = btnDel.getAttribute('data-name');
        if (id) deleteItem(id, name);
        return;
      }
    });
  };

  /**
   * Ajuste de stock rápido mediante RPC adjust_inventory (RF-51, RF-52)
   */
  const adjustStock = async (itemId, delta) => {
    const item = cachedItems.find(i => i.id === itemId);
    if (!item) return;

    if (delta < 0 && item.currentStock <= 0) {
      Ui.toast('El stock ya es cero; no se puede restar más', 'warning');
      return;
    }

    const res = await Api.adjustInventory(itemId, delta, delta > 0 ? 'Ajuste manual (+1)' : 'Ajuste manual (-1)');
    if (res.error) {
      Ui.toast(res.error, 'error');
      return;
    }

    // Actualiza caché local y UI
    item.currentStock = res.data;
    item.isLow = item.minThreshold > 0 && item.currentStock <= item.minThreshold;
    if (item.isLow) {
      Ui.toast(`⚠️ ${item.name} bajo el mínimo`, 'warning');
    }

    renderListOnly();
    Ui.renderAlerts();
    DashboardModule?.render();
  };

  /**
   * Modal para agregar ítem
   */
  const showAddModal = async (catsList, rolesList) => {
    const cats = catsList || (await Api.getInventoryCategories()).data || [];
    const roles = rolesList || (await Api.getCareRoles()).data || [];

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="ni-name">Nombre del insumo *</label>
        <input class="form-input" id="ni-name" placeholder="Ej: Gasas estériles 10x10" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="ni-cat">Categoría</label>
          <select class="form-select" id="ni-cat">
            ${cats.map(c => `<option value="${Api.escapeHtml(c.id)}">${Api.escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="ni-unit">Unidad</label>
          <input class="form-input" id="ni-unit" placeholder="piezas, ml, cajas..." value="piezas">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="ni-stock">Stock actual</label>
          <input class="form-input" id="ni-stock" type="number" placeholder="0" min="0" value="0">
        </div>
        <div class="form-group">
          <label class="form-label" for="ni-min">Mínimo recomendado</label>
          <input class="form-input" id="ni-min" type="number" placeholder="0" min="0" value="0">
          <span class="form-hint">Alerta cuando baje de este nivel</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="ni-role">Rol responsable de reponer</label>
        <select class="form-select" id="ni-role">
          <option value="">(Sin asignar)</option>
          ${roles.map(r => `<option value="${Api.escapeHtml(r.name)}">${Api.escapeHtml(r.icon || '')} ${Api.escapeHtml(r.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ni-notes">Notas / Proveedor</label>
        <input class="form-input" id="ni-notes" placeholder="Marca habitual, farmacia...">
      </div>
    `;

    Ui.showModal('➕ Nuevo Ítem de Inventario', contentHtml, async () => {
      const name = document.getElementById('ni-name')?.value?.trim();
      const categoryId = document.getElementById('ni-cat')?.value || null;
      const unit = document.getElementById('ni-unit')?.value?.trim() || 'unidad';
      const currentStock = parseFloat(document.getElementById('ni-stock')?.value) || 0;
      const minThreshold = parseFloat(document.getElementById('ni-min')?.value) || 0;
      const responsibleRole = document.getElementById('ni-role')?.value || null;
      const notes = document.getElementById('ni-notes')?.value?.trim() || null;

      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      const res = await Api.addInventoryItem({
        name,
        categoryId,
        unit,
        currentStock,
        minThreshold,
        responsibleRole,
        notes
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(`${name} agregado al inventario`, 'success');
      render();
      DashboardModule?.render();
      return true;
    });
  };

  /**
   * Modal para editar ítem
   */
  const showEditModal = (itemId, cats, roles) => {
    const item = cachedItems.find(i => i.id === itemId);
    if (!item) return;

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="ei-name">Nombre *</label>
        <input class="form-input" id="ei-name" value="${Api.escapeHtml(item.name)}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="ei-cat">Categoría</label>
          <select class="form-select" id="ei-cat">
            ${cats.map(c => `
              <option value="${Api.escapeHtml(c.id)}" ${c.id === item.categoryId ? 'selected' : ''}>${Api.escapeHtml(c.name)}</option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="ei-unit">Unidad</label>
          <input class="form-input" id="ei-unit" value="${Api.escapeHtml(item.unit || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="ei-stock">Stock actual</label>
          <input class="form-input" id="ei-stock" type="number" min="0" value="${item.currentStock}">
        </div>
        <div class="form-group">
          <label class="form-label" for="ei-min">Mínimo</label>
          <input class="form-input" id="ei-min" type="number" min="0" value="${item.minThreshold}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="ei-role">Responsable</label>
        <select class="form-select" id="ei-role">
          <option value="">(Sin asignar)</option>
          ${roles.map(r => `
            <option value="${Api.escapeHtml(r.name)}" ${item.responsibleRole === r.name ? 'selected' : ''}>
              ${Api.escapeHtml(r.icon || '')} ${Api.escapeHtml(r.name)}
            </option>
          `).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ei-notes">Notas</label>
        <input class="form-input" id="ei-notes" value="${Api.escapeHtml(item.notes || '')}">
      </div>
    `;

    Ui.showModal(`✏️ Editar — ${item.name}`, contentHtml, async () => {
      const name = document.getElementById('ei-name')?.value?.trim();
      const categoryId = document.getElementById('ei-cat')?.value || null;
      const unit = document.getElementById('ei-unit')?.value?.trim() || 'unidad';
      const currentStock = parseFloat(document.getElementById('ei-stock')?.value) || 0;
      const minThreshold = parseFloat(document.getElementById('ei-min')?.value) || 0;
      const responsibleRole = document.getElementById('ei-role')?.value || null;
      const notes = document.getElementById('ei-notes')?.value?.trim() || null;

      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      const res = await Api.updateInventoryItem(itemId, {
        name,
        categoryId,
        unit,
        currentStock,
        minThreshold,
        responsibleRole,
        notes
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Ítem actualizado', 'success');
      render();
      DashboardModule?.render();
      return true;
    });
  };

  /**
   * Modal para agregar nueva categoría
   */
  const showAddCategoryModal = () => {
    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="nc-name">Nombre de la categoría *</label>
        <input class="form-input" id="nc-name" placeholder="Ej: Oxigenoterapia" required>
      </div>
    `;

    Ui.showModal('➕ Nueva Categoría', contentHtml, async () => {
      const name = document.getElementById('nc-name')?.value?.trim();
      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      const res = await Api.addInventoryCategory(name);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(`Categoría "${name}" agregada`, 'success');
      render();
      return true;
    });
  };

  /**
   * Eliminar ítem
   */
  const deleteItem = (itemId, name) => {
    Ui.confirm(`¿Eliminar ${name}?`, 'Se removerá del inventario permanentemente.', async () => {
      const res = await Api.deleteInventoryItem(itemId);
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
    showAddModal,
    showAddCategoryModal
  };
})();
