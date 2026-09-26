# Prompt para Antigravity — Plan de implementación del módulo «Gestión Insumos»

> **Antes de usarlo**
> 1. Copia al repositorio de CuidApp:
>    - `supabase/05b_fix_primer_admin.sql`
>    - `supabase/07_insumos.sql`
>    - `js/inventory-calc.js`
>    - `tests/inventory-calc.test.js`
>    - `docs/plan_implementacion_gestion_insumos.md` (tu plan v2.2)
> 2. Abre Antigravity en modo **Planning**.
> 3. Pega todo lo que está debajo de la línea.
> 4. Revisa el *Implementation Plan* que genere y responde sus preguntas abiertas **antes** de aprobarlo.

---

## ROL Y OBJETIVO

Actúa como ingeniero de software sénior y responsable de calidad de **CuidApp v2**, una aplicación web para coordinar el cuidado domiciliario de un paciente de alta dependencia médica.

En esta etapa tu tarea es **solo producir un plan de implementación detallado** del módulo «Gestión Insumos». **No escribas ni modifiques código** hasta que yo apruebe el plan. Si algo es ambiguo o contradice el código real, **pregúntame**: no lo resuelvas por tu cuenta.

Un error en este módulo puede dejar al paciente sin un medicamento o sin oxígeno. Prioriza la corrección sobre la velocidad y hazlo explícito en cada fase.

## FUENTES DE VERDAD (en orden de prioridad)

1. **Este prompt.** Donde contradiga al plan v2.2, manda este prompt.
2. **`supabase/07_insumos.sql`.** Es la capa de datos ya diseñada y probada en PostgreSQL 16 sobre 01–06 y 05b: dosis, reposiciones, relevos, antiduplicidad, recepción con canje, RLS, auditoría y re-ejecución. No la rediseñes. Si detectas un error, descríbelo con evidencia y propón el cambio mínimo en un archivo nuevo `08_…sql`.
3. **`js/inventory-calc.js` y `tests/inventory-calc.test.js`.** Contienen toda la lógica de cálculo, con 23 pruebas que pasan (`node --test`). La interfaz **no debe reimplementar** ninguno de estos cálculos.
4. **El código existente**: `js/api.js`, `js/local-store.js`, `supabase/01…06`, `index.html`, `css/styles.css` y los módulos JS actuales de Inventario, Medicamentos y Dashboard. Es la referencia de patrones y convenciones.
5. **`docs/plan_implementacion_gestion_insumos.md` (v2.2).** Es la referencia de interfaz, flujos y wireframes.

Lee todos estos archivos completos antes de planificar. Cita archivo y función cuando te apoyes en el código existente. Localiza tú mismo qué archivos JS implementan hoy las pantallas de Inventario, Medicamentos y Dashboard; no los supongas.

## CORRECCIONES VINCULANTES AL PLAN v2.2

1. **No existe sincronización offline.** El «Dual Storage» del plan son **dos modos excluyentes**: `LOCAL_MODE` guarda todo en localStorage vía `LocalStore`, y el modo Supabase funciona solo con conexión. No construyas una cola de sincronización. La Fase 8 del plan v2.2 pasa a ser: pruebas del módulo completo **en ambos modos** y reintento seguro ante fallos de red (punto 7).

2. **Nombres reales de la base de datos.** No hay tablas `supplies_*`.
   - Se **extienden** `inventory_items` (catálogo) e `inventory_movements` (libro de movimientos).
   - Tablas nuevas: `supply_locations`, `supply_suppliers`, `supply_relays`, `supply_order_batches`, `supply_order_lines`, `supply_open_containers` y `supply_expiry_records`.
   - Vistas: `inventory_items_view` (ampliada, conserva todas sus columnas anteriores), `inventory_stock_view` y `supply_in_transit_view`.
   - RPC nuevas: `record_supply_movements`, `save_supply_relay`, `mark_supply_in_transit`, `receive_supply_order_line`, `cancel_supply_order_line` y `void_supply_movement`.
   - RPC existentes adaptadas, **con la misma firma**: `record_administration`, `undo_administration`, `record_restock` y `adjust_inventory`. Esta última admite un 4.º parámetro opcional, `p_location_id`.

3. **El stock ya no se edita como número.** `inventory_items.current_stock` y `medications.current_stock` son caché de solo lectura, derivada del libro. El stock cambia registrando un conteo, un consumo, un traslado, un vaciado o una recepción. Si alguien edita el número directamente, el servidor lo rechaza con un error que empieza por `STOCK_LEDGER:`. El stock inicial al **crear** un ítem o un medicamento sí se acepta: se convierte automáticamente en un conteo inicial.

4. **Los medicamentos están integrados.** Al crear un medicamento se crea su ítem en `inventory_items` (`medication_id`) mediante un trigger, con punto de uso en «Habitación» y reserva en «Armario Central».
   - Una dosis administrada genera un consumo en el libro; deshacerla lo anula.
   - Una reposición (`record_restock`) genera una recepción y conserva el historial en `medication_restocks` y el gasto en `expenses`.
   - **Nunca se bloquea una dosis por falta de stock contable.** Si el libro queda en negativo, se muestra como anomalía.
   - El consumo diario de un fármaco sale de su **pauta** (`pauta_daily_amount` en `inventory_items_view`).
   - Un fármaco pausado o suspendido no genera compras.
   - No se puede cambiar la unidad de un medicamento que ya tiene movimientos.

5. **La reposición se calcula por días de cobertura.**
   - Punto de pedido = consumo × (tiempo de entrega + días de seguridad).
   - Siempre se descuenta lo que ya está en camino.
   - El selector Continuo/Variable se mantiene como dato del catálogo (`consumption_type`).
   - Los tratamientos con fin usan `treatment_end_date`.
   - Todo el cálculo lo hacen `InventoryCalc.computeReorder` y `InventoryCalc.buildSupplyPlan`.

6. **Kanban.**
   - El Paso 3 llama a `mark_supply_in_transit`. Si devuelve `conflicts`, se muestra quién ya lo pidió (*«En camino por Laura P.»*).
   - El Paso 4 abre `https://wa.me/…?text=…` con `InventoryCalc.buildWhatsAppUrl`. El portapapeles queda solo como alternativa, porque en iOS falla si se llama después de un `await`.
   - Los pedidos atrasados (`InventoryCalc.evaluateOrderLine`) deben poder **liberarse** con `cancel_supply_order_line`.

7. **Idempotencia.** Cada acción que registra algo (guardar relevo, vaciado, traslado, marcar en camino, recibir) genera su `clientEventId` con `LocalStore.uuid()` **en el momento en que el usuario pulsa**. Si la llamada falla por red, se reintenta con **el mismo** id. Los botones se deshabilitan mientras la operación está en curso.

8. **Fotos de libreta.** En modo Supabase se suben al bucket privado `supply-relay-photos` con la ruta `{clientEventId}.jpg`, comprimidas en el cliente. La tabla guarda solo `photo_path`. En `LOCAL_MODE` **nunca** se guardan en localStorage: en base64 agotan la cuota y provocan pérdida silenciosa de **todos** los datos, porque `LocalStore` guarda la base entera en una sola clave. Propón una alternativa (por ejemplo, IndexedDB) y pregúntame.

9. **Relevo no bloqueante.**
   - Una casilla vacía significa **omitida**, no cero.
   - Está prohibido usar `Number(valor)`, `+valor` o `parseInt` directamente sobre los inputs de conteo. Se usan `InventoryCalc.parseCountInput` y `InventoryCalc.buildRelayCounts`.
   - Los omitidos se guardan en `omitted_item_ids` y el ítem pasa a gris («desconocido»), nunca a verde.
   - El relevo usa el enum existente `shift_slot_t` y se vincula al turno abierto de `shifts`.

10. **PAO a 48 h.** La acción es «abrir envase nuevo» si hay cerrados, y «comprar» solo si no los hay (`InventoryCalc.evaluateOpenContainer`).

## CÓMO SE CONECTAN LA API Y EL MOTOR

- **Movimientos del cliente.** `InventoryCalc.buildEmptiedMovements`, `buildTransferMovements` y `buildRelayCounts` generan los movimientos en camelCase. `InventoryCalc.toRpcMovementRows` los convierte al JSON que esperan `record_supply_movements` y `save_supply_relay`.
- **Plan de compras en Supabase.** Se llama a `buildSupplyPlan` con:
  - `stockRows` ← `inventory_stock_view`, mapeada a camelCase;
  - `movements` ← solo los **últimos 30 días** no anulados de `inventory_movements`, para estimar el consumo;
  - `items` ← `inventory_items_view`;
  - `orderLines` ← `supply_order_lines` con `status = 'in_transit'`;
  - `locations`, `suppliers` y `pendingReviewItemIds` ← `omitted_item_ids` del último relevo.
- **Plan de compras en `LOCAL_MODE`.** Basta con pasar el libro completo en `movements`, sin `stockRows`.
- **Embebido de datos.** PostgREST no anida vistas. Para embeber nombres, usa las tablas base con claves foráneas, por ejemplo: `supply_order_lines` → `inventory_items(name, unit, purchase_unit)` y `profiles(full_name)`.

## CONVENCIONES DEL CÓDIGO EXISTENTE QUE DEBES RESPETAR

- **Módulos:** `const Nombre = (() => { 'use strict'; … return {…}; })();`. Vanilla JS, sin dependencias ni herramientas de compilación.
- **`api.js`:** cada método existe en dos versiones, la remota y la de `LocalAdapter`. El `Proxy` final elige según `isLocal()`. **Todo método nuevo debe existir en ambos lados y agregarse a `apiInstance`.** Si falta en `LocalAdapter`, en `LOCAL_MODE` se ejecuta la versión Supabase y falla con «Cliente de base de datos no inicializado».
- **Contrato de retorno:** las lecturas devuelven datos mapeados a camelCase. Las escrituras devuelven `{ ok: true, … }` o `{ ok: false, error: traducirError(error) }`. Todo pasa por `wrap()`.
- **Base de datos:** LEER de las vistas `*_view` y ESCRIBIR por RPC o en tablas base. Toda vista nueva lleva `with (security_invoker = true)`. Toda RPC comprueba `is_active_user()`. Es un sistema de **un solo paciente**: no hay hogares ni multi-inquilino.
- **Auditoría:**
  - En Supabase la hace el trigger `audit_trigger`, que 07 ya aplicó a las tablas nuevas.
  - En `LOCAL_MODE` se usa `LocalStore.insert/update/remove` con el nombre de tabla SQL como `auditTableName`. `recordAudit` no está exportada: si la necesitas para las RPC emuladas, propón exportarla.
- **XSS:** todo texto interpolado en HTML pasa por `Api.escapeHtml`.
- **Mensajes al usuario:** en español llano, a través de `traducirError`.

## HALLAZGOS EN EL CÓDIGO EXISTENTE QUE EL PLAN DEBE ATENDER

1. **Primer administrador (ya corregido).** El `UPDATE` de `05_seed.sql` no tiene efecto. En el Editor SQL `auth.uid()` es nulo, así que `guard_profile_update` restaura `app_role` y `active`, y el perfil queda inactivo aunque el `UPDATE` termina «con éxito». La corrección está en `05b_fix_primer_admin.sql`. Después hay que repetir el `UPDATE` de 05.

2. **Fechas en UTC.** `todayStr()` en `api.js` y `local-store.js` usa `toISOString()`. En América, a partir de las 19:00–20:00 locales devuelve **la fecha de mañana**. Afecta a `scheduled_date` (y por tanto a `uniq_admin_slot`), a las tareas recurrentes, a los gastos y a este módulo. `current_date` en el servidor también es UTC. **Propón la corrección como Fase 0 separada, pendiente de mi aprobación.**

3. **`traducirError` usa patrones demasiado genéricos.** Cualquier `duplicate key value` se muestra como «Esta dosis programada ya ha sido registrada hoy», y cualquier `check constraint` como «El stock no puede ser menor a cero». Hay que agregar patrones específicos **antes** de los genéricos, al menos para:
   - `STOCK_LEDGER`
   - `one_open_order_per_item`
   - `inventory_movements_ledger_ck`
   - `inventory_items_supply_checks`
   - `inventory_movements_client_event_uq`
   - `supply_relays_not_future`
   - `supply_locations_name_key`
   - `supply_suppliers_name_key`
   - `No se puede cambiar la unidad`

4. **`LocalStore.recordAdministration` bloquea la dosis** si el stock es insuficiente, mientras que el SQL no la bloquea. Debe dejar de bloquearla en ambos modos.

5. **Consumo calculado distinto en cada modo.** `LocalStore.getInventoryItemsView` divide entre 30 días fijos si hay 3 o más salidas, mientras que la vista SQL divide entre los días transcurridos y exige al menos 7. Las pantallas nuevas deben usar solo `InventoryCalc`. Decide si la pantalla antigua también migra.

6. **Campos distintos en `LocalStore`.** Los `inventoryMovements` locales usan `reason`, `previousStock`, `newStock` y `actorId`; Supabase usa `note` y `profile_id`. La migración local debe normalizarlos.

7. **Alertas duplicadas.** Tras la integración, un fármaco bajo podría aparecer dos veces en `getActiveAlerts`: como medicamento y como insumo. Hay que excluir del bloque de inventario los ítems con `medicationId`.

8. **Edición de stock en formularios existentes.** `updateMedication` y `updateInventoryItem` envían `currentStock`, y ahora el servidor lo rechaza. Los formularios deben dejar de enviarlo cuando cambia y ofrecer «Registrar conteo».

9. **Fuera de alcance, solo informar.** En `apiInstance`, `getComplementCategories`, `add/update/deleteComplementCategory`, `get/setAvailableComplementos`, `deleteShoppingItemsBatch` y `getDailyMenu` apuntan siempre a `LocalAdapter`. En modo Supabase guardan datos solo en el dispositivo y no se comparten entre usuarios. Descríbelo en el plan como riesgo del módulo Alimentación, sin corregirlo.

## ALCANCE POR ARCHIVO (detállalo y complétalo en el plan)

- **`supabase/`:**
  - Orden de despliegue: 05b → repetir el `UPDATE` de 05 → 07.
  - La consulta final de 07 debe devolver cero vistas inseguras.
  - Explica cómo verificar la migración en un proyecto Supabase de pruebas antes de producción.

- **`index.html`:**
  - Cargar `js/inventory-calc.js` **antes** de `local-store.js` y de los módulos de inventario.
  - Contenedor `#panel-inventory` con las 4 pestañas.

- **`js/local-store.js`:**
  - Colecciones nuevas en camelCase: `supplyLocations`, `supplySuppliers`, `supplyRelays`, `supplyOrderBatches`, `supplyOrderLines`, `supplyOpenContainers` y `supplyExpiryRecords`.
  - Campos nuevos en `inventoryItems` e `inventoryMovements`, iguales a 07 pero en camelCase.
  - `sanitizeAndMigrate` sube a la versión `2.2.0`. Debe:
    - sembrar las 3 ubicaciones;
    - crear el ítem de cada medicamento que no lo tenga;
    - convertir cada `currentStock` existente en un conteo inicial;
    - normalizar los movimientos antiguos.
  - Emulación de **todas** las RPC de 07 con la misma semántica: idempotencia por `clientEventId`, conflicto de «en camino», recepción con canje y gasto, anulación por grupo y caché de stock recalculada con `InventoryCalc.deriveStock`.

- **`js/api.js`:**
  - Métodos nuevos, en remoto y en `LocalAdapter`. Para cada uno indica firma, RPC o vista usada y mapeo de campos. Como mínimo:
    - lecturas: `getSupplyLocations`, `getSupplySuppliers`, `getInventoryStock`, `getRecentInventoryMovements(days)`, `getSupplyRelays`, `getSupplyOrderLines(status)`, `getOpenContainers`, `getSupplyPlanContext`;
    - proveedores: `addSupplySupplier`, `updateSupplySupplier`;
    - escrituras: `recordSupplyMovements`, `saveSupplyRelay`, `markSupplyInTransit`, `receiveSupplyOrderLine`, `cancelSupplyOrderLine`, `markOrderBatchExported`, `voidSupplyMovement`, `openContainer`, `closeContainer`;
    - fotos: `uploadRelayPhoto`.
  - Ampliar el mapeo de `getInventory` con las columnas nuevas de `inventory_items_view`.
  - Actualizar `traducirError`, `getActiveAlerts` y `exportAllData`.

- **Módulos existentes de Inventario y Medicamentos:** identifica cada pantalla que hoy edita el stock y cómo se adapta. «Ajustar» sigue funcionando vía `adjust_inventory`; «editar stock» pasa a ser «registrar conteo».

- **Módulo nuevo de Gestión Insumos:** los 5 controladores del plan v2.2 (`InventorySharedState`, `RoomRelayController`, `OtherLocationsController`, `KanbanController` y `SpotCatalogController`), alimentados por `InventoryCalc.buildSupplyPlan`. Propón si van en un archivo nuevo o dentro del de inventario existente, justificándolo.

- **Dashboard:** el widget del plan v2.2, con contadores de críticos, reorden, desconocidos, pendientes por revisar, en camino y pedidos atrasados, más el botón de vaciado de cilindro. Si hay varios retornables, el botón debe preguntar **cuál** se vació.

- **`css/styles.css`:**
  - Áreas táctiles de al menos 48 px.
  - Semáforo con un cuarto estado gris («desconocido») que no dependa solo del color.
  - Respetar el tema existente.

## FORMATO DEL PLAN QUE DEBES ENTREGAR

1. **Resumen** de la arquitectura resultante, en un máximo de 10 líneas.

2. **Inventario de archivos:** una tabla con archivo, tipo de cambio (nuevo / modificado / sin cambios) y riesgo.

3. **Fases.** Para cada fase indica objetivo, tareas concretas función por función, archivos, **criterios de aceptación verificables**, pruebas, riesgos y cómo revertir. Orden sugerido (puedes ajustarlo si lo justificas):
   - **Fase 0.** Correcciones previas: 05b y la propuesta de fechas locales, pendiente de aprobación.
   - **Fase 1.** Base de datos: aplicar 07 en un proyecto de pruebas y ejecutar las verificaciones.
   - **Fase 2.** Motor: integrar `inventory-calc.js` y sus pruebas en el repositorio.
   - **Fase 3.** `LocalStore`: migración 2.2.0 y emulación de las RPC.
   - **Fase 4.** `api.js`: métodos nuevos, mapeos, `traducirError` y alertas.
   - **Fase 5.** Adaptar los módulos existentes de Inventario y Medicamentos.
   - **Fases 6 a 9.** Pestañas 1 a 4.
   - **Fase 10.** Widget del Dashboard.
   - **Fase 11.** Pruebas integrales en ambos modos y en dispositivos reales.

4. **Matriz de pruebas.** Cada caso se ejecuta en `LOCAL_MODE` y en Supabase. Como mínimo:
   - Una dosis dada descuenta en Medicamentos y en Insumos, y deshacerla la restituye.
   - Una dosis con stock contable 0 se registra igual y el ítem muestra la anomalía.
   - Un vaciado registrado antes que un relevo contado antes da el stock correcto.
   - Si dos usuarios marcan el mismo ítem «en camino», el segundo ve el conflicto con el nombre del primero.
   - Reintentar con el mismo `clientEventId` no duplica nada.
   - Una recepción parcial con canje de vacíos y costo genera el gasto y, si es fármaco, el registro en `medication_restocks`.
   - Un traslado armario → habitación y su «Deshacer».
   - En un relevo con casillas vacías, el ítem aparece en «Pendientes por Revisar» y en gris; un «0» se registra como cero.
   - Un medicamento pausado no aparece en compras sugeridas.
   - Un usuario inactivo no ve ni escribe nada.
   - Editar el stock directamente muestra un mensaje en español, no un error técnico.
   - En un iPhone real: el teclado numérico del relevo (no tiene tecla Enter; valida `enterkeyhint` y la navegación entre campos) y la exportación a WhatsApp.
   - Relevo de 15 ítems en menos de 30 segundos, medido en un teléfono real.

5. **Orden de despliegue** y lista de verificación posterior.

6. **Preguntas abiertas.** Formúlame al menos estas:
   - ¿Relevo con los 3 turnos de `shift_slot_t` (mañana/tarde/noche) o con 2 (día/noche)?
   - ¿Quién edita el catálogo (umbrales, proveedores, tiempos de entrega)? Hoy cualquier usuario activo puede hacerlo; ¿se restringe a `admin`?
   - ¿Qué hacer con las fotos de libreta en `LOCAL_MODE`?
   - ¿Los medicamentos deben aparecer también en el listado del módulo Inventario existente, o solo en Gestión Insumos?
   - ¿Qué nombres de categoría de gasto usar? Hoy conviven «Medicamentos» y «Farmacia».
   - Valores por defecto de días de seguridad y tiempo de entrega por tipo de proveedor.

## RESTRICCIONES

- No modifiques `supabase/01…07` ni `05b`. Todo cambio de base de datos va en archivos nuevos numerados.
- No introduzcas dependencias, frameworks ni herramientas de compilación.
- No dupliques en la interfaz ningún cálculo que ya exista en `InventoryCalc`. Si necesitas uno nuevo, agrégalo al motor **con su prueba**.
- No uses localStorage para imágenes ni para nada que pueda superar unos pocos KB por registro.
- No marques una fase como terminada sin sus pruebas en verde (`node --test` y la matriz de la fase).
- Si una instrucción de este prompt te parece incorrecta a la luz del código, dilo con evidencia antes de continuar.
