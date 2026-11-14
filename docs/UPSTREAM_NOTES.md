# Upstream notes for QVAC (drafts for issues and PRs)

Things we hit while building IO Offline on `@qvac/sdk@0.23.0` (Windows 11, Node 26.13, Intel Iris Xe). Each is written so it can be pasted into an issue on github.com/tetherto/qvac. **Not filed yet.**

### 1. Worker fails to start from Git Bash on Windows
**What happens:** any SDK call (e.g. `downloadAsset`, `loadModel`) run from Git Bash (MSYS) fails after 30 s with `RPC initialization timed out after 30000ms — the worker process may have failed to start`. The same script works from PowerShell or cmd.
**Ask:** document it in the Windows requirements, and/or surface the worker's stderr in the error so the cause is visible.

### 2. Docs disagree on the `qvac serve openai` default port
The CLI quickstart says `127.0.0.1:11435`, while the HTTP-server connection page uses `http://localhost:11434/v1`. 11434 is also Ollama's default, so people running both will collide.
**Ask:** one value everywhere; mention the conflict with Ollama.

### 3. Docs disagree on the minimum Node version
The JS SDK page says `>= v22.17`; the system-requirements page says `^22.21.0 || >=24.9.0`.
**Ask:** align them (the requirements page appears correct).

### 4. Quiz-style structured output: small models mislabel answer indices
With `responseFormat: json_schema` and a schema containing `options[]` and `answerIndex`, Qwen3 1.7B produced valid JSON whose `answerIndex` pointed to the wrong option in 2 of 3 questions, even though its explanation named the right answer. Asking instead for `correct` + `distractors[]` and computing the index in code fixed it.
**Ask (docs PR):** add this pattern to the structured-output guide as a tip for small models.

### 5. Remaining South African languages
`TRANSLATEPSY_AFRISLM_*` covers Afrikaans, isiZulu, isiXhosa, Sesotho and Setswana, and works very well for us. South Africa has 11 official languages; **Sepedi (nso), Xitsonga (ts), siSwati (ss), Tshivenda (ve) and isiNdebele (nr)** have no offline model. `AFRICAN_LANGUAGES_MAP` has no entry for them either.
**Ask:** a roadmap for these five, and batch input for LLM translators (one `translate()` call per string makes whole-page translation slow on first use). We'd help test.

### 6. Model cache layout for multi-file models
Single-file models land in `~/.qvac/models/<hash>_<file>`, while Bergamot sets land in `~/.qvac/models/sets/<hash>/`. That's fine, but it's undocumented. Tools like our `doctor` script need to know it to check whether a model is cached.
**Ask:** a public `isCached({ assetSrc })` helper, or a note in the download-lifecycle docs.
