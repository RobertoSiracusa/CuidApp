/* ============================================================
   CuidApp v2 — Capa de Datos y API (js/api.js)
   Sustituye a data.js · Centraliza todo acceso a Supabase
   RNF-20, RNF-29, RNF-31, RNF-43, RNF-47
   ============================================================ */

const Api = (() => {
  'use strict';

  const db = () => {
    const client = Auth.client();
    if (!client) throw new Error('Cliente de base de datos no inicializado');
    return client;
  };

  // ─── Utilidades transversales ─────────────────────────────

  /**
   * §0.1 — Escapado de HTML obligatorio para evitar XSS en el DOM
   */
  const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  /**
   * RNF-20 — Traducción de errores técnicos a lenguaje llano en español
   */
  const traducirError = (err) => {
    if (!err) return null;
    const msg = String(err.message || err.details || err || '');

    // 1. Mensajes específicos con prefijos de Gestión Insumos
    const prefixes = [
      'STOCK_LEDGER', 'UBICACION_ESPECIAL', 'UBICACION_ESTADO', 'UBICACION_ARCHIVADA',
      'UBICACION_CON_STOCK', 'PROVEEDOR_CON_HISTORIAL', 'PROVEEDOR_ESTADO',
      'PROVEEDOR_ARCHIVADO', 'PROVEEDOR_CON_PEDIDOS', 'UBICACION_PERMISO', 'PROVEEDOR_PERMISO'
    ];
    for (const p of prefixes) {
      if (msg.includes(p + ':')) {
        return msg.split(p + ':')[1].trim();
      }
    }

    if (/violates foreign key constraint.*supply_locations/i.test(msg)) {
      return 'Esta ubicación tiene historial: archívala en lugar de borrarla.';
    }
    if (/supply_locations_special_active_ck/i.test(msg)) {
      return 'El punto de uso y el almacén por defecto no se pueden archivar.';
    }
    if (/one_open_order_per_item/i.test(msg)) {
      return 'Este insumo ya está en camino.';
    }
    if (/inventory_movements_ledger_ck/i.test(msg) || /inventory_items_supply_checks/i.test(msg)) {
      return 'Hay un dato fuera de rango; revisa cantidades y configuración.';
    }
    if (/supply_relays_not_future/i.test(msg)) {
      return 'La hora del conteo no puede ser futura.';
    }
    if (/supply_locations_name_key/i.test(msg) || /supply_suppliers_name_key/i.test(msg)) {
      return 'Ya existe uno con ese nombre.';
    }
    if (/No se puede cambiar la unidad/i.test(msg)) {
      return 'No se puede cambiar la unidad de un medicamento que ya tiene movimientos en el inventario.';
    }
    if (/Los movimientos del relevo deben ser anteriores/i.test(msg)) {
      return 'Los movimientos del relevo deben ser anteriores o iguales a la hora del conteo.';
    }

    // 2. Errores de red y sesión
    if (/network/i.test(msg) || /fetch/i.test(msg)) {
      return 'Sin conexión con el servidor. Revisa tu acceso a internet.';
    }
    if (/JWT/i.test(msg) || /session/i.test(msg) || /unauthorized/i.test(msg)) {
      return 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.';
    }
    if (/row-level security/i.test(msg) || /permission denied/i.test(msg) || /No autorizado/i.test(msg)) {
      return 'No tienes permisos para realizar esta acción.';
    }

    // 3. Restricciones específicas de CuidApp existentes
    if (/uniq_admin_slot/i.test(msg)) {
      return 'Esta dosis programada ya ha sido registrada hoy.';
    }
    if (/uniq_task_template_day/i.test(msg)) {
      return 'Esta tarea recurrente ya fue generada para el día de hoy.';
    }
    if (/one_open_shift/i.test(msg)) {
      return 'Ya existe un turno abierto en el sistema.';
    }
    if (/current_stock >= 0/i.test(msg)) {
      return 'El stock no puede ser menor a cero.';
    }
    if (/duplicate key value/i.test(msg)) {
      return 'Ya existe un registro idéntico en el sistema.';
    }

    return msg || 'No se pudo completar la acción. Vuelve a intentarlo.';
  };

  // ─── Caché en memoria para datos de referencia ────────────
  let _cache = {
    settings: null,
    patientStatus: null,
    careRoles: null,
    profiles: null
  };

  const invalidateCache = (key) => {
    if (key) _cache[key] = null;
    else _cache = { settings: null, patientStatus: null, careRoles: null, profiles: null };
  };

  // ─── Formateadores de fecha y moneda (es-ES) ──────────────
  const nowISO = () => new Date().toISOString();
  const localDateStr = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const todayStr = () => localDateStr();

  const formatDate = (isoStr) => {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const formatDateShort = (isoStr) => {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
  };

  const formatDateTime = (isoStr) => {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };

  const timeAgo = (isoStr) => {
    if (!isoStr) return '—';
    const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
    if (diff < 60) return 'Hace un momento';
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
    const days = Math.floor(diff / 86400);
    return days === 1 ? 'Ayer' : `Hace ${days} días`;
  };

  const shiftDuration = (startedAt, endedAt) => {
    if (!startedAt) return '—';
    const end = endedAt ? new Date(endedAt) : new Date();
    const start = new Date(startedAt);
    const diffMin = Math.max(0, Math.floor((end - start) / 60000));
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    if (h === 0) return `${m}m`;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const currency = (amount) =>
    (amount || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ─── Adaptador de Almacenamiento Local (LOCAL_MODE) ────────
  const isLocal = () => Boolean(window.CUIDAPP_CONFIG?.LOCAL_MODE && typeof LocalStore !== 'undefined');

  /**
   * Envuelve retornos para soportar simultáneamente desestructuración directa
   * (e.g. const [a, b] = await Api.getMedications()) y wrappers con .data (e.g. res.data)
   */
  const wrap = (val) => {
    if (val === null || val === undefined) {
      return { ok: true, data: null };
    }
    if (Array.isArray(val)) {
      val.data = val;
      val.ok = true;
      return val;
    }
    if (typeof val === 'object') {
      // Si ya trae el contrato ok (con o sin data, p.ej. {ok:false,error:'x'})
      // se respeta tal cual: no pisar un error convirtiéndolo en éxito.
      if (val.ok !== undefined) return val;
      val.data = val;
      val.ok = true;
      return val;
    }
    return { ok: true, data: val };
  };

  const LocalAdapter = {
    bootstrap: async () => {
      LocalStore.generateRecurringTasks();
      return { ok: true };
    },

    getSettings: async () => {
      const s = LocalStore.getSettings();
      return {
        patientName: s.patientName || 'El Paciente',
        emergencyContactName: s.emergencyContactName || '',
        emergencyContactPhone: s.emergencyContactPhone || '',
        emergencyContactWhatsapp: s.emergencyContactWhatsapp || '',
        updatedAt: s.updatedAt || nowISO()
      };
    },

    saveSettings: async (updates) => {
      const s = LocalStore.saveSettings(updates);
      return { ok: true, data: s };
    },

    getPatientStatus: async () => {
      const ps = LocalStore.getPatientStatus();
      return {
        status: ps.status || 'stable',
        notes: ps.notes || '',
        updatedBy: ps.updatedBy || 'Sistema',
        lastUpdated: ps.lastUpdated || nowISO()
      };
    },

    savePatientStatus: async (status, notes = '') => {
      const ps = LocalStore.savePatientStatus(status, notes);
      return { ok: true, data: ps };
    },

    getCareRoles: async () => {
      const roles = LocalStore.getCollection('careRoles') || [];
      return roles.map(r => ({
        id: r.id,
        name: r.name,
        icon: r.icon || '👤',
        color: r.color || '#8b949e',
        isDefault: !!r.isDefault
      }));
    },

    addCareRole: async ({ name, icon, color }) => {
      const role = {
        id: 'role_' + LocalStore.uuid().slice(0, 8),
        name: name.trim(),
        icon: icon || '👤',
        color: color || '#8b949e',
        isDefault: false
      };
      LocalStore.insert('careRoles', role, 'care_roles');
      return { ok: true, data: role };
    },

    updateCareRole: async (id, { name, icon, color }) => {
      const updated = LocalStore.update('careRoles', id, { name: name.trim(), icon, color }, 'care_roles');
      return { ok: true, data: updated };
    },

    deleteCareRole: async (id) => {
      LocalStore.remove('careRoles', id, 'care_roles');
      return { ok: true };
    },

    getProfiles: async () => {
      const roles = LocalStore.getCollection('careRoles') || [];
      const rMap = new Map(roles.map(r => [r.id, r]));
      const profs = LocalStore.getCollection('profiles') || [];
      return profs.map(p => ({
        id: p.id,
        fullName: p.fullName || p.full_name,
        phone: p.phone || '',
        notes: p.notes || '',
        careRoleId: p.careRoleId || p.care_role_id,
        careRole: rMap.get(p.careRoleId || p.care_role_id) || null,
        appRole: p.appRole || p.app_role || 'caregiver',
        active: p.active !== false,
        createdAt: p.createdAt || p.created_at
      }));
    },

    updateProfile: async (id, updates) => {
      const payload = {};
      if (updates.fullName !== undefined) { payload.fullName = updates.fullName; payload.full_name = updates.fullName; }
      if (updates.phone !== undefined) payload.phone = updates.phone;
      if (updates.notes !== undefined) payload.notes = updates.notes;
      if (updates.careRoleId !== undefined) { payload.careRoleId = updates.careRoleId; payload.care_role_id = updates.careRoleId; }
      if (updates.appRole !== undefined) { payload.appRole = updates.appRole; payload.app_role = updates.appRole; }
      if (updates.active !== undefined) payload.active = updates.active;
      const updated = LocalStore.update('profiles', id, payload, 'profiles');
      return { ok: true, data: updated };
    },

    getCurrentShift: async () => {
      const shifts = LocalStore.getCollection('shifts') || [];
      const open = shifts.find(s => !s.endedAt && !s.ended_at);
      if (!open) return null;
      const profs = LocalStore.getCollection('profiles') || [];
      const roles = LocalStore.getCollection('careRoles') || [];
      const p = profs.find(pr => pr.id === (open.caregiverId || open.profile_id)) || {};
      const r = roles.find(ro => ro.id === (open.careRoleId || open.care_role_id)) || {};
      return {
        id: open.id,
        profileId: p.id || open.caregiverId,
        personName: p.fullName || open.caregiverName || 'Cuidador',
        phone: p.phone || '',
        careRoleId: r.id || open.careRoleId,
        roleName: r.name || 'Cuidador',
        roleIcon: r.icon || '🤝',
        roleColor: r.color || '#f0a500',
        startedAt: open.startedAt || open.started_at,
        endedAt: open.endedAt || open.ended_at
      };
    },

    takeShift: async (careRoleId) => {
      try {
        const shiftId = LocalStore.takeShift(careRoleId);
        return { ok: true, shiftId, data: shiftId };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    endShift: async () => {
      try {
        LocalStore.endShift();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    getShiftHistory: async (limit = 50) => {
      const shifts = [...(LocalStore.getCollection('shifts') || [])].reverse().slice(0, limit);
      const profs = LocalStore.getCollection('profiles') || [];
      const roles = LocalStore.getCollection('careRoles') || [];
      const pMap = new Map(profs.map(p => [p.id, p]));
      const rMap = new Map(roles.map(r => [r.id, r]));
      return shifts.map(s => {
        const p = pMap.get(s.caregiverId || s.profile_id) || {};
        const r = rMap.get(s.careRoleId || s.care_role_id) || {};
        return {
          id: s.id,
          personName: p.fullName || s.caregiverName || 'Cuidador',
          roleName: r.name || 'Cuidador',
          roleIcon: r.icon || '👤',
          startedAt: s.startedAt || s.started_at,
          endedAt: s.endedAt || s.ended_at
        };
      });
    },

    getShiftNotes: async (opts = {}) => {
      const notes = [...(LocalStore.getCollection('shiftNotes') || [])].reverse();
      const profs = LocalStore.getCollection('profiles') || [];
      const pMap = new Map(profs.map(p => [p.id, p]));
      const limit = opts.limit || 50;
      return notes.slice(0, limit).map(n => {
        const p = pMap.get(n.fromProfileId || n.from_profile_id) || {};
        return {
          id: n.id,
          content: n.content,
          fromProfileId: n.fromProfileId || n.from_profile_id,
          authorName: p.fullName || 'Cuidador',
          readAt: n.readAt || n.read_at,
          isRead: !!(n.readAt || n.read_at),
          createdAt: n.createdAt || n.created_at
        };
      });
    },

    addShiftNote: async (content) => {
      const user = Auth.getUser();
      const note = {
        id: LocalStore.uuid(),
        content: content.trim(),
        fromProfileId: user?.id || null,
        readAt: null,
        createdAt: nowISO()
      };
      LocalStore.insert('shiftNotes', note, 'shift_notes');
      return { ok: true, data: note };
    },

    markShiftNoteRead: async (id) => {
      const ids = Array.isArray(id) ? id : [id];
      ids.forEach(noteId => {
        LocalStore.update('shiftNotes', noteId, { readAt: nowISO() });
      });
      return { ok: true };
    },

    markAllShiftNotesRead: async () => {
      (LocalStore.getCollection('shiftNotes') || []).forEach(n => {
        if (!n.readAt) n.readAt = nowISO();
      });
      LocalStore.save();
      return { ok: true };
    },

    getMedications: async () => {
      const meds = LocalStore.getMedicationsView();
      return meds.map(m => ({
        id: m.id,
        name: m.name,
        prescriber: m.prescriber || '',
        indication: m.indication || '',
        startDate: m.startDate || m.start_date,
        status: m.status || 'active',
        notes: m.notes || '',
        needsRestock: !!m.needsRestock,
        unit: m.unit || 'unidad',
        currentStock: Number(m.currentStock || 0),
        minThreshold: Number(m.minThreshold || 0),
        manualDailyAmount: m.manualDailyAmount != null ? Number(m.manualDailyAmount) : null,
        dailyAmount: Number(m.dailyConsumption || 0),
        dailyConsumption: Number(m.dailyConsumption || 0),
        daysRemaining: m.daysRemaining != null ? Number(m.daysRemaining) : null,
        stockControl: m.stockControl || 'dosis',
        schedules: (m.schedules || []).map(s => ({
          id: s.id,
          medicationId: s.medicationId,
          timeOfDay: (s.timeOfDay || s.scheduledTime || '08:00').slice(0, 5),
          scheduledTime: (s.timeOfDay || s.scheduledTime || '08:00').slice(0, 5),
          dose: Number(s.dose || 1),
          active: s.active !== false
        }))
      }));
    },

    getMedicationSchedules: async (medId) => {
      let scheds = LocalStore.getCollection('medicationSchedules') || [];
      if (medId) scheds = scheds.filter(s => s.medicationId === medId);
      return scheds.map(s => ({
        id: s.id,
        medicationId: s.medicationId,
        timeOfDay: (s.timeOfDay || s.scheduledTime || '08:00').slice(0, 5),
        scheduledTime: (s.timeOfDay || s.scheduledTime || '08:00').slice(0, 5),
        dose: Number(s.dose || 1),
        active: s.active !== false
      }));
    },

    addMedication: async (med) => {
      const item = {
        id: LocalStore.uuid(),
        name: med.name.trim(),
        prescriber: (med.prescriber || '').trim(),
        indication: (med.indication || '').trim(),
        startDate: med.startDate || todayStr(),
        status: med.status || 'active',
        notes: (med.notes || '').trim(),
        unit: med.unit || 'unidad',
        currentStock: Math.max(0, Number(med.currentStock || 0)),
        minThreshold: Math.max(0, Number(med.minThreshold || 0)),
        manualDailyAmount: med.manualDailyAmount != null ? Number(med.manualDailyAmount) : null,
        stockControl: med.stockControl || 'dosis',
        needsRestock: false,
        createdAt: nowISO()
      };
      LocalStore.insert('medications', item, 'medications');
      return { ok: true, data: item };
    },

    updateMedication: async (id, updates) => {
      const payload = {};
      if (updates.name !== undefined) payload.name = updates.name.trim();
      if (updates.prescriber !== undefined) payload.prescriber = updates.prescriber.trim();
      if (updates.indication !== undefined) payload.indication = updates.indication.trim();
      if (updates.startDate !== undefined) payload.startDate = updates.startDate;
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.notes !== undefined) payload.notes = updates.notes.trim();
      if (updates.unit !== undefined) payload.unit = updates.unit;
      if (updates.minThreshold !== undefined) payload.minThreshold = Math.max(0, Number(updates.minThreshold));
      if (updates.manualDailyAmount !== undefined) payload.manualDailyAmount = updates.manualDailyAmount != null ? Number(updates.manualDailyAmount) : null;
      if (updates.stockControl !== undefined) payload.stockControl = updates.stockControl;
      if (updates.needsRestock !== undefined) payload.needsRestock = !!updates.needsRestock;
      const updated = LocalStore.update('medications', id, payload, 'medications');
      return { ok: true, data: updated };
    },

    deleteMedication: async (id) => {
      LocalStore.remove('medications', id, 'medications');
      const allScheds = LocalStore.getCollection('medicationSchedules');
      const remaining = allScheds.filter(s => s.medicationId !== id);
      allScheds.length = 0;
      allScheds.push(...remaining);
      LocalStore.save();
      return { ok: true };
    },

    addMedicationSchedule: async ({ medicationId, timeOfDay, scheduledTime, dose }) => {
      const time = (scheduledTime || timeOfDay || '08:00').slice(0, 5);
      const sched = {
        id: LocalStore.uuid(),
        medicationId,
        timeOfDay: time,
        scheduledTime: time,
        dose: Number(dose || 1),
        active: true,
        createdAt: nowISO()
      };
      LocalStore.insert('medicationSchedules', sched, 'medication_schedules');
      return { ok: true, data: sched };
    },

    updateMedicationSchedule: async (id, updates) => {
      const payload = {};
      if (updates.timeOfDay !== undefined || updates.scheduledTime !== undefined) {
        const time = (updates.scheduledTime || updates.timeOfDay).slice(0, 5);
        payload.timeOfDay = time;
        payload.scheduledTime = time;
      }
      if (updates.dose !== undefined) payload.dose = Number(updates.dose);
      if (updates.active !== undefined) payload.active = !!updates.active;
      const updated = LocalStore.update('medicationSchedules', id, payload, 'medication_schedules');
      return { ok: true, data: updated };
    },

    deleteMedicationSchedule: async (id) => {
      LocalStore.remove('medicationSchedules', id, 'medication_schedules');
      return { ok: true };
    },

    recordRestock: async ({ medicationId, quantity, establishment = '', cost = 0 }) => {
      try {
        const restockId = LocalStore.recordRestock({ medicationId, quantity, establishment, cost });
        return { ok: true, restockId, data: restockId };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    getRestockHistory: async (medicationId) => {
      let restocks = [...(LocalStore.getCollection('medicationRestocks') || [])].reverse();
      if (medicationId) restocks = restocks.filter(r => r.medicationId === medicationId);
      const meds = LocalStore.getCollection('medications') || [];
      const profs = LocalStore.getCollection('profiles') || [];
      const medMap = new Map(meds.map(m => [m.id, m]));
      const pMap = new Map(profs.map(p => [p.id, p]));
      return restocks.map(r => ({
        id: r.id,
        medicationId: r.medicationId,
        medicationName: medMap.get(r.medicationId)?.name || 'Medicamento',
        quantity: Number(r.quantity),
        establishment: r.establishment || '',
        cost: Number(r.cost || 0),
        managedByName: pMap.get(r.managedBy)?.fullName || 'Sistema',
        createdAt: r.createdAt
      }));
    },

    getTodayAdministrations: async () => {
      const today = todayStr();
      const admins = (LocalStore.getCollection('medicationAdministrations') || []).filter(a => a.scheduledDate === today);
      return admins.map(a => ({
        id: a.id,
        medicationId: a.medicationId,
        scheduleId: a.scheduleId,
        scheduledDate: a.scheduledDate,
        scheduledTime: a.scheduledTime ? a.scheduledTime.slice(0, 5) : null,
        administeredAt: a.administeredAt,
        administeredByName: a.administeredByName || 'Cuidador',
        status: a.status,
        dose: Number(a.dose || 1),
        notes: a.notes || ''
      }));
    },

    getAdministrations: async (filter = {}) => {
      let admins = [...(LocalStore.getCollection('medicationAdministrations') || [])];
      if (filter.date) admins = admins.filter(a => a.scheduledDate === filter.date);
      if (filter.medicationId) admins = admins.filter(a => a.medicationId === filter.medicationId);
      return admins.map(a => ({
        id: a.id,
        medicationId: a.medicationId,
        scheduleId: a.scheduleId,
        scheduledDate: a.scheduledDate,
        scheduledTime: a.scheduledTime ? a.scheduledTime.slice(0, 5) : null,
        administeredAt: a.administeredAt,
        administeredByName: a.administeredByName || 'Cuidador',
        status: a.status,
        dose: Number(a.dose || 1),
        notes: a.notes || ''
      }));
    },

    recordAdministration: async ({ medicationId, scheduleId, scheduledDate, scheduledTime, status, dose, notes }) => {
      try {
        const adminId = LocalStore.recordAdministration({
          medicationId,
          scheduleId,
          scheduledDate,
          scheduledTime,
          status,
          dose,
          notes
        });
        return { ok: true, adminId, data: adminId };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    undoAdministration: async (id) => {
      try {
        LocalStore.undoAdministration(id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    getAdministrationHistory: async ({ medicationId, fromDate, toDate, limit = 100 } = {}) => {
      let admins = [...(LocalStore.getCollection('medicationAdministrations') || [])].reverse();
      if (medicationId) admins = admins.filter(a => a.medicationId === medicationId);
      if (fromDate) admins = admins.filter(a => a.scheduledDate >= fromDate);
      if (toDate) admins = admins.filter(a => a.scheduledDate <= toDate);
      const meds = LocalStore.getCollection('medications') || [];
      const medMap = new Map(meds.map(m => [m.id, m]));
      return admins.slice(0, limit).map(a => {
        const m = medMap.get(a.medicationId) || {};
        return {
          id: a.id,
          medicationId: a.medicationId,
          medicationName: m.name || 'Medicamento',
          unit: m.unit || 'unidad',
          scheduledDate: a.scheduledDate,
          scheduledTime: a.scheduledTime ? a.scheduledTime.slice(0, 5) : null,
          administeredAt: a.administeredAt,
          administeredByName: a.administeredByName || 'Cuidador',
          status: a.status,
          dose: Number(a.dose || 1),
          notes: a.notes || ''
        };
      });
    },

    getInventory: async () => {
      const items = LocalStore.getInventoryItemsView();
      const roles = LocalStore.getCollection('careRoles') || [];
      const rMap = new Map(roles.map(r => [r.id, r]));
      return items.map(i => ({
        id: i.id,
        name: i.name,
        categoryId: i.categoryId,
        categoryName: i.categoryName || 'Otros',
        currentStock: Number(i.currentStock || 0),
        unit: i.unit || 'unidad',
        minThreshold: Number(i.minThreshold || 0),
        optimalStock: Number(i.optimalStock || 0),
        orderUnit: i.orderUnit || 'unidad',
        unitsPerPurchase: Number(i.unitsPerPurchase || 1),
        isCritical: !!i.isCritical,
        reviewEveryHours: i.reviewEveryHours != null ? Number(i.reviewEveryHours) : (i.isCritical ? 26 : 50),
        isPao: !!i.isPao,
        paoHours: i.paoHours != null ? Number(i.paoHours) : null,
        oxygenFlowLpm: i.oxygenFlowLpm != null ? Number(i.oxygenFlowLpm) : null,
        cylinderCapacityLiters: i.cylinderCapacityLiters != null ? Number(i.cylinderCapacityLiters) : null,
        stockControl: i.stockControl || 'dosis',
        consumptionType: i.consumptionType || 'variable',
        medicationId: i.medicationId || null,
        primaryLocationId: i.primaryLocationId || 'loc_hab',
        reserveLocationId: i.reserveLocationId || 'loc_arm',
        supplierId: i.supplierId || null,
        responsibleCareRoleId: i.responsibleCareRoleId,
        responsibleRole: rMap.get(i.responsibleCareRoleId) || null,
        notes: i.notes || '',
        avgDailyConsumption: i.avgDailyConsumption != null ? Number(i.avgDailyConsumption) : null,
        daysRemaining: i.daysRemaining != null ? Number(i.daysRemaining) : null,
        isLow: !!i.isLow,
        active: i.active !== false
      }));
    },

    getInventoryItems: async () => LocalAdapter.getInventory(),

    addInventoryItem: async (item) => {
      const newItem = {
        id: LocalStore.uuid(),
        name: item.name.trim(),
        categoryId: item.categoryId || null,
        currentStock: 0,
        unit: item.unit || 'unidad',
        orderUnit: item.orderUnit || item.unit || 'unidad',
        unitsPerPurchase: Number(item.unitsPerPurchase || 1),
        minThreshold: Math.max(0, Number(item.minThreshold || 0)),
        optimalStock: Math.max(0, Number(item.optimalStock || 0)),
        isCritical: !!item.isCritical,
        reviewEveryHours: item.reviewEveryHours != null ? Number(item.reviewEveryHours) : (item.isCritical ? 26 : 50),
        isPao: !!item.isPao,
        paoHours: item.paoHours != null ? Number(item.paoHours) : null,
        oxygenFlowLpm: item.oxygenFlowLpm != null ? Number(item.oxygenFlowLpm) : null,
        cylinderCapacityLiters: item.cylinderCapacityLiters != null ? Number(item.cylinderCapacityLiters) : null,
        stockControl: item.stockControl || 'dosis',
        consumptionType: item.consumptionType || 'variable',
        primaryLocationId: item.primaryLocationId || 'loc_hab',
        reserveLocationId: item.reserveLocationId || 'loc_arm',
        supplierId: item.supplierId || null,
        responsibleCareRoleId: item.responsibleCareRoleId || null,
        notes: (item.notes || '').trim(),
        active: item.active !== false,
        createdAt: nowISO()
      };
      LocalStore.insert('inventoryItems', newItem, 'inventory_items');
      if (item.currentStock && Number(item.currentStock) > 0) {
        LocalStore.recordSupplyMovements([{
          itemId: newItem.id,
          locationId: newItem.primaryLocationId,
          stockState: 'full',
          movementType: 'count',
          quantity: Number(item.currentStock),
          note: 'Stock inicial al crear insumo'
        }]);
      }
      return { ok: true, data: newItem };
    },

    updateInventoryItem: async (id, updates) => {
      const payload = {};
      if (updates.name !== undefined) payload.name = updates.name.trim();
      if (updates.categoryId !== undefined) payload.categoryId = updates.categoryId;
      // currentStock es de solo lectura y nunca se actualiza aquí (ledger manda)
      if (updates.unit !== undefined) payload.unit = updates.unit;
      if (updates.orderUnit !== undefined) payload.orderUnit = updates.orderUnit;
      if (updates.unitsPerPurchase !== undefined) payload.unitsPerPurchase = Number(updates.unitsPerPurchase) || 1;
      if (updates.minThreshold !== undefined) payload.minThreshold = Math.max(0, Number(updates.minThreshold));
      if (updates.optimalStock !== undefined) payload.optimalStock = Math.max(0, Number(updates.optimalStock));
      if (updates.isCritical !== undefined) payload.isCritical = !!updates.isCritical;
      if (updates.reviewEveryHours !== undefined) payload.reviewEveryHours = updates.reviewEveryHours != null ? Number(updates.reviewEveryHours) : null;
      if (updates.isPao !== undefined) payload.isPao = !!updates.isPao;
      if (updates.paoHours !== undefined) payload.paoHours = updates.paoHours != null ? Number(updates.paoHours) : null;
      if (updates.oxygenFlowLpm !== undefined) payload.oxygenFlowLpm = updates.oxygenFlowLpm != null ? Number(updates.oxygenFlowLpm) : null;
      if (updates.cylinderCapacityLiters !== undefined) payload.cylinderCapacityLiters = updates.cylinderCapacityLiters != null ? Number(updates.cylinderCapacityLiters) : null;
      if (updates.stockControl !== undefined) payload.stockControl = updates.stockControl;
      if (updates.consumptionType !== undefined) payload.consumptionType = updates.consumptionType;
      if (updates.primaryLocationId !== undefined) payload.primaryLocationId = updates.primaryLocationId;
      if (updates.reserveLocationId !== undefined) payload.reserveLocationId = updates.reserveLocationId;
      if (updates.supplierId !== undefined) payload.supplierId = updates.supplierId;
      if (updates.responsibleCareRoleId !== undefined) payload.responsibleCareRoleId = updates.responsibleCareRoleId;
      if (updates.notes !== undefined) payload.notes = updates.notes.trim();
      if (updates.active !== undefined) payload.active = !!updates.active;
      const updated = LocalStore.update('inventoryItems', id, payload, 'inventory_items');
      return { ok: true, data: updated };
    },

    deleteInventoryItem: async (id) => {
      LocalStore.remove('inventoryItems', id, 'inventory_items');
      return { ok: true };
    },

    adjustInventoryStock: async (itemId, delta, note = '') => {
      try {
        const mov = LocalStore.adjustInventory(itemId, delta, note);
        return { ok: true, currentStock: mov.newStock, data: mov.newStock };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    getInventoryMovements: async (itemId, limit = 50) => {
      let movs = [...(LocalStore.getCollection('inventoryMovements') || [])].reverse();
      if (itemId) movs = movs.filter(m => m.itemId === itemId);
      const profs = LocalStore.getCollection('profiles') || [];
      const pMap = new Map(profs.map(p => [p.id, p]));
      return movs.slice(0, limit).map(m => ({
        id: m.id,
        itemId: m.itemId,
        delta: Number(m.delta),
        occurredOn: (m.createdAt || nowISO()).split('T')[0],
        note: m.reason || m.note || '',
        authorName: pMap.get(m.actorId)?.fullName || 'Sistema',
        createdAt: m.createdAt
      }));
    },

    getInventoryCategories: async () => {
      return (LocalStore.getCollection('inventoryCategories') || []).map(c => ({ id: c.id, name: c.name }));
    },

    addInventoryCategory: async (name) => {
      const cat = { id: 'cat_' + LocalStore.uuid().slice(0, 8), name: name.trim() };
      LocalStore.insert('inventoryCategories', cat);
      return { ok: true, data: cat };
    },

    // ─── Gestión Insumos (LocalAdapter) ──────────────────────
    getSupplyLocations: async (includeArchived = false) => {
      return LocalStore.getSupplyLocationsView(includeArchived);
    },

    addSupplyLocation: async (loc) => {
      try {
        const res = LocalStore.insertSupplyLocation(loc);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    updateSupplyLocation: async (id, updates) => {
      try {
        const res = LocalStore.updateSupplyLocation(id, updates);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    archiveSupplyLocation: async (id) => {
      try {
        LocalStore.archiveSupplyLocation(id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    restoreSupplyLocation: async (id) => {
      try {
        LocalStore.restoreSupplyLocation(id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    setSpecialLocation: async (id, role) => {
      try {
        LocalStore.setSpecialLocation(id, role);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    deleteSupplyLocation: async (id) => {
      try {
        LocalStore.deleteSupplyLocation(id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    getSupplySuppliers: async (includeArchived = false) => {
      return LocalStore.getSupplySuppliersView(includeArchived);
    },

    addSupplySupplier: async (sup) => {
      try {
        const res = LocalStore.insertSupplySupplier(sup);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    updateSupplySupplier: async (id, updates) => {
      try {
        const res = LocalStore.updateSupplySupplier(id, updates);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    archiveSupplySupplier: async (id) => {
      try {
        LocalStore.archiveSupplySupplier(id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    restoreSupplySupplier: async (id) => {
      try {
        LocalStore.restoreSupplySupplier(id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    deleteSupplySupplier: async (id) => {
      try {
        LocalStore.deleteSupplySupplier(id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    recordSupplyMovements: async (movements) => {
      try {
        const res = LocalStore.recordSupplyMovements(movements);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    saveSupplyRelayFull: async (payload) => {
      try {
        const res = LocalStore.saveSupplyRelayFull(payload);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    markSupplyInTransit: async (supplierId, lines, clientEventId, expectedBy = null) => {
      try {
        const res = LocalStore.markSupplyInTransit(supplierId, lines, clientEventId, expectedBy);
        return res;
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    receiveSupplyOrderLine: async (params) => {
      try {
        const res = LocalStore.receiveSupplyOrderLine(params);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    cancelSupplyOrderLine: async (lineId, reason) => {
      try {
        const res = LocalStore.cancelSupplyOrderLine(lineId, reason);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    voidSupplyMovement: async (movementId, reason) => {
      try {
        const res = LocalStore.voidSupplyMovement(movementId, reason);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    openContainer: async (itemId, locationId, openedAt) => {
      try {
        const res = LocalStore.openContainer(itemId, locationId, openedAt);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    closeContainer: async (containerId, closedAt, notes) => {
      try {
        const res = LocalStore.closeContainer(containerId, closedAt, notes);
        return { ok: true, data: res };
      } catch (err) {
        return { ok: false, error: traducirError(err) };
      }
    },

    getInventoryStockView: async (filters = {}) => {
      return LocalStore.getInventoryStockView(filters);
    },

    getSupplyPlanContext: async (filters = {}) => {
      return LocalStore.getSupplyPlanContext(filters);
    },

    getSupplyRelays: async (limit = 30) => {
      const relays = [...(LocalStore.getCollection('supplyRelays') || [])].reverse();
      const profs = LocalStore.getCollection('profiles') || [];
      const pMap = new Map(profs.map(p => [p.id, p]));
      return relays.slice(0, limit).map(r => ({
        id: r.id,
        occurredAt: r.occurredAt,
        deliveredByProfileId: r.deliveredByProfileId,
        deliveredByName: pMap.get(r.deliveredByProfileId)?.fullName || 'Entregador',
        receivedByProfileId: r.receivedByProfileId,
        receivedByName: pMap.get(r.receivedByProfileId)?.fullName || 'Receptor',
        photoPath: r.photoPath || null,
        clientEventId: r.clientEventId || null,
        countsCount: r.countsCount || 0,
        omittedCount: r.omittedCount || 0,
        notes: r.notes || '',
        createdAt: r.createdAt
      }));
    },

    getSupplyOrderBatches: async (status = null) => {
      let batches = [...(LocalStore.getCollection('supplyOrderBatches') || [])].reverse();
      if (status) batches = batches.filter(b => b.status === status);
      const sups = LocalStore.getCollection('supplySuppliers') || [];
      const profs = LocalStore.getCollection('profiles') || [];
      const sMap = new Map(sups.map(s => [s.id, s]));
      const pMap = new Map(profs.map(p => [p.id, p]));
      return batches.map(b => ({
        id: b.id,
        supplierId: b.supplierId,
        supplierName: sMap.get(b.supplierId)?.name || 'Proveedor',
        status: b.status,
        linesCount: b.linesCount || 0,
        clientEventId: b.clientEventId,
        orderedByName: pMap.get(b.orderedByProfileId)?.fullName || 'Cuidador',
        createdAt: b.createdAt
      }));
    },

    getSupplyOrderLines: async (status = null) => {
      let lines = [...(LocalStore.getCollection('supplyOrderLines') || [])];
      if (status) lines = lines.filter(l => l.status === status);
      const items = LocalStore.getCollection('inventoryItems') || [];
      const sups = LocalStore.getCollection('supplySuppliers') || [];
      const locs = LocalStore.getCollection('supplyLocations') || [];
      const profs = LocalStore.getCollection('profiles') || [];
      const iMap = new Map(items.map(i => [i.id, i]));
      const sMap = new Map(sups.map(s => [s.id, s]));
      const lMap = new Map(locs.map(l => [l.id, l]));
      const pMap = new Map(profs.map(p => [p.id, p]));
      return lines.map(l => {
        const item = iMap.get(l.itemId) || {};
        return {
          id: l.id,
          batchId: l.batchId,
          supplierId: l.supplierId,
          supplierName: sMap.get(l.supplierId)?.name || 'Proveedor',
          itemId: l.itemId,
          itemName: item.name || 'Insumo',
          unit: item.unit || 'unidad',
          targetLocationId: l.targetLocationId,
          targetLocationName: lMap.get(l.targetLocationId)?.name || 'Almacén',
          orderedQtyPurchase: Number(l.orderedQtyPurchase || 1),
          unitsPerPurchase: Number(l.unitsPerPurchase || 1),
          orderedQtyBase: Number(l.orderedQtyBase || 0),
          receivedQtyBase: Number(l.receivedQtyBase || 0),
          status: l.status,
          expectedBy: l.expectedBy,
          orderedAt: l.orderedAt,
          receivedAt: l.receivedAt,
          orderedByName: pMap.get(l.orderedByProfileId)?.fullName || 'Cuidador',
          createdAt: l.createdAt
        };
      });
    },

    getSupplyOpenContainers: async (itemId = null) => {
      let containers = [...(LocalStore.getCollection('supplyOpenContainers') || [])];
      if (itemId) containers = containers.filter(c => c.itemId === itemId);
      return containers.filter(c => !c.closedAt);
    },

    uploadRelayPhoto: async (clientEventId, blob) => {
      return LocalStore.PhotoStore.savePhoto(clientEventId, blob);
    },

    getRelayPhotoUrl: async (clientEventId) => {
      const blob = await LocalStore.PhotoStore.getPhoto(clientEventId);
      if (!blob) return null;
      return URL.createObjectURL(blob);
    },

    getTasksByDate: async (dateStr) => {
      const targetDate = dateStr || todayStr();
      const allTasks = LocalStore.getCollection('tasks') || [];
      const tasks = allTasks.filter(t => t.taskDate === targetDate);
      const roles = LocalStore.getCollection('careRoles') || [];
      const profs = LocalStore.getCollection('profiles') || [];
      const comments = LocalStore.getCollection('taskComments') || [];
      const rMap = new Map(roles.map(r => [r.id, r]));
      const pMap = new Map(profs.map(p => [p.id, p]));

      return tasks.map(t => {
        const r = rMap.get(t.assignedCareRoleId || t.careRoleId) || null;
        const p = pMap.get(t.assignedProfileId || t.assignedProfile?.id) || null;
        const taskComments = comments.filter(c => c.taskId === t.id);
        return {
          id: t.id,
          templateId: t.templateId || null,
          title: t.title,
          description: t.description || '',
          shift: t.shift || t.shiftType || 'morning',
          shiftType: t.shift || t.shiftType || 'morning',
          assignedCareRoleId: t.assignedCareRoleId || null,
          assignedCareRole: r,
          assignedRole: r,
          assignedProfileId: t.assignedProfileId || null,
          assignedProfile: p,
          assignedPersonName: p?.fullName || '',
          status: t.status || 'pending',
          isEmergency: !!t.isEmergency,
          taskDate: t.taskDate,
          comments: taskComments.map(c => ({
            id: c.id,
            text: c.text,
            authorName: pMap.get(c.authorId)?.fullName || 'Usuario',
            createdAt: c.createdAt
          }))
        };
      });
    },

    addTask: async (task) => {
      const newTask = {
        id: LocalStore.uuid(),
        templateId: task.templateId || null,
        title: task.title.trim(),
        description: (task.description || '').trim(),
        shift: task.shift || task.shiftType || 'morning',
        shiftType: task.shift || task.shiftType || 'morning',
        assignedCareRoleId: task.assignedCareRoleId || null,
        assignedProfileId: task.assignedProfileId || null,
        status: task.status || 'pending',
        isEmergency: !!task.isEmergency,
        taskDate: task.taskDate || todayStr(),
        createdAt: nowISO()
      };
      LocalStore.insert('tasks', newTask, 'tasks');
      return { ok: true, data: newTask };
    },

    updateTask: async (id, updates) => {
      const payload = {};
      if (updates.title !== undefined) payload.title = updates.title.trim();
      if (updates.description !== undefined) payload.description = updates.description.trim();
      if (updates.shift !== undefined || updates.shiftType !== undefined) {
        const s = updates.shift || updates.shiftType;
        payload.shift = s;
        payload.shiftType = s;
      }
      if (updates.assignedCareRoleId !== undefined) payload.assignedCareRoleId = updates.assignedCareRoleId;
      if (updates.assignedProfileId !== undefined) payload.assignedProfileId = updates.assignedProfileId;
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.isEmergency !== undefined) payload.isEmergency = !!updates.isEmergency;
      if (updates.taskDate !== undefined) payload.taskDate = updates.taskDate;
      const updated = LocalStore.update('tasks', id, payload, 'tasks');
      return { ok: true, data: updated };
    },

    deleteTask: async (id) => {
      LocalStore.remove('tasks', id, 'tasks');
      return { ok: true };
    },

    cycleTaskStatus: async (id, currentStatus) => {
      const flow = { 'pending': 'in-progress', 'in-progress': 'completed', 'completed': 'pending' };
      const nextStatus = flow[currentStatus] || 'pending';
      return LocalAdapter.updateTask(id, { status: nextStatus });
    },

    addTaskComment: async (taskId, text) => {
      const user = Auth.getUser();
      const c = {
        id: LocalStore.uuid(),
        taskId,
        authorId: user?.id || null,
        text: text.trim(),
        createdAt: nowISO()
      };
      LocalStore.insert('taskComments', c, 'task_comments');
      return { ok: true, data: c };
    },

    getTaskComments: async (taskId) => {
      const comments = (LocalStore.getCollection('taskComments') || []).filter(c => c.taskId === taskId);
      const profs = LocalStore.getCollection('profiles') || [];
      const pMap = new Map(profs.map(p => [p.id, p]));
      return comments.map(c => ({
        id: c.id,
        taskId: c.taskId,
        text: c.text,
        authorName: pMap.get(c.authorId)?.fullName || 'Usuario',
        createdAt: c.createdAt
      }));
    },

    getTaskTemplates: async () => {
      const tmpls = LocalStore.getCollection('taskTemplates') || [];
      const roles = LocalStore.getCollection('careRoles') || [];
      const profs = LocalStore.getCollection('profiles') || [];
      const rMap = new Map(roles.map(r => [r.id, r]));
      const pMap = new Map(profs.map(p => [p.id, p]));
      return tmpls.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description || '',
        shift: t.shift || t.shiftType || 'morning',
        shiftType: t.shift || t.shiftType || 'morning',
        assignedCareRoleId: t.assignedCareRoleId || null,
        assignedCareRole: rMap.get(t.assignedCareRoleId) || null,
        assignedProfileId: t.assignedProfileId || null,
        assignedProfile: pMap.get(t.assignedProfileId) || null,
        isEmergency: !!t.isEmergency,
        recurringDays: t.recurringDays || [1, 2, 3, 4, 5, 6, 7],
        active: t.active !== false
      }));
    },

    addTaskTemplate: async (tmpl) => {
      const newTmpl = {
        id: LocalStore.uuid(),
        title: tmpl.title.trim(),
        description: (tmpl.description || '').trim(),
        shift: tmpl.shift || tmpl.shiftType || 'morning',
        shiftType: tmpl.shift || tmpl.shiftType || 'morning',
        assignedCareRoleId: tmpl.assignedCareRoleId || null,
        assignedProfileId: tmpl.assignedProfileId || null,
        isEmergency: !!tmpl.isEmergency,
        recurringDays: tmpl.recurringDays || [1, 2, 3, 4, 5, 6, 7],
        active: tmpl.active !== false,
        createdAt: nowISO()
      };
      LocalStore.insert('taskTemplates', newTmpl, 'task_templates');
      return { ok: true, data: newTmpl };
    },

    updateTaskTemplate: async (id, updates) => {
      const payload = {};
      if (updates.title !== undefined) payload.title = updates.title.trim();
      if (updates.description !== undefined) payload.description = updates.description.trim();
      if (updates.shift !== undefined || updates.shiftType !== undefined) {
        const s = updates.shift || updates.shiftType;
        payload.shift = s;
        payload.shiftType = s;
      }
      if (updates.assignedCareRoleId !== undefined) payload.assignedCareRoleId = updates.assignedCareRoleId;
      if (updates.assignedProfileId !== undefined) payload.assignedProfileId = updates.assignedProfileId;
      if (updates.isEmergency !== undefined) payload.isEmergency = !!updates.isEmergency;
      if (updates.recurringDays !== undefined) payload.recurringDays = updates.recurringDays;
      if (updates.active !== undefined) payload.active = !!updates.active;
      const updated = LocalStore.update('taskTemplates', id, payload, 'task_templates');
      return { ok: true, data: updated };
    },

    deleteTaskTemplate: async (id) => {
      LocalStore.remove('taskTemplates', id, 'task_templates');
      return { ok: true };
    },

    getAppointments: async () => {
      const appts = [...(LocalStore.getCollection('appointments') || [])];
      appts.sort((a, b) => (a.apptDate + ' ' + (a.apptTime || '')).localeCompare(b.apptDate + ' ' + (b.apptTime || '')));
      return appts.map(a => ({
        id: a.id,
        title: a.title,
        specialty: a.specialty || '',
        doctor: a.doctor || '',
        apptDate: a.apptDate,
        apptTime: a.apptTime ? a.apptTime.slice(0, 5) : '',
        modality: a.modality || 'presencial',
        location: a.location || '',
        preparation: a.preparation || '',
        status: a.status || 'upcoming',
        notes: a.notes || '',
        resultNotes: a.resultNotes || ''
      }));
    },

    getUpcomingAppointments: async (days = null) => {
      const today = todayStr();
      const all = await LocalAdapter.getAppointments();
      let upcoming = all.filter(a => a.status === 'upcoming' && a.apptDate >= today);
      if (typeof days === 'number') {
        const limitDate = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
        upcoming = upcoming.filter(a => a.apptDate <= limitDate);
      }
      return upcoming;
    },

    getPastAppointments: async () => {
      const today = todayStr();
      const all = await LocalAdapter.getAppointments();
      return all.filter(a => a.status === 'completed' || a.apptDate < today);
    },

    addAppointment: async (appt) => {
      const newAppt = {
        id: LocalStore.uuid(),
        title: appt.title.trim(),
        specialty: (appt.specialty || '').trim(),
        doctor: (appt.doctor || '').trim(),
        apptDate: appt.apptDate,
        apptTime: appt.apptTime || null,
        modality: appt.modality || 'presencial',
        location: (appt.location || '').trim(),
        preparation: (appt.preparation || '').trim(),
        status: appt.status || 'upcoming',
        notes: (appt.notes || '').trim(),
        resultNotes: '',
        createdAt: nowISO()
      };
      LocalStore.insert('appointments', newAppt, 'appointments');
      return { ok: true, data: newAppt };
    },

    updateAppointment: async (id, updates) => {
      const payload = {};
      if (updates.title !== undefined) payload.title = updates.title.trim();
      if (updates.specialty !== undefined) payload.specialty = updates.specialty.trim();
      if (updates.doctor !== undefined) payload.doctor = updates.doctor.trim();
      if (updates.apptDate !== undefined) payload.apptDate = updates.apptDate;
      if (updates.apptTime !== undefined) payload.apptTime = updates.apptTime || null;
      if (updates.modality !== undefined) payload.modality = updates.modality;
      if (updates.location !== undefined) payload.location = updates.location.trim();
      if (updates.preparation !== undefined) payload.preparation = updates.preparation.trim();
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.notes !== undefined) payload.notes = updates.notes.trim();
      if (updates.resultNotes !== undefined) payload.resultNotes = updates.resultNotes.trim();
      const updated = LocalStore.update('appointments', id, payload, 'appointments');
      return { ok: true, data: updated };
    },

    deleteAppointment: async (id) => {
      LocalStore.remove('appointments', id, 'appointments');
      return { ok: true };
    },

    getRecipes: async () => {
      const recipes = LocalStore.getCollection('recipes') || [];
      const ings = LocalStore.getCollection('recipeIngredients') || [];
      return recipes.map(r => ({
        id: r.id,
        name: r.name,
        mealTypes: r.mealTypes || ['lunch'],
        instructions: r.instructions || '',
        notes: r.notes || '',
        ingredients: ings.filter(i => i.recipeId === r.id).map(i => ({
          id: i.id,
          name: i.name,
          amount: i.amount || '',
          unit: i.unit || ''
        }))
      }));
    },

    addRecipe: async ({ name, mealTypes, instructions = '', notes = '', ingredients = [] }) => {
      const r = {
        id: LocalStore.uuid(),
        name: name.trim(),
        mealTypes: mealTypes || ['lunch'],
        instructions: instructions.trim(),
        notes: notes.trim(),
        createdAt: nowISO()
      };
      LocalStore.insert('recipes', r, 'recipes');
      if (ingredients && ingredients.length > 0) {
        ingredients.forEach(i => {
          LocalStore.insert('recipeIngredients', {
            id: LocalStore.uuid(),
            recipeId: r.id,
            name: i.name.trim(),
            amount: String(i.amount || ''),
            unit: String(i.unit || '')
          });
        });
      }
      return { ok: true, data: r };
    },

    updateRecipe: async (id, { name, mealTypes, instructions, notes, ingredients }) => {
      const payload = {};
      if (name !== undefined) payload.name = name.trim();
      if (mealTypes !== undefined) payload.mealTypes = mealTypes;
      if (instructions !== undefined) payload.instructions = instructions.trim();
      if (notes !== undefined) payload.notes = notes.trim();
      LocalStore.update('recipes', id, payload, 'recipes');

      if (ingredients !== undefined) {
        const allIngs = LocalStore.getCollection('recipeIngredients');
        const filtered = allIngs.filter(i => i.recipeId !== id);
        allIngs.length = 0;
        allIngs.push(...filtered);
        ingredients.forEach(i => {
          allIngs.push({
            id: LocalStore.uuid(),
            recipeId: id,
            name: i.name.trim(),
            amount: String(i.amount || ''),
            unit: String(i.unit || '')
          });
        });
        LocalStore.save();
      }
      return { ok: true };
    },

    deleteRecipe: async (id) => {
      LocalStore.remove('recipes', id, 'recipes');
      const allIngs = LocalStore.getCollection('recipeIngredients') || [];
      const filtered = allIngs.filter(i => i && i.recipeId !== id);
      allIngs.length = 0;
      allIngs.push(...filtered);

      // Limpiar asignaciones de la receta en weeklyPlan
      const plan = LocalStore.getCollection('weeklyPlan') || [];
      const cleanedPlan = plan.filter(s => s && s.recipeId !== id);
      plan.length = 0;
      plan.push(...cleanedPlan);

      LocalStore.save();
      return { ok: true };
    },

    getWeeklyPlan: async (weekKey, dateList = null) => {
      const rows = LocalStore.getCollection('weeklyPlan') || [];
      const filteredRows = rows.filter(r => {
        if (!r) return false;
        if (dateList && Array.isArray(dateList) && dateList.length > 0 && r.date) {
          return dateList.includes(r.date);
        }
        if (weekKey) {
          return r.weekKey === weekKey || (!r.weekKey && weekKey === 'current');
        }
        return true;
      });

      const slotMap = new Map();
      filteredRows.forEach(row => {
        if (!row) return;
        const d = Number(row.dayIndex !== undefined ? row.dayIndex : row.day_index);
        const m = row.mealType || row.meal_type;
        const rid = row.recipeId || row.recipe_id;
        const dateStr = row.date || null;
        if (isNaN(d) || !m) return;
        const key = dateStr ? `${dateStr}_${m}` : `${d}_${m}`;
        if (!slotMap.has(key)) {
          slotMap.set(key, {
            date: dateStr,
            dayOfWeek: d,
            dayIndex: d,
            mealType: m,
            recipeIds: []
          });
        }
        if (rid && !slotMap.get(key).recipeIds.includes(rid)) {
          slotMap.get(key).recipeIds.push(rid);
        }
      });

      return Array.from(slotMap.values());
    },

    getDailyMenu: async (targetDateStr) => {
      const rows = LocalStore.getCollection('weeklyPlan') || [];
      const dateStr = targetDateStr || todayStr();
      const matched = rows.filter(r => r && (r.date === dateStr));
      const res = {
        date: dateStr,
        desayuno: [],
        almuerzo: [],
        cena: [],
        totalRecipes: 0
      };
      matched.forEach(r => {
        const m = (r.mealType || r.meal_type || '').toLowerCase();
        const rid = r.recipeId || r.recipe_id;
        if (!rid) return;
        if (m === 'desayuno' || m === 'breakfast') {
          if (!res.desayuno.includes(rid)) res.desayuno.push(rid);
        } else if (m === 'almuerzo' || m === 'lunch') {
          if (!res.almuerzo.includes(rid)) res.almuerzo.push(rid);
        } else if (m === 'cena' || m === 'dinner') {
          if (!res.cena.includes(rid)) res.cena.push(rid);
        }
      });
      res.totalRecipes = res.desayuno.length + res.almuerzo.length + res.cena.length;
      return res;
    },

    setMealInPlan: async (dayIndex, mealType, recipeIds, weekKey, dateStr = null) => {
      const plan = LocalStore.getCollection('weeklyPlan');
      const numDay = Number(dayIndex);
      const remaining = plan.filter(r => {
        if (!r) return false;
        const rDay = Number(r.dayIndex !== undefined ? r.dayIndex : r.day_index);
        const rMeal = r.mealType || r.meal_type;
        const mealMatch = (rMeal === mealType);
        if (!mealMatch) return true;

        if (dateStr && r.date) {
          return r.date !== dateStr;
        }
        if (weekKey) {
          const wMatch = (r.weekKey === weekKey || (!r.weekKey && weekKey === 'current'));
          return !(wMatch && rDay === numDay);
        }
        return rDay !== numDay;
      });
      plan.length = 0;
      plan.push(...remaining);
      if (recipeIds && recipeIds.length > 0) {
        recipeIds.forEach(rid => {
          plan.push({
            id: LocalStore.uuid(),
            date: dateStr || null,
            dayIndex: numDay,
            dayOfWeek: numDay,
            mealType,
            recipeId: rid,
            weekKey: weekKey || null
          });
        });
      }
      LocalStore.save();
      return { ok: true };
    },

    addRecipeToSlot: async (dayIndex, mealType, recipeId) => {
      LocalStore.getCollection('weeklyPlan').push({
        id: LocalStore.uuid(),
        dayIndex: Number(dayIndex),
        mealType,
        recipeId
      });
      LocalStore.save();
      return { ok: true };
    },

    removeRecipeFromSlot: async (dayIndex, mealType, recipeId) => {
      const plan = LocalStore.getCollection('weeklyPlan');
      const idx = plan.findIndex(r => (r.dayIndex === dayIndex || r.day_index === dayIndex) && (r.mealType === mealType || r.meal_type === mealType) && (r.recipeId === recipeId || r.recipe_id === recipeId));
      if (idx !== -1) {
        plan.splice(idx, 1);
        LocalStore.save();
      }
      return { ok: true };
    },

    getComplementos: async () => {
      const comps = LocalStore.getCollection('complementos') || [];
      const ings = LocalStore.getCollection('complementoIngredients') || [];
      return comps.map(c => ({
        id: c.id,
        name: c.name,
        category: c.category || 'otros',
        amount: c.amount || '',
        unit: c.unit || '',
        notes: c.notes || '',
        ingredients: ings.filter(i => i.complementoId === c.id).map(i => ({
          id: i.id,
          name: i.name,
          amount: i.amount || '',
          unit: i.unit || ''
        }))
      }));
    },

    addComplemento: async ({ name, category = 'otros', amount = '', unit = '', notes = '', ingredients = [] }) => {
      const c = {
        id: LocalStore.uuid(),
        name: name.trim(),
        category,
        amount: String(amount),
        unit: String(unit),
        notes: notes.trim(),
        createdAt: nowISO()
      };
      LocalStore.insert('complementos', c, 'complementos');
      if (ingredients && ingredients.length > 0) {
        ingredients.forEach(i => {
          LocalStore.insert('complementoIngredients', {
            id: LocalStore.uuid(),
            complementoId: c.id,
            name: i.name.trim(),
            amount: String(i.amount || ''),
            unit: String(i.unit || '')
          });
        });
      }
      return { ok: true, data: c };
    },

    updateComplemento: async (id, updates) => {
      const payload = {};
      if (updates.name !== undefined) payload.name = updates.name.trim();
      if (updates.category !== undefined) payload.category = updates.category;
      if (updates.amount !== undefined) payload.amount = String(updates.amount);
      if (updates.unit !== undefined) payload.unit = String(updates.unit);
      if (updates.notes !== undefined) payload.notes = updates.notes.trim();
      LocalStore.update('complementos', id, payload, 'complementos');

      if (updates.ingredients !== undefined) {
        const allIngs = LocalStore.getCollection('complementoIngredients');
        const filtered = allIngs.filter(i => i.complementoId !== id);
        allIngs.length = 0;
        allIngs.push(...filtered);
        updates.ingredients.forEach(i => {
          allIngs.push({
            id: LocalStore.uuid(),
            complementoId: id,
            name: i.name.trim(),
            amount: String(i.amount || ''),
            unit: String(i.unit || '')
          });
        });
        LocalStore.save();
      }
      return { ok: true };
    },

    deleteComplemento: async (id) => {
      LocalStore.remove('complementos', id, 'complementos');
      const allIngs = LocalStore.getCollection('complementoIngredients');
      const filtered = allIngs.filter(i => i.complementoId !== id);
      allIngs.length = 0;
      allIngs.push(...filtered);
      LocalStore.save();
      return { ok: true };
    },

    // Categorías de Complementos
    getComplementCategories: async () => {
      const cats = LocalStore.getCollection('complementoCategories') || [];
      return cats;
    },

    addComplementCategory: async ({ label, icon = '🧺' }) => {
      const cats = LocalStore.getCollection('complementoCategories');
      const id = 'cat_' + Date.now();
      const newCat = {
        id,
        label: label.trim(),
        icon: icon || '🧺',
        isCustom: true
      };
      LocalStore.insert('complementoCategories', newCat);
      return { ok: true, data: newCat };
    },

    updateComplementCategory: async (id, { label, icon }) => {
      const payload = {};
      if (label !== undefined) payload.label = label.trim();
      if (icon !== undefined) payload.icon = icon;
      LocalStore.update('complementoCategories', id, payload);
      return { ok: true };
    },

    deleteComplementCategory: async (id) => {
      LocalStore.remove('complementoCategories', id);
      const remainingCats = LocalStore.getCollection('complementoCategories') || [];
      const fallbackCat = remainingCats[0]?.id || 'otros';
      const comps = LocalStore.getCollection('complementos') || [];
      comps.forEach(c => {
        if (c && c.category === id) {
          c.category = fallbackCat;
        }
      });
      LocalStore.save();
      return { ok: true };
    },

    // Complementos disponibles en planificador
    getAvailableComplementos: async () => {
      const arr = LocalStore.getCollection('availableComplementos') || [];
      return [...arr];
    },

    setAvailableComplementos: async (ids) => {
      const toSave = Array.isArray(ids) ? [...ids] : [];
      const list = LocalStore.getCollection('availableComplementos');
      list.length = 0;
      list.push(...toSave);
      LocalStore.save();
      return { ok: true, data: [...list] };
    },

    // Lista de Compras
    getShoppingList: async () => {
      const list = [...(LocalStore.getCollection('shoppingList') || [])];
      list.sort((a, b) => (Number(a.checked) - Number(b.checked)));
      return list.map(s => ({
        id: s.id,
        name: s.name,
        origins: Array.isArray(s.origins) ? s.origins : (s.origins ? [s.origins] : []),
        amount: s.amount || '',
        unit: s.unit || '',
        source: s.source || 'manual',
        weekKey: s.weekKey || null,
        checked: !!s.checked,
        createdAt: s.createdAt
      }));
    },

    addShoppingItem: async ({ name, origins = [], amount = '', unit = '', source = 'manual', weekKey = null }) => {
      const item = {
        id: LocalStore.uuid(),
        name: name.trim(),
        origins: Array.isArray(origins) ? origins : (origins ? [origins] : []),
        amount: String(amount),
        unit: String(unit),
        source,
        weekKey,
        checked: false,
        createdAt: nowISO()
      };
      LocalStore.insert('shoppingList', item);
      return { ok: true, data: item };
    },

    updateShoppingItem: async (id, updates) => {
      const payload = {};
      if (updates.name !== undefined) payload.name = updates.name.trim();
      if (updates.origins !== undefined) payload.origins = updates.origins;
      if (updates.amount !== undefined) payload.amount = String(updates.amount);
      if (updates.unit !== undefined) payload.unit = String(updates.unit);
      if (updates.checked !== undefined) payload.checked = !!updates.checked;
      const updated = LocalStore.update('shoppingList', id, payload);
      return { ok: true, data: updated };
    },

    deleteShoppingItem: async (id) => {
      LocalStore.remove('shoppingList', id);
      return { ok: true };
    },

    deleteShoppingItemsBatch: async (ids) => {
      if (!ids || !ids.length) return { ok: true };
      const idSet = new Set(ids);
      const list = LocalStore.getCollection('shoppingList');
      const filtered = list.filter(i => !idSet.has(i.id));
      list.length = 0;
      list.push(...filtered);
      LocalStore.save();
      return { ok: true };
    },

    clearCheckedShoppingItems: async () => {
      const list = LocalStore.getCollection('shoppingList');
      const remaining = list.filter(i => !i.checked);
      list.length = 0;
      list.push(...remaining);
      LocalStore.save();
      return { ok: true };
    },

    clearShoppingList: async () => {
      LocalStore.getCollection('shoppingList').length = 0;
      LocalStore.save();
      return { ok: true };
    },

    addBulkShoppingItems: async (items, mode = 'append', context = {}) => {
      if (!items || !items.length) return { ok: true, count: 0 };
      const currentList = LocalStore.getCollection('shoppingList');

      // Si el modo es 'replace', removemos ítems previos de la misma fuente/semana
      if (mode === 'replace') {
        const sourceToReplace = context.source || items[0]?.source;
        const weekKeyToReplace = context.weekKey;
        const filtered = currentList.filter(item => {
          if (sourceToReplace === 'plan' && weekKeyToReplace) {
            return !(item.source === 'plan' && item.weekKey === weekKeyToReplace);
          } else if (sourceToReplace === 'complemento') {
            return item.source !== 'complemento';
          }
          return true;
        });
        currentList.length = 0;
        currentList.push(...filtered);
      }

      // Fusionar o agregar
      items.forEach(newItem => {
        const normName = (newItem.name || '').trim().toLowerCase();
        const existing = currentList.find(i => (i.name || '').trim().toLowerCase() === normName);

        const newOrigins = Array.isArray(newItem.origins) ? newItem.origins : (newItem.origins ? [newItem.origins] : []);

        if (existing) {
          const existingOrigins = Array.isArray(existing.origins) ? existing.origins : (existing.origins ? [existing.origins] : []);
          newOrigins.forEach(orig => {
            if (orig && !existingOrigins.includes(orig)) {
              existingOrigins.push(orig);
            }
          });
          existing.origins = existingOrigins;
          if (newItem.amount && !existing.amount) existing.amount = newItem.amount;
          if (newItem.unit && !existing.unit) existing.unit = newItem.unit;
        } else {
          currentList.push({
            id: LocalStore.uuid(),
            name: newItem.name.trim(),
            origins: newOrigins,
            amount: String(newItem.amount || ''),
            unit: String(newItem.unit || ''),
            source: newItem.source || 'manual',
            weekKey: newItem.weekKey || context.weekKey || null,
            checked: false,
            createdAt: nowISO()
          });
        }
      });

      LocalStore.save();
      return { ok: true, count: items.length };
    },

    getExpenses: async ({ page = 0, pageSize = 50 } = {}) => {
      const all = [...(LocalStore.getCollection('expenses') || [])];
      all.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.localeCompare(a.createdAt));
      const profs = LocalStore.getCollection('profiles') || [];
      const pMap = new Map(profs.map(p => [p.id, p]));
      const from = page * pageSize;
      const slice = all.slice(from, from + pageSize);
      return {
        expenses: slice.map(e => ({
          id: e.id,
          expenseDate: e.expenseDate,
          amount: Number(e.amount),
          category: e.category,
          description: e.description || '',
          linkedRestockId: e.linkedRestockId || null,
          managedByName: pMap.get(e.managedBy)?.fullName || 'Sistema',
          createdAt: e.createdAt
        })),
        totalCount: all.length
      };
    },

    getExpensesThisMonth: async () => {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const all = LocalStore.getCollection('expenses') || [];
      const thisMonth = all.filter(e => e.expenseDate >= firstDay);
      const total = thisMonth.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      return { total, count: thisMonth.length };
    },

    getExpenseTotal: (expenses) => {
      return (expenses || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    },

    addExpense: async ({ description, amount, date, category = 'Otros', linkedRestockId = null }) => {
      const user = Auth.getUser();
      const exp = {
        id: LocalStore.uuid(),
        description: description.trim(),
        amount: Number(amount),
        expenseDate: date || todayStr(),
        category: category || 'Otros',
        linkedRestockId,
        managedBy: user?.id || null,
        createdAt: nowISO()
      };
      LocalStore.insert('expenses', exp, 'expenses');
      return { ok: true, data: exp };
    },

    deleteExpense: async (id) => {
      LocalStore.remove('expenses', id, 'expenses');
      return { ok: true };
    },

    getAuditLog: async ({ tableName, actorId, fromDate, toDate, page = 0, pageSize = 50 } = {}) => {
      let list = [...(LocalStore.getCollection('auditLog') || [])];
      if (tableName) list = list.filter(a => a.tableName === tableName);
      if (actorId) list = list.filter(a => a.actorId === actorId);
      if (fromDate) list = list.filter(a => a.createdAt >= fromDate);
      if (toDate) list = list.filter(a => a.createdAt <= toDate + 'T23:59:59.999Z');
      const from = page * pageSize;
      const slice = list.slice(from, from + pageSize);
      return {
        entries: slice.map(entry => ({
          id: entry.id,
          tableName: entry.tableName,
          recordId: entry.recordId,
          action: entry.action,
          actorId: entry.actorId,
          actorName: entry.actorName || 'Sistema',
          changedFields: entry.changedFields || [],
          oldValues: entry.oldValues || {},
          newValues: entry.newValues || {},
          createdAt: entry.createdAt
        })),
        totalCount: list.length
      };
    },

    getAuditLogs: async (...args) => LocalAdapter.getAuditLog(...args),

    purgeOldAudit: async (months = 24) => {
      const count = LocalStore.purgeOldAudit(months);
      return { ok: true, deletedCount: count };
    },

    getActiveAlerts: async () => {
      const alerts = [];
      const today = todayStr();
      const nowTime = new Date().toTimeString().slice(0, 5); // "HH:MM"

      try {
        const [meds, admins] = await Promise.all([
          LocalAdapter.getMedications(),
          LocalAdapter.getTodayAdministrations()
        ]);

        meds.filter(m => m.status === 'active').forEach(m => {
          (m.schedules || []).filter(s => s.active).forEach(s => {
            const administered = admins.some(a => a.scheduleId === s.id && a.scheduledDate === today);
            if (!administered && s.timeOfDay < nowTime) {
              alerts.push({
                id: `dose_late_${s.id}`,
                type: 'critical',
                title: 'Dosis atrasada',
                message: `${m.name} (${s.dose} ${m.unit}) tocaba a las ${s.timeOfDay}`,
                module: 'administration'
              });
            }
          });
        });

        meds.filter(m => m.status === 'active').forEach(m => {
          if (m.needsRestock || (m.daysRemaining !== null && m.daysRemaining <= 3)) {
            alerts.push({
              id: `med_stock_${m.id}`,
              type: m.currentStock === 0 ? 'critical' : 'alert',
              title: 'Medicamento por agotarse',
              message: `${m.name}: quedan ${m.currentStock} ${m.unit} (${m.daysRemaining != null ? m.daysRemaining + ' días' : 'reposición urgente'})`,
              module: 'medications'
            });
          }
        });

        const inventory = await LocalAdapter.getInventory();
        inventory.forEach(item => {
          if (item.medicationId) return; // Medicamentos ya procesados arriba
          if (item.isLow) {
            alerts.push({
              id: `inv_low_${item.id}`,
              type: item.currentStock === 0 ? 'critical' : 'alert',
              title: item.isCritical ? 'Insumo CRÍTICO agotado/bajo' : 'Insumo bajo mínimo',
              message: `${item.name}: ${item.currentStock} ${item.unit} (mínimo: ${item.minThreshold})`,
              module: 'inventory'
            });
          }
        });

        const appointments = await LocalAdapter.getUpcomingAppointments(2);
        appointments.forEach(a => {
          alerts.push({
            id: `appt_soon_${a.id}`,
            type: a.apptDate === today ? 'critical' : 'alert',
            title: a.apptDate === today ? 'Cita médica HOY' : 'Cita médica próxima',
            message: `${a.title} con ${a.doctor || a.specialty || 'médico'} (${formatDate(a.apptDate)} ${a.apptTime || ''})`,
            module: 'agenda'
          });
        });
      } catch (e) {
        console.warn('Error al derivar alertas activas en local:', e);
      }

      return alerts;
    },

    getTasksForDate: async (dateStr) => LocalAdapter.getTasksByDate(dateStr),
    getShoppingItems: async () => LocalAdapter.getShoppingList(),
    addShoppingItemsBatch: async (items) => LocalAdapter.addBulkShoppingItems(items),
    archiveCompletedShopping: async () => LocalAdapter.clearCheckedShoppingItems(),
    setWeeklySlot: async (d, m, ids, weekKey, dateStr) => LocalAdapter.setMealInPlan(d, m, ids, weekKey, dateStr),
    updatePatientStatus: async (st, n) => LocalAdapter.savePatientStatus(st, n),
    adjustInventory: async (id, delta, n) => LocalAdapter.adjustInventoryStock(id, delta, n),
    getMedicationRestocks: async (medId) => LocalAdapter.getRestockHistory(medId),
    markShiftNotesRead: async (ids) => LocalAdapter.markShiftNoteRead(ids),

    exportAllData: async () => {
      const backup = {
        _meta: {
          exportedAt: nowISO(),
          app: 'CuidApp v2.0',
          version: '2.0.0',
          mode: 'local_storage'
        },
        settings: await LocalAdapter.getSettings(),
        patientStatus: await LocalAdapter.getPatientStatus(),
        careRoles: await LocalAdapter.getCareRoles(),
        profiles: await LocalAdapter.getProfiles(),
        shifts: await LocalAdapter.getShiftHistory(200),
        shiftNotes: await LocalAdapter.getShiftNotes(),
        medications: await LocalAdapter.getMedications(),
        restocks: await LocalAdapter.getRestockHistory(),
        administrations: await LocalAdapter.getAdministrationHistory({ limit: 500 }),
        inventory: await LocalAdapter.getInventory(),
        movements: await LocalAdapter.getInventoryMovements(null, 500),
        supplyLocations: await LocalAdapter.getSupplyLocations(true),
        supplySuppliers: await LocalAdapter.getSupplySuppliers(true),
        supplyRelays: await LocalAdapter.getSupplyRelays(500),
        supplyOrderBatches: await LocalAdapter.getSupplyOrderBatches(),
        supplyOrderLines: await LocalAdapter.getSupplyOrderLines(),
        supplyOpenContainers: await LocalAdapter.getSupplyOpenContainers(),
        tasks: LocalStore.getCollection('tasks') || [],
        taskTemplates: await LocalAdapter.getTaskTemplates(),
        appointments: await LocalAdapter.getAppointments(),
        recipes: await LocalAdapter.getRecipes(),
        weeklyPlan: await LocalAdapter.getWeeklyPlan(),
        complementos: await LocalAdapter.getComplementos(),
        shopping: await LocalAdapter.getShoppingList(),
        expenses: (await LocalAdapter.getExpenses({ pageSize: 1000 })).expenses
      };
      return JSON.stringify(backup, null, 2);
    }
  };

  // ─── Bootstrap ────────────────────────────────────────────
  const bootstrap = async () => {
    if (isLocal()) return wrap(await LocalAdapter.bootstrap());
    try {
      // Generar tareas recurrentes del día (RF-64, idempotente)
      await db().rpc('generate_recurring_tasks').catch(e => console.warn('Error al generar tareas:', e));

      // Precargar referencias
      await Promise.all([
        getSettings(true),
        getPatientStatus(true),
        getCareRoles(true),
        getProfiles(true)
      ]);
      return { ok: true };
    } catch (e) {
      console.warn('Error en bootstrap de datos:', e);
      return { ok: false, error: traducirError(e) };
    }
  };

  // ─── 1. Configuración (settings) ──────────────────────────
  const getSettings = async (forceRefresh = false) => {
    if (_cache.settings && !forceRefresh) return _cache.settings;
    const { data, error } = await db()
      .from('settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();

    if (error) throw new Error(traducirError(error));
    _cache.settings = {
      patientName: data?.patient_name || 'El Paciente',
      emergencyContactName: data?.emergency_contact_name || '',
      emergencyContactPhone: data?.emergency_contact_phone || '',
      emergencyContactWhatsapp: data?.emergency_contact_whatsapp || '',
      updatedAt: data?.updated_at
    };
    return _cache.settings;
  };

  const saveSettings = async (updates) => {
    const payload = {
      patient_name: updates.patientName,
      emergency_contact_name: updates.emergencyContactName,
      emergency_contact_phone: updates.emergencyContactPhone,
      emergency_contact_whatsapp: updates.emergencyContactWhatsapp,
      updated_at: nowISO()
    };
    const { data, error } = await db()
      .from('settings')
      .update(payload)
      .eq('id', true)
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };
    invalidateCache('settings');
    return { ok: true, data };
  };

  // ─── 2. Estado del Paciente (patient_status) ──────────────
  const getPatientStatus = async (forceRefresh = false) => {
    if (_cache.patientStatus && !forceRefresh) return _cache.patientStatus;
    const { data, error } = await db()
      .from('patient_status')
      .select('*, profiles:updated_by(full_name)')
      .eq('id', true)
      .maybeSingle();

    if (error) throw new Error(traducirError(error));
    _cache.patientStatus = {
      status: data?.status || 'stable',
      notes: data?.notes || '',
      updatedBy: data?.profiles?.full_name || 'Sistema',
      updatedById: data?.updated_by,
      lastUpdated: data?.updated_at || nowISO()
    };
    return _cache.patientStatus;
  };

  const savePatientStatus = async (status, notes = '') => {
    const user = Auth.getUser();
    const payload = {
      status,
      notes,
      updated_by: user?.id || null,
      updated_at: nowISO()
    };
    const { data, error } = await db()
      .from('patient_status')
      .update(payload)
      .eq('id', true)
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };
    invalidateCache('patientStatus');
    return { ok: true, data };
  };

  // ─── 3. Roles de Cuidado (care_roles) y Perfiles ──────────
  const getCareRoles = async (forceRefresh = false) => {
    if (_cache.careRoles && !forceRefresh) return _cache.careRoles;
    const { data, error } = await db()
      .from('care_roles')
      .select('*')
      .order('is_default', { ascending: false })
      .order('name');

    if (error) throw new Error(traducirError(error));
    _cache.careRoles = data.map(r => ({
      id: r.id,
      name: r.name,
      icon: r.icon || '👤',
      color: r.color || '#8b949e',
      isDefault: r.is_default
    }));
    return _cache.careRoles;
  };

  const addCareRole = async ({ name, icon, color }) => {
    const { data, error } = await db()
      .from('care_roles')
      .insert({ name: name.trim(), icon: icon || '👤', color: color || '#8b949e' })
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };
    invalidateCache('careRoles');
    return { ok: true, data };
  };

  const updateCareRole = async (id, { name, icon, color }) => {
    const { data, error } = await db()
      .from('care_roles')
      .update({ name: name.trim(), icon, color })
      .eq('id', id)
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };
    invalidateCache('careRoles');
    return { ok: true, data };
  };

  const deleteCareRole = async (id) => {
    const { error } = await db().from('care_roles').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    invalidateCache('careRoles');
    return { ok: true };
  };

  const getProfiles = async (forceRefresh = false) => {
    if (_cache.profiles && !forceRefresh) return _cache.profiles;
    const { data, error } = await db()
      .from('profiles')
      .select('*, care_roles(*)')
      .order('full_name');

    if (error) throw new Error(traducirError(error));
    _cache.profiles = data.map(p => ({
      id: p.id,
      fullName: p.full_name,
      phone: p.phone,
      notes: p.notes,
      careRoleId: p.care_role_id,
      careRole: p.care_roles ? {
        id: p.care_roles.id,
        name: p.care_roles.name,
        icon: p.care_roles.icon,
        color: p.care_roles.color
      } : null,
      appRole: p.app_role,
      active: p.active,
      createdAt: p.created_at
    }));
    return _cache.profiles;
  };

  const updateProfile = async (id, updates) => {
    const payload = {};
    if (updates.fullName !== undefined) payload.full_name = updates.fullName;
    if (updates.phone !== undefined) payload.phone = updates.phone;
    if (updates.notes !== undefined) payload.notes = updates.notes;
    if (updates.careRoleId !== undefined) payload.care_role_id = updates.careRoleId;
    if (updates.appRole !== undefined) payload.app_role = updates.appRole;
    if (updates.active !== undefined) payload.active = updates.active;

    const { data, error } = await db()
      .from('profiles')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };
    invalidateCache('profiles');
    if (id === Auth.getUser()?.id) {
      await Auth.refreshProfile();
    }
    return { ok: true, data };
  };

  // ─── 4. Turnos (shifts) y Traspasos (shift_notes) ─────────
  const getCurrentShift = async () => {
    const { data, error } = await db()
      .from('shifts')
      .select('*, profiles(id, full_name, phone), care_roles(id, name, icon, color)')
      .is('ended_at', null)
      .maybeSingle();

    if (error) throw new Error(traducirError(error));
    if (!data) return null;
    return {
      id: data.id,
      profileId: data.profile_id,
      personName: data.profiles?.full_name || 'Desconocido',
      phone: data.profiles?.phone || '',
      careRoleId: data.care_role_id,
      roleName: data.care_roles?.name || 'Cuidador',
      roleIcon: data.care_roles?.icon || '🤝',
      roleColor: data.care_roles?.color || '#f0a500',
      startedAt: data.started_at,
      endedAt: data.ended_at
    };
  };

  const takeShift = async (careRoleId) => {
    const { data, error } = await db().rpc('take_shift', {
      p_care_role_id: careRoleId || null
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, shiftId: data };
  };

  const endShift = async () => {
    const { error } = await db().rpc('end_shift');
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const getShiftHistory = async (limit = 50) => {
    const { data, error } = await db()
      .from('shifts')
      .select('*, profiles(full_name, phone), care_roles(name, icon, color)')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(traducirError(error));
    return data.map(s => ({
      id: s.id,
      personName: s.profiles?.full_name || 'Desconocido',
      roleName: s.care_roles?.name || 'Cuidador',
      roleIcon: s.care_roles?.icon || '👤',
      startedAt: s.started_at,
      endedAt: s.ended_at
    }));
  };

  const getShiftNotes = async () => {
    const { data, error } = await db()
      .from('shift_notes')
      .select('*, profiles(full_name)')
      .order('created_at', { ascending: false });

    if (error) throw new Error(traducirError(error));
    return data.map(n => ({
      id: n.id,
      content: n.content,
      fromProfileId: n.from_profile_id,
      authorName: n.profiles?.full_name || 'Cuidador saliente',
      readAt: n.read_at,
      createdAt: n.created_at
    }));
  };

  const addShiftNote = async (content) => {
    const { data, error } = await db()
      .from('shift_notes')
      .insert({
        content: content.trim(),
        from_profile_id: Auth.getUser()?.id || null
      })
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const markShiftNoteRead = async (id) => {
    const { error } = await db()
      .from('shift_notes')
      .update({ read_at: nowISO() })
      .eq('id', id);

    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const markAllShiftNotesRead = async () => {
    const { error } = await db()
      .from('shift_notes')
      .update({ read_at: nowISO() })
      .is('read_at', null);

    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  // ─── 5. Medicamentos y Reposiciones ───────────────────────
  const getMedications = async () => {
    // RNF-43: lectura compuesta con relación anidada
    const { data, error } = await db()
      .from('medications_view')
      .select('*, medication_schedules(*)')
      .order('name');

    if (error) throw new Error(traducirError(error));
    return data.map(m => ({
      id: m.id,
      name: m.name,
      prescriber: m.prescriber || '',
      indication: m.indication || '',
      startDate: m.start_date,
      status: m.status,
      notes: m.notes || '',
      needsRestock: !!m.needs_restock,
      unit: m.unit || 'unidad',
      currentStock: Number(m.current_stock || 0),
      manualDailyAmount: m.manual_daily_amount != null ? Number(m.manual_daily_amount) : null,
      dailyAmount: Number(m.daily_amount || 0),
      daysRemaining: m.days_remaining != null ? Number(m.days_remaining) : null,
      stockControl: m.stock_control || 'dosis',
      schedules: (m.medication_schedules || []).map(s => ({
        id: s.id,
        medicationId: s.medication_id,
        timeOfDay: s.time_of_day.slice(0, 5),
        dose: Number(s.dose),
        active: s.active
      }))
    }));
  };

  const addMedication = async (med) => {
    const payload = {
      name: med.name.trim(),
      prescriber: (med.prescriber || '').trim(),
      indication: (med.indication || '').trim(),
      start_date: med.startDate || todayStr(),
      status: med.status || 'active',
      notes: (med.notes || '').trim(),
      unit: med.unit || 'unidad',
      current_stock: Math.max(0, Number(med.currentStock || 0)),
      manual_daily_amount: med.manualDailyAmount != null ? Number(med.manualDailyAmount) : null,
      stock_control: med.stockControl || 'dosis'
    };
    const { data, error } = await db().from('medications').insert(payload).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const updateMedication = async (id, updates) => {
    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.prescriber !== undefined) payload.prescriber = updates.prescriber.trim();
    if (updates.indication !== undefined) payload.indication = updates.indication.trim();
    if (updates.startDate !== undefined) payload.start_date = updates.startDate;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.notes !== undefined) payload.notes = updates.notes.trim();
    if (updates.unit !== undefined) payload.unit = updates.unit;
    if (updates.manualDailyAmount !== undefined) payload.manual_daily_amount = updates.manualDailyAmount != null ? Number(updates.manualDailyAmount) : null;
    if (updates.stockControl !== undefined) payload.stock_control = updates.stockControl;
    if (updates.needsRestock !== undefined) payload.needs_restock = !!updates.needsRestock;

    const { data, error } = await db().from('medications').update(payload).eq('id', id).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const deleteMedication = async (id) => {
    const { error } = await db().from('medications').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const addMedicationSchedule = async ({ medicationId, timeOfDay, dose }) => {
    const { data, error } = await db()
      .from('medication_schedules')
      .insert({
        medication_id: medicationId,
        time_of_day: timeOfDay,
        dose: Number(dose),
        active: true
      })
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const updateMedicationSchedule = async (id, updates) => {
    const payload = {};
    if (updates.timeOfDay !== undefined) payload.time_of_day = updates.timeOfDay;
    if (updates.dose !== undefined) payload.dose = Number(updates.dose);
    if (updates.active !== undefined) payload.active = !!updates.active;

    const { data, error } = await db()
      .from('medication_schedules')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const deleteMedicationSchedule = async (id) => {
    const { error } = await db().from('medication_schedules').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const recordRestock = async ({ medicationId, quantity, establishment = '', cost = 0 }) => {
    const { data, error } = await db().rpc('record_restock', {
      p_medication_id: medicationId,
      p_quantity: Number(quantity),
      p_establishment: establishment,
      p_cost: Number(cost || 0)
    });

    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, restockId: data };
  };

  const getRestockHistory = async (medicationId) => {
    let query = db()
      .from('medication_restocks')
      .select('*, profiles(full_name), medications(name)')
      .order('created_at', { ascending: false });

    if (medicationId) query = query.eq('medication_id', medicationId);
    const { data, error } = await query;
    if (error) throw new Error(traducirError(error));
    return data.map(r => ({
      id: r.id,
      medicationId: r.medication_id,
      medicationName: r.medications?.name,
      quantity: Number(r.quantity),
      establishment: r.establishment,
      cost: Number(r.cost),
      managedByName: r.profiles?.full_name || 'Sistema',
      createdAt: r.created_at
    }));
  };

  // ─── 6. Administración de Dosis (RF-39 .. RF-48) ──────────
  const getTodayAdministrations = async () => {
    const today = todayStr();
    const { data, error } = await db()
      .from('medication_administrations')
      .select('*, profiles(full_name)')
      .eq('scheduled_date', today);

    if (error) throw new Error(traducirError(error));
    return data.map(a => ({
      id: a.id,
      medicationId: a.medication_id,
      scheduleId: a.schedule_id,
      scheduledDate: a.scheduled_date,
      scheduledTime: a.scheduled_time ? a.scheduled_time.slice(0, 5) : null,
      administeredAt: a.administered_at,
      administeredByName: a.profiles?.full_name || 'Cuidador',
      status: a.status, // 'given' | 'skipped' | 'refused'
      dose: Number(a.dose),
      notes: a.notes || ''
    }));
  };

  const recordAdministration = async ({
    medicationId, scheduleId, scheduledDate, scheduledTime, status, dose, notes = ''
  }) => {
    const { data, error } = await db().rpc('record_administration', {
      p_medication_id: medicationId,
      p_schedule_id: scheduleId || null,
      p_scheduled_date: scheduledDate || todayStr(),
      p_scheduled_time: scheduledTime || null,
      p_status: status,
      p_dose: Number(dose || 0),
      p_notes: notes
    });

    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, adminId: data };
  };

  const undoAdministration = async (id) => {
    const { error } = await db().rpc('undo_administration', { p_id: id });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const getAdministrationHistory = async ({ medicationId, fromDate, toDate, limit = 100 } = {}) => {
    let query = db()
      .from('medication_administrations')
      .select('*, profiles(full_name), medications(name, unit)')
      .order('scheduled_date', { ascending: false })
      .order('scheduled_time', { ascending: false })
      .limit(limit);

    if (medicationId) query = query.eq('medication_id', medicationId);
    if (fromDate) query = query.gte('scheduled_date', fromDate);
    if (toDate) query = query.lte('scheduled_date', toDate);

    const { data, error } = await query;
    if (error) throw new Error(traducirError(error));
    return data.map(a => ({
      id: a.id,
      medicationId: a.medication_id,
      medicationName: a.medications?.name,
      unit: a.medications?.unit || 'unidad',
      scheduledDate: a.scheduled_date,
      scheduledTime: a.scheduled_time ? a.scheduled_time.slice(0, 5) : null,
      administeredAt: a.administered_at,
      administeredByName: a.profiles?.full_name || 'Cuidador',
      status: a.status,
      dose: Number(a.dose),
      notes: a.notes || ''
    }));
  };

  // ─── 7. Inventario (RF-49 .. RF-57) ───────────────────────
  const getInventory = async () => {
    // Lectura de vista con cálculo correcto de consumo (RF-54, RF-55)
    const { data, error } = await db()
      .from('inventory_items_view')
      .select('*, care_roles(id, name, icon, color)')
      .order('name');

    if (error) throw new Error(traducirError(error));
    return data.map(i => ({
      id: i.id,
      name: i.name,
      categoryId: i.category_id,
      categoryName: i.category_name || 'Otros',
      currentStock: Number(i.current_stock || 0),
      unit: i.unit || 'unidad',
      minThreshold: Number(i.min_threshold || 0),
      optimalStock: Number(i.optimal_stock || 0),
      orderUnit: i.order_unit || i.unit || 'unidad',
      unitsPerPurchase: Number(i.units_per_order || 1),
      isCritical: !!i.is_critical,
      reviewEveryHours: i.review_frequency_hours != null ? Number(i.review_frequency_hours) : (i.is_critical ? 26 : 50),
      isPao: !!i.is_pao,
      paoHours: i.pao_days ? i.pao_days * 24 : null,
      oxygenFlowLpm: i.flow_rate_lpm != null ? Number(i.flow_rate_lpm) : null,
      cylinderCapacityLiters: i.cylinder_capacity_liters != null ? Number(i.cylinder_capacity_liters) : null,
      stockControl: i.stock_control || 'dosis',
      consumptionType: i.consumption_type || 'variable',
      medicationId: i.medication_id || null,
      primaryLocationId: i.primary_location_id || 'loc_hab',
      reserveLocationId: i.reserve_location_id || 'loc_arm',
      supplierId: i.default_supplier_id || null,
      responsibleCareRoleId: i.responsible_care_role_id,
      responsibleRole: i.care_roles ? {
        id: i.care_roles.id,
        name: i.care_roles.name,
        icon: i.care_roles.icon,
        color: i.care_roles.color
      } : null,
      notes: i.notes || '',
      avgDailyConsumption: i.avg_daily_consumption != null ? Number(i.avg_daily_consumption) : null,
      daysRemaining: i.days_remaining != null ? Number(i.days_remaining) : null,
      isLow: !!i.is_low,
      active: i.active !== false
    }));
  };

  const addInventoryItem = async (item) => {
    const payload = {
      name: item.name.trim(),
      category_id: item.categoryId || null,
      unit: item.unit || 'unidad',
      order_unit: item.orderUnit || item.unit || 'unidad',
      units_per_order: Number(item.unitsPerPurchase || 1),
      min_threshold: Math.max(0, Number(item.minThreshold || 0)),
      optimal_stock: Math.max(0, Number(item.optimalStock || 0)),
      is_critical: !!item.isCritical,
      review_frequency_hours: item.reviewEveryHours != null ? Number(item.reviewEveryHours) : (item.isCritical ? 26 : 50),
      is_pao: !!item.isPao,
      pao_days: item.paoHours ? Math.ceil(item.paoHours / 24) : null,
      flow_rate_lpm: item.oxygenFlowLpm != null ? Number(item.oxygenFlowLpm) : null,
      cylinder_capacity_liters: item.cylinderCapacityLiters != null ? Number(item.cylinderCapacityLiters) : null,
      stock_control: item.stockControl || 'dosis',
      consumption_type: item.consumptionType || 'variable',
      primary_location_id: item.primaryLocationId || 'loc_hab',
      reserve_location_id: item.reserveLocationId || 'loc_arm',
      default_supplier_id: item.supplierId || null,
      responsible_care_role_id: item.responsibleCareRoleId || null,
      notes: (item.notes || '').trim()
    };
    const { data, error } = await db().from('inventory_items').insert(payload).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    if (item.currentStock && Number(item.currentStock) > 0) {
      await recordSupplyMovements([{
        itemId: data.id,
        locationId: payload.primary_location_id,
        stockState: 'full',
        movementType: 'count',
        quantity: Number(item.currentStock),
        note: 'Stock inicial al crear insumo'
      }]);
    }
    return { ok: true, data };
  };

  const updateInventoryItem = async (id, updates) => {
    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.categoryId !== undefined) payload.category_id = updates.categoryId;
    // current_stock es de solo lectura (ledger manda)
    if (updates.unit !== undefined) payload.unit = updates.unit;
    if (updates.orderUnit !== undefined) payload.order_unit = updates.orderUnit;
    if (updates.unitsPerPurchase !== undefined) payload.units_per_order = Number(updates.unitsPerPurchase) || 1;
    if (updates.minThreshold !== undefined) payload.min_threshold = Math.max(0, Number(updates.minThreshold));
    if (updates.optimalStock !== undefined) payload.optimal_stock = Math.max(0, Number(updates.optimalStock));
    if (updates.isCritical !== undefined) payload.is_critical = !!updates.isCritical;
    if (updates.reviewEveryHours !== undefined) payload.review_frequency_hours = updates.reviewEveryHours != null ? Number(updates.reviewEveryHours) : null;
    if (updates.isPao !== undefined) payload.is_pao = !!updates.isPao;
    if (updates.paoHours !== undefined) payload.pao_days = updates.paoHours ? Math.ceil(updates.paoHours / 24) : null;
    if (updates.oxygenFlowLpm !== undefined) payload.flow_rate_lpm = updates.oxygenFlowLpm != null ? Number(updates.oxygenFlowLpm) : null;
    if (updates.cylinderCapacityLiters !== undefined) payload.cylinder_capacity_liters = updates.cylinderCapacityLiters != null ? Number(updates.cylinderCapacityLiters) : null;
    if (updates.stockControl !== undefined) payload.stock_control = updates.stockControl;
    if (updates.consumptionType !== undefined) payload.consumption_type = updates.consumptionType;
    if (updates.primaryLocationId !== undefined) payload.primary_location_id = updates.primaryLocationId;
    if (updates.reserveLocationId !== undefined) payload.reserve_location_id = updates.reserveLocationId;
    if (updates.supplierId !== undefined) payload.default_supplier_id = updates.supplierId;
    if (updates.responsibleCareRoleId !== undefined) payload.responsible_care_role_id = updates.responsibleCareRoleId;
    if (updates.notes !== undefined) payload.notes = updates.notes.trim();
    if (updates.active !== undefined) payload.active = !!updates.active;

    const { data, error } = await db().from('inventory_items').update(payload).eq('id', id).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const deleteInventoryItem = async (id) => {
    const { error } = await db().from('inventory_items').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const adjustInventoryStock = async (itemId, delta, note = '') => {
    const { data, error } = await db().rpc('adjust_inventory', {
      p_item_id: itemId,
      p_delta: Number(delta),
      p_note: note
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, currentStock: data };
  };

  const getInventoryMovements = async (itemId, limit = 50) => {
    let query = db()
      .from('inventory_movements')
      .select('*, profiles(full_name)')
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (itemId) query = query.eq('item_id', itemId);
    const { data, error } = await query;
    if (error) throw new Error(traducirError(error));
    return data.map(m => ({
      id: m.id,
      itemId: m.item_id,
      delta: Number(m.delta),
      occurredOn: m.occurred_on,
      note: m.note || '',
      authorName: m.profiles?.full_name || 'Sistema',
      createdAt: m.created_at
    }));
  };

  const getInventoryCategories = async () => {
    const { data, error } = await db().from('inventory_categories').select('*').order('name');
    if (error) throw new Error(traducirError(error));
    return data.map(c => ({ id: c.id, name: c.name }));
  };

  const addInventoryCategory = async (name) => {
    const { data, error } = await db()
      .from('inventory_categories')
      .insert({ name: name.trim() })
      .select()
      .single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  // ─── 7b. Gestión Insumos (Supabase Remoto) ──────────────────
  const getSupplyLocations = async (includeArchived = false) => {
    let query = db().from('supply_locations_view').select('*');
    if (!includeArchived) query = query.eq('status', 'active');
    const { data, error } = await query.order('is_usage_point', { ascending: false }).order('is_default_restock', { ascending: false }).order('name');
    if (error) throw new Error(traducirError(error));
    return data.map(l => ({
      id: l.id,
      name: l.name,
      type: l.type,
      status: l.status,
      isDefaultRestock: !!l.is_default_restock,
      isUsagePoint: !!l.is_usage_point,
      reviewFrequencyHours: l.review_frequency_hours,
      notes: l.notes || '',
      distinctItemsCount: Number(l.distinct_items_count || 0),
      totalUnitsCount: Number(l.total_units_count || 0),
      createdAt: l.created_at
    }));
  };

  const addSupplyLocation = async (loc) => {
    const payload = {
      name: loc.name.trim(),
      type: loc.type || 'storage',
      is_default_restock: !!loc.isDefaultRestock,
      is_usage_point: !!loc.isUsagePoint,
      review_frequency_hours: loc.reviewFrequencyHours != null ? Number(loc.reviewFrequencyHours) : null,
      notes: (loc.notes || '').trim()
    };
    const { data, error } = await db().from('supply_locations').insert(payload).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const updateSupplyLocation = async (id, updates) => {
    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.type !== undefined) payload.type = updates.type;
    if (updates.isDefaultRestock !== undefined) payload.is_default_restock = !!updates.isDefaultRestock;
    if (updates.isUsagePoint !== undefined) payload.is_usage_point = !!updates.isUsagePoint;
    if (updates.reviewFrequencyHours !== undefined) payload.review_frequency_hours = updates.reviewFrequencyHours != null ? Number(updates.reviewFrequencyHours) : null;
    if (updates.notes !== undefined) payload.notes = updates.notes.trim();
    const { data, error } = await db().from('supply_locations').update(payload).eq('id', id).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const archiveSupplyLocation = async (id) => {
    const { error } = await db().rpc('archive_supply_location', { p_location_id: id });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const restoreSupplyLocation = async (id) => {
    const { error } = await db().rpc('restore_supply_location', { p_location_id: id });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const setSpecialLocation = async (id, role) => {
    const { error } = await db().rpc('set_special_location', { p_location_id: id, p_role: role });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const deleteSupplyLocation = async (id) => {
    const { error } = await db().from('supply_locations').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const getSupplySuppliers = async (includeArchived = false) => {
    let query = db().from('supply_suppliers_view').select('*');
    if (!includeArchived) query = query.eq('status', 'active');
    const { data, error } = await query.order('name');
    if (error) throw new Error(traducirError(error));
    return data.map(s => ({
      id: s.id,
      name: s.name,
      contactName: s.contact_name || '',
      phone: s.phone || '',
      whatsapp: s.whatsapp || '',
      leadTimeHours: Number(s.lead_time_hours || 24),
      status: s.status,
      notes: s.notes || '',
      distinctItemsCount: Number(s.distinct_items_count || 0),
      openOrdersCount: Number(s.open_orders_count || 0),
      createdAt: s.created_at
    }));
  };

  const addSupplySupplier = async (sup) => {
    const payload = {
      name: sup.name.trim(),
      contact_name: (sup.contactName || '').trim(),
      phone: (sup.phone || '').trim(),
      whatsapp: (sup.whatsapp || '').trim(),
      lead_time_hours: sup.leadTimeHours != null ? Number(sup.leadTimeHours) : 24,
      notes: (sup.notes || '').trim()
    };
    const { data, error } = await db().from('supply_suppliers').insert(payload).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const updateSupplySupplier = async (id, updates) => {
    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.contactName !== undefined) payload.contact_name = updates.contactName.trim();
    if (updates.phone !== undefined) payload.phone = updates.phone.trim();
    if (updates.whatsapp !== undefined) payload.whatsapp = updates.whatsapp.trim();
    if (updates.leadTimeHours !== undefined) payload.lead_time_hours = Number(updates.leadTimeHours);
    if (updates.notes !== undefined) payload.notes = updates.notes.trim();
    const { data, error } = await db().from('supply_suppliers').update(payload).eq('id', id).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const archiveSupplySupplier = async (id) => {
    const { error } = await db().rpc('archive_supply_supplier', { p_supplier_id: id });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const restoreSupplySupplier = async (id) => {
    const { error } = await db().rpc('restore_supply_supplier', { p_supplier_id: id });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const deleteSupplySupplier = async (id) => {
    const { error } = await db().from('supply_suppliers').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const recordSupplyMovements = async (movements) => {
    const { data, error } = await db().rpc('record_supply_movements', {
      p_movements: movements.map(m => ({
        item_id: m.itemId,
        location_id: m.locationId,
        stock_state: m.stockState || 'full',
        movement_type: m.movementType,
        quantity: Number(m.quantity || 0),
        qty_absolute: m.qtyAbsolute != null ? Number(m.qtyAbsolute) : null,
        note: m.note || null,
        group_id: m.groupId || null,
        client_event_id: m.clientEventId || null,
        occurred_at: m.occurredAt || nowISO()
      }))
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const saveSupplyRelayFull = async (payload) => {
    const { data, error } = await db().rpc('save_supply_relay_full', {
      p_relay: {
        occurred_at: payload.relay.occurredAt,
        delivered_by_profile_id: payload.relay.deliveredByProfileId,
        received_by_profile_id: payload.relay.receivedByProfileId,
        photo_path: payload.relay.photoPath || null,
        client_event_id: payload.relay.clientEventId || null,
        counts_count: payload.relay.countsCount || 0,
        omitted_count: payload.relay.omittedCount || 0,
        notes: payload.relay.notes || null
      },
      p_lines: (payload.lines || []).map(l => ({
        item_id: l.itemId,
        location_id: l.locationId,
        stock_state: l.stockState || 'full',
        counted_qty: l.countedQty != null ? Number(l.countedQty) : null,
        is_omitted: !!l.isOmitted,
        discrepancy: l.discrepancy != null ? Number(l.discrepancy) : null,
        discrepancy_reason: l.discrepancyReason || null
      })),
      p_movements: (payload.movements || []).map(m => ({
        item_id: m.itemId,
        location_id: m.locationId,
        stock_state: m.stockState || 'full',
        movement_type: m.movementType,
        quantity: Number(m.quantity || 0),
        qty_absolute: m.qtyAbsolute != null ? Number(m.qtyAbsolute) : null,
        note: m.note || null,
        group_id: m.groupId || null,
        client_event_id: m.clientEventId || null,
        occurred_at: m.occurredAt || payload.relay.occurredAt
      }))
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const markSupplyInTransit = async (supplierId, lines, clientEventId, expectedBy = null) => {
    const { data, error } = await db().rpc('mark_supply_in_transit', {
      p_supplier_id: supplierId || null,
      p_lines: lines.map(l => ({
        item_id: l.itemId,
        ordered_qty_purchase: Number(l.orderedQtyPurchase || 1),
        units_per_purchase: Number(l.unitsPerPurchase || 1),
        ordered_qty_base: Number(l.orderedQtyBase || 0),
        target_location_id: l.targetLocationId || null
      })),
      p_client_event_id: clientEventId || null,
      p_expected_by: expectedBy || null
    });
    if (error) {
      if (error.message?.includes('one_open_order_per_item')) {
        return { ok: false, conflict: true, error: 'Este insumo ya está en camino.' };
      }
      return { ok: false, error: traducirError(error) };
    }
    return { ok: true, data };
  };

  const receiveSupplyOrderLine = async (params) => {
    const { data, error } = await db().rpc('receive_supply_order_line', {
      p_line_id: params.lineId,
      p_received_qty_base: Number(params.receivedQtyBase),
      p_client_event_id: params.clientEventId || null,
      p_location_id: params.locationId || null,
      p_empties_sent: Number(params.emptiesSent || 0),
      p_cost: Number(params.cost || 0),
      p_received_at: params.receivedAt || nowISO()
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const cancelSupplyOrderLine = async (lineId, reason) => {
    const { data, error } = await db().rpc('cancel_supply_order_line', {
      p_line_id: lineId,
      p_reason: reason || 'Cancelado por usuario'
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const voidSupplyMovement = async (movementId, reason) => {
    const { data, error } = await db().rpc('void_supply_movement', {
      p_movement_id: movementId,
      p_reason: reason || 'Anulado por usuario'
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const openContainer = async (itemId, locationId, openedAt) => {
    const { data, error } = await db().rpc('open_container', {
      p_item_id: itemId,
      p_location_id: locationId || null,
      p_opened_at: openedAt || nowISO()
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const closeContainer = async (containerId, closedAt, notes) => {
    const { data, error } = await db().rpc('close_container', {
      p_container_id: containerId,
      p_closed_at: closedAt || nowISO(),
      p_notes: notes || null
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const getInventoryStockView = async (filters = {}) => {
    let query = db().from('inventory_stock_view').select('*');
    if (filters.itemId) query = query.eq('item_id', filters.itemId);
    if (filters.locationId) query = query.eq('location_id', filters.locationId);
    if (filters.stockState) query = query.eq('stock_state', filters.stockState);
    const { data, error } = await query;
    if (error) throw new Error(traducirError(error));
    return data.map(r => ({
      itemId: r.item_id,
      locationId: r.location_id,
      stockState: r.stock_state,
      effectiveStock: Number(r.effective_stock || 0),
      lastMovementAt: r.last_movement_at,
      lastCountAt: r.last_count_at
    }));
  };

  const getSupplyPlanContext = async (filters = {}) => {
    const [itemsRes, stockRes, locsRes, supsRes, linesRes] = await Promise.all([
      db().from('inventory_items_view').select('*').eq('active', true),
      db().from('inventory_stock_view').select('*'),
      db().from('supply_locations').select('*').eq('status', 'active'),
      db().from('supply_suppliers').select('*').eq('status', 'active'),
      db().from('supply_order_lines').select('*').eq('status', 'in_transit')
    ]);
    if (itemsRes.error) throw new Error(traducirError(itemsRes.error));
    return {
      items: (itemsRes.data || []).map(i => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        orderUnit: i.order_unit || i.unit,
        unitsPerPurchase: Number(i.units_per_order || 1),
        minThreshold: Number(i.min_threshold || 0),
        optimalStock: Number(i.optimal_stock || 0),
        isCritical: !!i.is_critical,
        reviewEveryHours: i.review_frequency_hours != null ? Number(i.review_frequency_hours) : (i.is_critical ? 26 : 50),
        isPao: !!i.is_pao,
        paoHours: i.pao_days ? i.pao_days * 24 : null,
        oxygenFlowLpm: i.flow_rate_lpm != null ? Number(i.flow_rate_lpm) : null,
        cylinderCapacityLiters: i.cylinder_capacity_liters != null ? Number(i.cylinder_capacity_liters) : null,
        stockControl: i.stock_control || 'dosis',
        consumptionType: i.consumption_type || 'variable',
        primaryLocationId: i.primary_location_id || 'loc_hab',
        reserveLocationId: i.reserve_location_id || 'loc_arm',
        supplierId: i.default_supplier_id || null,
        leadTimeHours: 24,
        safetyMarginDays: 2,
        reviewPeriodDays: 2,
        active: true
      })),
      stockRows: (stockRes.data || []).map(s => ({
        itemId: s.item_id,
        locationId: s.location_id,
        stockState: s.stock_state,
        effectiveStock: Number(s.effective_stock || 0)
      })),
      locations: (locsRes.data || []).map(l => ({
        id: l.id,
        name: l.name,
        isUsagePoint: !!l.is_usage_point,
        isDefaultRestock: !!l.is_default_restock
      })),
      suppliers: (supsRes.data || []).map(s => ({
        id: s.id,
        name: s.name,
        leadTimeHours: Number(s.lead_time_hours || 24),
        phone: s.phone,
        whatsapp: s.whatsapp
      })),
      openOrderLines: (linesRes.data || []).map(ol => ({
        id: ol.id,
        itemId: ol.item_id,
        supplierId: ol.supplier_id,
        orderedQtyBase: Number(ol.ordered_qty_base || 0),
        status: ol.status,
        expectedBy: ol.expected_by,
        orderedAt: ol.ordered_at
      }))
    };
  };

  const getSupplyRelays = async (limit = 30) => {
    const { data, error } = await db()
      .from('supply_relays')
      .select('*, delivered:profiles!delivered_by_profile_id(full_name), received:profiles!received_by_profile_id(full_name)')
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(traducirError(error));
    return data.map(r => ({
      id: r.id,
      occurredAt: r.occurred_at,
      deliveredByProfileId: r.delivered_by_profile_id,
      deliveredByName: r.delivered?.full_name || 'Entregador',
      receivedByProfileId: r.received_by_profile_id,
      receivedByName: r.received?.full_name || 'Receptor',
      photoPath: r.photo_path || null,
      clientEventId: r.client_event_id || null,
      countsCount: r.counts_count || 0,
      omittedCount: r.omitted_count || 0,
      notes: r.notes || '',
      createdAt: r.created_at
    }));
  };

  const getSupplyOrderBatches = async (status = null) => {
    let query = db().from('supply_order_batches').select('*, supply_suppliers(name), profiles(full_name)').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error(traducirError(error));
    return data.map(b => ({
      id: b.id,
      supplierId: b.supplier_id,
      supplierName: b.supply_suppliers?.name || 'Proveedor',
      status: b.status,
      linesCount: b.lines_count || 0,
      clientEventId: b.client_event_id,
      orderedByName: b.profiles?.full_name || 'Cuidador',
      createdAt: b.created_at
    }));
  };

  const getSupplyOrderLines = async (status = null) => {
    let query = db().from('supply_order_lines').select('*, inventory_items(name, unit), supply_suppliers(name), supply_locations(name), profiles(full_name)').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error(traducirError(error));
    return data.map(l => ({
      id: l.id,
      batchId: l.batch_id,
      supplierId: l.supplier_id,
      supplierName: l.supply_suppliers?.name || 'Proveedor',
      itemId: l.item_id,
      itemName: l.inventory_items?.name || 'Insumo',
      unit: l.inventory_items?.unit || 'unidad',
      targetLocationId: l.target_location_id,
      targetLocationName: l.supply_locations?.name || 'Almacén',
      orderedQtyPurchase: Number(l.ordered_qty_purchase || 1),
      unitsPerPurchase: Number(l.units_per_purchase || 1),
      orderedQtyBase: Number(l.ordered_qty_base || 0),
      receivedQtyBase: Number(l.received_qty_base || 0),
      status: l.status,
      expectedBy: l.expected_by,
      orderedAt: l.ordered_at,
      receivedAt: l.received_at,
      orderedByName: l.profiles?.full_name || 'Cuidador',
      createdAt: l.created_at
    }));
  };

  const getSupplyOpenContainers = async (itemId = null) => {
    let query = db().from('supply_open_containers').select('*, inventory_items(name, unit), supply_locations(name)').is('closed_at', null);
    if (itemId) query = query.eq('item_id', itemId);
    const { data, error } = await query;
    if (error) throw new Error(traducirError(error));
    return data.map(c => ({
      id: c.id,
      itemId: c.item_id,
      itemName: c.inventory_items?.name,
      locationId: c.location_id,
      locationName: c.supply_locations?.name,
      openedAt: c.opened_at,
      closedAt: c.closed_at
    }));
  };

  const uploadRelayPhoto = async (clientEventId, blob) => {
    const filePath = `relays/${clientEventId}.jpg`;
    const { data, error } = await db().storage.from('relay-photos').upload(filePath, blob, {
      contentType: 'image/jpeg',
      upsert: true
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, path: filePath };
  };

  const getRelayPhotoUrl = async (clientEventId) => {
    const { data } = db().storage.from('relay-photos').getPublicUrl(`relays/${clientEventId}.jpg`);
    return data?.publicUrl || null;
  };

  // ─── 8. Tareas y Plantillas (RF-58 .. RF-66) ───────────────
  const getTasksByDate = async (dateStr) => {
    const targetDate = dateStr || todayStr();
    const { data, error } = await db()
      .from('tasks')
      .select('*, care_roles(id, name, icon, color), profiles(id, full_name), task_comments(*, profiles(full_name))')
      .eq('task_date', targetDate)
      .order('is_emergency', { ascending: false })
      .order('created_at');

    if (error) throw new Error(traducirError(error));
    return data.map(t => ({
      id: t.id,
      templateId: t.template_id,
      title: t.title,
      description: t.description || '',
      shift: t.shift, // 'morning' | 'afternoon' | 'night' | 'any'
      assignedCareRoleId: t.assigned_care_role_id,
      assignedRole: t.care_roles ? {
        id: t.care_roles.id,
        name: t.care_roles.name,
        icon: t.care_roles.icon,
        color: t.care_roles.color
      } : null,
      assignedProfileId: t.assigned_profile_id,
      assignedPersonName: t.profiles?.full_name || '',
      status: t.status, // 'pending' | 'in-progress' | 'completed'
      isEmergency: !!t.is_emergency,
      taskDate: t.task_date,
      comments: (t.task_comments || []).map(c => ({
        id: c.id,
        text: c.text,
        authorName: c.profiles?.full_name || 'Usuario',
        createdAt: c.created_at
      }))
    }));
  };

  const getTodayTasks = () => getTasksByDate(todayStr());

  const addTask = async (task) => {
    const payload = {
      title: task.title.trim(),
      description: (task.description || '').trim(),
      shift: task.shift || 'morning',
      assigned_care_role_id: task.assignedCareRoleId || null,
      assigned_profile_id: task.assignedProfileId || null,
      status: task.status || 'pending',
      is_emergency: !!task.isEmergency,
      task_date: task.taskDate || todayStr()
    };
    const { data, error } = await db().from('tasks').insert(payload).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const updateTask = async (id, updates) => {
    const payload = {};
    if (updates.title !== undefined) payload.title = updates.title.trim();
    if (updates.description !== undefined) payload.description = updates.description.trim();
    if (updates.shift !== undefined) payload.shift = updates.shift;
    if (updates.assignedCareRoleId !== undefined) payload.assigned_care_role_id = updates.assignedCareRoleId;
    if (updates.assignedProfileId !== undefined) payload.assigned_profile_id = updates.assignedProfileId;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.isEmergency !== undefined) payload.is_emergency = !!updates.isEmergency;
    if (updates.taskDate !== undefined) payload.task_date = updates.taskDate;

    const { data, error } = await db().from('tasks').update(payload).eq('id', id).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const deleteTask = async (id) => {
    const { error } = await db().from('tasks').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const cycleTaskStatus = async (id, currentStatus) => {
    const flow = { 'pending': 'in-progress', 'in-progress': 'completed', 'completed': 'pending' };
    const nextStatus = flow[currentStatus] || 'pending';
    return await updateTask(id, { status: nextStatus });
  };

  const addTaskComment = async (taskId, text) => {
    const { data, error } = await db()
      .from('task_comments')
      .insert({
        task_id: taskId,
        author_id: Auth.getUser()?.id || null,
        text: text.trim()
      })
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const getTaskTemplates = async () => {
    const { data, error } = await db()
      .from('task_templates')
      .select('*, care_roles(*), profiles(*)')
      .order('title');

    if (error) throw new Error(traducirError(error));
    return data.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description || '',
      shift: t.shift,
      assignedCareRoleId: t.assigned_care_role_id,
      assignedProfileId: t.assigned_profile_id,
      isEmergency: !!t.is_emergency,
      recurringDays: t.recurring_days || [],
      active: t.active
    }));
  };

  const addTaskTemplate = async (tmpl) => {
    const payload = {
      title: tmpl.title.trim(),
      description: (tmpl.description || '').trim(),
      shift: tmpl.shift || 'morning',
      assigned_care_role_id: tmpl.assignedCareRoleId || null,
      assigned_profile_id: tmpl.assignedProfileId || null,
      is_emergency: !!tmpl.isEmergency,
      recurring_days: tmpl.recurringDays || [],
      active: tmpl.active !== false
    };
    const { data, error } = await db().from('task_templates').insert(payload).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const updateTaskTemplate = async (id, updates) => {
    const payload = {};
    if (updates.title !== undefined) payload.title = updates.title.trim();
    if (updates.description !== undefined) payload.description = updates.description.trim();
    if (updates.shift !== undefined) payload.shift = updates.shift;
    if (updates.assignedCareRoleId !== undefined) payload.assigned_care_role_id = updates.assignedCareRoleId;
    if (updates.assignedProfileId !== undefined) payload.assigned_profile_id = updates.assignedProfileId;
    if (updates.isEmergency !== undefined) payload.is_emergency = !!updates.isEmergency;
    if (updates.recurringDays !== undefined) payload.recurring_days = updates.recurringDays;
    if (updates.active !== undefined) payload.active = !!updates.active;

    const { data, error } = await db().from('task_templates').update(payload).eq('id', id).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const deleteTaskTemplate = async (id) => {
    const { error } = await db().from('task_templates').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  // ─── 9. Agenda Médica (RF-67 .. RF-71) ────────────────────
  const getAppointments = async () => {
    const { data, error } = await db().from('appointments').select('*').order('appt_date').order('appt_time');
    if (error) throw new Error(traducirError(error));
    return data.map(a => ({
      id: a.id,
      title: a.title,
      specialty: a.specialty || '',
      doctor: a.doctor || '',
      apptDate: a.appt_date,
      apptTime: a.appt_time ? a.appt_time.slice(0, 5) : '',
      modality: a.modality || 'presencial',
      location: a.location || '',
      preparation: a.preparation || '',
      status: a.status, // 'upcoming' | 'completed' | 'cancelled'
      notes: a.notes || '',
      resultNotes: a.result_notes || ''
    }));
  };

  const getUpcomingAppointments = async () => {
    const today = todayStr();
    const all = await getAppointments();
    return all.filter(a => a.status === 'upcoming' && a.apptDate >= today);
  };

  const getPastAppointments = async () => {
    const today = todayStr();
    const all = await getAppointments();
    return all.filter(a => a.status === 'completed' || a.apptDate < today);
  };

  const addAppointment = async (appt) => {
    const payload = {
      title: appt.title.trim(),
      specialty: (appt.specialty || '').trim(),
      doctor: (appt.doctor || '').trim(),
      appt_date: appt.apptDate,
      appt_time: appt.apptTime || null,
      modality: appt.modality || 'presencial',
      location: (appt.location || '').trim(),
      preparation: (appt.preparation || '').trim(),
      status: appt.status || 'upcoming',
      notes: (appt.notes || '').trim()
    };
    const { data, error } = await db().from('appointments').insert(payload).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const updateAppointment = async (id, updates) => {
    const payload = {};
    if (updates.title !== undefined) payload.title = updates.title.trim();
    if (updates.specialty !== undefined) payload.specialty = updates.specialty.trim();
    if (updates.doctor !== undefined) payload.doctor = updates.doctor.trim();
    if (updates.apptDate !== undefined) payload.appt_date = updates.apptDate;
    if (updates.apptTime !== undefined) payload.appt_time = updates.apptTime || null;
    if (updates.modality !== undefined) payload.modality = updates.modality;
    if (updates.location !== undefined) payload.location = updates.location.trim();
    if (updates.preparation !== undefined) payload.preparation = updates.preparation.trim();
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.notes !== undefined) payload.notes = updates.notes.trim();
    if (updates.resultNotes !== undefined) payload.result_notes = updates.resultNotes.trim();

    const { data, error } = await db().from('appointments').update(payload).eq('id', id).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const deleteAppointment = async (id) => {
    const { error } = await db().from('appointments').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  // ─── 10. Alimentación, Recetas y Plan Semanal (RF-72..77) ──
  const getRecipes = async () => {
    const { data, error } = await db()
      .from('recipes')
      .select('*, recipe_ingredients(*)')
      .order('name');

    if (error) throw new Error(traducirError(error));
    return data.map(r => ({
      id: r.id,
      name: r.name,
      mealTypes: r.meal_types || ['lunch'],
      instructions: r.instructions || '',
      notes: r.notes || '',
      ingredients: (r.recipe_ingredients || []).map(i => ({
        id: i.id,
        name: i.name,
        amount: i.amount || '',
        unit: i.unit || ''
      }))
    }));
  };

  const addRecipe = async ({ name, mealTypes, instructions = '', notes = '', ingredients = [] }) => {
    const { data: recipe, error: err1 } = await db()
      .from('recipes')
      .insert({
        name: name.trim(),
        meal_types: mealTypes || ['lunch'],
        instructions: instructions.trim(),
        notes: notes.trim()
      })
      .select()
      .single();

    if (err1) return { ok: false, error: traducirError(err1) };

    if (ingredients.length > 0) {
      const rows = ingredients.map(i => ({
        recipe_id: recipe.id,
        name: i.name.trim(),
        amount: String(i.amount || ''),
        unit: String(i.unit || '')
      }));
      const { error: err2 } = await db().from('recipe_ingredients').insert(rows);
      if (err2) return { ok: false, error: traducirError(err2) };
    }

    return { ok: true, data: recipe };
  };

  const updateRecipe = async (id, { name, mealTypes, instructions, notes, ingredients }) => {
    const payload = {};
    if (name !== undefined) payload.name = name.trim();
    if (mealTypes !== undefined) payload.meal_types = mealTypes;
    if (instructions !== undefined) payload.instructions = instructions.trim();
    if (notes !== undefined) payload.notes = notes.trim();

    const { error: err1 } = await db().from('recipes').update(payload).eq('id', id);
    if (err1) return { ok: false, error: traducirError(err1) };

    if (ingredients !== undefined) {
      await db().from('recipe_ingredients').delete().eq('recipe_id', id);
      if (ingredients.length > 0) {
        const rows = ingredients.map(i => ({
          recipe_id: id,
          name: i.name.trim(),
          amount: String(i.amount || ''),
          unit: String(i.unit || '')
        }));
        await db().from('recipe_ingredients').insert(rows);
      }
    }

    return { ok: true };
  };

  const deleteRecipe = async (id) => {
    const { error } = await db().from('recipes').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const getWeeklyPlan = async () => {
    const { data, error } = await db()
      .from('weekly_plan')
      .select('*, recipes(*, recipe_ingredients(*))');

    if (error) throw new Error(traducirError(error));
    const slotMap = new Map();
    (data || []).forEach(row => {
      if (!row) return;
      const d = Number(row.day_index);
      const m = row.meal_type;
      const rid = row.recipe_id;
      if (isNaN(d) || !m) return;
      const key = `${d}_${m}`;
      if (!slotMap.has(key)) {
        slotMap.set(key, {
          dayOfWeek: d,
          dayIndex: d,
          mealType: m,
          recipeIds: []
        });
      }
      if (rid && !slotMap.get(key).recipeIds.includes(rid)) {
        slotMap.get(key).recipeIds.push(rid);
      }
    });

    return Array.from(slotMap.values());
  };

  const setMealInPlan = async (dayIndex, mealType, recipeIds) => {
    await db()
      .from('weekly_plan')
      .delete()
      .eq('day_index', dayIndex)
      .eq('meal_type', mealType);

    if (recipeIds && recipeIds.length > 0) {
      const rows = recipeIds.map(rid => ({
        day_index: dayIndex,
        meal_type: mealType,
        recipe_id: rid
      }));
      const { error } = await db().from('weekly_plan').insert(rows);
      if (error) return { ok: false, error: traducirError(error) };
    }
    return { ok: true };
  };

  const addRecipeToSlot = async (dayIndex, mealType, recipeId) => {
    const { error } = await db().from('weekly_plan').insert({
      day_index: dayIndex,
      meal_type: mealType,
      recipe_id: recipeId
    });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const removeRecipeFromSlot = async (dayIndex, mealType, recipeId) => {
    const { error } = await db()
      .from('weekly_plan')
      .delete()
      .eq('day_index', dayIndex)
      .eq('meal_type', mealType)
      .eq('recipe_id', recipeId);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  // Complementos
  const getComplementos = async () => {
    const { data, error } = await db()
      .from('complementos')
      .select('*, complemento_ingredients(*)')
      .order('name');

    if (error) throw new Error(traducirError(error));
    return data.map(c => ({
      id: c.id,
      name: c.name,
      category: c.category || 'otros',
      amount: c.amount || '',
      unit: c.unit || '',
      notes: c.notes || '',
      ingredients: (c.complemento_ingredients || []).map(ci => ({
        id: ci.id,
        name: ci.name,
        amount: ci.amount || '',
        unit: ci.unit || ''
      }))
    }));
  };

  const addComplemento = async ({ name, category = 'otros', amount = '', unit = '', notes = '', ingredients = [] }) => {
    const { data, error } = await db()
      .from('complementos')
      .insert({
        name: name.trim(),
        category,
        amount: String(amount),
        unit: String(unit),
        notes: notes.trim()
      })
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };

    if (ingredients.length > 0) {
      const rows = ingredients.map(i => ({
        complemento_id: data.id,
        name: i.name.trim(),
        amount: String(i.amount || ''),
        unit: String(i.unit || '')
      }));
      await db().from('complemento_ingredients').insert(rows);
    }

    return { ok: true, data };
  };

  const updateComplemento = async (id, updates) => {
    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.category !== undefined) payload.category = updates.category;
    if (updates.amount !== undefined) payload.amount = String(updates.amount);
    if (updates.unit !== undefined) payload.unit = String(updates.unit);
    if (updates.notes !== undefined) payload.notes = updates.notes.trim();

    const { error } = await db().from('complementos').update(payload).eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };

    if (updates.ingredients !== undefined) {
      await db().from('complemento_ingredients').delete().eq('complemento_id', id);
      if (updates.ingredients.length > 0) {
        const rows = updates.ingredients.map(i => ({
          complemento_id: id,
          name: i.name.trim(),
          amount: String(i.amount || ''),
          unit: String(i.unit || '')
        }));
        await db().from('complemento_ingredients').insert(rows);
      }
    }

    return { ok: true };
  };

  const deleteComplemento = async (id) => {
    const { error } = await db().from('complementos').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  // ─── 11. Lista de Compras (shopping_list) ─────────────────
  const getShoppingList = async () => {
    const { data, error } = await db()
      .from('shopping_list')
      .select('*')
      .order('checked', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) throw new Error(traducirError(error));
    return data.map(s => ({
      id: s.id,
      name: s.name,
      amount: s.amount || '',
      unit: s.unit || '',
      source: s.source || 'manual',
      checked: !!s.checked,
      createdAt: s.created_at
    }));
  };

  const addShoppingItem = async ({ name, amount = '', unit = '', source = 'manual' }) => {
    const { data, error } = await db()
      .from('shopping_list')
      .insert({
        name: name.trim(),
        amount: String(amount),
        unit: String(unit),
        source,
        checked: false
      })
      .select()
      .single();

    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const updateShoppingItem = async (id, updates) => {
    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.amount !== undefined) payload.amount = String(updates.amount);
    if (updates.unit !== undefined) payload.unit = String(updates.unit);
    if (updates.checked !== undefined) payload.checked = !!updates.checked;

    const { data, error } = await db().from('shopping_list').update(payload).eq('id', id).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const toggleShoppingItem = async (id, currentChecked) => {
    return await updateShoppingItem(id, { checked: !currentChecked });
  };

  const deleteShoppingItem = async (id) => {
    const { error } = await db().from('shopping_list').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const clearCheckedShoppingItems = async () => {
    const { error } = await db().from('shopping_list').delete().eq('checked', true);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const clearShoppingList = async () => {
    const { error } = await db().from('shopping_list').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  const addBulkShoppingItems = async (items) => {
    if (!items || !items.length) return { ok: true, count: 0 };
    const rows = items.map(i => ({
      name: i.name.trim(),
      amount: String(i.amount || ''),
      unit: String(i.unit || ''),
      source: i.source || 'plan',
      checked: false
    }));
    const { error } = await db().from('shopping_list').insert(rows);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, count: rows.length };
  };

  // ─── 12. Gastos (expenses) ────────────────────────────────
  const getExpenses = async ({ page = 0, pageSize = 50 } = {}) => {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, count, error } = await db()
      .from('expenses')
      .select('*, profiles(full_name)', { count: 'exact' })
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw new Error(traducirError(error));
    return {
      expenses: data.map(e => ({
        id: e.id,
        expenseDate: e.expense_date,
        amount: Number(e.amount),
        category: e.category,
        description: e.description || '',
        linkedRestockId: e.linked_restock_id,
        managedByName: e.profiles?.full_name || 'Sistema',
        createdAt: e.created_at
      })),
      totalCount: count || 0
    };
  };

  const getExpensesThisMonth = async () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const { data, error } = await db()
      .from('expenses')
      .select('amount')
      .gte('expense_date', firstDay);

    if (error) throw new Error(traducirError(error));
    const total = data.reduce((sum, e) => sum + Number(e.amount), 0);
    return { total, count: data.length };
  };

  const addExpense = async ({ description, amount, date, category = 'Otros', linkedRestockId = null }) => {
    const payload = {
      description: description.trim(),
      amount: Number(amount),
      expense_date: date || todayStr(),
      category: category || 'Otros',
      linked_restock_id: linkedRestockId,
      managed_by: Auth.getUser()?.id || null
    };
    const { data, error } = await db().from('expenses').insert(payload).select().single();
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, data };
  };

  const deleteExpense = async (id) => {
    const { error } = await db().from('expenses').delete().eq('id', id);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  // ─── 13. Auditoría (audit_log, solo admin) ────────────────
  const getAuditLog = async ({ tableName, actorId, fromDate, toDate, page = 0, pageSize = 50 } = {}) => {
    Auth.requireAdmin();
    const from = page * pageSize;
    const to = from + pageSize - 1;

    let query = db()
      .from('audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (tableName) query = query.eq('table_name', tableName);
    if (actorId) query = query.eq('actor_id', actorId);
    if (fromDate) query = query.gte('created_at', fromDate);
    if (toDate) query = query.lte('created_at', toDate + 'T23:59:59.999Z');

    const { data, count, error } = await query;
    if (error) throw new Error(traducirError(error));

    return {
      entries: data.map(entry => ({
        id: entry.id,
        tableName: entry.table_name,
        recordId: entry.record_id,
        action: entry.action,
        actorId: entry.actor_id,
        actorName: entry.actor_name || 'Sistema',
        changedFields: entry.changed_fields || [],
        oldValues: entry.old_values || {},
        newValues: entry.new_values || {},
        createdAt: entry.created_at
      })),
      totalCount: count || 0
    };
  };

  const purgeOldAudit = async (months = 24) => {
    Auth.requireAdmin();
    const { data, error } = await db().rpc('purge_old_audit', { p_months: months });
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true, deletedCount: data };
  };

  // ─── 14. Alertas Derivadas en Vivo (RF-84 .. RF-87) ───────
  const getActiveAlerts = async () => {
    const alerts = [];
    const today = todayStr();
    const nowTime = new Date().toTimeString().slice(0, 5); // "HH:MM"

    try {
      // 1. Dosis atrasadas de hoy
      const [meds, admins] = await Promise.all([
        getMedications(),
        getTodayAdministrations()
      ]);

      meds.filter(m => m.status === 'active').forEach(m => {
        m.schedules.filter(s => s.active).forEach(s => {
          const administered = admins.some(a => a.scheduleId === s.id && a.scheduledDate === today);
          if (!administered && s.timeOfDay < nowTime) {
            alerts.push({
              id: `dose_late_${s.id}`,
              type: 'critical',
              title: 'Dosis atrasada',
              message: `${m.name} (${s.dose} ${m.unit}) tocaba a las ${s.timeOfDay}`,
              module: 'administration'
            });
          }
        });
      });

      // 2. Medicamentos con poco stock (<= 3 días)
      meds.filter(m => m.status === 'active').forEach(m => {
        if (m.needsRestock || (m.daysRemaining !== null && m.daysRemaining <= 3)) {
          alerts.push({
            id: `med_stock_${m.id}`,
            type: m.currentStock === 0 ? 'critical' : 'alert',
            title: 'Medicamento por agotarse',
            message: `${m.name}: quedan ${m.currentStock} ${m.unit} (${m.daysRemaining != null ? m.daysRemaining + ' días' : 'reposición urgente'})`,
            module: 'medications'
          });
        }
      });

      // 3. Ítems de inventario bajo umbral mínimo
      const inventory = await getInventory();
      inventory.forEach(item => {
        if (item.medicationId) return; // Medicamentos ya procesados arriba
        if (item.isLow) {
          alerts.push({
            id: `inv_low_${item.id}`,
            type: item.currentStock === 0 ? 'critical' : 'alert',
            title: item.isCritical ? 'Insumo CRÍTICO agotado/bajo' : 'Insumo bajo mínimo',
            message: `${item.name}: ${item.currentStock} ${item.unit} (mínimo: ${item.minThreshold})`,
            module: 'inventory'
          });
        }
      });

      // 4. Citas médicas próximas (≤ 2 días)
      const appointments = await getUpcomingAppointments();
      const in2Days = new Date();
      in2Days.setDate(in2Days.getDate() + 2);
      const limitDate = in2Days.toISOString().split('T')[0];

      appointments.forEach(a => {
        if (a.apptDate <= limitDate) {
          alerts.push({
            id: `appt_soon_${a.id}`,
            type: a.apptDate === today ? 'critical' : 'alert',
            title: a.apptDate === today ? 'Cita médica HOY' : 'Cita médica próxima',
            message: `${a.title} con ${a.doctor || a.specialty || 'médico'} (${formatDate(a.apptDate)} ${a.apptTime || ''})`,
            module: 'agenda'
          });
        }
      });
    } catch (e) {
      console.warn('Error al derivar alertas activas:', e);
    }

    return alerts;
  };

  // ─── 15. Exportación JSON completa (RF-98) ────────────────
  const exportAllData = async () => {
    Auth.requireAdmin();
    const [
      settings, patientStatus, careRoles, profiles, shifts,
      shiftNotes, medications, restocks, administrations,
      inventory, movements, tasks, taskTemplates, appointments,
      recipes, weeklyPlan, complementos, shopping, expenses,
      supplyLocations, supplySuppliers, supplyRelays, supplyOrderBatches,
      supplyOrderLines, supplyOpenContainers
    ] = await Promise.all([
      getSettings(),
      getPatientStatus(),
      getCareRoles(),
      getProfiles(),
      getShiftHistory(200),
      getShiftNotes(),
      getMedications(),
      getRestockHistory(),
      getAdministrationHistory({ limit: 500 }),
      getInventory(),
      getInventoryMovements(null, 500),
      db().from('tasks').select('*'),
      getTaskTemplates(),
      getAppointments(),
      getRecipes(),
      getWeeklyPlan(),
      getComplementos(),
      getShoppingList(),
      getExpenses({ pageSize: 1000 }),
      getSupplyLocations(true),
      getSupplySuppliers(true),
      getSupplyRelays(500),
      getSupplyOrderBatches(),
      getSupplyOrderLines(),
      getSupplyOpenContainers()
    ]);

    const backup = {
      _meta: {
        exportedAt: nowISO(),
        app: 'CuidApp v2.0',
        version: '2.0.0'
      },
      settings,
      patientStatus,
      careRoles,
      profiles,
      shifts,
      shiftNotes,
      medications,
      restocks,
      administrations,
      inventory,
      movements,
      supplyLocations,
      supplySuppliers,
      supplyRelays,
      supplyOrderBatches,
      supplyOrderLines,
      supplyOpenContainers,
      tasks: tasks.data || [],
      taskTemplates,
      appointments,
      recipes,
      weeklyPlan,
      complementos,
      shopping,
      expenses: expenses.expenses
    };

    return JSON.stringify(backup, null, 2);
  };

  // ─── Métodos adicionales requeridos por la interfaz ────────
  const getMedicationSchedules = async (medicationId) => {
    if (isLocal()) return wrap(await LocalAdapter.getMedicationSchedules(medicationId));
    let query = db().from('medication_schedules').select('*').order('time_of_day');
    if (medicationId) query = query.eq('medication_id', medicationId);
    const { data, error } = await query;
    if (error) throw new Error(traducirError(error));
    return wrap(data.map(s => ({
      id: s.id,
      medicationId: s.medication_id,
      timeOfDay: (s.time_of_day || '08:00').slice(0, 5),
      scheduledTime: (s.time_of_day || '08:00').slice(0, 5),
      dose: Number(s.dose),
      active: s.active
    })));
  };

  const getAdministrations = async (filter = {}) => {
    if (isLocal()) return wrap(await LocalAdapter.getAdministrations(filter));
    let query = db()
      .from('medication_administrations')
      .select('*, profiles(full_name)')
      .order('scheduled_date', { ascending: false })
      .order('scheduled_time', { ascending: false });
    if (filter.date) query = query.eq('scheduled_date', filter.date);
    if (filter.medicationId) query = query.eq('medication_id', filter.medicationId);
    const { data, error } = await query;
    if (error) throw new Error(traducirError(error));
    return wrap(data.map(a => ({
      id: a.id,
      medicationId: a.medication_id,
      scheduleId: a.schedule_id,
      scheduledDate: a.scheduled_date,
      scheduledTime: a.scheduled_time ? a.scheduled_time.slice(0, 5) : null,
      administeredAt: a.administered_at,
      administeredByName: a.profiles?.full_name || 'Cuidador',
      status: a.status,
      dose: Number(a.dose),
      notes: a.notes || ''
    })));
  };

  const getTaskComments = async (taskId) => {
    if (isLocal()) return wrap(await LocalAdapter.getTaskComments(taskId));
    const { data, error } = await db()
      .from('task_comments')
      .select('*, profiles(full_name)')
      .eq('task_id', taskId)
      .order('created_at');
    if (error) throw new Error(traducirError(error));
    return wrap(data.map(c => ({
      id: c.id,
      taskId: c.task_id,
      text: c.text,
      authorName: c.profiles?.full_name || 'Usuario',
      createdAt: c.created_at
    })));
  };

  const getExpenseTotal = (expenses) => {
    return (expenses || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  };

  const markShiftNotesRead = async (ids) => {
    if (isLocal()) return wrap(await LocalAdapter.markShiftNoteRead(ids));
    const noteIds = Array.isArray(ids) ? ids : [ids];
    const { error } = await db().from('shift_notes').update({ read_at: nowISO() }).in('id', noteIds);
    if (error) return { ok: false, error: traducirError(error) };
    return { ok: true };
  };

  // ─── Superficie pública del módulo Api con Soporte Local Transparente ─────
  const apiInstance = {
    // Utilidades
    escapeHtml,
    traducirError,
    bootstrap,
    nowISO,
    todayStr,
    formatDate,
    formatDateShort,
    formatDateTime,
    timeAgo,
    shiftDuration,
    currency,

    // Configuración y Paciente
    getSettings,
    saveSettings,
    getPatientStatus,
    savePatientStatus,
    updatePatientStatus: savePatientStatus,

    // Roles y Personal
    getCareRoles,
    addCareRole,
    updateCareRole,
    deleteCareRole,
    getProfiles,
    updateProfile,

    // Turnos
    getCurrentShift,
    takeShift,
    endShift,
    getShiftHistory,
    getShiftNotes,
    addShiftNote,
    markShiftNoteRead,
    markAllShiftNotesRead,
    markShiftNotesRead,

    // Medicamentos y Dosis
    getMedications,
    addMedication,
    updateMedication,
    deleteMedication,
    addMedicationSchedule,
    updateMedicationSchedule,
    deleteMedicationSchedule,
    getMedicationSchedules,
    recordRestock,
    getRestockHistory,
    getMedicationRestocks: getRestockHistory,
    getTodayAdministrations,
    getAdministrations,
    recordAdministration,
    undoAdministration,
    getAdministrationHistory,

    // Inventario
    getInventory,
    addInventoryItem,
    updateInventoryItem,
    deleteInventoryItem,
    adjustInventoryStock,
    adjustInventory: adjustInventoryStock,
    getInventoryMovements,
    getInventoryCategories,
    addInventoryCategory,

    // Gestión Insumos
    getSupplyLocations,
    addSupplyLocation,
    updateSupplyLocation,
    archiveSupplyLocation,
    restoreSupplyLocation,
    setSpecialLocation,
    deleteSupplyLocation,
    getSupplySuppliers,
    addSupplySupplier,
    updateSupplySupplier,
    archiveSupplySupplier,
    restoreSupplySupplier,
    deleteSupplySupplier,
    recordSupplyMovements,
    saveSupplyRelayFull,
    markSupplyInTransit,
    receiveSupplyOrderLine,
    cancelSupplyOrderLine,
    voidSupplyMovement,
    openContainer,
    closeContainer,
    getInventoryStockView,
    getSupplyPlanContext,
    getSupplyRelays,
    getSupplyOrderBatches,
    getSupplyOrderLines,
    getSupplyOpenContainers,
    uploadRelayPhoto,
    getRelayPhotoUrl,

    // Tareas
    getTasksByDate,
    getTasksForDate: getTasksByDate,
    getTodayTasks,
    addTask,
    updateTask,
    deleteTask,
    cycleTaskStatus,
    addTaskComment,
    getTaskComments,
    getTaskTemplates,
    addTaskTemplate,
    updateTaskTemplate,
    deleteTaskTemplate,

    // Agenda
    getAppointments,
    getUpcomingAppointments,
    getPastAppointments,
    addAppointment,
    updateAppointment,
    deleteAppointment,

    // Alimentación
    getRecipes,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    getWeeklyPlan,
    setMealInPlan,
    setWeeklySlot: setMealInPlan,
    addRecipeToSlot,
    removeRecipeFromSlot,
    getComplementos,
    addComplemento,
    updateComplemento,
    deleteComplemento,
    getComplementCategories: LocalAdapter.getComplementCategories,
    addComplementCategory: LocalAdapter.addComplementCategory,
    updateComplementCategory: LocalAdapter.updateComplementCategory,
    deleteComplementCategory: LocalAdapter.deleteComplementCategory,
    getAvailableComplementos: LocalAdapter.getAvailableComplementos,
    setAvailableComplementos: LocalAdapter.setAvailableComplementos,
    getDailyMenu: LocalAdapter.getDailyMenu,

    // Compras
    getShoppingList,
    getShoppingItems: getShoppingList,
    addShoppingItem,
    updateShoppingItem,
    toggleShoppingItem,
    deleteShoppingItem,
    deleteShoppingItemsBatch: LocalAdapter.deleteShoppingItemsBatch,
    clearCheckedShoppingItems,
    archiveCompletedShopping: clearCheckedShoppingItems,
    clearShoppingList,
    addBulkShoppingItems,
    addShoppingItemsBatch: addBulkShoppingItems,

    // Finanzas y Auditoría
    getExpenses,
    getExpensesThisMonth,
    getExpenseTotal,
    addExpense,
    deleteExpense,
    getAuditLog,
    purgeOldAudit,

    // Alertas y Respaldo
    getActiveAlerts,
    exportAllData
  };

  return new Proxy(apiInstance, {
    get(target, prop, receiver) {
      if (isLocal() && LocalAdapter[prop]) {
        return async (...args) => {
          const res = await LocalAdapter[prop](...args);
          return wrap(res);
        };
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val !== 'function') return val;
      return (...args) => {
        const res = val.apply(target, args);
        // wrap sólo si el retorno es una Promise: hay helpers síncronos
        // (escapeHtml, todayStr, timeAgo, formatDate, formatDateShort,
        // formatDateTime, shiftDuration, currency) que se usan dentro de
        // template strings y no pueden volverse async sin romper las vistas.
        if (res && typeof res.then === 'function') return res.then(wrap);
        return res;
      };
    }
  });
})();
