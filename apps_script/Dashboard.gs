// Live results tab for the study. Needs Key.gs (private, not in this repository) in the same
// Apps Script project. Run installDashboard() once from the editor: it builds the "dashboard" tab
// and refreshes it every 5 minutes. The sheet menu "Study > Refresh dashboard" refreshes on demand.
// Participant IDs listed in column A of the "exclude" tab (e.g. your own tests) are left out.
//
// Pairs are sampled uniformly, so "all pairs" is directly comparable to the paper's VLM preference.
// Pairs are also split into clean (neither clip collapsed into flat frames) and degenerate (at least
// one did), shown as extra columns.

const DASH = "dashboard";
const BOOT = 2000;
const MIN_CONSISTENCY = 2 / 3;
const NCOL = 11;

// Tab. 3 of the paper (Qwen2.5-VL-7B judge, both orders, n=120 per baseline) and the same judge
// records restricted to clean pairs (gvdm-cvpr ledger 3.66). Hard = (wins + ties/2) / n.
const PAPER_NAMES = { base: "base", lvd_default: "LVD", compattn: "Comp-Attn",
                      videotetris_10fps: "VideoTetris (VideoCrafter2)", ttom72b: "TTOM (Wan2.1-14B)" };
const VLM = {
  base:        { hard: 0.746, soft: 0.619, hardClean: 0.632, softClean: 0.547 },
  lvd_default: { hard: 0.863, soft: 0.701, hardClean: 0.713, softClean: 0.608 },
  compattn:    { hard: 0.588, soft: 0.557, hardClean: 0.505, softClean: 0.510 },
  videotetris_10fps: { hard: 0.647, soft: 0.574, hardClean: 0.653, softClean: 0.577 },  // n=119 (no clip for prompt 45)
  ttom72b:     { hard: 0.438, soft: 0.471, hardClean: 0.441, softClean: 0.473 },
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Study").addItem("Refresh dashboard", "updateDashboard").addToUi();
}

function installDashboard() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === "updateDashboard") ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger("updateDashboard").timeBased().everyMinutes(5).create();
  updateDashboard();
}

function readParticipants_(ss) {
  const sheet = ss.getSheetByName("responses");
  if (!sheet || sheet.getLastRow() < 2) return {};
  const [head, ...data] = sheet.getDataRange().getValues();
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const ex = ss.getSheetByName("exclude");
  const excluded = new Set(ex ? ex.getRange("A:A").getValues().flat().map(String).filter(Boolean) : []);

  const people = {};
  for (const r of data) {
    const pid = String(r[col.participant]);
    if (!pid || excluded.has(pid)) continue;
    const p = people[pid] = people[pid] || { trials: {}, expertise: r[col.expertise], last: r[col.received_at] };
    // Keyed by trial index: a row resent after a network retry overwrites instead of counting twice.
    p.trials[r[col.trial]] = {
      pair: r[col.pair_id], group: r[col.group], repeat: Number(r[col.repeat]), n: Number(r[col.n_trials]),
      oursChosen: KEY_OURS_VIDEOS.has(String(r[col.chosen])), rt: Number(r[col.rt_ms]),
      clean: !KEY_DEGENERATE_PAIRS.has(String(r[col.pair_id])),
    };
    if (r[col.received_at] > p.last) p.last = r[col.received_at];
  }
  for (const p of Object.values(people)) {
    const ts = Object.values(p.trials);
    const first = {};
    for (const t of ts) if (!t.repeat) first[t.pair] = t;
    const reps = ts.filter((t) => t.repeat && first[t.pair]);
    p.first = Object.values(first);
    p.answers = ts.length;
    p.complete = ts.length > 0 && ts.length >= ts[0].n;
    p.consistency = reps.length ? reps.filter((t) => t.oursChosen === first[t.pair].oursChosen).length / reps.length : null;
    p.medianRt = median_(ts.map((t) => t.rt));
  }
  return people;
}

function median_(a) {
  if (!a.length) return "";
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

// Per baseline: {clean, degenerate, overall (all pairs)} ours-preferred rates for a list of participant ids.
function stratRates_(people, ids) {
  const win = {}, tot = {};
  for (const id of ids) {
    for (const t of people[id].first) {
      const k = t.group + "/" + (t.clean ? "clean" : "degenerate");
      tot[k] = (tot[k] || 0) + 1;
      win[k] = (win[k] || 0) + (t.oursChosen ? 1 : 0);
    }
  }
  const out = {};
  for (const g of Object.keys(KEY_GROUPS)) {
    const r = {};
    for (const s of ["clean", "degenerate"]) {
      const k = g + "/" + s;
      r[s + "_n"] = tot[k] || 0;
      if (tot[k]) r[s] = win[k] / tot[k];
    }
    const nAll = r.clean_n + r.degenerate_n;
    if (nAll) r.overall = ((win[g + "/clean"] || 0) + (win[g + "/degenerate"] || 0)) / nAll;
    out[g] = r;
  }
  return out;
}

// Point estimates plus 95% CIs from a bootstrap over participants.
function table_(people, ids) {
  const point = stratRates_(people, ids);
  const boots = {};
  for (let b = 0; b < BOOT && ids.length; b++) {
    const r = stratRates_(people, ids.map(() => ids[Math.floor(Math.random() * ids.length)]));
    for (const g in r) for (const s of ["clean", "degenerate", "overall"]) {
      if (r[g][s] !== undefined) (boots[g + s] = boots[g + s] || []).push(r[g][s]);
    }
  }
  const ci = (g, s) => {
    const a = (boots[g + s] || []).sort((x, y) => x - y);
    return a.length ? [a[Math.floor(0.025 * a.length)], a[Math.max(0, Math.ceil(0.975 * a.length) - 1)]] : ["", ""];
  };
  const v = (x) => (x === undefined ? "" : x);
  return Object.keys(KEY_GROUPS).map((g) => {
    const p = point[g];
    return [KEY_GROUPS[g],
      p.clean_n, v(p.clean), ...ci(g, "clean"),
      p.degenerate_n, v(p.degenerate), ...ci(g, "degenerate"),
      v(p.overall), ...ci(g, "overall")].slice(0, NCOL + 1);
  });
}

function pad_(row) { while (row.length < NCOL) row.push(""); return row.slice(0, NCOL); }

// Paper-style table: one row per baseline, VLM (paper) next to human rates of the second table.
function paperTable_(points) {
  return Object.keys(KEY_GROUPS).map((g, i) => {
    const b = KEY_GROUPS[g], v = VLM[b] || {}, h = points[i];
    const cell = (x) => (x === undefined ? "" : x);
    return pad_([PAPER_NAMES[b] || b, v.hard ?? "", v.soft ?? "", v.hardClean ?? "", v.softClean ?? "",
                 cell(h[9]), h[10] === "" ? "" : h[10].toFixed(2) + "-" + h[11].toFixed(2),
                 cell(h[2]), h[3] === "" ? "" : h[3].toFixed(2) + "-" + h[4].toFixed(2), h[1]]);
  });
}

function updateDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName("exclude")) ss.insertSheet("exclude").getRange("A1").setValue("participant IDs to leave out (one per row, from A2)");
  const people = readParticipants_(ss);
  const all = Object.keys(people).filter((id) => people[id].first.length);
  const clean = all.filter((id) => people[id].complete &&
    (people[id].consistency === null || people[id].consistency >= MIN_CONSISTENCY));
  const nAnswers = all.reduce((s, id) => s + people[id].answers, 0);
  const cons = all.map((id) => people[id].consistency).filter((c) => c !== null);
  const head = ["Ours preferred over", "Clean pairs: n", "rate", "CI low", "CI high",
                "Degenerate pairs: n", "rate", "CI low", "CI high", "All pairs", "CI low / high"];
  const fmt = (rows) => rows.map((r) => pad_([r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9],
    r[10] === "" ? "" : r[10].toFixed(3) + " / " + r[11].toFixed(3)]));
  const nG = Object.keys(KEY_GROUPS).length;
  const tAll = table_(people, all), tClean = table_(people, clean);

  // Build the sheet section by section, remembering where each table lands for formatting.
  const rows = [];
  const at = {};
  const add = (name, rs) => { at[name] = rows.length + 1; rows.push(...rs); };
  add("title", [pad_(["Human preference study: " + KEY_OURS + " vs baselines"]), pad_(["Updated", new Date()]),
    pad_(["Participants (any answer)", all.length, "completed", all.filter((id) => people[id].complete).length,
          "answers", nAnswers, "mean repeat consistency", cons.length ? cons.reduce((a, b) => a + b, 0) / cons.length : ""]),
    pad_(["Clean = neither clip collapsed (flat frames). All pairs = every answered pair, as in the paper."]),
    pad_([])]);
  add("paperTitle", [pad_(["Paper Tab. 3 view, ours on CogVideoX-5b (human = complete and consistent participants; >0.5 favours ours)"])]);
  add("paperHead", [pad_(["Ours vs.", "VLM hard (paper)", "VLM soft (paper)", "VLM hard, clean pairs", "VLM soft, clean pairs",
                          "Human, all pairs", "95% CI", "Human, clean pairs", "95% CI", "Human n (clean)"])]);
  add("paper", paperTable_(tClean));
  add("gap1", [pad_([])]);
  add("allTitle", [pad_(["All participants"])]);
  add("allHead", [pad_(head)]);
  add("all", fmt(tAll));
  add("gap2", [pad_([])]);
  add("cleanTitle", [pad_(["Complete and consistent participants (repeat agreement >= 2/3)"])]);
  add("cleanHead", [pad_(head)]);
  add("clean", fmt(tClean));
  add("gap3", [pad_([])]);
  add("pHead", [pad_(["Participant", "Expertise", "Answers", "Complete", "Repeat consistency", "Median time per pair (s)",
                      "Last answer", "In second table"])]);
  const ids = Object.keys(people).sort((a, b) => (people[b].last > people[a].last ? 1 : -1));
  add("people", ids.map((id) => {
    const p = people[id];
    return pad_([id, p.expertise, p.answers, p.complete, p.consistency === null ? "" : p.consistency,
                 p.medianRt === "" ? "" : p.medianRt / 1000, p.last, clean.includes(id)]);
  }));

  const sh = ss.getSheetByName(DASH) || ss.insertSheet(DASH, 0);
  sh.clear();
  for (const c of sh.getCharts()) sh.removeChart(c);
  sh.getRange(1, 1, rows.length, NCOL).setValues(rows);

  sh.getRange(at.title, 1).setFontWeight("bold").setFontSize(14);
  sh.getRange(at.title + 3, 1).setFontStyle("italic").setFontColor("#646b78");
  for (const k of ["paperTitle", "allTitle", "cleanTitle"]) sh.getRange(at[k], 1).setFontWeight("bold").setFontSize(12);
  for (const k of ["paperHead", "allHead", "cleanHead", "pHead"]) {
    sh.getRange(at[k], 1, 1, NCOL).setFontWeight("bold").setBackground("#ecebfd");
  }
  for (const k of ["all", "clean"]) {
    for (const c of [3, 4, 5, 7, 8, 9, 10]) sh.getRange(at[k], c, nG, 1).setNumberFormat("0.000");
    sh.getRange(at[k], 10, nG, 1).setFontWeight("bold");
  }
  // Paper view: three decimals, green above 0.5 and red below, as \win / \lose in the paper.
  for (const c of [2, 3, 4, 5, 6, 8]) {
    const r = sh.getRange(at.paper, c, nG, 1);
    r.setNumberFormat("0.000");
    const vals = r.getValues();
    r.setFontColors(vals.map(([x]) => [x === "" ? "#000000" : x > 0.5 ? "#1f7a4d" : x < 0.5 ? "#c0392b" : "#000000"]));
    r.setFontWeight("bold");
  }
  sh.getRange(at.paper, 1, nG, NCOL).setBorder(null, null, true, null, null, null);
  sh.getRange(at.title + 2, 8).setNumberFormat("0.00");
  sh.autoResizeColumns(1, NCOL);

  // Clean-pair and all-pair rate per baseline, all participants; 0.5 = no preference.
  const chart = sh.newChart().asColumnChart()
    .addRange(sh.getRange(at.allHead, 1, nG + 1, 1)).addRange(sh.getRange(at.allHead, 3, nG + 1, 1))
    .addRange(sh.getRange(at.allHead, 10, nG + 1, 1))
    .setOption("title", "Ours preferred (all participants): clean pairs vs all pairs; 0.5 = no preference")
    .setOption("vAxis", { viewWindow: { min: 0, max: 1 } })
    .setOption("series", { 0: { labelInLegend: "clean pairs" }, 1: { labelInLegend: "all pairs" } })
    .setPosition(at.people + ids.length + 2, 1, 0, 0).build();
  sh.insertChart(chart);
}
