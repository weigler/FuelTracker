/* ============================================================
   Tanque Cheio — app.js
   Firebase Auth + Firestore, cálculo de consumo, gráficos
   ============================================================ */

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let vehicles = [];      // todos os veículos do usuário
let fuelups = [];       // todos os abastecimentos do usuário
let unsubVehicles = null;
let unsubFuelups = null;
let dashboardFilter = "all";
let charts = { consumption: null, price: null, cost: null };

/* ---------------- Helpers ---------------- */
const $ = (id) => document.getElementById(id);
const fmtMoney = (n) => "R$ " + (Number(n) || 0).toFixed(2).replace(".", ",");
const fmtKm = (n) => Math.round(Number(n) || 0).toLocaleString("pt-BR");
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
function fuelLabel(type) {
  return FUEL_LABELS[type] || type;
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

auth.onAuthStateChanged((user) => {
  currentUser = user;
  if (user) {
    $("auth-screen").hidden = true;
    $("app").hidden = false;
    $("settings-email").textContent = user.email || "—";
    attachListeners(user.uid);
  } else {
    $("app").hidden = true;
    $("auth-screen").hidden = false;
    if (unsubVehicles) unsubVehicles();
    if (unsubFuelups) unsubFuelups();
    vehicles = [];
    fuelups = [];
  }
});

/* ---------------- Firestore listeners ---------------- */
function attachListeners(uid) {
  const vehiclesRef = db.collection("users").doc(uid).collection("vehicles");
  const fuelupsRef = db.collection("users").doc(uid).collection("fuelups");

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
  }, (err) => toast("Erro ao carregar abastecimentos: " + err.message));
}

function vehiclesCol() {
  return db.collection("users").doc(currentUser.uid).collection("vehicles");
}
function fuelupsCol() {
  return db.collection("users").doc(currentUser.uid).collection("fuelups");
}

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
}
$("dashboard-vehicle-filter").addEventListener("change", (e) => {
  dashboardFilter = e.target.value;
  renderDashboard();
});

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
        <div class="vehicle-meta">${v.type === "moto" ? "Moto" : "Carro"}${v.plate ? " · " + escapeHtml(v.plate) : ""} · ${count} abastecimento${count === 1 ? "" : "s"}</div>
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
        <div class="entry-sub">${fmtKm(f.odometer)} km · ${Number(f.liters).toFixed(2)} L · ${fuelLabel(f.fuelType)}${f.fullTank ? "" : " · parcial"}${f.engineHours ? ` · ${Number(f.engineHours).toFixed(1)}h motor` : ""}</div>
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
  $("fuelup-modal-title").textContent = f ? "Editar abastecimento" : "Novo abastecimento";
  if (f) {
    $("fuelup-vehicle").value = f.vehicleId;
    $("fuelup-date").value = f.date;
    $("fuelup-odometer").value = f.odometer;
    $("fuelup-liters").value = f.liters;
    $("fuelup-total").value = f.totalCost;
    $("fuelup-fuel-type").value = f.fuelType;
    $("fuelup-full-tank").checked = f.fullTank !== false;
    $("fuelup-engine-hours").value = f.engineHours ?? "";
    $("fuelup-vehicle-avg-speed").value = f.vehicleAvgSpeed ?? "";
    $("fuelup-vehicle-kml").value = f.vehicleKmL ?? "";
    $("fuelup-notes").value = f.notes || "";
  } else {
    $("fuelup-date").value = todayISO();
    $("fuelup-odometer").value = "";
    $("fuelup-liters").value = "";
    $("fuelup-total").value = "";
    $("fuelup-fuel-type").value = "gasolina";
    $("fuelup-full-tank").checked = true;
    $("fuelup-engine-hours").value = "";
    $("fuelup-vehicle-avg-speed").value = "";
    $("fuelup-vehicle-kml").value = "";
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
    engineHours: parseOptionalNumber($("fuelup-engine-hours").value),
    vehicleAvgSpeed: parseOptionalNumber($("fuelup-vehicle-avg-speed").value),
    vehicleKmL: parseOptionalNumber($("fuelup-vehicle-kml").value),
    nfceKey: $("fuelup-nfce-key").value.trim() || null,
    notes: $("fuelup-notes").value.trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    if (id) {
      await fuelupsCol().doc(id).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
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

function baseChartOptions(yFormatter) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: {
      callbacks: yFormatter ? { label: (ctx) => yFormatter(ctx.parsed.y) } : undefined
    } },
    scales: {
      x: { ticks: { color: chartTextColor, font: chartFont, maxRotation: 0 }, grid: { color: "transparent" } },
      y: { ticks: { color: chartTextColor, font: chartFont }, grid: { color: chartGridColor } },
    },
  };
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
    options: baseChartOptions((v) => v.toFixed(2) + " km/l"),
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
    options: baseChartOptions((v) => fmtMoney(v)),
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
    options: baseChartOptions((v) => fmtMoney(v)),
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

/* ---------------- Exportar dados ---------------- */
$("export-btn").addEventListener("click", () => {
  const payload = { exportedAt: new Date().toISOString(), vehicles, fuelups };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tanque-cheio-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Backup exportado.");
});

/* ---------------- Restaurar backup ---------------- */
$("restore-btn").addEventListener("click", () => $("restore-file-input").click());
$("restore-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  const statusEl = $("restore-status");
  statusEl.hidden = false;
  statusEl.textContent = "Lendo arquivo...";

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (err) {
    statusEl.textContent = "Arquivo inválido — não parece um backup JSON do Tanque Cheio.";
    return;
  }

  const vList = Array.isArray(payload.vehicles) ? payload.vehicles : [];
  const fList = Array.isArray(payload.fuelups) ? payload.fuelups : [];
  if (vList.length === 0 && fList.length === 0) {
    statusEl.textContent = "Não encontrei veículos ou abastecimentos nesse arquivo.";
    return;
  }

  if (!confirm(`Este backup tem ${vList.length} veículo(s) e ${fList.length} abastecimento(s). Registros com o mesmo ID serão atualizados; nada é apagado. Restaurar agora?`)) {
    statusEl.hidden = true;
    return;
  }

  statusEl.textContent = "Restaurando...";
  try {
    // Firestore permite até 500 operações por lote — divide se precisar
    const ops = [];
    vList.forEach((v) => {
      const { id, ...data } = v;
      ops.push(() => (id ? vehiclesCol().doc(id).set(data, { merge: true }) : vehiclesCol().add(data)));
    });
    fList.forEach((f) => {
      const { id, ...data } = f;
      ops.push(() => (id ? fuelupsCol().doc(id).set(data, { merge: true }) : fuelupsCol().add(data)));
    });

    // set/add não se misturam bem num batch manual quando não há id (add gera doc novo);
    // por simplicidade e robustez, executa em paralelo em lotes menores.
    const chunkSize = 400;
    for (let i = 0; i < ops.length; i += chunkSize) {
      const chunk = ops.slice(i, i + chunkSize);
      await Promise.all(chunk.map((op) => op()));
    }
    statusEl.textContent = `Restauração concluída: ${vList.length} veículo(s) e ${fList.length} abastecimento(s) processados.`;
    toast("Backup restaurado.");
  } catch (err) {
    statusEl.textContent = "Erro ao restaurar: " + err.message;
  }
});

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
  if (result.key) {
    $("fuelup-nfce-key").value = result.key;
    const notesEl = $("fuelup-notes");
    const tag = "NFC-e " + result.key.slice(-8);
    if (!notesEl.value.includes(tag)) {
      notesEl.value = notesEl.value ? notesEl.value + " · " + tag : tag;
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

  const vehicleLabel = vehicleFilterId === "all"
    ? "Todos os veículos"
    : (vehicles.find((v) => v.id === vehicleFilterId)?.name || "Veículo");
  const fuelFilterLabel = fuelFilter === "all" ? "Todos os combustíveis" : fuelLabel(fuelFilter);
  const periodLabel = pdfPeriod === "all"
    ? "Todo o período"
    : `${fmtDateBR(filtered[0].date)} a ${fmtDateBR(filtered[filtered.length - 1].date)}`;

  doc.setFontSize(16);
  doc.text("Tanque Cheio — Relatório de abastecimentos", 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Período: ${periodLabel}`, 14, 25);
  doc.text(`Veículo: ${vehicleLabel}   ·   Combustível: ${fuelFilterLabel}`, 14, 30);
  doc.text(`Gerado em ${fmtDateBR(todayISO())}`, 14, 35);

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
    startY: 40,
    head: [["Data", "Veículo", "Odômetro", "Litros", "R$/L", "Total", "Combustível", "km/l"]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [232, 162, 61], textColor: [26, 18, 0] },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  });

  const totalCost = filtered.reduce((s, f) => s + Number(f.totalCost || 0), 0);
  const totalLiters = filtered.reduce((s, f) => s + Number(f.liters || 0), 0);
  const avgPrice = totalLiters > 0 ? totalCost / totalLiters : 0;

  const byVehicleOdo = {};
  filtered.forEach((f) => (byVehicleOdo[f.vehicleId] = byVehicleOdo[f.vehicleId] || []).push(f.odometer));
  let totalKm = 0;
  Object.values(byVehicleOdo).forEach((odos) => {
    if (odos.length >= 2) totalKm += Math.max(...odos) - Math.min(...odos);
  });

  const kmlValues = filtered.map((f) => consumptionMap.get(f.id)).filter(Boolean).map((c) => c.kmPerLiter);
  const avgKmL = kmlValues.length ? kmlValues.reduce((s, v) => s + v, 0) / kmlValues.length : null;

  const finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text("Resumo", 14, finalY);
  doc.setFontSize(10);
  doc.setTextColor(60);
  const summaryLines = [
    `Total gasto: ${fmtMoney(totalCost)}`,
    `Litros abastecidos: ${totalLiters.toFixed(2)} L`,
    `Preço médio por litro: ${fmtMoney(avgPrice)}`,
    `Km rodados no período (aprox.): ${totalKm > 0 ? fmtKm(totalKm) + " km" : "—"}`,
    `Consumo médio: ${avgKmL !== null ? avgKmL.toFixed(2) + " km/l" : "—"}`,
    `Abastecimentos no período: ${filtered.length}`,
  ];
  summaryLines.forEach((line, i) => doc.text(line, 14, finalY + 7 + i * 6));

  const fileVehiclePart = vehicleFilterId === "all" ? "todos" : vehicleLabel.toLowerCase().replace(/\s+/g, "-");
  const fileFuelPart = fuelFilter === "all" ? "todos" : fuelFilter;
  doc.save(`tanque-cheio-${pdfPeriod}-${fileVehiclePart}-${fileFuelPart}.pdf`);

  statusEl.textContent = "PDF gerado.";
}
