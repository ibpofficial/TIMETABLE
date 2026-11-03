"""Google OR-Tools CP-SAT Optimization Engine for Large-Scale Timetables.

Implements mathematical constraint satisfaction and soft-penalty minimization
with multi-worker support, symmetry breaking, and progress streaming.
"""

import time
from typing import Callable, Dict, List, Optional, Tuple, Any
from ortools.sat.python import cp_model

from .models import (
    SchedulerInputState,
    ScheduleSolution,
    Timeslot,
    Assignment,
    Room,
    Subject,
    Faculty,
    FailureDiagnostic,
)
from .dsa import run_feasibility_precheck


class SolutionProgressCallback(cp_model.CpSolverSolutionCallback):
    """Streams progress during CP-SAT branch-and-bound search."""

    def __init__(self, on_progress: Optional[Callable[[Dict[str, Any]], None]] = None):
        super().__init__()
        self._on_progress = on_progress
        self._solution_count = 0
        self.start_time = time.time()

    def on_solution_callback(self):
        self._solution_count += 1
        elapsed = time.time() - self.start_time
        obj = self.objective_value
        bound = self.best_objective_bound

        gap = 0.0
        if abs(obj) > 1e-4:
            gap = max(0.0, (abs(obj - bound) / abs(obj)) * 100.0)

        if self._on_progress:
            self._on_progress({
                "type": "solution_found",
                "solutionCount": self._solution_count,
                "objective": obj,
                "bound": bound,
                "gapPct": round(gap, 2),
                "elapsedSeconds": round(elapsed, 2),
            })


class CPSATScheduler:
    def __init__(self, state: SchedulerInputState):
        self.state = state
        self.timeslots: List[Timeslot] = self._build_timeslots()
        self.rooms: List[Room] = state.rooms.theoryList + state.rooms.labList
        self.room_map = {r.id: r for r in self.rooms}

    def _t2m(self, t: str) -> int:
        h, m = map(int, t.split(":"))
        return h * 60 + m

    def _m2t(self, m: int) -> str:
        h = m // 60
        mins = m % 60
        return f"{h:02d}:{mins:02d}"

    def _build_timeslots(self) -> List[Timeslot]:
        list_slots: List[Timeslot] = []
        id_counter = 0

        for day in self.state.days:
            start = self._t2m(self.state.startTime)
            end = self._t2m(self.state.endTime)
            step = self.state.slotLength

            day_breaks = [
                (self._t2m(b.start), self._t2m(b.start) + b.durationMins)
                for b in self.state.breaks
                if b.day == day
            ]

            for m in range(start, end, step):
                slot_start = m
                slot_end = m + step
                if slot_end > end:
                    break

                is_break = any(
                    not (slot_end <= b_start or slot_start >= b_end)
                    for b_start, b_end in day_breaks
                )

                id_counter += 1
                list_slots.append(
                    Timeslot(
                        id=f"TS_{day}_{id_counter}",
                        day=day,
                        start=self._m2t(slot_start),
                        end=self._m2t(slot_end),
                        startMin=slot_start,
                        endMin=slot_end,
                        isBreak=is_break,
                        index=len(list_slots),
                    )
                )

        return list_slots

    def solve(
        self,
        on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
        time_limit_seconds: Optional[int] = None,
    ) -> Tuple[Optional[ScheduleSolution], List[FailureDiagnostic]]:
        start_time = time.time()

        # Step 0: Fast Pre-check
        precheck = run_feasibility_precheck(self.state, self.timeslots)
        if not precheck.is_feasible:
            diagnostics = [
                FailureDiagnostic(
                    subject="Pre-Check",
                    batches=[],
                    faculty="",
                    reason=b,
                    suggestedRelaxation="Adjust capacity or class volume.",
                )
                for b in precheck.bottlenecks
            ]
            return None, diagnostics

        model = cp_model.CpModel()

        # 1. Expand sessions
        sessions: List[Dict[str, Any]] = []
        for s in self.state.subjects:
            f_ids = s.facultyIds if s.facultyIds else ([s.facultyId] if s.facultyId else [])
            for i in range(s.classesPerWeek):
                sessions.append({
                    "id": f"{s.id}_S{i}",
                    "subject": s,
                    "sessionIndex": i,
                    "length": s.sessionLength,
                    "batches": s.batches,
                    "facultyIds": f_ids,
                    "roomType": s.type,
                    "capacityRequirement": s.capacityRequirement,
                })

        # 2. Decision Variables: x[session_idx, timeslot_idx, room_idx] in {0, 1}
        # Variable: session starts at timeslot t in room r
        x_vars: Dict[Tuple[int, int, int], cp_model.IntVar] = {}
        session_valid_assignments: Dict[int, List[Tuple[int, int]]] = {i: [] for i in range(len(sessions))}

        for i, sess in enumerate(sessions):
            sub: Subject = sess["subject"]
            sess_len = sess["length"]

            # Filter compatible rooms
            compat_rooms = self.rooms
            if sub.preferredRoomTypes:
                compat_rooms = [r for r in self.rooms if r.type in sub.preferredRoomTypes]
            else:
                if sess["roomType"] == "theory":
                    compat_rooms = [r for r in self.rooms if r.type in ["theory", "lecture_hall", "seminar_room", "auditorium"]]
                else:
                    compat_rooms = [r for r in self.rooms if r.type in ["practical", "lab", "computer_lab", "studio"]]

            req_cap = sess["capacityRequirement"] or 0
            if self.state.batchSizes:
                req_cap = max(req_cap, sum(self.state.batchSizes.get(b, 0) for b in sess["batches"]))
            compat_rooms = [r for r in compat_rooms if r.capacity >= req_cap]

            # Find compatible timeslot blocks
            for t_idx, ts in enumerate(self.timeslots):
                if t_idx + sess_len > len(self.timeslots):
                    continue

                block_slots = self.timeslots[t_idx : t_idx + sess_len]
                # All slots in block must be on the same day and not breaks
                if any(s_slot.day != ts.day or s_slot.isBreak for s_slot in block_slots):
                    continue

                # Subject fixed slot check
                if sub.fixed:
                    if sub.fixedDay and ts.day != sub.fixedDay:
                        continue
                    if sub.fixedStart and ts.start != sub.fixedStart:
                        continue

                # Faculty unavailability
                blocked = False
                for fid in sess["facultyIds"]:
                    fac = next((f for f in self.state.faculties if f.id == fid), None)
                    if fac and fac.unavail:
                        for u in fac.unavail:
                            if u.day == ts.day:
                                u_start = self._t2m(u.start)
                                u_end = self._t2m(u.end)
                                if not (block_slots[-1].endMin <= u_start or block_slots[0].startMin >= u_end):
                                    blocked = True
                                    break
                    if blocked:
                        break
                if blocked:
                    continue

                for r_idx, r in enumerate(self.rooms):
                    if r not in compat_rooms:
                        continue

                    var = model.NewBoolVar(f"x_s{i}_t{t_idx}_r{r_idx}")
                    x_vars[(i, t_idx, r_idx)] = var
                    session_valid_assignments[i].append((t_idx, r_idx))

        # 3. Hard Constraint: Exactly one (timeslot, room) for each session
        for i, sess in enumerate(sessions):
            valid_opts = [x_vars[(i, t, r)] for t, r in session_valid_assignments[i]]
            if not valid_opts:
                return None, [
                    FailureDiagnostic(
                        subject=sess["subject"].name,
                        batches=sess["batches"],
                        faculty=", ".join(sess["facultyIds"]),
                        reason=f"No valid timeslot-room combination found for session {sess['id']}.",
                        suggestedRelaxation="Add more rooms or widen faculty availability.",
                    )
                ]
            model.AddExactlyOne(valid_opts)

        # 4. Hard Resource No-Overlap Constraints (Optimized O(|x_vars|) inverted index)
        slot_batch_vars: Dict[int, Dict[str, List[cp_model.IntVar]]] = {
            t: {b: [] for b in self.state.batches} for t in range(len(self.timeslots))
        }
        slot_fac_vars: Dict[int, Dict[str, List[cp_model.IntVar]]] = {
            t: {f.id: [] for f in self.state.faculties} for t in range(len(self.timeslots))
        }
        slot_room_vars: Dict[int, Dict[int, List[cp_model.IntVar]]] = {
            t: {r_idx: [] for r_idx in range(len(self.rooms))} for t in range(len(self.timeslots))
        }

        for (i, start_t, r_idx), var in x_vars.items():
            sess = sessions[i]
            sess_len = sess["length"]
            for offset in range(sess_len):
                slot = start_t + offset
                if slot < len(self.timeslots):
                    for b in sess["batches"]:
                        if b in slot_batch_vars[slot]:
                            slot_batch_vars[slot][b].append(var)
                    for fid in sess["facultyIds"]:
                        if fid in slot_fac_vars[slot]:
                            slot_fac_vars[slot][fid].append(var)
                    slot_room_vars[slot][r_idx].append(var)

        for slot_idx, ts in enumerate(self.timeslots):
            if ts.isBreak:
                continue
            for b_vars in slot_batch_vars[slot_idx].values():
                if len(b_vars) > 1:
                    model.AddAtMostOne(b_vars)
            for f_vars in slot_fac_vars[slot_idx].values():
                if len(f_vars) > 1:
                    model.AddAtMostOne(f_vars)
            for r_vars in slot_room_vars[slot_idx].values():
                if len(r_vars) > 1:
                    model.AddAtMostOne(r_vars)

        # 5. Batch max classes per day
        batch_day_vars: Dict[Tuple[str, str], List[cp_model.IntVar]] = {}
        fac_load_vars: Dict[str, List[cp_model.IntVar]] = {}

        for (i, t, r), var in x_vars.items():
            sess = sessions[i]
            day = self.timeslots[t].day
            for b in sess["batches"]:
                key = (b, day)
                if key not in batch_day_vars:
                    batch_day_vars[key] = []
                batch_day_vars[key].append(var * sess["length"])

            for fid in sess["facultyIds"]:
                if fid not in fac_load_vars:
                    fac_load_vars[fid] = []
                fac_load_vars[fid].append(var * sess["length"])

        for (b, day), terms in batch_day_vars.items():
            model.Add(sum(terms) <= self.state.maxClassesPerDay)

        # 6. Faculty weekly load limit
        for fac in self.state.faculties:
            if fac.id in fac_load_vars:
                model.Add(sum(fac_load_vars[fac.id]) <= fac.maxWeeklySlots)

        # 7. Symmetry Breaking: order identical sessions of the same subject
        for s in self.state.subjects:
            if s.classesPerWeek > 1:
                subj_sessions = [idx for idx, sess in enumerate(sessions) if sess["subject"].id == s.id]
                for k in range(len(subj_sessions) - 1):
                    i1, i2 = subj_sessions[k], subj_sessions[k + 1]
                    # Start timeslot of i1 < Start timeslot of i2
                    t_expr1 = sum(t * x_vars[(i1, t, r)] for t, r in session_valid_assignments[i1])
                    t_expr2 = sum(t * x_vars[(i2, t, r)] for t, r in session_valid_assignments[i2])
                    model.Add(t_expr1 < t_expr2)

        # 8. Soft Constraints Objective
        penalties = []

        # Soft 1: Balance subject days (prefer spreading subject over different days)
        for s in self.state.subjects:
            for day in self.state.days:
                day_t_indices = [idx for idx, t in enumerate(self.timeslots) if t.day == day]
                same_day_vars = []
                for i, sess in enumerate(sessions):
                    if sess["subject"].id == s.id:
                        for t, r in session_valid_assignments[i]:
                            if t in day_t_indices:
                                same_day_vars.append(x_vars[(i, t, r)])
                if len(same_day_vars) > 1:
                    excess = model.NewIntVar(0, len(same_day_vars), f"excess_{s.id}_{day}")
                    model.Add(excess >= sum(same_day_vars) - 1)
                    penalties.append(excess * 50)

        # Soft 2: Morning preference for heavy subjects
        for i, sess in enumerate(sessions):
            if sess["subject"].isHeavySubject:
                for t, r in session_valid_assignments[i]:
                    if self.timeslots[t].startMin >= 13 * 60:
                        penalties.append(x_vars[(i, t, r)] * 30)

        if penalties:
            model.Minimize(sum(penalties))

        # Solve with CP-SAT
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = float(
            time_limit_seconds or self.state.options.timeLimitSeconds or 30.0
        )
        solver.parameters.num_workers = int(self.state.options.numWorkers or 8)
        if self.state.options.randomSeed:
            solver.parameters.random_seed = self.state.options.randomSeed

        callback = SolutionProgressCallback(on_progress)
        status = solver.Solve(model, callback)

        elapsed_ms = (time.time() - start_time) * 1000

        if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
            solution = self._build_solution(sessions, x_vars, solver, elapsed_ms, status)
            return solution, []

        # Infeasible: return diagnostic
        return None, [
            FailureDiagnostic(
                subject="Combinatorial Constraint",
                batches=self.state.batches,
                faculty="Multiple",
                reason="CP-SAT determined mathematical infeasibility: resource contention or load bounds cannot be satisfied simultaneously.",
                suggestedRelaxation="Increase maxClassesPerDay, add more rooms, or reduce subject classesPerWeek.",
            )
        ]

    def _build_solution(
        self,
        sessions: List[Dict[str, Any]],
        x_vars: Dict[Tuple[int, int, int], cp_model.IntVar],
        solver: cp_model.CpSolver,
        elapsed_ms: float,
        status: int = cp_model.FEASIBLE,
    ) -> ScheduleSolution:
        by_batch: Dict[str, List[Assignment]] = {b: [] for b in self.state.batches}

        for (i, t, r), var in x_vars.items():
            if solver.Value(var) == 1:
                sess = sessions[i]
                sub: Subject = sess["subject"]
                room = self.rooms[r]
                sess_len = sess["length"]

                for k in range(sess_len):
                    ts = self.timeslots[t + k]
                    assignment = Assignment(
                        id=f"{sess['id']}_{ts.id}",
                        subjectId=sub.id,
                        subject=sub.name,
                        facultyId=sub.facultyId,
                        facultyIds=sess["facultyIds"],
                        room=room.name,
                        timeslotId=ts.id,
                        length=1,
                        batches=sess["batches"],
                        studentGroups=sub.studentGroups,
                        day=ts.day,
                        startMin=ts.startMin,
                        endMin=ts.endMin,
                        explanation=f"Assigned by CP-SAT in {room.name} satisfying all constraints.",
                    )

                    for b in sess["batches"]:
                        if b in by_batch:
                            by_batch[b].append(assignment)

        theory_room_names = [r.name for r in self.rooms if r.type == "theory"]
        lab_room_names = [r.name for r in self.rooms if r.type == "practical"]

        return ScheduleSolution(
            timeslots=self.timeslots,
            byBatch=by_batch,
            roomsByType={
                "theory": theory_room_names,
                "practical": lab_room_names,
            },
            score={
                "hardViolations": 0,
                "softScore": round(solver.ObjectiveValue(), 2),
            },
            metadata={
                "engine": "python",
                "solveTimeMs": round(elapsed_ms, 2),
                "status": "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
            },
        )
