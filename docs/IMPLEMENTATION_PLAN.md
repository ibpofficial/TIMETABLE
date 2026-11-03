# IBP Timetable Generator: Industrial-Grade Upgrade Implementation Plan

**Author:** Principal Optimization & Systems Engineer  
**Date:** November 2026  
**Status:** In Progress (Phase 1 Underway)  
**Target:** Transform IBP Timetable Generator into an industrial-strength, enterprise-grade constraint optimization scheduling engine with dual execution engines (TypeScript worker + Python CP-SAT service), rich academic modeling, interactive clash-resolution UI, full explainability, and multi-tenant persistence.

---

## 1. Executive Summary & Goals

The IBP Timetable Generator is currently a functional college timetable creator built with a React frontend and Node/Express backend. While it features an intuitive 8-step wizard, AI co-pilot, and in-browser scheduling, its core solver is a hand-written backtracking search capped at 4,000 attempts with hardcoded soft penalties. It struggles on medium-to-large institutions, lacks support for complex constraints (e.g., room travel times, co-teaching, section splits, non-uniform periods, teacher load limits), duplicates solver logic across client and server, and lacks automated test coverage.

### Key Upgrade Objectives
1. **Unified Schema & Contracts:** A single source of truth in `packages/shared` providing TypeScript interfaces, Zod runtime schemas, JSON Schema generation, and Pydantic v2 models in Python.
2. **Dual-Engine Architecture:**
   - **`packages/solver-ts`:** An optimized, unified TypeScript solver maintaining browser Web Worker compatibility for instant client-side execution on small-to-medium problems.
   - **`solver-py/`:** A high-performance Python FastAPI service powered by Google OR-Tools CP-SAT, Large Neighborhood Search (LNS), graph coloring (DSATUR), network flow feasibility checks, and scikit-learn advisory models.
3. **Enterprise Data Model (v2):** Backward-compatible schema supporting multi-institution types, lab group splits, multi-room travel matrices, non-uniform periods, 30+ togglable/weighted constraint templates, and LLM-assisted natural language constraint parsing.
4. **Resilient Backend:** Redis/BullMQ job queues with Server-Sent Events (SSE) streaming, PostgreSQL multi-tenant isolation, versioned timetable histories with diffing, and zero memory leaks.
5. **Interactive UI & Explainability:** Clash highlighting, minimal unsat-core explanations, repair recommendations with minimum disruption, and multi-format exports (PDF, Excel, CSV, iCal).

---

## 2. Current State Analysis

| Component | Current Implementation | Observed Limitations |
|-----------|------------------------|----------------------|
| **Monorepo Structure** | npm workspaces (`client`, `server`) | Root cluttered with legacy vanilla JS (`app.js`, `index.html`, `styles.css`, `firestore.rules`). |
| **Solver (TS)** | Duplicated in `client/src/scheduler/solver.ts` and `server/src/scheduler/solver.ts` (926 lines each) | Logic drift, O(n²) scans in `rankDomainValues`, memory bloat via full Cartesian domains, 4000-attempt arbitrary cutoff. |
| **Test Suite** | Vitest installed in `server`, 0 test files | Zero safety net for refactoring or regression detection. |
| **Data Persistence** | SQLite via Prisma (`server/prisma/dev.db`) checked into git | Ephemeral session-based queries (`sessionId`), non-production database, no migrations for v2 models. |
| **Job Execution** | In-memory `Map` in `server/src/jobs.ts` | Jobs lost on process restart; no horizontal scaling or distributed worker queue. |
| **Asset Paths** | Missing banner/flow SVGs in `docs/` and `assets/` | Broken links in documentation. |
| **Constraints** | Hard-coded heuristic weights (50, 100, 30, 15) | No user configurability, lack of building travel time, co-teaching, or group splits. |

---

## 3. Gap Analysis & Resolution Matrix

| Issue ID | Identified Problem | Root Cause | Target Solution |
|----------|-------------------|------------|-----------------|
| **GAP-01** | Duplicate TS Solver | Separate files copied during MVP development | Extract to `packages/solver-ts` imported by client and server. |
| **GAP-02** | Solver Scalability Ceiling | Naive backtracking without mathematical programming | Deploy OR-Tools CP-SAT in `solver-py/` with LNS and DSATUR initial bounds. |
| **GAP-03** | Domain Inefficiency | Full Cartesian product allocation (`timeslot × room`) | Bitset occupancy masks, interval trees, and separate time placement from room matching. |
| **GAP-04** | Magic Constraint Numbers | Fixed score penalties in solver loops | Configurable `ConstraintTemplate` architecture with user-adjusted weights (0–1000). |
| **GAP-05** | Zero Test Coverage | Tests were omitted in original repo | Comprehensive test suite: golden benchmark instances, unit tests, property-based tests (Hypothesis), integration tests. |
| **GAP-06** | Ephemeral Jobs & Auth | In-memory `Map` and `sessionId` strings | BullMQ + Redis for resilient job queues, JWT authentication with RBAC and organisation isolation. |
| **GAP-07** | Git Cleanliness | `dev.db` and legacy files in git root | Move legacy files to `legacy/`, remove `dev.db*` from git, update `.gitignore`. |
| **GAP-08** | Inflexible Academic Model | Only basic batch/subject/faculty model | Schema v2: departments, programs, lab groups (A1/A2), co-teaching, shifts, travel matrices. |
| **GAP-09** | Black-box Infeasibility | Fails silently or gives arbitrary diagnostics | Minimal UNSAT core explanation via OR-Tools assumptions, Hall's theorem pre-check, relaxation suggestions. |

---

## 4. Phased Execution Roadmap

### Phase 1: Foundation, Workspace Restructuring & Golden Suite
- **Step 1.1:** Legacy file migration (`app.js`, `index.html`, `styles.css`, `firestore.rules` -> `legacy/`). Remove `server/prisma/dev.db*` from git tracking and append to `.gitignore`.
- **Step 1.2:** Create monorepo package `packages/shared` containing core types, Zod schemas, and JSON schema exporter.
- **Step 1.3:** Create `packages/solver-ts` unifying the TypeScript backtracking solver. Update `client` and `server` to consume `packages/shared` and `packages/solver-ts`.
- **Step 1.4:** Build instance generator `tools/generate-instance.ts` and golden test suite with 25+ diverse instances (tiny, school, college, university, evil/infeasible).
- **Step 1.5:** Implement automated benchmark runner in `benchmarks/` measuring solve times, memory, constraint fulfillment, and soft scores.
- **Step 1.6:** Verification: full workspace build, Vitest unit tests pass, and initial benchmark recorded.

### Phase 2: Richer Academic Data Model (v2) & Migration Engine
- **Step 2.1:** Implement schema v2 supporting sections, lab subgroups, co-teaching, travel times, non-uniform periods, shifts, and 30+ constraint templates.
- **Step 2.2:** Build robust migration utility `migrateConfig(v1 -> v2)` with 100% backward compatibility for existing saved configurations.
- **Step 2.3:** Implement Constraint Studio definitions and schema validation for natural-language constraint translation.
- **Step 2.4:** Verification: test migrations against all sample datasets; ensure existing UI continues to render and save.

### Phase 3: Industrial Python Solver Service (`solver-py/`)
- **Step 3.1:** Scaffold FastAPI project in `solver-py/` with UV virtual environment, Pydantic v2 models, and OR-Tools 9.9+.
- **Step 3.2:** Implement CP-SAT optimization model with interval variables, `AddNoOverlap`, channel constraints, and weighted objective terms.
- **Step 3.3:** Build algorithmic acceleration layer: DSATUR graph coloring, Hall's condition/flow pre-checks, bitset occupancy matrix, Hungarian room assignment.
- **Step 3.4:** Implement Large Neighborhood Search (LNS) and Tabu Search soft-objective polishing.
- **Step 3.5:** Implement UNSAT core explainability and minimal relaxation suggestions.
- **Step 3.6:** Implement ML difficulty predictor and heuristic weight recommender (scikit-learn).
- **Step 3.7:** Build FastAPI endpoints (`/solve`, `/jobs/{id}`, `/validate`, `/explain`, `/repair`) with SSE streaming.
- **Step 3.8:** Verification: Pytest suite with property-based testing (Hypothesis), 85%+ coverage, independent solution validator.

### Phase 4: Backend Hardening & Data Persistence
- **Step 4.1:** Integrate BullMQ and Redis for persistent background job processing with cancellation and pause.
- **Step 4.2:** Prisma schema upgrade: PostgreSQL production readiness with SQLite fallback for local dev; models for Users, Orgs, Versioned Timetables, and Audit Logs.
- **Step 4.3:** JWT authentication, RBAC middleware, rate limiting, and structured logging (Pino).
- **Step 4.4:** Node API bridge to delegate solve jobs intelligently (small/browser vs large/Python).

### Phase 5: Product Features & Frontend Polish
- **Step 5.1:** Wizard v2 enhancements: Constraint Studio step, Preferences step, and Scenario step.
- **Step 5.2:** Live solving view with real-time objective convergence chart and best-so-far acceptance.
- **Step 5.3:** Interactive drag-and-drop timetable editor with instant clash detection, cell coloring, pinning, and minimal-disruption re-solve.
- **Step 5.4:** Master grid, room utilization heatmap, and faculty load distribution views.
- **Step 5.5:** Multi-format exports: print-ready PDF, Excel, CSV, iCalendar (.ics).

### Phase 6: Performance, Benchmarks & Verification
- **Step 6.1:** Benchmark evaluation across small, college, and university problem tiers.
- **Step 6.2:** Zero hard-constraint violation guarantee verified by independent validator.
- **Step 6.3:** Virtualized grid rendering for large datasets ensuring < 50ms main thread blocking.

### Phase 7: DevOps, Documentation & World-Class README
- **Step 7.1:** Docker multi-stage builds and `docker-compose.yml` (client, server, solver-py, postgres, redis).
- **Step 7.2:** Comprehensive README.md with dark/light hero banner, animated architecture SVG, flow diagrams, real benchmark data, and API reference.
- **Step 7.3:** Community documents (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue templates).
- **Step 7.4:** Lighthouse audits and SEO verification.

---

## 5. Risk Assessment & Mitigation

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| **Regression in Existing UI** | High | Low | Pure additive schema changes with bidirectional `migrateConfig` adapter; Vitest & Playwright regression suites. |
| **Python Service Unavailable in Simple Deployments** | Medium | Medium | Automatic fallback to `packages/solver-ts` when Python backend is unreachable. UI transparently informs user of engine tier. |
| **Solving Timeout on Massive Universities** | High | Medium | Fast initial feasible solution via DSATUR + flow matching within 5 seconds, followed by progressive CP-SAT/LNS refinement with streaming best-so-far. |
| **Node/Python Schema Drift** | High | Low | JSON Schema as central contract; automated generation of TypeScript and Pydantic types checked during CI. |
| **Windows Sandbox / Tool Availability** | Medium | Low | Use isolated `uv` for Python environments and MinGit; zero dependency on system administrator rights. |
