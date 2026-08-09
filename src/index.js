'use strict';
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const missav = require('./missav');

const GENRE_SLUG = {
  'Uncensored':'uncensored','Censored':'censored','Creampie':'creampie',
  'Big Tits':'big-tits','Blowjob':'blowjob','Amateur':'amateur',
  'Lesbian':'lesbian','Solo':'solo','Cosplay':'cosplay',
  'Squirting':'squirting','Anal':'anal','Threesome':'threesome',
  'Outdoor':'outdoor','MILF':'milf','Schoolgirl':'schoolgirl',
};
const GENRES = Object.keys(GENRE_SLUG);
const EXTRA_BASE = [{ name: 'skip' }, { name: 'search' }];
const EXTRA_FULL = [
  { name: 'skip' }, { name: 'search' },
  { name: 'genre', options: GENRES },
];

const manifest = {
  id: 'community.missav.ws',
  version: '1.0.0',
  name: 'MissAV',
  description: 'Xem phim JAV từ MissAV — Uncensored, Censored, và nhiều thể loại',
  logo: 'https://missav.ws/favicon.ico',
  catalogs: [
    { id: 'missav-newest',      type: 'movie', name: '🆕 Mới Nhất',       extra: EXTRA_FULL },
    { id: 'missav-uncensored',  type: 'movie', name: '🔞 Uncensored',      extra: EXTRA_BASE },
    { id: 'missav-censored',    type: 'movie', name: '🎬 Censored',         extra: EXTRA_BASE },
    { id: 'missav-english-sub', type: 'movie', name: '🇬🇧 English Sub',     extra: EXTRA_BASE },
    { id: 'missav-chinese-sub', type: 'movie', name: '🇨🇳 Chinese Sub',     extra: EXTRA_BASE },
  ],
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  idPrefixes: ['missav:'],
};

const CATALOG_PATH = {
  'missav-newest':      '/en',
  'missav-uncensored':  '/en/genres/uncensored',
  'missav-censored':    '/en/genres/censored',
  'missav-english-sub': '/en/subtitles/english',
  'missav-chinese-sub': '/en/subtitles/chinese',
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const page = Math.floor((parseInt(extra.skip) || 0) / 24) + 1;
  let items = [];
  try {
    if (extra.search) {
      items = await missav.search(extra.search, page);
    } else if (extra.genre && GENRE_SLUG[extra.genre]) {
      items = await missav.getByGenre(GENRE_SLUG[extra.genre], page);
    } else {
      items = await missav.getNewest(page);
    }
    return { metas: items.map(missav.toMeta) };
  } catch(e) {
    console.error('[catalog] error:', e.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (!id.startsWith('missav:')) return { meta: null };
  try {
    const slug = id.replace('missav:', '');
    const data = await missav.getDetail(slug);
    if (!data) return { meta: null };
    return { meta: missav.toMeta(data) };
  } catch(e) { return { meta: null }; }
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (!id.startsWith('missav:')) return { streams: [] };
  try {
    const slug = id.replace('missav:', '');
    const data = await missav.getDetail(slug);
    if (!data) return { streams: [] };
    const streams = [];

    if (data.m3u8) {
      streams.push({
        url: data.m3u8,
        title: '▶ MissAV HLS',
        behaviorHints: { notWebReady: false },
      });
    }
    if (data.embedUrl) {
      streams.push({
        url: data.embedUrl,
        title: '🌐 MissAV Embed',
        behaviorHints: { notWebReady: true },
      });
    }
    // Fallback: link trang gốc
    if (!streams.length) {
      streams.push({
        externalUrl: `https://missav.ws/en/${slug}`,
        title: '🔗 Mở MissAV',
      });
    }
    return { streams };
  } catch(e) { return { streams: [] }; }
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`MissAV Addon: http://localhost:${PORT}/manifest.json`);