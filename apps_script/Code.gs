// Google Apps Script receiver for the study. Paste into Extensions > Apps Script of the
// response Sheet, then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
// Each POST carries {rows: [...]}; every row becomes one line of the "responses" tab.

const COLUMNS = [
  "received_at", "participant", "session_started", "expertise", "trial", "n_trials", "pair_id",
  "prompt_idx", "group", "left", "right", "chosen", "side", "repeat", "rt_ms", "client_time",
  "viewport", "user_agent",
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("responses") || ss.insertSheet("responses");
    if (sheet.getLastRow() === 0) sheet.appendRow(COLUMNS);
    const rows = JSON.parse(e.postData.contents).rows || [];
    const now = new Date().toISOString();
    const values = rows.map((r) => COLUMNS.map((c) => (c === "received_at" ? now : r[c] ?? "")));
    if (values.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, values.length, COLUMNS.length).setValues(values);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, n: values.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput("ok");
}
