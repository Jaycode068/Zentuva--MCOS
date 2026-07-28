# API Documentation

Documents every public endpoint exposed by `apps/api`, grouped by domain module.

## Current endpoints

### Health

| Method | Path          | Description                                                        |
| ------ | ------------- | ------------------------------------------------------------------ |
| GET    | `/api/health` | Liveness/readiness check. Verifies database connectivity and heap. |

No other endpoints exist yet — this foundation deliberately excludes business modules. As
endpoints are added, document them here (or split into `docs/api/<domain>.md` once this file
grows), including: method, path, request/response shape, auth requirements, and validation rules.
