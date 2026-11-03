import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Faculty, Subject, Break, FixedEvent, Room, SolverOptions,
  ScheduleSolution, FailureDiagnostic, JobState,
  Department, Program, InstitutionType, StudentGroup, Shift,
  ConstraintTemplate, BuildingTravelMatrix
} from '../types';
import { BUILTIN_CONSTRAINTS, migrateConfig } from '@ibp/shared';

export type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface TimetableState {
  // Version & Institution
  version: number;
  institutionType: InstitutionType;
  institutionName: string;
  setInstitutionType: (type: InstitutionType) => void;
  setInstitutionName: (name: string) => void;

  // Wizard navigation
  currentStep: WizardStep;
  setStep: (step: WizardStep) => void;

  // Step 1 - Institution settings & Rooms
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

  // Travel Matrix
  travelMatrix: BuildingTravelMatrix | null;
  setTravelTime: (buildingA: string, buildingB: string, minutes: number) => void;

  // Step 2 - Batches & Groups
  batches: string[];
  batchSizes: Record<string, number>;
  studentGroups: StudentGroup[];
  addBatch: (name: string, size?: number) => void;
  removeBatch: (name: string) => void;
  setBatchSize: (name: string, size: number) => void;
  addStudentGroup: (group: StudentGroup) => void;
  removeStudentGroup: (id: string) => void;

  // Shifts
  shifts: Shift[];
  addShift: (shift: Shift) => void;
  removeShift: (id: string) => void;

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

  // Constraint Studio (Phase 2 & 5)
  constraints: ConstraintTemplate[];
  toggleConstraint: (id: string, enabled?: boolean) => void;
  setConstraintWeight: (id: string, weight: number) => void;
  updateConstraintParams: (id: string, params: Record<string, any>) => void;
  addCustomConstraint: (constraint: ConstraintTemplate) => void;
  removeCustomConstraint: (id: string) => void;

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

  // College-wide structures state
  departments: Department[];
  programs: Program[];
  batchDetails: Record<string, { programId: string; semester: number }>;
  addDepartment: (dept: Department) => void;
  removeDepartment: (id: string) => void;
  addProgram: (prog: Program) => void;
  removeProgram: (id: string) => void;
  setBatchDetails: (batch: string, programId: string, semester: number) => void;

  // Cloud save
  sessionId: string;
  savedConfigId: string | null;
  setSavedConfigId: (id: string | null) => void;

  // Load full config (with auto-migration v1 -> v2)
  loadConfig: (config: unknown) => void;

  // Reset
  resetAll: () => void;
  resetResults: () => void;
  clearStepData: (step: WizardStep) => void;
}

const generateSessionId = () => `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const defaultState = {
  version: 2,
  institutionType: 'college' as InstitutionType,
  institutionName: 'Default Institute',
  currentStep: 0 as WizardStep,
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  startTime: '09:00',
  endTime: '17:00',
  slotLength: 60,
  maxClassesPerDay: 6,
  theoryRooms: [
    { id: 'T1', name: 'T1', type: 'theory', capacity: 60, building: 'Block-A', floor: 1, roomNumber: '101', equipment: ['projector'] },
    { id: 'T2', name: 'T2', type: 'theory', capacity: 60, building: 'Block-A', floor: 1, roomNumber: '102', equipment: ['projector'] },
    { id: 'T3', name: 'T3', type: 'theory', capacity: 60, building: 'Block-A', floor: 2, roomNumber: '201', equipment: ['projector', 'smart_board'] },
    { id: 'T4', name: 'T4', type: 'theory', capacity: 60, building: 'Block-A', floor: 2, roomNumber: '202', equipment: ['projector', 'smart_board'] },
  ],
  labRooms: [
    { id: 'L1', name: 'L1', type: 'practical', capacity: 60, building: 'Block-B', floor: 1, roomNumber: '101', equipment: ['pc_lab_software'] },
    { id: 'L2', name: 'L2', type: 'practical', capacity: 60, building: 'Block-B', floor: 1, roomNumber: '102', equipment: ['pc_lab_software'] },
  ],
  travelMatrix: null,
  batches: [],
  batchSizes: {},
  studentGroups: [],
  shifts: [],
  faculties: [],
  subjects: [],
  breaks: [],
  events: [],
  constraints: BUILTIN_CONSTRAINTS,
  solverOptions: {
    engine: 'auto' as const,
    maxAttempts: 5000,
    balanceAcrossWeek: true,
    timeLimitSeconds: 30,
    numWorkers: 4,
  },
  jobId: null,
  jobStatus: null,
  solution: null,
  diagnostics: null,
  savedConfigId: null,
  departments: [],
  programs: [],
  batchDetails: {},
};

export const useTimetableStore = create<TimetableState>()(
  persist(
    (set, get) => ({
      ...defaultState,
      sessionId: generateSessionId(),

      setInstitutionType: (institutionType) => set({ institutionType }),
      setInstitutionName: (institutionName) => set({ institutionName }),
      setStep: (step) => set({ currentStep: step }),

      setDays: (days) => set({ days }),
      setStartTime: (startTime) => set({ startTime }),
      setEndTime: (endTime) => set({ endTime }),
      setSlotLength: (slotLength) => set({ slotLength }),
      setMaxClassesPerDay: (maxClassesPerDay) => set({ maxClassesPerDay }),
      setTheoryRooms: (theoryRooms) => set({ theoryRooms }),
      setLabRooms: (labRooms) => set({ labRooms }),

      setTravelTime: (buildingA, buildingB, minutes) => set((s) => {
        const matrix = s.travelMatrix ? { ...s.travelMatrix.matrix } : {};
        if (!matrix[buildingA]) matrix[buildingA] = {};
        if (!matrix[buildingB]) matrix[buildingB] = {};
        matrix[buildingA][buildingB] = minutes;
        matrix[buildingB][buildingA] = minutes;
        const buildings = Array.from(new Set([...(s.travelMatrix?.buildings || []), buildingA, buildingB]));
        return { travelMatrix: { buildings, matrix } };
      }),

      addBatch: (name, size = 60) => set((s) => ({
        batches: [...s.batches, name],
        batchSizes: { ...s.batchSizes, [name]: size },
      })),
      removeBatch: (name) => set((s) => {
        const newSizes = { ...s.batchSizes };
        delete newSizes[name];
        const newBatchDetails = { ...s.batchDetails };
        delete newBatchDetails[name];
        return {
          batches: s.batches.filter((b) => b !== name),
          batchSizes: newSizes,
          batchDetails: newBatchDetails,
          studentGroups: s.studentGroups.filter((g) => g.batchId !== name),
          subjects: s.subjects.filter((sub) => !sub.batches.every((b) => b === name)),
        };
      }),
      setBatchSize: (name, size) => set((s) => ({
        batchSizes: { ...s.batchSizes, [name]: size },
      })),

      addStudentGroup: (group) => set((s) => ({
        studentGroups: [...s.studentGroups, group],
      })),
      removeStudentGroup: (id) => set((s) => ({
        studentGroups: s.studentGroups.filter((g) => g.id !== id),
      })),

      addShift: (shift) => set((s) => ({ shifts: [...s.shifts, shift] })),
      removeShift: (id) => set((s) => ({ shifts: s.shifts.filter((sh) => sh.id !== id) })),

      addFaculty: (f) => set((s) => ({ faculties: [...s.faculties, f] })),
      updateFaculty: (id, updates) => set((s) => ({
        faculties: s.faculties.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      })),
      removeFaculty: (id) => set((s) => ({
        faculties: s.faculties.filter((f) => f.id !== id),
        subjects: s.subjects.map((sub) => (sub.facultyId === id ? { ...sub, facultyId: null } : sub)),
      })),

      addSubject: (subject) => set((s) => ({ subjects: [...s.subjects, subject] })),
      updateSubject: (id, updates) => set((s) => ({
        subjects: s.subjects.map((sub) => (sub.id === id ? { ...sub, ...updates } : sub)),
      })),
      removeSubject: (id) => set((s) => ({ subjects: s.subjects.filter((sub) => sub.id !== id) })),

      addBreak: (b) => set((s) => ({ breaks: [...s.breaks, b] })),
      removeBreak: (idx) => set((s) => ({ breaks: s.breaks.filter((_, i) => i !== idx) })),
      addEvent: (e) => set((s) => ({ events: [...s.events, e] })),
      removeEvent: (idx) => set((s) => ({ events: s.events.filter((_, i) => i !== idx) })),

      toggleConstraint: (id, enabled) => set((s) => ({
        constraints: s.constraints.map((c) =>
          c.id === id ? { ...c, enabled: enabled !== undefined ? enabled : !c.enabled } : c
        ),
      })),
      setConstraintWeight: (id, weight) => set((s) => ({
        constraints: s.constraints.map((c) => (c.id === id ? { ...c, weight } : c)),
      })),
      updateConstraintParams: (id, params) => set((s) => ({
        constraints: s.constraints.map((c) => (c.id === id ? { ...c, params: { ...c.params, ...params } } : c)),
      })),
      addCustomConstraint: (constraint) => set((s) => ({
        constraints: [...s.constraints, constraint],
      })),
      removeCustomConstraint: (id) => set((s) => ({
        constraints: s.constraints.filter((c) => c.id !== id),
      })),

      setSolverOptions: (opts) => set((s) => ({ solverOptions: { ...s.solverOptions, ...opts } })),

      setJobId: (jobId) => set({ jobId }),
      setJobStatus: (jobStatus) => set({ jobStatus }),
      setSolution: (solution) => set({ solution }),
      setDiagnostics: (diagnostics) => set({ diagnostics }),
      setSavedConfigId: (savedConfigId) => set({ savedConfigId }),

      addDepartment: (dept) => set((s) => ({ departments: [...s.departments, dept] })),
      removeDepartment: (id) => set((s) => ({
        departments: s.departments.filter((d) => d.id !== id),
        programs: s.programs.filter((p) => p.departmentId !== id),
        faculties: s.faculties.map((f) => (f.departmentId === id ? { ...f, departmentId: null } : f)),
        subjects: s.subjects.map((sub) => (sub.departmentId === id ? { ...sub, departmentId: null } : sub)),
        theoryRooms: s.theoryRooms.map((r) => (r.departmentId === id ? { ...r, departmentId: null } : r)),
        labRooms: s.labRooms.map((r) => (r.departmentId === id ? { ...r, departmentId: null } : r)),
      })),

      addProgram: (prog) => set((s) => ({ programs: [...s.programs, prog] })),
      removeProgram: (id) => set((s) => ({
        programs: s.programs.filter((p) => p.id !== id),
        subjects: s.subjects.map((sub) => (sub.programId === id ? { ...sub, programId: null } : sub)),
      })),

      setBatchDetails: (batch, programId, semester) => set((s) => ({
        batchDetails: { ...s.batchDetails, [batch]: { programId, semester } },
      })),

      // Load config with automatic backward compatibility migration v1 -> v2
      loadConfig: (raw) => {
        try {
          const migrated = migrateConfig(raw);
          set((s) => ({
            version: migrated.version ?? 2,
            institutionType: migrated.institutionType ?? 'college',
            institutionName: migrated.institutionName ?? s.institutionName,
            days: migrated.days ?? s.days,
            startTime: migrated.startTime ?? s.startTime,
            endTime: migrated.endTime ?? s.endTime,
            slotLength: migrated.slotLength ?? s.slotLength,
            maxClassesPerDay: migrated.maxClassesPerDay ?? s.maxClassesPerDay,
            theoryRooms: migrated.rooms?.theoryList ?? s.theoryRooms,
            labRooms: migrated.rooms?.labList ?? s.labRooms,
            batches: migrated.batches ?? s.batches,
            batchSizes: migrated.batchSizes ?? s.batchSizes ?? {},
            studentGroups: migrated.studentGroups ?? [],
            shifts: migrated.shifts ?? [],
            faculties: migrated.faculties ?? s.faculties,
            subjects: migrated.subjects ?? s.subjects,
            breaks: migrated.breaks ?? s.breaks,
            events: migrated.events ?? s.events,
            constraints: migrated.constraints ?? s.constraints,
            travelMatrix: migrated.travelMatrix ?? null,
            solverOptions: migrated.options ?? s.solverOptions,
            departments: migrated.departments ?? s.departments ?? [],
            programs: migrated.programs ?? s.programs ?? [],
            batchDetails: migrated.batchDetails ?? s.batchDetails ?? {},
          }));
        } catch (err) {
          console.error('Failed to migrate config:', err);
        }
      },

      resetAll: () => set({ ...defaultState, sessionId: get().sessionId }),
      resetResults: () => set({ jobId: null, jobStatus: null, solution: null, diagnostics: null }),
      clearStepData: (step) => set((s) => {
        switch (step) {
          case 0:
            return { departments: [], programs: [], batchDetails: {} };
          case 1:
            return { startTime: '09:00', endTime: '17:00', slotLength: 60, maxClassesPerDay: 6, theoryRooms: [], labRooms: [] };
          case 2:
            return { batches: [], batchSizes: {}, studentGroups: [] };
          case 3:
            return {
              faculties: [],
              subjects: s.subjects.map((sub) => ({ ...sub, facultyId: null, facultyIds: [] })),
            };
          case 4:
            return { subjects: [] };
          case 5:
            return { breaks: [], events: [] };
          case 6:
            return { jobId: null, jobStatus: null, solution: null, diagnostics: null };
          default:
            return {};
        }
      }),
    }),
    {
      name: 'ibp-timetable-store',
      partialize: (state) => ({
        version: state.version,
        institutionType: state.institutionType,
        institutionName: state.institutionName,
        days: state.days,
        startTime: state.startTime,
        endTime: state.endTime,
        slotLength: state.slotLength,
        maxClassesPerDay: state.maxClassesPerDay,
        theoryRooms: state.theoryRooms,
        labRooms: state.labRooms,
        travelMatrix: state.travelMatrix,
        batches: state.batches,
        batchSizes: state.batchSizes,
        studentGroups: state.studentGroups,
        shifts: state.shifts,
        faculties: state.faculties,
        subjects: state.subjects,
        breaks: state.breaks,
        events: state.events,
        constraints: state.constraints,
        solverOptions: state.solverOptions,
        departments: state.departments,
        programs: state.programs,
        batchDetails: state.batchDetails,
        sessionId: state.sessionId,
      }),
    }
  )
);
