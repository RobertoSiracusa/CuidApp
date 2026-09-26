-- ═══════════════════════════════════════════════════════════════
-- CuidApp v2 — Control de Insumos (supabase/07_control_insumos.sql)
--
-- Registro de insumos y medicamentos con stock objetivo y nivel de
-- prioridad. Cada nivel fija cada cuánto se revisa el stock:
--   Nivel 1 → cada 24 h · Nivel 2 → cada 48 h · Nivel 3 → cada 72 h
-- La revisión consiste en anotar el stock actual; el consumo del
-- periodo se deduce comparando con la revisión anterior.
--
-- Por ahora SOLO un administrador puede ver y operar este módulo.
-- Ejecutar en el SQL Editor de Supabase después de 01 a 06.
-- Es re-ejecutable.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── Tablas ─────────────────────────────────────────────────────
create table if not exists stock_items (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  category         text not null check (category in (
                     'medicamento','insumo_medico','material_curacion',
                     'higiene','nutricion','otro')),
  target_stock     numeric not null check (target_stock >= 0),
  priority         smallint not null check (priority in (1, 2, 3)),
  -- Último stock contado. NULL = todavía sin revisión.
  -- Solo lo escribe el trigger de stock_checks.
  current_stock    numeric check (current_stock >= 0),
  last_checked_at  timestamptz,
  created_by       uuid references profiles(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);
create unique index if not exists stock_items_name_key on stock_items (lower(trim(name)));

create table if not exists stock_checks (
  id                 uuid primary key default gen_random_uuid(),
  item_id            uuid not null references stock_items(id) on delete cascade,
  quantity           numeric not null check (quantity >= 0),
  previous_quantity  numeric,
  checked_by         uuid references profiles(id) on delete set null,
  checked_at         timestamptz not null default now()
);
create index if not exists stock_checks_item_idx on stock_checks (item_id, checked_at desc);

-- ── Revisión: guarda el stock anterior y actualiza el insumo ───
-- En la misma transacción que el INSERT: o quedan ambos o ninguno.
create or replace function stock_checks_apply() returns trigger
language plpgsql set search_path = public as $$
begin
  new.checked_by := auth.uid();
  new.checked_at := now();

  select current_stock into new.previous_quantity
    from stock_items where id = new.item_id
     for update;

  update stock_items
     set current_stock = new.quantity,
         last_checked_at = new.checked_at
   where id = new.item_id;

  return new;
end; $$;

drop trigger if exists stock_checks_apply on stock_checks;
create trigger stock_checks_apply before insert on stock_checks
  for each row execute function stock_checks_apply();

-- ── Auditoría (reutiliza audit_trigger de 03_audit.sql) ────────
drop trigger if exists audit_stock_items on stock_items;
create trigger audit_stock_items after insert or update or delete on stock_items
  for each row execute function audit_trigger();

drop trigger if exists audit_stock_checks on stock_checks;
create trigger audit_stock_checks after insert or update or delete on stock_checks
  for each row execute function audit_trigger();

-- ── RLS: solo administradores ──────────────────────────────────
alter table stock_items  enable row level security;
alter table stock_checks enable row level security;

drop policy if exists stock_items_admin on stock_items;
create policy stock_items_admin on stock_items
  for all to authenticated
  using (is_admin()) with check (is_admin());

-- Las revisiones son un historial: se leen y se crean, no se editan.
drop policy if exists stock_checks_select on stock_checks;
create policy stock_checks_select on stock_checks
  for select to authenticated using (is_admin());

drop policy if exists stock_checks_insert on stock_checks;
create policy stock_checks_insert on stock_checks
  for insert to authenticated with check (is_admin());

commit;
