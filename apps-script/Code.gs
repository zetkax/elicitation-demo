/**
 * Expert elicitation demo — results collector.
 *
 * Deployed as a Web App, this receives one JSON payload per completed survey
 * and appends it to the bound spreadsheet. Headers are managed dynamically:
 * a payload key that has not been seen before becomes a new column, so adding
 * a question to the survey does not require touching this script.
 */

const SHEET_NAME = "responses";

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
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  const row = headers.map(function (key) {
    const value = payload[key];
    return value === undefined || value === null ? "" : value;
  });

  sheet.appendRow(row);
  return sheet.getLastRow();
}

function json_(object) {
  return ContentService.createTextOutput(
    JSON.stringify(object),
  ).setMimeType(ContentService.MimeType.JSON);
}
