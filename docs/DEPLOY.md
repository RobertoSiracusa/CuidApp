# CuidApp — Guía de Despliegue y Operación

**Para quién es este documento:** para quien pone CuidApp en producción y lo mantiene funcionando.
**Requisito previo:** las cuentas de GitHub, Vercel y Supabase ya creadas — ver
`docs/TUTORIAL-CUENTAS.md`.

> **Diferencia entre los dos documentos:**
> `TUTORIAL-CUENTAS.md` = crear las cuentas, una sola vez.
> `DEPLOY.md` (este) = poner el proyecto en marcha, verificarlo y mantenerlo vivo.

---

## 1. Antes de desplegar

Comprueba que el proyecto está completo:

- [ ] Existe `js/config.js` con la URL y la `anon key` reales.
- [ ] Existe `js/vendor/supabase.js` y **no** está vacío.
- [ ] Existen los seis archivos de `supabase/`.
- [ ] **No** existen `server.ps1`, `Iniciar_CuidApp.bat`, `js/data.js` ni `js/vitals.js`.
- [ ] Buscar `service_role` en todo el proyecto **no devuelve nada**.
- [ ] `js/config.js` tiene `LOCAL_MODE: false`. Con ese flag en `false` la app usa Supabase; en `true`
      opera solo en el navegador contra `js/local-store.js`, sin backend. `js/local-store.js` existe
      en el proyecto y se carga siempre desde `index.html` — es el adaptador que implementa ese modo,
      no un descuido de `localStorage`.

> **Las comprobaciones de `service_role` y `LOCAL_MODE` no son rutina.** Una `service_role key`
> filtrada da acceso total al expediente del paciente sin contraseña. Un `LOCAL_MODE: true` en
> producción significa que cada cuidador ve solo los datos guardados en su propio dispositivo, y no
> los del resto del equipo.

---

## 2. Orden de despliegue

**Primero la base de datos, después la aplicación.** Si publicas la app antes de crear las tablas,
quien entre verá errores.

```
1. Ejecutar los .sql en Supabase        (§3)
2. Publicar el código en GitHub          (§4)
3. Vercel despliega automáticamente      (§4)
4. Conectar las direcciones              (§5)
5. Crear el primer administrador         (§6)
6. Verificar                             (§7)
```

---

## 3. Base de datos

En Supabase → **SQL Editor** → **New query**, ejecuta cada archivo **en este orden**, uno a uno:

| # | Archivo | Qué crea | Cómo saber que salió bien |
|---|---|---|---|
| 1 | `01_schema.sql` | Tablas, tipos e índices | `Table Editor` muestra `profiles`, `medications`, `tasks`, `audit_log`… |
| 2 | `02_functions.sql` | Funciones, vistas y cálculos | `select * from is_admin();` responde sin error |
| 3 | `03_audit.sql` | Triggers de auditoría | `select count(*) from audit_log;` responde `0` |
| 4 | `04_rls.sql` | Reglas de seguridad | Las tablas muestran el candado "RLS enabled" en Table Editor, y la consulta final del archivo devuelve **cero filas** |
| 5 | `05_seed.sql` | Roles y categorías iniciales | `select count(*) from care_roles;` responde `7` |
| 6 | `06_migracion_v1.sql` | Recetas, plan semanal y complementos reales de v1 | `select count(*) from recipes;` responde `4` |

> **El orden es obligatorio.** Cada archivo usa lo que creó el anterior. Si uno falla, corrígelo
> antes de seguir: ejecutar el siguiente sobre una base incompleta multiplica los errores.

### Si un script falla a mitad de camino

**Reintentarlo no es seguro — no lo vuelvas a correr sin más.** El SQL Editor aborta el script
completo apenas encuentra un error, pero lo que ya se ejecutó antes de esa línea queda aplicado: la
base se queda a mitad de camino. Y salvo `06_migracion_v1.sql`, ninguno de estos archivos está escrito
para tolerar una segunda ejecución:

- `01_schema.sql` aborta al segundo intento: el `create type` de la línea 8 y los 25 `create table`
  del archivo no usan `if not exists`, así que el primero que ya existe corta todo lo que sigue.
- `04_rls.sql` aborta al segundo intento: seis de sus `create policy` (líneas 34, 40, 46, 51, 53 y 58)
  no tienen un `drop policy if exists` antes, a diferencia de las que genera el bloque dinámico más
  arriba en el mismo archivo.
- `05_seed.sql` **no aborta, pero duplica en silencio**: el `insert` de `care_roles` (líneas 8-15) no
  tiene `on conflict`, y `name` no es una columna `UNIQUE` — cada reejecución sedimenta 7 filas más.
- `06_migracion_v1.sql` sí es idempotente: volver a ejecutarlo no duplica nada.

**Si un script que no sea `06_migracion_v1.sql` falla a mitad, no lo reintentes tal cual.** Resetea la
base completa (ver más abajo) y vuelve a correr la secuencia desde `01_schema.sql`. Solo si estás
seguro de que el archivo corrió completo y sin error, y únicamente sospechas duplicados en
`care_roles`, podés limpiarlos con
`select name, count(*) from care_roles group by name having count(*) > 1;` y borrando los sobrantes.

### Si necesitas empezar de cero

La forma más simple: Supabase → **Settings → Database → Reset database**. Borra todo el esquema
`public` y lo deja limpio para volver a correr los seis archivos desde `01_schema.sql`.

Alternativa manual, en el SQL Editor:

```sql
-- ⚠️ BORRA TODOS LOS DATOS. Sin vuelta atrás.
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated;
grant all on schema public to postgres, service_role;
```

Después vuelve a ejecutar los seis archivos. **Las cuentas de usuario sobreviven** (viven en el
esquema `auth`), pero sus perfiles se pierden: habrá que reactivarlos.

---

## 4. Publicar la aplicación

### Primera publicación

Ya hecha si seguiste el tutorial. Vercel quedó conectado a GitHub.

### Publicaciones siguientes

**No hay que hacer nada especial.** Cada vez que el código cambia en la rama principal de GitHub,
Vercel republica en menos de un minuto.

```
Cambias el código  →  Subes a GitHub  →  Vercel publica solo
```

Puedes ver el progreso en el panel de Vercel, pestaña **Deployments**.

### Si un despliegue falla

1. Abre el despliegue fallido en Vercel y lee el registro.
2. La causa más habitual: **Vercel intentó compilar el proyecto.** CuidApp no se compila.
   Ve a **Settings → Build & Development Settings** y deja **vacíos** los campos de
   *Build Command*, *Output Directory* e *Install Command*. Framework Preset: **Other**.

### Volver a una versión anterior

Si una actualización rompe algo, no hace falta arreglar el código con prisa:

1. Vercel → **Deployments**.
2. Busca el último despliegue que funcionaba.
3. Menú de los tres puntos → **Promote to Production**.

La versión anterior vuelve a estar en línea en segundos. **Los datos no se ven afectados**: viven en
Supabase, no en el código.

---

## 5. Conectar las direcciones

En Supabase → **Authentication** → **URL Configuration**:

| Campo | Valor |
|---|---|
| **Site URL** | `https://cuid-app-ten.vercel.app` |
| **Redirect URLs** | agregar `https://cuid-app-ten.vercel.app/**` |

**Qué depende de esto y qué no.** El login normal (`signInWithPassword`, en `js/auth.js:186`) **no**
depende de este paso: no redirige a ninguna parte, así que sin configurar esto el inicio de sesión
sigue funcionando con normalidad. Lo que sí depende de este paso: el alta de cuentas nuevas
(`signUp`, `js/auth.js:245`), cuyo correo de confirmación apunta a la Site URL, y el reseteo de
contraseña (`resetPasswordForEmail`, `js/auth.js:327`), que usa `redirectTo: window.location.origin`
y necesita ese origen en la lista de Redirect URLs. En resumen: sin este paso no se cae el login, se
caen el alta de usuarios nuevos y el reseteo de contraseña.

### Si usas un dominio propio

1. Vercel → **Settings → Domains** → añade tu dominio y sigue las instrucciones de DNS.
2. **Vuelve a Supabase y actualiza las dos direcciones de arriba.** Es el paso que todo el mundo
   olvida.

---

## 6. Primer administrador

**El `update` de placeholder que trae `05_seed.sql` (líneas 25-27) no puede crear el primer
administrador.** Tampoco lo logra registrarse primero en la app y correr después un `update` simple
como el de abajo — es el mismo problema. Hay una causa concreta y un procedimiento que sí funciona.

### Por qué el camino directo no funciona

El trigger `guard_profiles` (`02_functions.sql:57-59`, `before update on profiles`) hace:

```sql
if (not is_admin()) or (old.id = auth.uid()) then
  new.app_role := old.app_role;
  new.active   := old.active;
end if;
```

En el SQL Editor de Supabase no hay sesión JWT: `auth.uid()` es `NULL`, `is_admin()` da `false`, y el
trigger revierte `app_role` y `active` al valor anterior. Es un candado de arranque: para crear un
administrador hace falta ya ser administrador.

Y falla **en verde**, sin avisar. El `UPDATE` reporta "1 row affected" con total normalidad, pero
como el guard dejó la fila idéntica a como estaba, el trigger de auditoría (`03_audit.sql:44-46`)
decide que no hubo cambios (`cardinality(v_changed) = 0`) y ni siquiera lo registra: no queda ningún
rastro de que algo pasó.

Además, si el email todavía no existe en `auth.users` — por ejemplo si se corre el `update` de
`05_seed.sql` con el placeholder `CAMBIAR@EJEMPLO.COM` sin haber creado antes esa cuenta —, la
subconsulta da `NULL`, el `where id = NULL` no matchea ninguna fila, y el `UPDATE` afecta **0 filas
sin ningún error**.

### Procedimiento correcto

1. Crea el usuario primero, en el Dashboard: **Authentication → Users → Add user**, con el email real
   y una contraseña, marcando **Auto Confirm User**. El trigger `on_auth_user_created`
   (`02_functions.sql:38-41`) le crea automáticamente el perfil con `app_role='caregiver'` y
   `active=false`.
2. Recién después, en el SQL Editor, desactiva el guard temporalmente para poder promoverlo:

```sql
begin;
alter table profiles disable trigger guard_profiles;

update profiles
   set app_role = 'admin', active = true
 where id = (select id from auth.users where email = 'EMAIL-REAL@dominio.com');

alter table profiles enable trigger guard_profiles;
commit;
```

3. **Gate obligatorio — no lo saltees.** Los dos modos de fallo de arriba son silenciosos, así que
   hay que confirmar con una consulta aparte:

```sql
select u.email, p.app_role, p.active
  from profiles p join auth.users u on u.id = p.id
 where p.app_role = 'admin' and p.active = true;
```

   Debe devolver la fila del administrador recién creado. Si devuelve vacío, el bootstrap falló:
   repite desde el paso 1.

4. Recarga la aplicación.

> **Crea un segundo administrador el mismo día**, repitiendo este mismo procedimiento con su email.
> Es la única protección real contra perder el acceso administrativo. Con un solo admin, un móvil
> perdido o un correo inaccesible obligan a volver al panel de Supabase.

---

## 7. Verificación posterior al despliegue

Hazlo **desde un iPhone real**, que es la plataforma de referencia.

### 7.1 Seguridad — empieza por aquí

Esta lista comprueba la seguridad real contra Supabase (RLS, auditoría, roles). Todas estas
comprobaciones dan por hecho que `js/config.js` tiene `LOCAL_MODE: false` — que es el valor actual en
producción. Con `LOCAL_MODE: true` ninguna aplica: no hay sesión ni RLS que verificar, todo vive en
el navegador.

- [ ] Abre la app en una ventana privada, **sin iniciar sesión**: no se ve ningún dato del paciente.
- [ ] Regístrate con un correo de prueba: aparece la pantalla de cuenta pendiente y **ninguna** tabla.
- [ ] Con ese usuario de prueba ya activado como `caregiver`: **no** aparece la entrada de Auditoría
      ni la pestaña de Usuarios.
- [ ] Como administrador, **no** puedes desactivarte ni degradarte a ti mismo.
- [ ] Crea una persona llamada `<img src=x onerror=alert(1)>`: debe verse **como texto literal**,
      sin que salte ninguna ventana.
- [ ] En el SQL Editor, la consulta de "vistas inseguras" del final de `04_rls.sql` devuelve
      **cero filas**.

> **La prueba del `<img>` no es paranoia.** Es la comprobación de que el escapado de HTML quedó bien
> aplicado. Si salta una ventana emergente, **no repartas la dirección al equipo** hasta corregirlo.

### 7.2 Funcionamiento

- [ ] Crear un medicamento con stock 10 y un horario de 1 dosis.
- [ ] Marcar la dosis como administrada → el stock baja a 9 y aparece tu nombre.
- [ ] Intentar registrar la misma dosis otra vez → el sistema lo impide.
- [ ] Corregir la dosis → el stock vuelve a 10.
- [ ] Crear un ítem de inventario y ajustar el stock → muestra **"Recopilando datos"**, no un número
      inventado.
- [ ] Como administrador, abrir la Auditoría → aparecen tus cambios en lenguaje llano, con tu nombre.
- [ ] Tomar turno, cerrar turno, dejar una nota de turno.

### 7.3 iPhone

- [ ] Enfocar un campo de formulario **no** provoca zoom.
- [ ] Se puede ampliar el texto con el gesto de pinza.
- [ ] El encabezado no queda bajo el notch ni la Dynamic Island.
- [ ] La barra de navegación inferior no queda bajo el indicador de inicio.
- [ ] Compartir → **Añadir a pantalla de inicio** produce el ícono de CuidApp.
- [ ] Al abrir desde el ícono, la app ocupa toda la pantalla y **no vuelve a pedir la contraseña**.

### 7.4 Comportamiento sin conexión

- [ ] Activa el modo avión con un formulario a medio llenar: aparece el aviso de sin conexión y
      **no se pierde lo escrito**.
- [ ] Desactiva el modo avión: la app vuelve a funcionar sin recargar.

---

## 8. Operación diaria

### 8.1 Dar de alta a un cuidador

No requiere tocar Supabase:

1. La persona entra en la dirección de la app y pulsa **Crear cuenta**.
2. Tú entras en **Más → Usuarios**, la activas y le asignas su rol de cuidado.
3. La persona recarga y ya está dentro.

### 8.2 Dar de baja a alguien

En **Más → Usuarios**, desactívala. Pierde el acceso inmediatamente, pero **su historial se
conserva**: las dosis que administró y las tareas que completó siguen atribuidas a su nombre. Eso es
deliberado — borrar a la persona borraría la trazabilidad del cuidado.

### 8.3 ⚠️ El proyecto se pausa si no se usa

**El plan gratuito de Supabase pausa los proyectos tras aproximadamente 7 días sin actividad.**

- **Qué pasa:** la app deja de cargar datos. **No se pierde nada.**
- **Cómo reactivarlo:** entra en el panel de Supabase y pulsa **Restore** o **Resume**. Tarda uno o
  dos minutos.
- **Cómo evitarlo:** el uso diario previsto basta. El riesgo real son las vacaciones o un ingreso
  hospitalario prolongado en que nadie abra la app.

> Si vas a estar más de una semana sin usarla, entra un momento antes de irte y otro al volver.
> Verifica la política vigente en https://supabase.com/pricing: las condiciones del plan gratuito
> cambian.

### 8.4 Vigilar el consumo

Una vez al trimestre, en Supabase → **Settings → Usage**:

| Recurso | Consumo esperado | Límite gratuito | Cuándo preocuparse |
|---|---|---|---|
| Tamaño de base de datos | ~25 MB al primer año | 500 MB | Por encima de 300 MB |
| Transferencia de datos | ~100 MB/mes | 5 GB/mes | Por encima de 3 GB |
| Usuarios activos | 3–8 | 50.000 | Nunca, con este uso |

Si la base crece mucho más rápido de lo previsto, casi siempre es la tabla de auditoría. Comprueba:

```sql
select count(*), pg_size_pretty(pg_total_relation_size('audit_log')) from audit_log;
```

Y si hace falta, purga los registros antiguos (solo un administrador puede):

```sql
select purge_old_audit(24);   -- conserva los últimos 24 meses
```

### 8.5 Respaldos

**Supabase hace respaldos automáticos**, pero la ventana de recuperación del plan gratuito es corta
y puede cambiar. Consúltala en **Database → Backups**.

**Respaldo manual, recomendado una vez al mes:**

- Desde la app: **Configuración → Exportar datos** (solo administradores). Descarga un archivo JSON
  con todo.
- Guárdalo fuera del equipo: en la nube personal o en un disco externo.

> Este archivo contiene información de salud. Trátalo como tratarías un expediente médico en papel:
> no lo dejes en la carpeta de Descargas ni lo envíes por correo sin cifrar.

---

## 9. Solución de problemas

### La app carga en blanco

1. Abre la consola del navegador (en el móvil: Safari → Ajustes → Avanzado → Inspector web).
2. Causas habituales:

| Mensaje | Causa | Solución |
|---|---|---|
| `CUIDAPP_CONFIG is not defined` | Falta `js/config.js` o no se cargó | Verifica que existe y está en el orden de `<script>` correcto |
| `supabase is not defined` | `js/vendor/supabase.js` falta o está vacío | Vuelve a descargarlo |
| `Invalid API key` | La `anon key` está mal copiada | Cópiala entera desde Supabase → Settings → API |
| `Failed to fetch` | URL de Supabase incorrecta, o proyecto pausado | Revisa la URL; comprueba si el proyecto está pausado (§8.3) |

### Entro pero las listas salen vacías

Casi siempre es **RLS bloqueando las consultas**. Comprueba en orden:

1. ¿Tu perfil está activo?

```sql
select id, full_name, app_role, active from profiles where id = auth.uid();
```

2. Si `active` es `false`, actívalo (§6).
3. Si es `true` y sigue vacío, confirma que `04_rls.sql` se ejecutó completo: en Table Editor, las
   tablas deben mostrar el candado de RLS.

### Un usuario inactivo ve datos que no debería

Es el fallo de seguridad más silencioso del sistema: **alguna vista se creó sin
`security_invoker`**, y por tanto se ejecuta con los permisos del superusuario y se salta el RLS.

Comprueba:

```sql
select c.relname as vista_insegura
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v' and n.nspname = 'public'
   and coalesce(
         (select option_value from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'), 'false') <> 'true';
```

Si devuelve alguna fila, vuelve a ejecutar `02_functions.sql` completo y repite la consulta hasta
que devuelva cero. **Hasta entonces, no repartas la dirección de la app.**

### "infinite recursion detected in policy"

Las funciones `is_active_user()` o `is_admin()` se crearon **sin `SECURITY DEFINER`**. Vuelve a
ejecutar `02_functions.sql` completo.

> Es el error más confuso de diagnosticar: una política de `profiles` que consulta `profiles`
> se llama a sí misma sin fin. `SECURITY DEFINER` es lo que rompe el ciclo.

### La auditoría no registra nada

1. ¿Se ejecutó `03_audit.sql`?

```sql
select count(*) from pg_trigger where tgname like 'audit_%';
```

Debe devolver alrededor de 24, uno por tabla.

2. Si devuelve 0, vuelve a ejecutar `03_audit.sql`.
3. Si devuelve el número correcto pero `audit_log` sigue vacío, comprueba que **nadie ejecutó**
   `alter table audit_log force row level security`. Eso bloquea también al trigger. Para revertirlo:

```sql
alter table audit_log no force row level security;
```

### "Sesión expirada" constantemente

1. Verifica el **Site URL** en Supabase (§5): si no coincide con la dirección real, la renovación
   de sesión falla.
2. En iPhone, comprueba que Safari no tenga bloqueado el almacenamiento del sitio.

### El correo de recuperación no llega

1. Revisa la carpeta de spam.
2. Verifica **Site URL** y **Redirect URLs** (§5).
3. El plan gratuito limita los correos por hora. Espera y reintenta.

### El stock de un medicamento no cuadra

Revisa el historial de administraciones y reposiciones del medicamento. Si hay un descuadre real,
significa que **alguien modificó el stock directamente en lugar de registrar la dosis**. La
auditoría lo muestra:

```sql
select created_at, actor_name, changed_fields, old_values, new_values
  from audit_log
 where table_name = 'medications'
   and record_id = 'ID-DEL-MEDICAMENTO'
 order by created_at desc;
```

---

## 10. Seguridad — repaso periódico

Una vez cada seis meses:

- [ ] Revisar la lista de usuarios activos: desactivar a quien ya no participa en el cuidado.
- [ ] Confirmar que hay **al menos dos administradores**.
- [ ] Verificar que la verificación en dos pasos de GitHub sigue activa.
- [ ] Buscar `service_role` en el repositorio: no debe aparecer.
- [ ] Comprobar que existe un respaldo manual reciente.
- [ ] Repetir la prueba del `<img src=x onerror=alert(1)>` tras actualizaciones grandes.

---

## 11. Límites conocidos

Están documentados como decisiones, no como defectos. Consulta el §8 del SRS para el detalle.

| Límite | Consecuencia práctica |
|---|---|
| **Requiere conexión a internet** | Sin datos ni wifi no hay acceso al expediente |
| **No envía recordatorios de dosis** | CuidApp **registra** las dosis, no las **recuerda**. Los cuidadores deben saberlo |
| **El proyecto se pausa sin uso** | Ver §8.3 |
| **Sin notificaciones push** | Las alertas solo se ven al abrir la app |
| **Último en guardar, gana** | Si dos personas editan lo mismo a la vez, prevalece el último. La auditoría permite reconstruir qué pasó |

> **El segundo límite conviene comunicarlo explícitamente al equipo de cuidado.** Una app que
> muestra las dosis del día puede dar la impresión de que avisará cuando toque. No lo hace. Que
> alguien asuma lo contrario en la medicación de un paciente crítico es el peor malentendido
> posible.
