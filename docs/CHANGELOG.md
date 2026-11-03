# Changelog

All notable changes to the IBP Timetable Generator platform will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] - 2026-11-03

### Phase 2: Richer Academic Data Model & Migration Engine (Completed)
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
