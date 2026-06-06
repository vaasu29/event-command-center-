let sectors = [
  {
    id: "north",
    name: "North Gate",
    x: 210,
    y: 130,
    crowd: 62,
    volunteers: 42,
    required: 48,
    medical: 4,
    buses: 76,
    gates: 66,
    queue: 18,
  },
  {
    id: "east",
    name: "East Shuttle Hub",
    x: 705,
    y: 172,
    crowd: 71,
    volunteers: 36,
    required: 44,
    medical: 6,
    buses: 88,
    gates: 58,
    queue: 27,
  },
  {
    id: "south",
    name: "South Pilgrim Route",
    x: 470,
    y: 412,
    crowd: 55,
    volunteers: 53,
    required: 45,
    medical: 3,
    buses: 64,
    gates: 71,
    queue: 14,
  },
  {
    id: "west",
    name: "Food Court West",
    x: 160,
    y: 390,
    crowd: 68,
    volunteers: 31,
    required: 42,
    medical: 5,
    buses: 52,
    gates: 62,
    queue: 24,
  },
  {
    id: "ghat",
    name: "Sangam Ghat",
    x: 520,
    y: 252,
    crowd: 82,
    volunteers: 63,
    required: 74,
    medical: 8,
    buses: 70,
    gates: 80,
    queue: 32,
  },
];

let incidents = [
  {
    id: 101,
    priority: "Critical",
    location: "Sangam Ghat",
    type: "Crowd bottleneck",
    status: "Dispatching",
    eta: 7,
  },
  {
    id: 102,
    priority: "High",
    location: "East Shuttle Hub",
    type: "Transport delay",
    status: "Open",
    eta: 12,
  },
  {
    id: 103,
    priority: "Medium",
    location: "Food Court West",
    type: "Lost person",
    status: "Assigned",
    eta: 9,
  },
  {
    id: 104,
    priority: "Low",
    location: "North Gate 3",
    type: "Resource request",
    status: "Monitoring",
    eta: 18,
  },
];

const scenarioProfiles = {
  normal: {
    label: "Normal",
    crowd: 0,
    medical: 0,
    transport: 0,
    incidentChance: 0.08,
  },
  surge: {
    label: "Crowd surge",
    crowd: 12,
    medical: 1,
    transport: 5,
    incidentChance: 0.2,
  },
  medical: {
    label: "Medical spike",
    crowd: 5,
    medical: 4,
    transport: 0,
    incidentChance: 0.18,
  },
  transport: {
    label: "Transit delay",
    crowd: 6,
    medical: 0,
    transport: 16,
    incidentChance: 0.18,
  },
};

const state = {
  selectedSector: "all",
  scenario: "normal",
  speed: 2,
  paused: false,
  tick: 0,
  selectedMapSector: null,
  recommendationCount: 0,
  apiConnected: false,
  latestServerSnapshot: null,
};

const els = {
  riskScore: document.querySelector("#riskScore"),
  riskDelta: document.querySelector("#riskDelta"),
  crowdDensity: document.querySelector("#crowdDensity"),
  openIncidents: document.querySelector("#openIncidents"),
  criticalIncidents: document.querySelector("#criticalIncidents"),
  volunteerCoverage: document.querySelector("#volunteerCoverage"),
  transportLoad: document.querySelector("#transportLoad"),
  transportBars: document.querySelector("#transportBars"),
  incidentRows: document.querySelector("#incidentRows"),
  resourceGrid: document.querySelector("#resourceGrid"),
  insightList: document.querySelector("#insightList"),
  briefingOutput: document.querySelector("#briefingOutput"),
  mapDetail: document.querySelector("#mapDetail"),
  opsMap: document.querySelector("#opsMap"),
  sectorSelect: document.querySelector("#sectorSelect"),
  pauseBtn: document.querySelector("#pauseBtn"),
  simSpeed: document.querySelector("#simSpeed"),
  incidentDialog: document.querySelector("#incidentDialog"),
  liveClock: document.querySelector("#liveClock"),
  dataStatus: document.querySelector("#dataStatus"),
};

const ctx = els.opsMap.getContext("2d");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}

async function syncSnapshot(advance = false) {
  const params = new URLSearchParams({
    sector: state.selectedSector,
    scenario: state.scenario,
    speed: String(state.speed),
    advance: String(advance),
  });

  try {
    const snapshot = await apiRequest(`/api/snapshot?${params.toString()}`);
    sectors = snapshot.sectors;
    incidents = snapshot.incidents;
    state.latestServerSnapshot = snapshot;
    state.apiConnected = true;
    renderAll();
    return true;
  } catch (error) {
    state.apiConnected = false;
    return false;
  }
}

function getVisibleSectors() {
  if (state.selectedSector === "all") return sectors;
  return sectors.filter((sector) => sector.id === state.selectedSector);
}

function sectorRisk(sector) {
  const volunteerGap = Math.max(0, sector.required - sector.volunteers) * 1.5;
  const transportPressure = (sector.buses + sector.gates) / 2;
  return Math.round(sector.crowd * 0.48 + transportPressure * 0.22 + sector.medical * 3.4 + volunteerGap);
}

function getRiskBand(score) {
  if (score >= 82) return "alert";
  if (score >= 64) return "watch";
  return "calm";
}

function colorForRisk(score) {
  if (score >= 82) return "#f06060";
  if (score >= 64) return "#f0c040";
  return "#4cd080";
}

function average(items, key) {
  return Math.round(items.reduce((sum, item) => sum + item[key], 0) / Math.max(1, items.length));
}

function updateMetrics() {
  const visible = getVisibleSectors();
  const avgCrowd = average(visible, "crowd");
  const avgTransport = Math.round(visible.reduce((sum, item) => sum + (item.buses + item.gates) / 2, 0) / visible.length);
  const coverage = Math.round(
    (visible.reduce((sum, item) => sum + item.volunteers, 0) /
      Math.max(1, visible.reduce((sum, item) => sum + item.required, 0))) *
      100
  );
  const risk = Math.round(visible.reduce((sum, item) => sum + sectorRisk(item), 0) / visible.length);
  const filteredIncidents = filterIncidents();
  const critical = filteredIncidents.filter((incident) => incident.priority === "Critical").length;

  els.riskScore.textContent = risk;
  els.riskDelta.textContent = risk >= 82 ? "Immediate attention" : risk >= 64 ? "Elevated watch" : "Within operating range";
  els.crowdDensity.textContent = `${avgCrowd}%`;
  els.openIncidents.textContent = filteredIncidents.length;
  els.criticalIncidents.textContent = `${critical} critical`;
  els.volunteerCoverage.textContent = `${coverage}%`;
  els.transportLoad.textContent = `${avgTransport}%`;
}

function filterIncidents() {
  if (state.selectedSector === "all") return incidents;
  const sector = sectors.find((item) => item.id === state.selectedSector);
  if (!sector) return incidents;
  return incidents.filter((incident) => incident.location.includes(sector.name.split(" ")[0]) || incident.location === sector.name);
}

function renderBars() {
  const visible = getVisibleSectors();
  els.transportBars.innerHTML = visible
    .map((sector) => {
      const values = [
        { label: `${sector.name} buses`, value: sector.buses },
        { label: `${sector.name} gates`, value: sector.gates },
      ];
      return values
        .map((item) => {
          const cls = item.value >= 84 ? "danger" : item.value >= 70 ? "warn" : "";
          return `
            <div class="bar-item">
              <div class="bar-meta"><strong>${item.label}</strong><span>${item.value}% load</span></div>
              <div class="bar-track"><div class="bar-fill ${cls}" style="width:${item.value}%"></div></div>
            </div>
          `;
        })
        .join("");
    })
    .join("");
}

function renderResources() {
  const visible = getVisibleSectors();
  els.resourceGrid.innerHTML = visible
    .map((sector) => {
      const coverage = Math.round((sector.volunteers / sector.required) * 100);
      const cls = coverage < 82 ? "danger" : coverage < 95 ? "warn" : "";
      const ambulances = clamp(Math.ceil(sector.medical / 2), 1, 6);
      return `
        <div class="resource-card">
          <strong>${sector.name}</strong>
          <div class="resource-meta"><span>Volunteers</span><span>${sector.volunteers}/${sector.required}</span></div>
          <div class="bar-track"><div class="bar-fill ${cls}" style="width:${clamp(coverage, 0, 100)}%"></div></div>
          <div class="resource-meta"><span>Medical teams</span><span>${ambulances} active</span></div>
          <div class="resource-meta"><span>Queue time</span><span>${sector.queue} min</span></div>
        </div>
      `;
    })
    .join("");
}

function renderIncidents() {
  const priorityRank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const rows = filterIncidents()
    .slice()
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.eta - b.eta)
    .map((incident) => {
      return `
        <tr>
          <td><span class="pill ${incident.priority.toLowerCase()}">${incident.priority}</span></td>
          <td>${incident.location}</td>
          <td>${incident.type}</td>
          <td>${incident.status}</td>
          <td>${incident.eta} min</td>
          <td><button class="row-btn" type="button" data-ack="${incident.id}">Acknowledge</button></td>
        </tr>
      `;
    });

  els.incidentRows.innerHTML = rows.join("") || `<tr><td colspan="6">No open incidents for this sector.</td></tr>`;
}

function buildInsights() {
  const visible = getVisibleSectors();
  const insights = [];
  const highestRisk = visible.slice().sort((a, b) => sectorRisk(b) - sectorRisk(a))[0];
  const lowCoverage = visible.filter((sector) => sector.volunteers < sector.required);
  const highTransport = visible.filter((sector) => (sector.buses + sector.gates) / 2 >= 78);
  const criticalIncident = filterIncidents().find((incident) => incident.priority === "Critical");

  if (criticalIncident) {
    insights.push({
      title: `Escalate ${criticalIncident.location}`,
      detail: `${criticalIncident.type} is marked critical with ${criticalIncident.eta} minute response ETA. Open a direct command channel and stage medical support nearby.`,
      action: () => acknowledgeIncident(criticalIncident.id),
    });
  }

  if (highestRisk) {
    insights.push({
      title: `Rebalance ${highestRisk.name}`,
      detail: `Risk score ${sectorRisk(highestRisk)}. Redirect ${Math.max(4, highestRisk.required - highestRisk.volunteers)} volunteers and open one alternate movement corridor.`,
      action: () => reinforceSector(highestRisk.id),
    });
  }

  if (highTransport.length) {
    const sector = highTransport[0];
    insights.push({
      title: `Reduce transit load at ${sector.name}`,
      detail: `Transport load is averaging ${Math.round((sector.buses + sector.gates) / 2)}%. Trigger shuttle spacing and hold non-urgent inbound batches for 10 minutes.`,
      action: () => improveTransport(sector.id),
    });
  }

  if (lowCoverage.length) {
    const sector = lowCoverage.sort((a, b) => b.required - b.volunteers - (a.required - a.volunteers))[0];
    insights.push({
      title: `Fill volunteer gap`,
      detail: `${sector.name} is short by ${sector.required - sector.volunteers} volunteers. Shift standby staff from lower-risk routes.`,
      action: () => reinforceSector(sector.id),
    });
  }

  return insights.slice(0, 4);
}

function renderInsights() {
  const insights = state.apiConnected && state.latestServerSnapshot
    ? state.latestServerSnapshot.insights
    : buildInsights();
  els.insightList.innerHTML = insights
    .map((insight) => `<li><strong>${insight.title}</strong><span>${insight.detail}</span></li>`)
    .join("");
}

function drawMap() {
  const canvas = els.opsMap;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#1e2028";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 18;
  ctx.lineCap = "round";
  drawPath([
    [84, 90],
    [230, 140],
    [410, 210],
    [520, 252],
    [720, 170],
    [900, 120],
  ]);
  drawPath([
    [100, 430],
    [260, 382],
    [470, 412],
    [540, 252],
    [710, 172],
  ]);
  drawPath([
    [162, 390],
    [310, 295],
    [520, 252],
    [690, 330],
    [870, 420],
  ]);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 7;
  drawPath([
    [120, 470],
    [300, 430],
    [470, 412],
    [610, 360],
    [850, 450],
  ]);

  ctx.fillStyle = "rgba(56, 217, 169, 0.06)";
  ctx.beginPath();
  ctx.ellipse(520, 252, 185, 92, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(56, 217, 169, 0.5)";
  ctx.font = "700 15px Inter, sans-serif";
  ctx.fillText("Sangam convergence zone", 405, 250);

  sectors.forEach((sector) => {
    const score = sectorRisk(sector);
    const radius = 24 + sector.crowd * 0.34;
    const isVisible = state.selectedSector === "all" || state.selectedSector === sector.id;
    const selected = state.selectedMapSector === sector.id;

    ctx.globalAlpha = isVisible ? 1 : 0.24;
    ctx.fillStyle = colorForRisk(score);
    ctx.beginPath();
    ctx.arc(sector.x, sector.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(30, 32, 40, 0.88)";
    ctx.beginPath();
    ctx.arc(sector.x, sector.y, Math.max(22, radius * 0.44), 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = selected ? "#4cd080" : "rgba(255,255,255,0.1)";
    ctx.lineWidth = selected ? 5 : 3;
    ctx.stroke();

    ctx.fillStyle = "#eaf0f9";
    ctx.font = "800 16px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${sector.crowd}%`, sector.x, sector.y + 5);

    ctx.fillStyle = "rgba(234, 240, 249, 0.6)";
    ctx.font = "700 13px Inter, sans-serif";
    ctx.fillText(sector.name, sector.x, sector.y + radius + 21);
    ctx.globalAlpha = 1;
  });

  ctx.textAlign = "left";
}

function drawPath(points) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderMapDetail() {
  const selected = sectors.find((sector) => sector.id === state.selectedMapSector);
  if (!selected) {
    els.mapDetail.textContent = "Select a sector to inspect current load.";
    return;
  }
  els.mapDetail.textContent = `${selected.name}: crowd ${selected.crowd}%, queue ${selected.queue} min, volunteers ${selected.volunteers}/${selected.required}, medical load ${selected.medical} active calls.`;
}

function renderBriefing() {
  if (state.apiConnected && state.latestServerSnapshot?.briefing) {
    els.briefingOutput.textContent = state.latestServerSnapshot.briefing;
    return;
  }

  const visible = getVisibleSectors();
  const risk = Math.round(visible.reduce((sum, item) => sum + sectorRisk(item), 0) / visible.length);
  const highest = visible.slice().sort((a, b) => sectorRisk(b) - sectorRisk(a))[0];
  const urgent = filterIncidents().filter((incident) => ["Critical", "High"].includes(incident.priority));
  const coverage = Math.round(
    (visible.reduce((sum, item) => sum + item.volunteers, 0) /
      Math.max(1, visible.reduce((sum, item) => sum + item.required, 0))) *
      100
  );
  const insight = buildInsights()[0];

  els.briefingOutput.textContent = [
    `Operational status: ${risk >= 82 ? "red" : risk >= 64 ? "amber" : "green"} watch with aggregate risk score ${risk}.`,
    `Primary hotspot: ${highest.name} at ${highest.crowd}% crowd density and ${highest.queue} minute queue time.`,
    `Incident load: ${urgent.length} high-priority items require commander visibility.`,
    `Staffing: ${coverage}% volunteer coverage across selected sectors.`,
    `Recommended command action: ${insight ? insight.detail : "Maintain monitoring posture and keep standby teams staged."}`,
  ].join("\n");
}

function renderClock() {
  const formatter = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    timeZoneName: "short",
  });
  els.liveClock.textContent = formatter.format(new Date());
}

function renderAll() {
  if (els.dataStatus) {
    const source = state.latestServerSnapshot?.database === "mongodb" ? "MongoDB" : "FastAPI";
    els.dataStatus.textContent = state.apiConnected ? `Live API: ${source}` : "Local simulator";
    els.dataStatus.classList.toggle("is-live", state.apiConnected);
  }
  updateMetrics();
  renderBars();
  renderResources();
  renderIncidents();
  renderInsights();
  renderMapDetail();
  drawMap();
}

function mutateLiveData() {
  const profile = scenarioProfiles[state.scenario];
  sectors.forEach((sector) => {
    const centerCrowd = 58 + profile.crowd + (sector.id === "ghat" ? 14 : 0);
    sector.crowd = clamp(Math.round(sector.crowd + (centerCrowd - sector.crowd) * 0.08 + randomStep(4)), 24, 98);
    sector.medical = clamp(Math.round(sector.medical + randomStep(2) + profile.medical * 0.1), 1, 16);
    sector.buses = clamp(Math.round(sector.buses + randomStep(4) + profile.transport * 0.08), 28, 98);
    sector.gates = clamp(Math.round(sector.gates + randomStep(3) + (sector.crowd - 65) * 0.04), 32, 98);
    sector.queue = clamp(Math.round(sector.queue + randomStep(3) + (sector.crowd - 70) * 0.08 + profile.transport * 0.05), 3, 58);
  });

  incidents = incidents.map((incident) => ({
    ...incident,
    eta: clamp(incident.eta + Math.round(randomStep(2)), 3, 28),
  }));

  if (Math.random() < profile.incidentChance) {
    createRandomIncident();
  }
}

function randomStep(size) {
  return (Math.random() - 0.5) * size;
}

function createRandomIncident() {
  const sector = sectors[Math.floor(Math.random() * sectors.length)];
  const types = ["Crowd bottleneck", "Medical assistance", "Transport delay", "Resource request", "Lost person"];
  const priority = sector.crowd > 84 ? "Critical" : sector.crowd > 72 ? "High" : Math.random() > 0.55 ? "Medium" : "Low";
  incidents.unshift({
    id: Date.now(),
    priority,
    location: sector.name,
    type: types[Math.floor(Math.random() * types.length)],
    status: "Open",
    eta: Math.floor(6 + Math.random() * 16),
  });
  incidents = incidents.slice(0, 9);
}

async function acknowledgeIncident(id) {
  if (state.apiConnected) {
    try {
      await apiRequest(`/api/incidents/${id}/ack`, { method: "PATCH" });
      await syncSnapshot(false);
      return;
    } catch (error) {
      state.apiConnected = false;
    }
  }

  incidents = incidents.map((incident) => {
    if (incident.id !== id) return incident;
    const status = incident.status === "Resolved" ? "Resolved" : "Assigned";
    return { ...incident, status, eta: Math.max(3, incident.eta - 4) };
  });
  renderAll();
}

function reinforceSector(id) {
  const sector = sectors.find((item) => item.id === id);
  if (!sector) return;
  const added = Math.max(4, Math.min(12, sector.required - sector.volunteers + 3));
  sector.volunteers = clamp(sector.volunteers + added, 0, sector.required + 18);
  sector.queue = clamp(sector.queue - 5, 1, 58);
  state.recommendationCount += 1;
  renderAll();
  renderBriefing();
}

function improveTransport(id) {
  const sector = sectors.find((item) => item.id === id);
  if (!sector) return;
  sector.buses = clamp(sector.buses - 10, 20, 98);
  sector.gates = clamp(sector.gates - 6, 20, 98);
  sector.queue = clamp(sector.queue - 4, 1, 58);
  state.recommendationCount += 1;
  renderAll();
  renderBriefing();
}

async function applyTopRecommendation() {
  if (state.apiConnected) {
    try {
      await apiRequest(`/api/actions/top?sector=${encodeURIComponent(state.selectedSector)}`, {
        method: "POST",
      });
      await syncSnapshot(false);
      renderBriefing();
      return;
    } catch (error) {
      state.apiConnected = false;
    }
  }

  const insight = buildInsights()[0];
  if (insight) insight.action();
}

async function saveManualIncident() {
  const location = document.querySelector("#incidentLocation").value;
  const type = document.querySelector("#incidentType").value;
  const priority = document.querySelector("#incidentPriority").value;

  if (state.apiConnected) {
    try {
      await apiRequest("/api/incidents", {
        method: "POST",
        body: JSON.stringify({ location, type, priority }),
      });
      els.incidentDialog.close();
      await syncSnapshot(false);
      return;
    } catch (error) {
      state.apiConnected = false;
    }
  }

  incidents.unshift({
    id: Date.now(),
    priority,
    location,
    type,
    status: "Open",
    eta: priority === "Critical" ? 5 : priority === "High" ? 9 : 15,
  });
  els.incidentDialog.close();
  renderAll();
}

function handleCanvasClick(event) {
  const rect = els.opsMap.getBoundingClientRect();
  const scaleX = els.opsMap.width / rect.width;
  const scaleY = els.opsMap.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  const clicked = sectors.find((sector) => {
    const radius = 24 + sector.crowd * 0.34;
    return Math.hypot(sector.x - x, sector.y - y) <= radius;
  });

  if (clicked) {
    state.selectedMapSector = clicked.id;
    state.selectedSector = clicked.id;
    els.sectorSelect.value = clicked.id;
    renderAll();
  }
}

function setScenario(nextScenario) {
  state.scenario = nextScenario;
  document.querySelectorAll("[data-scenario]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.scenario === nextScenario);
  });
  renderAll();
  syncSnapshot(false);
}

document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => setScenario(button.dataset.scenario));
});

els.sectorSelect.addEventListener("change", (event) => {
  state.selectedSector = event.target.value;
  state.selectedMapSector = event.target.value === "all" ? null : event.target.value;
  renderAll();
  syncSnapshot(false);
});

els.simSpeed.addEventListener("input", (event) => {
  state.speed = Number(event.target.value);
});

els.pauseBtn.addEventListener("click", () => {
  state.paused = !state.paused;
  els.pauseBtn.textContent = state.paused ? "Resume feed" : "Pause feed";
});

els.incidentRows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ack]");
  if (button) acknowledgeIncident(Number(button.dataset.ack));
});

document.querySelector("#newIncidentBtn").addEventListener("click", () => els.incidentDialog.showModal());
document.querySelector("#saveIncidentBtn").addEventListener("click", saveManualIncident);
document.querySelector("#briefingBtn").addEventListener("click", async () => {
  await syncSnapshot(false);
  renderBriefing();
});
document.querySelector("#applyTopAction").addEventListener("click", applyTopRecommendation);
els.opsMap.addEventListener("click", handleCanvasClick);

setInterval(async () => {
  if (state.paused) return;
  state.tick += 1;
  const synced = await syncSnapshot(true);
  if (!synced) {
    for (let i = 0; i < state.speed; i += 1) mutateLiveData();
    renderAll();
  }
}, 2600);

setInterval(renderClock, 30000);
renderClock();
syncSnapshot(false).then((synced) => {
  if (!synced) renderAll();
});
