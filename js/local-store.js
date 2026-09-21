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

  const todayStr = () => new Date().toISOString().split('T')[0];
  const nowISO = () => new Date().toISOString();

  // ─── Estructura de Datos Inicial (Seed + cuidapp_db.json) ──────
  const getInitialDatabase = () => {
    const now = nowISO();
    const today = todayStr();

    return {
      _meta: {
        version: '2.0.0',
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
      inventoryCategories: [
        { id: 'cat_1', name: 'Medicamentos' },
        { id: 'cat_2', name: 'Insumos Médicos' },
        { id: 'cat_3', name: 'Alimentos/Suplementos' },
        { id: 'cat_4', name: 'Higiene Personal' },
        { id: 'cat_5', name: 'Equipos' },
        { id: 'cat_6', name: 'Otros' }
      ],
      inventoryItems: [
        {
          id: 'inv_1',
          name: 'Gasas estériles',
          categoryId: 'cat_2',
          currentStock: 25,
          unit: 'sobres',
          minThreshold: 10,
          presentation: 'Caja 50 sobres',
          notes: 'Uso en curas',
          active: true,
          createdAt: now
        },
        {
          id: 'inv_2',
          name: 'Guantes de látex (M)',
          categoryId: 'cat_2',
          currentStock: 8,
          unit: 'pares',
          minThreshold: 15,
          presentation: 'Caja 100',
          notes: 'Stock bajo reposición',
          active: true,
          createdAt: now
        },
        {
          id: 'inv_3',
          name: 'Solución salina 0.9%',
          categoryId: 'cat_2',
          currentStock: 4,
          unit: 'frascos',
          minThreshold: 3,
          presentation: '500ml',
          notes: 'Lavados',
          active: true,
          createdAt: now
        }
      ],
      inventoryMovements: [
        { id: 'mov_1', itemId: 'inv_1', delta: 25, previousStock: 0, newStock: 25, reason: 'Inventario inicial', actorId: 'usr_admin', createdAt: now },
        { id: 'mov_2', itemId: 'inv_2', delta: 8, previousStock: 0, newStock: 8, reason: 'Inventario inicial', actorId: 'usr_admin', createdAt: now },
        { id: 'mov_3', itemId: 'inv_3', delta: 4, previousStock: 0, newStock: 4, reason: 'Inventario inicial', actorId: 'usr_admin', createdAt: now }
      ],
      medications: [
        {
          id: 'med_1',
          name: 'Omeprazol 20mg',
          instructions: 'En ayunas antes del desayuno',
          currentStock: 14,
          unit: 'cápsulas',
          minThreshold: 7,
          status: 'active',
          notes: 'Protector gástrico',
          createdAt: now
        },
        {
          id: 'med_2',
          name: 'Paracetamol 500mg',
          instructions: 'Tomar con medio vaso de agua',
          currentStock: 20,
          unit: 'comprimidos',
          minThreshold: 10,
          status: 'active',
          notes: 'Para dolor o fiebre',
          createdAt: now
        },
        {
          id: 'med_3',
          name: 'Enoxaparina 40mg',
          instructions: 'Inyección subcutánea en abdomen',
          currentStock: 3,
          unit: 'jeringas',
          minThreshold: 5,
          status: 'active',
          notes: 'Anticoagulante urgente',
          createdAt: now
        }
      ],
      medicationSchedules: [
        { id: 'sched_1', medicationId: 'med_1', timeOfDay: '08:00', dose: 1, active: true },
        { id: 'sched_2', medicationId: 'med_2', timeOfDay: '14:00', dose: 1, active: true },
        { id: 'sched_3', medicationId: 'med_2', timeOfDay: '21:00', dose: 1, active: true },
        { id: 'sched_4', medicationId: 'med_3', timeOfDay: '20:00', dose: 1, active: true }
      ],
      medicationAdministrations: [],
      medicationRestocks: [],
      taskTemplates: [
        { id: 'tpl_1', title: 'Toma de tensión y temperatura', shiftType: 'morning', isEmergency: false, sortOrder: 1, active: true },
        { id: 'tpl_2', title: 'Movilización pasiva y cambios posturales', shiftType: 'afternoon', isEmergency: false, sortOrder: 2, active: true },
        { id: 'tpl_3', title: 'Higiene e hidratación de piel', shiftType: 'night', isEmergency: false, sortOrder: 3, active: true }
      ],
      tasks: [
        { id: 'task_1', templateId: 'tpl_1', title: 'Toma de tensión y temperatura', taskDate: today, shiftType: 'morning', status: 'pending', isEmergency: false, completedAt: null, completedBy: null, createdAt: now },
        { id: 'task_2', templateId: 'tpl_2', title: 'Movilización pasiva y cambios posturales', taskDate: today, shiftType: 'afternoon', status: 'pending', isEmergency: false, completedAt: null, completedBy: null, createdAt: now },
        { id: 'task_3', templateId: 'tpl_3', title: 'Higiene e hidratación de piel', taskDate: today, shiftType: 'night', status: 'pending', isEmergency: false, completedAt: null, completedBy: null, createdAt: now }
      ],
      taskComments: [],
      appointments: [
        {
          id: 'appt_1',
          title: 'Control Medicina Interna',
          specialty: 'Medicina Interna',
          doctor: 'Dra. Sánchez',
          apptDate: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
          apptTime: '11:30',
          modality: 'presencial',
          location: 'Hospital Central — Consulta 204',
          preparation: 'Llevar analíticas recientes y lista de medicamentos',
          status: 'upcoming',
          notes: '',
          resultNotes: '',
          createdAt: now
        }
      ],
      // ── Datos reales migrados de cuidapp_db.json ──
      recipes: [
        {
          id: 'rec_pure',
          name: 'Pure de papas',
          mealTypes: ['lunch', 'dinner'],
          instructions: '',
          notes: '',
          createdAt: '2026-09-21T15:37:27.977Z'
        },
        {
          id: 'rec_huevos',
          name: 'Huevos Revueltos',
          mealTypes: ['breakfast'],
          instructions: '',
          notes: '',
          createdAt: '2026-09-21T15:47:00.563Z'
        },
        {
          id: 'rec_crema',
          name: 'Crema Calabacin y Pollo',
          mealTypes: ['lunch', 'dinner'],
          instructions: '',
          notes: '',
          createdAt: '2026-09-21T15:47:44.181Z'
        },
        {
          id: 'rec_tortilla',
          name: 'Tortilla de Papas',
          mealTypes: ['lunch', 'dinner'],
          instructions: '',
          notes: '',
          createdAt: '2026-09-21T15:48:09.820Z'
        }
      ],
      recipeIngredients: [
        { id: uuid(), recipeId: 'rec_pure', name: 'Papas', amount: '', unit: '' },
        { id: uuid(), recipeId: 'rec_pure', name: 'Leche', amount: '', unit: '' },
        { id: uuid(), recipeId: 'rec_pure', name: 'Griego', amount: 'Yogurt', unit: '' },
        { id: uuid(), recipeId: 'rec_pure', name: 'Queso', amount: '', unit: '' },

        { id: uuid(), recipeId: 'rec_huevos', name: 'Huevo', amount: '', unit: '' },
        { id: uuid(), recipeId: 'rec_huevos', name: 'Queso', amount: '', unit: '' },

        { id: uuid(), recipeId: 'rec_crema', name: 'Calabacin', amount: '', unit: '' },
        { id: uuid(), recipeId: 'rec_crema', name: 'Pollo', amount: '', unit: '' },
        { id: uuid(), recipeId: 'rec_crema', name: 'Parmesano', amount: '', unit: '' },
        { id: uuid(), recipeId: 'rec_crema', name: 'Ricotta', amount: '', unit: '' },

        { id: uuid(), recipeId: 'rec_tortilla', name: 'Papas', amount: '', unit: '' },
        { id: uuid(), recipeId: 'rec_tortilla', name: 'Huevo', amount: '', unit: '' }
      ],
      weeklyPlan: [
        // Domingo (0)
        { id: uuid(), dayIndex: 0, dayOfWeek: 0, mealType: 'breakfast', recipeId: 'rec_huevos' },
        { id: uuid(), dayIndex: 0, dayOfWeek: 0, mealType: 'lunch', recipeId: 'rec_tortilla' },
        { id: uuid(), dayIndex: 0, dayOfWeek: 0, mealType: 'dinner', recipeId: 'rec_crema' },
        // Lunes (1)
        { id: uuid(), dayIndex: 1, dayOfWeek: 1, mealType: 'breakfast', recipeId: 'rec_huevos' },
        { id: uuid(), dayIndex: 1, dayOfWeek: 1, mealType: 'lunch', recipeId: 'rec_pure' },
        { id: uuid(), dayIndex: 1, dayOfWeek: 1, mealType: 'lunch', recipeId: 'rec_crema' },
        { id: uuid(), dayIndex: 1, dayOfWeek: 1, mealType: 'dinner', recipeId: 'rec_tortilla' },
        // Martes (2)
        { id: uuid(), dayIndex: 2, dayOfWeek: 2, mealType: 'breakfast', recipeId: 'rec_huevos' },
        { id: uuid(), dayIndex: 2, dayOfWeek: 2, mealType: 'lunch', recipeId: 'rec_tortilla' },
        { id: uuid(), dayIndex: 2, dayOfWeek: 2, mealType: 'dinner', recipeId: 'rec_pure' },
        // Miércoles (3)
        { id: uuid(), dayIndex: 3, dayOfWeek: 3, mealType: 'breakfast', recipeId: 'rec_huevos' },
        { id: uuid(), dayIndex: 3, dayOfWeek: 3, mealType: 'lunch', recipeId: 'rec_crema' },
        { id: uuid(), dayIndex: 3, dayOfWeek: 3, mealType: 'dinner', recipeId: 'rec_tortilla' },
        // Jueves (4)
        { id: uuid(), dayIndex: 4, dayOfWeek: 4, mealType: 'breakfast', recipeId: 'rec_huevos' },
        { id: uuid(), dayIndex: 4, dayOfWeek: 4, mealType: 'lunch', recipeId: 'rec_pure' },
        { id: uuid(), dayIndex: 4, dayOfWeek: 4, mealType: 'dinner', recipeId: 'rec_crema' },
        // Viernes (5)
        { id: uuid(), dayIndex: 5, dayOfWeek: 5, mealType: 'breakfast', recipeId: 'rec_huevos' },
        { id: uuid(), dayIndex: 5, dayOfWeek: 5, mealType: 'lunch', recipeId: 'rec_tortilla' },
        { id: uuid(), dayIndex: 5, dayOfWeek: 5, mealType: 'lunch', recipeId: 'rec_crema' },
        { id: uuid(), dayIndex: 5, dayOfWeek: 5, mealType: 'dinner', recipeId: 'rec_pure' },
        // Sábado (6)
        { id: uuid(), dayIndex: 6, dayOfWeek: 6, mealType: 'breakfast', recipeId: 'rec_huevos' },
        { id: uuid(), dayIndex: 6, dayOfWeek: 6, mealType: 'lunch', recipeId: 'rec_pure' },
        { id: uuid(), dayIndex: 6, dayOfWeek: 6, mealType: 'dinner', recipeId: 'rec_tortilla' }
      ],
      complementos: [
        {
          id: 'comp_coco',
          name: 'agua de coco',
          category: 'bebidas',
          amount: '',
          unit: '',
          notes: '',
          createdAt: '2026-09-21T15:37:45.169Z'
        }
      ],
      complementoIngredients: [],
      shoppingList: [],
      expenses: [
        {
          id: 'exp_1',
          description: 'Farmacia — Gasas y solución salina',
          amount: 18.50,
          expenseDate: today,
          category: 'Farmacia',
          linkedRestockId: null,
          managedBy: 'usr_admin',
          createdAt: now
        }
      ],
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
        },
        {
          id: 2,
          tableName: 'recipes',
          recordId: 'rec_pure',
          action: 'INSERT',
          actorId: 'usr_admin',
          actorName: 'Administrador Local',
          changedFields: ['name'],
          oldValues: {},
          newValues: { name: 'Pure de papas' },
          createdAt: now
        }
      ]
    };
  };

  // ─── Migración y Auto-reparación de Esquema ────────────────────
  const sanitizeAndMigrate = (data) => {
    if (!data || typeof data !== 'object') return getInitialDatabase();

    const LEGACY_ID_MAP = {
      'mubesejtzfv2d': 'rec_pure',
      'mubf4ocz2aix0': 'rec_huevos',
      'mubf5m0ls981z': 'rec_crema',
      'mubf65ssp8kjr': 'rec_tortilla',
      'mubesrtdojy23': 'comp_coco'
    };

    // Colecciones que DEBEN ser arreglos siempre
    const ARRAY_COLS = [
      'careRoles', 'profiles', 'inventoryCategories', 'inventoryItems', 'inventoryMovements',
      'medications', 'medicationSchedules', 'medicationAdministrations', 'medicationRestocks',
      'taskTemplates', 'tasks', 'taskComments', 'appointments', 'recipes', 'recipeIngredients',
      'weeklyPlan', 'complementos', 'complementoIngredients', 'shoppingList', 'expenses',
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
              rids.filter(Boolean).forEach(rawRid => {
                const rid = LEGACY_ID_MAP[rawRid] || rawRid;
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

    const initial = getInitialDatabase();

    // 1. Reconciliar recetas
    if (!data.recipes || data.recipes.length === 0) {
      data.recipes = initial.recipes;
      data.recipeIngredients = initial.recipeIngredients;
    } else {
      data.recipes.forEach(r => {
        if (LEGACY_ID_MAP[r.id]) r.id = LEGACY_ID_MAP[r.id];
      });
      // Asegurar que las recetas base existan
      initial.recipes.forEach(defR => {
        if (!data.recipes.some(r => r.id === defR.id || r.name.toLowerCase() === defR.name.toLowerCase())) {
          data.recipes.push(defR);
        }
      });
      if (!data.recipeIngredients || data.recipeIngredients.length === 0) {
        data.recipeIngredients = initial.recipeIngredients;
      }
    }

    // 2. Reconciliar weeklyPlan: asegurar que todos los días (0..6) tengan comidas
    if (!data.weeklyPlan || data.weeklyPlan.length === 0) {
      data.weeklyPlan = [...initial.weeklyPlan];
    } else {
      data.weeklyPlan.forEach(slot => {
        if (slot.recipeId && LEGACY_ID_MAP[slot.recipeId]) {
          slot.recipeId = LEGACY_ID_MAP[slot.recipeId];
        }
        if (slot.dayIndex === undefined && slot.dayOfWeek !== undefined) {
          slot.dayIndex = Number(slot.dayOfWeek);
        }
        if (slot.dayOfWeek === undefined && slot.dayIndex !== undefined) {
          slot.dayOfWeek = Number(slot.dayIndex);
        }
      });
      // Asegurar que ningún día (0..6) quede completamente vacío
      for (let day = 0; day <= 6; day++) {
        const hasDayMeals = data.weeklyPlan.some(s => Number(s.dayIndex ?? s.dayOfWeek) === day && s.recipeId);
        if (!hasDayMeals) {
          const defaultDaySlots = initial.weeklyPlan.filter(s => s.dayIndex === day);
          data.weeklyPlan.push(...defaultDaySlots);
        }
      }
    }

    // 3. Reconciliar complementos
    if (!data.complementos || data.complementos.length === 0) {
      data.complementos = initial.complementos;
    } else {
      data.complementos.forEach(c => {
        if (LEGACY_ID_MAP[c.id]) c.id = LEGACY_ID_MAP[c.id];
      });
    }

    if (!data._meta) data._meta = {};
    data._meta.version = '2.1.0';
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

  // ─── Emulación de Vistas y RPCs Transaccionales ───────────────

  // medications_view
  const getMedicationsView = () => {
    const meds = db().medications || [];
    const scheds = db().medicationSchedules || [];

    return meds.map(m => {
      const activeScheds = scheds.filter(s => s.medicationId === m.id && s.active);
      const dailyConsumption = activeScheds.reduce((sum, s) => sum + (Number(s.dose) || 0), 0);
      const currentStock = Number(m.currentStock) || 0;
      const minThreshold = Number(m.minThreshold) || 0;

      let daysRemaining = null;
      if (dailyConsumption > 0) {
        daysRemaining = Math.floor(currentStock / dailyConsumption);
      }

      const needsRestock = currentStock <= minThreshold || (daysRemaining !== null && daysRemaining <= 3);

      return {
        ...m,
        schedules: scheds.filter(s => s.medicationId === m.id),
        dailyConsumption,
        daysRemaining,
        needsRestock
      };
    });
  };

  // inventory_items_view
  const getInventoryItemsView = () => {
    const items = db().inventoryItems || [];
    const movs = db().inventoryMovements || [];
    const cats = db().inventoryCategories || [];
    const catMap = new Map(cats.map(c => [c.id, c.name]));

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 86400000;

    return items.map(item => {
      const currentStock = Number(item.currentStock) || 0;
      const minThreshold = Number(item.minThreshold) || 0;
      const categoryName = catMap.get(item.categoryId) || 'General';

      // Movimientos de salida (delta < 0)
      const itemMovs = movs.filter(m => m.itemId === item.id && m.delta < 0 && new Date(m.createdAt).getTime() >= thirtyDaysAgo);

      let daysRemaining = null;
      let avgDailyConsumption = 0;

      if (itemMovs.length >= 3) {
        const totalConsumed = itemMovs.reduce((sum, m) => sum + Math.abs(m.delta), 0);
        avgDailyConsumption = totalConsumed / 30;
        if (avgDailyConsumption > 0) {
          daysRemaining = Math.floor(currentStock / avgDailyConsumption);
        }
      }

      const isLow = currentStock <= minThreshold;

      return {
        ...item,
        categoryName,
        daysRemaining,
        avgDailyConsumption,
        isLow
      };
    });
  };

  // RPC: record_administration
  const recordAdministration = ({ medicationId, scheduleId, status, dose, notes, scheduledDate, scheduledTime }) => {
    const sDate = scheduledDate || todayStr();
    const numDose = Number(dose || 1);

    // Verificar si ya fue administrada hoy la misma dosis programada (RF-45)
    if (scheduleId) {
      const existing = db().medicationAdministrations.find(a => a.scheduleId === scheduleId && a.scheduledDate === sDate);
      if (existing) {
        throw new Error('Esta dosis ya fue registrada para el día de hoy.');
      }
    }

    // Si status === 'given' | 'administered', descontar del stock del medicamento
    if (status === 'given' || status === 'administered') {
      const med = db().medications.find(m => m.id === medicationId);
      if (!med) throw new Error('Medicamento no encontrado');
      if (Number(med.currentStock) < numDose) {
        throw new Error(`Stock insuficiente (${med.currentStock}) para administrar dosis de ${numDose}`);
      }
      const oldStock = med.currentStock;
      med.currentStock = Number(med.currentStock) - numDose;
      recordAudit('medications', med.id, 'UPDATE', ['current_stock'], { current_stock: oldStock }, { current_stock: med.currentStock });
    }

    const actor = getCurrentUser();
    const adminRecord = {
      id: uuid(),
      medicationId,
      scheduleId: scheduleId || null,
      scheduledDate: sDate,
      scheduledTime: scheduledTime || null,
      administeredAt: nowISO(),
      administeredBy: actor.id,
      administeredByName: actor.fullName,
      status: (status === 'administered' ? 'given' : status), // 'given' | 'skipped' | 'refused'
      dose: numDose,
      notes: notes || '',
      createdAt: nowISO()
    };

    db().medicationAdministrations.push(adminRecord);
    recordAudit('medication_administrations', adminRecord.id, 'INSERT', ['status', 'dose', 'notes'], {}, adminRecord);

    save();
    return adminRecord.id;
  };

  // RPC: undo_administration
  const undoAdministration = (adminId) => {
    const idx = db().medicationAdministrations.findIndex(a => a.id === adminId);
    if (idx === -1) throw new Error('Registro de administración no encontrado');

    const admin = db().medicationAdministrations[idx];

    // Si fue dada, restaurar el stock del medicamento
    if ((admin.status === 'given' || admin.status === 'administered') && admin.medicationId) {
      const med = db().medications.find(m => m.id === admin.medicationId);
      if (med) {
        const oldStock = med.currentStock;
        med.currentStock = Number(med.currentStock) + Number(admin.dose || 1);
        recordAudit('medications', med.id, 'UPDATE', ['current_stock'], { current_stock: oldStock }, { current_stock: med.currentStock });
      }
    }

    db().medicationAdministrations.splice(idx, 1);
    recordAudit('medication_administrations', adminId, 'DELETE', ['id'], admin, {});

    save();
    return true;
  };

  // RPC: adjust_inventory
  const adjustInventory = (itemId, delta, reason = '') => {
    const item = db().inventoryItems.find(i => i.id === itemId);
    if (!item) throw new Error('Insumo no encontrado');

    const oldStock = Number(item.currentStock) || 0;
    const newStock = oldStock + Number(delta);
    if (newStock < 0) {
      throw new Error('El stock resultante no puede ser menor que cero.');
    }

    item.currentStock = newStock;

    const actor = getCurrentUser();
    const mov = {
      id: uuid(),
      itemId,
      delta: Number(delta),
      previousStock: oldStock,
      newStock,
      reason: reason || (delta > 0 ? 'Ajuste manual (+)' : 'Ajuste manual (-)'),
      actorId: actor.id,
      createdAt: nowISO()
    };

    db().inventoryMovements.push(mov);
    recordAudit('inventory_items', itemId, 'UPDATE', ['current_stock'], { current_stock: oldStock }, { current_stock: newStock });

    save();
    return mov;
  };

  // RPC: record_restock
  const recordRestock = ({ medicationId, quantity, establishment = '', cost = 0 }) => {
    const med = db().medications.find(m => m.id === medicationId);
    if (!med) throw new Error('Medicamento no encontrado');

    const oldStock = Number(med.currentStock) || 0;
    const addQty = Number(quantity) || 0;
    med.currentStock = oldStock + addQty;

    const actor = getCurrentUser();
    const restockId = uuid();
    const restockRecord = {
      id: restockId,
      medicationId,
      quantity: addQty,
      establishment: establishment || '',
      cost: Number(cost) || 0,
      managedBy: actor.id,
      createdAt: nowISO()
    };
    db().medicationRestocks.push(restockRecord);

    // Crear gasto asociado automáticamente si costo > 0
    if (cost > 0) {
      db().expenses.push({
        id: uuid(),
        description: `Reposición de ${med.name}${establishment ? ' en ' + establishment : ''}`,
        amount: Number(cost),
        expenseDate: todayStr(),
        category: 'Farmacia',
        linkedRestockId: restockId,
        managedBy: actor.id,
        createdAt: nowISO()
      });
    }

    recordAudit('medications', medicationId, 'UPDATE', ['current_stock'], { current_stock: oldStock }, { current_stock: med.currentStock });

    save();
    return restockId;
  };

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

  // RPC: generate_recurring_tasks
  const generateRecurringTasks = () => {
    const today = todayStr();
    const templates = (db().taskTemplates || []).filter(t => t.active);
    let count = 0;

    templates.forEach(t => {
      const exists = db().tasks.some(task => task.templateId === t.id && task.taskDate === today);
      if (!exists) {
        db().tasks.push({
          id: uuid(),
          templateId: t.id,
          title: t.title,
          description: t.description || '',
          taskDate: today,
          shift: t.shift || t.shiftType || 'morning',
          shiftType: t.shift || t.shiftType || 'morning',
          assignedCareRoleId: t.assignedCareRoleId || null,
          assignedProfileId: t.assignedProfileId || null,
          status: 'pending',
          isEmergency: t.isEmergency || false,
          completedAt: null,
          completedBy: null,
          createdAt: nowISO()
        });
        count++;
      }
    });

    if (count > 0) save();
    return count;
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
    // Vistas
    getMedicationsView,
    getInventoryItemsView,
    // RPCs
    recordAdministration,
    undoAdministration,
    adjustInventory,
    recordRestock,
    takeShift,
    endShift,
    purgeOldAudit,
    generateRecurringTasks,
    resetToDefaults,
    sanitizeAndMigrate: () => sanitizeAndMigrate(db())
  };
})();
