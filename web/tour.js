// First-visit guided tour with two paths (researcher, investor) that walks across the real pages.
// No dependencies. Tour position travels in the URL (?tour=<path>&ts=<step>) so it survives page changes
// even when browser storage is blocked; localStorage only remembers that the welcome was seen.

const RESEARCHER_STRATEGY = './strategy.html?a=researcher-1.top-notch.near&id=dip-in-uptrend';
const INVESTOR_STRATEGY = './strategy.html?a=researcher-1.top-notch.near&id=eco-reversal';

const PATHS = {
  researcher: {
    label: 'Researcher path',
    done: { text: 'Open the Lab', href: './lab.html' },
    steps: [
      { page: './', sel: '#i-strategies', title: 'Strategies researchers have published', body: 'Each row is a trading strategy with its backtest numbers and an independent auditor\'s opinion, read live from NEAR mainnet. Yours can be here. Let\'s build one.' },
      { page: './lab.html', sel: '#how', title: 'The Lab: test an idea in seconds', body: 'No code and no wallet. You write one formula, and the Lab replays it on six months of real NEAR Intents prices, with swap costs, right in your browser.' },
      { page: './lab.html', sel: '#templates', title: 'Start from a starter idea', body: 'Each card is a classic idea, like "follow the trend" or "buy the dip", already written as a formula. Click one to load and run it. You can change it afterwards.' },
      { page: './lab.html', sel: '#editor', title: 'Your formula and settings', body: 'Every day the formula gives each token a score; the portfolio buys the top scorers and keeps the rest in USDC. If you make a typo, the Lab tells you what is wrong in plain words and can fix it for you.' },
      { page: './lab.html', sel: '#tiles', title: 'Read the results', body: 'Each number has a one-line meaning and a Good, Okay or Weak mark. Start with "Unseen-data Sharpe": it tests the last 30% of days, the best guard against an idea that only fits the past.' },
      { page: './lab.html', sel: '#gates', title: 'The listing bar', body: 'Five gates a strategy must clear before investors can see it. A failed gate comes with a tip on how to fix it.' },
      { page: './lab.html', sel: '#pub', title: 'Publish, public or hidden', body: 'Public puts the formula on-chain. Hidden puts only a fingerprint (hash) of it on-chain, so nobody can copy it. You earn a fee on every swap an investor\'s agent makes on your signal.' },
      { page: RESEARCHER_STRATEGY, sel: '#s-audit', title: 'What investors see: the audit', body: 'This published strategy keeps its logic hidden. The auditor received the formula privately, proved it matches the on-chain hash, and reproduced every signal. That opinion is what makes a hidden strategy worth trusting.' },
    ],
  },
  investor: {
    label: 'Investor path',
    done: { text: 'See my agent', href: './vault.html' },
    steps: [
      { page: './', sel: '#i-strategies', title: 'Pick a strategy by its numbers', body: 'Compare Sharpe (return per unit of risk; above 1 is good), Max DD (the worst fall) and the Auditor column. Every number here is read live from NEAR mainnet.' },
      { page: INVESTOR_STRATEGY, sel: '#s-backtest', title: 'How it did against holding NEAR', body: 'The green line is the strategy, the grey line is just holding NEAR. Right of the dashed line is data the strategy was not tuned on, the honest test. The ticks show which listing gates it passed.' },
      { page: INVESTOR_STRATEGY, sel: '#s-audit', title: 'The auditor checked it', body: 'An independent check, published on-chain: the stats reproduce and no signal was backdated. NEAR AI Cloud writes and signs the letter inside a secure enclave, but code decides the opinion.' },
      { page: INVESTOR_STRATEGY, sel: '#s-signals', title: 'Daily signals, on-chain', body: 'Every day the researcher publishes target weights to NEAR. They are timestamped, so a track record can\'t be faked after the fact.' },
      { page: './vault.html', sel: '#v-summary', title: 'Your vault', body: 'Your money sits in your own NEAR account. Our managed agent trades it toward the strategy you picked, through NEAR Intents. This is a real vault on mainnet.' },
      { page: './vault.html', sel: '#v-who', title: 'The agent can trade, never withdraw', body: 'Read live from the chain: only your key has full access. The agent can call one thing, swap, within your caps and daily limit.' },
      { page: './vault.html', sel: '#v-note', title: 'A daily note from your agent', body: 'Every day NEAR AI Cloud writes a plain-English note on what the agent did and why, signed so you can check it wasn\'t edited.', optional: true },
      { page: './vault.html', sel: '#v-controls', title: 'You stay in control', body: 'Pause the agent or withdraw at any time with your own key. No platform permission needed.' },
      { page: './audit.html?agent=alpha-bot-demo.near', sel: '#a-trades', title: 'Every trade, audited', body: 'Each swap the agent made is tickmarked: signal in force, trades toward the signal, through your vault, researcher paid. Press Audit at the top to recompute it in your browser from chain data.' },
    ],
  },
};

const SEEN = 'tn_tour_seen_v1';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// page identity: file name + the query keys that matter (strategy id)
function pageKey(href) {
  const u = new URL(href, location.href);
  const file = u.pathname.split('/').pop() || 'index.html';
  const id = file === 'strategy.html' ? (u.searchParams.get('id') || 'dip-in-uptrend') : '';
  return `${file}|${id}`;
}
function withTour(href, path, i) {
  const u = new URL(href, location.href);
  u.searchParams.set('tour', path); u.searchParams.set('ts', String(i));
  return u.toString();
}
function cleanUrl() {
  const u = new URL(location.href);
  if (!u.searchParams.has('tour')) return;
  u.searchParams.delete('tour'); u.searchParams.delete('ts');
  history.replaceState(null, '', u.toString());
}

let ui = null, cur = null, ro = null;
function teardown() { ro?.disconnect(); ro = null; if (ui) { ui.spot.remove(); ui.pop.remove(); ui.shade.remove(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('keydown', onKey); ui = null; } }
function end() { teardown(); cur = null; cleanUrl(); store.set(SEEN, '1'); }

function waitFor(sel, ms = 9000) {
  return new Promise((res) => {
    const t0 = Date.now();
    (function poll() {
      const el = document.querySelector(sel);
      if (el && !el.hidden && el.getBoundingClientRect().height > 0) return res(el);
      if (Date.now() - t0 > ms) return res(null);
      setTimeout(poll, 150);
    })();
  });
}

function place() {
  if (!ui || !cur) return;
  const { spot, pop } = ui, el = cur.el;
  pop.classList.remove('fixed', 'center');
  pop.style.transform = '';
  if (!el) { spot.style.display = 'none'; pop.classList.add('center'); return; }
  const r = el.getBoundingClientRect(), pad = 6;
  spot.style.display = 'block';
  Object.assign(spot.style, { top: `${r.top + scrollY - pad}px`, left: `${r.left + scrollX - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  const ph = pop.offsetHeight, pw = pop.offsetWidth, vh = innerHeight, vw = document.documentElement.clientWidth;
  const narrow = vw < 640;
  const below = vh - r.bottom, above = r.top;
  let top;
  if (!narrow && below >= ph + 20) top = r.bottom + 14;
  else if (!narrow && above >= ph + 20) top = r.top - ph - 14;
  else { pop.classList.add('fixed'); return; }
  const left = Math.min(Math.max(16, r.left), vw - pw - 16);
  pop.style.top = `${top + scrollY}px`; pop.style.left = `${left + scrollX}px`;
}

function onKey(e) {
  if (e.key === 'Escape') end();
  else if (e.key === 'ArrowRight') go(cur.i + 1);
  else if (e.key === 'ArrowLeft' && cur.i > 0) go(cur.i - 1);
}

async function show(path, i, dir = 1) {
  const P = PATHS[path]; const step = P.steps[i];
  if (!step) return end();
  if (pageKey(step.page) !== pageKey(location.href)) { location.href = withTour(step.page, path, i); return; }
  teardown();
  history.replaceState(null, '', withTour(location.href, path, i));
  const el = await waitFor(step.sel);
  if (!el && step.optional) return show(path, i + dir, dir);
  cur = { path, i, el };
  const shade = document.createElement('div'); shade.className = 'tn-shade';
  const spot = document.createElement('div'); spot.className = 'tn-spot';
  const pop = document.createElement('div'); pop.className = 'tn-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', step.title);
  const last = i === P.steps.length - 1;
  pop.innerHTML = `<button class="tn-x" aria-label="Close tour" type="button">×</button><div class="tn-path">${esc(P.label)}</div><h3>${esc(step.title)}</h3><p>${esc(step.body)}</p>
    <div class="tn-row"><span class="tn-n">${i + 1} of ${P.steps.length}</span>${i > 0 ? '<button class="ghost tn-back" type="button">Back</button>' : ''}${last ? `<button class="ghost tn-other" type="button">${path === 'researcher' ? 'Investor path' : 'Researcher path'}</button><button class="tn-done" type="button">${esc(P.done.text)}</button>` : '<button class="tn-next" type="button">Next</button>'}</div>`;
  document.body.append(shade, spot, pop);
  ui = { shade, spot, pop };
  shade.onclick = () => {}; // block clicks on the page behind, without ending the tour
  pop.querySelector('.tn-x').onclick = end;
  pop.querySelector('.tn-back')?.addEventListener('click', () => go(i - 1));
  pop.querySelector('.tn-next')?.addEventListener('click', () => go(i + 1));
  pop.querySelector('.tn-other')?.addEventListener('click', () => start(path === 'researcher' ? 'investor' : 'researcher'));
  pop.querySelector('.tn-done')?.addEventListener('click', () => { end(); if (pageKey(P.done.href) !== pageKey(location.href)) location.href = P.done.href; });
  if (el) {
    const tall = el.getBoundingClientRect().height > innerHeight * 0.6 || document.documentElement.clientWidth < 640;
    el.scrollIntoView({ behavior: 'instant', block: tall ? 'start' : 'center' });
    if (tall) scrollBy(0, -16);
    // pages fill in from the chain after load: follow the target as it grows
    if ('ResizeObserver' in window) { ro = new ResizeObserver(() => place()); ro.observe(el); ro.observe(document.body); }
  }
  place();
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  document.addEventListener('keydown', onKey);
  (pop.querySelector('.tn-next') || pop.querySelector('.tn-done')).focus({ preventScroll: true });
}
function go(i, path = cur?.path) {
  if (!path || i < 0) return;
  show(path, i, i < (cur?.i ?? 0) ? -1 : 1);
}
function start(path) { store.set(SEEN, '1'); closeWelcome(); show(path, 0); }

let modal = null;
function closeWelcome() { modal?.remove(); modal = null; }
function welcome() {
  closeWelcome();
  modal = document.createElement('div'); modal.className = 'tn-modal';
  modal.innerHTML = `<div class="tn-card" role="dialog" aria-modal="true" aria-labelledby="tn-h"><button class="tn-x" aria-label="Close" type="button">×</button>
    <h2 id="tn-h">Welcome to Top Notch ✓</h2>
    <p>A marketplace for trading strategies on NEAR. Researchers publish strategies with honest, audited backtests. Investors run an agent on one from their own vault. Which are you? We'll show you around in about a minute.</p>
    <div class="tn-choices">
      <button class="tn-choice" data-p="researcher" type="button"><i>🧪</i><b>I'm a researcher</b><span>I have a trading idea. Show me how to test it and earn from it.</span></button>
      <button class="tn-choice" data-p="investor" type="button"><i>💼</i><b>I'm an investor</b><span>I want a strategy I can trust, run from my own wallet.</span></button>
    </div>
    <button class="tn-skip" type="button">Skip, I'll explore on my own (the Guide link in the menu brings this back)</button></div>`;
  document.body.append(modal);
  modal.querySelectorAll('.tn-choice').forEach((b) => (b.onclick = () => start(b.dataset.p)));
  const skip = () => { store.set(SEEN, '1'); closeWelcome(); };
  modal.querySelector('.tn-skip').onclick = skip;
  modal.querySelector('.tn-x').onclick = skip;
  modal.addEventListener('click', (e) => { if (e.target === modal) skip(); });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') skip(); });
  modal.querySelector('.tn-choice').focus();
}

function init() {
  const nav = document.querySelector('nav.top');
  if (nav && !nav.querySelector('.tour-btn')) {
    const a = document.createElement('a'); a.href = '#guide'; a.className = 'tour-btn'; a.textContent = 'Guide';
    a.onclick = (e) => { e.preventDefault(); end(); welcome(); };
    nav.append(a);
  }
  const q = new URLSearchParams(location.search);
  const path = q.get('tour'), i = Number(q.get('ts') || 0);
  if (path && PATHS[path]) return show(path, Math.max(0, Math.min(i, PATHS[path].steps.length - 1)));
  if (q.has('notour')) return;
  if (location.hash === '#guide' || !store.get(SEEN)) welcome();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

export { PATHS, start, welcome };
