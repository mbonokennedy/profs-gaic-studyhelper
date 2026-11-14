# Dry-run checklist

Do this once **with the internet ON** (to catch download or setup problems), then once **with it OFF** (the real demo).

## Internet ON: fresh-clone test, as a stranger would do it
- [ ] Clone into a new folder, then `npm install`. No errors.
- [ ] `npm run setup`. All models show ✔ (resumes if interrupted).
- [ ] `npm run doctor`. "All good." (Ports in use is fine if a server is already running.)
- [ ] `npm start`. Prints the URLs + QR code, then `Ready. N courses available offline.`
- [ ] `npm run smoke` in a second terminal. "All checks passed."
- [ ] Follow only the README to open the app on the phone. Note any step that was unclear and fix the README.

## Internet OFF: the demo
- [ ] Wi-Fi off, hotspot on, phone joined to the hotspot.
- [ ] Restart `npm start` offline. Models load from the cache (no download lines).
- [ ] Start the server **~20 min before** the demo the first time, so the SA-language UI warm-up finishes (`i18n: … UI ready` ×5 in the log).
- [ ] Switch the page to isiZulu and back (instant once warmed).
- [ ] Tutor: ask a problem, tap a suggested answer; tap **Quick Question** and answer it.
- [ ] PC: Tutor (coach + explain), Quiz, Summary, Translate, mic, Listen.
- [ ] Phone: same four tabs, mic (HTTPS link), Listen, Add to Home Screen icon.
- [ ] Demo LMS (`/demo-lms`): the panel opens and the "From IO" banner shows the lesson title.
- [ ] Optional, IO itself: `QVAC_COMPANION_URL=http://127.0.0.1:8787`, `python main.py`, open a lesson as a demo student, open the IO Offline button.
- [ ] Time the full run against `docs/DEMO_SCRIPT.md` (target 3:00).

## Publishing (ask the team before doing these)
- [ ] Create the GitHub repo (public), push, and check the README renders and the LICENSE is detected.
- [ ] Confirm `data/` and `certs/` are not in the repo (they're git-ignored; `data/` may contain IO course content).
- [ ] Upload the demo video and link it at the top of the README.
- [ ] File the upstream issues in `docs/UPSTREAM_NOTES.md` on github.com/tetherto/qvac.
