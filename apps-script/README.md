# Results collector setup

One-time setup, about five minutes. Nothing here needs a paid account.

## 1. Create the spreadsheet

Make a new Google Sheet — <https://sheets.new>. Name it something like
`elicitation-pilot-responses`. You do not need to add headers; the script
creates a `responses` tab and writes its own header row.

## 2. Add the script

In that sheet: **Extensions → Apps Script**. Delete the placeholder
`myFunction`, paste the whole contents of `Code.gs`, and save.

## 3. Deploy it as a Web App

**Deploy → New deployment → ⚙ → Web app**, then:

| Field | Value |
| --- | --- |
| Description | `elicitation collector` |
| Execute as | **Me** |
| Who has access | **Anyone** |

"Anyone" is required — survey participants are not signed in to your Google
account. "Execute as Me" is what lets an anonymous request write to *your*
sheet. Google will ask you to authorise the script; the "unverified app"
warning is expected for your own scripts (**Advanced → Go to … (unsafe)**).

Copy the **Web app URL** it gives you. It ends in `/exec`.

## 4. Point the survey at it

Paste that URL into `resultsEndpoint` in `config.js`:

```js
window.ELICITATION_CONFIG = {
  resultsEndpoint: "https://script.google.com/macros/s/AKfy…/exec",
  surveyVersion: "2026-09-08-pilot",
};
```

## 5. Check it works

Open the `/exec` URL directly in a browser. You should see:

```json
{"ok":true,"service":"elicitation-demo collector"}
```

Then run the survey end to end and confirm a row lands in the sheet.

## Redeploying after a script change

Editing `Code.gs` does **not** update the live Web App. You must go
**Deploy → Manage deployments → ✏ → Version: New version → Deploy**. The URL
stays the same. This trips up almost everyone at least once.

## What this is and is not

Good enough for a pilot: free, no server, no API key in the client, and the
data is immediately readable and shareable.

Worth knowing before it becomes real infrastructure:

- **The endpoint is unauthenticated.** Anyone with the URL can append rows.
  Fine for a small pilot; not fine once results matter. Add a shared secret,
  or move to a real backend.
- **Do not collect personal data through it** without checking how your
  institution wants participant data handled. There is currently no consent
  step in the survey.
- Apps Script has daily quotas, and Sheets slows past a few thousand rows.
  Neither will bite during piloting.

The natural upgrade is Supabase (free tier, real Postgres, insert-only
row-level security) — the client-side change is confined to `postResponse`.
