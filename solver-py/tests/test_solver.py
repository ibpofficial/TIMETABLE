import pytest
from solver_py.models import (
    SchedulerInputState,
    Room,
    Subject,
    Faculty,
    RoomsContainer,
    SolverOptions,
)
from solver_py.cpsat_solver import CPSATScheduler
from solver_py.validator import validate_solution
from solver_py.lns import LargeNeighborhoodSearch


def create_test_instance(num_batches=2, classes_per_week=2):
    return SchedulerInputState(
        days=["Monday", "Tuesday", "Wednesday"],
        startTime="09:00",
        endTime="13:00",
        slotLength=60,
        maxClassesPerDay=4,
        rooms=RoomsContainer(
            theoryList=[
                Room(id="t1", name="Room 101", capacity=60, type="theory"),
                Room(id="t2", name="Room 102", capacity=60, type="theory"),
            ],
            labList=[
                Room(id="l1", name="Lab 201", capacity=30, type="practical"),
            ],
        ),
        batches=[f"Batch_{i+1}" for i in range(num_batches)],
        faculties=[
            Faculty(id="f1", name="Prof. Alpha", maxWeeklySlots=15),
            Faculty(id="f2", name="Prof. Beta", maxWeeklySlots=15),
        ],
        subjects=[
            Subject(
                id=f"sub_{i+1}",
                name=f"Course_{i+1}",
                type="theory",
                classesPerWeek=classes_per_week,
                sessionLength=1,
                facultyId="f1" if i % 2 == 0 else "f2",
                batches=[f"Batch_{i+1}"],
            )
            for i in range(num_batches)
        ],
        breaks=[],
        events=[],
        options=SolverOptions(engine="python", timeLimitSeconds=10, randomSeed=42),
    )


def test_cpsat_solver_feasible():
    state = create_test_instance(num_batches=2, classes_per_week=3)
    scheduler = CPSATScheduler(state)
    solution, diagnostics = scheduler.solve()

    assert solution is not None
    assert len(diagnostics) == 0

    # Independent validation
    report = validate_solution(state, solution)
    assert report.is_valid is True
    assert report.hard_violations == 0


def test_cpsat_solver_infeasible_detected():
    state = create_test_instance(num_batches=2, classes_per_week=3)
    # Make impossible: 1 slot limit per day, but batches need 3 slots in 3 days
    state.maxClassesPerDay = 0
    scheduler = CPSATScheduler(state)
    solution, diagnostics = scheduler.solve()

    assert solution is None
    assert len(diagnostics) > 0


def test_lns_optimization():
    state = create_test_instance(num_batches=2, classes_per_week=2)
    scheduler = CPSATScheduler(state)
    solution, diagnostics = scheduler.solve()
    assert solution is not None

    lns = LargeNeighborhoodSearch(scheduler)
    polished = lns.optimize_lns(solution, max_iterations=2, time_limit_seconds=5)
    assert polished is not None
    report = validate_solution(state, polished)
    assert report.is_valid is True

