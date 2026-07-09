import crypto from 'crypto';
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

// In-memory job store
const jobsStore = new Map<string, { state: JobState }>();

// Cleanup jobs older than 1 hour periodically
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobsStore.entries()) {
    if (job.state.createdAt.getTime() < oneHourAgo) {
      jobsStore.delete(id);
    }
  }
}, 10 * 60 * 1000);

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

  // Execute solver in the next tick to prevent blocking the HTTP response
  process.nextTick(() => {
    try {
      const solver = new TimetableSolver(state);
      solver.init();

      const solution = solver.solve((placed, total) => {
        jobState.placedSessions = placed;
        jobState.totalSessions = total;
      });

      if (solution) {
        jobState.status = 'success';
        jobState.solution = solution;
      } else {
        jobState.status = 'failed';
        jobState.solution = solver.getBestPartialSolution();
        jobState.diagnostics = solver.getDiagnostics();
      }
    } catch (err: any) {
      console.error(`Solver runtime error in job ${jobId}:`, err);
      jobState.status = 'error';
      jobState.error = err.message || String(err);
    }
  });

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
    return true;
  }
  return false;
}
