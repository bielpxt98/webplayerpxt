import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3001;
const SERVICE_NAME = 'pxt-player-api';
const REQUEST_TIMEOUT_MS = Number(process.env.XTREAM_TIMEOUT_MS || 10000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistPath = resolveFrontendDistPath();

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  `http://localhost:${PORT}`,
];

const configuredAllowedOrigins = [
  process.env.FRONTEND_ORIGIN,
  process.env.CORS_ORIGIN,
  process.env.RENDER_EXTERNAL_URL,
  getRenderServiceOrigin(),
]
  .filter(Boolean)
  .flatMap((origins) => origins.split(','))
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins])];

const corsOptions = {
  origin(origin, callback) {
    const normalizedOrigin = normalizeOrigin(origin);

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

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: SERVICE_NAME });
});

app.use('/api', cors(corsOptions));
app.options('/api/*', cors(corsOptions));
app.use('/api', express.json({ limit: '32kb' }));

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

  try {
    const data = await fetchXtreamJson(apiUrl);
    const userInfo = data?.user_info || {};
    const catalog = await buildXtreamCatalog({ apiUrl, initialData: data });

    return res.json({
      ok: true,
      status: userInfo.status ?? null,
      auth: userInfo.auth ?? null,
      username: userInfo.username ?? null,
      exp_date: userInfo.exp_date ?? null,
      max_connections: userInfo.max_connections ?? null,
      active_cons: userInfo.active_cons ?? null,
      allowed_output_formats: userInfo.allowed_output_formats ?? [],
      catalog,
    });
  } catch (error) {
    const isAbort = error?.name === 'AbortError';

    return res.status(error?.status || (isAbort ? 504 : 502)).json({
      ok: false,
      error: error?.publicMessage || (isAbort
        ? 'Xtream API request timed out.'
        : 'Could not validate credentials with Xtream API.'),
    });
  }
});

app.use('/api', (_req, res) => {
  return res.status(404).json({ ok: false, error: 'API route not found.' });
});

if (frontendDistPath) {
  app.use(express.static(frontendDistPath, {
    fallthrough: true,
  }));
}

app.get('*', (_req, res, next) => {
  if (!frontendDistPath) {
    return res.status(503).json({
      ok: false,
      error: 'Frontend build not found. Run npm run build before starting the server.',
    });
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

function resolveFrontendDistPath() {
  const candidatePaths = [
    path.resolve(__dirname, '..', 'dist'),
    path.resolve(__dirname, 'dist'),
  ];

  const distPath = candidatePaths.find((candidatePath) => (
    fs.existsSync(path.join(candidatePath, 'index.html'))
  ));

  if (!distPath) {
    console.warn(`Frontend build not found. Checked: ${candidatePaths.join(', ')}`);
    return null;
  }

  return distPath;
}

function normalizeOrigin(origin) {
  return origin?.trim().replace(/\/+$/, '');
}

function getRenderServiceOrigin() {
  const serviceName = process.env.RENDER_SERVICE_NAME;

  if (!serviceName) {
    return null;
  }

  return `https://${serviceName}.onrender.com`;
}

async function fetchXtreamJson(apiUrl, action) {
  const requestUrl = new URL(apiUrl);

  if (action) {
    requestUrl.searchParams.set('action', action);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const xtreamResponse = await fetch(requestUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!xtreamResponse.ok) {
      const error = new Error(`Xtream API responded with HTTP ${xtreamResponse.status}.`);
      error.status = 502;
      error.publicMessage = `Xtream API responded with HTTP ${xtreamResponse.status}.`;
      throw error;
    }

    return xtreamResponse.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function buildXtreamCatalog({ apiUrl, initialData }) {
  const normalizedFromInitialData = normalizeXtreamCatalog(initialData);
  const missingActions = [
    ['liveCategories', 'get_live_categories'],
    ['movieCategories', 'get_vod_categories'],
    ['seriesCategories', 'get_series_categories'],
    ['liveStreams', 'get_live_streams'],
    ['vodStreams', 'get_vod_streams'],
    ['series', 'get_series'],
  ].filter(([catalogKey]) => normalizedFromInitialData[catalogKey].length === 0);

  const actionResults = await Promise.allSettled(
    missingActions.map(([, action]) => fetchXtreamJson(apiUrl, action)),
  );

  const supplementalData = {};

  actionResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const [catalogKey] = missingActions[index];
      supplementalData[catalogKey] = result.value;
    }
  });

  const catalog = normalizeXtreamCatalog({
    ...initialData,
    ...supplementalData,
    fetchedAt: new Date().toISOString(),
  });

  logMaskedLivePlaybackUrls({ apiUrl, liveStreams: catalog.liveStreams });

  return catalog;
}

function normalizeXtreamCatalog(data = {}) {
  const categories = Array.isArray(data.categories) ? data.categories : [];

  return {
    liveCategories: firstArray(
      data.liveCategories,
      data.live_categories,
      data.available_channels?.liveCategories,
      data.available_channels?.live_categories,
      filterCategories(categories, ['live', 'channel']),
    ),
    movieCategories: firstArray(
      data.movieCategories,
      data.vodCategories,
      data.movie_categories,
      data.vod_categories,
      data.available_channels?.movieCategories,
      data.available_channels?.vodCategories,
      data.available_channels?.movie_categories,
      data.available_channels?.vod_categories,
      filterCategories(categories, ['movie', 'vod']),
    ),
    seriesCategories: firstArray(
      data.seriesCategories,
      data.series_categories,
      data.available_channels?.seriesCategories,
      data.available_channels?.series_categories,
      filterCategories(categories, ['series']),
    ),
    liveStreams: firstArray(
      data.liveStreams,
      data.live_streams,
      data.available_channels,
      data.available_channels?.liveStreams,
      data.available_channels?.live_streams,
    ),
    vodStreams: firstArray(
      data.vodStreams,
      data.vod_streams,
      data.available_channels?.vodStreams,
      data.available_channels?.vod_streams,
      data.available_channels?.movies,
    ),
    series: firstArray(
      data.series,
      data.available_channels?.series,
    ),
    user_info: data.user_info || null,
    server_info: data.server_info || null,
    fetchedAt: data.fetchedAt || new Date().toISOString(),
  };
}


function createMaskedXtreamLiveUrl(apiUrl, streamId, extension) {
  if (!streamId) return '';

  const baseUrl = new URL(apiUrl);
  const username = baseUrl.searchParams.get('username') || '';
  const maskedPassword = '••••••';
  const normalizedBase = `${baseUrl.protocol}//${baseUrl.host}`;
  return `${normalizedBase}/live/${encodeURIComponent(username)}/${maskedPassword}/${encodeURIComponent(streamId)}.${extension}`;
}

function logMaskedLivePlaybackUrls({ apiUrl, liveStreams }) {
  const firstLiveStream = Array.isArray(liveStreams) ? liveStreams.find((stream) => stream?.stream_id || stream?.id) : null;
  const streamId = firstLiveStream?.stream_id || firstLiveStream?.id;

  if (!streamId) return;

  console.info('[LIVE TV] Xtream playback URL format', {
    streamId: String(streamId),
    primaryUrl: createMaskedXtreamLiveUrl(apiUrl, streamId, 'm3u8'),
    fallbackUrl: createMaskedXtreamLiveUrl(apiUrl, streamId, 'ts'),
  });
}

function firstArray(...candidates) {
  const value = candidates.find((candidate) => Array.isArray(candidate));
  return value || [];
}

function filterCategories(categories, typeHints) {
  if (!categories.length) return [];

  return categories.filter((category) => {
    const searchable = [
      category.category_type,
      category.type,
      category.kind,
      category.content_type,
      category.parent_type,
    ].filter(Boolean).join(' ').toLowerCase();

    return typeHints.some((hint) => searchable.includes(hint));
  });
}

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
