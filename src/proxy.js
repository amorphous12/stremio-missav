'use strict';

const { createSession } = require('wreq-js');

const REFERER = 'https://missav.ws/';

let _sessionPromise = null;

async function getSession() {
  if (_sessionPromise) return _sessionPromise;
  _sessionPromise = createSession({
    browser: 'chrome_142',
    os: 'windows',
  }).catch((e) => {
    console.error('[proxy] session create failed:', e.message);
    _sessionPromise = null;
    throw e;
  });
  return _sessionPromise;
}

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
    const session = await getSession();
    const upstream = await session.fetch(target, {
      headers: {
        Referer: REFERER,
        Origin: REFERER.replace(/\/$/, ''),
        Accept: '*/*',
      },
      timeout: 20000,
    });

    const ct = upstream.headers.get('content-type') || '';
    const buf = Buffer.from(await upstream.arrayBuffer());
    const head = buf.slice(0, 7).toString();
    const isM3u8 = ct.includes('mpegurl') || head === '#EXTM3U';

    if (isM3u8) {
      let text = buf.toString('utf8');
      const baseUrl = target.substring(0, target.lastIndexOf('/') + 1);
      const publicBase =
        process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

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
