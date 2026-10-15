# C1 evidence

Captured 15 October 2026. Read the main report at
`../../stage-c1-independent-integration-baseline.md` before interpreting these files.

- `run-{1,2}.json`: complete Jest results with exact case names, errors, and timings.
- `run-{1,2}.log`: raw stdout/stderr, including setup, teardown, and early-return warnings.
- `run-{1,2}-execution.json`: invocation timestamps, exit codes, safety preconditions.
- `failing-tests.md`: exact failed-case ledger and repeat comparison.
- `guard-unit.{json,log}`: the 44 existing database-guard unit tests.
- `development-identity-rejection.txt`: test guard rejection of the actual observed dev identity.
- `development-{before,after}.json`: live identities, migration checksums and per-table row fingerprints.
- `test-before.json`, `test-after-run-{1,2}.json`: equivalent test-database snapshots.
- `repeatability-evidence.json`: twelve C1-owned orphan orders, empty child groups,
  baseline-order hash after their exclusion, role memberships, and adjustment index.
- `migration-comparison.json`: local/applied migration comparison for both databases.
- `environment-identities.json`: redacted Docker identity observations; no container env/credentials.
- `git-status-{before,after}.txt`, `git-log.txt`, `git-diff-before.patch`: repository baseline.
- `source-hashes-before.json`, `preservation-verification.json`: source/patch and backup preservation.
- `c1-*.cjs`: archived assessment scripts used for these observations, not changes to
  the Jest harness. They expect `apps/api` as working directory and use local paths.
  Do not rerun into these evidence filenames; logs intentionally use exclusive creation.

Fingerprints hash sorted `row_to_json` strings inside read-only repeatable-read
transactions. Row contents (including credential fields) were not exported. Counts
and hashes cover 158 public tables, including the migration-history table; this
does not fingerprint sequence state, catalog objects, WAL, or external provider state.

There was no reset or reseed between runs. Run 2 started with six leaked orders.
The same failures reproduced, but clean repeatability is explicitly unproven.
No leaked records were removed after the runs.
