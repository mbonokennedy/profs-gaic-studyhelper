# IO integration (opt-in)

These are the changes made in the IO LMS codebase so IO pages can open IO Offline. They are **off unless `QVAC_COMPANION_URL` is set** in IO's environment. With it unset, IO's headers and templates are byte-for-byte what they were.

Only the new partial is included here. The other edits are described rather than copied, so this repository contains no IO source.

1. **New template partial** `profspect_web_facing_templates/partials/shared/_io_offline_widget.html` (copy in this folder).
   It renders a floating "IO Offline" button and a side panel iframe. On the lesson page (`lesson_view.html` provides `lesson`, `course` and `content_blocks`), it sends `{type:'io-lesson', title, text, lessonId, courseId}` to the iframe with `postMessage`, targeting the companion's exact origin. No learner data is included.
2. **Include it** in `base/student/layout.html`, directly after the `_translate_widget.html` include.
3. **Context processor** in `main.py` (`inject_qvac_companion`) exposes `qvac_companion_url` and `qvac_companion_origin` to templates.
4. **Security policy** in `profspect_security.py`:
   - A new `companion_url_origin()` accepts only a clean `http(s)://host[:port]`.
   - When it returns an origin, that one origin is appended to CSP `frame-src`, and allowed `microphone` in the Feature-Policy and Permissions-Policy.
   - Everything else, including `frame-ancestors 'none'`, is unchanged.

**Enable for a local demo** (IO on :1029, IO Offline on the same PC):

```powershell
$env:QVAC_COMPANION_URL = "http://127.0.0.1:8787"   # plain HTTP is fine on localhost (counts as a secure context)
python main.py
```

**Production** also needs nginx's `X-Frame-Options`/`Permissions-Policy` lines reviewed (`nginx/nginx.conf`), and IO Offline must be served over HTTPS at a stable hostname.

**Verification done:** IO's pytest suite gives identical results with the variable unset and set (103 passed; the same 428 pre-existing fixture errors in both runs, which also occur on the unmodified code).
