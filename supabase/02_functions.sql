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
