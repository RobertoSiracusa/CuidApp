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
