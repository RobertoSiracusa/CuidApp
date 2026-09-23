/* ═══════════════════════════════════════════════════════════════
   CuidApp — Módulo de Menú y Alimentación (js/food.js)
   4 Pestañas: Recetas · Planificación · Complementos · Compras
   ═══════════════════════════════════════════════════════════════ */

const FoodModule = (() => {
  'use strict';

  // 4 pestañas en español
  let activeTab = 'recetas'; // 'recetas' | 'planificacion' | 'complementos' | 'compras'

  // Tipos de comida en español (con compatibilidad legacy)
  const MEAL_TYPES = [
    { id: 'desayuno', legacyId: 'breakfast', label: 'Desayuno', icon: '🌅' },
    { id: 'almuerzo', legacyId: 'lunch',     label: 'Almuerzo', icon: '🍽️' },
    { id: 'cena',     legacyId: 'dinner',    label: 'Cena',     icon: '🌙' }
  ];

  const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const DAYS_FULL  = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  // Estado y caché
  let cachedRecipes = [];
  let cachedPlan = [];
  let cachedComplementos = [];
  let cachedCategories = [];
  let cachedAvailableComplementos = [];
  let cachedShopping = [];

  // Filtro activo en Recetas
  let activeRecipeFilter = 'all';

  // Selección de complementos para lista de compras
  const selectedComplementosForShopping = new Set();

  // Fecha seleccionada para la cuadrícula semanal (siempre apunta al lunes)
  let currentMonday = getMondayOfWeek(new Date());

  // ─── Utilidades de Fecha y Semanas ─────────────────────────────
  function getMondayOfWeek(d) {
    const date = new Date(d);
    const day = date.getDay(); // 0 Dom, 1 Lun, ...
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(date.setDate(diff));
    mon.setHours(0, 0, 0, 0);
    return mon;
  }

  function getWeekInfo(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return {
      weekNumber: weekNo,
      year: date.getUTCFullYear(),
      monthName: d.toLocaleDateString('es-ES', { month: 'long' }),
      weekKey: `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
    };
  }

  function get7DaysFromMonday(monday) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
    return days;
  }

  // ─── Parser de Ingredientes ───────────────────────────────────
  // Acepta ingredientes separados por coma o por saltos de línea
  const parseIngredientsText = (text) => {
    if (!text || typeof text !== 'string') return [];
    return text
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(name => ({ name }));
  };

  const formatIngredientsForTextarea = (ingredients) => {
    if (!ingredients || !ingredients.length) return '';
    return ingredients.map(i => (typeof i === 'string' ? i : i.name)).filter(Boolean).join('\n');
  };

  // ─── Consolidador de Ingredientes con Origen entre Paréntesis ───
  // Regla del usuario: TODO ingrediente muestra su origen entre paréntesis,
  // incluso si proviene de una sola receta o complemento.
  const consolidateIngredients = (itemsWithOrigin) => {
    const map = new Map();
    itemsWithOrigin.forEach(item => {
      const cleanName = (item.name || '').trim();
      if (!cleanName) return;
      const key = cleanName.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          name: cleanName,
          origins: item.origin ? [item.origin] : []
        });
      } else {
        const entry = map.get(key);
        if (item.origin && !entry.origins.includes(item.origin)) {
          entry.origins.push(item.origin);
        }
      }
    });

    return Array.from(map.values()).map(entry => {
      const originText = entry.origins.length > 0 ? ` (${entry.origins.join(', ')})` : '';
      return {
        name: entry.name,
        origins: entry.origins,
        displayName: `${entry.name}${originText}`
      };
    });
  };

  // Comprueba si una receta aplica para un tiempo de comida
  const recipeMatchesMeal = (recipe, mealId) => {
    const types = recipe.mealTypes || [];
    if (mealId === 'desayuno') return types.includes('desayuno') || types.includes('breakfast');
    if (mealId === 'almuerzo') return types.includes('almuerzo') || types.includes('lunch');
    if (mealId === 'cena')     return types.includes('cena') || types.includes('dinner');
    return types.includes(mealId);
  };

  // Normalizador de plan
  const normalizePlan = (raw) => {
    if (Array.isArray(raw)) {
      return raw.filter(s => s && typeof s === 'object' && (s.dayIndex !== undefined || s.dayOfWeek !== undefined));
    }
    if (raw && typeof raw === 'object') {
      const arr = [];
      Object.keys(raw).forEach(day => {
        const dayObj = raw[day];
        if (dayObj && typeof dayObj === 'object') {
          Object.keys(dayObj).forEach(meal => {
            arr.push({
              dayIndex: parseInt(day, 10),
              dayOfWeek: parseInt(day, 10),
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

  // ─── Render Principal ──────────────────────────────────────────
  const render = async () => {
    const el = document.getElementById('panel-food');
    if (!el) return;

    Ui.skeleton(el);

    try {
      if (activeTab === 'recetas') {
        await renderRecetas(el);
      } else if (activeTab === 'planificacion') {
        await renderPlanificacion(el);
      } else if (activeTab === 'complementos') {
        await renderComplementos(el);
      } else if (activeTab === 'compras') {
        await renderCompras(el);
      }
    } catch (err) {
      console.error('Error render FoodModule:', err);
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar la sección de menú: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="food-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('food-retry-btn')?.addEventListener('click', render);
    }
  };

  const tabsHtml = () => `
    <div class="tabs" id="food-nav-tabs" style="font-size:0.75rem;margin-bottom:14px;">
      <button class="tab-btn ${activeTab === 'recetas' ? 'active' : ''}" data-tab="recetas">Recetas</button>
      <button class="tab-btn ${activeTab === 'planificacion' ? 'active' : ''}" data-tab="planificacion">Planificación</button>
      <button class="tab-btn ${activeTab === 'complementos' ? 'active' : ''}" data-tab="complementos">Complementos</button>
      <button class="tab-btn ${activeTab === 'compras' ? 'active' : ''}" data-tab="compras">Compras</button>
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

  // ═══════════════════════════════════════════════════════════════
  //  1. PESTAÑA RECETAS
  // ═══════════════════════════════════════════════════════════════
  const renderRecetas = async (el) => {
    const res = await Api.getRecipes();
    cachedRecipes = res.data || [];

    const filtered = activeRecipeFilter === 'all'
      ? cachedRecipes
      : cachedRecipes.filter(r => recipeMatchesMeal(r, activeRecipeFilter));

    el.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🍽️ Menú y Alimentación</div>
          <div class="text-xs text-muted" style="margin-top:2px;">Catálogo de preparaciones del recetario</div>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-add-recipe">+ Agregar Receta</button>
      </div>

      ${tabsHtml()}

      <!-- Filtros rápidos con scroll/chips -->
      <div class="chip-row" id="recipe-filter-chips" style="margin-bottom:12px;">
        <div class="chip ${activeRecipeFilter === 'all' ? 'active' : ''}" data-filter="all">
          Todas (${cachedRecipes.length})
        </div>
        ${MEAL_TYPES.map(m => `
          <div class="chip ${activeRecipeFilter === m.id ? 'active' : ''}" data-filter="${m.id}">
            ${m.icon} ${m.label}
          </div>
        `).join('')}
      </div>

      <!-- Listado con scrollbar accesible -->
      <div id="recipes-list" class="accessible-scroll" style="max-height:520px;">
        ${filtered.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">🍽️</div>
            <div class="empty-text">Sin recetas en esta categoría.<br>Toca "+ Agregar Receta" para crear una preparación.</div>
          </div>
        ` : filtered.map(r => renderRecipeCard(r)).join('')}
      </div>
    `;

    bindNavTabs(el);
    bindRecetasEvents(el);
  };

  const renderRecipeCard = (r) => {
    const types = (r.mealTypes || ['almuerzo']).map(t => {
      return MEAL_TYPES.find(m => m.id === t || m.legacyId === t);
    }).filter(Boolean);

    const badgesHtml = types.map(t => `
      <span class="recipe-type-badge">${t.icon} ${Api.escapeHtml(t.label)}</span>
    `).join(' ');

    return `
      <div class="recipe-card" data-id="${Api.escapeHtml(r.id)}" style="padding:12px 14px;margin-bottom:8px;">
        <div class="flex items-center justify-between" style="gap:8px;">
          <div style="flex:1;min-width:0;">
            <div class="recipe-name" style="font-size:0.95rem;font-weight:700;color:var(--text);margin-bottom:4px;">
              ${Api.escapeHtml(r.name)}
            </div>
            <div class="recipe-type-badges">${badgesHtml}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-ghost btn-sm btn-edit-recipe" data-id="${Api.escapeHtml(r.id)}" title="Editar receta">
              ✏️
            </button>
            <button class="btn btn-ghost btn-sm text-critical btn-del-recipe" data-id="${Api.escapeHtml(r.id)}" data-name="${Api.escapeHtml(r.name)}" title="Eliminar receta">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `;
  };

  const bindRecetasEvents = (el) => {
    el.querySelector('#btn-add-recipe')?.addEventListener('click', showAddRecipeModal);

    el.querySelectorAll('#recipe-filter-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const filter = chip.getAttribute('data-filter');
        if (filter) {
          activeRecipeFilter = filter;
          renderRecetas(el);
        }
      });
    });

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

  const showAddRecipeModal = () => {
    showRecipeFormModal('➕ Agregar Receta', null, async (data) => {
      const res = await Api.addRecipe(data);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }
      Ui.toast(`Receta "${data.name}" agregada con éxito`, 'success');
      render();
      return true;
    });
  };

  const showEditRecipeModal = (id) => {
    const recipe = cachedRecipes.find(r => r.id === id);
    if (!recipe) return;

    showRecipeFormModal(`✏️ Editar — ${recipe.name}`, recipe, async (data) => {
      const res = await Api.updateRecipe(id, data);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }
      Ui.toast('Receta actualizada', 'success');
      render();
      return true;
    });
  };

  const showRecipeFormModal = (modalTitle, existing, onSubmit) => {
    const rawTypes = existing?.mealTypes || ['almuerzo'];
    // Normalizar a español
    const selectedTypes = rawTypes.map(t => {
      if (t === 'breakfast') return 'desayuno';
      if (t === 'lunch') return 'almuerzo';
      if (t === 'dinner') return 'cena';
      return t;
    });

    const ingTextareaValue = formatIngredientsForTextarea(existing?.ingredients || []);

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="rf-title">Título de la receta</label>
        <input class="form-input" id="rf-title" value="${Api.escapeHtml(existing?.name || '')}" placeholder="Ej: Pollo a la plancha con puré">
      </div>

      <div class="form-group">
        <label class="form-label">Clasificación (selección múltiple: desayuno, almuerzo y/o cena)</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
          ${MEAL_TYPES.map(m => `
            <label style="display:inline-flex;align-items:center;gap:6px;background:var(--bg-glass);border:1px solid var(--border);border-radius:var(--r-full);padding:6px 12px;cursor:pointer;font-size:0.85rem;">
              <input type="checkbox" class="rf-meal-check" value="${m.id}" ${selectedTypes.includes(m.id) ? 'checked' : ''}>
              <span>${m.icon} ${m.label}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="rf-ing">Ingredientes (un ingrediente por línea o separados por comas)</label>
        <textarea class="form-textarea" id="rf-ing" rows="4" placeholder="Ej: Papas, Leche, Queso&#10;o uno por línea:&#10;Papas&#10;Leche&#10;Queso">${Api.escapeHtml(ingTextareaValue)}</textarea>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px;">
          ℹ️ Esta lista se asociará a la receta y se incluirá automáticamente en la lista de compras semanal.
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="rf-notes">Notas (observaciones y comentarios dietéticos)</label>
        <textarea class="form-textarea" id="rf-notes" rows="2" placeholder="Comentarios libres, restricciones, bajo en sodio...">${Api.escapeHtml(existing?.notes || '')}</textarea>
      </div>
    `;

    Ui.showModal(modalTitle, contentHtml, async () => {
      const name = document.getElementById('rf-title')?.value?.trim() || 'Sin título';
      const checkedBoxes = document.querySelectorAll('.rf-meal-check:checked');
      const mealTypes = Array.from(checkedBoxes).map(cb => cb.value);

      const ingText = document.getElementById('rf-ing')?.value || '';
      const ingredients = parseIngredientsText(ingText);
      const notes = document.getElementById('rf-notes')?.value?.trim() || '';

      return await onSubmit({
        name,
        mealTypes: mealTypes.length > 0 ? mealTypes : ['almuerzo'],
        ingredients,
        notes
      });
    });
  };

  const deleteRecipe = (id, name) => {
    Ui.confirm(
      `¿Estás seguro de que deseas eliminar esta receta?`,
      `Se eliminará "${name}" del catálogo y de la planificación semanal. Esta acción no se puede deshacer.`,
      async () => {
        const res = await Api.deleteRecipe(id);
        if (res.error) {
          Ui.toast(res.error, 'error');
        } else {
          Ui.toast(`Receta "${name}" eliminada`, 'info');
          render();
        }
      }
    );
  };

  // ═══════════════════════════════════════════════════════════════
  //  2. PESTAÑA PLANIFICACIÓN
  // ═══════════════════════════════════════════════════════════════
  const renderPlanificacion = async (el) => {
    const weekInfo = getWeekInfo(currentMonday);
    const sevenDays = get7DaysFromMonday(currentMonday);
    const sevenDates = sevenDays.map(d => d.toISOString().split('T')[0]);

    const [planRes, recipesRes, compsRes, availRes] = await Promise.all([
      Api.getWeeklyPlan(weekInfo.weekKey, sevenDates),
      Api.getRecipes(),
      Api.getComplementos(),
      Api.getAvailableComplementos()
    ]);

    cachedPlan = normalizePlan(planRes.data || planRes);
    cachedRecipes = recipesRes.data || [];
    cachedComplementos = compsRes.data || [];
    cachedAvailableComplementos = Array.isArray(availRes) ? availRes : (availRes?.data || []);

    const recipeMap = new Map(cachedRecipes.map(r => [r.id, r]));
    const todayStr = Api.todayStr();

    // Columnas de la cuadrícula: Lunes a Domingo
    const headersHtml = sevenDays.map((d, idx) => {
      const dStr = sevenDates[idx];
      const isToday = dStr === todayStr;
      return `
        <th class="${isToday ? 'today-col' : ''}">
          <div>${DAYS_SHORT[idx]}</div>
          <div style="font-size:0.68rem;font-weight:400;opacity:0.85;">${d.getDate()}</div>
        </th>
      `;
    }).join('');

    // Filas de comidas: Desayuno, Almuerzo, Cena
    const rowsHtml = MEAL_TYPES.map(mt => {
      const cellsHtml = sevenDays.map((_, dayIdx) => {
        const dStr = sevenDates[dayIdx];
        // Encontrar asignaciones del slot aisladas por fecha exacta o día de la semana
        const slot = cachedPlan.find(s => (
          s &&
          ((s.date && s.date === dStr) || (!s.date && Number(s.dayIndex ?? s.dayOfWeek) === dayIdx)) &&
          (s.mealType === mt.id || s.mealType === mt.legacyId)
        ));
        const recipeIds = slot?.recipeIds || [];
        const slotRecipes = recipeIds.map(id => recipeMap.get(id)).filter(Boolean);

        const isEmpty = slotRecipes.length === 0;

        return `
          <td>
            <div class="planner-cell-box ${isEmpty ? 'empty' : ''}" data-day="${dayIdx}" data-date="${dStr}" data-meal="${mt.id}" title="Toca para agregar o modificar recetas">
              ${isEmpty ? `
                <span style="opacity:0.4;font-size:0.72rem;">+ asignar</span>
              ` : `
                ${slotRecipes.map(r => `
                  <div class="planner-recipe-tag">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Api.escapeHtml(r.name)}</span>
                    <span class="rm-tag-btn" data-day="${dayIdx}" data-date="${dStr}" data-meal="${mt.id}" data-recipe-id="${Api.escapeHtml(r.id)}" title="Quitar">×</span>
                  </div>
                `).join('')}
              `}
            </div>
          </td>
        `;
      }).join('');

      return `
        <tr>
          <td class="planner-meal-hdr">
            <span>${mt.icon}</span>
            <span>${mt.label}</span>
          </td>
          ${cellsHtml}
        </tr>
      `;
    }).join('');

    // Complementos disponibles
    const availItems = cachedAvailableComplementos
      .map(id => cachedComplementos.find(c => String(c.id) === String(id)))
      .filter(Boolean);

    el.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🍽️ Planificación de Comidas</div>
          <div class="text-xs text-muted" style="margin-top:2px;">Planificación semanal (7 días · Desayuno, Almuerzo y Cena)</div>
        </div>
      </div>

      ${tabsHtml()}

      <!-- Barra de navegación semanal -->
      <div class="week-nav-bar">
        <button class="btn btn-secondary btn-sm" id="btn-prev-week" title="Semana anterior">
          ◀ Anterior
        </button>

        <div class="week-indicator-box">
          <div class="week-indicator-title">Semana ${weekInfo.weekNumber}</div>
          <div class="week-indicator-sub">${weekInfo.monthName} ${weekInfo.year}</div>
        </div>

        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" id="btn-curr-week" title="Ir a la semana actual">
            Hoy
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-next-week" title="Semana siguiente">
            Siguiente ▶
          </button>
        </div>
      </div>

      <!-- Cuadrícula Semanal -->
      <div class="planner-table-container">
        <table class="planner-grid-table">
          <thead>
            <tr>
              <th style="width:110px;">Comida</th>
              ${headersHtml}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <!-- Botón Generar Lista de Compras -->
      <div style="margin-bottom:20px;">
        <button class="btn btn-primary btn-full" id="btn-gen-plan-shopping" style="padding:12px;font-size:0.95rem;font-weight:700;">
          🛒 Generar Lista de Compras (Semana ${weekInfo.weekNumber})
        </button>
      </div>

      <!-- Sección: Complementos Disponibles -->
      <div class="available-comps-card">
        <div class="flex items-center justify-between" style="margin-bottom:8px;">
          <div>
            <div style="font-weight:800;font-size:0.92rem;color:var(--text);">🥤 Complementos disponibles</div>
            <div class="text-xs text-muted">Selecciona complementos del menú. Marca la casilla cuando se termine la cantidad disponible para retirarlo.</div>
          </div>
          ${availItems.length > 0 ? `
            <button class="btn btn-ghost btn-xs text-critical" id="btn-clear-all-avail">
              Eliminar todos
            </button>
          ` : ''}
        </div>

        <!-- Desplegable para seleccionar complemento -->
        <div style="display:flex;gap:8px;margin-top:8px;">
          <select class="form-select" id="select-add-complemento" style="flex:1;">
            <option value="">-- Seleccionar complemento para agregar a disponibles --</option>
            ${cachedComplementos.map(c => `
              <option value="${Api.escapeHtml(c.id)}">${Api.escapeHtml(c.name)}</option>
            `).join('')}
          </select>
        </div>

        <!-- Lista de complementos disponibles mostrados con casilla y scrollbar accesible -->
        <div class="accessible-scroll" style="max-height:160px;margin-top:12px;">
          ${availItems.length === 0 ? `
            <div class="text-xs text-muted" style="padding:14px;text-align:center;background:var(--bg-glass);border-radius:var(--r-md);border:1px dashed var(--border-subtle);">
              No hay complementos marcados como disponibles actualmente.<br>Selecciona uno en el menú superior para tenerlo en consulta permanente.
            </div>
          ` : `
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:8px;">
              ${availItems.map(c => `
                <div class="avail-comp-card-item" data-id="${Api.escapeHtml(c.id)}" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--r-md);">
                  <label style="display:flex;align-items:center;gap:10px;cursor:pointer;flex:1;margin:0;" title="Marcar cuando se termine la cantidad disponible">
                    <input type="checkbox" class="chk-retire-comp" data-id="${Api.escapeHtml(c.id)}" style="width:18px;height:18px;cursor:pointer;">
                    <span style="font-weight:700;font-size:0.875rem;color:var(--text);">${Api.escapeHtml(c.name)}</span>
                  </label>
                  <span class="rm-chip-btn" data-id="${Api.escapeHtml(c.id)}" title="Quitar inmediatamente" style="cursor:pointer;padding:2px 6px;color:var(--text-muted);font-size:1.1rem;line-height:1;">×</span>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    bindNavTabs(el);
    bindPlanificacionEvents(el, weekInfo, sevenDates);
  };

  const bindPlanificacionEvents = (el, weekInfo, sevenDates = []) => {
    // Navegación de semanas
    el.querySelector('#btn-prev-week')?.addEventListener('click', () => {
      currentMonday.setDate(currentMonday.getDate() - 7);
      render();
    });

    el.querySelector('#btn-next-week')?.addEventListener('click', () => {
      currentMonday.setDate(currentMonday.getDate() + 7);
      render();
    });

    el.querySelector('#btn-curr-week')?.addEventListener('click', () => {
      currentMonday = getMondayOfWeek(new Date());
      render();
    });

    // Clic en celda (aunque ya tenga recetas asignadas, se permite ingresar de nuevo)
    el.querySelectorAll('.planner-cell-box').forEach(box => {
      box.addEventListener('click', (e) => {
        // Si hizo clic en la '×' de una receta individual, no abrir modal
        if (e.target.closest('.rm-tag-btn')) return;

        const day = parseInt(box.getAttribute('data-day'), 10);
        const meal = box.getAttribute('data-meal');
        const dateStr = box.getAttribute('data-date') || sevenDates[day];
        showCellRecipeSelectorModal(day, meal, weekInfo, dateStr);
      });
    });

    // Quitar receta individual desde la celda
    el.querySelectorAll('.rm-tag-btn').forEach(span => {
      span.addEventListener('click', async (e) => {
        e.stopPropagation();
        const day = parseInt(span.getAttribute('data-day'), 10);
        const meal = span.getAttribute('data-meal');
        const recipeId = span.getAttribute('data-recipe-id');
        const dateStr = span.getAttribute('data-date') || sevenDates[day];

        const slot = cachedPlan.find(s => (
          s &&
          ((s.date && s.date === dateStr) || (!s.date && Number(s.dayIndex ?? s.dayOfWeek) === day)) &&
          (s.mealType === meal || s.mealType === (MEAL_TYPES.find(m => m.id === meal)?.legacyId))
        ));
        if (!slot) return;

        const newIds = (slot.recipeIds || []).filter(id => id !== recipeId);
        await Api.setWeeklySlot(day, meal, newIds, weekInfo.weekKey, dateStr);
        render();
      });
    });

    // Complementos disponibles: agregar desde select
    el.querySelector('#select-add-complemento')?.addEventListener('change', async (e) => {
      const compId = e.target.value;
      if (!compId) return;
      const strId = String(compId);
      if (cachedAvailableComplementos.some(id => String(id) === strId)) {
        Ui.toast('Este complemento ya está en la lista de disponibles', 'info');
        e.target.value = '';
        return;
      }
      cachedAvailableComplementos.push(strId);
      await Api.setAvailableComplementos(cachedAvailableComplementos);
      Ui.toast('Complemento agregado a disponibles', 'success');
      render();
    });

    // Complementos disponibles: casilla interactiva para retirar cuando se agote la cantidad
    el.querySelectorAll('.chk-retire-comp').forEach(chk => {
      chk.addEventListener('change', async () => {
        const id = chk.getAttribute('data-id');
        const comp = cachedComplementos.find(c => String(c.id) === String(id));
        const name = comp?.name || 'Complemento';
        cachedAvailableComplementos = cachedAvailableComplementos.filter(cId => String(cId) !== String(id));
        await Api.setAvailableComplementos(cachedAvailableComplementos);
        Ui.toast(`"${name}" marcado como agotado y retirado`, 'info');
        render();
      });
    });

    // Complementos disponibles: quitar inmediatamente con ×
    el.querySelectorAll('.rm-chip-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        cachedAvailableComplementos = cachedAvailableComplementos.filter(cId => String(cId) !== String(id));
        await Api.setAvailableComplementos(cachedAvailableComplementos);
        render();
      });
    });

    // Complementos disponibles: eliminar todos
    el.querySelector('#btn-clear-all-avail')?.addEventListener('click', async () => {
      cachedAvailableComplementos = [];
      await Api.setAvailableComplementos([]);
      Ui.toast('Se retiraron todos los complementos disponibles', 'info');
      render();
    });

    // Generar lista de compras de la semana seleccionada
    el.querySelector('#btn-gen-plan-shopping')?.addEventListener('click', () => {
      generateShoppingFromWeekPlan(weekInfo);
    });
  };

  /**
   * Modal de selección de recetas para una celda
   * - Filtra únicamente las recetas cuya categoría coincida con la celda
   * - Permite selección múltiple
   * - Muestra pre-marcadas las recetas ya seleccionadas
   * - Botón Cancelar y Guardar selección
   */
  const showCellRecipeSelectorModal = (dayIndex, mealType, weekInfo, dateStr = null) => {
    const mealObj = MEAL_TYPES.find(m => m.id === mealType) || { label: mealType, icon: '🍽️' };
    const dayName = DAYS_FULL[dayIndex];

    // Recetas filtradas estrictamente por la categoría
    const suitableRecipes = cachedRecipes.filter(r => recipeMatchesMeal(r, mealType));

    // Recetas actualmente asignadas (por fecha exacta o por día)
    const slot = cachedPlan.find(s => (
      s &&
      ((dateStr && s.date && s.date === dateStr) || (!s.date && Number(s.dayIndex ?? s.dayOfWeek) === dayIndex)) &&
      (s.mealType === mealType || s.mealType === mealObj.legacyId)
    ));
    const currentRecipeIds = new Set(slot?.recipeIds || []);

    const dateHeader = dateStr ? ` · ${dateStr}` : '';

    const contentHtml = `
      <div style="margin-bottom:12px;font-size:0.875rem;color:var(--text-sec);">
        Selecciona las recetas para: <strong>${dayName}${dateHeader} — ${mealObj.icon} ${mealObj.label}</strong>
      </div>

      <div class="accessible-scroll" style="max-height:280px;display:flex;flex-direction:column;gap:6px;">
        ${suitableRecipes.length === 0 ? `
          <div class="empty-state" style="padding:16px;">
            <div class="empty-text">No hay recetas registradas con la clasificación "${mealObj.label}".<br>Ve a la pestaña Recetas para clasificar preparaciones.</div>
          </div>
        ` : suitableRecipes.map(r => `
          <label style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg-glass);border:1px solid var(--border-subtle);border-radius:var(--r-md);cursor:pointer;">
            <div style="display:flex;align-items:center;gap:10px;">
              <input type="checkbox" class="sel-slot-recipe-check" value="${Api.escapeHtml(r.id)}" ${currentRecipeIds.has(r.id) ? 'checked' : ''} style="width:18px;height:18px;">
              <div style="font-weight:700;font-size:0.9rem;">${Api.escapeHtml(r.name)}</div>
            </div>
            ${r.ingredients?.length ? `
              <span style="font-size:0.72rem;color:var(--text-muted);">${r.ingredients.length} ing.</span>
            ` : ''}
          </label>
        `).join('')}
      </div>
    `;

    Ui.showModal(`🍽️ Asignar Recetas`, contentHtml, async () => {
      const checkedBoxes = document.querySelectorAll('.sel-slot-recipe-check:checked');
      const selectedIds = Array.from(checkedBoxes).map(cb => cb.value);

      const res = await Api.setWeeklySlot(dayIndex, mealType, selectedIds, weekInfo.weekKey, dateStr);
      if (res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }
      Ui.toast('Planificación actualizada', 'success');
      render();
      return true;
    });
  };

  /**
   * Generar Lista de Compras preliminar desde la semana seleccionada
   */
  const generateShoppingFromWeekPlan = async (weekInfo) => {
    const recipeMap = new Map(cachedRecipes.map(r => [r.id, r]));

    // Recolectar todos los ingredientes con su origen (nombre de receta)
    const rawIngredientsWithOrigin = [];
    cachedPlan.forEach(slot => {
      (slot.recipeIds || []).forEach(rId => {
        const recipe = recipeMap.get(rId);
        if (!recipe) return;
        (recipe.ingredients || []).forEach(ing => {
          const ingName = typeof ing === 'string' ? ing : ing.name;
          if (ingName && ingName.trim()) {
            rawIngredientsWithOrigin.push({
              name: ingName.trim(),
              origin: recipe.name
            });
          }
        });
      });
    });

    if (rawIngredientsWithOrigin.length === 0) {
      Ui.toast('No hay recetas con ingredientes asignadas en esta semana', 'warning');
      return;
    }

    // Consolidar: regla del usuario -> origen siempre entre paréntesis
    const consolidated = consolidateIngredients(rawIngredientsWithOrigin);

    showPreliminaryShoppingModal(
      `🛒 Lista de Compras — Semana ${weekInfo.weekNumber}`,
      consolidated,
      'plan',
      weekInfo.weekKey
    );
  };

  /**
   * Modal preliminar de lista de compras con:
   * - Ingredientes seleccionados por defecto
   * - Opción de quitar selección o agregar ingredientes
   * - Barra de desplazamiento vertical con scrollbar accesible
   * - Diálogo de conflicto si ya se había enviado previamente (Sustituir / Complementar / Cancelar)
   */
  const showPreliminaryShoppingModal = (title, consolidatedItems, source, weekKey = null) => {
    // Estado de selección local en el modal
    const selectionMap = new Map();
    consolidatedItems.forEach((item, idx) => {
      selectionMap.set(idx, { ...item, selected: true });
    });

    let extraIndex = 1000;

    const renderList = () => {
      const container = document.getElementById('prelim-items-container');
      if (!container) return;

      const items = Array.from(selectionMap.entries());
      if (items.length === 0) {
        container.innerHTML = `<div class="text-xs text-muted" style="padding:16px;text-align:center;">Sin ingredientes en la lista.</div>`;
        return;
      }

      container.innerHTML = items.map(([key, item]) => `
        <div class="prelim-item-row ${item.selected ? '' : 'unselected'}" data-key="${key}">
          <div style="display:flex;align-items:center;gap:10px;flex:1;">
            <input type="checkbox" class="prelim-chk" data-key="${key}" ${item.selected ? 'checked' : ''} style="width:18px;height:18px;">
            <span style="font-size:0.875rem;font-weight:600;">
              ${Api.escapeHtml(item.displayName)}
            </span>
          </div>
        </div>
      `).join('');

      const count = items.filter(([_, i]) => i.selected).length;
      const counterEl = document.getElementById('prelim-sel-count');
      if (counterEl) counterEl.textContent = `${count} de ${items.length} seleccionados`;
    };

    const contentHtml = `
      <div style="margin-bottom:10px;font-size:0.85rem;color:var(--text-sec);">
        Ingredientes consolidados. Todos vienen seleccionados; puedes desmarcar o escribir nuevos ítems:
      </div>

      <!-- Barra rápida para agregar ítem extra -->
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <input class="form-input" id="prelim-add-input" placeholder="Agregar ingrediente extra..." style="flex:1;">
        <button type="button" class="btn btn-secondary btn-sm" id="prelim-btn-add-extra">+ Agregar</button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:0.75rem;color:var(--text-muted);" id="prelim-sel-count">0 seleccionados</span>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn btn-ghost btn-xs" id="prelim-sel-all">Marcar todos</button>
          <button type="button" class="btn btn-ghost btn-xs" id="prelim-sel-none">Desmarcar todos</button>
        </div>
      </div>

      <!-- Lista con scroll accesible -->
      <div id="prelim-items-container" class="accessible-scroll" style="max-height:280px;border:1px solid var(--border-subtle);border-radius:var(--r-md);padding:6px;background:rgba(255,255,255,0.02);">
      </div>
    `;

    Ui.showModal(title, contentHtml, async () => {
      const selectedItems = Array.from(selectionMap.values()).filter(i => i.selected);
      if (selectedItems.length === 0) {
        Ui.toast('No has seleccionado ningún ingrediente', 'warning');
        return false;
      }

      // Comprobar si ya se envió lista para este contexto (en historial o en la lista de compras)
      const alreadySent = await checkAlreadySent(source, weekKey);

      if (alreadySent) {
        // Transicionar la vista del modal al diálogo de conflicto sin cerrarlo prematuramente
        transitionToConflictView(source, weekKey, selectedItems);
        return false; // Retorna false para que Ui.confirmModal no cierre el modal
      } else {
        // Agregar directamente
        await finalizeShoppingSend(source, weekKey, selectedItems, 'append');
        return true;
      }
    });

    // Renderizar lista inicial
    setTimeout(() => {
      renderList();

      document.getElementById('prelim-btn-add-extra')?.addEventListener('click', () => {
        const inp = document.getElementById('prelim-add-input');
        const text = inp?.value?.trim();
        if (!text) return;
        const newKey = extraIndex++;
        selectionMap.set(newKey, {
          name: text,
          origins: ['Manual'],
          displayName: `${text} (Manual)`,
          selected: true
        });
        inp.value = '';
        renderList();
      });

      document.getElementById('prelim-add-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('prelim-btn-add-extra')?.click();
        }
      });

      document.getElementById('prelim-sel-all')?.addEventListener('click', () => {
        selectionMap.forEach(i => { i.selected = true; });
        renderList();
      });

      document.getElementById('prelim-sel-none')?.addEventListener('click', () => {
        selectionMap.forEach(i => { i.selected = false; });
        renderList();
      });

      document.getElementById('prelim-items-container')?.addEventListener('change', (e) => {
        const chk = e.target.closest('.prelim-chk');
        if (chk) {
          const key = parseInt(chk.getAttribute('data-key'), 10);
          if (selectionMap.has(key)) {
            selectionMap.get(key).selected = chk.checked;
            renderList();
          }
        }
      });
    }, 50);
  };

  const checkAlreadySent = async (source, weekKey) => {
    try {
      const raw = localStorage.getItem('cuidapp_food_sent_history');
      const history = raw ? JSON.parse(raw) : { weeks: {}, days: {} };
      if (source === 'plan' && weekKey && history.weeks && history.weeks[weekKey]) {
        return true;
      }
      if (source === 'complemento' && history.days && history.days[Api.todayStr()]) {
        return true;
      }
    } catch (e) {}

    // Doble verificación: comprobar si ya existen ítems de esa semana o fuente en shoppingList
    try {
      const res = await Api.getShoppingList();
      const items = res.data || res || [];
      if (source === 'plan' && weekKey) {
        return items.some(i => i && i.source === 'plan' && i.weekKey === weekKey);
      }
      if (source === 'complemento') {
        return items.some(i => i && i.source === 'complemento');
      }
    } catch (e) {}

    return false;
  };

  const markAsSent = (source, weekKey) => {
    try {
      const raw = localStorage.getItem('cuidapp_food_sent_history');
      const history = raw ? JSON.parse(raw) : { weeks: {}, days: {} };
      if (source === 'plan' && weekKey) history.weeks[weekKey] = new Date().toISOString();
      if (source === 'complemento') history.days[Api.todayStr()] = new Date().toISOString();
      localStorage.setItem('cuidapp_food_sent_history', JSON.stringify(history));
    } catch (e) {}
  };

  /**
   * Transición del modal a resolución de conflicto:
   * "¿El nuevo envío sustituye el anterior o lo complementa?"
   * Opciones: [Sustituir] [Complementar] [Cancelar]
   */
  const transitionToConflictView = (source, weekKey, selectedItems) => {
    const titleEl = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    if (titleEl) titleEl.textContent = '⚠️ Envío Existente';
    if (confirmBtn) confirmBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';

    const msg = source === 'plan'
      ? `Ya se ha enviado una lista de compras para esta semana previamente.<br><br>¿Deseas que este nuevo envío <strong>sustituya</strong> la lista anterior o que la <strong>complemente</strong>?`
      : `Ya se ha generado una lista de complementos en el día de hoy.<br><br>¿Deseas que este nuevo envío <strong>sustituya</strong> la anterior o que la <strong>complemente</strong>?`;

    if (body) {
      body.innerHTML = `
        <div style="font-size:0.92rem;color:var(--text);line-height:1.5;margin-bottom:18px;">
          ${msg}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button type="button" class="btn btn-primary btn-full" id="btn-conflict-substitute" style="padding:12px;font-weight:700;">
            🔄 Sustituir lista anterior
          </button>
          <button type="button" class="btn btn-secondary btn-full" id="btn-conflict-complement" style="padding:12px;font-weight:700;">
            ➕ Complementar (unir a la existente)
          </button>
          <button type="button" class="btn btn-ghost btn-full text-muted" id="btn-conflict-cancel" style="padding:10px;">
            ✕ Cancelar
          </button>
        </div>
      `;

      document.getElementById('btn-conflict-substitute')?.addEventListener('click', async () => {
        Ui.closeModal();
        await finalizeShoppingSend(source, weekKey, selectedItems, 'replace');
      });

      document.getElementById('btn-conflict-complement')?.addEventListener('click', async () => {
        Ui.closeModal();
        await finalizeShoppingSend(source, weekKey, selectedItems, 'append');
      });

      document.getElementById('btn-conflict-cancel')?.addEventListener('click', () => {
        Ui.closeModal();
        Ui.toast('Envío cancelado', 'info');
      });
    }
  };

  const finalizeShoppingSend = async (source, weekKey, selectedItems, mode) => {
    const itemsToAdd = selectedItems.map(i => ({
      name: i.name,
      origins: i.origins || [],
      amount: '',
      unit: '',
      source: source === 'plan' ? 'plan' : 'complemento',
      weekKey: weekKey || null
    }));

    await Api.addBulkShoppingItems(itemsToAdd, mode, { source, weekKey });
    markAsSent(source, weekKey);

    Ui.toast(`${itemsToAdd.length} ingredientes enviados a la pestaña Compras`, 'success');
    activeTab = 'compras';
    render();
  };

  // ═══════════════════════════════════════════════════════════════
  //  3. PESTAÑA COMPLEMENTOS
  // ═══════════════════════════════════════════════════════════════
  const renderComplementos = async (el) => {
    const [compsRes, catsRes] = await Promise.all([
      Api.getComplementos(),
      Api.getComplementCategories()
    ]);

    cachedComplementos = compsRes.data || [];
    cachedCategories = catsRes.data || [
      { id: 'bebidas', label: 'Bebidas', icon: '🥤', isCustom: false },
      { id: 'contornos', label: 'Contornos', icon: '🥗', isCustom: false },
      { id: 'snacks', label: 'Snacks', icon: '🍎', isCustom: false }
    ];

    // Contenido por categorías
    let categoriesHtml = '';
    cachedCategories.forEach(cat => {
      const items = cachedComplementos.filter(c => c.category === cat.id);

      categoriesHtml += `
        <div class="card" style="padding:12px;margin-bottom:14px;background:var(--bg-glass);">
          <div class="comp-category-hdr">
            <div style="font-weight:800;font-size:0.92rem;display:flex;align-items:center;gap:6px;">
              <span>${cat.icon || '🧺'}</span>
              <span>${Api.escapeHtml(cat.label)}</span>
              <span class="text-xs text-muted" style="font-weight:400;">(${items.length})</span>
            </div>
            <div style="display:flex;gap:4px;">
              <button class="btn btn-ghost btn-xs btn-rename-cat" data-id="${Api.escapeHtml(cat.id)}" data-label="${Api.escapeHtml(cat.label)}" title="Renombrar categoría">
                ✏️
              </button>
              ${cat.isCustom ? `
                <button class="btn btn-ghost btn-xs text-critical btn-del-cat" data-id="${Api.escapeHtml(cat.id)}" data-label="${Api.escapeHtml(cat.label)}" title="Eliminar categoría">
                  🗑️
                </button>
              ` : ''}
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:6px;">
            ${items.length === 0 ? `
              <div class="text-xs text-muted" style="padding:8px 0;">Sin complementos registrados en esta categoría</div>
            ` : items.map(item => {
              const isChecked = selectedComplementosForShopping.has(item.id);
              const ingsSummary = (item.ingredients || []).map(i => Api.escapeHtml(i.name || i)).join(', ');

              return `
                <div class="comp-item-card" data-id="${Api.escapeHtml(item.id)}">
                  <!-- Casilla de selección a la izquierda para incluir en lista de compras -->
                  <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                    <input type="checkbox" class="chk-select-comp" data-id="${Api.escapeHtml(item.id)}" ${isChecked ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;">
                    <div style="flex:1;min-width:0;">
                      <div style="font-weight:700;font-size:0.9rem;color:var(--text);">${Api.escapeHtml(item.name)}</div>
                      ${item.notes ? `
                        <div class="text-xs text-muted" style="margin-top:2px;font-style:italic;">
                          📝 <strong>Notas:</strong> ${Api.escapeHtml(item.notes)}
                        </div>
                      ` : ''}
                      ${ingsSummary ? `
                        <div class="text-xs text-sec" style="margin-top:2px;">
                          🥬 <strong>Ingredientes:</strong> ${ingsSummary}
                        </div>
                      ` : ''}
                    </div>
                  </div>

                  <!-- Botones de Editar y Eliminar a la derecha -->
                  <div style="display:flex;gap:4px;flex-shrink:0;">
                    <button class="btn btn-ghost btn-sm btn-edit-comp" data-id="${Api.escapeHtml(item.id)}" title="Editar complemento">
                      ✏️
                    </button>
                    <button class="btn btn-ghost btn-sm text-critical btn-del-comp" data-id="${Api.escapeHtml(item.id)}" data-name="${Api.escapeHtml(item.name)}" title="Eliminar complemento">
                      🗑️
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });

    const selectedCount = selectedComplementosForShopping.size;

    el.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🥤 Complementos</div>
          <div class="text-xs text-muted" style="margin-top:2px;">Bebidas, contornos, snacks y categorías personalizadas</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-secondary btn-sm" id="btn-add-cat">+ Nueva categoría</button>
          <button class="btn btn-primary btn-sm" id="btn-add-comp">+ Complemento</button>
        </div>
      </div>

      ${tabsHtml()}

      <!-- Contenedor con scroll accesible -->
      <div class="accessible-scroll" style="max-height:500px;margin-bottom:16px;">
        ${categoriesHtml}
      </div>

      <!-- Botón Generar Lista de Compras -->
      <div style="margin-top:10px;">
        <button class="btn btn-primary btn-full" id="btn-gen-comp-shopping" style="padding:12px;font-size:0.95rem;font-weight:700;">
          🛒 Generar Lista de Compras (${selectedCount} complemento${selectedCount === 1 ? '' : 's'} seleccionado${selectedCount === 1 ? '' : 's'})
        </button>
      </div>
    `;

    bindNavTabs(el);
    bindComplementosEvents(el);
  };

  const bindComplementosEvents = (el) => {
    el.querySelector('#btn-add-cat')?.addEventListener('click', showAddCategoryModal);
    el.querySelector('#btn-add-comp')?.addEventListener('click', showAddComplementoModal);

    // Selección de complementos para lista de compras
    el.querySelectorAll('.chk-select-comp').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.getAttribute('data-id');
        if (chk.checked) {
          selectedComplementosForShopping.add(id);
        } else {
          selectedComplementosForShopping.delete(id);
        }
        const btnGen = document.getElementById('btn-gen-comp-shopping');
        if (btnGen) {
          const count = selectedComplementosForShopping.size;
          btnGen.textContent = `🛒 Generar Lista de Compras (${count} complemento${count === 1 ? '' : 's'} seleccionado${count === 1 ? '' : 's'})`;
        }
      });
    });

    // Delegación para editar y eliminar complementos
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

      const btnRenameCat = e.target.closest('.btn-rename-cat');
      if (btnRenameCat) {
        const id = btnRenameCat.getAttribute('data-id');
        const label = btnRenameCat.getAttribute('data-label');
        if (id) showRenameCategoryModal(id, label);
        return;
      }

      const btnDelCat = e.target.closest('.btn-del-cat');
      if (btnDelCat) {
        const id = btnDelCat.getAttribute('data-id');
        const label = btnDelCat.getAttribute('data-label');
        if (id) deleteCategory(id, label);
        return;
      }
    });

    // Generar lista de compras desde complementos seleccionados
    el.querySelector('#btn-gen-comp-shopping')?.addEventListener('click', () => {
      generateShoppingFromComplementos();
    });
  };

  const showAddCategoryModal = () => {
    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="ncat-name">Nombre de la nueva categoría *</label>
        <input class="form-input" id="ncat-name" placeholder="Ej: Postres, Salsas, Infusiones..." required>
      </div>
      <div class="form-group">
        <label class="form-label" for="ncat-icon">Ícono o emoji</label>
        <input class="form-input" id="ncat-icon" value="🧺" placeholder="Emoji ej: 🍮, 🍵">
      </div>
    `;

    Ui.showModal('➕ Nueva Categoría', contentHtml, async () => {
      const label = document.getElementById('ncat-name')?.value?.trim();
      const icon = document.getElementById('ncat-icon')?.value?.trim() || '🧺';
      if (!label) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }
      await Api.addComplementCategory({ label, icon });
      Ui.toast(`Categoría "${label}" agregada`, 'success');
      render();
      return true;
    });
  };

  const showRenameCategoryModal = (id, currentLabel) => {
    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="rcat-name">Nuevo nombre de la categoría *</label>
        <input class="form-input" id="rcat-name" value="${Api.escapeHtml(currentLabel)}" required>
      </div>
    `;

    Ui.showModal('✏️ Renombrar Categoría', contentHtml, async () => {
      const newLabel = document.getElementById('rcat-name')?.value?.trim();
      if (!newLabel) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }
      await Api.updateComplementCategory(id, { label: newLabel });
      Ui.toast('Categoría renombrada', 'success');
      render();
      return true;
    });
  };

  const deleteCategory = (id, label) => {
    Ui.confirm(
      `¿Eliminar la categoría "${label}"?`,
      'Los complementos en esta categoría no se borrarán, pero se moverán a otra categoría.',
      async () => {
        await Api.deleteComplementCategory(id);
        Ui.toast(`Categoría "${label}" eliminada`, 'info');
        render();
      }
    );
  };

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

  const showComplementoFormModal = (modalTitle, existing, onSubmit) => {
    const ingTextareaValue = formatIngredientsForTextarea(existing?.ingredients || []);

    const contentHtml = `
      <div class="form-group">
        <label class="form-label" for="cf-name">Nombre del complemento *</label>
        <input class="form-input" id="cf-name" value="${Api.escapeHtml(existing?.name || '')}" placeholder="Ej: Jugo de naranja natural" required>
      </div>

      <div class="form-group">
        <label class="form-label" for="cf-cat">Categoría</label>
        <select class="form-select" id="cf-cat">
          ${cachedCategories.map(c => `
            <option value="${Api.escapeHtml(c.id)}" ${existing?.category === c.id ? 'selected' : ''}>
              ${c.icon || '🧺'} ${Api.escapeHtml(c.label)}
            </option>
          `).join('')}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="cf-ing">Ingredientes (un ingrediente por línea o separados por comas)</label>
        <textarea class="form-textarea" id="cf-ing" rows="3" placeholder="Ej: Naranjas, Azúcar o uno por línea">${Api.escapeHtml(ingTextareaValue)}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label" for="cf-notes">Notas (observaciones y comentarios dietéticos)</label>
        <textarea class="form-textarea" id="cf-notes" rows="2" placeholder="Marca preferida, sin azúcar, temperatura...">${Api.escapeHtml(existing?.notes || '')}</textarea>
      </div>
    `;

    Ui.showModal(modalTitle, contentHtml, async () => {
      const name = document.getElementById('cf-name')?.value?.trim();
      const category = document.getElementById('cf-cat')?.value || 'otros';
      const ingText = document.getElementById('cf-ing')?.value || '';
      const ingredients = parseIngredientsText(ingText);
      const notes = document.getElementById('cf-notes')?.value?.trim() || '';

      if (!name) {
        Ui.toast('El nombre es requerido', 'warning');
        return false;
      }

      return await onSubmit({ name, category, notes, ingredients });
    });
  };

  const deleteComplemento = (id, name) => {
    Ui.confirm(
      `¿Estás seguro de que deseas eliminar este complemento?`,
      `Se eliminará "${name}". Esta acción no se puede deshacer.`,
      async () => {
        const res = await Api.deleteComplemento(id);
        if (res.error) {
          Ui.toast(res.error, 'error');
        } else {
          selectedComplementosForShopping.delete(id);
          Ui.toast(`"${name}" eliminado`, 'info');
          render();
        }
      }
    );
  };

  const generateShoppingFromComplementos = () => {
    if (selectedComplementosForShopping.size === 0) {
      Ui.toast('Selecciona al menos un complemento marcando su casilla a la izquierda', 'warning');
      return;
    }

    const selectedItems = Array.from(selectedComplementosForShopping)
      .map(id => cachedComplementos.find(c => c.id === id))
      .filter(Boolean);

    const rawIngredientsWithOrigin = [];
    selectedItems.forEach(item => {
      if (item.ingredients && item.ingredients.length > 0) {
        item.ingredients.forEach(ing => {
          const ingName = typeof ing === 'string' ? ing : ing.name;
          if (ingName && ingName.trim()) {
            rawIngredientsWithOrigin.push({
              name: ingName.trim(),
              origin: item.name
            });
          }
        });
      } else {
        // Si no tiene ingredientes separados, el producto mismo es el ítem
        rawIngredientsWithOrigin.push({
          name: item.name.trim(),
          origin: item.name
        });
      }
    });

    const consolidated = consolidateIngredients(rawIngredientsWithOrigin);

    showPreliminaryShoppingModal(
      `🛒 Lista de Compras — Desde Complementos`,
      consolidated,
      'complemento'
    );
  };

  // ═══════════════════════════════════════════════════════════════
  //  4. PESTAÑA COMPRAS
  // ═══════════════════════════════════════════════════════════════
  const renderCompras = async (el) => {
    const res = await Api.getShoppingItems();
    cachedShopping = res.data || [];

    const unchecked = cachedShopping.filter(i => !i.checked);
    const checked = cachedShopping.filter(i => i.checked);

    el.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🛒 Lista de Compras</div>
          <div class="text-xs text-muted" style="margin-top:2px;">Consolidada desde Planificación y Complementos</div>
        </div>
        <span class="badge ${unchecked.length > 0 ? 'badge-alert' : 'badge-active'}">
          ${unchecked.length} pendiente${unchecked.length === 1 ? '' : 's'}
        </span>
      </div>

      ${tabsHtml()}

      <!-- Acciones de cabecera: Enviar por WhatsApp y Copiar lista -->
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <button class="btn btn-whatsapp btn-sm" id="btn-shop-wa" style="flex:1;min-width:160px;font-weight:700;">
          📲 Enviar lista por WhatsApp
        </button>
        <button class="btn btn-secondary btn-sm" id="btn-shop-copy" style="flex:1;min-width:140px;">
          📋 Copiar lista
        </button>
      </div>

      <!-- Barra para agregar ítem manual con teclado -->
      <div style="display:flex;gap:6px;margin-bottom:14px;">
        <input class="form-input" id="shop-manual-input" placeholder="Escribir nuevo producto para comprar..." style="flex:1;">
        <button class="btn btn-primary btn-sm" id="btn-shop-add-manual">+ Agregar</button>
      </div>

      <!-- Lista con scroll accesible -->
      <div class="accessible-scroll" style="max-height:420px;margin-bottom:16px;">
        ${cachedShopping.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">🛒</div>
            <div class="empty-text">Lista de compras vacía.<br>Genera productos desde Planificación, Complementos o escribe arriba con el teclado.</div>
          </div>
        ` : `
          <!-- Productos por comprar -->
          <div style="margin-bottom:12px;">
            <div style="font-size:0.8rem;font-weight:800;color:var(--text);margin-bottom:6px;">
              POR COMPRAR (${unchecked.length})
            </div>
            ${unchecked.length === 0 ? `
              <div class="text-xs text-muted" style="padding:10px;background:rgba(255,255,255,0.02);border-radius:var(--r-md);text-align:center;">
                🎉 ¡Todos los productos han sido marcados como comprados!
              </div>
            ` : unchecked.map(item => renderShoppingRow(item)).join('')}
          </div>

          <!-- Productos ya comprados -->
          ${checked.length > 0 ? `
            <div style="margin-top:14px;">
              <div style="font-size:0.8rem;font-weight:800;color:var(--stable);margin-bottom:6px;">
                ✅ COMPRADOS (${checked.length})
              </div>
              ${checked.map(item => renderShoppingRow(item)).join('')}
            </div>
          ` : ''}
        `}
      </div>

      <!-- Botones de marcado de compra al fondo -->
      ${cachedShopping.length > 0 ? `
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary btn-full" id="btn-shop-buy-selected" style="font-weight:700;">
              ✓ Comprado (eliminar seleccionados)
            </button>
            <button class="btn btn-secondary btn-full" id="btn-shop-buy-all" style="font-weight:700;">
              ✅ Comprado todos
            </button>
          </div>
        </div>
      ` : ''}
    `;

    bindNavTabs(el);
    bindComprasEvents(el);
  };

  const renderShoppingRow = (item) => {
    // Orígenes entre paréntesis si están disponibles
    let originsText = '';
    if (Array.isArray(item.origins) && item.origins.length > 0) {
      originsText = ` (${item.origins.join(', ')})`;
    }

    return `
      <div class="shop-item-v2 ${item.checked ? 'checked' : ''}" data-id="${Api.escapeHtml(item.id)}">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer;" class="shop-toggle-area" data-id="${Api.escapeHtml(item.id)}">
          <input type="checkbox" class="shop-item-chk" data-id="${Api.escapeHtml(item.id)}" ${item.checked ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;">
          <div style="flex:1;min-width:0;">
            <span class="shop-item-title" style="font-weight:600;font-size:0.9rem;color:var(--text);">
              ${Api.escapeHtml(item.name)}
            </span>
            ${originsText ? `
              <span style="font-size:0.75rem;color:var(--text-muted);font-style:italic;">${Api.escapeHtml(originsText)}</span>
            ` : ''}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm text-critical btn-shop-del-item" data-id="${Api.escapeHtml(item.id)}" title="Quitar de la lista">
          ✕
        </button>
      </div>
    `;
  };

  const bindComprasEvents = (el) => {
    // Agregar producto manual escribiendo con el teclado
    const handleAddManual = async () => {
      const inp = el.querySelector('#shop-manual-input');
      const text = inp?.value?.trim();
      if (!text) return;

      await Api.addShoppingItem({
        name: text,
        origins: ['Manual'],
        source: 'manual'
      });
      inp.value = '';
      Ui.toast(`"${text}" agregado a compras`, 'success');
      renderCompras(el);
      DashboardModule?.render();
    };

    el.querySelector('#btn-shop-add-manual')?.addEventListener('click', handleAddManual);
    el.querySelector('#shop-manual-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddManual();
      }
    });

    // Checkbox toggle
    el.addEventListener('change', async (e) => {
      const chk = e.target.closest('.shop-item-chk');
      if (chk) {
        const id = chk.getAttribute('data-id');
        await Api.updateShoppingItem(id, { checked: chk.checked });
        renderCompras(el);
        DashboardModule?.render();
      }
    });

    // Eliminar ítem individual con '✕'
    el.addEventListener('click', async (e) => {
      const btnDel = e.target.closest('.btn-shop-del-item');
      if (btnDel) {
        const id = btnDel.getAttribute('data-id');
        if (id) {
          await Api.deleteShoppingItem(id);
          renderCompras(el);
          DashboardModule?.render();
        }
      }
    });

    // Comprar seleccionados: elimina los ítems marcados de la lista y de los pendientes
    el.querySelector('#btn-shop-buy-selected')?.addEventListener('click', async () => {
      const checkedIds = cachedShopping.filter(i => i.checked).map(i => i.id);
      if (checkedIds.length === 0) {
        Ui.toast('Marca con la casilla los ingredientes que ya compraste para eliminarlos de la lista', 'warning');
        return;
      }

      await Api.deleteShoppingItemsBatch(checkedIds);
      Ui.toast(`${checkedIds.length} producto${checkedIds.length === 1 ? '' : 's'} marcado${checkedIds.length === 1 ? '' : 's'} como comprado y retirado de la lista`, 'success');
      renderCompras(el);
      DashboardModule?.render();
    });

    // Comprado todos: elimina todos los ingredientes de la lista
    el.querySelector('#btn-shop-buy-all')?.addEventListener('click', () => {
      Ui.confirm(
        '¿Marcar todos como comprados?',
        'Se eliminarán todos los productos de la lista de compras y de los pendientes del Dashboard.',
        async () => {
          await Api.clearShoppingList();
          Ui.toast('¡Todos los productos comprados y lista al día!', 'success');
          renderCompras(el);
          DashboardModule?.render();
        }
      );
    });

    // Enviar lista por WhatsApp
    el.querySelector('#btn-shop-wa')?.addEventListener('click', sendShoppingWhatsApp);

    // Copiar lista al portapapeles
    el.querySelector('#btn-shop-copy')?.addEventListener('click', copyShoppingToClipboard);
  };

  const buildShoppingListText = async () => {
    const unchecked = cachedShopping.filter(i => !i.checked);
    const checked = cachedShopping.filter(i => i.checked);

    const settingsRes = await Api.getSettings();
    const settings = settingsRes.data || {};

    let msg = `🛒 *Lista de Compras — CuidApp*\n`;
    msg += `Paciente: ${settings.patientName || 'Paciente'}\n`;
    msg += `Fecha: ${new Date().toLocaleDateString('es-ES')}\n\n`;

    if (unchecked.length > 0) {
      msg += `*Pendientes por comprar (${unchecked.length}):*\n`;
      unchecked.forEach(item => {
        let orig = (item.origins && item.origins.length > 0) ? ` (${item.origins.join(', ')})` : '';
        msg += `◻ ${item.name}${orig}\n`;
      });
    }

    if (checked.length > 0) {
      msg += `\n*Ya comprados (${checked.length}):*\n`;
      checked.forEach(item => {
        let orig = (item.origins && item.origins.length > 0) ? ` (${item.origins.join(', ')})` : '';
        msg += `✓ ~${item.name}${orig}~\n`;
      });
    }

    msg += `\n_Generado desde CuidApp_`;
    return { msg, settings };
  };

  const sendShoppingWhatsApp = async () => {
    if (cachedShopping.length === 0) {
      Ui.toast('La lista de compras está vacía', 'warning');
      return;
    }

    const { msg, settings } = await buildShoppingListText();
    const waNum = (settings.emergencyContactWhatsapp || '').replace(/\D/g, '');

    const url = waNum
      ? `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;

    window.open(url, '_blank');
    Ui.toast('Lista preparada para WhatsApp', 'success');

    // Actualizar Dashboard
    DashboardModule?.render();
  };

  const copyShoppingToClipboard = async () => {
    if (cachedShopping.length === 0) {
      Ui.toast('La lista de compras está vacía', 'warning');
      return;
    }

    const { msg } = await buildShoppingListText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(msg);
      } else {
        const ta = document.createElement('textarea');
        ta.value = msg;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      Ui.toast('Lista copiada al portapapeles con éxito', 'success');
    } catch (e) {
      Ui.toast('No se pudo copiar automáticamente. Intenta de nuevo.', 'error');
    }
  };

  // ─── Inicialización y Exportación ──────────────────────────────
  const init = () => {
    render();
  };

  return {
    init,
    render,
    showToday: () => {
      if (!activeTab) activeTab = 'recetas';
      render();
    },
    setTab: (t) => {
      // Normalizar tab
      if (t === 'recipes' || t === 'recetario') {
        activeTab = 'recetas';
      } else if (t === 'planner' || t === 'planificacion' || t === 'today') {
        activeTab = 'planificacion';
        currentMonday = getMondayOfWeek(new Date());
      } else if (t === 'shopping' || t === 'compras') {
        activeTab = 'compras';
      } else if (t === 'complementos') {
        activeTab = 'complementos';
      } else {
        activeTab = t;
      }
    },
    showAddRecipeModal,
    showAddComplementoModal
  };
})();

// Exponer globalmente en window para el router (app.js) y accesos directos
window.FoodModule = FoodModule;
