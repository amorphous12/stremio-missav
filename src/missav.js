'use strict';
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

const listCache = new NodeCache({ stdTTL: 600 });
const detailCache = new NodeCache({ stdTTL: 300 });

const BASE = 'https://missav.ws';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://missav.ws/',
};

async function fetchHtml(url) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    return res.data;
  } catch (e) {
    console.error('[MissAV] fetch error:', url, e.message);
    return null;
  }
}

// Parse danh sách video từ trang list
function parseList(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const items = [];
  $('div.thumbnail, div.videos div.video, article.video-item, div.grid div[data-id]').each((i, el) => {
    const $el = $(el);
    const a = $el.find('a').first();
    const href = a.attr('href') || '';
    const slug = href.replace(/^.*\/([^\/]+)\/?$/, '$1');
    const title = $el.find('a[title], span.title, p.title, .video-title').first().attr('title')
      || $el.find('a[title], span.title, p.title').first().text().trim()
      || slug;
    const thumb = $el.find('img').first().attr('data-src')
      || $el.find('img').first().attr('src') || '';
    if (slug && slug !== href) {
      items.push({ slug, title, thumb, href });
    }
  });

  // Fallback: tìm tất cả link /en/ hoặc /ja/
  if (!items.length) {
    $('a[href*="/en/"], a[href*="/ja/"]').each((i, el) => {
      const href = $(el).attr('href') || '';
      const slug = href.replace(/^.*\/([^\/]+)\/?$/, '$1');
      const title = $(el).attr('title') || $(el).text().trim() || slug;
      const thumb = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
      if (slug && !items.find(x => x.slug === slug)) {
        items.push({ slug, title, thumb, href });
      }
    });
  }
  return items;
}

// Lấy danh sách mới nhất
async function getNewest(page = 1) {
  const key = `newest_${page}`;
  const c = listCache.get(key); if (c) return c;
  const html = await fetchHtml(`${BASE}/en?page=${page}`);
  const r = parseList(html);
  listCache.set(key, r); return r;
}

// Tìm kiếm
async function search(keyword, page = 1) {
  const key = `search_${keyword}_${page}`;
  const c = listCache.get(key); if (c) return c;
  const html = await fetchHtml(`${BASE}/en/search?q=${encodeURIComponent(keyword)}&page=${page}`);
  const r = parseList(html);
  listCache.set(key, r); return r;
}

// Theo thể loại
async function getByGenre(slug, page = 1) {
  const key = `genre_${slug}_${page}`;
  const c = listCache.get(key); if (c) return c;
  const html = await fetchHtml(`${BASE}/en/genres/${slug}?page=${page}`);
  const r = parseList(html);
  listCache.set(key, r); return r;
}

// Theo actress
async function getByActress(slug, page = 1) {
  const key = `actress_${slug}_${page}`;
  const c = listCache.get(key); if (c) return c;
  const html = await fetchHtml(`${BASE}/en/actresses/${slug}?page=${page}`);
  const r = parseList(html);
  listCache.set(key, r); return r;
}

// Chi tiết + lấy m3u8
async function getDetail(slug) {
  const c = detailCache.get(slug); if (c) return c;
  const url = `${BASE}/en/${slug}`;
  const html = await fetchHtml(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  const title = $('h1.text-base, h1, title').first().text().trim().replace(' - MissAV', '').replace(' | MissAV', '');
  const thumb = $('meta[property="og:image"]').attr('content')
    || $('video').attr('poster') || '';
  const desc = $('meta[property="og:description"]').attr('content')
    || $('div.description, p.description').text().trim() || '';

  // Lấy m3u8 từ source trong HTML (thường bị obfuscate)
  let m3u8 = '';

  // Cách 1: tìm trực tiếp trong script
  const scriptContent = $('script').map((i, el) => $(el).html()).get().join('\n');
  const m3u8Match = scriptContent.match(/source\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i)
    || scriptContent.match(/file\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i)
    || scriptContent.match(/['"]([^'"]+\.m3u8[^'"]*)['"]/i);
  if (m3u8Match) m3u8 = m3u8Match[1];

  // Cách 2: tìm trong source tag
  if (!m3u8) {
    const srcMatch = html.match(/src\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
    if (srcMatch) m3u8 = srcMatch[1];
  }

  // Cách 3: tìm embed URL
  let embedUrl = '';
  const embedMatch = html.match(/iframe[^>]+src\s*=\s*['"]([^'"]+)['"]/i);
  if (embedMatch) embedUrl = embedMatch[1];

  // Tags/genres
  const genres = [];
  $('a[href*="/genres/"]').each((i, el) => { genres.push($(el).text().trim()); });

  const data = { slug, title, thumb, desc, m3u8, embedUrl, genres, url };
  detailCache.set(slug, data);
  return data;
}

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

module.exports = { getNewest, search, getByGenre, getByActress, getDetail, toMeta };