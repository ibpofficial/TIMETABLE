import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Faculty, Subject, Break, FixedEvent, Room, SolverOptions,
  ScheduleSolution, FailureDiagnostic, JobState, SchedulerConfig
} from '../types';

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface TimetableState {
  // Wizard navigation
  currentStep: WizardStep;
  setStep: (step: WizardStep) => void;

  // Step 1 - Institution settings
  days: string[];
  startTime: string;
  endTime: string;
  slotLength: number;
  maxClassesPerDay: number;
  theoryRooms: Room[];
  labRooms: Room[];
  setDays: (days: string[]) => void;
  setStartTime: (t: string) => void;
  setEndTime: (t: string) => void;
  setSlotLength: (n: number) => void;
  setMaxClassesPerDay: (n: number) => void;
  setTheoryRooms: (rooms: Room[]) => void;
  setLabRooms: (rooms: Room[]) => void;

  // Step 2 - Batches
  batches: string[];
  addBatch: (name: string) => void;
  removeBatch: (name: string) => void;

  // Step 3 - Faculties
  faculties: Faculty[];
  addFaculty: (f: Faculty) => void;
  updateFaculty: (id: string, updates: Partial<Faculty>) => void;
  removeFaculty: (id: string) => void;

  // Step 4 - Subjects
  subjects: Subject[];
  addSubject: (s: Subject) => void;
  updateSubject: (id: string, updates: Partial<Subject>) => void;
  removeSubject: (id: string) => void;

  // Step 5 - Breaks & Events
  breaks: Break[];
  events: FixedEvent[];
  addBreak: (b: Break) => void;
  removeBreak: (idx: number) => void;
  addEvent: (e: FixedEvent) => void;
  removeEvent: (idx: number) => void;

  // Step 6 - Solver options
  solverOptions: SolverOptions;
  setSolverOptions: (opts: Partial<SolverOptions>) => void;

  // Generation state
  jobId: string | null;
  jobStatus: JobState | null;
  solution: ScheduleSolution | null;
  diagnostics: FailureDiagnostic[] | null;
  setJobId: (id: string | null) => void;
  setJobStatus: (status: JobState | null) => void;
  setSolution: (sol: ScheduleSolution | null) => void;
  setDiagnostics: (d: FailureDiagnostic[] | null) => void;

  // Cloud save
  sessionId: string;
  savedConfigId: string | null;
  setSavedConfigId: (id: string | null) => void;

  // Load full config
  loadConfig: (config: Partial<SchedulerConfig>) => void;

  // Reset
  resetAll: () => void;
  resetResults: () => void;
}

const generateSessionId = () => `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const defaultState = {
  currentStep: 1 as WizardStep,
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  startTime: '09:00',
  endTime: '17:00',
  slotLength: 60,
  maxClassesPerDay: 6,
  theoryRooms: [
    { id: 'T1', name: 'T1', type: 'theory' as const, capacity: 60 },
    { id: 'T2', name: 'T2', type: 'theory' as const, capacity: 60 },
    { id: 'T3', name: 'T3', type: 'theory' as const, capacity: 60 },
    { id: 'T4', name: 'T4', type: 'theory' as const, capacity: 60 },
  ],
  labRooms: [
    { id: 'L1', name: 'L1', type: 'practical' as const, capacity: 30 },
    { id: 'L2', name: 'L2', type: 'practical' as const, capacity: 30 },
  ],
  batches: [],
  faculties: [],
  subjects: [],
  breaks: [],
  events: [],
  solverOptions: { maxAttempts: 5000, balanceAcrossWeek: true },
  jobId: null,
  jobStatus: null,
  solution: null,
  diagnostics: null,
  savedConfigId: null,
};

export const useTimetableStore = create<TimetableState>()(
  persist(
    (set, get) => ({
      ...defaultState,
      sessionId: generateSessionId(),

      setStep: (step) => set({ currentStep: step }),

      setDays: (days) => set({ days }),
      setStartTime: (startTime) => set({ startTime }),
      setEndTime: (endTime) => set({ endTime }),
      setSlotLength: (slotLength) => set({ slotLength }),
      setMaxClassesPerDay: (maxClassesPerDay) => set({ maxClassesPerDay }),
      setTheoryRooms: (theoryRooms) => set({ theoryRooms }),
      setLabRooms: (labRooms) => set({ labRooms }),

      addBatch: (name) => set((s) => ({ batches: [...s.batches, name] })),
      removeBatch: (name) => set((s) => ({
        batches: s.batches.filter((b) => b !== name),
        subjects: s.subjects.filter((sub) => !sub.batches.every((b) => b === name)),
      })),

      addFaculty: (f) => set((s) => ({ faculties: [...s.faculties, f] })),
      updateFaculty: (id, updates) => set((s) => ({
        faculties: s.faculties.map((f) => f.id === id ? { ...f, ...updates } : f),
      })),
      removeFaculty: (id) => set((s) => ({
        faculties: s.faculties.filter((f) => f.id !== id),
        subjects: s.subjects.map((sub) => sub.facultyId === id ? { ...sub, facultyId: null } : sub),
      })),

      addSubject: (subject) => set((s) => ({ subjects: [...s.subjects, subject] })),
      updateSubject: (id, updates) => set((s) => ({
        subjects: s.subjects.map((sub) => sub.id === id ? { ...sub, ...updates } : sub),
      })),
      removeSubject: (id) => set((s) => ({ subjects: s.subjects.filter((sub) => sub.id !== id) })),

      addBreak: (b) => set((s) => ({ breaks: [...s.breaks, b] })),
      removeBreak: (idx) => set((s) => ({ breaks: s.breaks.filter((_, i) => i !== idx) })),
      addEvent: (e) => set((s) => ({ events: [...s.events, e] })),
      removeEvent: (idx) => set((s) => ({ events: s.events.filter((_, i) => i !== idx) })),

      setSolverOptions: (opts) => set((s) => ({ solverOptions: { ...s.solverOptions, ...opts } })),

      setJobId: (jobId) => set({ jobId }),
      setJobStatus: (jobStatus) => set({ jobStatus }),
      setSolution: (solution) => set({ solution }),
      setDiagnostics: (diagnostics) => set({ diagnostics }),
      setSavedConfigId: (savedConfigId) => set({ savedConfigId }),

      loadConfig: (config) => set((s) => ({
        days: config.days ?? s.days,
        startTime: config.startTime ?? s.startTime,
        endTime: config.endTime ?? s.endTime,
        slotLength: config.slotLength ?? s.slotLength,
        maxClassesPerDay: config.maxClassesPerDay ?? s.maxClassesPerDay,
        theoryRooms: config.rooms?.theoryList ?? s.theoryRooms,
        labRooms: config.rooms?.labList ?? s.labRooms,
        batches: config.batches ?? s.batches,
        faculties: config.faculties ?? s.faculties,
        subjects: config.subjects ?? s.subjects,
        breaks: config.breaks ?? s.breaks,
        events: config.events ?? s.events,
        solverOptions: config.options ?? s.solverOptions,
      })),

      resetAll: () => set({ ...defaultState, sessionId: get().sessionId }),
      resetResults: () => set({ jobId: null, jobStatus: null, solution: null, diagnostics: null }),
    }),
    {
      name: 'ibp-timetable-store',
      // Don't persist solution/job state — only config
      partialize: (state) => ({
        days: state.days,
        startTime: state.startTime,
        endTime: state.endTime,
        slotLength: state.slotLength,
        maxClassesPerDay: state.maxClassesPerDay,
        theoryRooms: state.theoryRooms,
        labRooms: state.labRooms,
        batches: state.batches,
        faculties: state.faculties,
        subjects: state.subjects,
        breaks: state.breaks,
        events: state.events,
        solverOptions: state.solverOptions,
        sessionId: state.sessionId,
      }),
    }
  )
);
