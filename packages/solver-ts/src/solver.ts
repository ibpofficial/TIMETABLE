import {
  SchedulerInputState,
  Timeslot,
  Assignment,
  ScheduleSolution,
  FailureDiagnostic,
  Subject,
  Faculty,
  Room,
  ConstraintTemplate,
} from '@ibp/shared';

export interface TimeBlock {
  slots: Timeslot[];
  startMin: number;
  endMin: number;
  day: string;
}

export interface SessionVariable {
  id: string; // e.g. "S1_0"
  subject: Subject;
  length: number;
  batches: string[];
  studentGroups?: string[];
  facultyId: string | null;
  facultyIds: string[];
  roomType: 'theory' | 'practical';
  capacityRequirement?: number;
}

export interface DomainValue {
  timeBlock: TimeBlock;
  room: string;
}

export class TimetableSolver {
  private state: SchedulerInputState;
  private timeslots: Timeslot[] = [];
  private rooms: Room[] = [];
  private roomMap = new Map<string, Room>();
  private variables: SessionVariable[] = [];
  private varMap = new Map<string, SessionVariable>();
  private infeasibleVariables: SessionVariable[] = [];

  // Occupancies
  private batchOccupancy = new Map<string, Set<string>>(); // batch -> Set(timeslotId)
  private groupOccupancy = new Map<string, Set<string>>(); // group -> Set(timeslotId)
  private facultyOccupancy = new Map<string, Set<string>>(); // facultyId -> Set(timeslotId)
  private roomOccupancy = new Map<string, Set<string>>(); // roomId -> Set(timeslotId)

  // Load counters
  private batchDailyCount = new Map<string, Map<string, number>>(); // batch -> day -> count
  private facultyWeeklyCount = new Map<string, number>(); // facultyId -> count
  private facultyDailyCount = new Map<string, Map<string, number>>(); // facultyId -> day -> count

  // Fast indexing for soft constraints (O(1) lookups instead of scanning all variables)
  private subjectDayCounts = new Map<string, Map<string, number>>(); // subjectId -> day -> count
  private facultySlotStarts = new Map<string, Map<string, number[]>>(); // facultyId -> day -> startIndices

  // Soft weights lookup
  private softWeights: {
    balanceWeek: number;
    facultyGaps: number;
    batchSpread: number;
    heavyMorning: number;
  } = {
    balanceWeek: 50,
    facultyGaps: 60,
    batchSpread: 15,
    heavyMorning: 30,
  };

  // Solution tracking
  private initialAssignments: Assignment[] = [];
  private currentAssignments = new Map<string, DomainValue>();
  private bestAssignments = new Map<string, DomainValue>();
  private attempts = 0;
  private maxAttempts = 5000;

  // Domain cache
  private domains = new Map<string, DomainValue[]>();

  constructor(state: SchedulerInputState) {
    this.state = state;
    this.maxAttempts = state.options?.maxAttempts ?? 5000;
    this.extractWeights(state.constraints);
  }

  private extractWeights(constraints?: ConstraintTemplate[]) {
    if (!constraints) return;
    for (const c of constraints) {
      if (!c.enabled) continue;
      if (c.id === 'soft_balance_across_week') this.softWeights.balanceWeek = c.weight;
      if (c.id === 'soft_minimize_faculty_gaps') this.softWeights.facultyGaps = c.weight;
      if (c.id === 'soft_student_daily_load_spread') this.softWeights.batchSpread = c.weight;
      if (c.id === 'soft_heavy_subjects_morning') this.softWeights.heavyMorning = c.weight;
    }
  }

  private t2m(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  private m2t(m: number): string {
    const h = Math.floor(m / 60);
    const mins = m % 60;
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    return `${pad(h)}:${pad(mins)}`;
  }

  private buildTimeslots(): Timeslot[] {
    const list: Timeslot[] = [];
    let idCounter = 0;

    for (const day of this.state.days) {
      const start = this.t2m(this.state.startTime);
      const end = this.t2m(this.state.endTime);
      const step = this.state.slotLength;

      const dayBreaks = (this.state.breaks ?? [])
        .filter((b) => b.day === day)
        .map((b) => ({
          start: this.t2m(b.start),
          end: this.t2m(b.start) + b.durationMins,
        }));

      for (let m = start; m + step <= end; m += step) {
        const slotStart = m;
        const slotEnd = m + step;

        const slot: Timeslot = {
          id: `TS_${day}_${++idCounter}`,
          day,
          start: this.m2t(slotStart),
          end: this.m2t(slotEnd),
          startMin: slotStart,
          endMin: slotEnd,
          isBreak: false,
          index: list.length,
        };

        slot.isBreak = dayBreaks.some(
          (b) => !(slotEnd <= b.start || slotStart >= b.end)
        );

        list.push(slot);
      }
    }
    return list;
  }

  public init() {
    this.timeslots = this.buildTimeslots();

    this.rooms = [
      ...(this.state.rooms.theoryList ?? []).map((r) => ({ ...r, type: r.type || 'theory' })),
      ...(this.state.rooms.labList ?? []).map((r) => ({ ...r, type: r.type || 'practical' })),
    ];

    this.roomMap.clear();
    for (const r of this.rooms) {
      this.roomMap.set(r.id, r);
      this.roomOccupancy.set(r.id, new Set());
    }

    for (const b of this.state.batches) {
      this.batchOccupancy.set(b, new Set());
      const dailyMap = new Map<string, number>();
      for (const d of this.state.days) dailyMap.set(d, 0);
      this.batchDailyCount.set(b, dailyMap);
    }

    if (this.state.studentGroups) {
      for (const g of this.state.studentGroups) {
        this.groupOccupancy.set(g.id, new Set());
      }
    }

    for (const f of this.state.faculties) {
      this.facultyOccupancy.set(f.id, new Set());
      this.facultyWeeklyCount.set(f.id, 0);
      const dailyMap = new Map<string, number>();
      for (const d of this.state.days) dailyMap.set(d, 0);
      this.facultyDailyCount.set(f.id, dailyMap);

      const startsMap = new Map<string, number[]>();
      for (const d of this.state.days) startsMap.set(d, []);
      this.facultySlotStarts.set(f.id, startsMap);
    }

    for (const s of this.state.subjects) {
      const countsMap = new Map<string, number>();
      for (const d of this.state.days) countsMap.set(d, 0);
      this.subjectDayCounts.set(s.id, countsMap);
    }

    this.placeFixedEvents();

    this.variables = [];
    this.varMap.clear();

    for (const s of this.state.subjects) {
      const totalSessions = s.classesPerWeek;
      const facultyIds = s.facultyIds && s.facultyIds.length > 0
        ? s.facultyIds
        : (s.facultyId ? [s.facultyId] : []);

      for (let i = 0; i < totalSessions; i++) {
        const v: SessionVariable = {
          id: `${s.id}_S${i}`,
          subject: s,
          length: s.sessionLength,
          batches: s.batches,
          studentGroups: s.studentGroups,
          facultyId: s.facultyId,
          facultyIds,
          roomType: s.type,
          capacityRequirement: s.capacityRequirement,
        };
        this.variables.push(v);
        this.varMap.set(v.id, v);
      }
    }

    const searchableVars: SessionVariable[] = [];
    this.infeasibleVariables = [];

    for (const v of this.variables) {
      const domain = this.computeInitialDomain(v);
      this.domains.set(v.id, domain);
      if (domain.length > 0) {
        searchableVars.push(v);
      } else {
        this.infeasibleVariables.push(v);
      }
    }
    this.variables = searchableVars;
  }

  private placeFixedEvents() {
    if (!this.state.events) return;

    for (const ev of this.state.events) {
      const match = this.timeslots.find(
        (t) => t.day === ev.day && t.start === ev.start
      );
      if (!match) continue;

      for (let k = 0; k < ev.length; k++) {
        const slotIdx = match.index + k;
        if (slotIdx >= this.timeslots.length) break;
        const ts = this.timeslots[slotIdx];
        if (ts.day !== ev.day || ts.isBreak) break;

        const targetRooms = this.rooms.filter((r) => {
          if (ev.roomType === 'theory') {
            return ['theory', 'lecture_hall', 'seminar_room', 'auditorium'].includes(r.type);
          } else {
            return ['practical', 'lab', 'computer_lab', 'studio'].includes(r.type);
          }
        });

        let allocatedRoom = 'N/A';
        for (const room of targetRooms) {
          const occ = this.roomOccupancy.get(room.id);
          if (occ && !occ.has(ts.id)) {
            occ.add(ts.id);
            allocatedRoom = room.name;
            break;
          }
        }

        const batches = ev.batches && ev.batches.length > 0 ? ev.batches : this.state.batches;
        for (const batch of batches) {
          this.batchOccupancy.get(batch)?.add(ts.id);
        }

        if (ev.facultyId) {
          this.facultyOccupancy.get(ev.facultyId)?.add(ts.id);
        }

        this.initialAssignments.push({
          id: `fixed_${ev.name}_${ts.id}`,
          subjectId: null,
          subject: `[${ev.name}]`,
          facultyId: ev.facultyId || null,
          room: allocatedRoom,
          timeslotId: ts.id,
          length: 1,
          batches: [...batches],
        });
      }
    }
  }

  private computeInitialDomain(v: SessionVariable): DomainValue[] {
    const list: DomainValue[] = [];
    const possibleTimeBlocks = this.getTimeBlocks(v.length);
    const subject = v.subject;

    let compatibleRooms = this.rooms;
    if (subject.preferredRoomTypes && subject.preferredRoomTypes.length > 0) {
      compatibleRooms = compatibleRooms.filter((r) => subject.preferredRoomTypes!.includes(r.type));
    } else {
      if (v.roomType === 'theory') {
        compatibleRooms = compatibleRooms.filter((r) => ['theory', 'lecture_hall', 'seminar_room', 'auditorium'].includes(r.type));
      } else {
        compatibleRooms = compatibleRooms.filter((r) => ['practical', 'lab', 'computer_lab', 'studio'].includes(r.type));
      }
    }

    let totalStudents = 0;
    if (this.state.batchSizes) {
      for (const b of v.batches) {
        totalStudents += this.state.batchSizes[b] || 0;
      }
    }
    const capacityNeeded = Math.max(totalStudents, subject.capacityRequirement || 0);

    for (const tb of possibleTimeBlocks) {
      if (subject.fixed) {
        if (subject.fixedDay && tb.day !== subject.fixedDay) continue;
        if (subject.fixedStart && tb.slots[0].start !== subject.fixedStart) continue;
        if (subject.fixedLength && tb.slots.length !== subject.fixedLength) continue;
      }

      if (this.isSubjectUnavailable(subject, tb)) continue;

      let facultyBlocked = false;
      for (const fid of v.facultyIds) {
        const faculty = this.state.faculties.find((f) => f.id === fid);
        if (faculty && this.isFacultyUnavailable(faculty, tb)) {
          facultyBlocked = true;
          break;
        }
      }
      if (facultyBlocked) continue;

      for (const room of compatibleRooms) {
        if (capacityNeeded > 0 && room.capacity < capacityNeeded) continue;

        if (subject.requiredEquipment && subject.requiredEquipment.length > 0) {
          const roomEquipment = room.equipment || [];
          const hasAllEquipment = subject.requiredEquipment.every((eq) => roomEquipment.includes(eq));
          if (!hasAllEquipment) continue;
        }

        list.push({
          timeBlock: tb,
          room: room.id,
        });
      }
    }

    return list;
  }

  private getTimeBlocks(length: number): TimeBlock[] {
    const blocks: TimeBlock[] = [];
    for (let i = 0; i <= this.timeslots.length - length; i++) {
      const slots = this.timeslots.slice(i, i + length);
      const day = slots[0].day;

      const valid = slots.every((s) => s.day === day && !s.isBreak);
      if (!valid) continue;

      blocks.push({
        slots,
        startMin: slots[0].startMin,
        endMin: slots[slots.length - 1].endMin,
        day,
      });
    }
    return blocks;
  }

  private isSubjectUnavailable(sub: Subject, tb: TimeBlock): boolean {
    if (!sub.unavail || sub.unavail.length === 0) return false;
    return sub.unavail.some((u) => {
      if (u.day !== tb.day) return false;
      const uStart = this.t2m(u.start);
      const uEnd = this.t2m(u.end);
      return !(tb.endMin <= uStart || tb.startMin >= uEnd);
    });
  }

  private isFacultyUnavailable(fac: Faculty, tb: TimeBlock): boolean {
    if (!fac.unavail || fac.unavail.length === 0) return false;
    return fac.unavail.some((u) => {
      if (u.day !== tb.day) return false;
      const uStart = this.t2m(u.start);
      const uEnd = this.t2m(u.end);
      return !(tb.endMin <= uStart || tb.startMin >= uEnd);
    });
  }

  public solve(onProgress?: (placed: number, total: number) => void): ScheduleSolution | null {
    this.attempts = 0;
    this.currentAssignments.clear();
    this.bestAssignments.clear();

    const solveStart = this.backtrack(this.variables, onProgress);

    if (solveStart) {
      return this.buildResult(this.currentAssignments);
    }

    return null;
  }

  private backtrack(
    unassigned: SessionVariable[],
    onProgress?: (placed: number, total: number) => void
  ): boolean {
    this.attempts++;

    if (this.currentAssignments.size > this.bestAssignments.size) {
      this.bestAssignments = new Map(this.currentAssignments);
    }

    if (onProgress && this.attempts % 100 === 0) {
      onProgress(this.bestAssignments.size, this.variables.length);
    }

    if (this.attempts >= this.maxAttempts) {
      return false;
    }

    if (unassigned.length === 0) {
      return true;
    }

    // MRV with degree tie-breaker
    let bestVarIdx = -1;
    let minDomainSize = Infinity;

    for (let i = 0; i < unassigned.length; i++) {
      const v = unassigned[i];
      const domain = this.domains.get(v.id) ?? [];
      const validSize = domain.length;
      if (validSize < minDomainSize) {
        minDomainSize = validSize;
        bestVarIdx = i;
      } else if (validSize === minDomainSize && bestVarIdx !== -1) {
        const vDegree = (v.batches.length * 10) + v.length;
        const currentBestDegree = (unassigned[bestVarIdx].batches.length * 10) + unassigned[bestVarIdx].length;
        if (vDegree > currentBestDegree) {
          bestVarIdx = i;
        }
      }
    }

    if (bestVarIdx === -1) return false;
    const v = unassigned[bestVarIdx];

    const domain = this.domains.get(v.id) ?? [];
    if (domain.length === 0) {
      return false;
    }

    const rankedDomain = this.rankDomainValues(v, domain);

    const nextUnassigned = [
      ...unassigned.slice(0, bestVarIdx),
      ...unassigned.slice(bestVarIdx + 1),
    ];

    for (const val of rankedDomain) {
      if (!this.isConsistent(v, val)) {
        continue;
      }

      this.assign(v, val);

      const savedDomains = new Map<string, DomainValue[]>();
      let fcFailed = false;

      for (const uv of nextUnassigned) {
        const uvDomain = this.domains.get(uv.id) ?? [];
        const legalValues: DomainValue[] = [];

        for (const uvVal of uvDomain) {
          if (this.areConsistentTogether(v, val, uv, uvVal)) {
            legalValues.push(uvVal);
          }
        }

        savedDomains.set(uv.id, uvDomain);
        this.domains.set(uv.id, legalValues);

        if (legalValues.length === 0) {
          fcFailed = true;
          break;
        }
      }

      if (!fcFailed) {
        const success = this.backtrack(nextUnassigned, onProgress);
        if (success) return true;
      }

      for (const [id, dom] of savedDomains.entries()) {
        this.domains.set(id, dom);
      }

      this.unassign(v, val);
    }

    return false;
  }

  private rankDomainValues(v: SessionVariable, domain: DomainValue[]): DomainValue[] {
    if (domain.length <= 1) return domain;
    return [...domain].sort((a, b) => {
      const scoreA = this.evaluateValueSoftConstraints(v, a);
      const scoreB = this.evaluateValueSoftConstraints(v, b);
      return scoreB - scoreA;
    });
  }

  // O(1) indexed soft constraint evaluation
  private evaluateValueSoftConstraints(v: SessionVariable, val: DomainValue): number {
    let score = 0;
    const day = val.timeBlock.day;
    const startIdx = val.timeBlock.slots[0].index;

    // 1. Balance subject load across week
    const subjectSameDayCount = this.subjectDayCounts.get(v.subject.id)?.get(day) ?? 0;
    score -= subjectSameDayCount * this.softWeights.balanceWeek;

    // 2. Faculty daily gaps & spread
    for (const fid of v.facultyIds) {
      const starts = this.facultySlotStarts.get(fid)?.get(day) ?? [];
      if (starts.length > 0) {
        let closestDist = Infinity;
        for (const s of starts) {
          const d = Math.abs(startIdx - s);
          if (d < closestDist) closestDist = d;
        }
        if (closestDist === v.length) {
          score += this.softWeights.facultyGaps * 1.5; // Contiguous block
        } else if (closestDist <= 2) {
          score += this.softWeights.facultyGaps * 0.5; // Small gap
        } else {
          score -= this.softWeights.facultyGaps * 0.2; // Large gap
        }
      } else {
        const facultyDaily = this.facultyDailyCount.get(fid)?.get(day) ?? 0;
        score -= facultyDaily * 20;
      }
    }

    // 3. Batch daily load balance
    let batchMaxDailyLoad = 0;
    for (const batch of v.batches) {
      const currentLoad = this.batchDailyCount.get(batch)?.get(day) ?? 0;
      if (currentLoad > batchMaxDailyLoad) {
        batchMaxDailyLoad = currentLoad;
      }
    }
    score -= batchMaxDailyLoad * this.softWeights.batchSpread;

    // 4. Heavy subjects morning bonus
    if (v.subject.isHeavySubject) {
      if (val.timeBlock.slots[0].startMin < 13 * 60) {
        score += this.softWeights.heavyMorning;
      } else {
        score -= this.softWeights.heavyMorning;
      }
    }

    return score;
  }

  private isConsistent(v: SessionVariable, val: DomainValue): boolean {
    const day = val.timeBlock.day;
    const slots = val.timeBlock.slots;

    for (const batch of v.batches) {
      const dailyCount = this.batchDailyCount.get(batch)?.get(day) ?? 0;
      if (dailyCount + v.length > this.state.maxClassesPerDay) {
        return false;
      }
    }

    for (const fid of v.facultyIds) {
      const faculty = this.state.faculties.find((f) => f.id === fid);
      if (faculty) {
        const weeklyCount = this.facultyWeeklyCount.get(fid) ?? 0;
        if (weeklyCount + v.length > faculty.maxWeeklySlots) {
          return false;
        }

        if (faculty.maxDailySlots) {
          const dailyCount = this.facultyDailyCount.get(fid)?.get(day) ?? 0;
          if (dailyCount + v.length > faculty.maxDailySlots) {
            return false;
          }
        }
      }
    }

    for (const ts of slots) {
      for (const batch of v.batches) {
        if (this.batchOccupancy.get(batch)?.has(ts.id)) {
          return false;
        }
      }

      if (v.studentGroups) {
        for (const g of v.studentGroups) {
          if (this.groupOccupancy.get(g)?.has(ts.id)) {
            return false;
          }
        }
      }

      for (const fid of v.facultyIds) {
        if (this.facultyOccupancy.get(fid)?.has(ts.id)) {
          return false;
        }
      }

      if (this.roomOccupancy.get(val.room)?.has(ts.id)) {
        return false;
      }
    }

    return true;
  }

  private areConsistentTogether(
    v1: SessionVariable,
    val1: DomainValue,
    v2: SessionVariable,
    val2: DomainValue
  ): boolean {
    const slots1 = new Set(val1.timeBlock.slots.map((s) => s.id));
    const overlaps = val2.timeBlock.slots.some((s) => slots1.has(s.id));
    if (!overlaps) return true;

    if (val1.room === val2.room) return false;

    // Faculty conflict (check all co-teaching faculty)
    for (const f1 of v1.facultyIds) {
      if (v2.facultyIds.includes(f1)) return false;
    }

    // Batch conflict
    const batches1 = new Set(v1.batches);
    if (v2.batches.some((b) => batches1.has(b))) return false;

    // Subgroup conflict
    if (v1.studentGroups && v2.studentGroups) {
      const g1 = new Set(v1.studentGroups);
      if (v2.studentGroups.some((g) => g1.has(g))) return false;
    }

    return true;
  }

  private assign(v: SessionVariable, val: DomainValue) {
    const day = val.timeBlock.day;
    const slots = val.timeBlock.slots;
    const startIdx = slots[0].index;

    this.currentAssignments.set(v.id, val);

    for (const ts of slots) {
      for (const batch of v.batches) {
        this.batchOccupancy.get(batch)?.add(ts.id);
      }
      if (v.studentGroups) {
        for (const g of v.studentGroups) {
          this.groupOccupancy.get(g)?.add(ts.id);
        }
      }
      for (const fid of v.facultyIds) {
        this.facultyOccupancy.get(fid)?.add(ts.id);
      }
      this.roomOccupancy.get(val.room)?.add(ts.id);
    }

    for (const batch of v.batches) {
      const dailyMap = this.batchDailyCount.get(batch)!;
      dailyMap.set(day, dailyMap.get(day)! + v.length);
    }

    for (const fid of v.facultyIds) {
      this.facultyWeeklyCount.set(fid, (this.facultyWeeklyCount.get(fid) ?? 0) + v.length);
      const dailyMap = this.facultyDailyCount.get(fid)!;
      dailyMap.set(day, dailyMap.get(day)! + v.length);

      const starts = this.facultySlotStarts.get(fid)?.get(day);
      if (starts) starts.push(startIdx);
    }

    const sDayMap = this.subjectDayCounts.get(v.subject.id);
    if (sDayMap) sDayMap.set(day, (sDayMap.get(day) ?? 0) + 1);
  }

  private unassign(v: SessionVariable, val: DomainValue) {
    const day = val.timeBlock.day;
    const slots = val.timeBlock.slots;
    const startIdx = slots[0].index;

    this.currentAssignments.delete(v.id);

    for (const ts of slots) {
      for (const batch of v.batches) {
        this.batchOccupancy.get(batch)?.delete(ts.id);
      }
      if (v.studentGroups) {
        for (const g of v.studentGroups) {
          this.groupOccupancy.get(g)?.delete(ts.id);
        }
      }
      for (const fid of v.facultyIds) {
        this.facultyOccupancy.get(fid)?.delete(ts.id);
      }
      this.roomOccupancy.get(val.room)?.delete(ts.id);
    }

    for (const batch of v.batches) {
      const dailyMap = this.batchDailyCount.get(batch)!;
      dailyMap.set(day, dailyMap.get(day)! - v.length);
    }

    for (const fid of v.facultyIds) {
      this.facultyWeeklyCount.set(fid, (this.facultyWeeklyCount.get(fid) ?? 0) - v.length);
      const dailyMap = this.facultyDailyCount.get(fid)!;
      dailyMap.set(day, dailyMap.get(day)! - v.length);

      const starts = this.facultySlotStarts.get(fid)?.get(day);
      if (starts) {
        const idx = starts.indexOf(startIdx);
        if (idx !== -1) starts.splice(idx, 1);
      }
    }

    const sDayMap = this.subjectDayCounts.get(v.subject.id);
    if (sDayMap) sDayMap.set(day, Math.max(0, (sDayMap.get(day) ?? 0) - 1));
  }

  private buildResult(assignmentsMap: Map<string, DomainValue>): ScheduleSolution {
    const byBatch: Record<string, Assignment[]> = {};
    for (const b of this.state.batches) {
      byBatch[b] = [];
    }

    for (const fixed of this.initialAssignments) {
      for (const b of fixed.batches) {
        if (byBatch[b]) {
          byBatch[b].push(fixed);
        }
      }
    }

    for (const [vid, val] of assignmentsMap.entries()) {
      const v = this.varMap.get(vid);
      if (!v) continue;
      const roomObj = this.roomMap.get(val.room);
      const roomName = roomObj ? roomObj.name : val.room;

      for (const ts of val.timeBlock.slots) {
        const assignment: Assignment = {
          id: `${vid}_${ts.id}`,
          subjectId: v.subject.id,
          subject: v.subject.name,
          facultyId: v.facultyId,
          facultyIds: v.facultyIds,
          room: roomName,
          timeslotId: ts.id,
          length: 1,
          batches: v.batches,
          studentGroups: v.studentGroups,
          day: ts.day,
          startMin: ts.startMin,
          endMin: ts.endMin,
        };

        for (const batch of v.batches) {
          if (byBatch[batch]) {
            byBatch[batch].push(assignment);
          }
        }
      }
    }

    const roomsByType = {
      theory: this.rooms.filter((r) => r.type === 'theory').map((r) => r.name),
      practical: this.rooms.filter((r) => r.type === 'practical').map((r) => r.name),
    };

    const byFaculty: Record<string, Assignment[]> = {};
    const byRoom: Record<string, Assignment[]> = {};
    for (const f of this.state.faculties) byFaculty[f.id] = [];
    for (const r of this.rooms) byRoom[r.name] = [];

    for (const list of Object.values(byBatch)) {
      for (const a of list) {
        if (a.facultyId && byFaculty[a.facultyId]) {
          if (!byFaculty[a.facultyId].some((x) => x.id === a.id)) byFaculty[a.facultyId].push(a);
        }
        if (a.room && byRoom[a.room]) {
          if (!byRoom[a.room].some((x) => x.id === a.id)) byRoom[a.room].push(a);
        }
      }
    }

    return {
      timeslots: this.timeslots,
      byBatch,
      byFaculty,
      byRoom,
      roomsByType,
      score: {
        hardViolations: 0,
        softScore: 0,
        metrics: {
          placedCount: assignmentsMap.size,
        },
      },
      metadata: {
        engine: 'ts',
        solveTimeMs: 0,
        iterations: this.attempts,
      },
    };
  }

  public getBestPartialSolution(): ScheduleSolution {
    return this.buildResult(this.bestAssignments);
  }

  public getDiagnostics(): FailureDiagnostic[] {
    const diagnostics: FailureDiagnostic[] = [];

    const infeasibleGroups = new Map<string, SessionVariable[]>();
    for (const v of this.infeasibleVariables) {
      if (!infeasibleGroups.has(v.subject.id)) {
        infeasibleGroups.set(v.subject.id, []);
      }
      infeasibleGroups.get(v.subject.id)!.push(v);
    }
    for (const vars of infeasibleGroups.values()) {
      const referenceVar = vars[0];
      const sub = referenceVar.subject;
      const faculty = this.state.faculties.find((f) => f.id === referenceVar.facultyId);
      diagnostics.push({
        subject: sub.name,
        batches: sub.batches,
        faculty: faculty ? faculty.name : 'No Faculty Assigned',
        reason: this.diagnoseEmptyDomain(referenceVar),
        suggestedRelaxation: 'Add more compatible rooms, adjust session length, or loosen teacher unavailability windows.',
      });
    }

    const assignedIds = new Set(this.bestAssignments.keys());
    const unplacedVars = this.variables.filter((v) => !assignedIds.has(v.id));

    const subjectGroups = new Map<string, SessionVariable[]>();
    for (const v of unplacedVars) {
      if (!subjectGroups.has(v.subject.id)) {
        subjectGroups.set(v.subject.id, []);
      }
      subjectGroups.get(v.subject.id)!.push(v);
    }

    for (const [, vars] of subjectGroups.entries()) {
      const referenceVar = vars[0];
      const sub = referenceVar.subject;
      const faculty = this.state.faculties.find((f) => f.id === referenceVar.facultyId);
      const facultyName = faculty ? faculty.name : 'No Faculty Assigned';

      let reason = '';
      let suggestedRelaxation = '';
      const batchConflict = this.checkBatchOverloads(referenceVar);
      const facultyWeeklyConflict = faculty && (this.facultyWeeklyCount.get(faculty.id) ?? 0) + referenceVar.length > faculty.maxWeeklySlots;

      if (batchConflict) {
        reason = `Batches (${referenceVar.batches.join(', ')}) exceeded max classes per day limit (${this.state.maxClassesPerDay}) or have full schedules.`;
        suggestedRelaxation = `Increase max classes per day from ${this.state.maxClassesPerDay} or reduce weekly classes for this cohort.`;
      } else if (facultyWeeklyConflict) {
        reason = `Faculty ${facultyName} exceeds contractual load limit of ${faculty?.maxWeeklySlots} teaching slots/week.`;
        suggestedRelaxation = `Increase faculty max weekly slots or assign a co-teacher.`;
      } else {
        reason = `Search limit reached without finding collision-free slot for faculty ${facultyName} and required rooms.`;
        suggestedRelaxation = `Increase max solver attempts or run with Python CP-SAT engine for deeper combinatorial search.`;
      }

      diagnostics.push({
        subject: sub.name,
        batches: sub.batches,
        faculty: facultyName,
        reason,
        suggestedRelaxation,
      });
    }

    return diagnostics;
  }

  private diagnoseEmptyDomain(v: SessionVariable): string {
    const sub = v.subject;
    const faculty = this.state.faculties.find((f) => f.id === v.facultyId);

    if (sub.fixed) {
      const match = this.timeslots.find(
        (t) => t.day === sub.fixedDay && t.start === sub.fixedStart
      );
      if (!match) return `Fixed slot (${sub.fixedDay} ${sub.fixedStart}) is outside active teaching hours.`;
      if (match.isBreak) return `Fixed slot (${sub.fixedDay} ${sub.fixedStart}) overlaps with an institution break.`;
      return `Fixed slot conflicts with faculty unavailability windows.`;
    }

    let compatibleRooms = this.rooms;
    if (sub.preferredRoomTypes && sub.preferredRoomTypes.length > 0) {
      compatibleRooms = compatibleRooms.filter((r) => sub.preferredRoomTypes!.includes(r.type));
      if (compatibleRooms.length === 0) {
        return `No rooms exist matching preferred types: ${sub.preferredRoomTypes.join(', ')}.`;
      }
    } else {
      if (v.roomType === 'theory') {
        compatibleRooms = compatibleRooms.filter((r) => ['theory', 'lecture_hall', 'seminar_room', 'auditorium'].includes(r.type));
        if (compatibleRooms.length === 0) return `No classrooms (theory rooms) are configured.`;
      } else {
        compatibleRooms = compatibleRooms.filter((r) => ['practical', 'lab', 'computer_lab', 'studio'].includes(r.type));
        if (compatibleRooms.length === 0) return `No laboratories (practical rooms) are configured.`;
      }
    }

    let totalStudents = 0;
    if (this.state.batchSizes) {
      for (const b of v.batches) totalStudents += this.state.batchSizes[b] || 0;
    }
    const capacityNeeded = Math.max(totalStudents, sub.capacityRequirement || 0);
    const capacityRooms = compatibleRooms.filter((r) => r.capacity >= capacityNeeded);
    if (capacityRooms.length === 0) {
      return `Combined batch size (${capacityNeeded} students) exceeds capacity of all compatible rooms.`;
    }

    if (sub.requiredEquipment && sub.requiredEquipment.length > 0) {
      const equipRooms = capacityRooms.filter((r) => {
        const roomEquipment = r.equipment || [];
        return sub.requiredEquipment!.every((eq) => roomEquipment.includes(eq));
      });
      if (equipRooms.length === 0) {
        return `No room with capacity >= ${capacityNeeded} contains required equipment: ${sub.requiredEquipment.join(', ')}.`;
      }
    }

    if (v.length > this.state.maxClassesPerDay) {
      return `Session length (${v.length} slots) exceeds maximum allowed classes per day (${this.state.maxClassesPerDay}).`;
    }

    if (faculty) {
      return `Faculty ${faculty.name} is unavailable during all potential timeslots.`;
    }

    return `Configured constraints leave zero valid scheduling slots.`;
  }

  private checkBatchOverloads(v: SessionVariable): boolean {
    for (const batch of v.batches) {
      let totalAssignedSlots = 0;
      for (const [assignedVid] of this.bestAssignments.entries()) {
        const assignedVar = this.varMap.get(assignedVid);
        if (assignedVar && assignedVar.batches.includes(batch)) {
          totalAssignedSlots += assignedVar.length;
        }
      }

      const maxSlotsPossible = this.state.days.length * this.state.maxClassesPerDay;
      if (totalAssignedSlots + v.length > maxSlotsPossible) {
        return true;
      }
    }
    return false;
  }
}

export function solveSchedule(
  state: SchedulerInputState,
  onProgress?: (placed: number, total: number) => void
): { solution: ScheduleSolution | null; diagnostics: FailureDiagnostic[] } {
  const solver = new TimetableSolver(state);
  solver.init();
  const solution = solver.solve(onProgress);
  const diagnostics = solver.getDiagnostics();
  return {
    solution: solution || (diagnostics.length > 0 ? solver.getBestPartialSolution() : null),
    diagnostics,
  };
}

