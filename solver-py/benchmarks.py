"""Performance Benchmark Runner for Python CP-SAT Solver.

Evaluates OR-Tools CP-SAT engine across 4 tiers:
- Small (5 Batches)
- College (16 Batches)
- University (40 Batches)
- Evil / Heavily Constrained

Validates 0 hard constraint violations with independent mathematical validator.
Outputs JSON and Markdown metrics.
"""

import time
import json
import tracemalloc
from typing import List, Dict, Any

from solver_py.models import SchedulerInputState, Subject, Room, Faculty, Break, RoomsContainer
from solver_py.cpsat_solver import CPSATScheduler
from solver_py.validator import validate_solution


def make_test_instance(tier: str) -> SchedulerInputState:
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]

    if tier == "small":
        num_batches = 5
        num_faculty = 15
        num_theory_rooms = 6
        num_lab_rooms = 2
        classes_per_batch = 5
    elif tier == "college":
        num_batches = 16
        num_faculty = 35
        num_theory_rooms = 16
        num_lab_rooms = 6
        classes_per_batch = 6
    elif tier == "university":
        num_batches = 40
        num_faculty = 80
        num_theory_rooms = 35
        num_lab_rooms = 12
        classes_per_batch = 6
    else:  # evil
        num_batches = 8
        num_faculty = 18
        num_theory_rooms = 7
        num_lab_rooms = 2
        classes_per_batch = 5

    batches = [f"Batch_{tier.upper()}_{i+1}" for i in range(num_batches)]
    theory_rooms = [
        Room(id=f"T_{i+1}", name=f"Room_{100+i+1}", type="theory", capacity=70, building=f"Block_{(i%2)+1}")
        for i in range(num_theory_rooms)
    ]
    lab_rooms = [
        Room(id=f"L_{i+1}", name=f"Lab_{200+i+1}", type="practical", capacity=60, building=f"Block_{(i%2)+1}")
        for i in range(num_lab_rooms)
    ]

    faculties = [
        Faculty(
            id=f"F_{i+1}",
            name=f"Prof. {chr(65 + (i % 26))}{i+1}",
            maxWeeklySlots=24,
            maxDailySlots=5,
            leaves=0,
            unavail=[],
        )
        for i in range(num_faculty)
    ]

    subjects: List[Subject] = []
    sub_id = 1
    for b_idx, b in enumerate(batches):
        for s in range(classes_per_batch):
            is_lab = (s == classes_per_batch - 1)
            fac = faculties[(b_idx * classes_per_batch + s) % num_faculty]
            classes_per_week = 1 if is_lab else (3 if s < 2 else 2)
            session_length = 2 if is_lab else 1
            subjects.append(
                Subject(
                    id=f"SUB_{sub_id}",
                    name=f"{'Lab' if is_lab else 'Course'}_{s+1}_{b}",
                    type="practical" if is_lab else "theory",
                    classesPerWeek=classes_per_week,
                    sessionLength=session_length,
                    facultyId=fac.id,
                    batches=[b],
                    preferredRoomTypes=["practical" if is_lab else "theory"],
                )
            )
            sub_id += 1

    breaks = [Break(day=d, start="13:00", durationMins=60) for d in days]

    return SchedulerInputState(
        days=days,
        startTime="09:00",
        endTime="17:00",
        slotLength=60,
        maxClassesPerDay=6,
        rooms=RoomsContainer(theoryList=theory_rooms, labList=lab_rooms),
        batches=batches,
        batchSizes={b: 50 for b in batches},
        faculties=faculties,
        subjects=subjects,
        breaks=breaks,
        events=[],
    )


def run_py_benchmarks() -> List[Dict[str, Any]]:
    tiers = [
        ("small", "Small (Tier 1)"),
        ("college", "College (Tier 2)"),
        ("university", "University (Tier 3)"),
        ("evil", "Evil / Heavily Constrained (Tier 4)"),
    ]

    results = []
    print("=" * 70)
    print("  IBP TIMETABLE GENERATOR — PYTHON CP-SAT INDUSTRIAL BENCHMARK")
    print("=" * 70)

    for tier_key, tier_name in tiers:
        instance = make_test_instance(tier_key)
        total_sessions = sum(s.classesPerWeek for s in instance.subjects)
        num_batches = len(instance.batches)
        num_rooms = len(instance.rooms.theoryList) + len(instance.rooms.labList)

        tracemalloc.start()
        t0 = time.perf_counter()

        scheduler = CPSATScheduler(instance)
        solution, diagnostics = scheduler.solve(time_limit_seconds=30)

        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
        current_mem, peak_mem = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        peak_mb = round(peak_mem / (1024 * 1024), 2)

        # Independent validation
        val_report = validate_solution(instance, solution) if solution else None
        hard_violations = val_report.hard_violations if val_report else 999
        is_valid = val_report.is_valid if val_report else False

        placed_count = sum(len(l) for l in solution.byBatch.values()) if solution else 0
        satisfaction_pct = 100.0 if hard_violations == 0 and solution else 0.0

        item = {
            "tier": tier_name,
            "engine": "Python CP-SAT (OR-Tools)",
            "batches": num_batches,
            "faculty": len(instance.faculties),
            "rooms": num_rooms,
            "totalSessions": total_sessions,
            "placedSessions": placed_count,
            "timeMs": elapsed_ms,
            "memoryMb": peak_mb,
            "hardViolations": hard_violations,
            "hardSatisfactionPct": satisfaction_pct,
            "softScore": solution.score.get("softScore", 0) if solution and solution.score else 0,
            "isValid": is_valid,
        }
        results.append(item)

        print(f"[{tier_name}]")
        print(f"  Sessions: {placed_count}/{total_sessions} placed | Time: {elapsed_ms} ms | Memory: {peak_mb} MB")
        print(f"  Hard Violations: {hard_violations} (Valid: {is_valid}) | Soft Penalty: {item['softScore']}")
        print("-" * 70)

    return results


if __name__ == "__main__":
    benchmark_data = run_py_benchmarks()
    with open("benchmarks/python_results.json", "w") as f:
        json.dump(benchmark_data, f, indent=2)
    print("Benchmark results saved to benchmarks/python_results.json")
