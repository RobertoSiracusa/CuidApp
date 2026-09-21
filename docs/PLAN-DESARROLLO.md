# CuidApp v2 — Plan de Desarrollo

**Destinatario:** Antigravity IDE (agente de desarrollo)
**Documento de referencia:** `docs/ESPECIFICACION-REQUISITOS.md` v2.0
**Fecha:** 2026-09-21

Este documento es **ejecutable**. Cada fase indica qué archivos tocar, qué escribir y cómo saber que
terminó. Ejecuta las fases **en orden**: cada una depende de la anterior.

---

## 0. Reglas de oro

Estas reglas no son negociables. Si alguna instrucción posterior parece contradecirlas, gana la regla.

1. **Sin framework.** Nada de React, Vue, Svelte, Tailwind, jQuery. HTML + CSS + JavaScript de navegador.
2. **Sin paso de build.** Sin `package.json`, sin `npm`, sin bundler. Los archivos se sirven tal cual.
3. **Una sola dependencia:** `supabase-js` v2, descargada como archivo y commiteada en `js/vendor/supabase.js`. **No se carga desde CDN en tiempo de ejecución.**
4. **Todo acceso a datos pasa por `js/api.js`.** Ningún otro módulo llama a Supabase directamente.
5. **Toda interpolación de datos del usuario pasa por `escapeHtml()`.** Sin excepciones. Ver §0.1.
6. **Toda la interfaz en español.** Fechas y moneda en `es-ES`.
7. **Se conserva el patrón IIFE por módulo** de v1: `const Modulo = (() => { ... return { ... }; })();`
8. **Sin pruebas automatizadas.** La verificación es manual, por lista de comprobación (Fase 8).
9. **Sin secretos en el código** salvo la `anon key` de Supabase, que es pública por diseño. La `service_role key` **nunca** aparece en el frontend.

### 0.1 Corrección transversal obligatoria — escapado de HTML

v1 renderizaba datos del usuario con `innerHTML` sin escapar. Sus funciones `escHtml`
(`roles.js:155`, `medications.js:379`, `inventory.js:294`, `food.js:49`) solo escapaban comillas para
atributos `onclick`; **no prevenían XSS**. Un nombre como `<img src=x onerror="...">` ejecutaba
código al renderizar la lista. En `localhost` era un riesgo teórico; **publicado en internet deja de
serlo.**

En `js/api.js`, exporta y usa en todos los módulos:

```js
const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
```

**Regla:** toda `${...}` dentro de una plantilla que termine en `innerHTML` y contenga datos de la
base de datos debe ir envuelta en `escapeHtml()`. Las funciones `escHtml` locales de cada módulo se
eliminan.

Para valores que van dentro de un atributo `onclick='...'` (por ejemplo un id), **prefiere
`dataset` + `addEventListener`** en lugar de construir el `onclick` como texto.

---

## 1. Resultado final — estructura de archivos

```
/
├── index.html                  ← reescrito
├── manifest.json               ← nuevo
├── vercel.json                 ← nuevo
├── .gitignore                  ← nuevo
├── README.md                   ← nuevo (breve)
├── css/
│   └── styles.css              ← modificado (iOS, tipografías, áreas táctiles)
├── js/
│   ├── vendor/
│   │   └── supabase.js         ← nuevo (descargado, versión fija)
│   ├── config.js               ← nuevo (URL + anon key)
│   ├── api.js                  ← nuevo (sustituye data.js)
│   ├── auth.js                 ← nuevo
│   ├── ui.js                   ← nuevo (modal, toast, confirm, estados de carga)
│   ├── app.js                  ← reescrito (solo router + arranque)
│   ├── dashboard.js            ← migrado
│   ├── roles.js                ← migrado + gestión de usuarios
│   ├── medications.js          ← migrado
│   ├── administration.js       ← NUEVO
│   ├── inventory.js            ← migrado
│   ├── tasks.js                ← migrado
│   ├── agenda.js               ← migrado
│   ├── food.js                 ← migrado
│   ├── expenses.js             ← extraído de app.js
│   ├── settings.js             ← extraído de app.js
│   └── audit.js                ← NUEVO
├── supabase/
│   ├── 01_schema.sql
│   ├── 02_functions.sql
│   ├── 03_audit.sql
│   ├── 04_rls.sql
│   ├── 05_seed.sql
│   └── 06_migracion_v1.sql     ← generado en Fase 7
└── docs/
    ├── ESPECIFICACION-REQUISITOS.md
    ├── PLAN-DESARROLLO.md
    ├── TUTORIAL-CUENTAS.md
    └── DEPLOY.md
```

**Archivos de v1 que se eliminan:** `server.ps1`, `test_listener.ps1`, `Iniciar_CuidApp.bat`,
`js/data.js`, `js/vitals.js`, `js/notifications.js`, y `cuidapp_db.json` (solo **después** de la
Fase 7).

---

## FASE 0 — Preparación

**Objetivo:** dejar el repositorio listo, sin arrastrar la arquitectura local de v1.

### Tareas

1. Crear las carpetas `js/vendor/`, `supabase/`.
2. **Conservar** `cuidapp_db.json` por ahora: contiene datos reales que se migran en la Fase 7.
3. Eliminar `server.ps1`, `test_listener.ps1`, `Iniciar_CuidApp.bat`, `js/vitals.js`.
4. Crear `.gitignore`:

```
.DS_Store
Thumbs.db
.vercel
*.log
```

5. Descargar `supabase-js` v2 (compilación UMD para navegador) y guardarlo como
   `js/vendor/supabase.js`. Anotar la versión exacta en un comentario en la primera línea del archivo.
   Expone el global `supabase` con `supabase.createClient(...)`.

6. Crear `js/config.js`:

```js
/* Configuración de conexión a Supabase.
   La anon key es pública por diseño: sin sesión válida y perfil activo,
   las políticas RLS no devuelven ningún dato. */
const CUIDAPP_CONFIG = {
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-ANON-KEY'
};
```

7. Crear `vercel.json`:

```json
{
  "cleanUrls": true,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    },
    {
      "source": "/js/vendor/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

8. Crear `manifest.json`:

```json
{
  "name": "CuidApp — Cuidados en Casa",
  "short_name": "CuidApp",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#080d17",
  "theme_color": "#080d17",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Genera `icon-192.png` y `icon-512.png` con el emoji 🏥 sobre fondo `#080d17`.

9. Crear `README.md` breve (máximo una pantalla): qué es CuidApp, el stack (Vercel + Supabase, sin
   build), cómo ejecutarlo en local —basta con abrir `index.html` desde cualquier servidor estático,
   por ejemplo la extensión Live Server de VS Code— y enlaces a los tres documentos de `docs/`.

   > No repitas aquí el contenido de `docs/`. El README solo orienta a quien abre el repositorio
   > por primera vez.

**Terminado cuando:** el repositorio tiene la estructura de §1 sin los archivos de v1, y
`js/vendor/supabase.js` existe con su versión anotada.

---

## FASE 1 — Base de datos

**Objetivo:** esquema completo, funciones, auditoría y políticas de seguridad.

Los cinco archivos se ejecutan **en orden** en el editor SQL de Supabase. Deben poder aplicarse
sobre un proyecto vacío sin errores.

### 1.1 — `supabase/01_schema.sql`

```sql
-- ═══════════════════════════════════════════════════════════════
-- CuidApp v2 — Esquema
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Tipos ──────────────────────────────────────────────────────
create type app_role_t      as enum ('admin','caregiver');
create type med_status_t    as enum ('active','paused','suspended');
create type admin_status_t  as enum ('given','skipped','refused');
create type task_status_t   as enum ('pending','in-progress','completed');
create type shift_slot_t    as enum ('morning','afternoon','night','any');
create type patient_state_t as enum ('stable','alert','critical');
create type modality_t      as enum ('presencial','telemedicina');
create type appt_status_t   as enum ('upcoming','completed','cancelled');
create type audit_action_t  as enum ('INSERT','UPDATE','DELETE');

-- ── Identidad y equipo ─────────────────────────────────────────
create table care_roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon        text not null default '👤',
  color       text not null default '#8b949e',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  phone         text not null default '',
  notes         text not null default '',
  care_role_id  uuid references care_roles(id) on delete set null,
  app_role      app_role_t not null default 'caregiver',
  active        boolean not null default false,
  created_at    timestamptz not null default now()
);

create table shifts (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  care_role_id  uuid references care_roles(id) on delete set null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);
-- Como máximo un turno abierto en todo el sistema.
-- Se indexa la expresión (ended_at is null), que vale `true` en todas las
-- filas que cumplen el WHERE: por eso solo puede existir una.
-- NO uses ((true)): PostgreSQL rechaza expresiones de índice constantes.
create unique index one_open_shift
  on shifts ((ended_at is null)) where ended_at is null;
create index shifts_started_idx on shifts (started_at desc);

create table shift_notes (
  id               uuid primary key default gen_random_uuid(),
  content          text not null,
  from_profile_id  uuid references profiles(id) on delete set null,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);

-- ── Configuración (filas únicas) ───────────────────────────────
create table settings (
  id  boolean primary key default true check (id),
  patient_name                text not null default 'El Paciente',
  emergency_contact_name      text not null default 'Médico de guardia',
  emergency_contact_phone     text not null default '',
  emergency_contact_whatsapp  text not null default '',
  updated_at  timestamptz not null default now()
);

create table patient_status (
  id  boolean primary key default true check (id),
  status      patient_state_t not null default 'stable',
  notes       text not null default '',
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ── Medicamentos ───────────────────────────────────────────────
create table medications (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  prescriber     text not null default '',
  indication     text not null default '',
  start_date     date not null default current_date,
  status         med_status_t not null default 'active',
  notes          text not null default '',
  needs_restock  boolean not null default false,
  unit           text not null default 'unidad',
  current_stock  numeric not null default 0 check (current_stock >= 0),
  -- Respaldo cuando el medicamento no tiene horarios definidos
  manual_daily_amount numeric,
  created_at     timestamptz not null default now()
);

create table medication_schedules (
  id             uuid primary key default gen_random_uuid(),
  medication_id  uuid not null references medications(id) on delete cascade,
  time_of_day    time not null,
  dose           numeric not null check (dose > 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (medication_id, time_of_day)
);

create table medication_administrations (
  id               uuid primary key default gen_random_uuid(),
  medication_id    uuid not null references medications(id) on delete cascade,
  schedule_id      uuid references medication_schedules(id) on delete set null,
  scheduled_date   date not null default current_date,
  scheduled_time   time,
  administered_at  timestamptz not null default now(),
  administered_by  uuid references profiles(id) on delete set null,
  status           admin_status_t not null,
  dose             numeric not null default 0,
  notes            text not null default '',
  created_at       timestamptz not null default now()
);
-- RF-45: no se puede registrar dos veces la misma dosis programada del mismo día
create unique index uniq_admin_slot
  on medication_administrations (schedule_id, scheduled_date)
  where schedule_id is not null;
create index admin_by_date_idx on medication_administrations (scheduled_date desc);

create table medication_restocks (
  id             uuid primary key default gen_random_uuid(),
  medication_id  uuid not null references medications(id) on delete cascade,
  quantity       numeric not null check (quantity > 0),
  establishment  text not null default '',
  cost           numeric not null default 0,
  managed_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- ── Inventario ─────────────────────────────────────────────────
create table inventory_categories (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique
);

create table inventory_items (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category_id   uuid references inventory_categories(id) on delete set null,
  current_stock numeric not null default 0 check (current_stock >= 0),
  unit          text not null default 'unidad',
  min_threshold numeric not null default 0,
  responsible_care_role_id uuid references care_roles(id) on delete set null,
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

create table inventory_movements (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references inventory_items(id) on delete cascade,
  delta        numeric not null,
  occurred_on  date not null default current_date,
  note         text not null default '',
  profile_id   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index movements_item_idx on inventory_movements (item_id, occurred_on);

-- ── Tareas ─────────────────────────────────────────────────────
create table task_templates (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text not null default '',
  shift          shift_slot_t not null default 'morning',
  assigned_care_role_id uuid references care_roles(id) on delete set null,
  assigned_profile_id   uuid references profiles(id) on delete set null,
  is_emergency   boolean not null default false,
  -- 0=domingo … 6=sábado. Array vacío = todos los días
  recurring_days smallint[] not null default '{}',
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid references task_templates(id) on delete set null,
  title        text not null,
  description  text not null default '',
  shift        shift_slot_t not null default 'morning',
  assigned_care_role_id uuid references care_roles(id) on delete set null,
  assigned_profile_id   uuid references profiles(id) on delete set null,
  status       task_status_t not null default 'pending',
  is_emergency boolean not null default false,
  task_date    date not null default current_date,
  created_at   timestamptz not null default now()
);
-- RF-64: una plantilla no puede instanciarse dos veces el mismo día
create unique index uniq_task_template_day
  on tasks (template_id, task_date) where template_id is not null;
create index tasks_date_idx on tasks (task_date);

create table task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  author_id  uuid references profiles(id) on delete set null,
  text       text not null,
  created_at timestamptz not null default now()
);

-- ── Agenda ─────────────────────────────────────────────────────
create table appointments (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  specialty    text not null default '',
  doctor       text not null default '',
  appt_date    date not null,
  appt_time    time,
  modality     modality_t not null default 'presencial',
  location     text not null default '',
  preparation  text not null default '',
  status       appt_status_t not null default 'upcoming',
  notes        text not null default '',
  result_notes text not null default '',
  created_at   timestamptz not null default now()
);
create index appts_date_idx on appointments (appt_date);

-- ── Alimentación ───────────────────────────────────────────────
create table recipes (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  -- 'breakfast' | 'lunch' | 'dinner'
  meal_types   text[] not null default '{lunch}',
  instructions text not null default '',
  notes        text not null default '',
  created_at   timestamptz not null default now()
);

create table recipe_ingredients (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references recipes(id) on delete cascade,
  name       text not null,
  amount     text not null default '',
  unit       text not null default ''
);

create table weekly_plan (
  id         uuid primary key default gen_random_uuid(),
  day_index  smallint not null check (day_index between 0 and 6),
  meal_type  text not null,
  recipe_id  uuid not null references recipes(id) on delete cascade,
  unique (day_index, meal_type, recipe_id)
);

create table complementos (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text not null default 'otros',
  amount     text not null default '',
  unit       text not null default '',
  notes      text not null default '',
  created_at timestamptz not null default now()
);

create table complemento_ingredients (
  id              uuid primary key default gen_random_uuid(),
  complemento_id  uuid not null references complementos(id) on delete cascade,
  name            text not null,
  amount          text not null default '',
  unit            text not null default ''
);

create table shopping_list (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  amount     text not null default '',
  unit       text not null default '',
  source     text not null default 'manual',
  checked    boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── Gastos ─────────────────────────────────────────────────────
create table expenses (
  id            uuid primary key default gen_random_uuid(),
  expense_date  date not null default current_date,
  amount        numeric not null check (amount > 0),
  category      text not null default 'Otros',
  description   text not null default '',
  linked_restock_id uuid references medication_restocks(id) on delete set null,
  managed_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index expenses_date_idx on expenses (expense_date desc);

-- ── Auditoría ──────────────────────────────────────────────────
create table audit_log (
  id             bigint generated always as identity primary key,
  table_name     text not null,
  record_id      text,
  action         audit_action_t not null,
  actor_id       uuid,
  actor_name     text not null default 'Sistema',
  changed_fields text[] not null default '{}',
  old_values     jsonb,
  new_values     jsonb,
  created_at     timestamptz not null default now()
);
create index audit_created_idx on audit_log (created_at desc);
create index audit_table_idx   on audit_log (table_name, created_at desc);
create index audit_actor_idx   on audit_log (actor_id, created_at desc);
```

> **`record_id` es `text`, no `uuid`, a propósito.** Las tablas `settings` y `patient_status` usan
> una clave booleana para garantizar fila única. Un `uuid` fallaría al auditarlas.

### 1.2 — `supabase/02_functions.sql`

```sql
-- ═══════════════════════════════════════════════════════════════
-- Funciones auxiliares y de negocio
-- ═══════════════════════════════════════════════════════════════

-- ── Ayudantes de permisos ──────────────────────────────────────
-- SECURITY DEFINER es OBLIGATORIO: estas funciones se usan dentro de
-- las políticas RLS de `profiles`. Sin ello, consultar profiles dentro
-- de una política de profiles provoca recursión infinita.
create or replace function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and active = true
  );
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
     where id = auth.uid() and active = true and app_role = 'admin'
  );
$$;

-- ── Alta automática de perfil (RF-02) ──────────────────────────
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, app_role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    'caregiver',
    false          -- inactivo hasta que un admin lo active
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ── Guarda de perfiles (RF-11) ─────────────────────────────────
-- Un usuario no puede auto-promoverse ni auto-activarse.
-- Un admin no puede degradarse ni desactivarse a sí mismo:
-- evita dejar el sistema sin administrador.
create or replace function guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (not is_admin()) or (old.id = auth.uid()) then
    new.app_role := old.app_role;
    new.active   := old.active;
  end if;
  return new;
end; $$;

drop trigger if exists guard_profiles on profiles;
create trigger guard_profiles before update on profiles
for each row execute function guard_profile_update();

-- ── Turnos ─────────────────────────────────────────────────────
create or replace function take_shift(p_care_role_id uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  update shifts set ended_at = now() where ended_at is null;
  insert into shifts (profile_id, care_role_id)
  values (auth.uid(), p_care_role_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function end_shift()
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  update shifts set ended_at = now() where ended_at is null;
end; $$;

-- ── Administración de dosis (RF-42, RF-43) ─────────────────────
-- Registra la dosis y descuenta el stock EN LA MISMA TRANSACCIÓN.
-- El descuento no vive en el cliente, así no puede desincronizarse.
create or replace function record_administration(
  p_medication_id  uuid,
  p_schedule_id    uuid,
  p_scheduled_date date,
  p_scheduled_time time,
  p_status         admin_status_t,
  p_dose           numeric,
  p_notes          text default ''
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;

  insert into medication_administrations (
    medication_id, schedule_id, scheduled_date, scheduled_time,
    administered_by, status, dose, notes
  ) values (
    p_medication_id, p_schedule_id, p_scheduled_date, p_scheduled_time,
    auth.uid(), p_status, coalesce(p_dose, 0), coalesce(p_notes, '')
  ) returning id into v_id;

  if p_status = 'given' then
    update medications
       set current_stock = greatest(0, current_stock - coalesce(p_dose, 0))
     where id = p_medication_id;
  end if;

  return v_id;
end; $$;

-- ── Corrección de dosis (RF-46) ────────────────────────────────
-- Revierte el descuento si la dosis se había marcado como administrada.
create or replace function undo_administration(p_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare r record;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  select * into r from medication_administrations where id = p_id;
  if not found then raise exception 'Registro no encontrado'; end if;

  if r.status = 'given' then
    update medications
       set current_stock = current_stock + r.dose
     where id = r.medication_id;
  end if;

  delete from medication_administrations where id = p_id;
end; $$;

-- ── Reposición de medicamento (RF-36, RF-37) ───────────────────
-- Suma stock, limpia la marca de reposición y, si hubo costo,
-- crea el gasto asociado. Todo en una transacción.
create or replace function record_restock(
  p_medication_id uuid,
  p_quantity      numeric,
  p_establishment text default '',
  p_cost          numeric default 0
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_name text;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;

  -- El nombre se lee aquí, no se recibe del cliente: así la descripción
  -- del gasto nunca puede contradecir al medicamento real.
  select name into v_name from medications where id = p_medication_id;
  if not found then raise exception 'Medicamento no encontrado'; end if;

  insert into medication_restocks (medication_id, quantity, establishment, cost, managed_by)
  values (p_medication_id, p_quantity, coalesce(p_establishment,''), coalesce(p_cost,0), auth.uid())
  returning id into v_id;

  update medications
     set current_stock = current_stock + p_quantity,
         needs_restock = false
   where id = p_medication_id;

  if coalesce(p_cost, 0) > 0 then
    insert into expenses (amount, category, description, linked_restock_id, managed_by)
    values (p_cost, 'Medicamentos', 'Reposición: ' || v_name, v_id, auth.uid());
  end if;

  return v_id;
end; $$;

-- ── Ajuste de inventario (RF-51, RF-52, RF-53) ─────────────────
-- La restricción current_stock >= 0 impide dejarlo en negativo.
create or replace function adjust_inventory(
  p_item_id uuid, p_delta numeric, p_note text default ''
) returns numeric
language plpgsql security invoker set search_path = public as $$
declare v_stock numeric;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;

  update inventory_items
     set current_stock = current_stock + p_delta
   where id = p_item_id
  returning current_stock into v_stock;

  if not found then raise exception 'Ítem no encontrado'; end if;

  insert into inventory_movements (item_id, delta, note, profile_id)
  values (p_item_id, p_delta, coalesce(p_note,''), auth.uid());

  return v_stock;
end; $$;

-- ── Generación de tareas recurrentes (RF-64) ───────────────────
-- Idempotente: el índice único impide duplicar la misma plantilla
-- el mismo día, así que se puede llamar en cada arranque sin riesgo.
create or replace function generate_recurring_tasks(p_date date default current_date)
returns integer
language plpgsql security invoker set search_path = public as $$
declare v_count integer;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;

  insert into tasks (
    template_id, title, description, shift,
    assigned_care_role_id, assigned_profile_id, is_emergency, task_date
  )
  select t.id, t.title, t.description, t.shift,
         t.assigned_care_role_id, t.assigned_profile_id, t.is_emergency, p_date
    from task_templates t
   where t.active
     and ( cardinality(t.recurring_days) = 0
           or extract(dow from p_date)::smallint = any(t.recurring_days) )
  on conflict (template_id, task_date) where template_id is not null
  do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- ═══════════════════════════════════════════════════════════════
-- VISTAS
--
-- ⚠️ TODAS llevan `with (security_invoker = true)`. NO lo omitas.
-- Por defecto una vista de PostgreSQL se ejecuta con los permisos de
-- QUIEN LA CREÓ (aquí, el superusuario), y por tanto NO aplica el RLS
-- de las tablas base. Sin esta cláusula, cualquier usuario autenticado
-- —incluso uno inactivo, aún sin aprobar— podría leer el expediente
-- completo a través de la vista, saltándose por completo 04_rls.sql.
-- Requiere PostgreSQL 15 o superior (Supabase ya lo usa).
-- ═══════════════════════════════════════════════════════════════

-- Consumo diario derivado de los horarios activos (RF-48).
-- Si el medicamento no tiene horarios, usa el valor manual.
create or replace view medication_daily_dose
with (security_invoker = true) as
select m.id as medication_id,
       coalesce(
         sum(s.dose) filter (where s.active),
         m.manual_daily_amount,
         0
       ) as daily_amount
  from medications m
  left join medication_schedules s on s.medication_id = m.id
 group by m.id, m.manual_daily_amount;

-- ── CORRECCIÓN DEL DEFECTO DE v1 (RF-54, RF-55) ────────────────
-- v1 dividía el consumo total entre el NÚMERO DE MOVIMIENTOS.
-- Lo correcto es dividir entre los DÍAS CALENDARIO transcurridos.
-- Con menos de 7 días de historial no se publica proyección: una
-- estimación basada en uno o dos movimientos es ruido disfrazado
-- de certeza, y en insumos de cuidado eso es peor que no mostrar nada.
create or replace view inventory_consumption_stats
with (security_invoker = true) as
with consumo as (
  select item_id,
         sum(abs(delta)) as total_consumed,
         min(occurred_on) as first_day
    from inventory_movements
   where delta < 0
   group by item_id
)
select i.id  as item_id,
       coalesce(c.total_consumed, 0) as total_consumed,
       c.first_day,
       (current_date - c.first_day + 1) as days_span,
       case
         when c.first_day is null then null
         when (current_date - c.first_day + 1) < 7 then null
         when coalesce(c.total_consumed,0) = 0 then null
         else round(c.total_consumed / (current_date - c.first_day + 1)::numeric, 3)
       end as avg_daily_consumption,
       case
         when c.first_day is null then null
         when (current_date - c.first_day + 1) < 7 then null
         when coalesce(c.total_consumed,0) = 0 then null
         else floor(
                i.current_stock /
                (c.total_consumed / (current_date - c.first_day + 1)::numeric)
              )
       end as days_remaining
  from inventory_items i
  left join consumo c on c.item_id = i.id;

-- ── Vistas de lectura para la interfaz ─────────────────────────
-- PostgREST deduce las relaciones a partir de claves foráneas. Una
-- vista con GROUP BY no tiene ninguna, así que NO se puede anidar
-- dentro de otra consulta (`select('*, medication_daily_dose(...)')`
-- falla). La solución es exponer una vista ya compuesta y leerla
-- directamente, en una sola consulta.
--
-- Regla para api.js:  LEER de las vistas *_view
--                     ESCRIBIR en las tablas base.

create or replace view medications_view
with (security_invoker = true) as
select m.*,
       d.daily_amount,
       case
         when coalesce(d.daily_amount, 0) <= 0 then null
         else floor(m.current_stock / d.daily_amount)
       end as days_remaining
  from medications m
  left join medication_daily_dose d on d.medication_id = m.id;

create or replace view inventory_items_view
with (security_invoker = true) as
select i.*,
       c.name as category_name,
       s.avg_daily_consumption,
       s.days_remaining,
       (i.min_threshold > 0 and i.current_stock <= i.min_threshold) as is_low
  from inventory_items i
  left join inventory_categories c on c.id = i.category_id
  left join inventory_consumption_stats s on s.item_id = i.id;
```

> **`avg_daily_consumption` y `days_remaining` devuelven `NULL` cuando no hay datos suficientes.**
> La interfaz debe mostrar *"Recopilando datos"*, nunca `0` ni `—`.
>
> Ojo con la diferencia: en `medications_view`, `days_remaining` se calcula sobre la **dosis
> programada** (dato declarado, siempre disponible). En `inventory_items_view` se calcula sobre el
> **consumo observado**, que necesita al menos 7 días de historial. Por eso el inventario muestra
> "Recopilando datos" y los medicamentos no.

### 1.3 — `supabase/03_audit.sql`

```sql
-- ═══════════════════════════════════════════════════════════════
-- Auditoría automática (RF-100 .. RF-106)
--
-- Por qué en la base de datos y no en la aplicación: si cada módulo
-- JS tuviera que registrar sus cambios, bastaría un olvido — o un
-- cliente modificado — para que una acción no quedara registrada.
-- Con un trigger, la auditoría ocurre dentro de la MISMA transacción
-- que el cambio: o se registran ambos, o no ocurre ninguno.
-- ═══════════════════════════════════════════════════════════════

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old      jsonb := '{}'::jsonb;
  v_new      jsonb := '{}'::jsonb;
  v_changed  text[] := '{}';
  v_key      text;
  v_actor    uuid := auth.uid();
  v_name     text;
  v_record   text;
  j_old      jsonb;
  j_new      jsonb;
begin
  select full_name into v_name from profiles where id = v_actor;

  if TG_OP = 'INSERT' then
    j_new    := to_jsonb(NEW);
    v_new    := j_new;
    v_changed:= array(select jsonb_object_keys(j_new));
    v_record := j_new->>'id';

  elsif TG_OP = 'UPDATE' then
    j_old := to_jsonb(OLD);
    j_new := to_jsonb(NEW);
    -- Guarda SOLO los campos que cambiaron (RNF-36): reduce el
    -- tamaño de fila y hace legible la auditoría.
    for v_key in select jsonb_object_keys(j_new) loop
      if j_new->v_key is distinct from j_old->v_key then
        v_changed := v_changed || v_key;
        v_old := v_old || jsonb_build_object(v_key, j_old->v_key);
        v_new := v_new || jsonb_build_object(v_key, j_new->v_key);
      end if;
    end loop;
    if cardinality(v_changed) = 0 then
      return null;   -- UPDATE que no cambió nada: no se audita
    end if;
    v_record := j_new->>'id';

  else -- DELETE
    j_old    := to_jsonb(OLD);
    v_old    := j_old;
    v_changed:= array(select jsonb_object_keys(j_old));
    v_record := j_old->>'id';
  end if;

  insert into audit_log (
    table_name, record_id, action, actor_id, actor_name,
    changed_fields, old_values, new_values
  ) values (
    TG_TABLE_NAME, v_record, TG_OP::audit_action_t, v_actor,
    coalesce(nullif(v_name,''), 'Sistema'),
    v_changed,
    nullif(v_old, '{}'::jsonb),
    nullif(v_new, '{}'::jsonb)
  );

  return null;
end; $$;

-- Aplicar el trigger a todas las tablas de negocio.
-- audit_log queda deliberadamente fuera: no se audita a sí misma.
do $$
declare t text;
begin
  foreach t in array array[
    'care_roles','profiles','settings','patient_status','shifts','shift_notes',
    'medications','medication_schedules','medication_administrations','medication_restocks',
    'inventory_categories','inventory_items','inventory_movements',
    'task_templates','tasks','task_comments','appointments',
    'recipes','recipe_ingredients','weekly_plan',
    'complementos','complemento_ingredients','shopping_list','expenses'
  ] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I;', t);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function audit_trigger();', t);
  end loop;
end $$;

-- ── Retención (RNF-37) ─────────────────────────────────────────
-- Ejecutar manualmente cada cierto tiempo, o programar con pg_cron.
create or replace function purge_old_audit(p_months integer default 24)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not is_admin() then raise exception 'Solo un administrador'; end if;
  delete from audit_log where created_at < now() - (p_months || ' months')::interval;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
```

### 1.4 — `supabase/04_rls.sql`

```sql
-- ═══════════════════════════════════════════════════════════════
-- Row Level Security (RNF-28, RNF-29)
--
-- Toda la seguridad del sistema vive aquí. El cliente es público:
-- si estas políticas están mal, los datos quedan expuestos.
-- ═══════════════════════════════════════════════════════════════

-- ── Tablas operativas: cualquier usuario ACTIVO opera ──────────
do $$
declare t text;
begin
  foreach t in array array[
    'care_roles','patient_status','shifts','shift_notes',
    'medications','medication_schedules','medication_administrations','medication_restocks',
    'inventory_categories','inventory_items','inventory_movements',
    'task_templates','tasks','task_comments','appointments',
    'recipes','recipe_ingredients','weekly_plan',
    'complementos','complemento_ingredients','shopping_list','expenses'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %1$s_all on public.%1$I;', t);
    execute format(
      'create policy %1$s_all on public.%1$I
         for all to authenticated
         using (is_active_user()) with check (is_active_user());', t);
  end loop;
end $$;

-- ── profiles ───────────────────────────────────────────────────
alter table profiles enable row level security;

-- Un usuario inactivo debe poder leer SU PROPIO perfil para que la
-- app pueda mostrarle "cuenta pendiente de aprobación" (RF-06).
create policy profiles_select on profiles
  for select to authenticated
  using (id = auth.uid() or is_active_user());

-- Cualquiera edita su propio perfil; un admin edita cualquiera.
-- El trigger guard_profile_update impide auto-promoverse (RF-11).
create policy profiles_update on profiles
  for update to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- Las altas las hace el trigger handle_new_user, no el cliente.
create policy profiles_delete on profiles
  for delete to authenticated using (is_admin());

-- ── settings: solo lectura para todos, escritura solo admin ────
alter table settings enable row level security;
create policy settings_select on settings
  for select to authenticated using (is_active_user());
create policy settings_update on settings
  for update to authenticated using (is_admin()) with check (is_admin());

-- ── audit_log: SOLO LECTURA y SOLO admin (RF-102, RF-103) ──────
alter table audit_log enable row level security;
create policy audit_select on audit_log
  for select to authenticated using (is_admin());
-- Deliberadamente NO se crean políticas de insert/update/delete:
-- nadie puede escribir la auditoría desde la aplicación. El trigger
-- escribe como SECURITY DEFINER (dueño de la tabla) y no está sujeto
-- a RLS.
-- IMPORTANTE: no ejecutar nunca
--   alter table audit_log force row level security;
-- porque eso bloquearía también al trigger.

-- ── Permisos sobre vistas ──────────────────────────────────────
grant select on medication_daily_dose        to authenticated;
grant select on inventory_consumption_stats  to authenticated;
grant select on medications_view             to authenticated;
grant select on inventory_items_view         to authenticated;

-- ── Comprobación: ninguna vista sin security_invoker ───────────
-- Debe devolver CERO filas. Si devuelve alguna, esa vista es un
-- agujero: expone sus tablas base saltándose el RLS.
select c.relname as vista_insegura
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v'
   and n.nspname = 'public'
   and coalesce(
         (select option_value from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'), 'false') <> 'true';
```

> **Por qué la comprobación anterior importa.** `grant select` sobre una vista da acceso a los datos
> **sin pasar por las políticas RLS de las tablas base**, porque la vista se ejecuta con los
> permisos de quien la creó. Las cuatro vistas de este proyecto llevan `security_invoker = true`
> precisamente para evitarlo. Si alguna vez añades una vista nueva, esa consulta es la forma de
> comprobar que no abriste una puerta trasera al expediente del paciente.

### 1.5 — `supabase/05_seed.sql`

```sql
-- ═══════════════════════════════════════════════════════════════
-- Datos iniciales
-- ═══════════════════════════════════════════════════════════════

insert into settings (id) values (true) on conflict do nothing;
insert into patient_status (id) values (true) on conflict do nothing;

insert into care_roles (name, icon, color, is_default) values
  ('Médico',                 '⚕️',  '#3fb4a0', true),
  ('Enfermera/Enfermero',    '💉',  '#6e8efb', true),
  ('Cuidador/a',             '🤝',  '#f0a500', true),
  ('Coordinador Familiar',   '👨‍👩‍👧', '#e05a4e', true),
  ('Fisioterapeuta',         '🏃',  '#26a66a', true),
  ('Nutricionista',          '🥗',  '#a78bfa', true),
  ('Proveedor/Farmacia',     '🏥',  '#fb923c', true);

insert into inventory_categories (name) values
  ('Medicamentos'), ('Insumos Médicos'), ('Alimentos/Suplementos'),
  ('Higiene Personal'), ('Equipos'), ('Otros')
on conflict (name) do nothing;

-- ── PRIMER ADMINISTRADOR ───────────────────────────────────────
-- Ejecutar DESPUÉS de haberse registrado en la app con ese email.
-- Sustituir por el email real antes de ejecutar.
update profiles
   set app_role = 'admin', active = true
 where id = (select id from auth.users where email = 'CAMBIAR@EJEMPLO.COM');
```

> **El trigger `guard_profile_update` impide auto-promoverse desde la app.** Este `UPDATE` funciona
> porque el editor SQL de Supabase se ejecuta con privilegios de servicio, no como un usuario
> autenticado. Es el único camino previsto para crear el primer admin.
>
> **Crea al menos dos administradores** (riesgo A-6 del SRS): si se pierde el acceso al único, hay
> que volver al panel de Supabase.

**Terminado cuando:** los cinco archivos se aplican en orden sobre un proyecto vacío sin errores, y
`select * from care_roles;` devuelve 7 filas.

---

## FASE 2 — Autenticación

**Objetivo:** nadie ve datos sin sesión válida y perfil activo.

### 2.1 — `js/auth.js`

Módulo IIFE `Auth` con esta superficie:

| Función | Comportamiento |
|---|---|
| `init()` | Crea el cliente Supabase con `CUIDAPP_CONFIG`. Recupera la sesión existente. Devuelve el estado inicial |
| `signIn(email, password)` | Inicia sesión. Devuelve `{ ok, error }` con mensaje **en español** |
| `signUp(email, password, fullName)` | Registra. Pasa `full_name` en `options.data` para que `handle_new_user` lo recoja |
| `signOut()` | Cierra sesión y recarga la app |
| `resetPassword(email)` | Envía enlace de recuperación (RF-05) |
| `getUser()` | Devuelve el usuario de la sesión actual |
| `getProfile()` | Devuelve el perfil cacheado: `{ id, full_name, phone, care_role_id, app_role, active }` |
| `isAdmin()` | `true` si `app_role === 'admin'` |
| `requireAdmin()` | Lanza o devuelve `false` si no es admin. Se usa como guarda en `audit.js` y en gestión de usuarios |
| `onChange(cb)` | Suscribe a cambios de sesión (`onAuthStateChange`) |

El cliente Supabase vive **dentro** de `auth.js` y se expone a `api.js` mediante `Auth.client()`.
Ningún módulo de interfaz lo toca.

### 2.2 — Pantallas de acceso en `index.html`

Tres estados excluyentes, antes del `<div id="app">`:

1. **`#auth-screen`** — acceso y registro. Dos pestañas: "Entrar" y "Crear cuenta", más un enlace
   "Olvidé mi contraseña".
   - `<input type="email" autocomplete="email">`
   - `<input type="password" autocomplete="current-password">` (o `new-password` en registro)
   - Estos atributos son los que permiten que el **llavero de iOS** ofrezca guardar y autocompletar
     (RNF-17). No los omitas.
2. **`#pending-screen`** — sesión válida, perfil inactivo (RF-06):
   *"Tu cuenta está creada pero aún no ha sido aprobada. Pide a un administrador de CuidApp que la
   active."* Con botón de cerrar sesión.
3. **`#app`** — la aplicación, oculta hasta tener sesión **y** perfil activo.

### 2.3 — Flujo de arranque en `js/app.js`

```
DOMContentLoaded
  └─ Auth.init()
       ├─ sin sesión           → mostrar #auth-screen
       ├─ sesión + inactivo    → mostrar #pending-screen
       └─ sesión + activo      → Api.bootstrap()  (settings, estado, perfiles, roles,
                                                    generate_recurring_tasks)
                                  → mostrar #app → navigateTo('dashboard')
```

**Terminado cuando:**
- Sin sesión no se ve ningún dato del paciente.
- Un usuario recién registrado ve la pantalla de pendiente.
- Tras activarlo desde el editor SQL, al recargar entra a la app.
- Cerrar y reabrir el navegador **no** vuelve a pedir credenciales.

---

## FASE 3 — Capa de datos (`js/api.js`)

**Objetivo:** sustituir `js/data.js` por completo. Es el único módulo que habla con Supabase.

### 3.1 Diferencias esenciales respecto a `data.js`

| `data.js` (v1) | `api.js` (v2) |
|---|---|
| Síncrono (`getMedications()` devuelve el array) | **Asíncrono** — todo devuelve `Promise`. Los módulos usan `async/await` |
| Escribía en `localStorage` | Escribe en Supabase |
| `camelCase` | La base usa `snake_case`. **`api.js` traduce**: expone `camelCase` a los módulos |
| Sin manejo de errores | Toda función captura el error y devuelve `{ data, error }` con **mensaje en español** |

### 3.2 Estructura

```js
const Api = (() => {
  'use strict';
  const db = () => Auth.client();

  // ── Utilidades ─────────────────────────────────────────
  const escapeHtml = (s) => { /* §0.1 */ };
  const fail = (error) => { /* traduce a mensaje en español */ };

  // ── Caché en memoria (NO localStorage) ─────────────────
  // Solo para datos de referencia que cambian poco:
  // care_roles, profiles, settings. Se invalida al escribirlos.
  let cache = {};

  // ── Un bloque por dominio ──────────────────────────────
  // settings · patientStatus · profiles · careRoles · shifts
  // shiftNotes · medications · schedules · administrations
  // restocks · inventory · tasks · taskTemplates · appointments
  // recipes · weeklyPlan · complementos · shopping · expenses · audit

  return { escapeHtml, /* … */ };
})();
```

### 3.3 Funciones que deben llamar a RPC, no a tablas

Estas operaciones son transaccionales. **Llámalas con `db().rpc(...)`**, nunca replicando su lógica
en el cliente:

| Función de `api.js` | RPC |
|---|---|
| `takeShift(careRoleId)` | `take_shift` |
| `endShift()` | `end_shift` |
| `recordAdministration({...})` | `record_administration` |
| `undoAdministration(id)` | `undo_administration` |
| `recordRestock({medicationId, quantity, establishment, cost})` | `record_restock` |
| `adjustInventory(itemId, delta, note)` | `adjust_inventory` |
| `generateRecurringTasks()` | `generate_recurring_tasks` |
| `purgeOldAudit(months)` | `purge_old_audit` |

### 3.4 Consultas con relaciones anidadas (RNF-43)

Evita el patrón N+1. PostgREST trae las relaciones **con clave foránea** en una sola consulta:

```js
// ✅ Bien: una sola consulta. medication_schedules tiene FK a medications,
//    así que PostgREST sabe anidarla. Y los cálculos ya vienen en la vista.
const { data } = await db()
  .from('medications_view')
  .select('*, medication_schedules(*)')
  .order('name');
```

```js
// ❌ Mal: PostgREST NO puede anidar una vista con GROUP BY, porque no
//    tiene clave foránea que relacionar. Esta consulta falla.
.from('medications').select('*, medication_daily_dose(daily_amount)')

// ❌ Mal: una consulta por cada medicamento (N+1).
for (const m of meds) { await db().from('medication_schedules')... }
```

**Regla general:**

| Operación | Origen |
|---|---|
| Leer medicamentos | `medications_view` (trae `daily_amount` y `days_remaining`) |
| Leer inventario | `inventory_items_view` (trae `category_name`, `avg_daily_consumption`, `days_remaining`, `is_low`) |
| Escribir cualquier cosa | La **tabla base**, nunca la vista |

### 3.5 Formateadores

Traslada tal cual desde `data.js` (§932–982 de v1), no cambian: `formatDate`, `formatDateShort`,
`formatDateTime`, `timeAgo`, `shiftDuration`, `currency`.

### 3.6 Alertas derivadas (RF-84)

`Api.getActiveAlerts()` calcula **en el cliente, a partir de datos ya cargados**, sin tabla:

1. Dosis atrasadas de hoy (hora programada pasada, sin registro).
2. Medicamentos activos con `days_remaining <= 3`.
3. Ítems de inventario con `current_stock <= min_threshold` y `min_threshold > 0`.
4. Citas con `appt_date` dentro de 2 días y `status = 'upcoming'`.

Devuelve `[{ type, title, message, module }]`. **No se persiste nada.** Una alerta desaparece sola
cuando la condición deja de cumplirse (RF-86).

**Terminado cuando:** `api.js` cubre todas las operaciones de los módulos y `js/data.js` está
eliminado.

---

## FASE 4 — Migración de los módulos existentes

**Objetivo:** pasar cada módulo de v1 de síncrono/`localStorage` a asíncrono/`api.js`.

### 4.0 Reestructurar `index.html` — hazlo ANTES que los módulos

Cada módulo busca su `<section>` por id. Si no existe, `render()` sale en silencio y la pantalla
queda en blanco **sin ningún error en consola**. Es exactamente el fallo que dejó huérfano el módulo
de signos vitales en v1.

**Secciones dentro de `<main id="main-content">`** — deben existir todas antes de la Fase 5:

```html
<section id="panel-dashboard"      class="panel"></section>
<section id="panel-administration" class="panel"></section>  <!-- NUEVO -->
<section id="panel-tasks"          class="panel"></section>
<section id="panel-medications"    class="panel"></section>
<section id="panel-inventory"      class="panel"></section>
<section id="panel-roles"          class="panel"></section>
<section id="panel-agenda"         class="panel"></section>
<section id="panel-food"           class="panel"></section>
<section id="panel-expenses"       class="panel"></section>
<section id="panel-audit"          class="panel"></section>  <!-- NUEVO, solo admin -->
<section id="panel-settings"       class="panel"></section>
```

**No existe `panel-vitals`.** Tampoco debe existir la ruta `vitals` en el router.

**Navegación inferior** — cinco destinos. Las dosis se consultan muchas veces al día; el catálogo de
medicamentos, casi nunca. Por eso Dosis entra en la barra y Medicamentos baja al menú "Más":

| Posición | Panel | Icono | Etiqueta |
|---|---|---|---|
| 1 | `dashboard` | 🏥 | Inicio |
| 2 | `administration` | 💊 | **Dosis** |
| 3 | `tasks` | 📋 | Tareas |
| 4 | `inventory` | 📦 | Stock |
| 5 | — | ⋯ | Más |

**Menú "Más"**: Medicamentos · Roles y Personal · Agenda Médica · Alimentación · Gastos ·
Configuración · **Auditoría** *(solo admin: se oculta con `hidden` si `Auth.isAdmin()` es falso)*.

**Checklist por cada módulo nuevo** (los cuatro puntos de RNF-51):

- [ ] `<script src="js/modulo.js">` en el orden del Apéndice B
- [ ] `<section id="panel-modulo">` en `index.html`
- [ ] Entrada en la navegación inferior o en el menú "Más"
- [ ] Registro en el objeto `modules` del router de `app.js`

### 4.1 Receta de migración (aplicar a cada módulo)

1. `render()` pasa a `async render()`. Todas las llamadas a datos con `await`.
2. **Antes** de la primera `await`, pinta el estado de carga: `Ui.skeleton(el)` (RNF-21).
3. Sustituir `CuidAppData.x()` por `await Api.x()`.
4. Sustituir `Notifications.toast(...)` por `Ui.toast(...)`.
5. Sustituir `App.showModal/confirm` por `Ui.showModal/confirm`.
6. **Envolver en `escapeHtml()` toda interpolación de datos** (§0.1). Eliminar el `escHtml` local.
7. Sustituir los `onclick="Modulo.fn('id')"` construidos como texto por `data-*` +
   `addEventListener` delegado en el contenedor.
8. Envolver cada escritura: si `error`, `Ui.toast(mensaje, 'error')` y **no cerrar el modal**, para
   que no se pierda lo escrito (RNF-19).

### 4.1.1 El panel de alertas vive en `ui.js`

v1 tenía `notifications.js`, que se elimina porque las alertas ya no se almacenan. Pero **la campana
del encabezado sigue existiendo** (RF-84..87) y necesita dueño: es cromo global, presente en todas
las pantallas, así que va en `ui.js` junto al resto del cromo.

`Ui.renderAlerts()` debe:

1. Llamar a `Api.getActiveAlerts()` (§3.6).
2. Pintar la lista en `#notif-list` y el número en `#notif-count`.
3. Si no hay alertas, mostrar *"Todo en orden"* — **no** el vacío de v1 ("Sin notificaciones nuevas"),
   que sugería que algo se había perdido.
4. Cada alerta navega a su módulo al tocarla.

**Cuándo recalcular (RF-85):**

```js
// Al arrancar, tras cargar los datos iniciales
// Al volver del segundo plano — clave en iPhone, donde la app
// puede pasar horas suspendida mostrando alertas caducadas
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) Ui.renderAlerts();
});
// Después de cualquier escritura que pueda cambiar una condición:
// administrar dosis, ajustar stock, completar cita
```

**Lo que ya no existe:** marcar como leída, limpiar, o el auto-marcado a los 2 segundos
(`notifications.js:87`). Una alerta se apaga sola cuando su causa desaparece (RF-86). No ofrezcas
ningún botón para descartarla: invitaría a ocultar un stock agotado en lugar de resolverlo.

### 4.2 Orden y notas por módulo

| # | Módulo | Notas específicas |
|---|---|---|
| 1 | `ui.js` | **Primero.** Extraer de `app.js` v1: `showModal` (`app.js:52`), `confirm` (`app.js:95`), toasts (`notifications.js:11`). Añadir `skeleton()`, `setLoading(btn, bool)`, la franja de sin conexión y **el panel de alertas** (§4.1.1) |
| 2 | `app.js` | Reducir a router + arranque + menú "Más" + emergencia + "¿Qué hago ahora?". Quitar gastos y configuración. **Quitar la ruta `vitals`** de `app.js:42` |
| 3 | `settings.js` | Extraer de `app.js:406`. Configuración global solo admin (RF-95); perfil propio para todos (RF-96); cerrar sesión (RF-97). **Quitar "Reiniciar datos"** |
| 4 | `expenses.js` | Extraer de `app.js:305`. Añadir paginación (RNF-44) |
| 5 | `roles.js` | Las personas ya no son registros sueltos: **son perfiles de usuario**. Añadir la pestaña "Usuarios" visible solo para admin (RF-07..11) |
| 6 | `dashboard.js` | Añadir el bloque de **dosis pendientes y atrasadas** (RF-15), arriba de las tareas |
| 7 | `tasks.js` | Plantillas y tareas ahora son tablas distintas. La generación recurrente ya **no** se llama aquí: se llama en el arranque (Fase 2) |
| 8 | `inventory.js` | Leer de `inventory_items_view`; escribir en `inventory_items`. Si `days_remaining` es `null`, mostrar **"Recopilando datos"** (RF-55). Los ajustes de stock van por `Api.adjustInventory()` (RPC), nunca por `update` directo |
| 9 | `medications.js` | Leer de `medications_view`; escribir en `medications`. Añadir la gestión de horarios de dosis (RF-39, RF-40) |
| 10 | `agenda.js` | Migración directa. Renombrar `date`→`appt_date`, `time`→`appt_time` |
| 11 | `food.js` | El más extenso. El plan semanal pasa de objeto anidado a tabla `weekly_plan`; los ingredientes, a tablas propias. **La consolidación por fecha (`getIngredientsFromPlanByDay`, `data.js:714`) se conserva tal cual**: es lógica de presentación, se ejecuta en el cliente sobre los datos ya cargados |

**Terminado cuando:** todos los módulos leen y escriben en Supabase, y una búsqueda de
`localStorage` en `js/` solo la encuentra dentro de `vendor/supabase.js`.

---

## FASE 5 — Módulos nuevos

### 5.1 — `js/administration.js` (RF-39 .. RF-48)

Nueva entrada en la navegación inferior. Sugerencia: sustituir "Meds" por **"Dosis"** y mover
Medicamentos al menú "Más" — las dosis se consultan muchas veces al día; el catálogo, casi nunca.

**Pestaña "Hoy"** — la pantalla principal:

1. Cargar horarios activos de medicamentos activos, y las administraciones de hoy.
2. Construir la lista de dosis del día: por cada horario, buscar si ya hay registro de hoy.
3. Clasificar y ordenar por hora:
   - **Atrasada** — hora pasada, sin registro. Color crítico, arriba del todo.
   - **Pendiente** — hora futura, sin registro.
   - **Registrada** — muestra estado, hora real y quién.
4. Cada dosis pendiente ofrece tres botones grandes (≥44px): **✅ Administrada · ⏭ Omitida ·
   🚫 Rechazada**, con campo de notas opcional.
5. Al confirmar: `Api.recordAdministration({...})` → RPC → refrescar.
6. Cada dosis registrada ofrece **↩ Corregir** → `Api.undoAdministration(id)`, con confirmación.

**Pestaña "Historial"** — por medicamento y rango de fechas, con quién administró cada dosis (RF-47).

**Gestión de horarios** — dentro del módulo de Medicamentos: añadir, editar, activar/desactivar
horarios (hora + dosis).

> **Advertencia visible en la interfaz.** Incluye un texto permanente en la pantalla de dosis:
> *"CuidApp registra las dosis administradas; no envía recordatorios."*
> El sistema no tiene notificaciones push (restricción R-7 del SRS). Omitir este aviso crearía una
> falsa sensación de seguridad en un asunto clínico.

### 5.2 — `js/audit.js` (RF-100 .. RF-106)

Visible **solo si `Auth.isAdmin()`**. Entrada en el menú "Más", oculta para el resto.

- Filtros: módulo (`table_name`), usuario (`actor_id`), rango de fechas.
- Paginación con `.range(desde, hasta)`, 50 filas por página.
- **Presentación en lenguaje llano (RF-105).** Necesitas dos diccionarios de traducción:

```js
const TABLAS = {
  medications: 'Medicamentos', inventory_items: 'Inventario',
  tasks: 'Tareas', shifts: 'Turnos', expenses: 'Gastos',
  medication_administrations: 'Dosis administradas', profiles: 'Usuarios',
  /* … una entrada por tabla … */
};
const CAMPOS = {
  current_stock: 'stock', full_name: 'nombre', task_date: 'fecha',
  needs_restock: 'marca de reposición', app_role: 'rol de permisos',
  /* … */
};
```

Renderizar como: **"María González cambió el stock de 12 a 8 · Inventario · hace 2 horas"**, con un
desplegable para ver el detalle técnico. Un volcado de JSON crudo no cumple RF-105.

- Si el admin intenta escribir en `audit_log`, RLS lo impide. No ofrezcas ninguna acción de edición
  ni borrado: el registro es inmutable por diseño (RF-102).

**Terminado cuando:** un admin ve sus propios cambios reflejados en la auditoría en segundos, y un
`caregiver` no ve la entrada del menú.

---

## FASE 6 — iPhone, Safari y usabilidad

### 6.1 — `index.html`

**Sustituir la etiqueta viewport** (v1 `index.html:5`):

```html
<!-- ANTES (v1) — iOS lo ignora desde iOS 10, y donde funciona impide ampliar el texto -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">

<!-- AHORA -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

Añadir en `<head>`:

```html
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="CuidApp">
```

### 6.2 — `css/styles.css`

```css
/* RNF-11 — 16px es el umbral exacto bajo el cual iOS hace zoom
   automático al enfocar un campo. Esta regla es lo que de verdad
   evita el zoom molesto; deshabilitarlo en el viewport no funciona. */
input, select, textarea, .form-input, .form-select, .form-textarea {
  font-size: 16px;
}

/* RNF-12 — áreas seguras: notch, Dynamic Island, indicador de inicio */
#app-header  { padding-top:    env(safe-area-inset-top); }
#bottom-nav  { padding-bottom: env(safe-area-inset-bottom); }
.modal, #more-menu { padding-bottom: env(safe-area-inset-bottom); }
body { padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); }

/* RNF-13 — 100vh se rompe con la barra dinámica de Safari */
.full-height {
  height: 100vh;                  /* respaldo antiguo */
  height: -webkit-fill-available; /* Safari iOS */
  height: 100dvh;                 /* moderno, gana si existe */
}

/* RNF-14 — área táctil mínima de Apple HIG */
button, .btn, .nav-btn, .chip, .task-check, .inv-step-btn, .shop-check {
  min-height: 44px;
  min-width:  44px;
}

/* Desplazamiento con inercia en iOS */
.panel, .picker-scroll-container { -webkit-overflow-scrolling: touch; }

/* Safari necesita el prefijo */
.modal, #notif-panel {
  -webkit-backdrop-filter: blur(12px);
          backdrop-filter: blur(12px);
}
```

Revisa además todas las apariciones de `100vh` en `styles.css` y aplica el patrón `.full-height`.

### 6.3 — Usabilidad (RNF-17 .. RNF-21)

| Requisito | Implementación |
|---|---|
| RNF-18 | `Ui.setLoading(btn, true)` deshabilita el botón y muestra un indicador mientras dura la operación |
| RNF-19 | Si una escritura falla, **el modal no se cierra** y los campos conservan su valor. Mostrar el error encima del formulario, con botón "Reintentar" |
| RNF-20 | Función `Api.traducirError(error)` con un diccionario: red caída, sesión expirada, permiso denegado, violación de restricción. Cualquier caso no contemplado: *"No se pudo completar la acción. Vuelve a intentarlo."* Nunca el mensaje crudo de PostgreSQL |
| RNF-21 | `Ui.skeleton(el)` pinta bloques grises antes de que lleguen los datos. Nunca una lista vacía que parezca "no hay nada" |
| RNF-05 (app) | Escuchar `window.addEventListener('offline'/'online')` y mostrar una franja fija: *"Sin conexión. No se pueden guardar cambios."* |

**Terminado cuando:** la app se ve correcta en un iPhone real (o en el simulador de Safari), el
teclado no provoca zoom al enfocar un campo, y nada queda oculto bajo el notch ni el indicador de
inicio.

---

## FASE 7 — Migración de los datos reales

`cuidapp_db.json` contiene datos reales: 4 recetas, 1 complemento, el plan semanal y los 7 roles.

1. Leer `cuidapp_db.json`.
2. Generar `supabase/06_migracion_v1.sql` con los `INSERT` correspondientes:
   - `recipes` + `recipe_ingredients` (4 recetas).
   - `complementos` (agua de coco).
   - `weekly_plan`: el objeto `{"1":{"lunch":[...]}}` se convierte en una fila por
     `(day_index, meal_type, recipe_id)`.
   - **No migrar** `roles` (ya están en `05_seed.sql`) ni `settings` (valores por defecto).
   - **No migrar** `notifications` (la tabla ya no existe).
3. Como los ids de v1 no son UUID, genera nuevos con `gen_random_uuid()` y resuelve las referencias
   del plan semanal con CTEs o mediante el nombre de la receta.
4. Ejecutar una sola vez en el editor SQL.
5. Verificar en la app que las 4 recetas y el plan aparecen correctamente.
6. **Solo entonces**, eliminar `cuidapp_db.json` del repositorio.

**Terminado cuando:** las recetas y el plan semanal de v1 se ven en la app desplegada.

---

## FASE 8 — Verificación manual

Sin pruebas automatizadas. Recorre esta lista sobre el despliegue real, desde un iPhone.

### Seguridad — lo más importante

- [ ] Sin sesión, `index.html` **no** muestra ningún dato del paciente.
- [ ] En una pestaña de incógnito, ejecutar en la consola una consulta a la API con la `anon key`
      y **sin sesión**: debe devolver vacío o error, nunca datos.
- [ ] Un usuario recién registrado (inactivo) ve la pantalla de pendiente y **ninguna** tabla.
- [ ] Un `caregiver` **no** ve la entrada de Auditoría ni la pestaña de Usuarios.
- [ ] Un `caregiver` que intente consultar `audit_log` por consola recibe un resultado vacío.
- [ ] La consulta de "vistas inseguras" de §1.4 devuelve **cero filas**.
- [ ] Con el usuario de prueba **inactivo**, consultar `medications_view` por consola devuelve
      vacío. Si devuelve datos, falta `security_invoker` en alguna vista.
- [ ] Un admin **no puede** desactivarse ni degradarse a sí mismo (RF-11).
- [ ] Crear una persona con el nombre `<img src=x onerror=alert(1)>`: debe mostrarse **como texto
      literal**, sin ejecutar nada (RNF-31).

### Funcionalidad — brechas cerradas

- [ ] **Autenticación:** registrar, activar desde el panel, entrar, cerrar y reabrir el navegador
      sin que pida credenciales de nuevo.
- [ ] **Administración de dosis:** crear un medicamento con stock 10 y un horario de 1 dosis.
      Marcar como administrada → el stock baja a 9 y aparece firmada con tu nombre.
- [ ] Intentar registrar la **misma dosis dos veces**: el sistema lo impide (RF-45).
- [ ] Una dosis con hora pasada y sin registrar aparece como **atrasada**, destacada.
- [ ] **Corregir** una dosis administrada devuelve el stock a 10 y queda en la auditoría.
- [ ] **Inventario:** un ítem con 2 días de historial muestra "Recopilando datos", no un número.
- [ ] Un ítem con más de 7 días muestra una proyección coherente con el consumo real.
- [ ] Restar más stock del existente se impide.
- [ ] **Vitals:** buscar "vitals" y "VitalsModule" en todo el repositorio no devuelve nada.
- [ ] **Auditoría:** cambiar el stock de un ítem y ver el cambio en la auditoría en lenguaje llano,
      con tu nombre.
- [ ] **Tareas recurrentes:** crear una plantilla, recargar la app al día siguiente y comprobar que
      la tarea se generó. Recargar de nuevo: **no** se duplica.

### iPhone / Safari

- [ ] Enfocar cualquier campo de formulario **no** provoca zoom.
- [ ] Se puede ampliar el texto con el gesto de pinza (el zoom está permitido).
- [ ] El encabezado no queda bajo el notch ni la Dynamic Island.
- [ ] La navegación inferior no queda bajo el indicador de inicio.
- [ ] Todos los botones se pulsan cómodamente con el pulgar.
- [ ] "Añadir a pantalla de inicio" produce un ícono y nombre propios.
- [ ] Los selectores de fecha y hora se abren correctamente en Safari.

### Usabilidad

- [ ] Activar el modo avión con un formulario a medio llenar: aparece el aviso de sin conexión y
      **no se pierde lo escrito**.
- [ ] Ningún mensaje de error muestra códigos técnicos ni texto de PostgreSQL.
- [ ] Las pantallas muestran esqueletos de carga, no listas vacías momentáneas.
- [ ] Toda la interfaz está en español, sin restos en inglés.

---

## Apéndice A — Errores frecuentes a evitar

| Error | Consecuencia | Prevención |
|---|---|---|
| Consultar `profiles` dentro de una política RLS de `profiles` sin `SECURITY DEFINER` | **Recursión infinita**, la app se cuelga | Usar siempre `is_active_user()` / `is_admin()` |
| `alter table audit_log force row level security` | El trigger deja de poder escribir; la auditoría se rompe en silencio | No ejecutarlo nunca |
| Descontar stock desde JavaScript en lugar del RPC | El stock se desincroniza con carreras entre dispositivos | Usar siempre `record_administration` |
| Olvidar `escapeHtml()` en una interpolación | XSS almacenado en una app pública | Revisar módulo por módulo al terminar la Fase 4 |
| Poner la `service_role key` en `config.js` | **Acceso total a la base para cualquiera** | Solo la `anon key` en el frontend |
| Dejar `render()` síncrono tras migrar | Se renderiza una promesa, la pantalla queda vacía | `async` + `await` en todo `render()` |
| Cerrar el modal antes de confirmar que la escritura salió bien | Se pierde lo escrito (viola RNF-19) | Cerrar solo tras `error === null` |
| Calcular el promedio de consumo dividiendo entre movimientos | Reintroduce el defecto de v1 | Usar `inventory_items_view` |
| **Crear una vista sin `with (security_invoker = true)`** | **Cualquier usuario autenticado, incluso inactivo, lee las tablas base saltándose el RLS** | Todas las vistas lo llevan. Verificar con la consulta de §1.4 |
| Anidar una vista con `GROUP BY` en un `select()` de PostgREST | La consulta falla: no hay clave foránea que relacionar | Leer de `medications_view` / `inventory_items_view` (§3.4) |
| Escribir sobre una vista en lugar de la tabla base | El `insert`/`update` falla o no audita | Leer de vistas, escribir en tablas |
| `create unique index ... on shifts ((true))` | PostgreSQL rechaza expresiones de índice constantes | Indexar `((ended_at is null))` |

---

## Apéndice B — Orden de `<script>` en `index.html`

El orden importa: no hay módulos ES ni gestor de dependencias.

```html
<script src="js/vendor/supabase.js"></script>
<script src="js/config.js"></script>
<script src="js/auth.js"></script>
<script src="js/api.js"></script>
<script src="js/ui.js"></script>
<script src="js/dashboard.js"></script>
<script src="js/roles.js"></script>
<script src="js/medications.js"></script>
<script src="js/administration.js"></script>
<script src="js/inventory.js"></script>
<script src="js/tasks.js"></script>
<script src="js/agenda.js"></script>
<script src="js/food.js"></script>
<script src="js/expenses.js"></script>
<script src="js/settings.js"></script>
<script src="js/audit.js"></script>
<script src="js/app.js"></script>   <!-- siempre el último: arranca todo -->
```

---

## Apéndice C — Trazabilidad fase ↔ requisito

| Fase | Requisitos que cubre |
|---|---|
| 0 | RNF-02, RNF-48, RNF-49, RNF-51 |
| 1 | RF-100..102, RNF-28..29, RNF-50, RF-43, RF-54..55, RF-64 |
| 2 | RF-01..06, RNF-17 |
| 3 | RF-84..88, RNF-43, RNF-47, RNF-31 |
| 4 | RF-12..38, RF-49..99 |
| 5 | RF-39..48, RF-103..106, RF-07..11 |
| 6 | RNF-08..16, RNF-18..21 |
| 7 | Continuidad de datos de v1 |
| 8 | Verificación de todo lo anterior |
