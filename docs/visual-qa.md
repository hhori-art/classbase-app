# Local visual QA

Screenshots logged-in screens for every role at 375px (mobile emulation) and 1280px and
automatically flags layout breakage. It only ever talks to the **local Firebase emulators**
(project `demo-classbase-security`) and the local dev server on `127.0.0.1:3100`.

## Run

```bash
# 1. Emulators (auth/firestore/storage). First time only: npm run security:setup
npm run security:start

# 2. QA app (next dev on 127.0.0.1:3100). Wraps `npm run security:app` and blanks every key
#    found in .env* files so no production credential (Firebase admin key, OpenAI, Zoom, LINE…)
#    is loaded; the admin SDK runs in emulator mode.
npm run qa:visual:app

# 3. Accounts + UI data (idempotent; both refuse to run unless the emulator hosts/project are the demo ones)
npm run security:accounts
npm run qa:visual:seed

# 4. Capture + check all pages
npm run qa:visual
```

`npm run qa:visual -- --start --seed` does everything in one go: starts the emulators and the QA app
when they are not running, runs `security:accounts` + `qa:visual:seed`, captures, and stops what it
started. Stopping sends SIGINT, so the emulators export their data to `.security-emulator-data`
(the same `--export-on-exit` behaviour as `npm run security:start`). Other options: `--role student|parent|teacher|teacher-dedicated|master`,
`--only /student/homework` (exact path), `--width 375`, `--headful`.

Output goes to `.visual-qa/<run>/` (git ignored):

- `<role>/<page>-<width>.png` — full-page screenshots (pages with an inner scroll container are
  captured by growing the viewport to the content height)
- `report.md` / `report.json` — issues per page with selector, text snippet and screenshot path

## Checks

| kind | severity | meaning |
|---|---|---|
| `horizontal-overflow` | error | page scrolls sideways; elements inside `overflow-x: auto/scroll` containers are allowed |
| `crushed-text` | error | text wrapped to ~1–2 characters per line in a box narrower than 2.5em (e.g. 「有／効」 pills), or > 2.2 line-heights tall while < 2.5em wide |
| `overlapping-controls` | error | two visible buttons/links/inputs overlap by > 20% of the smaller one |
| `text-overlaps-control` | warn | a text box (status pill, label) intrudes > 20% into a control it is not part of |
| `clipped-text` | warn | `overflow: hidden` clips text without an ellipsis |
| `console-error` / `exception` | error | browser console errors / uncaught exceptions |
| `http-5xx` / `network-failed` | error | failed requests |
| `http-4xx` | warn | 4xx responses (401 on logout is ignored) |
| `redirected` / `not-settled` | error / warn | page bounced elsewhere / loading skeletons still visible after 45s |

## Notes

- The QA browser enables `Page.setBypassCSP`: the production CSP (`next.config.mjs`) does not list
  the emulator hosts in `connect-src`, so a normal browser cannot sign in against the emulators.
  The app's headers are not changed.
- The Next.js dev indicator is hidden before screenshots.
- Uses the installed Chrome via the DevTools Protocol (Node's global `WebSocket`); no Puppeteer or
  Playwright. Set `CHROME_PATH` to use another Chrome binary.
