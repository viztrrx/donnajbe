(function() {
  const { ui, api } = Hub;

  api.addTab('music', 'Music', (pane) => {
    pane.innerHTML = `
      <div class="gpa-row">
        <input id="gpa-music-query" class="gpa-input" placeholder="Song name..." />
        <button id="gpa-music-search" class="gpa-btn primary">Play</button>
      </div>
      <div id="gpa-music-wrap" style="margin-top:10px; min-height:166px;"></div>
      <div class="gpa-sub" style="margin-top:10px;">Paste a SoundCloud link:</div>
      <div class="gpa-row">
        <input id="gpa-sc-url" class="gpa-input" placeholder="soundcloud.com/..." />
        <button id="gpa-sc-load" class="gpa-btn">Load</button>
      </div>
      <div id="gpa-sc-wrap" style="margin-top:10px;"></div>
    `;

    const musicWrap = pane.querySelector('#gpa-music-wrap');
    const scWrap = pane.querySelector('#gpa-sc-wrap');

    pane.querySelector('#gpa-music-search').onclick = async () => {
      const q = pane.querySelector('#gpa-music-query').value;
      const key = localStorage.getItem('gpa_youtube_api_key');
      if (!key) return alert('YouTube API Key missing!');

      try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(q)}&key=${key}`);
        const data = await res.json();
        const id = data.items[0].id.videoId;
        musicWrap.innerHTML = `<iframe width="100%" height="166" src="https://www.youtube.com/embed/${id}?autoplay=1" frameborder="0" allow="autoplay"></iframe>`;
      } catch (e) { alert('Error searching YouTube: ' + e.message); }
    };

    pane.querySelector('#gpa-sc-load').onclick = () => {
      const url = pane.querySelector('#gpa-sc-url').value;
      if (!url) return;
      scWrap.innerHTML = `<iframe width="100%" height="166" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}" frameborder="0" allow="autoplay"></iframe>`;
    };
  });
})();
