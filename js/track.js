// Funnel tracking for the server-rendered pages: store pages, category pages
// and the store directory.
//
// Those pages carry no application JavaScript at all — that is the point of
// them, they render complete on the server for crawlers — so until now they
// recorded nothing. Every visitor arriving from search landed on a page that
// could not tell anyone they had arrived, which meant the funnel only ever
// saw people who hit the homepage. The SEO work was the thing being measured
// and the only thing invisible.
//
// Deliberately standalone, with no dependency on app.js: these pages must stay
// cheap, and app.js is 1,600 lines of catalog UI none of them use. The price
// is that getVisitorId and getAttribution are duplicated from app.js — so the
// STORAGE KEYS BELOW MUST MATCH app.js EXACTLY. If they drift, one person
// browsing from a category page to the homepage becomes two visitors with two
// first touches, and every rate in the report is wrong in a way that looks
// plausible.

(function () {
  "use strict";

  // Must match VISITOR_KEY and ATTRIBUTION_KEY in js/app.js.
  var VISITOR_KEY = "omd_visitor_id";
  var ATTRIBUTION_KEY = "omd_first_touch";

  function getVisitorId() {
    try {
      var id = localStorage.getItem(VISITOR_KEY);
      if (!id) {
        id = ((window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
              String(Date.now()) + Math.random().toString(36).slice(2))
             .replace(/[^A-Za-z0-9-]/g, "");
        localStorage.setItem(VISITOR_KEY, id);
      }
      return id;
    } catch (e) {
      return null; // private mode with storage blocked — just don't track
    }
  }

  // First touch, not last. Written here as well as in app.js precisely because
  // a search visitor's first touch now happens on this page: if only the
  // homepage recorded it, arriving via /tech-deals and then clicking through
  // would attribute the visit to an internal referral instead of to search.
  function getAttribution() {
    try {
      var stored = localStorage.getItem(ATTRIBUTION_KEY);
      if (stored) return JSON.parse(stored);

      var params = new URLSearchParams(location.search);
      var referrerHost = document.referrer && document.referrer.indexOf(location.host) === -1
        ? new URL(document.referrer).hostname
        : null;

      var touch = {
        source: params.get("utm_source") || referrerHost || "direct",
        medium: params.get("utm_medium") || (referrerHost ? "referral" : "none"),
        campaign: params.get("utm_campaign") || null
      };
      localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(touch));
      return touch;
    } catch (e) {
      return { source: "direct", medium: "none", campaign: null };
    }
  }

  function track(step, dealId) {
    var visitorId = getVisitorId();
    if (!visitorId) return;
    var touch = getAttribution();
    var body = JSON.stringify({
      visitorId: visitorId,
      step: step,
      dealId: dealId || null,
      source: touch.source,
      medium: touch.medium,
      campaign: touch.campaign,
      landingPath: location.pathname
    });

    // sendBeacon rather than fetch, because every outbound link on these pages
    // navigates away: a fetch fired on click is cancelled when the page
    // unloads, which would lose exactly the clicks worth counting. Falls back
    // to a keepalive fetch where beacon isn't available.
    try {
      if (navigator.sendBeacon &&
          navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }))) {
        return;
      }
    } catch (e) { /* fall through */ }

    try {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* analytics must never break the page */ }
  }

  track("page_view");

  // A "Get code" link here goes to /?deal=<id>, where app.js opens the modal
  // and records the deal_view itself. Recording it here as well would be the
  // same visitor twice, and the report counts distinct visitors per step, so
  // it would change nothing except the event count. What it does buy is the
  // clicks that never complete — a slow connection, a closed tab — which on
  // these pages is the signal that the page did its job.
  document.addEventListener("click", function (e) {
    var link = e.target && e.target.closest ? e.target.closest("a[href*='/?deal=']") : null;
    if (!link) return;
    var match = /[?&]deal=([^&]+)/.exec(link.getAttribute("href") || "");
    track("deal_view", match ? decodeURIComponent(match[1]) : null);
  }, true);
})();
