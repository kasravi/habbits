# Habit Feed PWA

Personal habit tracker built as a single-feed Progressive Web App.

## What it does

- Single scrolling feed of daily habit cards.
- Time-based phases: Morning, After work, Before bed.
- Completion hides card and shows an encouraging instance reward.
- Habit strength formula: `S(t) = 100 * (1 - e^(-kt))` based on streak length.
- Skipping risk formula: `R(t) = 100 - S(t)`.
- Stage labels:
  - 0–20%: Fragile (Do not skip)
  - 21–70%: Forming (High friction)
  - 71–100%: Automatic
- SRHI scoring support (4 statements, 1–7 each) with automaticity threshold at `>= 5.5`.
- Per-card reporting types:
  - I did it button
  - Mood (1–7)
  - Emotion selection
  - Raw text input
  - Photo journal
  - Selfie + lightweight on-device face-tone heuristic
- Habit management via long press on card.
- IndexedDB persistence with JSON import/export (long press `+` button).
- Optional Google Drive backup sync from the data tools modal (requires a Google OAuth client ID).
- Day resets at 3:00 AM based on the app day-key logic.

## Easier Google Drive backup setup

End users should not need to find a Google OAuth client ID.

If you are deploying the app yourself, configure it once for everyone:

1. Create a Google OAuth Web client in Google Cloud Console.
2. Add the client ID as `VITE_GOOGLE_DRIVE_CLIENT_ID` in your env config.
3. Rebuild and deploy.

After that, users can simply click the Google Drive connect/backup button in the app.

### GitHub Pages deployment

Yes. This also works with GitHub Pages.

This repository's Pages workflow reads `VITE_GOOGLE_DRIVE_CLIENT_ID` from a GitHub repository variable during build: [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml).

Recommended setup:

1. Open your repository on GitHub.
2. Go to Settings → Secrets and variables → Actions.
3. Open the Variables tab.
4. Add a new repository variable named `VITE_GOOGLE_DRIVE_CLIENT_ID`.
5. Paste your Google OAuth Web client ID as the value.
6. Run the Pages workflow again, or push a new commit.

Notes:

- Use a repository variable, not necessarily a secret, because an OAuth client ID is public in browser apps.
- In Google Cloud Console, make sure your GitHub Pages origin and callback-friendly URLs are allowed for that OAuth client.
- Vite injects `VITE_` variables at build time, so changing the variable requires a rebuild/redeploy.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
