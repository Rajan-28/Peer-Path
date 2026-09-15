/**
 * PeerPath – Pure Node.js Signaling + Static Server
 * Zero external dependencies. WebSocket matchmaking + SDP/ICE relay.
 *
 * Run:  node server.js
 * Then open http://localhost:3000 in two browsers / tabs.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// ---------- Minimal WebSocket implementation ----------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function parseFrames(buffer, onMessage) {
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b1 = buffer[offset];
    const b2 = buffer[offset + 1];
    const opcode = b1 & 0x0f;
    const masked = (b2 & 0x80) !== 0;
    let len = b2 & 0x7f;
    let headerLen = 2;
    if (len === 126) {
      if (offset + 4 > buffer.length) return buffer.slice(offset);
      len = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (len === 127) {
      if (offset + 10 > buffer.length) return buffer.slice(offset);
      len = Number(buffer.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }
    const maskLen = masked ? 4 : 0;
    const total = headerLen + maskLen + len;
    if (offset + total > buffer.length) return buffer.slice(offset);

    let payload = Buffer.from(buffer.slice(offset + headerLen + maskLen, offset + total));
    if (masked) {
      const mask = buffer.slice(offset + headerLen, offset + headerLen + 4);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }

    if (opcode === 0x1) {
      onMessage(payload.toString('utf8'));
    } else if (opcode === 0x8) {
      onMessage(null, 'close');
    } else if (opcode === 0x9) {
      onMessage(null, 'ping', payload);
    }
    offset += total;
  }
  return offset < buffer.length ? buffer.slice(offset) : Buffer.alloc(0);
}

function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function encodePong(payload) {
  const header = Buffer.alloc(2);
  header[0] = 0x8a;
  header[1] = payload ? payload.length : 0;
  return payload && payload.length ? Buffer.concat([header, payload]) : header;
}

function encodeClose() {
  const buf = Buffer.alloc(2);
  buf[0] = 0x88;
  buf[1] = 0;
  return buf;
}

// ---------- Client & Matchmaking state ----------
const clients = new Map();
const waiting = { text: [], video: [] };

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

function send(client, obj) {
  if (!client || !client.socket || client.socket.destroyed) return;
  try {
    client.socket.write(encodeFrame(JSON.stringify(obj)));
  } catch (e) { /* ignore */ }
}

function removeFromQueue(id) {
  waiting.text = waiting.text.filter(x => x !== id);
  waiting.video = waiting.video.filter(x => x !== id);
}

function unpair(id) {
  const c = clients.get(id);
  if (!c) return;
  if (c.partnerId) {
    const p = clients.get(c.partnerId);
    if (p) {
      p.partnerId = null;
      send(p, { type: 'partner-left', reason: 'Partner disconnected' });
    }
    c.partnerId = null;
  }
}

function tryMatch(mode) {
  const q = waiting[mode];
  while (q.length >= 2) {
    const aId = q.shift();
    const bId = q.shift();
    const a = clients.get(aId);
    const b = clients.get(bId);
    if (!a || !b) continue;
    a.partnerId = bId;
    b.partnerId = aId;
    send(a, {
      type: 'matched',
      partnerId: bId,
      role: 'offerer',
      partner: b.profile || {},
      mode
    });
    send(b, {
      type: 'matched',
      partnerId: aId,
      role: 'answerer',
      partner: a.profile || {},
      mode
    });
  }
}

// ---------- HTTP static + WebSocket upgrade ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
});

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }
  const accept = acceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const id = uid();
  const client = { id, socket, partnerId: null, mode: null, profile: {}, buffer: Buffer.alloc(0) };
  clients.set(id, client);
  send(client, { type: 'welcome', id });

  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    client.buffer = parseFrames(client.buffer, (msg, special, payload) => {
      if (special === 'close') {
        cleanup(id);
        try { socket.write(encodeClose()); } catch (_) {}
        socket.destroy();
        return;
      }
      if (special === 'ping') {
        try { socket.write(encodePong(payload || Buffer.alloc(0))); } catch (_) {}
        return;
      }
      if (!msg) return;
      let data;
      try { data = JSON.parse(msg); } catch (_) { return; }
      handleMessage(id, data);
    });
  });

  socket.on('close', () => cleanup(id));
  socket.on('error', () => cleanup(id));
});

function cleanup(id) {
  const c = clients.get(id);
  if (!c) return;
  removeFromQueue(id);
  unpair(id);
  clients.delete(id);
}

function handleMessage(id, data) {
  const client = clients.get(id);
  if (!client) return;

  switch (data.type) {
    case 'find': {
      removeFromQueue(id);
      unpair(id);
      client.mode = data.mode === 'video' ? 'video' : 'text';
      client.profile = data.profile || {};
      waiting[client.mode].push(id);
      send(client, { type: 'searching', mode: client.mode });
      tryMatch(client.mode);
      break;
    }
    case 'signal': {
      if (!client.partnerId || client.partnerId !== data.to) return;
      const partner = clients.get(data.to);
      if (partner) {
        send(partner, { type: 'signal', from: id, signal: data.signal });
      }
      break;
    }
    case 'chat': {
      if (!client.partnerId) return;
      const partner = clients.get(client.partnerId);
      if (partner) {
        send(partner, { type: 'chat', from: id, text: data.text, ts: Date.now() });
      }
      break;
    }
    case 'next':
    case 'leave': {
      removeFromQueue(id);
      unpair(id);
      send(client, { type: 'idle' });
      break;
    }
    case 'report': {
      console.log(`[REPORT] from=${id} against=${client.partnerId} reason=${data.reason || 'n/a'}`);
      unpair(id);
      send(client, { type: 'report-ack' });
      break;
    }
    default:
      break;
  }
}

server.listen(PORT, () => {
  console.log('\n  PeerPath signaling server running');
  console.log('  → http://localhost:' + PORT);
  console.log('  Open two browser tabs and start matching.\n');
});
