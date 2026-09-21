/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Configuración Global (js/config.js)
   ═══════════════════════════════════════════════════════════════ */

const CUIDAPP_CONFIG = {
  // MODO LOCAL ACTIVO:
  // true = Opera 100% localmente en el navegador, persistiendo todos los datos
  //        en localStorage de este equipo (no requiere internet ni Supabase).
  // false = Conecta a Supabase en la nube con las credenciales indicadas abajo.
  LOCAL_MODE: true,

  // Configuración de conexión a Supabase (para cuando se active en la nube):
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-ANON-KEY'
};

if (typeof window !== 'undefined') {
  window.CUIDAPP_CONFIG = CUIDAPP_CONFIG;
}
