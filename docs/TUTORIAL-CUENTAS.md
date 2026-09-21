# CuidApp — Tutorial de registro de cuentas

**Para quién es este documento:** para quien va a poner CuidApp en internet, **sin necesidad de
experiencia técnica previa**.
**Tiempo estimado:** 30–45 minutos.
**Costo:** ninguno. Las tres herramientas tienen plan gratuito suficiente para este proyecto.

> **Antes de empezar, una advertencia sobre las capturas:** GitHub, Vercel y Supabase cambian el
> diseño de sus páginas con frecuencia. Los botones pueden llamarse ligeramente distinto o estar en
> otro sitio. Este tutorial describe **qué buscar**, no dónde está exactamente el píxel. Si un
> nombre no coincide, busca el que más se parezca.

---

## Qué vas a crear y por qué

CuidApp necesita tres cosas para funcionar en internet. Piensa en ello como montar una consulta:

| Herramienta | Qué hace | La analogía |
|---|---|---|
| **GitHub** | Guarda el código de la aplicación | El archivador donde vive el expediente del proyecto |
| **Supabase** | Guarda los datos y controla quién entra | La caja fuerte con los expedientes de los pacientes y el guardia de la puerta |
| **Vercel** | Publica la aplicación en internet | La sala de espera: lo que la gente ve cuando llega |

Los tres se conectan entre sí: **GitHub guarda → Vercel publica → Supabase responde con los datos.**

### Lo que vas a necesitar tener a mano

- Un correo electrónico al que tengas acceso.
- Un gestor de contraseñas o un lugar seguro donde anotar datos. **No un papel en el escritorio.**
- Unos 45 minutos sin interrupciones.

### Lo que vas a obtener al final

Dos datos que hay que copiar al proyecto. Anótalos según los vayas consiguiendo:

```
URL del proyecto Supabase:  https://__________________.supabase.co
Clave pública (anon key):   ________________________________________
```

---

# Parte 1 — GitHub

## 1.1 Qué es y por qué lo necesitas

GitHub guarda el código. Vercel lo lee de ahí para publicarlo: **cada vez que el código cambia en
GitHub, Vercel publica la nueva versión automáticamente.** Sin GitHub tendrías que subir los
archivos a mano cada vez.

## 1.2 Crear la cuenta

1. Entra en **https://github.com** y pulsa **Sign up**.
2. Escribe tu correo electrónico.
3. Crea una contraseña. **Que sea larga y única** — esta cuenta va a controlar el código de una
   aplicación con datos de salud.
4. Elige un nombre de usuario. Será público y visible; algo como `liliana-cuidapp` sirve.
5. Resuelve el pequeño acertijo de verificación que te muestre la página.
6. Busca en tu correo el código de GitHub e introdúcelo.
7. Si te pregunta por tus intereses o el tamaño de tu equipo, puedes saltar esas preguntas: no
   afectan a nada.

## 1.3 Activar la verificación en dos pasos

**Esto no es opcional.** Si alguien entra en tu GitHub, puede modificar la aplicación que usan los
cuidadores del paciente.

1. Pulsa tu foto de perfil, arriba a la derecha → **Settings**.
2. En el menú lateral: **Password and authentication**.
3. Busca **Two-factor authentication** y pulsa **Enable**.
4. La forma más sencilla es con una app del móvil (Google Authenticator, Microsoft Authenticator o
   el propio llavero del iPhone). Escanea el código que aparece en pantalla.
5. **Guarda los códigos de recuperación** que te muestre. Son tu única salida si pierdes el móvil.

## 1.4 Crear el repositorio del proyecto

Un "repositorio" es simplemente la carpeta del proyecto dentro de GitHub.

1. Pulsa el **+** de arriba a la derecha → **New repository**.
2. **Repository name:** `cuidapp`
3. **Description:** `Gestión de cuidados domiciliarios`
4. **Elige Private.** Es importante: aunque el código no contenga contraseñas, no hay motivo para
   publicarlo, y mantenerlo privado reduce la superficie de riesgo.
5. **No marques** ninguna de las casillas de abajo ("Add a README", ".gitignore", "license"): el
   proyecto ya tiene sus propios archivos y esas opciones estorbarían.
6. Pulsa **Create repository**.

## 1.5 Subir el código

La página que ves ahora muestra unas instrucciones con comandos. Tienes dos caminos:

**Opción A — Antigravity lo hace por ti (recomendado).** Dile que suba el proyecto al repositorio
que acabas de crear. Copia la dirección del repositorio (algo como
`https://github.com/tu-usuario/cuidapp.git`) y pásasela.

**Opción B — GitHub Desktop.** Si prefieres hacerlo con el ratón, descarga **GitHub Desktop** desde
https://desktop.github.com, inicia sesión, elige *Add existing repository*, selecciona la carpeta
de CuidApp y pulsa *Publish*.

✅ **Comprobación:** al recargar la página del repositorio deberías ver las carpetas `css`, `js`,
`docs`, `supabase` y el archivo `index.html`.

---

# Parte 2 — Supabase

Esta es la parte más importante: aquí viven los datos del paciente.

## 2.1 Qué es y por qué lo necesitas

Supabase hace dos trabajos:

- **Guarda los datos** — medicamentos, dosis, tareas, inventario, todo.
- **Controla quién entra** — gestiona las cuentas de los cuidadores y verifica las contraseñas.

## 2.2 Crear la cuenta

1. Entra en **https://supabase.com** y pulsa **Start your project**.
2. Lo más cómodo es **Continue with GitHub**: reutiliza la cuenta que acabas de crear y no tienes
   que recordar otra contraseña.
3. Autoriza el acceso cuando GitHub te lo pida.

## 2.3 Crear el proyecto

1. Pulsa **New project**.
2. **Organization:** si te pide crear una, ponle tu nombre o "Personal".
3. **Name:** `cuidapp`
4. **Database Password:** pulsa **Generate a password** y **guárdala inmediatamente en tu gestor de
   contraseñas.**

   > ⚠️ **Esta contraseña no se puede volver a ver.** Es la llave maestra de la base de datos. No la
   > vas a necesitar para el uso diario de CuidApp, pero si algún día hay que recuperar los datos y
   > la has perdido, el proceso se complica mucho. Guárdala ahora, no "después".

5. **Region:** elige la más cercana a donde se usará la app. Si estás en Panamá o Centroamérica,
   una región del este de Estados Unidos es la opción más rápida. Esto solo afecta a la velocidad,
   no al funcionamiento.
6. **Pricing plan:** deja el plan **Free**.
7. Pulsa **Create new project** y espera. Tarda entre uno y tres minutos en estar listo.

## 2.4 Copiar los dos datos de conexión

Cuando el proyecto esté listo:

1. En el menú lateral, busca **Project Settings** (normalmente un engranaje) → **API**.
2. Vas a ver varios datos. Solo necesitas dos:

| Dato | Aspecto | Qué hacer |
|---|---|---|
| **Project URL** | `https://abcdefgh.supabase.co` | Cópialo |
| **anon** / **public key** | Un texto larguísimo que empieza por `eyJ...` | Cópialo |

3. Pégalos en tu nota:

```
URL del proyecto Supabase:  https://abcdefgh.supabase.co
Clave pública (anon key):   eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

### ⚠️ Lo más importante de todo este tutorial

En esa misma pantalla verás **otra** clave llamada **`service_role`**, normalmente con un aviso de
"secret" o "never share".

| Clave | ¿Se puede poner en el código? | Por qué |
|---|---|---|
| **`anon`** (pública) | ✅ **Sí** | Por sí sola no sirve de nada. Solo devuelve datos si además hay una sesión iniciada de un usuario aprobado. Las reglas de seguridad de la base de datos la mantienen a raya |
| **`service_role`** (secreta) | ❌ **NUNCA** | **Se salta todas las reglas de seguridad.** Cualquiera que la tenga puede leer, cambiar o borrar el expediente completo del paciente, sin contraseña |

**Regla simple: la clave `service_role` no sale nunca de la página de Supabase.** No la copies, no
la pegues en el código, no la envíes por WhatsApp ni por correo, y no se la des a ningún asistente
de programación.

## 2.5 Crear las tablas de datos

El proyecto incluye cinco archivos que construyen toda la base de datos. Hay que ejecutarlos **en
orden**.

1. En el menú lateral, entra en **SQL Editor**.
2. Pulsa **New query**.
3. Abre el archivo `supabase/01_schema.sql` de tu proyecto, copia **todo** su contenido y pégalo en
   el editor.
4. Pulsa **Run** (o `Ctrl+Enter`).
5. Debe aparecer un mensaje de éxito. Si sale un error, **no sigas**: anota el mensaje y consulta
   `docs/DEPLOY.md`.
6. Repite exactamente lo mismo, uno por uno y **en este orden**:

```
1º  supabase/01_schema.sql      ← las tablas
2º  supabase/02_functions.sql   ← los cálculos y las operaciones
3º  supabase/03_audit.sql       ← el registro de auditoría
4º  supabase/04_rls.sql         ← las reglas de seguridad
5º  supabase/05_seed.sql        ← los datos iniciales
```

> **El orden no es negociable.** Cada archivo usa cosas que creó el anterior. Ejecutarlos
> desordenados produce errores.

✅ **Comprobación:** ve a **Table Editor** en el menú lateral. Deberías ver una lista larga de
tablas: `profiles`, `medications`, `tasks`, `audit_log`, y muchas más.

## 2.6 Configurar el correo de acceso

Supabase envía correos para confirmar cuentas y recuperar contraseñas.

1. Ve a **Authentication** → **Providers** y confirma que **Email** está activado.
2. En **Authentication** → **URL Configuration**, deja el **Site URL** como está **por ahora**.
   Lo cambiarás en la Parte 3, cuando sepas la dirección real de tu aplicación.

> **Nota sobre los correos:** el plan gratuito de Supabase envía un número limitado de correos por
> hora, pensado para pruebas. Para un equipo de 3 a 8 cuidadores que se registran una sola vez, es
> más que suficiente. Si alguna vez un correo no llega, espera unos minutos y revisa la carpeta de
> spam.

---

# Parte 3 — Vercel

## 3.1 Qué es y por qué lo necesitas

Vercel toma el código de GitHub y lo publica en internet con una dirección web. Cada vez que el
código cambia, republica solo.

## 3.2 Crear la cuenta

1. Entra en **https://vercel.com** y pulsa **Sign Up**.
2. Elige **Continue with GitHub** y autoriza el acceso.
3. Si te pregunta por el tipo de cuenta, elige la opción **personal** o **Hobby**: es la gratuita.

> **Condición del plan gratuito:** el plan Hobby de Vercel es **solo para uso no comercial**. Usar
> CuidApp para el cuidado de un familiar cumple esa condición sin problema. Si algún día se usara
> para prestar un servicio de pago, habría que pasar a un plan de pago.

## 3.3 Publicar la aplicación

1. En tu panel de Vercel, pulsa **Add New** → **Project**.
2. Aparecerá la lista de tus repositorios de GitHub. Busca **`cuidapp`** y pulsa **Import**.
   - Si no aparece, pulsa **Adjust GitHub App Permissions** y dale acceso al repositorio.
3. En la pantalla de configuración:
   - **Framework Preset:** debe decir **Other**. Si sugiere otra cosa, cámbialo.
   - **Build Command:** **déjalo vacío.** CuidApp no necesita compilarse.
   - **Output Directory:** **déjalo vacío.**
   - **Install Command:** **déjalo vacío.**

   > Si Vercel insiste en ejecutar un comando de construcción, el despliegue fallará. Este proyecto
   > son archivos que se sirven tal cual, sin procesar.

4. Pulsa **Deploy** y espera uno o dos minutos.
5. Cuando termine te dará una dirección como `https://cuidapp-xxxx.vercel.app`. **Anótala.**

## 3.4 Conectar Vercel con Supabase

Ahora hay que decirle a la aplicación dónde están sus datos.

1. En tu proyecto, abre el archivo **`js/config.js`**.
2. Sustituye los valores de ejemplo por los que anotaste en la Parte 2:

```js
const CUIDAPP_CONFIG = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...'
};
```

3. Guarda el archivo y súbelo a GitHub (con Antigravity o GitHub Desktop).
4. Vercel detectará el cambio y republicará solo, en menos de un minuto.

## 3.5 Cerrar el círculo: avisar a Supabase de la dirección

Este paso es fácil de olvidar y sin él **la recuperación de contraseña no funcionará.**

1. Vuelve a Supabase → **Authentication** → **URL Configuration**.
2. En **Site URL**, escribe la dirección que te dio Vercel:
   `https://cuidapp-xxxx.vercel.app`
3. En **Redirect URLs**, añade la misma dirección seguida de `/**`:
   `https://cuidapp-xxxx.vercel.app/**`
4. Guarda.

---

# Parte 4 — Crear tu cuenta de administrador

Ya está todo montado. Falta que **tú** entres y te conviertas en administrador.

1. Abre la dirección de tu aplicación en el navegador.
2. Pulsa **Crear cuenta** y regístrate con tu correo y una contraseña.
3. Verás el mensaje de que tu cuenta está **pendiente de aprobación**. Es lo correcto: **todo
   usuario nuevo nace sin permisos** y alguien tiene que activarlo. Como eres el primero, te vas a
   activar a ti mismo desde Supabase.
4. Vuelve a Supabase → **SQL Editor** → **New query**.
5. Pega esto, **cambiando el correo por el tuyo**:

```sql
update profiles
   set app_role = 'admin', active = true
 where id = (select id from auth.users where email = 'tu-correo@ejemplo.com');
```

6. Pulsa **Run**.
7. Vuelve a la aplicación y recarga la página. Ya deberías estar dentro.

> **Crea un segundo administrador cuanto antes.** Pídele a otra persona de confianza del equipo que
> se registre y actívala como `admin` con el mismo comando. Si pierdes el acceso a tu cuenta y eres
> el único administrador, recuperarlo exige volver al panel de Supabase.

---

# Parte 5 — Dar de alta al resto del equipo

A partir de aquí ya no hace falta tocar Supabase nunca más:

1. Cada cuidador entra en la dirección de la app y pulsa **Crear cuenta**.
2. Verá el mensaje de cuenta pendiente.
3. Tú, como administrador, entras en **Más → Usuarios**, lo activas y le asignas su rol de cuidado
   (Enfermería, Cuidador/a, etc.).
4. Esa persona recarga la página y ya está dentro.

---

# Resumen: qué guardar y dónde

| Dato | Dónde guardarlo | ¿Se puede compartir? |
|---|---|---|
| Contraseña de GitHub | Gestor de contraseñas | ❌ No |
| Códigos de recuperación de GitHub | Gestor de contraseñas | ❌ No |
| Contraseña de base de datos de Supabase | Gestor de contraseñas | ❌ No |
| Clave `service_role` de Supabase | **No la copies a ninguna parte** | ❌ **Nunca** |
| URL del proyecto Supabase | En `js/config.js` | ✅ Sí |
| Clave `anon` de Supabase | En `js/config.js` | ✅ Sí |
| Dirección de la app (Vercel) | Compártela con el equipo | ✅ Sí |
| Tu contraseña de CuidApp | Gestor de contraseñas | ❌ No |

---

# Si algo no sale bien

| Síntoma | Causa probable | Solución |
|---|---|---|
| La app carga en blanco | `js/config.js` no tiene los datos reales | Revisa la Parte 3.4 |
| "Invalid API key" | Copiaste la clave incompleta o la equivocada | Vuelve a copiar la clave **anon** entera |
| El despliegue de Vercel falla | Vercel intentó compilar el proyecto | Deja vacíos los campos de Build (Parte 3.3) |
| Entro pero no veo nada | Tu perfil sigue inactivo | Ejecuta el comando de la Parte 4.5 |
| El correo de recuperación no llega | Falta configurar el Site URL | Revisa la Parte 3.5, y mira en spam |
| Un archivo `.sql` da error | Los ejecutaste desordenados | Ver `docs/DEPLOY.md`, sección de problemas |

Para todo lo relacionado con el mantenimiento diario, actualizaciones y respaldos, continúa con
**`docs/DEPLOY.md`**.

---

# Verifica los límites antes de empezar

Los planes gratuitos cambian con el tiempo. Antes de dar por buenos los cálculos del proyecto,
confirma los límites vigentes:

- **Supabase:** https://supabase.com/pricing
- **Vercel:** https://vercel.com/pricing

Las estimaciones del proyecto (unos 25 MB de base de datos el primer año, frente a los 500 MB del
plan gratuito) dejan un margen muy holgado. Pero conviene comprobar de vez en cuando el uso real
desde el panel de Supabase, en lugar de confiar en una estimación escrita hace meses.
