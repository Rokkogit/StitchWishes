// POST -> sends a sample order to the shop's inbox.
//
// Order forwarding is the one part of this system whose failure is silent. A
// broken catalog save says so on screen immediately; a broken notification
// looks exactly like a quiet day. The first time anyone would find out is a
// customer asking where their parcel is.
//
// So there is a button that proves the pipe works, and it can be pressed
// before any real money depends on it.
//
// Session-protected, because it sends mail. An open endpoint that sends email
// on request is a way to have someone else fill Abi's inbox.

import { json, methodNotAllowed } from '../lib/http.mjs';
import { readConfig, verifyToken, readCookie, COOKIE_NAME } from '../lib/session.mjs';
import { readNotifyConfig, sendOrderEmail, orderReference } from '../lib/notify.mjs';
import { readStore } from '../lib/global-config.mjs';
import { orderTotal, DEFAULT_SETTINGS } from '../lib/settings.mjs';

function authorized(request) {
  const config = readConfig(process.env);
  if (!config.ok) return false;

  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!token) return false;

  return verifyToken(config.secret, token).valid;
}

// A plausible order rather than a bare "test" string. The point is to see what
// a real one will look like on a phone — whether the totals read correctly,
// whether the design name is there, whether it is obvious what to make — and a
// one-line test email answers none of that.
//
// Priced with the shop's own live shipping, fees and tax, so this doubles as a
// check that those are set the way she thinks they are.
const SAMPLE_ITEMS = [
  {
    handle: 'sample-beaded-pen',
    title: 'Beaded pen',
    designName: 'Blue holographic',
    price: 12,
    quantity: 2,
    choices: [{ label: 'Ink', value: 'Black' }],
  },
  {
    handle: 'sample-night-light',
    title: 'Stitch night light',
    designName: null,
    price: 24,
    quantity: 1,
    choices: [],
  },
];

export default {
  async fetch(request) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    if (!authorized(request)) return json(401, { error: 'Sign in first.' });

    const notify = readNotifyConfig(process.env);
    if (!notify.ok) {
      return json(503, {
        error:
          'Email is not switched on yet: RESEND_API_KEY is unset. Add it in the Vercel project settings and redeploy.',
      });
    }

    // Live settings if the store has them, defaults if it does not. A store
    // that cannot be reached is not a reason to refuse a test of email.
    const store = await readStore(process.env);
    const settings = (store.ok && store.settings) || DEFAULT_SETTINGS;

    const result = await sendOrderEmail(process.env, {
      test: true,
      reference: orderReference(),
      items: SAMPLE_ITEMS,
      totals: orderTotal(SAMPLE_ITEMS, settings),
      customer: {
        name: 'Test Customer',
        email: notify.to,
        address: '123 Example Street\nSomewhere, US 12345',
        note: 'This is the note a customer would leave. If you can read this, order forwarding works.',
      },
    });

    if (!result.ok) {
      // The provider's own words, not a summary of them. Every likely failure
      // here has a different fix, and only the detail distinguishes them.
      const said = [result.status && `HTTP ${result.status}`, result.detail]
        .filter(Boolean)
        .join(' — ');

      if (result.reason === 'rejected-key') {
        return json(502, {
          error: `The email key was refused (${said}). It has expired or been revoked — make a new one in Resend.`,
        });
      }

      if (result.reason === 'rate-limited') {
        return json(502, { error: `Resend is rate-limiting this account (${said}). Try again in a minute.` });
      }

      if (result.reason === 'unreachable') {
        return json(502, { error: `Could not reach Resend at all (${said}).` });
      }

      return json(502, { error: `Resend refused the message (${said}).` });
    }

    return json(200, {
      ok: true,
      to: notify.to,
      // Whether the shop's real charges were in play, so a total that looks
      // wrong can be traced to settings rather than to this endpoint.
      pricedWith: store.ok && store.settings ? 'your live checkout settings' : 'default settings',
    });
  },
};
