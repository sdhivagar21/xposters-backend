// Work that runs after the response has been sent (order emails, milestone
// checks). On Vercel a function can be paused as soon as it has answered, so
// the work is handed to waitUntil, which keeps it alive until it finishes.
// Anywhere else (Render, local) it simply runs in the background as before.
let waitUntil = null;
try {
  ({ waitUntil } = require("@vercel/functions"));
} catch {
  // not installed - plain fire-and-forget
}

function inBackground(...tasks) {
  const done = Promise.allSettled(tasks.map((t) => Promise.resolve(t))).then((results) => {
    for (const r of results) if (r.status === "rejected") console.error("[background]", r.reason && r.reason.message);
  });
  if (waitUntil) {
    try {
      waitUntil(done);
    } catch {
      // outside a request context - nothing to extend
    }
  }
  return done;
}

module.exports = { inBackground };
