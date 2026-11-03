import pytest
from hypothesis import given, settings, strategies as st
from solver_py.models import (
    SchedulerInputState,
    RoomsContainer,
    Room,
    Faculty,
    Subject,
    SolverOptions,
)
from solver_py.cpsat_solver import CPSATScheduler
from solver_py.validator import validate_solution


@settings(max_examples=10, deadline=15000)
@given(
    num_batches=st.integers(min_value=1, max_value=3),
    classes_per_week=st.integers(min_value=1, max_value=3),
)
def test_hypothesis_zero_hard_constraint_violations(num_batches: int, classes_per_week: int):
    """Property: Any solution returned by CPSATScheduler must ALWAYS have 0 hard constraint violations."""
    state = SchedulerInputState(
        days=["Monday", "Tuesday", "Wednesday"],
        startTime="09:00",
        endTime="13:00",
        slotLength=60,
        maxClassesPerDay=4,
        rooms=RoomsContainer(
            theoryList=[
                Room(id=f"r_{i}", name=f"Room_{i}", capacity=60, type="theory")
                for i in range(num_batches)
            ],
            labList=[],
        ),
        batches=[f"Batch_{i}" for i in range(num_batches)],
        faculties=[
            Faculty(id=f"f_{i}", name=f"Prof_{i}", maxWeeklySlots=15)
            for i in range(num_batches)
        ],
        subjects=[
            Subject(
                id=f"s_{i}",
                name=f"Subject_{i}",
                type="theory",
                classesPerWeek=classes_per_week,
                sessionLength=1,
                facultyId=f"f_{i}",
                batches=[f"Batch_{i}"],
            )
            for i in range(num_batches)
        ],
        breaks=[],
        events=[],
        options=SolverOptions(engine="python", timeLimitSeconds=5, randomSeed=123),
    )

    scheduler = CPSATScheduler(state)
    solution, _ = scheduler.solve()

    if solution is not None:
        report = validate_solution(state, solution)
        assert report.is_valid is True, f"Hard violations detected: {report.errors}"
        assert report.hard_violations == 0
