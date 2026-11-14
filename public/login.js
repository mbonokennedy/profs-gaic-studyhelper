const $ = (s) => document.querySelector(s);
const form = $('#form'), err = $('#err'), btn = $('#submit');

$('#show').addEventListener('click', () => {
  const pw = $('#password');
  pw.type = pw.type === 'password' ? 'text' : 'password';
  $('#show').textContent = pw.type === 'password' ? 'Show' : 'Hide';
});

fetch('/api/login-hint').then((r) => r.json()).then(({ demo }) => {
  if (!demo) return;
  $('#demo').hidden = false;
  $('#useDemo').addEventListener('click', () => {
    $('#email').value = demo.email;
    $('#password').value = demo.password;
    form.requestSubmit();
  });
}).catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
  const email = $('#email').value.trim(), password = $('#password').value;
  if (!email || !password) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Sign-in failed.');
    location.replace('/');
  } catch (e2) {
    err.textContent = e2.message; err.hidden = false;
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});
