# Adenda para Antigravity — Gestión de ubicaciones y proveedores

> **Antes de usarla**
> 1. Copia al repositorio:
>    - `supabase/08_ubicaciones_proveedores.sql` (nuevo)
>    - `js/inventory-calc.js` (**reemplaza** al anterior)
>    - `tests/inventory-calc.test.js` (**reemplaza** al anterior; ahora son 24 pruebas)
> 2. En la **misma conversación** de Antigravity donde pediste el plan, pega todo lo que está debajo de la línea.
> 3. Si Antigravity ya empezó a escribir código, detenlo antes de pegar esto.

---

## CAMBIO AL PLAN DE IMPLEMENTACIÓN: GESTIÓN DE UBICACIONES Y PROVEEDORES

Actualiza el *Implementation Plan* que acabas de proponer para incorporar lo siguiente. Sigue en modo planificación: **no escribas ni modifiques código** hasta que apruebe el plan actualizado.

### Archivos nuevos o actualizados en el repositorio

- **`supabase/08_ubicaciones_proveedores.sql`** (nuevo). Tiene la misma prioridad que `07_insumos.sql` como fuente de verdad y está probado en PostgreSQL 16 sobre 01–07. No lo modifiques; si detectas un error, descríbelo con evidencia y propón el cambio en un `09_…sql`. La restricción de no modificar archivos SQL existentes se extiende a 08.
- **`js/inventory-calc.js`** y **`tests/inventory-calc.test.js`** (actualizados, 24 pruebas). `summarizeItemStock` ahora ignora las ubicaciones archivadas al medir la antigüedad de los conteos y devuelve `archivedWithStock`. Para que funcione, cada ubicación que se pase al motor debe incluir `active`.

**Nuevo orden de despliegue:** 05b → repetir el `UPDATE` de 05 → 07 → 08.

### Qué resuelve 08 (reglas que la interfaz y `LocalStore` deben respetar)

1. **Crear ubicaciones.** Cualquier usuario activo puede crearlas. Nacen activas y sin función especial. El nombre es único y el tipo es `habitacion`, `armario`, `nevera` u `otro`.

2. **Editar ubicaciones.** Se pueden editar directamente el nombre, el tipo, el orden y la antigüedad máxima de conteo (`max_audit_age_hours`). Los campos `active`, `archived_at`, `is_point_of_care` e `is_default_storage` **solo** cambian por RPC; si se editan por otra vía, el servidor devuelve `UBICACION_ESTADO`.

3. **Archivar ubicaciones** con `archive_supply_location(p_location_id, p_transfer_to, p_note)`.
   - Si la ubicación tiene stock o referencias activas y no se indica destino, se rechaza con `UBICACION_CON_STOCK`, que informa cuántos insumos y referencias hay.
   - Con destino, en una sola transacción:
     - traslada el stock, llenos y vacíos, como movimientos `transfer`;
     - deja en cero los saldos negativos;
     - mueve la ubicación principal y la reserva de los insumos, los pedidos en camino, los envases abiertos y los vencimientos;
     - archiva la ubicación.
   - Devuelve un resumen de lo movido.
   - Es idempotente: si la ubicación ya está archivada, devuelve `already_archived: true`.

4. **Ubicaciones archivadas.** No aceptan movimientos, relevos, pedidos, envases, vencimientos ni asignaciones (`UBICACION_ARCHIVADA`). Su historial se conserva. `restore_supply_location(p_location_id)` las reactiva.

5. **Borrar ubicaciones.** Solo es posible si la ubicación nunca se usó. Si tiene historial, falla por clave foránea y hay que archivarla. `supply_locations_view.has_history` indica de antemano qué opción ofrecer.

6. **Ubicaciones especiales.** El punto de uso (Habitación) y el almacén por defecto (Armario) no se pueden borrar ni archivar (`UBICACION_ESPECIAL`). Solo un **admin** puede reasignar esa función con `set_special_location(p_location_id, 'point_of_care' | 'default_storage')`. Reasignar no mueve stock ni cambia la ubicación de los insumos existentes: solo define dónde se crean los nuevos y dónde se hace el relevo. La interfaz debe explicarlo antes de confirmar.

7. **Proveedores.**
   - `archive_supply_supplier` se rechaza si el proveedor tiene pedidos en camino (`PROVEEDOR_CON_PEDIDOS`). Si hay insumos que aún lo tienen asignado, devuelve `items_still_assigned` para que la interfaz ofrezca reasignarlos.
   - No se puede asignar un proveedor archivado (`PROVEEDOR_ARCHIVADO`).
   - No se puede borrar un proveedor con pedidos o insumos (`PROVEEDOR_CON_HISTORIAL`).
   - `active` solo cambia por RPC (`PROVEEDOR_ESTADO`).
   - `restore_supply_supplier` lo reactiva.

8. **Editor SQL.** Sin sesión de usuario, el dueño del proyecto conserva el control, con el mismo criterio que 05b. Estas guardas protegen a la aplicación, no el mantenimiento de la base de datos.

### Qué debe añadir el plan

**Interfaz, dentro de la pestaña Catálogo:** una sección «Ubicaciones y proveedores».

- **Lista de ubicaciones.** Se alimenta de `supply_locations_view` y muestra nombre, tipo, función especial, estado y los contadores `items_with_stock`, `items_default`, `items_reserve` y `orders_in_transit`. Tiene un filtro «Mostrar archivadas», desactivado por defecto.
- **Acciones sobre ubicaciones:**
  - Crear y Editar.
  - **Archivar** como asistente de tres pasos:
    1. mostrar qué depende de la ubicación;
    2. elegir el destino entre las ubicaciones activas;
    3. confirmar y mostrar el resumen devuelto.
  - Restaurar.
  - **Borrar**, visible solo si `has_history` es falso y la ubicación no es especial.
  - «Asignar como punto de uso / almacén por defecto», visible solo para admin.
- **Lista de proveedores** con Crear, Editar (nombre, canal, WhatsApp, tiempo de entrega), Archivar, Restaurar y Borrar con las mismas reglas. Tras archivar un proveedor, si `items_still_assigned > 0`, se ofrece reasignar esos insumos a otro proveedor.
- **Dónde se ocultan los archivados:**
  - ubicaciones: pestaña Otras Ubicaciones, selectores de ubicación principal y reserva, destino de recepción, traslados y envases abiertos;
  - proveedores: selectores de proveedor en el Catálogo y en el Kanban.
- **Dónde siguen visibles:** en el historial de movimientos, relevos y pedidos, con la etiqueta «archivada».
- Todas las acciones usan el patrón de botón deshabilitado mientras la operación está en curso. Las acciones destructivas piden confirmación explícita, con el nombre de la ubicación o del proveedor.

**`api.js`** (métodos en remoto y en `LocalAdapter`, añadidos a `apiInstance`):

- `getSupplyLocations({ includeArchived })`, que lee `supply_locations_view`.
- `addSupplyLocation`.
- `updateSupplyLocation`, que **nunca** envía `active` ni las funciones especiales.
- `deleteSupplyLocation`.
- `archiveSupplyLocation(id, transferToId, note)`.
- `restoreSupplyLocation(id)`.
- `setSpecialLocation(id, role)`.
- `getSupplySuppliers({ includeArchived })`, `addSupplySupplier`, `updateSupplySupplier`, `archiveSupplySupplier`, `restoreSupplySupplier` y `deleteSupplySupplier`.
- `getSupplyPlanContext` debe incluir **todas** las ubicaciones, también las archivadas, con su campo `active`, para que el motor las reconozca.

**`traducirError`:** agrega patrones específicos **antes** de los genéricos existentes.

- Para los errores con prefijo en mayúsculas (`UBICACION_ESPECIAL`, `UBICACION_ESTADO`, `UBICACION_ARCHIVADA`, `UBICACION_CON_STOCK`, `PROVEEDOR_CON_HISTORIAL`, `PROVEEDOR_ESTADO`, `PROVEEDOR_ARCHIVADO`, `PROVEEDOR_CON_PEDIDOS`), muestra el texto que sigue a los dos puntos: ya está en español llano.
- Para `violates foreign key constraint` sobre `supply_locations`, muestra: «Esta ubicación tiene historial: archívala en lugar de borrarla».
- Para `supply_locations_special_active_ck`, muestra: «El punto de uso y el almacén por defecto no se pueden archivar».

**`LocalStore` (LOCAL_MODE):**

- Emular `archive_supply_location`, `restore_supply_location`, `set_special_location`, `archive_supply_supplier` y `restore_supply_supplier` con **la misma semántica y los mismos mensajes**, incluidas la atomicidad (si algo falla, no se aplica nada) y la idempotencia.
- Rechazar movimientos, relevos, pedidos y asignaciones hacia ubicaciones archivadas.
- En modo local no hay admin real. Propón cómo tratar `set_special_location`: con el perfil local de rol `admin` o sin restricción.

### Pruebas que se añaden a la matriz (en ambos modos)

1. Crear una ubicación, contar stock en ella e intentar archivarla sin destino: se rechaza con el detalle.
2. Archivarla con destino: el stock, la ubicación principal y la reserva de los insumos, y el pedido en camino pasan al destino. El insumo **no** queda en gris después.
3. Tras archivarla, un conteo o una asignación hacia esa ubicación se rechaza con un mensaje en español. Restaurarla la vuelve a habilitar.
4. Borrar una ubicación nunca usada funciona. Borrar una con historial muestra el mensaje de archivar.
5. La Habitación y el Armario no se pueden borrar ni archivar. Un cuidador no puede reasignar su función; un admin sí, y un insumo nuevo sin ubicación va al nuevo almacén por defecto.
6. Un proveedor con pedido en camino no se archiva. Uno archivado no aparece en los selectores ni se puede asignar. Uno con historial no se borra.
7. Repetir cualquier archivado no cambia nada (`already_archived`).

### Formato de la respuesta

1. Al inicio, una sección **«Cambios respecto a la versión anterior del plan»**: fases afectadas, tareas añadidas, criterios de aceptación nuevos y archivos adicionales en el inventario.
2. A continuación, el plan completo actualizado, sin quitar nada de lo ya propuesto que no esté afectado.
3. Añade a tus preguntas abiertas:
   - ¿Archivar ubicaciones y proveedores lo puede hacer cualquier usuario activo, como ahora, o solo un admin?
   - ¿Cuánto tiempo deben seguir visibles las ubicaciones archivadas en el filtro del historial?
