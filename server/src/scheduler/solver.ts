import {
  SchedulerInputState,
  Timeslot,
  Assignment,
  ScheduleSolution,
  FailureDiagnostic,
  Subject,
  Faculty,
  Room,
  UnavailabilityWindow
} from '../types';

// Representing a contiguous block of timeslots for solver convenience
export interface TimeBlock {
  slots: Timeslot[];
  startMin: number;
  endMin: number;
  day: string;
}

interface SessionVariable {
  id: string; // e.g. "S1_0"
  subject: Subject;
  length: number;
  batches: string[];
  facultyId: string | null;
  roomType: 'theory' | 'practical';
  capacityRequirement?: number;
}

interface DomainValue {
  timeBlock: TimeBlock;
  room: string;
}

export class TimetableSolver {
  private state: SchedulerInputState;
  private timeslots: Timeslot[] = [];
  private rooms: Room[] = [];
  private variables: SessionVariable[] = [];
  private infeasibleVariables: SessionVariable[] = [];

  // Track occupancies
  private batchOccupancy = new Map<string, Set<string>>(); // batch -> Set(timeslotId)
  private facultyOccupancy = new Map<string, Set<string>>(); // facultyId -> Set(timeslotId)
  private roomOccupancy = new Map<string, Set<string>>(); // roomId -> Set(timeslotId)

  private batchDailyCount = new Map<string, Map<string, number>>(); // batch -> day -> count
  private facultyWeeklyCount = new Map<string, number>(); // facultyId -> count
  private facultyDailyCount = new Map<string, Map<string, number>>(); // facultyId -> day -> count

  // Solution tracking
  private initialAssignments: Assignment[] = [];
  private currentAssignments = new Map<string, DomainValue>();
  private bestAssignments = new Map<string, DomainValue>();
  private attempts = 0;
  private maxAttempts = 4000;

  // Domain cache
  private domains = new Map<string, DomainValue[]>();

  constructor(state: SchedulerInputState) {
    this.state = state;
    this.maxAttempts = state.options?.maxAttempts ?? 4000;
  }

  // Convert time string "HH:MM" to minutes from midnight
  private t2m(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  // Convert minutes to "HH:MM" string
  private m2t(m: number): string {
    const h = Math.floor(m / 60);
    const mins = m % 60;
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    return `${pad(h)}:${pad(mins)}`;
  }

  // Build the list of active timeslots across all instruction days
  private buildTimeslots(): Timeslot[] {
    const list: Timeslot[] = [];
    let idCounter = 0;

    for (const day of this.state.days) {
      const start = this.t2m(this.state.startTime);
      const end = this.t2m(this.state.endTime);
      const step = this.state.slotLength;

      // Breaks on this day
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

        // If it overlaps with any break interval, mark as break
        slot.isBreak = dayBreaks.some(
          (b) => !(slotEnd <= b.start || slotStart >= b.end)
        );

        list.push(slot);
      }
    }
    return list;
  }

  // Initialize data structures, build variables and initial domains
  public init() {
    this.timeslots = this.buildTimeslots();
    
    // Aggregate rooms list, preserving custom types with fallback
    this.rooms = [
      ...(this.state.rooms.theoryList ?? []).map((r) => ({ ...r, type: r.type || 'theory' })),
      ...(this.state.rooms.labList ?? []).map((r) => ({ ...r, type: r.type || 'practical' })),
    ];

    // Initialize counts and occupancies
    for (const b of this.state.batches) {
      this.batchOccupancy.set(b, new Set());
      const dailyMap = new Map<string, number>();
      for (const d of this.state.days) dailyMap.set(d, 0);
      this.batchDailyCount.set(b, dailyMap);
    }

    for (const f of this.state.faculties) {
      this.facultyOccupancy.set(f.id, new Set());
      this.facultyWeeklyCount.set(f.id, 0);
      const dailyMap = new Map<string, number>();
      for (const d of this.state.days) dailyMap.set(d, 0);
      this.facultyDailyCount.set(f.id, dailyMap);
    }

    for (const r of this.rooms) {
      this.roomOccupancy.set(r.id, new Set());
    }

    // Process Fixed Events first (Assembly, seminars, etc.)
    this.placeFixedEvents();

    // Build Session Variables for scheduling
    this.variables = [];
    for (const s of this.state.subjects) {
      const totalSessions = s.classesPerWeek;
      for (let i = 0; i < totalSessions; i++) {
        this.variables.push({
          id: `${s.id}_S${i}`,
          subject: s,
          length: s.sessionLength,
          batches: s.batches,
          facultyId: s.facultyId,
          roomType: s.type,
          capacityRequirement: s.capacityRequirement,
        });
      }
    }

    // Build domains for each variable and isolate infeasible ones
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

  // Pre-schedule static global events
  private placeFixedEvents() {
    if (!this.state.events) return;

    for (const ev of this.state.events) {
      const match = this.timeslots.find(
        (t) => t.day === ev.day && t.start === ev.start
      );
      if (!match) continue;

      // Occupy slots for this event length
      for (let k = 0; k < ev.length; k++) {
        const slotIdx = match.index + k;
        if (slotIdx >= this.timeslots.length) break;
        const ts = this.timeslots[slotIdx];
        if (ts.day !== ev.day || ts.isBreak) break;

        // Allocate a room for this event if possible (matching custom room types)
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

        // Occupy all batches since it's global
        for (const batch of this.state.batches) {
          this.batchOccupancy.get(batch)?.add(ts.id);
        }

        this.initialAssignments.push({
          id: `fixed_${ev.name}_${ts.id}`,
          subjectId: null,
          subject: `[${ev.name}]`,
          facultyId: null,
          room: allocatedRoom,
          timeslotId: ts.id,
          length: 1,
          batches: [...this.state.batches],
        });
      }
    }
  }

  // Compute all valid combinations of TimeBlock and Room for a variable
  private computeInitialDomain(v: SessionVariable): DomainValue[] {
    const list: DomainValue[] = [];
    const possibleTimeBlocks = this.getTimeBlocks(v.length);
    const subject = v.subject;

    // Room-type matching: filter by subject preferredRoomTypes
    let compatibleRooms = this.rooms;
    if (subject.preferredRoomTypes && subject.preferredRoomTypes.length > 0) {
      compatibleRooms = compatibleRooms.filter((r) => subject.preferredRoomTypes!.includes(r.type));
    } else {
      // Fallback default matching categories
      if (v.roomType === 'theory') {
        compatibleRooms = compatibleRooms.filter((r) => ['theory', 'lecture_hall', 'seminar_room', 'auditorium'].includes(r.type));
      } else {
        compatibleRooms = compatibleRooms.filter((r) => ['practical', 'lab', 'computer_lab', 'studio'].includes(r.type));
      }
    }

    // Pre-calculate total student capacity requirement based on batch sizes
    let totalStudents = 0;
    if (this.state.batchSizes) {
      for (const b of v.batches) {
        totalStudents += this.state.batchSizes[b] || 0;
      }
    }
    const capacityNeeded = Math.max(totalStudents, subject.capacityRequirement || 0);

    for (const tb of possibleTimeBlocks) {
      // Constraint: Respect subject fixed slot if specified
      if (subject.fixed) {
        if (subject.fixedDay && tb.day !== subject.fixedDay) continue;
        if (subject.fixedStart && tb.slots[0].start !== subject.fixedStart) continue;
        if (subject.fixedLength && tb.slots.length !== subject.fixedLength) continue;
      }

      // Constraint: Respect subject unavailability windows
      if (this.isSubjectUnavailable(subject, tb)) continue;

      // Constraint: Respect faculty unavailability windows
      if (v.facultyId) {
        const faculty = this.state.faculties.find((f) => f.id === v.facultyId);
        if (faculty && this.isFacultyUnavailable(faculty, tb)) continue;
      }

      // Find compatible rooms
      for (const room of compatibleRooms) {
        // Constraint: Room capacity requirement (checking batch size sum + subject override)
        if (capacityNeeded > 0 && room.capacity < capacityNeeded) continue;

        // Constraint: Room equipment requirements
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

  // Helper to extract all contiguous slot groups of length L on the same day
  private getTimeBlocks(length: number): TimeBlock[] {
    const blocks: TimeBlock[] = [];
    for (let i = 0; i <= this.timeslots.length - length; i++) {
      const slots = this.timeslots.slice(i, i + length);
      const day = slots[0].day;
      
      // All slots must be on the same day and none can be breaks
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

  // Check if subject is unavailable during TimeBlock
  private isSubjectUnavailable(sub: Subject, tb: TimeBlock): boolean {
    if (!sub.unavail || sub.unavail.length === 0) return false;
    return sub.unavail.some((u) => {
      if (u.day !== tb.day) return false;
      const uStart = this.t2m(u.start);
      const uEnd = this.t2m(u.end);
      // Overlap condition
      return !(tb.endMin <= uStart || tb.startMin >= uEnd);
    });
  }

  // Check if faculty is unavailable during TimeBlock
  private isFacultyUnavailable(fac: Faculty, tb: TimeBlock): boolean {
    if (!fac.unavail || fac.unavail.length === 0) return false;
    return fac.unavail.some((u) => {
      if (u.day !== tb.day) return false;
      const uStart = this.t2m(u.start);
      const uEnd = this.t2m(u.end);
      return !(tb.endMin <= uStart || tb.startMin >= uEnd);
    });
  }

  // Core backtrack implementation
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

  // Backtracking recursive CSP function
  private backtrack(
    unassigned: SessionVariable[],
    onProgress?: (placed: number, total: number) => void
  ): boolean {
    this.attempts++;

    // Track best partial assignments
    if (this.currentAssignments.size > this.bestAssignments.size) {
      this.bestAssignments = new Map(this.currentAssignments);
    }

    if (onProgress && this.attempts % 100 === 0) {
      onProgress(this.bestAssignments.size, this.variables.length);
    }

    // Cutoff if attempts exceeded
    if (this.attempts >= this.maxAttempts) {
      return false;
    }

    if (unassigned.length === 0) {
      return true;
    }

    // 1. Variable Selection: MRV Heuristic
    // Dynamic MRV: choose variable with minimum remaining legal domain values
    let bestVarIdx = -1;
    let minDomainSize = Infinity;
    
    for (let i = 0; i < unassigned.length; i++) {
      const v = unassigned[i];
      const domain = this.domains.get(v.id) ?? [];
      
      // Filter domain against current assignments (forward checking keeps domains trimmed)
      const validSize = domain.length;
      if (validSize < minDomainSize) {
        minDomainSize = validSize;
        bestVarIdx = i;
      } else if (validSize === minDomainSize) {
        // Degree heuristic tie-breaker: prefer electives (touches more batches) or larger slot sizes
        const vDegree = (v.batches.length * 10) + v.length;
        const currentBestDegree = (unassigned[bestVarIdx].batches.length * 10) + unassigned[bestVarIdx].length;
        if (vDegree > currentBestDegree) {
          bestVarIdx = i;
        }
      }
    }

    if (bestVarIdx === -1) return false;
    const v = unassigned[bestVarIdx];

    // Domain is empty -> failure, need to backtrack
    const domain = this.domains.get(v.id) ?? [];
    if (domain.length === 0) {
      return false;
    }

    // 2. Value Ordering: Heuristics & Soft Constraints
    // Rank values by soft constraints (spread subjects across week, minimize faculty gaps)
    const rankedDomain = this.rankDomainValues(v, domain);

    const nextUnassigned = [
      ...unassigned.slice(0, bestVarIdx),
      ...unassigned.slice(bestVarIdx + 1),
    ];

    for (const val of rankedDomain) {
      // 3. Consistency checks (hard constraints)
      if (!this.isConsistent(v, val)) {
        continue;
      }

      // Apply assignment
      this.assign(v, val);

      // 4. Forward Checking: prune domains of remaining variables
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
          fcFailed = true; // domain wiped out! Fail fast
        }
      }

      if (!fcFailed) {
        // Recurse
        const success = this.backtrack(nextUnassigned, onProgress);
        if (success) return true;
      }

      // Restore domains
      for (const [id, dom] of savedDomains.entries()) {
        this.domains.set(id, dom);
      }

      // Backtrack
      this.unassign(v, val);
    }

    return false;
  }

  // Soft constraint value ranking
  private rankDomainValues(v: SessionVariable, domain: DomainValue[]): DomainValue[] {
    // We sort the values to favor optimal options first
    return [...domain].sort((a, b) => {
      const scoreA = this.evaluateValueSoftConstraints(v, a);
      const scoreB = this.evaluateValueSoftConstraints(v, b);
      return scoreB - scoreA; // Higher score is preferred
    });
  }

  // Evaluate value soft constraints: larger is better
  private evaluateValueSoftConstraints(v: SessionVariable, val: DomainValue): number {
    let score = 0;
    const day = val.timeBlock.day;
    const startIdx = val.timeBlock.slots[0].index;

    // 1. Balance subject load across week (avoid scheduling same subject on same day)
    // Penalize if this batch already has an assignment for this subject on this day
    let subjectSameDayCount = 0;
    for (const [assignedVid, assignedVal] of this.currentAssignments.entries()) {
      const assignedVar = this.variables.find((x) => x.id === assignedVid);
      if (assignedVar && assignedVar.subject.id === v.subject.id && assignedVal.timeBlock.day === day) {
        subjectSameDayCount++;
      }
    }
    score -= subjectSameDayCount * 50;

    // 2. Minimize faculty daily gaps
    // Check if faculty has scheduled hours on the same day, prefer slot contiguous or close to existing hours
    if (v.facultyId) {
      let closestDistance = Infinity;
      let hasHoursOnDay = false;

      for (const [assignedVid, assignedVal] of this.currentAssignments.entries()) {
        const assignedVar = this.variables.find((x) => x.id === assignedVid);
        if (assignedVar && assignedVar.facultyId === v.facultyId && assignedVal.timeBlock.day === day) {
          hasHoursOnDay = true;
          const assignedStart = assignedVal.timeBlock.slots[0].index;
          const dist = Math.abs(startIdx - assignedStart);
          if (dist < closestDistance) closestDistance = dist;
        }
      }

      if (hasHoursOnDay) {
        if (closestDistance === v.length) {
          // Perfectly contiguous! No gap
          score += 100;
        } else if (closestDistance <= 2) {
          // Small gap (1 free period sandwiched)
          score += 30;
        } else {
          // Large gap
          score -= 10;
        }
      } else {
        // Spreading faculty load evenly: prefer starting on a day with fewer teaching hours for this faculty
        const facultyDaily = this.facultyDailyCount.get(v.facultyId)?.get(day) ?? 0;
        score -= facultyDaily * 20;
      }
    }

    // 3. Balance batch daily load (prefer days where the batch has fewer classes overall)
    let batchMaxDailyLoad = 0;
    for (const batch of v.batches) {
      const currentLoad = this.batchDailyCount.get(batch)?.get(day) ?? 0;
      if (currentLoad > batchMaxDailyLoad) {
        batchMaxDailyLoad = currentLoad;
      }
    }
    score -= batchMaxDailyLoad * 15;

    return score;
  }

  // Hard constraints check: is assigning this variable to this value consistent with current assignments?
  private isConsistent(v: SessionVariable, val: DomainValue): boolean {
    const day = val.timeBlock.day;
    const slots = val.timeBlock.slots;

    // 1. Batch max classes per day limit
    for (const batch of v.batches) {
      const dailyCount = this.batchDailyCount.get(batch)?.get(day) ?? 0;
      // If we add this session of length v.length, will we exceed maxClassesPerDay?
      // A session contributes to slots. If a session has length 2, it occupies 2 classes/slots
      if (dailyCount + v.length > this.state.maxClassesPerDay) {
        return false;
      }
    }

    // 2. Faculty weekly slots limit and daily limits
    if (v.facultyId) {
      const faculty = this.state.faculties.find((f) => f.id === v.facultyId);
      if (faculty) {
        const weeklyCount = this.facultyWeeklyCount.get(v.facultyId) ?? 0;
        if (weeklyCount + v.length > faculty.maxWeeklySlots) {
          return false;
        }

        // Optional daily limit checks
        if (faculty.maxDailySlots) {
          const dailyCount = this.facultyDailyCount.get(v.facultyId)?.get(day) ?? 0;
          if (dailyCount + v.length > faculty.maxDailySlots) {
            return false;
          }
        }
      }
    }

    // 3. Time overlap checks (batch, faculty, room)
    for (const ts of slots) {
      // Batch occupancy
      for (const batch of v.batches) {
        if (this.batchOccupancy.get(batch)?.has(ts.id)) {
          return false;
        }
      }

      // Faculty occupancy
      if (v.facultyId && this.facultyOccupancy.get(v.facultyId)?.has(ts.id)) {
        return false;
      }

      // Room occupancy
      if (this.roomOccupancy.get(val.room)?.has(ts.id)) {
        return false;
      }
    }

    return true;
  }

  // Check if two variables can be assigned their values without conflict (used in forward checking)
  private areConsistentTogether(
    v1: SessionVariable,
    val1: DomainValue,
    v2: SessionVariable,
    val2: DomainValue
  ): boolean {
    // If they don't overlap in time, there is no conflict!
    const slots1 = new Set(val1.timeBlock.slots.map((s: Timeslot) => s.id));
    const overlaps = val2.timeBlock.slots.some((s: Timeslot) => slots1.has(s.id));
    if (!overlaps) return true;

    // They overlap in time. Check resource sharing:
    
    // 1. Same Room
    if (val1.room === val2.room) return false;

    // 2. Same Faculty
    if (v1.facultyId && v2.facultyId && v1.facultyId === v2.facultyId) return false;

    // 3. Same Batch (electives support multiple batches)
    const batches1 = new Set(v1.batches);
    const sharesBatch = v2.batches.some((b) => batches1.has(b));
    if (sharesBatch) return false;

    return true;
  }

  // Update occupancy tracking on assign
  private assign(v: SessionVariable, val: DomainValue) {
    const day = val.timeBlock.day;
    const slots = val.timeBlock.slots;

    this.currentAssignments.set(v.id, val);

    for (const ts of slots) {
      for (const batch of v.batches) {
        this.batchOccupancy.get(batch)?.add(ts.id);
      }
      if (v.facultyId) {
        this.facultyOccupancy.get(v.facultyId)?.add(ts.id);
      }
      this.roomOccupancy.get(val.room)?.add(ts.id);
    }

    // Increment counters
    for (const batch of v.batches) {
      const dailyMap = this.batchDailyCount.get(batch)!;
      dailyMap.set(day, dailyMap.get(day)! + v.length);
    }

    if (v.facultyId) {
      this.facultyWeeklyCount.set(v.facultyId, (this.facultyWeeklyCount.get(v.facultyId) ?? 0) + v.length);
      const dailyMap = this.facultyDailyCount.get(v.facultyId)!;
      dailyMap.set(day, dailyMap.get(day)! + v.length);
    }
  }

  // Undo occupancy changes on backtrack
  private unassign(v: SessionVariable, val: DomainValue) {
    const day = val.timeBlock.day;
    const slots = val.timeBlock.slots;

    this.currentAssignments.delete(v.id);

    for (const ts of slots) {
      for (const batch of v.batches) {
        this.batchOccupancy.get(batch)?.delete(ts.id);
      }
      if (v.facultyId) {
        this.facultyOccupancy.get(v.facultyId)?.delete(ts.id);
      }
      this.roomOccupancy.get(val.room)?.delete(ts.id);
    }

    // Decrement counters
    for (const batch of v.batches) {
      const dailyMap = this.batchDailyCount.get(batch)!;
      dailyMap.set(day, dailyMap.get(day)! - v.length);
    }

    if (v.facultyId) {
      this.facultyWeeklyCount.set(v.facultyId, (this.facultyWeeklyCount.get(v.facultyId) ?? 0) - v.length);
      const dailyMap = this.facultyDailyCount.get(v.facultyId)!;
      dailyMap.set(day, dailyMap.get(day)! - v.length);
    }
  }

  // Format assignments map into API return structure
  private buildResult(assignmentsMap: Map<string, DomainValue>): ScheduleSolution {
    const byBatch: Record<string, Assignment[]> = {};
    for (const b of this.state.batches) {
      byBatch[b] = [];
    }

    // Include initial pre-assignments (Fixed events)
    for (const fixed of this.initialAssignments) {
      for (const b of fixed.batches) {
        if (byBatch[b]) {
          byBatch[b].push(fixed);
        }
      }
    }

    // Add scheduled sessions
    for (const [vid, val] of assignmentsMap.entries()) {
      const v = this.variables.find((x) => x.id === vid)!;
      const roomObj = this.rooms.find((r) => r.id === val.room)!;

      for (const ts of val.timeBlock.slots) {
        const assignment: Assignment = {
          id: `${vid}_${ts.id}`,
          subjectId: v.subject.id,
          subject: v.subject.name,
          facultyId: v.facultyId,
          room: roomObj.name,
          timeslotId: ts.id,
          length: 1, // Store flat per timeslot for simpler rendering in tabular grids
          batches: v.batches,
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

    return {
      timeslots: this.timeslots,
      byBatch,
      roomsByType,
    };
  }

  // Return the best partial solution found during search
  public getBestPartialSolution(): ScheduleSolution {
    return this.buildResult(this.bestAssignments);
  }

  // Analyze failure constraints for unplaced variables to compile diagnostic logs
  public getDiagnostics(): FailureDiagnostic[] {
    const diagnostics: FailureDiagnostic[] = [];

    // 1. Report precomputed infeasible diagnostics
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
      });
    }

    // 2. Report search-time diagnostics (unassigned variables in best solution)
    const assignedIds = new Set(this.bestAssignments.keys());
    const unplacedVars = this.variables.filter((v) => !assignedIds.has(v.id));
    
    // Group by subject to avoid duplicate diagnostics for multiple sessions of the same subject
    const subjectGroups = new Map<string, SessionVariable[]>();
    for (const v of unplacedVars) {
      if (!subjectGroups.has(v.subject.id)) {
        subjectGroups.set(v.subject.id, []);
      }
      subjectGroups.get(v.subject.id)!.push(v);
    }

    for (const [subId, vars] of subjectGroups.entries()) {
      const referenceVar = vars[0];
      const sub = referenceVar.subject;
      const faculty = this.state.faculties.find((f) => f.id === referenceVar.facultyId);
      const facultyName = faculty ? faculty.name : 'No Faculty Assigned';

      // Diagnose search-time conflict reason
      let reason = '';
      const batchConflict = this.checkBatchOverloads(referenceVar);
      const facultyWeeklyConflict = faculty && (this.facultyWeeklyCount.get(faculty.id) ?? 0) + referenceVar.length > faculty.maxWeeklySlots;
      
      if (batchConflict) {
        reason = `Attending batches (${referenceVar.batches.join(', ')}) have no remaining open periods because they already exceed the limit of ${this.state.maxClassesPerDay} classes per day, or are booked in conflicting classes.`;
      } else if (facultyWeeklyConflict) {
        reason = `Faculty ${facultyName} exceeds their max load of ${faculty?.maxWeeklySlots} teaching slots/week.`;
      } else {
        reason = `Unable to resolve schedule collision: Faculty ${facultyName} or the necessary room is double-booked by other classes during all valid slots.`;
      }

      diagnostics.push({
        subject: sub.name,
        batches: sub.batches,
        faculty: facultyName,
        reason,
      });
    }

    return diagnostics;
  }

  // Diagnose exact structural failure for a variable with an empty initial domain
  private diagnoseEmptyDomain(v: SessionVariable): string {
    const sub = v.subject;
    const faculty = this.state.faculties.find((f) => f.id === v.facultyId);
    
    // 1. Fixed slot issues
    if (sub.fixed) {
      const match = this.timeslots.find(
        (t) => t.day === sub.fixedDay && t.start === sub.fixedStart
      );
      if (!match) {
        return `Fixed slot (${sub.fixedDay} ${sub.fixedStart}) is outside the active working hours of instruction.`;
      }
      if (match.isBreak) {
        return `Fixed slot (${sub.fixedDay} ${sub.fixedStart}) overlaps with a scheduled school break.`;
      }
      return `Fixed slot conflicts with unavailability windows or resource overlaps.`;
    }

    // 2. Room type availability
    let compatibleRooms = this.rooms;
    if (sub.preferredRoomTypes && sub.preferredRoomTypes.length > 0) {
      compatibleRooms = compatibleRooms.filter((r) => sub.preferredRoomTypes!.includes(r.type));
      if (compatibleRooms.length === 0) {
        return `No rooms exist matching the preferred room types: ${sub.preferredRoomTypes.join(', ')}.`;
      }
    } else {
      if (v.roomType === 'theory') {
        compatibleRooms = compatibleRooms.filter((r) => ['theory', 'lecture_hall', 'seminar_room', 'auditorium'].includes(r.type));
        if (compatibleRooms.length === 0) {
          return `No classrooms (theory rooms) are configured in Step 1.`;
        }
      } else {
        compatibleRooms = compatibleRooms.filter((r) => ['practical', 'lab', 'computer_lab', 'studio'].includes(r.type));
        if (compatibleRooms.length === 0) {
          return `No labs (practical rooms) are configured in Step 1.`;
        }
      }
    }

    // 3. Room capacity check
    let totalStudents = 0;
    if (this.state.batchSizes) {
      for (const b of v.batches) {
        totalStudents += this.state.batchSizes[b] || 0;
      }
    }
    const capacityNeeded = Math.max(totalStudents, sub.capacityRequirement || 0);
    const capacityRooms = compatibleRooms.filter((r) => r.capacity >= capacityNeeded);
    if (capacityRooms.length === 0) {
      return `Room capacity mismatch: Combined batch size (${capacityNeeded} students) exceeds the maximum capacity of any compatible room.`;
    }

    // 4. Equipment tags check
    if (sub.requiredEquipment && sub.requiredEquipment.length > 0) {
      const equipRooms = capacityRooms.filter((r) => {
        const roomEquipment = r.equipment || [];
        return sub.requiredEquipment!.every((eq) => roomEquipment.includes(eq));
      });
      if (equipRooms.length === 0) {
        return `Equipment mismatch: No rooms of sufficient capacity have the required tags: ${sub.requiredEquipment.join(', ')}.`;
      }
    }

    // 5. Length limits
    if (v.length > this.state.maxClassesPerDay) {
      return `Session length (${v.length} hrs) exceeds the maximum allowed classes per day (${this.state.maxClassesPerDay} hrs).`;
    }

    // 6. Availability fallbacks
    if (faculty) {
      return `Availability block: Faculty member ${faculty.name} is fully unavailable during all potential timeslots.`;
    }
    return `Availability block: Restriction filters leave zero valid scheduling slots.`;
  }

  // Simple heuristic checks if batch timeslots are generally overloaded
  private checkBatchOverloads(v: SessionVariable): boolean {
    for (const batch of v.batches) {
      let totalAssignedSlots = 0;
      for (const [assignedVid, assignedVal] of this.bestAssignments.entries()) {
        const assignedVar = this.variables.find((x) => x.id === assignedVid);
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
