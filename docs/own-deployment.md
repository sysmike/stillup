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
| `SYNC_UPSTREAM` | `sysmike/status-page` | The repository to follow |
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
its own. They are ordered so the page keeps running until the last step.

### 1. Create the repository

Create an empty **public** repository, for example `status`, and copy the
current one into it, history and all:

```bash
git clone --bare https://github.com/<you>/status-page.git
cd status-page.git
git push --mirror https://github.com/<you>/status.git
cd .. && rm -rf status-page.git
```

### 2. Set it up

In the new repository:

- **Settings → Pages → Source**: *GitHub Actions*.
- **Settings → Actions → General → Workflow permissions**: *Read and write
  permissions*.
- **Settings → General → Features → Issues → Issue permissions**: *Collaborators
  only*.
- **Settings → Secrets and variables → Actions**: recreate every variable and
  secret the old repository has. They are not copied with the code.

Scheduled runs can start before this is done and fail, or run with nothing to
check. That is harmless: the next step runs everything once it is in place.

### 3. Give the sync a token

`GITHUB_TOKEN` can push code but not a change to a workflow file, so following
the project fully takes a token that can. Create a fine-grained token at
<https://github.com/settings/personal-access-tokens/new>:

- **Repository access**: *Only select repositories* → the new repository
- **Repository permissions** → **Contents**: *Read and write*
- **Repository permissions** → **Workflows**: *Read and write*

Store it in the new repository as the secret `SYNC_TOKEN`. Without it, a sync
works as long as the project has not changed a workflow. One that has is
stopped whole, with an error saying why, rather than taking the code without
the workflows that go with it.

### 4. Check it runs

Run **Uptime** once from the Actions tab, then **Sync**. The page is now live at
`https://<you>.github.io/status/`; check it looks right there before moving
anything else.

### 5. Move the domain

A custom domain can belong to one Pages site at a time. Remove it under
**Settings → Pages** in the old repository, then add it in the new one. DNS does
not change, since both are served from `<you>.github.io`. The page is
unreachable on the domain until GitHub has issued the new certificate, which is
usually a matter of minutes but can take longer.

### 6. Point everything else at it

- If an external scheduler dispatches the Uptime workflow, change the
  repository in its script, and add the new repository to its token's
  repository access — see [external-scheduler.md](external-scheduler.md).
- Incidents are issues, and they stay in the repository they were opened in. To
  keep them on the page, open each one in the old repository and use **Transfer
  issue** in its sidebar. An incident left behind simply drops off the page.

### 7. Retire the old page

In the old repository:

- **Actions → Uptime** and **Actions → Pages**: *Disable workflow*, before
  anything else. Left running, Uptime would go on checking your monitors,
  committing history and opening incidents in a repository that no longer
  serves the page. Leave **Test** enabled, and **Sync**, which does nothing
  there.
- Delete its variables and secrets.
- Open **Issue permissions** back up to everyone if you want public bug
  reports.
- Deleting `history/` from it is optional: the sync never reads it.
