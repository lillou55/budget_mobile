const { createClient } = window.supabase;

const DEFAULT_CATEGORIES = [
  "Loyer",
  "Courses",
  "Transport",
  "Santé",
  "Factures",
  "Loisirs",
  "Épargne",
  "Divers"
];

const state = {
  supabase: null,
  session: null,
  data: null,
  activeAccountId: null,
  activeMonth: null,
  filters: { search: "", category: "all", status: "all" },
  saveTimer: null,
  theme: localStorage.getItem("budgetflow_theme") || "dark",
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindEls();
  applyTheme(state.theme);
  restoreConfig();
  wireAuth();
  wireApp();
  registerServiceWorker();
}

function bindEls() {
  [
    "authView","appView","supabaseUrl","supabaseAnonKey","saveConfigBtn","testConfigBtn","emailInput","passwordInput","signInBtn","signUpBtn",
    "themeToggle","signOutBtn","accountSelect","monthSelect","dashboardTitle","statsGrid","spendRateLabel","spendRateBar","plannedList",
    "incomeList","unexpectedList","searchInput","categoryFilter","statusFilter","monthlyNotes","openingBalanceInput","monthlyTargetInput",
    "saveMonthSettingsBtn","syncNowBtn","duplicateMonthBtn","newAccountBtn","addIncomeBtn","addPlannedBtn","addUnexpectedBtn","addIncomeBtn2",
    "addPlannedBtn2","addUnexpectedBtn2","manageCategoriesBtn","annualChart","annualSummary","reloadCloudBtn","saveCloudBtn","syncStateLabel",
    "syncStateText","importJsonInput","exportJsonBtn","exportCsvBtn","modalRoot","toast"
  ].forEach(id => els[id] = document.getElementById(id));

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "annualTab") renderAnnual();
    });
  });
}

function wireAuth() {
  els.saveConfigBtn.addEventListener("click", saveConfig);
  els.testConfigBtn.addEventListener("click", testConfig);
  els.signInBtn.addEventListener("click", signIn);
  els.signUpBtn.addEventListener("click", signUp);
  els.signOutBtn.addEventListener("click", signOut);
  els.themeToggle.addEventListener("click", () => {
    const next = document.body.classList.contains("light") ? "dark" : "light";
    applyTheme(next);
  });

  if (buildClient()) {
    state.supabase.auth.getSession().then(({ data }) => {
      if (data.session) handleSession(data.session);
    });
    state.supabase.auth.onAuthStateChange((_event, session) => {
      if (session) handleSession(session);
      else showAuth();
    });
  }
}

function wireApp() {
  els.accountSelect.addEventListener("change", () => {
    state.activeAccountId = els.accountSelect.value;
    ensureActiveMonth();
    render();
  });
  els.monthSelect.addEventListener("change", () => {
    state.activeMonth = els.monthSelect.value;
    render();
  });
  els.searchInput.addEventListener("input", e => { state.filters.search = e.target.value.trim().toLowerCase(); renderLists(); });
  els.categoryFilter.addEventListener("change", e => { state.filters.category = e.target.value; renderLists(); });
  els.statusFilter.addEventListener("change", e => { state.filters.status = e.target.value; renderLists(); });
  els.monthlyNotes.addEventListener("input", () => { getCurrentMonthData().notes = els.monthlyNotes.value; scheduleSave("Notes mises à jour"); });
  els.saveMonthSettingsBtn.addEventListener("click", saveMonthSettings);
  els.syncNowBtn.addEventListener("click", () => saveRemote(true));
  els.saveCloudBtn.addEventListener("click", () => saveRemote(true));
  els.reloadCloudBtn.addEventListener("click", loadRemote);
  els.duplicateMonthBtn.addEventListener("click", duplicateMonthForward);
  els.newAccountBtn.addEventListener("click", () => openAccountModal());
  [els.addIncomeBtn, els.addIncomeBtn2].forEach(btn => btn.addEventListener("click", () => openEntryModal("income")));
  [els.addPlannedBtn, els.addPlannedBtn2].forEach(btn => btn.addEventListener("click", () => openEntryModal("planned")));
  [els.addUnexpectedBtn, els.addUnexpectedBtn2].forEach(btn => btn.addEventListener("click", () => openEntryModal("unexpected")));
  els.manageCategoriesBtn.addEventListener("click", openCategoriesModal);
  els.exportJsonBtn.addEventListener("click", exportJson);
  els.exportCsvBtn.addEventListener("click", exportAnnualCsv);
  els.importJsonInput.addEventListener("change", importJson);
}

function applyTheme(theme) {
  state.theme = theme;
  document.body.classList.toggle("light", theme === "light");
  localStorage.setItem("budgetflow_theme", theme);
}

function restoreConfig() {
  els.supabaseUrl.value = localStorage.getItem("budgetflow_supabase_url") || "";
  els.supabaseAnonKey.value = localStorage.getItem("budgetflow_supabase_anon") || "";
}

function saveConfig() {
  localStorage.setItem("budgetflow_supabase_url", els.supabaseUrl.value.trim());
  localStorage.setItem("budgetflow_supabase_anon", els.supabaseAnonKey.value.trim());
  if (buildClient()) {
    toast("Configuration enregistrée");
  }
}

function buildClient() {
  const url = els.supabaseUrl.value.trim();
  const key = els.supabaseAnonKey.value.trim();
  if (!url || !key) return false;
  try {
    state.supabase = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return true;
  } catch (e) {
    toast("Configuration Supabase invalide");
    return false;
  }
}

async function testConfig() {
  if (!buildClient()) return toast("Ajoute l’URL et la clé anon");
  const { error } = await state.supabase.from("budget_snapshots").select("updated_at").limit(1);
  toast(error ? `Connexion OK, mais table/policies à vérifier` : "Connexion Supabase OK");
}

async function signUp() {
  if (!buildClient()) return toast("Enregistre d’abord la config Supabase");
  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value;
  if (!email || !password) return toast("Email et mot de passe requis");
  const { error } = await state.supabase.auth.signUp({ email, password });
  if (error) return toast(error.message);
  toast("Compte créé. Vérifie tes emails si confirmation activée.");
}

async function signIn() {
  if (!buildClient()) return toast("Enregistre d’abord la config Supabase");
  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value;
  const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
  if (error) return toast(error.message);
  handleSession(data.session);
}

async function signOut() {
  await state.supabase?.auth.signOut();
  state.session = null;
  state.data = null;
  showAuth();
}

async function handleSession(session) {
  state.session = session;
  els.signOutBtn.classList.remove("hidden");
  showApp();
  await loadRemote();
}

function showAuth() {
  els.authView.classList.remove("hidden");
  els.appView.classList.add("hidden");
  els.signOutBtn.classList.add("hidden");
}

function showApp() {
  els.authView.classList.add("hidden");
  els.appView.classList.remove("hidden");
}

function defaultData() {
  const month = monthKey(new Date());
  const accountId = crypto.randomUUID();
  return {
    version: 1,
    categories: [...DEFAULT_CATEGORIES],
    accounts: [{ id: accountId, name: "Compte personnel", color: "#6d8cff", monthlyTarget: 0, months: { [month]: makeEmptyMonth() } }],
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  };
}

function makeEmptyMonth(fromPrevious = null) {
  return {
    openingBalance: fromPrevious?.carryOver ?? 0,
    monthlyTarget: fromPrevious?.monthlyTarget ?? 0,
    incomes: [],
    planned: (fromPrevious?.planned || []).filter(i => i.recurring).map(i => ({ ...i, id: crypto.randomUUID(), paid: false })),
    unexpected: [],
    notes: ""
  };
}

async function loadRemote() {
  if (!state.supabase || !state.session?.user) return;
  setSyncState("Chargement...", "Récupération des données cloud...");
  const userId = state.session.user.id;
  const { data, error } = await state.supabase.from("budget_snapshots").select("payload, updated_at").eq("user_id", userId).maybeSingle();
  if (error) {
    setSyncState("Erreur cloud", error.message);
    return toast(error.message);
  }
  state.data = data?.payload || defaultData();
  touchMeta();
  normalizeData();
  state.activeAccountId ||= state.data.accounts[0]?.id;
  ensureActiveMonth();
  render();
  setSyncState("Synchronisé", data?.updated_at ? `Dernière synchro: ${formatDateTime(data.updated_at)}` : "Première session prête");
  if (!data) await saveRemote();
}

async function saveRemote(forceToast = false) {
  if (!state.supabase || !state.session?.user || !state.data) return;
  touchMeta();
  const payload = structuredClone(state.data);
  const { error } = await state.supabase.from("budget_snapshots").upsert({
    user_id: state.session.user.id,
    payload,
    updated_at: new Date().toISOString()
  });
  if (error) {
    setSyncState("Erreur de sauvegarde", error.message);
    return toast(error.message);
  }
  setSyncState("Synchronisé", `Dernière synchro: ${formatDateTime(new Date())}`);
  if (forceToast) toast("Sauvegarde cloud effectuée");
}

function scheduleSave(message) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveRemote(), 650);
  render();
  if (message) setSyncState("Modification locale", `${message}. Sauvegarde en cours...`);
}

function touchMeta() {
  if (!state.data.meta) state.data.meta = {};
  state.data.meta.updatedAt = new Date().toISOString();
}

function normalizeData() {
  state.data.categories = Array.isArray(state.data.categories) && state.data.categories.length ? state.data.categories : [...DEFAULT_CATEGORIES];
  if (!Array.isArray(state.data.accounts) || !state.data.accounts.length) {
    const replacement = defaultData();
    state.data.accounts = replacement.accounts;
  }
  state.data.accounts.forEach(account => {
    account.months ||= {};
    Object.keys(account.months).forEach(month => {
      const m = account.months[month];
      m.incomes ||= [];
      m.planned ||= [];
      m.unexpected ||= [];
      m.notes ||= "";
      if (typeof m.openingBalance !== "number") m.openingBalance = Number(m.openingBalance || 0);
      if (typeof m.monthlyTarget !== "number") m.monthlyTarget = Number(m.monthlyTarget || account.monthlyTarget || 0);
    });
  });
}

function getActiveAccount() {
  return state.data.accounts.find(a => a.id === state.activeAccountId) || state.data.accounts[0];
}

function ensureActiveMonth() {
  const account = getActiveAccount();
  if (!account) return;
  const months = Object.keys(account.months).sort();
  state.activeMonth ||= months.at(-1) || monthKey(new Date());
  if (!account.months[state.activeMonth]) account.months[state.activeMonth] = makeEmptyMonth();
}

function getCurrentMonthData() {
  const account = getActiveAccount();
  ensureActiveMonth();
  return account.months[state.activeMonth];
}

function computeMonth(account, month) {
  const m = account.months[month];
  const incomeTotal = sum(m.incomes, "amount");
  const plannedPaid = m.planned.filter(x => x.paid).reduce((s, x) => s + Number(x.amount || 0), 0);
  const plannedTotal = sum(m.planned, "amount");
  const unexpectedTotal = sum(m.unexpected, "amount");
  const opening = Number(m.openingBalance || 0);
  const realRemaining = opening + incomeTotal - plannedPaid - unexpectedTotal;
  const forecastRemaining = opening + incomeTotal - plannedTotal - unexpectedTotal;
  const totalSpent = plannedPaid + unexpectedTotal;
  return { opening, incomeTotal, plannedPaid, plannedTotal, unexpectedTotal, realRemaining, forecastRemaining, totalSpent };
}

function render() {
  if (!state.data) return;
  normalizeData();
  renderSelectors();
  renderStats();
  renderLists();
  renderNotesAndSettings();
  renderAnnual();
}

function renderSelectors() {
  const accounts = state.data.accounts;
  els.accountSelect.innerHTML = accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  els.accountSelect.value = state.activeAccountId;
  const account = getActiveAccount();
  const months = Object.keys(account.months).sort();
  els.monthSelect.innerHTML = months.map(m => `<option value="${m}">${formatMonth(m)}</option>`).join("");
  if (!months.includes(state.activeMonth)) state.activeMonth = months.at(-1);
  els.monthSelect.value = state.activeMonth;
  const options = ['<option value="all">Toutes</option>'].concat(state.data.categories.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`));
  els.categoryFilter.innerHTML = options.join("");
  els.categoryFilter.value = state.filters.category;
  els.dashboardTitle.textContent = `${account.name} · ${formatMonth(state.activeMonth)}`;
}

function renderStats() {
  const account = getActiveAccount();
  const s = computeMonth(account, state.activeMonth);
  const cards = [
    ["Solde de départ", money(s.opening)],
    ["Crédits du mois", money(s.incomeTotal)],
    ["Dépensé réel", money(s.totalSpent)],
    ["Restant réel", money(s.realRemaining)],
    ["Prévu total", money(s.plannedTotal)],
    ["Imprévues", money(s.unexpectedTotal)],
    ["Restant prévisionnel", money(s.forecastRemaining)],
    ["Budget cible", money(getCurrentMonthData().monthlyTarget || 0)]
  ];
  els.statsGrid.innerHTML = cards.map(([label, value]) => `<div class="stat-card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("");
  const base = Math.max(1, s.opening + s.incomeTotal);
  const rate = Math.min(100, Math.max(0, Math.round((s.totalSpent / base) * 100)));
  els.spendRateLabel.textContent = `${rate}%`;
  els.spendRateBar.style.width = `${rate}%`;
}

function renderLists() {
  const m = getCurrentMonthData();
  const filterFn = item => {
    const matchesText = !state.filters.search || [item.label, item.comment, item.category, item.priority, item.date].join(" ").toLowerCase().includes(state.filters.search);
    const matchesCategory = state.filters.category === "all" || item.category === state.filters.category;
    const matchesStatus = state.filters.status === "all"
      || (state.filters.status === "pending" && item.type === "planned" && !item.paid)
      || (state.filters.status === "paid" && item.type === "planned" && item.paid)
      || (state.filters.status === "unexpected" && item.type === "unexpected");
    return matchesText && matchesCategory && matchesStatus;
  };

  const planned = m.planned.map(i => ({ ...i, type: "planned" })).filter(filterFn).sort((a,b) => (a.date||"").localeCompare(b.date||""));
  const unexpected = m.unexpected.map(i => ({ ...i, type: "unexpected" })).filter(filterFn);
  const incomes = m.incomes.filter(i => {
    const matchesText = !state.filters.search || [i.label, i.comment, i.category, i.date].join(" ").toLowerCase().includes(state.filters.search);
    const matchesCategory = state.filters.category === "all" || i.category === state.filters.category;
    return matchesText && matchesCategory;
  });

  els.plannedList.innerHTML = planned.length ? planned.map(itemCard).join("") : emptyState("Aucune dépense prévue pour ce filtre.");
  els.unexpectedList.innerHTML = unexpected.length ? unexpected.map(itemCard).join("") : emptyState("Aucune dépense imprévue.");
  els.incomeList.innerHTML = incomes.length ? incomes.map(itemCard).join("") : emptyState("Aucun crédit enregistré.");

  bindListActions();
}

function itemCard(item) {
  const amount = money(item.amount || 0);
  const pills = [
    item.category ? `<span class="pill">${escapeHtml(item.category)}</span>` : "",
    item.date ? `<span class="pill">${escapeHtml(item.date)}</span>` : "",
    item.recurring ? `<span class="pill">Récurrente</span>` : "",
    item.priority ? `<span class="pill ${item.priority === 'Haute' ? 'danger' : 'warning'}">${escapeHtml(item.priority)}</span>` : "",
    item.paid ? `<span class="pill success">Payée</span>` : item.type === "planned" ? `<span class="pill warning">À payer</span>` : ""
  ].join("");
  return `
    <article class="item-card">
      <div class="item-head">
        <div>
          <div class="item-title">${escapeHtml(item.label || 'Sans titre')}</div>
          <div class="item-meta">${pills}</div>
          ${item.comment ? `<p class="hint" style="margin-top:10px;">${escapeHtml(item.comment)}</p>` : ''}
        </div>
        <strong>${amount}</strong>
      </div>
      <div class="item-actions">
        ${item.type === 'planned' ? `<button class="secondary" data-action="toggle-paid" data-id="${item.id}">${item.paid ? 'Décocher' : 'Cocher payé'}</button>` : ''}
        <button class="secondary" data-action="edit-${item.type}" data-id="${item.id}">Modifier</button>
        <button class="ghost" data-action="delete-${item.type}" data-id="${item.id}">Supprimer</button>
      </div>
    </article>
  `;
}

function bindListActions() {
  document.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const { action, id } = btn.dataset;
      const m = getCurrentMonthData();
      if (action === "toggle-paid") {
        const item = m.planned.find(x => x.id === id);
        item.paid = !item.paid;
        scheduleSave("Statut modifié");
        return;
      }
      if (action === "edit-planned") return openEntryModal("planned", m.planned.find(x => x.id === id));
      if (action === "edit-unexpected") return openEntryModal("unexpected", m.unexpected.find(x => x.id === id));
      if (action === "edit-income") return openEntryModal("income", m.incomes.find(x => x.id === id));
      if (action === "delete-planned") m.planned = m.planned.filter(x => x.id !== id);
      if (action === "delete-unexpected") m.unexpected = m.unexpected.filter(x => x.id !== id);
      if (action === "delete-income") m.incomes = m.incomes.filter(x => x.id !== id);
      scheduleSave("Ligne supprimée");
    });
  });
}

function renderNotesAndSettings() {
  const m = getCurrentMonthData();
  els.monthlyNotes.value = m.notes || "";
  els.openingBalanceInput.value = Number(m.openingBalance || 0);
  els.monthlyTargetInput.value = Number(m.monthlyTarget || 0);
}

function renderAnnual() {
  if (!state.data) return;
  const account = getActiveAccount();
  const months = Object.keys(account.months).sort();
  const year = state.activeMonth?.slice(0,4) || String(new Date().getFullYear());
  const sameYear = months.filter(m => m.startsWith(year));
  const rows = sameYear.map(month => ({ month, ...computeMonth(account, month) }));
  drawChart(rows);
  const totalIncome = rows.reduce((s,r) => s + r.incomeTotal, 0);
  const totalSpent = rows.reduce((s,r) => s + r.totalSpent, 0);
  const avgRemaining = rows.length ? rows.reduce((s,r) => s + r.realRemaining, 0)/rows.length : 0;
  els.annualSummary.innerHTML = [
    ["Crédits annuels", money(totalIncome)],
    ["Dépenses réelles", money(totalSpent)],
    ["Restant moyen", money(avgRemaining)]
  ].map(([label, value]) => `<div class="stat-card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("");
}

function drawChart(rows) {
  const canvas = els.annualChart;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 800;
  const h = 240;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0,0,w,h);
  if (!rows.length) return;
  const max = Math.max(...rows.map(r => Math.max(r.totalSpent, r.incomeTotal, 1)));
  const barW = w / (rows.length * 2);
  rows.forEach((r, i) => {
    const x = 24 + i * (barW * 2);
    const spentH = (r.totalSpent / max) * (h - 60);
    const incomeH = (r.incomeTotal / max) * (h - 60);
    ctx.fillStyle = "rgba(45,212,191,0.85)";
    ctx.fillRect(x, h - 28 - incomeH, barW - 6, incomeH);
    ctx.fillStyle = "rgba(109,140,255,0.9)";
    ctx.fillRect(x + barW, h - 28 - spentH, barW - 6, spentH);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "12px sans-serif";
    ctx.fillText(r.month.slice(5), x, h - 8);
  });
}

function saveMonthSettings() {
  const m = getCurrentMonthData();
  m.openingBalance = Number(els.openingBalanceInput.value || 0);
  m.monthlyTarget = Number(els.monthlyTargetInput.value || 0);
  scheduleSave("Paramètres du mois enregistrés");
}

function duplicateMonthForward() {
  const account = getActiveAccount();
  const current = state.activeMonth;
  const next = nextMonthKey(current);
  if (account.months[next]) {
    state.activeMonth = next;
    render();
    return toast("Le mois suivant existe déjà");
  }
  const sourceStats = computeMonth(account, current);
  const source = getCurrentMonthData();
  account.months[next] = makeEmptyMonth({
    carryOver: sourceStats.realRemaining,
    planned: source.planned,
    monthlyTarget: source.monthlyTarget
  });
  state.activeMonth = next;
  scheduleSave("Mois suivant créé");
}

function openAccountModal(existing = null) {
  const isEdit = !!existing;
  openModal({
    title: isEdit ? "Modifier le compte" : "Nouveau compte",
    body: `
      <div class="modal-grid">
        <label><span>Nom du compte</span><input id="modalAccountName" value="${escapeAttr(existing?.name || '')}" /></label>
        <label><span>Budget mensuel cible</span><input id="modalAccountTarget" type="number" step="0.01" value="${existing?.monthlyTarget || 0}" /></label>
      </div>
    `,
    onSave: () => {
      const name = document.getElementById("modalAccountName").value.trim();
      const monthlyTarget = Number(document.getElementById("modalAccountTarget").value || 0);
      if (!name) return toast("Nom du compte requis");
      if (existing) {
        existing.name = name;
        existing.monthlyTarget = monthlyTarget;
      } else {
        const id = crypto.randomUUID();
        const mk = monthKey(new Date());
        state.data.accounts.push({ id, name, color: "#6d8cff", monthlyTarget, months: { [mk]: makeEmptyMonth() } });
        state.activeAccountId = id;
        state.activeMonth = mk;
      }
      scheduleSave("Compte enregistré");
      closeModal();
    }
  });
}

function openCategoriesModal() {
  openModal({
    title: "Catégories",
    body: `
      <label><span>Liste des catégories (une par ligne)</span>
        <textarea id="modalCategories" rows="10">${escapeHtml(state.data.categories.join("\n"))}</textarea>
      </label>
    `,
    onSave: () => {
      const values = document.getElementById("modalCategories").value.split("\n").map(v => v.trim()).filter(Boolean);
      state.data.categories = [...new Set(values.length ? values : DEFAULT_CATEGORIES)];
      scheduleSave("Catégories mises à jour");
      closeModal();
    }
  });
}

function openEntryModal(type, existing = null) {
  const titleMap = { planned: "Dépense prévue", unexpected: "Dépense imprévue", income: "Crédit" };
  const categories = state.data.categories.map(c => `<option value="${escapeAttr(c)}" ${existing?.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join("");
  openModal({
    title: existing ? `Modifier · ${titleMap[type]}` : `Ajouter · ${titleMap[type]}`,
    body: `
      <div class="modal-grid">
        <label><span>Libellé</span><input id="entryLabel" value="${escapeAttr(existing?.label || '')}" /></label>
        <label><span>Montant</span><input id="entryAmount" type="number" step="0.01" value="${existing?.amount || ''}" /></label>
        <label><span>Date prévue / date</span><input id="entryDate" type="date" value="${existing?.date || ''}" /></label>
        <label><span>Catégorie</span><select id="entryCategory">${categories}</select></label>
        ${type === 'unexpected' ? `<label><span>Priorité</span><select id="entryPriority"><option ${existing?.priority==='Normale'?'selected':''}>Normale</option><option ${existing?.priority==='Haute'?'selected':''}>Haute</option></select></label>` : ''}
        ${type === 'planned' ? `<label class="checkbox-row"><input id="entryPaid" type="checkbox" ${existing?.paid ? 'checked' : ''} /> Déjà payée</label>
        <label class="checkbox-row"><input id="entryRecurring" type="checkbox" ${existing?.recurring ? 'checked' : ''} /> Reporter au mois suivant</label>` : ''}
      </div>
      <label style="margin-top:12px; display:block;"><span>Commentaire</span><textarea id="entryComment" rows="4">${escapeHtml(existing?.comment || '')}</textarea></label>
    `,
    onSave: () => {
      const item = {
        id: existing?.id || crypto.randomUUID(),
        label: document.getElementById("entryLabel").value.trim(),
        amount: Number(document.getElementById("entryAmount").value || 0),
        date: document.getElementById("entryDate").value || "",
        category: document.getElementById("entryCategory").value || "Divers",
        comment: document.getElementById("entryComment").value.trim()
      };
      if (!item.label || !item.amount) return toast("Libellé et montant requis");
      if (type === 'planned') {
        item.paid = document.getElementById("entryPaid").checked;
        item.recurring = document.getElementById("entryRecurring").checked;
      }
      if (type === 'unexpected') item.priority = document.getElementById("entryPriority").value;
      const m = getCurrentMonthData();
      const key = type === 'income' ? 'incomes' : type === 'planned' ? 'planned' : 'unexpected';
      const list = m[key];
      const idx = list.findIndex(x => x.id === item.id);
      if (idx >= 0) list[idx] = item; else list.push(item);
      scheduleSave("Ligne enregistrée");
      closeModal();
    }
  });
}

function openModal({ title, body, onSave }) {
  els.modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal">
        <div class="section-head compact"><h2>${title}</h2></div>
        ${body}
        <div class="modal-footer">
          <button class="secondary" id="modalCancel">Annuler</button>
          <button id="modalSave">Enregistrer</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("modalCancel").addEventListener("click", closeModal);
  document.getElementById("modalBackdrop").addEventListener("click", e => { if (e.target.id === 'modalBackdrop') closeModal(); });
  document.getElementById("modalSave").addEventListener("click", onSave);
}

function closeModal() { els.modalRoot.innerHTML = ""; }

function exportJson() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `budget-flow-cloud-${state.activeMonth}.json`);
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      state.data = JSON.parse(reader.result);
      normalizeData();
      state.activeAccountId = state.data.accounts[0]?.id;
      ensureActiveMonth();
      render();
      await saveRemote(true);
      toast("JSON importé et synchronisé");
    } catch {
      toast("Fichier JSON invalide");
    }
  };
  reader.readAsText(file);
}

function exportAnnualCsv() {
  const account = getActiveAccount();
  const year = state.activeMonth.slice(0,4);
  const rows = Object.keys(account.months).sort().filter(m => m.startsWith(year)).map(month => {
    const s = computeMonth(account, month);
    return [month, s.opening, s.incomeTotal, s.plannedTotal, s.plannedPaid, s.unexpectedTotal, s.totalSpent, s.realRemaining].join(",");
  });
  const csv = ["mois,solde_depart,credits,prevu_total,prevu_paye,imprevues,depense_reelle,restant_reel", ...rows].join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `budget-flow-${account.name}-${year}.csv`);
}

function setSyncState(label, text) {
  els.syncStateLabel.textContent = label;
  els.syncStateText.textContent = text;
}

function sum(arr, key) { return arr.reduce((s, x) => s + Number(x[key] || 0), 0); }
function money(n) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n || 0)); }
function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`; }
function nextMonthKey(month) {
  const [y,m] = month.split("-").map(Number);
  const d = new Date(y, m, 1);
  return monthKey(d);
}
function formatMonth(key) {
  const [y,m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date(y, m-1, 1));
}
function formatDateTime(value) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function emptyState(label) { return `<div class="info-card">${label}</div>`; }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(els.toast._t);
  els.toast._t = setTimeout(() => els.toast.classList.add("hidden"), 2600);
}
function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function escapeAttr(value = "") { return escapeHtml(value); }

function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}
