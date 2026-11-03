import { SchedulerInputState, Room, Faculty, Subject, Break, FixedEvent, BUILTIN_CONSTRAINTS } from '@ibp/shared';

// Deterministic 32-bit PRNG (Mulberry32)
export function createPRNG(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type InstanceTier = 'tiny' | 'school' | 'college' | 'university' | 'evil';

export interface GeneratorOptions {
  seed?: number;
  tier?: InstanceTier;
  batchesCount?: number;
  facultyCount?: number;
  roomsCount?: number;
  days?: string[];
  maxClassesPerDay?: number;
  includeElectives?: boolean;
  includeGroups?: boolean;
  makeInfeasible?: 'faculty_overload' | 'no_rooms' | 'capacity_exceeded' | 'pigeonhole' | 'none';
}

export function generateInstance(options: GeneratorOptions = {}): { config: SchedulerInputState; expectedFeasible: boolean } {
  const seed = options.seed ?? 12345;
  const rand = createPRNG(seed);
  const tier = options.tier ?? 'tiny';

  const defaultDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const days = options.days ?? defaultDays;
  const slotLength = 60;
  let startTime = '09:00';
  let endTime = '17:00';
  let maxClassesPerDay = options.maxClassesPerDay ?? 6;

  let batchCount = 2;
  let facultyCount = 4;
  let theoryRoomCount = 2;
  let labRoomCount = 1;
  let subjectsPerBatch = 4;
  let expectedFeasible = true;

  if (tier === 'tiny') {
    batchCount = options.batchesCount ?? 2;
    facultyCount = options.facultyCount ?? 4;
    theoryRoomCount = Math.max(1, Math.floor(batchCount * 0.8));
    labRoomCount = 1;
    subjectsPerBatch = 3;
    maxClassesPerDay = 4;
  } else if (tier === 'school') {
    batchCount = options.batchesCount ?? 6;
    facultyCount = options.facultyCount ?? 12;
    theoryRoomCount = batchCount;
    labRoomCount = 2;
    subjectsPerBatch = 5;
    maxClassesPerDay = 6;
    startTime = '08:30';
    endTime = '15:30';
  } else if (tier === 'college') {
    batchCount = options.batchesCount ?? 16;
    facultyCount = options.facultyCount ?? 32;
    theoryRoomCount = Math.ceil(batchCount * 0.8);
    labRoomCount = Math.ceil(batchCount * 0.4);
    subjectsPerBatch = 6;
    maxClassesPerDay = 6;
  } else if (tier === 'university') {
    batchCount = options.batchesCount ?? 40;
    facultyCount = options.facultyCount ?? 80;
    theoryRoomCount = Math.ceil(batchCount * 0.85);
    labRoomCount = Math.ceil(batchCount * 0.4);
    subjectsPerBatch = 6;
    maxClassesPerDay = 7;
  } else if (tier === 'evil') {
    batchCount = options.batchesCount ?? 4;
    facultyCount = options.facultyCount ?? 4;
    theoryRoomCount = 1;
    labRoomCount = 0;
    subjectsPerBatch = 8;
    maxClassesPerDay = 4;
    expectedFeasible = false;
  }

  // Generate Batches
  const batches: string[] = [];
  const batchSizes: Record<string, number> = {};
  for (let i = 1; i <= batchCount; i++) {
    const bName = `Batch_${tier.toUpperCase()}_${i}`;
    batches.push(bName);
    batchSizes[bName] = 40 + Math.floor(rand() * 20); // 40-60 students
  }

  // Generate Rooms
  const theoryList: Room[] = [];
  for (let i = 1; i <= theoryRoomCount; i++) {
    theoryList.push({
      id: `room_theory_${i}`,
      name: `Room ${100 + i}`,
      type: 'theory',
      capacity: 70,
      building: `Block-${(i % 2) + 1}`,
      floor: Math.floor(i / 10) + 1,
      equipment: ['projector', 'whiteboard'],
      isShared: true,
    });
  }

  const labList: Room[] = [];
  for (let i = 1; i <= labRoomCount; i++) {
    labList.push({
      id: `room_lab_${i}`,
      name: `Lab ${200 + i}`,
      type: 'practical',
      capacity: 35,
      building: `Block-${(i % 2) + 1}`,
      floor: 2,
      equipment: ['computers', 'lan'],
      isShared: true,
    });
  }

  // Generate Faculty
  const faculties: Faculty[] = [];
  for (let i = 1; i <= facultyCount; i++) {
    faculties.push({
      id: `faculty_${i}`,
      name: `Prof. ${String.fromCharCode(65 + (i % 26))}${i}`,
      leaves: 0,
      maxWeeklySlots: 22,
      maxDailySlots: 5,
      maxConsecutiveSlots: 3,
      minGapBetweenSessions: 0,
      unavail: [],
      departmentId: `dept_${(i % 3) + 1}`,
    });
  }

  // Generate Subjects
  const subjects: Subject[] = [];
  let subjCounter = 1;

  for (const b of batches) {
    for (let s = 1; s <= subjectsPerBatch; s++) {
      const isLab = s === subjectsPerBatch && labRoomCount > 0;
      const assignedFac = faculties[(subjCounter - 1) % faculties.length];
      const classesPerWeek = isLab ? 1 : (s <= 2 ? 3 : 2);
      const sessionLength = isLab ? 2 : 1;

      subjects.push({
        id: `subj_${subjCounter++}`,
        name: isLab ? `Lab_${s}_${b}` : `Course_${s}_${b}`,
        type: isLab ? 'practical' : 'theory',
        classesPerWeek,
        sessionLength,
        facultyId: assignedFac.id,
        facultyIds: [assignedFac.id],
        batches: [b],
        capacityRequirement: isLab ? 30 : 50,
      });
    }
  }

  // Elective subject shared across multiple batches
  if (options.includeElectives && batches.length >= 2) {
    const electiveBatches = batches.slice(0, 2);
    subjects.push({
      id: `subj_elective_${subjCounter++}`,
      name: `Open_Elective_AI`,
      type: 'theory',
      classesPerWeek: 2,
      sessionLength: 1,
      facultyId: faculties[0].id,
      facultyIds: [faculties[0].id],
      batches: electiveBatches,
      capacityRequirement: 90,
    });
  }

  // Breaks
  const breaks: Break[] = [
    {
      day: 'Monday',
      start: '12:00',
      durationMins: 60,
      name: 'Lunch',
    },
    {
      day: 'Tuesday',
      start: '12:00',
      durationMins: 60,
      name: 'Lunch',
    },
    {
      day: 'Wednesday',
      start: '12:00',
      durationMins: 60,
      name: 'Lunch',
    },
    {
      day: 'Thursday',
      start: '12:00',
      durationMins: 60,
      name: 'Lunch',
    },
    {
      day: 'Friday',
      start: '12:00',
      durationMins: 60,
      name: 'Lunch',
    },
  ];

  // Infeasible injections
  if (options.makeInfeasible === 'faculty_overload') {
    faculties[0].maxWeeklySlots = 1;
    expectedFeasible = false;
  } else if (options.makeInfeasible === 'no_rooms') {
    theoryList.length = 0;
    expectedFeasible = false;
  } else if (options.makeInfeasible === 'capacity_exceeded') {
    theoryList.forEach((r) => (r.capacity = 10));
    expectedFeasible = false;
  } else if (options.makeInfeasible === 'pigeonhole') {
    maxClassesPerDay = 1;
    expectedFeasible = false;
  }

  const config: SchedulerInputState = {
    version: 2,
    institutionType: tier === 'school' ? 'school' : 'college',
    institutionName: `Benchmark_${tier.toUpperCase()}`,
    days,
    startTime,
    endTime,
    slotLength,
    maxClassesPerDay,
    rooms: {
      theoryList,
      labList,
    },
    batches,
    batchSizes,
    faculties,
    subjects,
    breaks,
    events: [],
    options: {
      engine: 'auto',
      maxAttempts: 5000,
      balanceAcrossWeek: true,
      timeLimitSeconds: 30,
    },
    constraints: BUILTIN_CONSTRAINTS,
  };

  return { config, expectedFeasible };
}
