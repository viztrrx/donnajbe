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
  async fetch(req) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GPA-Key',
      'Access-Control-Max-Age': '86400'
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(req.url);

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
