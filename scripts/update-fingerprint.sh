#!/bin/sh
# Print a fingerprint of a dictionary update: its data files, its regression fixtures and its
# commit message. The update workflow takes one before any review and another of what it is
# about to commit, and lets an update merge itself only when the two match.
#
# Usage: sh scripts/update-fingerprint.sh <data directory> <fixtures directory> <commit message>
set -eu
list() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum); }
{
  list "$1"
  list "$2"
  sha256sum < "$3"
} | sha256sum | cut -d ' ' -f 1
