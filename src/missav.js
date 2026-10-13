'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

const listCache = new NodeCache({ stdTTL: 600 });
const detailCache = new NodeCache({ stdTTL: 300 });
const streamCache = new NodeCache({ stdTTL: 1800 });

const BASE = 'https://missav.ws';
const LANG = 'en';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: BASE + '/',
};

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function fetchHtml(url) {
  try {
    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
      maxRedirects: 5,
    });
    return res.data;
  } catch (e) {
    console.error('[MissAV] fetch error:', url, e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function absUrl(href) {
  if (!href) return '';
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return BASE + href;
  return href;
}

function slugFromHref(href) {
  if (!href) return '';
  const clean = href.split('?')[0].replace(/\/+$/, '');
  return clean.split('/').pop() || '';
}

// ---------------------------------------------------------------------------
// Eval unpacker (port từ Python _unbase + get_and_unpack)
// ---------------------------------------------------------------------------

const UNBASE_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

function unbase(num, base) {
  let result = 0;
  const s = String(num);
  for (let i = 0; i < s.length; i++) {
    const idx = UNBASE_CHARS.indexOf(s[i]);
    if (idx < 0) return 0;
    result = result * base + idx;
  }
  return result;
}

function unpackEval(html) {
  const m = html.match(
    /eval\(function\(p,a,c,k,e,[d_]\)\{[\s\S]*?\}\s*\('([\s\S]*?)',(\d+),\d+,'([\s\S]*?)'\.split\('\|'\)/
  );
  if (!m) return '';

  const pVal = m[1];
  const aVal = parseInt(m[2], 10);
  const kVal = m[3].split('|');

  return pVal.replace(/\b\w+\b/g, (word) => {
    const idx = unbase(word, aVal);
    return idx < kVal.length && kVal[idx] ? kVal[idx] : word;
  });
}

// ---------------------------------------------------------------------------
// List parsing
// ---------------------------------------------------------------------------

function parseList(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  // Thumbnail cards trên MissAV dùng class chứa "thumbnail" hoặc "group"
  $('div.thumbnail, div.group').each((_, el) => {
    const $el = $(el);
    const a = $el.find('a[href]').first();
    let href = a.attr('href') || '';
    if (!href) return;
    href = absUrl(href);
    if (!href.startsWith('http')) return;
    if (seen.has(href)) return;

    // Bỏ qua link điều hướng
    if (/\/(genres|actresses|makers|series|directors|labels|search|dm\d+)\//.test(href)) return;

    const slug = slugFromHref(href);
    if (!slug || slug.length < 4) return;

    let title =
      a.attr('title') ||
      $el.find('div.my-2 a').first().text().trim() ||
      $el.find('img').first().attr('alt') ||
      slug.replace(/-/g, ' ').toUpperCase();

    // Tag prefix
    if (/-uncensored-leak/.test(href)) title = '[Uncensored Leak] ' + title;
    if (/-english-subtitle/.test(href)) title = '[Eng Sub] ' + title;

    const img = $el.find('img').first();
    let thumb =
      img.attr('data-src') ||
      img.attr('data-lazy-src') ||
      img.attr('src') ||
      '';
    if (thumb && thumb.endsWith('.svg')) thumb = '';
    thumb = absUrl(thumb);

    seen.add(href);
    items.push({ slug, title, thumb, href });
  });

  return items;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

async function getNewest(page = 1) {
  const key = `newest_${page}`;
  const c = listCache.get(key);
  if (c) return c;
  const html = await fetchHtml(`${BASE}/${LANG}?page=${page}`);
  const r = parseList(html);
  if (r.length) listCache.set(key, r);
  return r;
}

async function search(keyword, page = 1) {
  const key = `search_${keyword}_${page}`;
  const c = listCache.get(key);
  if (c) return c;
  const html = await fetchHtml(
    `${BASE}/${LANG}/search?q=${encodeURIComponent(keyword)}&page=${page}`
  );
  const r = parseList(html);
  if (r.length) listCache.set(key, r);
  return r;
}

async function getByGenre(slug, page = 1) {
  const key = `genre_${slug}_${page}`;
  const c = listCache.get(key);
  if (c) return c;
  const html = await fetchHtml(`${BASE}/${LANG}/genres/${slug}?page=${page}`);
  const r = parseList(html);
  if (r.length) listCache.set(key, r);
  return r;
}

async function getByPath(path, page = 1) {
  const key = `path_${path}_${page}`;
  const c = listCache.get(key);
  if (c) return c;
  const html = await fetchHtml(`${BASE}${path}?page=${page}`);
  const r = parseList(html);
  if (r.length) listCache.set(key, r);
  return r;
}

// ---------------------------------------------------------------------------
// Detail (không còn cố regex m3u8)
// ---------------------------------------------------------------------------

async function getDetail(slug) {
  const c = detailCache.get(slug);
  if (c) return c;

  const url = slug.startsWith('http') ? slug : `${BASE}/${LANG}/${slug}`;
  const html = await fetchHtml(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    slug;

  const thumb =
    $('meta[property="og:image"]').attr('content') ||
    $('video').attr('poster') ||
    '';

  const desc =
    $('meta[property="og:description"]').attr('content') ||
    $('div.description').text().trim() ||
    '';

  const genres = [];
  $('a[href*="/genres/"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t && !genres.includes(t)) genres.push(t);
  });

  const data = {
    slug: slugFromHref(url),
    url,
    title: title.replace(' - MissAV', '').replace(' | MissAV', ''),
    thumb,
    desc,
    genres,
  };
  detailCache.set(slug, data);
  return data;
}

// ---------------------------------------------------------------------------
// Stream resolution (thuần JS, dùng unpacker)
// ---------------------------------------------------------------------------

async function pickBestHls(masterUrl) {
  try {
    const res = await axios.get(masterUrl, {
      headers: { ...HEADERS, Referer: BASE + '/' },
      timeout: 10000,
    });
    const lines = String(res.data).split('\n');
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
        const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        for (let j = i + 1; j < lines.length; j++) {
          const uri = lines[j].trim();
          if (uri && !uri.startsWith('#')) {
            const abs = uri.startsWith('http')
              ? uri
              : masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1) + uri;
            variants.push([bw, abs]);
            break;
          }
        }
      }
    }
    if (variants.length) {
      variants.sort((a, b) => b[0] - a[0]);
      return variants[0][1];
    }
  } catch (e) {
    console.error('[MissAV] pickBestHls error:', e.message);
  }
  return null;
}

async function resolveStream(slugOrUrl) {
  const key = `stream_${slugOrUrl}`;
  const c = streamCache.get(key);
  if (c) return c;

  const url = slugOrUrl.startsWith('http')
    ? slugOrUrl
    : `${BASE}/${LANG}/${slugOrUrl}`;

  const html = await fetchHtml(url);
  if (!html) return null;

  // Cách 1: unpacker
  let playlistUrl = '';
  const unpacked = unpackEval(html);
  if (unpacked) {
    const m = unpacked.match(/https:\/\/surrit\.com\/([a-f0-9-]{36})\//);
    if (m) playlistUrl = `https://surrit.com/${m[1]}/playlist.m3u8`;
    else {
      const uuidM = unpacked.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
      if (uuidM) playlistUrl = `https://surrit.com/${uuidM[1]}/playlist.m3u8`;
    }
  }

  // Cách 2: tìm trực tiếp trong HTML
  if (!playlistUrl) {
    const m = html.match(
      /https:\/\/surrit\.com\/[a-f0-9-]{36}\/playlist\.m3u8/
    );
    if (m) playlistUrl = m[0];
  }

  if (!playlistUrl) {
    console.error('[MissAV] no playlist URL for', url);
    return null;
  }

  const best = (await pickBestHls(playlistUrl)) || playlistUrl;
  const result = { master: playlistUrl, best, referer: BASE + '/' };
  streamCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

function toMeta(item) {
  return {
    id: `missav:${item.slug}`,
    type: 'movie',
    name: item.title || item.slug,
    poster: item.thumb || '',
    background: item.thumb || '',
    description: item.desc || '',
    genres: item.genres || [],
    language: 'ja',
  };
}

module.exports = {
  BASE,
  LANG,
  getNewest,
  search,
  getByGenre,
  getByPath,
  getDetail,
  resolveStream,
  toMeta,
  slugFromHref,
};
