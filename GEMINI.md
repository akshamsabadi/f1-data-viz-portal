# F1 Data Viz Portal: Repository Guidelines

## Project-Specific Conventions

### 1. Versioning Strategy
- All future implementations and patches should be versioned within the **`v1.16.X`** series (e.g., `v1.16.1`, `v1.16.2`, etc.), incrementing the patch number for every incremental update or feature addition.
- Version identifiers must be updated inside `src/index.html` and the `APP_VERSION` constant in `src/js/app.js`.

### 2. Design Conventions
- Any customized form or dropdown selector should use native `<select>` nodes styled with custom backgrounds (`appearance: none`) and appropriate down-arrows to maintain standard accessible behaviors across mobile and desktop devices.
