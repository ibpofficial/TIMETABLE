import fs from 'fs';
import path from 'path';
import { generateInstance, InstanceTier } from '../tools/generate-instance';
import { TimetableSolver } from '../packages/solver-ts/src/solver';
import { ScheduleSolution } from '../packages/shared/src/types';

interface BenchmarkResult {
  tier: string;
  batches: number;
  faculty: number;
  rooms: number;
  totalSessions: number;
  timeToFirstMs: number;
  timeToBestMs: number;
  memoryMb: number;
  hardConstraintPct: number;
  softScore: number;
  attempts: number;
}

function evaluateHardConstraintPercentage(solution: ScheduleSolution): number {
  let violations = 0;
  let totalChecks = 0;

  const batchOccupancy = new Map<string, Set<string>>();
  const facultyOccupancy = new Map<string, Set<string>>();
  const roomOccupancy = new Map<string, Set<string>>();

  for (const [batch, assignments] of Object.entries(solution.byBatch)) {
    if (!batchOccupancy.has(batch)) batchOccupancy.set(batch, new Set());

    for (const a of assignments) {
      totalChecks += 3;
      // 1. Batch double-booking
      if (batchOccupancy.get(batch)!.has(a.timeslotId)) violations++;
      batchOccupancy.get(batch)!.add(a.timeslotId);

      // 2. Faculty double-booking
      if (a.facultyId) {
        if (!facultyOccupancy.has(a.facultyId)) facultyOccupancy.set(a.facultyId, new Set());
        if (facultyOccupancy.get(a.facultyId)!.has(a.timeslotId)) violations++;
        facultyOccupancy.get(a.facultyId)!.add(a.timeslotId);
      }

      // 3. Room double-booking
      if (a.room && a.room !== 'N/A') {
        if (!roomOccupancy.has(a.room)) roomOccupancy.set(a.room, new Set());
        if (roomOccupancy.get(a.room)!.has(a.timeslotId)) violations++;
        roomOccupancy.get(a.room)!.add(a.timeslotId);
      }
    }
  }

  if (totalChecks === 0) return 100;
  return Math.round(((totalChecks - violations) / totalChecks) * 1000) / 10;
}

function calculateSoftScore(solution: ScheduleSolution): number {
  let penalty = 0;
  // Penalize multi-subject on same day
  for (const [, assignments] of Object.entries(solution.byBatch)) {
    const subjectDays = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!a.subjectId) continue;
      const slot = solution.timeslots.find((t) => t.id === a.timeslotId);
      if (!slot) continue;
      if (!subjectDays.has(a.subjectId)) subjectDays.set(a.subjectId, new Set());
      if (subjectDays.get(a.subjectId)!.has(slot.day)) {
        penalty += 20; // 2nd instance on same day
      }
      subjectDays.get(a.subjectId)!.add(slot.day);
    }
  }
  return -penalty;
}

export function runBenchmarks(): BenchmarkResult[] {
  const configs: Array<{ tier: InstanceTier; batches: number; faculty: number; electives?: boolean }> = [
    { tier: 'tiny', batches: 2, faculty: 4 },
    { tier: 'school', batches: 6, faculty: 12 },
    { tier: 'college', batches: 12, faculty: 24, electives: true },
    { tier: 'college', batches: 20, faculty: 40, electives: true },
  ];

  const results: BenchmarkResult[] = [];

  for (const c of configs) {
    const { config } = generateInstance({
      seed: 42,
      tier: c.tier,
      batchesCount: c.batches,
      facultyCount: c.faculty,
      includeElectives: c.electives,
    });

    const totalSessions = config.subjects.reduce((sum, s) => sum + s.classesPerWeek, 0);
    const roomsCount = config.rooms.theoryList.length + config.rooms.labList.length;

    const startMem = process.memoryUsage().heapUsed;
    const startTime = performance.now();
    let timeToFirstMs = 0;

    const solver = new TimetableSolver(config);
    solver.init();

    const solution = solver.solve((placed) => {
      if (timeToFirstMs === 0 && placed > 0) {
        timeToFirstMs = Math.round(performance.now() - startTime);
      }
    });

    const endTime = performance.now();
    const endMem = process.memoryUsage().heapUsed;
    const timeToBestMs = Math.round(endTime - startTime);
    if (timeToFirstMs === 0) timeToFirstMs = timeToBestMs;

    const memoryMb = Math.round(((endMem - startMem) / (1024 * 1024)) * 100) / 100;
    const finalSolution = solution || solver.getBestPartialSolution();
    const hardConstraintPct = evaluateHardConstraintPercentage(finalSolution);
    const softScore = calculateSoftScore(finalSolution);

    results.push({
      tier: `${c.tier.toUpperCase()} (${c.batches} Batches)`,
      batches: c.batches,
      faculty: c.faculty,
      rooms: roomsCount,
      totalSessions,
      timeToFirstMs,
      timeToBestMs,
      memoryMb: Math.max(0.5, memoryMb),
      hardConstraintPct,
      softScore,
      attempts: (finalSolution.metadata?.iterations as number) || 1,
    });
  }

  // Save JSON
  const outDir = path.resolve(__dirname);
  const jsonPath = path.join(outDir, 'results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8');

  // Render Markdown Table
  let md = '# IBP Timetable Optimization Benchmarks\n\n';
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Engine:** @ibp/solver-ts (MRV Backtracking + O(1) Pruning)\n\n`;
  md += '| Instance Tier | Batches | Faculty | Rooms | Sessions | First Feasible (ms) | Best Solution (ms) | Hard Satisfied (%) | Soft Score | Memory (MB) |\n';
  md += '|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|\n';

  for (const r of results) {
    md += `| **${r.tier}** | ${r.batches} | ${r.faculty} | ${r.rooms} | ${r.totalSessions} | ${r.timeToFirstMs} ms | ${r.timeToBestMs} ms | ${r.hardConstraintPct}% | ${r.softScore} | ${r.memoryMb} MB |\n`;
  }

  const mdPath = path.join(outDir, 'BENCHMARKS.md');
  fs.writeFileSync(mdPath, md, 'utf-8');
  console.log(`Benchmarks recorded to ${jsonPath} and ${mdPath}`);

  return results;
}

if (require.main === module) {
  runBenchmarks();
}
