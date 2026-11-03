# IBP Timetable Optimization Benchmarks

**Date:** 2026-11-03
**Engine:** @ibp/solver-ts (MRV Backtracking + O(1) Pruning)

| Instance Tier | Batches | Faculty | Rooms | Sessions | First Feasible (ms) | Best Solution (ms) | Hard Satisfied (%) | Soft Score | Memory (MB) |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **TINY (2 Batches)** | 2 | 4 | 2 | 14 | 7 ms | 7 ms | 100% | -20 | 0.5 MB |
| **SCHOOL (6 Batches)** | 6 | 12 | 8 | 66 | 46 ms | 46 ms | 100% | -60 | 5.86 MB |
| **COLLEGE (12 Batches)** | 12 | 24 | 15 | 158 | 393 ms | 427 ms | 100% | -140 | 65.58 MB |
| **COLLEGE (20 Batches)** | 20 | 40 | 24 | 262 | 1054 ms | 2157 ms | 100% | -100 | 109.24 MB |
