/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Motor de cálculo de Gestión Insumos (js/inventory-calc.js)

   Funciones PURAS: no tocan DOM, red ni almacenamiento, y reciben `now`
   como parámetro. Se usan en tres sitios:
     · inventory.js / dashboard.js → semáforo, cobertura, sugerencias
     · local-store.js (LOCAL_MODE) → emulación de las vistas y RPCs
     · tests/ (node --test)        → pruebas sin navegador

   Recibe objetos en camelCase, tal como los entrega Api (api.js).
   Todas las cantidades están en la UNIDAD BASE del ítem (item.unit).
   Solo se convierte a unidad de compra al sugerir pedidos y al mostrar.

   La regla de stock es la misma que la vista inventory_stock_view de
   supabase/07_insumos.sql. Si cambias una, cambia la otra.

   Cargar en index.html ANTES de local-store.js e inventory.js.
   ═══════════════════════════════════════════════════════════════ */

const InventoryCalc = (() => {
  'use strict';

  const HOUR_MS = 3600 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const EPS = 1e-9;

  const DEFAULTS = Object.freeze({
    safetyDays: 3,
    reviewPeriodDays: 7,
    leadTimeHours: 48,
    maxAuditAgeHours: 168,
    paoCriticalHours: 48,
    inUseCylinderFraction: 0.5,     // el cilindro conectado se asume a medio uso
    consumptionWindowDays: 14,
    consumptionMinDays: 3,
    consumptionDeviationRatio: 0.5, // aviso si lo observado difiere >50% de la pauta
    overdueEscalationHours: 24,
    plausibilityRatio: 3,
    plausibilityAbs: 20
  });

  const STATUS_ORDER = ['critico', 'reorden', 'desconocido', 'sin_configurar', 'optimo', 'finalizado'];

  // ─── Utilidades ───────────────────────────────────────────
  const ts = (value) => {
    const t = value instanceof Date ? value.getTime() : Date.parse(value);
    if (Number.isNaN(t)) throw new TypeError('Fecha inválida: ' + value);
    return t;
  };

  const num = (value, fallback) =>
    (value === null || value === undefined || value === '' ? fallback : Number(value));

  const round = (value, decimals = 2) => {
    const f = Math.pow(10, decimals);
    return Math.round(value * f) / f;
  };

  const stockKey = (itemId, locationId, state) => `${itemId}|${locationId}|${state || 'full'}`;

  const pluralize = (word, n) => {
    if (!word || Math.abs(n - 1) < EPS || /s$/i.test(word) || word === 'ml' || word === 'g') return word;
    return /[aeiouáéíóú]$/i.test(word) ? word + 's' : word + 'es';
  };

  // ─── 1. Unidades ──────────────────────────────────────────
  const toBase = (qtyPurchaseUnits, item) => qtyPurchaseUnits * num(item.unitsPerPurchase, 1);

  /** Unidades de compra necesarias para cubrir `baseQty` (redondeo hacia arriba). */
  const toPurchaseUnitsCeil = (baseQty, item) => {
    if (!(baseQty > EPS)) return 0;
    return Math.ceil(baseQty / num(item.unitsPerPurchase, 1) - EPS);
  };

  /** "2 cajas + 4 cápsulas" */
  const formatQty = (baseQty, item) => {
    const per = num(item.unitsPerPurchase, 1);
    const unit = item.unit || 'unidad';
    const purchaseUnit = item.purchaseUnit || unit;
    if (per === 1 || purchaseUnit === unit) return `${round(baseQty)} ${pluralize(unit, baseQty)}`;
    const whole = Math.floor(baseQty / per + EPS);
    const rest = round(baseQty - whole * per);
    const parts = [];
    if (whole > 0) parts.push(`${whole} ${pluralize(purchaseUnit, whole)}`);
    if (rest > EPS || parts.length === 0) parts.push(`${rest} ${pluralize(unit, rest)}`);
    return parts.join(' + ');
  };

  const formatDuration = (days) => {
    if (days === null || days === undefined || !Number.isFinite(days)) return '—';
    if (days < 2) return `${round(days * 24, 1)} h`;
    return `${round(days, 1)} días`;
  };

  // ─── 2. Entrada del relevo (vacío ≠ cero) ─────────────────
  /**
   * NUNCA usar Number(raw): Number('') === 0 convertiría una casilla
   * omitida en «agotado».
   * @returns {{status:'omitted'|'ok'|'invalid', value:number|null, error?:string}}
   */
  const parseCountInput = (raw, { allowDecimal = false } = {}) => {
    if (raw === null || raw === undefined) return { status: 'omitted', value: null };
    const s = String(raw).trim().replace(',', '.');
    if (s === '') return { status: 'omitted', value: null };
    const re = allowDecimal ? /^\d+(\.\d+)?$/ : /^\d+$/;
    if (!re.test(s)) {
      return {
        status: 'invalid',
        value: null,
        error: allowDecimal ? 'Ingresa un número mayor o igual a 0' : 'Ingresa un número entero mayor o igual a 0'
      };
    }
    return { status: 'ok', value: Number(s) };
  };

  /** Detecta errores de tipeo (12 → 120). Solo alerta aumentos: bajar es consumo normal. */
  const checkPlausibility = (value, expected, opts = {}) => {
    const o = { ...DEFAULTS, ...opts };
    if (value === null || expected === null || expected === undefined) return { ok: true };
    if (value - expected > o.plausibilityAbs && value > expected * o.plausibilityRatio) {
      return {
        ok: false,
        warning: `Anotaste ${value} y el sistema esperaba cerca de ${round(expected)}. ¿Es correcto o fue un error de tipeo?`
      };
    }
    return { ok: true };
  };

  // ─── 3. Constructores de movimientos ──────────────────────
  // `newId` se inyecta (LocalStore.uuid o crypto.randomUUID).

  /**
   * Convierte las filas del formulario de relevo en conteos.
   * entries: [{ item, locationId, rawFull, rawEmpty?, expectedFull? }]
   * Los omitidos NO generan conteo: se conserva el dato previo y se
   * marcan como «Pendientes por Revisar». Solo los inválidos bloquean.
   */
  const buildRelayCounts = (entries, newId, opts) => {
    const counts = [];
    const omittedItemIds = [];
    const errors = [];
    const warnings = [];

    entries.forEach((e) => {
      const full = parseCountInput(e.rawFull, { allowDecimal: e.item.unit === 'ml' });
      const empty = e.item.isReturnable ? parseCountInput(e.rawEmpty) : { status: 'omitted' };

      if (full.status === 'invalid') errors.push({ itemId: e.item.id, field: 'full', error: full.error });
      if (empty.status === 'invalid') errors.push({ itemId: e.item.id, field: 'empty', error: empty.error });

      if (full.status === 'omitted' && empty.status === 'omitted') {
        omittedItemIds.push(e.item.id);
        return;
      }
      if (full.status === 'ok') {
        const p = checkPlausibility(full.value, num(e.expectedFull, null), opts);
        if (!p.ok) warnings.push({ itemId: e.item.id, warning: p.warning });
        counts.push({ itemId: e.item.id, locationId: e.locationId, stockState: 'full',
          qtyAbsolute: full.value, clientEventId: newId() });
      }
      if (empty.status === 'ok') {
        counts.push({ itemId: e.item.id, locationId: e.locationId, stockState: 'empty',
          qtyAbsolute: empty.value, clientEventId: newId() });
      }
    });

    return { canSave: errors.length === 0, counts, omittedItemIds, errors, warnings };
  };

  /** «Se vació cilindro/recipiente»: 2 filas del mismo grupo (llenos −1, vacíos +1). */
  const buildEmptiedMovements = (itemId, locationId, occurredAt, newId) => {
    const groupId = newId();
    const at = new Date(ts(occurredAt)).toISOString();
    return [
      { itemId, locationId, stockState: 'full', movementType: 'emptied', delta: -1,
        occurredAt: at, groupId, clientEventId: newId() },
      { itemId, locationId, stockState: 'empty', movementType: 'emptied', delta: 1,
        occurredAt: at, groupId, clientEventId: newId() }
    ];
  };

  /** Traslado entre ubicaciones (p. ej. armario → habitación): 2 filas del mismo grupo. */
  const buildTransferMovements = (itemId, fromLocationId, toLocationId, qtyBase, occurredAt, newId) => {
    if (!(qtyBase > 0)) throw new RangeError('La cantidad a trasladar debe ser mayor que 0');
    if (fromLocationId === toLocationId) throw new RangeError('Origen y destino deben ser distintos');
    const groupId = newId();
    const at = new Date(ts(occurredAt)).toISOString();
    return [
      { itemId, locationId: fromLocationId, stockState: 'full', movementType: 'transfer', delta: -qtyBase,
        occurredAt: at, groupId, clientEventId: newId() },
      { itemId, locationId: toLocationId, stockState: 'full', movementType: 'transfer', delta: qtyBase,
        occurredAt: at, groupId, clientEventId: newId() }
    ];
  };

  /**
   * Convierte movimientos camelCase al JSON que esperan las RPC
   * record_supply_movements y save_supply_relay (snake_case).
   */
  const toRpcMovementRows = (movements) => movements.map((m) => {
    const row = {
      item_id: m.itemId,
      location_id: m.locationId,
      stock_state: m.stockState || 'full',
      client_event_id: m.clientEventId
    };
    if (m.movementType) row.movement_type = m.movementType;
    if (m.qtyAbsolute !== undefined && m.qtyAbsolute !== null) row.qty_absolute = m.qtyAbsolute;
    if (m.delta !== undefined && m.delta !== null) row.delta = m.delta;
    if (m.occurredAt) row.occurred_at = m.occurredAt;
    if (m.groupId) row.group_id = m.groupId;
    if (m.note) row.note = m.note;
    return row;
  });

  // ─── 4. Stock derivado (misma regla que inventory_stock_view) ─
  /**
   * Último conteo no anulado (occurredAt, desempate createdAt)
   * + deltas con occurredAt ESTRICTAMENTE posterior.
   * El resultado no depende del orden de los movimientos.
   * movement: { itemId, locationId, stockState, movementType,
   *             qtyAbsolute, delta, occurredAt, createdAt, voidedAt }
   * @returns {Map<string, {itemId, locationId, stockState, quantity, rawQuantity, negative, lastCountedAt}>}
   */
  const deriveStock = (movements) => {
    const groups = new Map();
    movements.forEach((m) => {
      if (m.voidedAt) return;
      const key = stockKey(m.itemId, m.locationId, m.stockState);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    });

    const created = (m) => (m.createdAt ? ts(m.createdAt) : 0);
    const out = new Map();
    groups.forEach((list, key) => {
      let last = null;
      list.forEach((m) => {
        if (m.movementType !== 'count') return;
        if (!last) { last = m; return; }
        const d = ts(m.occurredAt) - ts(last.occurredAt);
        if (d > 0 || (d === 0 && created(m) > created(last))) last = m;
      });
      const t0 = last ? ts(last.occurredAt) : -Infinity;
      let qty = last ? Number(last.qtyAbsolute) : 0;
      list.forEach((m) => {
        if (m.movementType !== 'count' && ts(m.occurredAt) > t0) qty += Number(m.delta);
      });
      const first = list[0];
      out.set(key, {
        itemId: first.itemId,
        locationId: first.locationId,
        stockState: first.stockState || 'full',
        quantity: Math.max(0, qty),
        rawQuantity: qty,
        negative: qty < -EPS,
        lastCountedAt: last ? last.occurredAt : null
      });
    });
    return out;
  };

  /**
   * Stock de un ítem en todas sus ubicaciones y detección de datos viejos.
   * locationsById: Map<id, {maxAuditAgeHours}>
   */
  const summarizeItemStock = (item, stockMap, locationsById, { now, pendingReviewItemIds } = {}) => {
    const tNow = ts(now);
    const byLocation = {};
    const slot = (locId) => {
      if (!byLocation[locId]) byLocation[locId] = { full: 0, empty: 0, lastCountedAt: null, stale: false };
      return byLocation[locId];
    };
    slot(item.defaultLocationId);
    if (item.reserveLocationId) slot(item.reserveLocationId);

    const anomalies = [];
    let onHandFull = 0;
    let emptyUnits = 0;
    stockMap.forEach((row) => {
      if (row.itemId !== item.id) return;
      const s = slot(row.locationId);
      if (row.stockState === 'empty') { s.empty += row.quantity; emptyUnits += row.quantity; }
      else { s.full += row.quantity; onHandFull += row.quantity; }
      if (row.lastCountedAt && (!s.lastCountedAt || ts(row.lastCountedAt) > ts(s.lastCountedAt))) {
        s.lastCountedAt = row.lastCountedAt;
      }
      if (row.negative) anomalies.push({ locationId: row.locationId, stockState: row.stockState, rawQuantity: row.rawQuantity });
    });

    // Una ubicación archivada (loc.active === false) no se audita: su conteo
    // viejo no debe dejar el insumo en gris para siempre. Si aún tuviera
    // stock (no debería: archive_supply_location lo traslada), se avisa.
    const staleLocations = [];
    const archivedWithStock = [];
    Object.keys(byLocation).forEach((locId) => {
      const loc = locationsById.get(locId);
      const s = byLocation[locId];
      if (loc && loc.active === false) {
        s.archived = true;
        s.stale = false;
        if (s.full > EPS || s.empty > EPS) archivedWithStock.push(locId);
        return;
      }
      // La frecuencia propia del insumo (reviewEveryHours) rige en su punto
      // de uso; el resto de ubicaciones usa la frecuencia de la ubicación.
      const locMaxH = num(loc && loc.maxAuditAgeHours, DEFAULTS.maxAuditAgeHours);
      const maxAgeH = locId === item.defaultLocationId ? num(item.reviewEveryHours, locMaxH) : locMaxH;
      s.reviewEveryHours = maxAgeH;
      s.dueAt = s.lastCountedAt ? new Date(ts(s.lastCountedAt) + maxAgeH * HOUR_MS).toISOString() : null;
      s.hoursUntilDue = s.dueAt ? (ts(s.dueAt) - tNow) / HOUR_MS : -Infinity;
      s.stale = s.hoursUntilDue < 0;
      if (s.stale) staleLocations.push(locId);
    });

    const pending = pendingReviewItemIds instanceof Set
      ? pendingReviewItemIds : new Set(pendingReviewItemIds || []);
    return {
      onHandFull, emptyUnits, byLocation, staleLocations, archivedWithStock,
      pendingReview: pending.has(item.id), anomalies
    };
  };

  // ─── 5. Consumo diario ────────────────────────────────────
  /** Cilindros por día a partir de flujo, horas de uso y capacidad. */
  const cylindersPerDay = (item) => {
    if (!item.isReturnable || !(item.flowLpm > 0) || !(item.cylinderCapacityLiters > 0)) return null;
    return (item.flowLpm * 60 * num(item.hoursPerDay, 24)) / item.cylinderCapacityLiters;
  };

  /**
   * Consumo observado en el libro: explícito (consume, emptied — incluye
   * las dosis administradas) + implícito (lo que falta entre lo esperado
   * y lo contado). Las diferencias se suman CON SIGNO en todas las
   * ubicaciones: un traslado armario→habitación no registrado se compensa.
   */
  const estimateDailyConsumption = (item, movements, now, opts = {}) => {
    const o = { ...DEFAULTS, ...opts };
    const tNow = ts(now);
    const windowStart = tNow - o.consumptionWindowDays * DAY_MS;
    const isCount = (m) => (m.movementType === 'count' ? 1 : 0);

    const list = movements
      .filter((m) => m.itemId === item.id && !m.voidedAt && (m.stockState || 'full') === 'full' && ts(m.occurredAt) <= tNow)
      .sort((a, b) => (ts(a.occurredAt) - ts(b.occurredAt)) || (isCount(a) - isCount(b))); // empate: el conteo va último

    if (list.length === 0) return { value: null, reason: 'sin_historial' };

    // `running` solo existe para una ubicación a partir de su primer CONTEO.
    // Así el cálculo es correcto aunque se reciba solo un tramo reciente del
    // historial (p. ej. los últimos 30 días): un movimiento anterior al primer
    // conteo visible no puede fijar una base falsa.
    const running = new Map();
    let explicit = 0;
    let implied = 0;
    list.forEach((m) => {
      const inWindow = ts(m.occurredAt) >= windowStart;
      if (m.movementType === 'count') {
        if (inWindow && running.has(m.locationId)) implied += running.get(m.locationId) - Number(m.qtyAbsolute);
        running.set(m.locationId, Number(m.qtyAbsolute));
        return;
      }
      const delta = Number(m.delta);
      if (running.has(m.locationId)) running.set(m.locationId, running.get(m.locationId) + delta);
      if (inWindow && (m.movementType === 'consume' || m.movementType === 'emptied')) explicit += -delta;
    });

    const days = (tNow - Math.max(windowStart, ts(list[0].occurredAt))) / DAY_MS;
    if (days < o.consumptionMinDays) return { value: null, reason: 'historial_insuficiente', days: round(days, 1) };
    return { value: Math.max(0, (explicit + implied) / days), reason: 'ok', days: round(days, 1) };
  };

  /**
   * Prioridad: medicamento pausado/suspendido (consumo 0: no se repone)
   *   > flujo (cilindros) > pauta (horarios de medicación activos,
   *   item.pautaDailyAmount de inventory_items_view) > configurado > estimado.
   */
  const resolveDailyConsumption = (item, estimate, opts = {}) => {
    const o = { ...DEFAULTS, ...opts };
    if (item.medicationStatus === 'paused' || item.medicationStatus === 'suspended') {
      return {
        value: 0, source: 'medicamento_pausado',
        warning: 'Medicamento ' + (item.medicationStatus === 'paused' ? 'pausado' : 'suspendido') +
          ': no se sugiere reposición.'
      };
    }
    const fromFlow = cylindersPerDay(item);
    if (fromFlow !== null) return { value: fromFlow, source: 'flujo', warning: null };

    const est = estimate && estimate.value !== null ? estimate.value : null;
    const deviation = (reference, label) => {
      if (est === null || !(reference > 0)) return null;
      if (Math.abs(est - reference) / reference <= o.consumptionDeviationRatio) return null;
      return `El consumo observado (${round(est)}/día) difiere de ${label} (${round(reference)}/día). ` +
        'Revisa si faltan dosis por registrar o conteos por corregir.';
    };

    // Con control por conteo la dosis es variable: la pauta no representa
    // el consumo real. Se usa el configurado (máximo esperado) o lo observado.
    const pauta = item.stockControl === 'conteo' ? null : num(item.pautaDailyAmount, null);
    if (pauta !== null && pauta > 0) {
      return { value: pauta, source: 'pauta', estimate: est, warning: deviation(pauta, 'la pauta médica') };
    }
    const configured = num(item.dailyConsumption, null);
    if (configured !== null) {
      return { value: configured, source: 'configurado', estimate: est, warning: deviation(configured, 'lo configurado') };
    }
    if (est !== null) return { value: est, source: 'estimado', warning: null };
    return { value: null, source: 'sin_dato', warning: 'Sin dato de consumo: se usan los umbrales fijos.' };
  };

  // ─── 6. Cobertura y reposición ────────────────────────────
  const leadTimeHours = (item, supplier) =>
    num(item.leadTimeHoursOverride, num(supplier && supplier.leadTimeHours, DEFAULTS.leadTimeHours));

  /** Días de tratamiento restantes (hasta el fin del día local). null si no aplica. */
  const treatmentDaysLeft = (item, now) => {
    if (!item.treatmentEndDate) return null;
    const [y, m, d] = String(item.treatmentEndDate).slice(0, 10).split('-').map(Number);
    return (new Date(y, m - 1, d, 23, 59, 59, 999).getTime() - ts(now)) / DAY_MS;
  };

  const inTransitByItem = (orderLines) => {
    const map = new Map();
    (orderLines || []).forEach((l) => {
      if (l.status === 'in_transit') map.set(l.itemId, (map.get(l.itemId) || 0) + Number(l.qtyBase));
    });
    return map;
  };

  /**
   * Punto de pedido = consumo × (entrega + seguridad)
   * Nivel objetivo  = consumo × (entrega + seguridad + periodo de revisión)
   * Posición        = stock en casa + en camino      ← evita compras dobles
   * Con fecha de fin de tratamiento, ambos se limitan a lo que falta tomar.
   * input: { onHandFull, emptyUnits, inTransitBase, dailyConsumption, leadHours, now }
   */
  const computeReorder = (item, input, opts = {}) => {
    const o = { ...DEFAULTS, ...opts };
    const leadDays = input.leadHours / 24;
    const inTransit = num(input.inTransitBase, 0);
    const daily = input.dailyConsumption;

    const onHandEffective = item.isReturnable && input.onHandFull > 0
      ? Math.max(0, input.onHandFull - o.inUseCylinderFraction)
      : input.onHandFull;
    const position = onHandEffective + inTransit;

    const r = {
      mode: null, leadDays, onHandEffective, inTransitBase: inTransit, position,
      coverageOnHandDays: null, coveragePositionDays: null,
      reorderPointBase: null, targetBase: null, needBase: 0, purchaseUnits: 0,
      treatmentDaysLeft: treatmentDaysLeft(item, input.now), exchange: null
    };

    if (r.treatmentDaysLeft !== null && r.treatmentDaysLeft <= 0) {
      r.mode = 'tratamiento_finalizado';
      return r;
    }

    const minT = num(item.minThreshold, 0);
    const optimal = num(item.optimalStock, null);

    if (daily !== null && daily > EPS) {
      let rop = daily * (leadDays + num(item.safetyDays, o.safetyDays));
      let target = daily * (leadDays + num(item.safetyDays, o.safetyDays) + num(item.reviewPeriodDays, o.reviewPeriodDays));
      if (r.treatmentDaysLeft !== null) {
        const remaining = daily * r.treatmentDaysLeft;
        rop = Math.min(rop, remaining);
        target = Math.min(target, remaining);
      }
      r.mode = 'cobertura';
      r.reorderPointBase = rop;
      r.targetBase = target;
      r.coverageOnHandDays = onHandEffective / daily;
      r.coveragePositionDays = position / daily;
      r.needBase = position <= rop + EPS ? Math.max(0, target - position) : 0;
    } else if (minT > 0 && optimal !== null) {
      r.mode = 'umbral_fijo';
      r.reorderPointBase = minT;
      r.targetBase = optimal;
      r.needBase = position <= minT + EPS ? Math.max(0, optimal - position) : 0;
    } else if (daily !== null) {
      r.mode = 'sin_consumo';
    } else {
      r.mode = 'sin_configurar';
    }

    r.purchaseUnits = toPurchaseUnitsCeil(r.needBase, item);

    if (item.isReturnable) {
      const empties = num(input.emptyUnits, 0);
      const toExchange = Math.min(empties, r.purchaseUnits);
      const expected = num(item.totalCirculatingUnits, null);
      const circuit = input.onHandFull + empties;
      r.exchange = {
        emptiesAvailable: empties,
        emptiesToExchange: toExchange,
        additionalUnitsNeeded: r.purchaseUnits - toExchange, // requieren compra/alquiler, no canje
        circuitCount: circuit,
        circuitExpected: expected,
        circuitDiscrepancy: expected === null ? 0 : circuit - expected
      };
    }
    return r;
  };

  // ─── 7. Semáforo ──────────────────────────────────────────
  /**
   * critico     → lo que hay en casa no alcanza para esperar un pedido nuevo
   * reorden     → hay que pedir (la posición cayó bajo el punto de pedido)
   * desconocido → sería «óptimo» pero el dato está viejo u omitido
   * Un rojo o amarillo NUNCA se oculta por dato viejo: solo se marca baja confianza.
   */
  const evaluateStatus = (item, reorder, summary) => {
    const reasons = [];
    let base;

    switch (reorder.mode) {
      case 'tratamiento_finalizado':
        base = 'finalizado';
        reasons.push('Tratamiento finalizado según su fecha de término.');
        break;
      case 'sin_configurar':
        base = 'sin_configurar';
        reasons.push('Falta el consumo diario o los niveles mínimo y óptimo.');
        break;
      case 'cobertura':
        if (reorder.onHandEffective <= EPS || reorder.coverageOnHandDays < reorder.leadDays - EPS) {
          base = 'critico';
          reasons.push(`Lo que hay en casa dura ${formatDuration(reorder.coverageOnHandDays)} y el proveedor tarda ${formatDuration(reorder.leadDays)}.`);
          if (reorder.inTransitBase > 0) reasons.push('Hay un pedido en camino: confirma la hora de llegada.');
        } else if (reorder.needBase > 0) {
          base = 'reorden';
          reasons.push(`Cobertura total de ${formatDuration(reorder.coveragePositionDays)}, bajo el punto de pedido.`);
        } else {
          base = 'optimo';
        }
        break;
      case 'umbral_fijo':
        if (reorder.onHandEffective <= EPS) { base = 'critico'; reasons.push('Sin existencias en casa.'); }
        else if (reorder.needBase > 0) { base = 'reorden'; reasons.push('Por debajo del mínimo configurado.'); }
        else base = 'optimo';
        break;
      default:
        base = 'optimo';
    }

    const archivedWithStock = summary.archivedWithStock || [];
    const lowConfidence = summary.staleLocations.length > 0 || summary.pendingReview ||
      summary.anomalies.length > 0 || archivedWithStock.length > 0;
    if (archivedWithStock.length > 0) reasons.push('Hay stock registrado en una ubicación archivada: trasládalo o regístralo en cero.');
    if (summary.pendingReview) reasons.push('Omitido en el último relevo: pendiente por revisar.');
    if (summary.staleLocations.length > 0) reasons.push(`Conteo vencido en ${summary.staleLocations.length} ubicación(es).`);
    if (summary.anomalies.length > 0) reasons.push('El registro da stock negativo: falta anotar un movimiento o un conteo.');

    // Revisión del punto de uso vencida. En un crítico es una alerta propia
    // («Revisión pendiente»), no solo un gris.
    const poc = summary.byLocation && summary.byLocation[item.defaultLocationId];
    const reviewDue = !!(poc && poc.stale && !poc.archived);
    if (reviewDue && item.isCritical) {
      reasons.unshift('Revisión ' + (num(item.reviewEveryHours, 0) > 0 && item.reviewEveryHours <= 26 ? 'diaria ' : '') +
        'pendiente: ' + (poc.lastCountedAt ? `último conteo hace ${formatDuration((-poc.hoursUntilDue + poc.reviewEveryHours) / 24)}` : 'nunca se ha contado') + '.');
    }

    const status = base === 'optimo' && lowConfidence ? 'desconocido' : base;
    return {
      status, baseStatus: base, lowConfidence, reasons, reviewDue,
      alertActive: !!item.isCritical && (status === 'critico' || reviewDue)
    };
  };

  // ─── 8. Traslado desde la reserva al punto de uso ─────────
  const suggestPointOfCareTransfer = (item, summary) => {
    const min = num(item.pointOfCareMin, null);
    if (min === null || !item.reserveLocationId) return null;
    const poc = summary.byLocation[item.defaultLocationId] || { full: 0 };
    const reserve = summary.byLocation[item.reserveLocationId] || { full: 0 };
    if (poc.full >= min || reserve.full <= EPS) return null;
    const qty = Math.min(reserve.full, num(item.unitsPerPurchase, 1));
    return {
      fromLocationId: item.reserveLocationId,
      toLocationId: item.defaultLocationId,
      qtyBase: qty,
      message: `Quedan ${formatQty(poc.full, item)} en el punto de uso. Trae ${formatQty(qty, item)} de la reserva y regístralo.`
    };
  };

  // ─── 9. Envases abiertos (PAO) ────────────────────────────
  /**
   * ≤48 h: «abrir nuevo» si hay cerrados, «comprar» si no.
   * Sin cerrados, se pide antes: cuando lo que queda < entrega + 48 h.
   */
  const evaluateOpenContainer = (container, { now, sealedUnitsAvailable = 0, leadHours } = {}, opts = {}) => {
    const o = { ...DEFAULTS, ...opts };
    const hoursLeft = (ts(container.expiresAt) - ts(now)) / HOUR_MS;
    const sealed = num(sealedUnitsAvailable, 0);
    const lead = num(leadHours, o.leadTimeHours);

    if (hoursLeft <= 0) return { status: 'vencido', hoursLeft, action: sealed > 0 ? 'desechar_y_abrir_nuevo' : 'desechar_y_comprar' };
    if (hoursLeft <= o.paoCriticalHours) return { status: 'critico', hoursLeft, action: sealed > 0 ? 'abrir_nuevo' : 'comprar' };
    if (sealed <= 0 && hoursLeft <= lead + o.paoCriticalHours) return { status: 'reorden', hoursLeft, action: 'comprar' };
    return { status: 'ok', hoursLeft, action: null };
  };

  const computePaoExpiry = (openedAt, paoDays) => new Date(ts(openedAt) + paoDays * DAY_MS).toISOString();

  // ─── 10. Pedidos huérfanos ────────────────────────────────
  const evaluateOrderLine = (line, now, opts = {}) => {
    const o = { ...DEFAULTS, ...opts };
    if (line.status !== 'in_transit') return { status: line.status };
    const lateH = (ts(now) - ts(line.expectedBy)) / HOUR_MS;
    if (lateH <= 0) return { status: 'a_tiempo', hoursLate: 0 };
    if (lateH <= o.overdueEscalationHours) return { status: 'atrasado', hoursLate: round(lateH, 1) };
    return {
      status: 'escalar',
      hoursLate: round(lateH, 1),
      message: `Pedido de ${line.handledByName || 'alguien del equipo'} sin recibir hace ${round(lateH, 1)} h. ` +
        'Confirma con el proveedor o libéralo para que otra persona lo pida.'
    };
  };

  // ─── 11. WhatsApp ─────────────────────────────────────────
  /** lines: [{ item, qtyPurchaseUnits, emptiesToExchange? }] */
  const buildWhatsAppMessage = ({ supplierName, date, lines, handledByName, notes }) => {
    const out = ['*Pedido CuidApp*' + (supplierName ? ` · ${supplierName}` : '')];
    if (date) out.push(date);
    out.push('');
    let empties = 0;
    lines.forEach((l) => {
      const label = [l.item.name, l.item.presentation].filter(Boolean).join(' ');
      const unit = l.item.purchaseUnit || l.item.unit || 'unidad';
      out.push(`• ${label}: ${l.qtyPurchaseUnits} ${pluralize(unit, l.qtyPurchaseUnits)}`);
      empties += num(l.emptiesToExchange, 0);
    });
    if (empties > 0) out.push('', `Cilindros vacíos para canje: ${empties}`);
    if (handledByName) out.push('', `Responsable: ${handledByName}`);
    if (notes) out.push(notes);
    return out.join('\n');
  };

  /** Más fiable que el portapapeles en iOS. Sin teléfono, WhatsApp pide el contacto. */
  const buildWhatsAppUrl = (text, phone) => {
    const digits = phone ? String(phone).replace(/\D/g, '') : '';
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  };

  // ─── 12. Orquestador: plan para Pestaña 3 y Dashboard ─────
  /**
   * ctx: { items, movements, orderLines, suppliers, locations,
   *        pendingReviewItemIds (array|Set), now }
   */
  // ─── Revisión, traslados inferidos y disponibilidad ───────

  /**
   * Lista para el «Conteo diario de críticos» y los recordatorios: insumos
   * cuyo punto de uso vence en las próximas `withinHours` horas (o ya venció).
   * rows: plan.rows de buildSupplyPlan.
   */
  const buildReviewList = (rows, { withinHours = 0, onlyCritical = false } = {}) => rows
    .filter((r) => r.item.active !== false && (!onlyCritical || r.item.isCritical))
    .map((r) => ({ row: r, poc: r.summary.byLocation[r.item.defaultLocationId] }))
    .filter(({ poc }) => poc && !poc.archived && poc.hoursUntilDue <= withinHours)
    .sort((a, b) => a.poc.hoursUntilDue - b.poc.hoursUntilDue)
    .map(({ row, poc }) => ({
      item: row.item,
      locationId: row.item.defaultLocationId,
      dueAt: poc.dueAt,
      hoursUntilDue: poc.hoursUntilDue,
      overdue: poc.hoursUntilDue < 0,
      expectedFull: poc.full
    }));

  /**
   * Si en el punto de uso se cuenta MÁS de lo esperado y hay stock en la
   * reserva, lo más probable es un traslado no registrado. Devuelve la
   * sugerencia (redondeada a unidades de compra enteras, sin superar lo que
   * hay en la reserva) y los movimientos listos, fechados 1 s ANTES del
   * conteo para que el conteo del punto de uso los absorba y solo se
   * descuenten de la reserva. Devuelve null si no aplica.
   */
  const inferTransferFromCount = ({ item, countedQty, expectedQty, reserveQty, countedAt, newId }) => {
    if (!item || !item.reserveLocationId || countedQty === null || countedQty === undefined) return null;
    const surplus = Number(countedQty) - num(expectedQty, 0);
    const available = num(reserveQty, 0);
    if (surplus <= EPS || available <= EPS) return null;
    const per = item.unitsPerPurchase || 1;
    const suggestedQty = Math.min(available, Math.ceil(surplus / per - EPS) * per);
    const at = new Date(ts(countedAt) - 1000).toISOString();
    return {
      surplus,
      suggestedQty,
      message: `Hay ${formatQty(surplus, item)} más de lo esperado. ` +
        `¿Trajiste ${formatQty(suggestedQty, item)} de la reserva?`,
      movements: buildTransferMovements(item.id, item.reserveLocationId, item.defaultLocationId,
        suggestedQty, at, newId).map((m) => ({ ...m, note: 'Traslado detectado en relevo' }))
    };
  };

  /** Aviso antes de trasladar más de lo que el sistema cree que hay en el origen. */
  const checkTransferAvailability = ({ item, qtyBase, availableQty }) => {
    const available = num(availableQty, 0);
    if (qtyBase <= available + EPS) return { ok: true, available };
    return {
      ok: false,
      available,
      warning: `El sistema cree que en el origen quedan ${formatQty(Math.max(0, available), item)}. ` +
        '¿Registrar igual el traslado y revisar esa ubicación?'
    };
  };

  /**
   * Convierte filas de inventory_stock_view (ya en camelCase: itemId,
   * locationId, stockState, quantity, rawQuantity, lastCountedAt) al mismo
   * formato que devuelve deriveStock.
   */
  const stockMapFromRows = (rows) => {
    const map = new Map();
    rows.forEach((r) => {
      const raw = Number(r.rawQuantity !== undefined && r.rawQuantity !== null ? r.rawQuantity : r.quantity);
      map.set(stockKey(r.itemId, r.locationId, r.stockState), {
        itemId: r.itemId, locationId: r.locationId, stockState: r.stockState || 'full',
        quantity: Math.max(0, raw), rawQuantity: raw, negative: raw < -EPS,
        lastCountedAt: r.lastCountedAt || null
      });
    });
    return map;
  };

  const buildSupplyPlan = (ctx, opts) => {
    const locationsById = new Map(ctx.locations.map((l) => [l.id, l]));
    const suppliersById = new Map(ctx.suppliers.map((s) => [s.id, s]));
    // En Supabase, pasar ctx.stockRows (de inventory_stock_view) y solo los
    // movimientos recientes en ctx.movements. En LOCAL_MODE basta con el libro.
    const stockMap = ctx.stockRows ? stockMapFromRows(ctx.stockRows) : deriveStock(ctx.movements);
    const inTransit = inTransitByItem(ctx.orderLines);

    const rows = ctx.items.filter((item) => item.active !== false).map((item) => {
      const supplier = suppliersById.get(item.supplierId) || null;
      const summary = summarizeItemStock(item, stockMap, locationsById,
        { now: ctx.now, pendingReviewItemIds: ctx.pendingReviewItemIds });
      const consumption = resolveDailyConsumption(item, estimateDailyConsumption(item, ctx.movements, ctx.now, opts), opts);
      const reorder = computeReorder(item, {
        onHandFull: summary.onHandFull,
        emptyUnits: summary.emptyUnits,
        inTransitBase: inTransit.get(item.id) || 0,
        dailyConsumption: consumption.value,
        leadHours: leadTimeHours(item, supplier),
        now: ctx.now
      }, opts);
      return {
        item, supplier, summary, consumption, reorder,
        status: evaluateStatus(item, reorder, summary),
        transfer: suggestPointOfCareTransfer(item, summary),
        suggestedLine: reorder.purchaseUnits > 0 ? {
          itemId: item.id,
          destinationLocationId: item.reserveLocationId || item.defaultLocationId,
          qtyPurchaseUnits: reorder.purchaseUnits,
          qtyBase: toBase(reorder.purchaseUnits, item),
          emptiesToExchange: reorder.exchange ? reorder.exchange.emptiesToExchange : 0
        } : null
      };
    });

    rows.sort((a, b) =>
      (STATUS_ORDER.indexOf(a.status.status) - STATUS_ORDER.indexOf(b.status.status)) ||
      ((a.reorder.coverageOnHandDays ?? Infinity) - (b.reorder.coverageOnHandDays ?? Infinity)));

    const counts = {};
    rows.forEach((r) => { counts[r.status.status] = (counts[r.status.status] || 0) + 1; });
    return { rows, counts };
  };

  return Object.freeze({
    DEFAULTS,
    toBase, toPurchaseUnitsCeil, formatQty, formatDuration,
    parseCountInput, checkPlausibility, buildRelayCounts,
    buildEmptiedMovements, buildTransferMovements, toRpcMovementRows,
    buildReviewList, inferTransferFromCount, checkTransferAvailability,
    deriveStock, stockMapFromRows, summarizeItemStock,
    cylindersPerDay, estimateDailyConsumption, resolveDailyConsumption,
    leadTimeHours, treatmentDaysLeft, inTransitByItem, computeReorder, evaluateStatus,
    suggestPointOfCareTransfer, evaluateOpenContainer, computePaoExpiry,
    evaluateOrderLine, buildWhatsAppMessage, buildWhatsAppUrl,
    buildSupplyPlan
  });
})();

// Solo para pruebas con Node (node --test). En el navegador no hace nada.
if (typeof module !== 'undefined' && module.exports) module.exports = InventoryCalc;
