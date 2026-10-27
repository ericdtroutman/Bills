#!/usr/bin/env bash
# One-time setup, run in a GitHub Codespace on this repo:   bash setup/connect-google.sh
# 1. Signs in to Google with permission to update Apps Script projects only.
# 2. Downloads the live Bills script into server/, with the passcode taken out of the code.
# 3. Prints the two secrets to paste into GitHub, then pushes server/ so the first deploy runs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CLASP="npx -y @google/clasp@3.4.1"
line() { printf '\n%s\n' "------------------------------------------------------------"; }

line
echo "Before you start, in the Apps Script editor for your Bills script:"
echo "  Project Settings (gear icon) > Script Properties > Add script property"
echo "  Property: PASSCODE    Value: the passcode you use in the app now"
echo "Also turn on the Apps Script API at https://script.google.com/home/usersettings"
read -r -p "Done both? Type y and press Enter: " ok
[ "$ok" = "y" ] || { echo "Stopped. Run it again when both are done."; exit 1; }

line
echo "Paste your Script ID (Project Settings > IDs > Script ID), then press Enter:"
read -r SCRIPT_ID
SCRIPT_ID="$(printf '%s' "$SCRIPT_ID" | tr -d '[:space:]')"
[ -n "$SCRIPT_ID" ] || { echo "No Script ID entered."; exit 1; }

# Sign in with only the Apps Script permissions the deploy needs.
tmp="$(mktemp -d)"
printf '{"scriptId":"%s","rootDir":"."}' "$SCRIPT_ID" > "$tmp/.clasp.json"
cat > "$tmp/appsscript.json" <<'EOF'
{"timeZone":"America/New_York","oauthScopes":[
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
  "https://www.googleapis.com/auth/script.webapp.deploy"]}
EOF
line
echo "Google sign-in. Open the link below, choose your account, and allow access."
echo "Your browser will then show a page that won't load (localhost)."
echo "That's expected: copy that page's whole address and paste it here."
( cd "$tmp" && $CLASP login --no-localhost --use-project-scopes )
rm -rf "$tmp"

# Download the live script exactly as it is.
line
echo "Downloading your live script..."
rm -rf server && mkdir server
( cd server && $CLASP clone "$SCRIPT_ID" )

# Take the passcode out of the code: read it from Script Properties instead.
shopt -s nullglob
changed=0
for f in server/*.gs server/*.js; do
  if grep -qE "^\s*var\s+PASSCODE\s*=" "$f"; then
    sed -i -E "s/^(\s*)var\s+PASSCODE\s*=.*$/\1var PASSCODE = PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';/" "$f"
    sed -i "s/PICK YOUR PASSCODE: change the text between the quotes\./PASSCODE: set in Project Settings > Script Properties (name PASSCODE)./" "$f"
    sed -i "s/SETUP: Pick a passcode at the top of Code.gs, save, and deploy a new version./SETUP: Add a script property named PASSCODE in Project Settings > Script Properties./" "$f"
    changed=1
  fi
done
if [ "$changed" != 1 ] || grep -nE "^\s*var\s+PASSCODE\s*=\s*['\"]" server/*.gs server/*.js 2>/dev/null; then
  echo "Couldn't safely take the passcode out of the code. Nothing was pushed. Tell Claude what you see."
  exit 1
fi
echo "Passcode line replaced. The code now reads it from Script Properties."

line
echo "Your deployments (the one your app uses has the AKfy... id in your app link):"
( cd server && $CLASP deployments ) || true

line
echo "Now add two secrets at:"
echo "  https://github.com/ericdtroutman/Bills/settings/secrets/actions  >  New repository secret"
echo
echo "Secret 1   Name: DEPLOYMENT_ID"
echo "           Value: the AKfy... id from the list above that matches your app link"
echo
echo "Secret 2   Name: CLASPRC_JSON"
echo "           Value: everything between the two lines below"
echo "=================== copy from here ==================="
cat ~/.clasprc.json
echo
echo "==================== copy to here ===================="
read -r -p "Added both secrets? Type y and press Enter to send the script up: " ok
[ "$ok" = "y" ] || { echo "Stopped before pushing. Run git add server && git commit && git push when ready."; exit 1; }

git add server
git commit -m "Add Apps Script code (passcode moved to Script Properties)"
git push
rm -f ~/.clasprc.json
line
echo "Done. Watch the deploy at https://github.com/ericdtroutman/Bills/actions"
echo "You can delete this Codespace now (github.com/codespaces)."
