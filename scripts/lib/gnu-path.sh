#!/usr/bin/env bash
# macOS: the red-team tooling and e2e scripts use GNU grep -P and coreutils' timeout. Homebrew installs them as
# ggrep/gtimeout; putting the gnubin directories first on PATH makes plain `grep -P` / `timeout` work.
#   brew install bash grep coreutils  # once (macOS ships bash 3.2; the scripts use mapfile / declare -A)
#   source scripts/lib/gnu-path.sh    # in your shell, or: PATH prefix is applied by scripts that source this file
# No-op on Linux.
if [[ "$(uname -s)" == Darwin ]]; then
  for d in /opt/homebrew/opt/grep/libexec/gnubin /opt/homebrew/opt/coreutils/libexec/gnubin /opt/homebrew/bin \
           /usr/local/opt/grep/libexec/gnubin /usr/local/opt/coreutils/libexec/gnubin; do
    [[ -d "$d" && ":$PATH:" != *":$d:"* ]] && PATH="$d:$PATH"
  done
  export PATH
fi
