import '@doloop/ui/tokens.css';
import '@doloop/ui/styles.css';
import './blocked.css';

const params = new URLSearchParams(window.location.search);
const until = params.get('until');
const site = params.get('site');

const title = document.getElementById('title');
const detail = document.getElementById('detail');

if (until && title) {
  const t = new Date(until);
  if (!Number.isNaN(t.getTime())) {
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      t,
    );
    title.textContent = `You're in a focus block until ${time}`;
  }
}
if (site && detail) detail.textContent = `${site} is blocked during work intervals.`;
