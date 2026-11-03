import crypto from 'crypto';
import path from 'path';
import { Worker } from 'worker_threads';
import { Response } from 'express';
import { SchedulerInputState, ScheduleSolution, FailureDiagnostic } from '@ibp/shared';
import { TimetableSolver } from '@ibp/solver-ts';

export interface JobState {
  id: string;
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'error';
  placedSessions: number;
  totalSessions: number;
  engineUsed: 'ts' | 'python';
  solution?: ScheduleSolution;
  diagnostics?: FailureDiagnostic[];
  error?: string;
  createdAt: Date;
}

export interface JobOptions {
  engine?: 'auto' | 'ts' | 'python';
  maxAttempts?: number;
  timeoutSeconds?: number;
}

// In-memory jobs store
const jobsStore = new Map<string, { state: JobState; sseClients: Response[] }>();
// Map to track active worker threads for execution cancellation
const activeWorkers = new Map<string, Worker>();
// Map to track abort controllers for Python HTTP calls
const activeHttpAbortControllers = new Map<string, AbortController>();

const PYTHON_SOLVER_URL = process.env.PYTHON_SOLVER_URL || 'http://localhost:8000';

// Cleanup jobs older than 1 hour periodically
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobsStore.entries()) {
    if (job.state.createdAt.getTime() < oneHourAgo) {
      jobsStore.delete(id);
    }
  }
}, 10 * 60 * 1000);

/**
 * Emit Server-Sent Events (SSE) to all connected clients for a job.
 */
function emitSSE(jobId: string, eventName: string, data: any) {
  const job = jobsStore.get(jobId);
  if (!job || job.sseClients.length === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of [...job.sseClients]) {
    try {
      client.write(payload);
      if (eventName === 'complete' || eventName === 'error') {
        client.end();
      }
    } catch {
      // Remove disconnected client
      job.sseClients = job.sseClients.filter((c) => c !== client);
    }
  }
}

/**
 * Run solver inline on main thread (TypeScript fallback).
 */
function runSolverInline(state: SchedulerInputState, jobState: JobState, jobId: string) {
  process.nextTick(() => {
    try {
      if ((jobState.status as any) === 'cancelled') return;

      jobState.engineUsed = 'ts';
      const solver = new TimetableSolver(state);
      solver.init();

      const solution = solver.solve((placed, total) => {
        if ((jobState.status as any) === 'cancelled') return;
        jobState.placedSessions = placed;
        jobState.totalSessions = total;
        emitSSE(jobId, 'progress', { placedSessions: placed, totalSessions: total });
      });

      if ((jobState.status as any) === 'cancelled') return;

      const diagnostics = solver.getDiagnostics();
      if (solution && diagnostics.length === 0) {
        jobState.status = 'success';
        jobState.solution = solution;
        emitSSE(jobId, 'complete', { status: 'success', solution });
      } else {
        jobState.status = 'failed';
        jobState.solution = solution || solver.getBestPartialSolution();
        jobState.diagnostics = diagnostics;
        emitSSE(jobId, 'complete', { status: 'failed', solution: jobState.solution, diagnostics });
      }
    } catch (err: any) {
      if ((jobState.status as any) === 'cancelled') return;
      console.error(`Solver runtime error in job ${jobId}:`, err);
      jobState.status = 'error';
      jobState.error = err.message || String(err);
      emitSSE(jobId, 'error', { error: jobState.error });
    }
  });
}

/**
 * Delegate to Python CP-SAT solver service via HTTP.
 */
async function runPythonSolver(
  state: SchedulerInputState,
  jobState: JobState,
  jobId: string,
  options?: JobOptions
): Promise<boolean> {
  const controller = new AbortController();
  activeHttpAbortControllers.set(jobId, controller);
  const timeoutId = setTimeout(() => controller.abort(), (options?.timeoutSeconds || 30) * 1000);

  try {
    const res = await fetch(`${PYTHON_SOLVER_URL}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state,
        timeLimitSeconds: options?.timeoutSeconds || 20,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    activeHttpAbortControllers.delete(jobId);

    if (!res.ok) {
      throw new Error(`Python solver HTTP ${res.status}: ${res.statusText}`);
    }

    const data: any = await res.json();
    if ((jobState.status as any) === 'cancelled') return true;

    jobState.engineUsed = 'python';
    jobState.solution = data.solution;
    jobState.diagnostics = data.diagnostics || [];
    jobState.placedSessions = data.solution?.metrics?.placedCount || jobState.totalSessions;
    jobState.status = data.status === 'success' ? 'success' : 'failed';

    emitSSE(jobId, 'complete', {
      status: jobState.status,
      solution: jobState.solution,
      diagnostics: jobState.diagnostics,
      engine: 'python',
    });

    return true;
  } catch (err: any) {
    clearTimeout(timeoutId);
    activeHttpAbortControllers.delete(jobId);

    if ((jobState.status as any) === 'cancelled') return true;

    console.warn(`[Solver Delegation] Python solver at ${PYTHON_SOLVER_URL} unavailable or failed: ${err.message}. Falling back gracefully to TypeScript solver.`);
    return false;
  }
}

/**
 * Execute job scheduling using either Python solver or TypeScript fallback.
 */
async function executeJob(
  state: SchedulerInputState,
  jobState: JobState,
  jobId: string,
  options?: JobOptions
) {
  const wantsPython = options?.engine === 'python' || (options?.engine !== 'ts' && state.batches.length > 10);

  if (wantsPython) {
    const pythonSuccess = await runPythonSolver(state, jobState, jobId, options);
    if (pythonSuccess) return;
  }

  // Fallback to TypeScript Solver
  jobState.engineUsed = 'ts';
  runSolverInline(state, jobState, jobId);
}

/**
 * Creates and starts a new scheduling job.
 */
export function createJob(state: SchedulerInputState, options?: JobOptions): string {
  const jobId = crypto.randomUUID();
  const totalSessions = state.subjects.reduce((sum, s) => sum + s.classesPerWeek, 0);

  const jobState: JobState = {
    id: jobId,
    status: 'running',
    placedSessions: 0,
    totalSessions,
    engineUsed: options?.engine === 'python' ? 'python' : 'ts',
    createdAt: new Date(),
  };

  const job = { state: jobState, sseClients: [] as Response[] };
  jobsStore.set(jobId, job);

  // Run execution asynchronously
  executeJob(state, jobState, jobId, options).catch((err) => {
    console.error(`Unhandled error executing job ${jobId}:`, err);
    jobState.status = 'error';
    jobState.error = err.message || String(err);
    emitSSE(jobId, 'error', { error: jobState.error });
  });

  return jobId;
}

/**
 * Retrieve status of a job.
 */
export function getJob(jobId: string): JobState | null {
  const job = jobsStore.get(jobId);
  return job ? job.state : null;
}

/**
 * Subscribe an Express response to real-time Server-Sent Events.
 */
export function subscribeJobEvents(jobId: string, res: Response): boolean {
  const job = jobsStore.get(jobId);
  if (!job) return false;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial state immediately
  res.write(`event: progress\ndata: ${JSON.stringify({
    placedSessions: job.state.placedSessions,
    totalSessions: job.state.totalSessions,
    status: job.state.status,
    engine: job.state.engineUsed,
  })}\n\n`);

  if (job.state.status !== 'running') {
    res.write(`event: complete\ndata: ${JSON.stringify({
      status: job.state.status,
      solution: job.state.solution,
      diagnostics: job.state.diagnostics,
      error: job.state.error,
    })}\n\n`);
    res.end();
    return true;
  }

  job.sseClients.push(res);

  reqCloseHandler(res, () => {
    job.sseClients = job.sseClients.filter((c) => c !== res);
  });

  return true;
}

function reqCloseHandler(res: Response, onClose: () => void) {
  res.on('close', onClose);
}

/**
 * Cancel a running job.
 */
export function cancelJob(jobId: string): boolean {
  const job = jobsStore.get(jobId);
  if (!job) return false;

  if (job.state.status === 'running') {
    job.state.status = 'cancelled';

    // Abort python HTTP request if in flight
    const abortCtrl = activeHttpAbortControllers.get(jobId);
    if (abortCtrl) {
      abortCtrl.abort();
      activeHttpAbortControllers.delete(jobId);
    }

    // Terminate worker if running
    const worker = activeWorkers.get(jobId);
    if (worker) {
      worker.terminate().catch((err) => console.error('Failed to terminate worker:', err));
      activeWorkers.delete(jobId);
    }

    emitSSE(jobId, 'cancelled', { message: 'Job cancelled by user' });
    return true;
  }
  return false;
}
