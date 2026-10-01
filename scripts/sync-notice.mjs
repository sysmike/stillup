// Says that an update is waiting for someone to apply it, and takes that back
// once one is applied. The scheduled sync leaves workflow changes alone: GitHub
// may hold a changed workflow for approval, and a hold that starts at night
// stops the checks until someone happens to look.
//
//   node scripts/sync-notice.mjs waiting   notify, and open or update the issue
//   node scripts/sync-notice.mjs applied   close the issue, if one is open

import { load } from '../site/lang/i18n.mjs';
import { loadConfig } from './lib/config.mjs';
import { api, repo } from './lib/github.mjs';
import { notify } from './lib/notify.mjs';
import { commitLink, findNotice, noticeBody } from './lib/update-notice.mjs';

const mode = process.argv[2];
if (mode !== 'waiting' && mode !== 'applied') {
  throw new Error(`Usage: sync-notice.mjs waiting|applied, not "${mode ?? ''}"`);
}

const { notifications, site } = loadConfig(process.env.CONFIG_VARS, process.env.CONFIG_SECRETS);
const { t } = await load(site.lang);
const upstream = process.env.SYNC_UPSTREAM;
const sha = process.env.SYNC_SHA;
const syncUrl = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/workflows/sync.yml`;

// The issue it opened is among the open ones. A page has a handful at most, so
// one page of them is plenty.
const open = await api(`/repos/${repo}/issues?state=open&per_page=100`);
const notice = findNotice(open);

if (mode === 'applied') {
  if (notice) {
    await api(`/repos/${repo}/issues/${notice.number}/comments`, {
      method: 'POST',
      body: { body: t('issue.updateApplied', { commit: commitLink(upstream, sha) }) },
    });
    await api(`/repos/${repo}/issues/${notice.number}`, {
      method: 'PATCH',
      body: { state: 'closed', state_reason: 'completed' },
    });
    console.log(`Closed #${notice.number}.`);
  }
} else {
  const body = noticeBody({ t, upstream, sha, syncUrl });
  if (!notice) {
    const created = await api(`/repos/${repo}/issues`, {
      method: 'POST',
      body: { title: t('issue.updateTitle'), body },
    });
    console.log(`Opened #${created.number}.`);
  } else if (notice.body !== body) {
    // A newer update has taken the waiting one's place. Edited rather than
    // commented on, so the issue does not fill up with one comment a night.
    await api(`/repos/${repo}/issues/${notice.number}`, { method: 'PATCH', body: { body } });
    console.log(`Updated #${notice.number}.`);
  }

  // Unlike the issue, this is sent every night until the update is applied.
  const sent = await notify(
    notifications,
    {
      status: 'update',
      name: site.title,
      url: syncUrl,
      update: { upstream, sha },
      site: site.title,
      at: new Date().toISOString(),
    },
    { t },
  );
  if (!sent) console.log('No notification target takes update events.');
}
