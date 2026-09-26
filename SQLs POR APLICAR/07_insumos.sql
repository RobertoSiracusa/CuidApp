-- ═══════════════════════════════════════════════════════════════
-- CuidApp v2 — Módulo «Gestión Insumos»
-- supabase/07_insumos.sql
--
-- Ejecutar en el Editor SQL de Supabase DESPUÉS de 01 a 06.
-- Se ejecuta completo dentro de una transacción: o se aplica todo o nada.
-- Es re-ejecutable (if not exists / create or replace / drop if exists).
--
-- Principios (se mantienen los de 01–06):
--   · Un solo paciente. Acceso = is_active_user(); administración = is_admin().
--   · Leer de las vistas *_view, escribir en tablas base o por RPC.
--   · Toda vista lleva security_invoker = true.
--   · Toda tabla de negocio nueva entra en la auditoría automática.
--
-- Qué cambia en tablas existentes:
--   · inventory_items     → se amplía como catálogo de insumos (ubicación,
--                            proveedor, unidades, cobertura, retornables, PAO).
--   · medications         → CADA medicamento tiene automáticamente su insumo
--                            enlazado (inventory_items.medication_id). Así un
--                            fármaco nunca tiene dos stocks distintos.
--   · inventory_movements → pasa a ser el LIBRO DE MOVIMIENTOS: la única
--                            fuente de verdad del stock. Solo se inserta;
--                            nunca se edita ni se borra (se «anula»).
--   · current_stock (en inventory_items y en medications enlazados) queda
--     como CACHÉ que mantiene un trigger. Editarlo a mano está bloqueado.
--   · record_administration / undo_administration / record_restock /
--     adjust_inventory mantienen su firma (api.js no cambia la llamada) pero
--     escriben en el libro. Una dosis NUNCA se bloquea por falta de stock
--     contable: si el libro queda en negativo se marca como anomalía.
--
-- Convención de signos en inventory_movements.delta:
--   consume, discard, exchange_out  → negativo
--   receive                         → positivo
--   transfer                        → 2 filas (−n origen, +n destino), mismo group_id
--   emptied                         → 2 filas misma ubicación: full −1 y empty +1
--   adjust                          → corrección con signo (no cuenta como consumo)
--   count                           → usa qty_absolute y delta = null
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Tipos ───────────────────────────────────────────────────
do $$ begin create type supply_location_kind_t as enum ('habitacion','armario','nevera','otro');
exception when duplicate_object then null; end $$;
do $$ begin create type consumption_type_t as enum ('continuo','variable');
exception when duplicate_object then null; end $$;
do $$ begin create type stock_state_t as enum ('full','empty');
exception when duplicate_object then null; end $$;
do $$ begin create type supply_movement_t as enum
  ('count','consume','transfer','receive','emptied','exchange_out','discard','adjust');
exception when duplicate_object then null; end $$;
do $$ begin create type supply_channel_t as enum ('farmacia','gases','supermercado','otro');
exception when duplicate_object then null; end $$;
do $$ begin create type supply_order_status_t as enum ('in_transit','received','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin create type open_container_status_t as enum ('active','finished','discarded');
exception when duplicate_object then null; end $$;

-- ── 2. Ubicaciones y proveedores ───────────────────────────────
create table if not exists supply_locations (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null unique,
  kind                 supply_location_kind_t not null,
  -- Antigüedad máxima de un conteo antes de considerarlo «dato no confiable»
  max_audit_age_hours  int not null default 168 check (max_audit_age_hours > 0),
  is_point_of_care     boolean not null default false,  -- la «Habitación» del relevo
  is_default_storage   boolean not null default false,  -- destino por defecto
  sort_order           int not null default 0,
  created_at           timestamptz not null default now()
);
-- Como máximo UNA ubicación de cada tipo especial (mismo patrón que one_open_shift)
create unique index if not exists one_point_of_care
  on supply_locations ((is_point_of_care)) where is_point_of_care;
create unique index if not exists one_default_storage
  on supply_locations ((is_default_storage)) where is_default_storage;

create table if not exists supply_suppliers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  channel          supply_channel_t not null default 'farmacia',
  whatsapp_phone   text not null default '',
  -- Tiempo real desde que se pide hasta que llega (incluye fines de semana)
  lead_time_hours  int not null default 48 check (lead_time_hours > 0),
  notes            text not null default '',
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ── 3. inventory_items → catálogo de insumos ───────────────────
-- `unit`          = unidad base (tableta, ml, unidad, cilindro)
-- `min_threshold` = mínimo en unidad base (respaldo sin dato de consumo)
alter table inventory_items
  add column if not exists presentation             text not null default '',
  add column if not exists default_location_id      uuid references supply_locations(id) on delete restrict,
  add column if not exists reserve_location_id      uuid references supply_locations(id) on delete set null,
  add column if not exists supplier_id              uuid references supply_suppliers(id) on delete set null,
  add column if not exists medication_id            uuid unique references medications(id) on delete set null,
  add column if not exists consumption_type         consumption_type_t not null default 'continuo',
  add column if not exists purchase_unit            text not null default 'unidad',
  add column if not exists units_per_purchase       numeric not null default 1,
  add column if not exists units_per_dose           numeric not null default 1,
  add column if not exists daily_consumption        numeric,
  add column if not exists treatment_end_date       date,
  add column if not exists safety_days              numeric not null default 3,
  add column if not exists review_period_days       numeric not null default 7,
  add column if not exists lead_time_hours_override int,
  add column if not exists optimal_stock            numeric,
  add column if not exists point_of_care_min        numeric,
  add column if not exists is_returnable            boolean not null default false,
  add column if not exists total_circulating_units  int,
  add column if not exists cylinder_capacity_liters numeric,
  add column if not exists flow_lpm                 numeric,
  add column if not exists hours_per_day            numeric,
  add column if not exists requires_pao             boolean not null default false,
  add column if not exists default_pao_days         int,
  add column if not exists is_critical              boolean not null default false,
  add column if not exists active                   boolean not null default true,
  add column if not exists updated_at               timestamptz not null default now();

alter table inventory_items drop constraint if exists inventory_items_supply_checks;
alter table inventory_items add constraint inventory_items_supply_checks check (
      units_per_purchase > 0
  and units_per_dose > 0
  and (daily_consumption is null or daily_consumption >= 0)
  and safety_days >= 0
  and review_period_days >= 0
  and (lead_time_hours_override is null or lead_time_hours_override > 0)
  and (optimal_stock is null or optimal_stock >= min_threshold)
  and (point_of_care_min is null or point_of_care_min >= 0)
  and (not requires_pao or coalesce(default_pao_days, 0) > 0)
  and (is_returnable or (total_circulating_units is null
                         and cylinder_capacity_liters is null and flow_lpm is null))
  and (total_circulating_units is null or total_circulating_units >= 0)
  and (cylinder_capacity_liters is null or cylinder_capacity_liters > 0)
  and (flow_lpm is null or flow_lpm > 0)
  and (hours_per_day is null or (hours_per_day > 0 and hours_per_day <= 24))
  and (reserve_location_id is null or reserve_location_id is distinct from default_location_id)
);

-- ── 4. Relevos, pedidos, envases abiertos, vencimientos ────────
create table if not exists supply_relays (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references supply_locations(id),
  shift_id          uuid references shifts(id) on delete set null,
  shift_slot        shift_slot_t not null,
  counted_at        timestamptz not null,                 -- cuándo se contó físicamente
  counted_by_name   text not null default '',             -- quien contó (puede no ser usuaria)
  transcribed_by    uuid default auth.uid() references profiles(id) on delete set null,
  omitted_item_ids  uuid[] not null default '{}',         -- «Pendientes por Revisar»
  photo_path        text,                                  -- ruta en Storage, nunca base64
  client_event_id   uuid not null unique,
  created_at        timestamptz not null default now(),   -- cuándo se transcribió
  constraint supply_relays_not_future check (counted_at <= created_at + interval '5 minutes')
);
create index if not exists supply_relays_created_idx on supply_relays (created_at desc);

create table if not exists supply_order_batches (
  id               uuid primary key default gen_random_uuid(),
  supplier_id      uuid references supply_suppliers(id) on delete set null,
  created_by       uuid default auth.uid() references profiles(id) on delete set null,
  exported_at      timestamptz,
  client_event_id  uuid not null unique,
  created_at       timestamptz not null default now()
);

create table if not exists supply_order_lines (
  id                        uuid primary key default gen_random_uuid(),
  batch_id                  uuid not null references supply_order_batches(id) on delete cascade,
  item_id                   uuid not null references inventory_items(id) on delete cascade,
  destination_location_id   uuid not null references supply_locations(id),
  qty_purchase_units        numeric not null check (qty_purchase_units > 0),
  qty_base                  numeric not null check (qty_base > 0),
  empties_to_exchange       int not null default 0 check (empties_to_exchange >= 0),
  status                    supply_order_status_t not null default 'in_transit',
  handled_by                uuid default auth.uid() references profiles(id) on delete set null,
  handled_by_name           text not null default '',
  ordered_at                timestamptz not null default now(),
  expected_by               timestamptz not null,
  received_qty_base         numeric check (received_qty_base >= 0),  -- < qty_base = parcial
  received_at               timestamptz,
  receive_client_event_id   uuid unique,
  cost                      numeric not null default 0 check (cost >= 0),
  cancelled_at              timestamptz,
  cancel_reason             text not null default '',
  created_at                timestamptz not null default now(),
  constraint supply_order_lines_received_ck
    check (status <> 'received' or (received_at is not null and received_qty_base is not null)),
  constraint supply_order_lines_cancelled_ck
    check (status <> 'cancelled' or cancelled_at is not null)
);
-- Antiduplicidad real: un solo pedido abierto por insumo.
create unique index if not exists one_open_order_per_item
  on supply_order_lines (item_id) where status = 'in_transit';

create table if not exists supply_open_containers (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references inventory_items(id) on delete cascade,
  location_id      uuid not null references supply_locations(id),
  label_tag        text not null default '',
  opened_at        timestamptz not null,
  pao_days         int not null check (pao_days > 0),
  expires_at       timestamptz not null,       -- lo calcula el cliente: opened_at + pao_days
  status           open_container_status_t not null default 'active',
  closed_at        timestamptz,
  opened_by        uuid default auth.uid() references profiles(id) on delete set null,
  client_event_id  uuid not null unique,
  created_at       timestamptz not null default now(),
  constraint supply_open_containers_dates_ck check (expires_at > opened_at),
  constraint supply_open_containers_closed_ck check (status = 'active' or closed_at is not null)
);

-- Vencimientos de envases CERRADOS. Informativo: alimenta alertas, no altera stock.
create table if not exists supply_expiry_records (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references inventory_items(id) on delete cascade,
  location_id  uuid not null references supply_locations(id),
  expiry_date  date not null,
  qty_base     numeric not null check (qty_base > 0),
  status       text not null default 'active' check (status in ('active','used','discarded')),
  created_at   timestamptz not null default now()
);

-- ── 5. inventory_movements → libro de movimientos ──────────────
alter table inventory_movements alter column delta drop not null;
alter table inventory_movements
  add column if not exists location_id        uuid references supply_locations(id),
  add column if not exists stock_state        stock_state_t not null default 'full',
  add column if not exists movement_type      supply_movement_t not null default 'adjust',
  add column if not exists qty_absolute       numeric,
  add column if not exists occurred_at        timestamptz not null default now(),
  add column if not exists relay_id           uuid,
  add column if not exists order_line_id      uuid,
  add column if not exists administration_id  uuid,
  add column if not exists group_id           uuid,
  add column if not exists client_event_id    uuid not null default gen_random_uuid(),
  add column if not exists voided_at          timestamptz,
  add column if not exists voided_by          uuid references profiles(id) on delete set null;

alter table inventory_movements drop constraint if exists inventory_movements_relay_fk;
alter table inventory_movements add constraint inventory_movements_relay_fk
  foreign key (relay_id) references supply_relays(id) on delete set null;
alter table inventory_movements drop constraint if exists inventory_movements_order_line_fk;
alter table inventory_movements add constraint inventory_movements_order_line_fk
  foreign key (order_line_id) references supply_order_lines(id) on delete set null;
alter table inventory_movements drop constraint if exists inventory_movements_admin_fk;
alter table inventory_movements add constraint inventory_movements_admin_fk
  foreign key (administration_id) references medication_administrations(id) on delete set null;

create unique index if not exists inventory_movements_client_event_uq
  on inventory_movements (client_event_id);
create index if not exists inventory_movements_stock_idx
  on inventory_movements (item_id, location_id, stock_state, occurred_at desc)
  where voided_at is null;

alter table inventory_movements drop constraint if exists inventory_movements_ledger_ck;
alter table inventory_movements add constraint inventory_movements_ledger_ck check (
      location_id is not null
  and (   (movement_type = 'count'  and qty_absolute is not null and qty_absolute >= 0 and delta is null)
       or (movement_type <> 'count' and delta is not null and qty_absolute is null))
  and (movement_type not in ('consume','discard','exchange_out') or delta < 0)
  and (movement_type <> 'receive' or delta > 0)
  and (movement_type not in ('transfer','emptied','adjust') or delta <> 0)
  and (movement_type <> 'exchange_out' or stock_state = 'empty')
  and occurred_at <= created_at + interval '5 minutes'
);

-- ── 6. Vistas ──────────────────────────────────────────────────
-- Stock por ubicación derivado del libro.
-- Regla: último conteo no anulado (occurred_at, desempate created_at)
--        + deltas con occurred_at ESTRICTAMENTE posterior.
-- Es la misma regla que js/inventory-calc.js → deriveStock().
create or replace view inventory_stock_view
with (security_invoker = true) as
with active as (
  select * from inventory_movements where voided_at is null
),
keys as (
  select distinct item_id, location_id, stock_state from active
),
last_count as (
  select distinct on (item_id, location_id, stock_state)
         item_id, location_id, stock_state, qty_absolute, occurred_at
    from active
   where movement_type = 'count'
   order by item_id, location_id, stock_state, occurred_at desc, created_at desc
)
select k.item_id,
       k.location_id,
       k.stock_state,
       coalesce(lc.qty_absolute, 0) + coalesce(d.delta, 0)               as raw_quantity,
       greatest(0, coalesce(lc.qty_absolute, 0) + coalesce(d.delta, 0)) as quantity,
       lc.occurred_at                                                    as last_counted_at
  from keys k
  left join last_count lc
         on lc.item_id = k.item_id and lc.location_id = k.location_id
        and lc.stock_state = k.stock_state
  left join lateral (
    select sum(m.delta) as delta
      from active m
     where m.item_id = k.item_id
       and m.location_id = k.location_id
       and m.stock_state = k.stock_state
       and m.movement_type <> 'count'
       and (lc.occurred_at is null or m.occurred_at > lc.occurred_at)
  ) d on true;

create or replace view supply_in_transit_view
with (security_invoker = true) as
select item_id,
       sum(qty_base)                      as in_transit_base,
       min(expected_by)                   as next_expected_by,
       string_agg(handled_by_name, ', ')  as handled_by_names
  from supply_order_lines
 where status = 'in_transit'
 group by item_id;

-- Las dos vistas existentes se recrean (cambian sus columnas).
drop view if exists inventory_items_view;
drop view if exists inventory_consumption_stats;

-- Igual que en 02, pero solo cuenta consumo REAL (consume / emptied),
-- no traslados, descartes ni correcciones, y excluye anulados.
create view inventory_consumption_stats
with (security_invoker = true) as
with consumo as (
  select item_id,
         sum(abs(delta))  as total_consumed,
         min(occurred_on) as first_day
    from inventory_movements
   where voided_at is null
     and stock_state = 'full'
     and movement_type in ('consume','emptied')
     and delta < 0
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
         else floor(i.current_stock /
                    (c.total_consumed / (current_date - c.first_day + 1)::numeric))
       end as days_remaining
  from inventory_items i
  left join consumo c on c.item_id = i.id;

-- Conserva TODAS las columnas que ya lee api.js (getInventory) y añade las nuevas.
create view inventory_items_view
with (security_invoker = true) as
select i.*,
       c.name                    as category_name,
       s.avg_daily_consumption,
       s.days_remaining,
       (i.min_threshold > 0 and i.current_stock <= i.min_threshold) as is_low,
       dl.name                   as default_location_name,
       rl.name                   as reserve_location_name,
       sp.name                   as supplier_name,
       sp.channel                as supplier_channel,
       sp.lead_time_hours        as supplier_lead_time_hours,
       sp.whatsapp_phone         as supplier_whatsapp,
       m.status                  as medication_status,
       md.daily_amount           as pauta_daily_amount,
       coalesce(e.empty_quantity, 0) as empty_quantity,
       coalesce(t.in_transit_base, 0) as in_transit_base,
       t.next_expected_by
  from inventory_items i
  left join inventory_categories        c  on c.id  = i.category_id
  left join inventory_consumption_stats s  on s.item_id = i.id
  left join supply_locations            dl on dl.id = i.default_location_id
  left join supply_locations            rl on rl.id = i.reserve_location_id
  left join supply_suppliers            sp on sp.id = i.supplier_id
  left join medications                 m  on m.id  = i.medication_id
  left join medication_daily_dose       md on md.medication_id = i.medication_id
  left join lateral (
    select sum(quantity) as empty_quantity
      from inventory_stock_view v
     where v.item_id = i.id and v.stock_state = 'empty'
  ) e on true
  left join supply_in_transit_view      t  on t.item_id = i.id;

-- ── 7. Caché de stock y guardas ────────────────────────────────
-- Recalcula current_stock (llenos, todas las ubicaciones) desde el libro y lo
-- copia al medicamento enlazado. Es el ÚNICO camino que puede escribir
-- current_stock en insumos y en medicamentos enlazados.
create or replace function refresh_supply_stock_cache(p_item_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_med   uuid;
begin
  select coalesce(sum(quantity), 0) into v_total
    from inventory_stock_view
   where item_id = p_item_id and stock_state = 'full';

  select medication_id into v_med from inventory_items where id = p_item_id;

  perform set_config('cuidapp.stock_sync', 'on', true);
  update inventory_items set current_stock = v_total
   where id = p_item_id and current_stock is distinct from v_total;
  if v_med is not null then
    update medications set current_stock = v_total
     where id = v_med and current_stock is distinct from v_total;
  end if;
  perform set_config('cuidapp.stock_sync', 'off', true);
  return v_total;
end; $$;

create or replace function guard_supply_stock_cache() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.current_stock is distinct from old.current_stock
     and coalesce(current_setting('cuidapp.stock_sync', true), 'off') <> 'on' then
    -- Medicamento sin insumo enlazado: comportamiento de siempre
    if TG_TABLE_NAME = 'medications'
       and not exists (select 1 from inventory_items where medication_id = new.id) then
      return new;
    end if;
    raise exception 'STOCK_LEDGER: el stock se gestiona con conteos y movimientos; usa «Registrar conteo» en Gestión Insumos'
      using errcode = 'P0001';
  end if;
  return new;
end; $$;

drop trigger if exists guard_stock_cache on inventory_items;
create trigger guard_stock_cache before update on inventory_items
  for each row execute function guard_supply_stock_cache();
drop trigger if exists guard_stock_cache on medications;
create trigger guard_stock_cache before update on medications
  for each row execute function guard_supply_stock_cache();

-- Prepara cada insumo: ubicación por defecto, unidad del medicamento enlazado.
create or replace function prepare_inventory_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.default_location_id is null then
    select id into new.default_location_id
      from supply_locations where is_default_storage limit 1;
  end if;
  if new.medication_id is not null
     and (TG_OP = 'INSERT' or new.medication_id is distinct from old.medication_id) then
    -- La unidad base del insumo es la unidad del medicamento: las dosis
    -- se descuentan 1:1 sin conversión.
    select unit into new.unit from medications where id = new.medication_id;
  end if;
  if TG_OP = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end; $$;

drop trigger if exists prepare_item on inventory_items;
create trigger prepare_item before insert or update on inventory_items
  for each row execute function prepare_inventory_item();

-- Stock inicial: al crear un insumo con current_stock > 0, o al enlazar un
-- medicamento que ya tenía stock, se registra como CONTEO inicial.
create or replace function seed_supply_initial_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_qty numeric := 0;
begin
  if TG_OP = 'UPDATE' and new.medication_id is not distinct from old.medication_id then
    return null;
  end if;

  if exists (select 1 from inventory_movements where item_id = new.id and voided_at is null) then
    -- El insumo ya tiene historial: el libro manda sobre el medicamento
    perform refresh_supply_stock_cache(new.id);
    return null;
  end if;

  if new.medication_id is not null then
    select coalesce(current_stock, 0) into v_qty from medications where id = new.medication_id;
  end if;
  if TG_OP = 'INSERT' and new.current_stock > 0 then
    v_qty := new.current_stock;
  end if;

  if v_qty > 0 and new.default_location_id is not null then
    insert into inventory_movements
      (item_id, location_id, movement_type, qty_absolute, occurred_at, note, profile_id)
    values
      (new.id, new.default_location_id, 'count', v_qty, now(), 'Stock inicial', auth.uid());
  else
    perform refresh_supply_stock_cache(new.id);
  end if;
  return null;
end; $$;

drop trigger if exists seed_initial_count on inventory_items;
create trigger seed_initial_count after insert or update of medication_id on inventory_items
  for each row execute function seed_supply_initial_count();

-- Enlace automático medicamento ↔ insumo.
-- Al crear un medicamento se crea su insumo en la Habitación (punto de uso),
-- con reserva en el almacén por defecto. Su stock inicial pasa a ser un conteo.
create or replace function link_medication_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if not exists (select 1 from inventory_items where medication_id = new.id) then
      insert into inventory_items (name, unit, category_id, medication_id,
                                   default_location_id, reserve_location_id,
                                   consumption_type, current_stock)
      values (new.name, new.unit,
              (select id from inventory_categories where name = 'Medicamentos'),
              new.id,
              (select id from supply_locations where is_point_of_care limit 1),
              (select id from supply_locations where is_default_storage limit 1),
              'continuo', 0);
    end if;
    return null;
  end if;

  -- UPDATE: mantener nombre y unidad sincronizados
  if new.unit is distinct from old.unit
     and exists (select 1 from inventory_movements m
                   join inventory_items i on i.id = m.item_id
                  where i.medication_id = new.id and m.voided_at is null) then
    raise exception 'No se puede cambiar la unidad de un medicamento con movimientos registrados; crea uno nuevo'
      using errcode = 'P0001';
  end if;
  if new.name is distinct from old.name or new.unit is distinct from old.unit then
    update inventory_items set name = new.name, unit = new.unit where medication_id = new.id;
  end if;
  return null;
end; $$;

drop trigger if exists link_item on medications;
create trigger link_item after insert or update of name, unit on medications
  for each row execute function link_medication_item();

-- Al borrar un medicamento, su insumo queda inactivo (conserva el historial).
create or replace function unlink_medication_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update inventory_items set active = false where medication_id = old.id;
  return old;
end; $$;

drop trigger if exists unlink_item on medications;
create trigger unlink_item before delete on medications
  for each row execute function unlink_medication_item();

-- Completa cada movimiento antes de insertarlo.
create or replace function prepare_inventory_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.location_id is null then
    select coalesce(i.default_location_id,
                    (select id from supply_locations where is_default_storage limit 1))
      into new.location_id
      from inventory_items i where i.id = new.item_id;
  end if;
  new.occurred_on := new.occurred_at::date;
  new.profile_id  := coalesce(new.profile_id, auth.uid());
  return new;
end; $$;

drop trigger if exists prepare_movement on inventory_movements;
create trigger prepare_movement before insert on inventory_movements
  for each row execute function prepare_inventory_movement();

create or replace function sync_supply_stock_cache() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform refresh_supply_stock_cache(coalesce(new.item_id, old.item_id));
  return null;
end; $$;

drop trigger if exists sync_stock_cache on inventory_movements;
create trigger sync_stock_cache after insert or update or delete on inventory_movements
  for each row execute function sync_supply_stock_cache();

-- ── 8. RPC existentes adaptadas ────────────────────────────────
-- Misma firma que en 02: api.js no cambia.
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
declare
  v_id   uuid;
  v_item uuid;
  v_loc  uuid;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;

  insert into medication_administrations (
    medication_id, schedule_id, scheduled_date, scheduled_time,
    administered_by, status, dose, notes
  ) values (
    p_medication_id, p_schedule_id, p_scheduled_date, p_scheduled_time,
    auth.uid(), p_status, coalesce(p_dose, 0), coalesce(p_notes, '')
  ) returning id into v_id;

  if p_status = 'given' and coalesce(p_dose, 0) > 0 then
    select id, default_location_id into v_item, v_loc
      from inventory_items where medication_id = p_medication_id;

    if v_item is not null then
      -- Medicamento enlazado: la dosis es un movimiento de consumo en el punto de uso
      insert into inventory_movements
        (item_id, location_id, movement_type, delta, occurred_at, administration_id, note, profile_id)
      values
        (v_item, v_loc, 'consume', -p_dose, now(), v_id, 'Dosis administrada', auth.uid());
    else
      update medications
         set current_stock = greatest(0, current_stock - p_dose)
       where id = p_medication_id;
    end if;
  end if;

  return v_id;
end; $$;

-- Pasa a SECURITY DEFINER porque debe anular un movimiento del libro
-- (el libro no admite UPDATE desde el cliente). Conserva su validación.
create or replace function undo_administration(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_linked boolean;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  select * into r from medication_administrations where id = p_id;
  if not found then raise exception 'Registro no encontrado'; end if;

  update inventory_movements
     set voided_at = now(), voided_by = auth.uid()
   where administration_id = p_id and voided_at is null;
  get diagnostics v_linked = row_count;

  if not v_linked and r.status = 'given'
     and not exists (select 1 from inventory_items where medication_id = r.medication_id) then
    update medications set current_stock = current_stock + r.dose where id = r.medication_id;
  end if;

  delete from medication_administrations where id = p_id;
end; $$;

-- Movimiento de entrada común a reposiciones y recepciones de pedidos.
-- Si el insumo está enlazado a un medicamento, también deja el registro en
-- medication_restocks (historial del módulo Medicamentos) y el gasto.
create or replace function post_supply_receipt(
  p_item_id          uuid,
  p_location_id      uuid,
  p_qty_base         numeric,
  p_occurred_at      timestamptz,
  p_client_event_id  uuid,
  p_order_line_id    uuid,
  p_establishment    text,
  p_cost             numeric
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_item      inventory_items%rowtype;
  v_restock   uuid;
  v_category  text;
begin
  select * into v_item from inventory_items where id = p_item_id;
  if not found then raise exception 'Insumo no encontrado'; end if;

  insert into inventory_movements
    (item_id, location_id, movement_type, delta, occurred_at, order_line_id,
     client_event_id, note, profile_id)
  values
    (p_item_id, coalesce(p_location_id, v_item.reserve_location_id, v_item.default_location_id),
     'receive', p_qty_base, p_occurred_at, p_order_line_id,
     p_client_event_id, 'Recepción', auth.uid());

  if v_item.medication_id is not null then
    insert into medication_restocks (medication_id, quantity, establishment, cost, managed_by)
    values (v_item.medication_id, p_qty_base, coalesce(p_establishment, ''),
            coalesce(p_cost, 0), auth.uid())
    returning id into v_restock;
    update medications set needs_restock = false where id = v_item.medication_id;
  end if;

  if coalesce(p_cost, 0) > 0 then
    select coalesce(c.name, 'Otros') into v_category
      from inventory_items i left join inventory_categories c on c.id = i.category_id
     where i.id = p_item_id;
    insert into expenses (amount, category, description, linked_restock_id, managed_by)
    values (p_cost, v_category, 'Compra: ' || v_item.name, v_restock, auth.uid());
  end if;

  return v_restock;
end; $$;
revoke execute on function post_supply_receipt(uuid, uuid, numeric, timestamptz, uuid, uuid, text, numeric)
  from public, anon, authenticated;

-- Misma firma que en 02. Para medicamentos enlazados, la entrada va al libro.
create or replace function record_restock(
  p_medication_id uuid,
  p_quantity      numeric,
  p_establishment text default '',
  p_cost          numeric default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_item uuid;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'La cantidad debe ser mayor que cero'; end if;

  select name into v_name from medications where id = p_medication_id;
  if not found then raise exception 'Medicamento no encontrado'; end if;

  select id into v_item from inventory_items where medication_id = p_medication_id;
  if v_item is not null then
    return post_supply_receipt(v_item, null, p_quantity, now(), gen_random_uuid(),
                               null, p_establishment, p_cost);
  end if;

  -- Sin insumo enlazado: comportamiento original de 02
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

-- adjust_inventory: se añade p_location_id (opcional). Se elimina la versión
-- de 3 parámetros para que PostgREST no encuentre dos candidatas.
-- La llamada actual de api.js (p_item_id, p_delta, p_note) sigue funcionando.
drop function if exists adjust_inventory(uuid, numeric, text);
create or replace function adjust_inventory(
  p_item_id     uuid,
  p_delta       numeric,
  p_note        text default '',
  p_location_id uuid default null
) returns numeric
language plpgsql security invoker set search_path = public as $$
declare
  v_loc   uuid;
  v_here  numeric;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  if coalesce(p_delta, 0) = 0 then raise exception 'El ajuste no puede ser cero'; end if;

  select coalesce(p_location_id, default_location_id) into v_loc
    from inventory_items where id = p_item_id;
  if not found then raise exception 'Ítem no encontrado'; end if;

  if p_delta < 0 then
    select coalesce(sum(quantity), 0) into v_here
      from inventory_stock_view
     where item_id = p_item_id and location_id = v_loc and stock_state = 'full';
    if v_here + p_delta < 0 then
      raise exception 'El stock resultante no puede ser menor que cero (hay % en esa ubicación)', v_here;
    end if;
  end if;

  insert into inventory_movements (item_id, location_id, movement_type, delta, occurred_at, note, profile_id)
  values (p_item_id, v_loc,
          case when p_delta < 0 then 'consume' else 'receive' end::supply_movement_t,
          p_delta, now(), coalesce(p_note, ''), auth.uid());

  return (select current_stock from inventory_items where id = p_item_id);
end; $$;

-- ── 9. RPC nuevas del módulo ───────────────────────────────────
-- Inserta uno o varios movimientos de forma atómica e idempotente.
-- p_rows: [{item_id, location_id, stock_state, movement_type, qty_absolute,
--           delta, occurred_at, group_id, client_event_id, note}]
create or replace function record_supply_movements(p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row        jsonb;
  v_n          int;
  v_inserted   int := 0;
  v_duplicate  int := 0;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if v_row->>'movement_type' = 'receive' then
      raise exception 'Las recepciones se registran con receive_supply_order_line o record_restock';
    end if;

    insert into inventory_movements (
      item_id, location_id, stock_state, movement_type, qty_absolute, delta,
      occurred_at, relay_id, group_id, client_event_id, note, profile_id
    ) values (
      (v_row->>'item_id')::uuid,
      (v_row->>'location_id')::uuid,
      coalesce(v_row->>'stock_state', 'full')::stock_state_t,
      (v_row->>'movement_type')::supply_movement_t,
      (v_row->>'qty_absolute')::numeric,
      (v_row->>'delta')::numeric,
      coalesce((v_row->>'occurred_at')::timestamptz, now()),
      (v_row->>'relay_id')::uuid,
      (v_row->>'group_id')::uuid,
      (v_row->>'client_event_id')::uuid,
      coalesce(v_row->>'note', ''),
      auth.uid()
    )
    on conflict (client_event_id) do nothing;

    get diagnostics v_n = row_count;
    if v_n = 1 then v_inserted := v_inserted + 1; else v_duplicate := v_duplicate + 1; end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicate);
end; $$;

-- Guarda el relevo completo (cabecera + conteos) de forma atómica.
-- Si no se indica turno, se vincula al turno abierto (tabla shifts).
create or replace function save_supply_relay(p_relay jsonb, p_counts jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_relay_id  uuid;
  v_counts    jsonb;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;

  select id into v_relay_id from supply_relays
   where client_event_id = (p_relay->>'client_event_id')::uuid;
  if v_relay_id is not null then
    return jsonb_build_object('relay_id', v_relay_id, 'duplicate', true);
  end if;

  insert into supply_relays (
    location_id, shift_id, shift_slot, counted_at, counted_by_name,
    omitted_item_ids, photo_path, client_event_id
  ) values (
    coalesce((p_relay->>'location_id')::uuid,
             (select id from supply_locations where is_point_of_care limit 1)),
    coalesce((p_relay->>'shift_id')::uuid,
             (select id from shifts where ended_at is null limit 1)),
    coalesce(p_relay->>'shift_slot', 'any')::shift_slot_t,
    (p_relay->>'counted_at')::timestamptz,
    coalesce(p_relay->>'counted_by_name', ''),
    coalesce(array(select jsonb_array_elements_text(p_relay->'omitted_item_ids'))::uuid[], '{}'),
    p_relay->>'photo_path',
    (p_relay->>'client_event_id')::uuid
  ) returning id into v_relay_id;

  -- Todos los conteos heredan relay_id y el counted_at del relevo
  select coalesce(jsonb_agg(
           c || jsonb_build_object('relay_id', v_relay_id,
                                   'movement_type', 'count',
                                   'occurred_at', p_relay->>'counted_at')), '[]'::jsonb)
    into v_counts
    from jsonb_array_elements(p_counts) c;

  perform record_supply_movements(v_counts);

  return jsonb_build_object('relay_id', v_relay_id, 'duplicate', false,
                            'counts', jsonb_array_length(v_counts));
end; $$;

-- Paso 3 del Kanban: marcar «En camino». Atómica e idempotente.
-- p_lines: [{item_id, destination_location_id, qty_purchase_units, qty_base,
--            empties_to_exchange}]
create or replace function mark_supply_in_transit(
  p_supplier_id      uuid,
  p_lines            jsonb,
  p_client_event_id  uuid,
  p_expected_by      timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_batch_id   uuid;
  v_line       jsonb;
  v_line_id    uuid;
  v_name       text;
  v_expected   timestamptz;
  v_claimed    jsonb := '[]'::jsonb;
  v_conflicts  jsonb := '[]'::jsonb;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;

  select id into v_batch_id from supply_order_batches where client_event_id = p_client_event_id;
  if v_batch_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'line_id', id)), '[]'::jsonb)
      into v_claimed from supply_order_lines where batch_id = v_batch_id;
    return jsonb_build_object('batch_id', v_batch_id, 'claimed', v_claimed,
                              'conflicts', '[]'::jsonb, 'duplicate', true);
  end if;

  select coalesce(nullif(full_name, ''), 'Sin nombre') into v_name
    from profiles where id = auth.uid();
  v_expected := coalesce(
    p_expected_by,
    now() + make_interval(hours => coalesce(
      (select lead_time_hours from supply_suppliers where id = p_supplier_id), 48)));

  insert into supply_order_batches (supplier_id, client_event_id)
  values (p_supplier_id, p_client_event_id)
  returning id into v_batch_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_id := null;

    insert into supply_order_lines (
      batch_id, item_id, destination_location_id, qty_purchase_units, qty_base,
      empties_to_exchange, handled_by_name, expected_by
    )
    select v_batch_id,
           i.id,
           coalesce((v_line->>'destination_location_id')::uuid,
                    i.reserve_location_id, i.default_location_id),
           (v_line->>'qty_purchase_units')::numeric,
           (v_line->>'qty_base')::numeric,
           coalesce((v_line->>'empties_to_exchange')::int, 0),
           coalesce(v_name, 'Sin nombre'),
           v_expected
      from inventory_items i
     where i.id = (v_line->>'item_id')::uuid
    on conflict (item_id) where status = 'in_transit' do nothing
    returning id into v_line_id;

    if v_line_id is null then
      v_conflicts := v_conflicts || jsonb_build_object(
        'item_id', v_line->>'item_id',
        'handled_by_name', (select handled_by_name from supply_order_lines
                             where item_id = (v_line->>'item_id')::uuid
                               and status = 'in_transit'));
    else
      v_claimed := v_claimed || jsonb_build_object('item_id', v_line->>'item_id', 'line_id', v_line_id);
    end if;
  end loop;

  if jsonb_array_length(v_claimed) = 0 then
    delete from supply_order_batches where id = v_batch_id;
    v_batch_id := null;
  end if;

  return jsonb_build_object('batch_id', v_batch_id, 'claimed', v_claimed,
                            'conflicts', v_conflicts, 'duplicate', false);
end; $$;

-- Recepción total o parcial, con canje de vacíos y gasto opcional.
create or replace function receive_supply_order_line(
  p_line_id            uuid,
  p_received_qty_base  numeric,
  p_client_event_id    uuid,
  p_location_id        uuid default null,
  p_empties_sent       int default null,
  p_cost               numeric default 0,
  p_received_at        timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_line      supply_order_lines%rowtype;
  v_location  uuid;
  v_empties   int;
  v_supplier  text;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;

  select * into v_line from supply_order_lines where id = p_line_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if v_line.receive_client_event_id = p_client_event_id then
    return jsonb_build_object('line_id', p_line_id, 'duplicate', true);
  end if;
  if v_line.status <> 'in_transit' then
    raise exception 'Este pedido ya fue % y no se puede recibir otra vez', v_line.status;
  end if;
  if coalesce(p_received_qty_base, -1) < 0 or coalesce(p_cost, 0) < 0 then
    raise exception 'Cantidad o costo inválidos';
  end if;

  v_location := coalesce(p_location_id, v_line.destination_location_id);
  v_empties  := coalesce(p_empties_sent, v_line.empties_to_exchange);
  select s.name into v_supplier
    from supply_order_batches b left join supply_suppliers s on s.id = b.supplier_id
   where b.id = v_line.batch_id;

  if p_received_qty_base > 0 then
    perform post_supply_receipt(v_line.item_id, v_location, p_received_qty_base, p_received_at,
                                p_client_event_id, p_line_id, v_supplier, p_cost);
  end if;

  if v_empties > 0 then
    insert into inventory_movements
      (item_id, location_id, stock_state, movement_type, delta, occurred_at,
       order_line_id, group_id, note, profile_id)
    values
      (v_line.item_id, v_location, 'empty', 'exchange_out', -v_empties, p_received_at,
       p_line_id, p_client_event_id, 'Vacíos entregados en canje', auth.uid());
  end if;

  update supply_order_lines
     set status = 'received',
         received_qty_base = p_received_qty_base,
         received_at = p_received_at,
         receive_client_event_id = p_client_event_id,
         cost = coalesce(p_cost, 0)
   where id = p_line_id;

  return jsonb_build_object('line_id', p_line_id, 'duplicate', false,
                            'partial', p_received_qty_base < v_line.qty_base);
end; $$;

-- Liberar un pedido: evita que quede bloqueado «En camino» para siempre.
create or replace function cancel_supply_order_line(p_line_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  update supply_order_lines
     set status = 'cancelled', cancelled_at = now(), cancel_reason = coalesce(p_reason, '')
   where id = p_line_id and status = 'in_transit';
  if not found then raise exception 'El pedido no existe o ya no está en camino'; end if;
end; $$;

-- «Deshacer»: anula el movimiento y todo su grupo (p. ej. las 2 filas de un vaciado).
create or replace function void_supply_movement(p_movement_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_m     inventory_movements%rowtype;
  v_count int;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  select * into v_m from inventory_movements where id = p_movement_id;
  if not found then raise exception 'Movimiento no encontrado'; end if;
  if v_m.order_line_id is not null then
    raise exception 'Una recepción no se anula: registra un conteo para corregirla';
  end if;
  if v_m.administration_id is not null then
    raise exception 'Este consumo viene de una dosis: corrígelo desde Administración de dosis';
  end if;

  update inventory_movements
     set voided_at = now(), voided_by = auth.uid()
   where voided_at is null
     and (id = p_movement_id or (v_m.group_id is not null and group_id = v_m.group_id));
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- ── 10. Row Level Security ─────────────────────────────────────
do $$
declare t text;
begin
  -- Catálogos y operación: cualquier usuario ACTIVO (patrón de 04_rls.sql)
  foreach t in array array[
    'supply_locations','supply_suppliers','supply_order_batches',
    'supply_open_containers','supply_expiry_records'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %1$s_all on public.%1$I;', t);
    execute format(
      'create policy %1$s_all on public.%1$I
         for all to authenticated
         using (is_active_user()) with check (is_active_user());', t);
  end loop;

  -- Registros inmutables: solo leer e insertar.
  -- Anular, recibir y cancelar se hace por RPC (SECURITY DEFINER).
  foreach t in array array['inventory_movements','supply_relays','supply_order_lines'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %1$s_all on public.%1$I;', t);
    execute format('drop policy if exists %1$s_select on public.%1$I;', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I;', t);
    execute format(
      'create policy %1$s_select on public.%1$I
         for select to authenticated using (is_active_user());', t);
    execute format(
      'create policy %1$s_insert on public.%1$I
         for insert to authenticated with check (is_active_user());', t);
  end loop;
end $$;

-- ── 11. Auditoría automática (mismo trigger de 03_audit.sql) ───
do $$
declare t text;
begin
  foreach t in array array[
    'supply_locations','supply_suppliers','supply_relays',
    'supply_order_batches','supply_order_lines',
    'supply_open_containers','supply_expiry_records'
  ] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I;', t);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function audit_trigger();', t);
  end loop;
end $$;

-- ── 12. Storage: fotos de la libreta (bucket privado) ──────────
-- Ruta: {relay_client_event_id}.jpg — nunca base64 en tablas ni en localStorage.
insert into storage.buckets (id, name, public)
values ('supply-relay-photos', 'supply-relay-photos', false)
on conflict (id) do nothing;

drop policy if exists supply_relay_photos_read on storage.objects;
create policy supply_relay_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'supply-relay-photos' and is_active_user());
drop policy if exists supply_relay_photos_insert on storage.objects;
create policy supply_relay_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'supply-relay-photos' and is_active_user());

-- ── 13. Permisos ───────────────────────────────────────────────
grant select on inventory_stock_view         to authenticated;
grant select on supply_in_transit_view       to authenticated;
grant select on inventory_consumption_stats  to authenticated;
grant select on inventory_items_view         to authenticated;

grant execute on function record_supply_movements(jsonb)                       to authenticated;
grant execute on function save_supply_relay(jsonb, jsonb)                      to authenticated;
grant execute on function mark_supply_in_transit(uuid, jsonb, uuid, timestamptz) to authenticated;
grant execute on function receive_supply_order_line(uuid, numeric, uuid, uuid, int, numeric, timestamptz) to authenticated;
grant execute on function cancel_supply_order_line(uuid, text)                  to authenticated;
grant execute on function void_supply_movement(uuid)                           to authenticated;
grant execute on function adjust_inventory(uuid, numeric, text, uuid)          to authenticated;

-- Funciones internas: no invocables desde la API
-- (Supabase concede EXECUTE a anon y authenticated por defecto: hay que retirarlo explícitamente)
revoke execute on function refresh_supply_stock_cache(uuid) from public, anon, authenticated;

-- ── 14. Datos iniciales ────────────────────────────────────────
insert into supply_locations (name, kind, max_audit_age_hours, is_point_of_care, is_default_storage, sort_order)
values ('Habitación',      'habitacion', 24,  true,  false, 1),
       ('Armario Central', 'armario',    168, false, true,  2),
       ('Nevera',          'nevera',     168, false, false, 3)
on conflict (name) do nothing;

insert into inventory_categories (name) values ('Gases y Oxígeno')
on conflict (name) do nothing;

-- Medicamentos ya existentes sin insumo enlazado (idempotente)
insert into inventory_items (name, unit, category_id, medication_id,
                             default_location_id, reserve_location_id, consumption_type, current_stock)
select m.name, m.unit,
       (select id from inventory_categories where name = 'Medicamentos'),
       m.id,
       (select id from supply_locations where is_point_of_care limit 1),
       (select id from supply_locations where is_default_storage limit 1),
       'continuo', 0
  from medications m
 where not exists (select 1 from inventory_items i where i.medication_id = m.id);

commit;

-- ── Comprobación (igual que en 04): debe devolver CERO filas ───
select c.relname as vista_insegura
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v'
   and n.nspname = 'public'
   and coalesce(
         (select option_value from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'), 'false') <> 'true';
