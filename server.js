const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CANDLE_LIFETIME_MS = 2 * 60 * 1000;
const MAX_CANDLES = 40;
const PURPOSES = new Set(['За здоровье', 'За богатство', 'За финансы']);

const candles = new Map();

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function cleanupExpiredCandles() {
  const now = Date.now();
  let changed = false;

  for (const [id, candle] of candles.entries()) {
    if (candle.expiresAt <= now) {
      candles.delete(id);
      changed = true;
    }
  }

  if (changed) {
    io.emit('candles:update', getActiveCandles());
  }
}

function getActiveCandles() {
  cleanupExpiredCandlesSilently();
  return [...candles.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function cleanupExpiredCandlesSilently() {
  const now = Date.now();
  for (const [id, candle] of candles.entries()) {
    if (candle.expiresAt <= now) candles.delete(id);
  }
}

function sanitizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

app.get('/api/candles', (req, res) => {
  res.json({
    candles: getActiveCandles(),
    maxCandles: MAX_CANDLES,
    lifetimeMs: CANDLE_LIFETIME_MS
  });
});

app.post('/api/candles', (req, res) => {
  cleanupExpiredCandlesSilently();

  const name = sanitizeName(req.body?.name);
  const purpose = String(req.body?.purpose || '');
  const ownerId = String(req.body?.ownerId || '').slice(0, 80);

  if (!name) {
    return res.status(400).json({ error: 'Введите имя.' });
  }

  if (!PURPOSES.has(purpose)) {
    return res.status(400).json({ error: 'Выберите назначение свечи.' });
  }

  if (!ownerId) {
    return res.status(400).json({ error: 'Не удалось определить пользователя.' });
  }

  const now = Date.now();
  const existing = [...candles.values()].find(
    candle => candle.ownerId === ownerId && candle.expiresAt > now
  );

  if (existing) {
    return res.status(409).json({
      error: 'Ваша свеча ещё горит.',
      candle: existing
    });
  }

  if (candles.size >= MAX_CANDLES) {
    return res.status(409).json({
      error: 'Подсвечник заполнен. Попробуйте немного позже.'
    });
  }

  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const candle = {
    id,
    ownerId,
    name,
    purpose,
    createdAt: now,
    expiresAt: now + CANDLE_LIFETIME_MS
  };

  candles.set(id, candle);
  io.emit('candles:update', getActiveCandles());
  res.status(201).json({ candle });
});

io.on('connection', socket => {
  socket.emit('candles:update', getActiveCandles());
});

setInterval(cleanupExpiredCandles, 1000);

server.listen(PORT, () => {
  console.log(`Online candle site: http://localhost:${PORT}`);
});
