import { parentPort, workerData } from 'worker_threads';
import { TimetableSolver } from './solver';
import { SchedulerInputState } from '../types';

if (!parentPort) {
  throw new Error('This file must be run as a worker thread.');
}

try {
  // Read state passed as workerData or message
  const state: SchedulerInputState = workerData;
  if (!state) {
    throw new Error('No scheduler state configuration provided to worker.');
  }

  const solver = new TimetableSolver(state);
  solver.init();

  const solution = solver.solve((placed, total) => {
    parentPort!.postMessage({
      type: 'progress',
      placed,
      total,
    });
  });

  if (solution) {
    parentPort.postMessage({
      type: 'success',
      solution,
    });
  } else {
    // If failed, return the best partial schedule and error diagnostics
    const partialSolution = solver.getBestPartialSolution();
    const diagnostics = solver.getDiagnostics();
    parentPort.postMessage({
      type: 'failed',
      solution: partialSolution,
      diagnostics,
    });
  }
} catch (error: any) {
  parentPort.postMessage({
    type: 'error',
    error: error?.message || String(error),
  });
}
