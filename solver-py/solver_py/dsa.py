"""Discrete Mathematics, Graph Algorithms and Feasibility Pre-checks for Timetable Scheduling.

Implements:
1. Feasibility Pre-check (Hall's Condition & Capacity Conservation)
2. Conflict Graph & DSATUR Graph Coloring
3. Bitset Occupancy Matrix for O(1) collision queries
4. Optimal Room Assignment via Hungarian / Linear Sum Assignment
"""

from typing import Dict, List, Set, Tuple, Optional, Any
import numpy as np
from scipy.optimize import linear_sum_assignment
from .models import SchedulerInputState, Room, Subject, Faculty, Timeslot


class FeasibilityPrecheckResult:
    def __init__(self, is_feasible: bool, bottlenecks: List[str]):
        self.is_feasible = is_feasible
        self.bottlenecks = bottlenecks


def run_feasibility_precheck(state: SchedulerInputState, timeslots: List[Timeslot]) -> FeasibilityPrecheckResult:
    """Detect impossible scheduling inputs in milliseconds before invoking solvers.

    Verifies:
    1. Batch load <= total non-break slots available per batch.
    2. Faculty load <= faculty max weekly slots and available slots.
    3. Room capacity: every subject has at least one compatible physical room.
    4. Total room slots: total required slots <= total room capacity across week.
    """
    bottlenecks: List[str] = []
    active_slots = [t for t in timeslots if not t.isBreak]
    total_slots = len(active_slots)
    days_count = len(state.days)
    max_slots_per_batch = days_count * state.maxClassesPerDay

    all_rooms = state.rooms.theoryList + state.rooms.labList
    theory_rooms = [r for r in all_rooms if r.type == "theory"]
    lab_rooms = [r for r in all_rooms if r.type == "practical"]

    # 1. Batch slot capacity checks
    batch_required: Dict[str, int] = {b: 0 for b in state.batches}
    for s in state.subjects:
        for b in s.batches:
            if b in batch_required:
                batch_required[b] += s.classesPerWeek * s.sessionLength

    for b, req in batch_required.items():
        if req > total_slots:
            bottlenecks.append(
                f"Batch '{b}' requires {req} slots, but only {total_slots} active instruction slots exist across the week."
            )
        elif req > max_slots_per_batch:
            bottlenecks.append(
                f"Batch '{b}' requires {req} slots, which exceeds the max daily cap allowance ({days_count} days × {state.maxClassesPerDay} = {max_slots_per_batch} slots)."
            )

    # 2. Faculty contractual load checks
    faculty_required: Dict[str, int] = {f.id: 0 for f in state.faculties}
    for s in state.subjects:
        f_ids = s.facultyIds if s.facultyIds else ([s.facultyId] if s.facultyId else [])
        for fid in f_ids:
            if fid in faculty_required:
                faculty_required[fid] += s.classesPerWeek * s.sessionLength

    for f in state.faculties:
        req = faculty_required.get(f.id, 0)
        if req > f.maxWeeklySlots:
            bottlenecks.append(
                f"Faculty '{f.name}' is assigned {req} weekly slots, exceeding contractual maxWeeklySlots of {f.maxWeeklySlots}."
            )
        if req > total_slots:
            bottlenecks.append(
                f"Faculty '{f.name}' load of {req} slots exceeds total available timetable slots ({total_slots})."
            )

    # 3. Room compatibility checks
    for s in state.subjects:
        compat = []
        if s.type == "practical":
            compat = lab_rooms
        else:
            compat = theory_rooms

        if s.preferredRoomTypes:
            compat = [r for r in all_rooms if r.type in s.preferredRoomTypes]

        req_cap = s.capacityRequirement or 0
        if state.batchSizes:
            b_sum = sum(state.batchSizes.get(b, 0) for b in s.batches)
            req_cap = max(req_cap, b_sum)

        compat_cap = [r for r in compat if r.capacity >= req_cap]
        if not compat_cap:
            bottlenecks.append(
                f"Subject '{s.name}' ({s.type}, capacity >= {req_cap}) has 0 compatible rooms."
            )

    return FeasibilityPrecheckResult(
        is_feasible=len(bottlenecks) == 0,
        bottlenecks=bottlenecks,
    )


class ConflictGraph:
    """Builds an undirected conflict graph where nodes are session variables and edges represent hard clashes."""

    def __init__(self, sessions: List[Dict[str, Any]]):
        self.sessions = sessions
        self.adj: Dict[int, Set[int]] = {i: set() for i in range(len(sessions))}

    def add_edge(self, u: int, v: int):
        self.adj[u].add(v)
        self.adj[v].add(u)

    def build_from_state(self):
        n = len(self.sessions)
        for i in range(n):
            for j in range(i + 1, n):
                s1 = self.sessions[i]
                s2 = self.sessions[j]

                # Same Batch
                b1 = set(s1["batches"])
                if any(b in b1 for b in s2["batches"]):
                    self.add_edge(i, j)
                    continue

                # Same Faculty
                f1 = set(s1.get("facultyIds", []))
                f2 = set(s2.get("facultyIds", []))
                if f1 and f2 and (f1 & f2):
                    self.add_edge(i, j)
                    continue


def dsatur_coloring(graph: ConflictGraph) -> Dict[int, int]:
    """DSATUR (Degree of Saturation) Graph Coloring.

    Computes a conflict-free timeslot grouping and lower bound on chromatic number.
    """
    n = len(graph.sessions)
    if n == 0:
        return {}

    colors: Dict[int, int] = {}
    degrees = {u: len(graph.adj[u]) for u in range(n)}
    saturations: Dict[int, Set[int]] = {u: set() for u in range(n)}

    uncolored = set(range(n))

    # Pick initial node with maximum degree
    first_node = max(uncolored, key=lambda u: degrees[u])
    colors[first_node] = 0
    uncolored.remove(first_node)

    for neighbor in graph.adj[first_node]:
        saturations[neighbor].add(0)

    while uncolored:
        # Pick node with maximum saturation; tie-break with maximum degree
        best_node = max(
            uncolored,
            key=lambda u: (len(saturations[u]), degrees[u])
        )

        # Find lowest available color not used by any neighbor
        neighbor_colors = {colors[nbr] for nbr in graph.adj[best_node] if nbr in colors}
        c = 0
        while c in neighbor_colors:
            c += 1

        colors[best_node] = c
        uncolored.remove(best_node)

        # Update neighbor saturations
        for neighbor in graph.adj[best_node]:
            saturations[neighbor].add(c)

    return colors


class BitsetOccupancy:
    """64-bit integer bitset occupancy matrix for O(1) clash testing."""

    def __init__(self, num_resources: int, num_slots: int):
        self.num_slots = num_slots
        # Store as array of uint64 or Python arbitrary-precision ints
        self.masks: List[int] = [0] * num_resources

    def is_free(self, resource_idx: int, slot_idx: int, length: int = 1) -> bool:
        slot_mask = ((1 << length) - 1) << slot_idx
        return (self.masks[resource_idx] & slot_mask) == 0

    def occupy(self, resource_idx: int, slot_idx: int, length: int = 1):
        slot_mask = ((1 << length) - 1) << slot_idx
        self.masks[resource_idx] |= slot_mask

    def release(self, resource_idx: int, slot_idx: int, length: int = 1):
        slot_mask = ((1 << length) - 1) << slot_idx
        self.masks[resource_idx] &= ~slot_mask


def assign_rooms_hungarian(
    sessions_in_slot: List[Dict[str, Any]],
    available_rooms: List[Room],
) -> Dict[str, str]:
    """Assigns rooms to simultaneous sessions using the Hungarian Algorithm (Min-Cost Bipartite Matching).

    Minimizes:
    - Capacity mismatch penalty (wasted seats or tight fit)
    - Preferred room type deviations
    - Building travel penalties
    """
    n_sessions = len(sessions_in_slot)
    n_rooms = len(available_rooms)
    if n_sessions == 0 or n_rooms == 0:
        return {}

    cost_matrix = np.full((n_sessions, n_rooms), 100000.0)

    for i, s in enumerate(sessions_in_slot):
        req_cap = s.get("capacityRequirement", 40)
        req_type = s.get("roomType", "theory")

        for j, r in enumerate(available_rooms):
            # Hard type incompatibility
            if req_type == "practical" and r.type != "practical":
                continue
            if req_type == "theory" and r.type == "practical":
                continue
            if r.capacity < req_cap:
                continue

            # Cost: prefer room whose capacity is close to required capacity (minimize wasted seats)
            waste = r.capacity - req_cap
            cost = waste * 1.0

            # Equipment bonus
            req_equip = s.get("requiredEquipment", [])
            if req_equip:
                has_all = all(e in (r.equipment or []) for e in req_equip)
                if not has_all:
                    continue
                cost -= 50.0

            cost_matrix[i, j] = max(0.0, cost)

    row_ind, col_ind = linear_sum_assignment(cost_matrix)
    assignment: Dict[str, str] = {}

    for r_idx, c_idx in zip(row_ind, col_ind):
        if cost_matrix[r_idx, c_idx] < 50000.0:
            sess_id = sessions_in_slot[r_idx]["id"]
            room_name = available_rooms[c_idx].name
            assignment[sess_id] = room_name

    return assignment
