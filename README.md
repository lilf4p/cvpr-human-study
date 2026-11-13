# Video preference study

Static site for a pairwise human preference study: each trial shows one text prompt and two
generated videos, and the participant picks the one they prefer. Hosted on GitHub Pages; answers
go to a Google Sheet through a Google Apps Script web app.

Video file names are opaque on purpose. The key mapping them to methods is kept outside this
repository; do not add it here.

## Files

- `index.html`, `style.css`, `app.js`: the page.
- `config.js`: study settings (answer endpoint, pairs per participant, repeats, wording).
- `pairs.json`, `videos/`: the generated stimuli (built by the analysis repo's `make_human_study.py`).
- `apps_script/Code.gs`: the receiver to paste into Google Apps Script.

## 1. Response sheet (once)

1. Create a Google Sheet, then Extensions > Apps Script.
2. Replace the editor contents with `apps_script/Code.gs` and save.
3. Deploy > New deployment > type **Web app**; Execute as **Me**, Who has access **Anyone**. Authorize.
4. Copy the web app URL (`https://script.google.com/macros/s/.../exec`) into `endpoint` in `config.js`.

Rows appear in the tab `responses`, one per answered pair. If you edit `Code.gs` later, use
Deploy > Manage deployments > Edit > New version, which keeps the same URL.

## 2. GitHub Pages

```bash
git init -b main && git add . && git commit -m "Video preference study"
git remote add origin git@github.com:<user>/<repo>.git   # create the empty repo on GitHub first
git push -u origin main
```

Then on GitHub: Settings > Pages > Source **Deploy from a branch**, branch `main`, folder `/`.
The study is served at `https://<user>.github.io/<repo>/`.

The repository must be public for Pages on a free account. That exposes the clips and prompts,
which are not secret, but not which method made which clip.

## Test locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

With `endpoint` empty the page runs in test mode and offers the answers as a JSON download at the
end. Progress is kept in the browser (localStorage); clear site data to start a new session.

## Live dashboard (private)

In the same Apps Script project add two files: `Dashboard.gs` (from `apps_script/`) and `Key.gs`
(generated next to the private key, never committed here). Run `installDashboard` once from the
editor and authorize it. A `dashboard` tab then shows the ours-preferred rate per baseline with 95%
bootstrap CIs, for all participants and for complete + consistent ones, plus one row per
participant. Rates are split into clean pairs (neither clip collapsed into flat frames) and
degenerate pairs, plus an overall rate reweighted to the full pair set, since the site shows clean
pairs more often (`cleanShare` in `config.js`). It refreshes every 5 minutes, or from the sheet menu Study > Refresh dashboard. Put
test participant IDs in the `exclude` tab to leave them out.

## Analysis

Export the `responses` tab as CSV and run, in the code repository:

```bash
python scripts/analyze_human_study.py responses.csv --key <path to key.json>
```
