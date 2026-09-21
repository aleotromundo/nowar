const MAX_LIMIT = 40;
const DEFAULT_LIMIT = 20;
const MAX_PURGE = 25;
const CHECK_CONCURRENCY = 4;
const INVALID_RETENTION_DAYS = 30;
const YOUTUBE_OEMBED = 'https://www.youtube.com/oembed';

function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(payload);
}

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function envConfig() {
  const rawUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const url = rawUrl
    ? (/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl.replace(/\/$/, '')}.supabase.co`).replace(/\/$/, '')
    : '';
  return { url, key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() };
}

function boundedInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

function isPrivateIp(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '0.0.0.0' || host === '127.0.0.1' || host === '169.254.169.254' || host === '::1') return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31) return true;
  }
  if (host.includes(':') && (/^(fc|fd)/i.test(host) || /^fe8|^fe9|^fea|^feb/i.test(host))) return true;
  return false;
}

function publicHttpUrl(value, base = '') {
  try {
    const parsed = new URL(String(value || ''), base || undefined);
    if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateIp(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isYouTubeHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
}

function resourceKind(row) {
  return text(row?.metadata?.resourceKind || row?.resource_kind, 80).toLowerCase();
}

function youtubeCanonicalUrl(row) {
  const id = text(row.source_id || row.url, 200);
  const kind = resourceKind(row);
  if (!id) return null;
  if (kind === 'youtube#channel') return `https://www.youtube.com/channel/${encodeURIComponent(id)}`;
  if (kind === 'youtube#playlist') return `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

function youtubeOembedUrl(row) {
  const target = youtubeCanonicalUrl(row);
  if (!target) return null;
  return `${YOUTUBE_OEMBED}?url=${encodeURIComponent(target)}&format=json`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function result(ok, code, details = {}) {
  return { ok, code, ...details };
}

async function probeDirectUrl(rawUrl, mediaType) {
  let current = publicHttpUrl(rawUrl);
  if (!current) return result(false, 'unsafe_url', { permanent: true });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response;
    try {
      response = await fetchWithTimeout(current.href, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': 'Nowarfy-YouToo/1.0 (reserve health check)', Accept: '*/*' }
      });
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      return result(false, aborted ? 'timeout' : 'network_error', { transient: true, error: text(error?.message || error, 300) });
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const next = publicHttpUrl(location, current.href);
      if (!next) return result(false, 'unsafe_redirect', { permanent: true, httpStatus: response.status });
      current = next;
      continue;
    }

    if ([405, 501].includes(response.status)) {
      try {
        response = await fetchWithTimeout(current.href, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'User-Agent': 'Nowarfy-YouToo/1.0 (reserve health check)', Accept: '*/*', Range: 'bytes=0-1' }
        });
      } catch (error) {
        const aborted = error?.name === 'AbortError';
        return result(false, aborted ? 'timeout' : 'network_error', { transient: true, error: text(error?.message || error, 300) });
      }
      if (response.body?.getReader) {
        try {
          const reader = response.body.getReader();
          await reader.read();
          await reader.cancel();
        } catch { /* algunos servidores cierran el body después del primer byte */ }
      }
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const next = publicHttpUrl(location, current.href);
      if (!next) return result(false, 'unsafe_redirect', { permanent: true, httpStatus: response.status });
      current = next;
      continue;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const looksLikeExpectedMedia = !contentType
      ? true
      : mediaType === 'mp3'
        ? contentType.startsWith('audio/') || contentType.includes('octet-stream') || contentType.includes('mpeg') || contentType.includes('ogg')
        : mediaType === 'freevideo'
          ? contentType.startsWith('video/') || contentType.includes('octet-stream') || contentType.includes('webm') || contentType.includes('ogg')
          : true;
    if (response.status >= 200 && response.status < 300 && looksLikeExpectedMedia) {
      return result(true, 'ok', { httpStatus: response.status, contentType, checkedUrl: current.href });
    }
    if (response.status === 404 || response.status === 410) return result(false, 'not_found', { permanent: true, httpStatus: response.status, contentType, checkedUrl: current.href });
    if (response.status === 401 || response.status === 403) return result(false, 'forbidden_or_hotlink', { transient: true, httpStatus: response.status, contentType, checkedUrl: current.href });
    if (response.status === 429 || response.status >= 500) return result(false, 'temporary_http_error', { transient: true, httpStatus: response.status, contentType, checkedUrl: current.href });
    if (!looksLikeExpectedMedia) return result(false, 'unexpected_content_type', { permanent: true, httpStatus: response.status, contentType, checkedUrl: current.href });
    return result(false, 'http_error', { transient: true, httpStatus: response.status, contentType, checkedUrl: current.href });
  }
  return result(false, 'too_many_redirects', { permanent: true });
}

async function checkYouTube(row) {
  const kind = resourceKind(row);
  const oembed = youtubeOembedUrl(row);
  if (!oembed) return result(false, 'missing_youtube_id', { permanent: true });

  // oEmbed confirma videos públicos y evita gastar una unidad de la Data API.
  // Para canales/listas, la comprobación HTTP es deliberadamente menos estricta.
  try {
    const response = await fetchWithTimeout(oembed, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Nowarfy-YouToo/1.0 (reserve health check)', Accept: 'application/json' }
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (response.ok) {
      if (kind === 'youtube#video') {
        const body = await response.json().catch(() => null);
        if (!body?.title) return result(false, 'youtube_invalid_metadata', { permanent: true, httpStatus: response.status, contentType });
      }
      return result(true, 'ok', { httpStatus: response.status, contentType });
    }
    if ([429, 500, 502, 503, 504].includes(response.status)) return result(false, 'youtube_temporary_error', { transient: true, httpStatus: response.status, contentType });
    if (kind === 'youtube#video' && [400, 404].includes(response.status)) return result(false, 'youtube_unavailable', { permanent: true, httpStatus: response.status, contentType });
    // oEmbed no soporta todas las URLs de canales/listas; no las invalida por eso.
    if (kind !== 'youtube#video') {
      const pageUrl = youtubeCanonicalUrl(row);
      const pageResult = await probeDirectUrl(pageUrl, 'yt');
      return pageResult.ok ? pageResult : result(false, 'youtube_catalog_unavailable', { transient: !pageResult.permanent, permanent: Boolean(pageResult.permanent), httpStatus: pageResult.httpStatus });
    }
    return result(false, 'youtube_http_error', { transient: true, httpStatus: response.status, contentType });
  } catch (error) {
    return result(false, error?.name === 'AbortError' ? 'youtube_timeout' : 'youtube_network_error', { transient: true, error: text(error?.message || error, 300) });
  }
}

async function checkCandidate(row) {
  const contentGroup = text(row?.metadata?.contentGroup, 80).toLowerCase();
  if (row.radio_eligible && contentGroup === 'non_music_video') {
    return result(false, 'classification_mismatch', { permanent: true });
  }
  if (!text(row.title, 500) || !text(row.playable_url || row.url, 4000)) {
    return result(false, 'missing_metadata_or_playable_url', { permanent: true });
  }
  if (row.source === 'youtube') {
    const target = youtubeCanonicalUrl(row);
    if (!target || !isYouTubeHost(new URL(target).hostname)) return result(false, 'invalid_youtube_url', { permanent: true });
    return checkYouTube(row);
  }
  const direct = row.playable_url || row.url;
  return probeDirectUrl(direct, row.media_type);
}

function nextCheckAt(outcome, healthStatus) {
  const now = Date.now();
  const delay = outcome.ok
    ? (healthStatus === 'healthy' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000)
    : outcome.transient
      ? 6 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  return new Date(now + delay).toISOString();
}

function buildHealthPatch(row, outcome) {
  const previousFails = Number(row.health_fail_count || 0);
  const previousPasses = Number(row.health_pass_count || 0);
  const failCount = outcome.ok ? 0 : previousFails + 1;
  const passCount = outcome.ok ? previousPasses + 1 : previousPasses;
  // Nunca invalidamos por un único error. Los errores temporales necesitan más reintentos.
  const threshold = outcome.permanent ? 3 : 5;
  const healthStatus = outcome.ok ? 'healthy' : failCount >= threshold ? 'invalid' : 'suspect';
  const patch = {
    health_status: healthStatus,
    health_checked_at: new Date().toISOString(),
    health_http_status: Number.isInteger(outcome.httpStatus) ? outcome.httpStatus : null,
    health_content_type: text(outcome.contentType, 160) || null,
    health_fail_count: failCount,
    health_pass_count: passCount,
    health_error: outcome.ok ? null : text(outcome.code || 'health_check_failed', 300),
    health_next_check_at: nextCheckAt(outcome, healthStatus),
    last_error: outcome.ok ? null : text(outcome.code || 'health_check_failed', 1000)
  };
  if (outcome.ok) {
    const refreshDays = row.media_type === 'yt' ? 30 : 14;
    patch.expires_at = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000).toISOString();
  }
  if (healthStatus === 'invalid' && row.status !== 'invalid') patch.status = 'invalid';
  return patch;
}

async function supabaseRequest(path, options = {}) {
  const config = envConfig();
  if (!config.url || !config.key) return { configured: false, response: null, data: null };
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch { data = body; }
  return { configured: true, response, data };
}

function isAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  const authorization = String(req.headers?.authorization || '');
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

async function purgeOldInvalidCandidates() {
  const cutoff = new Date(Date.now() - INVALID_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    select: 'candidate_key',
    health_status: 'eq.invalid',
    health_checked_at: `lt.${cutoff}`,
    status: 'eq.invalid',
    order: 'health_checked_at.asc',
    limit: String(MAX_PURGE)
  });
  const selected = await supabaseRequest(`youtoo_discovery_candidates?${params.toString()}`);
  if (!selected.response?.ok) return { purged: 0, error: 'purge_select_failed' };
  const rows = (selected.data || []).slice(0, MAX_PURGE);
  const deleted = await Promise.all(rows.map(async row => {
    const keyParams = new URLSearchParams({ candidate_key: `eq.${row.candidate_key}` });
    const response = await supabaseRequest(`youtoo_discovery_candidates?${keyParams.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
    return Boolean(response.response?.ok);
  }));
  return { purged: deleted.filter(Boolean).length };
}

function candidateQuery(req, limit) {
  const params = new URLSearchParams({
    select: '*',
    status: 'in.(available,queued,played)',
    order: 'health_checked_at.asc.nullsfirst,discovered_at.asc',
    limit: String(Math.min(MAX_LIMIT * 3, Math.max(limit * 3, limit)))
  });
  const source = text(req.query?.source, 32);
  if (source && ['youtube', 'openverse', 'commons', 'jamendo'].includes(source)) params.set('source', `eq.${source}`);
  return params.toString();
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
  if (!isAuthorized(req)) return json(res, 401, { error: 'No autorizado' });

  const config = envConfig();
  if (!config.url || !config.key) return json(res, 503, { error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY' });

  const limit = boundedInt(req.query?.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const dryRun = String(req.query?.dryRun || '').toLowerCase() === 'true';
  try {
    const selected = await supabaseRequest(`youtoo_discovery_candidates?${candidateQuery(req, limit)}`);
    if (!selected.response?.ok) return json(res, selected.response?.status || 502, { error: selected.data?.message || 'No se pudo leer la reserva' });

    const now = Date.now();
    const candidates = (selected.data || [])
      .filter(row => row.health_status !== 'invalid')
      .filter(row => !row.health_next_check_at || Number.isNaN(Date.parse(row.health_next_check_at)) || Date.parse(row.health_next_check_at) <= now)
      .slice(0, limit);
    const summary = { selected: candidates.length, checked: 0, healthy: 0, suspect: 0, invalid: 0, skipped: 0 };
    const results = [];

    for (let offset = 0; offset < candidates.length; offset += CHECK_CONCURRENCY) {
      const batch = candidates.slice(offset, offset + CHECK_CONCURRENCY);
      const checkedBatch = await Promise.all(batch.map(async row => ({ row, outcome: await checkCandidate(row) })));
      for (const { row, outcome } of checkedBatch) {
        const patch = buildHealthPatch(row, outcome);
        if (!dryRun) {
          const params = new URLSearchParams({ candidate_key: `eq.${row.candidate_key}` });
          const updated = await supabaseRequest(`youtoo_discovery_candidates?${params.toString()}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(patch)
          });
          if (!updated.response?.ok) {
            summary.skipped += 1;
            results.push({ candidateKey: row.candidate_key, source: row.source, ok: false, code: 'update_failed' });
            continue;
          }
        }
        summary.checked += 1;
        summary[patch.health_status] = Number(summary[patch.health_status] || 0) + 1;
        results.push({ candidateKey: row.candidate_key, source: row.source, ok: outcome.ok, code: outcome.code, healthStatus: patch.health_status, httpStatus: outcome.httpStatus || null });
      }
    }

    const purge = dryRun ? { purged: 0, skipped: true } : await purgeOldInvalidCandidates();
    return json(res, 200, {
      ok: true,
      dryRun,
      checkedAt: new Date().toISOString(),
      ...summary,
      ...purge,
      results
    });
  } catch (error) {
    console.error('cleanup reserve error', error);
    return json(res, 500, { error: 'Error interno de limpieza', detail: text(error?.message || error, 300) });
  }
}
