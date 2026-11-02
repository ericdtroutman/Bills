# Bills (My Money app)

Eric's family budget app. The page (index.html) is served by GitHub Pages from main. The data lives in a Google Sheet behind an Apps Script web app (server/), and bank data comes in through SimpleFIN.

## How changes ship (Eric does nothing by hand)
- **Page:** edit index.html, commit, push to main. GitHub Pages republishes it in about a minute.
- **Script:** edit server/Code.js (or other files in server/), commit, push to main. `.github/workflows/deploy-script.yml` runs `clasp push --force` and `clasp redeploy`, so the web app link never changes. The `DEPLOYMENT_ID` secret holds the whole web app link; the workflow takes the id out of it, and the run fails if the web app's version didn't move. Its notice shows the deployments and versions: read it with `gh run list --repo ericdtroutman/bills --workflow deploy-script.yml --limit 1`, then `gh api repos/ericdtroutman/bills/check-runs/<job id>/annotations` (job id from `gh run view <run id> --json jobs`). Logs themselves can't be read from the workspace.
- **Checking the live script:** `.github/workflows/check-script.yml` (runs when its file changes, or by hand) reports, read-only, what code Google has, the versions and deployments, and whether the PASSCODE script property is set (via a temporary deployment it removes again).
- Until Oct 28, 2026 the web app was stuck on version 12 (the redeploy was given the full link). Fixed; the daily sync trigger runs the current code too (confirmed by the Oct 29 6:18 AM sync: passcodeReady = yes, JointBank refreshed).
- Commit straight to main with a plain-language message. Eric doesn't review PRs.

## No preview step (Eric, Oct 28, 2026)
- **Build straight into index.html and ship.** Eric asked to skip the preview to save usage; the beta/ copy and its code were removed Nov 1, 2026.
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
- **Setup runs only when it has to** (Oct 31, 2026): tab/header/trigger checks run when `TABLES` or `SYNC_SCHEDULE` change (a stamp in Script Properties, `SETUP_STAMP`) and once a day with the bank sync. If you change setup in any other way (a new trigger, new first-run data), bump `SETUP_REV` in Code.js.
- **Saving reads each tab once per request** and then writes row by row (`tab_()`); anything that writes a tab another way (`appendRows_`, `rewriteTable_`, `deleteRows`) must `delete TAB_[name]`. Appends make room first (`room_()`): a tab starts with 1,000 rows and writing past the last row fails.
- **Returns** (Oct 31, 2026): Charges `ret` = the date a charge was marked Returning (+ `|no=<refund ids>` Eric said aren't its refund). A returning charge stays on its card but counts nowhere (`counts()` in index.html; moneyMath skips it; clearing a card leaves it). `refundsFor()` / `settleReturn()` match the refund; both go to History. Tests: the Returns scenario in tests.html.
- **Card payments** (Nov 1, 2026): a payment on a card's own bank feed is never a charge (pending ones too). The sync keeps the newest per card in the `cardPays` setting (`{cardId: {date, amount}}`); the Cards page asks "Mark it paid?" (`payWaiting()`). It never ticks Paid on its own (Eric's rule). `cardPaySeen` = the day Eric last marked/unmarked/cleared the card or said "Not this one"; payments on or before that day aren't asked about. Only cards linked in Bank Sync (not Apple).
- **Paycheck calendar** (Nov 1, 2026): paydays and extra-check picks live in the `paydays` and `extraPicked` settings (comma-separated dates), edited from My Money > Paycheck calendar. `PAYDAYS` / `EXTRA_PICKED` in index.html are only the defaults; `PAY_ANCHOR` (Oct 23 check pays the Nov 1 bills) is always the first check.
- Remind Eric to tap **Back up** in the app before a change that touches the Sheet's structure.
- Don't ship on a Friday payday or during the pay-period overlap without saying so.
- Plans and history live in the claude.ai project "Comprehensive Budget and Family Planning App" (one doc: "My Money - notes.md").

## One-time setup (already done once connected)
`setup/connect-google.sh`, run in a Codespace, signs in with Apps Script permissions only, downloads the live script into server/ with the passcode line replaced, and prints the two secrets to add.
