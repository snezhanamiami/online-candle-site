const form = document.getElementById('candleForm');
const purposeInput = document.getElementById('purpose');
const nameInput = document.getElementById('name');
const submitButton = document.getElementById('submitButton');
const submitText = document.getElementById('submitText');
const statusMessage = document.getElementById('statusMessage');
const candleStage = document.getElementById('candleStage');
const candleTemplate = document.getElementById('candleTemplate');
const candleCount = document.getElementById('candleCount');
const freeCount = document.getElementById('freeCount');

const socket = io();
const OWNER_COOKIE = 'candle_owner_id';
const ACTIVE_COOKIE = 'active_candle_until';

let maxCandles = 40;
let lifetimeMs = 120000;
let activeCandles = [];
let ownerId = getOrCreateOwnerId();
let timerId = null;

function getCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const part = document.cookie.split('; ').find(item => item.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : null;
}

function setCookie(name, value, maxAgeSeconds) {
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}

function getOrCreateOwnerId() {
  const existing = getCookie(OWNER_COOKIE);
  if (existing) return existing;

  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  setCookie(OWNER_COOKIE, id, 60 * 60 * 24 * 365);
  return id;
}

function hasLocalActiveCandle() {
  const until = Number(getCookie(ACTIVE_COOKIE) || 0);
  return until > Date.now();
}

function getMyCandle() {
  return activeCandles.find(candle => candle.ownerId === ownerId && candle.expiresAt > Date.now());
}

function setStatus(text = '', type = 'success') {
  statusMessage.textContent = text;
  statusMessage.classList.toggle('error', type === 'error');
}

function updateFormState() {
  const myCandle = getMyCandle();
  const blocked = Boolean(myCandle) || hasLocalActiveCandle();

  purposeInput.disabled = blocked;
  nameInput.disabled = blocked;
  submitButton.disabled = blocked || activeCandles.length >= maxCandles;

  if (myCandle) {
    const seconds = Math.max(0, Math.ceil((myCandle.expiresAt - Date.now()) / 1000));
    submitText.textContent = `Свеча горит · ${seconds} сек.`;
    setStatus(`Свеча для «${myCandle.purpose.toLowerCase()}» горит. Новую можно поставить после её завершения.`);
  } else if (blocked) {
    const seconds = Math.max(0, Math.ceil((Number(getCookie(ACTIVE_COOKIE)) - Date.now()) / 1000));
    submitText.textContent = `Свеча горит · ${seconds} сек.`;
    setStatus('Ваша свеча ещё горит. Подождите немного.');
  } else if (activeCandles.length >= maxCandles) {
    submitText.textContent = 'Подсвечник заполнен';
    setStatus('Сейчас нет свободных мест. Новое место появится, когда одна из свечей догорит.', 'error');
  } else {
    submitText.textContent = 'Зажечь свечу';
    if (!statusMessage.classList.contains('error')) setStatus('');
  }
}

function getPosition(index, total, isMine) {
  const usable = Math.min(total, maxCandles);
  const columns = 10;
  const row = Math.floor(index / columns);
  const col = index % columns;
  const rows = Math.max(1, Math.ceil(usable / columns));

  const rowOffset = row % 2 ? 4 : 0;
  const x = 8 + col * 9.3 + rowOffset;
  const y = row * 46;
  const depth = rows - row;
  const scale = isMine ? 1.12 : Math.max(.72, 1 - row * .07);

  return { x: Math.min(95, x), y, scale, z: isMine ? 100 : depth + col };
}

function formatTimeLeft(expiresAt) {
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  return `Осталось ${seconds} сек.`;
}

function renderCandles() {
  candleStage.innerHTML = '';

  const sorted = [...activeCandles].sort((a, b) => {
    const aMine = a.ownerId === ownerId ? 1 : 0;
    const bMine = b.ownerId === ownerId ? 1 : 0;
    if (aMine !== bMine) return aMine - bMine;
    return a.createdAt - b.createdAt;
  });

  sorted.forEach((candle, index) => {
    const node = candleTemplate.content.firstElementChild.cloneNode(true);
    const isMine = candle.ownerId === ownerId;
    const elapsed = Date.now() - candle.createdAt;
    const burn = Math.min(1, Math.max(0, elapsed / lifetimeMs));
    const pos = getPosition(index, sorted.length, isMine);

    node.dataset.id = candle.id;
    node.style.setProperty('--x', `${pos.x}%`);
    node.style.setProperty('--y', `${pos.y}px`);
    node.style.setProperty('--scale', pos.scale);
    node.style.setProperty('--burn', burn);
    node.style.zIndex = pos.z;
    node.classList.toggle('is-mine', isMine);

    node.querySelector('.tooltip-name').textContent = candle.name;
    node.querySelector('.tooltip-purpose').textContent = candle.purpose;
    node.querySelector('.tooltip-time').textContent = formatTimeLeft(candle.expiresAt);
    node.setAttribute('aria-label', `${candle.name}, ${candle.purpose}`);

    candleStage.appendChild(node);
  });

  candleCount.textContent = String(activeCandles.length);
  freeCount.textContent = String(Math.max(0, maxCandles - activeCandles.length));
  updateFormState();
}

async function loadInitialCandles() {
  try {
    const response = await fetch('/api/candles');
    const data = await response.json();
    activeCandles = data.candles || [];
    maxCandles = data.maxCandles || 40;
    lifetimeMs = data.lifetimeMs || 120000;
    renderCandles();
  } catch {
    setStatus('Не удалось подключиться к серверу.', 'error');
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  setStatus('');

  const name = nameInput.value.trim();
  const purpose = purposeInput.value;

  if (!purpose) {
    setStatus('Выберите, для чего поставить свечу.', 'error');
    purposeInput.focus();
    return;
  }

  if (!name) {
    setStatus('Введите имя.', 'error');
    nameInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitText.textContent = 'Зажигаем…';

  try {
    const response = await fetch('/api/candles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, purpose, ownerId })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось поставить свечу.');

    setCookie(ACTIVE_COOKIE, String(data.candle.expiresAt), Math.ceil(lifetimeMs / 1000));
    nameInput.value = '';
    purposeInput.value = '';
    setStatus('Свеча зажжена.');
  } catch (error) {
    setStatus(error.message, 'error');
    submitButton.disabled = false;
    submitText.textContent = 'Зажечь свечу';
  }
});

socket.on('candles:update', candles => {
  activeCandles = Array.isArray(candles) ? candles : [];
  renderCandles();
});

socket.on('connect_error', () => {
  setStatus('Потеряно соединение с сервером. Пробуем восстановить…', 'error');
});

socket.on('connect', () => {
  if (statusMessage.textContent.includes('Потеряно соединение')) setStatus('');
});

clearInterval(timerId);
timerId = setInterval(() => {
  const now = Date.now();
  const before = activeCandles.length;
  activeCandles = activeCandles.filter(candle => candle.expiresAt > now);

  document.querySelectorAll('.candle').forEach(node => {
    const candle = activeCandles.find(item => item.id === node.dataset.id);
    if (!candle) return;
    const burn = Math.min(1, Math.max(0, (now - candle.createdAt) / lifetimeMs));
    node.style.setProperty('--burn', burn);
    const time = node.querySelector('.tooltip-time');
    if (time) time.textContent = formatTimeLeft(candle.expiresAt);
  });

  if (before !== activeCandles.length) renderCandles();
  else updateFormState();
}, 1000);

loadInitialCandles();
