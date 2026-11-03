"""FastAPI Service for IBP Timetable Industrial Optimization Platform.

Endpoints:
- POST /solve
- GET /jobs/{id}
- POST /validate
- POST /explain
- POST /repair
- POST /predict-difficulty
- GET /health
"""

import uuid
import time
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ortools

from .models import (
    SchedulerInputState,
    ScheduleSolution,
    SolverProgress,
    FailureDiagnostic,
)
from .cpsat_solver import CPSATScheduler
from .validator import validate_solution
from .lns import LargeNeighborhoodSearch, repair_schedule_minimum_disruption
from .ml_models import TimetableDifficultyPredictor, recommend_solver_strategy
from .dsa import run_feasibility_precheck

app = FastAPI(
    title="IBP Timetable Optimization Service",
    version="2.0.0",
    description="High-performance constraint optimization microservice powered by Google OR-Tools CP-SAT and machine learning assist models.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active jobs memory cache
active_jobs: Dict[str, Dict[str, Any]] = {}
difficulty_predictor = TimetableDifficultyPredictor()


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "solver-py",
        "ortoolsVersion": ortools.__version__,
        "activeJobs": len(active_jobs),
    }


class SolveRequest(BaseModel):
    state: SchedulerInputState
    timeLimitSeconds: Optional[int] = None
    useLNS: Optional[bool] = False


@app.post("/solve")
def solve_schedule_endpoint(req: SolveRequest):
    """Synchronous solve endpoint for immediate computation."""
    scheduler = CPSATScheduler(req.state)
    solution, diagnostics = scheduler.solve(time_limit_seconds=req.timeLimitSeconds)

    if solution and req.useLNS:
        lns = LargeNeighborhoodSearch(scheduler)
        solution = lns.optimize_lns(solution, max_iterations=3, time_limit_seconds=req.timeLimitSeconds or 10)

    # Validate solution independently
    validation = None
    if solution:
        val_report = validate_solution(req.state, solution)
        validation = {
            "isValid": val_report.is_valid,
            "hardViolations": val_report.hard_violations,
            "errors": val_report.errors,
        }

    return {
        "status": "success" if (solution and not diagnostics) else ("failed" if solution else "infeasible"),
        "solution": solution,
        "diagnostics": diagnostics,
        "validation": validation,
    }


def _run_background_solve(job_id: str, state: SchedulerInputState, time_limit: Optional[int]):
    scheduler = CPSATScheduler(state)

    def on_progress(prog_data: Dict[str, Any]):
        if job_id in active_jobs:
            active_jobs[job_id]["progress"] = prog_data

    solution, diagnostics = scheduler.solve(on_progress=on_progress, time_limit_seconds=time_limit)

    if job_id in active_jobs:
        active_jobs[job_id]["status"] = "success" if (solution and not diagnostics) else "failed"
        active_jobs[job_id]["solution"] = solution
        active_jobs[job_id]["diagnostics"] = diagnostics
        active_jobs[job_id]["completedAt"] = time.time()


@app.post("/jobs/start")
def start_solve_job(req: SolveRequest, background_tasks: BackgroundTasks):
    """Starts an asynchronous solving job with tracking ID."""
    job_id = f"py_job_{uuid.uuid4().hex[:8]}"
    active_jobs[job_id] = {
        "id": job_id,
        "status": "running",
        "startedAt": time.time(),
        "progress": {},
        "solution": None,
        "diagnostics": None,
    }

    background_tasks.add_task(_run_background_solve, job_id, req.state, req.timeLimitSeconds)
    return {"jobId": job_id, "status": "running"}


@app.get("/jobs/{job_id}")
def get_job_status(job_id: str):
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return active_jobs[job_id]


class ValidateRequest(BaseModel):
    state: SchedulerInputState
    solution: ScheduleSolution


@app.post("/validate")
def validate_solution_endpoint(req: ValidateRequest):
    """Independently verifies every constraint in a candidate timetable."""
    report = validate_solution(req.state, req.solution)
    return {
        "isValid": report.is_valid,
        "hardViolations": report.hard_violations,
        "errors": report.errors,
        "softPenalty": report.soft_penalty,
    }


@app.post("/explain")
def explain_infeasibility_endpoint(state: SchedulerInputState):
    """Pre-checks feasibility and explains structural bottlenecks if impossible."""
    scheduler = CPSATScheduler(state)
    precheck = run_feasibility_precheck(state, scheduler.timeslots)
    prediction = difficulty_predictor.predict(state)
    strategy = recommend_solver_strategy(state)

    return {
        "isFeasiblePrecheck": precheck.is_feasible,
        "bottlenecks": precheck.bottlenecks,
        "difficultyPrediction": prediction,
        "strategyRecommendation": strategy,
    }


class RepairRequest(BaseModel):
    state: SchedulerInputState
    baselineSolution: ScheduleSolution
    lockedAssignments: list[str]


@app.post("/repair")
def repair_schedule_endpoint(req: RepairRequest):
    """Re-optimizes schedule around locked assignments with minimal disruption."""
    solution, diagnostics = repair_schedule_minimum_disruption(
        req.state, req.baselineSolution, req.lockedAssignments
    )
    return {
        "status": "success" if solution else "failed",
        "solution": solution,
        "diagnostics": diagnostics,
    }


@app.post("/predict-difficulty")
def predict_difficulty_endpoint(state: SchedulerInputState):
    return difficulty_predictor.predict(state)
