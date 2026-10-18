import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Http2SecureServer } from 'node:http2';
import { networkInterfaces } from 'node:os';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * Phone companion relay. One desktop "host" and any number of phones share a room keyed by a short
 * session code; the server only forwards JSON between them and reports presence.
 *   ws://<host>/ws/session?code=AB12&role=host|phone
 *   GET /api/session/info -> LAN URLs the phone can reach
 */
interface Room {
  host: WebSocket | null;
  phones: Set<WebSocket>;
}

const PATH = '/ws/session';

function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
    }
  }
  return out;
}

function attach(httpServer: Server | Http2SecureServer | null) {
  if (!httpServer) return;
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ noServer: true });
  const send = (ws: WebSocket | null, msg: unknown) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const room = (code: string) => {
    let r = rooms.get(code);
    if (!r) rooms.set(code, (r = { host: null, phones: new Set() }));
    return r;
  };
  const presence = (r: Room) => {
    send(r.host, { type: 'presence', phones: r.phones.size });
    for (const p of r.phones) send(p, { type: 'hostStatus', online: !!r.host });
  };

  (httpServer as Server).on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== PATH) return;
    const code = (url.searchParams.get('code') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const role = url.searchParams.get('role');
    if (!code || (role !== 'host' && role !== 'phone')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const r = room(code);
      if (role === 'host') {
        if (r.host && r.host !== ws) r.host.close(4000, 'replaced');
        r.host = ws;
      } else {
        r.phones.add(ws);
      }
      presence(r);
      let alive = true;
      ws.on('pong', () => (alive = true));
      const ping = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, 15000);

      ws.on('message', (data) => {
        const text = data.toString();
        if (text.length > 20000) return;
        if (role === 'host') for (const p of r.phones) p.readyState === WebSocket.OPEN && p.send(text);
        else if (r.host?.readyState === WebSocket.OPEN) r.host.send(text);
      });
      ws.on('close', () => {
        clearInterval(ping);
        if (role === 'host' && r.host === ws) r.host = null;
        else r.phones.delete(ws);
        presence(r);
        if (!r.host && r.phones.size === 0) rooms.delete(code);
      });
    });
  });
}

const info = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
  if (req.url !== '/api/session/info') return next();
  const port = req.socket.localPort ?? 5173;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ lanUrls: lanUrls(port), port }));
};

export function sessionRelay(): Plugin {
  return {
    name: 'phone-session-relay',
    configureServer(server) {
      attach(server.httpServer);
      server.middlewares.use(info);
    },
    configurePreviewServer(server) {
      attach(server.httpServer);
      server.middlewares.use(info);
    },
  };
}
