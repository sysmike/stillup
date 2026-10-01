// Tells the page's notification targets that an update is waiting for someone
// to apply it. The scheduled sync leaves workflow changes alone: GitHub may hold
// a changed workflow for approval, and a hold that starts at night stops the
// checks until someone happens to look.

import { load } from '../site/lang/i18n.mjs';
import { loadConfig } from './lib/config.mjs';
import { notify } from './lib/notify.mjs';

const { notifications, site } = loadConfig(process.env.CONFIG_VARS, process.env.CONFIG_SECRETS);
const { t } = await load(site.lang);
const server = process.env.GITHUB_SERVER_URL || 'https://github.com';

const sent = await notify(
  notifications,
  {
    status: 'update',
    name: site.title,
    // Where it is applied, rather than what it is: the commit is one click on.
    url: `${server}/${process.env.GITHUB_REPOSITORY}/actions/workflows/sync.yml`,
    update: { upstream: process.env.SYNC_UPSTREAM, sha: process.env.SYNC_SHA },
    site: site.title,
    at: new Date().toISOString(),
  },
  { t },
);
if (!sent) console.log('No notification target takes update events.');
