# Changelog

All notable changes to the IBP Timetable Generator platform will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] - 2026-11-03

### Phase 7: DevOps, Containerization, World-Class Documentation & SEO (Completed)
- **Containerization & Production Stack:**
  - Added multi-stage `Dockerfile` for `client` (Node 20 + Nginx Alpine with SPA routing and API reverse-proxy).
  - Added multi-stage `Dockerfile` for `server` (Node 20 Alpine + Prisma generation + production bundle).
  - Added optimized `Dockerfile` for `solver-py` (Python 3.11-slim + OR-Tools + FastAPI).
  - Created `docker-compose.yml` orchestrating client, server, solver-py, PostgreSQL 16, and Redis 7 with healthchecks.
- **World-Class Documentation & Design Assets:**
  - Created animated SVG architecture diagram (`assets/architecture.svg`) with flowing data paths.
  - Rewrote `README.md` into an enterprise showcase with dual-engine comparison, real benchmark tables, interactive feature tour, API docs, and architecture diagrams.
  - Added repository governance files: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and MIT `LICENSE`.
  - Added SEO meta tags, OpenGraph, Twitter cards, JSON-LD `SoftwareApplication` schema, `robots.txt`, and `sitemap.xml`.

### Phase 6: Performance Benchmarking & Scale Target Validation (Completed)
- **Comprehensive Dual-Engine Benchmarks:**
  - Evaluated both `@ibp/solver-ts` (TypeScript Web Worker) and `solver-py` (Google OR-Tools CP-SAT) across 4 standard tiers: Tiny (2 Batches), School (6 Batches), College (12–20 Batches), and Evil (Infeasible).
  - Validated 0 hard constraint violations with independent mathematical validator.
  - Recorded real measured numbers in `benchmarks/BENCHMARKS.md` and `benchmarks/python_results.json`.
  - Optimized CP-SAT model building with an $O(|x\_vars|)$ inverted variable index, reducing setup latency from 40s to 15ms.

### Phase 5: Product Features & Frontend Polish (Completed)
- **Constraint Studio UI:**
  - Built `ConstraintStudio.tsx` allowing users to filter, toggle 30+ constraints, adjust weights (0–1000), apply presets, and describe rules in natural language with interactive preview before applying.
  - Integrated into Step 6 of wizard and added Solver Engine selector (`Auto`, `Browser Worker`, `Server CP-SAT`).
- **Interactive Timetable Inspection:**
  - Rewrote `Step7Results.tsx` with Panoramic Master View, Faculty Workload Analysis, Room Heatmap, and Free Room Finder.
  - Implemented real-time drag-and-drop clash highlights (green/amber/red) with tooltip diagnostic explanations.
  - Added session slot locking/pinning and "Re-optimize around locked sessions" support.
- **Multi-Format Exports:**
  - Implemented formatted multi-sheet Excel export (`.xlsx`) via SheetJS in `client/src/lib/exportUtils.ts`.
  - Implemented standard RFC 5545 iCalendar (`.ics`) export for calendar sync.

### Phase 4: Backend Hardening, Dynamic Solver Delegation & Enterprise Persistence (Completed)
- **Multi-Tenant Architecture & Auth:**
  - Added Prisma models for `User`, `Organization`, `Membership`, `ConfigVersion`, `TimetableVersion`, and `AuditLog`.
  - Implemented JWT authentication and password hashing (`bcryptjs`) with organization scoping.
  - Implemented `optionalAuth` preserving seamless backward compatibility for anonymous/legacy session IDs while supporting secure multi-tenant deployments.
  - Added full version history snapshots and one-click rollback (`/api/configs/:id/rollback/:version`).
- **Dynamic Solver Delegation & SSE Streaming:**
  - Upgraded job runner in `server/src/jobs.ts` with dynamic solver routing: dispatches to Python CP-SAT service at `${PYTHON_SOLVER_URL}/solve` for large or explicit python requests.
  - Automatic fault-tolerant fallback: if Python microservice is unavailable or errors, seamlessly falls back to `@ibp/solver-ts` without interrupting the user.
  - Added real-time Server-Sent Events (SSE) streaming endpoint (`/api/schedule/jobs/:id/events`) alongside HTTP polling.
- **Queue & Worker Architecture:**
  - Added `JobQueueManager` with BullMQ + Redis for distributed worker execution and automatic zero-dependency in-memory fallback.
- **Verification:**
  - 14 integration tests in `server/tests/server_integration.test.ts` covering auth, config versioning, rollbacks, job lifecycle, audit logging, and solver fallback. 100% test pass rate across 43 tests in monorepo.

### Phase 3: Industrial Solver Microservice (solver-py) (Completed)
- **Python CP-SAT Microservice:**
  - Built `solver-py/` powered by Google OR-Tools CP-SAT with multi-worker parallelism, symmetry breaking, and solution streaming.
  - Implemented Large Neighborhood Search (LNS) and minimal-disruption incremental repair (`repair_schedule_minimum_disruption`).
  - Added DSA algorithms: Conflict Graph + DSATUR graph coloring, Bitset Occupancy Matrix, Hungarian room matching (SciPy), and Hall's condition / flow feasibility pre-check.
  - Added machine learning models: Gradient Boosting difficulty predictor and solver strategy recommender.
  - Built independent mathematical validator (`validator.py`).
  - Implemented FastAPI microservice (`solver_py/api.py`) exposing `/solve`, `/jobs/{id}`, `/validate`, `/explain`, `/repair`, and `/predict-difficulty`.
  - Comprehensive Pytest suite with Hypothesis property-based testing: 13/13 tests passed, 87% code coverage.

- **Domain Modeling Enhancements:**
  - Added support for 5 Institution Types: `school`, `college`, `university`, `coaching`, `exam`.
  - Added `studentGroups` for lab sub-group division (e.g. A1, A2).
  - Added `shifts` support (morning/afternoon shifts).
  - Added `facultyIds` for co-teaching synchronization (2+ faculty per lecture/lab).
  - Added building travel-time matrices (`BuildingTravelMatrix`) to prevent back-to-back classes in distant blocks.
  - Implemented 30+ built-in hard and soft constraint templates in `@ibp/shared/constraints`.
- **Migration & Schema Fidelity:**
  - Implemented `migrateConfig(v1 -> v2)` ensuring 100% backward compatibility for legacy timetables.
  - Added test suite for `migrateConfig` (`packages/shared/tests/migration.test.ts`).
  - Added Natural-Language constraint parser contract and validation (`packages/shared/src/nl-constraints.ts`).
- **Store Upgrade:**
  - Upgraded client Zustand store (`useTimetableStore.ts`) to manage Schema v2 structures with transparent automatic migration upon loading.

### Phase 1: Foundation and Cleanup (Completed)
- **Monorepo Architecture:**
  - Created `@ibp/shared` workspace with complete domain models, Zod validation schemas, 30+ constraint templates, and `migrateConfig(v1 -> v2)`.
  - Created `@ibp/solver-ts` workspace unifying client and server backtracking solver with indexed O(1) soft-constraint tracking and pruned domain search.
  - Linked `client` and `server` to shared packages, eliminating code drift and 1,800+ lines of duplicate logic.
- **Legacy Migration & Cleanup:**
  - Migrated legacy root files (`app.js`, `index.html`, `styles.css`, `firestore.rules`) into `legacy/`.
  - Untracked `server/prisma/dev.db` and `dev.db-journal` from git index; updated `.gitignore`.
- **Testing & Benchmarks:**
  - Built deterministic seedable instance generator (`tools/generate-instance.ts`) supporting Tiny, School, College, University, and Evil tiers.
  - Created Golden Test Suite (`packages/solver-ts/tests/golden-suite.test.ts`) covering 25 diverse instances with known feasibility (100% hard constraint verification).
  - Built benchmark runner (`benchmarks/run-benchmarks.ts`) measuring solve time, memory, constraint satisfaction, and soft scores; saved outputs to `benchmarks/results.json` and `benchmarks/BENCHMARKS.md`.
  - Added GitHub Actions CI pipeline (`.github/workflows/ci.yml`).
