/**
 * 前端游戏逻辑模块（暗黑毛玻璃风格版本）
 * 处理WebSocket连接、消息收发、UI更新、视图切换、重连等功能
 */
(function() {
  /**
   * 应用状态对象
   */
  const state = {
    ws: null,
    connected: false,
    serverUrl: '',
    playerId: null,
    roomId: null,
    playerMark: null,
    match: null,
    round: null,
    myTurn: false,
    gameActive: false,
    reconnectTimer: null,
    moveTimerInterval: null,
    moveSecondsLeft: 30,
  };

  // DOM 元素（全局）
  const lobbyView = document.getElementById('lobby-view');
  const gameView = document.getElementById('game-view');
  const connectBtn = document.getElementById('connectBtn');
  const createRoomBtn = document.getElementById('createRoomBtn');
  const joinRoomBtn = document.getElementById('joinRoomBtn');
  const roomIdInput = document.getElementById('roomIdInput');
  const roomActions = document.getElementById('roomActions');
  const connectionStatus = document.getElementById('connectionStatus');
  const serverUrlInput = document.getElementById('serverUrl');

  // 游戏视图元素
  const quitBtn = document.getElementById('quitBtn');
  const roomWatermark = document.getElementById('roomWatermark');
  const scoreXEl = document.getElementById('scoreX');
  const scoreOEl = document.getElementById('scoreO');
  const turnIndicator = document.getElementById('turnIndicator');
  const boardCells = document.querySelectorAll('#board .cell');
  const surrenderBtn = document.getElementById('surrenderBtn');
  const chatHistory = document.getElementById('chatHistory');
  const chatInput = document.getElementById('chatInput');
  const sendChatBtn = document.getElementById('sendChatBtn');
  const timerDisplay = document.getElementById('timerDisplay'); // 未使用，保留占位
  const matchStatus = document.getElementById('matchStatus'); // 未用，但保留ID

  /**
   * 切换到大厅视图
   */
  function showLobby() {
    lobbyView.classList.remove('hidden');
    gameView.classList.add('hidden');
  }

  /**
   * 切换到游戏视图
   */
  function showGame() {
    lobbyView.classList.add('hidden');
    gameView.classList.remove('hidden');
  }

  /**
   * 重置游戏状态到初始
   */
  function resetGameState() {
    state.playerId = null;
    state.roomId = null;
    state.playerMark = null;
    state.match = null;
    state.round = null;
    state.myTurn = false;
    state.gameActive = false;
    stopMoveTimer();
    surrenderBtn.classList.add('hidden');
    updateBoard(Array(9).fill(''));
    turnIndicator.textContent = '等待对手加入';
    scoreXEl.textContent = '0';
    scoreOEl.textContent = '0';
    roomWatermark.textContent = 'Room: —';
    chatHistory.innerHTML = '';
  }

  /**
   * 退出并返回大厅
   */
  function quitRoom() {
    if (confirm('确定要退出房间吗？')) {
      if (state.ws) {
        state.ws.close();
      }
      stopReconnect();
      resetGameState();
      showLobby();
      connectionStatus.textContent = '未连接';
      connectionStatus.className = 'status disconnected';
      roomActions.style.display = 'none';
      state.connected = false;
    }
  }

  /**
   * 连接到WebSocket服务器
   */
  function connect() {
    const url = serverUrlInput.value.trim();
    if (!url) return alert('请输入服务器地址');
    state.serverUrl = url;
    state.ws = new WebSocket(url);
    state.ws.onopen = onOpen;
    state.ws.onmessage = onMessage;
    state.ws.onclose = onClose;
    state.ws.onerror = () => {
      connectionStatus.textContent = '连接错误';
      connectionStatus.className = 'status disconnected';
    };
  }

  /**
   * 连接成功回调
   */
  function onOpen() {
    state.connected = true;
    connectionStatus.textContent = '已连接';
    connectionStatus.className = 'status connected';
    roomActions.style.display = 'flex';
    // 保持在 lobby 视图，等待创建或加入
  }

  /**
   * 连接断开回调
   */
  function onClose() {
    state.connected = false;
    if (state.gameActive && state.playerId && state.roomId) {
      startReconnect();
    } else {
      // 未在游戏中，直接回到大厅
      showLobby();
      connectionStatus.textContent = '连接断开';
      connectionStatus.className = 'status disconnected';
      roomActions.style.display = 'none';
    }
  }

  /**
   * 发送消息到服务器
   * @param {string} type - 消息类型
   * @param {object} payload - 消息载荷
   */
  function send(type, payload = {}) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type, payload }));
    }
  }

  /**
   * 接收服务器消息处理
   * @param {MessageEvent} event - WebSocket消息事件
   */
  function onMessage(event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    const { type, payload } = msg;

    switch (type) {
      case 'ping':
        send('ping', {});
        break;

      case 'room_created':
        state.playerId = payload.playerId;
        state.roomId = payload.roomId;
        state.playerMark = payload.playerMark;
        roomWatermark.textContent = `Room: ${state.roomId}`;
        showGame();
        break;

      case 'join_success':
        state.playerId = payload.playerId;
        state.roomId = payload.roomId;
        state.playerMark = payload.playerMark;
        roomWatermark.textContent = `Room: ${state.roomId}`;
        showGame();
        if (payload.match) {
          state.match = payload.match;
          scoreXEl.textContent = payload.match.scores.X;
          scoreOEl.textContent = payload.match.scores.O;
        }
        if (payload.round) {
          syncRoundState(payload.round);
        }
        break;

      case 'join_failed':
        alert(`加入失败: ${payload.reason}`);
        break;

      case 'match_start':
        // 更新目标分数（如果需要）
        break;

      case 'round_start':
        state.round = payload;
        state.myTurn = (payload.turn === state.playerMark);
        state.gameActive = true;
        updateBoard(payload.board);
        updateTurnIndicator();
        surrenderBtn.classList.remove('hidden');
        startMoveTimer();
        break;

      case 'round_update':
        state.round = payload;
        state.myTurn = (payload.turn === state.playerMark);
        updateBoard(payload.board);
        updateTurnIndicator();
        resetMoveTimer();
        break;

      case 'round_end':
        state.gameActive = false;
        stopMoveTimer();
        state.match = { ...state.match, scores: payload.scores };
        scoreXEl.textContent = payload.scores.X;
        scoreOEl.textContent = payload.scores.O;
        turnIndicator.textContent = payload.winner === 'tie' ? '平局' : `${payload.winner} 获胜`;
        surrenderBtn.classList.add('hidden');
        break;

      case 'match_end':
        state.gameActive = false;
        state.match = { ...state.match, winner: payload.winner };
        scoreXEl.textContent = payload.finalScores.X;
        scoreOEl.textContent = payload.finalScores.O;
        turnIndicator.textContent = `${payload.winner} 赢得比赛！`;
        surrenderBtn.classList.add('hidden');
        stopMoveTimer();
        break;

      case 'move_rejected':
        alert(`无效落子: ${payload.reason}`);
        break;

      case 'reconnect_success':
        state.playerMark = payload.playerMark;
        stopReconnect();
        if (payload.match) {
          state.match = payload.match;
          scoreXEl.textContent = payload.match.scores.X;
          scoreOEl.textContent = payload.match.scores.O;
        }
        if (payload.round) syncRoundState(payload.round);
        connectionStatus.textContent = '已重连';
        connectionStatus.className = 'status connected';
        showGame();
        break;

      case 'reconnect_failed':
        alert(`重连失败: ${payload.reason}`);
        quitRoom();
        break;

      case 'chat':
        addChatMessage(payload.sender, payload.message, payload.timestamp);
        break;

      case 'error':
        alert(`错误: ${payload.message}`);
        break;
    }
  }

  /**
   * 同步轮次状态
   * @param {object} round - 轮次状态对象
   */
  function syncRoundState(round) {
    state.round = round;
    state.myTurn = (round.turn === state.playerMark);
    state.gameActive = round.state === 'PLAYING';
    updateBoard(round.board);
    updateTurnIndicator();
    if (state.gameActive) {
      surrenderBtn.classList.remove('hidden');
      startMoveTimer();
    } else {
      surrenderBtn.classList.add('hidden');
      stopMoveTimer();
    }
  }

  /**
   * 更新棋盘显示
   * @param {string[]} board - 棋盘数组
   */
  function updateBoard(board) {
    const b = board || Array(9).fill('');
    boardCells.forEach((cell, i) => {
      const mark = b[i];
      cell.textContent = mark === 'X' ? '✗' : (mark === 'O' ? '○' : '');
      cell.className = 'cell';
      if (mark === 'X') cell.classList.add('x');
      if (mark === 'O') cell.classList.add('o');
      if (!state.myTurn || mark !== '' || !state.gameActive) {
        cell.classList.add('disabled');
      } else {
        cell.classList.add('available'); // 可落子高亮
      }
    });
  }

  /**
   * 更新回合指示器
   */
  function updateTurnIndicator() {
    if (!state.round) return;
    if (state.gameActive) {
      turnIndicator.textContent = state.myTurn ? 'Your Turn' : `Opponent's Turn`;
    } else {
      turnIndicator.textContent = '等待…';
    }
  }

  /**
   * 启动移动计时器
   */
  function startMoveTimer() {
    stopMoveTimer();
    state.moveSecondsLeft = 30;
    state.moveTimerInterval = setInterval(() => {
      state.moveSecondsLeft--;
      if (state.moveSecondsLeft <= 0) {
        stopMoveTimer();
      }
    }, 1000);
  }

  /**
   * 重置移动计时器
   */
  function resetMoveTimer() {
    state.moveSecondsLeft = 30;
  }

  /**
   * 停止移动计时器
   */
  function stopMoveTimer() {
    if (state.moveTimerInterval) {
      clearInterval(state.moveTimerInterval);
      state.moveTimerInterval = null;
    }
  }

  /**
   * 开始自动重连
   */
  function startReconnect() {
    if (state.reconnectTimer) return;
    connectionStatus.textContent = '尝试重连...';
    state.reconnectTimer = setInterval(() => {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        stopReconnect();
        return;
      }
      attemptReconnect();
    }, 3000);
    attemptReconnect();
  }

  /**
   * 尝试重连
   */
  function attemptReconnect() {
    if (!state.serverUrl) return;
    const ws = new WebSocket(state.serverUrl);
    ws.onopen = () => {
      state.ws = ws;
      ws.onmessage = onMessage;
      ws.onclose = onClose;
      ws.onerror = () => {};
      send('reconnect', { playerId: state.playerId, roomId: state.roomId });
    };
  }

  /**
   * 停止自动重连
   */
  function stopReconnect() {
    if (state.reconnectTimer) {
      clearInterval(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }

  /**
   * 添加聊天消息到界面
   * @param {string} sender - 发送者标记
   * @param {string} message - 消息内容
   * @param {number} timestamp - 时间戳
   */
  function addChatMessage(sender, message, timestamp) {
    const div = document.createElement('div');
    div.className = `msg ${sender.toLowerCase()}-sender`;
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const senderMap = { X: 'Red', O: 'Blue', system: 'Sys' };
    div.innerHTML = `<span class="sender">[${senderMap[sender] || sender}]</span> ${message} <span class="time">${time}</span>`;
    chatHistory.appendChild(div);
    // 自动滚动到底部
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  // 事件绑定
  connectBtn.addEventListener('click', connect);
  createRoomBtn.addEventListener('click', () => send('create_room'));
  joinRoomBtn.addEventListener('click', () => {
    const rid = roomIdInput.value.trim();
    if (rid) send('join_room', { roomId: rid });
  });

  // 棋盘点击
  boardCells.forEach(cell => {
    cell.addEventListener('click', () => {
      if (!state.myTurn || !state.gameActive) return;
      const index = parseInt(cell.dataset.index);
      send('make_move', { index });
    });
  });

  // 投降按钮
  surrenderBtn.addEventListener('click', () => {
    if (confirm('确定要投降吗？')) send('surrender');
  });

  // 退出按钮
  quitBtn.addEventListener('click', quitRoom);

  // 聊天发送
  sendChatBtn.addEventListener('click', () => {
    const msg = chatInput.value.trim();
    if (msg) {
      send('chat', { message: msg });
      chatInput.value = '';
    }
  });
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const msg = chatInput.value.trim();
      if (msg) {
        send('chat', { message: msg });
        chatInput.value = '';
      }
    }
  });

  // 初始状态
  showLobby();
  updateBoard(Array(9).fill(''));
})();
