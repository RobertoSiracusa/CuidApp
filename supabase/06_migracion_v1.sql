-- ═══════════════════════════════════════════════════════════════
-- CuidApp v2 — Migración de Datos Reales de v1 (cuidapp_db.json)
-- supabase/06_migracion_v1.sql
--
-- Ejecutar en el Editor SQL de Supabase después de 01 a 05.
-- Es completamente idempotente: puede ejecutarse sin duplicar datos.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  v_rec_pure     uuid;
  v_rec_huevos   uuid;
  v_rec_crema    uuid;
  v_rec_tortilla uuid;
  v_comp_coco    uuid;
begin

  -- ── 1. Recetas e Ingredientes ───────────────────────────────────

  -- Receta 1: Pure de papas
  select id into v_rec_pure from public.recipes where name = 'Pure de papas' limit 1;
  if v_rec_pure is null then
    v_rec_pure := gen_random_uuid();
    insert into public.recipes (id, name, meal_types, instructions, notes, created_at)
    values (
      v_rec_pure,
      'Pure de papas',
      array['lunch', 'dinner'],
      '',
      '',
      '2026-09-21T15:37:27.977Z'::timestamptz
    );

    insert into public.recipe_ingredients (recipe_id, name, amount, unit) values
      (v_rec_pure, 'Papas', '', ''),
      (v_rec_pure, 'Leche', '', ''),
      (v_rec_pure, 'Griego', 'Yogurt', ''),
      (v_rec_pure, 'Queso', '', '');
  end if;

  -- Receta 2: Huevos Revueltos
  select id into v_rec_huevos from public.recipes where name = 'Huevos Revueltos' limit 1;
  if v_rec_huevos is null then
    v_rec_huevos := gen_random_uuid();
    insert into public.recipes (id, name, meal_types, instructions, notes, created_at)
    values (
      v_rec_huevos,
      'Huevos Revueltos',
      array['breakfast'],
      '',
      '',
      '2026-09-21T15:47:00.563Z'::timestamptz
    );

    insert into public.recipe_ingredients (recipe_id, name, amount, unit) values
      (v_rec_huevos, 'Huevo', '', ''),
      (v_rec_huevos, 'Queso', '', '');
  end if;

  -- Receta 3: Crema Calabacin y Pollo
  select id into v_rec_crema from public.recipes where name = 'Crema Calabacin y Pollo' limit 1;
  if v_rec_crema is null then
    v_rec_crema := gen_random_uuid();
    insert into public.recipes (id, name, meal_types, instructions, notes, created_at)
    values (
      v_rec_crema,
      'Crema Calabacin y Pollo',
      array['lunch', 'dinner'],
      '',
      '',
      '2026-09-21T15:47:44.181Z'::timestamptz
    );

    insert into public.recipe_ingredients (recipe_id, name, amount, unit) values
      (v_rec_crema, 'Calabacin', '', ''),
      (v_rec_crema, 'Pollo', '', ''),
      (v_rec_crema, 'Parmesano', '', ''),
      (v_rec_crema, 'Ricotta', '', '');
  end if;

  -- Receta 4: Tortilla de Papas
  select id into v_rec_tortilla from public.recipes where name = 'Tortilla de Papas' limit 1;
  if v_rec_tortilla is null then
    v_rec_tortilla := gen_random_uuid();
    insert into public.recipes (id, name, meal_types, instructions, notes, created_at)
    values (
      v_rec_tortilla,
      'Tortilla de Papas',
      array['lunch', 'dinner'],
      '',
      '',
      '2026-09-21T15:48:09.820Z'::timestamptz
    );

    insert into public.recipe_ingredients (recipe_id, name, amount, unit) values
      (v_rec_tortilla, 'Papas', '', ''),
      (v_rec_tortilla, 'Huevo', '', '');
  end if;


  -- ── 2. Plan Semanal (weekly_plan) ───────────────────────────────

  -- Día 1 (Lunes), Almuerzo: Pure de papas y Crema Calabacin y Pollo
  insert into public.weekly_plan (day_index, meal_type, recipe_id)
  values (1, 'lunch', v_rec_pure)
  on conflict (day_index, meal_type, recipe_id) do nothing;

  insert into public.weekly_plan (day_index, meal_type, recipe_id)
  values (1, 'lunch', v_rec_crema)
  on conflict (day_index, meal_type, recipe_id) do nothing;

  -- Día 2 (Martes), Desayuno: Huevos Revueltos
  insert into public.weekly_plan (day_index, meal_type, recipe_id)
  values (2, 'breakfast', v_rec_huevos)
  on conflict (day_index, meal_type, recipe_id) do nothing;


  -- ── 3. Complementos (complementos) ──────────────────────────────

  -- agua de coco (categoría bebidas)
  select id into v_comp_coco from public.complementos where name = 'agua de coco' limit 1;
  if v_comp_coco is null then
    v_comp_coco := gen_random_uuid();
    insert into public.complementos (id, name, category, amount, unit, notes, created_at)
    values (
      v_comp_coco,
      'agua de coco',
      'bebidas',
      '',
      '',
      '',
      '2026-09-21T15:37:45.169Z'::timestamptz
    );
  end if;

end $$;
