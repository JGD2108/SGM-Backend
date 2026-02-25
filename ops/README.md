# Ops (Lightsail)

Versioned operational scripts for yearly cleanup and systemd job installation.

## What it does

- Preserves `User` rows (and, by default, preserves orphan `Cliente` rows too).
- Deletes historical operational data from years older than `--before-year`.
- Writes a compact JSON summary (`logs/yearly-cleanup/...`) before/after execution.
- Installs a `systemd` timer so the job runs once per year.

## Main files

- `ops/yearly-cleanup.js`: cleanup script (`dry-run` by default)
- `ops/run-yearly-cleanup.sh`: loads `.env` and executes the cleanup script
- `ops/install-jobs.sh`: installs/updates `systemd` units
- `ops/install-post-merge-hook.sh`: optional git hook installer (post-merge)

## Common commands (Lightsail)

```bash
chmod +x ops/*.sh
bash ops/install-jobs.sh --user ubuntu
bash ops/run-yearly-cleanup.sh --dry-run
```

Optional git hook (server checkout only):

```bash
bash ops/install-post-merge-hook.sh
```

## Notes

- `git pull` alone does not apply OS-level job changes. The hook or `ops/install-jobs.sh` handles that.
- To also delete orphan clients, set `CLEANUP_DELETE_ORPHAN_CLIENTS=true` in the server environment.
