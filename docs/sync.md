# Keeping your page up to date

Your page lives in a fork of this project, with its own history, incidents,
variables and secrets. The **Sync** workflow keeps the fork's code up to date
with the project, so the page gets fixes and features without you merging
anything.

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
| `SYNC_UPSTREAM` | `sysmike/stillup` | The repository to follow. Uptime, Pages and Sync do nothing in the repository it names |
| `SYNC_REF` | `main` | The branch or tag to follow |
| `SYNC_KEEP` | none | Further paths to leave alone, separated by spaces or commas |

## Keep it public

The page reads `history/live.json` from `raw.githubusercontent.com` to refresh
without a deployment, and a private repository's files are not readable there
without signing in, so the page would stop refreshing between builds. GitHub
Pages from a private repository also needs a paid plan, and Actions minutes
stop being free.

## Giving the sync a token

`GITHUB_TOKEN` can push code but not a change to a workflow file, so following
the project fully takes a token that can. Create a fine-grained token at
<https://github.com/settings/personal-access-tokens/new>:

- **Repository access**: *Only select repositories* → your page's repository
- **Repository permissions** → **Contents**: *Read and write*
- **Repository permissions** → **Workflows**: *Read and write*

Store it in that repository as the secret `SYNC_TOKEN`. Without it, a sync
works as long as the project has not changed a workflow. One that has is
stopped whole, with an error saying why, rather than taking the code without
the workflows that go with it.

## If you also develop the code in your page's repository

Move the code out, not the page. The page's repository is the one with a
domain, variables, secrets, incidents and a history, and every one of those
would have to be moved and switched over; the code has none of them.

1. **Rename the page's repository** to what the page should be called, under
   **Settings → General**. Everything that pointed at it follows the rename.
2. **Run Pages** from its Actions tab. The page reads its live data from the
   repository by name, and the name it was built with changes only when it is
   built again.
3. **Create an empty public repository** for the code, under the old name if
   you like. Do this after step 2: GitHub stops redirecting a renamed
   repository's old name once a new repository takes it. Unless the code's
   repository is `sysmike/stillup`, set its own `SYNC_UPSTREAM` variable to its
   own name before pushing anything: the workflows arrive with the code, and
   this tells Uptime, Pages and Sync that there is no page there to run.
4. **Copy the code into it without the page's data.** In a fresh clone of the
   page's repository, this removes `history/` from every commit and drops the
   status commits that are left empty, keeping everything else:

   ```bash
   git clone --single-branch https://github.com/<you>/<page>.git code
   cd code
   FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --prune-empty --index-filter '
     git ls-files -z history | grep -zv "^history/.gitkeep$" | xargs -0 -r git rm -q --cached --ignore-unmatch --
   ' -- main
   git push https://github.com/<you>/<code>.git main
   ```

5. **In the page's repository, set `SYNC_UPSTREAM`** to the code's repository,
   unless it is `sysmike/stillup`, and add `SYNC_TOKEN` as above. From then on
   the page follows the code.

If an external scheduler dispatches the Uptime workflow, point it at the page's
new name too — see [external-scheduler.md](external-scheduler.md). It keeps
working through the redirect in the meantime, but only for as long as nothing
takes the old name.
