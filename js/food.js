/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo de Alimentación y Compras (js/food.js)
   Recetario · Planificador (D/A/C) · Complementos · Compras
   ═══════════════════════════════════════════════════════════════ */

const FoodModule = (() => {
  'use strict';

  let activeTab = 'today'; // 'today' | 'planner' | 'recipes' | 'complementos' | 'shopping'

  // Comidas principales — solo desayuno, almuerzo, cena
  const MEAL_TYPES = [
    { id: 'breakfast', label: 'Desayuno', icon: '🌅' },
    { id: 'lunch',     label: 'Almuerzo', icon: '🍽️' },
    { id: 'dinner',    label: 'Cena',     icon: '🌙' }
  ];

  // Categorías de complementos
  const COMPLEMENT_CATS = [
    { id: 'bebidas',   label: 'Bebidas',   icon: '🥤' },
    { id: 'contornos', label: 'Contornos', icon: '🥗' },
    { id: 'snacks',    label: 'Snacks',    icon: '🍎' },
    { id: 'otros',     label: 'Otros',     icon: '🧺' }
  ];

  const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const FULL_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  let cachedRecipes = [];
  let cachedPlan = [];
  let cachedComplementos = [];
  let cachedShopping = [];

  /**
   * Normaliza el plan semanal a un arreglo de slots [{ dayOfWeek, dayIndex, mealType, recipeIds }]
   */
  const normalizePlan = (raw) => {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const arr = [];
      Object.keys(raw).forEach(day => {
        const dayObj = raw[day];
        if (dayObj && typeof dayObj === 'object') {
          Object.keys(dayObj).forEach(meal => {
            arr.push({
              dayOfWeek: parseInt(day, 10),
              dayIndex: parseInt(day, 10),
              mealType: meal,
              recipeIds: Array.isArray(dayObj[meal]) ? dayObj[meal] : []
            });
          });
        }
      });
      return arr;
    }
    return [];
  };

  /**
   * Renderiza el módulo según la pestaña activa
   */
  const render = async () => {
    const el = document.getElementById('panel-food');
    if (!el) return;

    Ui.skeleton(el);

    try {
      if (activeTab === 'today') {
        await renderToday(el);
      } else if (activeTab === 'recipes') {
        await renderRecipes(el);
      } else if (activeTab === 'planner') {
        await renderPlanner(el);
      } else if (activeTab === 'complementos') {
        await renderComplementos(el);
      } else if (activeTab === 'shopping') {
        await renderShopping(el);
      }
    } catch (err) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar módulo de alimentación: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="food-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('food-retry-btn')?.addEventListener('click', render);
    }
  };

  const tabsHtml = () => `
    <div class="tabs" id="food-nav-tabs" style="font-size:0.75rem;">
      <button class="tab-btn ${activeTab === 'today' ? 'active' : ''}" data-tab="today">Menú de Hoy</button>
      <button class="tab-btn ${activeTab === 'planner' ? 'active' : ''}" data-tab="planner">Planificador</button>
      <button class="tab-btn ${activeTab === 'recipes' ? 'active' : ''}" data-tab="recipes">Recetario</button>
      <button class="tab-btn ${activeTab === 'complementos' ? 'active' : ''}" data-tab="complementos">Complementos</button>
      <button class="tab-btn ${activeTab === 'shopping' ? 'active' : ''}" data-tab="shopping">Compras</button>
    </div>
  `;

  const bindNavTabs = (el) => {
    el.querySelectorAll('#food-nav-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab && tab !== activeTab) {
          activeTab = tab;
          render();
        }
      });
    });
  };

  // ══════════════════════════════════════════════════════════
  //  0. MENÚ DE HOY (Menú del día — RF-74)
  // ══════════════════════════════════════════════════════════
  const renderToday = async (el) => {
    const [planRes, recipesRes, compRes] = await Promise.all([
      Api.getWeeklyPlan(),
      Api.getRecipes(),
      Api.getComplementos()
    ]);

    cachedPlan = normalizePlan(planRes.data || planRes);
    cachedRecipes = recipesRes.data || [];
    cachedComplementos = compRes.data || [];

    const recipeMap = new Map(cachedRecipes.map(r => [r.id, r]));

    const todayDate = new Date();
    const todayDayIndex = todayDate.getDay(); // 0..6
    const todayName = FULL_DAYS[todayDayIndex];
    const dateFormatted = todayDate.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    let mealsHtml = '';
    MEAL_TYPES.forEach(mt => {
      const slot = cachedPlan.find(s => (Number(s.dayOfWeek) === todayDayIndex || Number(s.dayIndex) === todayDayIndex) && s.mealType === mt.id);
      const slotRecipeIds = slot?.recipeIds || [];
      const slotRecipes = slotRecipeIds.map(id => recipeMap.get(id)).filter(Boolean);

      mealsHtml += `
        <div class="card" style="margin-bottom:12px;padding:14px;background:var(--bg-glass);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:1.35rem;">${mt.icon}</span>
              <div>
                <span class="font-bold text-base">${Api.escapeHtml(mt.label)}</span>
                <span class="text-xs text-muted" style="margin-left:6px;">(${slotRecipes.length} ${slotRecipes.length === 1 ? 'preparación' : 'preparaciones'})</span>
              </div>
            </div>
            <button class="btn btn-ghost btn-xs btn-add-today-recipe" data-meal="${mt.id}">
              + Asignar
            </button>
          </div>
      `;

      if (slotRecipes.length === 0) {
        mealsHtml += `
          <div style="padding:14px;text-align:center;background:rgba(255,255,255,0.02);border-radius:var(--radius-sm);border:1px dashed var(--border-subtle);">
            <div class="text-xs text-muted" style="margin-bottom:6px;">Sin preparaciones asignadas para el ${mt.label.toLowerCase()} de hoy</div>
            <button class="btn btn-secondary btn-xs btn-add-today-recipe" data-meal="${mt.id}">
              + Seleccionar del recetario
            </button>
          </div>
        `;
      } else {
        mealsHtml += `<div style="display:flex;flex-direction:column;gap:10px;">`;
        slotRecipes.forEach(r => {
          const ingList = (r.ingredients || []).map(i => {
            const qty = [i.amount, i.unit].filter(Boolean).join(' ');
            return qty ? `${i.name} (${qty})` : i.name;
          }).join(', ');

          mealsHtml += `
            <div style="padding:12px;background:rgba(255,255,255,0.04);border-radius:var(--radius-sm);border:1px solid var(--border-subtle);">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="flex:1;">
                  <div class="font-bold text-sm text-primary" style="font-size:0.95rem;">${Api.escapeHtml(r.name)}</div>
                  ${ingList ? `<div class="text-xs text-sec" style="margin-top:6px;">🥬 <strong>Ingredientes:</strong> ${Api.escapeHtml(ingList)}</div>` : ''}
                  ${r.instructions ? `<div class="text-xs text-muted" style="margin-top:4px;">📝 <strong>Instrucciones:</strong> ${Api.escapeHtml(r.instructions)}</div>` : ''}
                  ${r.notes ? `<div class="text-xs text-alert" style="margin-top:4px;">⚠️ <em>${Api.escapeHtml(r.notes)}</em></div>` : ''}
                </div>
                <button class="btn btn-ghost btn-xs text-critical btn-rm-today-recipe" data-meal="${mt.id}" data-recipe-id="${Api.escapeHtml(r.id)}" title="Quitar del menú de hoy">
                  ✕ Quitar
                </button>
              </div>
            </div>
          `;
        });
        mealsHtml += `</div>`;
      }

      mealsHtml += `</div>`;
    });

    let compHtml = '';
    if (cachedComplementos.length > 0) {
      compHtml = `
        <div class="card-title" style="margin-top:16px;">🥤 COMPLEMENTOS Y BEBIDAS</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;margin-bottom:16px;">
          ${cachedComplementos.map(c => `
            <div class="card" style="padding:10px;background:var(--bg-glass);">
              <div class="font-bold text-xs">${Api.escapeHtml(c.name)}</div>
              ${c.amount || c.unit ? `<div class="text-xs text-sec">${Api.escapeHtml([c.amount, c.unit].filter(Boolean).join(' '))}</div>` : ''}
              ${c.notes ? `<div class="text-xs text-muted" style="font-size:0.7rem;margin-top:2px;">${Api.escapeHtml(c.notes)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    el.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🍽️ Menú del Día</div>
          <div class="text-xs text-muted" style="margin-top:2px;">${todayName}, ${dateFormatted}</div>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-add-today-recipe-hdr">+ Receta</button>
      </div>
      ${tabsHtml()}

      <div class="card-title">🍲 COMIDAS DE HOY (${todayName.toUpperCase()})</div>
      ${mealsHtml}

      ${compHtml}

      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" id="btn-quick-planner" style="flex:1;min-width:140px;">
          📅 Planificador Semanal (7 días)
        </button>
        <button class="btn btn-secondary btn-sm" id="btn-quick-shopping" style="flex:1;min-width:140px;">
          🛒 Lista de Compras
        </button>
        <button class="btn btn-ghost btn-sm text-muted" id="btn-reset-demo-menus" style="width:100%;margin-top:4px;">
          🔄 Restablecer Menús de Ejemplo (7 Días Completos)
        </button>
      </div>
    `;

    bindNavTabs(el);
    bindTodayEvents(el, todayDayIndex);
  };

  const bindTodayEvents = (el, todayDayIndex) => {
    // Restaurar menús de ejemplo
    el.querySelector('#btn-reset-demo-menus')?.addEventListener('click', async () => {
      const ok = await Ui.confirm('¿Restablecer los menús de la semana con los datos de ejemplo predeterminados?');
      if (ok) {
        LocalStore.resetToDefaults();
        Ui.toast('Menús restablecidos correctamente', 'success');
        render();
      }
    });

    // Botones rápidos a planificador y compras
    el.querySelector('#btn-quick-planner')?.addEventListener('click', () => {
      activeTab = 'planner';
      render();
    });
    el.querySelector('#btn-quick-shopping')?.addEventListener('click', () => {
      activeTab = 'shopping';
      render();
    });

    // Agregar receta desde cabecera (abre para almuerzo o primera comida)
    el.querySelector('#btn-add-today-recipe-hdr')?.addEventListener('click', () => {
      showSelectRecipeModal(todayDayIndex, 'lunch');
    });

    // Agregar receta a comida específica
    el.querySelectorAll('.btn-add-today-recipe').forEach(btn => {
      btn.addEventListener('click', () => {
        const meal = btn.getAttribute('data-meal');
        showSelectRecipeModal(todayDayIndex, meal);
      });
    });

    // Quitar receta de hoy
    el.querySelectorAll('.btn-rm-today-recipe').forEach(btn => {
      btn.addEventListener('click', async () => {
        const meal = btn.getAttribute('data-meal');
        const recipeId = btn.getAttribute('data-recipe-id');
        const slot = cachedPlan.find(s => (Number(s.dayOfWeek) === todayDayIndex || Number(s.dayIndex) === todayDayIndex) && s.mealType === meal);
        if (!slot) return;
        const newIds = (slot.recipeIds || []).filter(id => id !== recipeId);
        const res = await Api.setWeeklySlot(todayDayIndex, meal, newIds);
        if (res.error) {
          Ui.toast(res.error, 'error');
        } else {
          Ui.toast('Receta retirada del menú de hoy', 'info');
          render();
        }
      });
    });
  };

  // ══════════════════════════════════════════════════════════
  //  1. RECETARIO (RF-72, RF-73)
  // ══════════════════════════════════════════════════════════
  const renderRecipes = async (el) => {
    const res = await Api.getRecipes();
    cachedRecipes = res.data || [];

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">🍽️ Alimentación</div>
        <button class="btn btn-primary btn-sm" id="btn-add-recipe">+ Receta</button>
      </div>
      ${tabsHtml()}

      <div class="chip-row" id="meal-filter-chips">
        <div class="chip active" data-filter="all">Todas (${cachedRecipes.length})</div>
        ${MEAL_TYPES.map(m => `
          <div class="chip" data-filter="${Api.escapeHtml(m.id)}">
            ${m.icon} ${Api.escapeHtml(m.label)}
          </div>
        `).join('')}
      </div>

      <div id="recipes-list">
        ${cachedRecipes.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">🍽️</div>
            <div class="empty-text">Sin recetas en el catálogo.<br>Toca "+ Receta" para agregar preparaciones.</div>
          </div>
        ` : cachedRecipes.map(r => renderRecipeCard(r)).join('')}
      </div>
    `;

    bindNavTabs(el);
    bindRecipeEvents(el);
  };

  const renderRecipeCard = (r) => {
    const types = (r.mealTypes || ['lunch'])
      .map(id => MEAL_TYPES.find(m => m.id === id))
      .filter(Boolean);

    const typeHtml = types.map(mt => `
      <span class="recipe-type-badge">${mt.icon} ${Api.escapeHtml(mt.label)}</span>
    `).join('');

    const ingHtml = r.ingredients && r.ingredients.length > 0
      ? `<div class="text-xs text-muted" style="margin-top:6px;">🥬 ${r.ingredients.map(i => `${i.amount || ''} ${i.unit || ''} ${Api.escapeHtml(i.name)}`.trim()).join(' · ')}</div>`
      : '';

    const instrHtml = r.instructions
      ? `<div class="text-xs text-sec" style="margin-top:4px;">${Api.escapeHtml(r.instructions)}</div>`
      : '';

    return `
      <div class="recipe-card" data-id="${Api.escapeHtml(r.id)}">
        <div class="flex items-center justify-between">
          <div style="flex:1;min-width:0;">
            <div class="recipe-name">${Api.escapeHtml(r.name)}</div>
            <div class="recipe-type-badges">${typeHtml}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-ghost btn-sm btn-edit-recipe" data-id="${Api.escapeHtml(r.id)}">✏️</button>
            <button class="btn btn-ghost btn-sm text-critical btn-del-recipe" data-id="${Api.escapeHtml(r.id)}" data-name="${Api.escapeHtml(r.name)}">🗑</button>
          </div>
        </div>
        ${ingHtml}
        ${instrHtml}
      </div>
    `;
  };

  const bindRecipeEvents = (el) => {
    // Agregar receta
    el.querySelector('#btn-add-recipe')?.addEventListener('click', showAddRecipeModal);

    // Filtros por tiempo de comida
    el.querySelectorAll('#meal-filter-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const filter = chip.getAttribute('data-filter');
        el.querySelectorAll('#meal-filter-chips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const filtered = filter === 'all'
          ? cachedRecipes
          : cachedRecipes.filter(r => (r.mealTypes || []).includes(filter));

        const listEl = document.getElementById('recipes-list');
        if (listEl) {
          listEl.innerHTML = filtered.length === 0
            ? '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">Sin recetas para este tipo</div></div>'
            : filtered.map(r => renderRecipeCard(r)).join('');
        }
      });
    });

    // Delegación en la lista de recetas
    el.querySelector('#recipes-list')?.addEventListener('click', (e) => {
      const btnEdit = e.target.closest('.btn-edit-recipe');
      if (btnEdit) {
        const id = btnEdit.getAttribute('data-id');
        if (id) showEditRecipeModal(id);
        return;
      }

      const btnDel = e.target.closest('.btn-del-recipe');
      if (btnDel) {
        const id = btnDel.getAttribute('data-id');
        const name = btnDel.getAttribute('data-name');
        if (id) deleteRecipe(id, name);
        return;
      }
    });
  };

  /**
   * Modal para agregar receta
   */
  const showAddRecipeModal = () => {
    showRecipeFormModal('➕ Nueva Receta', null, async (formData) => {
      const res = await Api.addRecipe(formData);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }
      Ui.toast(`Receta "${formData.name}" creada`, 'success');
      render();
      return true;
    });
  };

  /**
   * Modal para editar receta
   */
  const showEditRecipeModal = (id) => {
    const recipe = cachedRecipes.find(r => r.id === id);
    if (!recipe) return;

    showRecipeFormModal(`✏️ Editar — ${recipe.name}`, recipe, async (formData) => {
      const res = await Api.updateRecipe(id, formData);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }
      Ui.toast('Receta actualizada', 'success');
      render();
      return true;
    });
  };

  /**
   * Formulario común para receta (crear / editar)
   */
  const showRecipeFormModal = (title, existing, onSubmit) => {
    const mealTypes = existing?.mealTypes || ['lunch'];
    const ingredients = existing?.ingredients || [];

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="rf-name">Nombre de la receta *</label>
        <input class="form-input" id="rf-name" value="${Api.escapeHtml(existing?.name || '')}" placeholder="Ej: Pollo a la plancha con puré" required>
      </div>

      <div class="form-group">
        <label class="form-label">Tiempos de comida aplicables</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${MEAL_TYPES.map(m => `
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.85rem;">
              <input type="checkbox" class="rf-meal-type" value="${m.id}" ${mealTypes.includes(m.id) ? 'checked' : ''}>
              ${m.icon} ${Api.escapeHtml(m.label)}
            </label>
          `).join('')}
        </div>
      </div>

      <div class="card-title" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">
        <span>🥬 INGREDIENTES</span>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-add-ing-row" style="font-size:0.75rem;">+ Ingrediente</button>
      </div>

      <div id="rf-ing-container" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;max-height:160px;overflow-y:auto;">
        ${ingredients.length === 0 ? `
          <div class="ing-row" style="display:flex;gap:4px;">
            <input class="form-input ing-name" placeholder="Ingrediente (ej: Tomate)" style="flex:2;">
            <input class="form-input ing-amt" placeholder="Cant." style="flex:1;">
            <input class="form-input ing-unit" placeholder="Unid." style="flex:1;">
            <button type="button" class="btn btn-ghost btn-sm text-critical btn-rm-ing">✕</button>
          </div>
        ` : ingredients.map(ing => `
          <div class="ing-row" style="display:flex;gap:4px;">
            <input class="form-input ing-name" value="${Api.escapeHtml(ing.name || '')}" placeholder="Ingrediente" style="flex:2;">
            <input class="form-input ing-amt" value="${Api.escapeHtml(ing.amount || '')}" placeholder="Cant." style="flex:1;">
            <input class="form-input ing-unit" value="${Api.escapeHtml(ing.unit || '')}" placeholder="Unid." style="flex:1;">
            <button type="button" class="btn btn-ghost btn-sm text-critical btn-rm-ing">✕</button>
          </div>
        `).join('')}
      </div>

      <div class="form-group">
        <label class="form-label" for="rf-instructions">Instrucciones de preparación</label>
        <textarea class="form-textarea" id="rf-instructions" style="min-height:50px;" placeholder="Paso a paso breve...">${Api.escapeHtml(existing?.instructions || '')}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label" for="rf-notes">Notas / Advertencias dietéticas</label>
        <input class="form-input" id="rf-notes" value="${Api.escapeHtml(existing?.notes || '')}" placeholder="Bajo en sal, sin azúcar...">
      </div>
    `;

    Ui.showModal(title, contentHtml, async () => {
      const name = document.getElementById('rf-name')?.value?.trim();
      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      const selectedTypes = [];
      document.querySelectorAll('.rf-meal-type:checked').forEach(chk => {
        selectedTypes.push(chk.value);
      });

      const ingRows = document.querySelectorAll('#rf-ing-container .ing-row');
      const ingList = [];
      ingRows.forEach(row => {
        const iName = row.querySelector('.ing-name')?.value?.trim();
        const iAmt = row.querySelector('.ing-amt')?.value?.trim() || '';
        const iUnit = row.querySelector('.ing-unit')?.value?.trim() || '';
        if (iName) {
          ingList.push({ name: iName, amount: iAmt, unit: iUnit });
        }
      });

      const instructions = document.getElementById('rf-instructions')?.value?.trim() || '';
      const notes = document.getElementById('rf-notes')?.value?.trim() || '';

      return await onSubmit({
        name,
        mealTypes: selectedTypes.length > 0 ? selectedTypes : ['lunch'],
        ingredients: ingList,
        instructions,
        notes
      });
    });

    // Añadir fila de ingrediente
    document.getElementById('btn-add-ing-row')?.addEventListener('click', () => {
      const container = document.getElementById('rf-ing-container');
      if (!container) return;
      const row = document.createElement('div');
      row.className = 'ing-row';
      row.style.display = 'flex';
      row.style.gap = '4px';
      row.innerHTML = `
        <input class="form-input ing-name" placeholder="Ingrediente" style="flex:2;">
        <input class="form-input ing-amt" placeholder="Cant." style="flex:1;">
        <input class="form-input ing-unit" placeholder="Unid." style="flex:1;">
        <button type="button" class="btn btn-ghost btn-sm text-critical btn-rm-ing">✕</button>
      `;
      container.appendChild(row);
    });

    // Eliminar fila de ingrediente
    document.getElementById('rf-ing-container')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-rm-ing');
      if (btn) {
        btn.closest('.ing-row')?.remove();
      }
    });
  };

  /**
   * Eliminar receta
   */
  const deleteRecipe = (id, name) => {
    Ui.confirm(`¿Eliminar la receta "${name}"?`, 'Se removerá del catálogo y de las asignaciones del planificador.', async () => {
      const res = await Api.deleteRecipe(id);
      if (res.error) {
        Ui.toast(res.error, 'error');
      } else {
        Ui.toast(`Receta "${name}" eliminada`, 'info');
        render();
      }
    });
  };

  // ══════════════════════════════════════════════════════════
  //  2. PLANIFICADOR SEMANAL (RF-74)
  // ══════════════════════════════════════════════════════════
  const renderPlanner = async (el) => {
    const [planRes, recipesRes] = await Promise.all([
      Api.getWeeklyPlan(),
      Api.getRecipes()
    ]);

    cachedPlan = normalizePlan(planRes.data || planRes);
    cachedRecipes = recipesRes.data || [];

    const recipeMap = new Map(cachedRecipes.map(r => [r.id, r]));

    // Calcular días de la semana actual
    const today = new Date();
    const sow = new Date(today);
    sow.setDate(today.getDate() - today.getDay());

    let daysHdr = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(sow);
      d.setDate(d.getDate() + i);
      const isToday = d.toISOString().split('T')[0] === Api.todayStr();
      daysHdr += `
        <th style="${isToday ? 'color:var(--accent);font-weight:700;' : ''}">
          ${DAYS[d.getDay()]}<br><span style="font-size:0.6rem;font-weight:400;">${d.getDate()}</span>
        </th>
      `;
    }

    let rows = '';
    MEAL_TYPES.forEach(mt => {
      let cells = '';
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const slot = cachedPlan.find(s => (Number(s.dayOfWeek) === dayIndex || Number(s.dayIndex) === dayIndex) && s.mealType === mt.id);
        const slotRecipeIds = slot?.recipeIds || [];
        const slotRecipes = slotRecipeIds.map(id => recipeMap.get(id)).filter(Boolean);

        cells += `
          <td style="vertical-align:top;padding:4px;border:1px solid var(--border-subtle);min-width:85px;max-width:110px;">
            <div style="min-height:48px;display:flex;flex-direction:column;justify-content:space-between;">
              <div style="display:flex;flex-direction:column;gap:2px;">
                ${slotRecipes.map(r => `
                  <div style="font-size:0.65rem;background:var(--primary-subtle);color:var(--primary);padding:2px 4px;border-radius:3px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Api.escapeHtml(r.name)}">${Api.escapeHtml(r.name)}</span>
                    <span class="btn-rm-slot-recipe" data-day="${dayIndex}" data-meal="${mt.id}" data-recipe-id="${Api.escapeHtml(r.id)}" style="cursor:pointer;margin-left:2px;" title="Quitar">×</span>
                  </div>
                `).join('')}
              </div>
              <button class="btn btn-ghost btn-xs btn-add-slot-recipe" data-day="${dayIndex}" data-meal="${mt.id}" style="width:100%;font-size:0.65rem;padding:2px;margin-top:2px;">
                + receta
              </button>
            </div>
          </td>
        `;
      }

      rows += `
        <tr>
          <td style="font-weight:700;font-size:0.75rem;padding:4px;white-space:nowrap;border:1px solid var(--border-subtle);">
            ${mt.icon} ${mt.label}
          </td>
          ${cells}
        </tr>
      `;
    });

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">🍽️ Alimentación</div>
        <button class="btn btn-primary btn-sm" id="btn-goto-shopping">🛒 Generar Compras</button>
      </div>
      ${tabsHtml()}

      <div class="card-title">📅 PLANIFICADOR SEMANAL (7 DÍAS × 3 COMIDAS)</div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:16px;">
        <table style="width:100%;border-collapse:collapse;text-align:center;font-size:0.75rem;">
          <thead>
            <tr style="background:var(--bg-glass);">
              <th style="padding:6px;border:1px solid var(--border-subtle);">Comida</th>
              ${daysHdr}
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;

    bindNavTabs(el);
    bindPlannerEvents(el);
  };

  const bindPlannerEvents = (el) => {
    // Ir a compras
    el.querySelector('#btn-goto-shopping')?.addEventListener('click', () => {
      activeTab = 'shopping';
      render();
    });

    // Agregar receta a celda
    el.querySelectorAll('.btn-add-slot-recipe').forEach(btn => {
      btn.addEventListener('click', () => {
        const day = parseInt(btn.getAttribute('data-day'), 10);
        const meal = btn.getAttribute('data-meal');
        showSelectRecipeModal(day, meal);
      });
    });

    // Quitar receta de celda
    el.querySelectorAll('.btn-rm-slot-recipe').forEach(span => {
      span.addEventListener('click', async () => {
        const day = parseInt(span.getAttribute('data-day'), 10);
        const meal = span.getAttribute('data-meal');
        const recipeId = span.getAttribute('data-recipe-id');

        const slot = cachedPlan.find(s => (Number(s.dayOfWeek) === day || Number(s.dayIndex) === day) && s.mealType === meal);
        if (!slot) return;

        const newIds = (slot.recipeIds || []).filter(id => id !== recipeId);
        const res = await Api.setWeeklySlot(day, meal, newIds);
        if (res.error) {
          Ui.toast(res.error, 'error');
        } else {
          render();
        }
      });
    });
  };

  /**
   * Modal para seleccionar receta y asignarla a una celda del planificador
   */
  const showSelectRecipeModal = (dayOfWeek, mealType) => {
    const mealLabel = MEAL_TYPES.find(m => m.id === mealType)?.label || mealType;
    const dayLabel = FULL_DAYS[dayOfWeek];

    const suitable = cachedRecipes.filter(r => (r.mealTypes || []).includes(mealType));
    const others = cachedRecipes.filter(r => !(r.mealTypes || []).includes(mealType));
    const allRecipes = suitable.concat(others);

    const contentHtml = `
      <p class="text-sm text-sec" style="margin-bottom:12px;">
        Asignar a <strong>${dayLabel} — ${mealLabel}</strong>:
      </p>

      <div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
        ${allRecipes.length === 0 ? `
          <div class="text-xs text-muted">No hay recetas creadas aún. Crea una en el Recetario.</div>
        ` : allRecipes.map(r => `
          <div class="exp-item sel-recipe-item" data-id="${Api.escapeHtml(r.id)}" style="padding:8px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);cursor:pointer;">
            <div>
              <div class="font-bold text-sm">${Api.escapeHtml(r.name)}</div>
              <div class="text-xs text-muted">
                ${(r.mealTypes || []).map(mt => MEAL_TYPES.find(m => m.id === mt)?.icon || '').join(' ')}
                ${r.ingredients ? `· ${r.ingredients.length} ing.` : ''}
              </div>
            </div>
            <button class="btn btn-secondary btn-sm">Seleccionar</button>
          </div>
        `).join('')}
      </div>
    `;

    Ui.showModal(`🍽️ Asignar Receta`, contentHtml, null, false);

    document.querySelectorAll('.sel-recipe-item').forEach(item => {
      item.addEventListener('click', async () => {
        const recipeId = item.getAttribute('data-id');
        const numDay = Number(dayOfWeek);
        const slot = cachedPlan.find(s => (Number(s.dayOfWeek) === numDay || Number(s.dayIndex) === numDay) && s.mealType === mealType);
        const currentIds = slot?.recipeIds ? [...slot.recipeIds] : [];

        if (!currentIds.includes(recipeId)) {
          currentIds.push(recipeId);
        }

        const res = await Api.setWeeklySlot(numDay, mealType, currentIds);
        if (res.error) {
          Ui.toast(res.error, 'error');
        } else {
          Ui.toast('Receta asignada al plan', 'success');
          Ui.closeModal();
          render();
        }
      });
    });
  };

  // ══════════════════════════════════════════════════════════
  //  3. COMPLEMENTOS (RF-75)
  // ══════════════════════════════════════════════════════════
  const renderComplementos = async (el) => {
    const res = await Api.getComplementos();
    cachedComplementos = res.data || [];

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">🍽️ Alimentación</div>
        <button class="btn btn-primary btn-sm" id="btn-add-comp">+ Complemento</button>
      </div>
      ${tabsHtml()}

      <div class="card-title">🥤 COMPLEMENTOS (BEBIDAS, CONTORNOS, SNACKS)</div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${COMPLEMENT_CATS.map(cat => {
          const items = cachedComplementos.filter(c => c.category === cat.id);
          return `
            <div class="card" style="padding:10px;">
              <div style="font-weight:700;font-size:0.85rem;margin-bottom:8px;">
                ${cat.icon} ${Api.escapeHtml(cat.label)} (${items.length})
              </div>
              ${items.length === 0 ? `
                <div class="text-xs text-muted">Sin elementos en esta categoría</div>
              ` : `
                <div style="display:flex;flex-direction:column;gap:6px;">
                  ${items.map(item => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px;border-bottom:1px solid var(--border-subtle);">
                      <div>
                        <div class="font-bold text-sm">${Api.escapeHtml(item.name)}</div>
                        ${item.ingredients && item.ingredients.length > 0 ? `
                          <div class="text-xs text-muted">🥬 Ingredientes: ${item.ingredients.map(i => Api.escapeHtml(i.name)).join(', ')}</div>
                        ` : ''}
                        ${item.notes ? `<div class="text-xs text-sec">${Api.escapeHtml(item.notes)}</div>` : ''}
                      </div>
                      <div style="display:flex;gap:4px;">
                        <button class="btn btn-ghost btn-sm btn-edit-comp" data-id="${Api.escapeHtml(item.id)}">✏️</button>
                        <button class="btn btn-ghost btn-sm text-critical btn-del-comp" data-id="${Api.escapeHtml(item.id)}" data-name="${Api.escapeHtml(item.name)}">🗑</button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          `;
        }).join('')}
      </div>
    `;

    bindNavTabs(el);
    bindComplementosEvents(el);
  };

  const bindComplementosEvents = (el) => {
    el.querySelector('#btn-add-comp')?.addEventListener('click', showAddComplementoModal);

    el.addEventListener('click', (e) => {
      const btnEdit = e.target.closest('.btn-edit-comp');
      if (btnEdit) {
        const id = btnEdit.getAttribute('data-id');
        if (id) showEditComplementoModal(id);
        return;
      }

      const btnDel = e.target.closest('.btn-del-comp');
      if (btnDel) {
        const id = btnDel.getAttribute('data-id');
        const name = btnDel.getAttribute('data-name');
        if (id) deleteComplemento(id, name);
        return;
      }
    });
  };

  /**
   * Modal para agregar complemento
   */
  const showAddComplementoModal = () => {
    showComplementoFormModal('➕ Nuevo Complemento', null, async (data) => {
      const res = await Api.addComplemento(data);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }
      Ui.toast(`Complemento "${data.name}" agregado`, 'success');
      render();
      return true;
    });
  };

  /**
   * Modal para editar complemento
   */
  const showEditComplementoModal = (id) => {
    const item = cachedComplementos.find(c => c.id === id);
    if (!item) return;

    showComplementoFormModal(`✏️ Editar — ${item.name}`, item, async (data) => {
      const res = await Api.updateComplemento(id, data);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }
      Ui.toast('Complemento actualizado', 'success');
      render();
      return true;
    });
  };

  const showComplementoFormModal = (title, existing, onSubmit) => {
    const ingredients = existing?.ingredients || [];

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="cf-name">Nombre *</label>
        <input class="form-input" id="cf-name" value="${Api.escapeHtml(existing?.name || '')}" placeholder="Ej: Jugo de naranja natural" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="cf-cat">Categoría</label>
        <select class="form-select" id="cf-cat">
          ${COMPLEMENT_CATS.map(c => `
            <option value="${c.id}" ${existing?.category === c.id ? 'selected' : ''}>${c.icon} ${Api.escapeHtml(c.label)}</option>
          `).join('')}
        </select>
      </div>

      <div class="card-title" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">
        <span>🥬 INGREDIENTES (SI ES CASERO)</span>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-add-comp-ing">+ Ingrediente</button>
      </div>
      <div id="cf-ing-container" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;max-height:140px;overflow-y:auto;">
        ${ingredients.map(ing => `
          <div class="ing-row" style="display:flex;gap:4px;">
            <input class="form-input ing-name" value="${Api.escapeHtml(ing.name || '')}" placeholder="Ingrediente" style="flex:2;">
            <input class="form-input ing-amt" value="${Api.escapeHtml(ing.amount || '')}" placeholder="Cant." style="flex:1;">
            <input class="form-input ing-unit" value="${Api.escapeHtml(ing.unit || '')}" placeholder="Unid." style="flex:1;">
            <button type="button" class="btn btn-ghost btn-sm text-critical btn-rm-ing">✕</button>
          </div>
        `).join('')}
      </div>

      <div class="form-group">
        <label class="form-label" for="cf-notes">Notas</label>
        <input class="form-input" id="cf-notes" value="${Api.escapeHtml(existing?.notes || '')}" placeholder="Marca preferida, sin azúcar...">
      </div>
    `;

    Ui.showModal(title, contentHtml, async () => {
      const name = document.getElementById('cf-name')?.value?.trim();
      const category = document.getElementById('cf-cat')?.value || 'otros';
      const notes = document.getElementById('cf-notes')?.value?.trim() || '';

      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      const ingRows = document.querySelectorAll('#cf-ing-container .ing-row');
      const ingList = [];
      ingRows.forEach(row => {
        const iName = row.querySelector('.ing-name')?.value?.trim();
        const iAmt = row.querySelector('.ing-amt')?.value?.trim() || '';
        const iUnit = row.querySelector('.ing-unit')?.value?.trim() || '';
        if (iName) ingList.push({ name: iName, amount: iAmt, unit: iUnit });
      });

      return await onSubmit({ name, category, notes, ingredients: ingList });
    });

    document.getElementById('btn-add-comp-ing')?.addEventListener('click', () => {
      const container = document.getElementById('cf-ing-container');
      if (!container) return;
      const row = document.createElement('div');
      row.className = 'ing-row';
      row.style.display = 'flex';
      row.style.gap = '4px';
      row.innerHTML = `
        <input class="form-input ing-name" placeholder="Ingrediente" style="flex:2;">
        <input class="form-input ing-amt" placeholder="Cant." style="flex:1;">
        <input class="form-input ing-unit" placeholder="Unid." style="flex:1;">
        <button type="button" class="btn btn-ghost btn-sm text-critical btn-rm-ing">✕</button>
      `;
      container.appendChild(row);
    });

    document.getElementById('cf-ing-container')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-rm-ing');
      if (btn) btn.closest('.ing-row')?.remove();
    });
  };

  const deleteComplemento = (id, name) => {
    Ui.confirm(`¿Eliminar "${name}"?`, 'Se borrará de los complementos.', async () => {
      const res = await Api.deleteComplemento(id);
      if (res.error) {
        Ui.toast(res.error, 'error');
      } else {
        Ui.toast(`"${name}" eliminado`, 'info');
        render();
      }
    });
  };

  // ══════════════════════════════════════════════════════════
  //  4. LISTA DE COMPRAS CONSOLIDADA (RF-76 .. RF-83)
  // ══════════════════════════════════════════════════════════
  const renderShopping = async (el) => {
    const res = await Api.getShoppingItems();
    cachedShopping = res.data || [];

    const unchecked = cachedShopping.filter(i => !i.checked);
    const checked = cachedShopping.filter(i => i.checked);

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">🍽️ Alimentación</div>
      </div>
      ${tabsHtml()}

      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>🛒 LISTA DE COMPRAS CONSOLIDADA</span>
        <span class="badge ${unchecked.length > 0 ? 'badge-alert' : 'badge-active'}">
          ${unchecked.length} pendiente${unchecked.length !== 1 ? 's' : ''}
        </span>
      </div>

      <!-- Acciones de generación -->
      <div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;padding-bottom:4px;">
        <button class="btn btn-primary btn-sm" id="btn-add-shop-item">+ Ítem manual</button>
        <button class="btn btn-secondary btn-sm" id="btn-gen-from-plan">📅 Desde Planificador</button>
        <button class="btn btn-secondary btn-sm" id="btn-gen-from-comps">🥤 Desde Complementos</button>
      </div>

      <!-- Canales de exportación (RF-80, RF-81, RF-82) -->
      ${cachedShopping.length > 0 ? `
        <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
          <button class="btn btn-whatsapp btn-sm" id="btn-export-wa">📲 WhatsApp (${unchecked.length})</button>
          <button class="btn btn-secondary btn-sm" id="btn-export-tg" style="border-color:#2AABEE;color:#2AABEE;">✈️ Telegram</button>
          <button class="btn btn-secondary btn-sm" id="btn-export-tasks">📋 Enviar a Tareas</button>
        </div>
      ` : ''}

      ${cachedShopping.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">🛒</div>
          <div class="empty-text">Lista de compras vacía.<br>Genera productos desde el Planificador o agrega ítems manualmente.</div>
        </div>
      ` : `
        <!-- Pendientes -->
        <div class="card" style="overflow:hidden;margin-bottom:12px;">
          <div style="padding:10px 14px;background:rgba(255,255,255,0.03);border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.8rem;font-weight:700;">POR COMPRAR (${unchecked.length})</span>
            <span class="text-xs text-muted">Toca para marcar comprado</span>
          </div>
          ${unchecked.length === 0 ? `
            <div class="text-sm text-muted" style="padding:16px;text-align:center;">🎉 ¡Todos los productos han sido marcados como comprados!</div>
          ` : unchecked.map(i => renderShopItem(i)).join('')}
        </div>

        <!-- Comprados / En carrito -->
        ${checked.length > 0 ? `
          <div class="card" style="overflow:hidden;margin-bottom:14px;border-color:rgba(38,166,106,0.3);">
            <div style="padding:10px 14px;background:rgba(38,166,106,0.08);border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.8rem;font-weight:700;color:var(--stable);">✅ COMPRADOS (${checked.length})</span>
              <button class="btn btn-ghost btn-xs text-critical" id="btn-archive-checked">🧹 Archivar comprados</button>
            </div>
            <div style="opacity:0.85;">${checked.map(i => renderShopItem(i)).join('')}</div>
          </div>
        ` : ''}

        <div style="display:flex;gap:8px;margin-top:16px;flex-direction:column;">
          ${checked.length > 0 && unchecked.length === 0 ? `
            <button class="btn btn-primary btn-full" id="btn-complete-all" style="background:var(--stable);border-color:var(--stable);">
              🎉 Confirmar compra realizada completamente
            </button>
          ` : ''}

          <button class="btn btn-ghost btn-sm btn-full text-critical" id="btn-clear-all-shop">
            🗑 Vaciar toda la lista
          </button>
        </div>
      `}
    `;

    bindNavTabs(el);
    bindShoppingEvents(el);
  };

  const renderShopItem = (item) => {
    const amt = [item.amount, item.unit].filter(Boolean).join(' ');
    const sourceTag = item.source === 'complemento' ? '<span class="text-xs" style="color:var(--accent);">🥤</span> ' : '';

    return `
      <div class="shop-item ${item.checked ? 'checked' : ''}" data-id="${Api.escapeHtml(item.id)}">
        <div class="shop-check ${item.checked ? 'checked' : ''}" data-action="toggle">
          ${item.checked ? '✓' : ''}
        </div>
        <div class="shop-name ${item.checked ? 'checked' : ''}" data-action="toggle">
          ${sourceTag}${Api.escapeHtml(item.name)}
        </div>
        ${amt ? `<div class="shop-amount">${Api.escapeHtml(amt)}</div>` : ''}
        <div style="display:flex;gap:2px;align-items:center;">
          <button class="btn btn-ghost btn-sm btn-edit-shop" data-id="${Api.escapeHtml(item.id)}">✏️</button>
          <button class="btn btn-ghost btn-sm text-critical btn-del-shop" data-id="${Api.escapeHtml(item.id)}">✕</button>
        </div>
      </div>
    `;
  };

  const bindShoppingEvents = (el) => {
    // Agregar ítem manual
    el.querySelector('#btn-add-shop-item')?.addEventListener('click', showAddShoppingItemModal);

    // Generar desde planificador
    el.querySelector('#btn-gen-from-plan')?.addEventListener('click', generateFromPlan);

    // Generar desde complementos
    el.querySelector('#btn-gen-from-comps')?.addEventListener('click', showComplementosPicker);

    // Canales de exportación
    el.querySelector('#btn-export-wa')?.addEventListener('click', sendShoppingWhatsApp);
    el.querySelector('#btn-export-tg')?.addEventListener('click', sendShoppingTelegram);
    el.querySelector('#btn-export-tasks')?.addEventListener('click', sendShoppingToTasks);

    // Archivar comprados (RF-79)
    el.querySelector('#btn-archive-checked')?.addEventListener('click', async () => {
      await Api.archiveCompletedShopping();
      Ui.toast('Productos comprados archivados', 'info');
      render();
    });

    el.querySelector('#btn-complete-all')?.addEventListener('click', async () => {
      await Api.archiveCompletedShopping();
      Ui.toast('¡Compra completa registrada!', 'success');
      render();
    });

    // Vaciar lista
    el.querySelector('#btn-clear-all-shop')?.addEventListener('click', () => {
      Ui.confirm('¿Vaciar toda la lista de compras?', 'Se eliminarán todos los productos de la lista.', async () => {
        await Api.clearShoppingList();
        Ui.toast('Lista vaciada', 'info');
        render();
      });
    });

    // Delegación en la lista de compras
    el.addEventListener('click', async (e) => {
      const shopItem = e.target.closest('.shop-item');
      if (!shopItem) return;
      const id = shopItem.getAttribute('data-id');
      if (!id) return;

      // Toggle checkbox
      if (e.target.closest('[data-action="toggle"]')) {
        const item = cachedShopping.find(i => i.id === id);
        if (item) {
          await Api.updateShoppingItem(id, { checked: !item.checked });
          render();
        }
        return;
      }

      // Editar
      if (e.target.closest('.btn-edit-shop')) {
        showEditShoppingItemModal(id);
        return;
      }

      // Eliminar
      if (e.target.closest('.btn-del-shop')) {
        await Api.deleteShoppingItem(id);
        render();
        return;
      }
    });
  };

  /**
   * Consolidación por fecha desde el planificador semanal (RF-76, RF-77)
   */
  const generateFromPlan = async () => {
    const [planRes, recipesRes] = await Promise.all([
      Api.getWeeklyPlan(),
      Api.getRecipes()
    ]);

    const plan = normalizePlan(planRes.data || planRes);
    const recipes = recipesRes.data || [];

    const recipeMap = new Map(recipes.map(r => [r.id, r]));
    const daysWithIngredients = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const daySlots = plan.filter(s => Number(s.dayOfWeek) === dayIndex || Number(s.dayIndex) === dayIndex);
      const ingMap = new Map();

      daySlots.forEach(slot => {
        (slot.recipeIds || []).forEach(rId => {
          const r = recipeMap.get(rId);
          if (!r || !r.ingredients) return;
          r.ingredients.forEach(ing => {
            const key = (ing.name || '').trim().toLowerCase();
            if (!key) return;
            if (!ingMap.has(key)) {
              ingMap.set(key, {
                id: `plan_ing_${dayIndex}_${encodeURIComponent(key)}`,
                name: (ing.name || '').trim(),
                amount: ing.amount || '',
                unit: ing.unit || ''
              });
            } else {
              const existing = ingMap.get(key);
              const n1 = parseFloat(existing.amount);
              const n2 = parseFloat(ing.amount);
              if (!isNaN(n1) && !isNaN(n2) && existing.unit === ing.unit) {
                existing.amount = String(n1 + n2);
              } else if (ing.amount && existing.amount !== ing.amount) {
                existing.amount = `${existing.amount} + ${ing.amount}`;
              }
            }
          });
        });
      });

      if (ingMap.size > 0) {
        daysWithIngredients.push({
          dayIndex,
          dayLabel: FULL_DAYS[dayIndex],
          ingredients: Array.from(ingMap.values())
        });
      }
    }

    if (daysWithIngredients.length === 0) {
      Ui.toast('El planificador no tiene recetas asignadas aún', 'warning');
      return;
    }

    showIngredientPicker(daysWithIngredients);
  };

  /**
   * Selector de ingredientes consolidados por día (RF-77)
   */
  const showIngredientPicker = (days) => {
    const pickerSel = {};
    days.forEach(d => d.ingredients.forEach(ing => { pickerSel[ing.id] = true; }));

    let daysHtml = '';
    days.forEach(day => {
      const ingItems = day.ingredients.map(ing => {
        const amt = [ing.amount, ing.unit].filter(Boolean).join(' ');
        return `
          <div class="picker-item selected" id="pi-${ing.id}" data-id="${ing.id}" style="display:flex;align-items:center;justify-content:space-between;padding:6px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:4px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="picker-check" style="font-weight:700;color:var(--primary);">✓</span>
              <span>${Api.escapeHtml(ing.name)}</span>
            </div>
            ${amt ? `<span class="text-xs text-muted">${Api.escapeHtml(amt)}</span>` : ''}
          </div>
        `;
      }).join('');

      daysHtml += `
        <div class="picker-day-block" style="margin-bottom:12px;">
          <div class="font-bold text-sm" style="margin-bottom:6px;">📅 ${day.dayLabel} (${day.ingredients.length} ingredientes)</div>
          <div class="picker-ingredients">${ingItems}</div>
        </div>
      `;
    });

    const totalCount = days.reduce((acc, d) => acc + d.ingredients.length, 0);

    const contentHtml = `
      <p class="text-sm text-sec" style="margin-bottom:8px;">
        Selecciona los ingredientes que deseas incluir en la lista de compras:
      </p>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
        <button class="btn btn-ghost btn-sm" id="picker-all-btn">✅ Todos</button>
        <button class="btn btn-ghost btn-sm" id="picker-none-btn">❌ Ninguno</button>
      </div>
      <div id="picker-groups" style="max-height:260px;overflow-y:auto;padding-right:4px;">
        ${daysHtml}
      </div>
      <div style="text-align:right;margin-top:12px;">
        <span class="text-xs text-muted" id="picker-sel-count">${totalCount} seleccionados</span>
      </div>
    `;

    Ui.showModal('🛒 Ingredientes del Plan', contentHtml, async () => {
      const itemsToAdd = [];
      days.forEach(day => {
        day.ingredients.forEach(ing => {
          if (pickerSel[ing.id]) {
            itemsToAdd.push({
              name: ing.name,
              amount: ing.amount,
              unit: ing.unit,
              category: 'Planificador',
              source: 'plan'
            });
          }
        });
      });

      if (itemsToAdd.length === 0) {
        Ui.toast('No seleccionaste ningún ingrediente', 'warning');
        return false;
      }

      const res = await Api.addShoppingItemsBatch(itemsToAdd);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(`${itemsToAdd.length} ingredientes añadidos a Compras`, 'success');
      activeTab = 'shopping';
      render();
      return true;
    });

    // Delegación dentro del picker
    document.getElementById('picker-groups')?.addEventListener('click', (e) => {
      const itemEl = e.target.closest('.picker-item');
      if (!itemEl) return;
      const id = itemEl.getAttribute('data-id');
      if (!id) return;

      pickerSel[id] = !pickerSel[id];
      itemEl.classList.toggle('selected', pickerSel[id]);
      const checkEl = itemEl.querySelector('.picker-check');
      if (checkEl) checkEl.textContent = pickerSel[id] ? '✓' : '';

      const count = Object.values(pickerSel).filter(Boolean).length;
      const countEl = document.getElementById('picker-sel-count');
      if (countEl) countEl.textContent = `${count} seleccionados`;
    });

    document.getElementById('picker-all-btn')?.addEventListener('click', () => {
      days.forEach(d => d.ingredients.forEach(ing => {
        pickerSel[ing.id] = true;
        const el = document.getElementById(`pi-${ing.id}`);
        if (el) {
          el.classList.add('selected');
          const checkEl = el.querySelector('.picker-check');
          if (checkEl) checkEl.textContent = '✓';
        }
      }));
      const countEl = document.getElementById('picker-sel-count');
      if (countEl) countEl.textContent = `${totalCount} seleccionados`;
    });

    document.getElementById('picker-none-btn')?.addEventListener('click', () => {
      days.forEach(d => d.ingredients.forEach(ing => {
        pickerSel[ing.id] = false;
        const el = document.getElementById(`pi-${ing.id}`);
        if (el) {
          el.classList.remove('selected');
          const checkEl = el.querySelector('.picker-check');
          if (checkEl) checkEl.textContent = '';
        }
      }));
      const countEl = document.getElementById('picker-sel-count');
      if (countEl) countEl.textContent = `0 seleccionados`;
    });
  };

  /**
   * Selector jerárquico de complementos (RF-75)
   */
  const showComplementosPicker = async () => {
    const res = await Api.getComplementos();
    const items = res.data || [];

    if (items.length === 0) {
      Ui.toast('No hay complementos registrados aún', 'warning');
      return;
    }

    const compSel = {};
    items.forEach(item => {
      if (item.ingredients && item.ingredients.length > 0) {
        item.ingredients.forEach((_, idx) => { compSel[`comp_ing_${item.id}_${idx}`] = true; });
      } else {
        compSel[`comp_item_${item.id}`] = true;
      }
    });

    let groupsHtml = '';
    COMPLEMENT_CATS.forEach(cat => {
      const catItems = items.filter(i => i.category === cat.id);
      if (catItems.length === 0) return;

      groupsHtml += `
        <div class="picker-day-block" style="margin-bottom:12px;">
          <div class="font-bold text-sm" style="margin-bottom:6px;">${cat.icon} ${Api.escapeHtml(cat.label)}</div>
          ${catItems.map(item => {
            const hasIngs = item.ingredients && item.ingredients.length > 0;
            if (hasIngs) {
              return `
                <div style="margin-bottom:6px;padding:6px;background:var(--bg-glass);border-radius:var(--radius-sm);">
                  <div class="font-bold text-xs" style="margin-bottom:4px;">🥣 ${Api.escapeHtml(item.name)} (Casero)</div>
                  ${item.ingredients.map((ing, idx) => {
                    const key = `comp_ing_${item.id}_${idx}`;
                    return `
                      <div class="picker-item selected" id="cpi-${key}" data-key="${key}" style="display:flex;align-items:center;justify-content:space-between;padding:4px;cursor:pointer;">
                        <span><span class="picker-check" style="font-weight:700;color:var(--primary);">✓</span> ${Api.escapeHtml(ing.name)}</span>
                        <span class="text-xs text-muted">${[ing.amount, ing.unit].filter(Boolean).join(' ')}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              `;
            } else {
              const key = `comp_item_${item.id}`;
              return `
                <div class="picker-item selected" id="cpi-${key}" data-key="${key}" style="display:flex;align-items:center;justify-content:space-between;padding:6px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:4px;">
                  <span><span class="picker-check" style="font-weight:700;color:var(--primary);">✓</span> ${Api.escapeHtml(item.name)}</span>
                </div>
              `;
            }
          }).join('')}
        </div>
      `;
    });

    const contentHtml = `
      <p class="text-sm text-sec" style="margin-bottom:10px;">
        Selecciona los complementos que deseas agregar a la lista de compras:
      </p>
      <div id="comp-picker-groups" style="max-height:260px;overflow-y:auto;">
        ${groupsHtml}
      </div>
    `;

    Ui.showModal('🥤 Desde Complementos', contentHtml, async () => {
      const itemsToAdd = [];
      items.forEach(item => {
        if (item.ingredients && item.ingredients.length > 0) {
          item.ingredients.forEach((ing, idx) => {
            if (compSel[`comp_ing_${item.id}_${idx}`]) {
              itemsToAdd.push({
                name: ing.name,
                amount: ing.amount,
                unit: ing.unit,
                category: 'Complementos',
                source: 'complemento'
              });
            }
          });
        } else {
          if (compSel[`comp_item_${item.id}`]) {
            itemsToAdd.push({
              name: item.name,
              amount: '',
              unit: '',
              category: 'Complementos',
              source: 'complemento'
            });
          }
        }
      });

      if (itemsToAdd.length === 0) {
        Ui.toast('No seleccionaste ningún complemento', 'warning');
        return false;
      }

      const res = await Api.addShoppingItemsBatch(itemsToAdd);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(`${itemsToAdd.length} ítems agregados a Compras`, 'success');
      activeTab = 'shopping';
      render();
      return true;
    });

    document.getElementById('comp-picker-groups')?.addEventListener('click', (e) => {
      const itemEl = e.target.closest('.picker-item');
      if (!itemEl) return;
      const key = itemEl.getAttribute('data-key');
      if (!key) return;

      compSel[key] = !compSel[key];
      itemEl.classList.toggle('selected', compSel[key]);
      const checkEl = itemEl.querySelector('.picker-check');
      if (checkEl) checkEl.textContent = compSel[key] ? '✓' : '';
    });
  };

  /**
   * Modal para agregar ítem manual de compra (RF-83)
   */
  const showAddShoppingItemModal = () => {
    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="nsi-name">Producto *</label>
        <input class="form-input" id="nsi-name" placeholder="Ej: Leche deslactosada" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="nsi-amt">Cantidad</label>
          <input class="form-input" id="nsi-amt" placeholder="2">
        </div>
        <div class="form-group">
          <label class="form-label" for="nsi-unit">Unidad</label>
          <input class="form-input" id="nsi-unit" placeholder="litros, kg, latas...">
        </div>
      </div>
    `;

    Ui.showModal('➕ Agregar a Compras', contentHtml, async () => {
      const name = document.getElementById('nsi-name')?.value?.trim();
      const amount = document.getElementById('nsi-amt')?.value?.trim() || '';
      const unit = document.getElementById('nsi-unit')?.value?.trim() || '';

      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      const res = await Api.addShoppingItem({
        name,
        amount,
        unit,
        category: 'Manual'
      });

      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Producto agregado a la lista', 'success');
      render();
      return true;
    });
  };

  /**
   * Modal para editar ítem de compra
   */
  const showEditShoppingItemModal = (id) => {
    const item = cachedShopping.find(i => i.id === id);
    if (!item) return;

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="esi-name">Producto *</label>
        <input class="form-input" id="esi-name" value="${Api.escapeHtml(item.name)}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="esi-amt">Cantidad</label>
          <input class="form-input" id="esi-amt" value="${Api.escapeHtml(item.amount || '')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="esi-unit">Unidad</label>
          <input class="form-input" id="esi-unit" value="${Api.escapeHtml(item.unit || '')}">
        </div>
      </div>
    `;

    Ui.showModal('✏️ Editar Producto', contentHtml, async () => {
      const name = document.getElementById('esi-name')?.value?.trim();
      const amount = document.getElementById('esi-amt')?.value?.trim() || '';
      const unit = document.getElementById('esi-unit')?.value?.trim() || '';

      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      const res = await Api.updateShoppingItem(id, { name, amount, unit });
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Producto actualizado', 'success');
      render();
      return true;
    });
  };

  /**
   * Exportar lista de compras por WhatsApp (RF-80)
   */
  const sendShoppingWhatsApp = async () => {
    const unchecked = cachedShopping.filter(i => !i.checked);
    const checked = cachedShopping.filter(i => i.checked);
    if (cachedShopping.length === 0) {
      Ui.toast('La lista está vacía', 'warning');
      return;
    }

    const settingsRes = await Api.getSettings();
    const settings = settingsRes.data || {};
    const waNum = (settings.emergencyContactWhatsapp || '').replace(/\D/g, '');

    let msg = `🛒 *Lista de Compras — CuidApp*\n`;
    msg += `Paciente: ${settings.patientName || 'Paciente'}\n\n`;

    if (unchecked.length > 0) {
      msg += `*Pendientes por comprar (${unchecked.length}):*\n`;
      unchecked.forEach(i => {
        const amt = [i.amount, i.unit].filter(Boolean).join(' ');
        msg += `◻ ${i.name}${amt ? ` · ${amt}` : ''}\n`;
      });
    }

    if (checked.length > 0) {
      msg += `\n*Ya comprados (${checked.length}):*\n`;
      checked.forEach(i => {
        const amt = [i.amount, i.unit].filter(Boolean).join(' ');
        msg += `✓ ~${i.name}${amt ? ` · ${amt}` : ''}~\n`;
      });
    }

    msg += `\n_Generado desde CuidApp_`;

    const url = waNum
      ? `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;

    window.open(url, '_blank');
    Ui.toast('Lista preparada para WhatsApp', 'success');
  };

  /**
   * Exportar lista de compras por Telegram (RF-81)
   */
  const sendShoppingTelegram = () => {
    const unchecked = cachedShopping.filter(i => !i.checked);
    if (unchecked.length === 0) {
      Ui.toast('No hay compras pendientes para enviar', 'warning');
      return;
    }

    let msg = `🛒 Lista de Compras — CuidApp:\n\n`;
    unchecked.forEach(i => {
      const amt = [i.amount, i.unit].filter(Boolean).join(' ');
      msg += `◻ ${i.name}${amt ? ` (${amt})` : ''}\n`;
    });

    const url = `https://t.me/share/url?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
    Ui.toast('Lista preparada para Telegram', 'success');
  };

  /**
   * Enviar lista de compras como tarea al módulo de tareas (RF-82)
   */
  const sendShoppingToTasks = async () => {
    const unchecked = cachedShopping.filter(i => !i.checked);
    if (unchecked.length === 0) {
      Ui.toast('No hay compras pendientes para convertir en tarea', 'warning');
      return;
    }

    const desc = unchecked.map(i => {
      const amt = [i.amount, i.unit].filter(Boolean).join(' ');
      return `- ${i.name}${amt ? ` (${amt})` : ''}`;
    }).join('\n');

    const res = await Api.addTask({
      title: `Realizar compras de alimentos (${unchecked.length} ítems)`,
      description: desc,
      shift: 'morning',
      taskDate: Api.todayStr(),
      isEmergency: false
    });

    if (res.error) {
      Ui.toast(res.error, 'error');
    } else {
      Ui.toast('Tarea de compras creada en Tareas', 'success');
      DashboardModule?.render();
    }
  };

  const init = () => {
    render();
  };

  return {
    init,
    render,
    setTab: (t) => { activeTab = t; },
    showToday: () => { activeTab = 'today'; render(); },
    showAddRecipeModal,
    showAddShoppingItemModal
  };
})();
