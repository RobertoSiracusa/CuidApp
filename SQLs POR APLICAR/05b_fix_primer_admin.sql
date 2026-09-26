-- ═══════════════════════════════════════════════════════════════
-- CuidApp v2 — Corrección: activación del primer administrador
-- supabase/05b_fix_primer_admin.sql
--
-- Problema: el UPDATE de 05_seed.sql que promueve al primer admin NO
-- tiene efecto. Se ejecuta desde el Editor SQL, donde no hay sesión de
-- usuario: auth.uid() es nulo, is_admin() devuelve false y el trigger
-- guard_profile_update restaura app_role y active a sus valores previos.
-- El UPDATE termina "con éxito" pero el perfil sigue inactivo.
--
-- Corrección: la guarda solo actúa cuando hay un usuario autenticado.
-- Sin sesión (Editor SQL, service_role) solo opera el dueño del
-- proyecto; los clientes de la app siempre llevan JWT y pasan por RLS.
--
-- Ejecutar esto y DESPUÉS volver a ejecutar el UPDATE de 05_seed.sql.
-- ═══════════════════════════════════════════════════════════════

create or replace function guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and ((not is_admin()) or (old.id = auth.uid())) then
    new.app_role := old.app_role;
    new.active   := old.active;
  end if;
  return new;
end; $$;
