# Instrucciones para Aplicar Scripts SQL en Supabase

Este directorio contiene los scripts SQL que deben ejecutarse en el **SQL Editor de Supabase** para activar y actualizar el módulo de **Gestión de Insumos** de **CuidApp v2**.

---

## ⚠️ Orden Estricto de Ejecución

Deben aplicarse en el siguiente orden secuencial:

### 1. `05b_fix_primer_admin.sql`
- **Propósito:** Corrige la guarda `guard_profile_update` para permitir que el administrador pueda ser promovido desde el Editor SQL de Supabase (donde `auth.uid()` es nulo).
- **Acción posterior inmediata:** Tras ejecutar este archivo, vuelve a ejecutar el `UPDATE` de promoción a admin de `05_seed.sql` con el correo real del administrador:
  ```sql
  update profiles
     set app_role = 'admin',
         active = true
   where email = 'TU_EMAIL_DE_ADMIN@ejemplo.com';
  ```

### 2. `07_insumos.sql`
- **Propósito:** Crea el libro mayor de movimientos (`inventory_movements`), catálogo extendido (`inventory_items`), ubicaciones iniciales, proveedores, relevos, pedidos en tránsito (`supply_order_lines`), envases abiertos, RLS, vistas y funciones RPC principales.
- Se ejecuta completo dentro de una transacción. Es re-ejecutable.

### 3. `08_ubicaciones_proveedores.sql`
- **Propósito:** Triggers y funciones para la gestión avanzada de ubicaciones y proveedores.
  - Guarda de ubicaciones especiales (Habitación y Armario no se borran ni archivan).
  - Triggers para evitar asignar ubicaciones o proveedores archivados.
  - RPCs: `archive_supply_location`, `restore_supply_location`, `set_special_location`, `archive_supply_supplier`, `restore_supply_supplier`.
  - Re-ejecutable y transaccional.

### 4. `09_revision_y_control.sql`
- **Propósito:**
  - Añade `review_every_hours` por insumo (por defecto 26 h / diario para críticos).
  - Añade método de control `stock_control` ('dosis' o 'conteo') para medicamentos.
  - RPC `save_supply_relay_full` (guarda relevo + traslados inferidos en una sola transacción).
  - Ajusta frecuencias por defecto: Habitación (50 h), Armario (720 h).
  - Actualiza `record_administration` e `inventory_items_view`.
- **⚠️ Importante:** `09` reemplaza funciones y vistas de `07`. Si en el futuro se re-ejecuta `07`, se debe re-ejecutar inmediatamente después `08` y luego `09`.

---

## Verificación Posterior

Al terminar de ejecutar los 4 scripts, ejecuta la siguiente consulta en Supabase para asegurar que todas las vistas cumplen la directiva de seguridad:

```sql
select c.relname as vista_insegura
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v'
   and n.nspname = 'public'
   and coalesce(
         (select option_value from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'), 'false') <> 'true';
```
*(El resultado debe ser 0 filas).*
