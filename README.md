# Status page

Uptime monitoring inspired by [Upptime](https://github.com/upptime/upptime) that runs entirely on GitHub: checks run as a scheduled
Action, history is committed to this repository, outages open and close GitHub
issues, and the status page is published with GitHub Pages.

<img src=".screenshots/dark.png" alt="Status page in the dark theme">

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

## Site variables

| Variable | Default | Description |
| --- | --- | --- |
| `SITE_TITLE` | `Status` | Page and browser title |
| `SITE_DESCRIPTION` | none | Line under the status banner |
| `SITE_LINK` | none | Link in the footer |
| `SITE_LOGO` | none | Logo URL shown next to the title |
| `SITE_THEME` | `auto` | `auto`, `light` or `dark` |
| `SITE_LANG` | `en` | Language of the page, its issues and its notifications: `en` or `de`, see [Languages](#languages) |
| `INCIDENT_THRESHOLD` | `2` | Consecutive failed checks before an issue is opened |
| `INCIDENT_LABELS` | `status,incident` | Labels applied to incident issues. `maintenance` is reserved and ignored here |
| `SITE_URL` | the Pages address | Where the page is served from; only the feed needs it, and only to link to itself |
| `CERT_WARN_DAYS` | `14` | Days before a TLS certificate expires that are worth hearing about; `0` turns the checks off |
| `STALE_AFTER` | `30` | Minutes without a check before the page says so instead of vouching for what it shows; `0` turns it off |
| `SITE_SCRIPTS` | none | Tags added to the page's head, for analytics — see [Custom scripts](#custom-scripts) |
| `WINDOW_HEADING` | `Window` | The maintenance form's window field label, which is how the start of planned work is found |
| `MONITORS_HEADING` | `Affected monitors` | The maintenance form's monitors field label, which is how affected monitors are found |

## Monitors

Every monitor is a repository variable named `MONITOR_<NAME>`. The name after
the prefix becomes the slug and the default display name. The value is either a
plain URL or a JSON object.

```
MONITOR_WEBSITE   https://example.com
MONITOR_API       {"name":"Public API","url":"https://api.example.com/health","keyword":"ok","group":"Core"}
MONITOR_SMTP      {"name":"Mail","url":"tcp://mail.example.com:25","keyword":"220"}
MONITOR_GATEWAY   {"name":"Gateway","url":"ping://gw.example.com"}
MONITOR_OFFICE    {"name":"Office WiFi","url":"dummy://up"}
```

An `http` or `https` URL is requested over HTTP. A `tcp://host:port` URL is
checked by opening a connection: the monitor is up when the handshake
completes, and the measured time is the handshake itself. With `keyword` set,
the check also waits for the first chunk the server sends and matches it
against that string, which covers banner protocols such as SMTP, SSH or IMAP.
`method`, `headers`, `body`, `expectedStatus` and `followRedirects` do not
apply to a TCP monitor, and its address is not offered as a link — set `link`
if the monitor should point somewhere a browser can follow.

A `ping://host` URL sends one ICMP echo through the system `ping` binary and
measures the round trip. It needs `ping` on the runner, ignores `keyword`
along with the HTTP options, and is also not offered as a link.

A `dummy://` URL is not checked at all and is always reported up, for a
service whose state is followed somewhere else, or to hold a place on the page.
Everything else about the monitor works as usual, but nothing is measured, so
it has no response times.

**ICMP does not work on GitHub-hosted runners.** They are Azure virtual
machines, and Azure blocks ICMP, so a ping monitor reports `socket: Operation
not permitted` or `no reply` no matter how healthy the host is. Use ping only
with a self-hosted runner; on hosted runners check a port with `tcp://`
instead. To see where you stand, add `MONITOR_PINGTEST` as `ping://1.1.1.1`,
run the Uptime workflow once and read the "Run checks" step: `up` means ICMP
works for you, anything else means it does not.

| Key | Default | Description |
| --- | --- | --- |
| `url` | required | `https://…` to request, `tcp://host:port` to connect to, `ping://host` to ping, or `dummy://` for a monitor that is always up |
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
| `cert` | `true` for `https://` | Watch the TLS certificate's expiry; set it on a `tcp` monitor whose port speaks TLS from the start |
| `group` | none | Groups monitors under a heading |
| `description` | none | Shown in the monitor's details |
| `link` | `url` | Address linked in the monitor's details |
| `private` | `false`, `true` for secrets | Keeps the URL out of the published site and out of incident issues |
| `order` | `100` | Sort order within a group |
| `slug` | derived from the variable name | Overrides the slug used for history files and the monitor's address |

### Private monitors

A monitor can be defined as a repository **secret** instead of a variable, with
the same name and the same value format. Secrets are masked in workflow logs,
and a monitor defined that way is private: its URL is left out of
`api/summary.json`, left out of the incident issue, and stripped from error
messages such as `getaddrinfo ENOTFOUND …`.

What is still published for a private monitor: the slug derived from the secret
name, the display name, the group and description, and the status, uptime and
response times. Set `link` if the monitor should point somewhere anyway. Adding
`"private": true` to a monitor defined as a variable has the same effect.

## Groups

A monitor with a `group` is listed under that heading, with a line at its right
saying how many monitors the group holds and whether any are down or degraded.
Monitors without a group are listed on their own.

A `GROUP_<NAME>` variable sets where one group sits, the name matching the
group its monitors refer to:

```
GROUP_INTERNAL   1
GROUP_PUBLIC     {"order": 2}
```

Groups are ordered the way monitors are: by `order` ascending, defaulting to
`100`. Groups left without one keep the position their monitors give them,
which is what happens when no group is configured at all.

## Custom scripts

`SITE_SCRIPTS` adds tags to the end of the page's head. The common case is an
analytics snippet, and the common case is a bare URL:

```
SITE_SCRIPTS = https://cloud.umami.is/script.js
```

Most vendors want an attribute alongside it, which is what the object form is
for. Every key other than `code` becomes an attribute, so a snippet translates
across a field at a time:

```json
{ "src": "https://cloud.umami.is/script.js", "defer": true, "data-website-id": "abc-123" }
```

`true` writes the attribute on its own — `defer`, `async` — and `false` leaves it
out. A JSON array adds more than one tag, and `code` carries a script inline
instead of loading one:

```json
[
  { "src": "https://plausible.io/js/script.js", "defer": true, "data-domain": "status.example.com" },
  { "code": "document.addEventListener('click', () => {});" }
]
```

A `src` may also be a path, for a script you commit under `site/` and serve from
the page's own origin.

## Languages

Every string this repository writes lives in `site/lang/`, one file per
language, and `SITE_LANG` chooses between them. English and German ship with it.
The page reads those files in the browser and the workflows read them on the
runner, so a site set to a language sounds like itself everywhere: on the page,
in the issues it opens, and in the notifications it sends.

The build writes the title, the description and the shell's own text into
`index.html` as well, so a chat client unfurling the link or a search result
crawling the page gets what the site was configured as rather than the defaults
in the file.

Times are shown in the reader's own time zone whatever the language is, and the
wording of dates and durations follows the language rather than the reader's
browser, so a label and the time beside it never disagree.

Adding one is three steps: copy `site/lang/en.mjs` to the language's tag,
translate the values, and add the tag to `LANGUAGES` in `site/lang/i18n.mjs`.
The list has to be written down because a browser cannot read a directory, and
`SITE_LANG` is refused while the site is built if it names a language that is
not on it.

```js
// site/lang/fr.mjs
export default {
  'status.up': 'Opérationnel',
  'incidents.title': 'Incidents',
  // …
};
```

The page sets `lang` and `dir` from the language, and the stylesheet uses
logical properties throughout, so a right-to-left language mirrors the layout
rather than needing its own rules. No such language ships yet, so expect to find
some polishing to do if you add the first one.

A value that counts something is an object of plural forms rather than a
string, and the forms a language needs are its own — English has `one` and
`other`, Polish also needs `few` and `many`:

```js
'strip.checks': { one: '{count} check', other: '{count} checks' },
```

A key with nothing translating it falls back to English, so a language cannot
break the page by being incomplete. That is a safety net rather than a way of
working: `node --test` requires every language to have the keys English has, so
a translation is finished before it ships. The suite also checks that no
translation introduces a placeholder the page never fills in, that none drops
one the page depends on, and that every key the page asks for exists.

One thing a language file cannot reach is the maintenance issue template, since
GitHub renders it from the repository rather than from the site. A German
version is ready to copy over:

```bash
cp docs/maintenance.de.yml .github/ISSUE_TEMPLATE/maintenance.yml
```

Then set `MONITORS_HEADING` to `Betroffene Monitore` and `WINDOW_HEADING` to
`Zeitfenster`. Translating the template yourself works the same way: whatever
you call those two fields is what the variables have to say — see
[How it works](#how-it-works).

## Notifications

One variable per destination, named `NOTIFY_<NAME>`. Use a **secret** rather
than a variable: a webhook URL is a credential, and an SMTP URL carries a
password. The value is the URL, or JSON when more is needed.

```
NOTIFY_OPS      {"url":"https://hooks.slack.com/services/T000/B000/xxxx","type":"slack"}
NOTIFY_ALERTS   {"url":"https://discord.com/api/webhooks/000/xxxx","type":"discord"}
NOTIFY_TEAMS    {"url":"https://prod-12.westeurope.logic.azure.com/workflows/xxxx","type":"teams"}
NOTIFY_CHAT     {"url":"https://chat.example.com/hooks/xxxx","type":"mattermost"}
NOTIFY_PAGER    {"url":"https://example.com/hook","events":["down"]}
NOTIFY_MAIL     {"url":"smtps://status@example.com:password@mail.example.com:465",
                 "to":"ops@example.com, oncall@example.com"}
```

| `type` | Payload |
| --- | --- |
| `slack` | Message with a coloured attachment |
| `mattermost` | The same, which Mattermost accepts |
| `discord` | Embed linking to the issue |
| `teams` | Adaptive card, for a Workflows webhook |
| `teams-connector` | Message card, for a retired Office 365 connector |
| `email` | Plain text mail |
| `custom` | The event as JSON, below |

`type` may be left out in two cases: an `smtp://` or `smtps://` URL is mail, and
anything else without a type is a `custom` webhook. A type that is not in the
table fails the run rather than quietly going out as JSON.

A notification goes out when an incident opens and when it closes, so the same
`INCIDENT_THRESHOLD` that decides an issue is worth opening decides this too; a
single failed check notifies nobody. Restrict a destination to some of that with
`"events"`, any of `down`, `degraded`, `up` and `cert`. A failing destination is
logged and skipped — it never fails the run or blocks the others.

## Certificates

An expiring TLS certificate is the one outage that announces itself in advance,
and the handshake that would find it is one the check is making anyway. Every
`https://` monitor is watched by default, and a `tcp` monitor can be too if it
says `"cert": true` — implicit TLS only, so an SMTP submission port that starts
in the clear and upgrades with STARTTLS is not covered.

The certificate is read rather than trusted, so a self-signed or otherwise
unacceptable chain still reports an expiry instead of a permanent failure. A
probe that does not answer is left for the next run: the monitor itself already
says whether the host is up.

It is looked at twice a day rather than every five minutes, since nothing about
an expiry moves in between, and the result is kept in `history/certs.json`. The
warning steps down as the date approaches — `CERT_WARN_DAYS` out, then seven
days, then three, then one — so it is neither said once and forgotten nor
repeated every run. Renewing the certificate starts that over. The monitor's
details show the date whatever it is, in the page's usual colour until it comes
within `CERT_WARN_DAYS`.

### Custom webhooks

A custom endpoint receives the event itself:

```json
{
  "event": "down",
  "status": "down",
  "previousStatus": "up",
  "monitor": { "slug": "db", "name": "Database", "url": "https://db.example.com" },
  "error": "connect ECONNREFUSED",
  "code": null,
  "downFor": null,
  "issue": { "number": 42, "url": "https://github.com/acme/status/issues/42" },
  "site": "Acme Status",
  "at": "2026-03-01T12:00:00Z",
  "text": "🔴 Database is down"
}
```

`downFor` is filled in on recovery, `error` and `code` on an outage. A private
monitor sends no URL, the same as everywhere else. Add `"headers"` for an
endpoint that wants a token, and `"method"` if it does not want `POST`.

### Email

`smtps://` opens TLS immediately, usually on port 465. `smtp://` connects in
the clear and upgrades with STARTTLS when the server offers it, usually on 587.
Credentials go in the URL, percent-encoded — `@` in a username becomes `%40`.

| Option | Default | Description |
| --- | --- | --- |
| `to` | required | Recipients, a list or a comma-separated string |
| `from` | the login, if it is an address | Envelope and header sender |
| `insecureTls` | `false` | Accept a certificate no public CA signed |

AUTH PLAIN and AUTH LOGIN are supported, and no authentication at all when the
URL carries no credentials.

**Port 25 does not work on GitHub's runners.**
Submission ports are not blocked: use 587 (`smtp://`, STARTTLS) or 465 (`smtps://`), which
is what a mail server offers for authenticated sending anyway.

## How it works

`.github/workflows/uptime.yml` runs every five minutes:

1. `scripts/check.mjs` requests the monitors, up to eight at a time, and
   appends the results to `history/` in the order the monitors are listed.
2. `scripts/incidents.mjs` opens an issue when a monitor has failed
   `INCIDENT_THRESHOLD` times in a row, comments the downtime and closes the
   issue on recovery, notifies whatever `NOTIFY_*` configures, and writes a
   snapshot of recent incidents.
3. The history is committed back to the branch.
4. If anything the page shows changed, the Pages workflow deploys
   immediately; otherwise the site rebuilds once a day.
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
history/incidents.json     snapshot of recent incident issues and their comments
history/live.json          current status, uptime and incidents, read by the page itself
history/certs.json         TLS expiry per monitor, and which warnings have gone out
```

The build is a snapshot, so the deployed page also fetches `history/live.json`
from `raw.githubusercontent.com` on load, every minute, and whenever the tab
returns to the foreground. Status, uptime figures, incidents and the newest few
bars therefore refresh without a deployment, and a tab left open during an
outage keeps up. Only the rest of the 90 day history and the response time
chart wait for the next build, which is why a daily one is enough. GitHub
caches raw files for five minutes, which is the practical limit on how fresh
this is. If the fetch fails the page keeps its build time data.

An incident's own view shows the issue body and the newest comments on it, so
an update posted on the issue reaches the status page: a timeline entry says
how many comments there are, and the entry opens the conversation. The newest
five are kept, each cut to 800 characters, with a line pointing at GitHub when
there are more. A run only asks GitHub for a thread whose comment count
changed, so a quiet run costs no extra requests.

The page lists an open incident first, whatever its date, so a live outage is
never below something that has since been resolved; resolved entries follow, the
last ten within 30 days, with a link to the rest on GitHub. A quiet month says
so rather than hiding the section.

Planned work whose window has not opened yet is listed under **Upcoming**
instead, soonest first, dated by when it will start rather than by when somebody
wrote it down. Nothing changes state when the window opens: the page works out
which group an entry belongs to every time it draws, so the entry moves on its
own. The start is read from the form's **Window** field, which wants the date
first — `2026-03-14`, optionally with a 24 hour time, in UTC. Anything it cannot
read counts as no window at all, and the entry is listed as happening now, which
is what it would have been before any of this was read.

Issues labelled with the incident label show up on the page, so you can also
open one by hand for planned work: the **Planned maintenance** issue template
applies the `status` and `maintenance` labels and the entry is rendered as
maintenance rather than as an outage. If `INCIDENT_LABELS` is customised, the
first label in it has to be the one in
`.github/ISSUE_TEMPLATE/maintenance.yml`.

Two of the template's fields are read rather than only displayed. **Affected
monitors** links an issue to the monitors it concerns, and **Window** says when
the work starts. GitHub renders each field's label as a heading in the issue
body, and that heading is what is looked for. If you rename a label —
translating the form, for instance — set `MONITORS_HEADING` or `WINDOW_HEADING`
to the new text. Get one out of step and that part quietly stops working.

`feed.xml` is an Atom feed of the same incidents, linked from the page and
announced in its head, so a reader can follow the page without polling it and
without a GitHub account. There is one entry per incident rather than per
update: it appears when the incident is opened, and its `updated` moves when the
incident is resolved, which is what tells a reader's client to show it again.
Set `SITE_URL` if the page has a custom domain, so the feed can link to itself;
without it the feed is still valid and still links to every incident.

The `maintenance` label is reserved for that template. It is dropped from
`INCIDENT_LABELS` if it appears there, and an issue the workflow opened for an
outage is shown as an outage even if it carries the label, so a mislabelled
issue cannot present downtime as planned work.

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

## Tests

```bash
node --test
```

Covers configuration parsing, the redaction that keeps a private monitor's URL
out of issues, the daily rollup, the notification payloads in each language, the
language dictionaries themselves, what the build writes into the page's head,
the Atom feed, the certificate warnings and their stepping down, and the SMTP
client against a server that speaks the protocol back. No dependencies, and the Test workflow
runs the same command on every push that touches `scripts/` or `test/`.

## Notes

- Scheduled workflows are queued, not guaranteed: runs drift, whole slots get
  dropped under load, and GitHub disables schedules in repositories with no
  activity for 60 days. For an exact interval, trigger the workflow from a
  machine you control: [docs/external-scheduler.md](docs/external-scheduler.md).
- Uptime percentages count degraded checks as up, in the figures and in the
  day tooltip alike; only a failed check counts against them.
- A status page that has stopped checking still knows what it saw last, and
  saying so confidently is the one way it can mislead outright. Past
  `STALE_AFTER` minutes without a check the banner says the status may be out of
  date, and the tab icon greys out with it. The rows keep showing what was last
  seen, because that is what they are. The clock behind this is the newest check
  in the data, not the time the page was built: a scheduled rebuild moves the
  build time forward on its own and would go on doing so long after the checks
  behind it had stopped.
- The page's `<title>`, description and the tags a chat client reads to build a
  card are written into `index.html` by the build. Nothing that matters there
  runs the page's script, so a link shared in chat would otherwise advertise
  every deployment as "Status" in English whatever it was configured as. Set
  `SITE_URL` for the card to know its own address, and `SITE_LOGO` for it to
  have a picture.
- The page names its modules with `modulepreload` in the head. Without that a
  browser finds each import only after parsing the one before it, and the
  request for the status data queues behind the whole chain. The data itself is
  not preloaded: it is fetched with `no-cache`, which a preload does not match,
  so the hint would fetch it twice rather than once.
- Times are shown in the reader's own time zone, with the full timestamp and
  the zone's name in the tooltip of an incident's date. The day a bar stands for
  is a UTC day, and stays labelled as one wherever it is read from. How dates
  and durations are worded follows `SITE_LANG` rather than the reader's browser,
  so a label and the time beside it never disagree.

## License

- MIT — see [LICENSE](LICENSE).
- Data in the `./history` directory: [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/)
