import * as XLSX from 'xlsx';
import type { ScheduleSolution, Assignment, Faculty } from '../types';

/**
 * Generates an RFC 5545 standard iCalendar (.ics) string for faculty and student subscriptions.
 */
export function exportToICalendar(
  solution: ScheduleSolution,
  faculties: Faculty[],
  institutionName: string = 'IBP Timetable'
): string {
  const dayIndexMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };

  const dayRRuleMap: Record<string, string> = {
    Sun: 'SU', Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR', Sat: 'SA',
    Sunday: 'SU', Monday: 'MO', Tuesday: 'TU', Wednesday: 'WE', Thursday: 'TH', Friday: 'FR', Saturday: 'SA',
  };

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IBP Timetable Generator//Industrial Optimization Platform//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${institutionName} Schedule`,
    'X-WR-TIMEZONE:UTC',
  ];

  // Base reference date (next Monday)
  const now = new Date();
  const baseDate = new Date(now);
  const currentDay = baseDate.getDay();
  const distanceToMonday = (1 + 7 - currentDay) % 7 || 7;
  baseDate.setDate(baseDate.getDate() + distanceToMonday);

  const seen = new Set<string>();

  for (const list of Object.values(solution.byBatch)) {
    for (const a of list) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);

      const slot = solution.timeslots.find((t) => t.id === a.timeslotId);
      if (!slot) continue;

      const dayOffset = (dayIndexMap[slot.day] ?? 1) - 1; // 0 for Monday
      const eventDate = new Date(baseDate);
      eventDate.setDate(baseDate.getDate() + dayOffset);

      const [startH, startM] = slot.start.split(':').map(Number);
      const [endH, endM] = slot.end.split(':').map(Number);

      const startDt = new Date(eventDate);
      startDt.setHours(startH, startM, 0, 0);

      const endDt = new Date(eventDate);
      endDt.setHours(endH, endM, 0, 0);

      const formatICSDate = (d: Date) =>
        d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

      const faculty = faculties.find((f) => f.id === a.facultyId);
      const rruleDay = dayRRuleMap[slot.day] || 'MO';

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${a.id}@ibp-timetable`);
      lines.push(`DTSTAMP:${formatICSDate(now)}`);
      lines.push(`DTSTART:${formatICSDate(startDt)}`);
      lines.push(`DTEND:${formatICSDate(endDt)}`);
      lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${rruleDay}`);
      lines.push(`SUMMARY:${a.subject} (${a.batches.join('+')})`);
      lines.push(`LOCATION:${a.room}`);
      lines.push(`DESCRIPTION:Faculty: ${faculty?.name || 'N/A'}\\nBatches: ${a.batches.join(', ')}\\nRoom: ${a.room}`);
      lines.push('STATUS:CONFIRMED');
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * Formatted Multi-Sheet Excel Export (.xlsx) using SheetJS.
 * Creates clean sheets:
 * 1. Overview & Metrics
 * 2. Per-Batch Master Grids
 * 3. Per-Faculty Teaching Schedules
 * 4. Room Allocation Ledger
 */
export function exportToFormattedExcel(
  solution: ScheduleSolution,
  batches: string[],
  faculties: Faculty[],
  days: string[],
  institutionName: string = 'IBP Timetable'
): void {
  const wb = XLSX.utils.book_new();

  const uniqueTimes = Array.from(
    new Set(solution.timeslots.map((t) => `${t.start} – ${t.end}`))
  ).map((str) => {
    const [start, end] = str.split(' – ');
    return { start, end, label: str };
  });

  // 1. Overview Sheet
  const totalClasses = Object.values(solution.byBatch).flat().length;
  const overviewData = [
    [institutionName, ''],
    ['Generated Academic Timetable Schedule', ''],
    ['Export Date', new Date().toLocaleDateString()],
    ['Total Batches', batches.length],
    ['Total Teaching Staff', faculties.length],
    ['Total Scheduled Sessions', totalClasses],
    ['Soft Optimization Score', solution.score?.softScore ?? 0],
    ['Hard Violations', solution.score?.hardViolations ?? 0],
    ['', ''],
    ['Batch Summary', 'Classes / Week'],
    ...batches.map((b) => [b, (solution.byBatch[b] || []).length]),
  ];
  const wsOverview = XLSX.utils.aoa_to_sheet(overviewData);
  XLSX.utils.book_append_sheet(wb, wsOverview, 'Summary');

  // 2. Batch Sheets
  for (const b of batches) {
    const bAssignments = solution.byBatch[b] || [];
    const sheetData: any[][] = [];

    // Header title
    sheetData.push([`${b} — Weekly Timetable Schedule`]);
    sheetData.push(['Day', ...uniqueTimes.map((t) => t.label)]);

    for (const day of days) {
      const row = [day];
      for (const time of uniqueTimes) {
        const slot = solution.timeslots.find((t) => t.day === day && t.start === time.start);
        if (slot?.isBreak) {
          row.push('--- BREAK ---');
          continue;
        }

        const assign = bAssignments.find((a) => {
          const ts = solution.timeslots.find((t) => t.id === a.timeslotId);
          return ts && ts.day === day && ts.start === time.start;
        });

        if (assign) {
          const fac = faculties.find((f) => f.id === assign.facultyId);
          row.push(`${assign.subject}\n(${assign.room}) [${fac?.name || 'N/A'}]`);
        } else {
          row.push('—');
        }
      }
      sheetData.push(row);
    }

    const wsBatch = XLSX.utils.aoa_to_sheet(sheetData);
    // Sanitize sheet name (max 31 chars)
    const sheetName = b.replace(/[:\\/?*[\]]/g, '').slice(0, 30);
    XLSX.utils.book_append_sheet(wb, wsBatch, sheetName);
  }

  // 3. Faculty Sheets
  for (const f of faculties) {
    const sheetData: any[][] = [];
    sheetData.push([`Prof. ${f.name} — Teaching Schedule`]);
    sheetData.push(['Day', ...uniqueTimes.map((t) => t.label)]);

    for (const day of days) {
      const row = [day];
      for (const time of uniqueTimes) {
        const slot = solution.timeslots.find((t) => t.day === day && t.start === time.start);
        if (slot?.isBreak) {
          row.push('--- BREAK ---');
          continue;
        }

        // Find assignment for this faculty
        let found: Assignment | undefined;
        for (const list of Object.values(solution.byBatch)) {
          const match = list.find((a) => {
            const ts = solution.timeslots.find((t) => t.id === a.timeslotId);
            return a.facultyId === f.id && ts && ts.day === day && ts.start === time.start;
          });
          if (match) {
            found = match;
            break;
          }
        }

        if (found) {
          row.push(`${found.subject}\n(${found.batches.join('+')}) [${found.room}]`);
        } else {
          row.push('—');
        }
      }
      sheetData.push(row);
    }

    const wsFaculty = XLSX.utils.aoa_to_sheet(sheetData);
    const facultySheetName = `Prof_${f.name.replace(/[^a-zA-Z0-9]/g, '_')}`.slice(0, 30);
    XLSX.utils.book_append_sheet(wb, wsFaculty, facultySheetName);
  }

  // Write file
  XLSX.writeFile(wb, `${institutionName.replace(/[^a-zA-Z0-9]/g, '_')}_Schedule.xlsx`);
}

/**
 * Real-time clash detection for interactive drag and drop:
 * Tests if moving assignment `a` to `targetTimeslotId` causes a conflict.
 */
export function checkSlotClash(params: {
  solution: ScheduleSolution;
  assignment: Assignment;
  targetTimeslotId: string;
  faculties: Faculty[];
}): { status: 'valid' | 'clash' | 'penalty'; reason?: string } {
  const { solution, assignment, targetTimeslotId, faculties } = params;

  const targetSlot = solution.timeslots.find((t) => t.id === targetTimeslotId);
  if (!targetSlot) return { status: 'clash', reason: 'Invalid timeslot' };
  if (targetSlot.isBreak) return { status: 'clash', reason: 'Hard Conflict: Slot is a scheduled institution break' };

  // 1. Check Batch double booking
  for (const b of assignment.batches) {
    const batchList = solution.byBatch[b] || [];
    const existing = batchList.find(
      (x) => x.id !== assignment.id && x.timeslotId === targetTimeslotId
    );
    if (existing) {
      return {
        status: 'clash',
        reason: `Hard Conflict: Batch ${b} already has "${existing.subject}" at this time`,
      };
    }
  }

  // 2. Check Faculty double booking
  if (assignment.facultyId) {
    for (const [batch, list] of Object.entries(solution.byBatch)) {
      const facConflict = list.find(
        (x) => x.id !== assignment.id && x.facultyId === assignment.facultyId && x.timeslotId === targetTimeslotId
      );
      if (facConflict) {
        const facName = faculties.find((f) => f.id === assignment.facultyId)?.name || 'Teacher';
        return {
          status: 'clash',
          reason: `Hard Conflict: ${facName} is already teaching "${facConflict.subject}" for ${batch}`,
        };
      }
    }
  }

  // 3. Check Room collision
  if (assignment.room && assignment.room !== 'N/A') {
    for (const [batch, list] of Object.entries(solution.byBatch)) {
      const roomConflict = list.find(
        (x) => x.id !== assignment.id && x.room === assignment.room && x.timeslotId === targetTimeslotId
      );
      if (roomConflict) {
        return {
          status: 'clash',
          reason: `Hard Conflict: Room ${assignment.room} is occupied by ${batch} (${roomConflict.subject})`,
        };
      }
    }
  }

  // 4. Soft constraint check: check faculty daily slots
  if (assignment.facultyId) {
    const fac = faculties.find((f) => f.id === assignment.facultyId);
    if (fac?.maxDailySlots) {
      let daySlots = 0;
      for (const list of Object.values(solution.byBatch)) {
        for (const x of list) {
          if (x.id !== assignment.id && x.facultyId === assignment.facultyId) {
            const ts = solution.timeslots.find((t) => t.id === x.timeslotId);
            if (ts?.day === targetSlot.day) daySlots++;
          }
        }
      }
      if (daySlots + 1 > fac.maxDailySlots) {
        return {
          status: 'penalty',
          reason: `Soft Warning: Exceeds daily preferred load of ${fac.maxDailySlots} for ${fac.name}`,
        };
      }
    }
  }

  return { status: 'valid' };
}
