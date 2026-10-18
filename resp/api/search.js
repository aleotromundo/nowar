// api/search.js
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

function respondYouTubeError(res, response, data) {
  return res.status(response.status).json({
    error: {
      source: 'youtube',
      code: data?.error?.code || response.status,
      reason: data?.error?.errors?.[0]?.reason || data?.error?.status || 'youtube_error',
      message: data?.error?.message || 'No se pudo consultar YouTube'
    }
  });
}

function compactCache(res) {
  // Cinco minutos en navegador y hasta seis horas compartido para catálogos públicos.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400');
}

function boundedMax(value, fallback = 24) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 50) : fallback;
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function commonsLicenseAllowed(value) {
  const license = stripHtml(value).toLowerCase();
  return license.includes('public domain') || /cc\s*by(?:-sa)?(?:\s|\d|$)/i.test(license) || license.includes('cc0');
}

function mapCommonsVideoPage(page) {
  const info = page?.imageinfo?.[0];
  const mime = String(info?.mime || '').toLowerCase();
  const width = Number(info?.width || 0);
  const height = Number(info?.height || 0);
  const license = stripHtml(info?.extmetadata?.LicenseShortName?.value || info?.extmetadata?.UsageTerms?.value || '');
  if (!info?.url || !info?.thumburl || !commonsLicenseAllowed(license)) return null;
  const isOggVideo = ['video/ogg', 'application/ogg'].includes(mime) && width > 0 && height > 0;
  if (mime !== 'video/webm' && !isOggVideo) return null;
  const durationRaw = stripHtml(info?.extmetadata?.Duration?.value || '');
  const duration = Number.parseFloat(durationRaw);
  return {
    id: String(page?.pageid || ''),
    title: String(page?.title || '').replace(/^File:/i, '').replace(/\.(webm|ogv|ogg)$/i, '').trim(),
    creator: stripHtml(info?.extmetadata?.Artist?.value || info?.extmetadata?.Credit?.value || 'Wikimedia Commons'),
    description: stripHtml(info?.extmetadata?.ImageDescription?.value || ''),
    license,
    mime,
    url: info.url,
    thumbnail: info.thumburl,
    sourceUrl: page?.canonicalurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page?.title || ''))}`,
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    width,
    height
  };
}

function mapJamendoTrack(track) {
  const audio = String(track?.audio || '').trim();
  const title = String(track?.name || '').trim();
  const artist = String(track?.artist_name || '').trim();
  if (!audio || !title || !artist) return null;
  const genres = track?.musicinfo?.tags?.genres || track?.musicinfo?.tags?.instruments || [];
  const license = String(track?.license_ccurl || track?.license || '').trim();
  return {
    id: String(track.id || ''),
    title,
    artist,
    album: String(track.album_name || '').trim(),
    description: String(track.album_name || '').trim(),
    genre: Array.isArray(genres) ? genres.join(', ') : String(genres || ''),
    duration: Number.isFinite(Number(track.duration)) ? Number(track.duration) : null,
    url: audio,
    thumbnail: String(track.image || track.album_image || '').trim(),
    sourceUrl: String(track.shareurl || `https://www.jamendo.com/track/${track.id || ''}`).trim(),
    license,
    licenseVersion: license,
    source: 'jamendo',
    sourceId: String(track.id || '')
  };
}

function parseChannelReference(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const idFromUrl = raw.match(/youtube\.com\/channel\/(UC[\w-]{20,})/i)?.[1];
  if (idFromUrl || /^UC[\w-]{20,}$/i.test(raw)) return { id: idFromUrl || raw };
  const handleFromUrl = raw.match(/youtube\.com\/@([^/?#]+)/i)?.[1];
  const plainHandle = raw.match(/^@?([\w.-]{3,})$/)?.[1];
  const handle = handleFromUrl || plainHandle;
  return handle ? { handle: `@${decodeURIComponent(handle)}` } : null;
}

async function youtubeRequest(path, params) {
  const response = await fetch(`${YOUTUBE_API}/${path}?${params.toString()}`);
  const data = await response.json();
  return { response, data };
}

async function enrichVideoItems(items, apiKey) {
  const videoIds = (items || [])
    .map(item => item?.contentDetails?.videoId || (item?.id?.kind === 'youtube#video' ? item.id.videoId : null))
    .filter(Boolean);
  if (!videoIds.length) return items || [];

  const detailsParams = new URLSearchParams({
    part: 'contentDetails,status,statistics,snippet',
    id: videoIds.join(','),
    key: apiKey,
    fields: 'items(id,contentDetails(duration,definition,caption),status(embeddable),statistics(viewCount,likeCount,commentCount),snippet(publishedAt,liveBroadcastContent,categoryId,tags))'
  });
  const { response, data } = await youtubeRequest('videos', detailsParams);
  if (!response.ok) return items || [];

  const byId = new Map((data.items || []).map(item => [item.id, item]));
  return (items || []).filter(item => {
    const videoId = item?.contentDetails?.videoId || (item?.id?.kind === 'youtube#video' ? item.id.videoId : null);
    if (!videoId) return true;
    const detail = byId.get(videoId);
    if (detail?.status?.embeddable === false) return false;
    item.contentDetails = { ...item.contentDetails, ...detail?.contentDetails };
    item.statistics = detail?.statistics || {};
    item.videoSnippet = detail?.snippet || {};
    return true;
  });
}

async function enrichPlaylistItems(items, apiKey) {
  const playlistIds = [...new Set((items || [])
    .map(item => item?.id?.kind === 'youtube#playlist' ? item.id.playlistId : null)
    .filter(Boolean))];
  if (!playlistIds.length) return items || [];
  const detailsParams = new URLSearchParams({
    part: 'snippet,contentDetails',
    id: playlistIds.join(','),
    key: apiKey,
    fields: 'items(id,contentDetails(itemCount),snippet(thumbnails))'
  });
  const { response, data } = await youtubeRequest('playlists', detailsParams);
  if (!response.ok) return items || [];
  const byId = new Map((data.items || []).map(item => [item.id, item]));
  return (items || []).map(item => {
    const playlistId = item?.id?.playlistId;
    const detail = playlistId ? byId.get(playlistId) : null;
    if (!detail) return item;
    item.contentDetails = { ...item.contentDetails, ...detail.contentDetails };
    if (detail.snippet?.thumbnails) item.snippet = { ...item.snippet, thumbnails: detail.snippet.thumbnails };
    return item;
  });
}

async function fetchPlaylistItems({ playlistId, pageToken, maxResults, apiKey }) {
  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    playlistId,
    maxResults: String(maxResults),
    key: apiKey,
    fields: 'nextPageToken,prevPageToken,pageInfo(totalResults,resultsPerPage),items(contentDetails(videoId,videoPublishedAt),snippet(title,description,channelId,channelTitle,position,thumbnails,publishedAt))'
  });
  if (pageToken) params.set('pageToken', pageToken);
  const { response, data } = await youtubeRequest('playlistItems', params);
  if (!response.ok) return { response, data };
  data.items = await enrichVideoItems(data.items, apiKey);
  return { response, data };
}

async function fetchChannelPlaylists({ channelId, pageToken, maxResults, apiKey }) {
  const params = new URLSearchParams({
    part: 'snippet,contentDetails,status',
    channelId,
    maxResults: String(maxResults),
    key: apiKey,
    fields: 'nextPageToken,prevPageToken,pageInfo(totalResults,resultsPerPage),items(id,snippet(title,description,channelId,channelTitle,publishedAt,thumbnails),contentDetails(itemCount),status(privacyStatus))'
  });
  if (pageToken) params.set('pageToken', pageToken);
  return youtubeRequest('playlists', params);
}

export default async function handler(req, res) {
  const { query, type } = req.query;
  const action = String(req.query.action || '');
  const libraryActions = new Set(['playlistItems', 'channelOverview', 'channelPlaylists', 'channelUploads']);

  if (type === 'youtube' && (!query || typeof query !== 'string') && !libraryActions.has(action)) {
    return res.status(400).json({ error: { message: 'Falta el término de búsqueda' } });
  }

  try {
    if (type === 'youtube') {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) return res.status(500).json({ error: { message: 'Falta la clave YOUTUBE_API_KEY en Vercel' } });

      if (action === 'playlistItems') {
        const playlistId = String(req.query.playlistId || '').trim();
        if (!playlistId) return res.status(400).json({ error: { message: 'Falta playlistId' } });
        const { response, data } = await fetchPlaylistItems({
          playlistId,
          pageToken: String(req.query.pageToken || '').trim(),
          maxResults: boundedMax(req.query.maxResults, 24),
          apiKey
        });
        if (!response.ok) return respondYouTubeError(res, response, data);
        compactCache(res);
        return res.status(200).json(data);
      }

      if (action === 'channelOverview') {
        const reference = parseChannelReference(req.query.channelId || req.query.channelRef);
        if (!reference) return res.status(400).json({ error: { message: 'Falta un ID, handle o enlace público de canal' } });
        const channelsParams = new URLSearchParams({
          part: 'snippet,statistics,contentDetails',
          key: apiKey,
          fields: 'items(id,snippet(title,description,customUrl,publishedAt,thumbnails),statistics(subscriberCount,videoCount,viewCount),contentDetails(relatedPlaylists(uploads)))'
        });
        if (reference.id) channelsParams.set('id', reference.id);
        else channelsParams.set('forHandle', reference.handle);
        const { response: channelResponse, data: channelData } = await youtubeRequest('channels', channelsParams);
        if (!channelResponse.ok) return respondYouTubeError(res, channelResponse, channelData);
        const channel = channelData.items?.[0];
        if (!channel) return res.status(404).json({ error: { message: 'Canal no encontrado o handle no disponible' } });
        const channelId = channel.id;

        const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
        const [playlistsResult, uploadsResult] = await Promise.all([
          fetchChannelPlaylists({ channelId, pageToken: String(req.query.playlistsPageToken || '').trim(), maxResults: boundedMax(req.query.maxResults, 24), apiKey }),
          uploadsPlaylistId
            ? fetchPlaylistItems({ playlistId: uploadsPlaylistId, pageToken: String(req.query.uploadsPageToken || '').trim(), maxResults: boundedMax(req.query.maxResults, 24), apiKey })
            : Promise.resolve({ response: { ok: true }, data: { items: [] } })
        ]);
        if (!playlistsResult.response.ok) return respondYouTubeError(res, playlistsResult.response, playlistsResult.data);
        if (!uploadsResult.response.ok) return respondYouTubeError(res, uploadsResult.response, uploadsResult.data);
        compactCache(res);
        return res.status(200).json({ channel, playlists: playlistsResult.data, uploads: uploadsResult.data });
      }

      if (action === 'channelPlaylists') {
        const channelId = String(req.query.channelId || '').trim();
        if (!channelId) return res.status(400).json({ error: { message: 'Falta channelId' } });
        const { response, data } = await fetchChannelPlaylists({
          channelId,
          pageToken: String(req.query.pageToken || '').trim(),
          maxResults: boundedMax(req.query.maxResults, 24),
          apiKey
        });
        if (!response.ok) return respondYouTubeError(res, response, data);
        compactCache(res);
        return res.status(200).json(data);
      }

      if (action === 'channelUploads') {
        const uploadsPlaylistId = String(req.query.uploadsPlaylistId || '').trim();
        if (!uploadsPlaylistId) return res.status(400).json({ error: { message: 'Falta uploadsPlaylistId' } });
        const { response, data } = await fetchPlaylistItems({
          playlistId: uploadsPlaylistId,
          pageToken: String(req.query.pageToken || '').trim(),
          maxResults: boundedMax(req.query.maxResults, 24),
          apiKey
        });
        if (!response.ok) return respondYouTubeError(res, response, data);
        compactCache(res);
        return res.status(200).json(data);
      }

      const requestedTypes = String(req.query.resourceTypes || 'video')
        .split(',')
        .map(value => value.trim())
        .filter(value => ['video', 'playlist', 'channel'].includes(value));
      const resourceTypes = requestedTypes.length ? requestedTypes.join(',') : 'video';
      const maxResults = boundedMax(req.query.maxResults, 20);

      const params = new URLSearchParams({
        part: 'snippet',
        type: resourceTypes,
        maxResults: String(maxResults),
        q: query.trim(),
        key: apiKey,
        fields: 'nextPageToken,prevPageToken,pageInfo(totalResults,resultsPerPage),items(id(kind,videoId,playlistId,channelId),snippet(title,description,publishedAt,channelId,channelTitle,thumbnails))'
      });
      if (req.query.channelId && typeof req.query.channelId === 'string') params.set('channelId', req.query.channelId);
      if (req.query.pageToken && typeof req.query.pageToken === 'string') params.set('pageToken', req.query.pageToken);
      if (resourceTypes === 'video') {
        params.set('videoEmbeddable', 'true');
        params.set('videoSyndicated', 'true');
      }

      const { response, data } = await youtubeRequest('search', params);
      if (!response.ok) return respondYouTubeError(res, response, data);
      data.items = await enrichVideoItems(data.items, apiKey);
      data.items = await enrichPlaylistItems(data.items, apiKey);
      compactCache(res);
      return res.status(200).json(data);
    }

    if (type === 'commonsVideo') {
      if (!query || typeof query !== 'string') return res.status(400).json({ error: { source: 'commons', message: 'Falta el término de búsqueda' } });
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        origin: '*',
        generator: 'search',
        gsrnamespace: '6',
        gsrsearch: `${query.trim().slice(0, 120)} filetype:video`,
        gsrlimit: String(Math.min(boundedMax(req.query.maxResults, 12) * 3, 50)),
        gsrwhat: 'text',
        prop: 'imageinfo|info',
        inprop: 'url',
        iiprop: 'url|mime|size|extmetadata',
        iiurlwidth: '560',
        iilimit: '1'
      });
      const commonsResponse = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
        headers: { 'User-Agent': 'Nowarfy-YouToo/1.0 (public media discovery)' }
      });
      const commonsData = await commonsResponse.json();
      if (!commonsResponse.ok) return res.status(commonsResponse.status || 502).json({ error: { source: 'commons', message: 'No se pudo consultar Wikimedia Commons' } });
      const results = Object.values(commonsData?.query?.pages || {})
        .map(mapCommonsVideoPage)
        .filter(Boolean)
        .slice(0, boundedMax(req.query.maxResults, 12));
      compactCache(res);
      return res.status(200).json({ results });
    }

    if (type === 'jamendo') {
      const clientId = String(process.env.JAMENDO_CLIENT_ID || '').trim();
      if (!clientId) {
        return res.status(503).json({ error: { source: 'jamendo', code: 'missing_client_id', message: 'Jamendo está preparado pero requiere JAMENDO_CLIENT_ID en Vercel' } });
      }
      if (!query || typeof query !== 'string') return res.status(400).json({ error: { source: 'jamendo', message: 'Falta el término de búsqueda' } });
      const limit = Math.min(boundedMax(req.query.maxResults, 20), 50);
      const style = String(req.query.style || query || '').trim();
      const params = new URLSearchParams({
        client_id: clientId,
        format: 'json',
        limit: String(limit),
        search: query.trim().slice(0, 120),
        fuzzytags: style.slice(0, 80),
        audioformat: 'mp32',
        imagesize: '300',
        include: 'licenses,musicinfo',
        type: 'single albumtrack'
      });
      const jamendoResp = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`, {
        headers: { 'User-Agent': 'Nowarfy-YouToo/1.0 (music discovery)' }
      });
      const jamendoData = await jamendoResp.json();
      if (!jamendoResp.ok) return res.status(jamendoResp.status || 502).json({ error: { source: 'jamendo', message: jamendoData?.headers?.error_message || 'No se pudo consultar Jamendo' } });
      const results = (jamendoData.results || []).map(mapJamendoTrack).filter(Boolean);
      compactCache(res);
      return res.status(200).json({ results, headers: jamendoData.headers || {} });
    }

    if (type === 'openverse') {
      const clientId = process.env.OPENVERSE_CLIENT_ID;
      const clientSecret = process.env.OPENVERSE_CLIENT_SECRET;
      if (!query || typeof query !== 'string') return res.status(400).json({ error: { source: 'openverse', message: 'Falta el término de búsqueda' } });

      const pageSize = Math.min(boundedMax(req.query.maxResults, 20), 20);
      const page = Math.max(1, Number(req.query.page || 1));
      const searchUrl = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}&page_size=${pageSize}&page=${page}`;
      const headers = {};
      // Openverse permite consultas públicas sin token. Si Vercel tiene credenciales,
      // las usamos para aumentar el margen de cuota sin hacerlas obligatorias.
      if (clientId && clientSecret) {
        const tokenResp = await fetch('https://api.openverse.org/v1/auth_tokens/token/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' })
        });
        const tokenData = await tokenResp.json();
        if (tokenResp.ok && tokenData.access_token) headers.Authorization = `Bearer ${tokenData.access_token}`;
      }
      const searchResp = await fetch(searchUrl, { headers });
      const searchData = await searchResp.json();
      if (!searchResp.ok) {
        return res.status(searchResp.status || 502).json({ error: { source: 'openverse', message: searchData?.detail || 'No se pudo consultar Openverse' } });
      }
      compactCache(res);
      return res.status(200).json(searchData);
    }

    return res.status(400).json({ error: 'Tipo de búsqueda inválido' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
