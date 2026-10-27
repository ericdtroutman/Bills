# Bills (My Money app)

Eric's family budget app. The page (index.html) is served by GitHub Pages from main. The data lives in a Google Sheet behind an Apps Script web app (server/), and bank data comes in through SimpleFIN.

## How changes ship (Eric does nothing by hand)
- **Page:** edit index.html, commit, push to main. GitHub Pages republishes it in about a minute.
- **Script:** edit server/Code.gs (or other files in server/), commit, push to main. `.github/workflows/deploy-script.yml` runs `clasp push --force` and `clasp redeploy $DEPLOYMENT_ID`, so the web app link never changes. Check the run in the Actions tab.
- Commit straight to main with a plain-language message. Eric doesn't review PRs.

## Rules
- **tests.html must pass before any change to the money math ships.** It loads index.html in a hidden frame with saving switched off and replays the Pay Period Plan walkthrough. Run it headless before pushing (serve the repo with `python3 -m http.server`, open `/tests.html` in Playwright, read `window.__result`), and add checks there whenever the money math changes. Live copy: the GitHub Pages site + `/tests.html`.
- This repo is **public**. Never write the passcode, tokens, the deployment id or the web app URL into any file. The passcode lives in Script Properties (`PASSCODE`); the deploy sign-in and deployment id are repository secrets.
- New Sheet columns go at the **end** of a table in `TABLES`; `sheet_()` adds missing headers on its own.
- Remind Eric to tap **Back up** in the app before a change that touches the Sheet's structure.
- Don't ship on a Friday payday or during the pay-period overlap without saying so.
- Plans and history live in the claude.ai project "Comprehensive Budget and Family Planning App" (My Money - project context.md, My Money - roadmap.md).

## One-time setup (already done once connected)
`setup/connect-google.sh`, run in a Codespace, signs in with Apps Script permissions only, downloads the live script into server/ with the passcode line replaced, and prints the two secrets to add.
