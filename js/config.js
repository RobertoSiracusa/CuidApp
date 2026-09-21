/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Configuración Global (js/config.js)
   ═══════════════════════════════════════════════════════════════ */

const CUIDAPP_CONFIG = {
  // MODO LOCAL ACTIVO:
  // true = Opera 100% localmente en el navegador, persistiendo todos los datos
  //        en localStorage de este equipo (no requiere internet ni Supabase).
  // false = Conecta a Supabase en la nube con las credenciales indicadas abajo.
  LOCAL_MODE: false,

  // Configuración de conexión a Supabase (para cuando se active en la nube):
  SUPABASE_URL: 'https://tirdwnwtbxfriymzaxnl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_dEd6ES-UdX76iyoJmYtdWw_y29_WZSl'
};

if (typeof window !== 'undefined') {
  window.CUIDAPP_CONFIG = CUIDAPP_CONFIG;
}
