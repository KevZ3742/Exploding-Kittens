# 💥 Exploding Kittens — Multiplayer

Online multiplayer Exploding Kittens (Base Game, 2–5 players) with real-time WebSocket gameplay.

## Setup

```bash
npm install
npm start   # runs on localhost:3001
```

Then share with friends via ngrok:
```bash
ngrok http 3001
```

## How to Play

1. One player creates a room and shares the 4-letter code
2. Friends join with the code
3. Host clicks **Start Game**
4. Play cards, avoid the Exploding Kitten, last one standing wins!

## Cards (Base Game, 56 total)

| Card | Count | Effect |
|------|-------|--------|
| Exploding Kitten | 4 | You're out unless you have a Defuse |
| Defuse | 6 | Neutralize an Exploding Kitten |
| Nope | 5 | Cancel any action (5-second window) |
| Attack | 4 | End turn without drawing, next player takes 2 turns |
| Skip | 4 | End turn without drawing |
| Favor | 4 | Force a player to give you a card |
| Shuffle | 4 | Shuffle the draw pile |
| See the Future | 5 | Peek at top 3 cards |
| Cat Cards (×5 types) | 4 each | Play pairs to steal a random card |
