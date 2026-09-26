/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Módulo de Gestión de Insumos (js/inventory.js)
   Fases 6 a 9: Relevo de Habitación, Otras Ubicaciones, Kanban Compras, Catálogo
   ═══════════════════════════════════════════════════════════════ */

const InventoryModule = (() => {
  'use strict';

  let currentTab = 'relay'; // 'relay' | 'locations' | 'kanban' | 'catalog'
  let cachedContext = null;
  let searchTerm = '';
  let activeCategory = 'all';
  let relayInputValues = {}; // itemId -> string / number
  let relayPhotoBlob = null;
  let relayPhotoPreviewUrl = null;

  /**
   * Método público para cambiar de pestaña externamente (p.ej. desde roles tras iniciar turno)
   */
  const switchTab = (tab) => {
    currentTab = tab;
    render();
  };

  /**
   * Renderizado principal del panel de inventario
   */
  const render = async () => {
    const el = document.getElementById('panel-inventory');
    if (!el) return;

    Ui.skeleton(el);

    try {
      // Cargar contexto unificado mediante Api
      const [context, categoriesRes, rolesRes] = await Promise.all([
        Api.getSupplyPlanContext(),
        Api.getInventoryCategories(),
        Api.getCareRoles()
      ]);

      cachedContext = context;
      cachedContext.categories = categoriesRes.data || [];
      cachedContext.careRoles = rolesRes.data || [];

      const isAdmin = Auth.isAdmin();
      const userRole = (Auth.getProfile()?.appRole || Auth.getProfile()?.app_role || 'cuidador').toLowerCase();

      el.innerHTML = `
        <div class="section-header">
          <div class="section-title">📦 Gestión de Insumos</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="btn btn-secondary btn-sm" id="btn-quick-critical-count" title="Conteo rápido de insumos críticos">⚡ Conteo Críticos</button>
            ${isAdmin ? '<button class="btn btn-primary btn-sm" id="btn-add-item-modal">+ Insumo</button>' : ''}
          </div>
        </div>

        <!-- 4 Pestañas Principales (Fases 6..9) -->
        <div class="tabs" id="inv-main-tabs" style="margin-bottom:12px;overflow-x:auto;-webkit-overflow-scrolling:touch;">
          <button class="tab-btn ${currentTab === 'relay' ? 'active' : ''}" data-tab="relay">🏠 Relevo Habitación</button>
          <button class="tab-btn ${currentTab === 'locations' ? 'active' : ''}" data-tab="locations">📍 Otras Ubicaciones</button>
          <button class="tab-btn ${currentTab === 'kanban' ? 'active' : ''}" data-tab="kanban">🛒 Compras (Kanban)</button>
          <button class="tab-btn ${currentTab === 'catalog' ? 'active' : ''}" data-tab="catalog">⚙️ Catálogo</button>
        </div>

        <div id="inv-tab-content">
          <!-- El contenido de la pestaña se inserta aquí -->
        </div>
      `;

      bindMainTabEvents(el);

      const contentEl = el.querySelector('#inv-tab-content');
      if (currentTab === 'relay') {
        await renderRelayTab(contentEl);
      } else if (currentTab === 'locations') {
        await renderLocationsTab(contentEl);
      } else if (currentTab === 'kanban') {
        await renderKanbanTab(contentEl);
      } else if (currentTab === 'catalog') {
        await renderCatalogTab(contentEl);
      }
    } catch (err) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">Error al cargar insumos: ${Api.escapeHtml(err.message)}</div>
          <button class="btn btn-secondary btn-sm" id="inv-retry-btn" style="margin-top:12px;">Reintentar</button>
        </div>
      `;
      document.getElementById('inv-retry-btn')?.addEventListener('click', render);
    }
  };

  /**
   * Enlaza navegación de pestañas y botones superiores
   */
  const bindMainTabEvents = (el) => {
    el.querySelectorAll('#inv-main-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab && tab !== currentTab) {
          currentTab = tab;
          render();
        }
      });
    });

    el.querySelector('#btn-quick-critical-count')?.addEventListener('click', showQuickCriticalModal);
    el.querySelector('#btn-add-item-modal')?.addEventListener('click', () => showItemModal());
  };

  // ═══════════════════════════════════════════════════════════════
  // PESTAÑA 1: RELEVO DE HABITACIÓN (Fase 6)
  // ═══════════════════════════════════════════════════════════════
  const renderRelayTab = async (container) => {
    const items = cachedContext.items || [];
    const stockRows = cachedContext.stockRows || [];
    const usageLoc = (cachedContext.locations || []).find(l => l.isUsagePoint) || { id: 'loc_hab', name: 'Habitación' };

    // Filtrar insumos que tienen punto de uso aquí
    const roomItems = items.filter(i => (i.primaryLocationId || 'loc_hab') === usageLoc.id);
    const stockMap = new Map();
    stockRows.filter(s => s.locationId === usageLoc.id).forEach(s => {
      stockMap.set(s.itemId, s.effectiveStock);
    });

    const profiles = (await Api.getProfiles()).data || [];
    const currentProfile = Auth.getProfile();

    container.innerHTML = `
      <!-- Cabecera de Relevo -->
      <div class="card" style="margin-bottom:12px;padding:12px;background:var(--bg-glass);">
        <div style="font-weight:700;font-size:0.95rem;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
          <span>📋 Registro de Relevo — ${Api.escapeHtml(usageLoc.name)}</span>
          <span class="badge badge-info" style="font-size:0.7rem;">Punto de uso</span>
        </div>
        <p class="text-xs text-muted" style="margin-bottom:10px;">
          Ingresa la cantidad contada en cada casilla. <em>Dejar una casilla vacía se registra como OMITIDO</em> (no pone en cero el stock).
        </p>

        <div class="form-row">
          <div class="form-group" style="margin-bottom:6px;">
            <label class="form-label" for="relay-delivered-by">Entrega guardia</label>
            <select class="form-select" id="relay-delivered-by" style="font-size:0.8rem;padding:4px 8px;">
              <option value="">(Seleccionar entregador)</option>
              ${profiles.map(p => `
                <option value="${Api.escapeHtml(p.id)}">${Api.escapeHtml(p.fullName)}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label class="form-label" for="relay-received-by">Recibe guardia *</label>
            <select class="form-select" id="relay-received-by" style="font-size:0.8rem;padding:4px 8px;">
              ${profiles.map(p => `
                <option value="${Api.escapeHtml(p.id)}" ${p.id === currentProfile?.id ? 'selected' : ''}>
                  ${Api.escapeHtml(p.fullName)}${p.id === currentProfile?.id ? ' (Tú)' : ''}
                </option>
              `).join('')}
            </select>
          </div>
        </div>

        <!-- Captura de Foto Opcional (RNF-04) -->
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);">
          <input type="file" id="relay-photo-input" accept="image/*" capture="environment" style="display:none;">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-relay-photo" style="min-height:36px;">
            📷 ${relayPhotoBlob ? 'Cambiar Foto' : 'Foto del Relevo (opcional)'}
          </button>
          <div id="relay-photo-preview" style="display:${relayPhotoBlob ? 'flex' : 'none'};align-items:center;gap:6px;">
            <img src="${relayPhotoPreviewUrl || ''}" alt="Foto relevo" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid var(--border-color);">
            <button type="button" class="btn btn-ghost btn-sm text-critical" id="btn-remove-photo" style="padding:2px 4px;">✕</button>
          </div>
        </div>
      </div>

      <!-- Lista de Insumos a Contar -->
      <div id="relay-items-list">
        ${roomItems.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">🏠</div>
            <div class="empty-text">No hay insumos asignados a la habitación.</div>
          </div>
        ` : roomItems.map(item => {
          const current = stockMap.get(item.id) ?? 0;
          const isCrit = !!item.isCritical;
          const statusCls = current === 0 ? 'critical' : (current <= item.minThreshold ? 'alert' : 'stable');
          const pill = item.medicationId ? '💊 ' : '';
          const prevVal = relayInputValues[item.id] !== undefined ? relayInputValues[item.id] : '';

          return `
            <div class="card" style="margin-bottom:8px;padding:10px 12px;border-left:4px solid var(--${statusCls});" data-item-id="${Api.escapeHtml(item.id)}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                  <div style="font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:6px;">
                    <span>${pill}${Api.escapeHtml(item.name)}</span>
                    ${isCrit ? '<span class="badge badge-emergency" style="font-size:0.65rem;">CRÍTICO</span>' : ''}
                    ${item.stockControl === 'conteo' ? '<span class="badge badge-info" style="font-size:0.65rem;">Conteo</span>' : ''}
                  </div>
                  <div class="text-xs text-muted" style="margin-top:2px;">
                    Stock registrado: <strong>${current}</strong> ${Api.escapeHtml(item.unit || '')}
                    ${item.minThreshold > 0 ? ` · Mín: ${item.minThreshold}` : ''}
                  </div>
                </div>

                <!-- Input táctil grande -->
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                  <div style="display:flex;align-items:center;gap:4px;">
                    <input type="number" class="form-input relay-count-input" data-item-id="${Api.escapeHtml(item.id)}" data-prev-stock="${current}" min="0" step="1" placeholder="—" value="${prevVal}" style="width:75px;text-align:center;font-weight:700;font-size:1.1rem;padding:6px 4px;min-height:44px;">
                    <span style="font-size:0.8rem;color:var(--text-sec);">${Api.escapeHtml(item.unit || '')}</span>
                  </div>
                  <div class="plausibility-warning text-xs text-critical" id="warn-${Api.escapeHtml(item.id)}" style="display:none;font-weight:600;"></div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Notas y Botón de Finalizar Relevo -->
      <div class="card" style="margin-top:12px;padding:12px;">
        <div class="form-group" style="margin-bottom:8px;">
          <label class="form-label" for="relay-notes">Observaciones del Relevo</label>
          <textarea class="form-textarea" id="relay-notes" rows="2" placeholder="Novedades, traslados realizados o indicaciones entre guardias..."></textarea>
        </div>
        <button class="btn btn-primary" id="btn-save-relay-full" style="width:100%;min-height:48px;font-size:1rem;font-weight:700;">
          ✅ Completar Relevo de Habitación
        </button>
      </div>
    `;

    bindRelayEvents(container, roomItems, stockMap);
  };

  /**
   * Enlazar eventos del Relevo de Habitación
   */
  const bindRelayEvents = (container, roomItems, stockMap) => {
    // Foto
    const fileInput = container.querySelector('#relay-photo-input');
    const photoBtn = container.querySelector('#btn-relay-photo');
    const previewEl = container.querySelector('#relay-photo-preview');
    const previewImg = previewEl?.querySelector('img');
    const removePhotoBtn = container.querySelector('#btn-remove-photo');

    photoBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      relayPhotoBlob = file;
      if (relayPhotoPreviewUrl) URL.revokeObjectURL(relayPhotoPreviewUrl);
      relayPhotoPreviewUrl = URL.createObjectURL(file);
      if (previewImg) previewImg.src = relayPhotoPreviewUrl;
      if (previewEl) previewEl.style.display = 'flex';
      photoBtn.innerHTML = '📷 Cambiar Foto';
    });

    removePhotoBtn?.addEventListener('click', () => {
      relayPhotoBlob = null;
      if (relayPhotoPreviewUrl) URL.revokeObjectURL(relayPhotoPreviewUrl);
      relayPhotoPreviewUrl = null;
      if (previewEl) previewEl.style.display = 'none';
      if (photoBtn) photoBtn.innerHTML = '📷 Foto del Relevo (opcional)';
      if (fileInput) fileInput.value = '';
    });

    // Inputs con validación de plausibilidad en vivo
    container.querySelectorAll('.relay-count-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const itemId = input.getAttribute('data-item-id');
        const prevStock = parseFloat(input.getAttribute('data-prev-stock')) || 0;
        const valStr = input.value.trim();
        relayInputValues[itemId] = valStr;

        const warnEl = document.getElementById(`warn-${itemId}`);
        if (!warnEl) return;

        if (valStr === '') {
          warnEl.style.display = 'none';
          return;
        }

        const enteredQty = parseFloat(valStr);
        if (isNaN(enteredQty) || enteredQty < 0) {
          warnEl.textContent = 'Cantidad inválida';
          warnEl.style.display = 'block';
          return;
        }

        const plausibility = InventoryCalc.checkRelayPlausibility(prevStock, enteredQty);
        if (!plausibility.plausible) {
          warnEl.textContent = `⚠️ ¿${enteredQty}? (${plausibility.reason})`;
          warnEl.style.display = 'block';
        } else {
          warnEl.style.display = 'none';
        }
      });
    });

    // Completar Relevo
    container.querySelector('#btn-save-relay-full')?.addEventListener('click', async () => {
      const receivedBy = container.querySelector('#relay-received-by')?.value;
      const deliveredBy = container.querySelector('#relay-delivered-by')?.value || null;
      const notes = container.querySelector('#relay-notes')?.value?.trim() || '';

      if (!receivedBy) {
        Ui.toast('Selecciona quién recibe la guardia', 'warning');
        return;
      }

      const clientEventId = Api.nowISO() + '_' + Math.random().toString(36).slice(2, 7);
      const lines = [];
      const movements = [];
      let omittedCount = 0;
      let countsCount = 0;

      for (const item of roomItems) {
        const valStr = relayInputValues[item.id];
        const prevStock = stockMap.get(item.id) ?? 0;

        if (valStr === undefined || valStr === '') {
          // OMITIDO (no es cero)
          omittedCount++;
          lines.push({
            itemId: item.id,
            locationId: 'loc_hab',
            stockState: 'full',
            countedQty: null,
            isOmitted: true,
            discrepancy: null
          });
        } else {
          const countedQty = parseFloat(valStr);
          if (isNaN(countedQty) || countedQty < 0) {
            Ui.toast(`Corrige la cantidad para ${item.name}`, 'warning');
            return;
          }
          countsCount++;
          const discrepancy = countedQty - prevStock;
          lines.push({
            itemId: item.id,
            locationId: 'loc_hab',
            stockState: 'full',
            countedQty,
            isOmitted: false,
            discrepancy
          });

          // Movimiento de conteo físico para absorber y fijar el ledger
          movements.push({
            itemId: item.id,
            locationId: 'loc_hab',
            stockState: 'full',
            movementType: 'count',
            quantity: countedQty,
            qtyAbsolute: countedQty,
            note: 'Conteo en Relevo de Habitación',
            clientEventId: clientEventId + '_' + item.id
          });
        }
      }

      // Subir foto si existe
      let photoPath = null;
      if (relayPhotoBlob) {
        try {
          const photoRes = await Api.uploadRelayPhoto(clientEventId, relayPhotoBlob);
          if (photoRes && photoRes.ok) photoPath = photoRes.path || clientEventId;
        } catch (e) {
          console.warn('Error al guardar foto de relevo:', e);
        }
      }

      const payload = {
        relay: {
          occurredAt: Api.nowISO(),
          deliveredByProfileId: deliveredBy,
          receivedByProfileId: receivedBy,
          photoPath,
          clientEventId,
          countsCount,
          omittedCount,
          notes
        },
        lines,
        movements
      };

      const res = await Api.saveSupplyRelayFull(payload);
      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return;
      }

      Ui.toast(`Relevo completado: ${countsCount} contados, ${omittedCount} omitidos`, 'success');
      relayInputValues = {};
      relayPhotoBlob = null;
      if (relayPhotoPreviewUrl) URL.revokeObjectURL(relayPhotoPreviewUrl);
      relayPhotoPreviewUrl = null;

      render();
      DashboardModule?.render();
    });
  };

  // ═══════════════════════════════════════════════════════════════
  // PESTAÑA 2: OTRAS UBICACIONES Y TRASLADOS (Fase 7)
  // ═══════════════════════════════════════════════════════════════
  const renderLocationsTab = async (container) => {
    const locations = cachedContext.locations || [];
    const items = cachedContext.items || [];
    const stockRows = cachedContext.stockRows || [];
    const itemsMap = new Map(items.map(i => [i.id, i]));

    // Agrupar filas de stock por ubicación
    const stockByLoc = new Map();
    stockRows.forEach(s => {
      if (!stockByLoc.has(s.locationId)) stockByLoc.set(s.locationId, []);
      stockByLoc.get(s.locationId).push(s);
    });

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span class="card-title" style="margin:0;">📍 UBICACIONES Y STOCK</span>
        <button class="btn btn-secondary btn-sm" id="btn-manage-locations">⚙️ Gestionar Ubicaciones</button>
      </div>

      <div id="locations-accordion-list">
        ${locations.map(loc => {
          const locStocks = stockByLoc.get(loc.id) || [];
          const activeStocks = locStocks.filter(s => s.effectiveStock > 0);
          const isUsage = !!loc.isUsagePoint;
          const isDefault = !!loc.isDefaultRestock;
          const badgeText = isUsage ? 'Punto de uso' : (isDefault ? 'Almacén por defecto' : 'Almacén');

          return `
            <div class="card" style="margin-bottom:10px;padding:0;overflow:hidden;">
              <div class="loc-hdr" data-loc-id="${Api.escapeHtml(loc.id)}" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--bg-glass);cursor:pointer;user-select:none;">
                <div>
                  <div style="font-weight:700;font-size:1rem;display:flex;align-items:center;gap:6px;">
                    <span>${loc.name}</span>
                    <span class="badge ${isUsage ? 'badge-info' : 'badge-inactive'}" style="font-size:0.65rem;">${badgeText}</span>
                  </div>
                  <div class="text-xs text-muted" style="margin-top:2px;">
                    ${activeStocks.length} insumo${activeStocks.length !== 1 ? 's' : ''} con stock · Revisión c/${loc.reviewFrequencyHours || 50}h
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <button class="btn btn-ghost btn-sm btn-transfer-from-loc" data-loc-id="${Api.escapeHtml(loc.id)}" data-loc-name="${Api.escapeHtml(loc.name)}" title="Trasladar insumos">⇄ Trasladar</button>
                  <span class="loc-chevron">▼</span>
                </div>
              </div>

              <!-- Contenido desplegable -->
              <div class="loc-body" id="loc-body-${Api.escapeHtml(loc.id)}" style="padding:10px 14px;border-top:1px solid var(--border-subtle);">
                ${locStocks.length === 0 ? `
                  <div class="text-xs text-muted" style="padding:6px 0;">Sin stock registrado en esta ubicación.</div>
                ` : `
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    ${locStocks.map(s => {
                      const item = itemsMap.get(s.itemId) || {};
                      const pill = item.medicationId ? '💊 ' : '';
                      return `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-subtle);">
                          <div>
                            <div style="font-weight:600;font-size:0.9rem;">${pill}${Api.escapeHtml(item.name || 'Insumo')}</div>
                            <div class="text-xs text-muted">Estado: ${s.stockState === 'empty' ? 'Vacío' : 'Lleno'}</div>
                          </div>
                          <div style="display:flex;align-items:center;gap:10px;">
                            <span style="font-weight:700;font-size:1rem;">${s.effectiveStock} <span style="font-size:0.8rem;font-weight:400;color:var(--text-sec);">${Api.escapeHtml(item.unit || '')}</span></span>
                            ${!isUsage ? `
                              <button class="btn btn-secondary btn-sm btn-quick-bring" data-item-id="${Api.escapeHtml(item.id)}" data-from-loc="${Api.escapeHtml(loc.id)}" title="Traer a la habitación" style="padding:3px 8px;font-size:0.75rem;">
                                Traer a habitación
                              </button>
                            ` : ''}
                            ${item.isPao ? `
                              <button class="btn btn-ghost btn-sm btn-open-pao" data-item-id="${Api.escapeHtml(item.id)}" data-loc-id="${Api.escapeHtml(loc.id)}" title="Abrir nuevo envase (PAO)" style="padding:3px 8px;font-size:0.75rem;">
                                🧴 Abrir
                              </button>
                            ` : ''}
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    bindLocationsEvents(container);
  };

  /**
   * Enlazar eventos de la pestaña Ubicaciones
   */
  const bindLocationsEvents = (container) => {
    container.querySelector('#btn-manage-locations')?.addEventListener('click', showLocationsModal);

    // Accordions
    container.querySelectorAll('.loc-hdr').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        if (e.target.closest('.btn-transfer-from-loc')) return;
        const locId = hdr.getAttribute('data-loc-id');
        const body = document.getElementById(`loc-body-${locId}`);
        if (body) {
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
        }
      });
    });

    // Traer a habitación rápido
    container.querySelectorAll('.btn-quick-bring').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-item-id');
        const fromLoc = btn.getAttribute('data-from-loc');
        const item = (cachedContext.items || []).find(i => i.id === itemId);
        if (item) showTransferModal(item, fromLoc, 'loc_hab');
      });
    });

    // Abrir envase PAO
    container.querySelectorAll('.btn-open-pao').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-item-id');
        const locId = btn.getAttribute('data-loc-id');
        const item = (cachedContext.items || []).find(i => i.id === itemId);
        if (item) showOpenContainerModal(item, locId);
      });
    });

    // Botón general de trasladar
    container.querySelectorAll('.btn-transfer-from-loc').forEach(btn => {
      btn.addEventListener('click', () => {
        const locId = btn.getAttribute('data-loc-id');
        showGenericTransferModal(locId);
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════
  // PESTAÑA 3: COMPRAS KANBAN (Fase 8)
  // ═══════════════════════════════════════════════════════════════
  const renderKanbanTab = async (container) => {
    // Generar plan de compras usando el motor InventoryCalc
    const plan = InventoryCalc.buildSupplyPlan(cachedContext);
    const delayedOrders = InventoryCalc.detectDelayedOrders(
      cachedContext.openOrderLines || [],
      cachedContext.suppliers || [],
      Api.nowISO()
    );

    const pendingOrders = cachedContext.openOrderLines || [];
    const settings = (await Api.getSettings()).data || {};
    const patientName = settings.patientName || 'El Paciente';

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span class="card-title" style="margin:0;">🛒 KANBAN DE COMPRAS Y REPOSICIÓN</span>
        <button class="btn btn-secondary btn-sm" id="btn-create-order-batch">+ Crear Pedido Manual</button>
      </div>

      <!-- Alertas de retraso / huérfanos -->
      ${delayedOrders.length > 0 ? `
        <div class="card emergency" style="margin-bottom:12px;padding:10px 12px;border-left:4px solid var(--critical);">
          <div style="font-weight:700;color:var(--critical);font-size:0.85rem;">⚠️ PEDIDOS CON RETRASO (${delayedOrders.length})</div>
          <div class="text-xs text-sec" style="margin-top:2px;">
            Los siguientes pedidos han superado el plazo estimado de entrega. Revisa con el proveedor:
          </div>
          <ul style="margin:6px 0 0 16px;padding:0;font-size:0.75rem;">
            ${delayedOrders.map(d => `
              <li><strong>${Api.escapeHtml(d.supplierName || 'Proveedor')}</strong>: ${d.linesCount} líneas pedidas hace ${Math.round(d.hoursWaiting)}h.</li>
            `).join('')}
          </ul>
        </div>
      ` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;">
        <!-- Columna 1: Por Pedir (Sugerencias del Motor) -->
        <div class="card" style="padding:12px;background:var(--bg-glass);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:2px solid var(--accent);padding-bottom:6px;">
            <span style="font-weight:700;font-size:0.95rem;">📋 POR PEDIR (${plan.lines.length})</span>
            <span class="badge badge-info" style="font-size:0.7rem;">Sugerido</span>
          </div>

          ${plan.lines.length === 0 ? `
            <div class="empty-state" style="padding:20px 0;">
              <div class="empty-icon">✅</div>
              <div class="empty-text">Todos los insumos tienen stock suficiente.<br>No se requieren compras inmediatas.</div>
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${plan.lines.map(line => {
                const isCrit = line.urgency === 'critical';
                const pill = line.isMedication ? '💊 ' : '';
                return `
                  <div class="card" style="padding:8px 10px;border-left:3px solid ${isCrit ? 'var(--critical)' : 'var(--alert)'};background:var(--bg-card);">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                      <div>
                        <div style="font-weight:700;font-size:0.9rem;">${pill}${Api.escapeHtml(line.itemName)}</div>
                        <div class="text-xs text-muted">${Api.escapeHtml(line.supplierName || 'Farmacia')}</div>
                        <div class="text-xs text-alert" style="margin-top:2px;">
                          Pedir: <strong>${line.suggestedQtyPurchase} ${Api.escapeHtml(line.orderUnit)}</strong> (${line.suggestedQtyBase} ${Api.escapeHtml(line.baseUnit)})
                        </div>
                        <div class="text-xs text-muted" style="margin-top:2px;">Motivo: ${Api.escapeHtml(line.reason)}</div>
                      </div>
                    </div>
                    <div style="display:flex;gap:6px;margin-top:8px;">
                      <button class="btn btn-secondary btn-sm btn-order-whatsapp" data-item-id="${Api.escapeHtml(line.itemId)}" data-supplier-id="${Api.escapeHtml(line.supplierId)}" style="flex:1;font-size:0.75rem;">
                        💬 WhatsApp
                      </button>
                      <button class="btn btn-primary btn-sm btn-mark-in-transit" data-item-id="${Api.escapeHtml(line.itemId)}" data-supplier-id="${Api.escapeHtml(line.supplierId)}" data-qty="${line.suggestedQtyPurchase}" data-unit="${Api.escapeHtml(line.orderUnit)}" style="flex:1;font-size:0.75rem;">
                        🚚 En camino
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <!-- Columna 2: En Camino (in_transit) -->
        <div class="card" style="padding:12px;background:var(--bg-glass);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:2px solid var(--alert);padding-bottom:6px;">
            <span style="font-weight:700;font-size:0.95rem;">🚚 EN CAMINO (${pendingOrders.length})</span>
            <span class="badge badge-warning" style="font-size:0.7rem;">Pendiente</span>
          </div>

          ${pendingOrders.length === 0 ? `
            <div class="empty-state" style="padding:20px 0;">
              <div class="empty-icon">📦</div>
              <div class="empty-text">No hay pedidos en camino en este momento.</div>
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${pendingOrders.map(order => `
                <div class="card" style="padding:8px 10px;border-left:3px solid var(--accent);background:var(--bg-card);">
                  <div style="font-weight:700;font-size:0.9rem;">${Api.escapeHtml(order.itemName || 'Insumo')}</div>
                  <div class="text-xs text-muted">
                    Proveedor: <strong>${Api.escapeHtml(order.supplierName || 'Proveedor')}</strong>
                  </div>
                  <div class="text-xs text-sec" style="margin-top:2px;">
                    Cantidad: <strong>${order.orderedQtyPurchase || 1} ${Api.escapeHtml(order.unit || '')}</strong>
                    · Destino: ${Api.escapeHtml(order.targetLocationName || 'Almacén')}
                  </div>
                  <div class="text-xs text-muted" style="margin-top:2px;">
                    Pedido: ${Api.timeAgo(order.orderedAt)}
                  </div>
                  <div style="display:flex;gap:6px;margin-top:8px;">
                    <button class="btn btn-primary btn-sm btn-receive-line" data-line-id="${Api.escapeHtml(order.id)}" style="flex:1;font-size:0.75rem;">
                      📦 Recibir
                    </button>
                    <button class="btn btn-ghost btn-sm text-critical btn-cancel-line" data-line-id="${Api.escapeHtml(order.id)}" style="font-size:0.75rem;">
                      ✕ Cancelar
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    bindKanbanEvents(container, patientName);
  };

  /**
   * Enlazar eventos del Kanban
   */
  const bindKanbanEvents = (container, patientName) => {
    container.querySelector('#btn-create-order-batch')?.addEventListener('click', showCreateOrderBatchModal);

    // Marcar en camino
    container.querySelectorAll('.btn-mark-in-transit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const supplierId = btn.getAttribute('data-supplier-id');
        const qty = parseFloat(btn.getAttribute('data-qty')) || 1;

        const res = await Api.markSupplyInTransit(supplierId, [{
          itemId,
          orderedQtyPurchase: qty,
          orderedQtyBase: qty
        }], Api.nowISO());

        if (res && res.conflict) {
          Ui.toast('Este insumo ya se encuentra en camino por otro cuidador.', 'warning');
          return;
        }
        if (res && res.error) {
          Ui.toast(res.error, 'error');
          return;
        }

        Ui.toast('Insumo marcado como en camino', 'success');
        render();
      });
    });

    // Pedir por WhatsApp
    container.querySelectorAll('.btn-order-whatsapp').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-item-id');
        const supplierId = btn.getAttribute('data-supplier-id');
        const supplier = (cachedContext.suppliers || []).find(s => s.id === supplierId) || { name: 'Farmacia', whatsapp: '' };
        const item = (cachedContext.items || []).find(i => i.id === itemId);

        const lines = [{
          itemName: item?.name || 'Insumo',
          suggestedQtyPurchase: 1,
          orderUnit: item?.orderUnit || 'unidad'
        }];

        const url = InventoryCalc.formatWhatsAppOrderMessage(supplier, lines, patientName);
        window.open(url, '_blank');
      });
    });

    // Recibir pedido
    container.querySelectorAll('.btn-receive-line').forEach(btn => {
      btn.addEventListener('click', () => {
        const lineId = btn.getAttribute('data-line-id');
        const line = (cachedContext.openOrderLines || []).find(l => l.id === lineId);
        if (line) showReceiveOrderModal(line);
      });
    });

    // Cancelar pedido
    container.querySelectorAll('.btn-cancel-line').forEach(btn => {
      btn.addEventListener('click', () => {
        const lineId = btn.getAttribute('data-line-id');
        showCancelOrderModal(lineId);
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════
  // PESTAÑA 4: CATÁLOGO Y AJUSTES RÁPIDOS (Fase 9)
  // ═══════════════════════════════════════════════════════════════
  const renderCatalogTab = async (container) => {
    const items = cachedContext.items || [];
    const categories = cachedContext.categories || [];
    const stockRows = cachedContext.stockRows || [];
    const locations = cachedContext.locations || [];
    const locMap = new Map(locations.map(l => [l.id, l]));

    // Calcular stock total de cada ítem
    const totalStockMap = new Map();
    stockRows.forEach(s => {
      const cur = totalStockMap.get(s.itemId) || 0;
      totalStockMap.set(s.itemId, cur + Number(s.effectiveStock));
    });

    const filtered = items
      .filter(i => activeCategory === 'all' || i.categoryName === activeCategory)
      .filter(i => !searchTerm || i.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const isAdmin = Auth.isAdmin();

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span class="card-title" style="margin:0;">⚙️ CATÁLOGO DE INSUMOS (${items.length})</span>
        <div style="display:flex;gap:6px;">
          ${isAdmin ? '<button class="btn btn-secondary btn-sm" id="btn-manage-suppliers">Proveedores</button>' : ''}
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="btn-add-item-catalog">+ Insumo</button>' : ''}
        </div>
      </div>

      <!-- Barra de búsqueda y categorías -->
      <div class="search-wrap" style="margin-bottom:8px;">
        <span class="search-icon">🔍</span>
        <input class="search-input" id="cat-search" placeholder="Buscar insumo por nombre..." value="${Api.escapeHtml(searchTerm)}">
      </div>

      <div class="chip-row" style="overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;padding-bottom:4px;margin-bottom:12px;">
        <div class="chip ${activeCategory === 'all' ? 'active' : ''}" data-cat="all">Todos (${items.length})</div>
        ${categories.map(c => `
          <div class="chip ${activeCategory === c.name ? 'active' : ''}" data-cat="${Api.escapeHtml(c.name)}">
            ${Api.escapeHtml(c.name)}
          </div>
        `).join('')}
      </div>

      <!-- Lista de insumos -->
      <div id="catalog-items-list">
        ${filtered.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <div class="empty-text">Sin insumos registrados para este filtro.</div>
          </div>
        ` : filtered.map(item => {
          const totalStock = totalStockMap.get(item.id) ?? item.currentStock ?? 0;
          const isCrit = !!item.isCritical;
          const isLow = totalStock <= (item.minThreshold || 0);
          const statusCls = totalStock === 0 ? 'critical' : (isLow ? 'alert' : 'stable');
          const pill = item.medicationId ? '💊 ' : '';
          const primaryLoc = locMap.get(item.primaryLocationId)?.name || 'Habitación';
          const reserveLoc = locMap.get(item.reserveLocationId)?.name || 'Almacén';

          return `
            <div class="card" style="margin-bottom:8px;padding:10px 12px;border-left:4px solid var(--${statusCls});">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                  <div style="font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:6px;">
                    <span>${pill}${Api.escapeHtml(item.name)}</span>
                    ${isCrit ? '<span class="badge badge-emergency" style="font-size:0.65rem;">CRÍTICO</span>' : ''}
                    ${item.stockControl === 'conteo' ? '<span class="badge badge-info" style="font-size:0.65rem;">Conteo</span>' : ''}
                  </div>
                  <div class="text-xs text-muted" style="margin-top:2px;">
                    ${Api.escapeHtml(primaryLoc)} · Reserva: ${Api.escapeHtml(reserveLoc)}
                    ${item.minThreshold > 0 ? ` · Mín: ${item.minThreshold}` : ''}
                    ${item.optimalStock > 0 ? ` · Óptimo: ${item.optimalStock}` : ''}
                  </div>
                </div>

                <!-- Ajustes rápidos de 3 toques (+, -) -->
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-weight:700;font-size:1.05rem;">${totalStock} <span style="font-size:0.8rem;font-weight:400;color:var(--text-sec);">${Api.escapeHtml(item.unit || '')}</span></span>
                  <div style="display:flex;gap:2px;">
                    <button class="btn btn-secondary btn-sm btn-spot-adj" data-item-id="${Api.escapeHtml(item.id)}" data-delta="-1" style="min-width:32px;padding:2px 6px;">−</button>
                    <button class="btn btn-secondary btn-sm btn-spot-adj" data-item-id="${Api.escapeHtml(item.id)}" data-delta="1" style="min-width:32px;padding:2px 6px;">+</button>
                  </div>
                  <button class="btn btn-ghost btn-sm btn-edit-item" data-item-id="${Api.escapeHtml(item.id)}" title="Editar">✏️</button>
                  ${isAdmin ? `
                    <button class="btn btn-ghost btn-sm text-critical btn-del-item" data-item-id="${Api.escapeHtml(item.id)}" data-name="${Api.escapeHtml(item.name)}" title="Eliminar">🗑</button>
                  ` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    bindCatalogEvents(container);
  };

  /**
   * Enlazar eventos del Catálogo
   */
  const bindCatalogEvents = (container) => {
    container.querySelector('#cat-search')?.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      render();
    });

    container.querySelectorAll('.chip[data-cat]').forEach(chip => {
      chip.addEventListener('click', () => {
        activeCategory = chip.getAttribute('data-cat') || 'all';
        render();
      });
    });

    container.querySelector('#btn-add-item-catalog')?.addEventListener('click', () => showItemModal());
    container.querySelector('#btn-manage-suppliers')?.addEventListener('click', showSuppliersModal);

    // Ajustes rápidos (+, -)
    container.querySelectorAll('.btn-spot-adj').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const delta = parseFloat(btn.getAttribute('data-delta')) || 0;
        const res = await Api.recordSupplyMovements([{
          itemId,
          locationId: 'loc_hab',
          stockState: 'full',
          movementType: 'adjust',
          quantity: delta,
          note: delta > 0 ? 'Ajuste rápido (+)' : 'Ajuste rápido (−)'
        }]);

        if (res && res.error) {
          Ui.toast(res.error, 'error');
          return;
        }
        Ui.toast('Stock actualizado', 'info');
        render();
      });
    });

    // Editar ítem
    container.querySelectorAll('.btn-edit-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-item-id');
        const item = (cachedContext.items || []).find(i => i.id === itemId);
        if (item) showItemModal(item);
      });
    });

    // Eliminar ítem
    container.querySelectorAll('.btn-del-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-item-id');
        const name = btn.getAttribute('data-name');
        Ui.confirm('¿Eliminar insumo?', `Se eliminará "${name}" del catálogo.`, async () => {
          const res = await Api.deleteInventoryItem(itemId);
          if (res && res.error) {
            Ui.toast(res.error, 'error');
            return;
          }
          Ui.toast('Insumo eliminado', 'success');
          render();
        });
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════
  // MODALES Y ASISTENTES ESPECÍFICOS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Modal de Conteo Rápido de Críticos
   */
  const showQuickCriticalModal = async () => {
    if (!cachedContext) {
      cachedContext = await Api.getSupplyPlanContext();
    }
    const items = cachedContext.items || [];
    const stockRows = cachedContext.stockRows || [];
    const criticalItems = items.filter(i => i.isCritical);

    if (criticalItems.length === 0) {
      Ui.toast('No hay insumos marcados como críticos', 'info');
      return;
    }

    const stockMap = new Map();
    stockRows.filter(s => s.locationId === 'loc_hab').forEach(s => {
      stockMap.set(s.itemId, s.effectiveStock);
    });

    const html = `
      <p class="text-sm text-sec" style="margin-bottom:12px;">
        Verificación rápida de los insumos críticos en el punto de uso (Habitación):
      </p>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;">
        ${criticalItems.map(item => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:var(--bg-glass);border-radius:var(--radius-sm);border:1px solid var(--border-subtle);">
            <div>
              <div style="font-weight:700;font-size:0.9rem;">${item.medicationId ? '💊 ' : ''}${Api.escapeHtml(item.name)}</div>
              <div class="text-xs text-muted">Stock actual: ${stockMap.get(item.id) ?? 0} ${Api.escapeHtml(item.unit || '')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;">
              <input type="number" class="form-input qc-crit-input" data-item-id="${Api.escapeHtml(item.id)}" min="0" step="1" value="${stockMap.get(item.id) ?? 0}" style="width:70px;text-align:center;font-weight:700;">
              <span class="text-xs text-sec">${Api.escapeHtml(item.unit || '')}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    Ui.showModal('⚡ Conteo Rápido de Críticos', html, async () => {
      const inputs = document.querySelectorAll('.qc-crit-input');
      const movements = [];

      for (const input of inputs) {
        const itemId = input.getAttribute('data-item-id');
        const qty = parseFloat(input.value);
        if (isNaN(qty) || qty < 0) continue;

        movements.push({
          itemId,
          locationId: 'loc_hab',
          stockState: 'full',
          movementType: 'count',
          quantity: qty,
          qtyAbsolute: qty,
          note: 'Conteo rápido de críticos'
        });
      }

      if (movements.length > 0) {
        const res = await Api.recordSupplyMovements(movements);
        if (res && res.error) {
          Ui.toast(res.error, 'error');
          return false;
        }
        Ui.toast('Conteo de críticos registrado', 'success');
        render();
        DashboardModule?.render();
      }
      return true;
    });
  };

  /**
   * Modal de Traslado (Reserva -> Punto de Uso o entre ubicaciones)
   */
  const showTransferModal = (item, fromLocId, toLocId) => {
    const locations = cachedContext.locations || [];
    const stockRows = cachedContext.stockRows || [];
    const fromLoc = locations.find(l => l.id === fromLocId) || { name: 'Almacén' };
    const toLoc = locations.find(l => l.id === toLocId) || { name: 'Habitación' };

    const availStock = (stockRows.find(s => s.itemId === item.id && s.locationId === fromLocId)?.effectiveStock) ?? 0;
    const destStock = (stockRows.find(s => s.itemId === item.id && s.locationId === toLocId)?.effectiveStock) ?? 0;

    const suggested = InventoryCalc.suggestTransfer(item, availStock, destStock);

    const html = `
      <div class="form-group">
        <label class="form-label">Insumo</label>
        <div style="font-weight:700;">${item.medicationId ? '💊 ' : ''}${Api.escapeHtml(item.name)}</div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Origen</label>
          <div style="font-size:0.9rem;">${Api.escapeHtml(fromLoc.name)} (Disp: <strong>${availStock}</strong>)</div>
        </div>
        <div class="form-group">
          <label class="form-label">Destino</label>
          <div style="font-size:0.9rem;">${Api.escapeHtml(toLoc.name)} (Actual: <strong>${destStock}</strong>)</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="tr-qty">Cantidad a trasladar (${Api.escapeHtml(item.unit || 'unidades')}) *</label>
        <input class="form-input" id="tr-qty" type="number" min="1" max="${availStock}" value="${suggested.suggestedQty || 1}" required autofocus>
        ${suggested.reason ? `<div class="text-xs text-muted" style="margin-top:2px;">Sugerencia del sistema: ${Api.escapeHtml(suggested.reason)}</div>` : ''}
      </div>
      <div class="form-group">
        <label class="form-label" for="tr-note">Nota de traslado</label>
        <input class="form-input" id="tr-note" placeholder="Ej: Reposición diaria a habitación" value="Traslado a punto de uso">
      </div>
    `;

    Ui.showModal(`⇄ Trasladar a ${toLoc.name}`, html, async () => {
      const qty = parseFloat(document.getElementById('tr-qty')?.value);
      const note = document.getElementById('tr-note')?.value?.trim() || 'Traslado';

      if (isNaN(qty) || qty <= 0) {
        Ui.toast('Ingresa una cantidad válida mayor a 0', 'warning');
        return false;
      }
      if (qty > availStock) {
        Ui.toast(`La cantidad excede el stock disponible en ${fromLoc.name} (${availStock})`, 'warning');
        return false;
      }

      const groupId = Api.nowISO() + '_' + Math.random().toString(36).slice(2, 6);
      const movements = [
        {
          itemId: item.id,
          locationId: fromLocId,
          stockState: 'full',
          movementType: 'transfer_out',
          quantity: -qty,
          note,
          groupId
        },
        {
          itemId: item.id,
          locationId: toLocId,
          stockState: 'full',
          movementType: 'transfer_in',
          quantity: qty,
          note,
          groupId
        }
      ];

      const res = await Api.recordSupplyMovements(movements);
      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(`Trasladados ${qty} ${item.unit || ''} a ${toLoc.name}`, 'success');
      render();
      return true;
    });
  };

  /**
   * Modal de Traslado Genérico desde una ubicación
   */
  const showGenericTransferModal = (fromLocId) => {
    const items = cachedContext.items || [];
    const locations = cachedContext.locations || [];
    const stockRows = cachedContext.stockRows || [];
    const fromLoc = locations.find(l => l.id === fromLocId);
    const destLocs = locations.filter(l => l.id !== fromLocId);

    const availableItems = items.filter(i => {
      const s = stockRows.find(sr => sr.itemId === i.id && sr.locationId === fromLocId);
      return s && s.effectiveStock > 0;
    });

    if (availableItems.length === 0) {
      Ui.toast(`No hay insumos con stock en ${fromLoc?.name || 'esta ubicación'}`, 'info');
      return;
    }

    const html = `
      <div class="form-group">
        <label class="form-label" for="gt-item">Selecciona insumo a trasladar</label>
        <select class="form-select" id="gt-item">
          ${availableItems.map(i => {
            const st = stockRows.find(s => s.itemId === i.id && s.locationId === fromLocId)?.effectiveStock || 0;
            return `<option value="${Api.escapeHtml(i.id)}">${i.name} (Disp: ${st} ${i.unit || ''})</option>`;
          }).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="gt-dest">Ubicación destino</label>
        <select class="form-select" id="gt-dest">
          ${destLocs.map(l => `<option value="${Api.escapeHtml(l.id)}">${l.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="gt-qty">Cantidad</label>
        <input class="form-input" id="gt-qty" type="number" min="1" value="1" required>
      </div>
    `;

    Ui.showModal(`⇄ Trasladar desde ${fromLoc?.name || 'Ubicación'}`, html, async () => {
      const itemId = document.getElementById('gt-item')?.value;
      const toLocId = document.getElementById('gt-dest')?.value;
      const qty = parseFloat(document.getElementById('gt-qty')?.value);

      if (!itemId || !toLocId || isNaN(qty) || qty <= 0) {
        Ui.toast('Verifica los datos del traslado', 'warning');
        return false;
      }

      const groupId = Api.nowISO() + '_' + Math.random().toString(36).slice(2, 6);
      const res = await Api.recordSupplyMovements([
        { itemId, locationId: fromLocId, stockState: 'full', movementType: 'transfer_out', quantity: -qty, groupId },
        { itemId, locationId: toLocId, stockState: 'full', movementType: 'transfer_in', quantity: qty, groupId }
      ]);

      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Traslado registrado con éxito', 'success');
      render();
      return true;
    });
  };

  /**
   * Modal de Apertura de Envase (PAO)
   */
  const showOpenContainerModal = (item, locationId) => {
    const html = `
      <div class="form-group">
        <label class="form-label">Insumo</label>
        <div style="font-weight:700;">🧴 ${Api.escapeHtml(item.name)}</div>
      </div>
      <p class="text-sm text-muted">
        Este producto tiene un período de validez tras su apertura (PAO: ${item.paoHours ? Math.round(item.paoHours / 24) + ' días' : 'definido'}).
        Al marcarlo como abierto, el sistema comenzará a monitorear su fecha límite de uso.
      </p>
    `;
    Ui.showModal('🧴 Abrir Envase (PAO)', html, async () => {
      const res = await Api.openContainer(item.id, locationId || 'loc_hab', Api.nowISO());
      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }
      Ui.toast('Envase registrado como abierto', 'success');
      render();
      return true;
    });
  };

  /**
   * Modal para Recibir Pedido (Full o Parcial con canje de cilindro y gasto)
   */
  const showReceiveOrderModal = (order) => {
    const locations = cachedContext.locations || [];
    const html = `
      <div class="form-group">
        <label class="form-label">Insumo</label>
        <div style="font-weight:700;font-size:1.05rem;">${Api.escapeHtml(order.itemName || 'Insumo')}</div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="rec-qty">Cantidad recibida (unidades base) *</label>
          <input class="form-input" id="rec-qty" type="number" min="1" value="${order.orderedQtyBase || 1}" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="rec-dest">Ubicación destino</label>
          <select class="form-select" id="rec-dest">
            ${locations.map(l => `
              <option value="${Api.escapeHtml(l.id)}" ${l.id === order.targetLocationId ? 'selected' : ''}>
                ${Api.escapeHtml(l.name)}
              </option>
            `).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="rec-cost">Costo total ($)</label>
          <input class="form-input" id="rec-cost" type="number" min="0" step="0.01" placeholder="0.00">
        </div>
        <div class="form-group">
          <label class="form-label" for="rec-cat">Categoría de gasto</label>
          <select class="form-select" id="rec-cat">
            <option value="Farmacia" selected>Farmacia</option>
            <option value="Gases Medicinales">Gases Medicinales</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="rec-empties">Cilindros vacíos entregados a cambio (canje)</label>
        <input class="form-input" id="rec-empties" type="number" min="0" value="0">
      </div>
    `;

    Ui.showModal(`📦 Recibir Pedido — ${order.itemName || ''}`, html, async () => {
      const recQty = parseFloat(document.getElementById('rec-qty')?.value);
      const destId = document.getElementById('rec-dest')?.value;
      const cost = parseFloat(document.getElementById('rec-cost')?.value) || 0;
      const cat = document.getElementById('rec-cat')?.value || 'Farmacia';
      const empties = parseFloat(document.getElementById('rec-empties')?.value) || 0;

      if (isNaN(recQty) || recQty <= 0) {
        Ui.toast('Ingresa una cantidad recibida válida', 'warning');
        return false;
      }

      const res = await Api.receiveSupplyOrderLine({
        lineId: order.id,
        receivedQtyBase: recQty,
        locationId: destId,
        emptiesSent: empties,
        cost,
        receivedAt: Api.nowISO()
      });

      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      // Si se especificó costo > 0, registrar gasto automáticamente (unificado Farmacia / Gases)
      if (cost > 0) {
        await Api.addExpense({
          description: `Compra: ${order.itemName || 'Insumo'} (${recQty} unid.)`,
          amount: cost,
          date: Api.todayStr(),
          category: cat
        });
      }

      Ui.toast('Recepción de pedido registrada', 'success');
      render();
      DashboardModule?.render();
      return true;
    });
  };

  /**
   * Modal para Cancelar Pedido
   */
  const showCancelOrderModal = (lineId) => {
    const html = `
      <div class="form-group">
        <label class="form-label" for="cn-reason">Motivo de cancelación *</label>
        <input class="form-input" id="cn-reason" placeholder="Ej: Proveedor sin stock, pedido duplicado..." required>
      </div>
    `;
    Ui.showModal('❌ Cancelar Pedido', html, async () => {
      const reason = document.getElementById('cn-reason')?.value?.trim();
      if (!reason) {
        Ui.toast('Ingresa el motivo de cancelación', 'warning');
        return false;
      }
      const res = await Api.cancelSupplyOrderLine(lineId, reason);
      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }
      Ui.toast('Línea de pedido cancelada', 'info');
      render();
      return true;
    });
  };

  /**
   * Modal para Crear Pedido Manual
   */
  const showCreateOrderBatchModal = () => {
    const suppliers = cachedContext.suppliers || [];
    const items = cachedContext.items || [];

    const html = `
      <div class="form-group">
        <label class="form-label" for="ob-supplier">Proveedor *</label>
        <select class="form-select" id="ob-supplier">
          ${suppliers.map(s => `<option value="${Api.escapeHtml(s.id)}">${Api.escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ob-item">Insumo a pedir *</label>
        <select class="form-select" id="ob-item">
          ${items.map(i => `<option value="${Api.escapeHtml(i.id)}">${i.name} (${i.orderUnit || i.unit || 'unid.'})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ob-qty">Cantidad a pedir</label>
        <input class="form-input" id="ob-qty" type="number" min="1" value="1" required>
      </div>
    `;

    Ui.showModal('🛒 Crear Pedido Manual', html, async () => {
      const supplierId = document.getElementById('ob-supplier')?.value;
      const itemId = document.getElementById('ob-item')?.value;
      const qty = parseFloat(document.getElementById('ob-qty')?.value);

      if (!supplierId || !itemId || isNaN(qty) || qty <= 0) {
        Ui.toast('Verifica los datos del pedido', 'warning');
        return false;
      }

      const res = await Api.markSupplyInTransit(supplierId, [{
        itemId,
        orderedQtyPurchase: qty,
        orderedQtyBase: qty
      }], Api.nowISO());

      if (res && res.conflict) {
        Ui.toast('Este insumo ya se encuentra en camino.', 'warning');
        return false;
      }
      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Pedido creado y marcado en camino', 'success');
      render();
      return true;
    });
  };

  /**
   * Modal para Agregar o Editar Insumo en Catálogo
   */
  const showItemModal = (item = null) => {
    const isEdit = !!item;
    const categories = cachedContext.categories || [];
    const locations = cachedContext.locations || [];
    const suppliers = cachedContext.suppliers || [];
    const careRoles = cachedContext.careRoles || [];
    const isAdmin = Auth.isAdmin();

    const html = `
      <div class="form-group">
        <label class="form-label" for="im-name">Nombre del insumo *</label>
        <input class="form-input" id="im-name" value="${Api.escapeHtml(item?.name || '')}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="im-cat">Categoría</label>
          <select class="form-select" id="im-cat">
            <option value="">(Sin categoría)</option>
            ${categories.map(c => `
              <option value="${Api.escapeHtml(c.id)}" ${item?.categoryId === c.id ? 'selected' : ''}>
                ${Api.escapeHtml(c.name)}
              </option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="im-unit">Unidad base *</label>
          <input class="form-input" id="im-unit" value="${Api.escapeHtml(item?.unit || 'unidad')}" placeholder="cápsulas, ml, unidades..." required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="im-order-unit">Unidad de compra</label>
          <input class="form-input" id="im-order-unit" value="${Api.escapeHtml(item?.orderUnit || 'caja')}" placeholder="caja, frasco, cilindro...">
        </div>
        <div class="form-group">
          <label class="form-label" for="im-units-order">Unidades por compra</label>
          <input class="form-input" id="im-units-order" type="number" min="1" value="${item?.unitsPerPurchase || 1}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="im-min">Umbral mínimo ${!isAdmin ? '🔒' : ''}</label>
          <input class="form-input" id="im-min" type="number" min="0" value="${item?.minThreshold ?? 0}" ${!isAdmin ? 'disabled' : ''}>
        </div>
        <div class="form-group">
          <label class="form-label" for="im-opt">Stock óptimo ${!isAdmin ? '🔒' : ''}</label>
          <input class="form-input" id="im-opt" type="number" min="0" value="${item?.optimalStock ?? 0}" ${!isAdmin ? 'disabled' : ''}>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="im-crit">¿Insumo crítico?</label>
          <select class="form-select" id="im-crit">
            <option value="false" ${!item?.isCritical ? 'selected' : ''}>No (Normal)</option>
            <option value="true" ${item?.isCritical ? 'selected' : ''}>Sí (Crítico - Revisión diaria)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="im-freq">Frecuencia revisión (horas) ${!isAdmin ? '🔒' : ''}</label>
          <input class="form-input" id="im-freq" type="number" min="1" value="${item?.reviewEveryHours || 50}" ${!isAdmin ? 'disabled' : ''}>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="im-primary-loc">Punto de uso (primaria)</label>
          <select class="form-select" id="im-primary-loc">
            ${locations.map(l => `
              <option value="${Api.escapeHtml(l.id)}" ${item?.primaryLocationId === l.id ? 'selected' : (l.isUsagePoint ? 'selected' : '')}>
                ${Api.escapeHtml(l.name)}
              </option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="im-reserve-loc">Almacén (reserva)</label>
          <select class="form-select" id="im-reserve-loc">
            ${locations.map(l => `
              <option value="${Api.escapeHtml(l.id)}" ${item?.reserveLocationId === l.id ? 'selected' : (l.isDefaultRestock ? 'selected' : '')}>
                ${Api.escapeHtml(l.name)}
              </option>
            `).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="im-supplier">Proveedor por defecto</label>
        <select class="form-select" id="im-supplier">
          <option value="">(Sin proveedor asignado)</option>
          ${suppliers.map(s => `
            <option value="${Api.escapeHtml(s.id)}" ${item?.supplierId === s.id ? 'selected' : ''}>
              ${Api.escapeHtml(s.name)}
            </option>
          `).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="im-notes">Notas / Instrucciones</label>
        <textarea class="form-textarea" id="im-notes">${Api.escapeHtml(item?.notes || '')}</textarea>
      </div>
    `;

    Ui.showModal(isEdit ? `✏️ Editar — ${item.name}` : '➕ Nuevo Insumo', html, async () => {
      const name = document.getElementById('im-name')?.value?.trim();
      const categoryId = document.getElementById('im-cat')?.value || null;
      const unit = document.getElementById('im-unit')?.value?.trim() || 'unidad';
      const orderUnit = document.getElementById('im-order-unit')?.value?.trim() || 'caja';
      const unitsPerPurchase = parseFloat(document.getElementById('im-units-order')?.value) || 1;
      const minThreshold = parseFloat(document.getElementById('im-min')?.value) || 0;
      const optimalStock = parseFloat(document.getElementById('im-opt')?.value) || 0;
      const isCritical = document.getElementById('im-crit')?.value === 'true';
      const reviewEveryHours = parseFloat(document.getElementById('im-freq')?.value) || (isCritical ? 26 : 50);
      const primaryLocationId = document.getElementById('im-primary-loc')?.value || 'loc_hab';
      const reserveLocationId = document.getElementById('im-reserve-loc')?.value || 'loc_arm';
      const supplierId = document.getElementById('im-supplier')?.value || null;
      const notes = document.getElementById('im-notes')?.value?.trim() || '';

      if (!name) {
        Ui.toast('El nombre del insumo es obligatorio', 'warning');
        return false;
      }

      const payload = {
        name,
        categoryId,
        unit,
        orderUnit,
        unitsPerPurchase,
        minThreshold,
        optimalStock,
        isCritical,
        reviewEveryHours,
        primaryLocationId,
        reserveLocationId,
        supplierId,
        notes
      };

      let res;
      if (isEdit) {
        res = await Api.updateInventoryItem(item.id, payload);
      } else {
        res = await Api.addInventoryItem(payload);
      }

      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(isEdit ? 'Insumo actualizado' : 'Insumo registrado', 'success');
      render();
      return true;
    });
  };

  /**
   * Modal de Gestión de Ubicaciones (con asistente de archivado en 3 pasos)
   */
  const showLocationsModal = async () => {
    const locs = (await Api.getSupplyLocations(true)).data || [];
    const isAdmin = Auth.isAdmin();

    const html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span class="text-sm font-bold text-sec">UBICACIONES DEL SISTEMA</span>
        ${isAdmin ? '<button class="btn btn-primary btn-sm" id="btn-add-loc-inner">+ Nueva Ubicación</button>' : ''}
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;max-height:55vh;overflow-y:auto;">
        ${locs.map(l => {
          const isArchived = l.status === 'archived';
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg-glass);border-radius:var(--radius-sm);border:1px solid var(--border-subtle);opacity:${isArchived ? '0.6' : '1'};">
              <div>
                <div style="font-weight:700;font-size:0.9rem;">
                  ${Api.escapeHtml(l.name)}
                  ${isArchived ? '<span class="badge" style="background:#555;color:#ccc;font-size:0.65rem;">[Archivada]</span>' : ''}
                  ${l.isUsagePoint ? '<span class="badge badge-info" style="font-size:0.65rem;">Punto de uso</span>' : ''}
                  ${l.isDefaultRestock ? '<span class="badge badge-warning" style="font-size:0.65rem;">Almacén por defecto</span>' : ''}
                </div>
                <div class="text-xs text-muted">Revisión cada ${l.reviewFrequencyHours || 50}h</div>
              </div>
              <div style="display:flex;gap:4px;">
                ${isAdmin && !l.isUsagePoint && !l.isDefaultRestock ? `
                  ${!isArchived ? `
                    <button class="btn btn-secondary btn-sm btn-archive-loc" data-id="${Api.escapeHtml(l.id)}" data-name="${Api.escapeHtml(l.name)}" style="font-size:0.75rem;padding:2px 6px;">Archivar</button>
                  ` : `
                    <button class="btn btn-primary btn-sm btn-restore-loc" data-id="${Api.escapeHtml(l.id)}" style="font-size:0.75rem;padding:2px 6px;">Restaurar</button>
                  `}
                ` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    Ui.showModal('📍 Gestión de Ubicaciones', html, null);

    // Enlazar botones del modal
    document.getElementById('btn-add-loc-inner')?.addEventListener('click', () => {
      Ui.closeModal();
      showAddLocationModal();
    });

    document.querySelectorAll('.btn-archive-loc').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        Ui.closeModal();
        showArchiveLocationWizard({ id, name });
      });
    });

    document.querySelectorAll('.btn-restore-loc').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const res = await Api.restoreSupplyLocation(id);
        if (res && res.error) {
          Ui.toast(res.error, 'error');
          return;
        }
        Ui.toast('Ubicación restaurada', 'success');
        Ui.closeModal();
        render();
      });
    });
  };

  /**
   * Asistente de archivado en 3 pasos para ubicación (verifica stock antes de archivar)
   */
  const showArchiveLocationWizard = async (location) => {
    const stockRows = cachedContext.stockRows || [];
    const items = cachedContext.items || [];
    const itemsMap = new Map(items.map(i => [i.id, i]));
    const locStocks = stockRows.filter(s => s.locationId === location.id && s.effectiveStock > 0);

    if (locStocks.length > 0) {
      const html = `
        <p class="text-sm text-critical" style="font-weight:600;margin-bottom:8px;">
          ⚠️ Esta ubicación tiene stock remanente:
        </p>
        <ul style="font-size:0.8rem;margin:0 0 12px 18px;padding:0;">
          ${locStocks.map(s => `<li>${itemsMap.get(s.itemId)?.name || 'Insumo'}: <strong>${s.effectiveStock}</strong></li>`).join('')}
        </ul>
        <p class="text-xs text-muted">
          Para archivar sin perder la visibilidad del inventario, se trasladará automáticamente todo el stock al Almacén por defecto antes de archivar.
        </p>
      `;

      Ui.showModal(`Archivar "${location.name}" (Paso 2/3)`, html, async () => {
        // Ejecutar traslados de vaciado
        const movements = [];
        const groupId = Api.nowISO() + '_empty_loc';
        locStocks.forEach(s => {
          movements.push(
            { itemId: s.itemId, locationId: location.id, stockState: s.stockState, movementType: 'transfer_out', quantity: -s.effectiveStock, groupId },
            { itemId: s.itemId, locationId: 'loc_arm', stockState: s.stockState, movementType: 'transfer_in', quantity: s.effectiveStock, groupId }
          );
        });

        if (movements.length > 0) {
          await Api.recordSupplyMovements(movements);
        }

        const res = await Api.archiveSupplyLocation(location.id);
        if (res && res.error) {
          Ui.toast(res.error, 'error');
          return false;
        }

        Ui.toast(`Ubicación archivada y stock transferido al almacén`, 'success');
        render();
        return true;
      });
    } else {
      Ui.confirm('¿Archivar ubicación?', `"${location.name}" no tiene stock activo y se marcará como archivada.`, async () => {
        const res = await Api.archiveSupplyLocation(location.id);
        if (res && res.error) {
          Ui.toast(res.error, 'error');
          return;
        }
        Ui.toast('Ubicación archivada', 'info');
        render();
      });
    }
  };

  /**
   * Modal para Crear Ubicación
   */
  const showAddLocationModal = () => {
    const html = `
      <div class="form-group">
        <label class="form-label" for="al-name">Nombre de la ubicación *</label>
        <input class="form-input" id="al-name" placeholder="Ej: Botiquín Baño, Nevera Auxiliar..." required>
      </div>
      <div class="form-group">
        <label class="form-label" for="al-type">Tipo</label>
        <select class="form-select" id="al-type">
          <option value="storage" selected>Almacén / Armario</option>
          <option value="fridge">Refrigeración / Nevera</option>
          <option value="room">Punto de uso / Habitación</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="al-freq">Frecuencia de revisión (horas)</label>
        <input class="form-input" id="al-freq" type="number" min="1" value="50">
      </div>
    `;

    Ui.showModal('➕ Nueva Ubicación', html, async () => {
      const name = document.getElementById('al-name')?.value?.trim();
      const type = document.getElementById('al-type')?.value || 'storage';
      const reviewFrequencyHours = parseFloat(document.getElementById('al-freq')?.value) || 50;

      if (!name) {
        Ui.toast('Ingresa un nombre para la ubicación', 'warning');
        return false;
      }

      const res = await Api.addSupplyLocation({ name, type, reviewFrequencyHours });
      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast('Ubicación creada con éxito', 'success');
      render();
      return true;
    });
  };

  /**
   * Modal de Gestión de Proveedores
   */
  const showSuppliersModal = async () => {
    const sups = (await Api.getSupplySuppliers(true)).data || [];
    const isAdmin = Auth.isAdmin();

    const html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span class="text-sm font-bold text-sec">PROVEEDORES REGISTRADOS</span>
        ${isAdmin ? '<button class="btn btn-primary btn-sm" id="btn-add-sup-inner">+ Nuevo Proveedor</button>' : ''}
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;max-height:55vh;overflow-y:auto;">
        ${sups.map(s => {
          const isArchived = s.status === 'archived';
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg-glass);border-radius:var(--radius-sm);border:1px solid var(--border-subtle);opacity:${isArchived ? '0.6' : '1'};">
              <div>
                <div style="font-weight:700;font-size:0.9rem;">
                  ${Api.escapeHtml(s.name)}
                  ${isArchived ? '<span class="badge" style="background:#555;color:#ccc;font-size:0.65rem;">[Archivado]</span>' : ''}
                </div>
                <div class="text-xs text-muted">
                  Plazo entrega: <strong>${s.leadTimeHours || 24}h</strong> · Tel: ${Api.escapeHtml(s.phone || '—')}
                </div>
              </div>
              <div style="display:flex;gap:4px;">
                ${isAdmin ? `
                  <button class="btn btn-ghost btn-sm btn-edit-sup" data-id="${Api.escapeHtml(s.id)}" title="Editar">✏️</button>
                  ${!isArchived ? `
                    <button class="btn btn-secondary btn-sm btn-archive-sup" data-id="${Api.escapeHtml(s.id)}" data-name="${Api.escapeHtml(s.name)}" style="font-size:0.75rem;padding:2px 6px;">Archivar</button>
                  ` : `
                    <button class="btn btn-primary btn-sm btn-restore-sup" data-id="${Api.escapeHtml(s.id)}" style="font-size:0.75rem;padding:2px 6px;">Restaurar</button>
                  `}
                ` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    Ui.showModal('🏢 Gestión de Proveedores', html, null);

    document.getElementById('btn-add-sup-inner')?.addEventListener('click', () => {
      Ui.closeModal();
      showSupplierFormModal();
    });

    document.querySelectorAll('.btn-edit-sup').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const sup = sups.find(s => s.id === id);
        Ui.closeModal();
        if (sup) showSupplierFormModal(sup);
      });
    });

    document.querySelectorAll('.btn-archive-sup').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        Ui.confirm('¿Archivar proveedor?', `Se archivará "${name}".`, async () => {
          const res = await Api.archiveSupplySupplier(id);
          if (res && res.error) {
            Ui.toast(res.error, 'error');
            return;
          }
          Ui.toast('Proveedor archivado', 'info');
          Ui.closeModal();
          render();
        });
      });
    });

    document.querySelectorAll('.btn-restore-sup').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const res = await Api.restoreSupplySupplier(id);
        if (res && res.error) {
          Ui.toast(res.error, 'error');
          return;
        }
        Ui.toast('Proveedor restaurado', 'success');
        Ui.closeModal();
        render();
      });
    });
  };

  /**
   * Modal para Agregar o Editar Proveedor
   */
  const showSupplierFormModal = (sup = null) => {
    const isEdit = !!sup;
    const html = `
      <div class="form-group">
        <label class="form-label" for="sf-name">Nombre del proveedor *</label>
        <input class="form-input" id="sf-name" value="${Api.escapeHtml(sup?.name || '')}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="sf-contact">Persona de contacto</label>
          <input class="form-input" id="sf-contact" value="${Api.escapeHtml(sup?.contactName || '')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="sf-lead">Plazo entrega (horas) *</label>
          <input class="form-input" id="sf-lead" type="number" min="1" value="${sup?.leadTimeHours || 24}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="sf-phone">Teléfono</label>
          <input class="form-input" id="sf-phone" value="${Api.escapeHtml(sup?.phone || '')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="sf-wa">WhatsApp para pedidos</label>
          <input class="form-input" id="sf-wa" value="${Api.escapeHtml(sup?.whatsapp || '')}">
        </div>
      </div>
    `;

    Ui.showModal(isEdit ? `✏️ Editar — ${sup.name}` : '➕ Nuevo Proveedor', html, async () => {
      const name = document.getElementById('sf-name')?.value?.trim();
      const contactName = document.getElementById('sf-contact')?.value?.trim() || '';
      const leadTimeHours = parseFloat(document.getElementById('sf-lead')?.value) || 24;
      const phone = document.getElementById('sf-phone')?.value?.trim() || '';
      const whatsapp = document.getElementById('sf-wa')?.value?.trim() || '';

      if (!name) {
        Ui.toast('El nombre del proveedor es obligatorio', 'warning');
        return false;
      }

      let res;
      if (isEdit) {
        res = await Api.updateSupplySupplier(sup.id, { name, contactName, leadTimeHours, phone, whatsapp });
      } else {
        res = await Api.addSupplySupplier({ name, contactName, leadTimeHours, phone, whatsapp });
      }

      if (res && res.error) {
        Ui.toast(res.error, 'error');
        return false;
      }

      Ui.toast(isEdit ? 'Proveedor actualizado' : 'Proveedor registrado', 'success');
      render();
      return true;
    });
  };

  return {
    render,
    switchTab,
    showQuickCriticalModal,
    showTransferModal
  };
})();
