const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(express.static(path.join(__dirname, 'public')));

const CARD_TYPES = {
  EXPLODING: 'exploding', DEFUSE: 'defuse', NOPE: 'nope',
  ATTACK: 'attack', SKIP: 'skip', FAVOR: 'favor',
  SHUFFLE: 'shuffle', FUTURE: 'future',
  TACOCAT: 'tacocat', POTATO: 'potato', BEARD: 'beard', RAINBOW: 'rainbow', MELON: 'melon',
};

const CAT_CARDS = ['tacocat', 'potato', 'beard', 'rainbow', 'melon'];

const BASE_DECK = [
  ...Array(5).fill('nope'),
  ...Array(4).fill('attack'),
  ...Array(4).fill('skip'),
  ...Array(4).fill('favor'),
  ...Array(4).fill('shuffle'),
  ...Array(5).fill('future'),
  ...Array(4).fill('tacocat'),
  ...Array(4).fill('potato'),
  ...Array(4).fill('beard'),
  ...Array(4).fill('rainbow'),
  ...Array(4).fill('melon'),
];

const rooms = {};
const NOPE_WINDOW_MS = 5000;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function broadcast(room, msg) {
  room.players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(msg));
  });
}

function sendTo(room, pi, msg) {
  const p = room.players[pi];
  if (p?.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(msg));
}

function broadcastState(room) {
  const g = room.game;
  room.players.forEach((p, myIdx) => {
    if (p.ws.readyState !== WebSocket.OPEN) return;
    p.ws.send(JSON.stringify({
      type: 'game_state',
      myIndex: myIdx,
      currentPlayer: g.currentPlayer,
      turnsLeft: g.turnsLeft,
      deckCount: g.deck.length,
      discardTop: g.discard.length ? g.discard[g.discard.length - 1] : null,
      log: g.log.slice(-50),
      phase: g.phase,
      nopeWindow: g.nopeWindow ? { endsAt: g.nopeWindow.endsAt, nopeCount: g.nopeWindow.nopeCount } : null,
      pendingAction: g.pendingAction ? { card: g.pendingAction.card, playerName: g.pendingAction.playerName } : null,
      players: g.players.map((gp, i) => ({
        name: gp.name,
        alive: gp.alive,
        cardCount: gp.hand.length,
        hand: i === myIdx ? gp.hand : null,
      })),
    }));
  });
}

function addLog(room, msg) { room.game.log.push(msg); }

function cardName(type) {
  const names = {
    exploding:'Exploding Kitten', defuse:'Defuse', nope:'Nope', attack:'Attack',
    skip:'Skip', favor:'Favor', shuffle:'Shuffle', future:'See the Future',
    tacocat:'Taco Cat', potato:'Hairy Potato Cat', beard:'Beard Cat',
    rainbow:'Rainbow Cat', melon:'Cattermelon',
  };
  return names[type] || type;
}

function nextAlive(g, from) {
  let next = (from + 1) % g.players.length;
  let tries = 0;
  while (!g.players[next].alive && tries < g.players.length) {
    next = (next + 1) % g.players.length; tries++;
  }
  return next;
}

// ── GAME SETUP ──
function initGame(room) {
  const n = room.players.length;
  const deck = shuffle([...BASE_DECK]);

  const gamePlayers = room.players.map(p => ({
    name: p.name, alive: true, hand: ['defuse'],
  }));
  // Deal 4 more cards each
  for (let i = 0; i < 4; i++) gamePlayers.forEach(gp => gp.hand.push(deck.pop()));

  // Shuffle in (n-1) exploding kittens and remaining defuses
  const extraDefuses = Math.max(0, 6 - n);
  for (let i = 0; i < n - 1; i++) deck.push('exploding');
  for (let i = 0; i < extraDefuses; i++) deck.push('defuse');

  room.game = {
    players: gamePlayers,
    deck: shuffle(deck),
    discard: [],
    currentPlayer: 0,
    turnsLeft: 1,
    // phases: play | nope_window | insert_kitten | favor_response | ended
    phase: 'play',
    pendingAction: null,
    nopeWindow: null,
    nopeTimer: null,
    log: [`🐱 Game started with ${n} players! Good luck...`],
  };

  broadcastState(room);
  notifyTurn(room);
}

function notifyTurn(room) {
  const g = room.game;
  const cur = g.currentPlayer;
  broadcast(room, { type: 'turn_change', playerIndex: cur, player: g.players[cur].name, turnsLeft: g.turnsLeft });
  sendTo(room, cur, { type: 'your_turn' });
}

// ── DRAW ──
// Drawing always ends one "turn unit". When turnsLeft hits 0, pass to next player.
function handleDraw(room, pi) {
  const g = room.game;
  if (g.phase !== 'play') return;
  if (pi !== g.currentPlayer) return;

  const card = g.deck.pop();
  if (!card) {
    addLog(room, `😅 The deck is empty!`);
    finishOneTurn(room);
    return;
  }

  if (card === 'exploding') {
    // Check for defuse in hand
    const defuseIdx = g.players[pi].hand.indexOf('defuse');
    broadcast(room, { type: 'explosion', player: g.players[pi].name });
    addLog(room, `💥 ${g.players[pi].name} drew an EXPLODING KITTEN!!!`);

    if (defuseIdx !== -1) {
      g.players[pi].hand.splice(defuseIdx, 1);
      g.discard.push('defuse');
      addLog(room, `🛡️ ${g.players[pi].name} uses a Defuse! Insert the kitten back.`);
      g.phase = 'insert_kitten';
      broadcastState(room);
      sendTo(room, pi, { type: 'insert_kitten', deckSize: g.deck.length });
    } else {
      // Boom
      g.players[pi].alive = false;
      g.discard.push(...g.players[pi].hand);
      g.players[pi].hand = [];
      addLog(room, `💀 ${g.players[pi].name} explodes! Out of the game.`);
      broadcastState(room);
      const alive = g.players.filter(p => p.alive);
      if (alive.length === 1) {
        endGame(room, alive[0]);
      } else {
        // Move past this player
        g.turnsLeft = 0;
        finishOneTurn(room);
      }
    }
  } else {
    g.players[pi].hand.push(card);
    addLog(room, `🃏 ${g.players[pi].name} draws a card.`);
    broadcastState(room);
    finishOneTurn(room);
  }
}

// Decrement turnsLeft by 1. If 0, advance to next player.
function finishOneTurn(room) {
  const g = room.game;
  g.turnsLeft--;
  if (g.turnsLeft <= 0) {
    g.currentPlayer = nextAlive(g, g.currentPlayer);
    g.turnsLeft = 1;
  }
  g.phase = 'play';
  broadcastState(room);
  notifyTurn(room);
}

function endGame(room, winner) {
  addLog(room, `🎉 ${winner.name} is the last cat standing!`);
  room.game.phase = 'ended';
  broadcastState(room);
  broadcast(room, { type: 'game_over', winner: winner.name });
}

// ── NOPE WINDOW ──
function openNopeWindow(room, action) {
  const g = room.game;
  if (g.nopeTimer) clearTimeout(g.nopeTimer);
  g.phase = 'nope_window';
  g.pendingAction = action;
  g.nopeWindow = { endsAt: Date.now() + NOPE_WINDOW_MS, nopeCount: 0 };
  broadcastState(room);
  broadcast(room, { type: 'nope_window_open', action, endsAt: g.nopeWindow.endsAt });
  g.nopeTimer = setTimeout(() => resolveNope(room), NOPE_WINDOW_MS);
}

function resolveNope(room) {
  const g = room.game;
  if (g.nopeTimer) { clearTimeout(g.nopeTimer); g.nopeTimer = null; }
  const action = g.pendingAction;
  const wasNoped = g.nopeWindow.nopeCount % 2 === 1;
  g.phase = 'play';
  g.pendingAction = null;
  g.nopeWindow = null;

  if (wasNoped) {
    addLog(room, `🙅 ${action.playerName}'s ${cardName(action.card)} was Noped! They must still draw.`);
    broadcastState(room);
    // Noped: card has no effect. Player continues their turn normally (must draw to end it).
    // Attack/Skip being noped means they get no benefit — they still need to draw.
    notifyTurn(room); // re-notify so client knows it's still their turn
  } else {
    executeAction(room, action);
  }
}

// ── EXECUTE ACTIONS ──
function executeAction(room, action) {
  const g = room.game;
  const pi = action.playerIndex;
  const player = g.players[pi];

  switch (action.card) {
    case 'attack': {
      // End turn without drawing. Pass turnsLeft + 1 to next player.
      const turnsToPass = g.turnsLeft + 1;
      const next = nextAlive(g, pi);
      addLog(room, `⚡ ${player.name} Attacks! ${g.players[next].name} must take ${turnsToPass} turn(s).`);
      g.currentPlayer = next;
      g.turnsLeft = turnsToPass;
      g.phase = 'play';
      broadcastState(room);
      notifyTurn(room);
      break;
    }
    case 'skip': {
      // End one turn without drawing. turnsLeft - 1.
      addLog(room, `⏭️ ${player.name} skips a turn.`);
      finishOneTurn(room);
      break;
    }
    case 'shuffle': {
      g.deck = shuffle(g.deck);
      addLog(room, `🔀 ${player.name} shuffles the deck!`);
      broadcastState(room);
      // Does NOT end turn — player can keep playing or draw
      notifyTurn(room);
      break;
    }
    case 'future': {
      const top3 = g.deck.slice(-3).reverse();
      addLog(room, `🔮 ${player.name} peeks at the top 3 cards.`);
      sendTo(room, pi, { type: 'see_future', cards: top3 });
      broadcastState(room);
      // Does NOT end turn
      notifyTurn(room);
      break;
    }
    case 'favor': {
      const target = action.target;
      if (target == null || !g.players[target]?.alive || g.players[target].hand.length === 0) {
        addLog(room, `🤝 ${player.name} plays Favor (no valid target).`);
        notifyTurn(room);
        break;
      }
      addLog(room, `🤝 ${player.name} demands a Favor from ${g.players[target].name}!`);
      g.phase = 'favor_response';
      g.pendingAction = { ...action };
      broadcastState(room);
      sendTo(room, target, { type: 'give_card', from: player.name, fromIndex: pi });
      break;
    }
    default: {
      // Cat combo
      if (CAT_CARDS.includes(action.card) && action.isCombo) {
        const target = action.target;
        if (target == null || !g.players[target]?.alive || g.players[target].hand.length === 0) {
          addLog(room, `🐱 ${player.name} plays a pair (no valid target).`);
        } else {
          const idx = Math.floor(Math.random() * g.players[target].hand.length);
          const stolen = g.players[target].hand.splice(idx, 1)[0];
          player.hand.push(stolen);
          addLog(room, `🐱 ${player.name} steals a card from ${g.players[target].name}!`);
          sendTo(room, pi, { type: 'stole_card', card: stolen, from: g.players[target].name });
        }
        broadcastState(room);
        notifyTurn(room);
      }
      break;
    }
  }
}

// ── WEBSOCKET ──
wss.on('connection', ws => {
  let myRoom = null, myCode = null;

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create_room') {
      const code = Math.random().toString(36).slice(2, 6).toUpperCase();
      rooms[code] = { players: [], game: null };
      myCode = code; myRoom = rooms[code];
      myRoom.players.push({ name: msg.name, ws });
      ws.send(JSON.stringify({ type: 'room_created', code, playerIndex: 0 }));
    }

    else if (msg.type === 'join_room') {
      const code = msg.code.toUpperCase();
      if (!rooms[code]) { ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' })); return; }
      const room = rooms[code];
      if (room.game) { ws.send(JSON.stringify({ type: 'error', msg: 'Game already started' })); return; }
      if (room.players.length >= 5) { ws.send(JSON.stringify({ type: 'error', msg: 'Room full (max 5)' })); return; }
      myCode = code; myRoom = room;
      const idx = room.players.length;
      room.players.push({ name: msg.name, ws });
      ws.send(JSON.stringify({ type: 'room_joined', code, playerIndex: idx }));
      broadcast(room, { type: 'lobby', players: room.players.map(p => p.name), code });
    }

    else if (msg.type === 'start_game') {
      if (!myRoom || myRoom.players.length < 2) { ws.send(JSON.stringify({ type: 'error', msg: 'Need 2+ players' })); return; }
      const pi = myRoom.players.findIndex(p => p.ws === ws);
      if (pi !== 0) { ws.send(JSON.stringify({ type: 'error', msg: 'Only host can start' })); return; }
      broadcast(myRoom, { type: 'game_starting', players: myRoom.players.map(p => p.name) });
      initGame(myRoom);
    }

    else if (msg.type === 'play_card') {
      if (!myRoom?.game) return;
      const g = myRoom.game;
      const pi = myRoom.players.findIndex(p => p.ws === ws);
      if (pi !== g.currentPlayer) { ws.send(JSON.stringify({ type: 'error', msg: 'Not your turn' })); return; }
      if (g.phase !== 'play') { ws.send(JSON.stringify({ type: 'error', msg: 'Cannot play right now' })); return; }

      const player = g.players[pi];

      // Validate card is in hand
      if (msg.isCombo) {
        const count = player.hand.filter(c => c === msg.card).length;
        if (count < 2) { ws.send(JSON.stringify({ type: 'error', msg: 'Need 2 matching cards for combo' })); return; }
        let removed = 0;
        player.hand = player.hand.filter(c => (c === msg.card && removed < 2) ? (removed++, false) : true);
        g.discard.push(msg.card, msg.card);
      } else {
        const idx = player.hand.indexOf(msg.card);
        if (idx === -1) { ws.send(JSON.stringify({ type: 'error', msg: 'Card not in hand' })); return; }
        if (msg.card === 'defuse' || msg.card === 'exploding') {
          ws.send(JSON.stringify({ type: 'error', msg: "Can't play that card!" })); return;
        }
        player.hand.splice(idx, 1);
        g.discard.push(msg.card);
      }

      // Single cat card — discard it but no effect, stay in play phase
      if (CAT_CARDS.includes(msg.card) && !msg.isCombo) {
        addLog(myRoom, `🐱 ${player.name} plays ${cardName(msg.card)} (no effect alone).`);
        broadcastState(myRoom);
        return;
      }

      const action = {
        card: msg.card, playerIndex: pi, playerName: player.name,
        target: msg.target ?? null, isCombo: msg.isCombo ?? false,
      };

      addLog(myRoom, `▶️ ${player.name} plays ${cardName(msg.card)}${msg.isCombo ? ' (pair combo!)' : ''}.`);
      openNopeWindow(myRoom, action);
    }

    else if (msg.type === 'play_nope') {
      if (!myRoom?.game) return;
      const g = myRoom.game;
      if (g.phase !== 'nope_window') { ws.send(JSON.stringify({ type: 'error', msg: 'Nothing to Nope' })); return; }
      const pi = myRoom.players.findIndex(p => p.ws === ws);
      const player = g.players[pi];
      const nopeIdx = player.hand.indexOf('nope');
      if (nopeIdx === -1) { ws.send(JSON.stringify({ type: 'error', msg: 'No Nope card' })); return; }

      player.hand.splice(nopeIdx, 1);
      g.discard.push('nope');
      g.nopeWindow.nopeCount++;
      const isNoped = g.nopeWindow.nopeCount % 2 === 1;
      addLog(myRoom, `🙅 ${player.name} plays Nope! (${isNoped ? 'NOPED 🚫' : 'YEPED ✅ — action back on!'})`);

      if (myRoom.game.nopeTimer) clearTimeout(myRoom.game.nopeTimer);
      const newEnd = Date.now() + 3000;
      g.nopeWindow.endsAt = newEnd;
      myRoom.game.nopeTimer = setTimeout(() => resolveNope(myRoom), 3000);

      broadcastState(myRoom);
      broadcast(myRoom, { type: 'nope_played', player: player.name, nopeCount: g.nopeWindow.nopeCount, endsAt: newEnd });
    }

    else if (msg.type === 'draw_card') {
      if (!myRoom?.game) return;
      const pi = myRoom.players.findIndex(p => p.ws === ws);
      handleDraw(myRoom, pi);
    }

    else if (msg.type === 'insert_kitten') {
      if (!myRoom?.game) return;
      const g = myRoom.game;
      const pi = myRoom.players.findIndex(p => p.ws === ws);
      if (g.phase !== 'insert_kitten' || pi !== g.currentPlayer) return;
      const pos = Math.max(0, Math.min(msg.position, g.deck.length));
      g.deck.splice(g.deck.length - pos, 0, 'exploding');
      addLog(myRoom, `🛡️ ${g.players[pi].name} inserts the Exploding Kitten back.`);
      finishOneTurn(myRoom);
    }

    else if (msg.type === 'give_card') {
      if (!myRoom?.game) return;
      const g = myRoom.game;
      if (g.phase !== 'favor_response') return;
      const pi = myRoom.players.findIndex(p => p.ws === ws);
      const action = g.pendingAction;
      if (pi !== action.target) return;
      const idx = g.players[pi].hand.indexOf(msg.card);
      if (idx === -1) return;
      g.players[pi].hand.splice(idx, 1);
      g.players[action.playerIndex].hand.push(msg.card);
      addLog(myRoom, `🤝 ${g.players[pi].name} gives ${cardName(msg.card)} to ${g.players[action.playerIndex].name}.`);
      sendTo(myRoom, action.playerIndex, { type: 'received_card', card: msg.card, from: g.players[pi].name });
      g.phase = 'play';
      g.pendingAction = null;
      broadcastState(myRoom);
      notifyTurn(myRoom);
    }
  });

  ws.on('close', () => {
    if (!myRoom) return;
    const idx = myRoom.players.findIndex(p => p.ws === ws);
    if (idx !== -1) {
      broadcast(myRoom, { type: 'player_left', name: myRoom.players[idx].name });
      if (!myRoom.game) myRoom.players.splice(idx, 1);
      if (myRoom.players.length === 0) delete rooms[myCode];
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`\n💥 Exploding Kittens running on http://localhost:${PORT}\n`));
