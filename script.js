/*!
 * Gemini Page Assistant — injectable console/bookmarklet AI overlay
 * -------------------------------------------------------------
 * WHAT THIS DOES
 *  - "Page Insights" tab: reads the visible TEXT of the current page
 *    (document.body.innerText) and/or captures an actual SCREENSHOT (via
 *    getDisplayMedia), and sends either or both to Gemini/OpenAI to
 *    summarize, analyze, or answer questions. Includes a "Solve quiz on
 *    this page" button that also reads dropdown (<select>) options and
 *    radio/checkbox choices the AI can't see from plain page text, then
 *    returns one answer per question — including multi-part ones like
 *    "2a"/"2b" — as a small animated answer grid.
 *  - A general "Ask AI" chat section, independent of page content.
 *  - A "Music" section with a few ways to play something:
 *      1) Type a song name/description ("mi historia entre tus dedos by
 *         eslabon armado") and it searches YouTube's official Data API
 *         for the closest match and plays it via YouTube's own embed
 *         player. Needs a free YouTube Data API v3 key (see below).
 *      2) Paste a SoundCloud link directly, played via SoundCloud's own
 *         official embeddable player.
 *      3) A local/preloaded music library: fill in PRELOADED_TRACKS below
 *         with raw.githubusercontent.com URLs to audio files in your repo
 *         (must be public) and they'll show up in the playlist on load —
 *         or just click "Add audio files" to pick files off your own
 *         device for the session. Playback is a plain <audio> element, no
 *         embed/iframe involved.
 *    Playback keeps running in the background while you switch tabs (the
 *    player element stays in the DOM, just visually hidden).
 *  - A "Browser" section: a plain iframe with a URL bar. It only loads
 *    sites that allow being embedded (most publisher sites, wikis,
 *    many docs sites). Sites that set X-Frame-Options / CSP
 *    frame-ancestors to block embedding — banks, most social apps,
 *    soundcloud.com's own site — won't load here. That's a security
 *    protection those sites intentionally set, and this script does not
 *    attempt to circumvent it.
 *  - A "Theme" section to change the panel's color scheme, plus optional
 *    ambient background particles (several styles, adjustable play area)
 *    and AI provider/typing-speed/response-font controls.
 *  - All sections are switched via a dropdown in place of tabs.
 *  - Draggable panel. Minimizing flies it to the bottom-right corner as
 *    a resting spot (still fully draggable from there); the minimized
 *    button's icon is customizable in Settings (original icon styles,
 *    not any company's actual logo — see note in Settings section).
 *
 * SETUP
 *  1. Get a free Gemini API key from https://aistudio.google.com/apikey
 *     — and/or an OpenAI API key from https://platform.openai.com/api-keys
 *     (starts with "sk-"). Pick which one to use via "AI provider" in the
 *     Theme tab; each key is asked for and stored separately, so you can
 *     switch back and forth without re-entering anything.
 *  2. For the Music search feature: get a free YouTube Data API v3 key
 *     at console.cloud.google.com — create/select a project, enable
 *     "YouTube Data API v3" under APIs & Services, then create an API
 *     key under Credentials. Free tier covers roughly 100 searches/day.
 *  3. Host this file somewhere you control (a GitHub Gist "raw" URL,
 *     a repo on GitHub Pages, etc).
 *  4. On any page, open DevTools console and run:
 *       fetch('https://YOUR-RAW-URL/gemini-page-assistant.js').then(r=>r.text()).then(eval)
 *  5. The first time you use each feature, it'll ask you to paste the
 *     relevant API key. Keys are stored in localStorage FOR THAT SITE'S
 *     ORIGIN ONLY (browser security — a script can't share localStorage
 *     across different domains). You'll be asked again on a new domain
 *     unless you paste your own Gemini key directly into API_KEY_DEFAULT
 *     below before hosting your own copy.
 *
 * SCREEN CAPTURE
 *  - "Capture Screen" uses the browser's native getDisplayMedia prompt —
 *    Chrome will ask YOU to pick a tab/window/screen to share, take one
 *    frame, then immediately stop sharing. It cannot capture silently;
 *    that permission dialog is a browser-level protection and can't be
 *    skipped by this or any page script.
 *  - Requires a secure context (https) and a real click on the button.
 *
 * NOTES / LIMITS
 *  - This is plain injected JS, not a Chrome extension — it disappears
 *    on page reload/navigation. Re-run the fetch command each time, or
 *    turn it into a browser bookmarklet / DevTools Snippet.
 *  - Page text is truncated (see MAX_PAGE_CHARS) and screenshots are
 *    downscaled (see MAX_IMAGE_WIDTH) to keep requests fast and within
 *    token limits.
 *  - Uses the public Generative Language REST API directly from the
 *    browser with your API key as a query param — that's how Google's
 *    docs show client-side usage, but it does mean the key is visible
 *    in network requests made from your own browser session.
 */
(function () {
  'use strict';

  // ---- Config -------------------------------------------------------
  const MODEL = 'gemini-3.6-flash';
  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const STORAGE_KEY = 'gpa_gemini_api_key';
  const OPENAI_STORAGE_KEY = 'gpa_openai_api_key';
  const OPENAI_MODEL = 'gpt-4o-mini';
  // Browser→OpenAI calls can be blocked by ad blockers, antivirus shields or
  // network filters (they look like CORS errors). Routing through this proxy
  // avoids that: it forwards to api.openai.com and adds the CORS header.
  // Set to '' to call OpenAI directly.
  const OPENAI_PROXY = 'https://donnajbe.viztrrx.workers.dev';
  const PROVIDER_KEY = 'gpa_ai_provider';
  // Tells the AI what it is and what the console can do, so questions like
  // "what can you do?" get a real answer. Injected into the chat-facing
  // system prompts (Ask AI + page Q&A), not into the JSON-only ones.
  const CAPABILITIES_BRIEF = [
    'ABOUT YOU: You are the AI inside "Agent Console", a floating assistant panel the user runs on any web page.',
    'Its features: PAGE INSIGHTS — reads the current page\'s text and/or a screenshot, summarizes, analyzes, answers questions about the page, solves quizzes and multiple-choice questions found on the page (answer grid with highlights on the page), auto-fills form fields with mock values, extracts tables to CSV, watches the page for changes the user cares about, and follows natural-language page commands like "click the third link".',
    'ASK AI — general chat like this conversation, with voice input and spoken answers.',
    'MUSIC — plays songs via YouTube search, SoundCloud links, or a local audio library.',
    'BROWSER — embeds other sites in a frame, plus research mode that reads sources automatically and writes a cited brief.',
    'STUDY — generates flashcard decks from the current page with spaced practice.',
    'NOTES — the user pastes a passage; the AI reads it, researches it across the web, writes organized study notes, and then remembers the passage, notes and research so follow-up questions about the text are answered with full context.',
    'SAVED — saved insights, an autosaved scratchpad, and a pomodoro timer.',
    'When the user asks what you can do, describe these features briefly and naturally and point them to the right tab. You do not automatically see the page text in this conversation — for page-specific questions, Page Insights is the tab to use.'
  ].join(' ');
  const SPEED_KEY = 'gpa_type_speed';
  const FONT_KEY = 'gpa_response_font';
  const ICON_KEY = 'gpa_mini_icon';
  const ICON_LOOK_KEY = 'gpa_mini_look';
  const ICON_COLOR_MODE_KEY = 'gpa_mini_color_mode';
  const PANEL_SIZE_KEY = 'gpa_panel_size';
  const PANEL_SIZES = {
    compact: { w: 300, h: 400 },
    normal: { w: 360, h: 480 },
    large: { w: 420, h: 560 },
    xl: { w: 480, h: 640 }
  };
  const PARTICLE_KEY = 'gpa_particle_style';
  const PARTICLE_SIZE_KEY = 'gpa_particle_margin';
  let PARTICLE_PANEL_W = PANEL_SIZES.normal.w;
  let PARTICLE_PANEL_H = PANEL_SIZES.normal.h;
  const YT_STORAGE_KEY = 'gpa_youtube_api_key';
  const THEME_KEY = 'gpa_theme';
  const CUSTOM_COLOR_KEY = 'gpa_custom_accent';
  const MAX_PAGE_CHARS = 18000;
  const MAX_IMAGE_WIDTH = 1280;
  const API_KEY_DEFAULT = ''; // paste your own key here if hosting a private copy

  // Preloaded music library — pulled straight from your GitHub repo. Add
  // audio files to your repo, then list them here as raw.githubusercontent.com
  // URLs (open the file on GitHub, click "Raw", copy that URL). These stream
  // directly via a normal <audio> element — no fetch/download step needed —
  // so this only works if the repo (or at least this folder) is PUBLIC.
  // Example:
  //   const PRELOADED_TRACKS = [
  //     { name: 'My Song.mp3', url: 'https://raw.githubusercontent.com/USER/REPO/main/music/my-song.mp3' },
  //     { name: 'Another Track.mp3', url: 'https://raw.githubusercontent.com/USER/REPO/main/music/another.mp3' },
  //   ];
  const PRELOADED_TRACKS = [
    { name: 'Me Gusta Todo De Ti', url: 'https://raw.githubusercontent.com/viztrrx/gemini-ui/refs/heads/music/me-gusta-todo-de-ti.mp3' }
  ];

  // Prevent duplicate instances — toggle instead of re-injecting
  const existing = document.getElementById('gpa-root-host');
  if (existing) {
    existing.dispatchEvent(new CustomEvent('gpa-toggle'));
    return;
  }

  // ---- Themes ---------------------------------------------------------
  const THEMES = {
    dark:      { bg: '#0b0b0f', panel: '#16161c', field: '#1e1e26', text: '#eaeaf0', sub: '#9a9aa8', accent: '#5b8cff', border: '#26262f' },
    matte:     { bg: '#131313', panel: '#1a1a1a', field: '#222222', text: '#e6e6e6', sub: '#9c9c9c', accent: '#b0b0b0', border: '#2b2b2b' },
    red:       { bg: '#180a0a', panel: '#241010', field: '#2e1414', text: '#f5e9e9', sub: '#cf9d9d', accent: '#e5453a', border: '#3a1818' },
    blue:      { bg: '#081420', panel: '#0f1e2e', field: '#132840', text: '#e7eef7', sub: '#9db4c9', accent: '#4da3ff', border: '#1b3149' },
    purple:    { bg: '#120c1e', panel: '#1c1430', field: '#251c3d', text: '#efe9fb', sub: '#b6a8d1', accent: '#8b5cf6', border: '#2f2350' },
    pink:      { bg: '#1e0c16', panel: '#301425', field: '#3d1b30', text: '#fbe9f2', sub: '#d1a8bf', accent: '#ec4899', border: '#4a2038' },
    lightblue: { bg: '#eaf6ff', panel: '#f5fbff', field: '#ffffff', text: '#0f2740', sub: '#5b7c93', accent: '#0ea5e9', border: '#cfe8f7' },
    white:  { bg: '#ffffff', panel: '#f5f5f7', field: '#ffffff', text: '#17171a', sub: '#6b6b70', accent: '#2563eb', border: '#e1e1e6' }
  };

  let theme = localStorage.getItem(THEME_KEY) || 'matte';
  const savedCustomAccent = localStorage.getItem(CUSTOM_COLOR_KEY) || '#8b5cf6';
  THEMES.custom = { ...THEMES.dark, accent: savedCustomAccent };
  if (!THEMES[theme]) theme = 'matte';

  // ---- Host + Shadow DOM (isolates styles from the host page) -------
  const host = document.createElement('div');
  host.id = 'gpa-root-host';
  host.style.cssText = 'all:initial; position:fixed; top:80px; left:80px; z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  // Best-effort load of a nicer monospace font for AI responses. If the
  // host page's CSP blocks external stylesheets, this silently no-ops and
  // the CSS font-family fallback stack (system monospace fonts) is used.
  if (!document.getElementById('gpa-font-link')) {
    try {
      const fontLink = document.createElement('link');
      fontLink.id = 'gpa-font-link';
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap';
      document.head.appendChild(fontLink);
    } catch (e) { /* ignore — falls back to system monospace fonts */ }
  }

  // Styles for on-page highlight spans MUST live in the host page's own
  // <head>, not our shadow root's stylesheet — shadow DOM styles don't
  // reach elements injected into the outer document.
  if (!document.getElementById('gpa-highlight-style')) {
    const hlStyle = document.createElement('style');
    hlStyle.id = 'gpa-highlight-style';
    hlStyle.textContent = `
      .gpa-page-highlight {
        background: var(--gpa-hl-bg, rgba(255, 235, 59, 0.5)) !important;
        border-radius: 3px; padding: 0 2px; box-shadow: 0 0 0 rgba(0,0,0,0);
        animation: gpa-hl-in 0.5s ease;
      }
      @keyframes gpa-hl-in {
        0% { box-shadow: 0 0 0 0 var(--gpa-hl-glow, rgba(255,235,59,0.9)); }
        60% { box-shadow: 0 0 10px 3px var(--gpa-hl-glow, rgba(255,235,59,0.9)); }
        100% { box-shadow: 0 0 0 0 transparent; }
      }
    `;
    document.head.appendChild(hlStyle);
  }

  const style = document.createElement('style');
  root.appendChild(style);

  // Wrapper lets an ambient particle canvas float around the panel's edges
  // without sitting on top of (or blocking clicks on) any actual content.
  const particleWrap = document.createElement('div');
  particleWrap.className = 'gpa-particle-wrap';
  root.appendChild(particleWrap);

  const particleCanvas = document.createElement('canvas');
  particleCanvas.id = 'gpa-particles';
  particleWrap.appendChild(particleCanvas);

  const panel = document.createElement('div');
  panel.className = 'gpa-panel';
  particleWrap.appendChild(panel);

  panel.innerHTML = `
    <span class="gpa-corner gpa-corner-tl"></span>
    <span class="gpa-corner gpa-corner-tr"></span>
    <span class="gpa-corner gpa-corner-bl"></span>
    <span class="gpa-corner gpa-corner-br"></span>
    <div class="gpa-scanline"></div>
    <div class="gpa-header" id="gpa-drag">
      <button id="gpa-min" title="Minimize">&minus;</button>
      <span class="gpa-title">Agent Console</span>
      <span class="gpa-dot"></span>
      <button id="gpa-close" title="Close">&times;</button>
    </div>
    <div class="gpa-login" id="gpa-login">
      <div class="gpa-login-card">
        <div class="gpa-login-brand">
          <button id="gpa-signup-btn" class="gpa-login-logo" title="Register new account">NW</button>
          <div class="gpa-login-brandtext">
            <div class="gpa-login-company">Northwind Workspace</div>
            <div class="gpa-login-dept">Employee Resource Portal</div>
          </div>
          <div class="gpa-login-winbtns">
            <button id="gpa-login-min" class="gpa-login-winbtn" title="Minimize">&minus;</button>
            <button id="gpa-login-close" class="gpa-login-winbtn" title="Close">&times;</button>
          </div>
        </div>
        <div class="gpa-login-divider"></div>
        <div class="gpa-login-heading">Sign in to your account</div>
        <label class="gpa-login-label" for="gpa-login-user">Username</label>
        <input id="gpa-login-user" class="gpa-login-input" placeholder="e.g. j.smith" autocomplete="off" />
        <label class="gpa-login-label" for="gpa-login-pin">Password / PIN</label>
        <input id="gpa-login-pin" class="gpa-login-input" type="password" placeholder="••••••" autocomplete="off" />
        <div id="gpa-login-msg" class="gpa-login-msg"></div>
        <button id="gpa-login-btn" class="gpa-login-primary">Sign In</button>
        <div class="gpa-login-actions">
          <button id="gpa-login-restore" class="gpa-login-link">Transfer access code</button>
        </div>
        <div class="gpa-login-footer">
          <div>Authorized personnel only. Access may be monitored and logged.</div>
          <div class="gpa-login-legal">
            Credentials are stored locally in this browser and are not encrypted.
            Do not reuse a password from any other system.
          </div>
          <div class="gpa-login-copyright">© Northwind Workspace · IT Service Desk ext. 4400</div>
        </div>
      </div>
    </div>
    <div class="gpa-body" id="gpa-body">
      <div class="gpa-dropdown" id="gpa-dropdown">
        <button class="gpa-dropdown-btn" id="gpa-dropdown-btn">
          <span id="gpa-dropdown-label">Page Insights</span>
          <svg class="gpa-chevron" viewBox="0 0 20 20" width="13" height="13"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="gpa-dropdown-menu" id="gpa-dropdown-menu">
          <button class="gpa-dropdown-item active" data-tab="scan">Page Insights</button>
          <button class="gpa-dropdown-item" data-tab="ask">Ask AI</button>
          <button class="gpa-dropdown-item" data-tab="music">Music</button>
          <button class="gpa-dropdown-item" data-tab="browser">Browser</button>
          <button class="gpa-dropdown-item" data-tab="games">Games</button>
          <button class="gpa-dropdown-item" data-tab="study">Study</button>
          <button class="gpa-dropdown-item" data-tab="notes">Notes</button>
          <button class="gpa-dropdown-item" data-tab="saved">Saved</button>
          <button class="gpa-dropdown-item" data-tab="theme">Settings</button>
        </div>
      </div>

      <div class="gpa-pane active" data-pane="scan">
        <div class="gpa-row">
          <button id="gpa-quiz-btn" class="gpa-btn quiz-btn">✨ Solve quiz on this page</button>
        </div>
        <div class="gpa-row">
          <button id="gpa-scan-btn" class="gpa-btn">Scan page text</button>
          <button id="gpa-capture-btn" class="gpa-btn">Capture screen</button>
        </div>
        <div class="gpa-row">
          <button id="gpa-tables-btn" class="gpa-btn">📋 Extract tables</button>
          <button id="gpa-watch-btn" class="gpa-btn">👀 Watch page</button>
        </div>
        <div class="gpa-row" id="gpa-watch-row" style="display:none;">
          <input id="gpa-watch-cond" class="gpa-input" placeholder='Tell me when… (e.g. "price drops below $50")' />
          <button id="gpa-watch-start" class="gpa-btn primary">Arm</button>
        </div>
        <div class="gpa-row">
          <input id="gpa-cmd-input" class="gpa-input" placeholder='⚡ Tell the page what to do… ("click the third assignment")' />
          <button id="gpa-cmd-btn" class="gpa-btn primary">Do it</button>
        </div>
        <div class="gpa-row">
          <button id="gpa-upload-btn" class="gpa-btn">Upload image</button>
          <span class="gpa-sub">or paste (Ctrl+V) a screenshot anywhere in this panel</span>
          <input type="file" id="gpa-image-upload" accept="image/*" style="display:none" />
        </div>
        <div class="gpa-row" id="gpa-status-row" style="display:none;">
          <img id="gpa-thumb" alt="captured screen" />
          <span id="gpa-scan-status" class="gpa-sub"></span>
          <button id="gpa-clear-context" class="gpa-btn" title="Clear captured page text and screenshot">Clear</button>
        </div>
        <div class="gpa-row gpa-actions" id="gpa-scan-actions" style="display:none;">
          <button class="gpa-btn primary" data-action="summarize">Summarize</button>
          <button class="gpa-btn primary" data-action="analyze">Analyze</button>
          <button class="gpa-btn" data-action="autofill">Auto-Fill Form</button>
        </div>
        <div class="gpa-row" id="gpa-question-row" style="display:none;">
          <input id="gpa-question" class="gpa-input" placeholder="Ask a question about this page…" />
          <button id="gpa-question-btn" class="gpa-btn primary">Answer</button>
        </div>
        <div id="gpa-scan-output" class="gpa-output"></div>
        <div class="gpa-row" style="margin-top:6px;">
          <button id="gpa-clear-highlights" class="gpa-btn" style="display:none;">✕ Clear page highlights</button>
        </div>
      </div>

      <div class="gpa-pane" data-pane="ask">
        <div id="gpa-chat" class="gpa-chat"></div>
        <div class="gpa-row">
          <input id="gpa-ask-input" class="gpa-input" placeholder="Ask me anything…" />
          <button id="gpa-ask-btn" class="gpa-btn primary">Send</button>
          <button id="gpa-voice-btn" class="gpa-btn" title="Speak your question">🎙</button>
        </div>
      </div>

      <div class="gpa-pane" data-pane="music">
        <div class="gpa-row">
          <input id="gpa-music-query" class="gpa-input" placeholder="Type a song name or description…" />
          <button id="gpa-music-search" class="gpa-btn primary">Play</button>
        </div>
        <div id="gpa-music-status" class="gpa-sub" style="margin-bottom:6px;"></div>
        <div id="gpa-music-wrap" class="gpa-sc-wrap"></div>

        <div class="gpa-sub" style="margin:12px 0 6px;">Or paste a SoundCloud link directly:</div>
        <div class="gpa-row">
          <input id="gpa-sc-url" class="gpa-input" placeholder="soundcloud.com/…" />
          <button id="gpa-sc-load" class="gpa-btn">Load</button>
        </div>
        <div id="gpa-sc-wrap" class="gpa-sc-wrap"></div>

        <div class="gpa-sub" style="margin:14px 0 6px;">📁 Music library — preloaded from GitHub, plus any files you add here</div>
        <div class="gpa-row">
          <button id="gpa-local-add-btn" class="gpa-btn">Add audio files</button>
          <input type="file" id="gpa-local-file-input" accept="audio/*" multiple style="display:none" />
        </div>
        <div id="gpa-local-playlist" class="gpa-local-playlist"></div>
        <div id="gpa-local-player" class="gpa-local-player" style="display:none;">
          <div id="gpa-local-nowplaying" class="gpa-sub"></div>
          <div class="gpa-row">
            <input type="range" id="gpa-local-seek" class="gpa-range" min="0" max="100" value="0" />
          </div>
          <div class="gpa-row" style="justify-content:space-between;">
            <span id="gpa-local-time" class="gpa-sub">0:00 / 0:00</span>
          </div>
          <div class="gpa-row" style="justify-content:center; gap:10px;">
            <button id="gpa-local-prev" class="gpa-btn">⏮</button>
            <button id="gpa-local-playpause" class="gpa-btn primary">▶</button>
            <button id="gpa-local-next" class="gpa-btn">⏭</button>
          </div>
          <div class="gpa-row">
            <span class="gpa-sub">🔊</span>
            <input type="range" id="gpa-local-volume" class="gpa-range" min="0" max="100" value="80" />
          </div>
        </div>
      </div>

      <div class="gpa-pane" data-pane="browser">
        <div class="gpa-row">
          <input id="gpa-browser-url" class="gpa-input" placeholder="Enter a URL…" />
          <button id="gpa-browser-go" class="gpa-btn primary">Go</button>
        </div>
        <div class="gpa-sub" style="margin-bottom:8px;">Sites that block embedding (banks, most social apps, soundcloud.com itself) won't load here — that's a security setting on their end which this doesn't try to bypass. Use the Music tab for actual SoundCloud playback.</div>
        <iframe id="gpa-browser-frame" class="gpa-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
        <div class="gpa-sub" style="margin:12px 0 6px;">🔎 Research mode — AI reads web sources and writes you a brief</div>
        <div class="gpa-row">
          <input id="gpa-research-input" class="gpa-input" placeholder="Topic or question to research…" />
          <button id="gpa-research-btn" class="gpa-btn primary">Research</button>
        </div>
        <div id="gpa-research-out" class="gpa-output" style="max-height:200px;"></div>
      </div>

      <div class="gpa-pane" data-pane="games">
        <div class="gpa-row" style="flex-wrap: wrap;">
          <button class="gpa-btn game-btn primary" data-game="ttt">Tic-Tac-Toe</button>
          <button class="gpa-btn game-btn" data-game="rps">RPS</button>
          <button class="gpa-btn game-btn" data-game="memory">Memory</button>
          <button class="gpa-btn game-btn" data-game="snake">Snake</button>
          <button class="gpa-btn game-btn" data-game="2048">2048</button>
          <button class="gpa-btn game-btn" data-game="whack">Whack-a-Mole</button>
          <button class="gpa-btn game-btn" data-game="guess">Guess Number</button>
          <button class="gpa-btn game-btn" data-game="hangman">Hangman</button>
          <button class="gpa-btn game-btn" data-game="wordle">Wordle</button>
          <button class="gpa-btn game-btn" data-game="connect4">Connect 4</button>
          <button class="gpa-btn game-btn" data-game="minesweeper">Minesweeper</button>
          <button class="gpa-btn game-btn" data-game="simon">Simon</button>
          <button class="gpa-btn game-btn" data-game="breakout">Breakout</button>
          <button class="gpa-btn game-btn" data-game="flappy">Flappy</button>
          <button class="gpa-btn game-btn" data-game="scramble">Word Scramble</button>
          <button class="gpa-btn game-btn" data-game="reaction">Reaction Test</button>
          <button class="gpa-btn game-btn" data-game="tetris">Tetris</button>
          <button class="gpa-btn game-btn" data-game="checkers">Checkers</button>
          <button class="gpa-btn game-btn" data-game="sudoku">Sudoku</button>
        </div>
        <div class="gpa-row" style="margin-top:6px;">
          <button id="gpa-game-restart" class="gpa-btn">🔄 Restart</button>
          <button id="gpa-game-pause" class="gpa-btn">⏸ Pause</button>
          <button id="gpa-game-fullscreen" class="gpa-btn">⛶ Fullscreen</button>
        </div>
        <div class="gpa-sub" style="text-align:center; margin-bottom:4px;">Keys — P: pause · R: restart · T: timer</div>
        <div id="gpa-game-stage" class="gpa-game-stage">
          <div id="gpa-game-timer" class="gpa-game-timer" style="display:none;">0:00</div>
          <div id="gpa-game-viewport" class="gpa-game-viewport"><div id="gpa-game-fit" class="gpa-game-fit"></div></div>
          <div id="gpa-game-pausemenu" class="gpa-pause-menu" style="display:none;">
            <div class="gpa-pause-card">
              <div class="gpa-pause-title">⏸ Paused</div>
              <div id="gpa-pause-stats" class="gpa-pause-stats"></div>
              <div id="gpa-pause-options" class="gpa-pause-options"></div>
              <div class="gpa-row" style="justify-content:center; margin-top:10px;">
                <button id="gpa-pause-resume" class="gpa-btn primary">▶ Resume</button>
                <button id="gpa-pause-restart" class="gpa-btn">🔄 Restart</button>
              </div>
              <div class="gpa-sub" style="text-align:center; margin-top:8px;">P resume · R restart · T timer</div>
            </div>
          </div>
        </div>
      </div>

      <div class="gpa-pane" data-pane="saved">
        <div class="gpa-sub" style="margin-bottom:8px;">Your Saved Insights</div>
        <div id="gpa-saved-list" class="gpa-chat"></div>
        <div class="gpa-sub" style="margin:12px 0 6px;">📝 Scratchpad — autosaved to your profile</div>
        <textarea id="gpa-scratch" class="gpa-sync-box" style="height:90px;" placeholder="Jot anything… it saves as you type."></textarea>
        <div class="gpa-row" style="margin-top:6px;">
          <button id="gpa-scratch-tidy" class="gpa-btn">✨ Tidy notes with AI</button>
        </div>
        <div class="gpa-sub" style="margin:12px 0 6px;">🍅 Pomodoro — 25 min focus / 5 min break</div>
        <div class="gpa-row" style="justify-content:center;">
          <span id="gpa-pomo-time" class="gpa-pomo-time">25:00</span>
        </div>
        <div class="gpa-row" style="justify-content:center;">
          <button id="gpa-pomo-start" class="gpa-btn primary">▶ Start</button>
          <button id="gpa-pomo-reset" class="gpa-btn">Reset</button>
          <span id="gpa-pomo-count" class="gpa-sub"></span>
        </div>
      </div>

      <div class="gpa-pane" data-pane="study">
        <div class="gpa-row">
          <button id="gpa-fc-gen" class="gpa-btn primary">✨ Make flashcards from this page</button>
        </div>
        <div id="gpa-fc-status" class="gpa-sub" style="margin-bottom:6px;">Open a page with material on it, then generate a deck. Cards you "knew" three times are retired until you reset.</div>
        <div id="gpa-fc-study"></div>
      </div>

      <div class="gpa-pane" data-pane="notes">
        <div class="gpa-row">
          <textarea id="gpa-notes-input" class="gpa-sync-box" style="height:100px;" placeholder="Paste a passage here — article, chapter, story, lecture… Then press Enter (Shift+Enter makes a new line)."></textarea>
        </div>
        <div class="gpa-row">
          <button id="gpa-notes-go" class="gpa-btn primary">📝 Read, research &amp; make notes</button>
          <button id="gpa-notes-new" class="gpa-btn" style="display:none;">🗑 Clear &amp; start new</button>
        </div>
        <div id="gpa-notes-status" class="gpa-sub" style="margin-bottom:6px;">The AI reads the passage, researches it across the web, and writes organized notes — then remembers it all so you can ask follow-ups below.</div>
        <div id="gpa-notes-out" class="gpa-output"></div>
        <div class="gpa-sub" style="margin:10px 0 4px;">💬 Ask about this passage — it remembers the text, the notes and the research</div>
        <div class="gpa-row" id="gpa-notes-q-row" style="display:none;">
          <input id="gpa-notes-q" class="gpa-input" placeholder="Ask anything about the passage…" />
          <button id="gpa-notes-q-btn" class="gpa-btn primary">Ask</button>
        </div>
        <div id="gpa-notes-chat" class="gpa-chat" style="max-height:220px;"></div>
      </div>

      <div class="gpa-pane" data-pane="theme">
        <div class="gpa-sub" style="margin-bottom:8px;">Choose a color theme</div>
        <div class="gpa-swatches">
          <button class="gpa-swatch" data-theme="dark" style="background:#0b0b0f;border-color:#5b8cff;">Dark</button>
          <button class="gpa-swatch" data-theme="matte" style="background:#1a1a1a;border-color:#b0b0b0;">Matte Black</button>
          <button class="gpa-swatch" data-theme="red" style="background:#241010;border-color:#e5453a;">Red</button>
          <button class="gpa-swatch" data-theme="blue" style="background:#0f1e2e;border-color:#4da3ff;">Blue</button>
          <button class="gpa-swatch" data-theme="white" style="background:#f5f5f7;border-color:#2563eb;color:#111;">White</button>
          <button class="gpa-swatch" data-theme="purple" style="background:#1c1430;border-color:#8b5cf6;">Purple</button>
          <button class="gpa-swatch" data-theme="pink" style="background:#301425;border-color:#ec4899;">Pink</button>
          <button class="gpa-swatch" data-theme="lightblue" style="background:#eaf6ff;border-color:#0ea5e9;color:#111;">Light Blue</button>
        </div>
        <div class="gpa-row" style="margin-top:12px;">
          <label for="gpa-custom-color" class="gpa-sub" style="flex:1;">Custom color (pick any shade)</label>
          <input type="color" id="gpa-custom-color" class="gpa-color-input" value="#8b5cf6" />
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Account &amp; sync</div>
        <div class="gpa-row">
          <span id="gpa-account-who" class="gpa-sub">Not signed in</span>
          <button id="gpa-logout-btn" class="gpa-btn">Sign out</button>
        </div>
        <div class="gpa-row" style="margin-top:6px;">
          <button id="gpa-sync-export" class="gpa-btn" style="flex:1;">Copy sync code</button>
          <button id="gpa-sync-import" class="gpa-btn" style="flex:1;">Load sync code</button>
        </div>
        <textarea id="gpa-sync-box" class="gpa-sync-box" placeholder="Your sync code appears here. Paste one from another device and press Load sync code."></textarea>
        <div class="gpa-sub" style="margin-top:6px;">Optional cloud auto-sync (JSONBin)</div>
        <div class="gpa-row">
          <input id="gpa-cloud-bin" class="gpa-input" placeholder="Bin ID" autocomplete="off" />
        </div>
        <div class="gpa-row">
          <input id="gpa-cloud-key" class="gpa-input" type="password" placeholder="X-Master-Key" autocomplete="off" />
        </div>
        <div class="gpa-row">
          <button id="gpa-cloud-push" class="gpa-btn" style="flex:1;">Upload</button>
          <button id="gpa-cloud-pull" class="gpa-btn" style="flex:1;">Download</button>
        </div>
        <div id="gpa-cloud-msg" class="gpa-sub" style="margin-top:4px;"></div>
        <div class="gpa-sub" style="margin:14px 0 6px;">AI provider</div>
        <div class="gpa-row">
          <button class="gpa-btn provider-btn primary" data-provider="gemini">Gemini</button>
          <button class="gpa-btn provider-btn" data-provider="openai">OpenAI</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Voice</div>
        <div class="gpa-row">
          <button id="gpa-tts-toggle" class="gpa-btn">🔇 Read answers aloud: OFF</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Typing animation speed</div>
        <div class="gpa-row">
          <button class="gpa-btn speed-btn" data-speed="slow">Slow</button>
          <button class="gpa-btn speed-btn primary" data-speed="normal">Normal</button>
          <button class="gpa-btn speed-btn" data-speed="fast">Fast</button>
          <button class="gpa-btn speed-btn" data-speed="instant">Instant</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Response font</div>
        <div class="gpa-row">
          <button class="gpa-btn font-btn primary" data-font="mono">Typewriter</button>
          <button class="gpa-btn font-btn" data-font="system">Standard</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Minimized button icon</div>
        <div class="gpa-row" style="flex-wrap: wrap;">
          <button class="gpa-btn icon-btn primary" data-icon="dot">Dot</button>
          <button class="gpa-btn icon-btn" data-icon="sparkle">Sparkle</button>
          <button class="gpa-btn icon-btn" data-icon="bolt">Bolt</button>
          <button class="gpa-btn icon-btn" data-icon="orbit">Orbit</button>
          <button class="gpa-btn icon-btn" data-icon="chat">Chat</button>
          <button class="gpa-btn icon-btn" data-icon="letter">Letter (G/O)</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Minimized button look</div>
        <div class="gpa-row">
          <button class="gpa-btn look-btn primary" data-look="futuristic">Futuristic</button>
          <button class="gpa-btn look-btn" data-look="minimal">Minimal</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Minimized button color</div>
        <div class="gpa-row">
          <button class="gpa-btn colormode-btn primary" data-colormode="theme">Theme accent</button>
          <button class="gpa-btn colormode-btn" data-colormode="page">Match this page</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Interface size</div>
        <div class="gpa-row">
          <button class="gpa-btn size-btn" data-size="compact">Compact</button>
          <button class="gpa-btn size-btn primary" data-size="normal">Normal</button>
          <button class="gpa-btn size-btn" data-size="large">Large</button>
          <button class="gpa-btn size-btn" data-size="xl">XL</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Background particles</div>
        <div class="gpa-row" style="flex-wrap: wrap;">
          <button class="gpa-btn particle-btn primary" data-particle="off">Off</button>
          <button class="gpa-btn particle-btn" data-particle="sparkles">Sparkles</button>
          <button class="gpa-btn particle-btn" data-particle="snow">Snow</button>
          <button class="gpa-btn particle-btn" data-particle="bubbles">Bubbles</button>
          <button class="gpa-btn particle-btn" data-particle="stars">Stars</button>
          <button class="gpa-btn particle-btn" data-particle="network">Network</button>
          <button class="gpa-btn particle-btn" data-particle="fireflies">Fireflies</button>
          <button class="gpa-btn particle-btn" data-particle="confetti">Confetti</button>
        </div>
        <div class="gpa-row" style="margin-top:8px;">
          <label for="gpa-particle-size" class="gpa-sub" style="flex:1;">Particle play area size</label>
        </div>
        <div class="gpa-row">
          <input type="range" id="gpa-particle-size" class="gpa-range" min="0" max="260" step="10" />
        </div>
        <div class="gpa-row" style="margin-top:8px; flex-wrap: wrap;">
          <button id="gpa-clear-key" class="gpa-btn">Clear saved Gemini key</button>
          <button id="gpa-clear-openai-key" class="gpa-btn">Clear saved OpenAI key</button>
          <button id="gpa-clear-yt-key" class="gpa-btn">Clear saved YouTube key</button>
        </div>
      </div>
    </div>
  `;

  const minimized = document.createElement('div');
  minimized.className = 'gpa-mini';
  minimized.style.display = 'none';
  panel.appendChild(minimized);

  // Original, non-trademarked icon options for the minimized button — not
  // reproductions of any company's actual logo. "Letter" shows G or O
  // depending on whichever AI provider is currently active.
  const MINI_ICONS = {
    dot: '✦',
    sparkle: '<svg viewBox="0 0 24 24"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
    orbit: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.4"/><ellipse cx="12" cy="12" rx="9" ry="4" fill="none" stroke="#fff" stroke-width="1.6"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 4h16v11H8l-4 4z"/></svg>'
  };

  function renderMiniIcon() {
    const style = localStorage.getItem(ICON_KEY) || 'dot';
    if (style === 'letter') {
      const provider = localStorage.getItem(PROVIDER_KEY) || 'gemini';
      minimized.textContent = provider === 'openai' ? 'O' : 'G';
    } else {
      minimized.innerHTML = MINI_ICONS[style] || MINI_ICONS.dot;
    }
  }
  renderMiniIcon();

  // "Futuristic" (default) keeps the spinning rings/pulse; "Minimal" is a
  // calmer, low-key badge for anyone who'd rather it not stand out visually.
  function applyMiniLook() {
    const look = localStorage.getItem(ICON_LOOK_KEY) || 'futuristic';
    minimized.classList.toggle('gpa-mini-minimal', look === 'minimal');
  }
  applyMiniLook();

  // Samples the actual page's own colors so the minimized badge can blend
  // with whatever site it's sitting on, instead of always using the panel's
  // theme accent color.
  function getPageAccentColor() {
    const linkEl = document.querySelector('a');
    const linkColor = linkEl && parseRgbString(getComputedStyle(linkEl).color);
    if (linkColor && (linkColor.r + linkColor.g + linkColor.b) > 0) return linkColor;
    const bodyBg = parseRgbString(getComputedStyle(document.body).backgroundColor);
    const bg = (bodyBg && bodyBg.a > 0.05) ? bodyBg : { r: 255, g: 255, b: 255, a: 1 };
    const lum = relativeLuminance(bg);
    return lum < 0.5 ? { r: 225, g: 228, b: 235 } : { r: 55, g: 60, b: 72 };
  }

  function applyMiniColorMode() {
    const mode = localStorage.getItem(ICON_COLOR_MODE_KEY) || 'theme';
    if (mode === 'page') {
      const c = getPageAccentColor();
      const core = `rgb(${c.r}, ${c.g}, ${c.b})`;
      minimized.style.background = `radial-gradient(circle at 35% 30%, ${core}, ${THEMES[theme].bg} 78%)`;
      minimized.style.boxShadow = `0 0 10px 1px rgba(${c.r}, ${c.g}, ${c.b}, 0.45), 0 6px 16px rgba(0,0,0,0.35)`;
    } else {
      minimized.style.background = '';
      minimized.style.boxShadow = '';
    }
  }
  applyMiniColorMode();

  function applyTheme(name) {
    theme = THEMES[name] ? name : 'matte';
    localStorage.setItem(THEME_KEY, theme);
    const t = THEMES[theme];
    style.textContent = `
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .gpa-particle-wrap { position: relative; }
      #gpa-particles {
        position: absolute; z-index: 0; pointer-events: none; display: none;
      }
      .gpa-panel { position: relative; z-index: 1; }
      .gpa-panel {
        width: 360px;
        height: 480px;
        display: flex;
        flex-direction: column;
        background: linear-gradient(160deg, ${t.panel}ee 0%, ${t.bg}f2 100%);
        color: ${t.text};
        border: 1px solid ${t.accent}70;
        clip-path: polygon(22px 0, 100% 0, 100% calc(100% - 22px), calc(100% - 22px) 100%, 0 100%, 0 22px);
        backdrop-filter: blur(16px) saturate(150%);
        -webkit-backdrop-filter: blur(16px) saturate(150%);
        box-shadow: 0 20px 50px rgba(0,0,0,0.55), 0 0 0 1px ${t.accent}25, 0 0 34px ${t.accent}40, inset 0 0 40px ${t.accent}0d;
        overflow: hidden;
        user-select: none;
        animation: gpa-panel-in 0.32s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes gpa-panel-in {
        from { opacity: 0; transform: scale(0.92) translateY(8px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .gpa-corner {
        position: absolute; width: 20px; height: 20px; pointer-events: none; z-index: 3;
      }
      .gpa-corner-tl { top: -1px; left: -1px; border-top: 2px solid ${t.accent}; border-left: 2px solid ${t.accent}; }
      .gpa-corner-tr { top: -1px; right: -1px; border-top: 2px solid ${t.accent}; border-right: 2px solid ${t.accent}; }
      .gpa-corner-bl { bottom: -1px; left: -1px; border-bottom: 2px solid ${t.accent}; border-left: 2px solid ${t.accent}; }
      .gpa-corner-br { bottom: -1px; right: -1px; border-bottom: 2px solid ${t.accent}; border-right: 2px solid ${t.accent}; }
      .gpa-scanline {
        position: absolute; left: 0; right: 0; top: 0; height: 2px; z-index: 2;
        background: linear-gradient(90deg, transparent, ${t.accent}, transparent);
        opacity: 0.55; pointer-events: none;
        animation: gpa-scan-sweep 4.5s linear infinite;
      }
      @keyframes gpa-scan-sweep {
        0% { top: 0; opacity: 0; }
        10% { opacity: 0.55; }
        90% { opacity: 0.55; }
        100% { top: 100%; opacity: 0; }
      }
      .gpa-header {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px;
        background: linear-gradient(90deg, ${t.accent}18, transparent 60%);
        cursor: grab;
        border-bottom: 1px solid ${t.accent}44;
        flex-shrink: 0;
      }
      .gpa-header:active { cursor: grabbing; }
      #gpa-min {
        width: 22px; height: 22px; border-radius: 50%;
        border: 1px solid ${t.accent}70;
        background: transparent;
        color: ${t.accent};
        font-size: 14px; line-height: 1; cursor: pointer;
        display:flex; align-items:center; justify-content:center;
        flex-shrink: 0;
        transition: box-shadow 0.15s ease, background 0.15s ease;
      }
      #gpa-min:hover { background: ${t.accent}22; box-shadow: 0 0 10px ${t.accent}66; }
      .gpa-title {
        font-size: 10.5px; font-weight: 700; letter-spacing: 1.4px; flex: 1;
        text-transform: uppercase;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        color: ${t.text};
      }
      .gpa-dot {
        width: 7px; height: 7px; border-radius: 50%; background: ${t.accent}; flex-shrink:0;
        box-shadow: 0 0 0 0 ${t.accent}80;
        animation: gpa-dot-pulse 2.4s ease-in-out infinite;
      }
      @keyframes gpa-dot-pulse {
        0%, 100% { box-shadow: 0 0 0 0 ${t.accent}66; }
        50% { box-shadow: 0 0 0 4px ${t.accent}00; }
      }
      #gpa-close {
        width: 22px; height: 22px; border-radius: 50%;
        border: 1px solid ${t.accent}70;
        background: transparent;
        color: ${t.accent};
        font-size: 14px; line-height: 1; cursor: pointer;
        display:flex; align-items:center; justify-content:center;
        flex-shrink: 0;
        transition: box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      #gpa-close:hover { background: #e5453a; border-color: #e5453a; color: #fff; box-shadow: 0 0 10px #e5453a99; }
      .gpa-body { padding: 10px; user-select: text; flex: 1; overflow-y: auto; display: flex; flex-direction: column; min-height: 0; }
      .gpa-dropdown { position: relative; margin-bottom: 10px; flex-shrink: 0; }
      .gpa-dropdown-btn {
        width: 100%; display: flex; align-items: center; justify-content: space-between;
        padding: 9px 12px; font-size: 11px; font-weight: 700; letter-spacing: 1px;
        text-transform: uppercase;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
        cursor: pointer; color: ${t.text};
        border: 1px solid ${t.accent}55;
        background: linear-gradient(180deg, ${t.field}, ${t.panel});
        box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .gpa-dropdown-btn { display: none; }
      .gpa-chevron { display: none; }
      .gpa-dropdown-menu {
        position: static; display: flex; gap: 4px; flex-wrap: wrap;
        background: transparent; border: none; box-shadow: none;
        opacity: 1; transform: none; pointer-events: auto; overflow: visible;
      }
      .gpa-dropdown-item {
        flex: 1; min-width: 58px; text-align: center; padding: 7px 3px;
        font-size: 9px; font-weight: 700; color: ${t.sub}; line-height: 1.3;
        letter-spacing: 0.4px; text-transform: uppercase;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        background: ${t.field}; border: 1px solid ${t.accent}35;
        clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
      }
      .gpa-dropdown-item:hover { background: ${t.panel}; color: ${t.text}; border-color: ${t.accent}99; }
      .gpa-dropdown-item.active {
        color: #fff; background: ${t.accent}; border-color: ${t.accent};
        box-shadow: 0 0 12px ${t.accent}77;
      }
      .gpa-dropdown-item.active::before { content: none; }
      .gpa-pane { display: none; }
      .gpa-pane.active {
        display: flex; flex-direction: column; flex: 1; min-height: 0;
        animation: gpa-pane-in 0.22s ease both;
      }
      @keyframes gpa-pane-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .gpa-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-shrink: 0; }
      .gpa-actions { flex-wrap: wrap; }
      .gpa-input {
        flex: 1; padding: 7px 9px; border-radius: 5px;
        border: 1px solid ${t.border}; background: ${t.field}; color: ${t.text};
        font-size: 12.5px; outline: none;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-input:focus { border-color: ${t.accent}; box-shadow: 0 0 0 2px ${t.accent}33; }
      .gpa-btn {
        padding: 7px 10px; border: 1px solid ${t.border};
        background: ${t.field}; color: ${t.text}; font-size: 10.5px; font-weight: 700;
        letter-spacing: 0.6px; text-transform: uppercase;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
        cursor: pointer; white-space: nowrap;
        transition: border-color 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
      }
      .gpa-btn:hover { border-color: ${t.accent}; transform: translateY(-1px); box-shadow: 0 0 12px ${t.accent}44; }
      .gpa-btn:active { transform: translateY(0) scale(0.96); }
      .gpa-btn.primary { background: ${t.accent}; color: #fff; border-color: ${t.accent}; }
      .gpa-btn.primary:hover { box-shadow: 0 0 0 3px ${t.accent}33; }
      .quiz-btn {
        width: 100%; padding: 11px; font-size: 11.5px; font-weight: 800;
        letter-spacing: 0.8px; text-transform: uppercase; border: none; cursor: pointer;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
        color: #fff; background: linear-gradient(120deg, ${t.accent}, ${t.accent}99, ${t.accent});
        background-size: 220% 220%;
        box-shadow: 0 4px 16px ${t.accent}55;
        animation: gpa-shimmer 3.2s ease infinite;
      }
      @keyframes gpa-shimmer {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
      .quiz-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px ${t.accent}77; }
      .quiz-btn:active { transform: translateY(0) scale(0.97); }
      .quiz-btn:disabled { opacity: 0.65; cursor: default; transform: none; }
      .gpa-sub {
        color: ${t.sub}; font-size: 10px; flex: 1; letter-spacing: 0.5px;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-output {
        /* flex-shrink: 0 — inside the scrolling pane this box must size to
           its content (up to max-height), or rows of buttons below/above
           squeeze it down to a single visible line. */
        margin-top: 6px; flex: 0 0 auto; max-height: 260px; overflow-y: auto;
        font-size: 12.5px; line-height: 1.6; white-space: pre-wrap;
        overflow-wrap: break-word; word-break: break-word;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        padding: 8px; background: ${t.field}; border-radius: 6px;
        border: 1px solid ${t.accent}40;
        box-shadow: 0 0 0 1px ${t.accent}15 inset;
      }
      .gpa-output:empty { display: none; }
      .gpa-error {
        display: flex; align-items: flex-start; gap: 8px;
        background: rgba(229, 69, 58, 0.1); border: 1px solid rgba(229, 69, 58, 0.35);
        border-radius: 8px; padding: 9px 10px; color: ${t.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .gpa-error-icon { flex-shrink: 0; font-size: 14px; line-height: 1.4; }
      .gpa-cursor {
        display: inline-block; width: 2px; height: 1em;
        background: ${t.accent}; margin-left: 1px; vertical-align: text-bottom;
        animation: gpa-blink 0.85s steps(1) infinite;
      }
      @keyframes gpa-blink { 50% { opacity: 0; } }
      .gpa-answer-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
        gap: 8px;
      }
      .gpa-grid-cell {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 3px; padding: 9px 4px; border-radius: 9px;
        background: ${t.panel}; border: 1px solid ${t.border};
        animation: gpa-cell-in 0.3s ease both;
      }
      .gpa-grid-q { font-size: 10px; font-weight: 700; letter-spacing: 0.3px; color: ${t.sub}; }
      .gpa-grid-a {
        font-size: 16px; font-weight: 800; color: ${t.accent};
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      @keyframes gpa-cell-in {
        from { opacity: 0; transform: scale(0.82) translateY(5px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .gpa-grid-conf {
        font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 8px; margin-top: 1px;
      }
      .gpa-confidence-line { margin-top: 8px; }
      .gpa-conf-high { background: rgba(34, 197, 94, 0.18); color: #22c55e; }
      .gpa-conf-mid { background: rgba(234, 179, 8, 0.18); color: #eab308; }
      .gpa-conf-low { background: rgba(239, 68, 68, 0.18); color: #ef4444; }
      .gpa-chat {
        flex: 1; min-height: 80px; overflow-y: auto; margin-bottom: 8px;
        display: flex; flex-direction: column; gap: 6px;
      }
      .gpa-msg { padding: 7px 9px; border-radius: 8px; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word; }
      .gpa-msg.user { background: ${t.accent}; color: #fff; align-self: flex-end; max-width: 85%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .gpa-msg.ai { background: ${t.field}; border: 1px solid ${t.border}; align-self: flex-start; max-width: 90%; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace; }
      .gpa-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
      .gpa-swatch {
        width: 56px; height: 34px; border-radius: 8px; border: 2px solid transparent;
        cursor: pointer; font-size: 9px; color: #fff; font-weight: 700;
      }
      .gpa-color-input {
        width: 34px; height: 28px; padding: 0; border: 1px solid ${t.border};
        border-radius: 6px; background: ${t.field}; cursor: pointer;
      }
      .provider-btn { flex: 1; }
      .provider-btn.primary { background: ${t.accent}; color: #fff; border-color: ${t.accent}; }
      .speed-btn, .font-btn, .particle-btn, .icon-btn, .size-btn, .look-btn, .colormode-btn { flex: 1; padding: 6px 4px; font-size: 11px; }
      .speed-btn.primary, .font-btn.primary, .particle-btn.primary, .icon-btn.primary, .size-btn.primary, .look-btn.primary, .colormode-btn.primary { background: ${t.accent}; color: #fff; border-color: ${t.accent}; }
      .gpa-range {
        width: 100%; -webkit-appearance: none; appearance: none;
        height: 4px; border-radius: 2px; background: ${t.border}; outline: none;
      }
      .gpa-range::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 14px; height: 14px; border-radius: 50%;
        background: ${t.accent}; cursor: pointer; border: 2px solid ${t.panel};
        box-shadow: 0 0 0 2px ${t.accent}55;
      }
      .gpa-range::-moz-range-thumb {
        width: 14px; height: 14px; border-radius: 50%; border: 2px solid ${t.panel};
        background: ${t.accent}; cursor: pointer;
      }
      .gpa-font-system .gpa-output, .gpa-font-system .gpa-msg.ai {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      .gpa-mini {
        position: relative;
        width: 40px; height: 40px; border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, ${t.accent}, ${t.bg} 78%);
        color: #fff; display: flex;
        align-items: center; justify-content: center; font-size: 16px;
        font-weight: 800; cursor: grab; overflow: visible;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        box-shadow: 0 0 14px 2px ${t.accent}88, 0 8px 20px rgba(0,0,0,0.45);
        animation: gpa-orb-pulse 2.4s ease-in-out infinite;
      }
      .gpa-mini::before {
        content: ''; position: absolute; inset: -6px; border-radius: 50%;
        border: 2px solid transparent; border-top-color: ${t.accent}; border-right-color: ${t.accent}66;
        animation: gpa-orb-spin 3s linear infinite;
      }
      .gpa-mini::after {
        content: ''; position: absolute; inset: -12px; border-radius: 50%;
        border: 1px dashed ${t.accent}55;
        animation: gpa-orb-spin-rev 7s linear infinite;
      }
      .gpa-mini svg { width: 18px; height: 18px; fill: #fff; position: relative; z-index: 1; }
      @keyframes gpa-orb-pulse {
        0%, 100% { box-shadow: 0 0 14px 2px ${t.accent}88, 0 8px 20px rgba(0,0,0,0.45); }
        50% { box-shadow: 0 0 24px 6px ${t.accent}cc, 0 8px 24px rgba(0,0,0,0.5); }
      }
      @keyframes gpa-orb-spin { to { transform: rotate(360deg); } }
      @keyframes gpa-orb-spin-rev { to { transform: rotate(-360deg); } }
      .gpa-mini.gpa-mini-minimal {
        animation: gpa-mini-soft-pulse 3.6s ease-in-out infinite;
        box-shadow: 0 4px 14px rgba(0,0,0,0.3);
      }
      .gpa-mini.gpa-mini-minimal::before,
      .gpa-mini.gpa-mini-minimal::after { display: none; }
      @keyframes gpa-mini-soft-pulse {
        0%, 100% { opacity: 0.92; }
        50% { opacity: 1; }
      }
      #gpa-root-host.gpa-settling {
        transition: left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      #gpa-thumb {
        display: none; width: 34px; height: 34px; object-fit: cover;
        border-radius: 6px; border: 1px solid ${t.border}; flex-shrink: 0;
      }
      #gpa-thumb.show { display: block; }
      .gpa-iframe {
        flex: 1; width: 100%; min-height: 120px; border-radius: 8px;
        border: 1px solid ${t.border}; background: #000;
      }
      .gpa-sc-wrap { flex: 1; overflow-y: auto; }
      .gpa-sc-frame { width: 100%; height: 166px; border: 0; border-radius: 8px; }
      .gpa-local-playlist { max-height: 120px; overflow-y: auto; margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
      .gpa-local-track {
        display: flex; align-items: center; gap: 6px; padding: 6px 8px;
        background: ${t.field}; border: 1px solid ${t.border}; border-radius: 6px;
        cursor: pointer; font-size: 11px; color: ${t.text};
      }
      .gpa-local-track:hover { border-color: ${t.accent}; }
      .gpa-local-track.playing { border-color: ${t.accent}; background: ${t.accent}18; color: ${t.accent}; }
      .gpa-local-track-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gpa-local-track-remove { flex-shrink: 0; opacity: 0.6; cursor: pointer; padding: 0 4px; }
      .gpa-local-track-remove:hover { opacity: 1; color: #e5453a; }
      .gpa-local-player { margin-top: 10px; padding-top: 8px; border-top: 1px solid ${t.border}; }
      #gpa-local-nowplaying { text-align: center; margin-bottom: 6px; font-weight: 700; color: ${t.accent}; }
      .game-btn { flex: 1 1 auto; min-width: 64px; font-size: 9.5px; }
      .gpa-game-stage { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
      .gpa-game-viewport {
        flex: 1; min-height: 0; overflow: hidden; margin-top: 8px;
        display: flex; flex-direction: column; align-items: center;
        justify-content: flex-start;
        padding: 6px 2px;
      }
      /* Inner wrapper that gets uniformly scaled by fitGameToStage() so any
         game fits whatever panel size (or fullscreen) is active. */
      .gpa-game-fit {
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        transform-origin: top center;
      }
      .gpa-game-timer {
        position: absolute; top: 4px; right: 6px; z-index: 8;
        padding: 3px 8px; border-radius: 3px; pointer-events: none;
        background: ${t.field}cc; border: 1px solid ${t.accent}66; color: ${t.accent};
        font-size: 11px; font-weight: 800; letter-spacing: 0.8px;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-pause-menu {
        position: absolute; inset: 0; z-index: 10;
        background: ${t.bg}e8; backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
        display: flex; align-items: center; justify-content: center; padding: 10px;
        animation: gpa-pane-in 0.18s ease both;
      }
      .gpa-pause-card {
        width: 100%; max-width: 260px; padding: 14px;
        background: ${t.panel}; border: 1px solid ${t.accent}66;
        clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
        box-shadow: 0 0 26px ${t.accent}44;
      }
      .gpa-pause-title {
        text-align: center; font-size: 13px; font-weight: 800; letter-spacing: 1.2px;
        text-transform: uppercase; color: ${t.accent}; margin-bottom: 10px;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      /* Login screen deliberately ignores the app theme — it's plain,
         corporate and boring by design, so it reads as an ordinary
         internal work portal rather than part of the console UI. */
      /* Collapsed: the panel is just a backdrop for the round button, so
         strip every HUD element that would otherwise clip or outline it. */
      .gpa-panel.gpa-minimized {
        clip-path: none !important;
        border: none !important;
        background: transparent !important;
        box-shadow: none !important;
        border-radius: 50% !important;
        overflow: visible !important;
      }
      .gpa-panel.gpa-minimized .gpa-corner,
      .gpa-panel.gpa-minimized .gpa-scanline { display: none !important; }
      /* While signed out the panel drops its angular HUD silhouette for
         plain rounded corners, and the HUD chrome (brackets, scanline) is
         hidden so the login reads as an ordinary window. */
      .gpa-panel.gpa-locked {
        clip-path: none !important;
        border-radius: 14px !important;
        border-color: #d6d9de !important;
        box-shadow: 0 10px 30px rgba(0,0,0,0.28) !important;
      }
      .gpa-panel.gpa-locked .gpa-corner,
      .gpa-panel.gpa-locked .gpa-scanline { display: none !important; }
      .gpa-panel.gpa-locked .gpa-login { border-radius: 14px; }
      /* Neutral, quiet button while signed out — no accent glow or rings. */
      .gpa-mini.gpa-mini-locked {
        width: 42px; height: 42px; border-radius: 50% !important;
        background: linear-gradient(180deg, #5b6b7f, #475464) !important;
        border: 1px solid #6d7c8e !important;
        box-shadow: 0 3px 10px rgba(0,0,0,0.28) !important;
        animation: none !important;
        color: #fff; overflow: hidden;
      }
      .gpa-mini.gpa-mini-locked::before,
      .gpa-mini.gpa-mini-locked::after { display: none !important; }
      .gpa-login {
        position: absolute; inset: 0; z-index: 40;
        background: #f4f5f7;
        display: flex; align-items: flex-start; justify-content: center; padding: 16px;
        font-family: "Segoe UI", Arial, Helvetica, sans-serif;
        overflow-y: auto; overscroll-behavior: contain;
        scrollbar-width: thin; scrollbar-color: #b9c0ca transparent;
      }
      .gpa-login::-webkit-scrollbar { width: 8px; }
      .gpa-login::-webkit-scrollbar-track { background: transparent; }
      .gpa-login::-webkit-scrollbar-thumb {
        background: #c3cad3; border-radius: 99px;
        border: 2px solid #f4f5f7; background-clip: padding-box;
      }
      .gpa-login::-webkit-scrollbar-thumb:hover { background: #9aa3af; background-clip: padding-box; }
      .gpa-login-card { margin: auto 0; }
      .gpa-login-card {
        width: 100%; max-width: 300px; background: #ffffff;
        border: 1px solid #d6d9de; border-radius: 2px; padding: 20px 18px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.06);
      }
      .gpa-login-brand { display: flex; align-items: center; gap: 10px; cursor: grab; }
      .gpa-login-brand:active { cursor: grabbing; }
      .gpa-login-brandtext { flex: 1; min-width: 0; }
      .gpa-login-winbtns { display: flex; gap: 4px; flex-shrink: 0; }
      .gpa-login-winbtn {
        width: 20px; height: 20px; border: 1px solid #c4c9d0; background: #fff;
        color: #4b5563; border-radius: 3px; cursor: pointer; line-height: 1;
        font-size: 13px; display: flex; align-items: center; justify-content: center;
        font-family: "Segoe UI", Arial, Helvetica, sans-serif;
      }
      .gpa-login-winbtn:hover { background: #eef1f5; color: #1f2933; }
      #gpa-login-close:hover { background: #b42318; border-color: #b42318; color: #fff; }
      .gpa-login-logo {
        width: 34px; height: 34px; flex-shrink: 0; background: #1f4e8c; color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 700; letter-spacing: 0.5px; border-radius: 2px;
        border: none; padding: 0; cursor: pointer;
        font-family: "Segoe UI", Arial, Helvetica, sans-serif;
        transition: background 0.15s ease, box-shadow 0.15s ease;
      }
      .gpa-login-logo:hover { background: #17406f; box-shadow: 0 0 0 3px rgba(31,78,140,0.18); }
      .gpa-login-logo:active { background: #12325a; }
      .gpa-login-company { font-size: 13px; font-weight: 600; color: #1f2933; line-height: 1.2; }
      .gpa-login-dept { font-size: 10px; color: #6b7280; margin-top: 2px; }
      .gpa-login-divider { height: 1px; background: #e4e6ea; margin: 14px 0; }
      .gpa-login-heading { font-size: 12px; font-weight: 600; color: #1f2933; margin-bottom: 12px; }
      .gpa-login-label {
        display: block; font-size: 10.5px; color: #4b5563; margin-bottom: 4px; font-weight: 600;
      }
      .gpa-login-input {
        width: 100%; padding: 7px 9px; margin-bottom: 12px;
        border: 1px solid #c4c9d0; border-radius: 2px; background: #fff;
        font-size: 12px; color: #1f2933; outline: none;
        font-family: "Segoe UI", Arial, Helvetica, sans-serif;
      }
      .gpa-login-input:focus { border-color: #1f4e8c; box-shadow: 0 0 0 2px rgba(31,78,140,0.12); }
      .gpa-login-primary {
        width: 100%; padding: 8px; background: #1f4e8c; color: #fff;
        border: 1px solid #1a4278; border-radius: 2px; cursor: pointer;
        font-size: 12px; font-weight: 600;
        font-family: "Segoe UI", Arial, Helvetica, sans-serif;
      }
      .gpa-login-primary:hover { background: #1a4278; }
      .gpa-login-msg { font-size: 10.5px; min-height: 14px; margin-bottom: 6px; color: #1f4e8c; }
      .gpa-login-msg.error { color: #b42318; }
      .gpa-login-actions { margin-top: 10px; text-align: center; }
      .gpa-login-link {
        background: none; border: none; padding: 0; cursor: pointer;
        color: #1f4e8c; font-size: 10.5px; text-decoration: underline;
        font-family: "Segoe UI", Arial, Helvetica, sans-serif;
      }
      .gpa-login-sep { color: #c4c9d0; font-size: 10.5px; margin: 0 6px; }
      .gpa-login-footer {
        margin-top: 16px; padding-top: 12px; border-top: 1px solid #e4e6ea;
        font-size: 9px; color: #6b7280; line-height: 1.5;
      }
      .gpa-login-legal { margin-top: 6px; color: #8a919c; }
      .gpa-login-copyright { margin-top: 8px; color: #9aa1ac; }
      .gpa-sync-box {
        width: 100%; min-height: 54px; margin-top: 6px; padding: 7px;
        background: ${t.field}; border: 1px solid ${t.border}; border-radius: 5px;
        color: ${t.text}; font-size: 9.5px; resize: vertical; outline: none;
        word-break: break-all;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-sync-box:focus { border-color: ${t.accent}; }
      .gpa-pause-stats { display: flex; flex-direction: column; gap: 5px; }
      .gpa-pause-stat {
        display: flex; justify-content: space-between; align-items: center; gap: 10px;
        padding: 5px 8px; background: ${t.field}; border: 1px solid ${t.border}; border-radius: 5px;
        font-size: 11px;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-pause-options { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
      .gpa-pause-options:empty { display: none; }
      .gpa-pause-optrow {
        display: flex; justify-content: space-between; align-items: center; gap: 8px;
        padding: 4px 8px; background: ${t.field}; border: 1px solid ${t.border}; border-radius: 5px;
      }
      .gpa-pause-optlabel {
        color: ${t.sub}; text-transform: uppercase; letter-spacing: 0.5px; font-size: 9.5px;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-pause-optselect {
        background: ${t.panel}; color: ${t.accent}; border: 1px solid ${t.accent}55;
        border-radius: 4px; font-size: 10px; font-weight: 700; padding: 3px 5px;
        cursor: pointer; outline: none; max-width: 110px;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-pause-optbtn {
        background: ${t.panel}; color: ${t.accent}; border: 1px solid ${t.accent}55;
        border-radius: 4px; font-size: 10px; font-weight: 700; padding: 3px 9px; cursor: pointer;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-pause-stat-label { color: ${t.sub}; text-transform: uppercase; letter-spacing: 0.5px; font-size: 9.5px; }
      .gpa-pause-stat-value { color: ${t.accent}; font-weight: 800; }
      /* Fullscreen: the stage becomes the whole screen, game centered on it.
         Scaling itself is handled in JS by fitGameToStage() so mouse
         coordinates stay correct (a fixed CSS scale would break them). */
      .gpa-game-stage:fullscreen,
      .gpa-game-stage:-webkit-full-screen {
        background: ${t.bg}; padding: 20px;
      }
      .gpa-game-stage:fullscreen .gpa-game-viewport,
      .gpa-game-stage:-webkit-full-screen .gpa-game-viewport {
        justify-content: center;
      }
      .gpa-game-stage:fullscreen .game-canvas,
      .gpa-game-stage:-webkit-full-screen .game-canvas {
        image-rendering: pixelated;
      }
      .gpa-game-status {
        font-size: 12px; font-weight: 700; color: ${t.text}; text-align: center;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .ttt-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; width: 180px; }
      .ttt-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 26px; font-weight: 800; color: ${t.accent}; cursor: pointer;
        background: ${t.field}; border: 1px solid ${t.accent}44; border-radius: 6px;
      }
      .ttt-cell:hover { border-color: ${t.accent}; }
      .rps-row { display: flex; gap: 10px; }
      .rps-btn {
        font-size: 26px; width: 52px; height: 52px; border-radius: 50%;
        background: ${t.field}; border: 1px solid ${t.accent}55; cursor: pointer;
      }
      .rps-btn:hover { border-color: ${t.accent}; box-shadow: 0 0 10px ${t.accent}55; }
      .memory-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; width: 220px; }
      .memory-card {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 20px; background: ${t.field}; border: 1px solid ${t.accent}44;
        border-radius: 6px; cursor: pointer; user-select: none;
      }
      .memory-card.flipped, .memory-card.matched { background: ${t.accent}22; border-color: ${t.accent}; }
      .memory-card.matched { opacity: 0.55; cursor: default; }
      .game-canvas { border: 1px solid ${t.accent}55; border-radius: 6px; background: ${t.bg}; }
      .g2048-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; width: 220px; }
      .g2048-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 15px; font-weight: 800; border-radius: 5px; background: ${t.field};
        color: ${t.text};
      }
      .whack-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 200px; }
      .whack-hole {
        aspect-ratio: 1; border-radius: 50%; background: ${t.field};
        border: 1px solid ${t.accent}44; cursor: pointer;
        display: flex; align-items: center; justify-content: center; font-size: 22px;
      }
      .whack-hole.up { background: ${t.accent}33; border-color: ${t.accent}; }
      .hangman-letters { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; width: 230px; }
      .hangman-letter {
        font-size: 10px; padding: 5px 0; background: ${t.field}; border: 1px solid ${t.accent}44;
        border-radius: 4px; cursor: pointer; text-align: center;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .hangman-letter:disabled { opacity: 0.35; cursor: default; }
      .hangman-word {
        font-size: 22px; letter-spacing: 5px; font-weight: 800;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        color: ${t.accent};
      }
      .wordle-grid { display: flex; flex-direction: column; gap: 5px; margin: 6px 0; }
      .wordle-row { display: flex; gap: 5px; }
      .wordle-tile {
        width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 16px; border: 1px solid ${t.accent}44; border-radius: 4px;
        background: ${t.field}; color: ${t.text};
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .wordle-tile.correct { background: #22c55e; border-color: #22c55e; color: #fff; }
      .wordle-tile.present { background: #eab308; border-color: #eab308; color: #111; }
      .wordle-tile.absent { background: ${t.border}; border-color: ${t.border}; color: ${t.sub}; }
      .c4-board { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; width: 238px; background: ${t.field}; padding: 6px; border-radius: 6px; }
      .c4-cell { aspect-ratio: 1; border-radius: 50%; background: ${t.panel}; border: 1px solid ${t.accent}33; cursor: pointer; }
      .c4-cell.c4-red { background: #e5453a; border-color: #e5453a; }
      .c4-cell.c4-yellow { background: #f5c518; border-color: #f5c518; }
      .mine-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; width: 216px; }
      .mine-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800; background: ${t.field}; border: 1px solid ${t.accent}33;
        cursor: pointer; border-radius: 2px; user-select: none;
      }
      .mine-cell.revealed { background: ${t.panel}; cursor: default; }
      .mine-cell.mine { background: #e5453a55; }
      .mine-cell.n1 { color: #4da3ff; }
      .mine-cell.n2 { color: #22c55e; }
      .mine-cell.n3 { color: #e5453a; }
      .mine-cell.n4 { color: #8b5cf6; }
      .mine-cell.n5 { color: #f5c518; }
      .mine-cell.n6 { color: #06b6d4; }
      .mine-cell.n7 { color: ${t.text}; }
      .mine-cell.n8 { color: ${t.sub}; }
      .simon-pad { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; width: 160px; height: 160px; }
      .simon-btn { border-radius: 10px; cursor: pointer; opacity: 0.55; transition: opacity 0.1s ease; }
      .simon-btn.active { opacity: 1; box-shadow: 0 0 14px currentColor; }
      .simon-red { background: #e5453a; }
      .simon-blue { background: #4da3ff; }
      .simon-green { background: #22c55e; }
      .simon-yellow { background: #f5c518; }
      .reaction-box {
        width: 100%; max-width: 240px; height: 120px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center; text-align: center;
        font-weight: 800; font-size: 13px; cursor: pointer; padding: 10px; color: #fff;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .reaction-box.waiting { background: #e5453a; }
      .reaction-box.ready { background: #22c55e; }
      .checkers-board { display: grid; grid-template-columns: repeat(8, 1fr); width: 224px; border: 2px solid ${t.accent}55; }
      .checkers-cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; cursor: pointer; }
      .checkers-cell.light { background: ${t.field}; }
      .checkers-cell.dark { background: ${t.panel}; }
      .checkers-cell.selected { outline: 2px solid ${t.accent}; outline-offset: -2px; }
      .checkers-cell.valid-move { box-shadow: inset 0 0 0 3px ${t.accent}88; }
      .checkers-piece {
        width: 70%; height: 70%; border-radius: 50%; display: flex;
        align-items: center; justify-content: center; font-size: 10px;
      }
      .checkers-piece.red { background: #e5453a; border: 2px solid #a8281f; }
      .checkers-piece.black { background: #2a2a30; border: 2px solid #111; }
      .sudoku-grid { display: grid; grid-template-columns: repeat(9, 1fr); width: 225px; border: 2px solid ${t.accent}66; }
      .sudoku-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 700; background: ${t.field}; border: 1px solid ${t.border};
        cursor: pointer; color: ${t.text};
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .sudoku-cell.given { color: ${t.accent}; font-weight: 800; cursor: default; background: ${t.panel}; }
      .sudoku-cell.selected { background: ${t.accent}33; }
      .sudoku-cell.conflict { color: #e5453a; }
      .sudoku-cell.border-right { border-right: 2px solid ${t.accent}66; }
      .sudoku-cell.border-bottom { border-bottom: 2px solid ${t.accent}66; }
      .sudoku-numrow { display: flex; gap: 3px; margin-top: 8px; flex-wrap: wrap; }
      .sudoku-num { flex: 1; min-width: 20px; padding: 6px 0; font-size: 12px; }

      /* Themed scrollbars — thumb matches the current accent color */
      .gpa-body, .gpa-output, .gpa-chat, .gpa-sc-wrap {
        scrollbar-width: thin;
        scrollbar-color: ${t.accent} ${t.field};
      }
      .gpa-body::-webkit-scrollbar, .gpa-output::-webkit-scrollbar,
      .gpa-chat::-webkit-scrollbar, .gpa-sc-wrap::-webkit-scrollbar {
        width: 8px; height: 8px;
      }
      .gpa-body::-webkit-scrollbar-track, .gpa-output::-webkit-scrollbar-track,
      .gpa-chat::-webkit-scrollbar-track, .gpa-sc-wrap::-webkit-scrollbar-track {
        background: ${t.field}; border-radius: 8px;
      }
      .gpa-body::-webkit-scrollbar-thumb, .gpa-output::-webkit-scrollbar-thumb,
      .gpa-chat::-webkit-scrollbar-thumb, .gpa-sc-wrap::-webkit-scrollbar-thumb {
        background: ${t.accent}; border-radius: 8px; border: 2px solid ${t.field};
      }
      .gpa-body::-webkit-scrollbar-thumb:hover, .gpa-output::-webkit-scrollbar-thumb:hover,
      .gpa-chat::-webkit-scrollbar-thumb:hover, .gpa-sc-wrap::-webkit-scrollbar-thumb:hover {
        background: ${t.sub};
      }
      .gpa-body::-webkit-scrollbar-corner { background: transparent; }

      /* ---- Extended tools ---- */
      .gpa-sel-bubble { position: fixed; z-index: 2147483647; display: flex; gap: 2px; padding: 4px; border-radius: 10px; background: ${t.panel}; border: 1px solid ${t.accent}; box-shadow: 0 6px 24px rgba(0,0,0,0.45); }
      .gpa-sel-bubble button { background: transparent; border: none; color: ${t.text}; font-size: 11px; padding: 4px 7px; border-radius: 6px; cursor: pointer; white-space: nowrap; font-family: inherit; }
      .gpa-sel-bubble button:hover { background: ${t.accent}33; }
      .gpa-sel-pop { position: fixed; z-index: 2147483647; max-width: 340px; max-height: 260px; overflow: auto; padding: 10px 12px; border-radius: 10px; background: ${t.panel}; border: 1px solid ${t.accent}; color: ${t.text}; font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: break-word; box-shadow: 0 8px 28px rgba(0,0,0,0.5); }
      .gpa-sel-pop .gpa-sel-pop-src { display: block; margin-top: 8px; font-size: 10px; opacity: 0.65; overflow-wrap: break-word; }
      .gpa-flip { perspective: 900px; cursor: pointer; min-height: 96px; }
      .gpa-flip-inner { position: relative; transition: transform 0.35s; transform-style: preserve-3d; min-height: 96px; }
      .gpa-flip.flipped .gpa-flip-inner { transform: rotateY(180deg); }
      .gpa-flip-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; display: flex; align-items: center; justify-content: center; text-align: center; padding: 12px; border-radius: 10px; border: 1px solid ${t.border}; background: ${t.field}; color: ${t.text}; font-size: 12.5px; line-height: 1.5; overflow: auto; }
      .gpa-flip-back { transform: rotateY(180deg); background: ${t.accent}1f; border-color: ${t.accent}; }
      .gpa-pomo-time { font-size: 22px; font-weight: 700; letter-spacing: 2px; font-family: 'JetBrains Mono', ui-monospace, monospace; }
      .gpa-flash-once { animation: gpa-flash 1.2s ease-in-out 3; }
      @keyframes gpa-flash { 0%, 100% { outline: none; } 50% { outline: 3px solid ${t.accent}; outline-offset: 2px; } }
    `;
    if (typeof applyMiniColorMode === 'function') applyMiniColorMode();
  }
  applyTheme(theme);

  // ---- Drag logic -----------------------------------------------------
  (function makeDraggable() {
    let dragging = null, offX = 0, offY = 0;

    function start(e) {
      dragging = host;
      host.classList.remove('gpa-settling'); // grabbing mid-flight should feel instant, not laggy
      const rect = host.getBoundingClientRect();
      const p = 'touches' in e ? e.touches[0] : e;
      offX = p.clientX - rect.left;
      offY = p.clientY - rect.top;
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      const p = 'touches' in e ? e.touches[0] : e;
      let x = p.clientX - offX, y = p.clientY - offY;
      // Clamp against the panel's ACTUAL current size (mini dot, settled
      // panel, or whichever size preset is active) so it can never be
      // dragged past the edge of the visible window.
      const rect = host.getBoundingClientRect();
      x = Math.max(0, Math.min(window.innerWidth - rect.width, x));
      y = Math.max(0, Math.min(window.innerHeight - rect.height, y));
      host.style.left = x + 'px';
      host.style.top = y + 'px';
    }
    function end() { dragging = null; }

    root.addEventListener('mousedown', (e) => {
      if (e.target.closest('#gpa-drag') || e.target.closest('.gpa-mini') || (e.target.closest('.gpa-login-brand') && !e.target.closest('.gpa-login-logo') && !e.target.closest('.gpa-login-winbtns'))) start(e);
    });
    root.addEventListener('touchstart', (e) => {
      if (e.target.closest('#gpa-drag') || e.target.closest('.gpa-mini') || (e.target.closest('.gpa-login-brand') && !e.target.closest('.gpa-login-logo') && !e.target.closest('.gpa-login-winbtns'))) start(e);
    }, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
  })();

  // ---- Minimize / restore ---------------------------------------------
  const body = panel.querySelector('#gpa-body');
  const headerEl = panel.querySelector('.gpa-header');
  panel.querySelector('#gpa-min').addEventListener('click', () => setMinimized(true));
  minimized.addEventListener('click', () => setMinimized(false));
  host.addEventListener('gpa-toggle', () => setMinimized(!isMin));
  panel.querySelector('#gpa-close').addEventListener('click', () => host.remove());

  let isMin = false;
  function setMinimized(v) {
    const prevRect = host.getBoundingClientRect(); // capture BEFORE resizing anything below
    isMin = v;
    if (v) stopActiveGame();
    body.style.display = v ? 'none' : 'flex';
    headerEl.style.display = v ? 'none' : 'flex';
    minimized.style.display = v ? 'flex' : 'none';
    // The login overlay sits at z-index 40 across the whole panel, so if it
    // stays mounted while collapsed it covers the mini button and eats every
    // click and drag. Hide it while minimized; restore it on expand if the
    // user still hasn't signed in. (Queried live rather than closed over,
    // since this function is defined before the overlay reference exists.)
    const loginEl = panel.querySelector('#gpa-login');
    const signedInNow = typeof currentUser !== 'undefined' && currentUser;
    if (loginEl) {
      loginEl.style.display = v ? 'none' : (signedInNow ? 'none' : 'flex');
    }
    // The locked-chrome rules use !important (rounded corners, panel shadow),
    // which would otherwise paint a panel-sized shadow around the collapsed
    // dot. Drop the class while minimized, restore it on expand if signed out.
    panel.classList.toggle('gpa-locked', !v && !signedInNow);
    panel.classList.toggle('gpa-minimized', v);
    panel.style.width = v ? 'auto' : (PANEL_SIZES[panelSizeKey] || PANEL_SIZES.normal).w + 'px';
    panel.style.height = v ? 'auto' : (PANEL_SIZES[panelSizeKey] || PANEL_SIZES.normal).h + 'px';
    panel.style.background = v ? 'transparent' : THEMES[theme].panel;
    panel.style.boxShadow = v ? 'none' : '';
    panel.style.border = v ? 'none' : '';

    if (v) {
      // Animate to a resting spot in the bottom-right corner. Still fully
      // draggable afterward — grabbing it mid-flight (see `start()` above)
      // cancels the transition immediately so it never fights your cursor.
      const margin = 24, size = 40;
      const targetLeft = Math.max(0, window.innerWidth - size - margin);
      const targetTop = Math.max(0, window.innerHeight - size - margin);
      host.classList.add('gpa-settling');
      host.style.left = targetLeft + 'px';
      host.style.top = targetTop + 'px';
      host.addEventListener('transitionend', () => host.classList.remove('gpa-settling'), { once: true });
    } else {
      host.classList.remove('gpa-settling');
      // Expand from the SAME corner the mini dot was resting at (so it
      // grows up-and-left, away from the edge it was sitting against)
      // instead of keeping the old top-left pinned and letting the
      // now-much-bigger panel spill off the right/bottom of the screen.
      // Clamped afterward as a safety net for any resting position.
      const { w: newW, h: newH } = PANEL_SIZES[panelSizeKey] || PANEL_SIZES.normal;
      let newLeft = prevRect.right - newW;
      let newTop = prevRect.bottom - newH;
      newLeft = Math.max(0, Math.min(window.innerWidth - newW, newLeft));
      newTop = Math.max(0, Math.min(window.innerHeight - newH, newTop));
      host.style.left = newLeft + 'px';
      host.style.top = newTop + 'px';
    }

    // Signed out, particles stay off regardless of the stored preference.
    const signedIn = typeof currentUser !== 'undefined' && currentUser;
    const activeParticleStyle = signedIn ? (localStorage.getItem(PARTICLE_KEY) || 'off') : 'off';
    if (v) {
      particleCanvas.style.display = 'none';
      if (particleAnimId) { cancelAnimationFrame(particleAnimId); particleAnimId = null; }
    } else if (activeParticleStyle !== 'off') {
      particleCanvas.style.display = 'block';
      if (!particleAnimId) stepParticles();
    }
  }

  // ---- Dropdown section switcher -----------------------------------------
  const dropdown = panel.querySelector('#gpa-dropdown');
  const dropdownBtn = panel.querySelector('#gpa-dropdown-btn');
  const dropdownLabel = panel.querySelector('#gpa-dropdown-label');

  dropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  root.addEventListener('click', (e) => {
    if (!e.target.closest('#gpa-dropdown')) dropdown.classList.remove('open');
  });

  panel.querySelectorAll('.gpa-dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
      panel.querySelectorAll('.gpa-dropdown-item').forEach((b) => b.classList.remove('active'));
      panel.querySelectorAll('.gpa-pane').forEach((p) => p.classList.remove('active'));
      item.classList.add('active');
      panel.querySelector(`.gpa-pane[data-pane="${item.dataset.tab}"]`).classList.add('active');
      dropdownLabel.textContent = item.textContent;
      dropdown.classList.remove('open');
      if (item.dataset.tab !== 'games') stopActiveGame();
      if (item.dataset.tab === 'saved') renderSavedInsights();
      if (item.dataset.tab === 'study') renderDeck();
      // A hidden pane measures as zero, so games can only be sized once
      // the tab is actually visible.
      else requestAnimationFrame(() => { if (typeof fitGameToStage === 'function') fitGameToStage(); });
    });
  });

  // ---- Theme swatches -----------------------------------------------------
  panel.querySelectorAll('.gpa-swatch').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  const customColorInput = panel.querySelector('#gpa-custom-color');
  customColorInput.value = savedCustomAccent;
  customColorInput.addEventListener('input', (e) => {
    const color = e.target.value;
    localStorage.setItem(CUSTOM_COLOR_KEY, color);
    THEMES.custom = { ...THEMES.dark, accent: color };
    applyTheme('custom');
  });

  panel.querySelector('#gpa-clear-key').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    alert('Saved Gemini API key cleared for this site.');
  });
  panel.querySelector('#gpa-clear-openai-key').addEventListener('click', () => {
    localStorage.removeItem(OPENAI_STORAGE_KEY);
    alert('Saved OpenAI API key cleared for this site.');
  });
  panel.querySelector('#gpa-clear-yt-key').addEventListener('click', () => {
    localStorage.removeItem(YT_STORAGE_KEY);
    alert('Saved YouTube API key cleared for this site.');
  });

  // ---- AI provider toggle (Gemini / OpenAI) ------------------------------
  const providerBtns = panel.querySelectorAll('.provider-btn');
  function setProviderUI(p) {
    providerBtns.forEach((b) => b.classList.toggle('primary', b.dataset.provider === p));
  }
  setProviderUI(localStorage.getItem(PROVIDER_KEY) || 'gemini');
  providerBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(PROVIDER_KEY, btn.dataset.provider);
      setProviderUI(btn.dataset.provider);
      renderMiniIcon(); // in case "Letter" style is active — it tracks the provider
    });
  });

  // ---- Minimized-button icon toggle --------------------------------------
  const iconBtns = panel.querySelectorAll('.icon-btn');
  function setIconUI(i) {
    iconBtns.forEach((b) => b.classList.toggle('primary', b.dataset.icon === i));
  }
  setIconUI(localStorage.getItem(ICON_KEY) || 'dot');
  iconBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(ICON_KEY, btn.dataset.icon);
      setIconUI(btn.dataset.icon);
      renderMiniIcon();
    });
  });

  // ---- Minimized-button look (Futuristic / Minimal) ----------------------
  const lookBtns = panel.querySelectorAll('.look-btn');
  function setLookUI(l) {
    lookBtns.forEach((b) => b.classList.toggle('primary', b.dataset.look === l));
  }
  setLookUI(localStorage.getItem(ICON_LOOK_KEY) || 'futuristic');
  lookBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(ICON_LOOK_KEY, btn.dataset.look);
      setLookUI(btn.dataset.look);
      applyMiniLook();
    });
  });

  // ---- Minimized-button color (Theme accent / Match this page) ----------
  const colorModeBtns = panel.querySelectorAll('.colormode-btn');
  function setColorModeUI(m) {
    colorModeBtns.forEach((b) => b.classList.toggle('primary', b.dataset.colormode === m));
  }
  setColorModeUI(localStorage.getItem(ICON_COLOR_MODE_KEY) || 'theme');
  colorModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(ICON_COLOR_MODE_KEY, btn.dataset.colormode);
      setColorModeUI(btn.dataset.colormode);
      applyMiniColorMode();
    });
  });

  // ---- Typing speed toggle ------------------------------------------------
  const speedBtns = panel.querySelectorAll('.speed-btn');
  function setSpeedUI(s) {
    speedBtns.forEach((b) => b.classList.toggle('primary', b.dataset.speed === s));
  }
  setSpeedUI(localStorage.getItem(SPEED_KEY) || 'normal');
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(SPEED_KEY, btn.dataset.speed);
      setSpeedUI(btn.dataset.speed);
    });
  });

  // ---- Response font toggle ------------------------------------------------
  const fontBtns = panel.querySelectorAll('.font-btn');
  function setFontUI(f) {
    fontBtns.forEach((b) => b.classList.toggle('primary', b.dataset.font === f));
    panel.classList.toggle('gpa-font-system', f === 'system');
  }
  setFontUI(localStorage.getItem(FONT_KEY) || 'mono');
  fontBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(FONT_KEY, btn.dataset.font);
      setFontUI(btn.dataset.font);
    });
  });

  // ---- Ambient particle background ---------------------------------------
  // A canvas that floats around the panel's edges (not on top of content,
  // so it never blocks a click) with several interactive styles. Particles
  // gently drift away from the cursor and are tinted with the current
  // theme's accent color, so switching themes re-colors them automatically.
  // The "play area" (how far the particle field extends past the panel's
  // edges) is adjustable via a slider in Settings.
  const particleCtx = particleCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let particleMargin = parseInt(localStorage.getItem(PARTICLE_SIZE_KEY), 10);
  if (isNaN(particleMargin)) particleMargin = 40;
  let PW = PARTICLE_PANEL_W + particleMargin * 2;
  let PH = PARTICLE_PANEL_H + particleMargin * 2;

  function resizeParticleCanvas() {
    PW = PARTICLE_PANEL_W + particleMargin * 2;
    PH = PARTICLE_PANEL_H + particleMargin * 2;
    particleCanvas.style.inset = `-${particleMargin}px`;
    particleCanvas.width = PW * dpr;
    particleCanvas.height = PH * dpr;
    particleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeParticleCanvas();

  let particles = [];
  let particleAnimId = null;
  let mouseX = -9999, mouseY = -9999;

  particleWrap.addEventListener('mousemove', (e) => {
    const rect = particleCanvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  });
  particleWrap.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const num = parseInt(full, 16);
    return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`;
  }

  function makeParticle(styleName) {
    const w = PW, h = PH;
    const p = { style: styleName };
    if (styleName === 'snow') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.3; p.vy = 0.3 + Math.random() * 0.6;
      p.r = 1 + Math.random() * 2; p.alpha = 0.4 + Math.random() * 0.5; p.sway = Math.random() * Math.PI * 2;
    } else if (styleName === 'bubbles') {
      p.x = Math.random() * w; p.y = h + Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.2; p.vy = -(0.3 + Math.random() * 0.5);
      p.r = 2 + Math.random() * 4; p.alpha = 0.15 + Math.random() * 0.25; p.wobble = Math.random() * Math.PI * 2;
    } else if (styleName === 'stars') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = 0; p.vy = 0; p.r = 1 + Math.random() * 1.8;
      p.phase = Math.random() * Math.PI * 2; p.speed = 0.015 + Math.random() * 0.03;
    } else if (styleName === 'network') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.5; p.vy = (Math.random() - 0.5) * 0.5;
      p.r = 1.8; p.alpha = 0.85;
    } else if (styleName === 'fireflies') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.18; p.vy = (Math.random() - 0.5) * 0.18;
      p.r = 2 + Math.random() * 2.5; p.phase = Math.random() * Math.PI * 2; p.speed = 0.01 + Math.random() * 0.02;
    } else if (styleName === 'confetti') {
      p.x = Math.random() * w; p.y = Math.random() * h - h;
      p.vx = (Math.random() - 0.5) * 0.6; p.vy = 0.6 + Math.random() * 1.1;
      p.rw = 4 + Math.random() * 4; p.rh = 3 + Math.random() * 3;
      p.rot = Math.random() * Math.PI; p.vr = (Math.random() - 0.5) * 0.08;
      p.shade = Math.floor(Math.random() * 3);
    } else { // sparkles (default)
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.15; p.vy = (Math.random() - 0.5) * 0.15;
      p.r = 0.6 + Math.random() * 1.6; p.phase = Math.random() * Math.PI * 2; p.speed = 0.02 + Math.random() * 0.04;
    }
    return p;
  }

  function initParticles(styleName) {
    particles = [];
    if (styleName === 'off') return;
    // Density scales with the play area so a bigger canvas doesn't look sparse.
    const count = Math.max(16, Math.min(90, Math.round((PW * PH) / 4200)));
    for (let i = 0; i < count; i++) particles.push(makeParticle(styleName));
  }

  function stepParticles() {
    const styleName = localStorage.getItem(PARTICLE_KEY) || 'off';
    if (styleName === 'off') {
      particleCtx.clearRect(0, 0, PW, PH);
      particleAnimId = null;
      return;
    }
    const w = PW, h = PH;
    particleCtx.clearRect(0, 0, w, h);
    const accent = THEMES[theme].accent;
    const shadeColors = [accent, THEMES[theme].text, THEMES[theme].sub];

    if (styleName === 'network') {
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      });
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const linkDist = Math.min(w, h) * 0.18;
          if (d < linkDist) {
            particleCtx.strokeStyle = hexToRgba(accent, 0.22 * (1 - d / linkDist));
            particleCtx.lineWidth = 1;
            particleCtx.beginPath();
            particleCtx.moveTo(a.x, a.y);
            particleCtx.lineTo(b.x, b.y);
            particleCtx.stroke();
          }
        }
      }
      particles.forEach((p) => {
        particleCtx.beginPath();
        particleCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        particleCtx.fillStyle = hexToRgba(accent, p.alpha);
        particleCtx.fill();
      });
      particleAnimId = requestAnimationFrame(stepParticles);
      return;
    }

    if (styleName === 'confetti') {
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
        particleCtx.save();
        particleCtx.translate(p.x, p.y);
        particleCtx.rotate(p.rot);
        particleCtx.globalAlpha = 0.85;
        particleCtx.fillStyle = shadeColors[p.shade % shadeColors.length];
        particleCtx.fillRect(-p.rw / 2, -p.rh / 2, p.rw, p.rh);
        particleCtx.restore();
      });
      particleAnimId = requestAnimationFrame(stepParticles);
      return;
    }

    particles.forEach((p) => {
      const dx = p.x - mouseX, dy = p.y - mouseY;
      const dist = Math.hypot(dx, dy);
      if (dist < 60 && dist > 0.01) {
        const force = ((60 - dist) / 60) * 1.4;
        p.x += (dx / dist) * force;
        p.y += (dy / dist) * force;
      }
      let alpha = 0.6;
      if (p.style === 'snow') {
        p.sway += 0.02;
        p.x += p.vx + Math.sin(p.sway) * 0.3;
        p.y += p.vy;
        if (p.y > h + 5) { p.y = -5; p.x = Math.random() * w; }
        alpha = p.alpha;
      } else if (p.style === 'bubbles') {
        p.wobble += 0.03;
        p.x += p.vx + Math.sin(p.wobble) * 0.4;
        p.y += p.vy;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        alpha = p.alpha;
      } else if (p.style === 'stars') {
        p.phase += p.speed;
        alpha = 0.2 + Math.abs(Math.sin(p.phase)) * 0.8;
      } else if (p.style === 'fireflies') {
        p.x += p.vx; p.y += p.vy;
        p.phase += p.speed;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        alpha = 0.25 + Math.abs(Math.sin(p.phase)) * 0.6;
        const glow = particleCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        glow.addColorStop(0, hexToRgba(accent, alpha));
        glow.addColorStop(1, hexToRgba(accent, 0));
        particleCtx.fillStyle = glow;
        particleCtx.beginPath();
        particleCtx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        particleCtx.fill();
      } else { // sparkles
        p.x += p.vx; p.y += p.vy;
        p.phase += p.speed;
        alpha = 0.25 + Math.abs(Math.sin(p.phase)) * 0.75;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      }
      particleCtx.beginPath();
      particleCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      particleCtx.fillStyle = hexToRgba(accent, alpha);
      particleCtx.fill();
    });
    particleAnimId = requestAnimationFrame(stepParticles);
  }

  function setParticleStyle(styleName) {
    localStorage.setItem(PARTICLE_KEY, styleName);
    particleCanvas.style.display = styleName === 'off' || isMin ? 'none' : 'block';
    initParticles(styleName);
    if (particleAnimId) cancelAnimationFrame(particleAnimId);
    particleAnimId = null;
    if (styleName !== 'off' && !isMin) stepParticles();
  }

  const particleBtns = panel.querySelectorAll('.particle-btn');
  function setParticleUI(s) {
    particleBtns.forEach((b) => b.classList.toggle('primary', b.dataset.particle === s));
  }
  setParticleUI(localStorage.getItem(PARTICLE_KEY) || 'off');
  // Particles stay off until someone signs in — before login we don't know
  // whose preference applies, and the login screen should look plain.
  setParticleStyle('off');

  particleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setParticleUI(btn.dataset.particle);
      setParticleStyle(btn.dataset.particle);
    });
  });

  const particleSizeInput = panel.querySelector('#gpa-particle-size');
  particleSizeInput.value = particleMargin;
  particleSizeInput.addEventListener('input', (e) => {
    particleMargin = parseInt(e.target.value, 10);
    localStorage.setItem(PARTICLE_SIZE_KEY, String(particleMargin));
    resizeParticleCanvas();
    initParticles(localStorage.getItem(PARTICLE_KEY) || 'off');
  });

  // ---- Interface size presets ---------------------------------------------
  let panelSizeKey = localStorage.getItem(PANEL_SIZE_KEY) || 'normal';
  if (!PANEL_SIZES[panelSizeKey]) panelSizeKey = 'normal';
  const sizeBtns = panel.querySelectorAll('.size-btn');
  function setSizeUI(s) {
    sizeBtns.forEach((b) => b.classList.toggle('primary', b.dataset.size === s));
  }
  function applyPanelSize(key) {
    panelSizeKey = PANEL_SIZES[key] ? key : 'normal';
    localStorage.setItem(PANEL_SIZE_KEY, panelSizeKey);
    const { w, h } = PANEL_SIZES[panelSizeKey];
    if (!isMin) {
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
    }
    // Keep the ambient particle field sized to whatever the panel is now.
    PARTICLE_PANEL_W = w;
    PARTICLE_PANEL_H = h;
    resizeParticleCanvas();
    initParticles(localStorage.getItem(PARTICLE_KEY) || 'off');
    // The games stage just changed size too — rescale whatever is loaded.
    if (typeof fitGameToStage === 'function') requestAnimationFrame(fitGameToStage);
  }
  setSizeUI(panelSizeKey);
  applyPanelSize(panelSizeKey);
  sizeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setSizeUI(btn.dataset.size);
      applyPanelSize(btn.dataset.size);
    });
  });

  // ---- Gemini API helpers -----------------------------------------------
  function getApiKey() {
    let key = API_KEY_DEFAULT || localStorage.getItem(STORAGE_KEY);
    if (!key) {
      key = prompt('Paste your Gemini API key (from aistudio.google.com/apikey):');
      if (key) localStorage.setItem(STORAGE_KEY, key.trim());
    }
    return key ? key.trim() : null;
  }

  async function callGemini(userText, systemText, imageDataUrls) {
    const key = getApiKey();
    if (!key) throw new Error('No API key provided.');

    const parts = [];
    if (userText) parts.push({ text: userText });
    if (imageDataUrls && imageDataUrls.length) {
      imageDataUrls.forEach((dataUrl) => {
        const match = dataUrl.match(/^data:(.+);base64,(.*)$/);
        if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
      });
    }
    if (!parts.length) throw new Error('Nothing to send.');

    const body = { contents: [{ role: 'user', parts }] };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

    const res = await rawFetch(`${API_BASE}${MODEL}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '(no response)';
    return text;
  }

  // ---- OpenAI API helpers -------------------------------------------------
  function getOpenAiKey() {
    let key = localStorage.getItem(OPENAI_STORAGE_KEY);
    if (!key) {
      key = prompt('Paste your OpenAI API key (starts with "sk-"):');
      if (key) {
        key = key.trim();
        if (!key.startsWith('sk-')) {
          alert('That doesn\'t look like an OpenAI key — they normally start with "sk-". Saving it anyway; double-check if requests fail.');
        }
        localStorage.setItem(OPENAI_STORAGE_KEY, key);
      }
    }
    return key ? key.trim() : null;
  }

  // Native fetch that bypasses the page's own monkey-patched window.fetch.
  // Some sites (Quizlet/Edmentum is one) wrap window.fetch, and their
  // wrapper can throw on our cross-origin API calls ("Invalid value"). A
  // fresh about:blank iframe hands us an untouched copy of native fetch;
  // if that's unavailable, fall back to XMLHttpRequest.
  const rawFetch = (function () {
    try {
      const ifr = document.createElement('iframe');
      ifr.style.display = 'none';
      ifr.setAttribute('aria-hidden', 'true');
      document.documentElement.appendChild(ifr);
      if (ifr.contentWindow && ifr.contentWindow.fetch) {
        return ifr.contentWindow.fetch.bind(ifr.contentWindow);
      }
    } catch (e) { /* fall through to XHR */ }
    return function xhrFetch(url, opts) {
      opts = opts || {};
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(opts.method || 'GET', url, true);
        const headers = opts.headers || {};
        Object.keys(headers).forEach((k) => { try { xhr.setRequestHeader(k, headers[k]); } catch (e) { /* skip */ } });
        xhr.withCredentials = false;
        xhr.onload = () => resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          text: () => Promise.resolve(xhr.responseText),
          json: () => Promise.resolve(JSON.parse(xhr.responseText))
        });
        xhr.onerror = () => reject(new TypeError('Failed to fetch'));
        xhr.send(opts.body || null);
      });
    };
  })();

  async function callOpenAI(userText, systemText, imageDataUrls) {
    const key = getOpenAiKey();
    if (!key) throw new Error('No OpenAI API key provided.');

    const content = [];
    if (userText) content.push({ type: 'text', text: userText });
    if (imageDataUrls && imageDataUrls.length) {
      imageDataUrls.forEach((dataUrl) => content.push({ type: 'image_url', image_url: { url: dataUrl } }));
    }
    if (!content.length) throw new Error('Nothing to send.');

    const messages = [];
    if (systemText) messages.push({ role: 'system', content: systemText });
    messages.push({ role: 'user', content });

    const res = await rawFetch(`${OPENAI_PROXY || 'https://api.openai.com'}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({ model: OPENAI_MODEL, messages })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI API error (${res.status}): ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '(no response)';
  }

  // Dispatches to whichever provider is selected in the Theme tab.
  async function callAI(userText, systemText, imageDataUrls) {
    const provider = localStorage.getItem(PROVIDER_KEY) || 'gemini';
    return provider === 'openai'
      ? callOpenAI(userText, systemText, imageDataUrls)
      : callGemini(userText, systemText, imageDataUrls);
  }

  // Real second-pass check for quiz/answer-grid results: sends the draft
  // answers back to the AI alongside the original context and asks it to
  // re-verify each one, fixing anything wrong and returning a final,
  // calibrated confidence per item. Falls back to the draft if the
  // verification call fails or comes back unparsable, so a bad second
  // pass never wipes out a good first one.
  async function verifyGridAnswers(contextText, draftGrid, imageDataUrls) {
    const sys = 'You previously drafted answers to a set of questions. Re-check EACH answer against the original context on its own, independently — do not just assume the draft is correct. Fix anything wrong, then return a final JSON array in this exact shape and nothing else: [{"q":"1","a":"B","c":92}] — "c" is your honest confidence (0-100) that this specific final answer is correct. Do not include any text outside the JSON array.';
    const userText = `ORIGINAL CONTEXT:\n${contextText}\n\nDRAFT ANSWERS TO VERIFY:\n${JSON.stringify(draftGrid)}`;
    try {
      const out = await callAI(userText, sys, imageDataUrls);
      const verified = tryParseAnswerGrid(out);
      return verified || draftGrid;
    } catch (e) {
      return draftGrid;
    }
  }

  // ---- Friendly error display ---------------------------------------------
  // Turns raw API error text (status codes, JSON bodies) into one plain
  // sentence, and renders it in a small styled box instead of a code dump.
  function explainError(err, label) {
    const msg = (err && err.message) || String(err);
    const statusMatch = msg.match(/\((\d{3})\)/);
    const status = statusMatch ? statusMatch[1] : null;

    if (/No .*API key provided/i.test(msg)) return 'No API key entered yet — try again and paste one when prompted.';
    if (/Nothing to send|Nothing to analyze/i.test(msg)) return 'Nothing to work with yet — scan the page, capture the screen, or type something first.';
    if (status === '401' || /invalid.*key|unauthorized|API key not valid/i.test(msg)) {
      return `${label} rejected your API key. Double-check it (or clear and re-enter it) in the Theme tab.`;
    }
    if (status === '429' || /quota|credit|rate.?limit/i.test(msg)) {
      return `${label} says you're out of credits or hitting a rate limit. Check your billing/usage there, or switch providers in the Theme tab.`;
    }
    if (status === '404' || /model.*(not found|no longer available)/i.test(msg)) {
      return `${label}'s model name may have changed on their end and needs updating in the script.`;
    }
    if (/network|failed to fetch/i.test(msg)) {
      return `Couldn't reach ${label} — check your connection and try again.`;
    }
    return `Something went wrong talking to ${label}${status ? ` (error ${status})` : ''}. Try again in a moment.`;
  }

  function showError(el, err, label) {
    // The panel shows a friendly sentence; the full raw error lands in the
    // DevTools console so the real cause is never hidden behind it.
    console.error('[Agent Console] raw error from', label, ':', err);
    el.innerHTML = `<div class="gpa-error"><span class="gpa-error-icon">⚠</span><span>${explainError(err, label)}</span></div>`;
  }

  function currentProviderLabel() {
    return (localStorage.getItem(PROVIDER_KEY) || 'gemini') === 'openai' ? 'OpenAI' : 'Gemini';
  }

  // ---- Typewriter effect for AI responses ---------------------------------
  // Reveals text a few characters at a time with a blinking cursor. Speed
  // scales with length so long answers don't take forever to finish, and
  // is user-adjustable (Slow/Normal/Fast/Instant) in the Theme tab.
  function typeText(el, fullText, scrollContainer, onDone) {
    const speedSetting = localStorage.getItem(SPEED_KEY) || 'normal';
    if (speedSetting === 'instant') {
      el.classList.remove('gpa-typing');
      el.textContent = fullText;
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      if (onDone) onDone();
      return;
    }
    const delayMs = { slow: 28, normal: 12, fast: 4 }[speedSetting] || 12;
    el.classList.add('gpa-typing');
    el.textContent = '';
    const cursor = document.createElement('span');
    cursor.className = 'gpa-cursor';
    el.appendChild(cursor);
    const total = fullText.length;
    const chunk = Math.max(1, Math.ceil(total / 400));
    let i = 0;
    function step() {
      if (i >= total) {
        cursor.remove();
        el.classList.remove('gpa-typing');
        if (onDone) onDone();
        return;
      }
      cursor.insertAdjacentText('beforebegin', fullText.slice(i, i + chunk));
      i += chunk;
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      setTimeout(step, delayMs);
    }
    step();
  }

  // ---- Structured answer grid (for "answers to questions 1-10" style asks) --
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function confidenceClass(pct) {
    return pct >= 85 ? 'gpa-conf-high' : pct >= 60 ? 'gpa-conf-mid' : 'gpa-conf-low';
  }

  function tryParseAnswerGrid(text) {
    const trimmed = text.trim();
    if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) return null;
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.length && arr.every((it) => it && typeof it === 'object' && 'q' in it && 'a' in it)) {
        return arr;
      }
    } catch (e) { /* not JSON — fall through to plain text */ }
    return null;
  }

  function renderAnswerGrid(el, arr) {
    el.classList.remove('gpa-typing');
    const cells = arr.map((it, idx) => {
      const hasConf = typeof it.c === 'number' && !isNaN(it.c);
      const pct = hasConf ? Math.max(0, Math.min(100, Math.round(it.c))) : null;
      const badge = pct === null ? '' : `<span class="gpa-grid-conf ${confidenceClass(pct)}">${pct}%</span>`;
      return `<div class="gpa-grid-cell" style="animation-delay:${idx * 35}ms">
         <span class="gpa-grid-q">${escapeHtml(it.q)}</span>
         <span class="gpa-grid-a">${escapeHtml(it.a)}</span>
         ${badge}
       </div>`;
    }).join('');
    el.innerHTML = `<div class="gpa-answer-grid">${cells}</div>`;
  }

  // The verification pass re-checks answers/confidence but doesn't carry
  // the "h" (highlight quote) field through — restore it from the original
  // draft by matching question labels, so highlighting still works after
  // verification.
  function mergeHighlightField(verified, draft) {
    const draftByQ = {};
    draft.forEach((d) => { draftByQ[String(d.q)] = d.h; });
    return verified.map((v) => ({ ...v, h: v.h || draftByQ[String(v.q)] }));
  }

  // For a single free-text answer, the model appends a trailing
  // "CONFIDENCE: NN" line — pull it out and show it as a small badge
  // instead of leaving it as literal text in the answer.
  function extractConfidenceLine(text) {
    const match = text.match(/\n?\s*CONFIDENCE:\s*(\d{1,3})\s*%?\s*$/i);
    if (!match) return { text, confidence: null };
    const confidence = Math.max(0, Math.min(100, parseInt(match[1], 10)));
    return { text: text.slice(0, match.index).trim(), confidence };
  }

  function appendConfidenceBadge(container, confidence) {
    if (confidence === null || typeof confidence !== 'number' || isNaN(confidence)) return;
    const badge = document.createElement('div');
    badge.className = 'gpa-confidence-line';
    badge.innerHTML = `<span class="gpa-grid-conf ${confidenceClass(confidence)}">${confidence}% confident this is correct</span>`;
    container.appendChild(badge);
  }

  // Generic "strip a LABEL: value trailing line" extractor, used for both
  // CONFIDENCE and HIGHLIGHT metadata lines the AI appends after its answer.
  function extractTrailingLine(text, label) {
    const re = new RegExp(`\\n?\\s*${label}:\\s*(.+?)\\s*$`, 'i');
    const m = text.match(re);
    if (!m) return { text, value: null };
    return { text: text.slice(0, m.index).trim(), value: m[1].trim() };
  }

  // ---- On-page highlighting -------------------------------------------------
  // Finds a verbatim snippet of page text (as quoted back by the AI) in the
  // LIVE page DOM and wraps it in a colored highlight span. The highlight
  // color is chosen per-element by checking what's actually behind that
  // spot on the page, so it stays visible on both light and dark sections
  // of the same page rather than using one fixed color everywhere.
  let injectedHighlights = [];

  function clearPageHighlights() {
    injectedHighlights.forEach((span) => {
      if (span && span.parentNode) {
        const text = document.createTextNode(span.textContent);
        span.parentNode.replaceChild(text, span);
      }
    });
    injectedHighlights = [];
    const clearBtn = panel.querySelector('#gpa-clear-highlights');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  function parseRgbString(str) {
    const m = str && str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  }

  function relativeLuminance({ r, g, b }) {
    const conv = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * conv(r) + 0.7152 * conv(g) + 0.0722 * conv(b);
  }

  function getEffectiveBackground(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parseRgbString(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.05) return bg;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function pickHighlightStyle(bgRgb) {
    // Dark backgrounds get a bright neon highlight; light backgrounds get a
    // bold saturated one — both chosen to stay visible either way, and to
    // still look intentional against the page's own color, not just
    // maximum-contrast ugly.
    const lum = relativeLuminance(bgRgb);
    return lum < 0.45
      ? { bg: 'rgba(230, 255, 60, 0.55)', glow: 'rgba(230, 255, 60, 0.9)' }
      : { bg: 'rgba(255, 87, 34, 0.45)', glow: 'rgba(255, 87, 34, 0.85)' };
  }

  function normalizeForMatch(s) {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Highlights the first occurrence of `snippet` found on the page. Returns
  // true if something was found and highlighted.
  function highlightSnippetOnPage(snippet) {
    if (!snippet || snippet.length < 3) return false;
    const target = normalizeForMatch(snippet);
    if (!target) return false;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parentTag = node.parentElement && node.parentElement.tagName;
        if (!parentTag || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parentTag)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest('#gpa-root-host')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      const nodeText = node.nodeValue;
      const normalized = normalizeForMatch(nodeText);
      const idx = normalized.indexOf(target);
      if (idx === -1) continue;

      // Map the normalized-string index back to the original string as
      // closely as practical (whitespace collapsing can shift offsets
      // slightly) — good enough for highlighting purposes here.
      let start = idx, end = idx + target.length;
      if (start > nodeText.length) start = 0;
      if (end > nodeText.length) end = nodeText.length;

      const range = document.createRange();
      try {
        range.setStart(node, Math.min(start, nodeText.length));
        range.setEnd(node, Math.min(end, nodeText.length));
      } catch (e) { continue; }

      const span = document.createElement('span');
      span.className = 'gpa-page-highlight';
      const bg = getEffectiveBackground(node.parentElement);
      const style = pickHighlightStyle(bg);
      span.style.setProperty('--gpa-hl-bg', style.bg);
      span.style.setProperty('--gpa-hl-glow', style.glow);
      try {
        range.surroundContents(span);
      } catch (e) { continue; }

      injectedHighlights.push(span);
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const clearBtn = panel.querySelector('#gpa-clear-highlights');
      if (clearBtn) clearBtn.style.display = 'inline-block';
      return true;
    }
    return false;
  }

  function highlightSnippetsOnPage(snippets) {
    if (!snippets) return;
    const list = Array.isArray(snippets) ? snippets : [snippets];
    list.forEach((s) => { if (typeof s === 'string') highlightSnippetOnPage(s); });
  }

  function saveInsight(text) {
    const saved = JSON.parse(localStorage.getItem('gpa_saved_insights') || '[]');
    saved.push({
      text,
      url: window.location.href,
      title: document.title,
      date: new Date().toLocaleString()
    });
    localStorage.setItem('gpa_saved_insights', JSON.stringify(saved));
    alert('Insight saved to your profile!');
  }

  function renderSavedInsights() {
    const listEl = panel.querySelector('#gpa-saved-list');
    if (!listEl) return;
    const saved = JSON.parse(localStorage.getItem('gpa_saved_insights') || '[]');
    listEl.innerHTML = saved.length ? '' : '<div class="gpa-sub">No saved insights yet.</div>';
    saved.reverse().forEach((it) => {
      const div = document.createElement('div');
      div.className = 'gpa-msg ai';
      div.style.marginBottom = '8px';
      div.innerHTML = `
        <div class="gpa-sub" style="font-weight:700; margin-bottom:4px;">${escapeHtml(it.title)}</div>
        <div style="font-size:11px; margin-bottom:6px;">${escapeHtml(it.text)}</div>
        <div class="gpa-row" style="justify-content:space-between; font-size:9px; opacity:0.7;">
          <span>${it.date}</span>
          <a href="${it.url}" target="_blank" style="color:${THEMES[theme].accent}; text-decoration:none;">Visit Page</a>
        </div>
      `;
      listEl.appendChild(div);
    });
  }

  async function autoFillForm() {
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));
    if (!inputs.length) { alert('No form fields found on this page.'); return; }

    const fieldInfo = inputs.map((el, i) => {
      const label = el.closest('label')?.textContent || el.getAttribute('aria-label') || el.placeholder || el.name || `Field ${i+1}`;
      return { id: i, label: label.trim(), type: el.type || 'text' };
    });

    scanOutput.textContent = 'AI is analyzing form fields...';
    try {
      const sys = 'You are a form-filling assistant. Based on the provided page content and the list of form fields, generate realistic but mock values for each field. Return ONLY a JSON array of objects: [{"id":0, "v":"Value"}, ...]. If a field is obviously not needed or can\'t be filled, omit it from the array.';
      const userText = `PAGE TEXT:\n${pageText}\n\nFIELDS TO FILL:\n${JSON.stringify(fieldInfo)}`;
      const out = await callAI(userText, sys);
      const mapping = JSON.parse(out);

      // Show what the AI intends to fill before touching the form — fill
      // only on confirm. Mock values only; nothing is submitted.
      const preview = mapping.map((item) => {
        const el = inputs[item.id];
        const field = el ? (el.name || el.placeholder || item.id) : item.id;
        return `  ${field} → ${item.v}`;
      }).join('\n');
      if (!confirm(`The AI suggests filling ${mapping.length} field(s):\n\n${preview.slice(0, 900)}\n\nFill them in?\n(Nothing is submitted — you can still edit or clear everything.)`)) {
        scanOutput.textContent = 'Cancelled — no fields were filled.';
        return;
      }

      mapping.forEach((item) => {
        const el = inputs[item.id];
        if (el) {
          if (el.tagName === 'SELECT') {
            const opt = Array.from(el.options).find(o => o.text.toLowerCase().includes(item.v.toLowerCase()));
            if (opt) el.value = opt.value;
          } else {
            el.value = item.v;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      scanOutput.textContent = 'Form fields filled with suggested values!';
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    }
  }

  function addSaveButton(container, text) {
    const btn = document.createElement('button');
    btn.className = 'gpa-btn';
    btn.style.marginTop = '8px';
    btn.textContent = '💾 Save Insight';
    btn.addEventListener('click', () => saveInsight(text));
    container.appendChild(btn);
  }

  function extractPageText() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,svg,canvas,iframe').forEach((el) => el.remove());
    let text = clone.innerText || clone.textContent || '';
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > MAX_PAGE_CHARS) text = text.slice(0, MAX_PAGE_CHARS) + '\n\n[...truncated...]';
    return text;
  }

  // Reads answer choices the AI can't see from plain page text: closed
  // <select> dropdowns (only the currently-picked option renders as text)
  // and radio/checkbox groups (their option labels aren't always adjacent
  // to visible question text in a way innerText captures cleanly).
  function extractQuizChoices() {
    const lines = [];
    document.querySelectorAll('select').forEach((sel, idx) => {
      const opts = Array.from(sel.options).map((o) => o.text.trim()).filter(Boolean);
      if (opts.length) {
        const hint = sel.getAttribute('aria-label') || sel.name || sel.id || `dropdown ${idx + 1}`;
        lines.push(`Dropdown "${hint}" choices: ${opts.join(' | ')}`);
      }
    });
    function labelFor(input) {
      if (input.id) {
        try {
          const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
          if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
        } catch (e) { /* invalid id for CSS.escape — ignore */ }
      }
      const wrapLabel = input.closest('label');
      if (wrapLabel && wrapLabel.textContent.trim()) return wrapLabel.textContent.trim();
      return input.value || '';
    }
    const groups = {};
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input) => {
      const key = `${input.type}:${input.name || 'unnamed'}`;
      const text = labelFor(input);
      if (text) (groups[key] = groups[key] || []).push(text);
    });
    Object.entries(groups).forEach(([key, opts]) => {
      if (opts.length > 1) lines.push(`Multiple-choice options for "${key.split(':')[1]}": ${opts.join(' | ')}`);
    });
    return lines.join('\n');
  }

  // Opens the browser's native screen/window/tab picker, grabs ONE frame,
  // then immediately stops sharing. Requires a genuine user click and https.
  async function captureScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Screen capture is not supported in this context (needs https).');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'never' },
      audio: false
    });
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const vw = video.videoWidth, vh = video.videoHeight;
      const scale = Math.min(1, MAX_IMAGE_WIDTH / vw);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

      return canvas.toDataURL('image/png');
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  // ---- Upload / paste an image (for the AI to read text from or analyze) --
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function downscaleDataUrl(dataUrl, maxWidth) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = dataUrl;
    });
  }

  // ---- Scan & Analyze tab ------------------------------------------------
  let pageText = '';
  let screenshotDataUrl = '';

  const scanBtn = panel.querySelector('#gpa-scan-btn');
  const captureBtn = panel.querySelector('#gpa-capture-btn');
  const statusRow = panel.querySelector('#gpa-status-row');
  const scanStatus = panel.querySelector('#gpa-scan-status');
  const thumb = panel.querySelector('#gpa-thumb');
  const clearBtn = panel.querySelector('#gpa-clear-context');
  const scanActions = panel.querySelector('#gpa-scan-actions');
  const questionRow = panel.querySelector('#gpa-question-row');
  const scanOutput = panel.querySelector('#gpa-scan-output');

  function refreshStatus() {
    const parts = [];
    if (pageText) parts.push(`${pageText.length.toLocaleString()} chars of page text`);
    if (screenshotDataUrl) parts.push('screenshot captured');
    const has = parts.length > 0;
    statusRow.style.display = has ? 'flex' : 'none';
    scanActions.style.display = has ? 'flex' : 'none';
    questionRow.style.display = has ? 'flex' : 'none';
    scanStatus.textContent = has ? parts.join(' + ') : '';
    thumb.classList.toggle('show', !!screenshotDataUrl);
    thumb.src = screenshotDataUrl || '';
  }

  // ---- Quiz solver: reads page text + dropdown/radio/checkbox choices,
  // returns one answer per question (including multi-part like "2a"/"2b")
  // as the same structured grid used for plain answer-key questions.
  const quizBtn = panel.querySelector('#gpa-quiz-btn');
  quizBtn.addEventListener('click', async () => {
    if (!pageText) pageText = extractPageText();
    refreshStatus();
    const choices = extractQuizChoices();
    const combinedText = choices
      ? `${pageText}\n\nFORM CONTROLS ON THIS PAGE (dropdowns / multiple-choice / checkboxes):\n${choices}`
      : pageText;

    const prevLabel = quizBtn.textContent;
    quizBtn.textContent = 'Solving…';
    quizBtn.disabled = true;
    scanOutput.innerHTML = '';
    scanOutput.textContent = 'Reading the page…';
    try {
      const sys = 'You are analyzing a quiz, exam, or worksheet on this web page, including any dropdown menus and multiple-choice/checkbox options listed under FORM CONTROLS ON THIS PAGE. Identify every question — including multi-part questions like "2a"/"2b" — and give the single best correct answer for each, using the dropdown/multiple-choice options where relevant. Respond with ONLY a JSON array in this exact shape and nothing else: [{"q":"1","a":"B","c":85,"h":"exact verbatim phrase from PAGE TEXT for this question"}] — "q" is the question number/label as a string (use sub-labels for multi-part questions), "a" is the short correct answer, "c" is your confidence (0-100), "h" is a short exact quote (copied verbatim from PAGE TEXT, not paraphrased) that pinpoints where that question appears — so it can be found and highlighted on the page. If you genuinely cannot determine an answer for an item, use "a":"Unclear" and a low "c". Do not include any text outside the JSON array.';
      const out = await callAI(combinedText, sys, screenshotDataUrl ? [screenshotDataUrl] : null);
      const grid = tryParseAnswerGrid(out);
      if (grid) {
        quizBtn.textContent = 'Double-checking…';
        const verified = mergeHighlightField(
          await verifyGridAnswers(combinedText, grid, screenshotDataUrl ? [screenshotDataUrl] : null),
          grid
        );
        renderAnswerGrid(scanOutput, verified);
        highlightSnippetsOnPage(verified.map((it) => it.h).filter(Boolean));
      } else {
        typeText(scanOutput, out, scanOutput);
      }
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    } finally {
      quizBtn.textContent = prevLabel;
      quizBtn.disabled = false;
    }
  });

  scanBtn.addEventListener('click', () => {
    pageText = extractPageText();
    scanOutput.textContent = '';
    refreshStatus();
  });

  captureBtn.addEventListener('click', async () => {
    const prevLabel = captureBtn.textContent;
    captureBtn.textContent = 'Choose a tab/window…';
    captureBtn.disabled = true;
    try {
      screenshotDataUrl = await captureScreen();
      scanOutput.textContent = '';
      refreshStatus();
    } catch (e) {
      scanOutput.textContent = 'Screen capture cancelled or failed: ' + e.message;
    } finally {
      captureBtn.textContent = prevLabel;
      captureBtn.disabled = false;
    }
  });

  // Upload an image file directly.
  const imageUploadInput = panel.querySelector('#gpa-image-upload');
  const uploadBtn = panel.querySelector('#gpa-upload-btn');
  uploadBtn.addEventListener('click', () => imageUploadInput.click());
  imageUploadInput.addEventListener('change', async () => {
    const file = imageUploadInput.files && imageUploadInput.files[0];
    imageUploadInput.value = '';
    if (!file) return;
    try {
      const raw = await blobToDataUrl(file);
      screenshotDataUrl = await downscaleDataUrl(raw, MAX_IMAGE_WIDTH);
      scanOutput.textContent = '';
      refreshStatus();
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    }
  });

  // Paste an image (Ctrl+V) anywhere in the panel — e.g. a screenshot
  // copied from another app or the OS's own screenshot tool.
  root.addEventListener('paste', async (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        e.preventDefault();
        try {
          const raw = await blobToDataUrl(blob);
          screenshotDataUrl = await downscaleDataUrl(raw, MAX_IMAGE_WIDTH);
          scanOutput.textContent = '';
          refreshStatus();
        } catch (err) {
          showError(scanOutput, err, currentProviderLabel());
        }
        break;
      }
    }
  });

  clearBtn.addEventListener('click', () => {
    pageText = '';
    screenshotDataUrl = '';
    scanOutput.textContent = '';
    clearPageHighlights();
    refreshStatus();
  });

  panel.querySelector('#gpa-clear-highlights').addEventListener('click', clearPageHighlights);

  panel.querySelectorAll('#gpa-scan-actions .gpa-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!pageText && !screenshotDataUrl) { scanOutput.textContent = 'Scan the page or capture the screen first.'; return; }
      const action = btn.dataset.action;
      if (action === 'autofill') { autoFillForm(); return; }
      const highlightNote = ' Then, on its own final line, write "HIGHLIGHTS: " followed by a JSON array of 2-5 short exact verbatim quotes (a few words each, copied exactly from PAGE TEXT — not paraphrased) marking the most important clues/info, e.g. HIGHLIGHTS: ["exact phrase one", "exact phrase two"]. If nothing stands out or there is no page text, use an empty array.';
      const sys = (action === 'summarize'
        ? 'Summarize the provided content in plain, everyday sentences — the shortest version that still covers the essentials. No markdown formatting (no asterisks, headers, or numbered/bulleted lists) since this is shown as plain text. If both page text and a screenshot are provided, use both together. Then, on its own line, write exactly "CONFIDENCE: NN" where NN (0-100) is how confident you are that this summary faithfully and accurately represents the source content.'
        : 'Give a brief, plain-language read on the provided content: what it\'s about, the main point, and anything notable — a few sentences, not a breakdown. No markdown formatting (no asterisks, headers, or numbered/bulleted lists) since this is shown as plain text. If both page text and a screenshot are provided, use both together. Then, on its own line, write exactly "CONFIDENCE: NN" where NN (0-100) is how confident you are that this analysis is accurate.'
      ) + highlightNote;
      scanOutput.textContent = 'Thinking…';
      try {
        const textPart = pageText ? `PAGE TEXT:\n${pageText}` : '(no page text captured — use the screenshot)';
        const out = await callAI(textPart, sys, screenshotDataUrl ? [screenshotDataUrl] : null);
        const { text: t1, value: highlightsRaw } = extractTrailingLine(out, 'HIGHLIGHTS');
        const { text: cleanText, confidence } = extractConfidenceLine(t1);
        typeText(scanOutput, cleanText, scanOutput, () => {
          appendConfidenceBadge(scanOutput, confidence);
          addSaveButton(scanOutput, cleanText);
          if (highlightsRaw) {
            try {
              const snippets = JSON.parse(highlightsRaw);
              highlightSnippetsOnPage(snippets);
            } catch (e) { /* model didn't return valid JSON — skip highlighting silently */ }
          }
        });
      } catch (e) {
        showError(scanOutput, e, currentProviderLabel());
      }
    });
  });

  panel.querySelector('#gpa-question-btn').addEventListener('click', askPageQuestion);
  panel.querySelector('#gpa-question').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') askPageQuestion();
  });

  async function askPageQuestion() {
    const input = panel.querySelector('#gpa-question');
    const q = input.value.trim();
    if (!q) return;
    if (!pageText && !screenshotDataUrl) { scanOutput.textContent = 'Scan the page or capture the screen first.'; return; }
    scanOutput.textContent = 'Thinking…';
    try {
      const sys = 'You are the AI inside the user\'s "Agent Console" panel, answering about the web page they are viewing. ' + CAPABILITIES_BRIEF + ' Answer the question using ONLY the provided context (page text and/or screenshot). Before finalizing, double-check your answer against the context. If — and only if — the question is asking for answers to multiple numbered items (like a quiz, worksheet, or multiple-choice list), respond with ONLY a JSON array and nothing else, in exactly this shape: [{"q":"1","a":"B","c":90,"h":"exact verbatim phrase from PAGE TEXT near this question"}] — "q" is the item number/label as a string, "a" is the short answer, "c" is your confidence (0-100), "h" is a short exact quote (copied verbatim from PAGE TEXT, not paraphrased) that pinpoints where that question/answer appears, one object per item, no extra commentary. For any other kind of question, answer in brief plain sentences with no markdown formatting (no asterisks, headers, or lists), then two more lines: first exactly "CONFIDENCE: NN" (0-100, your confidence the answer is correct), then exactly "HIGHLIGHT: " followed by a short exact verbatim quote from PAGE TEXT that contains or supports the answer (empty if none applies). If the answer is not in the content, say so in one short sentence and use a low confidence number.';
      const textPart = `${pageText ? `PAGE TEXT:\n${pageText}\n\n` : ''}QUESTION:\n${q}`;
      const images = screenshotDataUrl ? [screenshotDataUrl] : null;
      const out = await callAI(textPart, sys, images);
      const grid = tryParseAnswerGrid(out);
      if (grid) {
        const verified = mergeHighlightField(await verifyGridAnswers(textPart, grid, images), grid);
        renderAnswerGrid(scanOutput, verified);
        highlightSnippetsOnPage(verified.map((it) => it.h).filter(Boolean));
      } else {
        const { text: t1, value: highlightSnippet } = extractTrailingLine(out, 'HIGHLIGHT');
        const { text: cleanText, confidence } = extractConfidenceLine(t1);
        typeText(scanOutput, cleanText, scanOutput, () => {
          appendConfidenceBadge(scanOutput, confidence);
          addSaveButton(scanOutput, cleanText);
          if (highlightSnippet) highlightSnippetOnPage(highlightSnippet);
        });
      }
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    }
  }

  function getYoutubeApiKey() {
    let key = localStorage.getItem(YT_STORAGE_KEY);
    if (!key) {
      key = prompt('Paste a YouTube Data API v3 key (free, from console.cloud.google.com — enable "YouTube Data API v3" then create an API key):');
      if (key) localStorage.setItem(YT_STORAGE_KEY, key.trim());
    }
    return key ? key.trim() : null;
  }

  async function searchYoutube(query) {
    const key = getYoutubeApiKey();
    if (!key) throw new Error('No YouTube API key provided.');
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=1&q=${encodeURIComponent(query)}&key=${key}`;
    const res = await rawFetch(url);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`YouTube API error (${res.status}): ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const item = data.items && data.items[0];
    if (!item) throw new Error('No matching song found.');
    return { id: item.id.videoId, title: item.snippet.title, channel: item.snippet.channelTitle };
  }

  // ---- SoundCloud tab (official embeddable player, no proxy) ------------
  const scInput = panel.querySelector('#gpa-sc-url');
  const scLoadBtn = panel.querySelector('#gpa-sc-load');
  const scWrap = panel.querySelector('#gpa-sc-wrap');

  function loadSoundCloud() {
    const url = scInput.value.trim();
    if (!/^https?:\/\/(www\.)?(soundcloud\.com|on\.soundcloud\.com)\//i.test(url)) {
      scWrap.textContent = 'Paste a valid soundcloud.com track or playlist link.';
      return;
    }
    const accentHex = THEMES[theme].accent.replace('#', '');
    const embedSrc = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23${accentHex}&auto_play=false&show_user=true&show_reposts=false&visual=false`;
    scWrap.innerHTML = `<iframe class="gpa-sc-frame" scrolling="no" frameborder="no" allow="autoplay" src="${embedSrc}"></iframe>`;
  }
  scLoadBtn.addEventListener('click', loadSoundCloud);
  scInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSoundCloud(); });

  // ---- Music search & play (YouTube Data API + official embed player) ----
  const musicQuery = panel.querySelector('#gpa-music-query');
  const musicSearchBtn = panel.querySelector('#gpa-music-search');
  const musicStatus = panel.querySelector('#gpa-music-status');
  const musicWrap = panel.querySelector('#gpa-music-wrap');

  async function playMusicSearch() {
    const q = musicQuery.value.trim();
    if (!q) return;
    musicStatus.textContent = 'Searching…';
    musicWrap.innerHTML = '';
    musicSearchBtn.disabled = true;
    try {
      const match = await searchYoutube(q);
      musicStatus.textContent = `Playing closest match: "${match.title}" — ${match.channel}`;
      musicWrap.innerHTML = `<iframe class="gpa-sc-frame" allow="autoplay; encrypted-media" src="https://www.youtube.com/embed/${match.id}?autoplay=1"></iframe>`;
    } catch (e) {
      showError(musicStatus, e, 'YouTube');
    } finally {
      musicSearchBtn.disabled = false;
    }
  }
  musicSearchBtn.addEventListener('click', playMusicSearch);
  musicQuery.addEventListener('keydown', (e) => { if (e.key === 'Enter') playMusicSearch(); });

  // ---- Local file player (fully offline — no network, no website involved) --
  // Files are read straight from disk via the browser's File API and played
  // through a normal <audio> element using a blob: URL. Once a file is
  // loaded, playback needs no internet connection at all. The playlist is
  // for this browsing session only — it can't be saved to disk from here,
  // so it resets if you reload the page or reopen the panel later.
  const localAddBtn = panel.querySelector('#gpa-local-add-btn');
  const localFileInput = panel.querySelector('#gpa-local-file-input');
  const localPlaylistEl = panel.querySelector('#gpa-local-playlist');
  const localPlayerEl = panel.querySelector('#gpa-local-player');
  const localNowPlaying = panel.querySelector('#gpa-local-nowplaying');
  const localSeek = panel.querySelector('#gpa-local-seek');
  const localTimeEl = panel.querySelector('#gpa-local-time');
  const localPlayPauseBtn = panel.querySelector('#gpa-local-playpause');
  const localPrevBtn = panel.querySelector('#gpa-local-prev');
  const localNextBtn = panel.querySelector('#gpa-local-next');
  const localVolume = panel.querySelector('#gpa-local-volume');

  let localPlaylist = PRELOADED_TRACKS.map((t) => ({ name: t.name, url: t.url }));
  let localCurrentIndex = -1;
  const localAudio = new Audio();
  localAudio.volume = 0.8;
  renderLocalPlaylist(); // show the preloaded list immediately; nothing auto-plays (browsers block that without a click anyway)

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function renderLocalPlaylist() {
    localPlaylistEl.innerHTML = '';
    localPlaylist.forEach((track, i) => {
      const row = document.createElement('div');
      row.className = 'gpa-local-track' + (i === localCurrentIndex ? ' playing' : '');
      const name = document.createElement('span');
      name.className = 'gpa-local-track-name';
      name.textContent = track.name;
      const remove = document.createElement('span');
      remove.className = 'gpa-local-track-remove';
      remove.textContent = '✕';
      remove.title = 'Remove';
      remove.addEventListener('click', (e) => { e.stopPropagation(); removeLocalTrack(i); });
      row.appendChild(name);
      row.appendChild(remove);
      row.addEventListener('click', () => playLocalTrack(i));
      localPlaylistEl.appendChild(row);
    });
  }

  function playLocalTrack(i) {
    if (i < 0 || i >= localPlaylist.length) return;
    localCurrentIndex = i;
    localAudio.src = localPlaylist[i].url;
    localAudio.play();
    localPlayerEl.style.display = 'block';
    localNowPlaying.textContent = localPlaylist[i].name;
    renderLocalPlaylist();
  }

  function removeLocalTrack(i) {
    const wasPlaying = i === localCurrentIndex;
    URL.revokeObjectURL(localPlaylist[i].url);
    localPlaylist.splice(i, 1);
    if (wasPlaying) {
      localAudio.pause();
      localAudio.removeAttribute('src');
      localCurrentIndex = -1;
      localPlayerEl.style.display = 'none';
    } else if (i < localCurrentIndex) {
      localCurrentIndex--;
    }
    renderLocalPlaylist();
  }

  localAddBtn.addEventListener('click', () => localFileInput.click());
  localFileInput.addEventListener('change', () => {
    const files = Array.from(localFileInput.files || []);
    files.forEach((file) => localPlaylist.push({ name: file.name, url: URL.createObjectURL(file) }));
    localFileInput.value = '';
    renderLocalPlaylist();
    if (localCurrentIndex === -1 && localPlaylist.length) playLocalTrack(0);
  });

  localPlayPauseBtn.addEventListener('click', () => {
    if (localCurrentIndex === -1) return;
    if (localAudio.paused) localAudio.play(); else localAudio.pause();
  });
  localPrevBtn.addEventListener('click', () => {
    if (!localPlaylist.length) return;
    playLocalTrack((localCurrentIndex - 1 + localPlaylist.length) % localPlaylist.length);
  });
  localNextBtn.addEventListener('click', () => {
    if (!localPlaylist.length) return;
    playLocalTrack((localCurrentIndex + 1) % localPlaylist.length);
  });
  localAudio.addEventListener('ended', () => {
    if (localPlaylist.length) playLocalTrack((localCurrentIndex + 1) % localPlaylist.length);
  });
  localAudio.addEventListener('play', () => { localPlayPauseBtn.textContent = '⏸'; });
  localAudio.addEventListener('pause', () => { localPlayPauseBtn.textContent = '▶'; });
  localAudio.addEventListener('timeupdate', () => {
    if (localAudio.duration) localSeek.value = String((localAudio.currentTime / localAudio.duration) * 100);
    localTimeEl.textContent = `${formatTime(localAudio.currentTime)} / ${formatTime(localAudio.duration)}`;
  });
  localSeek.addEventListener('input', () => {
    if (localAudio.duration) localAudio.currentTime = (parseFloat(localSeek.value) / 100) * localAudio.duration;
  });
  localVolume.addEventListener('input', () => { localAudio.volume = parseFloat(localVolume.value) / 100; });

  // ---- Browser tab (plain iframe — only loads sites that allow embedding) --
  const browserUrlInput = panel.querySelector('#gpa-browser-url');
  const browserGoBtn = panel.querySelector('#gpa-browser-go');
  const browserFrame = panel.querySelector('#gpa-browser-frame');

  function loadBrowserUrl() {
    let url = browserUrlInput.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    browserFrame.src = url;
  }
  browserGoBtn.addEventListener('click', loadBrowserUrl);
  browserUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBrowserUrl(); });

  // ---- Ask AI tab (general chat) -----------------------------------------
  const chatEl = panel.querySelector('#gpa-chat');
  const askInput = panel.querySelector('#gpa-ask-input');
  const askBtn = panel.querySelector('#gpa-ask-btn');

  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'gpa-msg ' + role;
    div.textContent = text;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  async function sendChat() {
    const q = askInput.value.trim();
    if (!q) return;
    addMsg('user', q);
    askInput.value = '';
    const thinking = document.createElement('div');
    thinking.className = 'gpa-msg ai';
    thinking.textContent = 'Thinking…';
    chatEl.appendChild(thinking);
    chatEl.scrollTop = chatEl.scrollHeight;
    try {
      const sys = 'You are a helpful, concise assistant. ' + CAPABILITIES_BRIEF + ' Reply in plain conversational sentences only — no markdown formatting (no asterisks, headers, or lists) since this is shown as plain text. Keep answers as short as possible while still being useful. Then, on its own final line, write exactly "CONFIDENCE: NN" where NN (0-100) is your confidence that the answer is accurate.';
      const out = await callAI(q, sys);
      const { text: cleanText, confidence } = extractConfidenceLine(out);
      typeText(thinking, cleanText, chatEl, () => { appendConfidenceBadge(thinking, confidence); speak(cleanText); });
    } catch (e) {
      showError(thinking, e, currentProviderLabel());
    }
  }
  askBtn.addEventListener('click', sendChat);
  askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  // ---- Extended tools -------------------------------------------------------
  // Voice input, read-aloud, text-selection assistant, table extractor, page
  // watcher, natural-language page commands, flashcards, scratchpad, pomodoro
  // and research mode. All persistent state uses gpa_* localStorage keys, so
  // profiles and cloud sync pick them up automatically (collectState grabs
  // every gpa_* key).

  const TTS_KEY = 'gpa_tts_enabled';
  const SCRATCH_KEY = 'gpa_scratchpad';
  const FC_KEY = 'gpa_flashcards';

  function stripConfidence(text) {
    return String(text || '').replace(/\n?\s*CONFIDENCE:\s*\d{1,3}\s*%?\s*$/i, '').trim();
  }

  // Read-aloud (browser speech synthesis — free, local, no key needed).
  function speak(text) {
    if (localStorage.getItem(TTS_KEY) !== 'on' || !('speechSynthesis' in window) || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 4000));
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch (e) { /* speech is a nice-to-have — never let it break a reply */ }
  }

  const ttsBtn = panel.querySelector('#gpa-tts-toggle');
  function renderTtsBtn() {
    const on = localStorage.getItem(TTS_KEY) === 'on';
    ttsBtn.textContent = on ? '🔊 Read answers aloud: ON' : '🔇 Read answers aloud: OFF';
    ttsBtn.classList.toggle('primary', on);
  }
  ttsBtn.addEventListener('click', () => {
    const on = localStorage.getItem(TTS_KEY) !== 'on';
    localStorage.setItem(TTS_KEY, on ? 'on' : 'off');
    if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
    renderTtsBtn();
  });
  renderTtsBtn();

  // Voice input for Ask AI (browser speech recognition).
  (function voiceInput() {
    const voiceBtn = panel.querySelector('#gpa-voice-btn');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      voiceBtn.title = 'Speech recognition not supported in this browser';
      voiceBtn.disabled = true;
      return;
    }
    let rec = null, listening = false;
    voiceBtn.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      rec = new SR();
      rec.lang = 'en-US';
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        askInput.value = e.results[0][0].transcript;
        sendChat();
      };
      const done = () => { listening = false; voiceBtn.classList.remove('primary'); voiceBtn.textContent = '🎙'; };
      rec.onend = done;
      rec.onerror = done;
      listening = true;
      voiceBtn.classList.add('primary');
      voiceBtn.textContent = '🔴';
      rec.start();
    });
  })();

  // Text-selection assistant: select any text on the page → floating bubble
  // with Explain / Simplify / Translate / Define / clean-copy / save.
  (function selectionAssistant() {
    const ACTIONS = [
      ['Explain', 'Explain the selected text clearly and concisely.'],
      ['Simplify', 'Rewrite the selected text in much simpler words anyone can understand. Keep it short.'],
      ['Translate', 'Translate the selected text to English. If it is already in English, translate it to Spanish.'],
      ['Define', 'Define the key terms, jargon, or names in the selected text — one per line, term first.'],
      ['📋 Clean', null],
      ['💾', 'save']
    ];
    let bubble = null, pop = null;

    function removeBubble() { if (bubble) { bubble.remove(); bubble = null; } }
    function removePop() { if (pop) { pop.remove(); pop = null; } }

    function showPop(x, y, selectedText, sys) {
      removePop();
      pop = document.createElement('div');
      pop.className = 'gpa-sel-pop';
      pop.textContent = 'Thinking…';
      pop.style.left = Math.max(8, Math.min(x, window.innerWidth - 356)) + 'px';
      pop.style.top = Math.max(8, Math.min(y + 14, window.innerHeight - 280)) + 'px';
      document.body.appendChild(pop);
      callAI(`Selected text:\n"""\n${selectedText}\n"""`, sys)
        .then((out) => {
          pop.textContent = stripConfidence(out);
          speak(out);
          const src = document.createElement('span');
          src.className = 'gpa-sel-pop-src';
          src.textContent = selectedText.slice(0, 120) + (selectedText.length > 120 ? '…' : '');
          pop.appendChild(src);
        })
        .catch((e) => { pop.textContent = 'AI error: ' + (e && e.message || e); });
      pop.addEventListener('click', removePop);
    }

    document.addEventListener('mouseup', (e) => {
      if (e.target.closest && (e.target.closest('#gpa-root-host') || e.target.closest('.gpa-sel-bubble') || e.target.closest('.gpa-sel-pop'))) return;
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel ? String(sel).trim() : '';
        if (!text || text.length < 2 || !sel.rangeCount || sel.isCollapsed) { removeBubble(); return; }
        removeBubble();
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        bubble = document.createElement('div');
        bubble.className = 'gpa-sel-bubble';
        ACTIONS.forEach(([label, sys]) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (sys === null) {
              navigator.clipboard.writeText(text.replace(/\s+/g, ' ').trim()).then(() => {
                b.textContent = '✓ Copied';
                setTimeout(removeBubble, 600);
              });
            } else if (sys === 'save') {
              saveInsight(text);
              removeBubble();
            } else {
              showPop(rect.left, rect.bottom, text, sys + ' Reply in plain text only — no markdown symbols.');
            }
          });
          bubble.appendChild(b);
        });
        document.body.appendChild(bubble);
        bubble.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - bubble.offsetWidth - 12)) + 'px';
        bubble.style.top = Math.max(8, rect.top - bubble.offsetHeight - 6) + 'px';
      }, 10);
    });
    window.addEventListener('scroll', removeBubble, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { removeBubble(); removePop(); } });
  })();

  // Table extractor: list every table on the page with CSV copy + Ask AI.
  panel.querySelector('#gpa-tables-btn').addEventListener('click', () => {
    const tables = Array.from(document.querySelectorAll('table')).filter((t) => t.rows.length > 1);
    if (!tables.length) { scanOutput.textContent = 'No tables found on this page.'; return; }
    scanOutput.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'gpa-sub';
    head.textContent = `Found ${tables.length} table${tables.length > 1 ? 's' : ''}:`;
    scanOutput.appendChild(head);
    tables.slice(0, 10).forEach((tb, i) => {
      const rows = Array.from(tb.rows).map((tr) => Array.from(tr.cells).map((td) => (td.innerText || '').trim().replace(/\s+/g, ' ')));
      if (!rows[0].length) return;
      const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\n');
      const div = document.createElement('div');
      div.className = 'gpa-msg ai';
      const label = document.createElement('div');
      label.textContent = `Table ${i + 1} — ${rows.length} rows × ${rows[0].length} cols`;
      label.style.fontWeight = '700';
      label.style.marginBottom = '4px';
      div.appendChild(label);
      const row = document.createElement('div');
      row.className = 'gpa-row';
      const cp = document.createElement('button');
      cp.className = 'gpa-btn';
      cp.textContent = '📋 Copy CSV';
      cp.addEventListener('click', () => navigator.clipboard.writeText(csv).then(() => {
        cp.textContent = '✓ Copied';
        setTimeout(() => { cp.textContent = '📋 Copy CSV'; }, 900);
      }));
      const ask = document.createElement('button');
      ask.className = 'gpa-btn primary';
      ask.textContent = '🤖 Ask AI about it';
      ask.addEventListener('click', async () => {
        ask.disabled = true;
        ask.textContent = 'Thinking…';
        try {
          const out = await callAI(`Here is a table as CSV:\n${csv.slice(0, 8000)}\n\nSummarize the key takeaways in a few short plain-text lines.`, 'You are a concise data analyst. Plain text only.');
          const res = document.createElement('div');
          res.className = 'gpa-msg ai';
          res.style.marginTop = '6px';
          div.appendChild(res);
          typeText(res, stripConfidence(out), scanOutput, () => addSaveButton(res, stripConfidence(out)));
        } catch (e) {
          showError(div, e, currentProviderLabel());
        }
        ask.disabled = false;
        ask.textContent = '🤖 Ask AI about it';
      });
      row.appendChild(cp);
      row.appendChild(ask);
      div.appendChild(row);
      scanOutput.appendChild(div);
    });
  });

  // Page watcher: poll the page text every 30s and let the AI judge whether
  // the user's condition has been met. In-memory only (a reload ends it) —
  // the condition is remembered so it's one click to re-arm.
  (function pageWatcher() {
    const watch = { timer: null, last: '', cond: '' };
    const watchBtn = panel.querySelector('#gpa-watch-btn');
    const watchRow = panel.querySelector('#gpa-watch-row');
    const watchCond = panel.querySelector('#gpa-watch-cond');
    watchCond.value = localStorage.getItem('gpa_watch_last_cond') || '';

    function setUi(watching) {
      watchBtn.textContent = watching ? '⏹ Stop watching' : '👀 Watch page';
      watchBtn.classList.toggle('primary', watching);
    }
    function stop(msg) {
      if (watch.timer) { clearInterval(watch.timer); watch.timer = null; }
      setUi(false);
      if (msg) scanOutput.textContent = msg;
    }
    watchBtn.addEventListener('click', () => {
      if (watch.timer) { stop('Stopped watching.'); return; }
      watchRow.style.display = watchRow.style.display === 'none' ? 'flex' : 'none';
    });
    panel.querySelector('#gpa-watch-start').addEventListener('click', () => {
      const cond = watchCond.value.trim();
      if (!cond) { scanOutput.textContent = 'Type what you want to watch for first.'; return; }
      watch.cond = cond;
      watch.last = extractPageText();
      localStorage.setItem('gpa_watch_last_cond', cond);
      if (window.Notification && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (e) { /* optional */ }
      }
      scanOutput.textContent = `👀 Watching every 30s for: "${cond}". Keep this tab open — reloading the page ends the watch.`;
      setUi(true);
      watch.timer = setInterval(check, 30000);
    });
    async function check() {
      try {
        const now = extractPageText();
        if (now === watch.last) return;
        watch.last = now;
        const sys = 'You are a page-change monitor. Answer with exactly one line: either "YES: <one short sentence>" or just "NO".';
        const out = await callAI(`The user is watching a page for this condition: "${watch.cond}"\n\nCURRENT PAGE TEXT (truncated):\n${now.slice(0, 9000)}\n\nDoes the page now satisfy the condition?`, sys);
        if (/^YES/i.test(out.trim())) {
          const why = out.replace(/^YES:\s*/i, '').trim();
          stop(`🔔 ${why}`);
          speak('Watch triggered. ' + why);
          try { if (window.Notification && Notification.permission === 'granted') new Notification('Agent Console', { body: why }); } catch (e) { /* optional */ }
        }
      } catch (e) { /* transient errors: keep watching */ }
    }
    setUi(false);
  })();

  // Natural-language page commands: AI maps the request to a concrete action.
  panel.querySelector('#gpa-cmd-btn').addEventListener('click', async () => {
    const cmdInput = panel.querySelector('#gpa-cmd-input');
    const cmd = cmdInput.value.trim();
    if (!cmd) return;
    scanOutput.textContent = '⚡ Working out what to do…';
    try {
      const sys = 'You convert user commands into page actions. Available actions: click (an element whose visible text matches), scroll (scroll to the first element containing the text), highlight (mark the text on the page). Respond ONLY with JSON: {"action":"click|scroll|highlight","target":"exact visible text to find"}. If impossible, respond {"action":"none"}.';
      const out = await callAI(`Command: ${cmd}\n\nPage text (truncated):\n${extractPageText().slice(0, 6000)}`, sys);
      const m = out.match(/\{[\s\S]*\}/);
      const plan = m ? JSON.parse(m[0]) : { action: 'none' };
      if (!plan.action || plan.action === 'none' || !plan.target) {
        scanOutput.textContent = "Couldn't map that to a page action — try naming the exact link or button text.";
        return;
      }
      const target = normalizeForMatch(String(plan.target));
      const candidates = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"],li,td,th,h1,h2,h3,h4,p,span,div,label')).filter((el) => {
        if (el.closest('#gpa-root-host')) return false;
        const t = normalizeForMatch(el.innerText || el.value || '');
        if (!t || !t.includes(target)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!candidates.length) {
        scanOutput.textContent = `Nothing on the page matches "${plan.target}".`;
        return;
      }
      candidates.sort((a, b) => normalizeForMatch(a.innerText || a.value || '').length - normalizeForMatch(b.innerText || b.value || '').length);
      const el = candidates[0];
      if (plan.action === 'click') {
        if (!confirm(`About to click: "${(el.innerText || el.value || '').trim().slice(0, 120)}"\n\nProceed?`)) {
          scanOutput.textContent = 'Cancelled — nothing was clicked.';
          return;
        }
        el.click();
        scanOutput.textContent = `⚡ Clicked: ${(el.innerText || el.value || '').trim().slice(0, 80)}`;
      } else if (plan.action === 'highlight') {
        const ok = highlightSnippetOnPage(String(plan.target));
        scanOutput.textContent = ok ? '⚡ Highlighted on the page.' : `Couldn't find "${plan.target}" to highlight.`;
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('gpa-flash-once');
        setTimeout(() => el.classList.remove('gpa-flash-once'), 4000);
        scanOutput.textContent = `⚡ Scrolled to: ${(el.innerText || el.value || '').trim().slice(0, 80)}`;
      }
      cmdInput.value = '';
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    }
  });

  // Flashcards (Study tab): generate a deck from the page, spaced-ish
  // repetition via a simple 3-box ladder — "knew it" moves a card up, three
  // boxes retires it; "again" sends it back to box 1.
  function renderDeck() {
    const fcStudy = panel.querySelector('#gpa-fc-study');
    const fcStatus = panel.querySelector('#gpa-fc-status');
    if (!fcStudy) return;
    const cards = JSON.parse(localStorage.getItem(FC_KEY) || '[]');
    fcStudy.innerHTML = '';
    if (!cards.length) {
      fcStudy.innerHTML = '<div class="gpa-sub">No deck yet. Find a page with material on it, then press "Make flashcards".</div>';
      return;
    }
    const mastered = cards.filter((c) => c.box >= 3).length;
    const head = document.createElement('div');
    head.className = 'gpa-row';
    head.style.justifyContent = 'space-between';
    const prog = document.createElement('span');
    prog.className = 'gpa-sub';
    prog.textContent = `${mastered}/${cards.length} mastered`;
    const ctrls = document.createElement('div');
    const reset = document.createElement('button');
    reset.className = 'gpa-btn';
    reset.textContent = '🔄 Reset progress';
    reset.addEventListener('click', () => {
      const c = JSON.parse(localStorage.getItem(FC_KEY) || '[]');
      c.forEach((x) => { x.box = 1; });
      localStorage.setItem(FC_KEY, JSON.stringify(c));
      renderDeck();
    });
    const del = document.createElement('button');
    del.className = 'gpa-btn';
    del.textContent = '🗑 Delete deck';
    del.addEventListener('click', () => {
      if (confirm('Delete the whole deck?')) { localStorage.removeItem(FC_KEY); renderDeck(); }
    });
    ctrls.appendChild(reset);
    ctrls.appendChild(del);
    head.appendChild(prog);
    head.appendChild(ctrls);
    fcStudy.appendChild(head);

    const due = cards.map((c, i) => ({ c, i })).filter((x) => x.c.box < 3);
    if (!due.length) {
      const done = document.createElement('div');
      done.className = 'gpa-sub';
      done.style.marginTop = '10px';
      done.textContent = '🎉 Deck mastered! Reset progress to study it again.';
      fcStudy.appendChild(done);
      return;
    }
    const pick = due[Math.floor(Math.random() * due.length)];
    const flip = document.createElement('div');
    flip.className = 'gpa-flip';
    flip.innerHTML = `<div class="gpa-flip-inner"><div class="gpa-flip-face">${escapeHtml(pick.c.q)}</div><div class="gpa-flip-face gpa-flip-back">${escapeHtml(pick.c.a)}</div></div>`;
    flip.addEventListener('click', () => flip.classList.toggle('flipped'));
    fcStudy.appendChild(flip);
    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.style.textAlign = 'center';
    hint.style.marginTop = '4px';
    hint.textContent = 'Tap the card to flip it';
    fcStudy.appendChild(hint);
    const row = document.createElement('div');
    row.className = 'gpa-row';
    row.style.marginTop = '6px';
    const again = document.createElement('button');
    again.className = 'gpa-btn';
    again.textContent = '🔁 Again';
    const know = document.createElement('button');
    know.className = 'gpa-btn primary';
    know.textContent = '✓ Knew it';
    function grade(box) {
      const c = JSON.parse(localStorage.getItem(FC_KEY) || '[]');
      c[pick.i].box = box === 3 ? Math.min(3, (c[pick.i].box || 1) + 1) : 1;
      localStorage.setItem(FC_KEY, JSON.stringify(c));
      renderDeck();
    }
    again.addEventListener('click', () => grade(1));
    know.addEventListener('click', () => grade(3));
    row.appendChild(again);
    row.appendChild(know);
    fcStudy.appendChild(row);
  }

  panel.querySelector('#gpa-fc-gen').addEventListener('click', async () => {
    const fcStatus = panel.querySelector('#gpa-fc-status');
    const fcStudy = panel.querySelector('#gpa-fc-study');
    const text = extractPageText().slice(0, 12000);
    if (text.trim().length < 80) { fcStatus.textContent = 'Not enough page text here to build cards — open a page with real content first.'; return; }
    fcStatus.textContent = '✨ Building your deck…';
    try {
      const sys = 'Create flashcards from the provided material. Return ONLY a JSON array of 8-15 objects: [{"q":"question","a":"short answer"}]. Cover the most important facts and concepts. No text outside the JSON array.';
      const out = await callAI(`MATERIAL:\n${text}`, sys);
      const m = out.match(/\[[\s\S]*\]/);
      const cards = JSON.parse(m[0]).map((c) => ({ q: String(c.q), a: String(c.a), box: 1 }));
      localStorage.setItem(FC_KEY, JSON.stringify(cards));
      fcStatus.textContent = `Deck created with ${cards.length} cards. Tap a card to flip it.`;
      renderDeck();
    } catch (e) {
      fcStatus.textContent = '';
      showError(fcStudy, e, currentProviderLabel());
    }
  });

  // Scratchpad (Saved tab): autosaved textarea + AI tidier.
  (function scratchpad() {
    const scratch = panel.querySelector('#gpa-scratch');
    const tidyBtn = panel.querySelector('#gpa-scratch-tidy');
    scratch.value = localStorage.getItem(SCRATCH_KEY) || '';
    let t = null;
    scratch.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => localStorage.setItem(SCRATCH_KEY, scratch.value), 300);
    });
    tidyBtn.addEventListener('click', async () => {
      const raw = scratch.value.trim();
      if (!raw) return;
      tidyBtn.disabled = true;
      tidyBtn.textContent = 'Tidying…';
      try {
        const out = await callAI(`Here are my raw notes. Rewrite them as a clean, organized plain-text list: group related items under short headings, fix typos, remove repetition. Keep every fact — do not invent new ones.\n\nNOTES:\n${raw.slice(0, 8000)}`, 'You are a tidy note-taker. Plain text only, no markdown symbols.');
        if (confirm('Replace your scratchpad with the tidied version?\n\n(OK = replace · Cancel = keep your notes)')) {
          scratch.value = stripConfidence(out);
          localStorage.setItem(SCRATCH_KEY, scratch.value);
        }
      } catch (e) {
        alert('AI error: ' + (e && e.message || e));
      }
      tidyBtn.disabled = false;
      tidyBtn.textContent = '✨ Tidy notes with AI';
    });
  })();

  // Pomodoro (Saved tab): 25/5 cycles, count persisted to the profile.
  (function pomodoro() {
    let left = 25 * 60, running = null, mode = 'focus';
    let cycles = parseInt(localStorage.getItem('gpa_pomo_cycles') || '0', 10) || 0;
    const timeEl = panel.querySelector('#gpa-pomo-time');
    const startBtn = panel.querySelector('#gpa-pomo-start');
    const countEl = panel.querySelector('#gpa-pomo-count');
    function render() {
      const m = String(Math.floor(left / 60)).padStart(2, '0');
      const s = String(left % 60).padStart(2, '0');
      timeEl.textContent = `${m}:${s}`;
      countEl.textContent = cycles ? `🍅 ${cycles} done` : '';
    }
    function stopTicking() {
      if (running) { clearInterval(running); running = null; }
      startBtn.textContent = '▶ Start';
    }
    function tick() {
      left--;
      if (left <= 0) {
        stopTicking();
        if (mode === 'focus') {
          cycles++;
          localStorage.setItem('gpa_pomo_cycles', String(cycles));
          mode = 'break';
          left = 5 * 60;
          speak('Focus session done. Take a five minute break.');
        } else {
          mode = 'focus';
          left = 25 * 60;
          speak('Break is over. Back to focus.');
        }
      }
      render();
    }
    startBtn.addEventListener('click', () => {
      if (running) { stopTicking(); return; }
      running = setInterval(tick, 1000);
      startBtn.textContent = '⏸ Pause';
    });
    panel.querySelector('#gpa-pomo-reset').addEventListener('click', () => {
      stopTicking();
      mode = 'focus';
      left = 25 * 60;
      render();
    });
    render();
  })();

  // Research mode (Browser tab): the AI picks 3 authoritative sources, the
  // worker fetches them (pages block browser-side fetches with CORS), and
  // the AI writes a brief with sources. Needs OPENAI_PROXY to be set.
  panel.querySelector('#gpa-research-btn').addEventListener('click', async () => {
    const q = panel.querySelector('#gpa-research-input').value.trim();
    const out = panel.querySelector('#gpa-research-out');
    if (!q) { out.textContent = 'Type a topic or question first.'; return; }
    if (!OPENAI_PROXY) { out.textContent = 'Research mode needs the worker proxy (OPENAI_PROXY) to fetch pages.'; return; }
    out.textContent = '🔎 Planning sources…';
    try {
      const planOut = await callAI(`I need to research: "${q}". Suggest 3 specific, authoritative web page URLs (direct articles or docs, not search result pages) that would contain good information about it. Respond ONLY with a JSON array of 3 URL strings.`, 'You are a research librarian.');
      const urls = JSON.parse(planOut.match(/\[[\s\S]*\]/)[0]).slice(0, 3);
      const srcs = [];
      for (const u of urls) {
        out.textContent = `🔎 Reading ${srcs.length + 1}/${urls.length}: ${u.slice(0, 60)}…`;
        try {
          const r = await rawFetch(`${OPENAI_PROXY}/read?url=${encodeURIComponent(u)}`);
          if (!r.ok) continue;
          const html = await r.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          doc.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach((el) => el.remove());
          const txt = (doc.body.innerText || '').replace(/\s+\n/g, '\n').trim();
          if (txt.length > 200) srcs.push({ url: u, text: txt.slice(0, 8000) });
        } catch (e) { /* skip unreadable sources */ }
      }
      if (!srcs.length) { out.textContent = 'Could not read any of the suggested sources. Try rephrasing the topic.'; return; }
      out.textContent = '✍️ Writing the report…';
      const sys = 'You write tight research briefs. Plain text with short sections: SUMMARY (2-3 sentences), KEY POINTS (lines starting with "-"), then SOURCES (list the URLs). No markdown symbols.';
      const body = srcs.map((s) => `SOURCE ${s.url}:\n${s.text}`).join('\n\n');
      const report = await callAI(`TOPIC: ${q}\n\n${body.slice(0, 24000)}`, sys);
      const clean = stripConfidence(report);
      out.innerHTML = '';
      const rep = document.createElement('div');
      rep.className = 'gpa-msg ai';
      out.appendChild(rep);
      typeText(rep, clean, out, () => { addSaveButton(rep, clean); speak(clean); });
    } catch (e) {
      showError(out, e, currentProviderLabel());
    }
  });

  // ---- Notes maker (Notes tab) ----------------------------------------------
  // Paste a passage → the AI reads it (title included), extracts structure,
  // researches it across the web through the worker, and writes neat
  // organized notes. The passage, notes, research excerpts and follow-up
  // chat are all kept in gpa_notes_state, so follow-up questions have full
  // context until you clear it — and it syncs with your profile.
  const NOTES_KEY = 'gpa_notes_state';
  let notesState = null;
  try { notesState = JSON.parse(localStorage.getItem(NOTES_KEY) || 'null'); } catch (e) { notesState = null; }

  function saveNotesState() {
    if (notesState) localStorage.setItem(NOTES_KEY, JSON.stringify(notesState));
  }

  function notesMsg(role, text) {
    const chat = panel.querySelector('#gpa-notes-chat');
    const div = document.createElement('div');
    div.className = 'gpa-msg ' + role;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  function restoreNotesView() {
    if (!notesState || !notesState.notes) return;
    const out = panel.querySelector('#gpa-notes-out');
    const qRow = panel.querySelector('#gpa-notes-q-row');
    const newBtn = panel.querySelector('#gpa-notes-new');
    out.textContent = notesState.notes;
    qRow.style.display = 'flex';
    newBtn.style.display = 'inline-block';
    (notesState.chat || []).forEach((m) => notesMsg(m.role, m.text));
  }
  restoreNotesView();

  panel.querySelector('#gpa-notes-new').addEventListener('click', () => {
    notesState = null;
    localStorage.removeItem(NOTES_KEY);
    panel.querySelector('#gpa-notes-out').innerHTML = '';
    panel.querySelector('#gpa-notes-chat').innerHTML = '';
    panel.querySelector('#gpa-notes-q-row').style.display = 'none';
    panel.querySelector('#gpa-notes-new').style.display = 'none';
    panel.querySelector('#gpa-notes-status').textContent = 'Cleared. Paste a new passage whenever you\'re ready.';
  });

  async function makeNotes() {
    const input = panel.querySelector('#gpa-notes-input');
    const status = panel.querySelector('#gpa-notes-status');
    const out = panel.querySelector('#gpa-notes-out');
    const raw = input.value.trim();
    if (raw.length < 200) { status.textContent = 'Paste a longer passage first — a paragraph or more.'; return; }
    if (!OPENAI_PROXY) { status.textContent = 'Research-backed notes need the worker proxy (OPENAI_PROXY) to be set.'; return; }
    const passage = raw.slice(0, 16000);
    const goBtn = panel.querySelector('#gpa-notes-go');
    goBtn.disabled = true;
    try {
      // Pass 1 — read and structure the passage itself.
      status.textContent = '📖 Reading and analyzing the passage…';
      const sys1 = 'You analyze a passage for note-taking. Return ONLY JSON: {"title":"best title for the passage","summary":"3-4 sentence overview","key_events":["..."],"important_parts":["short verbatim or near-verbatim quotes that matter most"],"key_terms":["term — plain definition"],"research_queries":["3 web search queries that would find reliable background context about the passage\'s subject"]} — key_events ordered as they happen; if the passage has no events, use main points instead. No text outside the JSON.';
      const out1 = await callAI(`PASSAGE:\n${passage}`, sys1);
      const m1 = out1.match(/\{[\s\S]*\}/);
      const info = JSON.parse(m1[0]);

      // Pass 2 — research: AI already suggested queries; pick a page URL per
      // query and read it through the worker (pages block browser fetches).
      status.textContent = '🌐 Researching sources…';
      const research = [];
      const queries = (info.research_queries || []).slice(0, 3);
      for (const qy of queries) {
        try {
          const pick = await callAI(`Suggest ONE specific, authoritative web page URL (direct article, docs or encyclopedia entry — not a search page) that best answers this research need: "${qy}". Respond ONLY with the URL string.`, 'You are a research librarian.');
          const u = pick.trim().replace(/^["'\[\]]+|["'\[\]]+$/g, '');
          if (!/^https?:\/\//i.test(u)) continue;
          status.textContent = `🌐 Reading: ${u.slice(0, 70)}…`;
          const r = await rawFetch(`${OPENAI_PROXY}/read?url=${encodeURIComponent(u)}`);
          if (!r.ok) continue;
          const html = await r.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          doc.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach((el) => el.remove());
          const txt = (doc.body.innerText || '').replace(/\s+\n/g, '\n').trim();
          if (txt.length > 200) research.push({ url: u, text: txt.slice(0, 6000) });
        } catch (e) { /* skip unreadable sources */ }
      }

      // Pass 3 — write the notes, passage first, research as background.
      status.textContent = research.length ? `✍️ Writing notes (passage + ${research.length} source${research.length > 1 ? 's' : ''})…` : '✍️ Writing notes…';
      const sys2 = 'You write study notes. Plain text only — no markdown symbols (no asterisks, #, or backticks). Use exactly these sections, each heading in CAPS on its own line:\nTITLE:\nOVERVIEW:\nKEY EVENTS:\nIMPORTANT PARTS:\nCONTEXT & BACKGROUND:\nKEY TERMS:\nQUICK FACTS:\nUnder KEY EVENTS use numbered lines. Under the other sections use "- " lines. IMPORTANT PARTS quotes the passage\'s own words where it matters and says briefly why each matters. CONTEXT & BACKGROUND uses the provided research (cite the source URL in parentheses at the end of each line you took from research) and notes where research contradicts or extends the passage. Keep every line tight and factual — notes, not an essay.';
      const researchBody = research.map((s) => `SOURCE ${s.url}:\n${s.text}`).join('\n\n');
      const out2 = await callAI(`PASSAGE:\n${passage}\n\nANALYSIS:\n${JSON.stringify(info)}\n\n${researchBody || 'RESEARCH: none available — base CONTEXT & BACKGROUND only on the passage and say research was unavailable.'}`, sys2);
      const notes = stripConfidence(out2).trim();

      notesState = {
        title: info.title || 'Untitled passage',
        passage,
        notes,
        research,
        chat: [],
        date: new Date().toLocaleString()
      };
      saveNotesState();
      out.innerHTML = '';
      const rep = document.createElement('div');
      rep.className = 'gpa-msg ai';
      out.appendChild(rep);
      typeText(rep, notes, out, () => {
        addSaveButton(rep, notes);
        const qRow = panel.querySelector('#gpa-notes-q-row');
        qRow.style.display = 'flex';
        panel.querySelector('#gpa-notes-new').style.display = 'inline-block';
        panel.querySelector('#gpa-notes-status').textContent = `Working with: "${notesState.title}" — ask follow-ups below, it has the whole passage in memory.`;
        speak('Notes ready.');
      });
    } catch (e) {
      showError(out, e, currentProviderLabel());
      status.textContent = '';
    }
    goBtn.disabled = false;
  }
  panel.querySelector('#gpa-notes-go').addEventListener('click', makeNotes);
  panel.querySelector('#gpa-notes-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); makeNotes(); }
  });

  // Follow-up questions — the AI answers from the stored passage, notes,
  // research excerpts and recent chat history.
  async function askNotesQuestion() {
    const qInput = panel.querySelector('#gpa-notes-q');
    const chat = panel.querySelector('#gpa-notes-chat');
    const q = qInput.value.trim();
    if (!q || !notesState || !notesState.notes) { if (!notesState) qInput.value = ''; return; }
    notesMsg('user', q);
    qInput.value = '';
    const aiMsg = notesMsg('ai', 'Thinking…');
    const history = (notesState.chat || []).slice(-8)
      .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.text}`)
      .join('\n');
    const researchText = (notesState.research || []).map((s) => `${s.url}:\n${s.text}`).join('\n\n').slice(0, 12000);
    const sys = 'You answer questions about a passage the user is studying. For anything about the passage, rely on the PASSAGE, NOTES, RESEARCH and chat history — quote or paraphrase it accurately; if something is not covered there, say so plainly and answer generally if you can. Otherwise you are a helpful, concise assistant. Plain text only — no markdown symbols. End with a final line "CONFIDENCE: NN" (0-100).';
    const userText = `PASSAGE (titled "${notesState.title}"):\n${notesState.passage}\n\nNOTES ALREADY WRITTEN:\n${notesState.notes}\n\nRESEARCH EXCERPTS:\n${researchText || '(none)'}\n\nRECENT CHAT:\n${history || '(none)'}\n\nNEW QUESTION: ${q}`;
    try {
      const out = await callAI(userText, sys);
      const { text: cleanText, confidence } = extractConfidenceLine(out);
      typeText(aiMsg, cleanText, chat, () => {
        appendConfidenceBadge(aiMsg, confidence);
        notesState.chat.push({ role: 'user', text: q }, { role: 'ai', text: cleanText });
        if (notesState.chat.length > 24) notesState.chat = notesState.chat.slice(-16);
        saveNotesState();
      });
    } catch (e) {
      showError(aiMsg, e, currentProviderLabel());
    }
  }
  panel.querySelector('#gpa-notes-q-btn').addEventListener('click', askNotesQuestion);
  panel.querySelector('#gpa-notes-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') askNotesQuestion();
  });

  // ---- Profiles, save state & cross-device sync -----------------------------
  // HOW THIS WORKS (and what it is not):
  //  * All of this script's settings/progress live in localStorage under
  //    "gpa_" keys. A profile is just a snapshot of every one of those keys.
  //  * Signing in restores that snapshot; signing out / auto-save captures it.
  //  * The PIN separates profiles and stops casual snooping. It is NOT
  //    encryption — the data sits in plain localStorage and this script is
  //    readable by anyone with the URL. Never reuse an important password.
  //  * Cross-device transfer works two ways: a portable "sync code" (a
  //    base64 blob you copy between machines, no server needed), or optional
  //    cloud auto-sync using credentials YOU enter at runtime — deliberately
  //    never hard-coded, so nothing secret ends up in a public repo.
  const PROFILE_PREFIX = 'gpa_profile_';
  const SESSION_KEY = 'gpa_session_user';
  const CLOUD_BIN_KEY = 'gpa_cloud_bin';
  const CLOUD_SECRET_KEY = 'gpa_cloud_key';
  // Keys that identify the session/profiles themselves must never be swept
  // into a profile snapshot, or restoring one would clobber the login system.
  const NON_PROFILE_KEYS = [SESSION_KEY, CLOUD_BIN_KEY, CLOUD_SECRET_KEY];

  const loginOverlay = panel.querySelector('#gpa-login');
  const loginUserInput = panel.querySelector('#gpa-login-user');
  const loginPinInput = panel.querySelector('#gpa-login-pin');
  const loginMsg = panel.querySelector('#gpa-login-msg');
  let currentUser = null;

  async function hashPin(user, pin) {
    const text = `gpa|${user}|${pin}`;
    if (window.crypto && window.crypto.subtle) {
      try {
        const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch (e) { /* fall through to the non-crypto path below */ }
    }
    // Fallback for non-secure contexts where SubtleCrypto is unavailable.
    let h = 0;
    for (let i = 0; i < text.length; i++) { h = ((h << 5) - h + text.charCodeAt(i)) | 0; }
    return 'fb' + (h >>> 0).toString(16);
  }

  function profileKey(user) { return PROFILE_PREFIX + user.toLowerCase(); }
  function readProfile(user) {
    try { return JSON.parse(localStorage.getItem(profileKey(user)) || 'null'); }
    catch (e) { return null; }
  }
  function writeProfile(user, profile) {
    localStorage.setItem(profileKey(user), JSON.stringify(profile));
  }

  // Snapshot every gpa_* key except the auth/profile plumbing itself.
  function collectState() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('gpa_')) continue;
      if (k.startsWith(PROFILE_PREFIX)) continue;
      if (NON_PROFILE_KEYS.includes(k)) continue;
      data[k] = localStorage.getItem(k);
    }
    return data;
  }

  function applyState(data) {
    if (!data || typeof data !== 'object') return;
    // Clear existing app keys first so a restored profile doesn't inherit
    // leftovers from whoever was signed in before.
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('gpa_')) continue;
      if (k.startsWith(PROFILE_PREFIX)) continue;
      if (NON_PROFILE_KEYS.includes(k)) continue;
      toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    Object.keys(data).forEach((k) => {
      if (k.startsWith('gpa_') && !k.startsWith(PROFILE_PREFIX) && !NON_PROFILE_KEYS.includes(k)) {
        localStorage.setItem(k, String(data[k]));
      }
    });
  }

  function saveProgress() {
    if (!currentUser) return;
    const profile = readProfile(currentUser);
    if (!profile) return;
    profile.data = collectState();
    profile.updatedAt = Date.now();
    writeProfile(currentUser, profile);
  }

  function showLoginMsg(text, isError) {
    loginMsg.textContent = text;
    loginMsg.classList.toggle('error', !!isError);
  }

  function refreshAccountUI() {
    const who = panel.querySelector('#gpa-account-who');
    if (who) who.textContent = currentUser ? `Signed in as ${currentUser}` : 'Not signed in';
  }

  // Re-applies everything a restored profile affects, so a sign-in takes
  // effect immediately instead of needing a reload.
  function reapplyAllSettings() {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY) || 'matte';
      const savedCustom = localStorage.getItem(CUSTOM_COLOR_KEY);
      if (savedCustom) THEMES.custom = { ...THEMES.dark, accent: savedCustom };
      applyTheme(THEMES[savedTheme] ? savedTheme : 'matte');
      if (typeof setProviderUI === 'function') setProviderUI(localStorage.getItem(PROVIDER_KEY) || 'gemini');
      if (typeof setSpeedUI === 'function') setSpeedUI(localStorage.getItem(SPEED_KEY) || 'normal');
      if (typeof setFontUI === 'function') setFontUI(localStorage.getItem(FONT_KEY) || 'mono');
      if (typeof setIconUI === 'function') setIconUI(localStorage.getItem(ICON_KEY) || 'dot');
      if (typeof setLookUI === 'function') setLookUI(localStorage.getItem(ICON_LOOK_KEY) || 'futuristic');
      if (typeof setColorModeUI === 'function') setColorModeUI(localStorage.getItem(ICON_COLOR_MODE_KEY) || 'theme');
      if (typeof renderMiniIcon === 'function') renderMiniIcon();
      if (typeof applyMiniLook === 'function') applyMiniLook();
      if (typeof applyMiniColorMode === 'function') applyMiniColorMode();
      if (typeof setParticleUI === 'function') setParticleUI(localStorage.getItem(PARTICLE_KEY) || 'off');
      if (typeof setParticleStyle === 'function') setParticleStyle(localStorage.getItem(PARTICLE_KEY) || 'off');
      if (typeof setSizeUI === 'function' && typeof applyPanelSize === 'function') {
        const sz = localStorage.getItem(PANEL_SIZE_KEY) || 'normal';
        setSizeUI(PANEL_SIZES[sz] ? sz : 'normal');
        applyPanelSize(sz);
      }
    } catch (e) { /* a restored-but-odd value shouldn't block sign-in */ }
  }

  // Toggles every "signed out" visual: plain rounded window, no HUD chrome,
  // no particles, neutral minimized button.
  function setLockedChrome(locked) {
    panel.classList.toggle('gpa-locked', locked);
    minimized.classList.toggle('gpa-mini-locked', locked);
    if (locked) {
      minimized.textContent = '';
      if (typeof setParticleStyle === 'function') setParticleStyle('off');
    } else if (typeof renderMiniIcon === 'function') {
      renderMiniIcon();
    }
  }

  function enterApp(user) {
    currentUser = user;
    localStorage.setItem(SESSION_KEY, user);
    loginOverlay.style.display = 'none';
    setLockedChrome(false);
    refreshAccountUI();
    reapplyAllSettings();
    // Particles were held off until now so the login screen stays plain and
    // doesn't leak the previous user's preference.
    if (typeof setParticleStyle === 'function') {
      setParticleStyle(localStorage.getItem(PARTICLE_KEY) || 'off');
    }
    const cloudBin = panel.querySelector('#gpa-cloud-bin');
    const cloudKey = panel.querySelector('#gpa-cloud-key');
    if (cloudBin) cloudBin.value = localStorage.getItem(CLOUD_BIN_KEY) || '';
    if (cloudKey) cloudKey.value = localStorage.getItem(CLOUD_SECRET_KEY) || '';
  }

  // Login-screen window controls (the panel header is covered while locked).
  panel.querySelector('#gpa-login-min').addEventListener('click', () => setMinimized(true));
  panel.querySelector('#gpa-login-close').addEventListener('click', () => host.remove());

  async function doSignIn() {
    const user = loginUserInput.value.trim();
    const pin = loginPinInput.value;
    if (!user || !pin) { showLoginMsg('Enter both a profile name and a PIN.', true); return; }
    const profile = readProfile(user);
    if (!profile) { showLoginMsg('No profile by that name here. Use Create, or restore a sync code.', true); return; }
    const hash = await hashPin(user.toLowerCase(), pin);
    if (hash !== profile.pinHash) { showLoginMsg('Wrong PIN.', true); return; }
    applyState(profile.data || {});
    showLoginMsg('');
    enterApp(user);
  }

  async function doSignUp() {
    const user = loginUserInput.value.trim();
    const pin = loginPinInput.value;
    if (!user || !pin) { showLoginMsg('Enter both a profile name and a PIN.', true); return; }
    if (readProfile(user)) { showLoginMsg('That profile already exists here — sign in instead.', true); return; }
    const pinHash = await hashPin(user.toLowerCase(), pin);
    // A brand-new profile starts from whatever is currently set up, so you
    // don't lose settings you'd already configured before making a profile.
    writeProfile(user, { user, pinHash, data: collectState(), updatedAt: Date.now() });
    showLoginMsg('');
    enterApp(user);
  }

  panel.querySelector('#gpa-login-btn').addEventListener('click', doSignIn);
  panel.querySelector('#gpa-signup-btn').addEventListener('click', doSignUp);
  loginPinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSignIn(); });
  loginUserInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginPinInput.focus(); });

  // ---- Sync codes (portable, no server involved) ----
  function encodeSyncCode(payload) {
    // encodeURIComponent first so non-ASCII (song names, emoji) survives btoa.
    return btoa(encodeURIComponent(JSON.stringify(payload)));
  }
  function decodeSyncCode(code) {
    return JSON.parse(decodeURIComponent(atob(code.trim())));
  }
  function buildSyncPayload() {
    return { v: 1, user: currentUser || 'export', updatedAt: Date.now(), data: collectState() };
  }

  panel.querySelector('#gpa-login-restore').addEventListener('click', async () => {
    const code = prompt('Paste the sync code copied from your other device:');
    if (!code) return;
    try {
      const payload = decodeSyncCode(code);
      if (!payload || !payload.data) throw new Error('bad payload');
      const user = loginUserInput.value.trim() || payload.user || 'restored';
      const pin = loginPinInput.value || '0000';
      const pinHash = await hashPin(user.toLowerCase(), pin);
      applyState(payload.data);
      writeProfile(user, { user, pinHash, data: payload.data, updatedAt: Date.now() });
      showLoginMsg('');
      enterApp(user);
    } catch (e) {
      showLoginMsg("That doesn't look like a valid sync code.", true);
    }
  });

  // Auto-save so progress survives a crash or a closed tab, not just a
  // clean sign-out.
  setInterval(saveProgress, 5000);
  window.addEventListener('beforeunload', saveProgress);

  // ---- Games tab -----------------------------------------------------------
  // Game loaders may return either a plain cleanup function (older/simple
  // games) or a controls object: { cleanup, pause, resume, stats }. `stats`
  // returns an array of {label, value} shown in the pause menu, so each game
  // can surface whatever actually matters for it (score, rounds, lives…).
  const gameViewport = panel.querySelector('#gpa-game-viewport');
  const gameFit = panel.querySelector('#gpa-game-fit');

  // Scales the whole game uniformly so it always fits the available stage
  // area — whatever interface size preset is active, and in fullscreen.
  // Scaling the wrapper (rather than each game) keeps every game's internal
  // coordinate math untouched; pointer-based games read the scale back off
  // getBoundingClientRect(), so clicks stay accurate at any zoom.
  function fitGameToStage() {
    if (!gameFit) return;
    gameFit.style.transform = 'none';
    const availW = Math.max(40, gameViewport.clientWidth - 4);
    const availH = Math.max(40, gameViewport.clientHeight - 4);
    const natW = gameFit.scrollWidth;
    const natH = gameFit.scrollHeight;
    if (!natW || !natH) return;
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    // Shrink to fit always; only grow when fullscreen (so a small game in a
    // small panel doesn't get blown up into a blurry mess).
    const maxScale = isFs ? 3.2 : 1;
    const scale = Math.min(maxScale, availW / natW, availH / natH);
    gameFit.style.transform = scale < 0.999 || scale > 1.001 ? `scale(${scale})` : 'none';
  }
  const gameBtns = panel.querySelectorAll('.game-btn');
  let activeGameControls = null;
  let gameStartedAt = 0;
  let gamePausedTotal = 0;
  let gamePausedAt = 0;
  let isGamePaused = false;

  // ---- Per-game options -----------------------------------------------------
  // Each game can expose an `options` array; these render as dropdowns in the
  // pause menu and persist under gpa_gameopt_<game>_<key>, so they ride along
  // with profile save/sync like everything else.
  function gameOptKey(game, key) { return `gpa_gameopt_${game}_${key}`; }
  function getGameOpt(game, key, fallback) {
    const v = localStorage.getItem(gameOptKey(game, key));
    return v === null ? fallback : v;
  }
  function setGameOpt(game, key, value) {
    localStorage.setItem(gameOptKey(game, key), String(value));
  }

  function gameBestKey(id) { return `gpa_game_best_${id}`; }
  function getBest(id) { return parseInt(localStorage.getItem(gameBestKey(id)), 10) || 0; }
  function setBestIfHigher(id, score) {
    const best = getBest(id);
    if (score > best) { localStorage.setItem(gameBestKey(id), String(score)); return score; }
    return best;
  }
  function gameElapsedSeconds() {
    if (!gameStartedAt) return 0;
    const end = isGamePaused ? gamePausedAt : Date.now();
    return Math.max(0, Math.floor((end - gameStartedAt - gamePausedTotal) / 1000));
  }
  function formatElapsed(sec) {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function stopActiveGame() {
    if (activeGameControls && typeof activeGameControls.cleanup === 'function') {
      try { activeGameControls.cleanup(); } catch (e) { /* ignore cleanup errors */ }
    }
    activeGameControls = null;
  }

  // --- Tic-Tac-Toe (vs a simple heuristic AI) ---
  function initTTT(root) {
    let board = Array(9).fill(null);
    let over = false;
    const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const boardEl = document.createElement('div');
    boardEl.className = 'ttt-board';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'Restart';
    resetBtn.style.marginTop = '4px';

    function checkWinner(b) {
      for (const [a, c, d] of WINS) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
      return b.every(Boolean) ? 'draw' : null;
    }
    function aiMove() {
      const empties = board.map((v, i) => (v ? null : i)).filter((v) => v !== null);
      for (const i of empties) { const t = [...board]; t[i] = 'O'; if (checkWinner(t) === 'O') return i; }
      for (const i of empties) { const t = [...board]; t[i] = 'X'; if (checkWinner(t) === 'X') return i; }
      if (board[4] === null) return 4;
      const corners = [0, 2, 6, 8].filter((i) => board[i] === null);
      if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
      return empties[Math.floor(Math.random() * empties.length)];
    }
    function render() {
      boardEl.innerHTML = '';
      board.forEach((v, i) => {
        const cell = document.createElement('div');
        cell.className = 'ttt-cell';
        cell.textContent = v || '';
        if (!v && !over) cell.addEventListener('click', () => play(i));
        boardEl.appendChild(cell);
      });
    }
    function play(i) {
      if (board[i] || over) return;
      board[i] = 'X';
      let w = checkWinner(board);
      if (!w) {
        const ai = aiMove();
        if (ai !== undefined) board[ai] = 'O';
        w = checkWinner(board);
      }
      render();
      if (w) {
        over = true;
        status.textContent = w === 'draw' ? "It's a draw!" : w === 'X' ? 'You win! 🎉' : 'AI wins!';
      } else {
        status.textContent = 'Your move (X)';
      }
    }
    resetBtn.addEventListener('click', () => {
      board = Array(9).fill(null);
      over = false;
      status.textContent = 'Your move (X)';
      render();
    });

    status.textContent = 'Your move (X)';
    root.appendChild(status);
    root.appendChild(boardEl);
    root.appendChild(resetBtn);
    render();

    return {
      stats: () => [
        { label: 'Moves made', value: board.filter(Boolean).length },
        { label: 'Status', value: over ? 'Finished' : 'Your move' }
      ]
    };
  }

  // --- Rock Paper Scissors ---
  function initRPS(root) {
    const choices = { rock: '✊', paper: '✋', scissors: '✌️' };
    let wins = 0, losses = 0, ties = 0;
    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const scoreEl = document.createElement('div');
    scoreEl.className = 'gpa-sub';
    const row = document.createElement('div');
    row.className = 'rps-row';

    function updateScore() { scoreEl.textContent = `Wins: ${wins}   Losses: ${losses}   Ties: ${ties}`; }
    function play(choice) {
      const keys = Object.keys(choices);
      const ai = keys[Math.floor(Math.random() * keys.length)];
      let result;
      if (choice === ai) { result = 'tie'; ties++; }
      else if (
        (choice === 'rock' && ai === 'scissors') ||
        (choice === 'paper' && ai === 'rock') ||
        (choice === 'scissors' && ai === 'paper')
      ) { result = 'win'; wins++; }
      else { result = 'lose'; losses++; }
      status.textContent = `You: ${choices[choice]}  AI: ${choices[ai]} — ${result === 'tie' ? 'Tie!' : result === 'win' ? 'You win!' : 'AI wins!'}`;
      updateScore();
    }
    Object.keys(choices).forEach((key) => {
      const btn = document.createElement('button');
      btn.className = 'rps-btn';
      btn.textContent = choices[key];
      btn.addEventListener('click', () => play(key));
      row.appendChild(btn);
    });

    status.textContent = 'Pick one!';
    updateScore();
    root.appendChild(status);
    root.appendChild(row);
    root.appendChild(scoreEl);

    return {
      stats: () => [
        { label: 'Wins', value: wins },
        { label: 'Losses', value: losses },
        { label: 'Ties', value: ties }
      ]
    };
  }

  // --- Memory Match ---
  function initMemory(root) {
    const emojis = ['🐱', '🐶', '🦊', '🐼', '🐸', '🦁'];
    let cards = [...emojis, ...emojis].sort(() => Math.random() - 0.5);
    let flipped = [];
    let matched = new Set();
    let moves = 0;
    let lock = false;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const grid = document.createElement('div');
    grid.className = 'memory-grid';

    function render() {
      grid.innerHTML = '';
      cards.forEach((emoji, i) => {
        const cell = document.createElement('div');
        cell.className = 'memory-card' + (matched.has(i) ? ' matched' : flipped.includes(i) ? ' flipped' : '');
        cell.textContent = matched.has(i) || flipped.includes(i) ? emoji : '❔';
        if (!matched.has(i) && !flipped.includes(i) && !lock) cell.addEventListener('click', () => flip(i));
        grid.appendChild(cell);
      });
    }
    function flip(i) {
      if (flipped.length === 2 || flipped.includes(i)) return;
      flipped.push(i);
      render();
      if (flipped.length === 2) {
        moves++;
        lock = true;
        const [a, b] = flipped;
        if (cards[a] === cards[b]) {
          matched.add(a); matched.add(b);
          flipped = [];
          lock = false;
          status.textContent = matched.size === cards.length ? `You win! Moves: ${moves}` : `Moves: ${moves}`;
          render();
        } else {
          setTimeout(() => { flipped = []; lock = false; status.textContent = `Moves: ${moves}`; render(); }, 700);
        }
      }
    }

    status.textContent = 'Find the pairs!';
    root.appendChild(status);
    root.appendChild(grid);
    render();

    return {
      stats: () => [
        { label: 'Moves', value: moves },
        { label: 'Pairs found', value: `${matched.size / 2} / ${emojis.length}` }
      ]
    };
  }

  // --- Snake (canvas) ---
  function initSnake(root) {
    const size = 13, cell = 16;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = size * cell;
    canvas.height = size * cell;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-game-status';

    // Smooth movement: the snake still thinks in whole grid cells, but
    // rendering interpolates between each segment's previous and current
    // cell every animation frame, so it glides instead of teleporting.
    const SKINS = {
      accent: { name: 'Theme accent', body: () => THEMES[theme].accent, head: '#ffffff' },
      emerald: { name: 'Emerald', body: () => '#22c55e', head: '#d1fae5' },
      cyan: { name: 'Cyan', body: () => '#06b6d4', head: '#cffafe' },
      magenta: { name: 'Magenta', body: () => '#ec4899', head: '#fce7f3' },
      amber: { name: 'Amber', body: () => '#f59e0b', head: '#fef3c7' },
      violet: { name: 'Violet', body: () => '#8b5cf6', head: '#ede9fe' },
      mono: { name: 'Mono', body: () => '#e5e7eb', head: '#ffffff' }
    };
    const SPEEDS = { relaxed: 210, normal: 150, fast: 105, insane: 70 };

    const skinKey = getGameOpt('snake', 'skin', 'accent');
    const skin = SKINS[skinKey] || SKINS.accent;
    const shape = getGameOpt('snake', 'shape', 'rounded');   // rounded | square | circle
    const wrapMode = getGameOpt('snake', 'wrap', 'walls');   // walls | wrap
    const showGrid = getGameOpt('snake', 'grid', 'off') === 'on';
    const trailFade = getGameOpt('snake', 'fade', 'on') === 'on';
    const STEP_MS = SPEEDS[getGameOpt('snake', 'speed', 'normal')] || 150;

    let snake, prevSnake, dir, nextDir, food, score, over, paused = false;
    let raf = null, lastStep = 0;

    function placeFood() {
      do { food = { x: Math.floor(Math.random() * size), y: Math.floor(Math.random() * size) }; }
      while (snake.some((s) => s.x === food.x && s.y === food.y));
    }
    function reset() {
      snake = [{ x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }];
      prevSnake = snake.map((s) => ({ ...s }));
      dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
      placeFood();
      score = 0; over = false;
      lastStep = performance.now();
      status.textContent = `Score: 0   Best: ${getBest('snake')}`;
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
    }
    function paintCell(x, y, w, h) {
      if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === 'square') {
        ctx.fillRect(x, y, w, h);
      } else {
        roundRect(x, y, w, h, 3);
      }
    }
    function draw(progress) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (showGrid) {
        ctx.strokeStyle = THEMES[theme].border;
        ctx.lineWidth = 1;
        for (let i = 1; i < size; i++) {
          ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, canvas.height); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(canvas.width, i * cell); ctx.stroke();
        }
      }
      // Food gets a subtle pulse so the board feels alive between steps.
      const pulse = 1 + Math.sin(performance.now() / 220) * 0.08;
      const fs = (cell - 4) * pulse;
      ctx.fillStyle = '#ff5252';
      paintCell(food.x * cell + (cell - fs) / 2, food.y * cell + (cell - fs) / 2, fs, fs);

      const bodyColor = skin.body();
      for (let i = snake.length - 1; i >= 0; i--) {
        const target = snake[i];
        const source = prevSnake[i] || target;
        // Don't interpolate across a wrap/teleport-sized jump.
        const dx = target.x - source.x, dy = target.y - source.y;
        const jumped = Math.abs(dx) > 1 || Math.abs(dy) > 1;
        const t = over ? 1 : (jumped ? 1 : progress);
        const px = (source.x + dx * t) * cell;
        const py = (source.y + dy * t) * cell;
        ctx.fillStyle = i === 0 ? skin.head : bodyColor;
        ctx.globalAlpha = (i === 0 || !trailFade) ? 1 : Math.max(0.45, 1 - i / (snake.length + 4));
        paintCell(px + 1, py + 1, cell - 2, cell - 2);
      }
      ctx.globalAlpha = 1;
    }
    function step() {
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (wrapMode === 'wrap') {
        // Pass through walls and come out the other side.
        head.x = (head.x + size) % size;
        head.y = (head.y + size) % size;
      }
      const hitWall = wrapMode !== 'wrap' &&
        (head.x < 0 || head.x >= size || head.y < 0 || head.y >= size);
      if (hitWall || snake.some((s) => s.x === head.x && s.y === head.y)) {
        over = true;
        const best = setBestIfHigher('snake', score);
        status.textContent = `Game over! Score: ${score}   Best: ${best}`;
        return;
      }
      prevSnake = snake.map((s) => ({ ...s }));
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score++;
        placeFood();
        status.textContent = `Score: ${score}   Best: ${getBest('snake')}`;
      } else {
        snake.pop();
      }
    }
    function loop(now) {
      if (over || paused) return;
      const elapsed = now - lastStep;
      if (elapsed >= STEP_MS) {
        lastStep = now - (elapsed % STEP_MS);
        step();
      }
      draw(Math.min(1, (now - lastStep) / STEP_MS));
      if (!over) raf = requestAnimationFrame(loop);
    }
    function onKey(e) {
      const map = {
        ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
        w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 }
      };
      const nd = map[e.key];
      if (!nd || paused) return;
      e.preventDefault();
      if (nd.x === -dir.x && nd.y === -dir.y) return;
      nextDir = nd;
    }

    window.addEventListener('keydown', onKey);
    reset();
    draw(0);
    raf = requestAnimationFrame(loop);

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Arrow keys or WASD to steer.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); },
      pause: () => { paused = true; cancelAnimationFrame(raf); },
      resume: () => {
        if (over) return;
        paused = false;
        lastStep = performance.now(); // don't let paused time cause a jump
        raf = requestAnimationFrame(loop);
      },
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Length', value: snake.length },
        { label: 'Mode', value: wrapMode === 'wrap' ? 'Wrap walls' : 'Solid walls' },
        { label: 'Status', value: over ? 'Game over' : 'Alive' }
      ],
      options: () => [
        { key: 'skin', label: 'Color', value: skinKey, restart: true,
          choices: Object.keys(SKINS).map((k) => ({ value: k, label: SKINS[k].name })) },
        { key: 'shape', label: 'Style', value: shape, restart: true,
          choices: [
            { value: 'rounded', label: 'Rounded' },
            { value: 'square', label: 'Blocky' },
            { value: 'circle', label: 'Beads' }
          ] },
        { key: 'speed', label: 'Speed', value: getGameOpt('snake', 'speed', 'normal'), restart: true,
          choices: [
            { value: 'relaxed', label: 'Relaxed' },
            { value: 'normal', label: 'Normal' },
            { value: 'fast', label: 'Fast' },
            { value: 'insane', label: 'Insane' }
          ] },
        { key: 'wrap', label: 'Walls', value: wrapMode, restart: true,
          choices: [
            { value: 'walls', label: 'Solid' },
            { value: 'wrap', label: 'Wrap around' }
          ] },
        { key: 'grid', label: 'Grid', value: showGrid ? 'on' : 'off', restart: true,
          choices: [{ value: 'off', label: 'Hidden' }, { value: 'on', label: 'Shown' }] },
        { key: 'fade', label: 'Tail fade', value: trailFade ? 'on' : 'off', restart: true,
          choices: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] }
      ]
    };
  }

  // --- 2048 ---
  function init2048(root) {
    const N = 4;
    let grid, score, over, paused = false;
    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const gridEl = document.createElement('div');
    gridEl.className = 'g2048-grid';

    function emptyGrid() { return Array.from({ length: N }, () => Array(N).fill(0)); }
    function addTile() {
      const empties = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) empties.push([r, c]);
      if (!empties.length) return;
      const [r, c] = empties[Math.floor(Math.random() * empties.length)];
      grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    }
    function tileColor(v) {
      const colors = { 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };
      return colors[v] || '#3c3a32';
    }
    function render() {
      gridEl.innerHTML = '';
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const cell = document.createElement('div');
        cell.className = 'g2048-cell';
        const v = grid[r][c];
        if (v) { cell.textContent = v; cell.style.background = tileColor(v); cell.style.color = v <= 4 ? '#5c5347' : '#fff'; }
        gridEl.appendChild(cell);
      }
    }
    function slideRow(row) {
      const nums = row.filter((v) => v);
      const merged = [];
      for (let i = 0; i < nums.length; i++) {
        if (nums[i] === nums[i + 1]) { merged.push(nums[i] * 2); score += nums[i] * 2; i++; }
        else merged.push(nums[i]);
      }
      while (merged.length < N) merged.push(0);
      return merged;
    }
    function transpose(g) {
      const res = emptyGrid();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) res[c][r] = g[r][c];
      return res;
    }
    function reverseRows(g) { return g.map((row) => [...row].reverse()); }
    function isGameOver() {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (!grid[r][c]) return false;
        if (c < N - 1 && grid[r][c] === grid[r][c + 1]) return false;
        if (r < N - 1 && grid[r][c] === grid[r + 1][c]) return false;
      }
      return true;
    }
    function move(dir) {
      if (over || paused) return;
      const g = grid.map((row) => [...row]);
      let transformed = g;
      if (dir === 'up' || dir === 'down') transformed = transpose(transformed);
      if (dir === 'right' || dir === 'down') transformed = reverseRows(transformed);
      let result = transformed.map(slideRow);
      if (dir === 'right' || dir === 'down') result = reverseRows(result);
      if (dir === 'up' || dir === 'down') result = transpose(result);

      const moved = JSON.stringify(result) !== JSON.stringify(g);
      if (moved) {
        grid = result;
        addTile();
        render();
        status.textContent = `Score: ${score}   Best: ${getBest('2048')}`;
        if (isGameOver()) {
          over = true;
          const best = setBestIfHigher('2048', score);
          status.textContent = `Game over! Score: ${score}   Best: ${best}`;
        }
      }
    }
    function reset() {
      grid = emptyGrid(); score = 0; over = false;
      addTile(); addTile();
      status.textContent = `Score: 0   Best: ${getBest('2048')}`;
      render();
    }
    function onKey(e) {
      const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
      if (map[e.key]) { e.preventDefault(); move(map[e.key]); }
    }

    window.addEventListener('keydown', onKey);
    reset();

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Arrow keys or WASD to slide tiles.';
    root.appendChild(status);
    root.appendChild(gridEl);
    root.appendChild(hint);

    return {
      cleanup: () => window.removeEventListener('keydown', onKey),
      pause: () => { paused = true; },
      resume: () => { paused = false; },
      stats: () => {
        const highestTile = Math.max(...grid.flat());
        return [
          { label: 'Score', value: score },
          { label: 'Highest tile', value: highestTile },
          { label: 'Status', value: over ? 'Game over' : 'In play' }
        ];
      }
    };
  }

  // --- Whack-a-Mole ---
  function initWhack(root) {
    const size = 9;
    let score = 0, timeLeft = 20, activeHole = -1, moleTimer = null, countdown = null, over = false;
    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const grid = document.createElement('div');
    grid.className = 'whack-grid';
    const holes = [];

    function render() {
      holes.forEach((h, i) => {
        h.classList.toggle('up', i === activeHole);
        h.textContent = i === activeHole ? '🐹' : '';
      });
    }
    for (let i = 0; i < size; i++) {
      const hole = document.createElement('div');
      hole.className = 'whack-hole';
      hole.addEventListener('click', () => {
        if (over || i !== activeHole) return;
        score++;
        activeHole = -1;
        render();
        status.textContent = `Score: ${score}   Time: ${timeLeft}s`;
      });
      holes.push(hole);
      grid.appendChild(hole);
    }
    function popMole() {
      if (over) return;
      activeHole = Math.floor(Math.random() * size);
      render();
      moleTimer = setTimeout(() => { activeHole = -1; render(); if (!over) popMole(); }, 550 + Math.random() * 450);
    }
    function tickCountdown() {
      timeLeft--;
      if (timeLeft <= 0) {
        over = true;
        clearTimeout(moleTimer);
        clearInterval(countdown);
        activeHole = -1; render();
        const best = setBestIfHigher('whack', score);
        status.textContent = `Time's up! Score: ${score}   Best: ${best}`;
      } else {
        status.textContent = `Score: ${score}   Time: ${timeLeft}s`;
      }
    }

    status.textContent = `Score: 0   Time: ${timeLeft}s   Best: ${getBest('whack')}`;
    root.appendChild(status);
    root.appendChild(grid);
    popMole();
    countdown = setInterval(tickCountdown, 1000);

    return {
      cleanup: () => { clearTimeout(moleTimer); clearInterval(countdown); },
      pause: () => { clearTimeout(moleTimer); clearInterval(countdown); moleTimer = null; countdown = null; },
      resume: () => {
        if (over) return;
        if (!moleTimer) popMole();
        if (!countdown) countdown = setInterval(tickCountdown, 1000);
      },
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Time left', value: `${timeLeft}s` },
        { label: 'Status', value: over ? "Time's up" : 'In play' }
      ]
    };
  }

  // --- Guess the Number ---
  function initGuess(root) {
    let target = Math.floor(Math.random() * 100) + 1;
    let tries = 0, over = false;
    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = "I'm thinking of a number between 1 and 100.";
    const row = document.createElement('div');
    row.className = 'gpa-row';
    const input = document.createElement('input');
    input.className = 'gpa-input';
    input.type = 'number'; input.min = '1'; input.max = '100';
    input.placeholder = 'Your guess…';
    const btn = document.createElement('button');
    btn.className = 'gpa-btn primary';
    btn.textContent = 'Guess';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'New number';
    resetBtn.style.marginTop = '6px';

    function guess() {
      if (over) return;
      const val = parseInt(input.value, 10);
      if (isNaN(val)) return;
      tries++;
      if (val === target) {
        over = true;
        const key = 'gpa_game_best_guess_tries';
        const prevBest = parseInt(localStorage.getItem(key), 10);
        const newBest = isNaN(prevBest) || tries < prevBest ? tries : prevBest;
        localStorage.setItem(key, String(newBest));
        status.textContent = `🎉 Correct! It was ${target}. Tries: ${tries}   Best: ${newBest}`;
      } else if (val < target) {
        status.textContent = `Higher than ${val}. Try again. (Tries: ${tries})`;
      } else {
        status.textContent = `Lower than ${val}. Try again. (Tries: ${tries})`;
      }
      input.value = '';
      input.focus();
    }
    btn.addEventListener('click', guess);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') guess(); });
    resetBtn.addEventListener('click', () => {
      target = Math.floor(Math.random() * 100) + 1;
      tries = 0; over = false;
      status.textContent = 'New number picked — guess away!';
    });

    row.appendChild(input);
    row.appendChild(btn);
    status.textContent = 'Make your first guess!';
    root.appendChild(hint);
    root.appendChild(status);
    root.appendChild(row);
    root.appendChild(resetBtn);

    return {
      stats: () => {
        const bestTries = parseInt(localStorage.getItem('gpa_game_best_guess_tries'), 10);
        return [
          { label: 'Tries this round', value: tries },
          { label: 'Fewest ever', value: isNaN(bestTries) ? '—' : bestTries },
          { label: 'Status', value: over ? 'Solved' : 'Guessing' }
        ];
      }
    };
  }

  // --- Hangman ---
  function initHangman(root) {
    const words = ['JAVASCRIPT', 'PYTHON', 'KEYBOARD', 'BROWSER', 'ROBOT', 'PUZZLE', 'GALAXY', 'WIZARD', 'PENGUIN', 'CANDLE'];
    const maxWrong = 6;
    let word, guessedLetters, wrongCount, over;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const wordEl = document.createElement('div');
    wordEl.className = 'hangman-word';
    const lettersEl = document.createElement('div');
    lettersEl.className = 'hangman-letters';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'New word';
    resetBtn.style.marginTop = '6px';

    function renderWord() {
      wordEl.textContent = word.split('').map((l) => (guessedLetters.has(l) ? l : '_')).join(' ');
    }
    function renderLetters() {
      lettersEl.innerHTML = '';
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((l) => {
        const b = document.createElement('button');
        b.className = 'hangman-letter';
        b.textContent = l;
        b.disabled = guessedLetters.has(l) || over;
        b.addEventListener('click', () => guessLetter(l));
        lettersEl.appendChild(b);
      });
    }
    function guessLetter(l) {
      if (over || guessedLetters.has(l)) return;
      guessedLetters.add(l);
      if (!word.includes(l)) wrongCount++;
      renderWord();
      if (word.split('').every((ch) => guessedLetters.has(ch))) {
        over = true;
        status.textContent = '🎉 You saved the day! You win!';
      } else if (wrongCount >= maxWrong) {
        over = true;
        status.textContent = `💀 Out of guesses! The word was ${word}.`;
      } else {
        status.textContent = `Guesses left: ${maxWrong - wrongCount}`;
      }
      renderLetters();
    }
    function reset() {
      word = words[Math.floor(Math.random() * words.length)];
      guessedLetters = new Set();
      wrongCount = 0; over = false;
      status.textContent = `Guesses left: ${maxWrong}`;
      renderWord();
      renderLetters();
    }

    resetBtn.addEventListener('click', reset);
    reset();
    root.appendChild(status);
    root.appendChild(wordEl);
    root.appendChild(lettersEl);
    root.appendChild(resetBtn);

    return {
      stats: () => [
        { label: 'Guesses left', value: maxWrong - wrongCount },
        { label: 'Letters tried', value: guessedLetters.size },
        { label: 'Status', value: over ? 'Finished' : 'In play' }
      ]
    };
  }

  // --- Wordle ---
  function initWordle(root) {
    const WORDS = ['REACT', 'BRAVE', 'STONE', 'PLANE', 'GRAPE', 'SHINE', 'CLOUD', 'FLAME', 'TRAIN', 'SWEET', 'BLEND', 'CRISP', 'FLUTE', 'GLOBE', 'HOUSE', 'JUICE', 'KNIFE', 'LEMON', 'MONEY', 'NURSE'];
    const target = WORDS[Math.floor(Math.random() * WORDS.length)];
    let guesses = [];
    let over = false;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const grid = document.createElement('div');
    grid.className = 'wordle-grid';
    const row = document.createElement('div');
    row.className = 'gpa-row';
    const input = document.createElement('input');
    input.className = 'gpa-input';
    input.maxLength = 5;
    input.placeholder = '5-letter word…';
    const btn = document.createElement('button');
    btn.className = 'gpa-btn primary';
    btn.textContent = 'Guess';

    function evaluate(guess) {
      const result = Array(5).fill('absent');
      const targetArr = target.split('');
      const guessArr = guess.split('');
      const counts = {};
      targetArr.forEach((l) => { counts[l] = (counts[l] || 0) + 1; });
      for (let i = 0; i < 5; i++) {
        if (guessArr[i] === targetArr[i]) { result[i] = 'correct'; counts[guessArr[i]]--; }
      }
      for (let i = 0; i < 5; i++) {
        if (result[i] === 'correct') continue;
        if (counts[guessArr[i]] > 0) { result[i] = 'present'; counts[guessArr[i]]--; }
      }
      return result;
    }
    function render() {
      grid.innerHTML = '';
      for (let r = 0; r < 6; r++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'wordle-row';
        const g = guesses[r];
        for (let c = 0; c < 5; c++) {
          const tile = document.createElement('div');
          tile.className = 'wordle-tile';
          if (g) { tile.textContent = g.word[c]; tile.classList.add(g.result[c]); }
          rowEl.appendChild(tile);
        }
        grid.appendChild(rowEl);
      }
    }
    function submitGuess() {
      if (over) return;
      const val = input.value.trim().toUpperCase();
      if (val.length !== 5) { status.textContent = 'Enter a 5-letter word.'; return; }
      const result = evaluate(val);
      guesses.push({ word: val, result });
      input.value = '';
      render();
      if (val === target) { over = true; status.textContent = `🎉 Solved in ${guesses.length}/6!`; }
      else if (guesses.length >= 6) { over = true; status.textContent = `Out of guesses! The word was ${target}.`; }
      else { status.textContent = `${6 - guesses.length} guesses left.`; }
    }
    btn.addEventListener('click', submitGuess);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGuess(); });

    status.textContent = 'Guess the 5-letter word! Green = right spot, yellow = wrong spot.';
    row.appendChild(input);
    row.appendChild(btn);
    root.appendChild(status);
    root.appendChild(grid);
    root.appendChild(row);
    render();

    return {
      stats: () => [
        { label: 'Guesses used', value: `${guesses.length} / 6` },
        { label: 'Status', value: over ? 'Finished' : 'In play' }
      ]
    };
  }

  // --- Connect Four (vs a simple AI) ---
  function initConnect4(root) {
    const COLS = 7, ROWS = 6;
    let board, over;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const boardEl = document.createElement('div');
    boardEl.className = 'c4-board';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'Restart';
    resetBtn.style.marginTop = '6px';

    function emptyBoard() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
    function lowestEmptyRow(b, col) {
      for (let r = ROWS - 1; r >= 0; r--) if (!b[r][col]) return r;
      return -1;
    }
    function checkWin(b, player) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (b[r][c] !== player) continue;
        if (c + 3 < COLS && b[r][c + 1] === player && b[r][c + 2] === player && b[r][c + 3] === player) return true;
        if (r + 3 < ROWS && b[r + 1][c] === player && b[r + 2][c] === player && b[r + 3][c] === player) return true;
        if (r + 3 < ROWS && c + 3 < COLS && b[r + 1][c + 1] === player && b[r + 2][c + 2] === player && b[r + 3][c + 3] === player) return true;
        if (r - 3 >= 0 && c + 3 < COLS && b[r - 1][c + 1] === player && b[r - 2][c + 2] === player && b[r - 3][c + 3] === player) return true;
      }
      return false;
    }
    function isFull(b) { return b.every((row) => row.every((cell) => cell)); }
    function aiMove() {
      const validCols = [];
      for (let c = 0; c < COLS; c++) if (lowestEmptyRow(board, c) !== -1) validCols.push(c);
      for (const c of validCols) { const r = lowestEmptyRow(board, c); const t = board.map((row) => [...row]); t[r][c] = 'Y'; if (checkWin(t, 'Y')) return c; }
      for (const c of validCols) { const r = lowestEmptyRow(board, c); const t = board.map((row) => [...row]); t[r][c] = 'R'; if (checkWin(t, 'R')) return c; }
      const centerOrder = [3, 2, 4, 1, 5, 0, 6].filter((c) => validCols.includes(c));
      return centerOrder[0];
    }
    function render() {
      boardEl.innerHTML = '';
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'c4-cell';
        if (board[r][c] === 'R') cell.classList.add('c4-red');
        if (board[r][c] === 'Y') cell.classList.add('c4-yellow');
        cell.addEventListener('click', () => drop(c));
        boardEl.appendChild(cell);
      }
    }
    function drop(col) {
      if (over) return;
      const r = lowestEmptyRow(board, col);
      if (r === -1) return;
      board[r][col] = 'R';
      if (checkWin(board, 'R')) { over = true; render(); status.textContent = '🎉 You win!'; return; }
      if (isFull(board)) { over = true; render(); status.textContent = "It's a draw!"; return; }
      render();
      setTimeout(() => {
        const aiCol = aiMove();
        if (aiCol === undefined) return;
        const ar = lowestEmptyRow(board, aiCol);
        board[ar][aiCol] = 'Y';
        if (checkWin(board, 'Y')) { over = true; render(); status.textContent = 'AI wins!'; return; }
        if (isFull(board)) { over = true; render(); status.textContent = "It's a draw!"; return; }
        render();
      }, 300);
    }
    function reset() {
      board = emptyBoard(); over = false;
      status.textContent = 'Your turn (Red) — click a column';
      render();
    }
    resetBtn.addEventListener('click', reset);
    reset();
    root.appendChild(status);
    root.appendChild(boardEl);
    root.appendChild(resetBtn);

    return {
      stats: () => {
        let pieces = 0;
        board.forEach((row) => row.forEach((cell) => { if (cell) pieces++; }));
        return [
          { label: 'Pieces played', value: pieces },
          { label: 'Turn', value: over ? 'Finished' : (turn === 'red' ? 'Yours' : 'AI') }
        ];
      }
    };
  }

  // --- Minesweeper ---
  function initMinesweeper(root) {
    const MINE_DIFF = { easy: 8, normal: 10, hard: 14, brutal: 18 };
    const mineDiff = getGameOpt('minesweeper', 'difficulty', 'normal');
    const SIZE = 8, MINES = MINE_DIFF[mineDiff] || 10;
    let board, revealed, flagged, over, firstClick;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const grid = document.createElement('div');
    grid.className = 'mine-grid';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'New game';
    resetBtn.style.marginTop = '6px';

    function idx(r, c) { return r * SIZE + c; }
    function neighbors(r, c) {
      const res = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) res.push([nr, nc]);
      }
      return res;
    }
    function setup(avoidR, avoidC) {
      board = Array(SIZE * SIZE).fill(0);
      let placed = 0;
      while (placed < MINES) {
        const r = Math.floor(Math.random() * SIZE), c = Math.floor(Math.random() * SIZE);
        if ((r === avoidR && c === avoidC) || board[idx(r, c)] === -1) continue;
        board[idx(r, c)] = -1;
        placed++;
      }
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (board[idx(r, c)] === -1) continue;
        let count = 0;
        neighbors(r, c).forEach(([nr, nc]) => { if (board[idx(nr, nc)] === -1) count++; });
        board[idx(r, c)] = count;
      }
    }
    function floodReveal(r, c) {
      const stack = [[r, c]];
      while (stack.length) {
        const [cr, cc] = stack.pop();
        const i = idx(cr, cc);
        if (revealed[i] || flagged[i]) continue;
        revealed[i] = true;
        if (board[i] === 0) neighbors(cr, cc).forEach(([nr, nc]) => { if (!revealed[idx(nr, nc)]) stack.push([nr, nc]); });
      }
    }
    function render() {
      grid.innerHTML = '';
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        const i = idx(r, c);
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        if (flagged[i] && !revealed[i]) cell.textContent = '🚩';
        else if (revealed[i]) {
          cell.classList.add('revealed');
          if (board[i] === -1) { cell.textContent = '💣'; cell.classList.add('mine'); }
          else if (board[i] > 0) { cell.textContent = board[i]; cell.classList.add('n' + board[i]); }
        }
        cell.addEventListener('click', () => reveal(r, c));
        cell.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleFlag(r, c); });
        grid.appendChild(cell);
      }
    }
    function reveal(r, c) {
      if (over) return;
      const i = idx(r, c);
      if (flagged[i] || revealed[i]) return;
      if (firstClick) { setup(r, c); firstClick = false; }
      if (board[i] === -1) {
        over = true;
        for (let k = 0; k < board.length; k++) if (board[k] === -1) revealed[k] = true;
        render();
        status.textContent = '💥 Boom! Game over.';
        return;
      }
      floodReveal(r, c);
      render();
      checkWin();
    }
    function toggleFlag(r, c) {
      if (over) return;
      const i = idx(r, c);
      if (revealed[i]) return;
      flagged[i] = !flagged[i];
      render();
    }
    function checkWin() {
      const safeCells = SIZE * SIZE - MINES;
      const revealedCount = revealed.filter(Boolean).length;
      if (revealedCount === safeCells) { over = true; status.textContent = '🎉 You cleared the field!'; }
      else status.textContent = `Mines: ${MINES}   Flags: ${flagged.filter(Boolean).length}`;
    }
    function reset() {
      board = Array(SIZE * SIZE).fill(0);
      revealed = Array(SIZE * SIZE).fill(false);
      flagged = Array(SIZE * SIZE).fill(false);
      over = false; firstClick = true;
      status.textContent = `Mines: ${MINES}   Left-click reveal, right-click flag`;
      render();
    }
    resetBtn.addEventListener('click', reset);
    reset();
    root.appendChild(status);
    root.appendChild(grid);
    root.appendChild(resetBtn);

    return {
      stats: () => [
        { label: 'Revealed', value: `${revealed.filter(Boolean).length} / ${SIZE * SIZE - MINES}` },
        { label: 'Flags placed', value: flagged.filter(Boolean).length },
        { label: 'Mines', value: MINES },
        { label: 'Status', value: over ? 'Finished' : 'In play' }
      ],
      options: () => [
        { key: 'difficulty', label: 'Mine count', value: mineDiff, restart: true,
          choices: [
            { value: 'easy', label: 'Easy (8)' },
            { value: 'normal', label: 'Normal (10)' },
            { value: 'hard', label: 'Hard (14)' },
            { value: 'brutal', label: 'Brutal (18)' }
          ] }
      ]
    };
  }

  // --- Simon ---
  function initSimon(root) {
    const colors = ['red', 'blue', 'green', 'yellow'];
    let sequence = [], playerIndex = 0, over = true, accepting = false;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const pad = document.createElement('div');
    pad.className = 'simon-pad';
    const startBtn = document.createElement('button');
    startBtn.className = 'gpa-btn primary';
    startBtn.textContent = 'Start';
    startBtn.style.marginTop = '6px';

    const btns = {};
    colors.forEach((color) => {
      const b = document.createElement('div');
      b.className = `simon-btn simon-${color}`;
      b.addEventListener('click', () => handleClick(color));
      btns[color] = b;
      pad.appendChild(b);
    });

    function flash(color, duration = 350) {
      return new Promise((resolve) => {
        btns[color].classList.add('active');
        setTimeout(() => { btns[color].classList.remove('active'); resolve(); }, duration);
      });
    }
    async function playSequence() {
      accepting = false;
      status.textContent = `Watch closely… (Round ${sequence.length})`;
      await new Promise((r) => setTimeout(r, 400));
      for (const color of sequence) {
        await flash(color);
        await new Promise((r) => setTimeout(r, 150));
      }
      accepting = true;
      playerIndex = 0;
      status.textContent = 'Your turn — repeat the sequence!';
    }
    function nextRound() {
      sequence.push(colors[Math.floor(Math.random() * 4)]);
      playSequence();
    }
    function handleClick(color) {
      if (!accepting || over) return;
      flash(color, 200);
      if (color === sequence[playerIndex]) {
        playerIndex++;
        if (playerIndex === sequence.length) { accepting = false; setTimeout(nextRound, 600); }
      } else {
        over = true; accepting = false;
        const best = setBestIfHigher('simon', sequence.length - 1);
        status.textContent = `Game over! You reached round ${sequence.length}. Best: ${best}`;
      }
    }
    startBtn.addEventListener('click', () => { sequence = []; over = false; nextRound(); });

    status.textContent = `Best: ${getBest('simon')} — press Start`;
    root.appendChild(status);
    root.appendChild(pad);
    root.appendChild(startBtn);

    return {
      // Pausing mid-sequence would desync the playback, so it just stops
      // accepting input; resuming replays the current sequence from the top.
      pause: () => { accepting = false; },
      resume: () => { if (!over && sequence.length) playSequence(); },
      stats: () => [
        { label: 'Round', value: sequence.length || '—' },
        { label: 'Status', value: over ? 'Game over' : (sequence.length ? 'In play' : 'Not started') }
      ]
    };
  }

  // --- Breakout ---
  function initBreakout(root) {
    const W = 220, H = 260;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-game-status';

    const PADDLE_W = { wide: 60, normal: 44, narrow: 30 };
    const breakoutPaddle = getGameOpt('breakout', 'paddle', 'normal');
    const paddleW = PADDLE_W[breakoutPaddle] || 44, paddleH = 6;
    let paddleX = W / 2 - paddleW / 2;
    let ballX, ballY, ballVX, ballVY, bricks, lives, score, over, raf, paused = false;
    const rows = 4, cols = 7, brickW = W / cols, brickH = 10, brickTop = 20;

    function resetBall() { ballX = W / 2; ballY = H - 30; ballVX = 1.6 * (Math.random() < 0.5 ? -1 : 1); ballVY = -2; }
    function reset() {
      bricks = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) bricks.push({ r, c, alive: true });
      lives = 3; score = 0; over = false;
      paddleX = W / 2 - paddleW / 2;
      resetBall();
      status.textContent = `Lives: ${lives}   Score: ${score}`;
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      bricks.forEach((b) => {
        if (!b.alive) return;
        ctx.fillStyle = ['#e5453a', '#f5c518', '#4da3ff', '#22c55e'][b.r % 4];
        ctx.fillRect(b.c * brickW + 1, brickTop + b.r * brickH + 1, brickW - 2, brickH - 2);
      });
      ctx.fillStyle = THEMES[theme].accent;
      ctx.fillRect(paddleX, H - 12, paddleW, paddleH);
      ctx.beginPath();
      ctx.arc(ballX, ballY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    function step() {
      if (over || paused) return;
      ballX += ballVX; ballY += ballVY;
      if (ballX < 4 || ballX > W - 4) ballVX *= -1;
      if (ballY < 4) ballVY *= -1;
      if (ballY > H - 16 && ballY < H - 8 && ballX > paddleX && ballX < paddleX + paddleW) {
        ballVY = -Math.abs(ballVY);
        const hitPos = (ballX - (paddleX + paddleW / 2)) / (paddleW / 2);
        ballVX = hitPos * 3;
      }
      if (ballY > H) {
        lives--;
        if (lives <= 0) {
          over = true;
          const best = setBestIfHigher('breakout', score);
          status.textContent = `Game over! Score: ${score}   Best: ${best}`;
        } else {
          resetBall();
          status.textContent = `Lives: ${lives}   Score: ${score}`;
        }
      }
      const bcol = Math.floor(ballX / brickW);
      const brow = Math.floor((ballY - brickTop) / brickH);
      if (brow >= 0 && brow < rows && bcol >= 0 && bcol < cols) {
        const brick = bricks.find((b) => b.r === brow && b.c === bcol && b.alive);
        if (brick) {
          brick.alive = false;
          ballVY *= -1;
          score += 10;
          status.textContent = `Lives: ${lives}   Score: ${score}`;
          if (bricks.every((b) => !b.alive)) {
            over = true;
            const best = setBestIfHigher('breakout', score);
            status.textContent = `🎉 Cleared! Score: ${score}   Best: ${best}`;
          }
        }
      }
      draw();
      if (!over) raf = requestAnimationFrame(step);
    }
    function onMove(e) {
      const rect = canvas.getBoundingClientRect();
      // rect.width reflects any CSS scaling applied by fitGameToStage(), so
      // divide it back out to get true canvas coordinates.
      const scale = rect.width / W || 1;
      const x = ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) / scale;
      paddleX = Math.max(0, Math.min(W - paddleW, x - paddleW / 2));
    }
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('touchmove', onMove, { passive: true });

    reset();
    draw();
    raf = requestAnimationFrame(step);

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Move your mouse over the canvas to steer the paddle.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { cancelAnimationFrame(raf); canvas.removeEventListener('mousemove', onMove); canvas.removeEventListener('touchmove', onMove); },
      pause: () => { cancelAnimationFrame(raf); paused = true; },
      resume: () => { paused = false; if (!over) raf = requestAnimationFrame(step); },
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Lives', value: lives },
        { label: 'Bricks left', value: bricks.filter((b) => b.alive).length }
      ],
      options: () => [
        { key: 'paddle', label: 'Paddle size', value: breakoutPaddle, restart: true,
          choices: [
            { value: 'wide', label: 'Wide' },
            { value: 'normal', label: 'Normal' },
            { value: 'narrow', label: 'Narrow' }
          ] }
      ]
    };
  }

  // --- Flappy ---
  function initFlappy(root) {
    const W = 220, H = 260;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-game-status';

    let birdY, birdV, pipes, score, over, started, raf, paused = false;
    // Tuned to be actually playable: gentler gravity, a softer flap, a wider
    // gap, and a terminal-velocity cap so the bird never plummets faster
    // than you can react to.
    const FLAPPY_DIFF = {
      easy:   { gravity: 0.13, flapV: -3.7, pipeGap: 112, pipeSpeed: 1.05 },
      normal: { gravity: 0.16, flapV: -4.0, pipeGap: 96,  pipeSpeed: 1.25 },
      hard:   { gravity: 0.20, flapV: -4.4, pipeGap: 82,  pipeSpeed: 1.6 }
    };
    const flappyDiff = getGameOpt('flappy', 'difficulty', 'normal');
    const fd = FLAPPY_DIFF[flappyDiff] || FLAPPY_DIFF.normal;
    const flappyBird = getGameOpt('flappy', 'bird', 'white');
    const BIRD_COLORS = { white: '#ffffff', gold: '#f5c518', mint: '#34d399', rose: '#fb7185' };
    const gravity = fd.gravity, flapV = fd.flapV, pipeGap = fd.pipeGap, pipeW = 30, pipeSpeed = fd.pipeSpeed;
    const maxFallV = 4.0;

    function spawnPipe() {
      const gapY = 40 + Math.random() * (H - 80 - pipeGap);
      pipes.push({ x: W, gapY, passed: false });
    }
    // The bird just hovers in place with no gravity and no pipes until the
    // first click — that first click both starts the game AND does the
    // first flap, so you're never falling before you've even had a chance
    // to react.
    function reset() {
      birdY = H / 2; birdV = 0; pipes = []; score = 0; over = false; started = false;
      status.textContent = `Click the canvas to start — Best: ${getBest('flappy')}`;
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = THEMES[theme].accent;
      pipes.forEach((p) => {
        ctx.fillRect(p.x, 0, pipeW, p.gapY);
        ctx.fillRect(p.x, p.gapY + pipeGap, pipeW, H - (p.gapY + pipeGap));
      });
      ctx.fillStyle = BIRD_COLORS[flappyBird] || '#ffffff';
      ctx.beginPath();
      ctx.arc(40, birdY, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    function endGame() {
      over = true;
      const best = setBestIfHigher('flappy', score);
      status.textContent = `Game over! Score: ${score}   Best: ${best}   (click to retry)`;
    }
    function step() {
      if (over || !started || paused) return;
      birdV += gravity;
      if (birdV > maxFallV) birdV = maxFallV;
      birdY += birdV;
      pipes.forEach((p) => { p.x -= pipeSpeed; });
      if (pipes.length && pipes[0].x < -pipeW) pipes.shift();
      if (pipes.length && pipes[pipes.length - 1].x < W - 130) spawnPipe();
      pipes.forEach((p) => {
        if (!p.passed && p.x + pipeW < 40) { p.passed = true; score++; status.textContent = `Score: ${score}   Best: ${getBest('flappy')}`; }
        const inX = 40 + 6 > p.x && 40 - 6 < p.x + pipeW;
        if (inX && (birdY - 6 < p.gapY || birdY + 6 > p.gapY + pipeGap)) endGame();
      });
      if (birdY - 6 < 0 || birdY + 6 > H) endGame();
      draw();
      if (!over) raf = requestAnimationFrame(step);
    }
    function flap() {
      if (over) { reset(); draw(); return; }
      if (!started) {
        started = true;
        spawnPipe();
        raf = requestAnimationFrame(step);
      }
      birdV = flapV;
    }

    canvas.addEventListener('click', flap);
    reset();
    draw();

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Click the canvas to flap. First click starts the game.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { cancelAnimationFrame(raf); canvas.removeEventListener('click', flap); },
      pause: () => { cancelAnimationFrame(raf); paused = true; },
      resume: () => { paused = false; if (!over && started) raf = requestAnimationFrame(step); },
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Pipes passed', value: pipes.filter((p) => p.passed).length },
        { label: 'Difficulty', value: flappyDiff },
        { label: 'Status', value: over ? 'Game over' : (started ? 'Flying' : 'Not started') }
      ],
      options: () => [
        { key: 'difficulty', label: 'Difficulty', value: flappyDiff, restart: true,
          choices: [
            { value: 'easy', label: 'Easy' },
            { value: 'normal', label: 'Normal' },
            { value: 'hard', label: 'Hard' }
          ] },
        { key: 'bird', label: 'Bird color', value: flappyBird, restart: true,
          choices: [
            { value: 'white', label: 'White' },
            { value: 'gold', label: 'Gold' },
            { value: 'mint', label: 'Mint' },
            { value: 'rose', label: 'Rose' }
          ] }
      ]
    };
  }

  // --- Word Scramble ---
  function initScramble(root) {
    const words = ['PLANET', 'GUITAR', 'WHISPER', 'JUNGLE', 'PYTHON', 'CANDLE', 'GALAXY', 'MARBLE', 'SILVER', 'WINTER'];
    let word, over;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const scrambledEl = document.createElement('div');
    scrambledEl.className = 'hangman-word';
    const row = document.createElement('div');
    row.className = 'gpa-row';
    const input = document.createElement('input');
    input.className = 'gpa-input';
    input.placeholder = 'Unscramble it…';
    const btn = document.createElement('button');
    btn.className = 'gpa-btn primary';
    btn.textContent = 'Submit';
    const row2 = document.createElement('div');
    row2.className = 'gpa-row';
    row2.style.marginTop = '6px';
    const hintBtn = document.createElement('button');
    hintBtn.className = 'gpa-btn';
    hintBtn.textContent = 'Hint';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'gpa-btn';
    nextBtn.textContent = 'New word';

    function scramble(w) {
      const arr = w.split('');
      let attempt;
      do { attempt = [...arr].sort(() => Math.random() - 0.5).join(''); } while (attempt === w);
      return attempt;
    }
    function reset() {
      word = words[Math.floor(Math.random() * words.length)];
      over = false;
      scrambledEl.textContent = scramble(word);
      status.textContent = 'Unscramble the word!';
      input.value = '';
    }
    function submit() {
      if (over) return;
      if (input.value.trim().toUpperCase() === word) { over = true; status.textContent = '🎉 Correct!'; }
      else status.textContent = 'Not quite — try again.';
    }
    hintBtn.addEventListener('click', () => { if (!over) status.textContent = `Hint: starts with "${word[0]}"`; });
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    nextBtn.addEventListener('click', reset);

    reset();
    row.appendChild(input);
    row.appendChild(btn);
    row2.appendChild(hintBtn);
    row2.appendChild(nextBtn);
    root.appendChild(status);
    root.appendChild(scrambledEl);
    root.appendChild(row);
    root.appendChild(row2);

    return {
      stats: () => [
        { label: 'Word length', value: word.length },
        { label: 'Status', value: over ? 'Solved' : 'Unsolved' }
      ]
    };
  }

  // --- Reaction Time Test ---
  function initReaction(root) {
    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const box = document.createElement('div');
    box.className = 'reaction-box waiting';
    box.textContent = 'Click to start';
    let state = 'idle', startTime, timeout;

    function startRound() {
      state = 'waiting';
      box.className = 'reaction-box waiting';
      box.textContent = 'Wait for green…';
      const delay = 1000 + Math.random() * 2500;
      timeout = setTimeout(() => {
        state = 'ready';
        startTime = performance.now();
        box.className = 'reaction-box ready';
        box.textContent = 'CLICK NOW!';
      }, delay);
    }
    box.addEventListener('click', () => {
      if (state === 'idle') { startRound(); return; }
      if (state === 'waiting') {
        clearTimeout(timeout);
        state = 'idle';
        box.className = 'reaction-box waiting';
        box.textContent = 'Too soon! Click to try again.';
        return;
      }
      if (state === 'ready') {
        const reactionMs = Math.round(performance.now() - startTime);
        const key = 'gpa_game_best_reaction_ms';
        const prevBest = parseInt(localStorage.getItem(key), 10);
        const newBest = isNaN(prevBest) || reactionMs < prevBest ? reactionMs : prevBest;
        localStorage.setItem(key, String(newBest));
        state = 'idle';
        box.className = 'reaction-box waiting';
        box.textContent = `${reactionMs}ms — Best: ${newBest}ms. Click to try again.`;
      }
    });

    status.textContent = 'Test your reflexes!';
    root.appendChild(status);
    root.appendChild(box);

    return {
      cleanup: () => clearTimeout(timeout),
      // Pausing mid-round would make the measurement meaningless, so
      // pausing just resets to idle and the next click starts fresh.
      pause: () => {
        clearTimeout(timeout);
        state = 'idle';
        box.className = 'reaction-box waiting';
        box.textContent = 'Click to start';
      },
      stats: () => {
        const best = parseInt(localStorage.getItem('gpa_game_best_reaction_ms'), 10);
        return [{ label: 'Best reaction', value: isNaN(best) ? '—' : `${best}ms` }];
      }
    };
  }

  // --- Tetris ---
  function initTetris(root) {
    const COLS = 10, ROWS = 18, CELL = 14;
    const SHAPES = {
      I: [[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]], [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]], [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]]],
      J: [[[1,0,0],[1,1,1],[0,0,0]], [[0,1,1],[0,1,0],[0,1,0]], [[0,0,0],[1,1,1],[0,0,1]], [[0,1,0],[0,1,0],[1,1,0]]],
      L: [[[0,0,1],[1,1,1],[0,0,0]], [[0,1,0],[0,1,0],[0,1,1]], [[0,0,0],[1,1,1],[1,0,0]], [[1,1,0],[0,1,0],[0,1,0]]],
      O: [[[1,1],[1,1]]],
      S: [[[0,1,1],[1,1,0],[0,0,0]], [[0,1,0],[0,1,1],[0,0,1]]],
      T: [[[0,1,0],[1,1,1],[0,0,0]], [[0,1,0],[0,1,1],[0,1,0]], [[0,0,0],[1,1,1],[0,1,0]], [[0,1,0],[1,1,0],[0,1,0]]],
      Z: [[[1,1,0],[0,1,1],[0,0,0]], [[0,0,1],[0,1,1],[0,1,0]]]
    };
    const PALETTES = {
      classic: { I: '#4da3ff', J: '#3b5bdb', L: '#f59f00', O: '#f5c518', S: '#22c55e', T: '#8b5cf6', Z: '#e5453a' },
      pastel: { I: '#a5d8ff', J: '#bac8ff', L: '#ffd8a8', O: '#ffec99', S: '#b2f2bb', T: '#d0bfff', Z: '#ffc9c9' },
      neon: { I: '#00e5ff', J: '#2979ff', L: '#ff9100', O: '#ffea00', S: '#00e676', T: '#d500f9', Z: '#ff1744' },
      mono: { I: '#e5e7eb', J: '#cbd5e1', L: '#94a3b8', O: '#f1f5f9', S: '#b0bec5', T: '#cfd8dc', Z: '#9aa5b1' }
    };
    const TYPES = Object.keys(SHAPES);

    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = COLS * CELL; canvas.height = ROWS * CELL;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-game-status';

    const TETRIS_START = { chill: 800, normal: 600, brisk: 420, turbo: 260 };
    const tetrisPace = getGameOpt('tetris', 'pace', 'normal');
    const tetrisPalette = getGameOpt('tetris', 'palette', 'classic');
    let board, current, score, level, linesCleared, over, dropTimer, dropInterval, paused = false;

    function emptyBoard() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
    function randomPiece() {
      const type = TYPES[Math.floor(Math.random() * TYPES.length)];
      const rotations = SHAPES[type];
      const shape = rotations[0];
      return { type, rot: 0, shape, x: Math.floor(COLS / 2) - Math.ceil(shape[0].length / 2), y: 0 };
    }
    function collides(shape, px, py) {
      for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const bx = px + c, by = py + r;
        if (bx < 0 || bx >= COLS || by >= ROWS) return true;
        if (by >= 0 && board[by][bx]) return true;
      }
      return false;
    }
    function merge() {
      current.shape.forEach((row, r) => row.forEach((v, c) => {
        if (v) { const by = current.y + r, bx = current.x + c; if (by >= 0) board[by][bx] = current.type; }
      }));
    }
    function clearLines() {
      let cleared = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r].every((cell) => cell)) {
          board.splice(r, 1);
          board.unshift(Array(COLS).fill(null));
          cleared++;
          r++;
        }
      }
      if (cleared) {
        const points = [0, 100, 300, 500, 800][cleared] || 1000;
        score += points * level;
        linesCleared += cleared;
        level = 1 + Math.floor(linesCleared / 10);
        dropInterval = Math.max(120, 600 - (level - 1) * 50);
        status.textContent = `Score: ${score}   Level: ${level}   Best: ${getBest('tetris')}`;
      }
    }
    function spawn() {
      current = randomPiece();
      if (collides(current.shape, current.x, current.y)) {
        over = true;
        const best = setBestIfHigher('tetris', score);
        status.textContent = `Game over! Score: ${score}   Best: ${best}`;
      }
    }
    function rotate() {
      const rotations = SHAPES[current.type];
      const nextRot = (current.rot + 1) % rotations.length;
      const nextShape = rotations[nextRot];
      if (!collides(nextShape, current.x, current.y)) { current.rot = nextRot; current.shape = nextShape; }
      else if (!collides(nextShape, current.x - 1, current.y)) { current.rot = nextRot; current.shape = nextShape; current.x -= 1; }
      else if (!collides(nextShape, current.x + 1, current.y)) { current.rot = nextRot; current.shape = nextShape; current.x += 1; }
    }
    function move(dx) { if (!collides(current.shape, current.x + dx, current.y)) current.x += dx; }
    function lockPiece() { merge(); clearLines(); spawn(); }
    function softDrop() {
      if (!collides(current.shape, current.x, current.y + 1)) { current.y++; score += 1; }
      else lockPiece();
    }
    function hardDrop() {
      while (!collides(current.shape, current.x, current.y + 1)) { current.y++; score += 2; }
      lockPiece();
    }
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (board[r][c]) { ctx.fillStyle = (PALETTES[tetrisPalette] || PALETTES.classic)[board[r][c]]; ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2); }
      }
      if (current && !over) {
        ctx.fillStyle = (PALETTES[tetrisPalette] || PALETTES.classic)[current.type];
        current.shape.forEach((row, r) => row.forEach((v, c) => {
          if (v) { const by = current.y + r; if (by >= 0) ctx.fillRect((current.x + c) * CELL + 1, by * CELL + 1, CELL - 2, CELL - 2); }
        }));
      }
    }
    function tick() {
      if (over) return;
      if (!collides(current.shape, current.x, current.y + 1)) current.y++;
      else lockPiece();
      draw();
    }
    function scheduleTick() {
      dropTimer = setTimeout(() => { tick(); if (!over) scheduleTick(); }, dropInterval);
    }
    function onKey(e) {
      if (over || paused) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      if (e.key === 'ArrowLeft') move(-1);
      else if (e.key === 'ArrowRight') move(1);
      else if (e.key === 'ArrowUp') rotate();
      else if (e.key === 'ArrowDown') softDrop();
      else if (e.key === ' ') hardDrop();
      draw();
    }
    function reset() {
      board = emptyBoard(); score = 0; level = 1; linesCleared = 0; over = false;
      dropInterval = TETRIS_START[tetrisPace] || 600;
      spawn();
      status.textContent = `Score: 0   Level: 1   Best: ${getBest('tetris')}`;
      draw();
    }

    window.addEventListener('keydown', onKey);
    reset();
    scheduleTick();

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Arrows to move/rotate/soft-drop, Space to hard-drop.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { clearTimeout(dropTimer); window.removeEventListener('keydown', onKey); },
      pause: () => { clearTimeout(dropTimer); dropTimer = null; paused = true; },
      resume: () => { paused = false; if (!over) scheduleTick(); },
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Level', value: level },
        { label: 'Lines cleared', value: linesCleared },
        { label: 'Status', value: over ? 'Game over' : 'In play' }
      ],
      options: () => [
        { key: 'palette', label: 'Colors', value: tetrisPalette, restart: true,
          choices: [
            { value: 'classic', label: 'Classic' },
            { value: 'pastel', label: 'Pastel' },
            { value: 'neon', label: 'Neon' },
            { value: 'mono', label: 'Mono' }
          ] },
        { key: 'pace', label: 'Start pace', value: tetrisPace, restart: true,
          choices: [
            { value: 'chill', label: 'Chill' },
            { value: 'normal', label: 'Normal' },
            { value: 'brisk', label: 'Brisk' },
            { value: 'turbo', label: 'Turbo' }
          ] }
      ]
    };
  }

  // --- Checkers (vs a simple AI) ---
  function initCheckers(root) {
    const SIZE = 8;
    let board, turn, selected, over, validDestinations;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const boardEl = document.createElement('div');
    boardEl.className = 'checkers-board';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'Restart';
    resetBtn.style.marginTop = '6px';

    function isDark(r, c) { return (r + c) % 2 === 1; }
    function setup() {
      board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
      for (let r = 0; r < 3; r++) for (let c = 0; c < SIZE; c++) if (isDark(r, c)) board[r][c] = { color: 'black', king: false };
      for (let r = 5; r < 8; r++) for (let c = 0; c < SIZE; c++) if (isDark(r, c)) board[r][c] = { color: 'red', king: false };
    }
    function pieceMoves(r, c) {
      const piece = board[r][c];
      if (!piece) return [];
      const dirs = piece.king ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : (piece.color === 'red' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
      const moves = [];
      dirs.forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) {
          if (!board[nr][nc]) moves.push({ toR: nr, toC: nc, capture: null });
          else if (board[nr][nc].color !== piece.color) {
            const jr = nr + dr, jc = nc + dc;
            if (jr >= 0 && jr < SIZE && jc >= 0 && jc < SIZE && !board[jr][jc]) moves.push({ toR: jr, toC: jc, capture: { r: nr, c: nc } });
          }
        }
      });
      return moves;
    }
    function allMoves(color) {
      const all = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (board[r][c] && board[r][c].color === color) pieceMoves(r, c).forEach((m) => all.push({ from: { r, c }, ...m }));
      }
      return all;
    }
    function applyMove(from, move) {
      const piece = board[from.r][from.c];
      board[from.r][from.c] = null;
      if (move.capture) board[move.capture.r][move.capture.c] = null;
      board[move.toR][move.toC] = piece;
      if (!piece.king && ((piece.color === 'red' && move.toR === 0) || (piece.color === 'black' && move.toR === SIZE - 1))) piece.king = true;
    }
    function countPieces(color) {
      let n = 0;
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (board[r][c] && board[r][c].color === color) n++;
      return n;
    }
    function render() {
      boardEl.innerHTML = '';
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'checkers-cell ' + (isDark(r, c) ? 'dark' : 'light');
        if (selected && selected.r === r && selected.c === c) cell.classList.add('selected');
        if (validDestinations && validDestinations.some((m) => m.toR === r && m.toC === c)) cell.classList.add('valid-move');
        const piece = board[r][c];
        if (piece) {
          const p = document.createElement('div');
          p.className = 'checkers-piece ' + piece.color;
          if (piece.king) { p.textContent = '♛'; p.style.color = piece.color === 'red' ? '#fff' : '#f5c518'; }
          cell.appendChild(p);
        }
        cell.addEventListener('click', () => handleClick(r, c));
        boardEl.appendChild(cell);
      }
    }
    function checkGameOver() {
      if (countPieces('black') === 0) { over = true; status.textContent = '🎉 You win! All black pieces captured.'; return; }
      if (countPieces('red') === 0) { over = true; status.textContent = 'AI wins! All your pieces are gone.'; return; }
    }
    function handleClick(r, c) {
      if (over || turn !== 'red') return;
      const piece = board[r][c];
      if (piece && piece.color === 'red') {
        selected = { r, c };
        validDestinations = pieceMoves(r, c);
        render();
        return;
      }
      if (selected && validDestinations) {
        const move = validDestinations.find((m) => m.toR === r && m.toC === c);
        if (move) {
          applyMove(selected, move);
          selected = null; validDestinations = null;
          render();
          checkGameOver();
          if (!over) { turn = 'black'; status.textContent = "AI's turn…"; setTimeout(aiTurn, 400); }
          return;
        }
      }
      selected = null; validDestinations = null;
      render();
    }
    function aiTurn() {
      const moves = allMoves('black');
      if (!moves.length) { over = true; status.textContent = '🎉 You win! AI has no moves left.'; return; }
      const captures = moves.filter((m) => m.capture);
      const pool = captures.length ? captures : moves;
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      applyMove(chosen.from, chosen);
      render();
      checkGameOver();
      if (!over) { turn = 'red'; status.textContent = 'Your turn (Red) — pick a piece'; }
    }
    function reset() {
      setup();
      turn = 'red'; selected = null; validDestinations = null; over = false;
      status.textContent = 'Your turn (Red) — pick a piece';
      render();
    }

    resetBtn.addEventListener('click', reset);
    reset();
    root.appendChild(status);
    root.appendChild(boardEl);
    root.appendChild(resetBtn);

    return {
      stats: () => [
        { label: 'Your pieces', value: countPieces('red') },
        { label: 'AI pieces', value: countPieces('black') },
        { label: 'Turn', value: over ? 'Finished' : (turn === 'red' ? 'Yours' : 'AI') }
      ]
    };
  }

  // --- Sudoku ---
  function initSudoku(root) {
    let solved, puzzle, given, selected, over;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const grid = document.createElement('div');
    grid.className = 'sudoku-grid';
    const numRow = document.createElement('div');
    numRow.className = 'sudoku-numrow';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'New puzzle';
    resetBtn.style.marginTop = '6px';

    function generateSolvedGrid() {
      const g = Array.from({ length: 9 }, () => Array(9).fill(0));
      function isValid(gr, r, c, val) {
        for (let i = 0; i < 9; i++) if (gr[r][i] === val || gr[i][c] === val) return false;
        const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
        for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) if (gr[br + dr][bc + dc] === val) return false;
        return true;
      }
      function fill(pos) {
        if (pos === 81) return true;
        const r = Math.floor(pos / 9), c = pos % 9;
        const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
        for (const n of nums) {
          if (isValid(g, r, c, n)) {
            g[r][c] = n;
            if (fill(pos + 1)) return true;
            g[r][c] = 0;
          }
        }
        return false;
      }
      fill(0);
      return g;
    }
    function makePuzzle(solvedGrid, removeCount) {
      const p = solvedGrid.map((row) => [...row]);
      let removed = 0;
      while (removed < removeCount) {
        const r = Math.floor(Math.random() * 9), c = Math.floor(Math.random() * 9);
        if (p[r][c] !== 0) { p[r][c] = 0; removed++; }
      }
      return p;
    }
    function conflicts(g, r, c, val) {
      if (!val) return false;
      for (let i = 0; i < 9; i++) {
        if (i !== c && g[r][i] === val) return true;
        if (i !== r && g[i][c] === val) return true;
      }
      const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
      for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
        const rr = br + dr, cc = bc + dc;
        if ((rr !== r || cc !== c) && g[rr][cc] === val) return true;
      }
      return false;
    }
    function render() {
      grid.innerHTML = '';
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const cell = document.createElement('div');
        cell.className = 'sudoku-cell';
        if (given[r][c]) cell.classList.add('given');
        if (selected && selected.r === r && selected.c === c) cell.classList.add('selected');
        if ((c + 1) % 3 === 0 && c !== 8) cell.classList.add('border-right');
        if ((r + 1) % 3 === 0 && r !== 8) cell.classList.add('border-bottom');
        const val = puzzle[r][c];
        if (val) {
          cell.textContent = val;
          if (!given[r][c] && conflicts(puzzle, r, c, val)) cell.classList.add('conflict');
        }
        cell.addEventListener('click', () => {
          if (given[r][c] || over) return;
          selected = { r, c };
          render();
        });
        grid.appendChild(cell);
      }
    }
    function checkWin() {
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        if (!puzzle[r][c]) return false;
        if (conflicts(puzzle, r, c, puzzle[r][c])) return false;
      }
      return true;
    }
    function placeNumber(n) {
      if (!selected || over) return;
      const { r, c } = selected;
      if (given[r][c]) return;
      puzzle[r][c] = n;
      render();
      if (checkWin()) { over = true; status.textContent = '🎉 Solved! Great job.'; }
      else status.textContent = 'Fill in the grid — tap a cell, then a number.';
    }
    for (let n = 1; n <= 9; n++) {
      const btn = document.createElement('button');
      btn.className = 'gpa-btn sudoku-num';
      btn.textContent = String(n);
      btn.addEventListener('click', () => placeNumber(n));
      numRow.appendChild(btn);
    }
    const clearBtn = document.createElement('button');
    clearBtn.className = 'gpa-btn sudoku-num';
    clearBtn.textContent = '✕';
    clearBtn.addEventListener('click', () => placeNumber(0));
    numRow.appendChild(clearBtn);

    function reset() {
      solved = generateSolvedGrid();
      puzzle = makePuzzle(solved, 44);
      given = puzzle.map((row) => row.map((v) => v !== 0));
      selected = null; over = false;
      status.textContent = 'Fill in the grid — tap a cell, then a number.';
      render();
    }

    resetBtn.addEventListener('click', reset);
    reset();
    root.appendChild(status);
    root.appendChild(grid);
    root.appendChild(numRow);
    root.appendChild(resetBtn);

    return {
      stats: () => {
        let filled = 0, blanks = 0, conflictCount = 0;
        for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
          if (puzzle[r][c]) {
            filled++;
            if (!given[r][c] && conflicts(puzzle, r, c, puzzle[r][c])) conflictCount++;
          } else blanks++;
        }
        return [
          { label: 'Filled', value: `${filled} / 81` },
          { label: 'Blanks left', value: blanks },
          { label: 'Conflicts', value: conflictCount },
          { label: 'Status', value: over ? 'Solved' : 'In progress' }
        ];
      }
    };
  }

  const GAME_LOADERS = {
    ttt: initTTT, rps: initRPS, memory: initMemory, snake: initSnake,
    '2048': init2048, whack: initWhack, guess: initGuess, hangman: initHangman,
    wordle: initWordle, connect4: initConnect4, minesweeper: initMinesweeper,
    simon: initSimon, breakout: initBreakout, flappy: initFlappy,
    scramble: initScramble, reaction: initReaction,
    tetris: initTetris, checkers: initCheckers, sudoku: initSudoku
  };

  const GAME_LABELS = {
    ttt: 'Tic-Tac-Toe', rps: 'Rock Paper Scissors', memory: 'Memory Match', snake: 'Snake',
    '2048': '2048', whack: 'Whack-a-Mole', guess: 'Guess the Number', hangman: 'Hangman',
    wordle: 'Wordle', connect4: 'Connect 4', minesweeper: 'Minesweeper', simon: 'Simon',
    breakout: 'Breakout', flappy: 'Flappy', scramble: 'Word Scramble', reaction: 'Reaction Test',
    tetris: 'Tetris', checkers: 'Checkers', sudoku: 'Sudoku'
  };

  const gameStage = panel.querySelector('#gpa-game-stage');
  const pauseMenu = panel.querySelector('#gpa-game-pausemenu');
  const pauseStatsEl = panel.querySelector('#gpa-pause-stats');
  const pauseBtn = panel.querySelector('#gpa-game-pause');
  const fullscreenBtn = panel.querySelector('#gpa-game-fullscreen');

  let currentGameId = 'ttt';

  function renderPauseStats() {
    const rows = [];
    rows.push({ label: 'Game', value: GAME_LABELS[currentGameId] || currentGameId });
    rows.push({ label: 'Time played', value: formatElapsed(gameElapsedSeconds()) });
    // Per-game stats, if the game exposes them.
    if (activeGameControls && typeof activeGameControls.stats === 'function') {
      try {
        const custom = activeGameControls.stats() || [];
        custom.forEach((s) => rows.push(s));
      } catch (e) { /* a broken stats fn shouldn't break the pause menu */ }
    }
    const best = getBest(currentGameId);
    if (best) rows.push({ label: 'Best score', value: String(best) });

    pauseStatsEl.innerHTML = rows.map((r) =>
      `<div class="gpa-pause-stat"><span class="gpa-pause-stat-label">${escapeHtml(r.label)}</span><span class="gpa-pause-stat-value">${escapeHtml(String(r.value))}</span></div>`
    ).join('');
    renderGameOptions();
  }

  // Renders whatever options the active game exposes. Changing one applies
  // live where the game supports it, or on the next restart otherwise.
  function renderGameOptions() {
    const optsEl = panel.querySelector('#gpa-pause-options');
    if (!optsEl) return;
    optsEl.innerHTML = '';
    const defs = (activeGameControls && typeof activeGameControls.options === 'function')
      ? (activeGameControls.options() || [])
      : [];
    if (!defs.length) return;

    defs.forEach((def) => {
      const row = document.createElement('div');
      row.className = 'gpa-pause-optrow';
      const label = document.createElement('span');
      label.className = 'gpa-pause-optlabel';
      label.textContent = def.label;
      row.appendChild(label);

      const select = document.createElement('select');
      select.className = 'gpa-pause-optselect';
      def.choices.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.textContent = c.label;
        if (String(c.value) === String(def.value)) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => {
        setGameOpt(currentGameId, def.key, select.value);
        if (typeof def.onChange === 'function') def.onChange(select.value);
        if (def.restart) loadGame(currentGameId);
      });
      row.appendChild(select);
      optsEl.appendChild(row);
    });

    const applyRow = document.createElement('div');
    applyRow.className = 'gpa-pause-optrow';
    const note = document.createElement('span');
    note.className = 'gpa-pause-optlabel';
    note.textContent = 'Apply options';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'gpa-pause-optbtn';
    applyBtn.textContent = 'Restart now';
    applyBtn.addEventListener('click', () => loadGame(currentGameId));
    applyRow.appendChild(note);
    applyRow.appendChild(applyBtn);
    optsEl.appendChild(applyRow);
  }

  function pauseGame() {
    if (isGamePaused) return;
    isGamePaused = true;
    gamePausedAt = Date.now();
    if (activeGameControls && typeof activeGameControls.pause === 'function') {
      try { activeGameControls.pause(); } catch (e) { /* ignore */ }
    }
    renderPauseStats();
    pauseMenu.style.display = 'flex';
    pauseBtn.textContent = '▶ Resume';
  }

  function resumeGame() {
    if (!isGamePaused) return;
    isGamePaused = false;
    gamePausedTotal += Date.now() - gamePausedAt;
    gamePausedAt = 0;
    if (activeGameControls && typeof activeGameControls.resume === 'function') {
      try { activeGameControls.resume(); } catch (e) { /* ignore */ }
    }
    pauseMenu.style.display = 'none';
    pauseBtn.textContent = '⏸ Pause';
  }

  function togglePause() { isGamePaused ? resumeGame() : pauseGame(); }

  function loadGame(id) {
    currentGameId = id;
    stopActiveGame();
    // Reset pause state for the new game.
    isGamePaused = false;
    gamePausedTotal = 0;
    gamePausedAt = 0;
    pauseMenu.style.display = 'none';
    pauseBtn.textContent = '⏸ Pause';
    gameStartedAt = Date.now();

    gameFit.innerHTML = '';
    gameFit.style.transform = 'none';
    gameBtns.forEach((b) => b.classList.toggle('primary', b.dataset.game === id));
    const loader = GAME_LOADERS[id];
    if (!loader) return;
    const returned = loader(gameFit);
    // Normalize both possible return shapes into one controls object.
    activeGameControls = typeof returned === 'function'
      ? { cleanup: returned }
      : (returned && typeof returned === 'object' ? returned : {});
    // Let layout settle before measuring, then scale to fit.
    requestAnimationFrame(fitGameToStage);
  }

  gameBtns.forEach((btn) => btn.addEventListener('click', () => loadGame(btn.dataset.game)));
  panel.querySelector('#gpa-game-restart').addEventListener('click', () => loadGame(currentGameId));
  panel.querySelector('#gpa-pause-restart').addEventListener('click', () => loadGame(currentGameId));
  panel.querySelector('#gpa-pause-resume').addEventListener('click', resumeGame);
  pauseBtn.addEventListener('click', togglePause);

  // ---- Match timer (toggled with "T") ----
  const gameTimerEl = panel.querySelector('#gpa-game-timer');
  let timerVisible = false;
  let timerTick = null;

  function refreshGameTimer() {
    if (!timerVisible) return;
    gameTimerEl.textContent = formatElapsed(gameElapsedSeconds());
  }
  function toggleGameTimer() {
    timerVisible = !timerVisible;
    gameTimerEl.style.display = timerVisible ? 'block' : 'none';
    if (timerVisible) {
      refreshGameTimer();
      if (!timerTick) timerTick = setInterval(refreshGameTimer, 500);
    } else if (timerTick) {
      clearInterval(timerTick);
      timerTick = null;
    }
  }

  // Keyboard shortcuts for the Games tab: P = pause/resume, R = restart,
  // T = show/hide the match timer. All share the same guards — ignored while
  // typing, ignored with modifier keys, and only while the Games tab is open.
  // They work in fullscreen too, since the listener is on window.
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k !== 'p' && k !== 'r' && k !== 't') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const gamesPane = panel.querySelector('.gpa-pane[data-pane="games"]');
    if (!gamesPane || !gamesPane.classList.contains('active')) return;
    // Don't steal the key from a text field (inside the panel or on the page).
    const activeEl = root.activeElement || document.activeElement;
    if (activeEl) {
      const tag = (activeEl.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || activeEl.isContentEditable) return;
    }
    e.preventDefault();
    if (k === 'p') togglePause();
    else if (k === 'r') loadGame(currentGameId);
    else if (k === 't') toggleGameTimer();
  });

  // Fullscreen the game stage (works from inside the shadow DOM).
  fullscreenBtn.addEventListener('click', () => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const req = gameStage.requestFullscreen || gameStage.webkitRequestFullscreen;
      if (req) req.call(gameStage).catch(() => { /* page may block fullscreen */ });
    }
  });
  function syncFullscreenLabel() {
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fullscreenBtn.textContent = active ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
    // Entering/leaving fullscreen changes the available area — refit.
    requestAnimationFrame(fitGameToStage);
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitGameToStage));
  document.addEventListener('fullscreenchange', syncFullscreenLabel);
  document.addEventListener('webkitfullscreenchange', syncFullscreenLabel);

  loadGame('ttt');

  // ---- Account / sync controls in Settings ---------------------------------
  const syncBox = panel.querySelector('#gpa-sync-box');
  const cloudMsg = panel.querySelector('#gpa-cloud-msg');
  const cloudBinInput = panel.querySelector('#gpa-cloud-bin');
  const cloudKeyInput = panel.querySelector('#gpa-cloud-key');

  panel.querySelector('#gpa-logout-btn').addEventListener('click', () => {
    saveProgress();
    currentUser = null;
    localStorage.removeItem(SESSION_KEY);
    refreshAccountUI();
    loginUserInput.value = '';
    loginPinInput.value = '';
    showLoginMsg('Signed out — your progress is saved.');
    loginOverlay.style.display = 'flex';
    setLockedChrome(true);
  });

  panel.querySelector('#gpa-sync-export').addEventListener('click', () => {
    saveProgress();
    const code = encodeSyncCode(buildSyncPayload());
    syncBox.value = code;
    syncBox.focus();
    syncBox.select();
    try {
      navigator.clipboard.writeText(code);
      cloudMsg.textContent = 'Sync code copied — paste it on your other device.';
    } catch (e) {
      cloudMsg.textContent = 'Sync code ready above — copy it manually.';
    }
  });

  panel.querySelector('#gpa-sync-import').addEventListener('click', () => {
    const code = syncBox.value.trim();
    if (!code) { cloudMsg.textContent = 'Paste a sync code into the box first.'; return; }
    try {
      const payload = decodeSyncCode(code);
      if (!payload || !payload.data) throw new Error('bad payload');
      applyState(payload.data);
      saveProgress();
      reapplyAllSettings();
      cloudMsg.textContent = 'Progress loaded from sync code.';
    } catch (e) {
      cloudMsg.textContent = "That doesn't look like a valid sync code.";
    }
  });

  // ---- Optional cloud auto-sync (JSONBin) ----
  // Credentials are entered here at runtime and kept in localStorage on this
  // device only — deliberately never hard-coded, so a public repo copy of
  // this script carries no secrets.
  function cloudCreds() {
    const bin = (cloudBinInput.value || '').trim();
    const key = (cloudKeyInput.value || '').trim();
    if (bin) localStorage.setItem(CLOUD_BIN_KEY, bin);
    if (key) localStorage.setItem(CLOUD_SECRET_KEY, key);
    return { bin, key };
  }

  panel.querySelector('#gpa-cloud-push').addEventListener('click', async () => {
    const { bin, key } = cloudCreds();
    if (!bin || !key) { cloudMsg.textContent = 'Enter both a Bin ID and an X-Master-Key.'; return; }
    saveProgress();
    cloudMsg.textContent = 'Uploading…';
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${encodeURIComponent(bin)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': key },
        body: JSON.stringify(buildSyncPayload())
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cloudMsg.textContent = `Uploaded at ${new Date().toLocaleTimeString()}.`;
    } catch (e) {
      cloudMsg.textContent = 'Upload failed: ' + e.message;
    }
  });

  panel.querySelector('#gpa-cloud-pull').addEventListener('click', async () => {
    const { bin, key } = cloudCreds();
    if (!bin || !key) { cloudMsg.textContent = 'Enter both a Bin ID and an X-Master-Key.'; return; }
    cloudMsg.textContent = 'Downloading…';
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${encodeURIComponent(bin)}/latest`, {
        headers: { 'X-Master-Key': key }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const payload = json && (json.record || json);
      if (!payload || !payload.data) throw new Error('no saved data in that bin');
      applyState(payload.data);
      saveProgress();
      reapplyAllSettings();
      cloudMsg.textContent = 'Progress downloaded and applied.';
    } catch (e) {
      cloudMsg.textContent = 'Download failed: ' + e.message;
    }
  });

  // ---- Session restore on load ----
  // If this browser already had someone signed in, skip straight back in.
  (function restoreSession() {
    const savedUser = localStorage.getItem(SESSION_KEY);
    if (savedUser && readProfile(savedUser)) {
      enterApp(savedUser);
    } else {
      localStorage.removeItem(SESSION_KEY);
      loginOverlay.style.display = 'flex';
      setLockedChrome(true);
      refreshAccountUI();
    }
  })();

})();
