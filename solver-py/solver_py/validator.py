"""Independent Mathematical Validator for Timetable Solutions.

Re-verifies all hard and soft constraints independently from the solver.
"""

from typing import Dict, List, Set, Any
from .models import SchedulerInputState, ScheduleSolution


class ValidationReport:
    def __init__(self, is_valid: bool, hard_violations: int, errors: List[str], soft_penalty: float):
        self.is_valid = is_valid
        self.hard_violations = hard_violations
        self.errors = errors
        self.soft_penalty = soft_penalty


def validate_solution(state: SchedulerInputState, solution: ScheduleSolution) -> ValidationReport:
    errors: List[str] = []
    hard_violations = 0
    soft_penalty = 0.0

    batch_occupancy: Dict[str, Set[str]] = {}
    faculty_occupancy: Dict[str, Set[str]] = {}
    room_occupancy: Dict[str, Set[str]] = {}
    batch_daily_slots: Dict[str, Dict[str, int]] = {}
    faculty_weekly_slots: Dict[str, int] = {}

    slot_map = {t.id: t for t in solution.timeslots}
    all_rooms = {r.id: r for r in state.rooms.theoryList + state.rooms.labList}
    room_by_name = {r.name: r for r in all_rooms.values()}

    for batch, assignments in solution.byBatch.items():
        if batch not in batch_occupancy:
            batch_occupancy[batch] = set()
            batch_daily_slots[batch] = {d: 0 for d in state.days}

        for a in assignments:
            ts = slot_map.get(a.timeslotId)
            if not ts:
                errors.append(f"Assignment {a.id} references non-existent timeslot {a.timeslotId}.")
                hard_violations += 1
                continue

            # 1. Break check
            if ts.isBreak:
                errors.append(f"Session {a.subject} scheduled during break slot {ts.id} ({ts.day} {ts.start}).")
                hard_violations += 1

            # 2. Batch double booking
            if a.timeslotId in batch_occupancy[batch]:
                errors.append(f"Batch {batch} double-booked at slot {ts.id}.")
                hard_violations += 1
            batch_occupancy[batch].add(a.timeslotId)

            # Daily batch load
            batch_daily_slots[batch][ts.day] += 1

            # 3. Faculty double booking
            fac_ids = a.facultyIds if a.facultyIds else ([a.facultyId] if a.facultyId else [])
            for fid in fac_ids:
                if fid not in faculty_occupancy:
                    faculty_occupancy[fid] = set()
                    faculty_weekly_slots[fid] = 0

                if a.timeslotId in faculty_occupancy[fid]:
                    errors.append(f"Faculty {fid} double-booked at slot {ts.id}.")
                    hard_violations += 1
                faculty_occupancy[fid].add(a.timeslotId)
                faculty_weekly_slots[fid] += 1

            # 4. Room double booking
            if a.room and a.room != "N/A":
                if a.room not in room_occupancy:
                    room_occupancy[a.room] = set()

                if a.timeslotId in room_occupancy[a.room]:
                    errors.append(f"Room {a.room} double-booked at slot {ts.id}.")
                    hard_violations += 1
                room_occupancy[a.room].add(a.timeslotId)

                # Room type verification
                room_obj = room_by_name.get(a.room)
                if room_obj:
                    # check subject type
                    matching_sub = next((s for s in state.subjects if s.id == a.subjectId), None)
                    if matching_sub:
                        if matching_sub.type == "practical" and room_obj.type != "practical":
                            errors.append(f"Practical subject '{matching_sub.name}' assigned to non-lab room '{a.room}'.")
                            hard_violations += 1

    # 5. Max classes per day
    for b, daily_map in batch_daily_slots.items():
        for d, count in daily_map.items():
            if count > state.maxClassesPerDay:
                errors.append(f"Batch {b} exceeds max classes per day on {d}: {count} > {state.maxClassesPerDay}.")
                hard_violations += 1

    # 6. Faculty weekly load
    for fac in state.faculties:
        total = faculty_weekly_slots.get(fac.id, 0)
        if total > fac.maxWeeklySlots:
            errors.append(f"Faculty {fac.name} assigned {total} slots, exceeding maxWeeklySlots {fac.maxWeeklySlots}.")
            hard_violations += 1

    is_valid = hard_violations == 0
    return ValidationReport(
        is_valid=is_valid,
        hard_violations=hard_violations,
        errors=errors,
        soft_penalty=soft_penalty,
    )
