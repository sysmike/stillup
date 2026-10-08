// The issue that stands for an update waiting to be applied by hand. It carries
// no incident label, so the page never shows it, and a marker, so the sync
// finds it again: one issue for as long as something waits, edited when a
// newer update takes its place and closed once one is applied.

import { findWorkflowIssue } from './issues.mjs';

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

export const findNotice = (issues) => findWorkflowIssue(issues, UPDATE_MARKER);
