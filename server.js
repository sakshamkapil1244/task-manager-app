const express = require('express');
const path = require('path');
const fs = require('fs');
const { performance } = require('perf_hooks');
const initSqlJs = require('sql.js');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'tasks.db');
const VISIBLE_STEP_DELAY_MS = 300;
const REPLAY_STEP_DELAY_MS = 700;

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

let db;

// Function to save the sql.js in-memory database to a file
function saveDatabase() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Promise wrapper for sql.js run
function run(sql, params = []) {
  db.run(sql, params);
  // Get the last inserted ID
  const lastIDRes = db.exec("SELECT last_insert_rowid()");
  const lastID = lastIDRes[0].values[0][0];
  const changes = db.getRowsModified();
  saveDatabase(); // Save to disk after every change
  return Promise.resolve({ lastID, changes });
}

// Promise wrapper for sql.js all
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return Promise.resolve(rows);
}

app.use(express.json({ limit: '20kb' }));
app.use(express.static(PUBLIC_DIR));

const clients = new Map();
const lastEventSets = new Map();
const busyClients = new Set();

function validClientId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
}

function sendEvent(clientId, eventName, data, { remember = true } = {}) {
  const response = clients.get(clientId);
  if (!response || response.writableEnded) return false;

  const payload = JSON.stringify(data);
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${payload}\n\n`);

  if (remember) {
    const events = lastEventSets.get(clientId) || [];
    events.push({ eventName, data });
    lastEventSets.set(clientId, events);
  }
  return true;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

app.get('/', (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/events', (request, response) => {
  const clientId = request.query.clientId;
  if (!validClientId(clientId)) {
    return response.status(400).end('A valid clientId is required.');
  }

  const oldResponse = clients.get(clientId);
  if (oldResponse && oldResponse !== response) oldResponse.end();

  response.status(200);
  response.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  response.flushHeaders();
  response.write(': connected\n\n');
  clients.set(clientId, response);

  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(': heartbeat\n\n');
  }, 25000);

  request.on('close', () => {
    clearInterval(heartbeat);
    if (clients.get(clientId) === response) clients.delete(clientId);
  });
});

app.get('/api/tasks', async (_request, response) => {
  try {
    const tasks = await all(
      'SELECT id, title, deadline, created_at AS createdAt FROM tasks ORDER BY id DESC'
    );
    response.json(tasks);
  } catch (error) {
    console.error('Could not load tasks:', error.message);
    response.status(500).json({ message: 'Could not load tasks.' });
  }
});

app.post('/api/tasks', async (request, response) => {
  const { clientId, title, deadline, pageDurationMs } = request.body || {};
  if (!validClientId(clientId)) {
    return response.status(400).json({ message: 'The live update connection is missing.' });
  }

  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  const cleanDeadline = typeof deadline === 'string' ? deadline.trim() : '';
  if (!cleanTitle || cleanTitle.length > 160 || !cleanDeadline || Number.isNaN(Date.parse(cleanDeadline))) {
    return response.status(400).json({
      message: 'Enter a title (up to 160 characters) and a valid deadline.'
    });
  }
  if (busyClients.has(clientId)) {
    return response.status(409).json({ message: 'Please wait for the current task flow to finish.' });
  }

  busyClients.add(clientId);
  lastEventSets.set(clientId, []);
  const requestStartedAt = performance.now();

  try {
    sendEvent(clientId, 'step', {
      step: 'page',
      elapsedMs: Math.max(0, Number(pageDurationMs) || 0),
      label: 'Task form submitted'
    });
    await delay(VISIBLE_STEP_DELAY_MS);

    const serverStepStartedAt = performance.now();
    const taskToSave = { title: cleanTitle, deadline: cleanDeadline };
    const serverElapsedMs = performance.now() - serverStepStartedAt;
    sendEvent(clientId, 'step', {
      step: 'server',
      elapsedMs: Number(serverElapsedMs.toFixed(2)),
      label: 'Request validated'
    });
    await delay(VISIBLE_STEP_DELAY_MS);

    const databaseStartedAt = performance.now();
    try {
      const createdAt = new Date().toISOString();
      const result = await run(
        'INSERT INTO tasks (title, deadline, created_at) VALUES (?, ?, ?)',
        [taskToSave.title, taskToSave.deadline, createdAt]
      );
      const task = {
        id: result.lastID,
        title: taskToSave.title,
        deadline: taskToSave.deadline,
        createdAt
      };
      sendEvent(clientId, 'step', {
        step: 'database',
        elapsedMs: Number((performance.now() - databaseStartedAt).toFixed(2)),
        label: 'Task saved',
        task
      });
      return response.status(201).json({ task });
    } catch (databaseError) {
      const elapsedMs = Number((performance.now() - databaseStartedAt).toFixed(2));
      console.error('Could not save task:', databaseError.message);
      sendEvent(clientId, 'error', {
        step: 'database',
        elapsedMs,
        message: 'The task could not be saved. Please try again.'
      });
      return response.status(500).json({ message: 'The task could not be saved. Please try again.' });
    }
  } catch (error) {
    console.error('Task request failed:', error.message);
    const elapsedMs = Number((performance.now() - requestStartedAt).toFixed(2));
    sendEvent(clientId, 'error', {
      step: 'server',
      elapsedMs,
      message: 'Something went wrong while processing the task.'
    });
    return response.status(500).json({ message: 'Something went wrong while processing the task.' });
  } finally {
    busyClients.delete(clientId);
  }
});

app.post('/api/replay', async (request, response) => {
  const { clientId } = request.body || {};
  if (!validClientId(clientId)) {
    return response.status(400).json({ message: 'The live update connection is missing.' });
  }
  if (busyClients.has(clientId)) {
    return response.status(409).json({ message: 'Please wait for the current flow to finish.' });
  }

  const savedEvents = lastEventSets.get(clientId) || [];
  if (savedEvents.length === 0) {
    return response.status(404).json({ message: 'There is no task flow to replay yet.' });
  }
  if (!clients.has(clientId)) {
    return response.status(409).json({ message: 'Reconnect to live updates before replaying.' });
  }

  busyClients.add(clientId);
  try {
    for (let index = 0; index < savedEvents.length; index += 1) {
      const savedEvent = savedEvents[index];
      sendEvent(clientId, savedEvent.eventName, { ...savedEvent.data, replay: true }, { remember: false });
      if (index < savedEvents.length - 1) await delay(REPLAY_STEP_DELAY_MS);
    }
    response.json({ message: 'Last task flow replayed.' });
  } finally {
    busyClients.delete(clientId);
  }
});

// Initialize sql.js and start server
initSqlJs().then(function(SQL) {
  // Load existing database or create new
  if (fs.existsSync(DB_PATH)) {
    const filebuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }

  // Create table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      deadline TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  saveDatabase();

  // Start the Express server
  app.listen(PORT, () => {
    console.log(`Task Manager is running at http://localhost:${PORT}`);
    console.log(`Database file: ${DB_PATH}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
});