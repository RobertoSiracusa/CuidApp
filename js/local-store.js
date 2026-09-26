/* ═══════════════════════════════════════════════════════════════
   CuidApp v2 — Motor de Persistencia Local (js/local-store.js)
   Permite operar 100% desconectado, persistiendo todos los datos
   en localStorage con soporte transaccional y auditoría completa.
   ═══════════════════════════════════════════════════════════════ */

const LocalStore = (() => {
  'use strict';

  const STORAGE_KEY = 'cuidapp_v2_db';
  const CURRENT_USER_KEY = 'cuidapp_v2_current_user';

  // Generador simple de UUID v4 compatible
  const uuid = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const localDateStr = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const todayStr = () => localDateStr();
  const nowISO = () => new Date().toISOString();

  // ─── Estructura de Datos Inicial (modo local) ───────────────────
  const getInitialDatabase = () => {
    const now = nowISO();

    return {
      _meta: {
        version: '2.4.0',
        createdAt: now,
        mode: 'local'
      },
      settings: {
        patientName: 'El Paciente',
        emergencyContactName: 'Médico de guardia',
        emergencyContactPhone: '+34 600 000 999',
        emergencyContactWhatsapp: '+34 600 000 999',
        summaryTime: '08:00',
        initialized: true
      },
      patientStatus: {
        status: 'stable',
        lastUpdated: now,
        updatedBy: 'Administrador Local',
        notes: 'Paciente estable, signos y medicación al día.'
      },
      careRoles: [
        { id: 'role_med', name: 'Médico', icon: '⚕️', color: '#3fb4a0', isDefault: true },
        { id: 'role_enf', name: 'Enfermera/Enfermero', icon: '💉', color: '#6e8efb', isDefault: true },
        { id: 'role_cui', name: 'Cuidador/a', icon: '🤝', color: '#f0a500', isDefault: true },
        { id: 'role_fam', name: 'Coordinador Familiar', icon: '👨‍👩‍👧', color: '#e05a4e', isDefault: true },
        { id: 'role_fis', name: 'Fisioterapeuta', icon: '🏃', color: '#26a66a', isDefault: true },
        { id: 'role_nut', name: 'Nutricionista', icon: '🥗', color: '#a78bfa', isDefault: true },
        { id: 'role_pro', name: 'Proveedor/Farmacia', icon: '🏥', color: '#fb923c', isDefault: true }
      ],
      profiles: [
        {
          id: 'usr_admin',
          fullName: 'Administrador Local',
          email: 'admin@cuidapp.local',
          phone: '+34 600 000 000',
          appRole: 'admin',
          careRoleId: 'role_fam',
          active: true,
          createdAt: now
        },
        {
          id: 'usr_maria',
          fullName: 'María González',
          email: 'maria@cuidapp.local',
          phone: '+34 611 222 333',
          appRole: 'caregiver',
          careRoleId: 'role_cui',
          active: true,
          createdAt: now
        },
        {
          id: 'usr_carlos',
          fullName: 'Carlos Ruiz',
          email: 'carlos@cuidapp.local',
          phone: '+34 622 333 444',
          appRole: 'caregiver',
          careRoleId: 'role_enf',
          active: true,
          createdAt: now
        }
      ],
      // ── Datos de Menú y Alimentación (inician vacíos para gestión del usuario) ──
      recipes: [],
      recipeIngredients: [],
      weeklyPlan: [],
      complementos: [],
      complementoCategories: [
        { id: 'bebidas', label: 'Bebidas', icon: '🥤', isCustom: false },
        { id: 'contornos', label: 'Contornos', icon: '🥗', isCustom: false },
        { id: 'snacks', label: 'Snacks', icon: '🍎', isCustom: false }
      ],
      availableComplementos: [],
      complementoIngredients: [],
      shoppingList: [],
      shifts: [],
      shiftNotes: [],
      auditLog: [
        {
          id: 1,
          tableName: 'settings',
          recordId: '1',
          action: 'INSERT',
          actorId: 'usr_admin',
          actorName: 'Administrador Local',
          changedFields: ['patient_name', 'emergency_contact_name'],
          oldValues: {},
          newValues: { patient_name: 'El Paciente', emergency_contact_name: 'Médico de guardia' },
          createdAt: now
        }
      ]
    };
  };

  // ─── Migración y Auto-reparación de Esquema ────────────────────
  const sanitizeAndMigrate = (data) => {
    if (!data || typeof data !== 'object') return getInitialDatabase();

    // Colecciones que DEBEN ser arreglos siempre
    const ARRAY_COLS = [
      'careRoles', 'profiles', 'recipes', 'recipeIngredients',
      'weeklyPlan', 'complementos', 'complementoIngredients', 'complementoCategories', 'availableComplementos', 'shoppingList',
      'shifts', 'shiftNotes', 'auditLog'
    ];

    ARRAY_COLS.forEach(col => {
      if (col === 'weeklyPlan' && data.weeklyPlan && !Array.isArray(data.weeklyPlan) && typeof data.weeklyPlan === 'object') {
        const arr = [];
        Object.keys(data.weeklyPlan).forEach(day => {
          const dayObj = data.weeklyPlan[day];
          if (dayObj && typeof dayObj === 'object') {
            Object.keys(dayObj).forEach(meal => {
              const rids = Array.isArray(dayObj[meal]) ? dayObj[meal] : [dayObj[meal]];
              rids.filter(Boolean).forEach(rid => {
                arr.push({
                  id: uuid(),
                  dayIndex: parseInt(day, 10),
                  dayOfWeek: parseInt(day, 10),
                  mealType: meal,
                  recipeId: rid
                });
              });
            });
          }
        });
        data.weeklyPlan = arr;
      } else if (!Array.isArray(data[col])) {
        data[col] = [];
      }
    });
    if (!Array.isArray(data.complementoCategories) || data.complementoCategories.length === 0) {
      data.complementoCategories = [
        { id: 'bebidas', label: 'Bebidas', icon: '🥤', isCustom: false },
        { id: 'contornos', label: 'Contornos', icon: '🥗', isCustom: false },
        { id: 'snacks', label: 'Snacks', icon: '🍎', isCustom: false }
      ];
    }

    // Lista de IDs hardcodeados que deben ser purgados de raíz
    const SAMPLE_FOOD_IDS = new Set([
      'mubesejtzfv2d', 'rec_pure',
      'mubf4ocz2aix0', 'rec_huevos',
      'mubf5m0ls981z', 'rec_crema',
      'mubf65ssp8kjr', 'rec_tortilla',
      'mubesrtdojy23', 'comp_coco'
    ]);

    // Limpieza de datos hardcodeados existentes en el almacenamiento local
    if (Array.isArray(data.recipes)) {
      data.recipes = data.recipes.filter(r => r && !SAMPLE_FOOD_IDS.has(r.id));
    } else {
      data.recipes = [];
    }

    if (Array.isArray(data.recipeIngredients)) {
      data.recipeIngredients = data.recipeIngredients.filter(i => i && !SAMPLE_FOOD_IDS.has(i.recipeId));
    } else {
      data.recipeIngredients = [];
    }

    if (Array.isArray(data.weeklyPlan)) {
      data.weeklyPlan = data.weeklyPlan.filter(s => s && typeof s === 'object' && !SAMPLE_FOOD_IDS.has(s.recipeId));
      const currentWk = (() => {
        const d = new Date();
        const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dayNum = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
        return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      })();
      data.weeklyPlan.forEach(slot => {
        if (slot) {
          if (slot.dayIndex === undefined && slot.dayOfWeek !== undefined) {
            slot.dayIndex = Number(slot.dayOfWeek);
          }
          if (slot.dayOfWeek === undefined && slot.dayIndex !== undefined) {
            slot.dayOfWeek = Number(slot.dayIndex);
          }
          if (!slot.weekKey && !slot.date) {
            slot.weekKey = currentWk;
          }
        }
      });
      data.weeklyPlan = data.weeklyPlan.filter(s => s && (s.dayIndex !== undefined || s.dayOfWeek !== undefined));
    } else {
      data.weeklyPlan = [];
    }

    if (Array.isArray(data.complementos)) {
      data.complementos = data.complementos.filter(c => c && !SAMPLE_FOOD_IDS.has(c.id));
    } else {
      data.complementos = [];
    }

    if (Array.isArray(data.availableComplementos)) {
      data.availableComplementos = data.availableComplementos.filter(id => id && !SAMPLE_FOOD_IDS.has(id));
    } else {
      data.availableComplementos = [];
    }

    if (Array.isArray(data.shoppingList)) {
      data.shoppingList = data.shoppingList.filter(i => i && !SAMPLE_FOOD_IDS.has(i.recipeId) && !SAMPLE_FOOD_IDS.has(i.complementoId));
    } else {
      data.shoppingList = [];
    }

    if (Array.isArray(data.auditLog)) {
      data.auditLog = data.auditLog.filter(a => a && !(a.tableName === 'recipes' && SAMPLE_FOOD_IDS.has(a.recordId)));
    }

    // Reconciliar categorías de complementos (mantener las categorías base del sistema)
    if (!data.complementoCategories || data.complementoCategories.length === 0) {
      data.complementoCategories = [
        { id: 'bebidas', label: 'Bebidas', icon: '🥤', isCustom: false },
        { id: 'contornos', label: 'Contornos', icon: '🥗', isCustom: false },
        { id: 'snacks', label: 'Snacks', icon: '🍎', isCustom: false }
      ];
    }
    if (!Array.isArray(data.availableComplementos)) {
      data.availableComplementos = [];
    }

    if (!data._meta) data._meta = {};
    data._meta.version = '2.4.0';
    data._meta.updatedAt = nowISO();

    return data;
  };

  // ─── Wrapper Seguro de Almacenamiento (Resistente a bloqueos de file:///) ─
  const safeStorage = {
    _mem: {},
    getItem(key) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage.getItem(key);
        }
      } catch (e) {
        console.warn('localStorage inaccesible (modo local file:///), usando memoria:', e);
      }
      return this._mem[key] !== undefined ? this._mem[key] : null;
    },
    setItem(key, val) {
      this._mem[key] = String(val);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, String(val));
        }
      } catch (e) {
        console.warn('localStorage no pudo persistir:', e);
      }
    },
    removeItem(key) {
      delete this._mem[key];
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(key);
        }
      } catch (e) {}
    }
  };

  // ─── Carga y Guardado en localStorage ─────────────────────────
  let _db = null;

  const load = () => {
    try {
      const raw = safeStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        _db = sanitizeAndMigrate(parsed);
      } else {
        _db = getInitialDatabase();
      }
      save();
    } catch (e) {
      console.warn('Error al leer de localStorage, usando base inicial:', e);
      _db = getInitialDatabase();
      save();
    }
    return _db;
  };

  const save = () => {
    if (!_db) return;
    try {
      safeStorage.setItem(STORAGE_KEY, JSON.stringify(_db));
    } catch (e) {
      console.error('Error al guardar en localStorage:', e);
    }
  };

  const resetToDefaults = () => {
    _db = getInitialDatabase();
    save();
    return _db;
  };

  // Obtener referencia a la base en memoria
  const db = () => {
    if (!_db) load();
    return _db;
  };

  // ─── Auditoría Automática (Emulación del trigger PostgreSQL) ──
  const recordAudit = (tableName, recordId, action, changedFields, oldValues, newValues) => {
    const actor = getCurrentUser();
    const nextId = (db().auditLog.length > 0 ? Math.max(...db().auditLog.map(a => a.id || 0)) : 0) + 1;

    db().auditLog.unshift({
      id: nextId,
      tableName,
      recordId: String(recordId || ''),
      action,
      actorId: actor.id,
      actorName: actor.fullName || 'Usuario',
      changedFields: changedFields || [],
      oldValues: oldValues || {},
      newValues: newValues || {},
      createdAt: nowISO()
    });

    save();
  };

  // ─── Manejo de Sesión de Prueba y Cambio de Rol ───────────────
  const getCurrentUserId = () => {
    try {
      return safeStorage.getItem(CURRENT_USER_KEY) || 'usr_admin';
    } catch {
      return 'usr_admin';
    }
  };

  const setCurrentUserId = (userId) => {
    try {
      safeStorage.setItem(CURRENT_USER_KEY, userId);
    } catch {}
  };

  const getCurrentUser = () => {
    const userId = getCurrentUserId();
    const user = db().profiles.find(p => p.id === userId);
    return user || db().profiles[0] || {
      id: 'usr_admin',
      fullName: 'Administrador Local',
      email: 'admin@cuidapp.local',
      appRole: 'admin',
      active: true
    };
  };

  // ─── Métodos CRUD Genéricos ──────────────────────────────────
  const getCollection = (col) => {
    const d = db();
    if (!Array.isArray(d[col])) {
      d[col] = [];
    }
    return d[col];
  };

  const insert = (col, item, auditTableName = null) => {
    if (!item.id) item.id = uuid();
    if (!item.createdAt) item.createdAt = nowISO();

    getCollection(col).push(item);

    if (auditTableName) {
      const keys = Object.keys(item).filter(k => k !== 'id' && k !== 'createdAt');
      recordAudit(auditTableName, item.id, 'INSERT', keys, {}, item);
    }

    save();
    return item;
  };

  const update = (col, id, updates, auditTableName = null) => {
    const idx = db()[col].findIndex(item => item.id === id);
    if (idx === -1) return null;

    const oldItem = { ...db()[col][idx] };

    const changedFields = [];
    const oldValues = {};
    const newValues = {};

    Object.keys(updates).forEach(key => {
      if (oldItem[key] !== updates[key]) {
        changedFields.push(key);
        oldValues[key] = oldItem[key];
        newValues[key] = updates[key];
      }
    });

    db()[col][idx] = { ...oldItem, ...updates, updatedAt: nowISO() };

    if (auditTableName && changedFields.length > 0) {
      recordAudit(auditTableName, id, 'UPDATE', changedFields, oldValues, newValues);
    }

    save();
    return db()[col][idx];
  };

  const remove = (col, id, auditTableName = null) => {
    const idx = db()[col].findIndex(item => item.id === id);
    if (idx === -1) return false;

    const oldItem = { ...db()[col][idx] };

    db()[col].splice(idx, 1);

    if (auditTableName) {
      const keys = Object.keys(oldItem).filter(k => k !== 'id');
      recordAudit(auditTableName, id, 'DELETE', keys, oldItem, {});
    }

    save();
    return true;
  };

  // ─── Emulación de RPCs Transaccionales ─────────────────────

  // RPC: take_shift
  const takeShift = (careRoleId) => {
    const open = db().shifts.find(s => !s.endedAt);
    if (open) throw new Error('Ya existe un turno abierto en el sistema.');

    const actor = getCurrentUser();
    const shift = {
      id: uuid(),
      caregiverId: actor.id,
      careRoleId,
      startedAt: nowISO(),
      endedAt: null,
      createdAt: nowISO()
    };

    db().shifts.push(shift);
    recordAudit('shifts', shift.id, 'INSERT', ['care_role_id', 'started_at'], {}, shift);

    save();
    return shift.id;
  };

  // RPC: end_shift
  const endShift = () => {
    const open = db().shifts.find(s => !s.endedAt);
    if (!open) throw new Error('No hay ningún turno abierto.');

    open.endedAt = nowISO();
    recordAudit('shifts', open.id, 'UPDATE', ['ended_at'], { ended_at: null }, { ended_at: open.endedAt });

    save();
    return open.id;
  };

  // RPC: purge_old_audit
  const purgeOldAudit = (months = 24) => {
    const cutoff = new Date(Date.now() - months * 30 * 86400000).toISOString();
    const beforeCount = db().auditLog.length;
    db().auditLog = db().auditLog.filter(a => a.createdAt >= cutoff);
    const deletedCount = beforeCount - db().auditLog.length;

    save();
    return deletedCount;
  };

  // Configuración y Paciente
  const getSettings = () => {
    return db().settings || {
      patientName: 'El Paciente',
      emergencyContactName: 'Médico de guardia',
      emergencyContactPhone: '+34 600 000 999',
      emergencyContactWhatsapp: '+34 600 000 999'
    };
  };

  const saveSettings = (updates) => {
    if (!db().settings) db().settings = {};
    const old = { ...db().settings };
    Object.assign(db().settings, updates, { updatedAt: nowISO() });
    recordAudit('settings', 'true', 'UPDATE', Object.keys(updates), old, db().settings);
    save();
    return db().settings;
  };

  const getPatientStatus = () => {
    return db().patientStatus || {
      status: 'stable',
      lastUpdated: nowISO(),
      updatedBy: 'Sistema',
      notes: ''
    };
  };

  const savePatientStatus = (status, notes = '') => {
    if (!db().patientStatus) db().patientStatus = {};
    const actor = getCurrentUser();
    const old = { ...db().patientStatus };
    db().patientStatus.status = status;
    db().patientStatus.notes = notes;
    db().patientStatus.updatedBy = actor.fullName || 'Usuario';
    db().patientStatus.lastUpdated = nowISO();
    recordAudit('patient_status', 'true', 'UPDATE', ['status', 'notes'], old, db().patientStatus);
    save();
    return db().patientStatus;
  };

  // Cargar base en memoria al inicializar script
  load();

  return {
    uuid,
    todayStr,
    nowISO,
    load,
    save,
    getDb: () => db(),
    getSettings,
    saveSettings,
    getPatientStatus,
    savePatientStatus,
    getCollection,
    insert,
    update,
    remove,
    getCurrentUser,
    setCurrentUserId,
    // RPCs
    takeShift,
    endShift,
    purgeOldAudit,
    resetToDefaults,
    sanitizeAndMigrate: () => sanitizeAndMigrate(db())
  };
})();
