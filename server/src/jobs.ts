import { Worker } from 'worker_threads';
import path from 'path';
import crypto from 'crypto';
import { SchedulerInputState, ScheduleSolution, FailureDiagnostic } from './types';

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
const jobsStore = new Map<string, { state: JobState; worker?: Worker }>();

// Cleanup jobs older than 1 hour periodically
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobsStore.entries()) {
    if (job.state.createdAt.getTime() < oneHourAgo) {
      if (job.state.status === 'running' && job.worker) {
        job.worker.terminate();
      }
      jobsStore.delete(id);
    }
  }
}, 10 * 60 * 1000);

export function createJob(state: SchedulerInputState): string {
  const jobId = crypto.randomUUID();
  
  // Decide worker entry file based on environment
  const isProd = __filename.endsWith('.js');
  const workerFile = isProd
    ? path.join(__dirname, 'scheduler', 'worker.js')
    : path.join(__dirname, 'scheduler', 'worker.ts');

  const execArgv = isProd ? [] : ['-r', 'ts-node/register'];

  const jobState: JobState = {
    id: jobId,
    status: 'running',
    placedSessions: 0,
    totalSessions: state.subjects.reduce((sum, s) => sum + s.classesPerWeek, 0),
    createdAt: new Date(),
  };

  try {
    const worker = new Worker(workerFile, {
      workerData: state,
      execArgv,
    });

    jobsStore.set(jobId, { state: jobState, worker });

    worker.on('message', (msg) => {
      const currentJob = jobsStore.get(jobId);
      if (!currentJob) return;

      if (msg.type === 'progress') {
        currentJob.state.placedSessions = msg.placed;
        currentJob.state.totalSessions = msg.total;
      } else if (msg.type === 'success') {
        currentJob.state.status = 'success';
        currentJob.state.solution = msg.solution;
        currentJob.worker = undefined;
        worker.terminate();
      } else if (msg.type === 'failed') {
        currentJob.state.status = 'failed';
        currentJob.state.solution = msg.solution; // return best partial
        currentJob.state.diagnostics = msg.diagnostics;
        currentJob.worker = undefined;
        worker.terminate();
      } else if (msg.type === 'error') {
        currentJob.state.status = 'error';
        currentJob.state.error = msg.error;
        currentJob.worker = undefined;
        worker.terminate();
      }
    });

    worker.on('error', (err) => {
      console.error(`Worker error in job ${jobId}:`, err);
      const currentJob = jobsStore.get(jobId);
      if (currentJob) {
        currentJob.state.status = 'error';
        currentJob.state.error = err.message || String(err);
        currentJob.worker = undefined;
      }
    });

    worker.on('exit', (code) => {
      const currentJob = jobsStore.get(jobId);
      if (currentJob && currentJob.state.status === 'running') {
        currentJob.state.status = 'error';
        currentJob.state.error = `Worker process exited with code ${code}`;
        currentJob.worker = undefined;
      }
    });

  } catch (error: any) {
    jobState.status = 'error';
    jobState.error = error?.message || String(error);
    jobsStore.set(jobId, { state: jobState });
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

  if (job.state.status === 'running' && job.worker) {
    job.worker.terminate();
    job.state.status = 'cancelled';
    job.worker = undefined;
    return true;
  }
  return false;
}
