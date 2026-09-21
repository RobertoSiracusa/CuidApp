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
