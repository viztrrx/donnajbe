/*!
 * Agent Console CORE HUB
 * -------------------------------------------------------------
 * This is the central orchestrator. It handles the UI, Shadow DOM,
 * AI Providers, and the Module Loading system.
 */
(function () {
  'use strict';

  // ---- Global Hub Object ----------------------------------------------------
  window.GPA_HUB = {
    state: {
      theme: 'matte',
      currentUser: null,
      panelSize: 'normal',
      provider: 'gemini',
      typeSpeed: 'normal',
      font: 'mono',
      miniIcon: 'dot',
      miniLook: 'futuristic',
      miniColorMode: 'theme',
      particleStyle: 'off',
      particleMargin: 40,
    },

    // UI References
    ui: {
      host: null,
      root: null,
      panel: null,
      dropdown: null,
      body: null,
      style: null,
      mini: null,
    },

    // API for Modules to use
    api: {
      addTab(id, label, renderFn) {
        const { dropdown, body } = GPA_HUB.ui;
        const item = document.createElement('button');
        item.className = 'gpa-dropdown-item';
        item.dataset.tab = id;
        item.textContent = label;
        item.addEventListener('click', () => GPA_HUB.UI.switchTab(id));
        dropdown.querySelector('.gpa-dropdown-menu').appendChild(item);
        const pane = document.createElement('div');
        pane.className = 'gpa-pane';
        pane.dataset.pane = id;
        body.appendChild(pane);
        renderFn(pane);
        console.log(`[Hub] Registered tab: ${label}`);
      },

      async ask(prompt, system = '', images = null) {
        const provider = localStorage.getItem('gpa_ai_provider') || 'gemini';
        const result = provider === 'openai'
          ? await this._callOpenAI(prompt, system, images)
          : await this._callGemini(prompt, system, images);
        const { text, confidence, highlight } = this._parseAIResponse(result);
        return { text, confidence, highlight };
      },

      _parseAIResponse(text) {
        const { text: t1, value: highlight } = GPA_HUB.Utils.extractTrailingLine(text, 'HIGHLIGHT');
        const { text: cleanText, confidence } = GPA_HUB.Utils.extractConfidenceLine(t1);
        return { text: cleanText, confidence, highlight };
      },

      async _callGemini(userText, systemText, imageDataUrls) {
        const key = localStorage.getItem('gpa_gemini_api_key') || '';
        if (!key) throw new Error('No Gemini API key.');
        const parts = [];
        if (userText) parts.push({ text: userText });
        if (imageDataUrls) {
          imageDataUrls.forEach(url => {
            const m = url.match(/^data:(.+);base64,(.*)$/);
            if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
          });
        }
        const body = { contents: [{ role: 'user', parts }] };
        if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '(no response)';
      },

      async _callOpenAI(userText, systemText, imageDataUrls) {
        const key = localStorage.getItem('gpa_openai_api_key');
        if (!key) throw new Error('No OpenAI API key.');
        const content = [];
        if (userText) content.push({ type: 'text', text: userText });
        if (imageDataUrls) {
          imageDataUrls.forEach(url => content.push({ type: 'image_url', image_url: { url } }));
        }
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: [
            ...(systemText ? [{ role: 'system', content: systemText }] : []),
            { role: 'user', content }
          ]})
        });
        const data = await res.json();
        return data?.choices?.[0]?.message?.content || '(no response)';
      }
    },

    UI: {
      switchTab(id) {
        const { dropdown, body } = GPA_HUB.ui;
        dropdown.querySelectorAll('.gpa-dropdown-item').forEach(i => i.classList.toggle('active', i.dataset.tab === id));
        body.querySelectorAll('.gpa-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === id));
        dropdown.querySelector('#gpa-dropdown-label').textContent =
          dropdown.querySelector(`.gpa-dropdown-item[data-tab="${id}"]`).textContent;
        dropdown.classList.remove('open');
      },

      applyTheme(name) {
        const t = GPA_HUB.Themes[name] || GPA_HUB.Themes.matte;
        GPA_HUB.ui.style.textContent = GPA_HUB.UI.getThemeCSS(t);
      },

      getThemeCSS(t) {
        return `
          * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .gpa-panel {
            width: 360px; height: 480px; display: flex; flex-direction: column;
            background: linear-gradient(160deg, ${t.panel}ee 0%, ${t.bg}f2 100%);
            color: ${t.text}; border: 1px solid ${t.accent}70;
            clip-path: polygon(22px 0, 100% 0, 100% calc(100% - 22px), calc(100% - 22px) 100%, 0 100%, 0 22px);
            backdrop-filter: blur(16px) saturate(150%); box-shadow: 0 20px 50px rgba(0,0,0,0.55);
            overflow: hidden; user-select: none;
          }
          .gpa-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: linear-gradient(90deg, ${t.accent}18, transparent 60%); cursor: grab; border-bottom: 1px solid ${t.accent}44; }
          .gpa-title { font-size: 10.5px; font-weight: 700; letter-spacing: 1.4px; flex: 1; text-transform: uppercase; font-family: 'JetBrains Mono', monospace; color: ${t.text}; }
          .gpa-body { padding: 10px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
          .gpa-dropdown { position: relative; margin-bottom: 10px; }
          .gpa-dropdown-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; cursor: pointer; color: ${t.text}; border: 1px solid ${t.accent}55; background: linear-gradient(180deg, ${t.field}, ${t.panel}); }
          .gpa-dropdown-menu { position: static; display: flex; gap: 4px; flex-wrap: wrap; }
          .gpa-dropdown-item { flex: 1; min-width: 58px; text-align: center; padding: 7px 3px; font-size: 9px; font-weight: 700; color: ${t.sub}; background: ${t.field}; border: 1px solid ${t.accent}35; cursor: pointer; }
          .gpa-dropdown-item.active { color: #fff; background: ${t.accent}; border-color: ${t.accent}; box-shadow: 0 0 12px ${t.accent}77; }
          .gpa-pane { display: none; flex-direction: column; flex: 1; }
          .gpa-pane.active { display: flex; }
          .gpa-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
          .gpa-input { flex: 1; padding: 7px 9px; border-radius: 5px; border: 1px solid ${t.border}; background: ${t.field}; color: ${t.text}; font-size: 12.5px; outline: none; font-family: 'JetBrains Mono', monospace; }
          .gpa-btn { padding: 7px 10px; border: 1px solid ${t.border}; background: ${t.field}; color: ${t.text}; font-size: 10.5px; font-weight: 700; text-transform: uppercase; cursor: pointer; }
          .gpa-btn.primary { background: ${t.accent}; color: #fff; border-color: ${t.accent}; }
          .gpa-sub { color: ${t.sub}; font-size: 10px; flex: 1; font-family: 'JetBrains Mono', monospace; }
          .gpa-output { margin-top: 6px; flex: 0 1 auto; max-height: 260px; overflow-y: auto; font-size: 12.5px; line-height: 1.6; padding: 8px; background: ${t.field}; border-radius: 6px; border: 1px solid ${t.accent}40; font-family: 'JetBrains Mono', monospace; }
        `;
      }
    },

    Themes: {
      dark: { bg: '#0b0b0f', panel: '#16161c', field: '#1e1e26', text: '#eaeaf0', sub: '#9a9aa8', accent: '#5b8cff', border: '#26262f' },
      matte: { bg: '#131313', panel: '#1a1a1a', field: '#222222', text: '#e6e6e6', sub: '#9c9c9c', accent: '#b0b0b0', border: '#2b2b2b' },
    },

    Utils: {
      extractTrailingLine(text, label) {
        const re = new RegExp(`\\n?\\s*${label}:\\s*(.+?)\\s*$`, 'i');
        const m = text.match(re);
        if (!m) return { text, value: null };
        return { text: text.slice(0, m.index).trim(), value: m[1].trim() };
      },
      extractConfidenceLine(text) {
        const match = text.match(/\\n?\\s*CONFIDENCE:\\s*(\\d{1,3})\\s*%?\\s*$/i);
        if (!match) return { text, confidence: null };
        return { text: text.slice(0, match.index).trim(), confidence: parseInt(match[1], 10) };
      },
      escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;'); }
    }
  };

  async function initHub() {
    const host = document.createElement('div');
    host.id = 'gpa-root-host';
    host.style.cssText = 'all:initial; position:fixed; top:80px; left:80px; z-index:2147483647;';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    const particleWrap = document.createElement('div');
    particleWrap.className = 'gpa-particle-wrap';
    const panel = document.createElement('div');
    panel.className = 'gpa-panel';
    panel.innerHTML = `
      <div class="gpa-header" id="gpa-drag">
        <span class="gpa-title">Agent Console</span>
        <button id="gpa-close" style="background:none; border:none; color:white; cursor:pointer;">&times;</button>
      </div>
      <div class="gpa-body" id="gpa-body">
        <div class="gpa-dropdown" id="gpa-dropdown">
          <button class="gpa-dropdown-btn" id="gpa-dropdown-btn">
            <span id="gpa-dropdown-label">Hub</span>
            <svg class="gpa-chevron" viewBox="0 0 20 20" width="13" height="13"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="gpa-dropdown-menu"></div>
        </div>
        <div id="gpa-main-content" style="flex:1; display:flex; flex-direction:column;"></div>
      </div>
    `;
    particleWrap.appendChild(panel);
    root.appendChild(style);
    root.appendChild(particleWrap);
    GPA_HUB.ui.host = host;
    GPA_HUB.ui.root = root;
    GPA_HUB.ui.panel = panel;
    GPA_HUB.ui.style = style;
    GPA_HUB.ui.body = panel.querySelector('#gpa-body');
    GPA_HUB.ui.dropdown = panel.querySelector('#gpa-dropdown');
    GPA_HUB.UI.applyTheme('matte');
    panel.querySelector('#gpa-close').onclick = () => host.remove();
    await loadManifest();
  }

  async function loadManifest() {
    const manifest = {
      modules: [
        { name: 'Insights', url: 'https://raw.githubusercontent.com/viztrrx/donnajbe/main/modules/automation.js' },
        { name: 'Games', url: 'https://raw.githubusercontent.com/viztrrx/donnajbe/main/modules/games.js' },
        { name: 'Music', url: 'https://raw.githubusercontent.com/viztrrx/donnajbe/main/modules/music.js' },
        { name: 'Automation', url: 'https://raw.githubusercontent.com/viztrrx/donnajbe/main/modules/automation.js' },
      ]
    };
    for (const mod of manifest.modules) {
      await loadModule(mod.url, mod.name);
    }
  }

  async function loadModule(url, name) {
    try {
      const res = await fetch(url);
      const code = await res.text();
      const init = new Function('Hub', code);
      init(GPA_HUB);
      console.log(`[Hub] Loaded ${name}`);
    } catch (e) {
      console.error(`[Hub] Failed to load ${name}:`, e);
    }
  }

  initHub();
})();
