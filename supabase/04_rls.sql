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
