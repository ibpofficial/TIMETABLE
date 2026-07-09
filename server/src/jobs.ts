import crypto from 'crypto';
import path from 'path';
import { Worker } from 'worker_threads';
import { SchedulerInputState, ScheduleSolution, FailureDiagnostic } from './types';
import { TimetableSolver } from './scheduler/solver';

export interface JobState {
  id: string;
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'error';
  placedSessions: number;
  totalSessions: number;
  solution?: ScheduleSolution;
  diagnostics?: FailureDiagnostic[];
  error?: string;
  createdAt: Date;
}

// In-memory jobs store
const jobsStore = new Map<string, { state: JobState }>();
// Map to track active worker threads for execution cancellation
const activeWorkers = new Map<string, Worker>();

// Cleanup jobs older than 1 hour periodically
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobsStore.entries()) {
    if (job.state.createdAt.getTime() < oneHourAgo) {
      jobsStore.delete(id);
    }
  }
}, 10 * 60 * 1000);

// Helper to run solver inline on the main thread (fallback)
function runSolverInline(state: SchedulerInputState, jobState: JobState, jobId: string) {
  process.nextTick(() => {
    try {
      if ((jobState.status as any) === 'cancelled') return;

      const solver = new TimetableSolver(state);
      solver.init();

      const solution = solver.solve((placed, total) => {
        if ((jobState.status as any) === 'cancelled') return;
        jobState.placedSessions = placed;
        jobState.totalSessions = total;
      });

      if ((jobState.status as any) === 'cancelled') return;

      const diagnostics = solver.getDiagnostics();
      if (solution && diagnostics.length === 0) {
        jobState.status = 'success';
        jobState.solution = solution;
      } else {
        jobState.status = 'failed';
        jobState.solution = solution || solver.getBestPartialSolution();
        jobState.diagnostics = diagnostics;
      }
    } catch (err: any) {
      if ((jobState.status as any) === 'cancelled') return;
      console.error(`Solver runtime error in job ${jobId}:`, err);
      jobState.status = 'error';
      jobState.error = err.message || String(err);
    }
  });
}

export function createJob(state: SchedulerInputState): string {
  const jobId = crypto.randomUUID();
  
  const jobState: JobState = {
    id: jobId,
    status: 'running',
    placedSessions: 0,
    totalSessions: state.subjects.reduce((sum, s) => sum + s.classesPerWeek, 0),
    createdAt: new Date(),
  };

  const job = { state: jobState };
  jobsStore.set(jobId, job);

  // Attempt to delegate to a worker thread for non-blocking execution
  try {
    const isTs = __filename.endsWith('.ts');
    const workerPath = isTs 
      ? path.resolve(__dirname, 'scheduler', 'worker.ts') 
      : path.resolve(__dirname, 'scheduler', 'worker.js');

    const worker = new Worker(workerPath, {
      workerData: state,
      execArgv: isTs ? ['-r', 'ts-node/register/transpile-only'] : undefined
    });

    activeWorkers.set(jobId, worker);

    worker.on('message', (msg) => {
      if ((jobState.status as any) === 'cancelled') {
        worker.terminate();
        activeWorkers.delete(jobId);
        return;
      }

      if (msg.type === 'progress') {
        jobState.placedSessions = msg.placed;
        jobState.totalSessions = msg.total;
      } else if (msg.type === 'success') {
        jobState.status = 'success';
        jobState.solution = msg.solution;
        activeWorkers.delete(jobId);
      } else if (msg.type === 'failed') {
        jobState.status = 'failed';
        jobState.solution = msg.solution;
        jobState.diagnostics = msg.diagnostics;
        activeWorkers.delete(jobId);
      } else if (msg.type === 'error') {
        jobState.status = 'error';
        jobState.error = msg.error;
        activeWorkers.delete(jobId);
      }
    });

    worker.on('error', (err) => {
      if ((jobState.status as any) === 'cancelled') return;
      console.warn(`Worker thread crashed or failed to start for job ${jobId}, falling back to main-thread solver:`, err);
      activeWorkers.delete(jobId);
      runSolverInline(state, jobState, jobId);
    });

    worker.on('exit', () => {
      activeWorkers.delete(jobId);
    });

  } catch (err) {
    console.warn(`Failed to spawn worker thread for job ${jobId}, falling back to main-thread solver:`, err);
    runSolverInline(state, jobState, jobId);
  }

  return jobId;
}

export function getJob(jobId: string): JobState | null {
  const job = jobsStore.get(jobId);
  return job ? job.state : null;
}

export function cancelJob(jobId: string): boolean {
  const job = jobsStore.get(jobId);
  if (!job) return false;

  if (job.state.status === 'running') {
    job.state.status = 'cancelled';
    const worker = activeWorkers.get(jobId);
    if (worker) {
      worker.terminate().catch((err) => console.error('Failed to terminate worker:', err));
      activeWorkers.delete(jobId);
    }
    return true;
  }
  return false;
}
