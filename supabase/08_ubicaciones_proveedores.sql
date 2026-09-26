-- ═══════════════════════════════════════════════════════════════
-- CuidApp v2 — Módulo «Gestión Insumos»: ubicaciones y proveedores
-- supabase/08_ubicaciones_proveedores.sql
--
-- Ejecutar DESPUÉS de 07_insumos.sql. Transaccional y re-ejecutable.
--
-- Qué resuelve:
--   1. ARCHIVAR una ubicación que ya tuvo movimientos (no se puede borrar
--      sin perder historial). Al archivar se exige dejar su stock en cero:
--      o se traslada a otra ubicación en la misma operación, o se rechaza.
--      También se reubican los insumos, pedidos en camino, envases abiertos
--      y vencimientos que la usaban.
--   2. Una ubicación archivada deja de aceptar movimientos, relevos, pedidos
--      y asignaciones. Su historial se conserva y se puede RESTAURAR.
--   3. BORRAR solo es posible si la ubicación nunca se usó.
--   4. Las ubicaciones especiales (punto de uso = Habitación, almacén por
--      defecto = Armario) no se pueden borrar ni archivar. Solo un admin
--      puede reasignar esa función a otra ubicación.
--   5. Proveedores: archivar solo sin pedidos en camino, no asignar uno
--      archivado a un insumo y no borrar uno con historial.
--
-- Los campos `active`, `is_point_of_care` e `is_default_storage` SOLO se
-- cambian por RPC desde la aplicación (en el Editor SQL, sin sesión de
-- usuario, el dueño del proyecto conserva el control, como en 05b). El nombre, tipo, orden y antigüedad máxima de conteo
-- se siguen editando directamente en la tabla.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Columnas ────────────────────────────────────────────────
alter table supply_locations
  add column if not exists active       boolean not null default true,
  add column if not exists archived_at  timestamptz,
  add column if not exists archived_by  uuid references profiles(id) on delete set null;

alter table supply_locations drop constraint if exists supply_locations_special_active_ck;
alter table supply_locations add constraint supply_locations_special_active_ck
  check (active or (not is_point_of_care and not is_default_storage));

alter table supply_suppliers
  add column if not exists archived_at  timestamptz;

-- ── 2. Guardas sobre supply_locations ──────────────────────────
create or replace function guard_supply_location() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    if old.is_point_of_care or old.is_default_storage then
      raise exception 'UBICACION_ESPECIAL: no se puede borrar «%» porque es el punto de uso o el almacén por defecto', old.name
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- Sin usuario de la aplicación (Editor SQL, migraciones): solo el dueño
  -- del proyecto. Mismo criterio que 05b_fix_primer_admin.sql.
  if auth.uid() is null then return new; end if;

  if TG_OP = 'INSERT' then
    -- Las ubicaciones nuevas nacen activas y sin función especial;
    -- la función especial se asigna con set_special_location().
    if coalesce(current_setting('cuidapp.location_admin', true), 'off') <> 'on' then
      new.active := true;
      new.archived_at := null;
      new.archived_by := null;
      if new.is_point_of_care or new.is_default_storage then
        raise exception 'UBICACION_ESPECIAL: usa «Asignar como punto de uso / almacén por defecto» para esa función'
          using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if (new.active is distinct from old.active
      or new.archived_at is distinct from old.archived_at
      or new.is_point_of_care is distinct from old.is_point_of_care
      or new.is_default_storage is distinct from old.is_default_storage)
     and coalesce(current_setting('cuidapp.location_admin', true), 'off') <> 'on' then
    raise exception 'UBICACION_ESTADO: para archivar, restaurar o cambiar la función de una ubicación usa las acciones del Catálogo'
      using errcode = 'P0001';
  end if;
  return new;
end; $$;

drop trigger if exists guard_location on supply_locations;
create trigger guard_location before insert or update or delete on supply_locations
  for each row execute function guard_supply_location();

-- ── 3. Nada nuevo puede apuntar a una ubicación archivada ──────
-- TG_ARGV contiene los nombres de columna a comprobar.
-- El nombre empieza por «require_» para ejecutarse DESPUÉS de los
-- triggers «prepare_*» de 07, que completan la ubicación por defecto.
create or replace function require_active_location() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_col   text;
  v_id    uuid;
  v_name  text;
  v_ok    boolean;
begin
  foreach v_col in array TG_ARGV loop
    v_id := (to_jsonb(new) ->> v_col)::uuid;
    continue when v_id is null;
    -- En UPDATE solo se valida si la columna cambió
    if TG_OP = 'UPDATE' and v_id is not distinct from (to_jsonb(old) ->> v_col)::uuid then
      continue;
    end if;
    select active, name into v_ok, v_name from supply_locations where id = v_id;
    if v_ok is false then
      raise exception 'UBICACION_ARCHIVADA: «%» está archivada; restáurala o elige otra ubicación', v_name
        using errcode = 'P0001';
    end if;
  end loop;
  return new;
end; $$;

drop trigger if exists require_active_location on inventory_movements;
create trigger require_active_location before insert on inventory_movements
  for each row execute function require_active_location('location_id');

drop trigger if exists require_active_location on supply_relays;
create trigger require_active_location before insert on supply_relays
  for each row execute function require_active_location('location_id');

drop trigger if exists require_active_location on supply_order_lines;
create trigger require_active_location before insert on supply_order_lines
  for each row execute function require_active_location('destination_location_id');

drop trigger if exists require_active_location on supply_open_containers;
create trigger require_active_location before insert or update on supply_open_containers
  for each row execute function require_active_location('location_id');

drop trigger if exists require_active_location on supply_expiry_records;
create trigger require_active_location before insert or update on supply_expiry_records
  for each row execute function require_active_location('location_id');

drop trigger if exists require_active_location on inventory_items;
create trigger require_active_location before insert or update on inventory_items
  for each row execute function require_active_location('default_location_id', 'reserve_location_id');

-- ── 4. RPC: archivar una ubicación ─────────────────────────────
-- p_transfer_to: ubicación activa que recibe el stock y las referencias.
--   Si es null y la ubicación tiene stock o referencias, se rechaza y se
--   devuelve el detalle para que la interfaz pida un destino.
-- Idempotente: si ya está archivada, devuelve {already_archived: true}.
create or replace function archive_supply_location(
  p_location_id  uuid,
  p_transfer_to  uuid default null,
  p_note         text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_loc          supply_locations%rowtype;
  v_dest         supply_locations%rowtype;
  v_row          record;
  v_group        uuid;
  v_moved        int := 0;
  v_zeroed       int := 0;
  v_items_def    int := 0;
  v_items_res    int := 0;
  v_orders       int := 0;
  v_containers   int := 0;
  v_expiry       int := 0;
  v_stock_items  int;
  v_refs         int;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;

  select * into v_loc from supply_locations where id = p_location_id for update;
  if not found then raise exception 'Ubicación no encontrada'; end if;
  if not v_loc.active then
    return jsonb_build_object('location_id', p_location_id, 'already_archived', true);
  end if;
  if v_loc.is_point_of_care or v_loc.is_default_storage then
    raise exception 'UBICACION_ESPECIAL: «%» es el punto de uso o el almacén por defecto; asigna esa función a otra ubicación antes de archivarla', v_loc.name
      using errcode = 'P0001';
  end if;

  if p_transfer_to is not null then
    select * into v_dest from supply_locations where id = p_transfer_to;
    if not found or not v_dest.active then
      raise exception 'UBICACION_ARCHIVADA: el destino no existe o está archivado' using errcode = 'P0001';
    end if;
    if p_transfer_to = p_location_id then
      raise exception 'El destino debe ser una ubicación distinta';
    end if;
  end if;

  -- ¿Qué depende de esta ubicación?
  select count(distinct item_id) into v_stock_items
    from inventory_stock_view where location_id = p_location_id and quantity > 0;
  select (select count(*) from inventory_items where default_location_id = p_location_id and active)
       + (select count(*) from supply_order_lines where destination_location_id = p_location_id and status = 'in_transit')
       + (select count(*) from supply_open_containers where location_id = p_location_id and status = 'active')
       + (select count(*) from supply_expiry_records where location_id = p_location_id and status = 'active')
    into v_refs;

  if p_transfer_to is null and (v_stock_items > 0 or v_refs > 0) then
    raise exception 'UBICACION_CON_STOCK: «%» tiene stock en % insumo(s) y % referencia(s) activas; elige a dónde trasladarlos',
      v_loc.name, v_stock_items, v_refs
      using errcode = 'P0001';
  end if;

  -- 4.1 Trasladar el stock (llenos y vacíos) y dejar la ubicación en cero
  for v_row in
    select item_id, stock_state, quantity, raw_quantity
      from inventory_stock_view where location_id = p_location_id
  loop
    if v_row.quantity > 0 then
      v_group := gen_random_uuid();
      insert into inventory_movements
        (item_id, location_id, stock_state, movement_type, delta, occurred_at, group_id, note, profile_id)
      values
        (v_row.item_id, p_location_id, v_row.stock_state, 'transfer', -v_row.quantity, now(), v_group,
         'Cierre de ubicación: ' || v_loc.name, auth.uid()),
        (v_row.item_id, p_transfer_to, v_row.stock_state, 'transfer', v_row.quantity, now(), v_group,
         'Cierre de ubicación: ' || v_loc.name, auth.uid());
      v_moved := v_moved + 1;
    elsif v_row.raw_quantity < 0 then
      -- Anomalía (libro negativo): se cierra con un conteo en cero
      insert into inventory_movements
        (item_id, location_id, stock_state, movement_type, qty_absolute, occurred_at, note, profile_id)
      values
        (v_row.item_id, p_location_id, v_row.stock_state, 'count', 0, now(),
         'Cierre de ubicación (corrige saldo negativo)', auth.uid());
      v_zeroed := v_zeroed + 1;
    end if;
  end loop;

  -- 4.2 Reubicar referencias
  if p_transfer_to is not null then
    -- Si el destino ya era la reserva del insumo, la reserva se libera
    update inventory_items
       set reserve_location_id = null
     where default_location_id = p_location_id and reserve_location_id = p_transfer_to;
    update inventory_items set default_location_id = p_transfer_to
     where default_location_id = p_location_id;
    get diagnostics v_items_def = row_count;

    update inventory_items
       set reserve_location_id = case when default_location_id = p_transfer_to then null else p_transfer_to end
     where reserve_location_id = p_location_id;
    get diagnostics v_items_res = row_count;

    update supply_order_lines set destination_location_id = p_transfer_to
     where destination_location_id = p_location_id and status = 'in_transit';
    get diagnostics v_orders = row_count;

    update supply_open_containers set location_id = p_transfer_to
     where location_id = p_location_id and status = 'active';
    get diagnostics v_containers = row_count;

    update supply_expiry_records set location_id = p_transfer_to
     where location_id = p_location_id and status = 'active';
    get diagnostics v_expiry = row_count;
  else
    -- Sin destino solo pueden quedar reservas: se liberan
    update inventory_items set reserve_location_id = null where reserve_location_id = p_location_id;
    get diagnostics v_items_res = row_count;
  end if;

  -- 4.3 Archivar
  perform set_config('cuidapp.location_admin', 'on', true);
  update supply_locations
     set active = false, archived_at = now(), archived_by = auth.uid()
   where id = p_location_id;
  perform set_config('cuidapp.location_admin', 'off', true);

  return jsonb_build_object(
    'location_id', p_location_id, 'already_archived', false,
    'stock_rows_transferred', v_moved, 'negative_rows_zeroed', v_zeroed,
    'items_default_moved', v_items_def, 'items_reserve_changed', v_items_res,
    'orders_redirected', v_orders, 'containers_moved', v_containers,
    'expiry_records_moved', v_expiry, 'note', coalesce(p_note, ''));
end; $$;

-- ── 5. RPC: restaurar una ubicación archivada ──────────────────
create or replace function restore_supply_location(p_location_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  perform set_config('cuidapp.location_admin', 'on', true);
  update supply_locations
     set active = true, archived_at = null, archived_by = null
   where id = p_location_id;
  if not found then raise exception 'Ubicación no encontrada'; end if;
  perform set_config('cuidapp.location_admin', 'off', true);
end; $$;

-- ── 6. RPC: reasignar punto de uso o almacén por defecto (admin) ─
-- p_role: 'point_of_care' | 'default_storage'. La función pasa de la
-- ubicación actual a la nueva en una sola transacción.
-- No mueve stock ni cambia la ubicación de los insumos existentes: solo
-- define dónde se crean los nuevos y dónde se hace el relevo.
create or replace function set_special_location(p_location_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_active boolean;
begin
  if not is_admin() then raise exception 'Solo un administrador puede cambiar esta función'; end if;
  if p_role not in ('point_of_care', 'default_storage') then
    raise exception 'Función no válida: %', p_role;
  end if;
  select active into v_active from supply_locations where id = p_location_id;
  if v_active is null then raise exception 'Ubicación no encontrada'; end if;
  if not v_active then
    raise exception 'UBICACION_ARCHIVADA: restaura la ubicación antes de asignarle esa función' using errcode = 'P0001';
  end if;

  perform set_config('cuidapp.location_admin', 'on', true);
  if p_role = 'point_of_care' then
    update supply_locations set is_point_of_care = false where is_point_of_care and id <> p_location_id;
    update supply_locations set is_point_of_care = true  where id = p_location_id;
  else
    update supply_locations set is_default_storage = false where is_default_storage and id <> p_location_id;
    update supply_locations set is_default_storage = true  where id = p_location_id;
  end if;
  perform set_config('cuidapp.location_admin', 'off', true);
end; $$;

-- ── 7. Proveedores ─────────────────────────────────────────────
create or replace function guard_supply_supplier() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    if exists (select 1 from supply_order_batches where supplier_id = old.id)
       or exists (select 1 from inventory_items where supplier_id = old.id) then
      raise exception 'PROVEEDOR_CON_HISTORIAL: «%» tiene pedidos o insumos asociados; archívalo en lugar de borrarlo', old.name
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if auth.uid() is null then return new; end if;

  if TG_OP = 'INSERT' then
    if coalesce(current_setting('cuidapp.supplier_admin', true), 'off') <> 'on' then
      new.active := true;
      new.archived_at := null;
    end if;
    return new;
  end if;

  if (new.active is distinct from old.active or new.archived_at is distinct from old.archived_at)
     and coalesce(current_setting('cuidapp.supplier_admin', true), 'off') <> 'on' then
    raise exception 'PROVEEDOR_ESTADO: para archivar o restaurar un proveedor usa las acciones del Catálogo'
      using errcode = 'P0001';
  end if;
  return new;
end; $$;

drop trigger if exists guard_supplier on supply_suppliers;
create trigger guard_supplier before insert or update or delete on supply_suppliers
  for each row execute function guard_supply_supplier();

-- No asignar un proveedor archivado a un insumo ni a un pedido nuevo
create or replace function require_active_supplier() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ok boolean; v_name text;
begin
  if new.supplier_id is null then return new; end if;
  if TG_OP = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id then return new; end if;
  select active, name into v_ok, v_name from supply_suppliers where id = new.supplier_id;
  if v_ok is false then
    raise exception 'PROVEEDOR_ARCHIVADO: «%» está archivado; restáuralo o elige otro proveedor', v_name
      using errcode = 'P0001';
  end if;
  return new;
end; $$;

drop trigger if exists require_active_supplier on inventory_items;
create trigger require_active_supplier before insert or update on inventory_items
  for each row execute function require_active_supplier();
drop trigger if exists require_active_supplier on supply_order_batches;
create trigger require_active_supplier before insert on supply_order_batches
  for each row execute function require_active_supplier();

-- Archivar: rechazado si hay pedidos en camino. Devuelve cuántos insumos
-- lo tienen asignado para que la interfaz ofrezca reasignarlos.
create or replace function archive_supply_supplier(p_supplier_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s        supply_suppliers%rowtype;
  v_pending  int;
  v_items    int;
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  select * into v_s from supply_suppliers where id = p_supplier_id for update;
  if not found then raise exception 'Proveedor no encontrado'; end if;
  if not v_s.active then
    return jsonb_build_object('supplier_id', p_supplier_id, 'already_archived', true);
  end if;

  select count(*) into v_pending
    from supply_order_lines l join supply_order_batches b on b.id = l.batch_id
   where b.supplier_id = p_supplier_id and l.status = 'in_transit';
  if v_pending > 0 then
    raise exception 'PROVEEDOR_CON_PEDIDOS: «%» tiene % pedido(s) en camino; recíbelos o cancélalos antes de archivarlo',
      v_s.name, v_pending using errcode = 'P0001';
  end if;

  select count(*) into v_items from inventory_items where supplier_id = p_supplier_id and active;

  perform set_config('cuidapp.supplier_admin', 'on', true);
  update supply_suppliers set active = false, archived_at = now() where id = p_supplier_id;
  perform set_config('cuidapp.supplier_admin', 'off', true);

  return jsonb_build_object('supplier_id', p_supplier_id, 'already_archived', false,
                            'items_still_assigned', v_items);
end; $$;

create or replace function restore_supply_supplier(p_supplier_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active_user() then raise exception 'No autorizado'; end if;
  perform set_config('cuidapp.supplier_admin', 'on', true);
  update supply_suppliers set active = true, archived_at = null where id = p_supplier_id;
  if not found then raise exception 'Proveedor no encontrado'; end if;
  perform set_config('cuidapp.supplier_admin', 'off', true);
end; $$;

-- ── 8. Vista de apoyo para la pantalla de ubicaciones ──────────
-- Muestra, por ubicación, cuánto depende de ella: la interfaz la usa para
-- decidir si ofrece «Borrar» (nunca usada) o «Archivar» (con destino).
create or replace view supply_locations_view
with (security_invoker = true) as
select l.*,
       coalesce(s.items_with_stock, 0)  as items_with_stock,
       coalesce(d.items_default, 0)     as items_default,
       coalesce(r.items_reserve, 0)     as items_reserve,
       coalesce(o.orders_in_transit, 0) as orders_in_transit,
       (m.has_movements or rl.has_relays or ol.has_orders or oc.has_containers or ex.has_expiry) as has_history
  from supply_locations l
  left join lateral (select count(distinct item_id) as items_with_stock
                       from inventory_stock_view v where v.location_id = l.id and v.quantity > 0) s on true
  left join lateral (select count(*) as items_default
                       from inventory_items i where i.default_location_id = l.id) d on true
  left join lateral (select count(*) as items_reserve
                       from inventory_items i where i.reserve_location_id = l.id) r on true
  left join lateral (select count(*) as orders_in_transit
                       from supply_order_lines x where x.destination_location_id = l.id and x.status = 'in_transit') o on true
  left join lateral (select exists (select 1 from inventory_movements x where x.location_id = l.id) as has_movements) m on true
  left join lateral (select exists (select 1 from supply_relays x where x.location_id = l.id) as has_relays) rl on true
  left join lateral (select exists (select 1 from supply_order_lines x where x.destination_location_id = l.id) as has_orders) ol on true
  left join lateral (select exists (select 1 from supply_open_containers x where x.location_id = l.id) as has_containers) oc on true
  left join lateral (select exists (select 1 from supply_expiry_records x where x.location_id = l.id) as has_expiry) ex on true;

-- ── 9. Permisos ────────────────────────────────────────────────
grant select on supply_locations_view to authenticated;
grant execute on function archive_supply_location(uuid, uuid, text) to authenticated;
grant execute on function restore_supply_location(uuid)             to authenticated;
grant execute on function set_special_location(uuid, text)          to authenticated;
grant execute on function archive_supply_supplier(uuid)             to authenticated;
grant execute on function restore_supply_supplier(uuid)             to authenticated;

commit;

-- ── Comprobación (igual que en 04 y 07): debe devolver CERO filas ─
select c.relname as vista_insegura
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v'
   and n.nspname = 'public'
   and coalesce(
         (select option_value from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'), 'false') <> 'true';
