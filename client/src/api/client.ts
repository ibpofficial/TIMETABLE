/**
 * Express API client — only handles solver jobs and AI proxy calls.
 * All data persistence (configs, timetables) is now done directly
 * through Firebase Firestore via src/lib/firestore.ts.
 */

import type { JobState, SchedulerConfig } from '../types';

const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Solver Jobs ─────────────────────────────────────────────────────────────
export async function startGeneration(state: SchedulerConfig): Promise<{ jobId: string }> {
  return request('/schedule/generate', { method: 'POST', body: JSON.stringify(state) });
}

export async function pollJob(jobId: string): Promise<JobState> {
  return request(`/schedule/jobs/${jobId}`);
}

export async function cancelJob(jobId: string): Promise<{ message: string }> {
  return request(`/schedule/jobs/${jobId}/cancel`, { method: 'POST' });
}

// ── AI Copilot ─────────────────────────────────────────────────────────────
export async function fetchAiTip(eventName: string, payload: unknown, context: unknown): Promise<{ reply: string }> {
  return request('/ai/tip', { method: 'POST', body: JSON.stringify({ eventName, payload, context }) });
}

export async function fetchAiSuggestFix(diagnostics: unknown[], context: unknown): Promise<{ suggestions: string }> {
  return request('/ai/suggest-fix', { method: 'POST', body: JSON.stringify({ diagnostics, context }) });
}

export async function fetchAiAgent(
  messages: Array<{ role: string; content: string }>,
  storeState: unknown
): Promise<{ reply: string; toolsUsed: string[] }> {
  return request('/ai/agent', { method: 'POST', body: JSON.stringify({ messages, storeState }) });
}
