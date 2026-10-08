// Which workflows GitHub is holding for approval. A held run does nothing at
// all, so it cannot say so itself; this is read from outside, by the Watch
// workflow.

export const HELD_MARKER = '<!-- watch:held -->';

// A run from someone else's pull request waits for approval as a matter of
// course, and says nothing about whether the page's own workflows run.
const FROM_PULL_REQUEST = new Set(['pull_request', 'pull_request_target']);

// Runs newest first. A workflow is held when its newest run is; an older held
// run that a later one has overtaken is history. `since` is the oldest run of
// the unbroken stretch of held ones, which is how long it has been stopped.
export function heldSince(runs) {
  const own = runs.filter((run) => !FROM_PULL_REQUEST.has(run.event));
  let since = null;
  for (const run of own) {
    if (run.conclusion !== 'action_required') break;
    since = run.created_at;
  }
  return since;
}

const when = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

// Each workflow links to its own page rather than to a run: the newest held
// run changes every few minutes for Uptime, and the body should not.
export function heldBody({ t, held }) {
  return [
    t('issue.heldIntro'),
    held.map(({ name, url, since }) => `- ${t('issue.heldItem', { name, url, since: when(since) })}`).join('\n'),
    t('issue.heldWhy'),
    t('issue.heldSteps'),
    HELD_MARKER,
  ].join('\n\n');
}
