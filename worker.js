// Agent Console — Cloudflare Worker proxy
// Deploy: Cloudflare dashboard → Workers & Pages → donnajbe → Edit code →
// replace ALL of the code with this file → Deploy.
//
// What it does:
//   OPTIONS            — answers CORS preflights itself. Browsers send one
//                        before the real API call; forwarding it to OpenAI
//                        gets a response that doesn't allow the Authorization
//                        header, and the browser then blocks the real request.
//   /v1/*              — forwards to api.openai.com (chat completions etc.)
//   /read?url=…        — fetches a web page server-side and returns its HTML
//                        so research mode can read pages the browser itself
//                        is not allowed to fetch (CORS). HTML/text only.

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GPA-Key, X-GPA-User',
      'Access-Control-Max-Age': '86400'
    };
    const json = (obj, status) => new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });

    // Moderation state for one user: active (default), blocked, or locked,
    // plus a kick counter the client compares against to force a one-time
    // sign-out. Read wherever we need to enforce or report it.
    // The owner is immune to all moderation and always allowed, even in
    // private mode. Defaults to 'viztrrx'; override with an OWNER env var.
    const OWNER = String((env && env.OWNER) || 'viztrrx').toLowerCase();

    const getMod = async (kv, user) => {
      if (!kv || !user) return { state: 'active', reason: '', kickNonce: 0 };
      const m = await kv.get('mod:' + String(user).toLowerCase(), 'json');
      return m || { state: 'active', reason: '', kickNonce: 0 };
    };
    const getConfig = async (kv) => (kv && (await kv.get('config', 'json'))) || { privateMode: false };

    // Effective state for one user, combining their own moderation record with
    // global config. Order: owner is always active; an explicit block/lock
    // wins next; then private mode blocks anyone without an allow exemption.
    const resolveState = (mod, cfg, user) => {
      if (String(user).toLowerCase() === OWNER) return { state: 'active', reason: '', kickNonce: 0, owner: true };
      if (mod.state === 'blocked') return { state: 'blocked', reason: mod.reason || '', kickNonce: mod.kickNonce || 0 };
      if (mod.state === 'locked') return { state: 'locked', reason: mod.reason || '', kickNonce: mod.kickNonce || 0 };
      if (cfg.privateMode && !mod.allow) return { state: 'blocked', reason: mod.reason || 'This tool is currently private — access is limited to the owner.', kickNonce: mod.kickNonce || 0, private: true };
      return { state: 'active', reason: '', kickNonce: mod.kickNonce || 0 };
    };
    const resolve = async (kv, user) => resolveState(await getMod(kv, user), await getConfig(kv), user);
    const sha256hex = async (str) => {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
    };
    // Human-friendly code: uppercase, no 0/O/1/I/L ambiguity.
    const genCode = () => {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      const a = new Uint8Array(8); crypto.getRandomValues(a);
      return [...a].map((x) => chars[x % chars.length]).join('');
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(req.url);

    // ==== Usage telemetry (Cloudflare KV) ================================
    //
    // Backed by a KV namespace you bind as `TELEMETRY` in the Cloudflare
    // dashboard, and an admin secret you set as the `ADMIN_TOKEN` variable.
    // Neither the KV nor the token is ever exposed to the browser: users can
    // only WRITE their own heartbeat (/track), and only a request bearing the
    // ADMIN_TOKEN can READ the logs (/admin/*). That is real, server-side
    // access control — unlike a key placed in the public script, which anyone
    // could read. Presence ("active now") is a per-session KV key with a short
    // TTL, so a user drops off the live list on their own ~2.5 min after their
    // last heartbeat, with no cleanup job.
    const SESSION_TTL = 150;        // seconds a session counts as "active"

    if (url.pathname === '/track' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ ok: false, error: 'telemetry KV not bound' }, 200);
      // text/plain body so the browser sends no CORS preflight.
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
      const user = clip(body.user || 'anonymous', 80);
      const sid = clip(body.sid, 60) || crypto.randomUUID();
      const now = Date.now();
      const cf = req.cf || {};
      const rec = {
        user,
        host: clip(body.host, 120),
        url: clip(body.url, 300),
        country: cf.country || '??',
        region: clip(cf.region || cf.city || '', 60),
        lastSeen: now
      };
      try {
        // Presence: expires on its own -> "active now" needs no cleanup.
        await kv.put('session:' + sid, JSON.stringify(rec), { expirationTtl: SESSION_TTL });
        // All-time rollup, refreshed on the "open" event (not every beat) to
        // stay well inside KV's free-tier write budget.
        if (body.event === 'open') {
          const uKey = 'user:' + user.toLowerCase();
          const prev = await kv.get(uKey, 'json');
          await kv.put(uKey, JSON.stringify({
            user,
            host: rec.host,
            country: rec.country,
            region: rec.region,
            firstSeen: (prev && prev.firstSeen) || now,
            lastSeen: now,
            opens: ((prev && prev.opens) || 0) + 1
          }));
        }
      } catch (e) { return json({ ok: false }, 200); }
      // Hand the caller its own effective state back on every beat, so a
      // block/lock/kick/private-mode change reaches them within one heartbeat
      // even without the separate /status poll.
      const r = await resolve(kv, user);
      return json({ ok: true, state: r.state, reason: r.reason, kickNonce: r.kickNonce, owner: !!r.owner, private: !!r.private });
    }

    // Read-only status for one user — the client polls this so a block takes
    // effect fast without waiting for the next (write-costing) heartbeat.
    if (url.pathname === '/status' && req.method === 'GET') {
      const kv = env && env.TELEMETRY;
      const r = await resolve(kv, url.searchParams.get('user') || '');
      return json({ state: r.state, reason: r.reason, kickNonce: r.kickNonce, owner: !!r.owner, private: !!r.private });
    }

    // Owner sets a user's moderation state. Token-gated like the other admin
    // routes, so only the owner can call it.
    if (url.pathname === '/admin/moderate' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const user = String(body.user || '').toLowerCase().slice(0, 80);
      if (!user) return json({ error: 'no user' }, 400);
      // The owner can never be blocked/locked/kicked.
      if (user === OWNER) return json({ ok: false, error: 'This user is the owner and is immune to moderation.' }, 200);
      const key = 'mod:' + user;
      const cur = (await kv.get(key, 'json')) || { state: 'active', reason: '', kickNonce: 0 };
      const action = body.action;
      if (action === 'block') { cur.state = 'blocked'; cur.allow = false; }
      else if (action === 'unblock') { cur.state = 'active'; cur.allow = true; }   // explicit allow (exempts from private mode)
      else if (action === 'lock') cur.state = 'locked';
      else if (action === 'unlock' || action === 'reset') cur.state = 'active';
      else if (action === 'kick') cur.kickNonce = (cur.kickNonce || 0) + 1;
      else return json({ error: 'unknown action' }, 400);
      cur.reason = String(body.reason || '').slice(0, 300);
      cur.updatedAt = Date.now();
      await kv.put(key, JSON.stringify(cur));
      return json({ ok: true, user, mod: cur });
    }

    // Global config: currently just private mode (block everyone but owner).
    if (url.pathname === '/admin/config' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const cfg = await getConfig(kv);
      if ('privateMode' in body) cfg.privateMode = !!body.privateMode;
      await kv.put('config', JSON.stringify(cfg));
      return json({ ok: true, config: cfg, owner: OWNER });
    }

    // Owner mints a one-time unlock code for ONE user. We store only its hash,
    // and hand the plaintext back this once for the owner to pass along. The
    // code releases only this username's block, and is consumed on use.
    if (url.pathname === '/admin/setunlock' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const user = String(body.user || '').toLowerCase().slice(0, 80);
      if (!user) return json({ error: 'no user' }, 400);
      const key = 'mod:' + user;
      const cur = (await kv.get(key, 'json')) || { state: 'active', reason: '', kickNonce: 0 };
      const code = genCode();
      cur.unlock = await sha256hex(user + '|' + code);   // only the hash is stored
      cur.unlockAt = Date.now();
      await kv.put(key, JSON.stringify(cur));
      return json({ ok: true, user, code });
    }

    // A blocked user redeems the code the owner gave them. Not token-gated —
    // knowing the code is the credential. Only flips this one username, and
    // only when the code matches; the code is single-use.
    if (url.pathname === '/unlock' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ ok: false, error: 'telemetry KV not bound' }, 200);
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const user = String(body.user || '').toLowerCase().slice(0, 80);
      const code = String(body.code || '').trim().toUpperCase();
      if (!user || !code) return json({ ok: false, error: 'missing user or code' }, 200);
      const key = 'mod:' + user;
      const cur = await kv.get(key, 'json');
      if (!cur || !cur.unlock) return json({ ok: false, error: 'no unlock code set for this user' }, 200);
      const h = await sha256hex(user + '|' + code);
      if (h !== cur.unlock) return json({ ok: false, error: 'invalid code' }, 200);
      cur.state = 'active';
      cur.reason = '';
      cur.allow = true;             // also exempts them from private mode
      delete cur.unlock;            // single use
      delete cur.unlockAt;
      cur.updatedAt = Date.now();
      await kv.put(key, JSON.stringify(cur));
      return json({ ok: true, state: 'active' });
    }

    if (url.pathname === '/admin/summary' && req.method === 'GET') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound on the worker' }, 500);
      if (!ADMIN) return json({ error: 'ADMIN_TOKEN not set on the worker' }, 500);
      if ((url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);

      const active = [];
      const sess = await kv.list({ prefix: 'session:' });
      for (const k of sess.keys) { const v = await kv.get(k.name, 'json'); if (v) active.push(v); }
      const users = [];
      const ul = await kv.list({ prefix: 'user:' });
      for (const k of ul.keys) { const v = await kv.get(k.name, 'json'); if (v) users.push(v); }

      // Effective states, so the admin sees who's blocked/locked/private and
      // who the owner is at a glance.
      const cfg = await getConfig(kv);
      const mods = {};
      const ml = await kv.list({ prefix: 'mod:' });
      for (const k of ml.keys) { const v = await kv.get(k.name, 'json'); if (v) mods[k.name.slice(4)] = v; }
      const stampOne = (x) => {
        const r = resolveState(mods[String(x.user).toLowerCase()] || { state: 'active' }, cfg, x.user);
        return { ...x, state: r.state, reason: r.reason, owner: !!r.owner, private: !!r.private };
      };

      // Collapse multiple live sessions from one user into a single presence.
      const activeByUser = {};
      active.forEach((s) => {
        const u = activeByUser[s.user];
        if (!u || s.lastSeen > u.lastSeen) activeByUser[s.user] = s;
      });
      return json({
        now: Date.now(),
        owner: OWNER,
        privateMode: !!cfg.privateMode,
        activeCount: Object.keys(activeByUser).length,
        active: Object.values(activeByUser).sort((a, b) => b.lastSeen - a.lastSeen).map(stampOne),
        users: users.sort((a, b) => b.lastSeen - a.lastSeen).map(stampOne)
      });
    }

    if (url.pathname === '/admin/clear' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
      let deleted = 0;
      for (const prefix of ['session:', 'user:']) {
        const list = await kv.list({ prefix });
        for (const k of list.keys) { await kv.delete(k.name); deleted++; }
      }
      return json({ ok: true, deleted });
    }

    // ---- /read?url=… : server-side page fetch for research mode ----
    if (url.pathname === '/read') {
      const target = url.searchParams.get('url');
      if (!target || !/^https?:\/\//i.test(target)) {
        return new Response(JSON.stringify({ error: 'missing or bad ?url=' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      let upstream;
      try {
        upstream = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentConsole/1.0; research reader)' },
          redirect: 'follow'
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'fetch failed' }), {
          status: 502,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      const type = upstream.headers.get('content-type') || '';
      if (!type.includes('text/html') && !type.includes('text/plain')) {
        return new Response(JSON.stringify({ error: 'not an HTML/text page: ' + type }), {
          status: 415,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      let body = await upstream.text();
      if (body.length > 3000000) body = body.slice(0, 3000000);
      return new Response(body, {
        status: 200,
        headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // ---- /v1/* : forward to OpenAI ----
    // Server-side moderation tooth: a blocked user is refused here, so blocking
    // actually costs them the AI features rather than only hiding the panel.
    // The client sends its signed-in name as X-GPA-User. (This can't gate
    // Gemini, which the browser calls directly, or a user who supplies their
    // own key in direct mode — those bypass the worker entirely.)
    const modUser = req.headers.get('X-GPA-User');
    if (modUser && env && env.TELEMETRY) {
      const r = await resolve(env.TELEMETRY, modUser);   // owner resolves to active
      if (r.state === 'blocked') {
        return json({ error: { message: 'Access to this tool has been blocked by the owner.' + (r.reason ? ' ' + r.reason : ''), type: 'blocked_by_owner' } }, 403);
      }
    }

    // The key can arrive four ways, tried in this order:
    //   1. a normal Authorization header
    //   2. the X-GPA-Key header    — for pages that rewrite Authorization
    //   3. a _gpa_key field in the JSON body — for pages whose wrappers strip
    //      custom headers too. Preferred over a query parameter because a key
    //      in a URL leaks into browser history, Referer headers, proxy/CDN
    //      logs and screenshots; a key in a body leaks into none of those.
    //   4. ?key= in the query string — legacy, still accepted so an older
    //      copy of script.js keeps working, but it should be considered
    //      compromised once used and rotated.
    let bodyText;
    let keyFromBody = '';

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      bodyText = await req.text();
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText);
          if (parsed && typeof parsed._gpa_key === 'string') {
            keyFromBody = parsed._gpa_key;
            delete parsed._gpa_key;          // never forward it upstream
            bodyText = JSON.stringify(parsed);
          }
        } catch (e) { /* not JSON — forward untouched */ }
      }
    }

    // A header value may only contain printable ASCII. If a key picked up an
    // invisible character somewhere (a zero-width space pasted in with it, a
    // stray newline), passing it straight to fetch throws a TypeError and the
    // whole worker 500s. Strip it here so the request still goes through.
    const strip = (v) => (v ? String(v).replace(/[^\x21-\x7E]/g, '') : '');
    const bearer = strip((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''))
      || strip(req.headers.get('X-GPA-Key'))
      || strip(keyFromBody)
      || strip(url.searchParams.get('key'));

    // Without this, a missing key was forwarded as the literal header
    // "Authorization: null", and OpenAI's reply ("You didn't provide an API
    // key") made it look like the key itself was at fault.
    if (!bearer) {
      return new Response(JSON.stringify({
        error: {
          message: 'No API key reached the proxy. The page is probably stripping headers — make sure script.js and worker.js are both up to date, since the key channel they agree on changed.',
          type: 'agent_console_no_key'
        }
      }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const res = await fetch('https://api.openai.com' + url.pathname, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${bearer}`,
        'Content-Type': 'application/json'
      },
      body: bodyText
    });
    const r = new Response(res.body, res);
    r.headers.set('Access-Control-Allow-Origin', '*');
    return r;
  }
};
