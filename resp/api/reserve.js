const ALLOWED_SOURCES = new Set(['youtube', 'openverse', 'commons', 'jamendo']);
const ALLOWED_MEDIA_TYPES = new Set(['yt', 'mp3', 'freevideo']);
const MAX_BATCH = 100;
const MAX_LIMIT = 50;
const ALLOWED_QUERY_SOURCES = new Set(['youtube', 'openverse', 'commons']);

function json(res, status, payload, headers = {}) {
  Object.entries({ 'Content-Type': 'application/json; charset=utf-8', ...headers }).forEach(([key, value]) => res.setHeader(key, value));
  return res.status(status).json(payload);
}

function compactCache(res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=3600');
}

function envConfig() {
  const rawUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const url = rawUrl
    ? (/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl.replace(/\/$/, '')}.supabase.co`).replace(/\/$/, '')
    : '';
  return {
    url,
    key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  };
}

function boundedInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

function text(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asRow(entry) {
  const source = text(entry.source, 32);
  const mediaType = text(entry.mediaType || entry.type, 24);
  const candidateKey = text(entry.candidateKey, 512);
  const url = text(entry.url, 4000);
  if (!candidateKey || !url || !ALLOWED_SOURCES.has(source) || !ALLOWED_MEDIA_TYPES.has(mediaType)) return null;
  return {
    candidate_key: candidateKey,
    source,
    source_id: text(entry.sourceId || entry.source_id || url, 512),
    media_type: mediaType,
    url,
    playable_url: text(entry.playableUrl || entry.playable_url || url, 4000),
    title: text(entry.title, 500) || 'Sin título',
    artist: text(entry.artist, 300),
    description: text(entry.description, 4000),
    thumbnail_url: text(entry.img || entry.thumbnail || entry.thumbnailUrl || entry.thumbnail_url, 4000),
    style_key: text(entry.styleKey || entry.style_key, 200) || 'rock metal',
    style_tokens: Array.isArray(entry.styleTokens || entry.style_tokens) ? (entry.styleTokens || entry.style_tokens).map(item => text(item, 80)).filter(Boolean).slice(0, 40) : [],
    radio_eligible: Boolean(entry.radioEligible ?? entry.radio_eligible),
    contexts: Array.isArray(entry.contexts) ? entry.contexts.map(item => text(item, 40)).filter(Boolean).slice(0, 20) : [text(entry.context, 40)].filter(Boolean),
    query_context: text(entry.queryContext || entry.query_context, 300),
    seed_key: text(entry.seedKey || entry.seed_key, 512) || null,
    license: text(entry.license, 500),
    license_version: text(entry.licenseVersion || entry.license_version, 120),
    source_url: text(entry.sourceUrl || entry.source_url, 4000),
    duration_seconds: Number.isFinite(Number(entry.duration)) ? Math.max(0, Math.round(Number(entry.duration))) : null,
    embeddable: typeof entry.embeddable === 'boolean' ? entry.embeddable : null,
    status: ['available', 'queued', 'played', 'invalid', 'expired'].includes(entry.status) ? entry.status : 'available',
    use_count: Math.max(0, Number.parseInt(entry.useCount || entry.use_count || 0, 10) || 0),
    discovered_at: isoOrNull(entry.discoveredAt || entry.discovered_at) || new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    last_used_at: isoOrNull(entry.lastUsedAt || entry.last_used_at),
    expires_at: isoOrNull(entry.expiresAt || entry.expires_at),
    last_error: text(entry.lastError || entry.last_error, 1000) || null,
    metadata: entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata) ? entry.metadata : {}
  };
}

function asQueryRow(body = {}) {
  const source = text(body.source, 32);
  const query = text(body.query, 300);
  const styleKey = text(body.styleKey || body.style_key, 200) || 'rock metal';
  const queryKey = text(body.queryKey || body.query_key, 512) || `${source}:${styleKey}:${query}`.toLowerCase();
  if (!queryKey || !query || !ALLOWED_QUERY_SOURCES.has(source)) return null;
  const status = ['ok', 'quota', 'error'].includes(body.status) ? body.status : 'ok';
  return {
    query_key: queryKey,
    source,
    query,
    style_key: styleKey,
    seed_key: text(body.seedKey || body.seed_key, 512) || null,
    next_page_token: text(body.nextPageToken || body.next_page_token, 1000) || null,
    pages_consumed: Math.max(0, Number.parseInt(body.pagesConsumed || body.pages_consumed || 0, 10) || 0),
    status,
    last_attempt_at: isoOrNull(body.lastAttemptAt || body.last_attempt_at) || new Date().toISOString(),
    last_success_at: isoOrNull(body.lastSuccessAt || body.last_success_at) || (status === 'ok' ? new Date().toISOString() : null),
    retry_after: isoOrNull(body.retryAfter || body.retry_after),
    result_count: Math.max(0, Number.parseInt(body.resultCount || body.result_count || 0, 10) || 0),
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {},
    updated_at: new Date().toISOString()
  };
}

function queryLookupUrl(req) {
  const params = new URLSearchParams({ select: '*' });
  const queryKey = text(req.query.queryKey || req.query.query_key, 512);
  if (queryKey) params.set('query_key', `eq.${queryKey}`);
  else {
    const source = text(req.query.source, 32);
    const query = text(req.query.query, 300);
    const styleKey = text(req.query.styleKey || req.query.style_key, 200) || 'rock metal';
    if (!ALLOWED_QUERY_SOURCES.has(source) || !query) return null;
    params.set('source', `eq.${source}`);
    params.set('query', `eq.${query}`);
    params.set('style_key', `eq.${styleKey}`);
  }
  params.set('limit', '1');
  return params.toString();
}

function fromRow(row) {
  const attribution = Array.isArray(row.youtoo_discovery_attributions) ? row.youtoo_discovery_attributions[0] : null;
  return {
    ...row.metadata,
    candidateKey: row.candidate_key,
    source: row.source,
    sourceId: row.source_id,
    type: row.media_type,
    url: row.url,
    playableUrl: row.playable_url,
    title: row.title,
    artist: row.artist,
    description: row.description,
    img: row.thumbnail_url,
    thumbnail: row.thumbnail_url,
    styleKey: row.style_key,
    radioEligible: row.radio_eligible,
    contexts: row.contexts || [],
    queryContext: row.query_context,
    seedKey: row.seed_key,
    license: row.license,
    licenseVersion: row.license_version,
    sourceUrl: row.source_url,
    duration: row.duration_seconds,
    embeddable: row.embeddable,
    status: row.status,
    healthStatus: row.health_status || 'unverified',
    healthCheckedAt: row.health_checked_at,
    healthNextCheckAt: row.health_next_check_at,
    healthHttpStatus: row.health_http_status,
    healthContentType: row.health_content_type,
    healthFailCount: row.health_fail_count || 0,
    healthPassCount: row.health_pass_count || 0,
    healthError: row.health_error || null,
    useCount: row.use_count,
    discoveredAt: row.discovered_at,
    lastSeenAt: row.last_seen_at,
    discoveredBy: row.discovered_by || attribution?.discovered_by || '',
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at
  };
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

function queryUrl(req, options = {}) {
  const params = new URLSearchParams();
  const discoveredBy = text(req.query.discoveredBy || req.query.discovered_by, 128);
  params.set('select', options.useAttribution === false || !discoveredBy ? '*' : '*,youtoo_discovery_attributions!inner(discovered_by)');
  const style = text(req.query.styleKey, 200);
  const artist = text(req.query.artist, 300);
  const source = text(req.query.source, 32);
  const kind = text(req.query.kind, 80).toLowerCase();
  const healthStatus = text(req.query.healthStatus || req.query.health_status, 32).toLowerCase();
  const status = text(req.query.status, 32).toLowerCase();
  const query = text(req.query.query, 300).toLowerCase();
  const scope = text(req.query.scope, 32).toLowerCase();
  if (style) params.set('style_key', `ilike.*${style.replace(/[*,()]/g, '')}*`);
  if (artist) params.set('artist', `ilike.*${artist.replace(/[*,()]/g, '')}*`);
  if (source && ALLOWED_SOURCES.has(source)) params.set('source', `eq.${source}`);
  if (kind === 'playlist') params.set('metadata->>resourceKind', 'eq.youtube#playlist');
  else if (kind === 'channel') params.set('metadata->>resourceKind', 'eq.youtube#channel');
  else if (kind === 'video') params.set('metadata->>resourceKind', 'eq.youtube#video');
  else if (kind === 'audio') params.set('media_type', 'eq.mp3');
  else if (kind === 'freevideo') params.set('media_type', 'eq.freevideo');
  else if (/^youtube#(?:video|playlist|channel)$/.test(kind)) params.set('metadata->>resourceKind', `eq.${kind}`);
  const safeDiscoveredBy = discoveredBy.replace(/[^a-zA-Z0-9_.:@-]/g, '');
  if (safeDiscoveredBy) {
    if (options.useAttribution === false) params.set('discovered_by', `eq.${safeDiscoveredBy}`);
    else params.set('youtoo_discovery_attributions.discovered_by', `eq.${safeDiscoveredBy}`);
  }
  if (query) {
    const safeQuery = query.replace(/[*,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (safeQuery) params.set('or', `(query_context.ilike.*${safeQuery}*,title.ilike.*${safeQuery}*,artist.ilike.*${safeQuery}*,description.ilike.*${safeQuery}*)`);
  }
  if (healthStatus && ['unverified', 'healthy', 'suspect', 'invalid'].includes(healthStatus)) params.set('health_status', `eq.${healthStatus}`);
  if (status && ['available', 'queued', 'played', 'invalid', 'expired'].includes(status)) params.set('status', `eq.${status}`);
  else if (text(req.query.includeAll, 10).toLowerCase() !== 'true') params.set('status', 'in.(available,queued,played)');
  if (scope !== 'search' && text(req.query.includeAll, 10).toLowerCase() !== 'true') params.set('radio_eligible', 'eq.true');
  params.set('order', 'last_used_at.asc.nullsfirst,discovered_at.desc');
  const limit = boundedInt(req.query.limit, 20, MAX_LIMIT);
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  return params.toString();
}

function quoteCsv(value) {
  const raw = String(value ?? '');
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function exportCsv(rows) {
  const columns = ['candidate_key', 'source', 'source_id', 'media_type', 'url', 'title', 'artist', 'style_key', 'radio_eligible', 'license', 'source_url', 'duration_seconds', 'status', 'use_count', 'discovered_at', 'last_used_at', 'discovered_by'];
  return [columns.join(','), ...rows.map(row => columns.map(column => quoteCsv(row[column])).join(','))].join('\r\n');
}

export default async function handler(req, res) {
  const config = envConfig();
  if (!config.url || !config.key) return json(res, 503, { error: { source: 'supabase', code: 'not_configured', message: 'La reserva global todavía no está configurada en Vercel' } });

  try {
    const body = req.body || {};
    const action = text(req.query.action || (req.method === 'GET' ? 'search' : body.action || 'upsert'), 40);
    if (req.method === 'GET' && action === 'query') {
      const lookup = queryLookupUrl(req);
      if (!lookup) return json(res, 400, { error: { source: 'supabase', message: 'Faltan queryKey o source, query y styleKey válidos' } });
      const result = await supabaseRequest(`youtoo_discovery_queries?${lookup}`);
      if (!result.response?.ok) return json(res, result.response?.status || 502, { error: { source: 'supabase', message: result.data?.message || 'No se pudo leer el estado de la consulta' } });
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return json(res, 200, { query: Array.isArray(result.data) ? result.data[0] || null : null });
    }

    if (req.method === 'GET' && action === 'search') {
      const resultOptions = { headers: { Prefer: 'count=exact' } };
      let result = await supabaseRequest(`youtoo_discovery_candidates?${queryUrl(req)}`, resultOptions);
      // Durante una actualización gradual puede existir todavía la columna singular
      // discovered_by pero no la tabla de atribuciones. En ese caso el catálogo global
      // sigue funcionando y el filtro propio usa el dato legado como respaldo.
      if (!result.response?.ok && text(req.query.discoveredBy || req.query.discovered_by, 128)) {
        result = await supabaseRequest(`youtoo_discovery_candidates?${queryUrl(req, { useAttribution: false })}`, resultOptions);
      }
      if (!result.response?.ok) return json(res, result.response?.status || 502, { error: { source: 'supabase', message: result.data?.message || 'No se pudo leer la reserva global' } });
      const contentRange = result.response.headers.get('content-range') || '';
      const totalMatch = contentRange.match(/\/(\d+)$/);
      if (text(req.query.discoveredBy || req.query.discovered_by, 128)) res.setHeader('Cache-Control', 'private, no-store');
      else compactCache(res);
      return json(res, 200, { results: (result.data || []).map(fromRow), total: totalMatch ? Number(totalMatch[1]) : null });
    }

    if (req.method === 'GET' && action === 'export') {
      const params = new URLSearchParams({ select: '*', order: 'discovered_at.desc', limit: '10000' });
      const result = await supabaseRequest(`youtoo_discovery_candidates?${params}`);
      if (!result.response?.ok) return json(res, result.response?.status || 502, { error: { source: 'supabase', message: result.data?.message || 'No se pudo exportar la reserva global' } });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="nowarfy-discovery-reserve.csv"');
      return res.status(200).send(`\ufeff${exportCsv(result.data || [])}`);
    }
    if (req.method === 'GET' && action === 'stats') {
      const kindDefinitions = [
        ['videos', 'metadata->>resourceKind', 'youtube#video'],
        ['playlists', 'metadata->>resourceKind', 'youtube#playlist'],
        ['channels', 'metadata->>resourceKind', 'youtube#channel'],
        ['audio', 'media_type', 'mp3'],
        ['freeVideos', 'media_type', 'freevideo']
      ];
      const [candidates, queries, sourceResults, kindResults] = await Promise.all([
        supabaseRequest('youtoo_discovery_candidates?select=count', { headers: { Prefer: 'count=exact' } }),
        supabaseRequest('youtoo_discovery_queries?select=count', { headers: { Prefer: 'count=exact' } }),
        Promise.all(['youtube', 'openverse', 'commons', 'jamendo'].map(source => supabaseRequest(`youtoo_discovery_candidates?select=count&source=eq.${source}`, { headers: { Prefer: 'count=exact' } }))),
        Promise.all(kindDefinitions.map(([, column, value]) => supabaseRequest(`youtoo_discovery_candidates?select=count&${column}=eq.${encodeURIComponent(value)}`, { headers: { Prefer: 'count=exact' } })))
      ]);
      const recent = await supabaseRequest('youtoo_discovery_candidates?select=*&order=discovered_at.desc&limit=10');
      const sourceCounts = Object.fromEntries(['youtube', 'openverse', 'commons', 'jamendo'].map((source, index) => [source, Number(sourceResults[index]?.response?.headers.get('content-range')?.split('/')[1] || 0)]));
      const kindCounts = Object.fromEntries(kindDefinitions.map(([label], index) => [label, Number(kindResults[index]?.response?.headers.get('content-range')?.split('/')[1] || 0)]));
      return json(res, 200, {
        totalCandidates: Number(candidates.response?.headers.get('content-range')?.split('/')[1] || 0),
        totalQueries: Number(queries.response?.headers.get('content-range')?.split('/')[1] || 0),
        sourceCounts,
        kindCounts,
        recent: (recent.data || []).map(fromRow)
      });
    }

    if (req.method !== 'POST') return json(res, 405, { error: { source: 'supabase', message: 'Método no permitido' } });
    if (action === 'query-upsert') {
      const row = asQueryRow(body);
      if (!row) return json(res, 400, { error: { source: 'supabase', message: 'Estado de consulta inválido' } });
      if (body.discoveredBy) row.discovered_by = text(body.discoveredBy, 128);
      const result = await supabaseRequest('youtoo_discovery_queries?on_conflict=query_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
      if (!result.response?.ok) return json(res, result.response?.status || 502, { error: { source: 'supabase', message: result.data?.message || 'No se pudo guardar el estado de la consulta' } });
      return json(res, 200, { saved: true, queryKey: row.query_key });
    }

    if (action === 'upsert') {
      const discoveredBy = text(body.discoveredBy, 128);
      const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, MAX_BATCH).map(e => {
        const r = asRow(e);
        if (r && discoveredBy) r.discovered_by = discoveredBy;
        return r;
      }).filter(Boolean);
      if (!entries.length) return json(res, 400, { error: { source: 'supabase', message: 'No hay candidatos válidos para guardar' } });
      const result = await supabaseRequest('youtoo_discovery_candidates?on_conflict=candidate_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(entries) });
      if (!result.response?.ok) return json(res, result.response?.status || 502, { error: { source: 'supabase', message: result.data?.message || 'No se pudo guardar la reserva global' } });
      if (discoveredBy) {
        const attributionRows = entries.map(entry => ({ candidate_key: entry.candidate_key, discovered_by: discoveredBy }));
        const attributionResult = await supabaseRequest('youtoo_discovery_attributions?on_conflict=candidate_key,discovered_by', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(attributionRows)
        });
        if (!attributionResult.response?.ok) console.warn('No se pudieron guardar atribuciones detalladas; se conserva discovered_by legado.', attributionResult.data);
      }
      return json(res, 200, { saved: entries.length });
    }

    if (action === 'mark-used') {
      const candidateKey = text(body.candidateKey, 512);
      if (!candidateKey) return json(res, 400, { error: { source: 'supabase', message: 'Falta candidateKey' } });
      const params = new URLSearchParams({ candidate_key: `eq.${candidateKey}` });
      const result = await supabaseRequest(`youtoo_discovery_candidates?${params}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'played', last_used_at: new Date().toISOString() })
      });
      if (!result.response?.ok) return json(res, result.response?.status || 502, { error: { source: 'supabase', message: result.data?.message || 'No se pudo marcar el candidato' } });
      return json(res, 200, { updated: true });
    }

    return json(res, 400, { error: { source: 'supabase', message: 'Acción inválida' } });
  } catch (error) {
    console.error('reserve endpoint error', error);
    return json(res, 500, { error: { source: 'supabase', message: 'Error interno de la reserva global' } });
  }
}
