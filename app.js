const APP_NAME = 'Budget Flow V4 Premium';
const DB_NAME = 'budget-flow-v4-db';
const DB_STORE = 'app_state';
const DB_KEY = 'singleton';
const FALLBACK_KEY = 'budget-flow-v4-fallback';
const currency = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const monthShortFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const defaultCategories = ['Logement', 'Courses', 'Transport', 'Santé', 'Énergie', 'Télécom', 'Loisirs', 'Assurance', 'Épargne', 'Autre'];
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let deferredPrompt = null;
let supabaseClient = null;

const state = {
  theme: 'dark',
  settings: {
    supabaseUrl: '',
    supabaseAnonKey: '',
    cloudEnabled: false,
    lastCloudSyncAt: null,
    lastLocalSaveAt: null,
  },
  selectedAccountId: null,
  selectedMonthKey: currentMonthKey(),
  accounts: [],
};

const idb = {
  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async get() {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(DB_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      const raw = localStorage.getItem(FALLBACK_KEY);
      return raw ? JSON.parse(raw) : null;
    }
  },
  async set(value) {
    try {
      const db = await this.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, DB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(value));
    }
  },
  async clear() {
    try {
      const db = await this.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch {}
    localStorage.removeItem(FALLBACK_KEY);
  }
};

function uid() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
function parseAmount(value) {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}
function formatEuro(value) { return currency.format(Number(value || 0)); }
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthToDate(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1);
}
function formatMonth(key) { return monthFmt.format(monthToDate(key)); }
function nextMonthKey(key) {
  const d = monthToDate(key);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function previousMonthKey(key) {
  const d = monthToDate(key);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function sum(items, key = 'amount') { return items.reduce((acc, item) => acc + Number(item[key] || 0), 0); }
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
function sortedMonthKeys(months) { return Object.keys(months).sort((a, b) => a.localeCompare(b)); }

function defaultMonth(key) {
  return {
    key,
    openingBalance: 0,
    carryOverEnabled: true,
    carryOverAmount: 0,
    income: [],
    planned: [],
    unexpected: [],
    notes: '',
    archived: false,
    categoryBudgets: {}
  };
}
function defaultAccount(name = 'Compte principal') {
  const key = currentMonthKey();
  return {
    id: uid(),
    name,
    color: '#7c9cff',
    monthlyTarget: 0,
    categories: [...defaultCategories],
    months: { [key]: defaultMonth(key) }
  };
}

async function bootstrap() {
  const saved = await idb.get();
  if (saved && saved.accounts?.length) Object.assign(state, saved);
  if (!state.accounts.length) {
    const account = defaultAccount();
    state.accounts.push(account);
    state.selectedAccountId = account.id;
    state.selectedMonthKey = currentMonthKey();
    ensureMonth(getAccount(), state.selectedMonthKey, false);
    await persist();
  }
  if (!state.selectedAccountId || !getAccount()) state.selectedAccountId = state.accounts[0]?.id || null;
  ensureMonth(getAccount(), state.selectedMonthKey, false);
  applyTheme();
  bindUI();
  maybeInitSupabase();
  renderAll();
  registerPWA();
}

function getAccount() { return state.accounts.find(a => a.id === state.selectedAccountId) || state.accounts[0] || null; }
function getMonth(account = getAccount(), key = state.selectedMonthKey) {
  if (!account) return null;
  ensureMonth(account, key, false);
  return account.months[key];
}
function ensureMonth(account, key, cloneFromPrevious = false) {
  if (!account || !key) return null;
  if (!account.months[key]) {
    const month = defaultMonth(key);
    if (cloneFromPrevious) {
      const prev = account.months[previousMonthKey(key)];
      if (prev) {
        month.openingBalance = 0;
        month.carryOverEnabled = prev.carryOverEnabled;
        month.categoryBudgets = clone(prev.categoryBudgets || {});
        month.planned = prev.planned
          .filter(item => item.recurring === 'monthly' || (item.recurring === 'yearly' && item.date?.slice(5, 7) === key.slice(5, 7)))
          .map(item => ({ ...clone(item), id: uid(), checked: false }));
      }
    }
    account.months[key] = month;
  }
  recomputeCarryOver(account, key);
  return account.months[key];
}
function recomputeCarryOver(account, key) {
  const month = account.months[key];
  if (!month) return;
  if (!month.carryOverEnabled) {
    month.carryOverAmount = 0;
    return;
  }
  const prev = account.months[previousMonthKey(key)];
  month.carryOverAmount = prev ? computeMonthMetrics(prev).remaining : 0;
}

function computeMonthMetrics(month) {
  const income = sum(month.income);
  const plannedTotal = sum(month.planned);
  const plannedPaid = sum(month.planned.filter(x => x.checked));
  const unexpected = sum(month.unexpected);
  const available = Number(month.openingBalance || 0) + Number(month.carryOverAmount || 0) + income;
  const remaining = available - plannedPaid - unexpected;
  return {
    income,
    plannedTotal,
    plannedPaid,
    unexpected,
    available,
    remaining,
    pending: plannedTotal - plannedPaid,
    plannedCount: month.planned.length,
    paidCount: month.planned.filter(x => x.checked).length,
  };
}

async function persist() {
  state.settings.lastLocalSaveAt = new Date().toISOString();
  await idb.set(clone(state));
  renderStorageInfo();
}

function applyTheme() {
  document.body.classList.toggle('light', state.theme === 'light');
}

function bindUI() {
  $('#themeBtn').onclick = async () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    await persist();
  };
  $('#addAccountBtn').onclick = addAccount;
  $('#newMonthBtn').onclick = createMonth;
  $('#duplicateMonthBtn').onclick = duplicateMonth;
  $('#accountSelect').onchange = async (e) => { state.selectedAccountId = e.target.value; ensureMonth(getAccount(), state.selectedMonthKey, false); await persist(); renderAll(); };
  $('#monthSelect').onchange = async (e) => { state.selectedMonthKey = e.target.value; ensureMonth(getAccount(), state.selectedMonthKey, true); await persist(); renderAll(); };
  $('#openingBalanceInput').onchange = updateMonthSettings;
  $('#monthlyTargetInput').onchange = updateAccountSettings;
  $('#carryOverToggle').onchange = updateMonthSettings;
  $('#archiveMonthToggle').onchange = updateMonthSettings;
  $('#saveNotesBtn').onclick = async () => { getMonth().notes = $('#monthNotes').value; await persist(); toast('Notes enregistrées'); };

  $$('.tab-btn').forEach(btn => btn.onclick = () => switchTab(btn.dataset.tab));
  $$('.mini-tab').forEach(btn => btn.onclick = () => switchFormTab(btn.dataset.formtab));

  $('#incomeForm').onsubmit = onIncomeSubmit;
  $('#plannedForm').onsubmit = onPlannedSubmit;
  $('#unexpectedForm').onsubmit = onUnexpectedSubmit;
  $('#plannedStatusFilter').onchange = renderMonthLists;
  $('#searchInput').oninput = renderSearchResults;
  $('#searchTypeFilter').onchange = renderSearchResults;
  $('#searchCategoryFilter').onchange = renderSearchResults;

  $('#categoryForm').onsubmit = addCategory;
  $('#exportJsonBtn').onclick = exportJSON;
  $('#importJsonInput').onchange = importJSON;
  $('#resetAppBtn').onclick = resetApp;
  $('#exportCsvBtn').onclick = exportAnnualCSV;
  $('#printMonthBtn').onclick = () => window.print();

  $('#saveSupabaseConfigBtn').onclick = saveSupabaseConfig;
  $('#clearSupabaseConfigBtn').onclick = clearSupabaseConfig;
  $('#authForm').onsubmit = onAuthSubmit;
  $('#pushCloudBtn').onclick = pushToCloud;
  $('#pullCloudBtn').onclick = pullFromCloud;
  $('#logoutCloudBtn').onclick = logoutCloud;
}

function switchTab(tab) {
  $$('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${tab}`));
}
function switchFormTab(tab) {
  $$('.mini-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.formtab === tab));
  $('#incomeForm').classList.toggle('active', tab === 'income');
  $('#plannedForm').classList.toggle('active', tab === 'planned');
  $('#unexpectedForm').classList.toggle('active', tab === 'unexpected');
}

async function addAccount() {
  const name = prompt('Nom du compte ?');
  if (!name) return;
  const acc = defaultAccount(name.trim());
  state.accounts.push(acc);
  state.selectedAccountId = acc.id;
  state.selectedMonthKey = currentMonthKey();
  await persist();
  renderAll();
  toast('Compte créé');
}
async function createMonth() {
  const wanted = prompt('Créer quel mois ? Format AAAA-MM', nextMonthKey(state.selectedMonthKey));
  if (!wanted || !/^\d{4}-\d{2}$/.test(wanted)) return;
  ensureMonth(getAccount(), wanted, true);
  state.selectedMonthKey = wanted;
  await persist();
  renderAll();
  toast('Ligne supprimée');
}

async function duplicateMonth() {
  const next = nextMonthKey(state.selectedMonthKey);
  ensureMonth(getAccount(), next, true);
  state.selectedMonthKey = next;
  await persist();
  renderAll();
  toast(`Mois ${formatMonth(next)} prêt`);
}
async function updateMonthSettings() {
  const month = getMonth();
  month.openingBalance = parseAmount($('#openingBalanceInput').value);
  month.carryOverEnabled = $('#carryOverToggle').checked;
  month.archived = $('#archiveMonthToggle').checked;
  recomputeCarryOver(getAccount(), state.selectedMonthKey);
  await persist();
  renderAll();
}
async function updateAccountSettings() {
  const acc = getAccount();
  acc.monthlyTarget = parseAmount($('#monthlyTargetInput').value);
  await persist();
  renderAll();
}

async function onIncomeSubmit(e) {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  const month = getMonth();
  month.income.unshift({
    id: uid(),
    label: data.get('label'),
    amount: parseAmount(data.get('amount')),
    date: data.get('date') || todayISO(),
    comment: data.get('comment') || ''
  });
  e.currentTarget.reset();
  await persist();
  renderAll();
}
async function onPlannedSubmit(e) {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  const month = getMonth();
  month.planned.unshift({
    id: uid(),
    label: data.get('label'),
    amount: parseAmount(data.get('amount')),
    date: data.get('date') || '',
    category: data.get('category') || 'Autre',
    recurring: data.get('recurring') || 'none',
    comment: data.get('comment') || '',
    checked: false
  });
  e.currentTarget.reset();
  await persist();
  renderAll();
}
async function onUnexpectedSubmit(e) {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  const month = getMonth();
  month.unexpected.unshift({
    id: uid(),
    label: data.get('label'),
    amount: parseAmount(data.get('amount')),
    date: data.get('date') || todayISO(),
    category: data.get('category') || 'Autre',
    priority: data.get('priority') || 'normale',
    comment: data.get('comment') || ''
  });
  e.currentTarget.reset();
  await persist();
  renderAll();
}

function itemMeta(parts) { return parts.filter(Boolean).join(' • '); }
function actionButton(label, handler, className = 'btn btn-ghost') {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = label;
  btn.onclick = handler;
  return btn;
}

function renderAll() {
  renderSelectors();
  renderDashboard();
  renderMonthLists();
  renderSearchResults();
  renderAnnual();
  renderArchives();
  renderSettings();
  renderCloud();
  renderStorageInfo();
}

function renderSelectors() {
  const account = getAccount();
  $('#accountSelect').innerHTML = state.accounts.map(acc => `<option value="${acc.id}" ${acc.id === account.id ? 'selected' : ''}>${escapeHTML(acc.name)}</option>`).join('');
  const keys = sortedMonthKeys(account.months);
  keys.forEach(key => ensureMonth(account, key, false));
  $('#monthSelect').innerHTML = keys.map(key => `<option value="${key}" ${key === state.selectedMonthKey ? 'selected' : ''}>${capitalize(formatMonth(key))}</option>`).join('');
  $('#heroKicker').textContent = `${account.name} • ${capitalize(formatMonth(state.selectedMonthKey))}`;
}

function renderDashboard() {
  const account = getAccount();
  const month = getMonth();
  const m = computeMonthMetrics(month);
  $('#heroTitle').textContent = m.remaining >= 0 ? 'Tu gardes le contrôle de ton mois.' : 'Attention, ton mois est en dépassement.';
  $('#statRemaining').textContent = formatEuro(m.remaining);
  $('#statIncome').textContent = formatEuro(m.income);
  $('#statPlannedPaid').textContent = formatEuro(m.plannedPaid);
  $('#statUnexpected').textContent = formatEuro(m.unexpected);
  $('#openingBalanceInput').value = month.openingBalance || 0;
  $('#monthlyTargetInput').value = account.monthlyTarget || 0;
  $('#carryOverToggle').checked = !!month.carryOverEnabled;
  $('#archiveMonthToggle').checked = !!month.archived;
  $('#monthNotes').value = month.notes || '';

  const badges = [
    `Solde départ ${formatEuro(month.openingBalance || 0)}`,
    `Report ${formatEuro(month.carryOverAmount || 0)}`,
    `${m.paidCount}/${m.plannedCount} prévues payées`,
    `Prévu restant ${formatEuro(m.pending)}`
  ];
  $('#monthBadges').innerHTML = badges.map(txt => `<span class="chip">${escapeHTML(txt)}</span>`).join('');

  const max = Math.max(m.available, m.plannedPaid, m.unexpected, Math.abs(m.remaining), 1);
  $('#flowBars').innerHTML = [
    ['Entrées disponibles', m.available, ''],
    ['Prévu payé', m.plannedPaid, ''],
    ['Imprévus', m.unexpected, m.unexpected > m.available * 0.35 ? 'warning' : ''],
    ['Restant réel', Math.abs(m.remaining), m.remaining < 0 ? 'danger' : '']
  ].map(([label, value, tone]) => `
    <div class="flow-row">
      <div class="flow-head"><strong>${label}</strong><span>${formatEuro(value)}</span></div>
      <div class="progress ${tone}"><span style="width:${Math.min(100, (value / max) * 100)}%"></span></div>
    </div>
  `).join('');

  renderCategoryBudgetList(account, month);
}

function renderCategoryBudgetList(account, month) {
  const categories = account.categories || [];
  const totals = {};
  [...month.planned.filter(x => x.checked), ...month.unexpected].forEach(item => {
    const cat = item.category || 'Autre';
    totals[cat] = (totals[cat] || 0) + Number(item.amount || 0);
  });
  $('#categoryBudgetList').innerHTML = categories.map(cat => {
    const budget = Number(month.categoryBudgets?.[cat] || 0);
    const spent = Number(totals[cat] || 0);
    const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
    const tone = budget > 0 && spent > budget ? 'danger' : budget > 0 && spent > budget * 0.8 ? 'warning' : '';
    return `
      <div class="budget-row">
        <div class="budget-head">
          <strong>${escapeHTML(cat)}</strong>
          <span>${formatEuro(spent)}${budget ? ` / ${formatEuro(budget)}` : ''}</span>
        </div>
        <div class="progress ${tone}"><span style="width:${budget ? pct : 0}%"></span></div>
        <div class="section-actions wrap">
          <button class="btn btn-ghost" onclick="setCategoryBudget('${escapeAttr(cat)}')">${budget ? 'Modifier le budget' : 'Définir un budget'}</button>
        </div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Ajoute des catégories pour voir le suivi ici.</div>';
}
window.setCategoryBudget = async function (category) {
  const month = getMonth();
  const current = Number(month.categoryBudgets?.[category] || 0);
  const value = prompt(`Budget pour ${category} (€)`, current || '0');
  if (value === null) return;
  month.categoryBudgets[category] = parseAmount(value);
  await persist();
  renderAll();
};

function renderMonthLists() {
  const month = getMonth();
  const plannedFilter = $('#plannedStatusFilter').value;
  renderList('#incomeList', month.income, renderIncomeItem, 'Aucune entrée ce mois-ci.');
  renderList('#plannedList', month.planned.filter(item => plannedFilter === 'all' ? true : plannedFilter === 'done' ? item.checked : !item.checked), renderPlannedItem, 'Aucune dépense prévue.');
  renderList('#unexpectedList', month.unexpected, renderUnexpectedItem, 'Aucune dépense imprévue.');
}
function renderList(selector, items, renderer, emptyText) {
  const node = $(selector);
  if (!items.length) {
    node.className = 'list-block empty-state';
    node.textContent = emptyText;
    return;
  }
  node.className = 'list-block';
  node.innerHTML = '';
  items.forEach(item => node.appendChild(renderer(item)));
}

function renderIncomeItem(item) {
  const row = document.createElement('article');
  row.className = 'item compact';
  row.innerHTML = `
    <div class="item-main">
      <div class="item-title">${escapeHTML(item.label)}</div>
      <div class="item-meta">${escapeHTML(itemMeta([item.date, item.comment]))}</div>
    </div>
    <div class="item-actions">
      <div class="item-amount">${formatEuro(item.amount)}</div>
      <button class="btn btn-ghost danger">Supprimer</button>
    </div>`;
  row.querySelectorAll('button')[0].onclick = () => editIncome(item.id);
  row.querySelectorAll('button')[1].onclick = async () => removeItem('income', item.id);
  return row;
}
function renderPlannedItem(item) {
  const row = document.createElement('article');
  row.className = 'item';
  const recurringMap = { monthly: 'mensuel', yearly: 'annuel', none: 'ponctuel' };
  row.innerHTML = `
    <input class="check-input" type="checkbox" ${item.checked ? 'checked' : ''} aria-label="Payée" />
    <div class="item-main">
      <div class="item-title">${escapeHTML(item.label)}</div>
      <div class="item-meta">${escapeHTML(itemMeta([item.date || 'sans date', item.category, recurringMap[item.recurring], item.comment]))}</div>
      <div>${item.checked ? '<span class="badge done">Payée</span>' : '<span class="badge">À payer</span>'}</div>
    </div>
    <div class="item-actions">
      <div class="item-amount">${formatEuro(item.amount)}</div>
      <button class="btn btn-ghost">Modifier</button>
      <button class="btn btn-ghost danger">Supprimer</button>
    </div>`;
  row.querySelector('.check-input').onchange = async (e) => { item.checked = e.target.checked; await persist(); renderAll(); };
  row.querySelectorAll('button')[0].onclick = () => editPlanned(item.id);
  row.querySelectorAll('button')[1].onclick = async () => removeItem('planned', item.id);
  return row;
}
function renderUnexpectedItem(item) {
  const row = document.createElement('article');
  row.className = 'item compact';
  const badgeClass = item.priority === 'urgente' ? 'badge urgent' : item.priority === 'haute' ? 'badge high' : 'badge';
  row.innerHTML = `
    <div class="item-main">
      <div class="item-title">${escapeHTML(item.label)}</div>
      <div class="item-meta">${escapeHTML(itemMeta([item.date, item.category, item.comment]))}</div>
      <div><span class="${badgeClass}">${escapeHTML(item.priority || 'normale')}</span></div>
    </div>
    <div class="item-actions">
      <div class="item-amount">${formatEuro(item.amount)}</div>
      <button class="btn btn-ghost">Modifier</button>
      <button class="btn btn-ghost danger">Supprimer</button>
    </div>`;
  row.querySelectorAll('button')[0].onclick = () => editUnexpected(item.id);
  row.querySelectorAll('button')[1].onclick = async () => removeItem('unexpected', item.id);
  return row;
}

async function removeItem(type, id) {
  const month = getMonth();
  if (!confirm('Supprimer cette ligne ?')) return;
  month[type] = month[type].filter(item => item.id !== id);
  await persist();
  renderAll();
}

async function editIncome(id) {
  const item = getMonth().income.find(x => x.id === id);
  if (!item) return;
  const label = prompt('Libellé du crédit', item.label); if (label === null) return;
  const amount = prompt('Montant (€)', item.amount); if (amount === null) return;
  const date = prompt('Date (AAAA-MM-JJ)', item.date || todayISO()); if (date === null) return;
  const comment = prompt('Commentaire', item.comment || ''); if (comment === null) return;
  item.label = label.trim();
  item.amount = parseAmount(amount);
  item.date = date;
  item.comment = comment;
  await persist();
  renderAll();
  toast('Crédit modifié');
}

async function editPlanned(id) {
  const item = getMonth().planned.find(x => x.id === id);
  if (!item) return;
  const label = prompt('Libellé', item.label); if (label === null) return;
  const amount = prompt('Montant (€)', item.amount); if (amount === null) return;
  const date = prompt('Date prévue (AAAA-MM-JJ)', item.date || ''); if (date === null) return;
  const comment = prompt('Commentaire', item.comment || ''); if (comment === null) return;
  item.label = label.trim(); item.amount = parseAmount(amount); item.date = date; item.comment = comment;
  await persist(); renderAll();
  toast('Dépense prévue modifiée');
}

async function editUnexpected(id) {
  const item = getMonth().unexpected.find(x => x.id === id);
  if (!item) return;
  const label = prompt('Libellé', item.label); if (label === null) return;
  const amount = prompt('Montant (€)', item.amount); if (amount === null) return;
  const comment = prompt('Commentaire', item.comment || ''); if (comment === null) return;
  item.label = label.trim(); item.amount = parseAmount(amount); item.comment = comment;
  await persist(); renderAll();
  toast('Dépense imprévue modifiée');
}


function renderSearchResults() {
  const text = $('#searchInput').value.trim().toLowerCase();
  const type = $('#searchTypeFilter').value;
  const category = $('#searchCategoryFilter').value;
  const month = getMonth();
  const pack = [
    ...month.income.map(item => ({ type: 'income', item })),
    ...month.planned.map(item => ({ type: 'planned', item })),
    ...month.unexpected.map(item => ({ type: 'unexpected', item })),
  ].filter(entry => type === 'all' || entry.type === type)
   .filter(entry => category === 'all' || (entry.item.category || 'all') === category)
   .filter(entry => !text || JSON.stringify(entry.item).toLowerCase().includes(text));

  const node = $('#searchResults');
  if (!pack.length) {
    node.className = 'list-block empty-state';
    node.textContent = 'Aucun résultat.';
    return;
  }
  node.className = 'list-block';
  node.innerHTML = pack.map(({ type, item }) => `
    <article class="item compact">
      <div class="item-main">
        <div class="item-title">${escapeHTML(item.label)}</div>
        <div class="item-meta">${escapeHTML(itemMeta([typeLabel(type), item.category, item.date, item.comment]))}</div>
      </div>
      <div class="item-amount">${formatEuro(item.amount)}</div>
    </article>
  `).join('');
}
function typeLabel(type) { return ({ income: 'Entrée', planned: 'Prévue', unexpected: 'Imprévue' })[type] || type; }

function renderAnnual() {
  const account = getAccount();
  const year = state.selectedMonthKey.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const rows = months.map(key => {
    ensureMonth(account, key, false);
    const metrics = computeMonthMetrics(account.months[key]);
    return { key, ...metrics };
  });
  const max = Math.max(...rows.map(r => Math.max(r.income, Math.abs(r.remaining), r.unexpected, r.plannedPaid)), 1);
  $('#annualBars').innerHTML = rows.map(row => `
    <div class="annual-row">
      <div class="annual-head"><strong>${capitalize(monthShortFmt.format(monthToDate(row.key)))}</strong><span>${formatEuro(row.remaining)}</span></div>
      <div class="progress ${row.remaining < 0 ? 'danger' : ''}"><span style="width:${Math.min(100, (Math.abs(row.remaining) / max) * 100)}%"></span></div>
      <div class="item-meta">Entrées ${formatEuro(row.income)} • Prévu payé ${formatEuro(row.plannedPaid)} • Imprévus ${formatEuro(row.unexpected)}</div>
    </div>
  `).join('');

  const totalIncome = sum(rows, 'income');
  const totalPaid = sum(rows, 'plannedPaid');
  const totalUnexpected = sum(rows, 'unexpected');
  const totalRemaining = sum(rows, 'remaining');
  $('#annualSummary').innerHTML = [
    ['Entrées annuelles', totalIncome],
    ['Prévu payé annuel', totalPaid],
    ['Imprévus annuels', totalUnexpected],
    ['Restant cumulé', totalRemaining],
  ].map(([label, value]) => `<div class="summary-line"><span>${label}</span><strong>${formatEuro(value)}</strong></div>`).join('');
}

function renderArchives() {
  const account = getAccount();
  const archived = sortedMonthKeys(account.months)
    .filter(key => account.months[key].archived)
    .map(key => ({ key, month: account.months[key], metrics: computeMonthMetrics(account.months[key]) }));
  const node = $('#archiveList');
  if (!archived.length) {
    node.className = 'list-block empty-state';
    node.textContent = 'Aucun mois archivé.';
    return;
  }
  node.className = 'list-block';
  node.innerHTML = archived.map(({ key, metrics }) => `
    <div class="archive-row item compact">
      <div class="item-main">
        <div class="item-title">${capitalize(formatMonth(key))}</div>
        <div class="item-meta">Restant ${formatEuro(metrics.remaining)} • Entrées ${formatEuro(metrics.income)} • Imprévus ${formatEuro(metrics.unexpected)}</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-ghost" onclick="openArchivedMonth('${key}')">Ouvrir</button>
      </div>
    </div>
  `).join('');
}
window.openArchivedMonth = async function (key) {
  state.selectedMonthKey = key;
  await persist();
  renderAll();
  switchTab('month');
};

function renderSettings() {
  const acc = getAccount();
  const month = getMonth();
  const categories = acc.categories;
  const categoryOptions = ['<option value="all">Toutes</option>', ...categories.map(c => `<option value="${escapeAttr(c)}">${escapeHTML(c)}</option>`)].join('');
  $('#searchCategoryFilter').innerHTML = categoryOptions;
  document.querySelectorAll('select[name="category"]').forEach(sel => {
    const current = sel.value;
    sel.innerHTML = categories.map(c => `<option value="${escapeAttr(c)}">${escapeHTML(c)}</option>`).join('');
    if (categories.includes(current)) sel.value = current;
  });

  $('#categoryTags').innerHTML = categories.map(cat => `
    <span class="tag">${escapeHTML(cat)} <button onclick="removeCategory('${escapeAttr(cat)}')">×</button></span>
  `).join('');

  $('#accountCards').innerHTML = state.accounts.map(account => {
    const selected = account.id === acc.id;
    return `
      <div class="account-card">
        <header>
          <strong>${escapeHTML(account.name)}</strong>
          <span>${selected ? 'Sélectionné' : ''}</span>
        </header>
        <div class="item-meta">${Object.keys(account.months).length} mois • ${account.categories.length} catégories</div>
        <div class="section-actions wrap">
          <button class="btn btn-ghost" onclick="renameAccount('${account.id}')">Renommer</button>
          <button class="btn btn-ghost ${selected ? 'hidden' : ''}" onclick="selectAccount('${account.id}')">Choisir</button>
          <button class="btn btn-ghost danger" onclick="deleteAccount('${account.id}')" ${state.accounts.length === 1 ? 'disabled' : ''}>Supprimer</button>
        </div>
      </div>
    `;
  }).join('');
}
window.renameAccount = async function (id) {
  const account = state.accounts.find(a => a.id === id); if (!account) return;
  const name = prompt('Nouveau nom du compte', account.name); if (!name) return;
  account.name = name.trim(); await persist(); renderAll();
};
window.selectAccount = async function (id) { state.selectedAccountId = id; await persist(); renderAll(); };
window.deleteAccount = async function (id) {
  if (state.accounts.length === 1) return;
  if (!confirm('Supprimer ce compte et tous ses mois ?')) return;
  state.accounts = state.accounts.filter(a => a.id !== id);
  state.selectedAccountId = state.accounts[0].id;
  await persist(); renderAll();
};
window.removeCategory = async function (category) {
  const acc = getAccount();
  if (!confirm(`Supprimer la catégorie ${category} ?`)) return;
  acc.categories = acc.categories.filter(c => c !== category);
  Object.values(acc.months).forEach(month => {
    delete month.categoryBudgets[category];
    month.planned.forEach(item => { if (item.category === category) item.category = 'Autre'; });
    month.unexpected.forEach(item => { if (item.category === category) item.category = 'Autre'; });
  });
  if (!acc.categories.includes('Autre')) acc.categories.push('Autre');
  await persist(); renderAll();
};
async function addCategory(e) {
  e.preventDefault();
  const input = $('#newCategoryInput');
  const value = input.value.trim();
  if (!value) return;
  const acc = getAccount();
  if (!acc.categories.includes(value)) acc.categories.push(value);
  input.value = '';
  await persist();
  renderAll();
}

function renderCloud() {
  $('#supabaseUrlInput').value = state.settings.supabaseUrl || '';
  $('#supabaseAnonKeyInput').value = state.settings.supabaseAnonKey || '';
  const user = supabaseClient?.auth ? null : null;
  $('#cloudStatusBox').innerHTML = `
    <strong>Mode actuel :</strong> ${state.settings.cloudEnabled ? 'Cloud prêt' : 'Local uniquement'}<br>
    <strong>Dernière synchro :</strong> ${state.settings.lastCloudSyncAt ? new Date(state.settings.lastCloudSyncAt).toLocaleString('fr-FR') : 'Jamais'}<br>
    <strong>Fonctionnement :</strong> les données restent d’abord dans IndexedDB, puis tu peux envoyer ou récupérer un snapshot complet.
  `;
}
async function saveSupabaseConfig() {
  state.settings.supabaseUrl = $('#supabaseUrlInput').value.trim();
  state.settings.supabaseAnonKey = $('#supabaseAnonKeyInput').value.trim();
  state.settings.cloudEnabled = !!(state.settings.supabaseUrl && state.settings.supabaseAnonKey);
  maybeInitSupabase();
  await persist();
  renderCloud();
  toast(state.settings.cloudEnabled ? 'Configuration cloud enregistrée' : 'Configuration vide');
}
async function clearSupabaseConfig() {
  state.settings.supabaseUrl = '';
  state.settings.supabaseAnonKey = '';
  state.settings.cloudEnabled = false;
  supabaseClient = null;
  await persist();
  renderCloud();
  toast('Configuration cloud effacée');
}
function maybeInitSupabase() {
  if (!state.settings.supabaseUrl || !state.settings.supabaseAnonKey || !window.supabase?.createClient) return;
  try {
    supabaseClient = window.supabase.createClient(state.settings.supabaseUrl, state.settings.supabaseAnonKey);
  } catch (err) {
    console.error(err);
    toast('Configuration Supabase invalide');
  }
}
async function onAuthSubmit(e) {
  e.preventDefault();
  if (!supabaseClient) return toast('Enregistre d’abord ta configuration Supabase');
  const data = new FormData(e.currentTarget);
  const email = data.get('email');
  const password = data.get('password');
  const action = e.submitter?.value;
  try {
    if (action === 'signup') {
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      toast('Compte créé. Vérifie ton email si une confirmation est demandée.');
    } else if (action === 'signin') {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast('Connectée au cloud');
    } else {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
      if (error) throw error;
      toast('Email de réinitialisation envoyé');
    }
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erreur d’authentification');
  }
}
async function requireCloudUser() {
  if (!supabaseClient) throw new Error('Configuration Supabase absente');
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Connecte-toi d’abord au cloud');
  return data.user;
}
async function pushToCloud() {
  try {
    const user = await requireCloudUser();
    const payload = clone(state);
    const { error } = await supabaseClient.from('budget_snapshots').upsert({ user_id: user.id, payload, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    state.settings.lastCloudSyncAt = new Date().toISOString();
    await persist();
    renderCloud();
    toast('Sauvegarde cloud effectuée');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Échec de la sauvegarde cloud');
  }
}
async function pullFromCloud() {
  try {
    const user = await requireCloudUser();
    const { data, error } = await supabaseClient.from('budget_snapshots').select('payload, updated_at').eq('user_id', user.id).single();
    if (error) throw error;
    if (!data?.payload) throw new Error('Aucune sauvegarde cloud trouvée');
    Object.assign(state, data.payload);
    state.settings.lastCloudSyncAt = new Date().toISOString();
    maybeInitSupabase();
    await persist();
    renderAll();
    toast('Données récupérées depuis le cloud');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Échec de la récupération cloud');
  }
}
async function logoutCloud() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  toast('Déconnectée du cloud');
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `budget-flow-v4-${state.selectedMonthKey}.json`);
}
async function importJSON(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed.accounts?.length) throw new Error('Fichier invalide');
    Object.assign(state, parsed);
    maybeInitSupabase();
    await persist();
    renderAll();
    toast('Import réussi');
  } catch (err) {
    toast(err.message || 'Import impossible');
  } finally {
    e.target.value = '';
  }
}
async function resetApp() {
  if (!confirm('Réinitialiser complètement l’application ?')) return;
  await idb.clear();
  Object.assign(state, {
    theme: 'dark',
    settings: { supabaseUrl: '', supabaseAnonKey: '', cloudEnabled: false, lastCloudSyncAt: null, lastLocalSaveAt: null },
    selectedAccountId: null,
    selectedMonthKey: currentMonthKey(),
    accounts: [defaultAccount()]
  });
  state.selectedAccountId = state.accounts[0].id;
  supabaseClient = null;
  await persist();
  renderAll();
  toast('Application réinitialisée');
}
function exportAnnualCSV() {
  const account = getAccount();
  const year = state.selectedMonthKey.slice(0, 4);
  const rows = [['mois', 'entrees', 'prevu_paye', 'imprevus', 'restant']];
  for (let i = 1; i <= 12; i++) {
    const key = `${year}-${String(i).padStart(2, '0')}`;
    ensureMonth(account, key, false);
    const m = computeMonthMetrics(account.months[key]);
    rows.push([key, m.income, m.plannedPaid, m.unexpected, m.remaining]);
  }
  const csv = rows.map(r => r.join(';')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `budget-flow-${account.name}-${year}.csv`);
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function renderStorageInfo() {
  $('#storageInfo').innerHTML = `
    <strong>Stockage :</strong> IndexedDB locale dans le navigateur<br>
    <strong>Dernière sauvegarde locale :</strong> ${state.settings.lastLocalSaveAt ? new Date(state.settings.lastLocalSaveAt).toLocaleString('fr-FR') : 'Jamais'}<br>
    <strong>Mode :</strong> ${state.settings.cloudEnabled ? 'Local + cloud optionnel' : 'Local uniquement'}
  `;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => node.classList.add('hidden'), 2600);
}
function capitalize(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }
function escapeHTML(str = '') {
  return String(str).replace(/[&<>'"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escapeAttr(str = '') { return String(str).replace(/'/g, '&#39;'); }

function registerPWA() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(console.error);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#installBtn').classList.remove('hidden');
  });
  $('#installBtn').onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt = null;
    $('#installBtn').classList.add('hidden');
  };
}

bootstrap();