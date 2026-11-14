# Demo script (3 minutes) and video shot list

**Setup, before you present (5 min):** `npm start` in PowerShell, and wait for `Ready.`. Turn on the Windows Mobile Hotspot and join it from the iPhone. Open the QR link once and accept the certificate. Open http://localhost:8787/demo-lms on the PC. **Turn Wi-Fi off** (keep the hotspot on).

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00 | PC, taskbar | Show Wi-Fi is off | "No internet. Everything you'll see runs on this laptop." |
| 0:05 | PC, login | Click **Use the demo learner account** → Dashboard | "Same In-Odyssey look. Accounts live on the device. The dashboard says it: 0 bytes to the cloud." |
| 0:10 | PC, demo LMS | Show the Quadratic Equations lesson, click the **IO Offline** button | "This is any LMS. One script tag adds IO Offline, and it receives the lesson I'm reading." |
| 0:25 | PC, panel | Ask: *Solve x² − 5x + 6 = 0 for me* | "Coach mode. It gives a hint, not the answer, like a good tutor." |
| 0:45 | PC, panel | **Tap** a suggested answer (no typing) | "Learners tap answers; it moves one rung up the hint ladder." |
| 1:05 | PC, full app | Sidebar → **Practice Quiz**, Generate, answer one question wrong | "Quizzes come from the lesson, marked instantly, with explanations." |
| 1:35 | iPhone | Show the status pill "On-device" | "Same app on my iPhone, over the laptop's own hotspot." |
| 1:45 | iPhone | Tap 🎤, ask *What is the discriminant?*, then tap **Listen** | "Speech in, speech out, on the device." |
| 2:15 | iPhone | Tap the translate button → **isiZulu**; the whole app switches | "The whole app in isiZulu, offline. Also isiXhosa, Afrikaans, Sesotho, Setswana." |
| 2:40 | PC | Point at a source chip under an answer | "Answers cite the lesson they came from. No API keys, no cloud, no learner data leaves the room." |
| 2:55 | | | "IO Offline, built on QVAC." |

**Video tips:** record the PC with Xbox Game Bar (Win+G) and the phone with iOS Screen Recording, then cut them side by side. Keep the terminal with the QR code visible for a second; it shows that nothing is hosted.

**If something stalls:** the first answer after start can take ~10 s while the model warms up, so ask one warm-up question before recording. If the phone can't connect, check the hotspot and the firewall prompt.
