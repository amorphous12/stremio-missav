'use strict';

const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const missav = require('./missav');
const { proxyHandler } = require('./proxy');

const PORT = process.env.PORT || 7000;
const PUBLIC_URL =
  process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;

const GENRE_SLUG = {
  Uncensored: 'uncensored',
  Censored: 'censored',
  Creampie: 'creampie',
  'Big Tits': 'big-tits',
  Blowjob: 'blowjob',
  Amateur: 'amateur',
  Lesbian: 'lesbian',
  Solo: 'solo',
  Cosplay: 'cosplay',
  Squirting: 'squirting',
  Anal: 'anal',
  Threesome: 'threesome',
  Outdoor: 'outdoor',
  MILF: 'milf',
  Schoolgirl: 'schoolgirl',
};
const GENRES = Object.keys(GENRE_SLUG);
const EXTRA_BASE = [{ name: 'skip' }, { name: 'search' }];
const EXTRA_FULL = [
  { name: 'skip' },
  { name: 'search' },
  { name: 'genre', options: GENRES },
];

const manifest = {
  id: 'community.missav.ws',
  version: '1.0.0',
  name: 'MissAV',
  description: 'Xem phim JAV từ MissAV',
  logo: 'https://missav.ws/favicon.ico',
  catalogs: [
    { id: 'missav-newest', type: 'movie', name: '🆕 Mới Nhất', extra: EXTRA_FULL },
    { id: 'missav-uncensored', type: 'movie', name: '🔞 Uncensored', extra: EXTRA_BASE },
    { id: 'missav-censored', type: 'movie', name: '🎬 Censored', extra: EXTRA_BASE },
    { id: 'missav-english-sub', type: 'movie', name: '🇬🇧 English Sub', extra: EXTRA_BASE },
    { id: 'missav-chinese-sub', type: 'movie', name: '🇨🇳 Chinese Sub', extra: EXTRA_BASE },
  ],
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  idPrefixes: ['missav:'],
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const page = Math.floor((parseInt(extra.skip) || 0) / 24) + 1;
  try {
    let items = [];

    if (extra.search) {
      items = await missav.search(extra.search, page);
    } else if (extra.genre && GENRE_SLUG[extra.genre]) {
      items = await missav.getByGenre(GENRE_SLUG[extra.genre], page);
    } else if (id === 'missav-uncensored') {
      items = await missav.getByGenre('uncensored', page);
    } else if (id === 'missav-censored') {
      items = await missav.getByGenre('censored', page);
    } else if (id === 'missav-english-sub') {
      items = await missav.getByPath('/en/subtitles/english', page);
    } else if (id === 'missav-chinese-sub') {
      items = await missav.getByPath('/en/subtitles/chinese', page);
    } else {
      items = await missav.getNewest(page);
    }

    return { metas: items.map(missav.toMeta) };
  } catch (e) {
    console.error('[catalog]', e.message);
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
  } catch (e) {
    console.error('[meta]', e.message);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (!id.startsWith('missav:')) return { streams: [] };
  try {
    const slug = id.replace('missav:', '');
    console.log('[stream] resolving', slug);

    const data = await missav.resolveStream(slug);
    if (!data || !data.best) {
      console.log('[stream] no stream for', slug);
      return { streams: [] };
    }

    const proxied = `${PUBLIC_URL}/proxy?url=${encodeURIComponent(data.best)}`;
    console.log('[stream] ->', proxied);

    return {
      streams: [
        {
          title: '▶ MissAV HLS',
          url: proxied,
          behaviorHints: {
            notWebReady: true,
            proxyHeaders: {
              request: {
                Referer: 'https://missav.ws/',
                Origin: 'https://missav.ws',
              },
            },
          },
        },
      ],
    };
  } catch (e) {
    console.error('[stream]', e.message);
    return { streams: [] };
  }
});

const app = express();

app.get('/health', (req, res) => res.send('ok'));
app.get('/proxy', proxyHandler);

app.use('/', getRouter(builder.getInterface()));

app.listen(PORT, '0.0.0.0', () => {
  console.log('---------------------------------------------');
  console.log(`MissAV addon listening on port ${PORT}`);
  console.log(`Manifest: ${PUBLIC_URL}/manifest.json`);
  console.log('---------------------------------------------');
});
