# Bills (My Money app)

Eric's family budget app. The page (index.html) is served by GitHub Pages from main. The data lives in a Google Sheet behind an Apps Script web app (server/), and bank data comes in through SimpleFIN.

## How changes ship (Eric does nothing by hand)
- **Page:** edit index.html, commit, push to main. GitHub Pages republishes it in about a minute.
- **Script:** edit server/Code.js (or other files in server/), commit, push to main. `.github/workflows/deploy-script.yml` runs `clasp push --force` and `clasp redeploy`, so the web app link never changes. The `DEPLOYMENT_ID` secret holds the whole web app link; the workflow takes the id out of it, and the run fails if the web app's version didn't move. Its notice shows the deployments and versions: read it with `gh run list --repo ericdtroutman/bills --workflow deploy-script.yml --limit 1`, then `gh api repos/ericdtroutman/bills/check-runs/<job id>/annotations` (job id from `gh run view <run id> --json jobs`). Logs themselves can't be read from the workspace.
- **Checking the live script:** `.github/workflows/check-script.yml` (runs when its file changes, or by hand) reports, read-only, what code Google has, the versions and deployments, and whether the PASSCODE script property is set (via a temporary deployment it removes again).
- Until Oct 28, 2026 the web app was stuck on version 12 (the redeploy was given the full link). Fixed; the daily sync trigger runs the current code too (confirmed by the Oct 29 6:18 AM sync: passcodeReady = yes, JointBank refreshed).
- Commit straight to main with a plain-language message. Eric doesn't review PRs.

## No preview step (Eric, Oct 28, 2026)
- **Build straight into index.html and ship.** Eric asked to skip the beta/ preview to save usage. `beta/index.html` is no longer kept up to date; don't edit it or test it.
- Keep work lean: no screenshots or extra checks unless something is risky or Eric asks.
- Script changes still go out before a page change that needs them (deploy, then push the page).

## Rules
- **The passcode is never saved on a device** (Eric, Oct 29, 2026): the page remembers only the app link and asks for the passcode every time it opens.
- **Long range is hidden** (`SHOW_LONG_RANGE = false` in index.html). The code and the saved `longRange` setting are kept for later.
- **Daily bank sync runs at about 8:30 AM** (Eric, Oct 29, 2026; `SYNC_SCHEDULE` in Code.js). Changing it replaces the trigger the next time the app is opened.
- **Sync log** (Oct 29, 2026): every sync adds a row to the SyncLog tab (time, Automatic or Sync now, how many came in, and SimpleFIN's last-update time for each linked bank). New Charges and Checking rows get addedAt and bankAsOf. SyncLog isn't sent to the page.
- **tests.html must pass before any change to the money math ships.** It loads index.html in a hidden frame with saving switched off and replays the Pay Period Plan walkthrough. Run it headless before pushing (serve the repo with `python3 -m http.server`, open `/tests.html` in Playwright, read `window.__result`), and add checks there whenever the money math changes. Live copy: the GitHub Pages site + `/tests.html`.
- This repo is **public**. Never write the passcode, tokens, the deployment id or the web app URL into any file. The passcode lives in Script Properties (`PASSCODE`); the deploy sign-in and deployment id are repository secrets.
- New Sheet columns go at the **end** of a table in `TABLES`; `sheet_()` adds missing headers on its own.
- Remind Eric to tap **Back up** in the app before a change that touches the Sheet's structure.
- Don't ship on a Friday payday or during the pay-period overlap without saying so.
- Plans and history live in the claude.ai project "Comprehensive Budget and Family Planning App" (My Money - project context.md, My Money - roadmap.md).

## One-time setup (already done once connected)
`setup/connect-google.sh`, run in a Codespace, signs in with Apps Script permissions only, downloads the live script into server/ with the passcode line replaced, and prints the two secrets to add.
