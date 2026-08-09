# Agency Admin (UI/UX mock)

A clickable front-end mock of the "Agency Admin" dashboard from the 10-prompt rebuild pack:
all 11 tabs, Apple liquid-glass design, dark mode default with a light-mode toggle.

**This is UI only.** There is no database, no login, no real AI and no integrations.
Everything runs on sample data held in memory: you can click around, add clients, mark
payments paid, chat, generate fake thumbnails, and it all behaves, but a page refresh
resets the data. The "AI" replies and generated images are canned so the flows can be felt.

## How to open it

Double-click `index.html`. That is it, no install, no server.

Or serve the folder if you prefer a URL:

```bash
python3 -m http.server 4620 --directory /Users/hugo/Whats/Poppy/agency-admin
```

then open http://localhost:4620

## What is in here

| File | What it is |
|---|---|
| `index.html` | the shell |
| `styles.css` | the whole design system (glass cards, pills, charts, chat, calendar) |
| `data.js` | the sample data: 6 clients, payments, team, analytics, threads, leads |
| `app.js` | router, sidebar, icons, modals, toasts, charts, shared components |
| `pages/*.js` | one file per sidebar tab (11 of them) |
| `e2e/app.spec.mjs` | Playwright tests (10, all passing) |

Run the tests:

```bash
npx playwright test -c agency-admin/playwright.config.mjs
```

Nothing in this folder touches the Elsie app, its build, or its test suite.
