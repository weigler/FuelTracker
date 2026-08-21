/* ============================================================
   Tanque Cheio — app.js
   Firebase Auth + Firestore, cálculo de consumo, gráficos
   ============================================================ */

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let vehicles = [];      // todos os veículos do grupo
let fuelups = [];       // todos os abastecimentos do grupo
let backups = [];       // snapshots de backup guardados no Firestore
let maintenances = [];  // registros de manutenção
let expenses = [];      // despesas (IPVA, seguro, etc.)
let currentHouseholdId = null;
let currentHousehold = null;
let unsubVehicles = null;
let unsubFuelups = null;
let unsubBackups = null;
let unsubMaintenances = null;
let unsubExpenses = null;
let unsubHousehold = null;
let dashboardFilter = "all";
let charts = { consumption: null, price: null, cost: null };

/* ---------------- Helpers ---------------- */
const $ = (id) => document.getElementById(id);
const fmtMoney = (n) => "R$ " + (Number(n) || 0).toFixed(2).replace(".", ",");
const fmtKm = (n) => Math.round(Number(n) || 0).toLocaleString("pt-BR");
const fmtHoursMinutes = (decimalHours) => {
  const h = Math.floor(decimalHours);
  const min = Math.round((decimalHours - h) * 60);
  return h > 0 ? `${h}h${min > 0 ? min + "min" : ""}` : `${min}min`;
};
const fmtDateBR = (isoDate) => {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
};
const monthKey = (isoDate) => isoDate.slice(0, 7); // YYYY-MM
const todayISO = () => new Date().toISOString().slice(0, 10);

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2600);
}

function parseOptionalNumber(v) {
  const n = parseFloat(v);
  return isFinite(n) && v !== "" ? n : null;
}

// Horas de motor são guardadas como decimal (ex.: 5.5), mas editadas em
// dois campos separados (horas e minutos) para facilitar a digitação.
function setEngineHoursFields(decimalHours) {
  if (decimalHours === null || decimalHours === undefined || !(decimalHours > 0)) {
    $("fuelup-engine-hours-h").value = "";
    $("fuelup-engine-hours-min").value = "";
    return;
  }
  const h = Math.floor(decimalHours);
  const min = Math.round((decimalHours - h) * 60);
  $("fuelup-engine-hours-h").value = h;
  $("fuelup-engine-hours-min").value = min;
}

function getEngineHoursFromFields() {
  const h = parseFloat($("fuelup-engine-hours-h").value) || 0;
  const min = parseFloat($("fuelup-engine-hours-min").value) || 0;
  if (h <= 0 && min <= 0) return null;
  return Math.round((h + min / 60) * 100) / 100;
}

// Avisa (sem bloquear) quando os litros informados passam da capacidade do
// tanque cadastrada para o veículo — ajuda a pegar erro de digitação.
function checkTankCapacityWarning() {
  const warnEl = $("fuelup-tank-warning");
  const vehicleId = $("fuelup-vehicle").value;
  const v = vehicles.find((x) => x.id === vehicleId);
  const liters = parseFloat($("fuelup-liters").value);
  if (!v || !v.tankCapacity || !(liters > 0) || liters <= v.tankCapacity) {
    warnEl.hidden = true;
    return;
  }
  warnEl.textContent = `Atenção: ${liters.toFixed(2)} L é mais do que a capacidade do tanque de ${escapeHtml(v.name)} (${v.tankCapacity} L). Confira o valor.`;
  warnEl.hidden = false;
}
$("fuelup-vehicle").addEventListener("change", checkTankCapacityWarning);
$("fuelup-vehicle").addEventListener("change", updateFuelupFuelTypeOptions);

function vehicleIcon(type) {
  return type === "moto" ? "🏍" : "🚗";
}

const FUEL_LABELS = {
  gasolina: "Gasolina",
  "gasolina-aditivada": "Gasolina Aditivada",
  "gasolina-premium": "Gasolina Premium",
  etanol: "Etanol",
  "diesel-s10": "Diesel S10",
};
const ALL_FUEL_TYPES = Object.keys(FUEL_LABELS);
function fuelLabel(type) {
  return FUEL_LABELS[type] || type;
}

// Restringe o seletor de combustível do abastecimento aos tipos que o
// veículo selecionado aceita (cadastro do veículo). Sem restrição
// cadastrada, mostra todos os tipos normalmente.
function updateFuelupFuelTypeOptions() {
  const sel = $("fuelup-fuel-type");
  const previous = sel.value;
  const vehicleId = $("fuelup-vehicle").value;
  const v = vehicles.find((x) => x.id === vehicleId);
  const accepted = v && Array.isArray(v.acceptedFuelTypes) && v.acceptedFuelTypes.length > 0
    ? ALL_FUEL_TYPES.filter((t) => v.acceptedFuelTypes.includes(t))
    : ALL_FUEL_TYPES;
  sel.innerHTML = accepted.map((t) => `<option value="${t}">${fuelLabel(t)}</option>`).join("");
  sel.value = accepted.includes(previous) ? previous : accepted[0];
}

/* ---------------- Auth ---------------- */
let authMode = "login"; // "login" | "signup"

$("auth-toggle").addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  $("auth-submit").textContent = authMode === "login" ? "Entrar" : "Criar conta";
  $("auth-toggle").textContent =
    authMode === "login" ? "Não tem conta? Criar cadastro" : "Já tem conta? Entrar";
  $("auth-error").hidden = true;
});

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const errEl = $("auth-error");
  errEl.hidden = true;
  $("auth-submit").disabled = true;
  try {
    if (authMode === "login") {
      await auth.signInWithEmailAndPassword(email, password);
    } else {
      await auth.createUserWithEmailAndPassword(email, password);
    }
  } catch (err) {
    errEl.textContent = translateAuthError(err.code) || err.message;
    errEl.hidden = false;
  } finally {
    $("auth-submit").disabled = false;
  }
});

auth.onAuthStateChanged(async (user) => {
  currentUser = user;
  if (user) {
    $("auth-screen").hidden = true;
    $("app").hidden = false;
    $("settings-email").textContent = user.email || "—";
    try {
      const household = await ensureHousehold(user.uid, user.email || "");
      currentHouseholdId = household.id;
      attachListeners();
    } catch (err) {
      toast("Erro ao carregar seus dados: " + err.message);
    }
  } else {
    $("app").hidden = true;
    $("auth-screen").hidden = false;
    if (unsubVehicles) unsubVehicles();
    if (unsubFuelups) unsubFuelups();
    if (unsubBackups) unsubBackups();
    if (unsubMaintenances) unsubMaintenances();
    if (unsubExpenses) unsubExpenses();
    if (unsubHousehold) unsubHousehold();
    vehicles = [];
    fuelups = [];
    backups = [];
    maintenances = [];
    expenses = [];
    currentHouseholdId = null;
    currentHousehold = null;
  }
});

/* ---------------- Grupo (household) ---------------- */
// Resolve o grupo do usuário: se ele já pertence a um, usa esse; senão,
// cria um novo grupo com ele como único membro e migra, uma única vez,
// os dados antigos de users/{uid}/... (de antes de existir grupo) pra lá.
async function ensureHousehold(uid, email) {
  const existing = await db.collection("households").where("members", "array-contains", uid).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  const [legacyVehicles, legacyFuelups, legacyMaintenances, legacyExpenses, legacyBackups] = await Promise.all([
    db.collection("users").doc(uid).collection("vehicles").get().catch(() => null),
    db.collection("users").doc(uid).collection("fuelups").get().catch(() => null),
    db.collection("users").doc(uid).collection("maintenances").get().catch(() => null),
    db.collection("users").doc(uid).collection("expenses").get().catch(() => null),
    db.collection("users").doc(uid).collection("backups").get().catch(() => null),
  ]);

  const inviteCode = generateInviteCode();
  const householdRef = db.collection("households").doc();
  await householdRef.set({
    members: [uid],
    memberNames: { [uid]: email },
    inviteCode,
    createdBy: uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection("householdInvites").doc(inviteCode).set({ householdId: householdRef.id });

  const migrations = [];
  const copyInto = (snap, subcol) => {
    if (!snap) return;
    snap.docs.forEach((d) => migrations.push(householdRef.collection(subcol).doc(d.id).set(d.data())));
  };
  copyInto(legacyVehicles, "vehicles");
  copyInto(legacyFuelups, "fuelups");
  copyInto(legacyMaintenances, "maintenances");
  copyInto(legacyExpenses, "expenses");
  copyInto(legacyBackups, "backups");
  if (migrations.length > 0) {
    await Promise.all(migrations);
    toast("Seus dados foram migrados para o novo formato de grupo.");
  }

  const created = await householdRef.get();
  return { id: householdRef.id, ...created.data() };
}

function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem caracteres ambíguos (0/O, 1/I)
  let code = "";
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code.slice(0, 3) + "-" + code.slice(3);
}

function getMemberDisplayName(uid) {
  if (!currentHousehold || !currentHousehold.memberNames) return uid;
  return currentHousehold.memberNames[uid] || uid;
}

function translateAuthError(code) {
  const map = {
    "auth/invalid-email": "E-mail inválido.",
    "auth/user-not-found": "Conta não encontrada.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/email-already-in-use": "Este e-mail já está cadastrado.",
    "auth/weak-password": "A senha precisa ter ao menos 6 caracteres.",
  };
  return map[code];
}

function doLogout() {
  auth.signOut();
}
$("logout-btn").addEventListener("click", doLogout);
$("settings-logout-btn").addEventListener("click", doLogout);

/* ---------------- Firestore listeners ---------------- */
function attachListeners() {
  const vehiclesRef = vehiclesCol();
  const fuelupsRef = fuelupsCol();

  unsubHousehold = db.collection("households").doc(currentHouseholdId).onSnapshot((snap) => {
    currentHousehold = { id: snap.id, ...snap.data() };
    renderHouseholdSettings();
  }, (err) => toast("Erro ao carregar o grupo: " + err.message));

  unsubVehicles = vehiclesRef.onSnapshot((snap) => {
    vehicles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderVehicles();
    populateVehicleSelects();
    renderDashboard();
  }, (err) => toast("Erro ao carregar veículos: " + err.message));

  unsubFuelups = fuelupsRef.onSnapshot((snap) => {
    fuelups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderFuelups();
    renderDashboard();
    updatePdfFuelFilterOptions();
  }, (err) => toast("Erro ao carregar abastecimentos: " + err.message));

  unsubBackups = backupsCol().orderBy("createdAt", "desc").onSnapshot((snap) => {
    backups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderBackups();
  }, (err) => toast("Erro ao carregar backups: " + err.message));

  unsubMaintenances = maintenancesCol().onSnapshot((snap) => {
    maintenances = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMaintenances();
    renderMaintenanceDue();
    renderDashboard();
  }, (err) => toast("Erro ao carregar manutenções: " + err.message));

  unsubExpenses = expensesCol().onSnapshot((snap) => {
    expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderExpenses();
    renderDashboard();
  }, (err) => toast("Erro ao carregar despesas: " + err.message));
}

function householdRef() {
  return db.collection("households").doc(currentHouseholdId);
}
function backupsCol() {
  return householdRef().collection("backups");
}
function maintenancesCol() {
  return householdRef().collection("maintenances");
}
function expensesCol() {
  return householdRef().collection("expenses");
}
function vehiclesCol() {
  return householdRef().collection("vehicles");
}
function fuelupsCol() {
  return householdRef().collection("fuelups");
}

/* ---------------- Família (grupo) ---------------- */
function renderHouseholdSettings() {
  if (!currentHousehold) return;
  const members = currentHousehold.members || [];
  $("family-members-list").innerHTML = members.map((uid) => `
    <div class="backup-item">
      <div>
        <div class="backup-date">${escapeHtml(getMemberDisplayName(uid))}${uid === currentUser.uid ? " (você)" : ""}</div>
      </div>
    </div>`).join("");
  $("invite-code-display").textContent = currentHousehold.inviteCode || "———";
}

$("copy-invite-code-btn").addEventListener("click", async () => {
  if (!currentHousehold || !currentHousehold.inviteCode) return;
  try {
    await navigator.clipboard.writeText(currentHousehold.inviteCode);
    toast("Código copiado.");
  } catch (err) {
    toast("Não consegui copiar automaticamente — código: " + currentHousehold.inviteCode);
  }
});

$("regenerate-invite-btn").addEventListener("click", async () => {
  if (!currentHousehold) return;
  if (!confirm("Gerar um novo código invalida o código atual — quem tinha o código antigo não vai mais conseguir entrar com ele. Continuar?")) return;
  try {
    const oldCode = currentHousehold.inviteCode;
    const newCode = generateInviteCode();
    await db.collection("householdInvites").doc(newCode).set({ householdId: currentHouseholdId });
    await householdRef().update({ inviteCode: newCode });
    if (oldCode) db.collection("householdInvites").doc(oldCode).delete().catch(() => {});
    toast("Novo código gerado.");
  } catch (err) {
    toast("Erro ao gerar novo código: " + err.message);
  }
});

$("join-household-btn").addEventListener("click", async () => {
  const statusEl = $("join-status");
  const codeInput = $("join-code-input");
  const code = codeInput.value.trim().toUpperCase();
  statusEl.hidden = false;
  if (!code) {
    statusEl.textContent = "Digite um código.";
    return;
  }
  statusEl.textContent = "Procurando grupo...";
  try {
    const inviteDoc = await db.collection("householdInvites").doc(code).get();
    if (!inviteDoc.exists) {
      statusEl.textContent = "Código não encontrado. Confira se digitou certo.";
      return;
    }
    const targetHouseholdId = inviteDoc.data().householdId;
    if (targetHouseholdId === currentHouseholdId) {
      statusEl.textContent = "Você já está nesse grupo.";
      return;
    }
    if (!confirm("Entrar nesse grupo? Seus dados atuais continuam guardados no grupo em que você está agora, mas o app vai passar a mostrar os dados do novo grupo.")) {
      statusEl.hidden = true;
      return;
    }
    await db.collection("households").doc(targetHouseholdId).update({
      members: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
      [`memberNames.${currentUser.uid}`]: currentUser.email || "",
    });

    if (unsubVehicles) unsubVehicles();
    if (unsubFuelups) unsubFuelups();
    if (unsubBackups) unsubBackups();
    if (unsubMaintenances) unsubMaintenances();
    if (unsubExpenses) unsubExpenses();
    if (unsubHousehold) unsubHousehold();

    currentHouseholdId = targetHouseholdId;
    attachListeners();
    codeInput.value = "";
    statusEl.hidden = true;
    toast("Você entrou no grupo.");
  } catch (err) {
    statusEl.textContent = "Erro ao entrar no grupo: " + err.message;
  }
});

/* ---------------- Navegação por abas ---------------- */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
    $("view-" + btn.dataset.view).hidden = false;
  });
});

document.querySelectorAll(".settings-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".settings-tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".settings-pane").forEach((p) => (p.hidden = true));
    $("settings-pane-" + btn.dataset.settingsTab).hidden = false;
  });
});

document.querySelectorAll(".maint-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".maint-tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".maint-pane").forEach((p) => (p.hidden = true));
    $("maint-pane-" + btn.dataset.maintTab).hidden = false;
  });
});

/* ================================================================
   VEÍCULOS
   ================================================================ */
function populateVehicleSelects() {
  const active = vehicles.filter((v) => !v.archived);

  // filtro do dashboard
  const dashSel = $("dashboard-vehicle-filter");
  const prevDash = dashSel.value || "all";
  dashSel.innerHTML =
    `<option value="all">Todos os veículos</option>` +
    active.map((v) => `<option value="${v.id}">${vehicleIcon(v.type)} ${escapeHtml(v.name)}</option>`).join("");
  dashSel.value = active.some((v) => v.id === prevDash) ? prevDash : "all";
  dashboardFilter = dashSel.value;

  // select do formulário de abastecimento
  const fSel = $("fuelup-vehicle");
  const prevF = fSel.value;
  fSel.innerHTML = active
    .map((v) => `<option value="${v.id}">${vehicleIcon(v.type)} ${escapeHtml(v.name)}</option>`)
    .join("");
  if (active.some((v) => v.id === prevF)) fSel.value = prevF;

  // filtro de veículo da exportação em PDF
  const pdfSel = $("pdf-vehicle-filter");
  const prevPdf = pdfSel.value || "all";
  pdfSel.innerHTML =
    `<option value="all">Todos os veículos</option>` +
    active.map((v) => `<option value="${v.id}">${vehicleIcon(v.type)} ${escapeHtml(v.name)}</option>`).join("");
  pdfSel.value = active.some((v) => v.id === prevPdf) ? prevPdf : "all";
  updatePdfFuelFilterOptions();

  // selects dos formulários de manutenção e despesa
  const maintSel = $("maintenance-vehicle");
  const prevMaint = maintSel.value;
  maintSel.innerHTML = active
    .map((v) => `<option value="${v.id}">${vehicleIcon(v.type)} ${escapeHtml(v.name)}</option>`)
    .join("");
  if (active.some((v) => v.id === prevMaint)) maintSel.value = prevMaint;

  const expSel = $("expense-vehicle");
  const prevExp = expSel.value;
  expSel.innerHTML = active
    .map((v) => `<option value="${v.id}">${vehicleIcon(v.type)} ${escapeHtml(v.name)}</option>`)
    .join("");
  if (active.some((v) => v.id === prevExp)) expSel.value = prevExp;
}
$("dashboard-vehicle-filter").addEventListener("change", (e) => {
  dashboardFilter = e.target.value;
  renderDashboard();
});

// Mostra no filtro de combustível do PDF só os tipos já usados nos
// abastecimentos (considerando o veículo selecionado no filtro ao lado).
function updatePdfFuelFilterOptions() {
  const sel = $("pdf-fuel-filter");
  const previous = sel.value || "all";
  const vehicleFilterId = $("pdf-vehicle-filter").value || "all";
  const relevant = vehicleFilterId === "all" ? fuelups : fuelups.filter((f) => f.vehicleId === vehicleFilterId);
  const used = ALL_FUEL_TYPES.filter((t) => relevant.some((f) => f.fuelType === t));
  sel.innerHTML = `<option value="all">Todos os combustíveis</option>` +
    used.map((t) => `<option value="${t}">${fuelLabel(t)}</option>`).join("");
  sel.value = used.includes(previous) || previous === "all" ? previous : "all";
}
$("pdf-vehicle-filter").addEventListener("change", updatePdfFuelFilterOptions);

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderVehicles() {
  const activeList = vehicles.filter((v) => !v.archived);
  const archivedList = vehicles.filter((v) => v.archived);

  $("vehicles-list").innerHTML = activeList.map(vehicleCardHtml).join("") ||
    `<p class="empty-state">Nenhum veículo cadastrado. Toque em "+ Novo" para começar.</p>`;

  $("archived-head").hidden = archivedList.length === 0;
  $("vehicles-archived-list").innerHTML = archivedList.map(vehicleCardHtml).join("");

  document.querySelectorAll("[data-vehicle-open]").forEach((el) => {
    el.addEventListener("click", () => openVehicleModal(el.dataset.vehicleOpen));
  });
}

function vehicleCardHtml(v) {
  const count = fuelups.filter((f) => f.vehicleId === v.id).length;
  return `
    <div class="vehicle-card ${v.archived ? "archived" : ""}" data-vehicle-open="${v.id}">
      <div class="vehicle-emblem">${vehicleIcon(v.type)}</div>
      <div class="vehicle-info">
        <div class="vehicle-name">${escapeHtml(v.name)}</div>
        <div class="vehicle-meta">${v.type === "moto" ? "Moto" : "Carro"}${v.plate ? " · " + escapeHtml(v.plate) : ""}${v.tankCapacity ? ` · Tanque: ${v.tankCapacity} L` : ""} · ${count} abastecimento${count === 1 ? "" : "s"}</div>
        ${v.acceptedFuelTypes && v.acceptedFuelTypes.length > 0 ? `<div class="vehicle-meta">Aceita: ${v.acceptedFuelTypes.map(fuelLabel).join(", ")}</div>` : ""}
      </div>
      <div class="vehicle-chevron">›</div>
    </div>`;
}

$("add-vehicle-btn").addEventListener("click", () => openVehicleModal(null));
$("vehicle-modal-close").addEventListener("click", () => ($("vehicle-modal").hidden = true));

function openVehicleModal(id) {
  const v = vehicles.find((x) => x.id === id);
  $("vehicle-id").value = id || "";
  $("vehicle-name").value = v ? v.name : "";
  $("vehicle-type").value = v ? v.type : "moto";
  $("vehicle-plate").value = v ? v.plate || "" : "";
  $("vehicle-tank-capacity").value = v && v.tankCapacity !== null && v.tankCapacity !== undefined ? v.tankCapacity : "";
  $("vehicle-monthly-budget").value = v && v.monthlyBudget !== null && v.monthlyBudget !== undefined ? v.monthlyBudget : "";
  const accepted = (v && Array.isArray(v.acceptedFuelTypes)) ? v.acceptedFuelTypes : [];
  document.querySelectorAll("#vehicle-fuel-types input[type=checkbox]").forEach((cb) => {
    cb.checked = accepted.includes(cb.value);
  });
  $("vehicle-modal-title").textContent = v ? "Editar veículo" : "Novo veículo";
  $("vehicle-archive-btn").hidden = !v;
  $("vehicle-archive-btn").textContent = v && v.archived ? "Reativar" : "Arquivar";
  $("vehicle-delete-btn").hidden = !v;
  $("vehicle-error").hidden = true;
  $("vehicle-modal").hidden = false;
}

$("vehicle-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("vehicle-id").value;
  const data = {
    name: $("vehicle-name").value.trim(),
    type: $("vehicle-type").value,
    plate: $("vehicle-plate").value.trim(),
    tankCapacity: parseOptionalNumber($("vehicle-tank-capacity").value),
    monthlyBudget: parseOptionalNumber($("vehicle-monthly-budget").value),
    acceptedFuelTypes: Array.from(document.querySelectorAll("#vehicle-fuel-types input[type=checkbox]:checked")).map((cb) => cb.value),
    archived: id ? (vehicles.find((v) => v.id === id) || {}).archived || false : false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (!data.name) {
    $("vehicle-error").textContent = "Dê um apelido para o veículo.";
    $("vehicle-error").hidden = false;
    return;
  }
  try {
    if (id) {
      await vehiclesCol().doc(id).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.createdBy = currentUser.uid;
      await vehiclesCol().add(data);
    }
    $("vehicle-modal").hidden = true;
    toast("Veículo salvo.");
  } catch (err) {
    $("vehicle-error").textContent = err.message;
    $("vehicle-error").hidden = false;
  }
});

$("vehicle-archive-btn").addEventListener("click", async () => {
  const id = $("vehicle-id").value;
  const v = vehicles.find((x) => x.id === id);
  if (!v) return;
  await vehiclesCol().doc(id).update({ archived: !v.archived });
  $("vehicle-modal").hidden = true;
  toast(v.archived ? "Veículo reativado." : "Veículo arquivado.");
});

$("vehicle-delete-btn").addEventListener("click", async () => {
  const id = $("vehicle-id").value;
  const hasFuelups = fuelups.some((f) => f.vehicleId === id);
  if (hasFuelups) {
    if (!confirm("Este veículo tem abastecimentos cadastrados. Excluir o veículo NÃO apaga o histórico, mas ele ficará órfão. Prefira arquivar. Deseja excluir mesmo assim?")) return;
  } else {
    if (!confirm("Excluir este veículo?")) return;
  }
  await vehiclesCol().doc(id).delete();
  $("vehicle-modal").hidden = true;
  toast("Veículo excluído.");
});

/* ================================================================
   MANUTENÇÃO
   ================================================================ */
const MAINT_TYPE_LABELS = {
  oleo: "Troca de óleo",
  "filtro-oleo": "Filtro de óleo",
  "filtro-ar": "Filtro de ar",
  "filtro-combustivel": "Filtro de combustível",
  pneus: "Pneus",
  freios: "Freios (pastilhas/lonas)",
  bateria: "Bateria",
  alinhamento: "Alinhamento/balanceamento",
  revisao: "Revisão geral",
  correia: "Correia dentada/acessórios",
  outro: "Outro",
};
function maintTypeLabel(t) {
  return MAINT_TYPE_LABELS[t] || t;
}

// Odômetro mais recente conhecido de um veículo (do último abastecimento)
function latestOdometer(vehicleId) {
  const list = fuelups.filter((f) => f.vehicleId === vehicleId);
  if (list.length === 0) return null;
  return Math.max(...list.map((f) => f.odometer));
}

function renderMaintenances() {
  const sorted = [...maintenances].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  $("maintenance-empty").hidden = sorted.length > 0;
  $("maintenance-list").innerHTML = sorted.map(maintenanceCardHtml).join("");
  document.querySelectorAll("[data-maintenance-open]").forEach((el) => {
    el.addEventListener("click", () => openMaintenanceModal(el.dataset.maintenanceOpen));
  });
}

function createdByLabel(createdByUid) {
  if (!createdByUid || !currentHousehold || !currentHousehold.members || currentHousehold.members.length <= 1) return "";
  return " · por " + escapeHtml(getMemberDisplayName(createdByUid));
}

function maintenanceCardHtml(m) {
  const v = vehicles.find((x) => x.id === m.vehicleId);
  return `
    <div class="entry-card" data-maintenance-open="${m.id}">
      <div class="entry-icon">🔧</div>
      <div class="entry-main">
        <div class="entry-title">${maintTypeLabel(m.type)} · ${v ? escapeHtml(v.name) : "Veículo removido"}</div>
        <div class="entry-sub">${fmtDateBR(m.date)} · ${fmtKm(m.odometer)} km${m.notes ? " · " + escapeHtml(m.notes) : ""}${createdByLabel(m.createdBy)}</div>
      </div>
      ${m.cost ? `<div class="entry-metric"><strong>${fmtMoney(m.cost)}</strong></div>` : ""}
    </div>`;
}

// Calcula quais manutenções estão vencendo/vencidas, comparando o odômetro
// mais recente do veículo com odômetro do último registro + intervalo, e a
// data de hoje com a data do último registro + meses de intervalo.
function computeMaintenanceDue() {
  const latestByKey = {};
  maintenances.forEach((m) => {
    const key = m.vehicleId + "::" + m.type;
    if (!latestByKey[key] || m.date > latestByKey[key].date) latestByKey[key] = m;
  });

  const due = [];
  Object.values(latestByKey).forEach((m) => {
    const v = vehicles.find((x) => x.id === m.vehicleId);
    if (!v || v.archived) return;
    const currentOdo = latestOdometer(m.vehicleId);

    if (m.intervalKm && currentOdo !== null) {
      const nextDueOdo = m.odometer + m.intervalKm;
      const remaining = nextDueOdo - currentOdo;
      if (remaining <= 500) {
        due.push({
          vehicleName: v.name, type: m.type,
          overdue: remaining <= 0,
          label: remaining <= 0
            ? `Venceu há ${fmtKm(Math.abs(remaining))} km`
            : `Faltam ${fmtKm(remaining)} km`,
        });
      }
    }
    if (m.intervalMonths) {
      const lastDate = new Date(m.date + "T00:00:00");
      const nextDue = new Date(lastDate);
      nextDue.setMonth(nextDue.getMonth() + m.intervalMonths);
      const today = new Date();
      const diffDays = Math.round((nextDue - today) / 86400000);
      if (diffDays <= 30) {
        due.push({
          vehicleName: v.name, type: m.type,
          overdue: diffDays <= 0,
          label: diffDays <= 0
            ? `Venceu em ${fmtDateBR(nextDue.toISOString().slice(0, 10))}`
            : `Vence em ${fmtDateBR(nextDue.toISOString().slice(0, 10))}`,
        });
      }
    }
  });
  return due;
}

function renderMaintenanceDue() {
  const due = computeMaintenanceDue();
  const el = $("maintenance-due-list");
  el.innerHTML = due.map((d) => `
    <div class="due-item ${d.overdue ? "" : "warning"}">
      <div>
        <div class="due-title">${maintTypeLabel(d.type)} · ${escapeHtml(d.vehicleName)}</div>
        <div class="due-meta">${d.label}</div>
      </div>
      <span class="due-badge ${d.overdue ? "" : "warning"}">${d.overdue ? "Vencida" : "Em breve"}</span>
    </div>`).join("");
}

$("add-maintenance-btn").addEventListener("click", () => openMaintenanceModal(null));
$("maintenance-modal-close").addEventListener("click", () => ($("maintenance-modal").hidden = true));

function openMaintenanceModal(id) {
  if (vehicles.filter((v) => !v.archived).length === 0) {
    toast("Cadastre um veículo primeiro.");
    return;
  }
  const m = maintenances.find((x) => x.id === id);
  $("maintenance-id").value = id || "";
  $("maintenance-modal-title").textContent = m ? "Editar manutenção" : "Nova manutenção";
  if (m) {
    $("maintenance-vehicle").value = m.vehicleId;
    $("maintenance-type").value = m.type;
    $("maintenance-date").value = m.date;
    $("maintenance-odometer").value = m.odometer;
    $("maintenance-cost").value = m.cost ?? "";
    $("maintenance-interval-km").value = m.intervalKm ?? "";
    $("maintenance-interval-months").value = m.intervalMonths ?? "";
    $("maintenance-notes").value = m.notes || "";
  } else {
    $("maintenance-type").value = "oleo";
    $("maintenance-date").value = todayISO();
    $("maintenance-odometer").value = "";
    $("maintenance-cost").value = "";
    $("maintenance-interval-km").value = "";
    $("maintenance-interval-months").value = "";
    $("maintenance-notes").value = "";
  }
  $("maintenance-delete-btn").hidden = !m;
  $("maintenance-error").hidden = true;
  $("maintenance-modal").hidden = false;
}

$("maintenance-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("maintenance-id").value;
  const odometer = parseFloat($("maintenance-odometer").value);
  const errEl = $("maintenance-error");
  if (!(odometer >= 0)) {
    errEl.textContent = "Confira o valor do odômetro.";
    errEl.hidden = false;
    return;
  }
  const data = {
    vehicleId: $("maintenance-vehicle").value,
    type: $("maintenance-type").value,
    date: $("maintenance-date").value,
    odometer,
    cost: parseOptionalNumber($("maintenance-cost").value),
    intervalKm: parseOptionalNumber($("maintenance-interval-km").value),
    intervalMonths: parseOptionalNumber($("maintenance-interval-months").value),
    notes: $("maintenance-notes").value.trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  try {
    if (id) {
      await maintenancesCol().doc(id).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.createdBy = currentUser.uid;
      await maintenancesCol().add(data);
    }
    $("maintenance-modal").hidden = true;
    toast("Manutenção salva.");
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

$("maintenance-delete-btn").addEventListener("click", async () => {
  const id = $("maintenance-id").value;
  if (!confirm("Excluir este registro de manutenção?")) return;
  await maintenancesCol().doc(id).delete();
  $("maintenance-modal").hidden = true;
  toast("Manutenção excluída.");
});

/* ================================================================
   DESPESAS (IPVA, seguro, licenciamento, etc.)
   ================================================================ */
const EXPENSE_CATEGORY_LABELS = {
  ipva: "IPVA",
  seguro: "Seguro",
  licenciamento: "Licenciamento",
  pecas: "Peças",
  estacionamento: "Estacionamento",
  multa: "Multa",
  lavagem: "Lavagem",
  pedagio: "Pedágio",
  outro: "Outra",
};
function expenseCategoryLabel(c) {
  return EXPENSE_CATEGORY_LABELS[c] || c;
}

function renderExpenses() {
  const sorted = [...expenses].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  $("expense-empty").hidden = sorted.length > 0;
  $("expense-list").innerHTML = sorted.map(expenseCardHtml).join("");
  document.querySelectorAll("[data-expense-open]").forEach((el) => {
    el.addEventListener("click", () => openExpenseModal(el.dataset.expenseOpen));
  });
}

function expenseCardHtml(x) {
  const v = vehicles.find((veh) => veh.id === x.vehicleId);
  return `
    <div class="entry-card" data-expense-open="${x.id}">
      <div class="entry-icon">💳</div>
      <div class="entry-main">
        <div class="entry-title">${expenseCategoryLabel(x.category)} · ${v ? escapeHtml(v.name) : "Veículo removido"}</div>
        <div class="entry-sub">${fmtDateBR(x.date)}${x.notes ? " · " + escapeHtml(x.notes) : ""}${createdByLabel(x.createdBy)}</div>
      </div>
      <div class="entry-metric"><strong>${fmtMoney(x.amount)}</strong></div>
    </div>`;
}

$("add-expense-btn").addEventListener("click", () => openExpenseModal(null));
$("expense-modal-close").addEventListener("click", () => ($("expense-modal").hidden = true));

function openExpenseModal(id) {
  if (vehicles.filter((v) => !v.archived).length === 0) {
    toast("Cadastre um veículo primeiro.");
    return;
  }
  const x = expenses.find((i) => i.id === id);
  $("expense-id").value = id || "";
  $("expense-modal-title").textContent = x ? "Editar despesa" : "Nova despesa";
  if (x) {
    $("expense-vehicle").value = x.vehicleId;
    $("expense-category").value = x.category;
    $("expense-date").value = x.date;
    $("expense-amount").value = x.amount;
    $("expense-notes").value = x.notes || "";
  } else {
    $("expense-category").value = "ipva";
    $("expense-date").value = todayISO();
    $("expense-amount").value = "";
    $("expense-notes").value = "";
  }
  $("expense-delete-btn").hidden = !x;
  $("expense-error").hidden = true;
  $("expense-modal").hidden = false;
}

$("expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("expense-id").value;
  const amount = parseFloat($("expense-amount").value);
  const errEl = $("expense-error");
  if (!(amount > 0)) {
    errEl.textContent = "Confira o valor da despesa.";
    errEl.hidden = false;
    return;
  }
  const data = {
    vehicleId: $("expense-vehicle").value,
    category: $("expense-category").value,
    date: $("expense-date").value,
    amount,
    notes: $("expense-notes").value.trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  try {
    if (id) {
      await expensesCol().doc(id).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.createdBy = currentUser.uid;
      await expensesCol().add(data);
    }
    $("expense-modal").hidden = true;
    toast("Despesa salva.");
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

$("expense-delete-btn").addEventListener("click", async () => {
  const id = $("expense-id").value;
  if (!confirm("Excluir esta despesa?")) return;
  await expensesCol().doc(id).delete();
  $("expense-modal").hidden = true;
  toast("Despesa excluída.");
});

/* ================================================================
   ABASTECIMENTOS
   ================================================================ */
function renderFuelups() {
  const sorted = [...fuelups].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  $("fuelups-empty").hidden = sorted.length > 0;
  const compareMap = computeConsumptionMap();
  $("fuelups-list").innerHTML = sorted.map((f) => fuelupCardHtml(f, compareMap.get(f.id))).join("");

  document.querySelectorAll("[data-fuelup-open]").forEach((el) => {
    el.addEventListener("click", () => openFuelupModal(el.dataset.fuelupOpen));
  });
}

// Retorna um chip HTML comparando um valor calculado com o valor informado
// pelo painel do veículo, com o desvio percentual e cor conforme a proximidade.
function compareChip(label, calculated, reported, unit, decimals) {
  if (calculated === null || calculated === undefined || !reported) return "";
  const diffPct = ((reported - calculated) / calculated) * 100;
  const cls = Math.abs(diffPct) <= 5 ? "ok" : "off";
  const sign = diffPct > 0 ? "+" : "";
  return `<span class="compare-chip ${cls}">${label}: ${calculated.toFixed(decimals)} calc · ${Number(reported).toFixed(decimals)} painel (${sign}${diffPct.toFixed(1)}%)</span>`;
}

function fuelupCardHtml(f, calc) {
  const v = vehicles.find((x) => x.id === f.vehicleId);
  const vName = v ? v.name : "Veículo removido";
  const icon = v ? vehicleIcon(v.type) : "❓";

  const chips = [
    compareChip("km/l", calc ? calc.kmPerLiter : null, f.vehicleKmL, "", 1),
    compareChip("vel. média", calc ? calc.calculatedAvgSpeed : null, f.vehicleAvgSpeed, " km/h", 0),
  ].filter(Boolean).join("");

  return `
    <div class="entry-card" data-fuelup-open="${f.id}">
      <div class="entry-icon">${icon}</div>
      <div class="entry-main">
        <div class="entry-title">${escapeHtml(vName)} · ${fmtDateBR(f.date)}${f.nfceKey ? '<span class="nfce-badge">NF</span>' : ""}</div>
        <div class="entry-sub">${fmtKm(f.odometer)} km · ${Number(f.liters).toFixed(2)} L · ${fuelLabel(f.fuelType)}${f.fullTank ? "" : " · parcial"}${f.engineHours ? ` · ${fmtHoursMinutes(f.engineHours)} motor` : ""}${f.stationName ? ` · ${escapeHtml(f.stationName)}` : ""}${createdByLabel(f.createdBy)}</div>
      </div>
      <div class="entry-metric">
        <strong>${fmtMoney(f.totalCost)}</strong>
        <span>${fmtMoney(f.pricePerLiter)}/L</span>
      </div>
      ${chips ? `<div class="entry-compare">${chips}</div>` : ""}
    </div>`;
}

$("add-fuelup-btn").addEventListener("click", () => openFuelupModal(null));
$("fuelup-modal-close").addEventListener("click", () => ($("fuelup-modal").hidden = true));

function openFuelupModal(id) {
  if (vehicles.filter((v) => !v.archived).length === 0) {
    toast("Cadastre um veículo primeiro.");
    return;
  }
  const f = fuelups.find((x) => x.id === id);
  $("fuelup-id").value = id || "";
  $("fuelup-nfce-key").value = f ? f.nfceKey || "" : "";
  $("nfce-preview").hidden = true;
  $("nfce-preview").innerHTML = "";
  $("nfce-paste-box").hidden = true;
  $("nfce-paste-input").value = "";
  $("fuelup-tank-warning").hidden = true;
  $("fuelup-modal-title").textContent = f ? "Editar abastecimento" : "Novo abastecimento";
  if (f) {
    $("fuelup-vehicle").value = f.vehicleId;
    updateFuelupFuelTypeOptions();
    $("fuelup-date").value = f.date;
    $("fuelup-odometer").value = f.odometer;
    $("fuelup-liters").value = f.liters;
    $("fuelup-total").value = f.totalCost;
    $("fuelup-fuel-type").value = f.fuelType;
    $("fuelup-full-tank").checked = f.fullTank !== false;
    setEngineHoursFields(f.engineHours);
    $("fuelup-vehicle-avg-speed").value = f.vehicleAvgSpeed ?? "";
    $("fuelup-vehicle-kml").value = f.vehicleKmL ?? "";
    $("fuelup-station-name").value = f.stationName || "";
    $("fuelup-station-cnpj").value = maskCnpjProgressive((f.stationCnpj || "").replace(/\D/g, ""));
    $("fuelup-notes").value = f.notes || "";
  } else {
    updateFuelupFuelTypeOptions();
    $("fuelup-date").value = todayISO();
    $("fuelup-odometer").value = "";
    $("fuelup-liters").value = "";
    $("fuelup-total").value = "";
    $("fuelup-full-tank").checked = true;
    setEngineHoursFields(null);
    $("fuelup-vehicle-avg-speed").value = "";
    $("fuelup-vehicle-kml").value = "";
    $("fuelup-station-name").value = "";
    $("fuelup-station-cnpj").value = "";
    $("fuelup-notes").value = "";
  }
  setFuelupMode("liters");
  recomputeFuelupFields();
  $("fuelup-delete-btn").hidden = !f;
  $("fuelup-error").hidden = true;
  $("fuelup-modal").hidden = false;
}

let fuelupMode = "liters";

document.querySelectorAll("#fuelup-form .mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => setFuelupMode(btn.dataset.mode));
});

function setFuelupMode(mode) {
  fuelupMode = mode;
  document.querySelectorAll("#fuelup-form .mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  const litersInput = $("fuelup-liters");
  const priceInput = $("fuelup-price-per-liter");
  const hint = $("fuelup-mode-hint");
  if (mode === "liters") {
    litersInput.readOnly = false;
    litersInput.required = true;
    priceInput.readOnly = true;
    priceInput.type = "text";
    priceInput.required = false;
    hint.hidden = true;
  } else {
    litersInput.readOnly = true;
    litersInput.required = false;
    priceInput.readOnly = false;
    priceInput.type = "number";
    priceInput.step = "0.001";
    priceInput.min = "0";
    priceInput.required = true;
    hint.hidden = false;
  }
  recomputeFuelupFields();
}

function recomputeFuelupFields() {
  const total = parseFloat($("fuelup-total").value);
  if (fuelupMode === "liters") {
    const liters = parseFloat($("fuelup-liters").value);
    $("fuelup-price-per-liter").value = liters > 0 && total > 0 ? fmtMoney(total / liters) : "";
  } else {
    const price = parseFloat($("fuelup-price-per-liter").value);
    $("fuelup-liters").value = price > 0 && total > 0 ? (total / price).toFixed(2) : "";
  }
  checkTankCapacityWarning();
}
$("fuelup-liters").addEventListener("input", recomputeFuelupFields);
$("fuelup-total").addEventListener("input", recomputeFuelupFields);
$("fuelup-price-per-liter").addEventListener("input", recomputeFuelupFields);

$("fuelup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("fuelup-id").value;
  const liters = parseFloat($("fuelup-liters").value);
  const totalCost = parseFloat($("fuelup-total").value);
  const odometer = parseFloat($("fuelup-odometer").value);
  const errEl = $("fuelup-error");

  if (!(liters > 0) || !(totalCost > 0) || !(odometer >= 0)) {
    errEl.textContent = "Confira os valores de km, litros e total.";
    errEl.hidden = false;
    return;
  }

  const data = {
    vehicleId: $("fuelup-vehicle").value,
    date: $("fuelup-date").value,
    odometer,
    liters,
    totalCost,
    pricePerLiter: Math.round((totalCost / liters) * 1000) / 1000,
    fuelType: $("fuelup-fuel-type").value,
    fullTank: $("fuelup-full-tank").checked,
    engineHours: getEngineHoursFromFields(),
    vehicleAvgSpeed: parseOptionalNumber($("fuelup-vehicle-avg-speed").value),
    vehicleKmL: parseOptionalNumber($("fuelup-vehicle-kml").value),
    nfceKey: $("fuelup-nfce-key").value.trim() || null,
    stationName: $("fuelup-station-name").value.trim(),
    stationCnpj: $("fuelup-station-cnpj").value.trim(),
    notes: $("fuelup-notes").value.trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    if (id) {
      await fuelupsCol().doc(id).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.createdBy = currentUser.uid;
      await fuelupsCol().add(data);
    }
    $("fuelup-modal").hidden = true;
    toast("Abastecimento salvo.");
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

$("fuelup-delete-btn").addEventListener("click", async () => {
  const id = $("fuelup-id").value;
  if (!confirm("Excluir este abastecimento?")) return;
  await fuelupsCol().doc(id).delete();
  $("fuelup-modal").hidden = true;
  toast("Abastecimento excluído.");
});

/* ================================================================
   CÁLCULO DE CONSUMO
   ================================================================ */
// Recebe abastecimentos de UM veículo e retorna pontos {date, odometer, kmPerLiter, pricePerLiter, totalCost}
function computeConsumptionSeries(vehicleFuelups) {
  const sorted = [...vehicleFuelups].sort((a, b) =>
    a.odometer - b.odometer || (a.date < b.date ? -1 : 1)
  );
  const points = [];
  let lastCheckpointOdometer = null;
  let litersSinceCheckpoint = 0;
  let hoursSinceCheckpoint = 0;
  let hoursKnown = true;

  for (const f of sorted) {
    litersSinceCheckpoint += Number(f.liters) || 0;
    if (f.engineHours !== null && f.engineHours !== undefined && f.engineHours > 0) {
      hoursSinceCheckpoint += Number(f.engineHours);
    } else {
      hoursKnown = false; // faltou registrar horas em algum abastecimento do intervalo
    }

    if (f.fullTank !== false) {
      if (lastCheckpointOdometer !== null && litersSinceCheckpoint > 0) {
        const dist = f.odometer - lastCheckpointOdometer;
        if (dist > 0) {
          points.push({
            id: f.id,
            date: f.date,
            odometer: f.odometer,
            kmPerLiter: dist / litersSinceCheckpoint,
            calculatedAvgSpeed: hoursKnown && hoursSinceCheckpoint > 0 ? dist / hoursSinceCheckpoint : null,
            pricePerLiter: f.pricePerLiter,
            totalCost: f.totalCost,
          });
        }
      }
      lastCheckpointOdometer = f.odometer;
      litersSinceCheckpoint = 0;
      hoursSinceCheckpoint = 0;
      hoursKnown = true;
    }
  }
  return points;
}

// Mapa fuelupId -> {kmPerLiter, calculatedAvgSpeed} calculado por veículo,
// usado para comparar com os valores que o painel do veículo informou.
function computeConsumptionMap() {
  const map = new Map();
  const byVehicle = {};
  fuelups.forEach((f) => (byVehicle[f.vehicleId] = byVehicle[f.vehicleId] || []).push(f));
  Object.values(byVehicle).forEach((list) => {
    computeConsumptionSeries(list).forEach((p) => map.set(p.id, p));
  });
  return map;
}

function scopedFuelups() {
  if (dashboardFilter === "all") return fuelups;
  return fuelups.filter((f) => f.vehicleId === dashboardFilter);
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function renderDashboard() {
  const scoped = scopedFuelups();
  $("dashboard-empty").hidden = fuelups.length > 0 && vehicles.length > 0;

  // --- séries de consumo (agrupadas por veículo se "todos") ---
  let allPoints = [];
  if (dashboardFilter === "all") {
    const byVehicle = {};
    scoped.forEach((f) => (byVehicle[f.vehicleId] = byVehicle[f.vehicleId] || []).push(f));
    Object.values(byVehicle).forEach((list) => {
      allPoints = allPoints.concat(computeConsumptionSeries(list));
    });
    allPoints.sort((a, b) => (a.date < b.date ? -1 : 1));
  } else {
    allPoints = computeConsumptionSeries(scoped);
  }

  // --- gauge: média dos últimos até 8 pontos de consumo ---
  const recentPoints = allPoints.slice(-8);
  const avgKmL = recentPoints.length
    ? recentPoints.reduce((s, p) => s + p.kmPerLiter, 0) / recentPoints.length
    : null;
  updateGauge(avgKmL);

  // --- stats do mês atual ---
  const thisMonth = monthKey(todayISO());
  const monthFuelups = scoped.filter((f) => monthKey(f.date) === thisMonth);
  const monthCost = monthFuelups.reduce((s, f) => s + Number(f.totalCost || 0), 0);
  const monthLiters = monthFuelups.reduce((s, f) => s + Number(f.liters || 0), 0);
  const avgPrice = monthLiters > 0 ? monthCost / monthLiters : null;

  $("stat-month-cost").textContent = fmtMoney(monthCost);
  $("stat-avg-price").textContent = avgPrice !== null ? fmtMoney(avgPrice) : "R$ —";
  $("stat-month-liters").textContent = monthLiters > 0 ? monthLiters.toFixed(1) + " L" : "— L";
  $("stat-month-km").textContent = monthKmDisplay(scoped, thisMonth);

  renderBudget(monthCost);
  renderExchangeCalculator(scoped);
  renderStationRanking(scoped);
  renderVehicleComparison();
  renderCharts(allPoints, scoped);
}

function monthKmDisplay(scoped, thisMonth) {
  // soma, por veículo, a distância entre o menor e maior odômetro dentre os
  // abastecimentos deste mês (aproximação simples e honesta)
  const byVehicle = {};
  scoped.filter((f) => monthKey(f.date) === thisMonth).forEach((f) => {
    (byVehicle[f.vehicleId] = byVehicle[f.vehicleId] || []).push(f.odometer);
  });
  let total = 0;
  Object.values(byVehicle).forEach((odos) => {
    if (odos.length >= 2) total += Math.max(...odos) - Math.min(...odos);
  });
  return total > 0 ? fmtKm(total) + " km" : "— km";
}

/* ---------------- Orçamento mensal ---------------- */
function renderBudget(monthCost) {
  const card = $("budget-card");
  let budget = null;
  if (dashboardFilter === "all") {
    const budgets = vehicles.filter((v) => !v.archived && v.monthlyBudget).map((v) => v.monthlyBudget);
    if (budgets.length > 0) budget = budgets.reduce((s, b) => s + b, 0);
  } else {
    const v = vehicles.find((x) => x.id === dashboardFilter);
    if (v && v.monthlyBudget) budget = v.monthlyBudget;
  }
  if (!budget) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const pct = Math.min((monthCost / budget) * 100, 100);
  const over = monthCost > budget;
  $("budget-values").textContent = `${fmtMoney(monthCost)} de ${fmtMoney(budget)}`;
  const fill = $("budget-fill");
  fill.style.width = pct + "%";
  fill.classList.toggle("over", over);
  $("budget-note").textContent = over
    ? `Passou do orçamento em ${fmtMoney(monthCost - budget)} este mês.`
    : `Faltam ${fmtMoney(budget - monthCost)} para o limite do mês.`;
}

/* ---------------- Câmbio Gasolina x Etanol ---------------- */
function getLatestPriceForFuel(list, type) {
  const matches = list.filter((f) => f.fuelType === type).sort((a, b) => (a.date < b.date ? 1 : -1));
  return matches.length ? Number(matches[0].pricePerLiter) : null;
}

function renderExchangeCalculator(scoped) {
  const gasInput = $("exchange-gas-price");
  const ethInput = $("exchange-ethanol-price");
  // só preenche automaticamente se o usuário ainda não editou o campo nesta sessão
  if (!gasInput.dataset.touched) {
    let gasPrice = null;
    for (const t of ["gasolina", "gasolina-aditivada", "gasolina-premium"]) {
      gasPrice = getLatestPriceForFuel(scoped, t) || getLatestPriceForFuel(fuelups, t);
      if (gasPrice) break;
    }
    if (gasPrice) gasInput.value = gasPrice.toFixed(2);
  }
  if (!ethInput.dataset.touched) {
    const ethPrice = getLatestPriceForFuel(scoped, "etanol") || getLatestPriceForFuel(fuelups, "etanol");
    if (ethPrice) ethInput.value = ethPrice.toFixed(2);
  }
  updateExchangeResult();
}

function updateExchangeResult() {
  const gas = parseFloat($("exchange-gas-price").value);
  const eth = parseFloat($("exchange-ethanol-price").value);
  const verdictEl = $("exchange-verdict");
  const ratioEl = $("exchange-ratio");
  if (!(gas > 0) || !(eth > 0)) {
    verdictEl.textContent = "—";
    verdictEl.className = "";
    ratioEl.textContent = "Informe os dois preços";
    return;
  }
  const ratio = eth / gas;
  if (ratio <= 0.7) {
    verdictEl.textContent = "Etanol compensa";
    verdictEl.className = "good";
  } else {
    verdictEl.textContent = "Gasolina compensa";
    verdictEl.className = "bad";
  }
  ratioEl.textContent = `Etanol está em ${(ratio * 100).toFixed(1)}% do preço da gasolina`;
}
$("exchange-gas-price").addEventListener("input", (e) => { e.target.dataset.touched = "1"; updateExchangeResult(); });
$("exchange-ethanol-price").addEventListener("input", (e) => { e.target.dataset.touched = "1"; updateExchangeResult(); });

/* ---------------- Ranking de postos ---------------- */
function renderStationRanking(scoped) {
  const card = $("ranking-card");
  const withStation = scoped.filter((f) => f.stationCnpj || f.stationName);
  if (withStation.length === 0) {
    card.hidden = true;
    return;
  }
  const groups = {};
  withStation.forEach((f) => {
    const key = f.stationCnpj || "name:" + (f.stationName || "").toLowerCase();
    if (!groups[key]) groups[key] = { name: f.stationName || f.stationCnpj || "Posto sem nome", cnpj: f.stationCnpj || null, entries: [] };
    if (f.stationName) groups[key].name = f.stationName;
    groups[key].entries.push(f);
  });
  const rows = Object.values(groups)
    .map((g) => {
      const prices = g.entries.map((f) => Number(f.pricePerLiter));
      return { name: g.name, cnpj: g.cnpj, visits: g.entries.length, avgPrice: prices.reduce((s, v) => s + v, 0) / prices.length };
    })
    .sort((a, b) => a.avgPrice - b.avgPrice);

  card.hidden = false;
  $("ranking-list").innerHTML = rows.map((r, i) => `
    <div class="ranking-item">
      <span class="ranking-rank">${i + 1}</span>
      <div class="ranking-info">
        <div class="ranking-name">${escapeHtml(r.name)}</div>
        <div class="ranking-meta">${r.visits} abastecimento${r.visits === 1 ? "" : "s"}${r.cnpj ? " · " + r.cnpj : ""}</div>
      </div>
      <div class="ranking-price">${fmtMoney(r.avgPrice)}/L</div>
    </div>`).join("");
}

/* ---------------- Comparação entre veículos ---------------- */
function renderVehicleComparison() {
  const card = $("compare-card");
  if (dashboardFilter !== "all") {
    card.hidden = true;
    return;
  }
  const active = vehicles.filter((v) => !v.archived);
  if (active.length < 2) {
    card.hidden = true;
    return;
  }

  const rows = active.map((v) => {
    const vFuelups = fuelups.filter((f) => f.vehicleId === v.id);
    const fuelCost = vFuelups.reduce((s, f) => s + Number(f.totalCost || 0), 0);
    const expenseCost = expenses.filter((x) => x.vehicleId === v.id).reduce((s, x) => s + Number(x.amount || 0), 0);
    const maintCost = maintenances.filter((m) => m.vehicleId === v.id).reduce((s, m) => s + Number(m.cost || 0), 0);
    const totalCost = fuelCost + expenseCost + maintCost;
    const odos = vFuelups.map((f) => f.odometer);
    const km = odos.length >= 2 ? Math.max(...odos) - Math.min(...odos) : 0;
    return { name: v.name, icon: vehicleIcon(v.type), totalCost, km, costPerKm: km > 0 ? totalCost / km : null };
  }).filter((r) => r.totalCost > 0);

  if (rows.length < 2) {
    card.hidden = true;
    return;
  }
  rows.sort((a, b) => (a.costPerKm ?? Infinity) - (b.costPerKm ?? Infinity));

  card.hidden = false;
  $("compare-list").innerHTML = rows.map((r) => `
    <div class="compare-item">
      <div class="compare-info">
        <div class="compare-name">${r.icon} ${escapeHtml(r.name)}</div>
        <div class="compare-meta">${fmtMoney(r.totalCost)} total${r.km > 0 ? " · " + fmtKm(r.km) + " km" : ""}</div>
      </div>
      <div class="compare-value">${r.costPerKm !== null ? fmtMoney(r.costPerKm) + "/km" : "—"}</div>
    </div>`).join("");
}

function updateGauge(avgKmL) {
  const valueEl = $("hero-gauge-value");
  const arcEl = $("hero-gauge-arc");
  const needleEl = $("hero-gauge-needle");

  if (avgKmL === null || !isFinite(avgKmL)) {
    valueEl.textContent = "—";
    arcEl.setAttribute("d", "");
    needleEl.style.transform = "rotate(-90deg)";
    return;
  }

  valueEl.textContent = avgKmL.toFixed(1);

  // escala: 0 a 25 km/l cobre a faixa de -120° a +120°
  const clamped = Math.max(0, Math.min(25, avgKmL));
  const pct = clamped / 25;
  const startAngle = -120;
  const endAngle = -120 + pct * 240;

  const r = 78, cx = 100, cy = 100;
  const toXY = (deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [sx, sy] = toXY(-120);
  const [ex, ey] = toXY(endAngle);
  const largeArc = endAngle - -120 > 180 ? 1 : 0;
  arcEl.setAttribute("d", `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`);

  needleEl.style.transform = `rotate(${endAngle}deg)`;
}

/* ---------------- Gráficos (Chart.js) ---------------- */
const chartFont = { family: "IBM Plex Mono", size: 11 };
const chartGridColor = "rgba(255,255,255,0.06)";
const chartTextColor = "#A6A5A2";

function baseChartOptions(tooltipFormatter, yTickFormatter) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 14, right: 10, left: 2, bottom: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: tooltipFormatter ? { label: (ctx) => tooltipFormatter(ctx.parsed.y) } : undefined,
      },
    },
    scales: {
      x: {
        ticks: {
          color: chartTextColor,
          font: chartFont,
          autoSkip: true,
          maxRotation: 60,
          minRotation: 0,
          padding: 6,
        },
        grid: { color: "transparent" },
      },
      y: {
        beginAtZero: true,
        grace: "12%",
        ticks: {
          color: chartTextColor,
          font: chartFont,
          padding: 8,
          callback: yTickFormatter || ((v) => v),
        },
        grid: { color: chartGridColor },
      },
    },
  };
}

// versão compacta pra caber no eixo (ex.: 1.234 -> "1,2k"); o valor completo
// continua aparecendo na dica ao tocar/passar o mouse
function compactNumber(v) {
  const n = Number(v);
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(".", ",") + "k";
  return n % 1 === 0 ? String(n) : n.toFixed(1).replace(".", ",");
}

function renderCharts(points, scoped) {
  // ---- consumo ----
  const consLabels = points.map((p) => fmtDateBR(p.date));
  const consData = points.map((p) => Number(p.kmPerLiter.toFixed(2)));
  charts.consumption = upsertChart(charts.consumption, "chart-consumption", {
    type: "line",
    data: { labels: consLabels, datasets: [{
      data: consData, borderColor: "#E8A23D", backgroundColor: "rgba(232,162,61,0.15)",
      fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: "#E8A23D",
    }] },
    options: baseChartOptions((v) => v.toFixed(2) + " km/l", (v) => compactNumber(v)),
  });

  // ---- preço ----
  const priceSorted = [...scoped].sort((a, b) => (a.date < b.date ? -1 : 1));
  const priceLabels = priceSorted.map((f) => fmtDateBR(f.date));
  const priceData = priceSorted.map((f) => Number(f.pricePerLiter));
  charts.price = upsertChart(charts.price, "chart-price", {
    type: "line",
    data: { labels: priceLabels, datasets: [{
      data: priceData, borderColor: "#2B8C82", backgroundColor: "rgba(43,140,130,0.15)",
      fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: "#2B8C82",
    }] },
    options: baseChartOptions((v) => fmtMoney(v), (v) => "R$ " + compactNumber(v)),
  });

  // ---- gasto por mês (últimos 6 meses) ----
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const costByMonth = months.map((mk) =>
    scoped.filter((f) => monthKey(f.date) === mk).reduce((s, f) => s + Number(f.totalCost || 0), 0)
  );
  const monthLabels = months.map((mk) => {
    const [y, m] = mk.split("-");
    return ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][parseInt(m, 10) - 1] + "/" + y.slice(2);
  });
  charts.cost = upsertChart(charts.cost, "chart-cost", {
    type: "bar",
    data: { labels: monthLabels, datasets: [{
      data: costByMonth.map((v) => Number(v.toFixed(2))), backgroundColor: "#E8A23D", borderRadius: 6, maxBarThickness: 28,
    }] },
    options: baseChartOptions((v) => fmtMoney(v), (v) => "R$ " + compactNumber(v)),
  });
}

function upsertChart(existing, canvasId, config) {
  if (existing) {
    existing.data = config.data;
    existing.update();
    return existing;
  }
  const ctx = $(canvasId).getContext("2d");
  return new Chart(ctx, config);
}

/* ---------------- Tema ---------------- */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("tanque-cheio-theme", theme); } catch (e) {}
  document.querySelectorAll(".theme-btn").forEach((b) => b.classList.toggle("active", b.dataset.themeChoice === theme));
}
(function initTheme() {
  let saved = "dark";
  try { saved = localStorage.getItem("tanque-cheio-theme") || "dark"; } catch (e) {}
  applyTheme(saved);
})();
document.querySelectorAll(".theme-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyTheme(btn.dataset.themeChoice));
});

/* ================================================================
   BACKUP NO FIRESTORE
   ------------------------------------------------------------------
   Em vez de baixar um arquivo, o backup é um snapshot salvo direto
   em users/{uid}/backups/{id} — mesma conta, mesmas regras de
   segurança de tudo o mais no app. Restaurar grava (upsert, pelo
   mesmo ID) de volta em vehicles/fuelups; nada é apagado.
   ================================================================ */

$("create-backup-btn").addEventListener("click", async () => {
  const btn = $("create-backup-btn");
  btn.disabled = true;
  try {
    await backupsCol().add({
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      vehicles,
      fuelups,
      vehiclesCount: vehicles.length,
      fuelupsCount: fuelups.length,
    });
    toast("Backup criado.");
  } catch (err) {
    toast("Erro ao criar backup: " + err.message);
  } finally {
    btn.disabled = false;
  }
});

function renderBackups() {
  $("backups-empty").hidden = backups.length > 0;
  $("backups-list").innerHTML = backups.map(backupItemHtml).join("");
  document.querySelectorAll("[data-backup-restore]").forEach((el) => {
    el.addEventListener("click", () => restoreBackup(el.dataset.backupRestore));
  });
  document.querySelectorAll("[data-backup-delete]").forEach((el) => {
    el.addEventListener("click", () => deleteBackup(el.dataset.backupDelete));
  });
}

function backupItemHtml(b) {
  const dt = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : null;
  const dateLabel = dt
    ? dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Agora mesmo";
  const vCount = b.vehiclesCount ?? (b.vehicles || []).length;
  const fCount = b.fuelupsCount ?? (b.fuelups || []).length;
  return `
    <div class="backup-item">
      <div>
        <div class="backup-date">${dateLabel}</div>
        <div class="backup-meta">${vCount} veículo${vCount === 1 ? "" : "s"} · ${fCount} abastecimento${fCount === 1 ? "" : "s"}</div>
      </div>
      <div class="backup-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-backup-restore="${b.id}">Restaurar</button>
        <button type="button" class="btn-icon" data-backup-delete="${b.id}" aria-label="Excluir backup" title="Excluir backup">🗑</button>
      </div>
    </div>`;
}

async function restoreBackup(id) {
  const b = backups.find((x) => x.id === id);
  if (!b) return;
  const vList = Array.isArray(b.vehicles) ? b.vehicles : [];
  const fList = Array.isArray(b.fuelups) ? b.fuelups : [];
  if (vList.length === 0 && fList.length === 0) {
    toast("Esse backup está vazio.");
    return;
  }
  if (!confirm(`Restaurar este backup (${vList.length} veículo(s), ${fList.length} abastecimento(s))? Registros com o mesmo ID são atualizados; nada é apagado.`)) {
    return;
  }
  toast("Restaurando...");
  try {
    const ops = [];
    vList.forEach((v) => {
      const { id: vid, ...data } = v;
      ops.push(() => (vid ? vehiclesCol().doc(vid).set(data, { merge: true }) : vehiclesCol().add(data)));
    });
    fList.forEach((f) => {
      const { id: fid, ...data } = f;
      ops.push(() => (fid ? fuelupsCol().doc(fid).set(data, { merge: true }) : fuelupsCol().add(data)));
    });
    // Firestore permite até 500 operações por lote — divide em pedaços menores por segurança
    const chunkSize = 400;
    for (let i = 0; i < ops.length; i += chunkSize) {
      await Promise.all(ops.slice(i, i + chunkSize).map((op) => op()));
    }
    toast("Backup restaurado.");
  } catch (err) {
    toast("Erro ao restaurar: " + err.message);
  }
}

async function deleteBackup(id) {
  if (!confirm("Excluir este backup? Essa ação não pode ser desfeita.")) return;
  try {
    await backupsCol().doc(id).delete();
    toast("Backup excluído.");
  } catch (err) {
    toast("Erro ao excluir: " + err.message);
  }
}

/* ---------------- Service worker ---------------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

/* ================================================================
   IMPORTAÇÃO DE NFC-e (QR Code do cupom fiscal)
   ------------------------------------------------------------------
   O QR Code da NFC-e traz sempre a chave de acesso de 44 dígitos
   (dela dá pra extrair o CNPJ do emitente com certeza). Em muitos
   estados (modelo "QR Code offline", Ato COTEPE 22/2019) o valor
   total (vNF) e a data/hora de emissão (dhEmi) também vêm junto,
   sem precisar consultar a internet — então tentamos extrair isso
   também, mas sempre mostrando pro usuário conferir antes de aplicar,
   já que o formato varia de estado pra estado e nem sempre é possível
   identificar o valor com 100% de certeza. Litros e odômetro o cupom
   não informa, então continuam manuais.
   ================================================================ */

let nfceStream = null;

$("nfce-scan-btn").addEventListener("click", startNfceCamera);
$("nfce-camera-close").addEventListener("click", stopNfceCamera);
$("nfce-upload-btn").addEventListener("click", () => $("nfce-file-input").click());
$("nfce-paste-btn").addEventListener("click", () => {
  $("nfce-paste-box").hidden = !$("nfce-paste-box").hidden;
});
$("nfce-paste-confirm").addEventListener("click", () => {
  const text = $("nfce-paste-input").value.trim();
  if (!text) return;
  const result = parseNFCeText(text);
  if (!result.key && result.totalValue === null) {
    toast("Não consegui reconhecer um código de NFC-e nesse texto.");
    return;
  }
  renderNfcePreview(result);
  $("nfce-paste-input").value = "";
  $("nfce-paste-box").hidden = true;
});

$("nfce-file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    URL.revokeObjectURL(img.src);
    if (code && code.data) {
      renderNfcePreview(parseNFCeText(code.data));
    } else {
      toast("Não encontrei um QR Code nessa imagem. Tente uma foto mais próxima e nítida.");
    }
  };
  img.src = URL.createObjectURL(file);
});

async function startNfceCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast("Este navegador não permite acesso à câmera. Use 'Enviar imagem' ou 'Colar código'.");
    return;
  }
  try {
    nfceStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch (err) {
    toast("Não foi possível acessar a câmera. Confira as permissões do navegador.");
    return;
  }
  const video = $("nfce-video");
  video.srcObject = nfceStream;
  $("nfce-camera-modal").hidden = false;
  requestAnimationFrame(scanNfceFrame);
}

function stopNfceCamera() {
  if (nfceStream) {
    nfceStream.getTracks().forEach((t) => t.stop());
    nfceStream = null;
  }
  $("nfce-camera-modal").hidden = true;
}

function scanNfceFrame() {
  if (!nfceStream) return;
  const video = $("nfce-video");
  const canvas = $("nfce-canvas");
  if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
    if (code && code.data) {
      stopNfceCamera();
      renderNfcePreview(parseNFCeText(code.data));
      return;
    }
  }
  requestAnimationFrame(scanNfceFrame);
}

// Extrai o que der da URL/texto do QR Code da NFC-e.
function parseNFCeText(rawText) {
  const text = String(rawText || "").trim();
  const result = { key: null, cnpj: null, totalValue: null, date: null, raw: text };

  const keyMatch = text.match(/\d{44}/);
  if (keyMatch) {
    result.key = keyMatch[0];
    result.cnpj = formatCNPJ(result.key.substring(6, 20));
  }

  try {
    const url = new URL(text);
    const params = url.searchParams;

    // Alguns portais estaduais usam parâmetros nomeados diretamente na URL
    const namedTotal = params.get("vNF");
    if (namedTotal && /^\d+(\.\d+)?$/.test(namedTotal)) result.totalValue = parseFloat(namedTotal);
    const namedDate = params.get("dhEmi");
    if (namedDate) {
      const d = parseNFCeDateToken(namedDate);
      if (d) result.date = d;
    }
    if (!result.key) {
      const chNFe = params.get("chNFe");
      if (chNFe && /^\d{44}$/.test(chNFe)) {
        result.key = chNFe;
        result.cnpj = formatCNPJ(chNFe.substring(6, 20));
      }
    }

    // Modelo "QR Code offline" (Ato COTEPE 22/2019): parâmetro p="chave|versao|tpAmb|dhEmi|vNF|..."
    const p = params.get("p");
    if (p) {
      const parts = p.split("|");
      if (!result.key && /^\d{44}$/.test(parts[0])) {
        result.key = parts[0];
        result.cnpj = formatCNPJ(parts[0].substring(6, 20));
      }
      parts.forEach((part) => {
        if (result.totalValue === null && /^\d{1,7}\.\d{2}$/.test(part)) {
          result.totalValue = parseFloat(part);
        }
        if (result.date === null && /^\d{8,14}$/.test(part)) {
          const d = parseNFCeDateToken(part);
          if (d) result.date = d;
        }
      });
    }
  } catch (e) {
    // Não é uma URL válida — pode ser um texto colado solto; procura um valor monetário isolado
    const valMatch = text.match(/\b\d{1,7}[.,]\d{2}\b/);
    if (valMatch && result.totalValue === null) {
      result.totalValue = parseFloat(valMatch[0].replace(",", "."));
    }
  }

  return result;
}

function parseNFCeDateToken(token) {
  const digits = String(token).replace(/\D/g, "");
  let y, m, d;
  if (digits.length >= 12) {
    y = digits.slice(0, 4); m = digits.slice(4, 6); d = digits.slice(6, 8);
  } else if (digits.length >= 10) {
    y = "20" + digits.slice(0, 2); m = digits.slice(2, 4); d = digits.slice(4, 6);
  } else if (digits.length === 8) {
    y = digits.slice(0, 4); m = digits.slice(4, 6); d = digits.slice(6, 8);
  } else {
    return null;
  }
  const mi = parseInt(m, 10), di = parseInt(d, 10), yi = parseInt(y, 10);
  if (mi < 1 || mi > 12 || di < 1 || di > 31 || yi < 2015 || yi > 2100) return null;
  return `${y}-${m}-${d}`;
}

function formatCNPJ(digits) {
  if (!digits || digits.length !== 14) return null;
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

// Formata progressivamente enquanto digita, aceitando só números (mesmo
// que a pessoa cole um CNPJ já pontuado, ele é normalizado).
function maskCnpjProgressive(digits) {
  const d = digits.slice(0, 14);
  let out = d.slice(0, 2);
  if (d.length > 2) out += "." + d.slice(2, 5);
  if (d.length > 5) out += "." + d.slice(5, 8);
  if (d.length > 8) out += "/" + d.slice(8, 12);
  if (d.length > 12) out += "-" + d.slice(12, 14);
  return out;
}

$("fuelup-station-cnpj").addEventListener("input", (e) => {
  const digits = e.target.value.replace(/\D/g, "");
  e.target.value = maskCnpjProgressive(digits);
});

function renderNfcePreview(result) {
  const el = $("nfce-preview");
  el.hidden = false;
  const keySpaced = result.key ? result.key.replace(/(\d{4})(?=\d)/g, "$1 ") : null;
  el.innerHTML = `
    <div class="nfce-preview-row"><span>Chave de acesso</span><strong>${keySpaced || "não identificada"}</strong></div>
    <div class="nfce-preview-row"><span>Emitente (CNPJ)</span><strong>${result.cnpj || "—"}</strong></div>
    <div class="nfce-preview-row"><span>Valor total detectado</span><strong>${result.totalValue !== null ? fmtMoney(result.totalValue) : "não identificado"}</strong></div>
    <div class="nfce-preview-row"><span>Data detectada</span><strong>${result.date ? fmtDateBR(result.date) : "não identificada"}</strong></div>
    <p class="nfce-preview-note">O formato do QR varia por estado — confira valor e data com o cupom antes de aplicar. Litros e km continuam manuais.</p>
    <div class="nfce-preview-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="nfce-discard-btn">Descartar</button>
      <button type="button" class="btn btn-primary btn-sm" id="nfce-apply-btn">Aplicar ao formulário</button>
    </div>
  `;
  $("nfce-discard-btn").addEventListener("click", () => {
    el.hidden = true;
    el.innerHTML = "";
  });
  $("nfce-apply-btn").addEventListener("click", () => applyNfceResult(result));
}

function applyNfceResult(result) {
  if (result.totalValue !== null) {
    $("fuelup-total").value = result.totalValue.toFixed(2);
    recomputeFuelupFields();
  }
  if (result.date) $("fuelup-date").value = result.date;
  if (result.key) $("fuelup-nfce-key").value = result.key;
  if (result.cnpj) {
    $("fuelup-station-cnpj").value = result.cnpj;
    // se já lançamos abastecimento nesse mesmo posto antes, sugere o nome salvo
    if (!$("fuelup-station-name").value.trim()) {
      const known = fuelups.find((f) => f.stationCnpj === result.cnpj && f.stationName);
      if (known) $("fuelup-station-name").value = known.stationName;
    }
  }
  $("nfce-preview").hidden = true;
  $("nfce-preview").innerHTML = "";
  toast("Dados da NFC-e aplicados — confira antes de salvar.");
}

/* ================================================================
   EXPORTAR RELATÓRIO EM PDF
   ================================================================ */
let pdfPeriod = "week";

document.querySelectorAll("[data-pdf-period]").forEach((btn) => {
  btn.addEventListener("click", () => {
    pdfPeriod = btn.dataset.pdfPeriod;
    document.querySelectorAll("[data-pdf-period]").forEach((b) => b.classList.toggle("active", b === btn));
    $("pdf-custom-range").hidden = pdfPeriod !== "custom";
  });
});

$("pdf-generate-btn").addEventListener("click", generatePdfReport);

function pdfDateRange() {
  const today = new Date();
  const toISODate = (d) => d.toISOString().slice(0, 10);

  if (pdfPeriod === "week") {
    const day = today.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);
    return { from: toISODate(monday), to: todayISO() };
  }
  if (pdfPeriod === "month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toISODate(first), to: todayISO() };
  }
  if (pdfPeriod === "all") {
    return { from: "0001-01-01", to: "9999-12-31" };
  }
  // custom
  return {
    from: $("pdf-date-from").value || "0001-01-01",
    to: $("pdf-date-to").value || "9999-12-31",
  };
}

// Desenha um mini-gráfico de linha no PDF (usado por consumo e por preço) e
// retorna o novo cursor Y, já com o espaçamento para o próximo bloco.
function drawPdfMiniLineChart(doc, { x, y, w, h, title, values, color, valueFmt, textMain, textDim, line, cream }) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...textMain);
  doc.text(title, x, y);
  y += 5;

  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  doc.setDrawColor(...line);
  doc.setFillColor(...cream);
  doc.roundedRect(x, y, w, h, 2, 2, "DF");

  doc.setDrawColor(...color);
  doc.setLineWidth(0.6);
  let prevX, prevY;
  values.forEach((v, i) => {
    const px = x + 6 + (i / Math.max(values.length - 1, 1)) * (w - 12);
    const py = y + h - 4 - ((v - minV) / range) * (h - 8);
    if (i > 0) doc.line(prevX, prevY, px, py);
    doc.setFillColor(...color);
    doc.circle(px, py, 0.9, "F");
    prevX = px;
    prevY = py;
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.4);
  doc.setTextColor(...textDim);
  doc.text(`mín ${valueFmt(minV)}`, x + 3, y + h - 2);
  doc.text(`máx ${valueFmt(maxV)}`, x + w - 3, y + 5, { align: "right" });

  return y + h + 13;
}

function generatePdfReport() {
  const statusEl = $("pdf-status");
  statusEl.hidden = false;
  statusEl.textContent = "Gerando PDF...";

  const { from, to } = pdfDateRange();
  const vehicleFilterId = $("pdf-vehicle-filter").value;
  const fuelFilter = $("pdf-fuel-filter").value;

  let filtered = fuelups.filter((f) => f.date >= from && f.date <= to);
  if (vehicleFilterId !== "all") filtered = filtered.filter((f) => f.vehicleId === vehicleFilterId);
  if (fuelFilter !== "all") filtered = filtered.filter((f) => f.fuelType === fuelFilter);
  filtered.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (filtered.length === 0) {
    statusEl.textContent = "Nenhum abastecimento encontrado com esses filtros.";
    return;
  }
  if (!window.jspdf) {
    statusEl.textContent = "Não consegui carregar o gerador de PDF. Confira sua conexão e tente novamente.";
    return;
  }

  // consumo calculado com base no histórico completo do(s) veículo(s) — mais preciso
  // do que recalcular só com o recorte filtrado
  const consumptionMap = computeConsumptionMap();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  // paleta igual à do app
  const DARK = [23, 24, 27];
  const AMBER = [232, 162, 61];
  const TEAL = [43, 140, 130];
  const CREAM = [247, 244, 238];
  const TEXT_MAIN = [32, 31, 28];
  const TEXT_DIM = [110, 109, 107];
  const LINE = [225, 222, 214];

  const vehicleLabel = vehicleFilterId === "all"
    ? "Todos os veículos"
    : (vehicles.find((v) => v.id === vehicleFilterId)?.name || "Veículo");
  const fuelFilterLabel = fuelFilter === "all" ? "Todos os combustíveis" : fuelLabel(fuelFilter);
  const periodLabel = pdfPeriod === "all"
    ? "Todo o período"
    : `${fmtDateBR(filtered[0].date)} a ${fmtDateBR(filtered[filtered.length - 1].date)}`;

  // ----- métricas -----
  const totalCost = filtered.reduce((s, f) => s + Number(f.totalCost || 0), 0);
  const totalLiters = filtered.reduce((s, f) => s + Number(f.liters || 0), 0);
  const avgPrice = totalLiters > 0 ? totalCost / totalLiters : 0;

  const byVehicleOdo = {};
  filtered.forEach((f) => (byVehicleOdo[f.vehicleId] = byVehicleOdo[f.vehicleId] || []).push(f.odometer));
  let totalKm = 0;
  Object.values(byVehicleOdo).forEach((odos) => {
    if (odos.length >= 2) totalKm += Math.max(...odos) - Math.min(...odos);
  });

  const kmlPoints = filtered.map((f) => consumptionMap.get(f.id)).filter(Boolean);
  const avgKmL = kmlPoints.length ? kmlPoints.reduce((s, p) => s + p.kmPerLiter, 0) / kmlPoints.length : null;

  /* ---------------- Cabeçalho ---------------- */
  doc.setFillColor(...DARK);
  doc.rect(0, 0, pageW, 32, "F");
  doc.setFillColor(...AMBER);
  doc.rect(0, 32, pageW, 1.4, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Tanque Cheio", margin, 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(225, 222, 214);
  doc.text(periodLabel, margin, 21.5);
  doc.text(`${vehicleLabel}  ·  ${fuelFilterLabel}`, margin, 27);

  doc.setFontSize(8);
  doc.setTextColor(190, 187, 178);
  doc.text(`Gerado em ${fmtDateBR(todayISO())}`, pageW - margin, 14, { align: "right" });
  doc.text(`${filtered.length} abastecimento${filtered.length === 1 ? "" : "s"}`, pageW - margin, 19, { align: "right" });

  let y = 42;

  /* ---------------- Cards de KPI ---------------- */
  const kpis = [
    { label: "GASTO TOTAL", value: fmtMoney(totalCost) },
    { label: "PREÇO MÉDIO / L", value: fmtMoney(avgPrice) },
    { label: "KM RODADOS", value: totalKm > 0 ? fmtKm(totalKm) + " km" : "—" },
    { label: "CONSUMO MÉDIO", value: avgKmL !== null ? avgKmL.toFixed(1) + " km/l" : "—" },
  ];
  const cardGap = 4;
  const cardW = (pageW - margin * 2 - cardGap * 3) / 4;
  const cardH = 22;
  kpis.forEach((k, i) => {
    const x = margin + i * (cardW + cardGap);
    doc.setFillColor(...CREAM);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, "F");
    doc.setFillColor(...AMBER);
    doc.roundedRect(x, y, cardW, 1.6, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(...TEXT_MAIN);
    doc.text(k.value, x + cardW / 2, y + 12.5, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.4);
    doc.setTextColor(...TEXT_DIM);
    doc.text(k.label, x + cardW / 2, y + 18, { align: "center" });
  });
  y += cardH + 11;

  /* ---------------- Mini gráfico: gasto por mês ---------------- */
  const monthTotals = {};
  filtered.forEach((f) => {
    const mk = monthKey(f.date);
    monthTotals[mk] = (monthTotals[mk] || 0) + Number(f.totalCost || 0);
  });
  const monthKeysSorted = Object.keys(monthTotals).sort().slice(-8);
  const monthNamesShort = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  if (monthKeysSorted.length >= 2) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...TEXT_MAIN);
    doc.text("Gasto por mês", margin, y);
    y += 5;

    const chartH = 26;
    const chartW = pageW - margin * 2;
    const maxVal = Math.max(...monthKeysSorted.map((mk) => monthTotals[mk]), 1);
    const barGap = 3;
    const barW = (chartW - barGap * (monthKeysSorted.length - 1)) / monthKeysSorted.length;

    doc.setDrawColor(...LINE);
    doc.line(margin, y + chartH, margin + chartW, y + chartH);

    monthKeysSorted.forEach((mk, i) => {
      const val = monthTotals[mk];
      const h = Math.max((val / maxVal) * (chartH - 8), 1.5);
      const x = margin + i * (barW + barGap);
      doc.setFillColor(...AMBER);
      doc.roundedRect(x, y + chartH - h, barW, h, 1, 1, "F");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.2);
      doc.setTextColor(...TEXT_MAIN);
      doc.text(fmtMoney(val).replace("R$ ", ""), x + barW / 2, y + chartH - h - 1.6, { align: "center" });

      const [yy, mm] = mk.split("-");
      doc.setTextColor(...TEXT_DIM);
      doc.text(`${monthNamesShort[parseInt(mm, 10) - 1]}/${yy.slice(2)}`, x + barW / 2, y + chartH + 4.5, { align: "center" });
    });
    y += chartH + 13;
  }

  /* ---------------- Mini gráfico: consumo ao longo do tempo ---------------- */
  if (kmlPoints.length >= 2) {
    y = drawPdfMiniLineChart(doc, {
      x: margin, y, w: pageW - margin * 2, h: 24,
      title: "Consumo ao longo do tempo (km/l)",
      values: kmlPoints.map((p) => p.kmPerLiter),
      color: TEAL, valueFmt: (v) => v.toFixed(1) + " km/l",
      textMain: TEXT_MAIN, textDim: TEXT_DIM, line: LINE, cream: CREAM,
    });
  }

  /* ---------------- Mini gráfico: preço do combustível ---------------- */
  const priceSeries = [...filtered]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((f) => Number(f.pricePerLiter))
    .filter((v) => v > 0);
  if (priceSeries.length >= 2) {
    y = drawPdfMiniLineChart(doc, {
      x: margin, y, w: pageW - margin * 2, h: 24,
      title: "Preço do combustível (R$/l)",
      values: priceSeries,
      color: AMBER, valueFmt: (v) => fmtMoney(v),
      textMain: TEXT_MAIN, textDim: TEXT_DIM, line: LINE, cream: CREAM,
    });
  }

  /* ---------------- Tabela detalhada ---------------- */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_MAIN);
  doc.text("Abastecimentos", margin, y);
  y += 3;

  const rows = filtered.map((f) => {
    const v = vehicles.find((x) => x.id === f.vehicleId);
    const calc = consumptionMap.get(f.id);
    return [
      fmtDateBR(f.date),
      v ? v.name : "—",
      fmtKm(f.odometer) + " km",
      Number(f.liters).toFixed(2) + " L",
      fmtMoney(f.pricePerLiter),
      fmtMoney(f.totalCost),
      fuelLabel(f.fuelType),
      calc ? calc.kmPerLiter.toFixed(2) : "—",
    ];
  });

  doc.autoTable({
    startY: y + 3,
    head: [["Data", "Veículo", "Odômetro", "Litros", "R$/L", "Total", "Combustível", "km/l"]],
    body: rows,
    styles: { fontSize: 7.6, cellPadding: 2.6, textColor: TEXT_MAIN, lineColor: LINE, lineWidth: 0.15 },
    headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.6 },
    alternateRowStyles: { fillColor: CREAM },
    margin: { left: margin, right: margin },
  });

  /* ---------------- Resumo final ---------------- */
  const finalY = doc.lastAutoTable.finalY + 9;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...TEXT_MAIN);
  doc.text("Resumo", margin, finalY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_DIM);
  const summaryLines = [
    `Total gasto: ${fmtMoney(totalCost)}`,
    `Litros abastecidos: ${totalLiters.toFixed(2)} L`,
    `Preço médio por litro: ${fmtMoney(avgPrice)}`,
    `Km rodados no período (aprox.): ${totalKm > 0 ? fmtKm(totalKm) + " km" : "—"}`,
    `Consumo médio: ${avgKmL !== null ? avgKmL.toFixed(2) + " km/l" : "—"}`,
  ];
  summaryLines.forEach((line, i) => doc.text(line, margin, finalY + 6.5 + i * 5.5));

  /* ---------------- Rodapé ---------------- */
  const pageCount = doc.internal.getNumberOfPages();
  const pageH = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_DIM);
    doc.text(`Tanque Cheio · Página ${p} de ${pageCount}`, pageW / 2, pageH - 8, { align: "center" });
  }

  const fileVehiclePart = vehicleFilterId === "all" ? "todos" : vehicleLabel.toLowerCase().replace(/\s+/g, "-");
  const fileFuelPart = fuelFilter === "all" ? "todos" : fuelFilter;
  doc.save(`tanque-cheio-${pdfPeriod}-${fileVehiclePart}-${fileFuelPart}.pdf`);

  statusEl.textContent = "PDF gerado.";
}
