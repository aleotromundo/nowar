const LRCLIB_GET_API = 'https://lrclib.net/api/get';
const LRCLIB_SEARCH_API = 'https://lrclib.net/api/search';
const APP_USER_AGENT = 'Nowarfy-YouToo/1.0 (https://nowarfy.vercel.app/)';
const MAX_GET_ATTEMPTS = 4;
const MAX_SEARCH_ATTEMPTS = 2;
const MAX_SEARCH_RESULTS = 20;
const EXACT_DURATION_TOLERANCE_SECONDS = 3;
const BOUNDED_DURATION_TOLERANCE_SECONDS = 12;
const MIN_FIELD_SCORE = 0.9;
const MIN_ACCEPT_SCORE = 0.9;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanQuery(value, maxLength = 160) {
  return String(value || '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function compactCache(res, found = true) {
  res.setHeader('Cache-Control', found
    ? 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400'
    : 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600');
}

function uniqueByNormalized(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = normalizeText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitCamelCase(value) {
  return String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function versionMarkers(value) {
  return new Set((normalizeText(value).match(/\b(?:live|acoustic|remix|karaoke|instrumental|demo|cover|radio|extended|unplugged|nightcore|slowed|sped|edit)\b/g) || []));
}

function compatibleVersions(requestedTitle, resultTitle) {
  const requested = versionMarkers(requestedTitle);
  const result = versionMarkers(resultTitle);
  if (!requested.size && !result.size) return true;
  if (requested.size !== result.size) return false;
  for (const marker of requested) if (!result.has(marker)) return false;
  return true;
}

function stripDecorativeTitle(value) {
  let text = splitCamelCase(cleanQuery(value));
  text = text.replace(/\s*[([{]([^\])}]{0,100})[\])}]/g, (full, inner) => {
    const normalized = normalizeText(inner);
    return /\b(?:official|music\s+video|video|audio|lyrics?|lyric|visualizer|hd|hq|4k|remaster(?:ed)?|vevo)\b/.test(normalized)
      ? ' '
      : full;
  });
  text = text.replace(/\s+(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|lyric|visualizer|hd|hq|4k)\s*$/i, ' ');
  text = text.replace(/\s*[-|·–—]\s*(?:official|music|audio|video|lyrics?|lyric|visualizer|vevo)\b.*$/i, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function splitEmbeddedArtist(title) {
  const cleaned = stripDecorativeTitle(title);
  const match = cleaned.match(/^(.{2,80}?)\s+[-–—|·]\s+(.{2,140})$/);
  if (!match) return null;
  const left = cleanQuery(match[1]);
  const right = cleanQuery(match[2]);
  if (!left || !right || /^(official|music|video|audio|lyrics?|lyric)$/i.test(left)) return null;
  return { artist: left, title: right };
}

function deriveTitleCandidates(value) {
  const cleaned = stripDecorativeTitle(value);
  const embedded = splitEmbeddedArtist(cleaned);
  return uniqueByNormalized([
    cleaned,
    embedded?.title,
    cleanQuery(value)
  ]).slice(0, 4);
}

function cleanArtistCandidate(value) {
  let text = splitCamelCase(cleanQuery(value));
  text = text
    .replace(/\s*[-|·–—]\s*(?:topic|official|music|channel|canal)\s*$/i, ' ')
    .replace(/(?:\s|[-|·–—])(?:vevo|topic)\s*$/i, ' ')
    .replace(/\b(?:official|music|channel|canal)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function deriveArtistCandidates(requestedArtist, requestedTitle) {
  const embedded = splitEmbeddedArtist(requestedTitle);
  return uniqueByNormalized([
    cleanArtistCandidate(requestedArtist),
    embedded?.artist,
    cleanQuery(requestedArtist)
  ]).map((value, index) => ({ value, source: index === 0 ? 'metadata' : index === 1 ? 'title_embedded' : 'raw_metadata' })).slice(0, 4);
}

function canonicalTitle(value) {
  return normalizeText(value)
    .replace(/\b(?:official|music|video|audio|lyrics?|lyric|visualizer|hd|hq|4k|vevo|remaster(?:ed)?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalArtist(value) {
  return normalizeText(cleanArtistCandidate(value));
}

function canonicalTrackTitle(value, artist) {
  const title = canonicalTitle(value);
  const performer = canonicalArtist(artist);
  if (!title || !performer) return title;
  if (title.startsWith(`${performer} `)) return title.slice(performer.length).trim();
  const compactTitle = title.replace(/\s/g, '');
  const compactPerformer = performer.replace(/\s/g, '');
  if (compactTitle.startsWith(`${compactPerformer} `)) return title.slice(performer.length).trim();
  return title;
}

function tokenScore(queryValue, resultValue, canonicalizer) {
  const query = canonicalizer(queryValue);
  const result = canonicalizer(resultValue);
  if (!query || !result) return 0;
  if (query === result) return 1;
  if (query.replace(/\s/g, '') === result.replace(/\s/g, '')) return 0.98;
  const queryTokens = new Set(query.split(' '));
  const resultTokens = new Set(result.split(' '));
  const intersection = [...queryTokens].filter(token => resultTokens.has(token)).length;
  if (!intersection) return 0;
  const recall = intersection / Math.min(queryTokens.size, resultTokens.size);
  const precision = intersection / Math.max(queryTokens.size, resultTokens.size);
  if (recall === 1) return 0.92 + (precision * 0.06);
  return (2 * recall * precision) / (recall + precision);
}

function bestFieldMatch(candidates, resultValue, canonicalizer) {
  return candidates.reduce((best, candidate) => {
    const score = tokenScore(candidate.value, resultValue, canonicalizer);
    return !best || score > best.score ? { score, candidate } : best;
  }, null) || { score: 0, candidate: null };
}

function durationInfo(requestedDuration, resultDuration) {
  const requested = Number(requestedDuration);
  const result = Number(resultDuration);
  const requestedAvailable = Number.isFinite(requested) && requested > 0;
  const resultAvailable = Number.isFinite(result) && result > 0;
  if (!requestedAvailable || !resultAvailable) {
    return { compared: false, exact: null, accepted: true, score: 1, delta: null };
  }
  const delta = Math.abs(requested - result);
  if (delta > BOUNDED_DURATION_TOLERANCE_SECONDS) {
    return { compared: true, exact: false, accepted: false, score: 0, delta };
  }
  return {
    compared: true,
    exact: delta <= EXACT_DURATION_TOLERANCE_SECONDS,
    accepted: true,
    score: delta <= EXACT_DURATION_TOLERANCE_SECONDS ? 1 : 0.9 - ((delta - EXACT_DURATION_TOLERANCE_SECONDS) * 0.015),
    delta
  };
}

function hasLyrics(record) {
  return !record?.instrumental && !!String(record?.plainLyrics || record?.syncedLyrics || '').trim();
}

function scoreRecord(record, requested, method, query) {
  if (!record || !hasLyrics(record)) return null;
  const titleCandidates = deriveTitleCandidates(requested.title).map(value => ({ value, source: value === stripDecorativeTitle(requested.title) ? 'clean_title' : 'title_variant' }));
  const artistCandidates = deriveArtistCandidates(requested.artist, requested.title);
  const resultTitle = record.trackName || record.name || '';
  const titleMatch = bestFieldMatch(titleCandidates, resultTitle, canonicalTitle);
  const artistMatch = bestFieldMatch(artistCandidates, record.artistName, canonicalArtist);
  const duration = durationInfo(requested.duration, record.duration);
  const variantsMatch = compatibleVersions(requested.title, resultTitle);
  if (!variantsMatch || !duration.accepted || titleMatch.score < 0.82 || artistMatch.score < 0.82) return null;

  const hasRequestedDuration = Number.isFinite(Number(requested.duration)) && Number(requested.duration) > 0;
  const score = hasRequestedDuration
    ? (titleMatch.score * 0.46) + (artistMatch.score * 0.42) + (duration.score * 0.12)
    : (titleMatch.score * 0.52) + (artistMatch.score * 0.48);
  const passes = titleMatch.score >= MIN_FIELD_SCORE
    && artistMatch.score >= MIN_FIELD_SCORE
    && score >= MIN_ACCEPT_SCORE;
  const resultArtist = record.artistName || '';
  return {
    record,
    method,
    query,
    score,
    passes,
    titleMatch,
    artistMatch,
    duration,
    signature: `${canonicalArtist(resultArtist)}::${canonicalTrackTitle(resultTitle, resultArtist)}`
  };
}

function sameLogicalTrack(left, right) {
  return left?.signature && left.signature === right?.signature;
}

function selectBest(candidates) {
  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  const top = sorted.find(candidate => candidate.passes);
  if (!top) return { status: 'none', candidate: null };
  const challenger = sorted.find(candidate => candidate !== top && !sameLogicalTrack(candidate, top) && candidate.passes);
  if (challenger && (top.score - challenger.score) < 0.045) return { status: 'ambiguous', candidate: null };
  return { status: 'accepted', candidate: top };
}

function responseRecord(data) {
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

async function fetchLrclib(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': APP_USER_AGENT,
      'X-User-Agent': APP_USER_AGENT
    }
  });
  const data = await response.json().catch(() => null);
  if (response.status === 404) return { kind: 'not_found', response, data };
  if (!response.ok) return { kind: 'upstream_error', response, data };
  return { kind: 'ok', response, data };
}

function sendUpstreamError(res, result) {
  const status = Number(result?.response?.status || 502) === 429 ? 429 : 502;
  res.setHeader('Retry-After', result?.response?.headers?.get?.('retry-after') || '30');
  return res.status(status).json({
    found: false,
    error: { source: 'lrclib', message: result?.data?.message || 'La fuente de letras no está disponible ahora' }
  });
}

function buildQueryPairs(requested) {
  const titles = deriveTitleCandidates(requested.title);
  const artists = deriveArtistCandidates(requested.artist, requested.title).map(candidate => candidate.value);
  const pairs = [];
  const add = (title, artist) => {
    const cleanTitle = cleanQuery(title);
    const cleanArtist = cleanQuery(artist);
    if (!cleanTitle || !cleanArtist) return;
    const key = `${normalizeText(cleanTitle)}::${normalizeText(cleanArtist)}`;
    if (pairs.some(pair => pair.key === key)) return;
    pairs.push({ title: cleanTitle, artist: cleanArtist, key });
  };
  add(titles[0], artists[0]);
  add(titles[1], artists[0]);
  add(titles[0], artists[1]);
  add(titles[1], artists[1]);
  return pairs.slice(0, MAX_GET_ATTEMPTS);
}

function buildSearchQueries(requested) {
  const titles = deriveTitleCandidates(requested.title);
  const artists = deriveArtistCandidates(requested.artist, requested.title).map(candidate => candidate.value);
  return uniqueByNormalized([
    `${titles[1] || titles[0] || ''} ${artists[0] || ''}`,
    `${titles[0] || ''} ${artists[0] || ''}`,
    `${titles[1] || titles[0] || ''} ${artists[1] || ''}`
  ].map(cleanQuery)).slice(0, MAX_SEARCH_ATTEMPTS);
}

function getQueryUrl(pair, requested) {
  const params = new URLSearchParams({ track_name: pair.title, artist_name: pair.artist });
  if (requested.album) params.set('album_name', requested.album);
  if (Number.isFinite(requested.duration) && requested.duration > 0 && requested.duration <= 3600) {
    params.set('duration', String(Math.round(requested.duration)));
  }
  return `${LRCLIB_GET_API}?${params.toString()}`;
}

function getSearchUrl(query) {
  return `${LRCLIB_SEARCH_API}?${new URLSearchParams({ q: query }).toString()}`;
}

function searchRecords(data) {
  if (Array.isArray(data)) return data.slice(0, MAX_SEARCH_RESULTS);
  if (Array.isArray(data?.tracks)) return data.tracks.slice(0, MAX_SEARCH_RESULTS);
  if (Array.isArray(data?.results)) return data.results.slice(0, MAX_SEARCH_RESULTS);
  return [];
}

function formatResponse(scored) {
  const { record, method, query, score, titleMatch, artistMatch, duration } = scored;
  return {
    found: true,
    verified: true,
    verification: {
      artist: artistMatch.score >= MIN_FIELD_SCORE,
      title: titleMatch.score >= MIN_FIELD_SCORE,
      duration: duration.compared ? duration.accepted : null,
      durationExact: duration.compared ? duration.exact : null,
      durationDelta: duration.delta === null ? null : Math.round(duration.delta * 10) / 10,
      durationToleranceSeconds: duration.compared && !duration.exact ? BOUNDED_DURATION_TOLERANCE_SECONDS : EXACT_DURATION_TOLERANCE_SECONDS,
      confidence: Math.round(score * 1000) / 1000,
      matchMethod: method,
      titleQuery: query?.title || '',
      artistQuery: query?.artist || query?.q || ''
    },
    track: {
      id: Number(record.id) || null,
      title: String(record.trackName || record.name || '').trim(),
      artist: String(record.artistName || '').trim(),
      album: String(record.albumName || '').trim(),
      duration: Number(record.duration) || null,
      plainLyrics: String(record.plainLyrics || '').trim(),
      syncedLyrics: String(record.syncedLyrics || '').trim(),
      source: 'LRCLIB',
      sourceUrl: 'https://lrclib.net/'
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { message: 'Método no permitido' } });
  }

  const requested = {
    title: cleanQuery(req.query.title),
    artist: cleanQuery(req.query.artist),
    album: cleanQuery(req.query.album),
    duration: Number(req.query.duration)
  };
  if (!requested.title || !requested.artist) {
    return res.status(400).json({ found: false, error: { message: 'Faltan título y artista' } });
  }

  try {
    const candidates = [];
    const pairs = buildQueryPairs(requested);
    for (const pair of pairs) {
      const result = await fetchLrclib(getQueryUrl(pair, requested));
      if (result.kind === 'upstream_error') return sendUpstreamError(res, result);
      if (result.kind !== 'ok') continue;
      const scored = scoreRecord(responseRecord(result.data), requested, 'exact_get', pair);
      if (scored) candidates.push(scored);
    }

    let selection = selectBest(candidates);
    if (selection.status === 'accepted') {
      compactCache(res, true);
      return res.status(200).json(formatResponse(selection.candidate));
    }

    for (const query of buildSearchQueries(requested)) {
      const result = await fetchLrclib(getSearchUrl(query));
      if (result.kind === 'upstream_error') return sendUpstreamError(res, result);
      if (result.kind !== 'ok') continue;
      for (const record of searchRecords(result.data)) {
        const scored = scoreRecord(record, requested, 'search_fallback', { q: query });
        if (scored) candidates.push(scored);
      }
      selection = selectBest(candidates);
      if (selection.status === 'accepted') {
        compactCache(res, true);
        return res.status(200).json(formatResponse(selection.candidate));
      }
    }

    compactCache(res, false);
    return res.status(200).json({
      found: false,
      reason: selection.status === 'ambiguous' ? 'ambiguous_match' : candidates.length ? 'metadata_mismatch' : 'not_found'
    });
  } catch (error) {
    console.error('lyrics proxy error', error);
    return res.status(502).json({ found: false, error: { source: 'lrclib', message: 'No se pudo consultar la fuente de letras' } });
  }
}
