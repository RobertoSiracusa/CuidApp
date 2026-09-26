# CuidApp — Cuidados en Casa

**CuidApp** coordina el cuidado domiciliario de un paciente crítico entre familiares, enfermeros, cuidadores y médicos: turnos y personal, menú y compras, y control de insumos y medicamentos por nivel de prioridad, con auditoría integral.

**Producción:** https://cuid-app-ten.vercel.app/

---

##  Stack Tecnológico

- **Frontend:** HTML5 + CSS3 (diseño optimizado para Safari en iOS) + JavaScript modular (IIFE).
- **Sin paso de build:** Sin frameworks (React, Vue, etc.), sin `npm`, sin bundlers ni `package.json`.
- **Backend & Base de Datos:** [Supabase](https://supabase.com) (PostgreSQL 15+, GoTrue Auth, Row Level Security, triggers de auditoría).
- **Despliegue:** [Vercel](https://vercel.com) como sitio web estático bajo HTTPS.
- **Dependencias externas:** Únicamente `@supabase/supabase-js` v2, vendorizada localmente en `js/vendor/supabase.js`.

---

##  Ejecución en Local

Para ejecutar CuidApp en entorno de desarrollo local basta con servir los archivos mediante cualquier servidor estático:

1. **Con Live Server (VS Code):** Clic derecho en `index.html` → *Open with Live Server*.
2. **Con Python:**
   ```bash
   python -m http.server 8000
   ```
3. `js/config.js` ya viene con las credenciales de Supabase configuradas y versionadas. La clave que
   contiene es pública por diseño (una `publishable key`, no la `service_role`): lo que protege los
   datos es la Row Level Security en Supabase, no mantenerla en secreto. No hace falta tocar nada
   para conectarse al backend real.

### Modo local sin Supabase

`js/config.js` tiene un flag `LOCAL_MODE`. En `true`, la app opera 100% en el navegador y persiste
los datos en `localStorage` de ese equipo (vía `js/local-store.js`), sin necesitar internet ni una
cuenta de Supabase — útil para probar la interfaz rápido. En `false` (el valor actual en el
repositorio), la app se conecta a Supabase en la nube con las credenciales indicadas en el mismo
archivo.

---

##  Documentación

- [Especificación de Requisitos (SRS v2.0)](docs/ESPECIFICACION-REQUISITOS.md)
- [Plan de Desarrollo](docs/PLAN-DESARROLLO.md)
- [Tutorial de Cuentas y Roles](docs/TUTORIAL-CUENTAS.md)
- [Guía de Despliegue en Vercel y Supabase](docs/DEPLOY.md)

---

## Créditos

El código de CuidApp fue desarrollado por un familiar, en buena medida asistido por IA.

Roberto Siracusa se encargó únicamente del despliegue: configuración del proyecto en
Supabase, conexión de la aplicación al backend y publicación en Vercel. No participó
del desarrollo de la aplicación.
