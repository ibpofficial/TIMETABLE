/// <reference types="vite/client" />
import type { SchedulerConfig, ScheduleSolution, SavedConfig } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Helper to make API calls to local SQLite backend
async function fetchApi(url: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Request failed: ${response.statusText}`);
  }

  return response.json();
}

// ── Saved Configs ─────────────────────────────────────────────────────────────

export async function fsListConfigs(sessionId: string): Promise<SavedConfig[]> {
  return fetchApi(`/api/configs?sessionId=${encodeURIComponent(sessionId)}`);
}

export async function fsSaveConfig(
  name: string,
  data: SchedulerConfig,
  sessionId: string
): Promise<{ id: string; name: string }> {
  return fetchApi('/api/configs', {
    method: 'POST',
    body: JSON.stringify({ name, data, sessionId }),
  });
}

export async function fsLoadConfig(
  id: string
): Promise<{ id: string; name: string; data: SchedulerConfig }> {
  return fetchApi(`/api/configs/${encodeURIComponent(id)}`);
}

export async function fsDeleteConfig(id: string): Promise<void> {
  await fetchApi(`/api/configs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fsUpdateConfig(id: string, name: string, data: SchedulerConfig): Promise<void> {
  await fetchApi(`/api/configs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ name, data }),
  });
}

// ── Saved Timetables ──────────────────────────────────────────────────────────

export async function fsSaveTimetable(
  name: string,
  configId: string,
  data: ScheduleSolution,
  sessionId: string
): Promise<{ id: string; name: string }> {
  return fetchApi('/api/timetables', {
    method: 'POST',
    body: JSON.stringify({ name, configId, data, sessionId }),
  });
}

export async function fsLoadTimetable(
  id: string
): Promise<{ id: string; name: string; configId: string; data: ScheduleSolution }> {
  return fetchApi(`/api/timetables/${encodeURIComponent(id)}`);
}

export async function fsListTimetables(sessionId: string): Promise<{ id: string; name: string; configId: string; createdAt: string }[]> {
  return fetchApi(`/api/timetables?sessionId=${encodeURIComponent(sessionId)}`);
}

export async function fsDeleteTimetable(id: string): Promise<void> {
  await fetchApi(`/api/timetables/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
