/**
 * Firestore persistence layer — replaces the Prisma/SQLite Express routes.
 * All saved configs and timetables are stored directly in Firestore from
 * the client, making the app work everywhere without a database server.
 *
 * Collections:
 *   savedConfigs/{docId}  → { name, sessionId, data (JSON string), createdAt, updatedAt }
 *   savedTimetables/{docId} → { name, sessionId, configId, data (JSON string), createdAt }
 */

import {
  collection, doc, addDoc, getDoc, getDocs,
  deleteDoc, updateDoc, query, where, orderBy,
  serverTimestamp, Timestamp
} from 'firebase/firestore';
import { db } from './firebase';
import type { SchedulerConfig, ScheduleSolution, SavedConfig } from '../types';

// ── Helper ────────────────────────────────────────────────────────────────────
function tsToIso(ts: any): string {
  if (!ts) return new Date().toISOString();
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  return String(ts);
}

// ── Saved Configs ─────────────────────────────────────────────────────────────

export async function fsListConfigs(sessionId: string): Promise<SavedConfig[]> {
  const q = query(
    collection(db, 'savedConfigs'),
    where('sessionId', '==', sessionId),
    orderBy('updatedAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({
    id: d.id,
    name: d.data().name,
    createdAt: tsToIso(d.data().createdAt),
    updatedAt: tsToIso(d.data().updatedAt),
  }));
}

export async function fsSaveConfig(
  name: string,
  data: SchedulerConfig,
  sessionId: string
): Promise<{ id: string; name: string }> {
  const docRef = await addDoc(collection(db, 'savedConfigs'), {
    name,
    sessionId,
    data: JSON.stringify(data),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: docRef.id, name };
}

export async function fsLoadConfig(
  id: string
): Promise<{ id: string; name: string; data: SchedulerConfig }> {
  const snap = await getDoc(doc(db, 'savedConfigs', id));
  if (!snap.exists()) throw new Error('Saved configuration not found.');
  const d = snap.data();
  return { id: snap.id, name: d.name, data: JSON.parse(d.data) };
}

export async function fsDeleteConfig(id: string): Promise<void> {
  await deleteDoc(doc(db, 'savedConfigs', id));
}

export async function fsUpdateConfig(id: string, name: string, data: SchedulerConfig): Promise<void> {
  await updateDoc(doc(db, 'savedConfigs', id), {
    name,
    data: JSON.stringify(data),
    updatedAt: serverTimestamp(),
  });
}

// ── Saved Timetables ──────────────────────────────────────────────────────────

export async function fsSaveTimetable(
  name: string,
  configId: string,
  data: ScheduleSolution,
  sessionId: string
): Promise<{ id: string; name: string }> {
  const docRef = await addDoc(collection(db, 'savedTimetables'), {
    name,
    sessionId,
    configId,
    data: JSON.stringify(data),
    createdAt: serverTimestamp(),
  });
  return { id: docRef.id, name };
}

export async function fsLoadTimetable(
  id: string
): Promise<{ id: string; name: string; configId: string; data: ScheduleSolution }> {
  const snap = await getDoc(doc(db, 'savedTimetables', id));
  if (!snap.exists()) throw new Error('Saved timetable not found.');
  const d = snap.data();
  return { id: snap.id, name: d.name, configId: d.configId, data: JSON.parse(d.data) };
}

export async function fsListTimetables(sessionId: string) {
  const q = query(
    collection(db, 'savedTimetables'),
    where('sessionId', '==', sessionId),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({
    id: d.id,
    name: d.data().name,
    configId: d.data().configId,
    createdAt: tsToIso(d.data().createdAt),
  }));
}

export async function fsDeleteTimetable(id: string): Promise<void> {
  await deleteDoc(doc(db, 'savedTimetables', id));
}
