// Full Domain Model for IBP Timetable Generator (Schema v1 + v2)

export type InstitutionType = 'school' | 'college' | 'university' | 'coaching' | 'exam';

export interface UnavailabilityWindow {
  day: string;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
  reason?: string;
}

export interface InstitutionSettings {
  name?: string;
  type?: InstitutionType;
  days: string[];
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
  slotLength: number; // in minutes (e.g. 60 or 45)
  maxClassesPerDay: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  building?: string;
}

export interface Program {
  id: string;
  name: string;
  departmentId: string;
  durationYears?: number;
}

export interface StudentGroup {
  id: string;
  name: string;       // e.g. "A1", "A2", "Batch-A"
  batchId: string;    // parent batch
  size: number;
}

export interface Room {
  id: string;
  name: string;
  type: string;       // "theory" | "practical" | custom e.g. "auditorium", "seminar"
  capacity: number;
  building?: string;
  floor?: number;
  roomNumber?: string;
  equipment?: string[];
  departmentId?: string | null; // Null/undefined means campus-wide shared
  isShared?: boolean;
  features?: string[];
  unavail?: UnavailabilityWindow[];
}

export interface SlotPreference {
  day: string;
  start: string;
  weight: number; // Positive = preferred, Negative = avoid (-100 to +100)
}

export interface Faculty {
  id: string;
  name: string;
  leaves: number;
  maxWeeklySlots: number;
  minWeeklySlots?: number;
  maxDailySlots?: number;
  maxConsecutiveSlots?: number;
  minGapBetweenSessions?: number; // min free slots between classes
  unavail: UnavailabilityWindow[];
  departmentId?: string | null;
  designation?: string;
  isPartTime?: boolean;
  preferredDaysOff?: string[];
  slotPreferences?: SlotPreference[];
}

export interface Subject {
  id: string;
  name: string;
  code?: string;
  type: 'theory' | 'practical';
  classesPerWeek: number;
  sessionLength: number; // in slots (e.g. 1 for 1-hour lecture, 2 or 3 for multi-hour lab)
  facultyId: string | null;
  facultyIds?: string[]; // Multiple faculty for co-teaching
  fixed?: boolean;
  fixedDay?: string;
  fixedStart?: string;
  fixedLength?: number;
  unavail?: UnavailabilityWindow[];
  batches: string[];     // Parent batches (supports electives across batches)
  studentGroups?: string[]; // Specific subgroups (e.g. ["A1"] for lab split)
  capacityRequirement?: number;
  preferredRoomTypes?: string[];
  requiredEquipment?: string[];
  departmentId?: string | null;
  programId?: string | null;
  splitPattern?: string; // e.g. "2+1" or "3"
  frequency?: 'weekly' | 'alternate_weeks_a' | 'alternate_weeks_b' | 'every_day';
  isHeavySubject?: boolean; // Don't place two heavy subjects back to back
}

export interface Break {
  day: string;
  start: string; // "HH:MM"
  durationMins: number;
  name?: string;
  batches?: string[]; // Specific batches if staggered, empty = all
}

export interface FixedEvent {
  name: string;
  day: string;
  start: string; // "HH:MM"
  length: number; // in slots
  roomType: 'theory' | 'practical';
  room?: string;
  batches?: string[];
  facultyId?: string;
}

export interface Shift {
  id: string;
  name: string; // e.g. "Morning Shift", "Evening Shift"
  startTime: string;
  endTime: string;
  batches: string[];
}

export type ConstraintKind = 'HARD' | 'SOFT';
export type ConstraintScope = 'global' | 'faculty' | 'batch' | 'room' | 'subject';

export interface ConstraintTemplate {
  id: string;
  name: string;
  kind: ConstraintKind;
  weight: number; // 1 to 1000
  scope: ConstraintScope;
  enabled: boolean;
  description: string;
  params: Record<string, any>;
}

export interface BuildingTravelMatrix {
  buildings: string[];
  matrix: Record<string, Record<string, number>>; // buildingA -> buildingB -> minutes required
}

export interface SolverOptions {
  engine?: 'auto' | 'ts' | 'python';
  maxAttempts: number;
  balanceAcrossWeek: boolean;
  timeLimitSeconds?: number;
  randomSeed?: number;
  numWorkers?: number;
  customWeights?: Record<string, number>;
}

export interface SchedulerInputState {
  version?: number; // 1 or 2
  institutionType?: InstitutionType;
  institutionName?: string;
  days: string[];
  startTime: string;
  endTime: string;
  slotLength: number;
  maxClassesPerDay: number;
  rooms: {
    theoryList: Room[];
    labList: Room[];
  };
  batches: string[];
  batchSizes?: Record<string, number>;
  studentGroups?: StudentGroup[];
  faculties: Faculty[];
  subjects: Subject[];
  breaks: Break[];
  events: FixedEvent[];
  options: SolverOptions;
  departments?: Department[];
  programs?: Program[];
  batchDetails?: Record<string, { programId: string; semester: number }>;
  shifts?: Shift[];
  constraints?: ConstraintTemplate[];
  travelMatrix?: BuildingTravelMatrix;
}

// Backward compatibility alias
export type SchedulerConfig = SchedulerInputState;

export interface Timeslot {
  id: string;
  day: string;
  start: string;
  end: string;
  startMin: number;
  endMin: number;
  isBreak: boolean;
  index: number;
}

export interface Assignment {
  id: string;
  subjectId: string | null;
  subject: string;
  facultyId: string | null;
  facultyIds?: string[];
  room: string;
  timeslotId: string;
  length: number;
  batches: string[];
  studentGroups?: string[];
  day?: string;
  startMin?: number;
  endMin?: number;
  explanation?: string;
}

export interface ScheduleSolution {
  timeslots: Timeslot[];
  byBatch: Record<string, Assignment[]>;
  byFaculty?: Record<string, Assignment[]>;
  byRoom?: Record<string, Assignment[]>;
  roomsByType: {
    theory: string[];
    practical: string[];
  };
  score?: {
    hardViolations: number;
    softScore: number;
    metrics?: Record<string, number>;
  };
  metadata?: {
    engine: 'ts' | 'python';
    solveTimeMs: number;
    iterations?: number;
    optimalityGap?: number;
  };
}

export interface FailureDiagnostic {
  subject: string;
  batches: string[];
  faculty: string;
  reason: string;
  suggestedRelaxation?: string;
}

export interface SolverProgress {
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'error';
  placedSessions: number;
  totalSessions: number;
  attempts: number;
  maxAttempts: number;
  solution?: ScheduleSolution;
  diagnostics?: FailureDiagnostic[];
  error?: string;
  elapsedMs?: number;
  bestScore?: number;
}

export interface SavedConfig {
  id: string;
  name: string;
  sessionId?: string;
  data?: any;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface SavedTimetable {
  id: string;
  name: string;
  configId: string;
  sessionId?: string;
  data?: any;
  createdAt: string | Date;
}

export interface JobState {
  id: string;
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'error';
  placedSessions: number;
  totalSessions: number;
  solution?: ScheduleSolution;
  diagnostics?: FailureDiagnostic[];
  error?: string;
  createdAt?: Date;
  updatedAt?: Date;
  engine?: 'ts' | 'python';
  progressHistory?: { timestamp: number; objective: number }[];
}
