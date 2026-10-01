// The issue that stands for an update waiting to be applied by hand. It carries
// no incident label, so the page never shows it, and a marker, so the sync
// finds it again: one issue for as long as something waits, edited when a
// newer update takes its place and closed once one is applied.

import { WORKFLOW_BOT } from './issues.mjs';

export const UPDATE_MARKER = '<!-- sync:update -->';

const server = () => process.env.GITHUB_SERVER_URL || 'https://github.com';

export function commitLink(upstream, sha) {
  return `[${upstream}@${sha.slice(0, 7)}](${server()}/${upstream}/commit/${sha})`;
}

export function noticeBody({ t, upstream, sha, syncUrl }) {
  return [
    t('issue.updateIntro', { commit: commitLink(upstream, sha) }),
    t('issue.updateWhy'),
    t('issue.updateSteps', { url: syncUrl }),
    t('issue.updateAutoClose'),
    UPDATE_MARKER,
  ].join('\n\n');
}

// Only the workflow's own issue counts. Anyone who can open an issue can type
// the marker, and the sync would otherwise close their issue for them.
export function findNotice(issues) {
  return (
    issues.find(
      (issue) =>
        !issue.pull_request &&
        issue.user?.type === 'Bot' &&
        issue.user.login === WORKFLOW_BOT &&
        (issue.body || '').includes(UPDATE_MARKER),
    ) || null
  );
}
