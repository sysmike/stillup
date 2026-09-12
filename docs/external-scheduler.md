# Triggering checks from your own server

GitHub's `schedule` event is best effort. Dispatching the workflow from a machine you control
gives an exact interval instead.

The **Uptime** workflow already accepts `workflow_dispatch`, so nothing in the
repository has to change.

## 1. Create a token

Fine-grained token at
<https://github.com/settings/personal-access-tokens/new>:

- **Resource owner**: `sysmike`
- **Repository access**: *Only select repositories* → `status-page`
- **Repository permissions** → **Actions**: *Read and write*
- **Expiration**: pick a date you will actually act on; the checks stop
  silently when the token expires

A classic token works too and needs the `repo` scope, but it grants far more
than this job requires.

## 2. Store it on the server

```bash
sudo install -m 600 /dev/null /etc/status-page.env
echo 'STATUS_PAGE_TOKEN=github_pat_...' | sudo tee /etc/status-page.env > /dev/null
```

Root-owned and `0600`: the token can start workflows in your repository.

## 3. Install the dispatch script

```bash
sudo tee /usr/local/bin/status-page-dispatch > /dev/null <<'EOF'
#!/bin/sh
# Starts one run of the status-page Uptime workflow.
set -eu
. /etc/status-page.env

body=$(mktemp)
trap 'rm -f "$body"' EXIT

code=$(curl -sS -o "$body" -w '%{http_code}' \
  -X POST \
  -H 'Accept: application/vnd.github+json' \
  -H "Authorization: Bearer $STATUS_PAGE_TOKEN" \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  https://api.github.com/repos/sysmike/status-page/actions/workflows/uptime.yml/dispatches \
  -d '{"ref":"main"}')

case "$code" in
  2*) exit 0 ;;
  *) echo "dispatch failed: HTTP $code $(cat "$body")" >&2; exit 1 ;;
esac
EOF
sudo chmod 755 /usr/local/bin/status-page-dispatch
sudo /usr/local/bin/status-page-dispatch && echo "dispatched"
```

A successful call returns `204 No Content` and prints nothing.

## 4. Run it every five minutes

systemd timer:

```bash
sudo tee /etc/systemd/system/status-page.service > /dev/null <<'EOF'
[Unit]
Description=Trigger the status page uptime checks
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/status-page-dispatch
EOF

sudo tee /etc/systemd/system/status-page.timer > /dev/null <<'EOF'
[Unit]
Description=Trigger the status page uptime checks every five minutes

[Timer]
OnCalendar=*:0/5
RandomizedDelaySec=15
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now status-page.timer
systemctl list-timers status-page.timer
```

Or, with cron:

```
*/5 * * * * /usr/local/bin/status-page-dispatch || logger -t status-page "dispatch failed"
```

`Persistent=true` is deliberately absent: a missed window is worth nothing
once it has passed, and catching up would only queue stale checks.

## 5. Verify

```bash
curl -s "https://api.github.com/repos/sysmike/status-page/actions/runs?event=workflow_dispatch&per_page=5" \
  | python3 -c "import sys,json;[print(r['run_started_at'], r['status'], r['conclusion']) for r in json.load(sys.stdin)['workflow_runs']]"
```

Consecutive entries five minutes apart mean the timer is driving the checks.

## 6. Keep the GitHub cron as a fallback

Leave the `schedule:` block in `.github/workflows/uptime.yml`. On a public
repository the extra runs cost nothing, they cover the case where your server
is down, and the `uptime` concurrency group serialises a collision. Remove it
only if duplicate runs bother you.

Dispatching also counts as repository activity, which keeps GitHub from
disabling the schedule after 60 idle days.

## Troubleshooting

| HTTP | Cause |
| --- | --- |
| 401 | Token expired, revoked or mistyped |
| 403 | Token lacks *Actions: Read and write*, or SSO authorisation is missing |
| 404 | Token cannot see the repository, or `uptime.yml` is not the file name on the default branch |
| 422 | `ref` does not exist, or the workflow on that ref has no `workflow_dispatch` trigger |

The API allows 5,000 authenticated requests an hour; 288 dispatches a day uses
a fraction of that.
