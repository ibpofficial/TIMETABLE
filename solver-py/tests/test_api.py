import pytest
from solver_py.api import (
    health_check,
    solve_schedule_endpoint,
    explain_infeasibility_endpoint,
    predict_difficulty_endpoint,
    SolveRequest,
)
from solver_py.models import SchedulerInputState, RoomsContainer, Room, Faculty, Subject


def get_minimal_state():
    return SchedulerInputState(
        days=["Monday", "Tuesday"],
        startTime="09:00",
        endTime="12:00",
        slotLength=60,
        maxClassesPerDay=3,
        rooms=RoomsContainer(
            theoryList=[Room(id="r1", name="Room 101", capacity=50, type="theory")],
            labList=[],
        ),
        batches=["Batch1"],
        faculties=[Faculty(id="f1", name="Dr. X", maxWeeklySlots=10)],
        subjects=[
            Subject(
                id="s1",
                name="Math",
                type="theory",
                classesPerWeek=2,
                sessionLength=1,
                facultyId="f1",
                batches=["Batch1"],
            )
        ],
        breaks=[],
        events=[],
    )


def test_health_endpoint():
    data = health_check()
    assert data["status"] == "healthy"
    assert "ortoolsVersion" in data


def test_solve_endpoint():
    req = SolveRequest(state=get_minimal_state())
    data = solve_schedule_endpoint(req)
    assert data["status"] == "success"
    assert data["solution"] is not None
    assert data["validation"]["isValid"] is True


def test_explain_endpoint():
    state = get_minimal_state()
    data = explain_infeasibility_endpoint(state)
    assert "isFeasiblePrecheck" in data
    assert "difficultyPrediction" in data
    assert "strategyRecommendation" in data


def test_predict_difficulty_endpoint():
    state = get_minimal_state()
    data = predict_difficulty_endpoint(state)
    assert "risk" in data
    assert "difficultyScore" in data
