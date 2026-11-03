import { z } from 'zod';

export const zUnavailabilityWindow = z.object({
  day: z.string().min(1),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format'),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format'),
  reason: z.string().optional(),
});

export const zInstitutionType = z.enum(['school', 'college', 'university', 'coaching', 'exam']);

export const zDepartment = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  code: z.string().min(1),
  building: z.string().optional(),
});

export const zProgram = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  departmentId: z.string().min(1),
  durationYears: z.number().int().positive().optional(),
});

export const zStudentGroup = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  batchId: z.string().min(1),
  size: z.number().int().nonnegative(),
});

export const zRoom = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  capacity: z.number().int().positive(),
  building: z.string().optional(),
  floor: z.number().int().optional(),
  roomNumber: z.string().optional(),
  equipment: z.array(z.string()).optional(),
  departmentId: z.string().nullable().optional(),
  isShared: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  unavail: z.array(zUnavailabilityWindow).optional(),
});

export const zSlotPreference = z.object({
  day: z.string().min(1),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weight: z.number().int().min(-100).max(100),
});

export const zFaculty = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  leaves: z.number().int().nonnegative().default(0),
  maxWeeklySlots: z.number().int().positive().default(20),
  minWeeklySlots: z.number().int().nonnegative().optional(),
  maxDailySlots: z.number().int().positive().optional(),
  maxConsecutiveSlots: z.number().int().positive().optional(),
  minGapBetweenSessions: z.number().int().nonnegative().optional(),
  unavail: z.array(zUnavailabilityWindow).default([]),
  departmentId: z.string().nullable().optional(),
  designation: z.string().optional(),
  isPartTime: z.boolean().optional(),
  preferredDaysOff: z.array(z.string()).optional(),
  slotPreferences: z.array(zSlotPreference).optional(),
});

export const zSubject = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  code: z.string().optional(),
  type: z.enum(['theory', 'practical']),
  classesPerWeek: z.number().int().positive(),
  sessionLength: z.number().int().positive().default(1),
  facultyId: z.string().nullable(),
  facultyIds: z.array(z.string()).optional(),
  fixed: z.boolean().optional(),
  fixedDay: z.string().optional(),
  fixedStart: z.string().optional(),
  fixedLength: z.number().int().positive().optional(),
  unavail: z.array(zUnavailabilityWindow).optional(),
  batches: z.array(z.string()).min(1, 'Subject must belong to at least one batch'),
  studentGroups: z.array(z.string()).optional(),
  capacityRequirement: z.number().int().positive().optional(),
  preferredRoomTypes: z.array(z.string()).optional(),
  requiredEquipment: z.array(z.string()).optional(),
  departmentId: z.string().nullable().optional(),
  programId: z.string().nullable().optional(),
  splitPattern: z.string().optional(),
  frequency: z.enum(['weekly', 'alternate_weeks_a', 'alternate_weeks_b', 'every_day']).optional(),
  isHeavySubject: z.boolean().optional(),
});

export const zBreak = z.object({
  day: z.string().min(1),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMins: z.number().int().positive(),
  name: z.string().optional(),
  batches: z.array(z.string()).optional(),
});

export const zFixedEvent = z.object({
  name: z.string().min(1),
  day: z.string().min(1),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  length: z.number().int().positive(),
  roomType: z.enum(['theory', 'practical']),
  room: z.string().optional(),
  batches: z.array(z.string()).optional(),
  facultyId: z.string().optional(),
});

export const zShift = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  batches: z.array(z.string()),
});

export const zConstraintTemplate = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['HARD', 'SOFT']),
  weight: z.number().int().min(1).max(1000),
  scope: z.enum(['global', 'faculty', 'batch', 'room', 'subject']),
  enabled: z.boolean(),
  description: z.string(),
  params: z.record(z.any()).default({}),
});

export const zBuildingTravelMatrix = z.object({
  buildings: z.array(z.string()),
  matrix: z.record(z.record(z.number())),
});

export const zSolverOptions = z.object({
  engine: z.enum(['auto', 'ts', 'python']).default('auto'),
  maxAttempts: z.number().int().positive().default(4000),
  balanceAcrossWeek: z.boolean().default(true),
  timeLimitSeconds: z.number().int().positive().default(30),
  randomSeed: z.number().int().optional(),
  numWorkers: z.number().int().positive().default(4),
  customWeights: z.record(z.number()).optional(),
});

export const zSchedulerInputState = z.object({
  version: z.number().int().default(2),
  institutionType: zInstitutionType.optional().default('college'),
  institutionName: z.string().optional(),
  days: z.array(z.string()).min(1, 'At least one day required'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  slotLength: z.number().int().positive().default(60),
  maxClassesPerDay: z.number().int().positive().default(6),
  rooms: z.object({
    theoryList: z.array(zRoom).default([]),
    labList: z.array(zRoom).default([]),
  }),
  batches: z.array(z.string()).min(1, 'At least one batch required'),
  batchSizes: z.record(z.number()).optional(),
  studentGroups: z.array(zStudentGroup).optional(),
  faculties: z.array(zFaculty).default([]),
  subjects: z.array(zSubject).default([]),
  breaks: z.array(zBreak).default([]),
  events: z.array(zFixedEvent).default([]),
  options: zSolverOptions.default({
    engine: 'auto',
    maxAttempts: 4000,
    balanceAcrossWeek: true,
  }),
  departments: z.array(zDepartment).optional(),
  programs: z.array(zProgram).optional(),
  batchDetails: z.record(z.object({ programId: z.string(), semester: z.number() })).optional(),
  shifts: z.array(zShift).optional(),
  constraints: z.array(zConstraintTemplate).optional(),
  travelMatrix: zBuildingTravelMatrix.optional(),
});
