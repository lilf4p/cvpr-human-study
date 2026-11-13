(() => {
  "use strict";
  const C = window.STUDY_CONFIG;
  const STORE = "vps_session_v1";
  const QUEUE = "vps_queue_v1";
  const $ = (id) => document.getElementById(id);

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "p" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Pick trialsPerParticipant pairs, an equal number per group, each prompt at most once,
  // random sides; then insert repeats (sides swapped) in the second half. Pairs are sampled
  // uniformly, as in the VLM preference of the paper (pair.clean is only used by the analysis).
  function buildPlan(pairs) {
    const groups = [...new Set(pairs.map((p) => p.group))];
    const perGroup = Math.floor(C.trialsPerParticipant / groups.length);
    const prompts = shuffle([...new Set(pairs.map((p) => p.prompt_idx))]);
    const byKey = new Map(pairs.map((p) => [p.group + "/" + p.prompt_idx, p]));
    const trials = [];
    let k = 0;
    for (const g of shuffle(groups.slice())) {
      for (let n = 0; n < perGroup && k < prompts.length; n++, k++) {
        const p = byKey.get(g + "/" + prompts[k]);
        const flip = Math.random() < 0.5;
        trials.push({ pair: p.id, left: flip ? p.v2 : p.v1, right: flip ? p.v1 : p.v2, repeat: 0 });
      }
    }
    shuffle(trials);
    const half = Math.ceil(trials.length / 2);
    const nRep = Math.min(C.repeatTrials, half);
    const src = shuffle(trials.slice(0, half).map((t, i) => i)).slice(0, nRep);
    for (const i of src) {
      const t = trials[i];
      const at = half + Math.floor(Math.random() * (trials.length - half + 1));
      trials.splice(at, 0, { pair: t.pair, left: t.right, right: t.left, repeat: 1 });
    }
    return trials;
  }

  let pairsById = null;
  let S = null; // session state, persisted
  let shownAt = 0;
  let unlockTimer = null;
  let expertise = "";

  function save() { store.set(STORE, S); }

  // Every answer goes to a persistent queue first, so nothing is lost on a network error or reload.
  function enqueue(row) {
    const q = store.get(QUEUE) || [];
    q.push(row);
    store.set(QUEUE, q);
    flush();
  }
  let flushing = false;
  async function flush() {
    if (!C.endpoint || flushing) return;
    const q = store.get(QUEUE) || [];
    if (!q.length) return;
    flushing = true;
    try {
      // text/plain avoids a CORS preflight, which Apps Script does not answer.
      await fetch(C.endpoint, { method: "POST", mode: "no-cors", body: JSON.stringify({ rows: q }),
        headers: { "Content-Type": "text/plain;charset=utf-8" } });
      const now = store.get(QUEUE) || [];
      store.set(QUEUE, now.slice(q.length));
    } catch (e) {
      setTimeout(flush, 5000);
    } finally {
      flushing = false;
    }
    if ((store.get(QUEUE) || []).length) setTimeout(flush, 1000);
    updateSync();
  }
  function updateSync() {
    if ($("done").hidden) return;
    const n = (store.get(QUEUE) || []).length;
    $("sync").textContent = !C.endpoint ? "Test mode: no server configured, answers were not sent."
      : n ? `Sending ${n} answer(s)… please keep this page open.` : "";
  }

  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
    $("status").hidden = id !== "trial";
    window.scrollTo(0, 0);
  }

  function lock(on) {
    $("pick-left").disabled = on;
    $("pick-right").disabled = on;
    $("wait").textContent = on ? "Watch both videos…" : "Choose the video you prefer";
  }

  function startUnlock(ms) {
    const bar = $("unlock-bar");
    bar.style.transition = "none";
    bar.style.width = "0";
    void bar.offsetWidth; // restart the transition
    bar.style.transition = `width ${ms}ms linear`;
    bar.style.width = "100%";
    unlockTimer = setTimeout(() => lock(false), ms);
  }

  function loadVideo(el, file) {
    return new Promise((resolve) => {
      // Some mobile browsers never fire canplaythrough before playback starts; do not wait forever.
      const timer = setTimeout(() => done(), 4000);
      const done = () => { clearTimeout(timer); el.removeEventListener("canplaythrough", done); resolve(); };
      el.addEventListener("canplaythrough", done);
      el.addEventListener("error", done, { once: true });
      el.src = "videos/" + file;
      el.load();
    });
  }

  function preload(t) {
    if (!t) return;
    // Warm the HTTP cache so the next pair starts without a visible load.
    for (const f of [t.left, t.right]) fetch("videos/" + f).catch(() => {});
  }

  function setProgress() {
    $("bar").style.width = (100 * S.i / S.trials.length) + "%";
    $("count").textContent = `${Math.min(S.i + 1, S.trials.length)} / ${S.trials.length}`;
  }

  async function showTrial() {
    if (S.i >= S.trials.length) return finish();
    const t = S.trials[S.i];
    const p = pairsById.get(t.pair);
    lock(true);
    clearTimeout(unlockTimer);
    $("unlock-bar").style.transition = "none";
    $("unlock-bar").style.width = "0";
    setProgress();
    $("pair").classList.add("loading");
    $("prompt").textContent = "“" + p.prompt + "”";
    const L = $("vid-left"), R = $("vid-right");
    await Promise.all([loadVideo(L, t.left), loadVideo(R, t.right)]);
    $("pair").classList.remove("loading");
    for (const o of ["opt-left", "opt-right"]) $(o).classList.remove("picked");
    L.currentTime = 0; R.currentTime = 0;
    await Promise.allSettled([L.play(), R.play()]);
    shownAt = performance.now();
    startUnlock(C.minViewMs);
    preload(S.trials[S.i + 1]);
  }

  function choose(side) {
    if ($("pick-left").disabled) return;
    const rt = Math.round(performance.now() - shownAt);
    lock(true);
    $(side === "left" ? "opt-left" : "opt-right").classList.add("picked");
    const t = S.trials[S.i];
    const p = pairsById.get(t.pair);
    const row = {
      participant: S.participant, session_started: S.started, expertise: S.expertise,
      trial: S.i, n_trials: S.trials.length, pair_id: t.pair, prompt_idx: p.prompt_idx, group: p.group,
      left: t.left, right: t.right, chosen: side === "left" ? t.left : t.right, side,
      repeat: t.repeat, rt_ms: rt,
      client_time: new Date().toISOString(), viewport: innerWidth + "x" + innerHeight,
      user_agent: navigator.userAgent,
    };
    S.answers.push(row);
    S.i += 1;
    save();
    enqueue(row);
    setProgress();
    setTimeout(showTrial, 280); // brief highlight of the pick
  }

  function finish() {
    for (const v of [$("vid-left"), $("vid-right")]) { v.pause(); v.removeAttribute("src"); v.load(); }
    S.finished = S.finished || new Date().toISOString();
    save();
    show("done");
    if (C.completionCode) {
      $("code").hidden = false;
      $("code").textContent = "Completion code: " + C.completionCode;
    }
    if (!C.endpoint) $("download").hidden = false;
    updateSync();
    flush();
  }

  function download() {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `answers_${S.participant}.json`;
    a.click();
  }

  async function init() {
    $("title").textContent = C.title;
    $("lead").textContent = C.lead || "";
    $("question").textContent = C.question;
    for (const s of C.instructions) {
      const li = document.createElement("li"); li.textContent = s; $("instructions").appendChild(li);
    }
    const nTotal = C.trialsPerParticipant + C.repeatTrials;
    $("chip-time").textContent = `About ${Math.ceil(nTotal * 12 / 60)} minutes`;
    $("chip-pairs").textContent = `${nTotal} video pairs`;

    let data;
    try {
      data = await (await fetch("pairs.json", { cache: "no-cache" })).json();
    } catch (e) {
      $("error").hidden = false;
      $("error").textContent = "Could not load the study. Please reload the page.";
      return;
    }
    pairsById = new Map(data.pairs.map((p) => [p.id, p]));

    const ready = () => { $("start").disabled = !($("consent").checked && (expertise || S)); };
    for (const b of $("expertise").querySelectorAll("button")) {
      b.addEventListener("click", () => {
        expertise = b.dataset.v;
        for (const o of $("expertise").querySelectorAll("button")) o.setAttribute("aria-checked", String(o === b));
        ready();
      });
    }
    $("consent").addEventListener("change", ready);
    $("start").addEventListener("click", () => {
      if (!S) {
        S = { participant: uuid(), started: new Date().toISOString(), expertise,
              trials: buildPlan(data.pairs), i: 0, answers: [] };
        save();
      }
      show("trial");
      showTrial();
    });
    $("pick-left").addEventListener("click", () => choose("left"));
    $("pick-right").addEventListener("click", () => choose("right"));
    $("download").addEventListener("click", download);
    document.addEventListener("keydown", (e) => {
      if ($("trial").hidden) return;
      if (e.key === "ArrowLeft") choose("left");
      if (e.key === "ArrowRight") choose("right");
    });
    window.addEventListener("online", flush);

    const old = store.get(STORE);
    if (old && old.trials && old.trials.every((t) => pairsById.has(t.pair))) {
      S = old;
      if (S.finished) return finish();
      if (S.i > 0) $("resume-note").hidden = false;
    }
    flush();
  }

  init();
})();
