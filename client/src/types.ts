// Shared types used across both client and server
// Keep in sync with server/src/types.ts

export interface UnavailabilityWindow {
  day: string;
  start: string;
  end: string;
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
}

export interface Faculty {
  id: string;
  name: string;
  leaves: number;
  maxWeeklySlots: number;
  maxDailySlots?: number;
  unavail: UnavailabilityWindow[];
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
  batches: string[]; // multiple = elective
  capacityRequirement?: number;
  preferredRoomTypes?: string[];
  requiredEquipment?: string[];
}

export interface Break {
  day: string;
  start: string;
  durationMins: number;
}

export interface FixedEvent {
  name: string;
  day: string;
  start: string;
  length: number;
  roomType: 'theory' | 'practical';
}

export interface SolverOptions {
  maxAttempts: number;
  balanceAcrossWeek: boolean;
}

export interface SchedulerConfig {
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
  roomsByType: { theory: string[]; practical: string[] };
}

export interface FailureDiagnostic {
  subject: string;
  batches: string[];
  faculty: string;
  reason: string;
}

export interface JobState {
  id: string;
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'error';
  placedSessions: number;
  totalSessions: number;
  solution?: ScheduleSolution;
  diagnostics?: FailureDiagnostic[];
  error?: string;
}

export interface SavedConfig {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
