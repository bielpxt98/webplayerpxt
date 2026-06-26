import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3001;
const SERVICE_NAME = 'pxt-player-api';
const REQUEST_TIMEOUT_MS = Number(process.env.XTREAM_TIMEOUT_MS || 10000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistPath = path.resolve(__dirname, '..', 'dist');

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  `http://localhost:${PORT}`,
];

const configuredAllowedOrigins = [
  process.env.CORS_ORIGIN,
  process.env.FRONTEND_ORIGIN,
]
  .filter(Boolean)
  .flatMap((origins) => origins.split(','))
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins])];

const corsOptions = {
  origin(origin, callback) {
    const normalizedOrigin = origin?.replace(/\/+$/, '');

    if (!normalizedOrigin || allowedOrigins.includes(normalizedOrigin) || isLocalOrigin(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: SERVICE_NAME });
});

app.post('/api/xtream/validate', async (req, res) => {
  const { server, username, password } = req.body || {};

  if (!server || !username || !password) {
    return res.status(400).json({
      ok: false,
      error: 'server, username and password are required.',
    });
  }

  let apiUrl;

  try {
    apiUrl = new URL('/player_api.php', normalizeServerUrl(server));
    apiUrl.searchParams.set('username', username);
    apiUrl.searchParams.set('password', password);
  } catch (_error) {
    return res.status(400).json({
      ok: false,
      error: 'server must be a valid http or https URL.',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const xtreamResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!xtreamResponse.ok) {
      return res.status(502).json({
        ok: false,
        error: `Xtream API responded with HTTP ${xtreamResponse.status}.`,
      });
    }

    const data = await xtreamResponse.json();
    const userInfo = data?.user_info || {};

    return res.json({
      ok: true,
      status: userInfo.status ?? null,
      auth: userInfo.auth ?? null,
      username: userInfo.username ?? null,
      exp_date: userInfo.exp_date ?? null,
      max_connections: userInfo.max_connections ?? null,
      active_cons: userInfo.active_cons ?? null,
      allowed_output_formats: userInfo.allowed_output_formats ?? [],
    });
  } catch (error) {
    const isAbort = error?.name === 'AbortError';

    return res.status(isAbort ? 504 : 502).json({
      ok: false,
      error: isAbort
        ? 'Xtream API request timed out.'
        : 'Could not validate credentials with Xtream API.',
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.use(express.static(frontendDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'API route not found.' });
  }

  return res.sendFile(path.join(frontendDistPath, 'index.html'), (error) => {
    if (error) next(error);
  });
});

app.use((err, _req, res, _next) => {
  if (err?.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ ok: false, error: err.message });
  }

  return res.status(500).json({ ok: false, error: 'Internal server error.' });
});

function isLocalOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch (_error) {
    return false;
  }
}

function normalizeServerUrl(server) {
  const url = new URL(server);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Invalid protocol');
  }

  return url;
}

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});
