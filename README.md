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
- Habit management via long press on card.
- IndexedDB persistence with JSON import/export (long press `+` button).
- Day resets at 3:00 AM based on the app day-key logic.

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
