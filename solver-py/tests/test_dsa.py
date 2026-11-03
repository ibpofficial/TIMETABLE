import pytest
from solver_py.models import (
    SchedulerInputState,
    Room,
    Subject,
    Faculty,
    Timeslot,
    RoomsContainer,
    SolverOptions,
)
from solver_py.dsa import (
    run_feasibility_precheck,
    ConflictGraph,
    dsatur_coloring,
    BitsetOccupancy,
    assign_rooms_hungarian,
)


def create_sample_state():
    return SchedulerInputState(
        days=["Monday", "Tuesday", "Wednesday"],
        startTime="09:00",
        endTime="12:00",
        slotLength=60,
        maxClassesPerDay=3,
        rooms=RoomsContainer(
            theoryList=[Room(id="r1", name="R101", capacity=50, type="theory")],
            labList=[Room(id="l1", name="L201", capacity=30, type="practical")],
        ),
        batches=["BatchA"],
        faculties=[Faculty(id="f1", name="Dr. A", maxWeeklySlots=10)],
        subjects=[
            Subject(
                id="s1",
                name="Math",
                type="theory",
                classesPerWeek=2,
                sessionLength=1,
                facultyId="f1",
                batches=["BatchA"],
            )
        ],
        breaks=[],
        events=[],
    )


def test_feasibility_precheck_feasible():
    state = create_sample_state()
    timeslots = [
        Timeslot(id=f"ts_{i}", day="Monday", start="09:00", end="10:00", startMin=540, endMin=600, isBreak=False, index=i)
        for i in range(9)
    ]
    res = run_feasibility_precheck(state, timeslots)
    assert res.is_feasible is True
    assert len(res.bottlenecks) == 0


def test_feasibility_precheck_infeasible_faculty_overload():
    state = create_sample_state()
    state.faculties[0].maxWeeklySlots = 1  # but subject needs 2
    timeslots = [
        Timeslot(id=f"ts_{i}", day="Monday", start="09:00", end="10:00", startMin=540, endMin=600, isBreak=False, index=i)
        for i in range(9)
    ]
    res = run_feasibility_precheck(state, timeslots)
    assert res.is_feasible is False
    assert any("maxWeeklySlots" in b for b in res.bottlenecks)


def test_dsatur_graph_coloring():
    sessions = [
        {"id": "s1", "batches": ["B1"], "facultyIds": ["f1"]},
        {"id": "s2", "batches": ["B1"], "facultyIds": ["f2"]},  # Clashes with s1 (same batch)
        {"id": "s3", "batches": ["B2"], "facultyIds": ["f1"]},  # Clashes with s1 (same faculty)
        {"id": "s4", "batches": ["B3"], "facultyIds": ["f3"]},  # Independent
    ]
    graph = ConflictGraph(sessions)
    graph.build_from_state()

    colors = dsatur_coloring(graph)
    assert len(colors) == 4
    # S1 and S2 share batch B1 -> cannot have same color
    assert colors[0] != colors[1]
    # S1 and S3 share faculty f1 -> cannot have same color
    assert colors[0] != colors[2]


def test_bitset_occupancy():
    bitset = BitsetOccupancy(num_resources=3, num_slots=10)
    assert bitset.is_free(0, 2, 2) is True

    bitset.occupy(0, 2, 2)
    assert bitset.is_free(0, 2, 2) is False
    assert bitset.is_free(0, 3, 1) is False
    assert bitset.is_free(0, 4, 1) is True

    bitset.release(0, 2, 2)
    assert bitset.is_free(0, 2, 2) is True


def test_hungarian_room_assignment():
    sessions = [
        {"id": "s1", "capacityRequirement": 40, "roomType": "theory"},
        {"id": "s2", "capacityRequirement": 20, "roomType": "practical"},
    ]
    rooms = [
        Room(id="r1", name="Large Theory", capacity=60, type="theory"),
        Room(id="r2", name="Lab 1", capacity=30, type="practical"),
    ]
    assignments = assign_rooms_hungarian(sessions, rooms)
    assert assignments["s1"] == "Large Theory"
    assert assignments["s2"] == "Lab 1"
