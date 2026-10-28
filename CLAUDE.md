# Bills (My Money app)

Eric's family budget app. The page (index.html) is served by GitHub Pages from main. The data lives in a Google Sheet behind an Apps Script web app (server/), and bank data comes in through SimpleFIN.

## How changes ship (Eric does nothing by hand)
- **Page:** edit index.html, commit, push to main. GitHub Pages republishes it in about a minute.
- **Script:** edit server/Code.js (or other files in server/), commit, push to main. `.github/workflows/deploy-script.yml` runs `clasp push --force` and `clasp redeploy`, so the web app link never changes. The `DEPLOYMENT_ID` secret holds the whole web app link; the workflow takes the id out of it, and the run fails if the web app's version didn't move. Its notice shows the deployments and versions: read it with `gh run list --repo ericdtroutman/bills --workflow deploy-script.yml --limit 1`, then `gh api repos/ericdtroutman/bills/check-runs/<job id>/annotations` (job id from `gh run view <run id> --json jobs`). Logs themselves can't be read from the workspace.
- **Checking the live script:** `.github/workflows/check-script.yml` (runs when its file changes, or by hand) reports, read-only, what code Google has, the versions and deployments, and whether the PASSCODE script property is set (via a temporary deployment it removes again).
- Until Oct 28, 2026 the web app was stuck on version 12 (the redeploy was given the full link). The daily sync trigger was created from the web app and may still run version 12; check that the sync uses new script code before relying on it.
- Commit straight to main with a plain-language message. Eric doesn't review PRs.

## Preview first (beta/)
- `beta/index.html` is the **preview**: the same app, opened at the site + `/beta/`. It reads Eric's real data (getData, getHistory) but `PREVIEW` blocks every save, backup and bank call, and a yellow bar says so. Reload resets it.
- **Build new features in beta/index.html first.** List each one in `PREVIEW_NEW` (one short line) so the bar shows what's being tried. Eric tries it on his phone.
- **Move a feature to the real app (root index.html) only when Eric says it's good**, tests pass for both (`tests.html` and `tests.html?app=beta`), and it's between paydays (one feature per pay period). Then remove its line from `PREVIEW_NEW`.
- Fixes and changes to shared code go into **both** files. `diff index.html beta/index.html` should show only features still in preview.
- Script changes a preview feature needs must be **additive only** (a new tab or a new field the real app ignores) so they can ship to Apps Script before the page change does.

## Rules
- **tests.html must pass before any change to the money math ships.** It loads index.html in a hidden frame with saving switched off and replays the Pay Period Plan walkthrough. Run it headless before pushing for both versions (serve the repo with `python3 -m http.server`, open `/tests.html` and `/tests.html?app=beta` in Playwright, read `window.__result`), and add checks there whenever the money math changes. Live copy: the GitHub Pages site + `/tests.html`.
- This repo is **public**. Never write the passcode, tokens, the deployment id or the web app URL into any file. The passcode lives in Script Properties (`PASSCODE`); the deploy sign-in and deployment id are repository secrets.
- New Sheet columns go at the **end** of a table in `TABLES`; `sheet_()` adds missing headers on its own.
- Remind Eric to tap **Back up** in the app before a change that touches the Sheet's structure.
- Don't ship on a Friday payday or during the pay-period overlap without saying so.
- Plans and history live in the claude.ai project "Comprehensive Budget and Family Planning App" (My Money - project context.md, My Money - roadmap.md).

## One-time setup (already done once connected)
`setup/connect-google.sh`, run in a Codespace, signs in with Apps Script permissions only, downloads the live script into server/ with the passcode line replaced, and prints the two secrets to add.
