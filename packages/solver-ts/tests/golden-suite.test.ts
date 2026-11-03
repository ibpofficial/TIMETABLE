import { describe, it, expect } from 'vitest';
import { TimetableSolver, solveSchedule } from '../src/solver';
import { generateInstance } from '../../../tools/generate-instance';
import { ScheduleSolution } from '@ibp/shared';

function verifyHardConstraints(solution: ScheduleSolution) {
  const batchOccupancy = new Map<string, Set<string>>();
  const facultyOccupancy = new Map<string, Set<string>>();
  const roomOccupancy = new Map<string, Set<string>>();

  for (const [batch, assignments] of Object.entries(solution.byBatch)) {
    if (!batchOccupancy.has(batch)) batchOccupancy.set(batch, new Set());

    for (const a of assignments) {
      // 1. No batch double booking
      const bSet = batchOccupancy.get(batch)!;
      expect(bSet.has(a.timeslotId), `Batch ${batch} double booked at slot ${a.timeslotId}`).toBe(false);
      bSet.add(a.timeslotId);

      // 2. No faculty double booking
      if (a.facultyId) {
        if (!facultyOccupancy.has(a.facultyId)) facultyOccupancy.set(a.facultyId, new Set());
        const fSet = facultyOccupancy.get(a.facultyId)!;
        expect(fSet.has(a.timeslotId), `Faculty ${a.facultyId} double booked at slot ${a.timeslotId}`).toBe(false);
        fSet.add(a.timeslotId);
      }

      // 3. No room double booking
      if (a.room && a.room !== 'N/A') {
        if (!roomOccupancy.has(a.room)) roomOccupancy.set(a.room, new Set());
        const rSet = roomOccupancy.get(a.room)!;
        expect(rSet.has(a.timeslotId), `Room ${a.room} double booked at slot ${a.timeslotId}`).toBe(false);
        rSet.add(a.timeslotId);
      }

      // 4. Break protection
      const slot = solution.timeslots.find((t) => t.id === a.timeslotId);
      expect(slot?.isBreak ?? false, `Session scheduled during break slot ${a.timeslotId}`).toBe(false);
    }
  }
}

describe('Golden Test Suite (25 Instances with Known Feasibility)', () => {
  // 1-5: Tiny Feasible Instances
  for (let i = 1; i <= 5; i++) {
    it(`Instance T${i} [Tiny Feasible]: seed ${100 + i}`, () => {
      const { config, expectedFeasible } = generateInstance({
        seed: 100 + i,
        tier: 'tiny',
      });
      expect(expectedFeasible).toBe(true);

      const result = solveSchedule(config);
      expect(result.solution, `Expected feasible solution for Tiny instance T${i}`).not.toBeNull();
      if (result.solution) {
        verifyHardConstraints(result.solution);
      }
    });
  }

  // 6-10: School Feasible Instances
  for (let i = 1; i <= 5; i++) {
    it(`Instance S${i} [School Feasible]: seed ${200 + i}`, () => {
      const { config, expectedFeasible } = generateInstance({
        seed: 200 + i,
        tier: 'school',
      });
      expect(expectedFeasible).toBe(true);

      const result = solveSchedule(config);
      expect(result.solution, `Expected feasible solution for School instance S${i}`).not.toBeNull();
      if (result.solution) {
        verifyHardConstraints(result.solution);
      }
    });
  }

  // 11-15: College Feasible Instances
  for (let i = 1; i <= 5; i++) {
    it(`Instance C${i} [College Feasible with Electives]: seed ${300 + i}`, () => {
      const { config, expectedFeasible } = generateInstance({
        seed: 300 + i,
        tier: 'college',
        batchesCount: 4,
        facultyCount: 8,
        includeElectives: true,
      });
      expect(expectedFeasible).toBe(true);

      const result = solveSchedule(config);
      expect(result.solution, `Expected feasible solution for College instance C${i}`).not.toBeNull();
      if (result.solution) {
        verifyHardConstraints(result.solution);
      }
    });
  }

  // 16-20: Coaching / Exam-style Instances
  for (let i = 1; i <= 5; i++) {
    it(`Instance E${i} [Coaching/Exam Compact]: seed ${400 + i}`, () => {
      const { config, expectedFeasible } = generateInstance({
        seed: 400 + i,
        tier: 'tiny',
        days: ['Saturday', 'Sunday'],
        maxClassesPerDay: 5,
      });
      expect(expectedFeasible).toBe(true);

      const result = solveSchedule(config);
      expect(result.solution, `Expected feasible solution for Coaching instance E${i}`).not.toBeNull();
      if (result.solution) {
        verifyHardConstraints(result.solution);
      }
    });
  }

  // 21-25: Evil / Infeasible Instances (must fail gracefully and explain)
  const evilVariants: Array<'faculty_overload' | 'no_rooms' | 'capacity_exceeded' | 'pigeonhole'> = [
    'faculty_overload',
    'no_rooms',
    'capacity_exceeded',
    'pigeonhole',
    'faculty_overload',
  ];

  for (let i = 1; i <= 5; i++) {
    const variant = evilVariants[i - 1];
    it(`Instance X${i} [Evil Infeasible: ${variant}]: seed ${500 + i}`, () => {
      const { config, expectedFeasible } = generateInstance({
        seed: 500 + i,
        tier: 'evil',
        makeInfeasible: variant,
      });
      expect(expectedFeasible).toBe(false);

      const solver = new TimetableSolver(config);
      solver.init();
      const solution = solver.solve();
      const diagnostics = solver.getDiagnostics();

      // Either solution is null or diagnostics report the exact collision
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0].reason.length).toBeGreaterThan(5);
    });
  }
});
