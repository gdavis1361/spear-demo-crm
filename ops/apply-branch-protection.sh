#!/usr/bin/env bash
# Applies ops/branch-protection.json to the `main` branch.
#
# Usage:
#   ./ops/apply-branch-protection.sh            # apply
#   ./ops/apply-branch-protection.sh --diff     # show local vs remote
#
# Requires `gh` CLI authenticated with admin access on the repo.
#
# The GH API expects a stripped shape (no `_comment` fields, required_signatures
# is `enabled: bool`, etc). We `jq` the file into the right form before PUTting.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$HERE/branch-protection.json"
OWNER_REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not on PATH" >&2
  exit 1
fi

# Strip editorial `_comment` keys + massage required_signatures to the
# bool the API expects.
payload=$(
  jq '
    walk(if type == "object" then with_entries(select(.key | startswith("_") | not)) else . end)
    | .required_signatures = false
  ' "$CONFIG"
)

case "${1:-apply}" in
  --diff|-d)
    remote=$(gh api "repos/$OWNER_REPO/branches/main/protection" --jq '{
      required_status_checks: .required_status_checks | {strict, contexts},
      enforce_admins: .enforce_admins.enabled,
      required_pull_request_reviews: .required_pull_request_reviews | {
        required_approving_review_count,
        dismiss_stale_reviews,
        require_code_owner_reviews,
        require_last_push_approval
      },
      required_linear_history: .required_linear_history.enabled,
      allow_force_pushes: .allow_force_pushes.enabled,
      allow_deletions: .allow_deletions.enabled,
      block_creations: .block_creations.enabled,
      required_conversation_resolution: .required_conversation_resolution.enabled,
      lock_branch: .lock_branch.enabled,
      allow_fork_syncing: .allow_fork_syncing.enabled,
      required_signatures: .required_signatures.enabled
    }')
    local=$(echo "$payload" | jq 'del(.restrictions)')
    diff <(echo "$remote" | jq -S .) <(echo "$local" | jq -S .) || true
    ;;
  apply|-a|"")
    echo "Applying branch protection to $OWNER_REPO/main"
    echo "$payload" | gh api \
      --method PUT \
      -H "Accept: application/vnd.github+json" \
      "repos/$OWNER_REPO/branches/main/protection" \
      --input -
    echo "OK"
    ;;
  *)
    echo "Unknown arg: $1" >&2
    echo "Usage: $0 [--diff|apply]" >&2
    exit 2
    ;;
esac
