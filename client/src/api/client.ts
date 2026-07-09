import type { SchedulerConfig, JobState, SavedConfig, ScheduleSolution } from '../types';

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

// ── Schedule ──────────────────────────────────────────
export async function startGeneration(state: SchedulerConfig): Promise<{ jobId: string }> {
  return request('/schedule/generate', { method: 'POST', body: JSON.stringify(state) });
}

export async function pollJob(jobId: string): Promise<JobState> {
  return request(`/schedule/jobs/${jobId}`);
}

export async function cancelJob(jobId: string): Promise<{ message: string }> {
  return request(`/schedule/jobs/${jobId}/cancel`, { method: 'POST' });
}

// ── Saved Configs ──────────────────────────────────────
export async function listConfigs(sessionId: string): Promise<SavedConfig[]> {
  return request(`/configs?sessionId=${encodeURIComponent(sessionId)}`);
}

export async function saveConfig(name: string, data: SchedulerConfig, sessionId: string): Promise<{ id: string; name: string }> {
  return request('/configs', { method: 'POST', body: JSON.stringify({ name, data, sessionId }) });
}

export async function loadConfig(id: string): Promise<{ id: string; name: string; data: SchedulerConfig }> {
  return request(`/configs/${id}`);
}

export async function deleteConfig(id: string): Promise<{ success: boolean }> {
  return request(`/configs/${id}`, { method: 'DELETE' });
}

// ── Saved Timetables ───────────────────────────────────
export async function saveTimetable(name: string, configId: string, data: ScheduleSolution, sessionId: string) {
  return request('/timetables', { method: 'POST', body: JSON.stringify({ name, configId, data, sessionId }) });
}

// ── AI ─────────────────────────────────────────────────
export async function fetchAiTip(eventName: string, payload: unknown, context: unknown): Promise<{ reply: string }> {
  return request('/ai/tip', { method: 'POST', body: JSON.stringify({ eventName, payload, context }) });
}

export async function fetchAiSuggestFix(diagnostics: unknown[], context: unknown): Promise<{ suggestions: string }> {
  return request('/ai/suggest-fix', { method: 'POST', body: JSON.stringify({ diagnostics, context }) });
}
