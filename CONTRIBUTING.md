# Contributing to IBP Timetable Platform

Thank you for your interest in contributing to **IBP Timetable Generator**! We welcome bug fixes, documentation improvements, optimization algorithms, and new constraint features.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js**: v20 or higher (`npm` workspaces enabled)
- **Python**: 3.11+ (with virtual environment support)
- **Docker**: (Optional, for running full microservice stack with PostgreSQL & Redis)

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-org/ibptimebook.git
   cd ibptimebook
   ```

2. **Install JavaScript/TypeScript dependencies:**
   ```bash
   npm install
   ```

3. **Build workspace packages:**
   ```bash
   npm run build:packages
   ```

4. **Set up Python solver microservice:**
   ```bash
   cd solver-py
   python -m venv .venv
   # On Windows:
   .venv\Scripts\activate
   # On Linux/macOS:
   source .venv/bin/activate
   pip install -e ".[test]"
   cd ..
   ```

5. **Start Development Servers:**
   - **Client (Vite):** `npm run dev:client` (runs on `http://localhost:5173`)
   - **Server (Express):** `npm run dev:server` (runs on `http://localhost:5000`)
   - **Python Solver (FastAPI):** `cd solver-py && uvicorn solver_py.main:app --reload --port 8000`

---

## 🧪 Testing Guidelines

We enforce strict test suites before merging any changes:

- **TypeScript Tests (`@ibp/shared`, `@ibp/solver-ts`, `server`):**
  ```bash
  npm test
  ```
- **Python CP-SAT Tests & Coverage:**
  ```bash
  cd solver-py
  pytest --cov=solver_py --cov-report=term-missing
  ```
- **Golden Test Suite & Benchmarks:**
  ```bash
  npm run benchmark
  ```

---

## 📐 Architecture & Principles

1. **Backward Compatibility:** All data model changes in `@ibp/shared` must provide safe auto-migrations via `migrateConfig(v1 -> v2)`. Never break existing user configurations.
2. **Zero Infeasible Schedules:** Any timetable returned to the user must be verified by both the solver and an independent mathematical validator.
3. **Decoupled Engines:** Fast in-browser scheduling runs via `@ibp/solver-ts` inside a Web Worker. Large-scale institutional scheduling is dispatched to the Python OR-Tools microservice.

---

## 📝 Pull Request Checklist

- [ ] All tests pass cleanly (`npm test` and `pytest`).
- [ ] TypeScript compilation succeeds with zero errors (`npm run build`).
- [ ] No secrets or `.env` files committed.
- [ ] Relevant documentation updated in `docs/` and `docs/CHANGELOG.md`.

