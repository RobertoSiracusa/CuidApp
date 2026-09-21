-- ═══════════════════════════════════════════════════════════════
-- Datos iniciales
-- ═══════════════════════════════════════════════════════════════

insert into settings (id) values (true) on conflict do nothing;
insert into patient_status (id) values (true) on conflict do nothing;

insert into care_roles (name, icon, color, is_default) values
  ('Médico',                 '⚕️',  '#3fb4a0', true),
  ('Enfermera/Enfermero',    '💉',  '#6e8efb', true),
  ('Cuidador/a',             '🤝',  '#f0a500', true),
  ('Coordinador Familiar',   '👨‍👩‍👧', '#e05a4e', true),
  ('Fisioterapeuta',         '🏃',  '#26a66a', true),
  ('Nutricionista',          '🥗',  '#a78bfa', true),
  ('Proveedor/Farmacia',     '🏥',  '#fb923c', true);

insert into inventory_categories (name) values
  ('Medicamentos'), ('Insumos Médicos'), ('Alimentos/Suplementos'),
  ('Higiene Personal'), ('Equipos'), ('Otros')
on conflict (name) do nothing;

-- ── PRIMER ADMINISTRADOR ───────────────────────────────────────
-- Ejecutar DESPUÉS de haberse registrado en la app con ese email.
-- Sustituir por el email real antes de ejecutar.
update profiles
   set app_role = 'admin', active = true
 where id = (select id from auth.users where email = 'CAMBIAR@EJEMPLO.COM');
