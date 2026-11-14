/* IO Offline embed: add the on-device AI study companion to ANY LMS page.
 *
 *   <script src="http://<pc>:8787/embed.js" defer></script>
 *   <script>window.IO_OFFLINE_LESSON = { title: 'Quadratic Equations', text: '…lesson text…', lessonId: '42' };</script>
 *
 * Adds a floating button that opens IO Offline in a side panel. The lesson text is
 * passed to the companion with postMessage (exact target origin). No learner data
 * is sent. Remember to allow this origin in the host page's CSP frame-src.
 */
(function () {
  var script = document.currentScript;
  var ORIGIN = new URL(script.src).origin;
  var css =
    '#iox-btn{position:fixed;bottom:22px;right:22px;z-index:2147483000;width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;' +
    'background:linear-gradient(135deg,#0E5C50,#0A3828);box-shadow:0 6px 20px rgba(10,56,40,.35);display:flex;align-items:center;justify-content:center;transition:transform .15s}' +
    '#iox-btn:hover{transform:scale(1.06)}#iox-btn .tag{position:absolute;top:-5px;right:-8px;background:#d4af37;color:#0A3828;font:800 9px/1 system-ui,sans-serif;border-radius:6px;padding:3px 4px}' +
    '#iox-panel{position:fixed;top:0;right:0;height:100%;width:min(420px,100vw);z-index:2147483001;background:#0A3828;box-shadow:-8px 0 32px rgba(0,0,0,.25);' +
    'transform:translateX(105%);transition:transform .22s ease;display:flex;flex-direction:column}' +
    '#iox-panel.open{transform:none}#iox-head{display:flex;align-items:center;gap:8px;padding:8px 12px;color:#fff;font:13px system-ui,sans-serif}' +
    '#iox-head span{opacity:.7}#iox-x{margin-left:auto;background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}' +
    '#iox-frame{flex:1;border:0;width:100%;background:#f4f6f5}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.id = 'iox-btn';
  btn.type = 'button';
  btn.title = 'IO Offline: private on-device AI tutor';
  btn.setAttribute('aria-label', 'Open IO Offline');
  btn.innerHTML =
    '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="#fff" stroke-width="3"/><circle cx="16" cy="16" r="4.5" fill="#d4af37"/></svg><span class="tag">OFFLINE</span>';
  var panel = document.createElement('div');
  panel.id = 'iox-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'IO Offline');
  panel.innerHTML =
    '<div id="iox-head"><strong>IO Offline</strong><span>· on-device, nothing sent to the cloud</span><button id="iox-x" type="button" aria-label="Close">&times;</button></div>' +
    '<iframe id="iox-frame" title="IO Offline" allow="microphone; autoplay"></iframe>';
  document.body.appendChild(btn);
  document.body.appendChild(panel);
  var frame = panel.querySelector('iframe');

  function lesson() {
    var l = window.IO_OFFLINE_LESSON;
    return l && l.text ? { type: 'io-lesson', title: l.title, text: l.text, lessonId: l.lessonId, courseId: l.courseId } : null;
  }
  function send() {
    var l = lesson();
    if (l && frame.contentWindow) frame.contentWindow.postMessage(l, ORIGIN);
  }
  function toggle(force) {
    var open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
    if (open && !frame.src) frame.src = ORIGIN + '/?embed=1' + (script.dataset.course ? '&course=' + encodeURIComponent(script.dataset.course) : '');
    panel.classList.toggle('open', open);
  }
  btn.addEventListener('click', function () { toggle(); });
  panel.querySelector('#iox-x').addEventListener('click', function () { toggle(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') toggle(false); });
  frame.addEventListener('load', send);
  window.addEventListener('message', function (e) {
    if (e.origin === ORIGIN && e.data && e.data.type === 'io-offline-ready') send();
  });
  window.IOOffline = { open: function () { toggle(true); }, close: function () { toggle(false); }, refreshLesson: send };
})();
