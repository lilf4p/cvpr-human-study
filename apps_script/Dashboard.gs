// Live results tab for the study. Needs Key.gs (private, not in this repository) in the same
// Apps Script project. Run installDashboard() once from the editor: it builds the "dashboard" tab
// and refreshes it every 5 minutes. The sheet menu "Study > Refresh dashboard" refreshes on demand.
// Participant IDs listed in column A of the "exclude" tab (e.g. your own tests) are left out.
//
// Pairs are in two strata: clean (neither clip collapsed) and degenerate (at least one did). The site
// oversamples clean pairs, so "overall" weights the two stratum rates by their share of all pairs.

const DASH = "dashboard";
const BOOT = 2000;
const MIN_CONSISTENCY = 2 / 3;
const NCOL = 11;

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

// Per baseline: {clean, degenerate, overall} ours-preferred rates for a list of participant ids.
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
    if (r.clean !== undefined && r.degenerate !== undefined) {
      const w = KEY_CLEAN_SHARE[g];
      r.overall = w * r.clean + (1 - w) * r.degenerate;
    }
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
                "Degenerate pairs: n", "rate", "CI low", "CI high", "Overall (reweighted)", "CI low / high"];
  const fmt = (rows) => rows.map((r) => pad_([r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9],
    r[10] === "" ? "" : r[10].toFixed(3) + " / " + r[11].toFixed(3)]));
  const nG = Object.keys(KEY_GROUPS).length;

  const rows = [
    pad_(["Human preference study: " + KEY_OURS + " vs baselines"]),
    pad_(["Updated", new Date()]),
    pad_(["Participants (any answer)", all.length, "completed", all.filter((id) => people[id].complete).length,
          "answers", nAnswers, "mean repeat consistency", cons.length ? cons.reduce((a, b) => a + b, 0) / cons.length : ""]),
    pad_(["Clean = neither clip collapsed (flat frames). Overall = clean and degenerate rates weighted by their share of all pairs."]),
    pad_(["All participants"]),
    pad_(head),
    ...fmt(table_(people, all)),
    pad_([]),
    pad_(["Complete and consistent participants (repeat agreement >= 2/3)"]),
    pad_(head),
    ...fmt(table_(people, clean)),
    pad_([]),
    pad_(["Participant", "Expertise", "Answers", "Complete", "Repeat consistency", "Median time per pair (s)",
          "Last answer", "In second table"]),
  ];
  const ids = Object.keys(people).sort((a, b) => (people[b].last > people[a].last ? 1 : -1));
  for (const id of ids) {
    const p = people[id];
    rows.push(pad_([id, p.expertise, p.answers, p.complete, p.consistency === null ? "" : p.consistency,
                    p.medianRt === "" ? "" : p.medianRt / 1000, p.last, clean.includes(id)]));
  }

  const sh = ss.getSheetByName(DASH) || ss.insertSheet(DASH, 0);
  sh.clear();
  for (const c of sh.getCharts()) sh.removeChart(c);
  sh.getRange(1, 1, rows.length, NCOL).setValues(rows);

  const t1 = 7, t2 = t1 + nG + 3, tp = t2 + nG + 2;  // first data row of each table
  sh.getRange("A1").setFontWeight("bold").setFontSize(14);
  sh.getRange("A4").setFontStyle("italic").setFontColor("#646b78");
  for (const r of [t1 - 2, t2 - 2]) sh.getRange(r, 1).setFontWeight("bold").setFontSize(12);
  for (const r of [t1 - 1, t2 - 1, tp - 1]) {
    sh.getRange(r, 1, 1, NCOL).setFontWeight("bold").setBackground("#ecebfd");
  }
  for (const r of [t1, t2]) {
    for (const c of [3, 4, 5, 7, 8, 9, 10]) sh.getRange(r, c, nG, 1).setNumberFormat("0.000");
    sh.getRange(r, 10, nG, 1).setFontWeight("bold");
  }
  sh.getRange("H3").setNumberFormat("0.00");
  sh.setFrozenRows(0);
  sh.autoResizeColumns(1, NCOL);

  // Clean-pair rate per baseline, all participants; 0.5 = no preference.
  const chart = sh.newChart().asColumnChart()
    .addRange(sh.getRange(t1 - 1, 1, nG + 1, 1)).addRange(sh.getRange(t1 - 1, 3, nG + 1, 1))
    .addRange(sh.getRange(t1 - 1, 10, nG + 1, 1))
    .setOption("title", "Ours preferred (all participants): clean pairs vs overall; 0.5 = no preference")
    .setOption("vAxis", { viewWindow: { min: 0, max: 1 } })
    .setOption("series", { 0: { labelInLegend: "clean pairs" }, 1: { labelInLegend: "overall (reweighted)" } })
    .setPosition(tp + ids.length + 2, 1, 0, 0).build();
  sh.insertChart(chart);
}
