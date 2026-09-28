# Ask the Black Kids

The homepage `/` (also available at `/live/`) is the state-based podcast entrance.

- Outside the confirmed live window: the inactive Zoom form is hidden; **Submit your question to the podcast** is primary. A confirmed future event appears in Eastern time, never a past date.
- During the live window: a session-only relationship question and fresh affirmative 18+/live recording/podcast/social-clips agreement enable **Join Zoom**. Submission stays secondary.
- Questions never leave the page or enter the Zoom URL. Only this tab's `sessionStorage` retains the question; consent is never saved. This is a client-side gate, not identity verification or a stored consent record.

## Confirmed event

`live/event.json` opens Saturday, October 3, 2026 at **8:00 PM Eastern (EDT, UTC−04:00)** and closes at **8:30 PM Eastern**. No early entry. The gate rechecks at click and every second; open tabs automatically close. Failed configuration, invalid URLs and expired events fail closed. No past next-event dates are shown. Future events require explicit confirmation and new configuration. The static Zoom invitation is public, not an access-control mechanism. Zoom's waiting room and recording notices must be managed separately in Zoom.

## Preview and tests

```sh
npm ci
npx playwright install chromium
npm test
npm run preview
```

Open http://127.0.0.1:8768/. Browser tests intercept external requests and never join a real meeting or submit questions. Test screenshots are in ignored `artifacts/`.

## Publishing

GitHub Pages serves `main` at https://asktheblackkids.com/ with the existing `CNAME`. Pushing the production branch publishes. Preserve `CNAME`; verify Pages deployment and actual public HTML, JS, configuration and browser state after every release.

Submission destination: https://onlyblackkids.com/pages/ask-obk
