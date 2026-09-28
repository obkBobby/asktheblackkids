const question = document.querySelector('#question');
const consent = document.querySelector('#consent');
const join = document.querySelector('#join');
const status = document.querySelector('#status');
let event = null;
const questionKey = 'ask-the-black-kids-question';
try { question.value = sessionStorage.getItem(questionKey) || ''; }
catch { /* The question still works when browser storage is unavailable. */ }

function currentZoom() {
  const now = Date.now();
  if (event?.available !== true || !(Date.parse(event.opensAt) <= now && now < Date.parse(event.closesAt))) return '';
  try {
    const url = new URL(event.zoomUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (!(url.hostname === 'zoom.us' || url.hostname.endsWith('.zoom.us'))) return '';
    if (!/^\/j\/\d{9,11}\/?$/.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}

function render() {
  const open = Boolean(currentZoom());
  document.querySelector('#live-form').hidden = !open;
  document.querySelector('#offline').hidden = open;
  const submit = document.querySelector('#submit');
  submit.classList.toggle('primary', !open);
  submit.textContent = open ? 'Submit to the podcast instead' : 'Submit your question to the podcast';
  const next = document.querySelector('#next-event');
  const scheduled = Date.parse(event?.scheduledAt);
  next.hidden = open || event?.available !== true || !(scheduled > Date.now());
  next.textContent = next.hidden ? '' : 'Next live: ' + new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(scheduled);
  join.disabled = !open || !question.value.trim() || !consent.checked;
  const watch = document.querySelector('#watch');
  watch.removeAttribute('href');
  watch.parentElement.hidden = true;
  if (open) {
    try {
      const url = new URL(event.watchUrl);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
          ['youtube.com', 'www.youtube.com', 'youtu.be', 'facebook.com', 'www.facebook.com'].includes(url.hostname)) {
        watch.href = url.href;
        watch.parentElement.hidden = false;
      }
    } catch { /* Unconfirmed or invalid watch links stay hidden. */ }
  }
  status.textContent = !open
    ? 'The waiting room is not open. Check back here when the hosts invite callers.'
    : !question.value.trim()
      ? ''
      : consent.checked
      ? 'You’re ready. Joining the waiting room does not guarantee airtime.'
      : 'Confirm you’re 18+ and agree above to join.';
}

setInterval(render, 1000);
window.addEventListener('pageshow', () => { consent.checked = false; render(); });
consent.addEventListener('change', render);
question.addEventListener('input', () => {
  try {
    if (question.value) sessionStorage.setItem(questionKey, question.value);
    else sessionStorage.removeItem(questionKey);
  } catch { /* Storage restrictions must not block the caller. */ }
  render();
});
join.addEventListener('click', () => {
  const url = currentZoom();
  if (question.value.trim() && consent.checked && url) window.location.assign(url);
  else render();
});
fetch('/live/event.json', { cache: 'no-store' })
  .then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
  .then(config => { event = config; render(); })
  .catch(() => { event = null; render(); });
