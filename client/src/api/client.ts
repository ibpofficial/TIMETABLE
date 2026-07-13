/// <reference types="vite/client" />
import type { JobState, SchedulerConfig } from '../types';
import { TimetableSolver } from '../scheduler/solver';

// Client-side in-memory job store and workers registry
const clientJobs = new Map<string, JobState>();
const clientWorkers = new Map<string, Worker>();

// Helper to run solver inline on the main thread (fallback if Workers are not supported)
function runSolverInline(state: SchedulerConfig, jobId: string) {
  setTimeout(() => {
    const jobState = clientJobs.get(jobId);
    if (!jobState || jobState.status === 'cancelled') return;

    try {
      const solver = new TimetableSolver(state);
      solver.init();

      const solution = solver.solve((placed, total) => {
        const currentJob = clientJobs.get(jobId);
        if (currentJob && currentJob.status === 'running') {
          currentJob.placedSessions = placed;
          currentJob.totalSessions = total;
        }
      });

      const currentJob = clientJobs.get(jobId);
      if (!currentJob || currentJob.status === 'cancelled') return;

      const diagnostics = solver.getDiagnostics();
      if (solution && diagnostics.length === 0) {
        currentJob.status = 'success';
        currentJob.solution = solution;
      } else {
        currentJob.status = 'failed';
        currentJob.solution = solution || solver.getBestPartialSolution();
        currentJob.diagnostics = diagnostics;
      }
    } catch (err: any) {
      const currentJob = clientJobs.get(jobId);
      if (currentJob) {
        currentJob.status = 'error';
        currentJob.error = err.message || String(err);
      }
    }
  }, 0);
}

// ── Solver Jobs ─────────────────────────────────────────────────────────────

export async function startGeneration(state: SchedulerConfig): Promise<{ jobId: string }> {
  const jobId = `job_${Math.random().toString(36).slice(2, 9)}`;
  const total = state.subjects.reduce((sum, s) => sum + s.classesPerWeek, 0);

  const jobState: JobState = {
    id: jobId,
    status: 'running',
    placedSessions: 0,
    totalSessions: total,
  };

  clientJobs.set(jobId, jobState);

  try {
    // Instantiate Web Worker using ESM URL syntax
    const worker = new Worker(
      new URL('../scheduler/worker.ts', import.meta.url),
      { type: 'module' }
    );

    clientWorkers.set(jobId, worker);

    worker.onmessage = (e) => {
      const currentJob = clientJobs.get(jobId);
      if (!currentJob || currentJob.status === 'cancelled') {
        worker.terminate();
        clientWorkers.delete(jobId);
        return;
      }

      const msg = e.data;
      if (msg.type === 'progress') {
        currentJob.placedSessions = msg.placed;
        currentJob.totalSessions = msg.total;
      } else if (msg.type === 'success') {
        currentJob.status = 'success';
        currentJob.solution = msg.solution;
        worker.terminate();
        clientWorkers.delete(jobId);
      } else if (msg.type === 'failed') {
        currentJob.status = 'failed';
        currentJob.solution = msg.solution;
        currentJob.diagnostics = msg.diagnostics;
        worker.terminate();
        clientWorkers.delete(jobId);
      } else if (msg.type === 'error') {
        currentJob.status = 'error';
        currentJob.error = msg.error;
        worker.terminate();
        clientWorkers.delete(jobId);
      }
    };

    worker.onerror = (err) => {
      console.warn('Web Worker crashed, falling back to main-thread solver:', err);
      const currentJob = clientJobs.get(jobId);
      if (currentJob && currentJob.status === 'running') {
        runSolverInline(state, jobId);
      }
      clientWorkers.delete(jobId);
    };

    // Start execution
    worker.postMessage(state);

  } catch (err) {
    console.warn('Failed to start Web Worker, falling back to main-thread solver:', err);
    runSolverInline(state, jobId);
  }

  return { jobId };
}

export async function pollJob(jobId: string): Promise<JobState> {
  const job = clientJobs.get(jobId);
  if (!job) {
    throw new Error('Job not found.');
  }
  // Return a copy of the job state to ensure React triggers state changes cleanly
  return { ...job };
}

export async function cancelJob(jobId: string): Promise<{ message: string }> {
  const job = clientJobs.get(jobId);
  if (job && job.status === 'running') {
    job.status = 'cancelled';
    const worker = clientWorkers.get(jobId);
    if (worker) {
      worker.terminate();
      clientWorkers.delete(jobId);
    }
    return { message: 'Job cancellation requested.' };
  }
  throw new Error('Unable to cancel job (either not running or not found).');
}

// ── AI Gateway Proxy Calls ───────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function fetchAiTip(eventName: string, payload: unknown, context: unknown, signal?: AbortSignal): Promise<{ reply: string }> {
  const response = await fetch(`${API_BASE}/api/ai/tip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ eventName, payload, context }),
    signal,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `AI request failed: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchAiSuggestFix(diagnostics: unknown[], context: unknown, signal?: AbortSignal): Promise<{ suggestions: string }> {
  const response = await fetch(`${API_BASE}/api/ai/suggest-fix`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ diagnostics, context }),
    signal,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `AI request failed: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchAiAgent(
  messages: Array<{ role: string; content: string }>,
  storeState: unknown,
  signal?: AbortSignal
): Promise<{ reply: string; toolsUsed: string[] }> {
  const response = await fetch(`${API_BASE}/api/ai/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages, storeState }),
    signal,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `AI Agent request failed: ${response.statusText}`);
  }

  return response.json();
}

