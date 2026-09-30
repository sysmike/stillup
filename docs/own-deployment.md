# Running the page from its own repository

The project and a status page built from it want different things from a
repository. The project wants public issues, so anyone can report a bug. A
status page wants its issues to itself, since they are its incidents, and it
carries its own history, variables and secrets. Keeping them in two
repositories lets each have what it needs, and the **Sync** workflow keeps the
deployment's code up to date with the project.

## What the sync does

Once a day, and whenever you start it from the Actions tab, **Sync** makes the
deployment's files match the project's, with two exceptions:

- `history/` always stays the deployment's own. The project's copy, if it has
  one, is ignored.
- Paths listed in the `SYNC_KEEP` variable stay as the deployment has them — a
  translated issue template, say, or a logo under `site/`.

Files the project changed, added or deleted are changed, added or deleted here
too. The tests run before anything is committed; if they fail, nothing is. The
result is one commit on top of the deployment's own, so the status commits the
Uptime workflow makes never conflict with it, and the page is deployed
afterwards.

| Variable | Default | Description |
| --- | --- | --- |
| `SYNC_UPSTREAM` | `sysmike/stillup` | The repository to follow |
| `SYNC_REF` | `main` | The branch or tag to follow |
| `SYNC_KEEP` | none | Further paths to leave alone, separated by spaces or commas |

## Keep it public

The page reads `history/live.json` from `raw.githubusercontent.com` to refresh
without a deployment, and a private repository's files are not readable there
without signing in, so the page would stop refreshing between builds. GitHub
Pages from a private repository also needs a paid plan, and Actions minutes
stop being free.

## Moving an existing page

These steps take a page that runs from the project repository and move it into
its own. Until the switch in step 5 the old repository goes on running the page
and keeping its record, so the new one stays quiet until then: two repositories
checking at once would each hold part of the history, and both would send every
alert.

### 1. Create the repository

Create an empty **public** repository, for example `status`, and copy the
current one into it, history and all:

```bash
git clone --bare https://github.com/<you>/stillup.git
cd stillup.git
git push --mirror https://github.com/<you>/status.git
cd .. && rm -rf stillup.git
```

Pick a name your account has not used before. If the repository you are moving
from was renamed, GitHub keeps redirecting its old name — to the scheduler, the
page's refresh and your clones — only until a new repository takes that name.

### 2. Hold its checks

In the new repository, **Actions → Uptime → Disable workflow**, straight away.
Its schedule starts as soon as the workflow exists. Runs that happen before you
get to it do no harm: the switch replaces everything they wrote.

### 3. Set it up

In the new repository:

- **Settings → Pages → Source**: *GitHub Actions*.
- **Settings → Actions → General → Workflow permissions**: *Read and write
  permissions*.
- **Settings → General → Features → Issues → Issue permissions**: *Collaborators
  only*.
- **Settings → Secrets and variables → Actions**: recreate every variable and
  secret the old repository has, notifications included. They are not copied
  with the code, and nothing checks or alerts from here until step 5.

Then give the sync a token. `GITHUB_TOKEN` can push code but not a change to a
workflow file, so following the project fully takes a token that can. Create a
fine-grained token at <https://github.com/settings/personal-access-tokens/new>:

- **Repository access**: *Only select repositories* → the new repository
- **Repository permissions** → **Contents**: *Read and write*
- **Repository permissions** → **Workflows**: *Read and write*

Store it in the new repository as the secret `SYNC_TOKEN`. Without it, a sync
works as long as the project has not changed a workflow. One that has is
stopped whole, with an error saying why, rather than taking the code without
the workflows that go with it.

### 4. Know how you would go back

Nothing below deletes anything until step 6. If the new page is not right at any
point in step 5, enable **Uptime** in the old repository again and move the
domain back if you had moved it: the old page picks up where it stopped.

### 5. Switch over

Do these in one sitting. Between the first and the last, the page on your domain
is frozen rather than down: it shows what the old repository last recorded.

1. In the old repository, **Actions → Uptime → Disable workflow**. Its record
   stops here, and an external scheduler still pointed at it will log failed
   dispatches until item 5 below.
2. Bring over everything it recorded since the copy. In a clone of the new
   repository, with the old repository's name in place of `stillup`:

   ```bash
   git pull
   git fetch https://github.com/<you>/stillup.git main
   git rm -rq history
   git checkout FETCH_HEAD -- history
   git commit -m "chore: take over the history"
   git push
   ```

   This replaces the new repository's `history/` with the old one's entirely,
   including anything a run wrote before you held its checks.
3. In the new repository, enable **Uptime** again and run it from the Actions
   tab, then run **Sync**. The page is now live at
   `https://<you>.github.io/<repository>/`; check it there.
4. Move the domain. A custom domain can belong to one Pages site at a time:
   remove it under **Settings → Pages** in the old repository, then add it in
   the new one. DNS does not change, since both are served from
   `<you>.github.io`. The page is unreachable on the domain until GitHub has
   issued the new certificate, which is usually a matter of minutes but can
   take longer.
5. If an external scheduler dispatches the Uptime workflow, change the
   repository it names and add the new repository to its token's repository
   access — see [external-scheduler.md](external-scheduler.md).
6. Incidents are issues, and they stay in the repository they were opened in.
   To keep them on the page, open each one in the old repository and use
   **Transfer issue** in its sidebar. An incident left behind drops off the
   page.

### 6. Retire the old page

Once the new page has run for a while and you are happy with it, in the old
repository:

- **Actions → Pages**: *Disable workflow*. Leave **Test** enabled, and
  **Sync**, which does nothing there.
- Delete its variables and secrets.
- Delete `history/` in an ordinary commit, if you like: the sync never reads
  it, and the data stays in the git history should you ever want it back.
- Open **Issue permissions** back up to everyone if you want public bug
  reports.
