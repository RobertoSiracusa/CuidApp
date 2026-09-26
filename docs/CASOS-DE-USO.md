# CuidApp — Casos de uso

## Actores

| Actor | Descripción | Permisos |
|---|---|---|
| **Visitante** | Persona sin cuenta, o cuya cuenta aún no se aprobó | Registrarse, iniciar sesión, recuperar contraseña |
| **Cuidador** | Cuenta aprobada con rol `caregiver` | Inicio, Menú, Roles y Personal (sin Usuarios), Configuración (perfil propio) |
| **Administrador** | Cuenta aprobada con rol `admin` | Todo lo del cuidador, además de Insumos, Usuarios, datos del paciente, Auditoría y copias |
| **Sistema** | Supabase (triggers y RLS) | Crea perfiles, guarda el stock anterior en cada revisión, audita y aplica permisos |

## Índice

| ID | Caso de uso | Actor principal |
|---|---|---|
| CU-01 | Registrarse y esperar aprobación | Visitante |
| CU-02 | Aprobar, desactivar o cambiar permisos de una cuenta | Administrador |
| CU-03 | Iniciar sesión y navegar | Cuidador / Administrador |
| CU-04 | Consultar el resumen del día | Cuidador / Administrador |
| CU-05 | Registrar un insumo | Administrador |
| CU-06 | Revisar el stock de un insumo | Administrador |
| CU-07 | Reponer insumos mediante la lista de compra | Administrador |
| CU-08 | Filtrar insumos | Administrador |
| CU-09 | Configurar los tiempos de revisión por nivel | Administrador |
| CU-10 | Editar o eliminar un insumo | Administrador |
| CU-11 | Planificar el menú semanal | Cuidador / Administrador |
| CU-12 | Gestionar la lista de compras | Cuidador / Administrador |
| CU-13 | Tomar y entregar un turno | Cuidador / Administrador |
| CU-14 | Consultar la auditoría | Administrador |
| CU-15 | Guardar una copia de seguridad | Administrador |

---

## CU-01 · Registrarse y esperar aprobación
- **Actor:** Visitante.
- **Precondición:** tiene acceso a la dirección de la app.
- **Flujo principal:**
  1. Pulsa **Crear cuenta** e introduce nombre, correo y contraseña.
  2. El sistema crea la cuenta y el perfil como cuidador **inactivo**.
  3. Se muestra "Cuenta pendiente de aprobación".
  4. Cuando un admin lo aprueba (CU-02), pulsa **Comprobar aprobación** y entra.
- **Alternativo:** el correo ya existe → mensaje de error. Si olvidó la contraseña, pulsa **¿Olvidaste tu contraseña?** y recibe un enlace por correo.
- **Postcondición:** el perfil existe; sin aprobación no ve ningún dato (RLS).

## CU-02 · Aprobar, desactivar o cambiar permisos de una cuenta
- **Actor:** Administrador.
- **Flujo principal:**
  1. Roles y Personal → **Usuarios**.
  2. Pulsa **Aprobar** o **Desactivar**, o **Hacer Admin** o **Hacer Cuidador**.
  3. Confirma. El cambio se aplica al instante y queda auditado.
- **Regla:** nadie puede cambiar sus propios permisos (trigger `guard_profiles`).
- **Postcondición:** una cuenta desactivada pierde el acceso, pero su historial se conserva.

## CU-03 · Iniciar sesión y navegar
- **Actor:** Cuidador o Administrador.
- **Flujo principal:**
  1. Introduce correo y contraseña.
  2. Se abre **Inicio**.
  3. Con ☰ (iPhone) o con el sidebar fijo (pantallas grandes) elige un módulo.
- **Regla:** Insumos, Auditoría y Guardar copia solo aparecen para admin. Si alguien intenta abrirlos sin permiso, vuelve a Inicio con un aviso.

## CU-04 · Consultar el resumen del día
- **Actor:** Cuidador o Administrador.
- **Flujo principal:** al abrir Inicio ve el menú de hoy, la lista de compra pendiente, las notas de relevo sin leer y las alertas.
- **Extensión (admin):**
  - Avisos de **insumos por revisar** (rojo).
  - Avisos de **insumos por reponer**: amarillo, o rojo si alguno está agotado.
  - Resumen del control de insumos.
- **Postcondición (admin):** la lista de compra se sincroniza con los insumos por reponer (CU-07).

## CU-05 · Registrar un insumo
- **Actor:** Administrador.
- **Flujo principal:**
  1. Insumos → **+ Registrar**.
  2. Elige una de las 6 categorías.
  3. Escribe el nombre y el **stock objetivo**, y elige el **nivel de prioridad** (1, 2 o 3).
  4. Pulsa **Registrar**.
  5. El sistema guarda la fecha de registro. El insumo queda "Sin conteo" y **por revisar**.
- **Alternativos:**
  - Falta el nombre, el objetivo o el nivel → aviso; el formulario no se cierra.
  - El nombre ya existe (sin distinguir mayúsculas) → "Ya existe un insumo con ese nombre".
- **Postcondición:** registro creado y auditado.

## CU-06 · Revisar el stock de un insumo
- **Actor:** Administrador.
- **Disparador:** se cumplió el tiempo del nivel (por defecto 24, 48 o 72 h) o el insumo no tiene conteo.
- **Flujo principal:**
  1. Toca el insumo, desde la lista o desde **Revisar ahora** en Inicio.
  2. Anota **cuántos hay ahora** (con − / + o escribiendo) y pulsa **Guardar revisión**.
  3. El sistema guarda la revisión, con el stock anterior y quién revisó, y actualiza el stock actual.
  4. Muestra el faltante y reprograma la próxima revisión.
  5. La tarjeta cambia de color: verde si está completo, amarillo si está bajo, rojo si hay cero.
- **Alternativo:** cantidad vacía o negativa → aviso.
- **Postcondición:** historial actualizado (consumo del periodo o reposición) y lista de compra sincronizada (CU-07).

## CU-07 · Reponer insumos mediante la lista de compra
- **Actor:** Administrador; el sistema sincroniza.
- **Flujo principal:**
  1. Al abrir Inicio o Insumos, cada insumo por debajo del objetivo aparece en Menú → Compras como *"Insumos · faltan N"*.
  2. Quien compra marca el producto.
  3. En la siguiente revisión (CU-06) se anota la nueva cantidad.
  4. Si el insumo queda completo, su entrada desaparece de la lista.
- **Reglas:**
  - Si la cantidad que falta cambia, la entrada se actualiza.
  - Una entrada marcada como comprada no se duplica.
  - Las entradas manuales no se tocan.

## CU-08 · Filtrar insumos
- **Actor:** Administrador.
- **Flujo principal:**
  1. Toca **Por revisar**, **Por reponer** o **Todos**.
  2. Y, si quiere, **Nivel 1**, **Nivel 2** o **Nivel 3**.
  3. Los dos filtros se combinan.
- **Postcondición:** si no hay resultados, se muestra un mensaje que indica el filtro aplicado.

## CU-09 · Configurar los tiempos de revisión por nivel
- **Actor:** Administrador.
- **Precondición:** se ejecutó `08_prioridades_insumos.sql`.
- **Flujo principal:**
  1. Insumos → **⚙️**.
  2. Ajusta las horas de cada nivel y guarda.
  3. Las próximas revisiones se recalculan.
- **Alternativos:**
  - Valor fuera de 1–720 o no entero → aviso.
  - Sin el script SQL → "Falta aplicar 08_prioridades_insumos.sql".

## CU-10 · Editar o eliminar un insumo
- **Actor:** Administrador.
- **Flujo principal (editar):** toca el insumo → **✏️ Editar** → cambia nombre, categoría, objetivo o prioridad → **Guardar**.
- **Flujo principal (eliminar):** toca el insumo → **🗑️ Eliminar** → confirma. Se borran el insumo y sus revisiones.
- **Postcondición:** el cambio queda auditado y la lista de compra se sincroniza.

## CU-11 · Planificar el menú semanal
- **Actor:** Cuidador o Administrador.
- **Flujo principal:**
  1. Menú → **Recetas**: crea las recetas con sus ingredientes y las comidas en las que se usan.
  2. Menú → **Planificación**: asigna recetas a cada día y comida.
  3. Envía los ingredientes a la lista de compra. Si ya se enviaron, elige entre sustituir o complementar.
- **Postcondición:** Inicio muestra el menú de hoy.

## CU-12 · Gestionar la lista de compras
- **Actor:** Cuidador o Administrador.
- **Flujo principal:**
  1. Menú → **Compras**.
  2. Añade productos a mano, marca los comprados y quita los que sobran.
  3. **Enviar por WhatsApp** o **Copiar lista**.
- **Limitación conocida:** el borrado en lote de los marcados no se guarda en Supabase (ver documentación técnica §9).

## CU-13 · Tomar y entregar un turno
- **Actor:** Cuidador o Administrador.
- **Flujo principal:**
  1. Roles y Personal → **Tomar turno** con su rol de cuidado.
  2. Al terminar, deja una **Nota de entrega** y pulsa **Fin de turno**.
  3. Quien entra ve la nota en Inicio y la marca como leída.
- **Regla:** solo puede haber un turno abierto a la vez.

## CU-14 · Consultar la auditoría
- **Actor:** Administrador.
- **Flujo principal:**
  1. Abre Auditoría.
  2. Filtra por módulo, usuario o fechas.
  3. Lee cada acción descrita en lenguaje llano.
- **Extensión:** **Purgar > 24m** elimina los registros antiguos.
- **Regla:** las entradas no se pueden editar ni borrar una a una.

## CU-15 · Guardar una copia de seguridad
- **Actor:** Administrador.
- **Flujo principal:**
  1. Pulsa **💾 Guardar copia**, desde el sidebar, la cabecera o Configuración.
  2. Se descarga `CuidApp_backup_AAAA-MM-DD.json`.
- **Postcondición:** el archivo contiene configuración, equipo, turnos, notas, menú, compras e insumos con su historial.
