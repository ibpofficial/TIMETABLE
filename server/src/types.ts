export interface UnavailabilityWindow {
  day: string;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export interface InstitutionSettings {
  days: string[];
  startTime: string;
  endTime: string;
  slotLength: number;
  maxClassesPerDay: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface Program {
  id: string;
  name: string;
  departmentId: string;
}

export interface Room {
  id: string;
  name: string;
  type: string;
  capacity: number;
  building?: string;
  floor?: number;
  roomNumber?: string;
  equipment?: string[];
  departmentId?: string | null; // Null/undefined means shared college-wide
}

export interface Faculty {
  id: string;
  name: string;
  leaves: number;
  maxWeeklySlots: number;
  maxDailySlots?: number; // Optional hourly/slot daily limit
  unavail: UnavailabilityWindow[];
  departmentId?: string | null; // Null/undefined means shared college-wide
}

export interface Subject {
  id: string;
  name: string;
  type: 'theory' | 'practical';
  classesPerWeek: number;
  sessionLength: number;
  facultyId: string | null;
  fixed?: boolean;
  fixedDay?: string;
  fixedStart?: string;
  fixedLength?: number;
  unavail?: UnavailabilityWindow[];
  batches: string[]; // Supports multiple batches for Electives!
  capacityRequirement?: number;
  preferredRoomTypes?: string[];
  requiredEquipment?: string[];
  departmentId?: string | null;
  programId?: string | null;
}

export interface Break {
  day: string;
  start: string; // "HH:MM"
  durationMins: number;
}

export interface FixedEvent {
  name: string;
  day: string;
  start: string; // "HH:MM"
  length: number;
  roomType: 'theory' | 'practical';
}

export interface SolverOptions {
  maxAttempts: number;
  balanceAcrossWeek: boolean;
}

export interface SchedulerInputState {
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
  faculties: Faculty[];
  subjects: Subject[];
  breaks: Break[];
  events: FixedEvent[];
  options: SolverOptions;
  departments?: Department[];
  programs?: Program[];
  batchDetails?: Record<string, { programId: string; semester: number }>;
}

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
  room: string;
  timeslotId: string;
  length: number;
  batches: string[];
}

export interface ScheduleSolution {
  timeslots: Timeslot[];
  byBatch: Record<string, Assignment[]>;
  roomsByType: {
    theory: string[];
    practical: string[];
  };
}

export interface FailureDiagnostic {
  subject: string;
  batches: string[];
  faculty: string;
  reason: string;
}

export interface SolverProgress {
  status: 'running' | 'success' | 'failed' | 'cancelled';
  placedSessions: number;
  totalSessions: number;
  attempts: number;
  maxAttempts: number;
  solution?: ScheduleSolution;
  diagnostics?: FailureDiagnostic[];
}
