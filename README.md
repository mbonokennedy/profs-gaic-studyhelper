# IO Offline

**A private, on-device AI study companion for learning platforms, built on [Tether QVAC](https://docs.qvac.tether.io/sdk/).**
It tutors, writes quizzes, summarises lessons, listens, speaks and translates with **no internet, no API keys and no learner data leaving the device.**

It was built to work alongside **IO**, the Profspect learning platform, but this repository is **standalone**. It ships its own sample course and a demo LMS page, and embeds in any LMS with one script tag.

| Tutor (RAG, hint-first, tap-to-answer) | Quiz | Summary | Voice in / out | Whole-page translation |
|---|---|---|---|---|
| Qwen3 1.7B + GTE-Large embeddings | Qwen3, JSON-schema output | Qwen3 | Whisper Tiny + Supertonic TTS | **isiZulu, isiXhosa, Afrikaans, Sesotho, Setswana** (TranslatePsy-AfriSLM 2B) + FR/PT/ES/DE (Bergamot) |

All models run through `@qvac/sdk` on the machine that runs the server. Phones and other browsers connect over the local network.

```
iPhone Safari ─┐  Wi-Fi / PC hotspot (HTTPS :8788)
PC browser ────┼──► server.mjs ──► @qvac/sdk ──► local models (~4 GB, cached in ~/.qvac)
Any LMS page ──┘   (embed.js → side panel; lesson text passed with postMessage)
```

---

## Quick start (about 10 minutes, most of it the one-time download)

**Needs:** Windows 10+/macOS/Linux x64 or arm64, **Node.js 22.21+ or 24.9+**, 8 GB RAM (16 GB recommended), ~5 GB free disk. On Windows, use **PowerShell or cmd**: the QVAC worker does not start from Git Bash.

```powershell
git clone <this repo> io-offline
cd io-offline
npm install
npm run setup     # ONE TIME, needs internet: downloads all models (~4 GB)
npm run doctor    # checks Node, RAM, disk, Vulkan, cached models, ports
npm start         # first start indexes the sample course (~10 s)
```

Then open **http://localhost:8787** and sign in. From here on **you can switch the internet off.**

### Whole-page translation (South African languages)

The round translate button (bottom-right, on every page) or the language button in the navbar switches the **whole app**, like IO's translate widget does. That covers the menu, dashboard, tutor answers, quizzes and summaries. "Show original" switches back. The choice is remembered.

- **isiZulu, isiXhosa, Afrikaans, Sesotho and Setswana** run on QVAC's `TRANSLATEPSY_AFRISLM_2B_TRANSLATION_Q4_K_M` (set `AFRI_MODEL=TRANSLATEPSY_AFRISLM_0_8B_TRANSLATION_Q4_K_M` for a faster, smaller model).
- **French, Portuguese, Spanish and German** run on Bergamot.
- Sepedi, Xitsonga, siSwati, Tshivenda and isiNdebele have no offline model in QVAC yet (see `docs/UPSTREAM_NOTES.md`).
- Translations are cached in `data/i18n/<lang>.json`. On start-up the server pre-translates the app's interface into the five SA languages in the background, roughly 3–4 minutes per language and only once. **Start the server ~20 minutes before a demo** (or once the day before) so language switching is instant and the tutor isn't sharing the CPU with the warm-up. `I18N_WARM=0` turns the warm-up off.
- Each tutor answer also has its own **Translate** button, which translates it inline.

### Tutor: tap, don't type

When the tutor asks the learner something, it offers 3 answers to tap: one correct, one common mistake and one partly right, generated on-device as JSON. There is also an "I'm not sure, give me a hint" option. "Give me a practice question" (or the **Quick Question** tile) puts a real multiple-choice question in the chat. The learner taps an option, it's marked instantly with an explanation, and they get "Another question / Explain it step by step / Why was my answer wrong?" follow-ups.

### Sign-in

IO Offline uses the In-Odyssey look, with a sign-in page, a dashboard, a sidebar (AI Tutor · Practice Quiz · Summarise Lesson) and a translator button on every page. Accounts are **stored on the device** with scrypt-hashed passwords and an HttpOnly session cookie. Nothing is sent anywhere.

- **Demo accounts** (fictional people, for demos only):
  - `learner@in-odyssey.demo` / `Odyssey2026!`
  - `teacher@in-odyssey.demo` / `Odyssey2026!`

  The login page offers a one-click "Use the demo learner account" while the demo accounts are active.
- **Real accounts:** set `USERS_FILE=path/to/users.json`, containing `[{"email":"…","name":"…","role":"Learner","grade":10,"password":"…"}]`. The demo accounts and the one-click button then switch off.
- **Inside IO or the demo LMS panel** the learner is already signed in to the host. An embed request whose parent page is an allowed IO origin gets an "IO Learner" session automatically.

- `npm run smoke`: end-to-end test of every feature against the running server (chat, summary, quiz, translate, TTS, STT).
- `npm run sync-io`: re-index course content (IO database if found, plus everything in `content/`).

### Use it on a phone (tested target: iPhone 15)

1. Put the phone on the same network as the PC. For a **true no-internet demo**, turn on **Windows Settings → Network → Mobile hotspot** and join it from the phone.
2. `npm start` prints a **QR code** for `https://<pc-ip>:8788`. Scan it with the Camera app.
3. Safari warns about the certificate (it is a self-signed one generated on your PC). Tap **Show Details → visit this website → Visit Website**. This is needed because Safari only allows the **microphone** on HTTPS.
4. Optional: **Share → Add to Home Screen** for an app-like icon.
5. Windows may ask to allow Node.js through the firewall on first run. Allow it on **private** networks.

If the mic is still refused, the 🎤 dictation key on the iPhone keyboard works too. Read-aloud works either way.

### Add your own course content

Drop Markdown files in `content/<course-name>/` (the first `# Heading` is the lesson title), then `npm run sync-io` or call `POST /api/sync`.

---

## Embed in an LMS

The demo LMS page (**http://localhost:8787/demo-lms**) is a stand-in for any LMS. Its entire integration is:

```html
<script src="http://<pc-ip>:8787/embed.js" defer></script>
<script>
  window.IO_OFFLINE_LESSON = { title: 'Quadratic Equations', text: '…lesson text…', lessonId: '42' };
</script>
```

This adds a floating **IO Offline** button. The side panel receives the current lesson, so "summarise this", "quiz me" and "explain step 2" work on exactly what the learner is reading. The host page must allow the companion origin in its CSP `frame-src`. Set `IO_ORIGIN` so IO Offline allows itself to be framed by that host (default: `http://127.0.0.1:1029 http://localhost:1029`).

### IO (Profspect LMS) integration

The IO-side changes are opt-in and live in the IO codebase, not here. `io-integration/` contains the template partial and a description of the three small edits. With `QVAC_COMPANION_URL=http://127.0.0.1:8787` set in IO's environment, every student page gets the IO Offline button and lesson pages hand their content to it. Leave it unset and IO is unchanged.

`npm run sync-io` can also read course content from an IO SQLite mirror (**read-only**, content tables only, no user data). Set `IO_DB_PATH` to point at it. Without it, only `content/` is used.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AFRI_MODEL` | `TRANSLATEPSY_AFRISLM_2B_TRANSLATION_Q4_K_M` | SA-language translator (0.8B variant is faster) |
| `I18N_WARM` | `1` | `0` disables background pre-translation of the UI |
| `LLM_MODEL` | `QWEN3_1_7B_INST_Q4` | `QWEN3_600M_INST_Q4` is ~3× faster on weak machines (run `npm run setup` once after changing) |
| `PORT` / `HTTPS_PORT` | `8787` / `8788` | Change if something else uses them |
| `IO_ORIGIN` | IO dev server | Space-separated origins allowed to embed IO Offline |
| `IO_DB_PATH` | `../profspect_io_lms_development/instance/profspect.db` | Optional IO content source |

## API

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/health` | model status, tokens/s, LAN URLs |
| GET | `/api/courses`, `/api/lesson?courseId&lessonId` | course list / one lesson |
| POST | `/api/chat` | `{courseId, lessonId?, mode: coach\|explain, messages, lesson?}` → SSE tokens + sources |
| POST | `/api/summary` | `{courseId, lessonId}` or `{title, text}` → SSE |
| POST | `/api/quiz` | same + `count` → `{questions:[{question, options, answerIndex, explanation}]}` |
| POST | `/api/translate` | `{text, lang: fr\|es\|pt\|de}` |
| POST | `/api/tts` | `{text}` → `audio/wav` |
| POST | `/api/transcribe` | 16 kHz mono WAV body → `{text}` |
| POST | `/api/ingest`, `/api/sync` | add a lesson / re-index content |
| POST | `/api/login`, `/api/logout`; GET `/api/me` | offline sign-in (all AI endpoints require a session) |
| POST | `/api/translate-page` | `{texts[], lang}` → `{translations[]}` (cached) |
| POST | `/api/suggest` | `{question}` → `{options[3]}` tappable replies |

## How it works (and the decisions behind it)

- **One Node process uses the SDK directly** (`src/ai.mjs`). There is no separate `qvac serve`. Models load lazily and stay resident, and each model has a single-job queue so a laptop stays responsive.
- **RAG** (`src/rag.mjs`): lessons are chunked (~550 chars), embedded with QVAC `embed()` (GTE-Large) and searched by cosine similarity from a small JSON index. QVAC's built-in `ragIngest` store is marked prototype-only, and keeping our own index lets answers cite the lesson title.
- **Coach mode** follows a hint ladder (concept → method → first step → solution). Small models ignore rules in the system prompt, so it uses one worked example plus a short reminder on the latest turn. In testing, this changed "here's the full solution" into "one hint and one question".
- **Quizzes** use QVAC structured output (`responseFormat: json_schema`). The model writes the *correct answer text* and three distractors, and the server shuffles them and computes `answerIndex`. Small models frequently mislabel indices; this design removes that failure.
- **Voice**: the browser records, decodes and resamples to 16 kHz mono WAV itself (Web Audio). The server needs no ffmpeg.
- **No CDNs**: the UI uses system fonts and inline SVG, so it renders with zero connectivity. A service worker caches the app shell.

## Performance (measured 14 Nov 2026, Intel i5-1145G7, 16 GB, Iris Xe, offline)

| | |
|---|---|
| Qwen3 1.7B generation | 12–14 tokens/s (0.6B: ~37 tokens/s) |
| Coach-mode reply | ~7–8 s |
| 4-question quiz | ~25 s |
| Whisper transcription (short sentence) | ~3 s |
| Bergamot translation (short paragraph) | ~1 s |
| Index 100 lessons | 42 s |
| Cold start (load LLM + embeddings) | ~50 s |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `RPC initialization timed out … worker process may have failed to start` | You're in Git Bash. Use PowerShell or cmd. |
| Requests hit another app | Something else owns the port (we hit a Java service on 8080). Set `PORT`. |
| Phone can't connect | Same network? Firewall prompt allowed for private networks? Try the PC hotspot. |
| Phone mic does nothing | Use the **https** URL on 8788 and accept the certificate. |
| Slow answers | `LLM_MODEL=QWEN3_600M_INST_Q4`, then `npm run setup`. |
| Model missing | `npm run doctor`, then `npm run setup` while online (downloads resume). |

## Project layout

```
server.mjs            HTTP/HTTPS server, API, LAN cert + QR code
src/ai.mjs            QVAC model loading + chat/quiz/summary/STT/TTS/translate
src/rag.mjs           chunking, embeddings index, search
src/io-connector.mjs  read-only IO content reader + content/ loader
src/models.mjs        model catalogue
public/               PWA (index.html, app.js, styles.css), embed.js, demo-lms.html
scripts/              setup (download), doctor, sync-io, smoke, make-icons
content/              sample courses (Markdown)
io-integration/       the opt-in IO template partial + notes
docs/                 pitch deck, demo script, dry-run checklist, upstream notes
examples/chat.cjs     minimal CLI chat against `qvac serve openai`
```

## License

Apache-2.0 (same as QVAC). See [LICENSE](LICENSE). The sample course content in `content/` is original and released under the same license.

The In-Odyssey and Profspect names and logos (`public/brand/`) are trademarks of Profspect and are **not** covered by the Apache license. Replace them if you fork this project.
