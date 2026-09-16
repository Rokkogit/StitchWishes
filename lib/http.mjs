// Shared response shaping for the admin endpoints.
// In lib/ rather than api/ so it is bundled into the functions that import it
// instead of being deployed as a route of its own.

// no-store on every admin response: these are per-session answers, and nothing
// between us and the browser should ever hold on to one.
export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function methodNotAllowed(allowed) {
  return json(405, { error: `Use ${allowed}.` }, { Allow: allowed });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
