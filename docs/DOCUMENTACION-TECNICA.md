# CuidApp — Documentación técnica

**Para quién:** para quien mantiene el código, la base de datos o el despliegue.
**Versión descrita:** rama `main` tras los PR #1 y #2 (sidebar, módulo Insumos y sus mejoras).

---

## 1. Arquitectura

```
iPhone / navegador
   │  index.html + js/*.js  (sitio estático en Vercel)
   │
   │  supabase-js v2 (HTTPS)
   ▼
Supabase
   ├─ Auth         cuentas, sesión (JWT)
   ├─ PostgreSQL   tablas, triggers, funciones
   ├─ RLS          quién puede leer y escribir cada tabla
   └─ audit_log    registro de cada cambio (por trigger)
```

- **Sin build:** los archivos se sirven tal cual. No hay `npm` ni `package.json`.
- **Página única:** `index.html` contiene las pantallas de acceso, el sidebar, un `<section class="panel">` por módulo y los modales compartidos. `App.navigateTo(panel)` muestra un panel y llama al `render()` de su módulo.
- **Módulos IIFE:** cada `js/*.js` expone un objeto global (`Api`, `Auth`, `Ui`, `App`, `DashboardModule`, `FoodModule`, `StockModule`, `RolesModule`, `SettingsModule`, `AuditModule`).
- **Orden de carga** (en `index.html`): `vendor/supabase.js` → `config.js` → `local-store.js` → `auth.js` → `api.js` → `ui.js` → los módulos → `app.js`. `app.js` va al final porque arranca la aplicación.

## 2. Archivos

| Archivo | Responsabilidad |
|---|---|
| `js/config.js` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` (clave pública) y `LOCAL_MODE` |
| `js/auth.js` | Inicio de sesión, registro, recuperación de contraseña, perfil actual, `isAdmin()`, `requireAdmin()` |
| `js/api.js` | Capa de datos. Traduce filas de Supabase (`snake_case`) a objetos (`camelCase`) y los errores técnicos a mensajes en español (`traducirError`) |
| `js/local-store.js` | Base de datos en `localStorage` para el modo local; también la usan algunas funciones del Menú (ver §9) |
| `js/ui.js` | `showModal`, `confirm`, `toast`, `skeleton` y el panel de alertas de la campana (`renderAlerts`) |
| `js/app.js` | Enrutador, sidebar, visibilidad por rol, arranque y refresco de la cabecera cada 60 s |
| `js/dashboard.js` | Inicio |
| `js/food.js` | Menú: Recetas, Planificación, Complementos y Compras |
| `js/stock.js` | Insumos |
| `js/roles.js` | Roles y Personal: equipo, turnos, notas de relevo y usuarios |
| `js/settings.js` | Configuración y exportación JSON |
| `js/audit.js` | Visor de auditoría con filtros y paginación |
| `supabase/*.sql` | Esquema, funciones, auditoría, RLS, datos iniciales y migraciones |
| `vercel.json` | Cabeceras de seguridad y caché del vendor |
| `manifest.json`, `icon-*.png` | Instalación como app ("Añadir a pantalla de inicio") |

## 3. Capa de datos (`js/api.js`)

- **Contrato de respuesta:** las lecturas devuelven los datos, envueltos por `wrap()` para admitir tanto `res.data` como desestructuración. Las escrituras devuelven `{ ok: true }` o `{ ok: false, error }` con el mensaje ya traducido.
- **Proxy y modo local:** `Api` es un `Proxy`. Con `LOCAL_MODE: true`, si `LocalAdapter` tiene un método con el mismo nombre, se usa ese en lugar del remoto.
- **Caché:** `settings`, `patientStatus`, `careRoles` y `profiles` se guardan en memoria. `invalidateCache(clave)` los refresca.
- **Insumos:** solo funcionan con Supabase. En modo local devuelven el error *"El control de insumos requiere conexión con Supabase."*

### 3.1 Lógica de Insumos

| Función | Qué hace |
|---|---|
| `STOCK_CATEGORIES` | Las 6 categorías fijas: medicamento, insumo médico, material de curación, higiene, nutrición/suplementos y otro |
| `STOCK_PRIORITIES` | Nivel → etiqueta y horas entre revisiones. Por defecto 24 / 48 / 72; se sobrescriben con `settings.stock_pN_hours` al cargar la configuración |
| `stockItemStatus(item)` | Calcula `checkDue` (sin conteo o vencida), `nextCheckAt`, `missing` = máx(objetivo − actual, 0) y `stockState`: `unknown` (sin conteo), `empty` (0), `low` (< objetivo) u `ok` |
| `getStockItems` / `addStockItem` / `updateStockItem` / `deleteStockItem` | CRUD de `stock_items` (solo admin) |
| `recordStockCheck(itemId, qty)` | Inserta en `stock_checks`; el trigger guarda el stock anterior y actualiza el insumo |
| `getStockChecks(itemId)` | Historial de revisiones con el nombre de quien revisó |
| `saveStockPriorityHours({1,2,3})` | Guarda las horas por nivel en `settings` |
| `syncStockShopping()` | Mantiene en `shopping_list` (con `source = 'insumos'`) los insumos por reponer (ver abajo) |

**Sincronización con la lista de compra.** Se ejecuta al abrir Inicio o Insumos, y solo si la sesión es de un admin:

- Si un insumo tiene faltante, se añade a la lista o se actualiza su cantidad.
- Si ya está completo, su entrada se borra.
- Solo se tocan entradas sin marcar. Si el insumo ya está marcado como comprado, no se vuelve a añadir hasta que se limpie de la lista.
- Las entradas se emparejan por nombre, sin distinguir mayúsculas.

**Color de la tarjeta según el estado:** `ok` verde, `low` amarillo, `empty` rojo y `unknown` gris (clases `.stock-item.state-*` en CSS).

### 3.2 Alertas

`Api.getActiveAlerts()` las calcula al vuelo, no se guardan:

- Una alerta por cada revisión vencida: crítica en nivel 1 y aviso en los demás.
- Una por cada insumo por reponer: crítica si está agotado y aviso si solo está bajo.
- Solo el admin las recibe.

`Ui.renderAlerts()` las pinta en la campana 🔔 y actualiza el contador de "Insumos" en el sidebar.

## 4. Base de datos

### 4.1 Orden de ejecución

En Supabase → **SQL Editor**, ejecuta cada archivo **en este orden**:

| # | Archivo | Qué hace | ¿Re-ejecutable? |
|---|---|---|---|
| 1 | `01_schema.sql` | Tipos y tablas base | No |
| 2 | `02_functions.sql` | `is_active_user()`, `is_admin()`, alta automática de perfil, guarda de perfiles, turnos y vistas | Sí (`create or replace`) |
| 3 | `03_audit.sql` | Trigger `audit_trigger()` y `purge_old_audit()` | Sí |
| 4 | `04_rls.sql` | Row Level Security | No |
| 5 | `05_seed.sql` | Fila de `settings` y `patient_status`, 7 roles de cuidado | Duplica roles si se repite |
| 6 | `05b_fix_primer_admin.sql` | Permite promover al primer admin desde el SQL Editor | Sí |
| 7 | `06_migracion_v1.sql` | Recetas y complementos reales de la versión 1 (opcional en una instalación nueva) | Sí |
| 8 | `07_control_insumos.sql` | Tablas `stock_items` y `stock_checks`, trigger de revisión, auditoría y RLS solo admin | Sí |
| 9 | `08_prioridades_insumos.sql` | Horas por nivel en `settings` (1–720, por defecto 24/48/72) | Sí |

> Si un script **no re-ejecutable** falla a mitad, no lo repitas. Resetea la base (Settings → Database → Reset) y vuelve a empezar desde `01`.

### 4.2 Tablas en uso

| Tabla | Uso |
|---|---|
| `profiles` | Un perfil por cuenta: nombre, teléfono, rol de cuidado, `app_role` (`admin`/`caregiver`), `active` |
| `care_roles` | Roles del equipo (Médico, Enfermería, Cuidador/a…) |
| `shifts`, `shift_notes` | Turnos (como máximo uno abierto) y notas de relevo |
| `settings` | Una sola fila: nombre del paciente, contacto de emergencia, horas por nivel de insumos |
| `patient_status` | Una sola fila. Solo se lee, para la insignia de la cabecera (ver §9) |
| `recipes`, `recipe_ingredients`, `weekly_plan` | Recetario y planificación semanal |
| `complementos`, `complemento_ingredients` | Complementos del Menú |
| `shopping_list` | Lista de compra. `source`: `manual`, `plan`, `complemento` o `insumos` |
| `stock_items` | Insumos: nombre (único sin distinguir mayúsculas), categoría, `target_stock`, `priority`, `current_stock` (último conteo), `last_checked_at` |
| `stock_checks` | Historial de revisiones: `quantity`, `previous_quantity`, `checked_by`, `checked_at` |
| `audit_log` | Registro de auditoría; solo lo escribe el trigger |

**Tablas heredadas sin uso.** `medications`, `medication_schedules`, `medication_administrations`, `medication_restocks`, `inventory_categories`, `inventory_items`, `inventory_movements`, `task_templates`, `tasks`, `task_comments`, `appointments` y `expenses`, junto con sus funciones, siguen en `01`–`05`. Pertenecen a los módulos retirados; la app ya no las lee ni las escribe. Ver §10.

## 5. Seguridad

- **RLS en todas las tablas.** Cualquier usuario *activo* opera las tablas operativas.
- **Solo admin:** `settings` (escritura), `audit_log` (lectura), `stock_items` y `stock_checks`.
- **`is_admin()` e `is_active_user()` son `SECURITY DEFINER`.** Sin eso, la política de `profiles` se llama a sí misma sin fin ("infinite recursion detected in policy").
- **Guarda de perfiles** (`guard_profiles`): nadie puede cambiarse a sí mismo `app_role` ni `active`, y solo un admin los cambia a otros.
- **Auditoría por trigger:** cada INSERT, UPDATE y DELETE queda en `audit_log` dentro de la misma transacción. Desde la app no se puede escribir en la auditoría.
- **Revisiones inmutables:** `stock_checks` solo tiene políticas de lectura e inserción; no se editan ni se borran. Solo desaparecen si se elimina el insumo, en cascada.
- **Escapado de HTML:** todo texto de usuario pasa por `Api.escapeHtml` antes de insertarse en el DOM.
- **Vistas:** deben crearse con `security_invoker`. Esta consulta tiene que devolver **cero filas**:

```sql
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v' and n.nspname = 'public'
   and coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'false') <> 'true';
```

## 6. Primer administrador

El trigger `guard_profiles` impide promover a alguien desde el SQL Editor, donde no hay sesión. `05b_fix_primer_admin.sql` lo corrige. Procedimiento:

1. Supabase → **Authentication → Users → Add user**, con el correo real y marcando **Auto Confirm User**. El perfil se crea solo, como cuidador inactivo.
2. En el SQL Editor:
   ```sql
   update profiles set app_role = 'admin', active = true
    where id = (select id from auth.users where email = 'CORREO-REAL@dominio.com');
   ```
3. Comprueba el resultado. Esta consulta debe devolver su fila:
   ```sql
   select u.email, p.app_role, p.active from profiles p join auth.users u on u.id = p.id
    where p.app_role = 'admin' and p.active;
   ```

Crea **dos administradores**: con uno solo, perder ese acceso obliga a volver al panel de Supabase.

## 7. Despliegue

1. **Base de datos primero** (§4), después el código.
2. **Vercel:** proyecto conectado a GitHub, *Framework Preset* **Other**, y los campos *Build*, *Output* e *Install* vacíos. Cada push a `main` publica en menos de un minuto. Para volver atrás: Deployments → último despliegue que funcionaba → **Promote to Production**.
3. **Supabase → Authentication → URL Configuration:**
   - *Site URL*: `https://cuid-app-ten.vercel.app`
   - *Redirect URLs*: `https://cuid-app-ten.vercel.app/**`

   Sin esto sigue funcionando el inicio de sesión, pero fallan el alta de cuentas nuevas y la recuperación de contraseña.
4. **Antes de publicar:** `js/config.js` debe tener `LOCAL_MODE: false`, y buscar `service_role` en el repositorio no debe devolver nada.

## 8. Operación

| Tarea | Cómo |
|---|---|
| Alta de un cuidador | La persona pulsa **Crear cuenta**; un admin la aprueba en Roles y Personal → **Usuarios** |
| Baja | Usuarios → **Desactivar**. Su historial se conserva |
| Respaldo mensual | Sidebar → **Guardar copia** (o Configuración → Exportar). El JSON contiene datos de salud: guárdalo cifrado o fuera de Descargas |
| Proyecto pausado | El plan gratuito de Supabase pausa tras ~7 días sin uso. Panel de Supabase → **Restore**. No se pierden datos |
| Auditoría grande | Auditoría → **Purgar > 24m**, o en SQL `select purge_old_audit(24);` |
| Consumo | Supabase → Settings → Usage, una vez por trimestre (límite gratuito: 500 MB de base) |

### Solución de problemas

| Síntoma | Causa habitual |
|---|---|
| La app carga en blanco | Falta `js/vendor/supabase.js`, la clave está mal copiada o el proyecto está pausado. Revisa la consola del navegador |
| Entra pero todo sale vacío | El perfil no está activo o `04_rls.sql` no se ejecutó completo |
| "Falta aplicar 08_prioridades_insumos.sql" | No se ejecutó `08`; la app sigue usando 24/48/72 h |
| "El control de insumos requiere conexión con Supabase" | `LOCAL_MODE` está en `true` |
| La auditoría no registra nada | Falta `03_audit.sql`, o alguien activó `force row level security` en `audit_log` |

## 9. Límites y problemas conocidos

| Tema | Detalle |
|---|---|
| **Borrado en lote de la lista de compra** | `Api.deleteShoppingItemsBatch` (lo usa Compras al quitar los marcados) apunta siempre a `LocalAdapter`: con Supabase **no borra en la nube**, solo en el navegador. Hay que corregirlo |
| **Datos del Menú solo en el dispositivo** | Las categorías de complementos, los complementos disponibles y el menú diario (`getComplementCategories`, `getAvailableComplementos`, `getDailyMenu`…) se guardan en `localStorage` aunque se use Supabase: cada teléfono ve los suyos |
| **Estado del paciente sin editor** | La cabecera sigue mostrando la insignia de estado (`patient_status`), pero la sección de Inicio que permitía cambiarlo se retiró |
| **Contacto de emergencia sin uso** | Configuración conserva esos campos, pero el botón SOS se retiró |
| **"Mantenimiento y menús locales"** | La sección de Configuración solo funciona en modo local; con Supabase no hace nada útil |
| **Sin entradas de stock** | El consumo se deduce entre dos conteos. Una reposición entre revisiones aparece como "subió (reposición)", no como consumo |
| **Requiere internet** | No hay modo sin conexión con Supabase |
| **Sin notificaciones push** | Las alertas solo se ven con la app abierta |
| **Último en guardar gana** | Dos ediciones simultáneas: prevalece la última. La auditoría permite reconstruirlo |

## 10. Deuda técnica recomendada

1. Corregir `deleteShoppingItemsBatch` para Supabase y llevar a Supabase las categorías y la disponibilidad de complementos.
2. Decidir qué hacer con el estado del paciente y el contacto de emergencia: recuperar su editor o retirarlos.
3. Retirar la sección "Mantenimiento y menús locales" si el modo local no se va a usar.
4. **Limpieza de la base de datos:** un script que borre las tablas y funciones heredadas (§4.2). Es irreversible: hazlo solo después de guardar una copia y confirmar que nadie necesita ese historial. La auditoría conserva sus registros antiguos.
5. Consolidar `01`–`08` en un esquema único para instalaciones nuevas, sin las tablas heredadas.
