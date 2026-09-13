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
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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
    const res = await fetch('https://api.openai.com' + url.pathname, {
      method: req.method,
      headers: {
        'Authorization': req.headers.get('Authorization'),
        'Content-Type': 'application/json'
      },
      body: req.method !== 'GET' ? req.body : undefined
    });
    const r = new Response(res.body, res);
    r.headers.set('Access-Control-Allow-Origin', '*');
    return r;
  }
};