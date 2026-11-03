# Architectural Decision Records (ADRs)

This document tracks all key technical decisions, architectural patterns, library selections, and design choices made during the upgrade of the IBP Timetable Generator.

---

## ADR-001: Monorepo Structure and Package Boundaries

- **Status:** Accepted
- **Context:** The original repository had two npm workspaces (`client` and `server`) with duplicated solver logic, types, and legacy code in the root directory.
- **Decision:**
  - Create `packages/shared` as an npm workspace package containing all domain types, Zod schemas, JSON schemas, validation helpers, and configuration migrations (`migrateConfig`).
  - Create `packages/solver-ts` as an npm workspace package containing the unified, high-efficiency TypeScript constraint solver (MRV backtracking + domain pruning) utilized by both Node.js server and client Web Workers.
  - Create `solver-py/` as an independent FastAPI service leveraging Google OR-Tools CP-SAT, LNS, and scikit-learn for high-complexity combinatorial instances.
  - Move legacy root web files (`app.js`, `index.html`, `styles.css`, `firestore.rules`) to `legacy/`.
- **Consequences:** Eliminates code drift between client and server, allows independent scaling of compute-intensive Python solver workers, and keeps repository structure clean and standards-compliant.

---

## ADR-002: Dual-Solver Architecture (TypeScript + Python CP-SAT)

- **Status:** Accepted
- **Context:** Users require both zero-setup client-side solving in the browser (for offline, privacy-conscious, or small school scenarios) and heavy-duty industrial optimization for complex universities with hundreds of rooms and constraints.
- **Decision:**
  - Provide automatic engine tier selection: small problems (<= 10 batches, standard constraints) can run directly via in-browser Web Worker or Node fallback.
  - Large/complex problems (electives, lab groups, travel matrices, > 10 batches) automatically route to the Python CP-SAT microservice.
  - The UI provides an explicit toggle allowing users to select: `Auto`, `Fast (Browser / TS)`, or `Optimal (Python CP-SAT)`.
- **Consequences:** Preserves instant feedback and serverless zero-cost execution for small workloads, while offering industrial constraint-satisfaction performance with proven mathematical bounds for large enterprise scenarios.

---

## ADR-003: Schema Evolution & Backward Compatibility (v1 to v2)

- **Status:** Accepted
- **Context:** Existing users have saved JSON configurations and database records using Schema v1. The new platform introduces rich constraints (lab groups, travel matrices, shifts, co-teaching).
- **Decision:**
  - All new fields in Schema v2 are optional or defaultable.
  - Implement a deterministic `migrateConfig(data: unknown): SchedulerInputStateV2` function in `packages/shared`.
  - When loading any configuration (via file upload, API, or local storage), check for schema version and auto-migrate transparently.
- **Consequences:** Zero breakage for legacy timetables or previously exported files while unlocking advanced modeling.

---

## ADR-004: Python Environment & Package Management via UV

- **Status:** Accepted
- **Context:** The solver service requires modern Python (3.11+) with high-performance C-extensions (`ortools`, `numpy`, `scikit-learn`). On developer machines and Windows sandboxes, administrator privileges might not be available for system-wide installers.
- **Decision:**
  - Use `uv` (Astral) for hermetic Python runtime downloading and dependency management.
  - Define `solver-py/pyproject.toml` with pinned dependencies.
- **Consequences:** 10x-100x faster environment creation, repeatable lockfiles across platforms (Windows/Linux/macOS), zero reliance on Windows registry or admin privileges.


## ADR-005: Backend Hardening, Dynamic Solver Routing & Versioned Persistence

- **Context:** The system needs to support multi-tenant organizations, audit trails, version control with rollbacks for both configurations and timetable runs, background job queueing, and seamless delegation between Python CP-SAT and the TypeScript fallback engine without breaking legacy anonymous sessions or dev setups.
- **Decision:**
  - Standardize on Prisma with SQLite for zero-dependency local dev and PostgreSQL for production deployments via `DATABASE_URL`.
  - Introduce `User`, `Organization`, `Membership`, `ConfigVersion`, `TimetableVersion`, and `AuditLog` models.
  - Implement optional JWT authentication: requests with Bearer tokens are multi-tenant and organization-scoped; unauthenticated requests fall back seamlessly to session-based scoping (`sessionId`).
  - Implement dynamic solver routing in `server/src/jobs.ts`: problems with `engine: 'python'` or `batches.length > 10` are delegated via HTTP to `PYTHON_SOLVER_URL`. If the microservice is unavailable or errors, the server gracefully falls back to `@ibp/solver-ts`.
  - Provide both Server-Sent Events (`/api/schedule/jobs/:id/events`) and polling (`/api/schedule/jobs/:id`).
  - Support BullMQ + Redis for distributed queues with automatic in-memory execution fallback.
- **Consequences:** Production-ready multi-user SaaS capabilities with zero friction for offline or single-developer local workflows.

---

## ADR-006: Inverted Variable Indexing for CP-SAT Model Construction

- **Status:** Accepted
- **Context:** Large-scale institutional instances (40 batches, 240+ subjects, 520 sessions) across 40 timeslots and 47 rooms generate millions of Cartesian combinations. Naive loops over batches and faculty iterating over all sessions during model construction caused high setup latency (40+ seconds) before solver execution began.
- **Decision:**
  - Build inverted indexes mapping `(slot, batch)`, `(slot, faculty_id)`, and `(slot, room_id)` directly from `x_vars[(i, t, r)]` in a single $O(|x\_vars|)$ pass.
  - Apply `AddAtMostOne` directly over the pre-bucketed variable lists.
- **Consequences:** Model construction latency drops from 40s to ~15ms, eliminating Python runtime bottlenecks and enabling rapid iterative solving and LNS re-optimization.

---

## ADR-007: Containerization & Deployment Strategy

- **Status:** Accepted
- **Context:** The platform consists of multiple specialized runtimes: React 18 client (SPA), Node.js Express API gateway, Python 3.11 CP-SAT solver, PostgreSQL database, and Redis queue.
- **Decision:**
  - Client deployed to Vercel (or containerized with Nginx Alpine for on-premise enterprise deployments).
  - Multi-stage Dockerfiles for client, server, and solver-py.
  - Orchestrate all 5 services using `docker-compose.yml` with automated healthchecks, volume persistence, and environment variable configuration.
- **Consequences:** Developers and institutional sysadmins can launch the complete enterprise platform with a single `docker compose up --build` command.

