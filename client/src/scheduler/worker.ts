import { TimetableSolver } from './solver';
import type { SchedulerConfig } from '../types';

self.onmessage = (e: MessageEvent<SchedulerConfig>) => {
  try {
    const config = e.data;
    const solver = new TimetableSolver(config);
    solver.init();

    const total = config.subjects.reduce((sum, s) => sum + s.classesPerWeek, 0);

    // Initial progress report
    self.postMessage({ type: 'progress', placed: 0, total });

    const solution = solver.solve((placed, totalCount) => {
      self.postMessage({ type: 'progress', placed, total: totalCount });
    });

    const diagnostics = solver.getDiagnostics();
    if (solution && diagnostics.length === 0) {
      self.postMessage({ type: 'success', solution });
    } else {
      self.postMessage({
        type: 'failed',
        solution: solution || solver.getBestPartialSolution(),
        diagnostics,
      });
    }
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      error: err.message || String(err)
    });
  }
};
