(function() {
  const { ui, api, Utils } = Hub;

  api.addTab('scan', 'Page Insights', (pane) => {
    pane.innerHTML = `
      <div class="gpa-row">
        <button id="gpa-quiz-btn" class="gpa-btn quiz-btn">✨ Solve quiz on this page</button>
      </div>
      <div class="gpa-row">
        <button id="gpa-scan-btn" class="gpa-btn">Scan page text</button>
        <button id="gpa-capture-btn" class="gpa-btn">Capture screen</button>
      </div>
      <div class="gpa-row">
        <button id="gpa-autofill-btn" class="gpa-btn primary">Auto-Fill Form</button>
      </div>
      <div class="gpa-row" id="gpa-status-row" style="display:none;">
        <img id="gpa-thumb" style="width:34px; height:34px; border-radius:6px; display:none;" />
        <span id="gpa-scan-status" class="gpa-sub"></span>
        <button id="gpa-clear-context" class="gpa-btn">Clear</button>
      </div>
      <div class="gpa-row gpa-actions" id="gpa-scan-actions" style="display:none;">
        <button class="gpa-btn primary" data-action="summarize">Summarize</button>
        <button class="gpa-btn primary" data-action="analyze">Analyze</button>
      </div>
      <div class="gpa-row" id="gpa-question-row" style="display:none;">
        <input id="gpa-question" class="gpa-input" placeholder="Ask a question about this page..." />
        <button id="gpa-question-btn" class="gpa-btn primary">Answer</button>
      </div>
      <div id="gpa-scan-output" class="gpa-output"></div>
    `;

    const scanOutput = pane.querySelector('#gpa-scan-output');
    let pageText = '';
    let screenshotDataUrl = '';

    function refreshStatus() {
      const parts = [];
      if (pageText) parts.push(`${pageText.length.toLocaleString()} chars`);
      if (screenshotDataUrl) parts.push('screenshot');
      const has = parts.length > 0;
      pane.querySelector('#gpa-status-row').style.display = has ? 'flex' : 'none';
      pane.querySelector('#gpa-scan-actions').style.display = has ? 'flex' : 'none';
      pane.querySelector('#gpa-question-row').style.display = has ? 'flex' : 'none';
      pane.querySelector('#gpa-scan-status').textContent = has ? parts.join(' + ') : '';
      const thumb = pane.querySelector('#gpa-thumb');
      thumb.style.display = screenshotDataUrl ? 'block' : 'none';
      thumb.src = screenshotDataUrl || '';
    }

    function extractPageText() {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,svg,canvas,iframe').forEach(el => el.remove());
      return (clone.innerText || clone.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 18000);
    }

    pane.querySelector('#gpa-scan-btn').onclick = () => {
      pageText = extractPageText();
      refreshStatus();
    };

    pane.querySelector('#gpa-capture-btn').onclick = async () => {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        screenshotDataUrl = canvas.toDataURL('image/png');
        stream.getTracks().forEach(t => t.stop());
        refreshStatus();
      } catch (e) { alert(e.message); }
    };

    pane.querySelector('#gpa-autofill-btn').onclick = async () => {
      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));
      const fieldInfo = inputs.map((el, i) => ({ id: i, label: el.placeholder || el.name || `Field ${i+1}` }));
      scanOutput.textContent = 'Filling...';
      try {
        const sys = 'Return ONLY a JSON array: [{"id":0, "v":"Value"}, ...].';
        const res = await api.ask(`FIELDS: ${JSON.stringify(fieldInfo)}\\nTEXT: ${pageText}`, sys);
        const mapping = JSON.parse(res.text);
        mapping.forEach(item => {
          const el = inputs[item.id];
          if (el) { el.value = item.v; el.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        scanOutput.textContent = 'Done!';
      } catch (e) { scanOutput.textContent = 'Error: ' + e.message; }
    };

    pane.querySelector('#gpa-quiz-btn').onclick = async () => {
      if (!pageText) pageText = extractPageText();
      scanOutput.textContent = 'Solving...';
      try {
        const sys = 'Respond with ONLY a JSON array: [{"q":"1","a":"B","c":85}].';
        const res = await api.ask(pageText, sys);
        const grid = JSON.parse(res.text);
        scanOutput.innerHTML = `<div class="gpa-answer-grid">` +
          grid.map(it => `<div class="gpa-grid-cell"><span class="gpa-grid-q">${it.q}</span><span class="gpa-grid-a">${it.a}</span></div>`).join('') +
          `</div>`;
      } catch (e) { scanOutput.textContent = 'Error: ' + e.message; }
    };

    pane.querySelectorAll('#gpa-scan-actions .gpa-btn').forEach(btn => {
      btn.onclick = async () => {
        const action = btn.dataset.action;
        const sys = action === 'summarize' ? 'Summarize this content. Plain text only.' : 'Analyze this content. Plain text only.';
        scanOutput.textContent = 'Thinking...';
        try {
          const res = await api.ask(pageText, sys, screenshotDataUrl ? [screenshotDataUrl] : null);
          scanOutput.textContent = res.text;
        } catch (e) { scanOutput.textContent = 'Error: ' + e.message; }
      };
    });
  });
})();
