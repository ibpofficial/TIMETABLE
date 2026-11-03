import { describe, it, expect } from 'vitest';
import { migrateConfig } from '../src/migration';
import { zSchedulerInputState } from '../src/schemas';
import { BUILTIN_CONSTRAINTS } from '../src/constraints';

describe('Configuration Migration Engine (v1 -> v2)', () => {
  it('migrates a raw legacy v1 config to a valid v2 schema', () => {
    const legacyV1 = {
      days: ['Monday', 'Tuesday', 'Wednesday'],
      startTime: '09:00',
      endTime: '15:00',
      slotLength: 60,
      maxClassesPerDay: 5,
      rooms: {
        theoryList: [{ id: 'r1', name: 'Class 101', capacity: 50 }],
        labList: [{ id: 'l1', name: 'Physics Lab', capacity: 25 }],
      },
      batches: ['Batch A', 'Batch B'],
      faculties: [
        { id: 'f1', name: 'Dr. Smith', leaves: 0, maxWeeklySlots: 15, unavail: [] },
      ],
      subjects: [
        {
          id: 's1',
          name: 'Physics',
          type: 'theory',
          classesPerWeek: 3,
          sessionLength: 1,
          facultyId: 'f1',
          batches: ['Batch A'],
        },
      ],
      breaks: [],
      events: [],
      options: {
        maxAttempts: 2000,
        balanceAcrossWeek: true,
      },
    };

    const v2 = migrateConfig(legacyV1);

    expect(v2.version).toBe(2);
    expect(v2.institutionType).toBe('college');
    expect(v2.constraints?.length).toBe(BUILTIN_CONSTRAINTS.length);
    expect(v2.rooms.theoryList[0].features).toEqual([]);
    expect(v2.faculties[0].maxConsecutiveSlots).toBe(4);
    expect(v2.subjects[0].facultyIds).toEqual(['f1']);

    const parseResult = zSchedulerInputState.safeParse(v2);
    expect(parseResult.success).toBe(true);
  });

  it('preserves existing v2 configuration without mutation', () => {
    const existingV2 = {
      version: 2,
      institutionType: 'university',
      institutionName: 'Apex University',
      days: ['Monday', 'Tuesday'],
      startTime: '08:00',
      endTime: '16:00',
      slotLength: 60,
      maxClassesPerDay: 6,
      rooms: { theoryList: [], labList: [] },
      batches: ['CS-101'],
      faculties: [],
      subjects: [],
      breaks: [],
      events: [],
      options: { engine: 'python', maxAttempts: 5000, balanceAcrossWeek: true },
      constraints: BUILTIN_CONSTRAINTS,
    };

    const result = migrateConfig(existingV2);
    expect(result.version).toBe(2);
    expect(result.institutionType).toBe('university');
    expect(result.options.engine).toBe('python');
  });

  it('handles empty or sparse configurations gracefully', () => {
    const emptyConfig = {
      days: ['Monday'],
      startTime: '09:00',
      endTime: '12:00',
      rooms: { theoryList: [], labList: [] },
      batches: ['Alpha'],
      faculties: [],
      subjects: [],
      breaks: [],
      events: [],
    };

    const result = migrateConfig(emptyConfig);
    expect(result.version).toBe(2);
    expect(result.batches).toEqual(['Alpha']);
    expect(result.maxClassesPerDay).toBe(6);
    expect(result.constraints?.length).toBeGreaterThan(20);
  });
});

