(function() {
  const { ui, api } = Hub;

  api.addTab('games', 'Games', (pane) => {
    pane.innerHTML = `
      <div class="gpa-row" style="flex-wrap:wrap;">
        <button class="gpa-btn game-btn primary" data-game="snake">Snake</button>
        <button class="gpa-btn game-btn" data-game="ttt">Tic-Tac-Toe</button>
        <button class="gpa-btn game-btn" data-game="2048">2048</button>
        <button class="gpa-btn game-btn" data-game="rps">RPS</button>
      </div>
      <div id="gpa-game-stage" style="margin-top:10px; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:200px;">
        <div id="gpa-game-viewport"></div>
      </div>
    `;

    const viewport = pane.querySelector('#gpa-game-viewport');

    pane.querySelectorAll('.game-btn').forEach(btn => {
      btn.onclick = () => {
        viewport.innerHTML = '';
        const game = btn.dataset.game;
        if (game === 'snake') initSnake(viewport);
        if (game === 'ttt') initTTT(viewport);
        if (game === 'rps') initRPS(viewport);
        if (game === '2048') init2048(viewport);
      };
    });

    function initSnake(root) {
      const canvas = document.createElement('canvas');
      canvas.width = 208; canvas.height = 208;
      canvas.style.border = '1px solid #ccc';
      root.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      let snake = [{x:10,y:10}], dir={x:1,y:0}, food={x:5,y:5}, score=0;

      function loop() {
        const head = {x: snake[0].x + dir.x, y: snake[0].y + dir.y};
        if (head.x<0 || head.x>=13 || head.y<0 || head.y>=13) return alert('Game Over!');
        snake.unshift(head);
        if (head.x===food.x && head.y===food.y) { score++; food={x:Math.floor(Math.random()*13), y:Math.floor(Math.random()*13)}; }
        else snake.pop();

        ctx.fillStyle='black'; ctx.fillRect(0,0,208,208);
        ctx.fillStyle='red'; ctx.fillRect(food.x*16, food.y*16, 16, 16);
        ctx.fillStyle='green'; snake.forEach(s => ctx.fillRect(s.x*16, s.y*16, 16, 16));
        setTimeout(loop, 150);
      }
      window.onkeydown = (e) => {
        if(e.key==='ArrowUp') dir={x:0,y:-1}; if(e.key==='ArrowDown') dir={x:0,y:1};
        if(e.key==='ArrowLeft') dir={x:-1,y:0}; if(e.key==='ArrowRight') dir={x:1,y:0};
      };
      loop();
    }

    function initTTT(root) {
      const board = Array(9).fill(null);
      const el = document.createElement('div');
      el.style.display='grid'; el.style.gridTemplateColumns='repeat(3, 50px)';
      board.forEach((_, i) => {
        const cell = document.createElement('div');
        cell.style.width='50px'; cell.style.height='50px'; cell.style.border='1px solid #000';
        cell.onclick = () => { if(!board[i]) { board[i]='X'; cell.textContent='X'; } };
        el.appendChild(cell);
      });
      root.appendChild(el);
    }

    function initRPS(root) {
      const btn = document.createElement('button');
      btn.textContent = 'Rock Paper Scissors - Click to Play';
      btn.onclick = () => {
        const choices = ['Rock', 'Paper', 'Scissors'];
        const ai = choices[Math.floor(Math.random()*3)];
        alert('AI chose: ' + ai);
      };
      root.appendChild(btn);
    }

    function init2048(root) {
      root.innerHTML = '2048 Logic Loading...';
    }
  });
})();
