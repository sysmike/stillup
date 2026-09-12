# Status page

Uptime monitoring inspired by [Upptime](https://github.com/upptime/upptime) that runs entirely on GitHub: checks run as a scheduled
Action, history is committed to this repository, outages open and close GitHub
issues, and the status page is published with GitHub Pages.

![Status page](.screenshots/dark.png)

| Light | Response time | Mobile |
| --- | --- | --- |
| [![Light theme](.screenshots/light.png)](.screenshots/light.png) | [![Response time chart](.screenshots/response-time.png)](.screenshots/response-time.png) | [![Mobile](.screenshots/mobile.png)](.screenshots/mobile.png) |

## Setup

1. Fork or copy this repository.
2. **Settings → Pages → Source**: select *GitHub Actions*.
3. **Settings → Actions → General → Workflow permissions**: select *Read and
   write permissions*.
4. Add one repository variable per monitor under **Settings → Secrets and
   variables → Actions → Variables** (see below), or a secret in the same place
   for a monitor whose URL should stay private.
5. Run the **Uptime** workflow once from the Actions tab.

## Custom domain

Point DNS at GitHub, then set the domain under **Settings → Pages → Custom
domain** and enable *Enforce HTTPS* once the certificate is issued.

```
# subdomain
status  CNAME  <user>.github.io.

# apex domain
@  A     185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
@  AAAA  2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153
```

Because Pages is published from a workflow rather than a branch, no `CNAME`
file is needed: the domain is stored in the repository's Pages configuration,
and an existing `CNAME` file is ignored. Deployments cannot drop it.

Verify the domain under account or organization **Settings → Pages** to keep
someone else from claiming it if this repository is renamed or deleted. If DNS
is proxied through Cloudflare, keep the record DNS-only until GitHub has issued
the certificate.

## Groups

A monitor with a `group` is listed under that heading. A collapsed group is
shown compactly, one line per monitor with its status and uptime, instead of a
card with the 90 day history. Clicking the heading toggles it, and that choice
is remembered in the visitor's browser.

`SITE_GROUP_COMPACT` decides the default:

| Value | Behaviour |
| --- | --- |
| `auto` (default) | A group starts compact when it holds more than four monitors and all of them are up |
| a number | Same, with that number instead of four |
| `always` | Every group starts compact |
| `never` | Every group starts expanded |

A group that contains something down or degraded is never collapsed by the
`auto` rule: an outage stays visible without a click.

A single group can override the default with a `GROUP_<NAME>` variable, where
the name matches the group the monitors refer to:

```
GROUP_INTERNAL   compact
GROUP_PUBLIC     expanded
```

`compact`, `always`, `true` and `yes` mean the same thing, as do `expanded`,
`never`, `false` and `no`. `auto` falls back to the site rule.

## Site variables

| Variable | Default | Description |
| --- | --- | --- |
| `SITE_TITLE` | `Status` | Page and browser title |
| `SITE_DESCRIPTION` | none | Line under the status banner |
| `SITE_LINK` | none | Link in the footer |
| `SITE_LOGO` | none | Logo URL shown next to the title |
| `SITE_THEME` | `auto` | `auto`, `light` or `dark` |
| `SITE_GROUP_COMPACT` | `auto` | `auto`, `always`, `never`, or a number to change the `auto` threshold |
| `INCIDENT_THRESHOLD` | `2` | Consecutive failed checks before an issue is opened |
| `INCIDENT_LABELS` | `status,incident` | Labels applied to incident issues |

## Monitors

Every monitor is a repository variable named `MONITOR_<NAME>`. The name after
the prefix becomes the slug and the default display name. The value is either a
plain URL or a JSON object.

```
MONITOR_WEBSITE   https://example.com
MONITOR_API       {"name":"Public API","url":"https://api.example.com/health","keyword":"ok","group":"Core"}
MONITOR_SMTP      {"name":"Mail","url":"tcp://mail.example.com:25","keyword":"220"}
MONITOR_GATEWAY   {"name":"Gateway","url":"ping://gw.example.com"}
```

An `http` or `https` URL is requested over HTTP. A `tcp://host:port` URL is
checked by opening a connection: the monitor is up when the handshake
completes, and the measured time is the handshake itself. With `keyword` set,
the check also waits for the first chunk the server sends and matches it
against that string, which covers banner protocols such as SMTP, SSH or IMAP.
`method`, `headers`, `body`, `expectedStatus` and `followRedirects` do not
apply to a TCP monitor, and its address is not used as the card link — set
`link` if the card should point somewhere.

A `ping://host` URL sends one ICMP echo through the system `ping` binary and
measures the round trip. It needs `ping` on the runner, ignores `keyword`
along with the HTTP options, and is also not used as a card link.

**ICMP does not work on GitHub-hosted runners.** They are Azure virtual
machines, and Azure blocks ICMP, so a ping monitor reports `socket: Operation
not permitted` or `no reply` no matter how healthy the host is. Use ping only
with a self-hosted runner; on hosted runners check a port with `tcp://`
instead. To see where you stand, add `MONITOR_PINGTEST` as `ping://1.1.1.1`,
run the Uptime workflow once and read the "Run checks" step: `up` means ICMP
works for you, anything else means it does not.

| Key | Default | Description |
| --- | --- | --- |
| `url` | required | `https://…` to request, `tcp://host:port` to connect to, or `ping://host` to ping |
| `name` | derived from the variable name | Display name |
| `method` | `GET` | HTTP method |
| `headers` | `{}` | Request headers |
| `body` | none | Request body |
| `expectedStatus` | `2xx` | Status code, `2xx` style pattern, `200-299` range, or an array of those |
| `keyword` | none | Response body, or the first chunk of a TCP banner, must contain this string |
| `timeout` | `10000` | Milliseconds before the request is aborted |
| `retries` | `1` | Extra attempts before a check counts as failed |
| `degradedMs` | `0` | Responses slower than this are reported as degraded (`0` disables) |
| `followRedirects` | `true` | Follow 3xx responses |
| `group` | none | Groups monitors under a heading |
| `description` | none | Subtitle on the card |
| `link` | `url` | Link target of the monitor name |
| `private` | `false`, `true` for secrets | Keeps the URL out of the published site and out of incident issues |
| `order` | `100` | Sort order within a group |
| `slug` | derived from the variable name | Overrides the slug used for history files |

### Private monitors

A monitor can be defined as a repository **secret** instead of a variable, with
the same name and the same value format. Secrets are masked in workflow logs,
and a monitor defined that way is private: its URL is left out of
`api/summary.json`, left out of the incident issue, and stripped from error
messages such as `getaddrinfo ENOTFOUND …`.

What is still published for a private monitor: the slug derived from the secret
name, the display name, the group and description, and the status, uptime and
response times. Set `link` if the card should point somewhere anyway. Adding
`"private": true` to a monitor defined as a variable has the same effect.

## How it works

`.github/workflows/uptime.yml` runs every five minutes:

1. `scripts/check.mjs` requests every monitor and appends the result to
   `history/`.
2. `scripts/incidents.mjs` opens an issue when a monitor has failed
   `INCIDENT_THRESHOLD` times in a row, comments the downtime and closes the
   issue on recovery, and writes a snapshot of recent incidents.
3. The history is committed back to the branch.
4. If anything the page shows changed, the Pages workflow deploys
   immediately; otherwise the site rebuilds on its own 30 minute schedule.
   That covers a monitor changing state and an incident issue being opened,
   edited, relabelled or closed, so planned maintenance appears without
   waiting. The workflow also runs on `issues` events for that reason.

`.github/workflows/pages.yml` runs `scripts/build.mjs`, which turns the history
into `_site/api/*.json` next to the static page in `site/`.

History is stored per monitor as CSV:

```
history/raw/<slug>.csv     every check of the last 7 days (response time chart)
history/daily/<slug>.csv   one aggregated row per day, kept indefinitely
history/state.json         current status and open issue per monitor
history/incidents.json     snapshot of recent incident issues
history/live.json          current status and incidents, read by the page itself
```

The build is a snapshot, so the deployed page also fetches `history/live.json`
from `raw.githubusercontent.com` on load, every minute, and whenever the tab
returns to the foreground. Status, response times and incidents therefore
refresh without a deployment, and a tab left open during an outage keeps up.
The 90 day bars come from the build and only change when the site is rebuilt.
GitHub caches raw files for five minutes, which is the practical limit on how
fresh this is. If the fetch fails the page keeps its build time data.

Issues labelled with the incident label show up on the page, so you can also
open one by hand for planned work: the **Planned maintenance** issue template
applies the `status` and `maintenance` labels and the entry is rendered as
maintenance rather than as an outage. If `INCIDENT_LABELS` is customised, the
first label in it has to be the one in
`.github/ISSUE_TEMPLATE/maintenance.yml`.

## Local preview

```bash
export CONFIG_VARS='{"SITE_TITLE":"Status","MONITOR_WEBSITE":"https://example.com"}'
node scripts/check.mjs
node scripts/build.mjs
npx serve _site
```

`CONFIG_VARS` and the optional `CONFIG_SECRETS` are the JSON objects that the
workflows pass in from the Actions `vars` and `secrets` contexts.
`scripts/incidents.mjs` additionally needs `GITHUB_TOKEN` and
`GITHUB_REPOSITORY`.

## Notes

- Scheduled workflows are queued, not guaranteed: runs drift, whole slots get
  dropped under load, and GitHub disables schedules in repositories with no
  activity for 60 days. For an exact interval, trigger the workflow from a
  machine you control: [docs/external-scheduler.md](docs/external-scheduler.md).
- Actions minutes are free on public repositories. On a private repository
  every job is rounded up to a whole minute, so the cost follows the number of
  runs, not their duration: the default schedule is roughly 336 job-minutes a
  day. Lengthen the two cron expressions to cut that, or keep the repository
  public and define sensitive monitors as secrets.
- The workflows use the Node.js that ships with the runner image, currently
  22.x, so there is no toolchain setup step.
- Uptime percentages count degraded checks as up; the day tooltip shows the
  share of successful checks.
- Checks run from GitHub's runners, so they only see outages that are visible
  from the public internet.

## License

- MIT — see [LICENSE](LICENSE).
- Data in the `./history` directory: [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/)
