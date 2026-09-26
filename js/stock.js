/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Control de Insumos (js/stock.js)
   Registro de insumos y medicamentos con stock objetivo y prioridad.
   Cada nivel de prioridad tiene su intervalo de revisión (por defecto
   24 / 48 / 72 h), configurable por el administrador.
   Por ahora solo lo usa un administrador.
   ═══════════════════════════════════════════════════════════════ */

const StockModule = (() => {
  'use strict';

  let filter = 'all';      // 'all' | 'due' | 'low'
  let priorityFilter = 0;  // 0 = todos los niveles, 1..3 = un nivel
  let items = [];

  const esc = (s) => Api.escapeHtml(s);
  const categoryOf = (id) => Api.STOCK_CATEGORIES.find(c => c.id === id) || { label: id, icon: '📦' };

  // Acepta "12", "12,5" o "12.5"; devuelve null si no es un número ≥ 0
  const parseQty = (raw) => {
    const n = Number(String(raw ?? '').trim().replace(',', '.'));
    return String(raw ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  };

  const fmtQty = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-ES'));

  // Texto corto para la próxima revisión
  const nextCheckText = (item, st) => {
    if (!item.lastCheckedAt) return 'Sin conteo todavía';
    if (st.checkDue) return `Revisión vencida · última ${Api.timeAgo(item.lastCheckedAt).toLowerCase()}`;
    const hours = Math.round((st.nextCheckAt - Date.now()) / 3600000);
    return hours < 1 ? 'Revisar en menos de 1 h' : hours <= 24 ? `Revisar en ${hours} h` : `Revisar ${Api.formatDateTime(st.nextCheckAt.toISOString())}`;
  };

  const stockTag = (item, st) => {
    if (st.stockState === 'unknown') return '<span class="stock-tag unknown">Sin conteo</span>';
    if (st.stockState === 'empty') return `<span class="stock-tag empty">Agotado · faltan ${fmtQty(st.missing)}</span>`;
    if (st.stockState === 'low') return `<span class="stock-tag low">Faltan ${fmtQty(st.missing)}</span>`;
    return '<span class="stock-tag ok">Completo</span>';
  };

  const setFilter = (f) => {
    filter = ['all', 'due', 'low'].includes(f) ? f : 'all';
  };

  // ─── Listado ─────────────────────────────────────────────
  const render = async () => {
    const el = document.getElementById('panel-stock');
    if (!el) return;
    Ui.skeleton(el);

    const res = await Api.getStockItems();
    if (!res.ok) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">${esc(res.error)}</div>
          <button class="btn btn-secondary btn-sm" id="stock-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>`;
      el.querySelector('#stock-retry-btn')?.addEventListener('click', render);
      return;
    }

    items = res.data;
    const now = new Date();
    const rows = items.map(item => ({ item, st: Api.stockItemStatus(item, now) }));
    const dueCount = rows.filter(r => r.st.checkDue).length;
    const lowCount = rows.filter(r => r.st.stockState === 'low' || r.st.stockState === 'empty').length;

    const visible = rows.filter(r =>
      (!priorityFilter || r.item.priority === priorityFilter) && (
        filter === 'due' ? r.st.checkDue :
        filter === 'low' ? (r.st.stockState === 'low' || r.st.stockState === 'empty') :
        true));

    const groups = [1, 2, 3]
      .map(p => ({ p, rows: visible.filter(r => r.item.priority === p) }))
      .filter(g => g.rows.length);

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">📦 Insumos</div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-secondary btn-icon" id="stock-config-btn" aria-label="Configurar tiempos de revisión" title="Configurar tiempos de revisión">⚙️</button>
          <button class="btn btn-primary btn-sm" id="stock-add-btn">+ Registrar</button>
        </div>
      </div>

      <div class="stock-summary">
        <button class="stock-kpi ${filter === 'due' ? 'active' : ''}" data-filter="due">
          <div class="stock-kpi-val" style="color:${dueCount ? 'var(--critical)' : 'var(--stable)'}">${dueCount}</div>
          <div class="stock-kpi-label">Por revisar</div>
        </button>
        <button class="stock-kpi ${filter === 'low' ? 'active' : ''}" data-filter="low">
          <div class="stock-kpi-val" style="color:${lowCount ? 'var(--alert)' : 'var(--stable)'}">${lowCount}</div>
          <div class="stock-kpi-label">Por reponer</div>
        </button>
        <button class="stock-kpi ${filter === 'all' ? 'active' : ''}" data-filter="all">
          <div class="stock-kpi-val">${items.length}</div>
          <div class="stock-kpi-label">Todos</div>
        </button>
      </div>

      <!-- Filtro por nivel de prioridad -->
      <div class="stock-chips" role="group" aria-label="Filtrar por nivel de prioridad">
        ${[0, 1, 2, 3].map(p => `
          <button class="stock-chip ${priorityFilter === p ? 'active' : ''}" data-priority="${p}">
            ${p === 0 ? 'Todos' : `${p === 1 ? '🔴' : p === 2 ? '🟡' : '🔵'} Nivel ${p}`}
          </button>
        `).join('')}
      </div>

      ${items.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">📦</div>
          <div class="empty-text">Aún no hay insumos registrados.<br>Toca «+ Registrar» para añadir el primero.</div>
        </div>
      ` : groups.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">✅</div>
          <div class="empty-text">${
            filter === 'due' ? 'No hay revisiones pendientes' :
            filter === 'low' ? 'No hay insumos por reponer' :
            'No hay insumos'}${priorityFilter ? ` en el nivel ${priorityFilter}` : ''}.</div>
        </div>
      ` : groups.map(g => `
        <div class="card-title stock-group-title">${esc(Api.STOCK_PRIORITIES[g.p].label)} · cada ${Api.STOCK_PRIORITIES[g.p].hours} h</div>
        ${g.rows.map(({ item, st }) => `
          <button class="stock-item state-${st.stockState}" data-id="${esc(item.id)}">
            <div class="stock-item-main">
              <div class="stock-item-name">${categoryOf(item.category).icon} ${esc(item.name)}</div>
              <div class="stock-item-meta">${esc(nextCheckText(item, st))}</div>
              <div>
                ${st.checkDue ? '<span class="stock-tag due">Revisar ahora</span>' : ''}
                ${stockTag(item, st)}
              </div>
            </div>
            <div class="stock-item-qty">
              <strong>${fmtQty(item.currentStock)}</strong><span> / ${fmtQty(item.targetStock)}</span>
            </div>
          </button>
        `).join('')}
      `).join('')}
    `;

    el.querySelector('#stock-add-btn')?.addEventListener('click', () => showCategoryStep());
    el.querySelector('#stock-config-btn')?.addEventListener('click', showPriorityConfig);
    el.querySelectorAll('.stock-kpi[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        filter = btn.dataset.filter === filter ? 'all' : btn.dataset.filter;
        render();
      });
    });
    el.querySelectorAll('.stock-chip[data-priority]').forEach(btn => {
      btn.addEventListener('click', () => {
        priorityFilter = Number(btn.dataset.priority);
        render();
      });
    });
    el.querySelectorAll('.stock-item[data-id]').forEach(btn => {
      btn.addEventListener('click', () => showItem(btn.dataset.id));
    });

    // Los insumos por reponer se reflejan en la lista de compra
    Api.syncStockShopping().then(r => {
      if (r && !r.ok) console.warn('No se pudo sincronizar la lista de compra:', r.error);
    });
  };

  // ─── Configuración de tiempos de revisión por nivel ──────
  const showPriorityConfig = () => {
    Ui.showModal('⚙️ Tiempos de revisión', `
      <div class="text-xs text-muted" style="margin-bottom:12px;">
        Cada cuántas horas se debe revisar el stock según el nivel de prioridad.
      </div>
      ${[1, 2, 3].map(p => `
        <div class="form-group">
          <label class="form-label" for="stock-hours-${p}">
            ${p === 1 ? '🔴' : p === 2 ? '🟡' : '🔵'} ${esc(Api.STOCK_PRIORITIES[p].label)} · horas
          </label>
          ${stepperHtml(`stock-hours-${p}`, Api.STOCK_PRIORITIES[p].hours)}
        </div>
      `).join('')}
    `, async () => {
      const hours = {};
      for (const p of [1, 2, 3]) {
        const h = parseQty(document.getElementById(`stock-hours-${p}`)?.value);
        if (h === null || !Number.isInteger(h) || h < 1 || h > 720) {
          Ui.toast(`Nivel ${p}: escribe un número entero de horas entre 1 y 720`, 'warning');
          return false;
        }
        hours[p] = h;
      }
      const res = await Api.saveStockPriorityHours(hours);
      if (!res.ok) { Ui.toast(res.error, 'error'); return false; }
      Ui.toast('Tiempos de revisión actualizados', 'success');
      refreshAll();
      return true;
    });
    bindFormControls();
  };

  // Refresca la lista, Inicio y el contador de alertas tras un cambio
  const refreshAll = () => {
    render();
    Ui.renderAlerts();
  };

  // ─── Registro: paso 1, categoría (un toque) ──────────────
  const showCategoryStep = () => {
    Ui.showModal('Registrar insumo · 1/2', `
      <div class="form-label" style="margin-bottom:8px;">¿Qué vas a registrar?</div>
      <div class="choice-grid">
        ${Api.STOCK_CATEGORIES.map(c => `
          <button type="button" class="choice-btn" data-cat="${c.id}">
            <span class="choice-icon">${c.icon}</span>${esc(c.label)}
          </button>
        `).join('')}
      </div>
    `, null, false);

    document.querySelectorAll('#modal-body .choice-btn[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => showDetailsStep(btn.dataset.cat));
    });
  };

  // Formulario común de nombre, stock objetivo y prioridad (alta y edición)
  const itemFormHtml = ({ name = '', targetStock = '', priority = null, category = null, withCategory = false }) => `
    ${withCategory ? `
      <div class="form-group">
        <div class="form-label">Categoría</div>
        <div class="choice-grid cols-3">
          ${Api.STOCK_CATEGORIES.map(c => `
            <button type="button" class="choice-btn ${c.id === category ? 'selected' : ''}" data-cat="${c.id}">
              <span class="choice-icon">${c.icon}</span>${esc(c.label)}
            </button>
          `).join('')}
        </div>
      </div>
    ` : ''}
    <div class="form-group">
      <label class="form-label" for="stock-name">Nombre</label>
      <input id="stock-name" class="form-input" type="text" maxlength="80" autocomplete="off"
             placeholder="Ej. Gasas estériles" value="${esc(name)}">
    </div>
    <div class="form-group">
      <label class="form-label" for="stock-target">¿Cuántos necesitas mantener en stock?</label>
      ${stepperHtml('stock-target', targetStock)}
    </div>
    <div class="form-group">
      <div class="form-label">Prioridad</div>
      <div class="choice-grid cols-3">
        ${[1, 2, 3].map(p => `
          <button type="button" class="choice-btn ${p === priority ? 'selected' : ''}" data-priority="${p}">
            <span class="choice-icon">${p === 1 ? '🔴' : p === 2 ? '🟡' : '🔵'}</span>
            Nivel ${p}
            <small>Revisar cada ${Api.STOCK_PRIORITIES[p].hours} h</small>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  const stepperHtml = (id, value) => `
    <div class="stepper">
      <button type="button" class="btn btn-secondary" data-step="-1" data-for="${id}" aria-label="Restar uno">−</button>
      <input id="${id}" class="form-input" type="text" inputmode="decimal" autocomplete="off"
             value="${esc(value)}" placeholder="0">
      <button type="button" class="btn btn-secondary" data-step="1" data-for="${id}" aria-label="Sumar uno">+</button>
    </div>
  `;

  // Cablea steppers y grupos de opción dentro del modal
  const bindFormControls = () => {
    const body = document.getElementById('modal-body');
    body.querySelectorAll('[data-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.for);
        const current = parseQty(input.value) ?? 0;
        input.value = String(Math.max(0, current + Number(btn.dataset.step)));
      });
    });
    ['data-priority', 'data-cat'].forEach(attr => {
      const group = body.querySelectorAll(`.choice-btn[${attr}]`);
      group.forEach(btn => btn.addEventListener('click', () => {
        group.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      }));
    });
  };

  // Lee y valida el formulario; devuelve null (con aviso) si falta algo
  const readItemForm = () => {
    const body = document.getElementById('modal-body');
    const name = document.getElementById('stock-name')?.value.trim();
    const targetStock = parseQty(document.getElementById('stock-target')?.value);
    const priority = Number(body.querySelector('.choice-btn[data-priority].selected')?.dataset.priority) || null;
    const category = body.querySelector('.choice-btn[data-cat].selected')?.dataset.cat;

    if (!name) { Ui.toast('Escribe el nombre del insumo', 'warning'); return null; }
    if (targetStock === null) { Ui.toast('Indica cuántos necesitas mantener en stock', 'warning'); return null; }
    if (!priority) { Ui.toast('Elige el nivel de prioridad', 'warning'); return null; }
    return { name, targetStock, priority, category };
  };

  // ─── Registro: paso 2, nombre, objetivo y prioridad ──────
  const showDetailsStep = (category) => {
    const cat = categoryOf(category);
    Ui.showModal('Registrar insumo · 2/2', `
      <button type="button" class="btn btn-ghost btn-sm" id="stock-back-btn" style="margin-bottom:8px;">
        ← ${cat.icon} ${esc(cat.label)}
      </button>
      ${itemFormHtml({})}
    `, async () => {
      const data = readItemForm();
      if (!data) return false;
      const res = await Api.addStockItem({ ...data, category });
      if (!res.ok) { Ui.toast(res.error, 'error'); return false; }
      Ui.toast(`${data.name} registrado. Toca el insumo para anotar su primer conteo.`, 'success', 4500);
      refreshAll();
      return true;
    });

    const confirmBtn = document.getElementById('modal-confirm-btn');
    if (confirmBtn) confirmBtn.textContent = 'Registrar';
    document.getElementById('stock-back-btn')?.addEventListener('click', showCategoryStep);
    bindFormControls();
  };

  // ─── Detalle: revisión de stock e historial ──────────────
  const showItem = async (id) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const st = Api.stockItemStatus(item);
    const cat = categoryOf(item.category);

    Ui.showModal(`${cat.icon} ${item.name}`, `
      <div class="text-xs text-muted" style="margin-bottom:12px;">
        ${esc(cat.label)} · ${esc(Api.STOCK_PRIORITIES[item.priority].label)} · Objetivo ${fmtQty(item.targetStock)}<br>
        Registrado ${esc(Api.formatDateTime(item.createdAt))}
      </div>
      <div style="margin-bottom:12px;">
        ${st.checkDue ? '<span class="stock-tag due">Revisar ahora</span>' : ''}
        ${stockTag(item, st)}
        <div class="text-xs text-muted" style="margin-top:4px;">${esc(nextCheckText(item, st))}</div>
      </div>

      <div class="form-group">
        <label class="form-label" for="stock-count">¿Cuántos hay ahora?</label>
        ${stepperHtml('stock-count', item.currentStock ?? '')}
      </div>

      <div class="card-title" style="margin-top:8px;">Historial de revisiones</div>
      <div id="stock-history" class="text-xs text-muted">Cargando…</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;">
        <button type="button" class="btn btn-secondary" id="stock-edit-btn">✏️ Editar</button>
        <button type="button" class="btn btn-danger" id="stock-delete-btn">🗑️ Eliminar</button>
      </div>
    `, async () => {
      const qty = parseQty(document.getElementById('stock-count')?.value);
      if (qty === null) { Ui.toast('Anota cuántos hay ahora', 'warning'); return false; }
      const res = await Api.recordStockCheck(item.id, qty);
      if (!res.ok) { Ui.toast(res.error, 'error'); return false; }
      const missing = Math.max(item.targetStock - qty, 0);
      Ui.toast(missing > 0 ? `Revisión guardada · faltan ${fmtQty(missing)} para el objetivo` : 'Revisión guardada · stock completo',
        missing > 0 ? 'warning' : 'success');
      refreshAll();
      return true;
    });

    const confirmBtn = document.getElementById('modal-confirm-btn');
    if (confirmBtn) confirmBtn.textContent = 'Guardar revisión';
    bindFormControls();
    document.getElementById('stock-edit-btn')?.addEventListener('click', () => showEdit(item));
    document.getElementById('stock-delete-btn')?.addEventListener('click', () => confirmDelete(item));

    const hist = await Api.getStockChecks(item.id);
    const histEl = document.getElementById('stock-history');
    if (!histEl) return;
    if (!hist.ok) { histEl.textContent = hist.error; return; }
    if (!hist.data.length) { histEl.textContent = 'Todavía no hay revisiones.'; return; }
    histEl.innerHTML = hist.data.map(c => {
      const diff = c.previousQuantity === null ? null : c.previousQuantity - c.quantity;
      const change = diff === null ? 'Primer conteo'
        : diff > 0 ? `Consumo ${fmtQty(diff)}`
        : diff < 0 ? `Subió ${fmtQty(-diff)} (reposición)`
        : 'Sin cambios';
      return `
        <div class="check-history-row">
          <div>
            <div style="color:var(--text);font-weight:600;">${fmtQty(c.quantity)} en stock</div>
            <div>${esc(Api.formatDateTime(c.checkedAt))} · ${esc(c.checkedByName)}</div>
          </div>
          <div style="text-align:right;white-space:nowrap;">${esc(change)}</div>
        </div>`;
    }).join('');
  };

  // ─── Edición ──────────────────────────────────────────────
  const showEdit = (item) => {
    Ui.showModal('Editar insumo', itemFormHtml({ ...item, withCategory: true }), async () => {
      const data = readItemForm();
      if (!data) return false;
      const res = await Api.updateStockItem(item.id, data);
      if (!res.ok) { Ui.toast(res.error, 'error'); return false; }
      Ui.toast('Insumo actualizado', 'success');
      refreshAll();
      return true;
    });
    const confirmBtn = document.getElementById('modal-confirm-btn');
    if (confirmBtn) confirmBtn.textContent = 'Guardar';
    bindFormControls();
  };

  const confirmDelete = (item) => {
    Ui.closeModal();
    Ui.confirm(`¿Eliminar «${item.name}»?`, 'Se borrarán también sus revisiones. La auditoría conserva el registro.', async () => {
      const res = await Api.deleteStockItem(item.id);
      if (!res.ok) { Ui.toast(res.error, 'error'); return; }
      Ui.toast('Insumo eliminado', 'success');
      refreshAll();
    });
  };

  return { render, setFilter };
})();

window.StockModule = StockModule;
