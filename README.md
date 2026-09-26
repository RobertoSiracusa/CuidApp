# CuidApp — Cuidados en Casa

**CuidApp** es una aplicación web, pensada para usarse desde el iPhone, que ayuda a coordinar el cuidado domiciliario de un paciente entre familiares, cuidadores, enfermería y médicos.

**Producción:** https://cuid-app-ten.vercel.app/

## Qué hace

| Módulo | Para qué sirve | Quién lo usa |
|---|---|---|
| 🏥 **Inicio** | Resumen del día: avisos de insumos, menú de hoy, lista de compra, notas de relevo y alertas | Todos |
| 🍽️ **Menú** | Recetas, planificación semanal, complementos y lista de compras (con envío por WhatsApp) | Todos |
| 📦 **Insumos** | Registro de insumos y medicamentos con stock objetivo y prioridad; revisiones periódicas según el nivel | Solo admin |
| 👥 **Roles y Personal** | Equipo de cuidado, turnos, notas de relevo y aprobación de cuentas | Todos (Usuarios: solo admin) |
| ⚙️ **Configuración** | Perfil propio, datos del paciente y sesión | Todos (datos del paciente: solo admin) |
| 🔍 **Auditoría** | Registro inmutable de todos los cambios, en lenguaje llano | Solo admin |
| 💾 **Guardar copia** | Descarga un respaldo completo en JSON | Solo admin |

La navegación es un **sidebar**. En el iPhone se abre con ☰ y en pantallas de 900 px o más queda fijo.

## Stack

- **Frontend:** HTML, CSS y JavaScript sin frameworks ni paso de build. Cada módulo es un archivo en `js/`.
- **Backend:** [Supabase](https://supabase.com) (PostgreSQL, autenticación, Row Level Security y triggers de auditoría).
- **Hosting:** [Vercel](https://vercel.com) como sitio estático. Cada cambio en `main` se publica solo.
- **Única dependencia:** `@supabase/supabase-js` v2, incluida en `js/vendor/supabase.js`.

## Estructura

```
index.html            Página única: pantallas de acceso, sidebar, paneles y modales
css/styles.css        Estilos (modo oscuro, pensado para iPhone)
js/
  config.js           URL y clave pública de Supabase, flag LOCAL_MODE
  auth.js             Sesión, registro, aprobación y rol (admin / cuidador)
  api.js              Capa de datos: todo acceso a Supabase pasa por aquí
  local-store.js      Almacenamiento en el navegador (modo local y parte del Menú)
  ui.js               Modales, confirmaciones, avisos y panel de alertas
  app.js              Navegación, sidebar y arranque
  dashboard.js        Inicio
  food.js             Menú
  stock.js            Insumos
  roles.js            Roles y Personal
  settings.js         Configuración y copia de seguridad
  audit.js            Auditoría
supabase/             Scripts SQL, numerados en orden de ejecución
docs/                 Documentación
```

## Puesta en marcha rápida

1. En Supabase → **SQL Editor**, ejecuta los archivos de `supabase/` en orden (de `01` a `08`). El detalle está en la [documentación técnica](docs/DOCUMENTACION-TECNICA.md#4-base-de-datos).
2. Crea el primer administrador ([procedimiento](docs/DOCUMENTACION-TECNICA.md#6-primer-administrador)).
3. Para desarrollo local, sirve la carpeta con cualquier servidor estático, por ejemplo con *Live Server* de VS Code o con `python -m http.server 8000`.

`js/config.js` ya trae la URL y la clave **pública** de Supabase. Esa clave no es secreta: lo que protege los datos es la Row Level Security. **Nunca** pongas la clave `service_role` en el repositorio.

## Documentación

| Documento | Contenido |
|---|---|
| [Plano del MVP](docs/MVP.md) | Mapa de lo que tiene la aplicación hoy, en una página |
| [Manual de usuario](docs/MANUAL-USUARIO.md) | Cómo se usa cada pantalla, para cuidadores y administradores |
| [Casos de uso](docs/CASOS-DE-USO.md) | Actores y flujos principales, paso a paso |
| [Documentación técnica](docs/DOCUMENTACION-TECNICA.md) | Arquitectura, datos, seguridad, despliegue, operación y límites conocidos |

## Créditos

El código de CuidApp fue desarrollado por un familiar, en buena medida asistido por IA.

Roberto Siracusa se encargó únicamente del despliegue: configuración del proyecto en Supabase, conexión de la aplicación al backend y publicación en Vercel. No participó del desarrollo de la aplicación.
