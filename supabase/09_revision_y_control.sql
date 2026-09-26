-- ═══════════════════════════════════════════════════════════════
-- CuidApp v2 — Módulo «Gestión Insumos»: revisión y control
-- supabase/09_revision_y_control.sql
--
-- Ejecutar DESPUÉS de 08_ubicaciones_proveedores.sql.
-- Transaccional y re-ejecutable.
--
-- ⚠️ 09 reemplaza record_administration e inventory_items_view de 07.
--    Si alguna vez vuelves a ejecutar 07, ejecuta después 08 y 09 en ese
--    orden; si no, se pierde el método de control por conteo.
--
-- Qué añade:
--   1. FRECUENCIA DE REVISIÓN POR INSUMO (review_every_hours). Se aplica
--      al punto de uso del insumo (su ubicación principal). Si es null, se
--      usa la de la ubicación. Al marcar un insumo como crítico, pasa a
--      revisión diaria (26 h) salvo que se indique otra frecuencia.
--   2. MÉTODO DE CONTROL DE MEDICAMENTOS (stock_control):
--        'dosis'  → cada dosis registrada descuenta stock (comportamiento de 07).
--        'conteo' → registrar una dosis queda como historial clínico pero NO
--                   descuenta; el stock lo fijan los conteos. Para dosis
--                   variables que controla la enfermera.
--   3. RELEVO CON MOVIMIENTOS: save_supply_relay_full guarda en una sola
--      transacción el relevo y los traslados que la interfaz haya inferido
--      («había más de lo esperado: lo trajeron del Armario»).
--   4. FRECUENCIAS DE UBICACIÓN acordadas:
--        Habitación (punto de uso)     → 50 h (turnos de 24 y 48 h)
--        Armario (almacén por defecto) → 720 h (verificación mensual; su
--                                        stock se mueve por compras y traslados)
--      Solo se cambian si todavía tienen el valor de fábrica de 07.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Tipos y columnas ────────────────────────────────────────
do $$ begin create type stock_control_t as enum ('dosis','conteo');
exception when duplicate_object then null; end $$;

alter table inventory_items
  add column if not exists review_every_hours int,
  add column if not exists stock_control      stock_control_t not null default 'dosis';

alter table inventory_items drop constraint if exists inventory_items_review_ck;
alter table inventory_items add constraint inventory_items_review_ck
  check (review_every_hours is null or review_every_hours between 1 and 2160);

-- Un crítico sin frecuencia propia pasa a revisión diaria (26 h).
-- Al quitarle la marca, si conserva exactamente esa frecuencia automática,
-- vuelve a la de su ubicación; una frecuencia fijada a mano se respeta.
-- (Nombre «prepare_review_*»: se ejecuta después de «prepare_item» de 07.)
create or replace function prepare_item_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_critical and new.review_every_hours is null
     and (TG_OP = 'INSERT' or not old.is_critical) then
    new.review_every_hours := 26;
  elsif TG_OP = 'UPDATE' and old.is_critical and not new.is_critical
        and new.review_every_hours = 26
        and old.review_every_hours is not distinct from new.review_every_hours then
    new.review_every_hours := null;
  end if;
  return new;
end; $$;

drop trigger if exists prepare_review_item on inventory_items;
create trigger prepare_review_item before insert or update on inventory_items
  for each row execute function prepare_item_review();

-- Críticos ya existentes sin frecuencia propia
update inventory_items set review_every_hours = 26
 where is_critical and review_every_hours is null;

-- ── 2. record_administration: respeta el método de control ─────
-- Misma firma que en 02 y 07: api.js no cambia.
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
  v_id       uuid;
  v_item     uuid;
  v_loc      uuid;
  v_control  stock_control_t;
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
    select id, default_location_id, stock_control into v_item, v_loc, v_control
      from inventory_items where medication_id = p_medication_id;

    if v_item is null then
      update medications
         set current_stock = greatest(0, current_stock - p_dose)
       where id = p_medication_id;
    elsif v_control = 'dosis' then
      insert into inventory_movements
        (item_id, location_id, movement_type, delta, occurred_at, administration_id, note, profile_id)
      values
        (v_item, v_loc, 'consume', -p_dose, now(), v_id, 'Dosis administrada', auth.uid());
    end if;
    -- 'conteo': la administración queda registrada; el stock lo fijan los conteos
  end if;

  return v_id;
end; $$;

-- ── 3. Relevo con movimientos adicionales (atómico) ────────────
-- p_movements: traslados inferidos u otros movimientos que acompañan al
-- relevo (mismo formato que record_supply_movements). Los traslados
-- inferidos deben fecharse ANTES de counted_at: así el conteo de la
-- Habitación los absorbe y solo se descuentan del Armario.
create or replace function save_supply_relay_full(p_relay jsonb, p_counts jsonb, p_movements jsonb default '[]')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_result  jsonb;
  v_moves   jsonb := '{}'::jsonb;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_movements, '[]')) m
              where (m->>'occurred_at')::timestamptz > (p_relay->>'counted_at')::timestamptz) then
    raise exception 'Los movimientos del relevo deben ser anteriores al momento del conteo';
  end if;

  v_result := save_supply_relay(p_relay, p_counts);
  if jsonb_array_length(coalesce(p_movements, '[]')) > 0 then
    v_moves := record_supply_movements(p_movements);
  end if;
  return v_result || jsonb_build_object('movements', v_moves);
end; $$;

grant execute on function save_supply_relay_full(jsonb, jsonb, jsonb) to authenticated;

-- ── 4. Frecuencias de ubicación acordadas ──────────────────────
-- Solo si conservan el valor de fábrica de 07 (no pisa ajustes hechos a mano).
update supply_locations set max_audit_age_hours = 50
 where is_point_of_care and max_audit_age_hours = 24;
update supply_locations set max_audit_age_hours = 720
 where is_default_storage and max_audit_age_hours = 168;

-- ── 5. inventory_items_view: incluye las columnas nuevas ───────
-- (Una vista con i.* fija sus columnas al crearse: hay que recrearla.)
drop view if exists inventory_items_view;
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
       t.next_expected_by,
       coalesce(i.review_every_hours, dl.max_audit_age_hours) as effective_review_hours,
       pc.last_counted_at        as point_of_care_last_counted_at
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
  left join lateral (
    select max(last_counted_at) as last_counted_at
      from inventory_stock_view v
     where v.item_id = i.id and v.location_id = i.default_location_id
  ) pc on true
  left join supply_in_transit_view      t  on t.item_id = i.id;

grant select on inventory_items_view to authenticated;

commit;

-- ── Comprobación (igual que en 04, 07 y 08): debe devolver CERO filas ─
select c.relname as vista_insegura
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v'
   and n.nspname = 'public'
   and coalesce(
         (select option_value from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'), 'false') <> 'true';
