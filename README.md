# CuidApp — Cuidados en Casa

**CuidApp** coordina el cuidado domiciliario de un paciente crítico entre familiares, enfermeros, cuidadores y médicos: turnos, administración de dosis de medicamentos, control de insumos e inventario, tareas por turno, agenda médica, alimentación, compras y registro de gastos con auditoría integral.

---

## 🛠️ Stack Tecnológico

- **Frontend:** HTML5 + CSS3 (diseño optimizado para Safari en iOS) + JavaScript modular (IIFE).
- **Sin paso de build:** Sin frameworks (React, Vue, etc.), sin `npm`, sin bundlers ni `package.json`.
- **Backend & Base de Datos:** [Supabase](https://supabase.com) (PostgreSQL 15+, GoTrue Auth, Row Level Security, triggers de auditoría).
- **Despliegue:** [Vercel](https://vercel.com) como sitio web estático bajo HTTPS.
- **Dependencias externas:** Únicamente `@supabase/supabase-js` v2, vendorizada localmente en `js/vendor/supabase.js`.

---

## 🚀 Ejecución en Local

Para ejecutar CuidApp en entorno de desarrollo local basta con servir los archivos mediante cualquier servidor estático:

1. **Con Live Server (VS Code):** Clic derecho en `index.html` → *Open with Live Server*.
2. **Con Python:**
   ```bash
   python -m http.server 8000
   ```
3. Configurar las credenciales de Supabase en `js/config.js`.

---

## 📚 Documentación

- [Especificación de Requisitos (SRS v2.0)](docs/ESPECIFICACION-REQUISITOS.md)
- [Plan de Desarrollo](docs/PLAN-DESARROLLO.md)
- [Tutorial de Cuentas y Roles](docs/TUTORIAL-CUENTAS.md)
- [Guía de Despliegue en Vercel y Supabase](docs/DEPLOY.md)
