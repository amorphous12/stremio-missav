'use strict';

const axios = require('axios');

const REFERER = 'https://missav.ws/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function proxyHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const target = req.query.url;
  if (!target) {
    res.status(400).send('missing url');
    return;
  }

  try {
    const upstream = await axios.get(target, {
      headers: {
        Referer: REFERER,
        Origin: REFERER.replace(/\/$/, ''),
        'User-Agent': UA,
        Accept: '*/*',
      },
      responseType: 'arraybuffer',
      timeout: 20000,
      validateStatus: () => true,
      maxRedirects: 5,
    });

    const ct = upstream.headers['content-type'] || '';
    const buf = Buffer.from(upstream.data);
    const head = buf.slice(0, 7).toString();
    const isM3u8 = ct.includes('mpegurl') || head === '#EXTM3U';

    if (isM3u8) {
      let text = buf.toString('utf8');
      const baseUrl = target.substring(0, target.lastIndexOf('/') + 1);

      // Public base (Render URL)
      const publicBase =
        process.env.PUBLIC_URL ||
        `${req.protocol}://${req.get('host')}`;

      text = text
        .split('\n')
        .map((line) => {
          const t = line.trim();
          if (!t || t.startsWith('#')) return line;
          let abs = t;
          if (!t.startsWith('http')) {
            if (t.startsWith('/')) {
              const u = new URL(target);
              abs = `${u.protocol}//${u.host}${t}`;
            } else {
              abs = baseUrl + t;
            }
          }
          return `${publicBase}/proxy?url=${encodeURIComponent(abs)}`;
        })
        .join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(text);
    } else {
      res.setHeader('Content-Type', ct || 'application/octet-stream');
      res.status(upstream.status).send(buf);
    }
  } catch (e) {
    console.error('[proxy]', e.message);
    res.status(502).send('upstream error: ' + e.message);
  }
}

module.exports = { proxyHandler };
