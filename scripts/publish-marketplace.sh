#!/usr/bin/env bash
set -euo pipefail

# Publish Claude Cockpit to the VSCode Marketplace.
#
# Prereqs (one-time, maintainer only):
#   1. Create an Azure DevOps organization tied to the publisher account
#      (publisher: dashable). https://dev.azure.com
#   2. Generate a Personal Access Token (PAT):
#        User Settings -> Personal Access Tokens -> + New Token
#        Organization: All accessible organizations
#        Scopes: Custom defined -> Marketplace -> Manage (read+publish)
#      See: https://learn.microsoft.com/en-us/azure/devops/marketplace/publish-extension
#   3. Export it for this shell:        export VSCE_PAT="<your-pat>"
#
# Usage:
#   bash scripts/publish-marketplace.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PUBLISHER=$(node -p "require('./package.json').publisher")
EXT_ID=$(node -p "require('./package.json').name")

if [[ -z "${VSCE_PAT:-}" ]]; then
  echo "ERROR: VSCE_PAT is not set." >&2
  echo "Generate a PAT (Marketplace -> Manage) at https://dev.azure.com and:" >&2
  echo "  export VSCE_PAT=\"<your-pat>\"" >&2
  echo "See https://learn.microsoft.com/en-us/azure/devops/marketplace/publish-extension" >&2
  exit 1
fi

VERSION=$(node -p "require('./package.json').version")
if [[ -z "$VERSION" ]]; then
  echo "ERROR: could not read version from package.json" >&2
  exit 1
fi

VSIX_NAME="${EXT_ID}-${VERSION}.vsix"

echo "==> Compiling TypeScript"
npm run compile

echo "==> Verifying PAT for publisher '${PUBLISHER}'"
npx --yes @vscode/vsce verify-pat "$PUBLISHER"

echo "==> Packaging ${VSIX_NAME}"
npx --yes @vscode/vsce package --out "$VSIX_NAME"

echo "==> Publishing to VSCode Marketplace"
npx --yes @vscode/vsce publish --packagePath "$VSIX_NAME"

URL="https://marketplace.visualstudio.com/items?itemName=${PUBLISHER}.${EXT_ID}"
echo
echo "Published ${PUBLISHER}.${EXT_ID}@${VERSION}"
echo "  -> ${URL}"
