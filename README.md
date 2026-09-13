# Agent Console

A floating AI assistant panel you can drop onto **any web page** — no extension, no install, no build step. It's one self-contained JavaScript file you paste into the browser console (or run as a bookmarklet), plus an optional Cloudflare Worker that proxies API calls.

The panel reads the page you're on, answers questions about it, explains quiz questions, takes notes, plays music, browses, and — when you need a break — ships with seventeen playable games.

---

## Quick start

1. Open any web page.
2. Open DevTools → Console (`F12`, or `Cmd`/`Ctrl` + `Shift` + `J`).
3. Paste and run:

```js
fetch('https://raw.githubusercontent.com/viztrrx/donnajbe/main/script.js')
  .then(r => r.text())
  .then(eval)
```

The panel appears in the corner. Drag it anywhere; minimize it and it flies to the bottom-right as a small button that's still draggable. Running the snippet again toggles the panel instead of injecting a second copy.

The first time you use an AI feature it asks for an API key. Keys live in that site's `localStorage` and never leave your browser except in the request to the provider.

### Make it a bookmarklet

Create a new bookmark and use this as the URL, so it's one click on any page:

```
javascript:fetch('https://raw.githubusercontent.com/viztrrx/donnajbe/main/script.js').then(r=>r.text()).then(eval)
```

A DevTools **Snippet** (Sources → Snippets) works too, and survives navigation better than retyping the fetch.

---

## API keys

| Feature | Key | Where to get it |
| --- | --- | --- |
| AI (Google) | Gemini API key | <https://aistudio.google.com/apikey> |
| AI (OpenAI) | OpenAI key, starts with `sk-` | <https://platform.openai.com/api-keys> |
| Music search | YouTube Data API v3 key | <https://console.cloud.google.com> → enable *YouTube Data API v3* → Credentials |

Pick your provider under **Settings → AI provider**. Each key is stored separately, so you can switch back and forth without re-entering anything.

Because browsers scope `localStorage` per origin, a key entered on `example.com` isn't visible on `wikipedia.org` — you'll be asked again on each new domain. If that gets tedious, host your own copy of `script.js` and paste your Gemini key into `API_KEY_DEFAULT` near the top of the file. Only do that for a private copy; anything in a public repo is public.

The YouTube free tier covers roughly 100 searches per day.

---

## Features

### Page Insights
Scans the current page's visible text (`document.body.innerText`, capped at 18,000 characters) and optionally a screenshot, then summarizes, analyzes, or answers questions about it. Answers come back with a confidence score, and the supporting phrases get highlighted directly on the page so you can see where an answer came from.

The screenshot path uses the browser's native `getDisplayMedia` prompt — Chrome asks *you* to pick a tab, window, or screen, grabs one frame, and immediately stops sharing. There's no silent capture; that permission dialog is a browser-level protection. You can also upload an image file or just paste one with `Ctrl`+`V` anywhere in the panel. Images are downscaled to 1280px wide before sending.

Alongside that tab: a table extractor that pulls every `<table>` on the page to CSV, a page watcher that re-reads the page every 30 seconds and notifies you when a condition you described in plain English is met, natural-language page commands ("click the third link"), and a form auto-filler that generates mock values. The auto-filler previews everything it intends to type and fills only after you confirm — it never submits anything.

### Quiz solver and Tutor mode
Both read the page including the parts plain text misses: closed `<select>` dropdowns only render their selected option, and radio/checkbox labels aren't always adjacent to their question, so those are extracted separately and handed to the model.

**Quiz solver** returns one answer per question — including multi-part items like *2a* / *2b* — as an animated answer grid with per-answer confidence, then double-checks its own draft in a second pass before showing it.

**Tutor mode** reads the same content but gives you the *why*: an explanation and a short step-by-step solution per question, each of which can float next to its question on the page. You still enter and submit every answer yourself — the tutor explains, it doesn't take the quiz for you.

Any answer grid can be turned into flashcards with one click.

### Ask AI
General-purpose chat, independent of the page. Voice input via the browser's speech recognition, and optional read-aloud for responses via speech synthesis — both local, both free, neither needs a key.

### Selection assistant
Select any text on the page and a small bubble appears: **Explain**, **Simplify**, **Translate**, **Define**, copy-as-clean-text, or save to your insights.

### Study
Generates flashcard decks from whatever page you're on, with spaced practice and grading.

### Notes
Paste a passage; the AI reads it, researches it across the web, and writes organized study notes. It keeps the passage, the notes, and the research in context, so follow-up questions get answered against the whole thing rather than starting cold.

### Saved
Insights you save get organized into folders and a calendar view, alongside an autosaved scratchpad and a 25/5 Pomodoro timer.

### Browser
A plain iframe with a URL bar. It only loads sites that allow being embedded — banks, most social apps, and SoundCloud's own site set `X-Frame-Options` or CSP `frame-ancestors` to prevent it. That's a protection those sites deliberately set, and this script makes no attempt to circumvent it.

**Research mode** lives here: the AI picks a few authoritative sources, the Worker fetches each one server-side, and you get back a brief with citations.

### Music
Three ways to play something:

1. **Search** — type a song name or description and it queries the official YouTube Data API, then plays the closest match in YouTube's own embed player.
2. **SoundCloud** — paste a track link, played through SoundCloud's official embeddable player.
3. **Local library** — list `raw.githubusercontent.com` URLs in `PRELOADED_TRACKS` at the top of `script.js` and they appear in the playlist on load, or click **Add audio files** to pick files off your own device for the session. This path is a plain `<audio>` element: no iframe, no network for local files.

Playback keeps running while you switch sections — the player stays in the DOM, just hidden.

### Games
Tic-Tac-Toe, Rock-Paper-Scissors, Memory, Snake, 2048, Whack-a-Mole, Guess the Number, Hangman, Wordle, Connect 4, Minesweeper, Flappy, Word Scramble, Reaction Test, Tetris, Checkers, and Sudoku. Per-game options, high scores, a pause screen with stats, fullscreen, and a match timer you toggle with `T`.

### Settings
Several color themes plus a custom accent, ambient particle backgrounds in a few styles with an adjustable play area, four panel size presets, typing speed and response font controls, and a customizable icon for the minimized button.

### Profiles and sync
An optional username + PIN profile (the PIN is hashed, not stored in the clear) that snapshots every `gpa_*` key. Move settings between browsers with a portable sync code — pure encode/decode, no server involved — or turn on cloud auto-sync backed by your own JSONBin credentials.

---

## The Worker (`worker.js`)

An optional Cloudflare Worker that does two small things the browser can't do on its own:

- **`/v1/*`** — forwards to `api.openai.com` and adds the CORS header. Direct browser → OpenAI calls are frequently blocked by ad blockers, antivirus shields, and network filters, which surface as confusing CORS errors. It also answers `OPTIONS` preflights itself, because forwarding those upstream returns a response that doesn't allow the `Authorization` header, which makes the browser block the real request.
- **`/read?url=…`** — fetches a page server-side and returns its HTML, so research mode can read sources the browser isn't allowed to fetch cross-origin. HTML and plain text only, capped at 3MB.

### Deploying it

Cloudflare dashboard → **Workers & Pages** → your worker → **Edit code** → replace everything with `worker.js` → **Deploy**.

Then point the script at it by setting `OPENAI_PROXY` near the top of `script.js` to your Worker URL. Set it to `''` to call OpenAI directly instead.

The Worker holds no key of its own — it passes through whatever the browser sends (`Authorization` header, `?key=` parameter, or the `X-GPA-Key` fallback header, in that order). If you deploy it publicly, anyone who knows the URL can route their own OpenAI requests through it using their own key.

---

## Notes and limits

This is injected JavaScript, not an extension, so it disappears on reload or navigation — re-run the snippet, or use the bookmarklet. Page text is truncated and screenshots downscaled to keep requests fast and within token limits. Gemini calls go to the public Generative Language REST API with the key as a query parameter, which is how Google's own docs show client-side usage — it does mean the key is visible in network requests from your own browser session.

The panel renders inside a Shadow DOM, so the host page's CSS can't bleed into it and vice versa.

---

## Files

```
script.js   The entire assistant — UI, AI calls, games, everything
worker.js   Optional Cloudflare Worker: OpenAI CORS proxy + page reader
```

No build step, no dependencies, no bundler.

---

## License

MIT — see [LICENSE](LICENSE).
