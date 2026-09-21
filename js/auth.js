/* ============================================================
   CuidApp v2 — Módulo de Autenticación (js/auth.js)
   RF-01 .. RF-06 · RNF-17, RNF-28, RNF-30
   ============================================================ */

const Auth = (() => {
  'use strict';

  let _client = null;
  let _session = null;
  let _profile = null;
  const _listeners = new Set();

  const isLocal = () => Boolean(
    (typeof CUIDAPP_CONFIG !== 'undefined' ? CUIDAPP_CONFIG.LOCAL_MODE : window.CUIDAPP_CONFIG?.LOCAL_MODE) &&
    typeof LocalStore !== 'undefined'
  );

  /**
   * Traduce errores comunes de Supabase Auth a español claro
   */
  const translateAuthError = (err) => {
    if (!err) return 'Ocurrió un error inesperado.';
    const msg = String(err.message || err);
    if (/invalid login credentials/i.test(msg) || /invalid_grant/i.test(msg)) {
      return 'Correo o contraseña incorrectos.';
    }
    if (/email not confirmed/i.test(msg)) {
      return 'El correo electrónico no ha sido confirmado aún.';
    }
    if (/user already registered/i.test(msg) || /already exists/i.test(msg)) {
      return 'Ya existe una cuenta registrada con este correo.';
    }
    if (/password.*least 6 characters/i.test(msg)) {
      return 'La contraseña debe tener al menos 6 caracteres.';
    }
    if (/rate limit/i.test(msg) || /too many requests/i.test(msg)) {
      return 'Demasiados intentos. Espera unos momentos antes de intentar de nuevo.';
    }
    if (/network/i.test(msg) || /failed to fetch/i.test(msg) || /fetch error/i.test(msg)) {
      return 'No hay conexión con el servidor. Revisa tu acceso a internet.';
    }
    return msg || 'No se pudo completar la solicitud de acceso.';
  };

  /**
   * Inicializa el cliente de Supabase y recupera la sesión almacenada
   */
  const init = async () => {
    // Modo 100% Local (sin internet / sin Supabase)
    if (isLocal()) {
      const activeUser = LocalStore.getCurrentUser();
      _profile = activeUser;
      _session = {
        user: {
          id: activeUser.id,
          email: activeUser.email || 'admin@cuidapp.local',
          user_metadata: {
            full_name: activeUser.fullName
          }
        }
      };
      return {
        session: _session,
        profile: _profile,
        active: !!_profile?.active,
        isAdmin: (_profile?.appRole || _profile?.app_role) === 'admin'
      };
    }

    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.error('Error crítico: supabase-js no está cargado.');
      return { ok: false, error: 'Librería de Supabase no disponible' };
    }

    if (!_client) {
      _client = supabase.createClient(
        CUIDAPP_CONFIG.SUPABASE_URL,
        CUIDAPP_CONFIG.SUPABASE_ANON_KEY
      );

      // Escuchar cambios de estado en Auth
      _client.auth.onAuthStateChange(async (event, session) => {
        _session = session;
        if (session?.user) {
          await refreshProfile();
        } else {
          _profile = null;
        }
        notifySubscribers(event, _session, _profile);
      });
    }

    try {
      const { data, error } = await _client.auth.getSession();
      if (error) {
        console.warn('No se pudo recuperar la sesión previa:', error);
        _session = null;
        _profile = null;
      } else {
        _session = data.session;
        if (_session?.user) {
          await refreshProfile();
        }
      }
    } catch (e) {
      console.warn('Error inicializando sesión:', e);
      _session = null;
      _profile = null;
    }

    return {
      session: _session,
      profile: _profile,
      active: !!_profile?.active,
      isAdmin: (_profile?.appRole || _profile?.app_role) === 'admin'
    };
  };

  /**
   * Refresca el perfil del usuario activo desde la tabla profiles
   */
  /**
   * Refresca el perfil del usuario activo desde la tabla profiles
   */
  const refreshProfile = async () => {
    if (isLocal()) {
      _profile = LocalStore.getCurrentUser();
      return _profile;
    }

    if (!_client || !_session?.user?.id) {
      _profile = null;
      return null;
    }
    try {
      const { data, error } = await _client
        .from('profiles')
        .select('*')
        .eq('id', _session.user.id)
        .maybeSingle();

      if (error) {
        console.warn('Error al leer perfil de usuario:', error);
      }
      _profile = data || null;
      return _profile;
    } catch (e) {
      console.warn('Excepción al cargar perfil:', e);
      return null;
    }
  };

  /**
   * Inicia sesión con email y contraseña
   */
  const signIn = async (email, password) => {
    if (isLocal()) {
      const em = (email || '').trim().toLowerCase();
      const profiles = LocalStore.getCollection('profiles');
      const found = profiles.find(p => (p.email || '').toLowerCase() === em);
      if (!found) {
        return { ok: false, error: 'Usuario no encontrado en la base local.' };
      }
      LocalStore.setCurrentUserId(found.id);
      _profile = LocalStore.getCurrentUser();
      _session = {
        user: {
          id: _profile.id,
          email: _profile.email,
          user_metadata: { full_name: _profile.fullName }
        }
      };
      notifySubscribers('SIGNED_IN', _session, _profile);
      return {
        ok: true,
        session: _session,
        profile: _profile,
        active: !!_profile.active,
        isAdmin: (_profile.appRole || _profile.app_role) === 'admin'
      };
    }

    if (!_client) await init();
    try {
      const { data, error } = await _client.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) {
        return { ok: false, error: translateAuthError(error) };
      }

      _session = data.session;
      await refreshProfile();

      return {
        ok: true,
        session: _session,
        profile: _profile,
        active: !!_profile?.active,
        isAdmin: (_profile?.appRole || _profile?.app_role) === 'admin'
      };
    } catch (e) {
      return { ok: false, error: translateAuthError(e) };
    }
  };

  /**
   * Registra una nueva cuenta. Pasa full_name en metadata para que el trigger handle_new_user lo asigne.
   */
  const signUp = async (email, password, fullName) => {
    if (isLocal()) {
      const newProfile = {
        id: LocalStore.uuid(),
        fullName: (fullName || '').trim(),
        email: (email || '').trim(),
        appRole: 'caregiver',
        active: true,
        createdAt: LocalStore.nowISO()
      };
      LocalStore.insert('profiles', newProfile, 'profiles');
      LocalStore.setCurrentUserId(newProfile.id);
      _profile = newProfile;
      _session = {
        user: {
          id: newProfile.id,
          email: newProfile.email,
          user_metadata: { full_name: newProfile.fullName }
        }
      };
      notifySubscribers('SIGNED_IN', _session, _profile);
      return {
        ok: true,
        session: _session,
        user: _session.user,
        profile: _profile,
        active: true
      };
    }

    if (!_client) await init();
    try {
      const { data, error } = await _client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: (fullName || '').trim()
          }
        }
      });

      if (error) {
        return { ok: false, error: translateAuthError(error) };
      }

      _session = data.session;
      if (_session?.user) {
        await refreshProfile();
      }

      return {
        ok: true,
        session: _session,
        user: data.user,
        profile: _profile,
        active: !!_profile?.active
      };
    } catch (e) {
      return { ok: false, error: translateAuthError(e) };
    }
  };

  /**
   * Cierra sesión
   */
  const signOut = async () => {
    if (isLocal()) {
      _session = null;
      _profile = null;
      window.location.reload();
      return;
    }

    if (_client) {
      try {
        await _client.auth.signOut();
      } catch (e) {
        console.warn('Error en signOut:', e);
      }
    }
    _session = null;
    _profile = null;
    window.location.reload();
  };

  /**
   * Cambiar de usuario en modo local para pruebas
   */
  const switchUser = (userId) => {
    if (!isLocal()) return;
    LocalStore.setCurrentUserId(userId);
    _profile = LocalStore.getCurrentUser();
    _session = {
      user: {
        id: _profile.id,
        email: _profile.email,
        user_metadata: { full_name: _profile.fullName }
      }
    };
    notifySubscribers('USER_UPDATED', _session, _profile);
    window.location.reload();
  };

  /**
   * Solicita restablecimiento de contraseña por correo
   */
  const resetPassword = async (email) => {
    if (isLocal()) {
      return { ok: true };
    }

    if (!_client) await init();
    try {
      const { error } = await _client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin
      });
      if (error) {
        return { ok: false, error: translateAuthError(error) };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: translateAuthError(e) };
    }
  };

  /**
   * Suscribe una función a los cambios de estado de sesión
   */
  const onChange = (callback) => {
    if (typeof callback === 'function') {
      _listeners.add(callback);
    }
    return () => _listeners.delete(callback);
  };

  const notifySubscribers = (event, session, profile) => {
    for (const listener of _listeners) {
      try {
        listener(event, session, profile);
      } catch (e) {
        console.error('Error en suscriptor de auth:', e);
      }
    }
  };

  const getUser = () => _session?.user || null;
  const getProfile = () => _profile || null;
  const isAdmin = () => (_profile?.appRole || _profile?.app_role) === 'admin';
  const requireAdmin = () => {
    if (!isAdmin()) {
      throw new Error('Acción reservada para administradores');
    }
    return true;
  };
  const client = () => _client;

  return {
    init,
    signIn,
    signUp,
    signOut,
    switchUser,
    resetPassword,
    getUser,
    getProfile,
    refreshProfile,
    isAdmin,
    requireAdmin,
    onChange,
    client
  };
})();
