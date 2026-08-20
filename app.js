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
        <div class="entry-title">${escapeHtml(vName)} · ${fmtDateBR(f.date)}</div>
        <div class="entry-sub">${fmtKm(f.odometer)} km · ${Number(f.liters).toFixed(2)} L · ${f.fuelType}${f.fullTank ? "" : " · parcial"}${f.engineHours ? ` · ${Number(f.engineHours).toFixed(1)}h motor` : ""}</div>
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
  updatePricePerLiterPreview();
  $("fuelup-delete-btn").hidden = !f;
  $("fuelup-error").hidden = true;
  $("fuelup-modal").hidden = false;
}

function updatePricePerLiterPreview() {
  const liters = parseFloat($("fuelup-liters").value);
  const total = parseFloat($("fuelup-total").value);
  $("fuelup-price-per-liter").value = liters > 0 && total > 0 ? fmtMoney(total / liters) : "";
}
$("fuelup-liters").addEventListener("input", updatePricePerLiterPreview);
$("fuelup-total").addEventListener("input", updatePricePerLiterPreview);

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

/* ---------------- Service worker ---------------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
