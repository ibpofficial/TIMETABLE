import { describe, it, expect } from 'vitest';
import { runBenchmarks } from './run-benchmarks';

describe('Performance Benchmarks Runner', () => {
  it('executes suite and outputs BENCHMARKS.md and results.json', () => {
    const results = runBenchmarks();
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.hardConstraintPct).toBe(100);
      expect(r.timeToBestMs).toBeGreaterThan(0);
    }
  });
});

