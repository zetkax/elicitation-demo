/**
 * Response persistence: build the payload, POST it, and keep an on-device
 * backup so a failed or unconfigured send is never silent data loss.
 *
 * `createStore` takes its configuration rather than reading globals, so tests
 * drive it with a fake fetch and a fake localStorage.
 */
import { N } from "./stats.js";

export function createStore({ endpoint, surveyVersion, startedAt, pendingKey = "elicitation_pending_v1" }) {
  function makeResponseId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `r-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }
  
  // A spreadsheet cell cannot hold an array or object, so anything non-scalar
  // is stored as JSON rather than stringifying to "[object Object]".
  // Free-text answers are trimmed: a stray space makes a name look like a
  // different person when you sort or match the follow-up list.
  function flattenValue(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    if (typeof value === "string") return value.trim();
    return value;
  }
  
  function buildPayload(data) {
    const submittedAt = new Date();
    const payload = {
      response_id: makeResponseId(),
      submitted_at: submittedAt.toISOString(),
      started_at: startedAt,
      duration_seconds: Math.round(
        (submittedAt.getTime() - new Date(startedAt).getTime()) / 1000,
      ),
      survey_version: surveyVersion,
      user_agent: navigator.userAgent,
    };
  
    Object.keys(data).forEach((key) => {
      if (key === "credible_interval_90") return;
      payload[key] = flattenValue(data[key]);
    });
  
    // The 90% interval is the headline output, so it gets its own two columns
    // instead of arriving as a JSON string nobody can chart.
    const interval = data.credible_interval_90;
    if (Array.isArray(interval) && interval.length === 2) {
      payload.ci90_low = interval[0];
      payload.ci90_high = interval[1];
    }
  
    return payload;
  }
  
  async function postResponse(payload) {
    // text/plain keeps this a CORS "simple request". Apps Script web apps do
    // not answer the preflight that application/json would trigger.
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
  
    if (!response.ok) {
      throw new Error(`Collector returned HTTP ${response.status}.`);
    }
  
    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.error || "Collector rejected the response.");
    }
  
    return result;
  }
  
  function readPending() {
    try {
      const stored = JSON.parse(localStorage.getItem(pendingKey));
      return Array.isArray(stored) ? stored : [];
    } catch (error) {
      return [];
    }
  }
  
  function writePending(items) {
    try {
      localStorage.setItem(pendingKey, JSON.stringify(items));
    } catch (error) {
      console.warn("Could not write the pending-response backup.", error);
    }
  }
  
  // Keyed on response_id so a retried save replaces its earlier attempt
  // instead of stacking duplicates in the buffer.
  function queuePending(payload) {
    const items = readPending().filter(
      (item) => item.response_id !== payload.response_id,
    );
    items.push(payload);
    writePending(items);
  }
  
  function dropPending(responseId) {
    const items = readPending();
    const remaining = items.filter((item) => item.response_id !== responseId);
    if (remaining.length !== items.length) writePending(remaining);
  }
  
  async function flushPending() {
    if (!endpoint) return;
  
    const items = readPending();
    if (!items.length) return;
  
    const stillPending = [];
    for (const item of items) {
      try {
        await postResponse(item);
      } catch (error) {
        stillPending.push(item);
      }
    }
  
    writePending(stillPending);
  
    const sent = items.length - stillPending.length;
    if (sent > 0) {
      console.log(`Recovered and sent ${sent} pending response(s).`);
    }
  }
  
  // Built once and reused, so the "Try again" button on a failed save cannot

  return { buildPayload, postResponse, queuePending, dropPending, readPending, flushPending };
}
