/**
 * Expert elicitation demo — results collector.
 *
 * Deployed as a Web App, this receives one JSON payload per completed survey
 * and appends it to the bound spreadsheet. Headers are managed dynamically:
 * a payload key that has not been seen before becomes a new column, so adding
 * a question to the survey does not require touching this script.
 */

const SHEET_NAME = "responses";

// The endpoint is unauthenticated by necessity -- respondents are not signed
// in -- so treat every payload as hostile input. These caps bound how much
// damage one request can do.
const MAX_FIELDS = 120;
const MAX_CELL_LENGTH = 5000;

/**
 * Sheets evaluates any cell whose text begins with =, +, - or @ as a formula.
 * A submitted formula runs when someone opens the sheet, and functions like
 * IMPORTXML can post other cells' contents to an arbitrary URL -- so an
 * open collector would otherwise be a data-exfiltration route. Prefixing with
 * an apostrophe keeps the text readable and inert.
 */
function sanitizeCell_(value) {
  if (typeof value !== "string") return value;

  const trimmed =
    value.length > MAX_CELL_LENGTH ? value.slice(0, MAX_CELL_LENGTH) + "…" : value;

  return /^[=+\-@\t\r]/.test(trimmed) ? "'" + trimmed : trimmed;
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  // Two browsers finishing at once would otherwise race on the header row.
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ ok: false, error: "Collector busy, try again." });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: "Empty request body." });
    }

    const payload = JSON.parse(e.postData.contents);

    // A column bomb is the cheapest way to make this sheet unusable, so a
    // payload with an implausible number of fields is refused outright.
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json_({ ok: false, error: "Payload must be a JSON object." });
    }
    if (Object.keys(payload).length > MAX_FIELDS) {
      return json_({ ok: false, error: "Too many fields." });
    }

    const rowNumber = writeRow_(getSheet_(), payload);

    return json_({
      ok: true,
      response_id: payload.response_id || null,
      row: rowNumber,
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Lets you sanity-check the deployment by opening the URL in a browser. */
function doGet() {
  return json_({ ok: true, service: "elicitation-demo collector" });
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return (
    spreadsheet.getSheetByName(SHEET_NAME) ||
    spreadsheet.insertSheet(SHEET_NAME)
  );
}

function writeRow_(sheet, payload) {
  const lastColumn = sheet.getLastColumn();
  let headers =
    lastColumn > 0
      ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].filter(String)
      : [];

  const newKeys = Object.keys(payload).filter(function (key) {
    return headers.indexOf(key) === -1;
  });

  if (newKeys.length) {
    headers = headers.concat(newKeys);
    // Header text is payload-controlled too, so it gets the same treatment as
    // cell values -- a key named "=IMPORTXML(...)" would otherwise run.
    sheet
      .getRange(1, 1, 1, headers.length)
      .setValues([headers.map(sanitizeCell_)]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  const row = headers.map(function (key) {
    const value = payload[key];
    return value === undefined || value === null ? "" : sanitizeCell_(value);
  });

  sheet.appendRow(row);
  return sheet.getLastRow();
}

function json_(object) {
  return ContentService.createTextOutput(
    JSON.stringify(object),
  ).setMimeType(ContentService.MimeType.JSON);
}
