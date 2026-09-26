// Ejecutar desde la raíz del proyecto:  node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/inventory-calc.js');

const H = 3600 * 1000;
const D = 24 * H;
const NOW = new Date(2026, 8, 24, 12, 0, 0); // 24/09/2026 12:00 hora local
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();

let seq = 0;
const newId = () => 'id-' + (++seq);

const HAB = { id: 'hab', kind: 'habitacion', maxAuditAgeHours: 24 };
const ARM = { id: 'arm', kind: 'armario', maxAuditAgeHours: 168 };
const FARMACIA = { id: 'far', leadTimeHours: 48 };
const GASES = { id: 'gas', leadTimeHours: 6 };

// Fármaco vinculado a medications: consumo diario desde la pauta
const omeprazol = {
  id: 'ome', name: 'Omeprazol 20mg', presentation: '', medicationId: 'med_1',
  consumptionType: 'continuo', defaultLocationId: 'hab', reserveLocationId: 'arm', supplierId: 'far',
  unit: 'cápsula', purchaseUnit: 'caja', unitsPerPurchase: 14, unitsPerDose: 1,
  pautaDailyAmount: 1, safetyDays: 3, reviewPeriodDays: 7, pointOfCareMin: 7, minThreshold: 0
};

const oxigeno = {
  id: 'o2', name: 'Oxígeno', presentation: 'Cilindro E', consumptionType: 'continuo',
  defaultLocationId: 'hab', supplierId: 'gas', unit: 'cilindro', purchaseUnit: 'cilindro', unitsPerPurchase: 1,
  isReturnable: true, totalCirculatingUnits: 4, cylinderCapacityLiters: 680, flowLpm: 2, hoursPerDay: 24,
  isCritical: true, safetyDays: 0.25, reviewPeriodDays: 0.5
};

const gasas = {
  id: 'gas10', name: 'Gasas 10x10', unit: 'sobre', purchaseUnit: 'caja', unitsPerPurchase: 50,
  defaultLocationId: 'hab', reserveLocationId: 'arm', supplierId: 'far',
  minThreshold: 20, optimalStock: 100
};

const count = (item, loc, qty, off, state = 'full') => ({
  itemId: item, locationId: loc, stockState: state, movementType: 'count',
  qtyAbsolute: qty, occurredAt: at(off), clientEventId: newId()
});
const mov = (item, loc, type, delta, off, state = 'full', extra = {}) => ({
  itemId: item, locationId: loc, stockState: state, movementType: type,
  delta, occurredAt: at(off), clientEventId: newId(), ...extra
});
const plan = (items, movements, extra = {}) => C.buildSupplyPlan({
  items, movements, orderLines: [], suppliers: [FARMACIA, GASES], locations: [HAB, ARM], now: NOW, ...extra
});

// ─────────────────────────────────────────────────────────────
test('Relevo: casilla vacía es OMITIDA, no cero', () => {
  assert.deepEqual(C.parseCountInput(''), { status: 'omitted', value: null });
  assert.deepEqual(C.parseCountInput('   '), { status: 'omitted', value: null });
  assert.deepEqual(C.parseCountInput('0'), { status: 'ok', value: 0 });
  assert.deepEqual(C.parseCountInput(' 12 '), { status: 'ok', value: 12 });
  assert.equal(C.parseCountInput('-1').status, 'invalid');
  assert.equal(C.parseCountInput('12a').status, 'invalid');
  assert.deepEqual(C.parseCountInput('2,5', { allowDecimal: true }), { status: 'ok', value: 2.5 });
  assert.equal(Number(''), 0, 'recordatorio del bug que esta función evita');
});

test('Relevo: omitidos no bloquean, inválidos sí; alerta de tipeo 12→120', () => {
  const r = C.buildRelayCounts([
    { item: omeprazol, locationId: 'hab', rawFull: '120', expectedFull: 12 },
    { item: { ...omeprazol, id: 'x' }, locationId: 'hab', rawFull: '' },
    { item: oxigeno, locationId: 'hab', rawFull: '1', rawEmpty: '' }
  ], newId);
  assert.equal(r.canSave, true);
  assert.deepEqual(r.omittedItemIds, ['x']);
  assert.equal(r.counts.length, 2);
  assert.equal(r.warnings.length, 1);
  assert.equal(C.buildRelayCounts([{ item: omeprazol, locationId: 'hab', rawFull: 'doce' }], newId).canSave, false);
});

test('Stock: idéntico sin importar el orden de llegada de los datos', () => {
  const g = 'grp';
  const movs = [
    count('o2', 'hab', 2, -1 * H), count('o2', 'hab', 1, -1 * H, 'empty'),
    mov('o2', 'hab', 'emptied', -1, -0.5 * H, 'full', { groupId: g }),
    mov('o2', 'hab', 'emptied', 1, -0.5 * H, 'empty', { groupId: g })
  ];
  const a = C.deriveStock(movs);
  const b = C.deriveStock([...movs].reverse());
  assert.equal(a.get('o2|hab|full').quantity, 1);
  assert.equal(a.get('o2|hab|empty').quantity, 2);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
});

test('Stock: un evento anterior al conteo queda absorbido; anulados no cuentan', () => {
  const movs = [mov('ome', 'hab', 'consume', -2, -3 * H), count('ome', 'hab', 10, -2 * H),
    { ...mov('ome', 'hab', 'consume', -3, -H), voidedAt: at(0) }];
  assert.equal(C.deriveStock(movs).get('ome|hab|full').quantity, 10);
});

test('Stock negativo se marca como anomalía', () => {
  const movs = [count('ome', 'arm', 0, -2 * H), mov('ome', 'arm', 'transfer', -14, -H)];
  const row = C.deriveStock(movs).get('ome|arm|full');
  assert.equal(row.quantity, 0);
  assert.equal(row.negative, true);
});

test('Consumo: la pauta de medicación tiene prioridad y avisa si lo observado difiere', () => {
  const est = { value: 2.2 };
  const r = C.resolveDailyConsumption(omeprazol, est);
  assert.equal(r.source, 'pauta');
  assert.equal(r.value, 1);
  assert.match(r.warning, /pauta médica/);
  assert.equal(C.resolveDailyConsumption({ ...omeprazol, pautaDailyAmount: null, dailyConsumption: 3 }, null).source, 'configurado');
  assert.equal(C.resolveDailyConsumption(oxigeno, est).source, 'flujo');
});

test('Medicamento pausado o suspendido: no genera compra aunque tenga pauta', () => {
  for (const st of ['paused', 'suspended']) {
    const item = { ...omeprazol, medicationStatus: st };
    const c = C.resolveDailyConsumption(item, null);
    assert.equal(c.source, 'medicamento_pausado');
    const r = C.computeReorder(item, { onHandFull: 0, inTransitBase: 0, dailyConsumption: c.value, leadHours: 24, now: NOW });
    assert.equal(r.purchaseUnits, 0);
  }
  assert.equal(C.resolveDailyConsumption({ ...omeprazol, medicationStatus: 'active' }, null).source, 'pauta');
});

test('Consumo estimado: las dosis administradas cuentan y un traslado no registrado se compensa', () => {
  // 10 días. Cada día se registra 1 dosis (consume). Cada 5 días se traen 5 del armario SIN registrarlo.
  const movs = [count('ome', 'hab', 10, -10 * D), count('ome', 'arm', 28, -10 * D)];
  for (let d = 9; d >= 0; d--) movs.push(mov('ome', 'hab', 'consume', -1, -d * D - H));
  movs.push(count('ome', 'hab', 10, -5 * D), count('ome', 'arm', 23, -5 * D));
  movs.push(count('ome', 'hab', 10, 0), count('ome', 'arm', 18, 0));
  const est = C.estimateDailyConsumption(omeprazol, movs, NOW);
  assert.ok(Math.abs(est.value - 1) < 1e-9, `debe dar 1/día, dio ${est.value}`);
});

test('Consumo estimado: historial corto no inventa un dato', () => {
  const movs = [count('ome', 'hab', 10, -1 * D), count('ome', 'hab', 8, 0)];
  assert.equal(C.estimateDailyConsumption(omeprazol, movs, NOW).value, null);
});

test('Reposición: descuenta lo que ya está en camino (antiduplicidad)', () => {
  const input = { onHandFull: 4, inTransitBase: 0, dailyConsumption: 1, leadHours: 48, now: NOW };
  const sinPedido = C.computeReorder(omeprazol, input);
  assert.ok(sinPedido.purchaseUnits > 0);
  const conPedido = C.computeReorder(omeprazol, { ...input, inTransitBase: C.toBase(sinPedido.purchaseUnits, omeprazol) });
  assert.equal(conPedido.purchaseUnits, 0);
});

test('Reposición: cápsulas → cajas, sumando todas las ubicaciones', () => {
  const r = C.computeReorder(omeprazol, { onHandFull: 40, dailyConsumption: 1, leadHours: 48, now: NOW });
  assert.equal(r.reorderPointBase, 5);
  assert.equal(r.purchaseUnits, 0);
  const bajo = C.computeReorder(omeprazol, { onHandFull: 5, dailyConsumption: 1, leadHours: 48, now: NOW });
  assert.equal(bajo.needBase, 7);
  assert.equal(bajo.purchaseUnits, 1);
  assert.equal(C.formatQty(40, omeprazol), '2 cajas + 12 cápsulas');
});

test('Reposición: sin consumo usa los umbrales fijos existentes (min_threshold / optimal_stock)', () => {
  const r = C.computeReorder(gasas, { onHandFull: 15, dailyConsumption: null, leadHours: 48, now: NOW });
  assert.equal(r.mode, 'umbral_fijo');
  assert.equal(r.needBase, 85);
  assert.equal(r.purchaseUnits, 2);
  assert.equal(C.computeReorder({ ...gasas, optimalStock: null, minThreshold: 0 },
    { onHandFull: 5, dailyConsumption: null, leadHours: 48, now: NOW }).mode, 'sin_configurar');
});

test('Tratamiento con fecha de término: no compra de más ni después del final', () => {
  const levo = { ...omeprazol, id: 'levo', unit: 'tableta', unitsPerPurchase: 7,
    consumptionType: 'variable', reserveLocationId: null, treatmentEndDate: '2026-09-28' };
  const r = C.computeReorder(levo, { onHandFull: 2, dailyConsumption: 1, leadHours: 24, now: NOW });
  assert.ok(r.treatmentDaysLeft > 4 && r.treatmentDaysLeft < 5);
  assert.ok(r.needBase <= r.treatmentDaysLeft - 2 + 1e-9);
  assert.equal(r.purchaseUnits, 1);
  assert.equal(C.computeReorder(levo, { onHandFull: 5, dailyConsumption: 1, leadHours: 24, now: NOW }).purchaseUnits, 0);
  const fin = C.computeReorder({ ...levo, treatmentEndDate: '2026-09-20' },
    { onHandFull: 0, dailyConsumption: 1, leadHours: 24, now: NOW });
  assert.equal(fin.mode, 'tratamiento_finalizado');
});

test('Oxígeno: consumo por flujo, cilindro en uso conservador, canje y balance', () => {
  const perDay = C.cylindersPerDay(oxigeno);
  assert.ok(Math.abs(perDay - 4.235) < 0.01);
  const r = C.computeReorder(oxigeno, { onHandFull: 2, emptyUnits: 2, dailyConsumption: perDay, leadHours: 6, now: NOW });
  assert.equal(r.onHandEffective, 1.5);
  assert.ok(r.coverageOnHandDays * 24 > 8 && r.coverageOnHandDays * 24 < 9);
  assert.equal(r.exchange.emptiesToExchange, 2);
  assert.equal(r.exchange.additionalUnitsNeeded, r.purchaseUnits - 2);
  assert.equal(r.exchange.circuitDiscrepancy, 0);
});

test('Semáforo: dato viejo nunca da falso verde, pero no oculta un rojo', () => {
  const viejo = plan([omeprazol], [count('ome', 'hab', 20, -3 * D), count('ome', 'arm', 28, -3 * D)]);
  assert.equal(viejo.rows[0].status.baseStatus, 'optimo');
  assert.equal(viejo.rows[0].status.status, 'desconocido');
  const rojo = plan([omeprazol], [count('ome', 'hab', 1, -3 * D)]);
  assert.equal(rojo.rows[0].status.status, 'critico');
  assert.equal(rojo.rows[0].status.lowConfidence, true);
});

test('Semáforo: ítem omitido en el relevo queda pendiente', () => {
  const p = plan([omeprazol], [count('ome', 'hab', 20, -H), count('ome', 'arm', 28, -H)], { pendingReviewItemIds: ['ome'] });
  assert.equal(p.rows[0].status.status, 'desconocido');
});

test('Traslado sugerido desde la reserva al punto de uso', () => {
  const t = plan([omeprazol], [count('ome', 'hab', 3, -H), count('ome', 'arm', 28, -H)]).rows[0].transfer;
  assert.equal(t.fromLocationId, 'arm');
  assert.equal(t.qtyBase, 14);
});

test('PAO: abrir nuevo si hay cerrados, comprar si no; pedir antes si el proveedor tarda', () => {
  const c = { expiresAt: at(30 * H) };
  assert.equal(C.evaluateOpenContainer(c, { now: NOW, sealedUnitsAvailable: 2 }).action, 'abrir_nuevo');
  assert.equal(C.evaluateOpenContainer(c, { now: NOW, sealedUnitsAvailable: 0 }).action, 'comprar');
  const lejos = { expiresAt: at(80 * H) };
  assert.equal(C.evaluateOpenContainer(lejos, { now: NOW, sealedUnitsAvailable: 0, leadHours: 48 }).status, 'reorden');
  assert.equal(C.evaluateOpenContainer(lejos, { now: NOW, sealedUnitsAvailable: 1, leadHours: 48 }).status, 'ok');
  assert.equal(C.computePaoExpiry('2026-09-01T00:00:00.000Z', 15), '2026-09-16T00:00:00.000Z');
});

test('Pedido huérfano: se escala pasado el plazo', () => {
  const line = { status: 'in_transit', expectedBy: at(-30 * H), handledByName: 'Laura P.' };
  assert.equal(C.evaluateOrderLine(line, NOW).status, 'escalar');
  assert.equal(C.evaluateOrderLine({ ...line, expectedBy: at(2 * H) }, NOW).status, 'a_tiempo');
});

test('WhatsApp: texto ordenado y URL codificada', () => {
  const text = C.buildWhatsAppMessage({
    supplierName: 'Farmacia San Rafael', handledByName: 'Laura P.',
    lines: [{ item: omeprazol, qtyPurchaseUnits: 2 }, { item: oxigeno, qtyPurchaseUnits: 1, emptiesToExchange: 1 }]
  });
  assert.match(text, /Omeprazol 20mg: 2 cajas/);
  assert.match(text, /Cilindros vacíos para canje: 1/);
  const url = C.buildWhatsAppUrl(text, '+58 (412) 555-0101');
  assert.ok(url.startsWith('https://wa.me/584125550101?text='));
  assert.equal(decodeURIComponent(url.split('text=')[1]), text);
});

test('Plan completo: ordena por gravedad y genera la línea sugerida', () => {
  const p = plan([omeprazol, oxigeno], [
    count('ome', 'hab', 20, -H), count('ome', 'arm', 28, -H),
    count('o2', 'hab', 1, -H), count('o2', 'hab', 3, -H, 'empty')
  ]);
  assert.equal(p.rows[0].item.id, 'o2');
  assert.equal(p.rows[0].status.status, 'critico');
  assert.equal(p.rows[0].status.alertActive, true);
  assert.ok(p.rows[0].suggestedLine.emptiesToExchange > 0);
  assert.equal(p.rows[1].status.status, 'optimo');
});

test('Vaciado y traslado: grupos de 2 filas con signos correctos y formato RPC', () => {
  let n = 0; const id = () => 'e' + (++n);
  const v = C.buildEmptiedMovements('o2', 'hab', NOW, id);
  assert.deepEqual(v.map(m => [m.stockState, m.delta]), [['full', -1], ['empty', 1]]);
  assert.equal(v[0].groupId, v[1].groupId);
  assert.notEqual(v[0].clientEventId, v[1].clientEventId);

  const t = C.buildTransferMovements('ome', 'arm', 'hab', 14, NOW, id);
  assert.deepEqual(t.map(m => [m.locationId, m.delta]), [['arm', -14], ['hab', 14]]);
  assert.throws(() => C.buildTransferMovements('ome', 'arm', 'arm', 1, NOW, id));
  assert.throws(() => C.buildTransferMovements('ome', 'arm', 'hab', 0, NOW, id));

  const rows = C.toRpcMovementRows(v);
  assert.deepEqual(Object.keys(rows[0]).sort(),
    ['client_event_id', 'delta', 'group_id', 'item_id', 'location_id', 'movement_type', 'occurred_at', 'stock_state']);
  const counts = C.toRpcMovementRows([{ itemId: 'x', locationId: 'hab', stockState: 'full', qtyAbsolute: 0, clientEventId: 'c' }]);
  assert.equal(counts[0].qty_absolute, 0, 'un conteo de cero se envía, no se descarta');
  assert.equal(counts[0].delta, undefined);
});

test('Supabase: el plan con stockRows del servidor + 30 días de historial da lo mismo que el libro completo', () => {
  // 60 días: 1 dosis diaria en habitación, conteo semanal, traslado no registrado cada 14 días.
  const full = [count('ome', 'hab', 20, -60 * D), count('ome', 'arm', 56, -60 * D)];
  let hab = 20, arm = 56;
  for (let d = 59; d >= 1; d--) {
    full.push(mov('ome', 'hab', 'consume', -1, -d * D)); hab -= 1;
    if (d % 14 === 0) { hab += 14; arm -= 14; }            // traslado sin registrar
    if (d % 7 === 0) { full.push(count('ome', 'hab', hab, -d * D + H)); full.push(count('ome', 'arm', arm, -d * D + H)); }
  }
  const recent = full.filter(m => new Date(m.occurredAt).getTime() >= NOW.getTime() - 30 * D);
  const stockRows = [...C.deriveStock(full).values()];

  const base = { items: [{ ...omeprazol, pautaDailyAmount: null }], orderLines: [], suppliers: [FARMACIA], locations: [HAB, ARM], now: NOW };
  const a = C.buildSupplyPlan({ ...base, movements: full });
  const b = C.buildSupplyPlan({ ...base, movements: recent, stockRows });

  assert.equal(a.rows[0].summary.onHandFull, b.rows[0].summary.onHandFull);
  assert.ok(Math.abs(a.rows[0].consumption.value - 1) < 1e-9, 'libro completo: 1/día');
  assert.ok(Math.abs(b.rows[0].consumption.value - 1) < 1e-9, 'historial truncado: 1/día');
  assert.equal(a.rows[0].reorder.purchaseUnits, b.rows[0].reorder.purchaseUnits);
});

test('Ubicación archivada: su conteo viejo no deja el insumo en gris; si conserva stock, avisa', () => {
  const MAL = { id: 'mal', kind: 'otro', maxAuditAgeHours: 168, active: false };
  const item = { ...omeprazol, pautaDailyAmount: 1 };
  // Stock vigente en habitación y armario; en el maletín archivado quedó en 0 hace 40 días
  const movs = [count('ome', 'hab', 20, -H), count('ome', 'arm', 28, -H), count('ome', 'mal', 0, -40 * D)];
  const ok = C.buildSupplyPlan({ items: [item], movements: movs, orderLines: [], suppliers: [FARMACIA],
    locations: [HAB, ARM, MAL], now: NOW });
  assert.equal(ok.rows[0].status.status, 'optimo');
  assert.deepEqual(ok.rows[0].summary.staleLocations, []);
  assert.equal(ok.rows[0].summary.byLocation.mal.archived, true);

  // Misma ubicación archivada pero con stock (p. ej. un error en LOCAL_MODE): baja confianza y motivo claro
  const bad = C.buildSupplyPlan({ items: [item], movements: [...movs, count('ome', 'mal', 5, -2 * H)],
    orderLines: [], suppliers: [FARMACIA], locations: [HAB, ARM, MAL], now: NOW });
  assert.equal(bad.rows[0].status.status, 'desconocido');
  assert.ok(bad.rows[0].status.reasons.some(r => /ubicación archivada/.test(r)));
});

// ─── 09: revisión por insumo, control por conteo y traslados inferidos ───
const HAB50 = { ...HAB, maxAuditAgeHours: 50 };
const ARM720 = { ...ARM, maxAuditAgeHours: 720 };

test('Revisión: el crítico diario vence a las 26 h en la habitación; el normal sigue la ubicación (50 h)', () => {
  const sonda = { id: 'son', name: 'Sonda', unit: 'unidad', purchaseUnit: 'unidad', unitsPerPurchase: 1,
    defaultLocationId: 'hab', isCritical: true, reviewEveryHours: 26, minThreshold: 2, optimalStock: 6 };
  const gasas = { ...sonda, id: 'gas', name: 'Gasas', isCritical: false, reviewEveryHours: null };
  const movs = [count('son', 'hab', 5, -30 * H), count('gas', 'hab', 5, -30 * H)];
  const plan = C.buildSupplyPlan({ items: [sonda, gasas], movements: movs, orderLines: [],
    suppliers: [FARMACIA], locations: [HAB50, ARM720], now: NOW });
  const s = plan.rows.find(r => r.item.id === 'son');
  const g = plan.rows.find(r => r.item.id === 'gas');
  assert.equal(s.status.reviewDue, true);
  assert.equal(s.status.alertActive, true, 'un crítico sin revisar es alerta, no solo gris');
  assert.equal(s.status.status, 'desconocido');
  assert.match(s.status.reasons[0], /Revisión diaria pendiente: último conteo hace 30 h/);
  assert.equal(g.status.reviewDue, false);
  assert.equal(g.status.status, 'optimo');

  const list = C.buildReviewList(plan.rows, { withinHours: 2, onlyCritical: true });
  assert.deepEqual(list.map(x => x.item.id), ['son']);
  assert.equal(list[0].overdue, true);
  assert.equal(list[0].expectedFull, 5);
  // Sin filtro de críticos y con 24 h de margen, entra también Gasas (vence en 20 h)
  assert.deepEqual(C.buildReviewList(plan.rows, { withinHours: 24 }).map(x => x.item.id), ['son', 'gas']);
});

test('Control por conteo: la pauta no se usa como consumo; manda el máximo configurado', () => {
  const tram = { ...omeprazol, id: 'tra', stockControl: 'conteo', pautaDailyAmount: 2, dailyConsumption: 4 };
  const c = C.resolveDailyConsumption(tram, { value: 3 });
  assert.equal(c.source, 'configurado');
  assert.equal(c.value, 4);
  assert.equal(C.resolveDailyConsumption({ ...tram, dailyConsumption: null }, { value: 3 }).source, 'estimado');
  assert.equal(C.resolveDailyConsumption({ ...tram, stockControl: 'dosis' }, null).source, 'pauta');
});

test('Traslado inferido: redondea a cajas, no supera la reserva y el conteo lo absorbe', () => {
  const tram = { ...omeprazol, id: 'tra', unitsPerPurchase: 10, purchaseUnit: 'caja', unit: 'tableta' };
  let n = 0; const id = () => 't' + (++n);
  const countedAt = at(0);
  const sug = C.inferTransferFromCount({ item: tram, countedQty: 24, expectedQty: 20, reserveQty: 30, countedAt, newId: id });
  assert.equal(sug.surplus, 4);
  assert.equal(sug.suggestedQty, 10, 'una caja entera: 4 de más + 6 consumidas');
  assert.match(sug.message, /4 tabletas más de lo esperado.*1 caja/);
  assert.ok(sug.movements.every(m => new Date(m.occurredAt) < new Date(countedAt)));

  // Aplicado junto al relevo: habitación = lo contado, armario − 1 caja
  const movs = [count('tra', 'hab', 20, -D), count('tra', 'arm', 30, -D), ...sug.movements,
    { ...count('tra', 'hab', 24, 0) }];
  const st = C.deriveStock(movs);
  assert.equal(st.get('tra|hab|full').quantity, 24);
  assert.equal(st.get('tra|arm|full').quantity, 20);

  assert.equal(C.inferTransferFromCount({ item: tram, countedQty: 24, expectedQty: 20, reserveQty: 6, countedAt, newId: id }).suggestedQty, 6);
  assert.equal(C.inferTransferFromCount({ item: tram, countedQty: 18, expectedQty: 20, reserveQty: 30, countedAt, newId: id }), null);
  assert.equal(C.inferTransferFromCount({ item: { ...tram, reserveLocationId: null }, countedQty: 24, expectedQty: 20, reserveQty: 30, countedAt, newId: id }), null);
  assert.equal(C.inferTransferFromCount({ item: tram, countedQty: 24, expectedQty: 20, reserveQty: 0, countedAt, newId: id }), null);
});

test('Circuito almacén → habitación con control por conteo: stock y consumo correctos', () => {
  // 10 días. Armario recibe 30; se trasladan 10 el día 5 (registrado) y 10 el día 8 (inferido en relevo).
  const tram = { ...omeprazol, id: 'tra', unitsPerPurchase: 10, stockControl: 'conteo', pautaDailyAmount: null, dailyConsumption: null };
  let n = 0; const id = () => 'c' + (++n);
  const movs = [count('tra', 'hab', 10, -10 * D), count('tra', 'arm', 0, -10 * D),
    mov('tra', 'arm', 'receive', 30, -9 * D),
    ...C.buildTransferMovements('tra', 'arm', 'hab', 10, at(-5 * D), id),
    count('tra', 'hab', 12, -4 * D)];   // 10 + 10 − 8 en 6 días
  const inferred = C.inferTransferFromCount({ item: tram, countedQty: 16, expectedQty: 12, reserveQty: 20, countedAt: at(-1 * D), newId: id });
  movs.push(...inferred.movements, count('tra', 'hab', 16, -1 * D));   // 12 + 10 − 6 en 3 días
  const plan = C.buildSupplyPlan({ items: [tram], movements: movs, orderLines: [], suppliers: [FARMACIA],
    locations: [HAB50, ARM720], now: NOW });
  const r = plan.rows[0];
  assert.equal(r.summary.byLocation.hab.full, 16);
  assert.equal(r.summary.byLocation.arm.full, 10);
  assert.equal(r.summary.onHandFull, 26);
  assert.equal(r.consumption.source, 'estimado');
  assert.ok(Math.abs(r.consumption.value - 14 / 10) < 1e-9, '8 + 6 tabletas en 10 días');
  assert.equal(r.summary.staleLocations.length, 0, 'el armario con verificación mensual no pasa a gris');
});

test('Aviso de traslado mayor que lo disponible', () => {
  assert.equal(C.checkTransferAvailability({ item: omeprazol, qtyBase: 14, availableQty: 28 }).ok, true);
  const w = C.checkTransferAvailability({ item: omeprazol, qtyBase: 14, availableQty: 0 });
  assert.equal(w.ok, false);
  assert.match(w.warning, /quedan 0 cápsulas/);
});
