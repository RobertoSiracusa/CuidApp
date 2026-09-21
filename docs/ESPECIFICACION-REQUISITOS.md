# CuidApp — Especificación de Requisitos (SRS)

**Versión del documento:** 2.0
**Fecha:** 2026-09-21
**Sustituye a:** v1.0 (ingeniería inversa sobre el prototipo local)
**Estado del producto:** rediseño para web pública — pendiente de implementación

> **Qué cambió respecto a v1.0**
> v1.0 documentaba un prototipo que corría en **un solo equipo Windows** (servidor PowerShell en
> `localhost`, datos en `localStorage`). v2.0 especifica una **aplicación web real** sobre Vercel +
> Supabase, con autenticación, auditoría y administración de medicamentos.
> La §9 traza qué requisito de v1 sobrevive, cambia o desaparece.

---

## 1. Objetivo del sistema

CuidApp coordina el **cuidado domiciliario de un paciente crítico** entre varias personas que se
turnan: familiares, enfermeros, cuidadores y médicos.

El problema que resuelve no es clínico sino **de coordinación y continuidad**:

- Cuando el cuidador cambia a media tarde, el que entra no sabe qué se hizo ni qué falta.
- Nadie recuerda con certeza si se dio la dosis de las 14:00, ni cuántas tabletas quedan.
- La cita del martes se le olvida a quien no estaba el día que la agendaron.
- Las compras y los gastos los hace cualquiera, sin registro común.
- Cuando algo sale mal, no hay forma de reconstruir qué pasó ni quién hizo qué.

El sistema es un **libro de guardia digital compartido**, accesible desde el teléfono de cada
cuidador: quién está a cargo, qué dosis tocan ahora, qué hay que hacer hoy, qué se está acabando,
qué viene en la agenda, cuánto se ha gastado y —para el administrador— qué cambió y quién lo cambió.

### 1.1 Alcance

| Dentro del alcance | Fuera del alcance |
|---|---|
| Coordinación de turnos y traspaso entre cuidadores | Historia clínica electrónica formal |
| Registro de administración de dosis | Prescripción o consejo clínico |
| Seguimiento de existencias de medicamentos e insumos | Facturación o seguros |
| Lista de tareas por turno | Telemedicina / videollamada |
| Agenda de citas médicas | Integración con farmacias o laboratorios |
| Planificación de alimentación y compras | Multi-paciente / multi-hogar |
| Registro de gastos | Signos vitales *(retirado en v2 — ver §9.3)* |
| Auditoría de cambios | Operación sin conexión *(retirada en v2 — ver §4.1)* |

### 1.2 Actores y permisos

El sistema distingue **dos conceptos de rol que no deben confundirse**:

- **Rol de cuidado** (`care_roles`): a qué se dedica la persona — Médico, Enfermería, Cuidador/a,
  Coordinador Familiar, Fisioterapeuta, Nutricionista, Proveedor/Farmacia. Es informativo y
  organizativo. El usuario puede crear roles nuevos.
- **Rol de permisos** (`profiles.app_role`): qué puede hacer en el sistema. Solo dos valores.

| Rol de permisos | Puede | No puede |
|---|---|---|
| **`admin`** | Todo lo del cuidador, más: ver la auditoría, activar/desactivar usuarios, cambiar roles de permiso, editar la configuración del paciente y el contacto de emergencia | — |
| **`caregiver`** | Operar todos los módulos de cuidado: turnos, dosis, tareas, inventario, agenda, alimentación, compras, gastos | Ver la auditoría, gestionar usuarios, editar la configuración global |

Un usuario recién registrado queda **inactivo** hasta que un admin lo activa (RF-07). Un perfil
inactivo no puede leer ni escribir ningún dato.

---

## 2. Arquitectura

```
iPhone / Android / Escritorio — navegador
  │
  │  HTTPS
  ▼
Vercel  ── sitio estático (HTML + CSS + JS)  ·  sin build, sin servidor propio
  │
  │  HTTPS — supabase-js (vendorizado)
  ▼
Supabase
  ├── GoTrue      — autenticación por email + contraseña
  ├── PostgREST   — acceso a datos
  └── PostgreSQL  — datos · Row Level Security · triggers de auditoría
```

### 2.1 Decisiones estructurales

1. **Una sola dependencia: `supabase-js` v2**, descargada y commiteada en `js/vendor/supabase.js`
   con versión fija. No se carga desde CDN en tiempo de ejecución: un tercero no debe estar en la
   ruta crítica de una aplicación de salud.
2. **Sin framework, sin build, sin `package.json`.** Se conserva el patrón de módulos IIFE de v1.
   Editar un `.js` y recargar sigue siendo el ciclo de desarrollo.
3. **La seguridad vive en la base de datos, no en el cliente.** Todo acceso pasa por políticas Row
   Level Security de PostgreSQL. La clave pública (`anon key`) es inofensiva por diseño: sin sesión
   válida y perfil activo, no devuelve nada.
4. **La auditoría vive en la base de datos, no en el cliente.** Triggers de Postgres. Ningún módulo
   JS tiene que acordarse de registrar nada, y ningún cliente puede evadirla.
5. **Las alertas se derivan, no se almacenan.** Ver §3.11.
6. **Un solo hogar, un solo paciente.** No hay columna de tenencia en las tablas.

---

## 3. Requisitos Funcionales (RF)

### 3.1 Autenticación y sesión — `js/auth.js` 🆕

| ID | Requisito |
|---|---|
| RF-01 | El sistema exige iniciar sesión con email y contraseña antes de mostrar cualquier dato del paciente |
| RF-02 | El sistema permite registrarse con email y contraseña; la cuenta queda **inactiva** hasta que un admin la active |
| RF-03 | La sesión persiste entre aperturas de la app y se renueva automáticamente sin pedir credenciales de nuevo |
| RF-04 | El sistema permite cerrar sesión explícitamente desde la configuración |
| RF-05 | El sistema permite recuperar la contraseña mediante enlace enviado al email |
| RF-06 | Un usuario autenticado pero inactivo ve una pantalla explicativa ("Tu cuenta está pendiente de aprobación") y ningún dato |

### 3.2 Gestión de usuarios — `js/roles.js` (solo admin) 🆕

| ID | Requisito |
|---|---|
| RF-07 | El admin ve la lista de usuarios registrados con su estado (activo/inactivo), rol de permisos y rol de cuidado |
| RF-08 | El admin puede activar o desactivar cualquier usuario |
| RF-09 | El admin puede promover un usuario a `admin` o devolverlo a `caregiver` |
| RF-10 | El admin puede asignar el rol de cuidado (Médico, Enfermería, …) a cada usuario |
| RF-11 | El sistema impide que un admin se desactive o se degrade a sí mismo, para no dejar el sistema sin administrador |

### 3.3 Panel de inicio — `js/dashboard.js`

| ID | Requisito |
|---|---|
| RF-12 | El panel muestra el estado del paciente (Estable / Alerta / Crítico), quién lo actualizó y hace cuánto |
| RF-13 | Cualquier usuario activo puede cambiar el estado del paciente; queda firmado con su identidad de sesión |
| RF-14 | El panel muestra quién está a cargo ahora y desde hace cuánto |
| RF-15 | El panel muestra **las dosis pendientes y atrasadas del día** 🆕 |
| RF-16 | El panel muestra indicadores tocables: dosis pendientes, tareas pendientes, tareas listas, medicamentos por agotarse e inventario bajo mínimo |
| RF-17 | El panel muestra el progreso del día en porcentaje de tareas completadas |
| RF-18 | El panel muestra las notas del turno anterior no leídas |
| RF-19 | El panel lista las alertas activas con acceso directo al módulo correspondiente |
| RF-20 | El panel lista las próximas citas a 7 días |

### 3.4 Equipo de cuidado y turnos — `js/roles.js`

| ID | Requisito |
|---|---|
| RF-21 | El sistema provee 7 roles de cuidado predefinidos y permite crear otros con nombre e ícono |
| RF-22 | Los roles predefinidos no se pueden eliminar; los creados por el usuario sí |
| RF-23 | Cada usuario del sistema tiene nombre, teléfono/WhatsApp, notas y un rol de cuidado |
| RF-24 | Se puede llamar por teléfono a cualquier miembro del equipo desde su ficha (enlace `tel:`) |
| RF-25 | Un usuario activo puede tomar el turno; el turno anterior se cierra y archiva automáticamente |
| RF-26 | El turno se puede cerrar explícitamente dejando a nadie a cargo |
| RF-27 | El sistema conserva el historial completo de turnos con persona, rol, inicio, fin y duración |
| RF-28 | El cuidador saliente puede dejar una nota de texto libre para el turno entrante |
| RF-29 | Las notas de turno se pueden marcar como leídas |

> **Cambio respecto a v1:** las personas ya no son registros sueltos dentro de un rol. Cada persona
> del equipo **es un usuario del sistema** con su propia cuenta. Esto es lo que hace que la firma de
> acciones y la auditoría signifiquen algo.

### 3.5 Medicamentos — abastecimiento — `js/medications.js`

| ID | Requisito |
|---|---|
| RF-30 | Registrar un medicamento con nombre, médico prescriptor, indicación, fecha de inicio, notas y estado (Activo / Pausado / Suspendido) |
| RF-31 | Registrar stock actual y unidad de medida |
| RF-32 | El sistema calcula los días restantes de stock a partir del **consumo diario derivado de los horarios programados** (RF-38); si no hay horarios, usa un consumo diario declarado manualmente |
| RF-33 | Los medicamentos se pueden buscar por nombre o prescriptor y filtrar por estado |
| RF-34 | Marcar un medicamento como "necesita reposición" lo destaca visualmente |
| RF-35 | El sistema genera un mensaje de solicitud de reposición prellenado y lo abre en WhatsApp, con stock, consumo y referencia de la última compra |
| RF-36 | Registrar una reposición con cantidad, establecimiento, costo y responsable; suma al stock y limpia la marca de reposición |
| RF-37 | Toda reposición con costo > 0 genera automáticamente un gasto en la categoría Medicamentos |
| RF-38 | Consultar el historial completo de reposiciones de cada medicamento |

### 3.6 Medicamentos — administración de dosis — `js/administration.js` 🆕

> Este módulo cierra la brecha funcional más importante de v1: el sistema gestionaba el
> **abastecimiento** de medicamentos pero no su **administración**. No existía registro de "se dio la
> dosis de las 14:00", con el riesgo de doble dosis u omisión silenciosa en un cambio de turno.

| ID | Requisito |
|---|---|
| RF-39 | Definir uno o varios horarios de dosis por medicamento (hora del día + cantidad) |
| RF-40 | Un horario se puede activar o desactivar sin borrarlo, para pausas temporales indicadas por el médico |
| RF-41 | El sistema deriva las **dosis del día** cruzando los horarios activos con las administraciones ya registradas de hoy |
| RF-42 | Cada dosis se marca como **Administrada**, **Omitida** o **Rechazada por el paciente**, con hora real, notas opcionales y firma automática del usuario en sesión |
| RF-43 | Marcar una dosis como *Administrada* **descuenta el stock de forma atómica en la base de datos**, no en el cliente |
| RF-44 | Una dosis cuya hora ya pasó y sigue sin registrar se muestra como **atrasada**, destacada visualmente |
| RF-45 | El sistema impide registrar dos veces la misma dosis programada del mismo día |
| RF-46 | Una dosis registrada por error se puede corregir; la corrección revierte el descuento de stock y queda en la auditoría |
| RF-47 | Consultar el historial de administración por medicamento y por día, con quién administró cada dosis |
| RF-48 | El consumo diario de cada medicamento se deriva de la suma de sus dosis programadas activas |

> **Alcance deliberado:** el sistema **no emite recordatorios push ni notificaciones fuera de la
> app.** Requeriría un servicio de notificaciones y, en iOS, una PWA instalada con permisos
> concedidos — complejidad desproporcionada para el tier gratuito. Las dosis atrasadas se destacan
> al abrir la app. Esto debe quedar claro para los cuidadores: **CuidApp registra la
> administración, no la recuerda.**

### 3.7 Inventario — `js/inventory.js`

| ID | Requisito |
|---|---|
| RF-49 | Registrar ítems con nombre, categoría, stock, unidad, umbral mínimo, rol responsable y notas |
| RF-50 | El sistema provee 6 categorías base y permite crear nuevas |
| RF-51 | Ajustar el stock de a una unidad con botones +/− desde la lista, sin abrir formulario |
| RF-52 | El sistema impide restar más unidades de las existentes |
| RF-53 | Cada movimiento de stock se registra con fecha, cantidad, nota y autor |
| RF-54 | El sistema estima el consumo promedio diario como **total consumido ÷ días calendario transcurridos** desde el primer movimiento |
| RF-55 | Con menos de **7 días** de historial, el sistema muestra "recopilando datos" en lugar de una proyección |
| RF-56 | Los ítems por debajo del mínimo se destacan visualmente y generan alerta |
| RF-57 | Los ítems se pueden buscar por nombre y filtrar por categoría |

> **RF-54 corrige un defecto de v1.** `getAvgDailyConsumption` dividía el consumo total entre el
> **número de movimientos registrados**, no entre los días transcurridos. Tres descuentos el mismo
> día producían un "promedio diario" artificialmente bajo y una proyección de duración optimista —
> precisamente el error más peligroso en gestión de insumos críticos.
>
> **RF-55 es una guarda de confianza.** Una proyección calculada sobre un único movimiento es ruido
> presentado como certeza. En insumos de cuidado, no mostrar nada es mejor que mostrar un número
> inventado.

### 3.8 Tareas — `js/tasks.js`

| ID | Requisito |
|---|---|
| RF-58 | Crear tareas con título, descripción, turno (Mañana/Tarde/Noche/Cualquiera), fecha, persona o rol asignado |
| RF-59 | Las tareas se agrupan por turno, con contador de completadas por grupo |
| RF-60 | Una tarea puede marcarse como urgente y se muestra en un bloque destacado al inicio |
| RF-61 | El estado rota con un toque: Pendiente → En progreso → Completada → Pendiente |
| RF-62 | Las tareas admiten comentarios firmados con autor y fecha |
| RF-63 | Se pueden definir **plantillas de tareas recurrentes** con los días de la semana en que aplican |
| RF-64 | Las tareas recurrentes del día se generan **al abrir la aplicación**, no al entrar al módulo de tareas |
| RF-65 | Se puede consultar y editar las tareas de cualquier fecha mediante un selector de día |
| RF-66 | El sistema muestra el progreso del día seleccionado en porcentaje |

> **RF-64 corrige un riesgo operativo de v1.** La generación se disparaba solo al abrir el panel de
> Tareas y solo para el día en curso: si nadie entraba a esa pantalla, ese día simplemente no tenía
> lista de verificación. En v2 la generación es idempotente (una plantilla no puede instanciarse dos
> veces el mismo día) y ocurre al iniciar la app.

### 3.9 Agenda médica — `js/agenda.js`

| ID | Requisito |
|---|---|
| RF-67 | Registrar citas con título, fecha, hora, especialidad, médico, lugar, modalidad (presencial/telemedicina), preparación previa y notas |
| RF-68 | Las citas se separan en "Próximas" e "Historial" |
| RF-69 | Las citas muestran cuenta regresiva y color según urgencia (≤1 día crítico, ≤3 días alerta) |
| RF-70 | La preparación previa (ayuno, documentos) se destaca visualmente |
| RF-71 | Una cita se marca como realizada capturando notas de resultado y seguimiento |

### 3.10 Alimentación y compras — `js/food.js`

| ID | Requisito |
|---|---|
| RF-72 | **Recetario:** crear preparaciones con nombre, ingredientes (cantidad/unidad/nombre), instrucciones y notas |
| RF-73 | Una receta puede aplicar a varios tiempos de comida (Desayuno / Almuerzo / Cena) y filtrarse por ellos |
| RF-74 | **Planificador:** cuadrícula semanal de 7 días × 3 comidas; cada celda admite varias recetas |
| RF-75 | **Complementos:** catálogo de bebidas, contornos, snacks y otros, con ingredientes si son caseros |
| RF-76 | **Generación de compras:** consolidar los ingredientes del plan semanal por fecha, sumando cantidades numéricas y eliminando repetidos del mismo día |
| RF-77 | Antes de agregar a compras, el usuario selecciona ingrediente por ingrediente, con "Todos / Ninguno" |
| RF-78 | La lista de compras separa pendientes de comprados, con marcado por toque |
| RF-79 | Se puede archivar solo lo comprado manteniendo lo pendiente, o confirmar la compra completa |
| RF-80 | La lista de compras se envía por WhatsApp con formato (pendientes, y comprados tachados) |
| RF-81 | La lista de compras se envía por Telegram |
| RF-82 | La lista de compras se convierte en tarea asignada a un rol y turno, con el detalle en la descripción |
| RF-83 | Se pueden agregar, editar y eliminar ítems de compra manualmente |

### 3.11 Alertas derivadas — `js/ui.js`

> **Cambio de diseño respecto a v1.** v1 *almacenaba* las notificaciones. Pero las alertas son
> **derivadas** de los datos: "queda poco stock" es una consecuencia del stock, no un hecho
> independiente. Almacenarlas con varios dispositivos produce estados de "leído" divergentes y
> alertas fantasma de condiciones ya resueltas. En v2 se calculan en vivo en cada carga.

| ID | Requisito |
|---|---|
| RF-84 | El sistema calcula en vivo las alertas de: dosis atrasadas, medicamentos con ≤3 días de stock, inventario bajo mínimo y citas a ≤2 días |
| RF-85 | Las alertas se recalculan al cargar la app y al volver a ella tras estar en segundo plano |
| RF-86 | Una alerta desaparece por sí sola cuando la condición que la causó deja de cumplirse |
| RF-87 | El contador de alertas activas se muestra en la campana del encabezado |
| RF-88 | El sistema muestra avisos efímeros (toasts) de info/éxito/advertencia/error para toda acción del usuario |

### 3.12 Emergencia — `js/app.js`

| ID | Requisito |
|---|---|
| RF-89 | Un botón flotante de emergencia está visible en todo momento y sobre todas las pantallas |
| RF-90 | El botón abre un diálogo con llamada telefónica directa y WhatsApp al contacto de emergencia |
| RF-91 | El mensaje de WhatsApp va prellenado con texto de asistencia urgente |

### 3.13 Gastos — `js/expenses.js`

| ID | Requisito |
|---|---|
| RF-92 | Registrar gastos con descripción, monto, fecha, categoría y responsable |
| RF-93 | El sistema totaliza el gasto del mes en curso y cuenta las transacciones |
| RF-94 | Se listan los gastos con paginación y opción de eliminar |

### 3.14 Configuración — `js/settings.js`

| ID | Requisito |
|---|---|
| RF-95 | El admin configura el nombre del paciente y el contacto de emergencia (nombre, teléfono, WhatsApp) |
| RF-96 | Cualquier usuario puede editar su propio nombre, teléfono y rol de cuidado |
| RF-97 | Cualquier usuario puede cerrar sesión desde la configuración |
| RF-98 | El admin puede exportar todos los datos a un archivo JSON descargable |

> **Retirado de v1:** el botón "Reiniciar datos" desaparece de la interfaz. Con datos compartidos en
> la nube y auditoría activa, un botón que borra todo el expediente al alcance de cualquier toque es
> un riesgo sin contrapartida. Si alguna vez hace falta, se hace desde el panel de Supabase.

### 3.15 Modo "¿Qué hago ahora?" — `js/app.js`

| ID | Requisito |
|---|---|
| RF-99 | Una vista simplificada a pantalla completa lista lo pendiente del día —**dosis primero, luego tareas**— para cuidadores nuevos o con poca familiaridad con la app |

### 3.16 Auditoría — `js/audit.js` (solo admin) 🆕

| ID | Requisito |
|---|---|
| RF-100 | El sistema registra automáticamente toda alta, modificación y baja en cualquier tabla de negocio |
| RF-101 | Cada registro de auditoría guarda: fecha y hora, usuario responsable, módulo afectado, tipo de acción y los **campos que cambiaron** con su valor anterior y nuevo |
| RF-102 | El registro de auditoría es **inmutable**: nadie, ni siquiera un admin, puede modificarlo o borrarlo desde la aplicación |
| RF-103 | Solo un admin puede consultar la auditoría |
| RF-104 | La auditoría se puede filtrar por módulo, por usuario y por rango de fechas |
| RF-105 | La auditoría se presenta en lenguaje llano ("María cambió el stock de Gasas de 12 a 8"), no como volcado técnico |
| RF-106 | La auditoría se consulta paginada, sin cargar el historial completo de una vez |

> **Por qué por trigger de base de datos y no por código de aplicación:** si cada módulo JS tuviera
> que registrar sus propios cambios, bastaría un olvido del programador —o un cliente modificado—
> para que una acción no quedara registrada. Con triggers de PostgreSQL, la auditoría ocurre dentro
> de la misma transacción que el cambio: **o se registran ambos, o no ocurre ninguno.**

---

## 4. Requisitos No Funcionales (RNF)

### 4.1 Plataforma y conectividad

| ID | Requisito |
|---|---|
| RNF-01 | El sistema es una aplicación web accesible desde cualquier navegador moderno, sin instalación |
| RNF-02 | El frontend se despliega como sitio estático en **Vercel (plan Hobby / gratuito)** |
| RNF-03 | Los datos y la autenticación residen en **Supabase (plan gratuito)** |
| RNF-04 | El sistema **requiere conexión a internet** para operar |
| RNF-05 | Sin conexión, el sistema muestra un aviso explícito y honesto; no presenta datos potencialmente obsoletos como si fueran actuales |
| RNF-06 | Toda comunicación viaja sobre HTTPS |
| RNF-07 | El despliegue se activa automáticamente al publicar cambios en la rama principal del repositorio |

> **Cambio de fondo respecto a v1.** v1 funcionaba sin internet porque los datos vivían en el
> dispositivo. Eso era una virtud, pero **impedía que dos cuidadores compartieran información** — el
> servidor escuchaba solo en `localhost` y ningún teléfono podía conectarse, pese a que la interfaz
> prometía uso móvil. v2 cambia autonomía por coordinación real: es el intercambio que hace que el
> producto cumpla su objetivo.

### 4.2 Compatibilidad — iPhone y Safari

| ID | Requisito |
|---|---|
| RNF-08 | El sistema funciona en **Safari de iOS 15.4 o superior** en iPhone, como plataforma de referencia |
| RNF-09 | El sistema funciona además en Chrome, Edge y Firefox de escritorio, y en Chrome de Android |
| RNF-10 | El **zoom del navegador está permitido**; se eliminan `maximum-scale` y `user-scalable=no` |
| RNF-11 | Todos los campos de formulario usan `font-size` ≥ 16px, que es lo que evita el auto-zoom de iOS al enfocar un campo |
| RNF-12 | La interfaz respeta las áreas seguras del dispositivo (`viewport-fit=cover` + `env(safe-area-inset-*)`): no queda contenido bajo el notch, la Dynamic Island ni el indicador de inicio |
| RNF-13 | Las alturas a pantalla completa usan `100dvh` con respaldo `-webkit-fill-available`, para no romperse con la barra dinámica de Safari |
| RNF-14 | Todo elemento tocable mide al menos **44 × 44 px** (Apple Human Interface Guidelines) |
| RNF-15 | La app se puede añadir a la pantalla de inicio del iPhone con ícono y nombre propios (`manifest.json` + `apple-touch-icon`) |
| RNF-16 | Las propiedades CSS con soporte parcial en Safari llevan prefijo `-webkit-` cuando corresponde |

> **RNF-10 corrige un anti-patrón de v1.** v1 deshabilitaba el zoom para evitar desplazamientos
> accidentales. Pero **iOS Safari ignora esa directiva desde iOS 10**, así que no funcionaba; y en
> los navegadores donde sí funciona, impide ampliar el texto a quien lo necesita. La solución real al
> auto-zoom molesto es RNF-11.

### 4.3 Usabilidad

> Replanteados por completo. Los de v1 asumían una app local e instantánea; con una red de por medio
> cambian las premisas y aparecen modos de fallo nuevos.

| ID | Requisito |
|---|---|
| RNF-17 | **Sesión persistente:** la app no pide credenciales en cada apertura. La sesión se renueva sola y el formulario de acceso usa los atributos estándar de autocompletado para integrarse con el llavero de iOS |
| RNF-18 | **Respuesta perceptible ≤ 100 ms:** toda acción produce realimentación inmediata (estado de carga o actualización optimista). Nunca una pantalla congelada sin explicación |
| RNF-19 | **Nunca perder lo escrito:** si el guardado falla, el formulario conserva los datos introducidos y ofrece reintentar. Es el riesgo nuevo que introduce la red y el más irritante en uso real |
| RNF-20 | **Errores en lenguaje llano:** "No hay conexión. Tus cambios no se guardaron." Nunca un código HTTP ni un mensaje del motor de base de datos |
| RNF-21 | **Estado de carga honesto:** mientras llegan los datos se muestran esqueletos o indicadores, nunca listas vacías que parezcan "no hay nada" |
| RNF-22 | Las acciones frecuentes no requieren más de dos toques desde cualquier pantalla |
| RNF-23 | Toda acción destructiva requiere confirmación explícita |
| RNF-24 | La interfaz está íntegramente en español, con formato de fecha y moneda `es-ES` |
| RNF-25 | El lenguaje evita jerga técnica y los iconos refuerzan cada etiqueta, para usuarios de baja alfabetización digital |
| RNF-26 | El sistema debe ser utilizable por un cuidador que nunca lo ha visto antes (RF-99) |
| RNF-27 | Las pantallas críticas —dosis del día y tareas— son legibles con una sola mano y a brazo extendido: tipografía ≥ 16px y contraste AA |

### 4.4 Seguridad

| ID | Requisito |
|---|---|
| RNF-28 | Ningún dato del paciente es accesible sin sesión autenticada **y** perfil activo |
| RNF-29 | El control de acceso se aplica en la base de datos mediante **Row Level Security**, no en el cliente. Un cliente modificado no puede saltárselo |
| RNF-30 | La `anon key` de Supabase es pública por diseño y puede publicarse en el repositorio; la `service_role key` **nunca** debe aparecer en el código del frontend |
| RNF-31 | Todo dato introducido por el usuario se **escapa antes de insertarse en el DOM**, mediante una única función centralizada |
| RNF-32 | Las contraseñas las gestiona Supabase Auth; la aplicación nunca las almacena ni las procesa |
| RNF-33 | Los datos de auditoría son inmutables desde la aplicación (RF-102) |
| RNF-34 | La aplicación declara cabeceras de seguridad en `vercel.json`: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` |

> **RNF-31 corrige una vulnerabilidad real de v1.** Las funciones `escHtml` de v1 escapaban comillas
> para atributos `onclick`, **no entidades HTML**: un nombre como `<img src=x onerror=…>` ejecutaba
> código al renderizar la lista. En una app local de un solo hogar el vector era limitado; **expuesta
> en internet deja de serlo.** Es corrección obligatoria, no opcional.

### 4.5 Capacidad

Los topes FIFO de v1 (200 turnos, 100 notas, 1.000 gastos, 90 movimientos…) existían por la cuota de
~5 MB de `localStorage`. **Se eliminan todos.** PostgreSQL no los necesita, y truncar historial
clínico era una mala propiedad heredada de una limitación técnica, no una decisión de producto.

**Supuestos de uso:** un hogar, 1 paciente, entre 3 y 8 cuidadores, uso diario.

| ID | Requisito | Estimación |
|---|---|---|
| RNF-35 | La tabla de auditoría es la de mayor crecimiento y debe dimensionarse explícitamente | Ver cálculo abajo |
| RNF-36 | El trigger de auditoría guarda **solo los campos modificados**, no la fila completa | Reduce el tamaño de fila ~3× |
| RNF-37 | Se aplica una **política de retención de 24 meses** sobre la auditoría, ejecutada manualmente o por tarea programada | Mantiene el crecimiento acotado |
| RNF-38 | El resto de tablas no requiere poda | Crecimiento despreciable |

**Cálculo de crecimiento de la auditoría**

| Concepto | Valor |
|---|---|
| Escrituras estimadas por día (dosis, tareas, inventario, turnos, compras, gastos) | ~100 |
| Tamaño medio de fila de auditoría, solo campos modificados, incluidos índices | ~500 bytes |
| Crecimiento diario | ~50 KB |
| **Crecimiento anual** | **~18 MB** |
| Resto de tablas del negocio, al año | ~5 MB |
| **Total estimado al primer año** | **~25 MB** |
| Límite del plan gratuito de Supabase | 500 MB |
| **Margen** | **~20× — holgado** |

> **Conclusión honesta:** la auditoría **no** pone en riesgo el tier gratuito con este patrón de uso.
> La retención de RNF-37 es prudencia ante un crecimiento inesperado —una importación masiva, un
> bucle defectuoso— no una necesidad inmediata. Conviene revisar el tamaño real a los 3 meses en el
> panel de Supabase en lugar de confiar en esta estimación.

**Otros límites de los planes gratuitos**

| Recurso | Consumo estimado | Límite del plan | Margen |
|---|---|---|---|
| Usuarios activos mensuales (Supabase Auth) | 3–8 | 50.000 | Enorme |
| Transferencia de datos (Supabase) | ~100 MB/mes | 5 GB/mes | ~50× |
| Ancho de banda (Vercel Hobby) | < 1 GB/mes | 100 GB/mes | Enorme |
| Peso de la app en la primera carga | ~330 KB | — | Cacheado tras la primera visita |

| ID | Requisito |
|---|---|
| RNF-39 | **El plan gratuito de Supabase pausa el proyecto tras ~7 días sin actividad.** El uso diario previsto lo evita, pero debe estar documentado en el runbook de operación |
| RNF-40 | **El plan Hobby de Vercel es solo para uso no comercial.** El uso familiar previsto cumple esa condición |
| RNF-41 | Los límites vigentes de ambos planes deben verificarse en el momento del alta, no darse por fijos |

### 4.6 Rendimiento

| ID | Requisito |
|---|---|
| RNF-42 | La app carga en menos de 3 segundos sobre 4G en la primera visita, y bajo 1 segundo con caché |
| RNF-43 | Cada pantalla realiza el mínimo de consultas posible; se evita el patrón N+1 usando consultas con relaciones anidadas de PostgREST |
| RNF-44 | Las listas largas (auditoría, gastos, historial de turnos) se cargan paginadas |
| RNF-45 | Los recursos estáticos se sirven con caché de larga duración y las consultas de datos sin caché |

### 4.7 Mantenibilidad

| ID | Requisito |
|---|---|
| RNF-46 | Cada dominio funcional reside en un módulo independiente con interfaz pública explícita (patrón IIFE) |
| RNF-47 | **Todo acceso a datos pasa por `js/api.js`.** Ningún módulo llama a Supabase directamente |
| RNF-48 | El sistema no requiere compilación, empaquetado ni gestor de dependencias |
| RNF-49 | La única dependencia externa está vendorizada con versión fija en `js/vendor/` |
| RNF-50 | El esquema de base de datos vive en archivos `.sql` versionados en el repositorio, aplicables en orden sobre un proyecto vacío |
| RNF-51 | Añadir un módulo nuevo requiere solo: un `<script>`, una `<section>`, una entrada de navegación y un registro en el router |

> **RNF-51 es exactamente el requisito que el módulo de signos vitales incumplía en v1**: tenía 196
> líneas de código correcto y ninguno de los cuatro puntos de conexión. En v2 el módulo se retira
> (§9.3).

### 4.8 Trazabilidad y respaldo

| ID | Requisito |
|---|---|
| RNF-52 | Toda acción que modifica datos queda atribuida a un usuario identificado |
| RNF-53 | El admin puede exportar la totalidad de los datos en JSON (RF-98) |
| RNF-54 | Supabase mantiene respaldos automáticos según su plan; el runbook documenta la ventana de recuperación disponible y recomienda una exportación manual periódica |

---

## 5. Modelo de datos

Relacional, en PostgreSQL. Normaliza lo que en v1 eran arrays anidados en JSON.

### 5.1 Identidad y equipo

| Tabla | Contenido |
|---|---|
| `auth.users` | Gestionada por Supabase Auth (email, contraseña cifrada) |
| `profiles` | 1:1 con `auth.users`. Nombre, teléfono, notas, `care_role_id`, `app_role`, `active` |
| `care_roles` | Roles de cuidado: nombre, ícono, color, `is_default` |
| `shifts` | Turnos. El activo es el que tiene `ended_at IS NULL` |
| `shift_notes` | Traspasos entre turnos, con `read_at` |

### 5.2 Clínico y logístico

| Tabla | Contenido |
|---|---|
| `settings` | Fila única: nombre del paciente, contacto de emergencia |
| `patient_status` | Fila única: estado, quién y cuándo lo cambió, notas |
| `medications` | Medicamento, stock, unidad, estado, prescriptor, `needs_restock` |
| `medication_schedules` 🆕 | Horarios de dosis: `medication_id`, hora, dosis, activo |
| `medication_administrations` 🆕 | Registro de dosis: programada para, administrada a las, por quién, estado, dosis, notas |
| `medication_restocks` | Reposiciones: cantidad, establecimiento, costo, responsable |
| `inventory_items` | Ítem, categoría, stock, unidad, mínimo, rol responsable |
| `inventory_categories` | Nombres de categoría |
| `inventory_movements` | Movimientos con fecha, delta, nota y autor |
| `tasks` | Instancias de tarea con fecha, turno, estado, asignación |
| `task_templates` 🆕 | Plantillas recurrentes con días de la semana |
| `task_comments` | Comentarios firmados |
| `appointments` | Citas médicas |

### 5.3 Alimentación y finanzas

| Tabla | Contenido |
|---|---|
| `recipes` + `recipe_ingredients` | Recetario normalizado |
| `weekly_plan` | Fila por (día, comida, receta) |
| `complementos` + `complemento_ingredients` | Bebidas, contornos, snacks |
| `shopping_list` | Ítems de compra con estado de marcado |
| `expenses` | Gastos, con enlace opcional a la reposición que los originó |

### 5.4 Auditoría

| Tabla | Contenido |
|---|---|
| `audit_log` 🆕 | Tabla afectada, id del registro, acción, actor, campos modificados, valores anterior y nuevo, fecha |

### 5.5 Vistas y funciones

| Objeto | Propósito |
|---|---|
| `inventory_consumption_stats` (vista) | Promedio diario correcto: total consumido ÷ días calendario (RF-54) |
| `medication_daily_dose` (vista) | Consumo diario derivado de horarios activos (RF-48) |
| `medications_view` (vista) | Lectura compuesta: medicamento + dosis diaria + días restantes |
| `inventory_items_view` (vista) | Lectura compuesta: ítem + categoría + consumo + días restantes |
| `record_administration()` (función) | Registra dosis y descuenta stock atómicamente (RF-43) |
| `record_restock()` (función) | Registra reposición, suma stock y genera el gasto (RF-36, RF-37) |
| `adjust_inventory()` (función) | Ajusta stock y registra el movimiento (RF-51, RF-53) |
| `generate_recurring_tasks()` (función) | Instancia las plantillas del día, idempotente (RF-64) |
| `audit_trigger()` (función) | Auditoría genérica aplicada a todas las tablas (RF-100) |
| `handle_new_user()` (trigger) | Crea el perfil inactivo al registrarse un usuario (RF-02) |
| `guard_profile_update()` (trigger) | Impide auto-promoverse y que un admin se degrade (RF-11) |

> **Todas las vistas se declaran con `security_invoker = true`.** Sin esa cláusula, una vista de
> PostgreSQL se ejecuta con los permisos de quien la creó y **no aplica el RLS de sus tablas base**:
> cualquier usuario autenticado, incluso uno aún sin aprobar, podría leer el expediente a través de
> ella. Es un requisito de seguridad, no una preferencia de estilo.

### 5.6 Tablas eliminadas respecto a v1

| Estructura de v1 | Destino |
|---|---|
| `notifications` | **Eliminada.** Las alertas se derivan en vivo (§3.11) |
| `vitalLogs` | **Eliminada.** Módulo retirado (§9.3) |
| `roles[].people[]` | Normalizada en `profiles` — cada persona es ahora un usuario real |
| `medications[].consumption{}` | Aplanada en columnas de `medications` |
| `medications[].restockHistory[]` | Normalizada en `medication_restocks` |
| `inventory[].consumptionHistory[]` | Normalizada en `inventory_movements` |
| `tasks[]` con bandera `isTemplate` | Separada en `tasks` + `task_templates` |
| `settings.summaryTime`, `settings.initialized` | **Eliminadas.** Definidas y persistidas en v1, nunca leídas |

---

## 6. Integraciones entre módulos

Las integraciones cruzadas son el valor diferencial del sistema. v2 añade dos.

```
Dosis administrada ─────(función atómica)────▶ Descuento de stock        [RF-43] 🆕
Horarios de dosis ──────(vista derivada)─────▶ Días restantes de stock   [RF-48] 🆕
Reposición con costo ───────────────────────▶ Gasto automático          [RF-37]
Planificador semanal ───(consolida por fecha)▶ Lista de compras         [RF-76]
Complementos ───────────────────────────────▶ Lista de compras          [RF-75]
Lista de compras ───────(con rol y turno)───▶ Tarea                     [RF-82]
Lista de compras ───────────────────────────▶ WhatsApp / Telegram       [RF-80,81]
Dosis · Stock · Inventario · Citas ─────────▶ Alertas derivadas         [RF-84]
Cualquier escritura ────(trigger Postgres)──▶ Auditoría                 [RF-100] 🆕
Usuario en sesión ──────────────────────────▶ Firma de toda acción
Todos los módulos ──────────────────────────▶ Panel de inicio           [RF-12..20]
```

---

## 7. Restricciones de diseño

| # | Restricción | Origen |
|---|---|---|
| R-1 | Sin framework de frontend, sin build, sin `package.json` | Requisito del usuario: minimizar dependencias |
| R-2 | Una sola dependencia externa, vendorizada | Ídem |
| R-3 | Sin funciones serverless ni backend propio | Decisión de arquitectura: RLS como capa de seguridad |
| R-4 | Debe operar dentro de los planes gratuitos de Vercel y Supabase | Requisito del usuario |
| R-5 | Sin suites de pruebas automatizadas; verificación manual por lista de comprobación | Requisito del usuario |
| R-6 | Un solo hogar y un solo paciente | Decisión acordada |
| R-7 | Sin notificaciones push | Consecuencia de R-3 y R-4 |

---

## 8. Riesgos conocidos y aceptados

| # | Riesgo | Mitigación / aceptación |
|---|---|---|
| A-1 | **Sin internet no hay app.** Un corte deja a los cuidadores sin acceso al expediente | Aceptado (RNF-04). Mitigación: la app avisa con claridad. Si resulta un problema real en uso, la caché de solo lectura es la evolución natural |
| A-2 | **El sistema no recuerda las dosis**, solo las registra | Aceptado (§3.6). Debe comunicarse explícitamente a los cuidadores para no crear falsa confianza |
| A-3 | La seguridad depende por completo de que las políticas RLS sean correctas | Mitigación: verificación explícita en la lista de comprobación del despliegue — intentar leer datos sin sesión y con perfil inactivo |
| A-4 | El proyecto gratuito de Supabase se pausa tras ~7 días sin uso | Documentado en el runbook (RNF-39) |
| A-5 | Dos cuidadores editando el mismo registro: gana el último | Aceptado. El riesgo real es bajo y la auditoría permite reconstruir qué pasó |
| A-6 | Pérdida de la cuenta de admin | Mitigación: crear al menos dos admins desde el inicio |

---

## 9. Trazabilidad v1 → v2

### 9.1 Requisitos funcionales nuevos

| Bloque | RF | Motivo |
|---|---|---|
| Autenticación y sesión | RF-01..06 | Brecha de diseño: v1 no tenía control de acceso |
| Gestión de usuarios | RF-07..11 | Consecuencia de la autenticación |
| Administración de dosis | RF-39..48 | Brecha funcional de mayor peso clínico en v1 |
| Auditoría | RF-100..106 | Requisito nuevo del usuario |

### 9.2 Requisitos modificados

| RF v2 | Cambio |
|---|---|
| RF-54, RF-55 | **Corrige** el defecto de cálculo de consumo promedio de v1 |
| RF-64 | **Corrige** el riesgo de que las tareas recurrentes no se generen |
| RF-84..87 | Las alertas pasan de almacenadas a derivadas |
| RF-23, RF-25 | Las personas del equipo pasan a ser usuarios reales con cuenta |
| RF-32, RF-48 | El consumo diario pasa de declarado a derivado de los horarios |
| RF-95 | La configuración global pasa a ser exclusiva del admin |

### 9.3 Requisitos eliminados

| RF v1 | Motivo |
|---|---|
| RF-85..88 (signos vitales) | **Retirados a petición del usuario: no son necesarios.** El módulo `js/vitals.js` se elimina del repositorio junto con su modelo de datos. Esto resuelve de paso el riesgo de pérdida de datos de la §6.4 de v1 (`vitalLogs` ausente de `DEFAULTS`): el problema desaparece con el módulo |
| RF-82 v1 (reiniciar datos) | Retirado de la interfaz: demasiado destructivo para datos compartidos (§3.14) |
| RF-74 v1 (marcar notificaciones leídas) | Sin sentido con alertas derivadas |

### 9.4 Requisitos no funcionales sustituidos

| RNF v1 | Estado en v2 |
|---|---|
| RNF-01 v1 — opera sin internet | **Invertido.** v2 requiere conexión (RNF-04). Ver §4.1 |
| RNF-02..05 v1 — arranque por `.bat`, PowerShell, puertos | **Eliminados.** No hay servidor local |
| RNF-06..11 v1 — `localStorage` + archivo JSON | **Sustituidos** por PostgreSQL |
| RNF-12..18 v1 — topes FIFO | **Eliminados.** Sustituidos por §4.5 |
| RNF-20 v1 — zoom deshabilitado | **Revertido** por accesibilidad (RNF-10) |
| RNF-39 v1 — protección de datos de salud | De **incumplido** a cumplido vía RLS (RNF-28, RNF-29) |
| RNF-40 v1 — neutralización de entradas | De **incumplido** a cumplido vía escapado centralizado (RNF-31) |
| RNF-46..49 v1 — compatibilidad y portabilidad Windows | **Sustituidos** por §4.2 (iOS/Safari) |

---

## 10. Resumen

**106 requisitos funcionales**, de los cuales 26 son nuevos y 4 se retiran respecto a v1.
**54 requisitos no funcionales**, replanteados por completo para plataforma web.

Las cuatro brechas de diseño identificadas en v1 quedan cerradas:

| Brecha v1 | Cierre en v2 |
|---|---|
| Sin autenticación | RF-01..11 + RNF-28..29 (RLS) |
| Medicamentos sin administración de dosis | RF-39..48 (módulo nuevo) |
| Cálculo de consumo de inventario defectuoso | RF-54..55 (vista SQL corregida + guarda de confianza) |
| Módulo de signos vitales huérfano | Retirado por completo (§9.3) |

Y dos vulnerabilidades que en v1 eran teóricas por correr en `localhost` pasan a ser corregidas
obligatoriamente al exponerse en internet: **control de acceso** (RNF-29) y **escapado de entradas
del usuario** (RNF-31).
