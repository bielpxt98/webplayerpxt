import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3001;
const SERVICE_NAME = 'pxt-player-api';
const REQUEST_TIMEOUT_MS = Number(process.env.XTREAM_TIMEOUT_MS || 25000);
const DEFAULT_USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistPath = resolveFrontendDistPath();

// Cabeçalhos limpos sem rastros de proxy que causam bloqueio 403 em servidores IPTV
const CLEAN_OUTBOUND_HEADERS = {
  'User-Agent': 'IPTVSmartersPlayer',
  Accept: '*/*',
};

// Desativa HSTS para aceitar tanto HTTP quanto HTTPS de forma transparente
app.use((_req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=0');
  next();
});

// Configuração robusta de CORS
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Range', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
  optionsSuccessStatus: 204,
}));

app.use(express.json({ limit: '512kb' }));

// Health Check
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: SERVICE_NAME, status: 'online' });
});

/**
 * 1. Endpoint genérico de Ações Xtream (get_live_categories, get_live_streams, etc.)
 * Permite que o frontend consulte qualquer parte do catálogo através do proxy HTTPS
 */
app.get('/api/xtream/action', async (req, res) => {
  const { server, username, password, action } = req.query;

  if (!server || !username || !password || !action) {
    return res.status(400).json({ ok: false, error: 'server, username, password e action são obrigatórios.' });
  }

  let apiUrl;
  try {
    apiUrl = new URL('/player_api.php', normalizeServerUrl(server));
    apiUrl.searchParams.set('username', String(username).trim());
    apiUrl.searchParams.set('password', String(password).trim());
    apiUrl.searchParams.set('action', String(action).trim());
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'URL do servidor inválida.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(apiUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: CLEAN_OUTBOUND_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return res.status(upstream.status).json({ ok: false, error: `Upstream HTTP ${upstream.status}` });
    }

    const data = await upstream.json();
    return res.json(data);
  } catch (error) {
    clearTimeout(timeout);
    return res.status(error.name === 'AbortError' ? 504 : 502).json({
      ok: false,
      error: error.message || 'Falha ao buscar dados no servidor de origem.',
    });
  }
});

/**
 * 2. Validação de Conta Xtream
 */
app.post('/api/xtream/validate', async (req, res) => {
  const { server, username, password } = req.body || {};

  if (!server || !username || !password) {
    return res.status(400).json({ ok: false, error: 'server, username e password são obrigatórios.' });
  }

  let apiUrl;
  try {
    apiUrl = new URL('/player_api.php', normalizeServerUrl(server));
    apiUrl.searchParams.set('username', String(username).trim());
    apiUrl.searchParams.set('password', String(password).trim());
  } catch (_error) {
    return res.status(400).json({ ok: false, error: 'server deve ser uma URL http ou https válida.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const upstream = await fetch(apiUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: CLEAN_OUTBOUND_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        ok: false,
        error: `Servidor retornou HTTP ${upstream.status}`,
      });
    }

    const data = await upstream.json();
    const userInfo = data?.user_info || {};

    if (userInfo.auth === 0) {
      return res.status(401).json({ ok: false, error: 'Usuário ou senha incorretos.' });
    }

    // Retorna a autenticação imediatamente com rapidez (200ms)
    // O catálogo é buscado de forma incremental/sob demanda pelo proxy /api/xtream/action
    return res.json({
      ok: true,
      status: userInfo.status ?? 'Active',
      auth: userInfo.auth ?? 1,
      username: userInfo.username ?? username,
      exp_date: userInfo.exp_date ?? null,
      max_connections: userInfo.max_connections ?? null,
      active_cons: userInfo.active_cons ?? null,
      allowed_output_formats: userInfo.allowed_output_formats ?? ['m3u8', 'ts'],
      server_info: data?.server_info || null,
      user_info: userInfo,
    });
  } catch (error) {
    clearTimeout(timeout);
    const isAbort = error.name === 'AbortError';
    return res.status(isAbort ? 504 : 502).json({
      ok: false,
      error: isAbort ? 'Tempo esgotado ao contatar o servidor IPTV.' : (error.message || 'Erro ao validar credenciais.'),
    });
  }
});

/**
 * 3. Proxy de Fluxo de Vídeo com Reescrita Completa de .m3u8
 */
app.get('/api/stream-proxy', async (req, res) => {
  const requestedUrl = req.query?.url;

  if (!requestedUrl || typeof requestedUrl !== 'string') {
    return res.status(400).json({ ok: false, error: 'Parâmetro url é obrigatório.' });
  }

  let streamUrl;
  try {
    streamUrl = normalizeStreamUrl(requestedUrl);
  } catch (_error) {
    return res.status(400).json({ ok: false, error: 'URL de stream inválida.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const proxyHeaders = { ...CLEAN_OUTBOUND_HEADERS };
    const range = req.get('range');
    if (range) {
      proxyHeaders.Range = range;
    }

    const upstreamResponse = await fetch(streamUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: proxyHeaders,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = upstreamResponse.headers.get('content-type') || getContentTypeFromUrl(upstreamResponse.url || streamUrl.toString());
    const isManifest = isM3u8Response(upstreamResponse.url || streamUrl.toString(), contentType);

    res.status(upstreamResponse.status);
    copyProxyResponseHeaders(upstreamResponse.headers, res, { includeLength: !isManifest });
    res.setHeader('Content-Type', contentType);

    if (!upstreamResponse.body) {
      return res.end();
    }

    // Intercepta e reescreve links do arquivo .m3u8 para evitar Mixed Content
    if (isManifest) {
      const manifestText = await upstreamResponse.text();
      const rewritten = rewriteM3u8Manifest(manifestText, upstreamResponse.url || streamUrl.toString());
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    // Para pedaços binários (.ts, .mp4, etc.), repassa o fluxo
    return Readable.fromWeb(upstreamResponse.body).pipe(res);
  } catch (error) {
    clearTimeout(timeout);
    if (res.headersSent) {
      return res.destroy(error);
    }
    const isAbort = error.name === 'AbortError';
    return res.status(isAbort ? 504 : 502).json({
      ok: false,
      error: isAbort ? 'Stream proxy timed out.' : 'Não foi possível reproduzir o fluxo.',
    });
  }
});

/**
 * 4. Resolução de Redirecionamento
 */
app.post('/api/stream/resolve', async (req, res) => {
  const { originalUrl, url } = req.body || {};
  const requestedUrl = originalUrl || url;

  if (!requestedUrl) {
    return res.status(400).json({ ok: false, error: 'originalUrl é obrigatório.' });
  }

  try {
    const streamUrl = normalizeStreamUrl(requestedUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(streamUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: CLEAN_OUTBOUND_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    await response.body?.cancel();

    const finalUrl = response.url || streamUrl.toString();

    return res.json({
      ok: true,
      originalUrl: streamUrl.toString(),
      finalUrl,
      statusCode: response.status,
      contentType: response.headers.get('content-type') || '',
      redirected: response.redirected || finalUrl !== streamUrl.toString(),
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error.message || 'Falha ao resolver URL de reprodução.',
    });
  }
});

/**
 * 5. Informações da Série
 */
app.post('/api/xtream/series-info', async (req, res) => {
  const { server, username, password, seriesId } = req.body || {};

  if (!server || !username || !password || !seriesId) {
    return res.status(400).json({ ok: false, error: 'server, username, password e seriesId são obrigatórios.' });
  }

  try {
    const apiUrl = new URL('/player_api.php', normalizeServerUrl(server));
    apiUrl.searchParams.set('username', String(username).trim());
    apiUrl.searchParams.set('password', String(password).trim());
    apiUrl.searchParams.set('action', 'get_series_info');
    apiUrl.searchParams.set('series_id', String(seriesId).trim());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const upstream = await fetch(apiUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: CLEAN_OUTBOUND_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return res.status(upstream.status).json({ ok: false, error: `Upstream HTTP ${upstream.status}` });
    }

    const data = await upstream.json();
    return res.json(data);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error.message || 'Falha ao buscar episódios da série.' });
  }
});

// Arquivos estáticos do frontend (dist)
if (frontendDistPath) {
  app.use(express.static(frontendDistPath));

  app.get(/^(?!\/api).*/, (_req, res, next) => {
    return res.sendFile(path.join(frontendDistPath, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
}

// Middleware global de erro
app.use((err, _req, res, _next) => {
  console.error('[SERVER ERROR]', err);
  return res.status(500).json({ ok: false, error: err.message || 'Erro interno do servidor.' });
});

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

async function buildQuickCatalog(apiUrl) {
  async function fetchAction(action) {
    try {
      const u = new URL(apiUrl.toString());
      u.searchParams.set('action', action);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(u.toString(), {
        headers: CLEAN_OUTBOUND_HEADERS,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (r.ok) {
        const j = await r.json();
        return Array.isArray(j) ? j : [];
      }
    } catch (_e) {}
    return [];
  }

  const [
    liveCategories,
    movieCategories,
    seriesCategories,
    liveStreams,
    vodStreams,
    series,
  ] = await Promise.all([
    fetchAction('get_live_categories'),
    fetchAction('get_vod_categories'),
    fetchAction('get_series_categories'),
    fetchAction('get_live_streams'),
    fetchAction('get_vod_streams'),
    fetchAction('get_series'),
  ]);

  return {
    liveCategories,
    movieCategories,
    seriesCategories,
    liveStreams,
    vodStreams,
    series,
  };
}

function rewriteM3u8Manifest(manifest, manifestUrl) {
  const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);

  return manifest.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      // Reescreve atributos URI="..." (como chaves de criptografia e mapas de inicialização)
      return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
        const absolute = uri.startsWith('http://') || uri.startsWith('https://')
          ? uri
          : new URL(uri, baseUrl).toString();
        return `URI="/api/stream-proxy?url=${encodeURIComponent(absolute)}"`;
      });
    }

    // Linha de segmento de vídeo (.ts) ou sub-playlist
    const absolute = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : new URL(trimmed, baseUrl).toString();

    return `/api/stream-proxy?url=${encodeURIComponent(absolute)}`;
  }).join('\n');
}

function getContentTypeFromUrl(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (pathname.endsWith('.ts')) return 'video/mp2t';
  if (pathname.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

function isM3u8Response(url, contentType) {
  const normalizedContentType = String(contentType || '').toLowerCase();
  const pathname = new URL(url).pathname.toLowerCase();
  return pathname.endsWith('.m3u8') || normalizedContentType.includes('mpegurl') || normalizedContentType.includes('application/vnd.apple');
}

function copyProxyResponseHeaders(headers, res, { includeLength }) {
  ['accept-ranges', 'cache-control', 'content-range', 'etag', 'last-modified'].forEach((headerName) => {
    const value = headers.get(headerName);
    if (value) res.setHeader(headerName, value);
  });

  if (includeLength) {
    const contentLength = headers.get('content-length');
    if (contentLength) res.setHeader('content-length', contentLength);
  }
}

function normalizeStreamUrl(url) {
  const streamUrl = new URL(url);
  if (!['http:', 'https:'].includes(streamUrl.protocol)) {
    throw new Error('Protocolo inválido');
  }
  return streamUrl;
}

function normalizeServerUrl(server) {
  const trimmed = String(server || '').trim().replace(/\/+$/, '');
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withProtocol);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Protocolo inválido');
  }
  return url;
}

function resolveFrontendDistPath() {
  const candidatePaths = [
    path.resolve(__dirname, '..', 'dist'),
    path.resolve(__dirname, 'dist'),
  ];
  return candidatePaths.find((p) => fs.existsSync(path.join(p, 'index.html'))) || null;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${SERVICE_NAME} listening on http://0.0.0.0:${PORT}`);
});
