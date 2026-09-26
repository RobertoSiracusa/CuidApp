# Instrucciones para Aplicar Scripts SQL en Supabase

Scripts que deben ejecutarse en el **SQL Editor de Supabase** para activar el módulo **Control de Insumos** de CuidApp v2.

> Los antiguos `07_insumos.sql`, `08_ubicaciones_proveedores.sql` y `09_revision_y_control.sql` se retiraron junto con el módulo de inventario anterior. **No los apliques.**

---

## Orden de ejecución

### 1. `05b_fix_primer_admin.sql` (solo si aún no se aplicó)
- **Propósito:** corrige la guarda `guard_profile_update` para poder promover al primer administrador desde el Editor SQL (donde `auth.uid()` es nulo).
- **Después:** vuelve a ejecutar el `UPDATE` de `05_seed.sql` con el correo real del administrador:
  ```sql
  update profiles
     set app_role = 'admin',
         active = true
   where email = 'TU_EMAIL_DE_ADMIN@ejemplo.com';
  ```

### 2. `07_control_insumos.sql`
- **Propósito:** crea `stock_items` (insumo, categoría, stock objetivo, prioridad 1/2/3, último conteo) y `stock_checks` (historial de revisiones).
- Un trigger guarda el stock anterior en cada revisión y actualiza el insumo en la misma transacción.
- Auditoría automática en ambas tablas.
- RLS: **solo administradores** pueden ver y operar el módulo.
- Transaccional y re-ejecutable.

---

## Verificación posterior

```sql
-- Deben existir las dos tablas con RLS activado
select relname, relrowsecurity
  from pg_class
 where relname in ('stock_items', 'stock_checks');
```
