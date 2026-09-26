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

  // ─── Estructura de Datos Inicial (Seed + cuidapp_db.json) ──────
  const getInitialDatabase = () => {
    const now = nowISO();
    const today = todayStr();

    return {
      _meta: {
        version: '2.3.0',
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
      supplyLocations: [
        { id: 'loc_hab', name: 'Habitación', locationType: 'habitacion', isPointOfCare: true, isDefaultStorage: false, reviewEveryHours: 50, sortOrder: 1, active: true, archivedAt: null, createdAt: now },
        { id: 'loc_arm', name: 'Armario Central', locationType: 'armario', isPointOfCare: false, isDefaultStorage: true, reviewEveryHours: 720, sortOrder: 2, active: true, archivedAt: null, createdAt: now },
        { id: 'loc_nev', name: 'Nevera', locationType: 'nevera', isPointOfCare: false, isDefaultStorage: false, reviewEveryHours: 168, sortOrder: 3, active: true, archivedAt: null, createdAt: now }
      ],
      supplySuppliers: [
        { id: 'sup_farm', name: 'Farmacia Principal', orderChannel: 'whatsapp', whatsappPhone: '+34 600 111 222', leadTimeHours: 24, notes: 'Entrega en 24h', active: true, archivedAt: null, createdAt: now },
        { id: 'sup_oxi', name: 'Oxígeno y Gases Médicos', orderChannel: 'whatsapp', whatsappPhone: '+34 600 333 444', leadTimeHours: 48, notes: 'Canje de cilindros', active: true, archivedAt: null, createdAt: now },
        { id: 'sup_dist', name: 'Distribuidora Sanitaria', orderChannel: 'phone', phone: '+34 900 100 200', leadTimeHours: 72, notes: 'Insumos continuos y pañales', active: true, archivedAt: null, createdAt: now }
      ],
      supplyRelays: [],
      supplyOrderBatches: [],
      supplyOrderLines: [],
      supplyOpenContainers: [],
      supplyExpiryRecords: [],
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
        }
      ]
    };
  };

  // ─── Migración y Auto-reparación de Esquema ────────────────────
  const sanitizeAndMigrate = (data) => {
    if (!data || typeof data !== 'object') return getInitialDatabase();

    // Colecciones que DEBEN ser arreglos siempre
    const ARRAY_COLS = [
      'careRoles', 'profiles', 'inventoryCategories', 'inventoryItems', 'inventoryMovements',
      'medications', 'medicationSchedules', 'medicationAdministrations', 'medicationRestocks',
      'taskTemplates', 'tasks', 'taskComments', 'appointments', 'recipes', 'recipeIngredients',
      'weeklyPlan', 'complementos', 'complementoIngredients', 'complementoCategories', 'availableComplementos', 'shoppingList', 'expenses',
      'shifts', 'shiftNotes', 'auditLog',
      'supplyLocations', 'supplySuppliers', 'supplyRelays', 'supplyOrderBatches', 'supplyOrderLines', 'supplyOpenContainers', 'supplyExpiryRecords'
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

    // ── Migración 2.3.0: Módulo Gestión Insumos ──
    const now = nowISO();
    if (!data.supplyLocations || data.supplyLocations.length === 0) {
      data.supplyLocations = [
        { id: 'loc_hab', name: 'Habitación', locationType: 'habitacion', isPointOfCare: true, isDefaultStorage: false, reviewEveryHours: 50, sortOrder: 1, active: true, archivedAt: null, createdAt: now },
        { id: 'loc_arm', name: 'Armario Central', locationType: 'armario', isPointOfCare: false, isDefaultStorage: true, reviewEveryHours: 720, sortOrder: 2, active: true, archivedAt: null, createdAt: now },
        { id: 'loc_nev', name: 'Nevera', locationType: 'nevera', isPointOfCare: false, isDefaultStorage: false, reviewEveryHours: 168, sortOrder: 3, active: true, archivedAt: null, createdAt: now }
      ];
    } else {
      if (!data.supplyLocations.some(l => l.id === 'loc_hab' || l.isPointOfCare)) {
        data.supplyLocations.push({ id: 'loc_hab', name: 'Habitación', locationType: 'habitacion', isPointOfCare: true, isDefaultStorage: false, reviewEveryHours: 50, sortOrder: 1, active: true, archivedAt: null, createdAt: now });
      }
      if (!data.supplyLocations.some(l => l.id === 'loc_arm' || l.isDefaultStorage)) {
        data.supplyLocations.push({ id: 'loc_arm', name: 'Armario Central', locationType: 'armario', isPointOfCare: false, isDefaultStorage: true, reviewEveryHours: 720, sortOrder: 2, active: true, archivedAt: null, createdAt: now });
      }
      if (!data.supplyLocations.some(l => l.id === 'loc_nev')) {
        data.supplyLocations.push({ id: 'loc_nev', name: 'Nevera', locationType: 'nevera', isPointOfCare: false, isDefaultStorage: false, reviewEveryHours: 168, sortOrder: 3, active: true, archivedAt: null, createdAt: now });
      }
    }

    if (!data.supplySuppliers || data.supplySuppliers.length === 0) {
      data.supplySuppliers = [
        { id: 'sup_farm', name: 'Farmacia Principal', orderChannel: 'whatsapp', whatsappPhone: '+34 600 111 222', leadTimeHours: 24, notes: 'Entrega en 24h', active: true, archivedAt: null, createdAt: now },
        { id: 'sup_oxi', name: 'Oxígeno y Gases Médicos', orderChannel: 'whatsapp', whatsappPhone: '+34 600 333 444', leadTimeHours: 48, notes: 'Canje de cilindros', active: true, archivedAt: null, createdAt: now },
        { id: 'sup_dist', name: 'Distribuidora Sanitaria', orderChannel: 'phone', phone: '+34 900 100 200', leadTimeHours: 72, notes: 'Insumos continuos y pañales', active: true, archivedAt: null, createdAt: now }
      ];
    }

    // Normalizar movimientos antiguos
    if (Array.isArray(data.inventoryMovements)) {
      data.inventoryMovements.forEach(m => {
        if (!m.id) m.id = uuid();
        m.stockState = m.stockState || 'full';
        m.locationId = m.locationId || 'loc_hab';
        m.note = m.note || m.reason || '';
        m.profileId = m.profileId || m.actorId || 'usr_admin';
        m.movementType = m.movementType || (m.delta < 0 ? 'consume' : (m.delta > 0 ? 'receive' : 'adjust'));
        m.quantity = m.quantity !== undefined ? Number(m.quantity) : (m.delta !== undefined ? Number(m.delta) : 0);
        m.qtyAbsolute = m.qtyAbsolute !== undefined ? m.qtyAbsolute : (m.movementType === 'count' ? Math.abs(m.quantity) : null);
        m.occurredAt = m.occurredAt || m.createdAt || now;
        m.clientEventId = m.clientEventId || uuid();
        if (m.voidedAt === undefined) m.voidedAt = null;
      });
    }

    // Integración de medicamentos en catálogo de insumos
    if (Array.isArray(data.medications) && Array.isArray(data.inventoryItems)) {
      data.medications.forEach(med => {
        let item = data.inventoryItems.find(i => i.medicationId === med.id);
        if (!item) {
          item = {
            id: uuid(),
            name: med.name,
            categoryId: 'cat_1',
            unit: med.unit || 'unidad',
            purchaseUnit: 'caja',
            unitsPerPurchase: 1,
            primaryLocationId: 'loc_hab',
            reserveLocationId: 'loc_arm',
            supplierId: 'sup_farm',
            medicationId: med.id,
            consumptionType: 'variable',
            dailyConsumption: null,
            treatmentEndDate: null,
            safetyMarginDays: 2,
            reviewPeriodDays: 2,
            leadTimeHours: 24,
            minThreshold: Number(med.minThreshold) || 0,
            optimalStock: med.currentStock ? Math.max(Number(med.currentStock), 10) : 10,
            isReturnable: false,
            circuitTotal: null,
            cylinderCapacityLiters: null,
            oxygenFlowLpm: null,
            hoursPerDay: null,
            paoHours: null,
            isCritical: false,
            reviewEveryHours: 50,
            stockControl: med.stockControl || 'dosis',
            currentStock: Number(med.currentStock) || 0,
            active: med.active !== false,
            createdAt: med.createdAt || now
          };
          data.inventoryItems.push(item);
        }
      });

      // Asegurar campos y conteo inicial en inventoryItems
      data.inventoryItems.forEach(item => {
        item.primaryLocationId = item.primaryLocationId || 'loc_hab';
        item.reserveLocationId = item.reserveLocationId || 'loc_arm';
        if (item.reviewEveryHours === undefined) {
          item.reviewEveryHours = item.isCritical ? 26 : 50;
        }
        if (item.stockControl === undefined) {
          item.stockControl = 'dosis';
        }
        if (item.isCritical === undefined) {
          item.isCritical = false;
        }
        const hasMovs = data.inventoryMovements.some(m => m.itemId === item.id);
        if (!hasMovs && Number(item.currentStock) > 0) {
          data.inventoryMovements.push({
            id: uuid(),
            itemId: item.id,
            locationId: item.primaryLocationId,
            stockState: 'full',
            movementType: 'count',
            quantity: Number(item.currentStock),
            qtyAbsolute: Number(item.currentStock),
            note: 'Conteo inicial por migración',
            occurredAt: item.createdAt || now,
            createdAt: item.createdAt || now,
            profileId: 'usr_admin',
            clientEventId: uuid(),
            voidedAt: null
          });
        }
      });

      // Recalcular caché con InventoryCalc si está disponible
      if (typeof InventoryCalc !== 'undefined' && InventoryCalc.deriveStock) {
        data.inventoryItems.forEach(item => {
          const derived = InventoryCalc.deriveStock(item.id, data.inventoryMovements);
          item.currentStock = derived.netFull;
          if (item.medicationId) {
            const med = data.medications.find(m => m.id === item.medicationId);
            if (med) med.currentStock = derived.netFull;
          }
        });
      }
    }

    if (!data._meta) data._meta = {};
    data._meta.version = '2.3.0';
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

  // ─── PhotoStore: Almacenamiento Seguro de Fotos en IndexedDB (RNF-04) ─
  const PhotoStore = (() => {
    const DB_NAME = 'cuidapp_photos_db';
    const STORE_NAME = 'relay_photos';
    let dbPromise = null;
    const getDB = () => {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') return resolve(null);
        try {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(STORE_NAME)) {
              d.createObjectStore(STORE_NAME, { keyPath: 'clientEventId' });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      return dbPromise;
    };
    const savePhoto = async (clientEventId, blob) => {
      const d = await getDB();
      if (!d) return false;
      return new Promise((resolve) => {
        try {
          const tx = d.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put({ clientEventId, blob, createdAt: new Date().toISOString() });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    };
    const getPhoto = async (clientEventId) => {
      const d = await getDB();
      if (!d) return null;
      return new Promise((resolve) => {
        try {
          const tx = d.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(clientEventId);
          req.onsuccess = () => resolve(req.result ? req.result.blob : null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    };
    return { savePhoto, getPhoto };
  })();

  // Recalcular caché de stock (currentStock) usando el libro de movimientos
  const recalcStockCache = (itemId) => {
    if (typeof InventoryCalc === 'undefined' || !InventoryCalc.deriveStock) return;
    const item = db().inventoryItems.find(i => i.id === itemId);
    if (!item) return;
    const derived = InventoryCalc.deriveStock(itemId, db().inventoryMovements);
    item.currentStock = derived.netFull;
    if (item.medicationId) {
      const med = db().medications.find(m => m.id === item.medicationId);
      if (med) med.currentStock = derived.netFull;
    }
  };

  const update = (col, id, updates, auditTableName = null) => {
    const idx = db()[col].findIndex(item => item.id === id);
    if (idx === -1) return null;

    const oldItem = { ...db()[col][idx] };

    // Regla de solo lectura: el stock se calcula desde el libro de movimientos
    if ((col === 'inventoryItems' || col === 'medications') && updates.currentStock !== undefined && updates.currentStock !== oldItem.currentStock) {
      throw new Error('STOCK_LEDGER: El stock es de solo lectura y se calcula desde el libro de movimientos.');
    }

    // Guardas de ubicaciones
    if (col === 'supplyLocations') {
      if (updates.active !== undefined && updates.active !== oldItem.active) {
        throw new Error('UBICACION_ESTADO: active solo cambia por RPC archive/restore.');
      }
      if (updates.isPointOfCare !== undefined && updates.isPointOfCare !== oldItem.isPointOfCare) {
        throw new Error('UBICACION_ESPECIAL: La función especial solo cambia por setSpecialLocation.');
      }
      if (updates.isDefaultStorage !== undefined && updates.isDefaultStorage !== oldItem.isDefaultStorage) {
        throw new Error('UBICACION_ESPECIAL: La función especial solo cambia por setSpecialLocation.');
      }
    }

    // Regla de frecuencia al marcar/desmarcar crítico
    if (col === 'inventoryItems' && updates.isCritical !== undefined) {
      if (updates.isCritical && (oldItem.reviewEveryHours === null || oldItem.reviewEveryHours === undefined || oldItem.reviewEveryHours === 50 || oldItem.reviewEveryHours === 720)) {
        updates.reviewEveryHours = 26;
      } else if (!updates.isCritical && oldItem.reviewEveryHours === 26) {
        updates.reviewEveryHours = 50;
      }
    }

    // Sincronización de nombre de medicamento en catálogo de insumos
    if (col === 'medications' && updates.name && updates.name !== oldItem.name) {
      const invItem = db().inventoryItems.find(i => i.medicationId === id);
      if (invItem) invItem.name = updates.name;
    }

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

    // Guardas de eliminación
    if (col === 'supplyLocations') {
      if (oldItem.isPointOfCare || oldItem.isDefaultStorage || oldItem.id === 'loc_hab' || oldItem.id === 'loc_arm') {
        throw new Error('UBICACION_ESPECIAL: Habitación y Armario no se pueden borrar.');
      }
      const hasHistory = (db().inventoryMovements || []).some(m => m.locationId === id) ||
                         (db().supplyRelays || []).some(r => r.locationId === id) ||
                         (db().inventoryItems || []).some(i => i.primaryLocationId === id || i.reserveLocationId === id);
      if (hasHistory) {
        throw new Error('UBICACION_CON_HISTORIAL: Esta ubicación tiene historial: archívala en lugar de borrarla.');
      }
    }

    if (col === 'supplySuppliers') {
      const hasHistory = (db().supplyOrderLines || []).some(o => o.supplierId === id) ||
                         (db().inventoryItems || []).some(i => i.supplierId === id);
      if (hasHistory) {
        throw new Error('PROVEEDOR_CON_HISTORIAL: Este proveedor tiene historial: archívalo en lugar de borrarlo.');
      }
    }

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

  // inventory_items_view (completa con columnas nuevas y uniones)
  const getInventoryItemsView = () => {
    const items = db().inventoryItems || [];
    const movs = (db().inventoryMovements || []).filter(m => !m.voidedAt);
    const cats = db().inventoryCategories || [];
    const locs = db().supplyLocations || [];
    const sups = db().supplySuppliers || [];
    const meds = db().medications || [];
    const scheds = db().medicationSchedules || [];
    const orders = (db().supplyOrderLines || []).filter(o => o.status === 'in_transit');

    const catMap = new Map(cats.map(c => [c.id, c.name]));
    const locMap = new Map(locs.map(l => [l.id, l]));
    const supMap = new Map(sups.map(s => [s.id, s]));

    return items.map(item => {
      const currentStock = Number(item.currentStock) || 0;
      const minThreshold = Number(item.minThreshold) || 0;
      const categoryName = catMap.get(item.categoryId) || 'General';
      const primaryLoc = locMap.get(item.primaryLocationId);
      const reserveLoc = locMap.get(item.reserveLocationId);
      const sup = supMap.get(item.supplierId);
      const med = item.medicationId ? meds.find(m => m.id === item.medicationId) : null;

      // Pauta de medicación
      let pautaDailyAmount = 0;
      if (item.medicationId) {
        const activeScheds = scheds.filter(s => s.medicationId === item.medicationId && s.active);
        pautaDailyAmount = activeScheds.reduce((sum, s) => sum + (Number(s.dose) || 0), 0);
      }

      // Pedidos en tránsito para este ítem
      const itemOrders = orders.filter(o => o.itemId === item.id);
      const inTransitBase = itemOrders.reduce((sum, o) => sum + (Number(o.orderedQtyBase) || 0), 0);
      const nextExpectedBy = itemOrders.map(o => o.expectedBy).filter(Boolean).sort()[0] || null;

      // Frecuencia efectiva de revisión en su punto de uso
      const effectiveReviewHours = item.reviewEveryHours || (primaryLoc?.reviewEveryHours) || 50;

      // Último conteo en punto de uso
      const pocCounts = movs.filter(m => m.itemId === item.id && m.locationId === item.primaryLocationId && m.movementType === 'count')
        .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
      const pointOfCareLastCountedAt = pocCounts[0] ? pocCounts[0].occurredAt : null;

      // Cantidad de vacíos para retornables
      let emptyQuantity = 0;
      if (item.isReturnable) {
        const itemMovs = movs.filter(m => m.itemId === item.id);
        const derived = typeof InventoryCalc !== 'undefined' && InventoryCalc.deriveStock
          ? InventoryCalc.deriveStock(item.id, itemMovs)
          : { netEmpty: 0 };
        emptyQuantity = derived.netEmpty || 0;
      }

      return {
        ...item,
        categoryName,
        primaryLocationName: primaryLoc?.name || 'Habitación',
        reserveLocationName: reserveLoc?.name || 'Armario Central',
        supplierName: sup?.name || null,
        supplierLeadTimeHours: sup?.leadTimeHours || 24,
        supplierWhatsapp: sup?.whatsappPhone || null,
        medicationStatus: med?.status || null,
        pautaDailyAmount,
        inTransitBase,
        nextExpectedBy,
        effectiveReviewHours,
        pointOfCareLastCountedAt,
        emptyQuantity,
        isLow: currentStock <= minThreshold
      };
    });
  };

  // supply_locations_view
  const getSupplyLocationsView = ({ includeArchived = false } = {}) => {
    let locs = db().supplyLocations || [];
    if (!includeArchived) {
      locs = locs.filter(l => l.active !== false && !l.archivedAt);
    }
    const items = db().inventoryItems || [];
    const orders = db().supplyOrderLines || [];
    const containers = db().supplyOpenContainers || [];
    const movs = db().inventoryMovements || [];
    const relays = db().supplyRelays || [];

    return locs.map(loc => {
      const itemsCount = items.filter(i => (i.primaryLocationId === loc.id || i.reserveLocationId === loc.id) && i.active !== false).length;
      const activeOrdersCount = orders.filter(o => o.targetLocationId === loc.id && o.status === 'in_transit').length;
      const openContainersCount = containers.filter(c => c.locationId === loc.id && c.status === 'open').length;
      const hasHistory = movs.some(m => m.locationId === loc.id) ||
                         relays.some(r => r.locationId === loc.id) ||
                         items.some(i => i.primaryLocationId === loc.id || i.reserveLocationId === loc.id) ||
                         orders.some(o => o.targetLocationId === loc.id);

      return {
        ...loc,
        itemsCount,
        activeOrdersCount,
        openContainersCount,
        hasHistory
      };
    }).sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
  };

  // supply_suppliers_view
  const getSupplySuppliersView = ({ includeArchived = false } = {}) => {
    let sups = db().supplySuppliers || [];
    if (!includeArchived) {
      sups = sups.filter(s => s.active !== false && !s.archivedAt);
    }
    const items = db().inventoryItems || [];
    const orders = db().supplyOrderLines || [];

    return sups.map(sup => {
      const itemsCount = items.filter(i => i.supplierId === sup.id && i.active !== false).length;
      const ordersCount = orders.filter(o => o.supplierId === sup.id).length;
      const hasHistory = ordersCount > 0 || items.some(i => i.supplierId === sup.id);
      return {
        ...sup,
        itemsCount,
        ordersCount,
        hasHistory
      };
    });
  };

  // inventory_stock_view
  const getInventoryStockView = () => {
    const items = db().inventoryItems || [];
    const locs = db().supplyLocations || [];
    const movs = (db().inventoryMovements || []).filter(m => !m.voidedAt);
    const rows = [];

    items.forEach(item => {
      const itemMovs = movs.filter(m => m.itemId === item.id);
      const locIds = new Set(itemMovs.map(m => m.locationId));
      if (item.primaryLocationId) locIds.add(item.primaryLocationId);
      if (item.reserveLocationId) locIds.add(item.reserveLocationId);

      locIds.forEach(locId => {
        const loc = locs.find(l => l.id === locId);
        const derived = typeof InventoryCalc !== 'undefined' && InventoryCalc.deriveStock
          ? InventoryCalc.deriveStock(item.id, itemMovs)
          : { byLocation: {} };
        const locData = (derived.byLocation && derived.byLocation[locId]) || { full: 0, empty: 0, lastCountedAt: null };

        rows.push({
          itemId: item.id,
          locationId: locId,
          locationName: loc?.name || locId,
          stockState: 'full',
          rawQuantity: locData.full,
          lastCountedAt: locData.lastCountedAt
        });

        if (item.isReturnable) {
          rows.push({
            itemId: item.id,
            locationId: locId,
            locationName: loc?.name || locId,
            stockState: 'empty',
            rawQuantity: locData.empty,
            lastCountedAt: locData.lastCountedAt
          });
        }
      });
    });
    return rows;
  };

  // Contexto para InventoryCalc.buildSupplyPlan
  const getSupplyPlanContext = () => {
    const items = getInventoryItemsView();
    const movs = (db().inventoryMovements || []).filter(m => !m.voidedAt);
    const orderLines = (db().supplyOrderLines || []).filter(o => o.status === 'in_transit');
    const locations = db().supplyLocations || [];
    const suppliers = db().supplySuppliers || [];
    const lastRelay = (db().supplyRelays || []).slice().sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))[0];
    const pendingReviewItemIds = lastRelay ? (lastRelay.omittedItemIds || []) : [];

    return {
      items,
      movements: movs,
      orderLines,
      locations,
      suppliers,
      pendingReviewItemIds,
      now: new Date()
    };
  };

  // RPC: record_administration (con método de control y sin bloqueo por stock)
  const recordAdministration = ({ medicationId, scheduleId, status, dose, notes, scheduledDate, scheduledTime }) => {
    const sDate = scheduledDate || todayStr();
    const numDose = Number(dose || 1);

    if (scheduleId) {
      const existing = db().medicationAdministrations.find(a => a.scheduleId === scheduleId && a.scheduledDate === sDate);
      if (existing) {
        throw new Error('Esta dosis ya fue registrada para el día de hoy.');
      }
    }

    const med = db().medications.find(m => m.id === medicationId);
    if (!med) throw new Error('Medicamento no encontrado');
    const invItem = db().inventoryItems.find(i => i.medicationId === medicationId);

    const actor = getCurrentUser();
    const adminId = uuid();
    const adminRecord = {
      id: adminId,
      medicationId,
      scheduleId: scheduleId || null,
      scheduledDate: sDate,
      scheduledTime: scheduledTime || null,
      administeredAt: nowISO(),
      administeredBy: actor.id,
      administeredByName: actor.fullName,
      status: (status === 'administered' ? 'given' : status),
      dose: numDose,
      notes: notes || '',
      createdAt: nowISO()
    };

    db().medicationAdministrations.push(adminRecord);
    recordAudit('medication_administrations', adminId, 'INSERT', ['status', 'dose', 'notes'], {}, adminRecord);

    // Descontar stock solo si status === 'given' y método de control es 'dosis'
    if (status === 'given' || status === 'administered') {
      const stockCtrl = med.stockControl || invItem?.stockControl || 'dosis';
      if (stockCtrl === 'dosis' && invItem) {
        db().inventoryMovements.push({
          id: uuid(),
          itemId: invItem.id,
          locationId: invItem.primaryLocationId || 'loc_hab',
          stockState: 'full',
          movementType: 'consume',
          quantity: -numDose,
          qtyAbsolute: null,
          administrationId: adminId,
          note: `Dosis administrada de ${med.name}`,
          profileId: actor.id,
          occurredAt: nowISO(),
          clientEventId: uuid(),
          voidedAt: null,
          createdAt: nowISO()
        });
        recalcStockCache(invItem.id);
      }
    }

    save();
    return adminId;
  };

  // RPC: undo_administration
  const undoAdministration = (adminId) => {
    const idx = db().medicationAdministrations.findIndex(a => a.id === adminId);
    if (idx === -1) throw new Error('Registro de administración no encontrado');

    const admin = db().medicationAdministrations[idx];

    // Anular movimiento de consumo vinculado
    const mov = db().inventoryMovements.find(m => m.administrationId === adminId);
    if (mov) {
      mov.voidedAt = nowISO();
      recalcStockCache(mov.itemId);
    }

    db().medicationAdministrations.splice(idx, 1);
    recordAudit('medication_administrations', adminId, 'DELETE', ['id'], admin, {});

    save();
    return true;
  };

  // RPC: adjust_inventory (compatible con 4.º parámetro locationId)
  const adjustInventory = (itemId, delta, reason = '', locationId = null) => {
    const item = db().inventoryItems.find(i => i.id === itemId);
    if (!item) throw new Error('Insumo no encontrado');

    const actor = getCurrentUser();
    const mov = {
      id: uuid(),
      itemId,
      locationId: locationId || item.primaryLocationId || 'loc_hab',
      stockState: 'full',
      movementType: 'adjust',
      quantity: Number(delta),
      qtyAbsolute: null,
      note: reason || (delta > 0 ? 'Ajuste manual (+)' : 'Ajuste manual (-)'),
      profileId: actor.id,
      occurredAt: nowISO(),
      clientEventId: uuid(),
      voidedAt: null,
      createdAt: nowISO()
    };

    db().inventoryMovements.push(mov);
    recalcStockCache(itemId);

    save();
    return mov;
  };

  // RPC: record_restock
  const recordRestock = ({ medicationId, quantity, establishment = '', cost = 0 }) => {
    const med = db().medications.find(m => m.id === medicationId);
    if (!med) throw new Error('Medicamento no encontrado');

    const actor = getCurrentUser();
    const restockId = uuid();
    const addQty = Number(quantity) || 0;

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

    // Entrada en el libro de movimientos
    const invItem = db().inventoryItems.find(i => i.medicationId === medicationId);
    if (invItem) {
      db().inventoryMovements.push({
        id: uuid(),
        itemId: invItem.id,
        locationId: invItem.reserveLocationId || invItem.primaryLocationId || 'loc_arm',
        stockState: 'full',
        movementType: 'receive',
        quantity: addQty,
        qtyAbsolute: null,
        note: `Compra en ${establishment || 'Farmacia'}`,
        profileId: actor.id,
        occurredAt: nowISO(),
        clientEventId: uuid(),
        voidedAt: null,
        createdAt: nowISO()
      });
      recalcStockCache(invItem.id);
    } else {
      med.currentStock = (Number(med.currentStock) || 0) + addQty;
    }

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

    save();
    return restockId;
  };

  // ─── RPCs del Módulo «Gestión Insumos» ─────────────────────────

  // RPC: record_supply_movements
  const recordSupplyMovements = (rows = []) => {
    if (!Array.isArray(rows) || rows.length === 0) return { ok: true, count: 0 };
    const existingEvents = new Set(db().inventoryMovements.map(m => m.clientEventId).filter(Boolean));
    const toInsert = [];
    const now = nowISO();
    const actor = getCurrentUser();
    const affectedItems = new Set();

    for (const r of rows) {
      if (r.clientEventId && existingEvents.has(r.clientEventId)) {
        continue;
      }
      if (r.movementType === 'receive') {
        throw new Error('STOCK_LEDGER: recordSupplyMovements no admite tipo receive. Usa la recepción de compras.');
      }
      const item = db().inventoryItems.find(i => i.id === r.itemId);
      if (!item) throw new Error(`STOCK_LEDGER: Insumo ${r.itemId} no encontrado`);

      const mov = {
        id: uuid(),
        itemId: r.itemId,
        locationId: r.locationId || item.primaryLocationId || 'loc_hab',
        stockState: r.stockState || 'full',
        movementType: r.movementType,
        quantity: r.quantity !== undefined ? Number(r.quantity) : 0,
        qtyAbsolute: r.qtyAbsolute !== undefined && r.qtyAbsolute !== null ? Number(r.qtyAbsolute) : null,
        note: r.note || '',
        groupId: r.groupId || null,
        clientEventId: r.clientEventId || uuid(),
        occurredAt: r.occurredAt || now,
        profileId: actor.id,
        voidedAt: null,
        createdAt: now
      };
      toInsert.push(mov);
      affectedItems.add(r.itemId);
    }

    if (toInsert.length > 0) {
      db().inventoryMovements.push(...toInsert);
      affectedItems.forEach(itemId => recalcStockCache(itemId));
      save();
    }
    return { ok: true, count: toInsert.length };
  };

  // RPC: save_supply_relay_full
  const saveSupplyRelayFull = (relay, counts = [], movements = []) => {
    const now = nowISO();
    const actor = getCurrentUser();
    if (!relay.occurredAt) relay.occurredAt = now;
    if (new Date(relay.occurredAt) > new Date()) {
      throw new Error('La hora del conteo no puede ser futura');
    }

    if (relay.clientEventId) {
      const existing = db().supplyRelays.find(r => r.clientEventId === relay.clientEventId);
      if (existing) return { ok: true, relayId: existing.id, duplicate: true };
    }

    const relayId = uuid();
    const relayRecord = {
      id: relayId,
      locationId: relay.locationId || 'loc_hab',
      occurredAt: relay.occurredAt,
      shiftId: relay.shiftId || null,
      shiftSlot: 'any',
      countedByName: relay.countedByName || actor.fullName || 'Cuidador',
      verifiedByProfileId: actor.id,
      notes: relay.notes || '',
      photoPath: relay.photoPath || null,
      countsCount: counts.length,
      omittedItemIds: relay.omittedItemIds || [],
      clientEventId: relay.clientEventId || uuid(),
      createdAt: now
    };

    db().supplyRelays.push(relayRecord);

    const toInsertMovs = [];
    const affectedItems = new Set();

    // Movimientos inferidos o traslados
    for (const m of movements) {
      const item = db().inventoryItems.find(i => i.id === m.itemId);
      if (!item) continue;
      toInsertMovs.push({
        id: uuid(),
        itemId: m.itemId,
        locationId: m.locationId || item.primaryLocationId || 'loc_hab',
        stockState: m.stockState || 'full',
        movementType: m.movementType || 'transfer',
        quantity: Number(m.quantity) || 0,
        qtyAbsolute: m.qtyAbsolute !== undefined ? m.qtyAbsolute : null,
        note: m.note || 'Traslado inferido por relevo',
        groupId: m.groupId || null,
        relayId,
        clientEventId: m.clientEventId || uuid(),
        occurredAt: m.occurredAt || relay.occurredAt,
        profileId: actor.id,
        voidedAt: null,
        createdAt: now
      });
      affectedItems.add(m.itemId);
    }

    // Conteos del relevo
    for (const c of counts) {
      const item = db().inventoryItems.find(i => i.id === c.itemId);
      if (!item) continue;
      toInsertMovs.push({
        id: uuid(),
        itemId: c.itemId,
        locationId: relay.locationId || item.primaryLocationId || 'loc_hab',
        stockState: c.stockState || 'full',
        movementType: 'count',
        quantity: Number(c.countedQty) || 0,
        qtyAbsolute: Number(c.countedQty) || 0,
        note: 'Conteo físico de relevo',
        groupId: null,
        relayId,
        clientEventId: uuid(),
        occurredAt: relay.occurredAt,
        profileId: actor.id,
        voidedAt: null,
        createdAt: now
      });
      affectedItems.add(c.itemId);
    }

    db().inventoryMovements.push(...toInsertMovs);
    affectedItems.forEach(itemId => recalcStockCache(itemId));
    save();
    return { ok: true, relayId };
  };

  // RPC: mark_supply_in_transit
  const markSupplyInTransit = (supplierId, lines = [], clientEventId, expectedBy = null) => {
    const now = nowISO();
    const actor = getCurrentUser();

    if (clientEventId) {
      const existingBatch = db().supplyOrderBatches.find(b => b.clientEventId === clientEventId);
      if (existingBatch) {
        return { ok: true, batchId: existingBatch.id, linesCount: existingBatch.linesCount, duplicate: true };
      }
    }

    // Control de conflictos antiduplicidad
    const conflicts = [];
    for (const l of lines) {
      const openLine = db().supplyOrderLines.find(ol => ol.itemId === l.itemId && ol.status === 'in_transit');
      if (openLine) {
        const item = db().inventoryItems.find(i => i.id === l.itemId);
        const orderedByProfile = db().profiles.find(p => p.id === openLine.orderedByProfileId);
        conflicts.push({
          itemId: l.itemId,
          itemName: item?.name || 'Insumo',
          orderedBy: orderedByProfile?.fullName || 'Otro cuidador',
          orderedAt: openLine.orderedAt
        });
      }
    }
    if (conflicts.length > 0) {
      return { ok: false, conflict: true, conflicts };
    }

    const batchId = uuid();
    const batch = {
      id: batchId,
      supplierId: supplierId || null,
      status: 'ordered',
      linesCount: lines.length,
      clientEventId: clientEventId || uuid(),
      orderedByProfileId: actor.id,
      createdAt: now
    };
    db().supplyOrderBatches.push(batch);

    for (const l of lines) {
      const item = db().inventoryItems.find(i => i.id === l.itemId);
      const targetLoc = l.targetLocationId || item?.reserveLocationId || item?.primaryLocationId || 'loc_arm';
      db().supplyOrderLines.push({
        id: uuid(),
        batchId,
        supplierId: supplierId || item?.supplierId || null,
        itemId: l.itemId,
        targetLocationId: targetLoc,
        orderedQtyPurchase: Number(l.orderedQtyPurchase) || 1,
        unitsPerPurchase: Number(l.unitsPerPurchase) || item?.unitsPerPurchase || 1,
        orderedQtyBase: Number(l.orderedQtyBase) || (Number(l.orderedQtyPurchase || 1) * (Number(l.unitsPerPurchase) || item?.unitsPerPurchase || 1)),
        receivedQtyBase: 0,
        status: 'in_transit',
        expectedBy: expectedBy || null,
        orderedAt: now,
        receivedAt: null,
        orderedByProfileId: actor.id,
        createdAt: now
      });
    }

    save();
    return { ok: true, batchId, linesCount: lines.length };
  };

  // RPC: receive_supply_order_line
  const receiveSupplyOrderLine = ({ lineId, receivedQtyBase, clientEventId, locationId, emptiesSent = 0, cost = 0, receivedAt }) => {
    const line = db().supplyOrderLines.find(l => l.id === lineId);
    if (!line) throw new Error('Línea de pedido no encontrada');
    if (line.status !== 'in_transit') {
      return { ok: true, alreadyReceived: true };
    }

    const item = db().inventoryItems.find(i => i.id === line.itemId);
    if (!item) throw new Error('Insumo no encontrado');

    const now = nowISO();
    const actor = getCurrentUser();
    const targetLoc = locationId || line.targetLocationId || item.reserveLocationId || item.primaryLocationId || 'loc_arm';
    const recQty = Number(receivedQtyBase) || Number(line.orderedQtyBase);

    // Actualizar pedido
    line.receivedQtyBase = recQty;
    line.status = recQty >= Number(line.orderedQtyBase) ? 'received' : 'partial';
    line.receivedAt = receivedAt || now;

    // Movimiento de recepción
    db().inventoryMovements.push({
      id: uuid(),
      itemId: item.id,
      locationId: targetLoc,
      stockState: 'full',
      movementType: 'receive',
      quantity: recQty,
      qtyAbsolute: null,
      orderLineId: line.id,
      note: 'Recepción de compra',
      profileId: actor.id,
      occurredAt: receivedAt || now,
      clientEventId: clientEventId || uuid(),
      voidedAt: null,
      createdAt: now
    });

    // Canje de vacíos si aplica
    if (emptiesSent > 0 && item.isReturnable) {
      db().inventoryMovements.push({
        id: uuid(),
        itemId: item.id,
        locationId: targetLoc,
        stockState: 'empty',
        movementType: 'exchange_out',
        quantity: -Number(emptiesSent),
        qtyAbsolute: null,
        orderLineId: line.id,
        note: 'Canje de vacíos en entrega',
        profileId: actor.id,
        occurredAt: receivedAt || now,
        clientEventId: uuid(),
        voidedAt: null,
        createdAt: now
      });
    }

    // Crear gasto opcional
    if (cost > 0) {
      const category = item.isReturnable ? 'Gases Medicinales' : 'Farmacia';
      db().expenses.push({
        id: uuid(),
        description: `Compra: ${item.name} (${recQty} ${item.unit})`,
        amount: Number(cost),
        expenseDate: todayStr(),
        category,
        managedBy: actor.id,
        createdAt: now
      });
    }

    // Si es fármaco, registrar en medicationRestocks
    if (item.medicationId) {
      db().medicationRestocks.push({
        id: uuid(),
        medicationId: item.medicationId,
        quantity: recQty,
        establishment: 'Proveedor',
        cost: Number(cost) || 0,
        managedBy: actor.id,
        createdAt: now
      });
    }

    recalcStockCache(item.id);
    save();
    return { ok: true, lineId: line.id, status: line.status };
  };

  // RPC: cancel_supply_order_line
  const cancelSupplyOrderLine = (lineId, reason = '') => {
    const line = db().supplyOrderLines.find(l => l.id === lineId);
    if (!line) throw new Error('Línea de pedido no encontrada');
    line.status = 'cancelled';
    line.notes = reason || 'Liberado por cuidador';
    save();
    return { ok: true, lineId };
  };

  // RPC: void_supply_movement
  const voidSupplyMovement = (movementId) => {
    const mov = db().inventoryMovements.find(m => m.id === movementId);
    if (!mov) throw new Error('Movimiento no encontrado');
    if (mov.movementType === 'receive') {
      throw new Error('STOCK_LEDGER: Las recepciones no se pueden anular directamente; libera o ajusta el pedido.');
    }
    if (mov.administrationId) {
      throw new Error('STOCK_LEDGER: Los consumos por dosis clínica se anulan desde la administración de medicamentos.');
    }

    const now = nowISO();
    const affectedItems = new Set([mov.itemId]);

    if (mov.groupId) {
      db().inventoryMovements.filter(m => m.groupId === mov.groupId).forEach(m => {
        m.voidedAt = now;
        affectedItems.add(m.itemId);
      });
    } else {
      mov.voidedAt = now;
    }

    affectedItems.forEach(itemId => recalcStockCache(itemId));
    save();
    return { ok: true, movementId };
  };

  // RPC: archive_supply_location
  const archiveSupplyLocation = (id, transferToId = null, note = '') => {
    const user = getCurrentUser();
    if (user.appRole !== 'admin') {
      throw new Error('UBICACION_PERMISO: Solo un administrador puede archivar ubicaciones.');
    }
    const loc = db().supplyLocations.find(l => l.id === id);
    if (!loc) throw new Error('Ubicación no encontrada');
    if (loc.isPointOfCare || loc.isDefaultStorage || loc.id === 'loc_hab' || loc.id === 'loc_arm') {
      throw new Error('UBICACION_ESPECIAL: El punto de uso y el almacén por defecto no se pueden archivar.');
    }
    if (loc.archivedAt || loc.active === false) {
      return { ok: true, alreadyArchived: true };
    }

    const items = db().inventoryItems || [];
    const movs = (db().inventoryMovements || []).filter(m => !m.voidedAt);
    const hasRefs = items.some(i => i.primaryLocationId === id || i.reserveLocationId === id) ||
                    movs.some(m => m.locationId === id);

    if (hasRefs && !transferToId) {
      throw new Error('UBICACION_CON_STOCK: Esta ubicación tiene insumos o stock; especifica una ubicación de destino.');
    }

    const now = nowISO();
    const destLoc = transferToId ? db().supplyLocations.find(l => l.id === transferToId) : null;
    if (transferToId && (!destLoc || !destLoc.active)) {
      throw new Error('UBICACION_ARCHIVADA: La ubicación de destino debe estar activa.');
    }

    // Trasladar stock y saldos
    if (transferToId) {
      items.forEach(item => {
        const itemMovs = movs.filter(m => m.itemId === item.id);
        const derived = typeof InventoryCalc !== 'undefined' && InventoryCalc.deriveStock
          ? InventoryCalc.deriveStock(item.id, itemMovs)
          : { byLocation: {} };
        const locStock = derived.byLocation && derived.byLocation[id];
        if (locStock && locStock.full > 0) {
          const groupId = uuid();
          db().inventoryMovements.push(
            { id: uuid(), itemId: item.id, locationId: id, stockState: 'full', movementType: 'transfer', quantity: -locStock.full, qtyAbsolute: null, note: `Traslado por archivo de ubicación hacia ${destLoc.name}`, groupId, profileId: user.id, occurredAt: now, clientEventId: uuid(), voidedAt: null, createdAt: now },
            { id: uuid(), itemId: item.id, locationId: transferToId, stockState: 'full', movementType: 'transfer', quantity: locStock.full, qtyAbsolute: null, note: `Traslado por archivo de ubicación desde ${loc.name}`, groupId, profileId: user.id, occurredAt: now, clientEventId: uuid(), voidedAt: null, createdAt: now }
          );
        } else if (locStock && locStock.full < 0) {
          db().inventoryMovements.push({
            id: uuid(), itemId: item.id, locationId: id, stockState: 'full', movementType: 'adjust', quantity: Math.abs(locStock.full), qtyAbsolute: null, note: 'Ajuste de saldo negativo por archivo de ubicación', profileId: user.id, occurredAt: now, clientEventId: uuid(), voidedAt: null, createdAt: now
          });
        }
        recalcStockCache(item.id);

        if (item.primaryLocationId === id) item.primaryLocationId = transferToId;
        if (item.reserveLocationId === id) item.reserveLocationId = transferToId;
      });

      // Reubicar pedidos en camino y envases abiertos
      (db().supplyOrderLines || []).filter(o => o.targetLocationId === id).forEach(o => o.targetLocationId = transferToId);
      (db().supplyOpenContainers || []).filter(c => c.locationId === id).forEach(c => c.locationId = transferToId);
      (db().supplyExpiryRecords || []).filter(e => e.locationId === id).forEach(e => e.locationId = transferToId);
    }

    loc.active = false;
    loc.archivedAt = now;
    loc.notes = note || loc.notes;

    save();
    return { ok: true, locationId: id, active: false };
  };

  // RPC: restore_supply_location
  const restoreSupplyLocation = (id) => {
    const user = getCurrentUser();
    if (user.appRole !== 'admin') {
      throw new Error('UBICACION_PERMISO: Solo un administrador puede restaurar ubicaciones.');
    }
    const loc = db().supplyLocations.find(l => l.id === id);
    if (!loc) throw new Error('Ubicación no encontrada');
    loc.active = true;
    loc.archivedAt = null;
    save();
    return { ok: true, locationId: id, active: true };
  };

  // RPC: set_special_location (admin)
  const setSpecialLocation = (id, role) => {
    const user = getCurrentUser();
    if (user.appRole !== 'admin') {
      throw new Error('UBICACION_PERMISO: Solo un administrador puede reasignar funciones especiales.');
    }
    const loc = db().supplyLocations.find(l => l.id === id);
    if (!loc || !loc.active) throw new Error('La ubicación debe existir y estar activa.');

    if (role === 'point_of_care') {
      db().supplyLocations.forEach(l => l.isPointOfCare = (l.id === id));
    } else if (role === 'default_storage') {
      db().supplyLocations.forEach(l => l.isDefaultStorage = (l.id === id));
    } else {
      throw new Error('Rol de ubicación no válido.');
    }

    save();
    return { ok: true, locationId: id, role };
  };

  // RPC: archive_supply_supplier
  const archiveSupplySupplier = (id) => {
    const user = getCurrentUser();
    if (user.appRole !== 'admin') {
      throw new Error('PROVEEDOR_PERMISO: Solo un administrador puede archivar proveedores.');
    }
    const sup = db().supplySuppliers.find(s => s.id === id);
    if (!sup) throw new Error('Proveedor no encontrado');
    const inTransit = (db().supplyOrderLines || []).some(o => o.supplierId === id && o.status === 'in_transit');
    if (inTransit) {
      throw new Error('PROVEEDOR_CON_PEDIDOS: No se puede archivar un proveedor con pedidos en camino.');
    }
    sup.active = false;
    sup.archivedAt = nowISO();
    save();
    return { ok: true, supplierId: id, active: false };
  };

  // RPC: restore_supply_supplier
  const restoreSupplySupplier = (id) => {
    const user = getCurrentUser();
    if (user.appRole !== 'admin') {
      throw new Error('PROVEEDOR_PERMISO: Solo un administrador puede restaurar proveedores.');
    }
    const sup = db().supplySuppliers.find(s => s.id === id);
    if (!sup) throw new Error('Proveedor no encontrado');
    sup.active = true;
    sup.archivedAt = null;
    save();
    return { ok: true, supplierId: id, active: true };
  };

  // RPC: delete_supply_location
  const deleteSupplyLocation = (id) => {
    const user = getCurrentUser();
    if (user.appRole !== 'admin') {
      throw new Error('UBICACION_PERMISO: Solo un administrador puede borrar ubicaciones.');
    }
    return remove('supplyLocations', id, 'supply_locations');
  };

  // RPC: delete_supply_supplier
  const deleteSupplySupplier = (id) => {
    const user = getCurrentUser();
    if (user.appRole !== 'admin') {
      throw new Error('PROVEEDOR_PERMISO: Solo un administrador puede borrar proveedores.');
    }
    return remove('supplySuppliers', id, 'supply_suppliers');
  };

  // Apertura y Cierre de Envases (PAO)
  const openContainer = ({ itemId, locationId, clientEventId, expiresAt, openedAt }) => {
    const now = nowISO();
    const actor = getCurrentUser();
    const item = db().inventoryItems.find(i => i.id === itemId);
    if (!item) throw new Error('Insumo no encontrado');

    const container = {
      id: uuid(),
      itemId,
      locationId: locationId || item.primaryLocationId || 'loc_hab',
      openedAt: openedAt || now,
      expiresAt: expiresAt || null,
      status: 'open',
      clientEventId: clientEventId || uuid(),
      openedByProfileId: actor.id,
      closedAt: null,
      notes: '',
      createdAt: now
    };
    db().supplyOpenContainers.push(container);
    save();
    return container;
  };

  const closeContainer = (containerId, clientEventId = null, closedAt = null, notes = '') => {
    const container = db().supplyOpenContainers.find(c => c.id === containerId);
    if (!container) throw new Error('Envase no encontrado');
    container.status = 'closed';
    container.closedAt = closedAt || nowISO();
    if (notes) container.notes = notes;
    save();
    return container;
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
    getSupplyLocationsView,
    getSupplySuppliersView,
    getInventoryStockView,
    getSupplyPlanContext,
    // RPCs
    recordAdministration,
    undoAdministration,
    adjustInventory,
    recordRestock,
    takeShift,
    endShift,
    purgeOldAudit,
    generateRecurringTasks,
    recordSupplyMovements,
    saveSupplyRelayFull,
    markSupplyInTransit,
    receiveSupplyOrderLine,
    cancelSupplyOrderLine,
    voidSupplyMovement,
    archiveSupplyLocation,
    restoreSupplyLocation,
    setSpecialLocation,
    archiveSupplySupplier,
    restoreSupplySupplier,
    deleteSupplyLocation,
    deleteSupplySupplier,
    openContainer,
    closeContainer,
    PhotoStore,
    resetToDefaults,
    sanitizeAndMigrate: () => sanitizeAndMigrate(db())
  };
})();
