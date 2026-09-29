#!/usr/bin/env bash
# Brings a deployment repository's code up to date with the project it was
# copied from, leaving its own data alone.
#
# Everything is taken from upstream except history/ and the paths listed in
# SYNC_KEEP, which stay exactly as this repository has them. Histories are not
# merged: the result is staged as one change on top of HEAD, so the status
# commits the Uptime workflow makes can never conflict with it. Files upstream
# has deleted are deleted here too.
#
# Stages the result and reports what changed; running the tests, committing and
# pushing are left to the caller. Meant for a fresh checkout, such as a
# workflow's: it rewrites the index and the working tree.
#
#   SYNC_UPSTREAM  owner/repository to follow (required)
#   SYNC_REF       branch or tag to follow (default: main)
#   SYNC_KEEP      further paths to keep, separated by spaces or commas
#   SYNC_SOURCE    where to fetch from, if not GitHub (used by the tests)

set -euo pipefail

upstream="${SYNC_UPSTREAM:?SYNC_UPSTREAM must name the repository to follow}"
ref="${SYNC_REF:-main}"
source="${SYNC_SOURCE:-https://github.com/${upstream}.git}"
extra="${SYNC_KEEP:-}"
# history/ is not optional: it is this deployment's record, and upstream's copy
# of it, if it has one, is somebody else's.
keep="history ${extra//,/ }"

git fetch --quiet --no-tags --depth=1 "$source" "$ref"
theirs=$(git rev-parse FETCH_HEAD)

# Their tree becomes the index; then each kept path is put back the way HEAD
# has it, and dropped entirely if HEAD never had it.
git read-tree "$theirs"
for path in $keep; do
  # --force because the entry read from upstream differs from both HEAD and
  # the working tree, which rm refuses otherwise; --cached never touches files.
  git rm -r -q --cached --force --ignore-unmatch -- "$path"
  if git cat-file -e "HEAD:${path}" 2>/dev/null; then
    git checkout HEAD -- "$path"
  fi
done

# The working tree follows the index, so the tests run against what would be
# committed. That includes removing files upstream deleted, which would
# otherwise linger untracked — a deleted test would still be run.
git checkout-index --all --force
git diff --cached --name-only --diff-filter=D HEAD -z | xargs -0 -r rm -f --

changed=false
workflows=false
if ! git diff --cached --quiet HEAD; then changed=true; fi
if ! git diff --cached --quiet HEAD -- .github/workflows; then workflows=true; fi

echo "upstream ${upstream}@${ref} is ${theirs:0:7}; changed=${changed}, workflows changed=${workflows}"
if [ "$changed" = true ]; then git diff --cached --stat HEAD | tail -n 25; fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "changed=${changed}"
    echo "workflows=${workflows}"
    echo "upstream_sha=${theirs}"
  } >> "$GITHUB_OUTPUT"
fi
