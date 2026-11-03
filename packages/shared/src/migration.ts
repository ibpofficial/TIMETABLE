import { SchedulerInputState, Subject, Faculty, Room } from './types';
import { BUILTIN_CONSTRAINTS } from './constraints';

export function migrateConfig(raw: any): SchedulerInputState {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid configuration object');
  }

  const rawConfig = { ...raw };

  // Detect and migrate v1 -> v2
  const currentVersion = rawConfig.version ?? 1;

  const theoryList: Room[] = (rawConfig.rooms?.theoryList || []).map((r: any) => ({
    id: String(r.id || `room_${Math.random().toString(36).substring(2, 7)}`),
    name: String(r.name || 'Room'),
    type: 'theory',
    capacity: Number(r.capacity) || 60,
    building: r.building || undefined,
    floor: r.floor ? Number(r.floor) : undefined,
    roomNumber: r.roomNumber || undefined,
    equipment: Array.isArray(r.equipment) ? r.equipment : [],
    departmentId: r.departmentId || null,
    isShared: r.isShared ?? true,
    features: Array.isArray(r.features) ? r.features : [],
    unavail: Array.isArray(r.unavail) ? r.unavail : [],
  }));

  const labList: Room[] = (rawConfig.rooms?.labList || []).map((r: any) => ({
    id: String(r.id || `lab_${Math.random().toString(36).substring(2, 7)}`),
    name: String(r.name || 'Lab'),
    type: 'practical',
    capacity: Number(r.capacity) || 30,
    building: r.building || undefined,
    floor: r.floor ? Number(r.floor) : undefined,
    roomNumber: r.roomNumber || undefined,
    equipment: Array.isArray(r.equipment) ? r.equipment : [],
    departmentId: r.departmentId || null,
    isShared: r.isShared ?? true,
    features: Array.isArray(r.features) ? r.features : [],
    unavail: Array.isArray(r.unavail) ? r.unavail : [],
  }));

  const faculties: Faculty[] = (rawConfig.faculties || []).map((f: any) => ({
    id: String(f.id || `fac_${Math.random().toString(36).substring(2, 7)}`),
    name: String(f.name || 'Faculty'),
    leaves: Number(f.leaves) || 0,
    maxWeeklySlots: Number(f.maxWeeklySlots) || 20,
    minWeeklySlots: f.minWeeklySlots ? Number(f.minWeeklySlots) : undefined,
    maxDailySlots: f.maxDailySlots ? Number(f.maxDailySlots) : undefined,
    maxConsecutiveSlots: f.maxConsecutiveSlots ? Number(f.maxConsecutiveSlots) : 4,
    minGapBetweenSessions: f.minGapBetweenSessions ? Number(f.minGapBetweenSessions) : 0,
    unavail: Array.isArray(f.unavail) ? f.unavail : [],
    departmentId: f.departmentId || null,
    designation: f.designation || undefined,
    isPartTime: Boolean(f.isPartTime),
    preferredDaysOff: Array.isArray(f.preferredDaysOff) ? f.preferredDaysOff : [],
    slotPreferences: Array.isArray(f.slotPreferences) ? f.slotPreferences : [],
  }));

  const subjects: Subject[] = (rawConfig.subjects || []).map((s: any) => {
    const facultyId = s.facultyId ? String(s.facultyId) : null;
    const facultyIds = Array.isArray(s.facultyIds) && s.facultyIds.length > 0
      ? s.facultyIds.map(String)
      : (facultyId ? [facultyId] : []);

    return {
      id: String(s.id || `subj_${Math.random().toString(36).substring(2, 7)}`),
      name: String(s.name || 'Subject'),
      code: s.code || undefined,
      type: s.type === 'practical' ? 'practical' : 'theory',
      classesPerWeek: Math.max(1, Number(s.classesPerWeek) || 1),
      sessionLength: Math.max(1, Number(s.sessionLength) || 1),
      facultyId,
      facultyIds,
      fixed: Boolean(s.fixed),
      fixedDay: s.fixedDay || undefined,
      fixedStart: s.fixedStart || undefined,
      fixedLength: s.fixedLength ? Number(s.fixedLength) : undefined,
      unavail: Array.isArray(s.unavail) ? s.unavail : [],
      batches: Array.isArray(s.batches) && s.batches.length > 0 ? s.batches.map(String) : [],
      studentGroups: Array.isArray(s.studentGroups) ? s.studentGroups : undefined,
      capacityRequirement: s.capacityRequirement ? Number(s.capacityRequirement) : undefined,
      preferredRoomTypes: Array.isArray(s.preferredRoomTypes) ? s.preferredRoomTypes : undefined,
      requiredEquipment: Array.isArray(s.requiredEquipment) ? s.requiredEquipment : undefined,
      departmentId: s.departmentId || null,
      programId: s.programId || null,
      splitPattern: s.splitPattern || undefined,
      frequency: s.frequency || 'weekly',
      isHeavySubject: Boolean(s.isHeavySubject),
    };
  });

  const constraints = Array.isArray(rawConfig.constraints) && rawConfig.constraints.length > 0
    ? rawConfig.constraints
    : BUILTIN_CONSTRAINTS;

  const migrated: SchedulerInputState = {
    version: 2,
    institutionType: rawConfig.institutionType || 'college',
    institutionName: rawConfig.institutionName || 'Default Institute',
    days: Array.isArray(rawConfig.days) ? rawConfig.days : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    startTime: rawConfig.startTime || '09:00',
    endTime: rawConfig.endTime || '17:00',
    slotLength: Number(rawConfig.slotLength) || 60,
    maxClassesPerDay: Number(rawConfig.maxClassesPerDay) || 6,
    rooms: {
      theoryList,
      labList,
    },
    batches: Array.isArray(rawConfig.batches) ? rawConfig.batches : [],
    batchSizes: rawConfig.batchSizes || {},
    studentGroups: Array.isArray(rawConfig.studentGroups) ? rawConfig.studentGroups : [],
    faculties,
    subjects,
    breaks: Array.isArray(rawConfig.breaks) ? rawConfig.breaks : [],
    events: Array.isArray(rawConfig.events) ? rawConfig.events : [],
    options: {
      engine: rawConfig.options?.engine || 'auto',
      maxAttempts: Number(rawConfig.options?.maxAttempts) || 4000,
      balanceAcrossWeek: rawConfig.options?.balanceAcrossWeek ?? true,
      timeLimitSeconds: Number(rawConfig.options?.timeLimitSeconds) || 30,
      randomSeed: rawConfig.options?.randomSeed ? Number(rawConfig.options?.randomSeed) : undefined,
      numWorkers: Number(rawConfig.options?.numWorkers) || 4,
      customWeights: rawConfig.options?.customWeights || {},
    },
    departments: Array.isArray(rawConfig.departments) ? rawConfig.departments : [],
    programs: Array.isArray(rawConfig.programs) ? rawConfig.programs : [],
    batchDetails: rawConfig.batchDetails || {},
    shifts: Array.isArray(rawConfig.shifts) ? rawConfig.shifts : [],
    constraints,
    travelMatrix: rawConfig.travelMatrix || undefined,
  };

  return migrated;
}
