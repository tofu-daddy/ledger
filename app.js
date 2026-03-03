// ═══════════════════════════════════════════════════════════════════════
// LEDGER — app.js
// ═══════════════════════════════════════════════════════════════════════

// ── CONSTANTS ──────────────────────────────────────────────────────────
const MONTHS      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FULL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DEFAULT_USER = 'toni';
const DONUT_COLORS = ['#33c7a5','#4fa7ff','#ff8f6b','#f2be5a','#5ad2c9','#8aa7ff','#7adf7f','#f38ab3'];
const SUPABASE_URL = 'https://yeiwludpviidmlfxeuid.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllaXdsdWRwdmlpZG1sZnhldWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTI2ODksImV4cCI6MjA4ODA2ODY4OX0.wCOym6qzSNGuY36BdZktYi7CFfIqaTbeMZxzP8cODYs';
const SUPABASE_TABLE = 'ledger_states';

// ── STATE ───────────────────────────────────────────────────────────────
let state = {
  currentMonth: null,
  data: {},
  theme: 'dark',
  ui: {
    txSearch: '',
    txFilter: 'all',
    txGroupFilter: 'all',
  },
};

let currentTab = 'budget';
let currentUser = null;
let sbClient = null;
let remoteSyncTimer = null;
let remoteSyncInFlight = false;
let remoteSyncEnabled = false;
let remoteSyncErrorShown = false;

// ── HELPERS ─────────────────────────────────────────────────────────────
function uid()          { return Math.random().toString(36).slice(2, 9); }
function monthKey(y, m) { return `${y}-${String(m + 1).padStart(2, '0')}`; }
function today()        { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; }
function fmtDate(d)     { return d.toISOString().slice(0, 10); }
function fmt(n)         { return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function prevMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  let pm = m - 2, py = y;
  if (pm < 0) { pm += 12; py--; }
  return monthKey(py, pm);
}

function defaultMonth() {
  return { income: [], groups: [], transactions: [] };
}

function getMonth(key) {
  const k = key || state.currentMonth;
  if (!state.data[k]) state.data[k] = defaultMonth();
  return state.data[k];
}

// ── PERSISTENCE ─────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('ledger_v2', JSON.stringify(state));
  queueRemoteSave();
}

function ensureStateShape() {
  const t = today();
  if (!state || typeof state !== 'object') state = {};
  if (!state.currentMonth) state.currentMonth = monthKey(t.y, t.m);
  if (!state.theme) state.theme = 'dark';
  if (!state.data || typeof state.data !== 'object') state.data = {};
  if (!state.ui || typeof state.ui !== 'object') state.ui = {};
  if (typeof state.ui.txSearch !== 'string') state.ui.txSearch = '';
  if (!state.ui.txFilter) state.ui.txFilter = 'all';
  if (!state.ui.txGroupFilter) state.ui.txGroupFilter = 'all';
}

function load() {
  const raw = localStorage.getItem('ledger_v2');
  if (raw) {
    try { state = JSON.parse(raw); } catch (e) { /* ignore */ }
  }
  ensureStateShape();
}

function initSupabase() {
  if (!window.supabase?.createClient || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function queueRemoteSave() {
  if (!remoteSyncEnabled || !sbClient || !currentUser) return;
  clearTimeout(remoteSyncTimer);
  remoteSyncTimer = setTimeout(() => { syncRemoteState(); }, 500);
}

async function syncRemoteState() {
  if (!remoteSyncEnabled || !sbClient || !currentUser || remoteSyncInFlight) return;
  remoteSyncInFlight = true;
  try {
    const payload = JSON.parse(JSON.stringify(state));
    const { error } = await sbClient.from(SUPABASE_TABLE).upsert(
      [{ username: currentUser, state_json: payload, updated_at: new Date().toISOString() }],
      { onConflict: 'username' }
    );
    if (error) throw error;
    remoteSyncErrorShown = false;
  } catch (err) {
    if (!remoteSyncErrorShown) {
      showToast('Cloud sync unavailable. Using local data.', 'info');
      remoteSyncErrorShown = true;
    }
  } finally {
    remoteSyncInFlight = false;
  }
}

async function hydrateFromRemote() {
  if (!remoteSyncEnabled || !sbClient || !currentUser) return;
  try {
    const { data, error } = await sbClient
      .from(SUPABASE_TABLE)
      .select('state_json')
      .eq('username', currentUser)
      .maybeSingle();

    if (error) throw error;
    if (data?.state_json && typeof data.state_json === 'object') {
      state = data.state_json;
      ensureStateShape();
      localStorage.setItem('ledger_v2', JSON.stringify(state));
    } else {
      queueRemoteSave();
    }
    remoteSyncErrorShown = false;
  } catch (err) {
    if (!remoteSyncErrorShown) {
      showToast('Could not load cloud state. Using local data.', 'info');
      remoteSyncErrorShown = true;
    }
  }
}

// ── SEED DATA ────────────────────────────────────────────────────────────
function seedDefaults() {
  const t = today();
  const key = monthKey(t.y, t.m);
  if (state.data[key]) return;
  state.data[key] = {
    income: [
      { id: uid(), name: 'Paycheck', budgeted: 5500, received: 5500 },
    ],
    groups: [
      { id: uid(), name: 'Housing', cats: [
        { id: uid(), name: 'Mortgage / Rent',  budgeted: 2200, spent: 2200 },
        { id: uid(), name: 'Utilities',         budgeted: 180,  spent: 142  },
        { id: uid(), name: 'Internet',          budgeted: 80,   spent: 80   },
      ]},
      { id: uid(), name: 'Food', cats: [
        { id: uid(), name: 'Groceries',  budgeted: 600, spent: 320 },
        { id: uid(), name: 'Dining Out', budgeted: 200, spent: 87  },
      ]},
      { id: uid(), name: 'Transport', cats: [
        { id: uid(), name: 'Gas',           budgeted: 120, spent: 65  },
        { id: uid(), name: 'Car Insurance', budgeted: 140, spent: 140 },
      ]},
      { id: uid(), name: 'Health', cats: [
        { id: uid(), name: 'Medical Premiums', budgeted: 280, spent: 280 },
        { id: uid(), name: 'Pharmacy',          budgeted: 40,  spent: 12  },
      ]},
      { id: uid(), name: 'Personal', cats: [
        { id: uid(), name: 'Running / Fitness', budgeted: 80, spent: 35 },
        { id: uid(), name: 'Subscriptions',     budgeted: 50, spent: 47 },
      ]},
    ],
    transactions: [
      { id: uid(), date: fmtDate(new Date()),                              payee: 'Whole Foods',  category: 'Groceries',  catGroup: 'Food',      amount: 94.30, type: 'expense', memo: '' },
      { id: uid(), date: fmtDate(new Date(Date.now() - 86400000)),         payee: 'Paycheck',     category: 'Paycheck',   catGroup: 'Income',    amount: 5500,  type: 'income',  memo: '' },
      { id: uid(), date: fmtDate(new Date(Date.now() - 172800000)),        payee: 'Shell Gas',    category: 'Gas',        catGroup: 'Transport', amount: 65,    type: 'expense', memo: '' },
      { id: uid(), date: fmtDate(new Date(Date.now() - 259200000)),        payee: 'Chipotle',     category: 'Dining Out', catGroup: 'Food',      amount: 18.75, type: 'expense', memo: 'Lunch with team' },
    ],
  };
  save();
}

// ── THEME ────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
  // Update toggle button icons
  document.querySelectorAll('.theme-toggle-icon').forEach(el => {
    el.textContent = theme === 'dark' ? '☀' : '☽';
  });
}

function toggleTheme() {
  const next = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  if (!document.getElementById('app').classList.contains('hidden')) renderAll();
  save();
}

// ── INIT ─────────────────────────────────────────────────────────────────
async function initApp() {
  load();
  await hydrateFromRemote();
  ensureStateShape();
  syncTxFiltersFromState();
  seedDefaults();
  applyTheme(state.theme);
  renderMonthList();
  renderAll();
}

// ── MONTH LIST ───────────────────────────────────────────────────────────
function monthHealthDot(key) {
  const mo = state.data[key];
  if (!mo || (!mo.income.length && !mo.groups.length)) return 'empty';
  const totalIncome = mo.income.reduce((s, i) => s + i.budgeted, 0);
  const totalBudgeted = mo.groups.reduce((s, g) => s + g.cats.reduce((ss, c) => ss + c.budgeted, 0), 0);
  if (totalIncome === 0) return 'empty';
  const left = totalIncome - totalBudgeted;
  const pct = totalBudgeted / totalIncome;
  if (pct >= 1.05) return 'danger';
  if (pct >= 0.98) return 'warn';
  return 'safe';
}

function renderMonthList() {
  const t = today();
  const list = document.getElementById('month-list');
  list.innerHTML = '';
  for (let i = -4; i <= 6; i++) {
    let m = t.m + i, y = t.y;
    while (m < 0)  { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    const key = monthKey(y, m);
    const dot = monthHealthDot(key);
    const el = document.createElement('div');
    el.className = 'month-item' + (key === state.currentMonth ? ' active' : '');
    el.innerHTML = `<span>${MONTHS[m]} ${y}</span><span class="month-dot ${dot}"></span>`;
    el.onclick = () => { state.currentMonth = key; save(); renderMonthList(); renderAll(); };
    list.appendChild(el);
  }
}

// ── RENDER ALL ───────────────────────────────────────────────────────────
function renderAll() {
  const [y, m] = state.currentMonth.split('-').map(Number);
  document.getElementById('header-month').textContent = `${FULL_MONTHS[m - 1]} ${y}`;
  renderBudget();
  renderTransactions();
  renderOverview();
  renderSidePanels();
  renderCopyBanner();
}

// ── COPY BANNER ──────────────────────────────────────────────────────────
function renderCopyBanner() {
  const banner = document.getElementById('copy-banner');
  const mo = getMonth();
  const hasData = mo.groups.length > 0 || mo.income.length > 0;
  if (hasData) { banner.classList.add('hidden'); return; }

  const prevKey = prevMonthKey(state.currentMonth);
  const prev = state.data[prevKey];
  if (!prev || (!prev.groups.length && !prev.income.length)) {
    banner.classList.add('hidden'); return;
  }

  const [y, m] = prevKey.split('-').map(Number);
  banner.classList.remove('hidden');
  document.getElementById('copy-banner-month').textContent = `${FULL_MONTHS[m - 1]} ${y}`;
}

function copyPrevMonth() {
  const prevKey = prevMonthKey(state.currentMonth);
  const prev = state.data[prevKey];
  if (!prev) return;
  const mo = getMonth();
  mo.income = prev.income.map(i => ({ ...i, id: uid(), received: 0 }));
  mo.groups = prev.groups.map(g => ({
    ...g,
    id: uid(),
    cats: g.cats.map(c => ({ ...c, id: uid(), spent: 0 })),
  }));
  save();
  renderAll();
  showToast('Budget copied from previous month', 'success');
}

// ── BUDGET TAB ───────────────────────────────────────────────────────────
function renderBudget() {
  const mo = getMonth();
  const totalIncome   = mo.income.reduce((s, i) => s + i.budgeted, 0);
  const totalBudgeted = mo.groups.reduce((s, g) => s + g.cats.reduce((ss, c) => ss + c.budgeted, 0), 0);
  const left = totalIncome - totalBudgeted;

  document.getElementById('sum-income').textContent   = fmt(totalIncome);
  document.getElementById('sum-budgeted').textContent = fmt(totalBudgeted);
  const leftEl = document.getElementById('sum-left');
  leftEl.textContent = (left < 0 ? '-' : '') + fmt(left);
  leftEl.style.color = left < 0 ? 'var(--danger)' : left === 0 ? 'var(--accent)' : 'var(--bright)';

  // Mini ring chart
  renderSummaryRing(totalIncome, totalBudgeted);

  const container = document.getElementById('category-groups');
  container.innerHTML = '';

  // Income section
  const incSec = document.createElement('div');
  incSec.className = 'group-section fade-in';
  incSec.innerHTML = `
    <div class="group-header">
      <div class="group-header-left">
        <span class="group-name">Income</span>
        <button class="btn-link" onclick="openAddIncome()">+ source</button>
      </div>
      <div class="group-header-cols">
        <span class="col-budgeted">Budgeted</span>
        <span class="col-received">Received</span>
        <span class="col-actions"></span>
      </div>
    </div>
    <div class="group-table">
      ${mo.income.map(inc => {
        const ok = inc.received >= inc.budgeted;
        return `
        <div class="cat-row" onclick="openEditIncome('${inc.id}')">
          <div class="cat-row-main">
            <span class="cat-name">${esc(inc.name)}</span>
            <div class="cat-amounts">
              <span class="cat-amount w-24 text-right" style="color:var(--bright)">${fmt(inc.budgeted)}</span>
              <span class="cat-amount w-24 text-right" style="color:${ok ? 'var(--accent)' : 'var(--warn)'}">${fmt(inc.received)}</span>
              <span class="col-actions"></span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
  container.appendChild(incSec);

  // Category groups
  mo.groups.forEach(group => {
    const groupTotal = group.cats.reduce((s, c) => s + c.budgeted, 0);
    const groupSpent = group.cats.reduce((s, c) => s + c.spent, 0);
    const groupLeft  = groupTotal - groupSpent;

    const sec = document.createElement('div');
    sec.className = 'group-section fade-in';
    sec.innerHTML = `
      <div class="group-header">
        <div class="group-header-left">
          <span class="group-name">${esc(group.name)}</span>
          <button class="btn-link" onclick="openAddCat('${group.id}')">+ category</button>
          <button class="btn-link danger" onclick="openDeleteGroup('${group.id}')">delete</button>
        </div>
        <div class="group-header-cols">
          <span class="col-budgeted">Budgeted</span>
          <span class="col-spent">Spent</span>
          <span class="col-left">Left</span>
          <span class="col-actions"></span>
        </div>
      </div>
      <div class="group-table">
        ${group.cats.map(cat => {
          const pct    = cat.budgeted > 0 ? Math.min(100, (cat.spent / cat.budgeted) * 100) : 0;
          const cls    = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'safe';
          const leftCat = cat.budgeted - cat.spent;
          return `
          <div class="cat-row" onclick="openEditCat('${group.id}','${cat.id}')">
            <div class="cat-row-main">
              <span class="cat-name">${esc(cat.name)}</span>
              <div class="cat-amounts">
                <span class="cat-amount w-24 text-right" style="color:var(--bright)">${fmt(cat.budgeted)}</span>
                <span class="cat-amount w-24 text-right" style="color:var(--dim)">${fmt(cat.spent)}</span>
                <span class="cat-amount w-20 text-right" style="color:${leftCat < 0 ? 'var(--danger)' : leftCat === 0 ? 'var(--dim)' : 'var(--accent)'}">${leftCat < 0 ? '-' : ''}${fmt(leftCat)}</span>
                <span class="col-actions"></span>
              </div>
            </div>
            <div class="cat-row-progress">
              <div class="progress-track">
                <div class="progress-fill ${cls}" style="width:${pct}%"></div>
              </div>
            </div>
          </div>`;
        }).join('')}
        <div class="group-total-row">
          <span style="font-size:11px;color:var(--muted)">Total</span>
          <div class="cat-amounts">
            <span class="cat-amount w-24 text-right" style="font-size:12px;color:var(--dim)">${fmt(groupTotal)}</span>
            <span class="cat-amount w-24 text-right" style="font-size:12px;color:var(--dim)">${fmt(groupSpent)}</span>
            <span class="cat-amount w-20 text-right" style="font-size:12px;color:${groupLeft < 0 ? 'var(--danger)' : 'var(--dim)'}">${groupLeft < 0 ? '-' : ''}${fmt(groupLeft)}</span>
            <span class="col-actions"></span>
          </div>
        </div>
      </div>
    `;
    container.appendChild(sec);
  });
}

// Mini ring chart in summary bar
function renderSummaryRing(income, budgeted) {
  const canvas = document.getElementById('summary-ring');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cssSize = 72;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(cssSize * dpr) || canvas.height !== Math.round(cssSize * dpr)) {
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const size = cssSize;
  const cx = size / 2, cy = size / 2, r = (size / 2) - 12;
  ctx.clearRect(0, 0, size, size);

  const pct = income > 0 ? Math.min(1, budgeted / income) : 0;
  const style = getComputedStyle(document.documentElement);
  const track = style.getPropertyValue('--border').trim() || '#27404d';
  const textColor = style.getPropertyValue('--bright').trim() || '#f6fafc';
  const ringColor = pct >= 1
    ? (style.getPropertyValue('--danger').trim() || '#ff6f61')
    : pct >= 0.8
      ? (style.getPropertyValue('--warn').trim() || '#f2be5a')
      : (style.getPropertyValue('--accent').trim() || '#33c7a5');

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = track;
  ctx.lineWidth = 5;
  ctx.stroke();

  if (pct > 0) {
    const startAngle = -Math.PI / 2;
    const endAngle   = startAngle + (Math.PI * 2 * pct);
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = ringColor;
    ctx.shadowColor = ringColor;
    ctx.shadowBlur = state.theme === 'light' ? 6 : 8;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Center text
  ctx.fillStyle = textColor;
  ctx.font = `bold 12px 'Geist Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(pct * 100)}%`, cx, cy);
}

// ── TRANSACTIONS TAB ─────────────────────────────────────────────────────
let txSearch  = '';
let txFilter  = 'all';
let txGroupFilter = 'all';

function syncTxFiltersFromState() {
  txSearch = state.ui?.txSearch || '';
  txFilter = state.ui?.txFilter || 'all';
  txGroupFilter = state.ui?.txGroupFilter || 'all';
}

function persistTxFilters() {
  if (!state.ui || typeof state.ui !== 'object') state.ui = {};
  state.ui.txSearch = txSearch;
  state.ui.txFilter = txFilter;
  state.ui.txGroupFilter = txGroupFilter;
  save();
}

function setTxSearch(value) {
  txSearch = value || '';
  persistTxFilters();
  renderTransactions();
}

function setTxTypeFilter(value) {
  txFilter = value || 'all';
  persistTxFilters();
  renderTransactions();
}

function setTxGroupFilter(value) {
  txGroupFilter = value || 'all';
  persistTxFilters();
  renderTransactions();
}

function renderTxGroupFilterOptions(mo) {
  const select = document.getElementById('tx-group-filter');
  if (!select) return;
  const current = txGroupFilter;
  const groups = Array.from(new Set(mo.transactions.map(tx => tx.catGroup).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="all">All groups</option>${groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}`;
  if (current !== 'all' && groups.includes(current)) {
    select.value = current;
  } else {
    txGroupFilter = 'all';
    select.value = 'all';
    persistTxFilters();
  }
}

function clearTxFilters() {
  txSearch = '';
  txFilter = 'all';
  txGroupFilter = 'all';
  const search = document.getElementById('tx-search');
  const type = document.getElementById('tx-filter');
  const group = document.getElementById('tx-group-filter');
  if (search) search.value = '';
  if (type) type.value = 'all';
  if (group) group.value = 'all';
  persistTxFilters();
  renderTransactions();
}

function openTransactionsWithGroup(groupName) {
  txGroupFilter = groupName || 'all';
  persistTxFilters();
  const tabBtn = document.getElementById('tab-btn-transactions');
  if (tabBtn) switchTab('transactions', tabBtn);
}

function renderTransactions() {
  const mo = getMonth();
  const list = document.getElementById('tx-list');
  const search = document.getElementById('tx-search');
  const type = document.getElementById('tx-filter');
  if (search && search.value !== txSearch) search.value = txSearch;
  if (type && type.value !== txFilter) type.value = txFilter;
  renderTxGroupFilterOptions(mo);
  let sorted = [...mo.transactions].sort((a, b) => b.date.localeCompare(a.date));

  // Filter
  if (txSearch) {
    const q = txSearch.toLowerCase();
    sorted = sorted.filter(tx =>
      tx.payee.toLowerCase().includes(q) ||
      tx.category.toLowerCase().includes(q) ||
      (tx.memo || '').toLowerCase().includes(q)
    );
  }
  if (txFilter !== 'all') {
    sorted = sorted.filter(tx => tx.type === txFilter);
  }
  if (txGroupFilter !== 'all') {
    sorted = sorted.filter(tx => tx.catGroup === txGroupFilter);
  }

  if (sorted.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:20px 0">No transactions found.</p>';
    return;
  }

  list.innerHTML = sorted.map(tx => `
    <div class="tx-row">
      <div class="tx-left">
        <span class="tx-date">${tx.date.slice(5)}</span>
        <div class="tx-info">
          <p class="tx-payee">${esc(tx.payee)}</p>
          <p class="tx-cat">${esc(tx.catGroup)} · ${esc(tx.category)}</p>
          ${tx.memo ? `<p class="tx-memo">${esc(tx.memo)}</p>` : ''}
        </div>
      </div>
      <div class="tx-right">
        <span class="tx-badge ${tx.type}">${tx.type}</span>
        <span class="tx-amount" style="color:${tx.type === 'income' ? 'var(--accent)' : 'var(--light)'}">${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount)}</span>
        <div class="tx-actions">
          <button class="tx-action-btn" onclick="openEditTransaction('${tx.id}')" title="Edit">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3l8-8z"/></svg>
          </button>
          <button class="tx-action-btn del" onclick="deleteTransaction('${tx.id}')" title="Delete">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// ── OVERVIEW TAB ─────────────────────────────────────────────────────────
function renderOverview() {
  const mo = getMonth();
  const totalIncome = mo.income.reduce((s, i) => s + i.received, 0);
  const totalSpent  = mo.groups.reduce((s, g) => s + g.cats.reduce((ss, c) => ss + c.spent, 0), 0);
  const saved = totalIncome - totalSpent;

  document.getElementById('ov-income').textContent = fmt(totalIncome);
  document.getElementById('ov-spent').textContent  = fmt(totalSpent);
  const netEl = document.getElementById('ov-net');
  netEl.textContent = (saved >= 0 ? '+' : '-') + fmt(saved);
  netEl.style.color = saved >= 0 ? 'var(--accent)' : 'var(--danger)';

  // Breakdown
  const breakdown = document.getElementById('ov-breakdown');
  breakdown.innerHTML = '';
  mo.groups.forEach((g, i) => {
    const spent    = g.cats.reduce((s, c) => s + c.spent, 0);
    const budgeted = g.cats.reduce((s, c) => s + c.budgeted, 0);
    const pct      = budgeted > 0 ? Math.min(100, (spent / budgeted) * 100) : 0;
    const color    = DONUT_COLORS[i % DONUT_COLORS.length];
    breakdown.innerHTML += `
      <div class="overview-row">
        <span class="overview-row-dot" style="background:${color}"></span>
        <span class="overview-row-name">${esc(g.name)}</span>
        <span class="overview-row-pct">${Math.round(pct)}%</span>
        <span class="overview-row-amt">${fmt(spent)}</span>
        <div class="overview-row-bar">
          <div class="progress-track">
            <div class="progress-fill ${pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'safe'}" style="width:${pct}%"></div>
          </div>
        </div>
      </div>
    `;
  });

  // Donut chart
  drawDonut(mo);
}

function drawDonut(mo) {
  const canvas = document.getElementById('donut-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cssSize = 180;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(cssSize * dpr) || canvas.height !== Math.round(cssSize * dpr)) {
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const style = getComputedStyle(document.documentElement);
  const textBright = style.getPropertyValue('--bright').trim() || '#f6fafc';
  const textDim = style.getPropertyValue('--dim').trim() || '#a6bac4';
  const track = style.getPropertyValue('--border').trim() || '#27404d';
  const panel = style.getPropertyValue('--panel').trim() || '#1a2c36';

  const size = cssSize;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 60;
  const lineWidth = 24;
  ctx.clearRect(0, 0, size, size);

  const groups = mo.groups.map((g, i) => ({
    name: g.name,
    value: g.cats.reduce((s, c) => s + c.spent, 0),
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  })).filter(g => g.value > 0);

  const total = groups.reduce((s, g) => s + g.value, 0);
  if (total === 0) {
    ctx.fillStyle = textDim;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No spending', cx, cy);
    return;
  }

  // Track ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = track;
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  let startAngle = -Math.PI / 2;
  const gap = 0.04;
  groups.forEach(g => {
    const slice = (g.value / total) * (Math.PI * 2 - gap * groups.length);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
    ctx.strokeStyle = g.color;
    ctx.shadowColor = g.color;
    ctx.shadowBlur = state.theme === 'light' ? 8 : 11;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.shadowBlur = 0;
    startAngle += slice + gap;
  });

  // Donut center disc
  ctx.beginPath();
  ctx.arc(cx, cy, radius - (lineWidth / 2) - 6, 0, Math.PI * 2);
  ctx.fillStyle = panel;
  ctx.fill();

  // Center total
  ctx.fillStyle = textBright;
  ctx.font = `bold 15px 'Geist Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fmt(total), cx, cy - 8);
  ctx.font = `10px 'Geist Mono', monospace`;
  ctx.fillStyle = textDim;
  ctx.fillText('SPENT', cx, cy + 10);

  // Legend
  const legend = document.getElementById('donut-legend');
  legend.innerHTML = groups.map(g => `
    <div class="donut-legend-item">
      <span class="donut-legend-dot" style="background:${g.color}"></span>
      <span class="donut-legend-name">${esc(g.name)}</span>
      <span class="donut-legend-val">${fmt(g.value)}</span>
    </div>
  `).join('');
}

// ── SIDE PANELS ──────────────────────────────────────────────────────────
function renderSidePanels() {
  const mo = getMonth();
  const groups = mo.groups
    .map(g => ({
      name: g.name,
      spent: g.cats.reduce((s, c) => s + c.spent, 0),
      budgeted: g.cats.reduce((s, c) => s + c.budgeted, 0),
    }))
    .filter(g => g.spent > 0 || g.budgeted > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 6);
  const totalGroupSpent = groups.reduce((s, g) => s + g.spent, 0);

  document.getElementById('spending-panel').innerHTML = groups.length
    ? groups.map(g => {
        const pct = g.budgeted > 0 ? Math.min(100, (g.spent / g.budgeted) * 100) : 0;
        const share = totalGroupSpent > 0 ? Math.round((g.spent / totalGroupSpent) * 100) : 0;
        return `
          <div class="spending-item clickable" onclick="openTransactionsWithGroup(decodeURIComponent('${encodeURIComponent(g.name)}'))" title="View ${esc(g.name)} transactions">
            <div class="spending-item-header">
              <span class="spending-name">${esc(g.name)}</span>
              <span class="spending-amt">${fmt(g.spent)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
              <span style="font-size:10px;color:var(--muted)">${share}% of group spend</span>
              <span style="font-size:10px;color:${pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--dim)'}">${Math.round(pct)}% of budget</span>
            </div>
            <div class="progress-track"><div class="progress-fill ${pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'safe'}" style="width:${pct}%"></div></div>
          </div>`;
      }).join('')
    : '<p style="color:var(--muted);font-size:12px">No group spending yet.</p>';

  const recent = [...mo.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  document.getElementById('recent-panel').innerHTML = recent.length
    ? recent.map(tx => `
        <div class="recent-item">
          <div>
            <p class="recent-payee">${esc(tx.payee)}</p>
            <p class="recent-cat">${esc(tx.category)}</p>
          </div>
          <span class="recent-amt" style="color:${tx.type === 'income' ? 'var(--accent)' : 'var(--dim)'}">${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount)}</span>
        </div>`).join('')
    : '<p style="color:var(--muted);font-size:12px">No recent transactions.</p>';
}

// ── MODAL ENGINE ─────────────────────────────────────────────────────────
let modalSubmitFn = null;

function openModal(title, bodyHTML, onSubmit, { submitLabel = 'Save', hideSave = false } = {}) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-submit-btn').style.display = hideSave ? 'none' : '';
  document.getElementById('modal-submit-btn').textContent = submitLabel;
  modalSubmitFn = onSubmit;
  document.getElementById('modal-overlay').classList.add('open');
  // Auto-focus first input
  setTimeout(() => {
    const first = document.querySelector('#modal-body input, #modal-body select');
    if (first) first.focus();
  }, 50);
}

function closeModal(e) {
  if (!e || e.target === document.getElementById('modal-overlay')) {
    document.getElementById('modal-overlay').classList.remove('open');
    modalSubmitFn = null;
  }
}

function modalSubmit() {
  if (modalSubmitFn) modalSubmitFn();
}

// ── CAT SELECT HELPER ────────────────────────────────────────────────────
function catOptions(selectedGroup, selectedCat) {
  const mo = getMonth();
  const cats = [
    { group: 'Income', name: 'Income' },
    ...mo.groups.flatMap(g => g.cats.map(c => ({ group: g.name, name: c.name }))),
  ];
  return cats.map(c => {
    const val = `${c.group}|${c.name}`;
    const sel = (c.group === selectedGroup && c.name === selectedCat) ? 'selected' : '';
    return `<option value="${val}" ${sel}>${c.group} → ${c.name}</option>`;
  }).join('');
}

// ── ADD / EDIT TRANSACTION ────────────────────────────────────────────────
function openAddTransaction() {
  openModal('Add Transaction', `
    <div class="input-group">
      <label class="input-label">Type</label>
      <select id="tx-type" class="input-field">
        <option value="expense">Expense</option>
        <option value="income">Income</option>
      </select>
    </div>
    <div class="input-group">
      <label class="input-label">Payee / Description</label>
      <input id="tx-payee" type="text" placeholder="e.g. Whole Foods" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Amount</label>
      <input id="tx-amount" type="number" placeholder="0.00" min="0" step="0.01" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Date</label>
      <input id="tx-date" type="date" value="${fmtDate(new Date())}" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Category</label>
      <select id="tx-cat" class="input-field">${catOptions('', '')}</select>
    </div>
    <div class="input-group">
      <label class="input-label">Memo (optional)</label>
      <input id="tx-memo" type="text" placeholder="Optional note" class="input-field" />
    </div>
  `, () => {
    const type    = document.getElementById('tx-type').value;
    const payee   = document.getElementById('tx-payee').value.trim();
    const amount  = parseFloat(document.getElementById('tx-amount').value);
    const date    = document.getElementById('tx-date').value;
    const memo    = document.getElementById('tx-memo').value.trim();
    const [catGroup, category] = document.getElementById('tx-cat').value.split('|');
    if (!payee || isNaN(amount) || amount <= 0) return;
    const tx = { id: uid(), date, payee, category, catGroup, amount, type, memo };
    getMonth().transactions.push(tx);
    if (type === 'expense') {
      const g = getMonth().groups.find(g => g.name === catGroup);
      if (g) { const c = g.cats.find(c => c.name === category); if (c) c.spent += amount; }
    } else {
      const inc = getMonth().income.find(i => i.name === category);
      if (inc) inc.received += amount;
    }
    save(); renderAll(); closeModal(); showToast('Transaction added', 'success');
  });
}

function openEditTransaction(id) {
  const tx = getMonth().transactions.find(t => t.id === id);
  if (!tx) return;
  openModal(`Edit Transaction`, `
    <div class="input-group">
      <label class="input-label">Type</label>
      <select id="tx-type" class="input-field">
        <option value="expense" ${tx.type === 'expense' ? 'selected' : ''}>Expense</option>
        <option value="income"  ${tx.type === 'income'  ? 'selected' : ''}>Income</option>
      </select>
    </div>
    <div class="input-group">
      <label class="input-label">Payee / Description</label>
      <input id="tx-payee" type="text" value="${esc(tx.payee)}" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Amount</label>
      <input id="tx-amount" type="number" value="${tx.amount}" min="0" step="0.01" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Date</label>
      <input id="tx-date" type="date" value="${tx.date}" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Category</label>
      <select id="tx-cat" class="input-field">${catOptions(tx.catGroup, tx.category)}</select>
    </div>
    <div class="input-group">
      <label class="input-label">Memo (optional)</label>
      <input id="tx-memo" type="text" value="${esc(tx.memo || '')}" class="input-field" />
    </div>
    <button class="btn-link danger" onclick="deleteTransaction('${id}');closeModal();">Delete transaction</button>
  `, () => {
    // Reverse old effects
    if (tx.type === 'expense') {
      const g = getMonth().groups.find(g => g.name === tx.catGroup);
      if (g) { const c = g.cats.find(c => c.name === tx.category); if (c) c.spent = Math.max(0, c.spent - tx.amount); }
    } else {
      const inc = getMonth().income.find(i => i.name === tx.category);
      if (inc) inc.received = Math.max(0, inc.received - tx.amount);
    }
    // Apply new values
    const type   = document.getElementById('tx-type').value;
    const payee  = document.getElementById('tx-payee').value.trim();
    const amount = parseFloat(document.getElementById('tx-amount').value);
    const date   = document.getElementById('tx-date').value;
    const memo   = document.getElementById('tx-memo').value.trim();
    const [catGroup, category] = document.getElementById('tx-cat').value.split('|');
    if (!payee || isNaN(amount) || amount <= 0) return;
    Object.assign(tx, { type, payee, amount, date, catGroup, category, memo });
    if (type === 'expense') {
      const g = getMonth().groups.find(g => g.name === catGroup);
      if (g) { const c = g.cats.find(c => c.name === category); if (c) c.spent += amount; }
    } else {
      const inc = getMonth().income.find(i => i.name === category);
      if (inc) inc.received += amount;
    }
    save(); renderAll(); closeModal(); showToast('Transaction updated', 'success');
  });
}

function deleteTransaction(id) {
  const mo = getMonth();
  const tx = mo.transactions.find(t => t.id === id);
  if (!tx) return;
  if (tx.type === 'expense') {
    const g = mo.groups.find(g => g.name === tx.catGroup);
    if (g) { const c = g.cats.find(c => c.name === tx.category); if (c) c.spent = Math.max(0, c.spent - tx.amount); }
  }
  mo.transactions = mo.transactions.filter(t => t.id !== id);
  save(); renderAll(); showToast('Transaction deleted', 'info');
}

// ── INCOME MODALS ────────────────────────────────────────────────────────
function openAddIncome() {
  openModal('Add Income Source', `
    <div class="input-group">
      <label class="input-label">Name</label>
      <input id="inc-name" type="text" placeholder="e.g. Freelance" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Budgeted Amount</label>
      <input id="inc-budgeted" type="number" placeholder="0.00" min="0" step="0.01" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Received Amount</label>
      <input id="inc-received" type="number" placeholder="0.00" min="0" step="0.01" class="input-field" />
    </div>
  `, () => {
    const name     = document.getElementById('inc-name').value.trim();
    const budgeted = parseFloat(document.getElementById('inc-budgeted').value) || 0;
    const received = parseFloat(document.getElementById('inc-received').value) || 0;
    if (!name) return;
    getMonth().income.push({ id: uid(), name, budgeted, received });
    save(); renderAll(); closeModal(); showToast('Income source added', 'success');
  });
}

function openEditIncome(id) {
  const inc = getMonth().income.find(i => i.id === id);
  if (!inc) return;
  openModal(`Edit: ${inc.name}`, `
    <div class="input-group">
      <label class="input-label">Name</label>
      <input id="inc-name" type="text" value="${esc(inc.name)}" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Budgeted</label>
      <input id="inc-budgeted" type="number" value="${inc.budgeted}" min="0" step="0.01" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Received</label>
      <input id="inc-received" type="number" value="${inc.received}" min="0" step="0.01" class="input-field" />
    </div>
    <button class="btn-link danger" onclick="deleteIncome('${id}');closeModal();">Delete source</button>
  `, () => {
    inc.name     = document.getElementById('inc-name').value.trim() || inc.name;
    inc.budgeted = parseFloat(document.getElementById('inc-budgeted').value) || 0;
    inc.received = parseFloat(document.getElementById('inc-received').value) || 0;
    save(); renderAll(); closeModal(); showToast('Income updated', 'success');
  });
}

function deleteIncome(id) {
  const mo = getMonth();
  mo.income = mo.income.filter(i => i.id !== id);
  save(); renderAll(); closeModal();
}

// ── GROUP / CATEGORY MODALS ───────────────────────────────────────────────
function openAddGroup() {
  openModal('Add Budget Group', `
    <div class="input-group">
      <label class="input-label">Group Name</label>
      <input id="group-name" type="text" placeholder="e.g. Savings" class="input-field" />
    </div>
  `, () => {
    const name = document.getElementById('group-name').value.trim();
    if (!name) return;
    getMonth().groups.push({ id: uid(), name, cats: [] });
    save(); renderAll(); closeModal(); showToast('Group added', 'success');
  });
}

function openDeleteGroup(groupId) {
  const g = getMonth().groups.find(g => g.id === groupId);
  if (!g) return;
  openModal(`Delete Group: ${g.name}`, `
    <p style="color:var(--light);font-size:13px">Delete <strong>${esc(g.name)}</strong> and all its categories? This cannot be undone.</p>
  `, () => {
    getMonth().groups = getMonth().groups.filter(g => g.id !== groupId);
    save(); renderAll(); closeModal(); showToast('Group deleted', 'info');
  }, { submitLabel: 'Delete' });
}

function openAddCat(groupId) {
  openModal('Add Category', `
    <div class="input-group">
      <label class="input-label">Category Name</label>
      <input id="cat-name" type="text" placeholder="e.g. Gym" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Budgeted Amount</label>
      <input id="cat-budget" type="number" placeholder="0.00" min="0" step="0.01" class="input-field" />
    </div>
  `, () => {
    const name     = document.getElementById('cat-name').value.trim();
    const budgeted = parseFloat(document.getElementById('cat-budget').value) || 0;
    if (!name) return;
    const g = getMonth().groups.find(g => g.id === groupId);
    if (g) g.cats.push({ id: uid(), name, budgeted, spent: 0 });
    save(); renderAll(); closeModal(); showToast('Category added', 'success');
  });
}

function openEditCat(groupId, catId) {
  const g   = getMonth().groups.find(g => g.id === groupId);
  const cat = g?.cats.find(c => c.id === catId);
  if (!cat) return;
  openModal(`Edit: ${cat.name}`, `
    <div class="input-group">
      <label class="input-label">Name</label>
      <input id="cat-name" type="text" value="${esc(cat.name)}" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Budgeted</label>
      <input id="cat-budget" type="number" value="${cat.budgeted}" min="0" step="0.01" class="input-field" />
    </div>
    <div class="input-group">
      <label class="input-label">Spent (actual)</label>
      <input id="cat-spent" type="number" value="${cat.spent}" min="0" step="0.01" class="input-field" />
    </div>
    <button class="btn-link danger" onclick="deleteCat('${groupId}','${catId}');closeModal();">Delete category</button>
  `, () => {
    cat.name     = document.getElementById('cat-name').value.trim() || cat.name;
    cat.budgeted = parseFloat(document.getElementById('cat-budget').value) || 0;
    cat.spent    = parseFloat(document.getElementById('cat-spent').value)   || 0;
    save(); renderAll(); closeModal(); showToast('Category updated', 'success');
  });
}

function deleteCat(groupId, catId) {
  const g = getMonth().groups.find(g => g.id === groupId);
  if (g) g.cats = g.cats.filter(c => c.id !== catId);
  save(); renderAll();
}

// ── TABS ─────────────────────────────────────────────────────────────────
function switchTab(name, el) {
  currentTab = name;
  document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  el.classList.add('active');
  if (name === 'transactions') renderTransactions();
  if (name === 'overview') renderOverview();
}

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────
function exportCSV() {
  const mo = getMonth();
  const [y, m] = state.currentMonth.split('-').map(Number);
  const rows = [['Date', 'Payee', 'Group', 'Category', 'Type', 'Amount', 'Memo']];
  const sorted = [...mo.transactions].sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach(tx => {
    rows.push([tx.date, tx.payee, tx.catGroup, tx.category, tx.type, tx.amount.toFixed(2), tx.memo || '']);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(`ledger-${state.currentMonth}.csv`, csv, 'text/csv');
  showToast('CSV exported', 'success');
}

function exportJSON() {
  const json = JSON.stringify(state, null, 2);
  download('ledger-backup.json', json, 'application/json');
  showToast('Backup exported', 'success');
}

function openImport() {
  openModal('Import Backup', `
    <p style="color:var(--dim);font-size:12px;margin-bottom:8px">Select a previously exported <code>ledger-backup.json</code> file. This will replace all current data.</p>
    <div class="input-group">
      <label class="input-label">JSON Backup File</label>
      <input id="import-file" type="file" accept=".json" class="input-field" style="padding:8px" />
    </div>
  `, () => {
    const file = document.getElementById('import-file').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!imported.data || !imported.currentMonth) throw new Error('Invalid backup');
        state = imported;
        save();
        syncTxFiltersFromState();
        applyTheme(state.theme || 'dark');
        renderMonthList();
        renderAll();
        closeModal();
        showToast('Backup restored ✓', 'success');
      } catch {
        showToast('Invalid backup file', 'error');
      }
    };
    reader.readAsText(file);
  }, { submitLabel: 'Import' });
}

function printView() {
  window.print();
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── DROPDOWN ──────────────────────────────────────────────────────────────
function toggleDropdown(id) {
  const menu = document.getElementById(id);
  menu.classList.toggle('open');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.dropdown-wrapper')) {
    document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
  }
});

// ── TOAST ─────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: '·' };
  toast.innerHTML = `<span style="color:var(--${type === 'success' ? 'safe' : type === 'error' ? 'danger' : 'accent'})">${icons[type]}</span> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut .25s ease forwards';
    setTimeout(() => toast.remove(), 260);
  }, 2200);
}

// Initialize cloud client and boot app once at startup.
initSupabase();
currentUser = DEFAULT_USER;
remoteSyncEnabled = !!sbClient;
initApp();

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName.toLowerCase();
  if (['input', 'select', 'textarea'].includes(tag)) return;

  const overlay = document.getElementById('modal-overlay');
  if (overlay.classList.contains('open')) {
    if (e.key === 'Escape') closeModal({ target: overlay });
    if (e.key === 'Enter') modalSubmit();
    return;
  }

  if (e.key === 'Escape') closeModal({ target: overlay });
  if (e.key === 't' || e.key === 'T') openAddTransaction();
  if (e.key === 'g' || e.key === 'G') openAddGroup();
  if (e.key === 'i' || e.key === 'I') openAddIncome();
  if (e.key === 'd' || e.key === 'D') toggleTheme();
});

// ── ESCAPE HELPER ─────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
