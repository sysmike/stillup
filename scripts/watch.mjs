// Keeps an issue open for as long as GitHub holds one of this repository's
// workflows for approval, and closes it once nothing is held. Run by the Watch
// workflow, which is not one it can report on: a held run does nothing.

import { load } from '../site/lang/i18n.mjs';
import { api, repo } from './lib/github.mjs';
import { HELD_MARKER, heldBody, heldSince } from './lib/held.mjs';
import { findWorkflowIssue } from './lib/issues.mjs';

const { t } = await load(process.env.SITE_LANG);
const server = process.env.GITHUB_SERVER_URL || 'https://github.com';

const { workflows } = await api(`/repos/${repo}/actions/workflows?per_page=100`);
const held = [];
for (const workflow of workflows) {
  // A disabled workflow is meant not to run, and Watch is running.
  if (workflow.state !== 'active' || workflow.path === '.github/workflows/watch.yml') continue;
  const { workflow_runs: runs } = await api(`/repos/${repo}/actions/workflows/${workflow.id}/runs?per_page=50`);
  const since = heldSince(runs);
  if (since) {
    held.push({ name: workflow.name, url: `${server}/${repo}/actions/workflows/${workflow.path.split('/').pop()}`, since });
  }
}

// A page has a handful of open issues at most, so one page of them is plenty.
const notice = findWorkflowIssue(await api(`/repos/${repo}/issues?state=open&per_page=100`), HELD_MARKER);

if (held.length) {
  const body = heldBody({ t, held });
  if (!notice) {
    const created = await api(`/repos/${repo}/issues`, { method: 'POST', body: { title: t('issue.heldTitle'), body } });
    console.log(`Held: ${held.map((item) => item.name).join(', ')}. Opened #${created.number}.`);
  } else if (notice.body !== body) {
    await api(`/repos/${repo}/issues/${notice.number}`, { method: 'PATCH', body: { body } });
    console.log(`Held: ${held.map((item) => item.name).join(', ')}. Updated #${notice.number}.`);
  } else {
    console.log(`Held: ${held.map((item) => item.name).join(', ')}. #${notice.number} already says so.`);
  }
} else if (notice) {
  await api(`/repos/${repo}/issues/${notice.number}/comments`, { method: 'POST', body: { body: t('issue.heldCleared') } });
  await api(`/repos/${repo}/issues/${notice.number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
  console.log(`Nothing is held. Closed #${notice.number}.`);
} else {
  console.log('Nothing is held.');
}
