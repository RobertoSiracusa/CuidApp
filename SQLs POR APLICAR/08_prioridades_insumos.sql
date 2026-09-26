-- ═══════════════════════════════════════════════════════════════
-- CuidApp v2 — Horas de revisión por nivel de prioridad
-- (supabase/08_prioridades_insumos.sql)
--
-- Guarda en settings cada cuántas horas se revisa un insumo según
-- su nivel. Por defecto: nivel 1 = 24 h, nivel 2 = 48 h, nivel 3 = 72 h.
-- Solo un administrador puede cambiarlas (RLS de settings en 04_rls.sql).
-- Ejecutar después de 07_control_insumos.sql. Es re-ejecutable.
-- ═══════════════════════════════════════════════════════════════

begin;

alter table settings
  add column if not exists stock_p1_hours integer not null default 24,
  add column if not exists stock_p2_hours integer not null default 48,
  add column if not exists stock_p3_hours integer not null default 72;

alter table settings drop constraint if exists settings_stock_p1_hours_check;
alter table settings drop constraint if exists settings_stock_p2_hours_check;
alter table settings drop constraint if exists settings_stock_p3_hours_check;
alter table settings
  add constraint settings_stock_p1_hours_check check (stock_p1_hours between 1 and 720),
  add constraint settings_stock_p2_hours_check check (stock_p2_hours between 1 and 720),
  add constraint settings_stock_p3_hours_check check (stock_p3_hours between 1 and 720);

commit;
