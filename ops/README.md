# Ops (Lightsail)

Versioned operational scripts for yearly cleanup and systemd job installation.

## What it does

- Preserves `User` rows (and, by default, preserves orphan `Cliente` rows too).
- Deletes historical operational data from years older than `--before-year`.
- Writes a compact JSON summary (`logs/yearly-cleanup/...`) before/after execution.
- Installs a `systemd` timer so the job runs once per year.
- Runs the cleanup through Docker (`sgm_api`) in Lightsail by default (via `systemd` service env).
- Copies the JSON summary from the container to the host (`logs/yearly-cleanup/`).

## Main files

- `ops/yearly-cleanup.js`: cleanup script (`dry-run` by default when called directly)
- `ops/run-yearly-cleanup.sh`: loads `.env` and executes the cleanup script
- `ops/install-jobs.sh`: installs/updates `systemd` units
- `ops/install-post-merge-hook.sh`: optional git hook installer (post-merge)

## Common commands (Lightsail)

```bash
chmod +x ops/*.sh
bash ops/install-jobs.sh --user ubuntu
bash ops/run-yearly-cleanup.sh --dry-run
```

`systemd` service/wrapper default is configured as `execute`. To force a safe preview manually:

```bash
bash ops/run-yearly-cleanup.sh --dry-run
```

If you need to temporarily force `dry-run` without editing versioned files, add a systemd override:

```bash
sudo systemctl edit sgm-yearly-cleanup.service
```

Then add:

```ini
[Service]
Environment=CLEANUP_DEFAULT_MODE=dry-run
```

Optional git hook (server checkout only):

```bash
bash ops/install-post-merge-hook.sh
```

## Notes

- `git pull` alone does not apply OS-level job changes. The hook or `ops/install-jobs.sh` handles that.
- The installed `systemd` unit forces `CLEANUP_EXECUTION_MODE=docker`, so it will fail safely if `sgm_api` is down.
- The installed `systemd` unit writes host summaries to `logs/yearly-cleanup/` in the repo path.
- To also delete orphan clients, set `CLEANUP_DELETE_ORPHAN_CLIENTS=true` in the server environment.
