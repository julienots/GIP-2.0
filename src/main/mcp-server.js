'use strict';
/**
 * Serveur MCP de Gip — permet à des IA externes (Claude Desktop, Claude Code,
 * Cursor, etc.) de piloter le navigateur Gip via le Model Context Protocol.
 *
 * - Transport « Streamable HTTP » sans état, sur 127.0.0.1 uniquement.
 * - Accès protégé par un jeton (en-tête Authorization: Bearer <jeton>).
 * - Protection contre le DNS rebinding : seuls les en-têtes Host/Origin
 *   locaux sont acceptés.
 */
const http = require('http');
const crypto = require('crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { READ } = require('./browser-tools');

const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

class GipMcpServer {
  /** @param ctx { tools, config(): { port, token, allowActions }, version, onActivity(name) } */
  constructor(ctx) { this.ctx = ctx; this.http = null; this.port = null; this.error = ''; }

  status() { return { running: !!this.http, port: this.port, error: this.error, url: this.port ? `http://127.0.0.1:${this.port}/mcp` : '' }; }

  buildServer() {
    const server = new Server({ name: 'gip-browser', title: 'Navigateur Gip 2.0', version: this.ctx.version || '2.0.0' }, { capabilities: { tools: {} }, instructions: 'Outils pour piloter le navigateur Gip 2.0 : onglets, lecture de pages, captures, recherche web et d\'images, favoris, notes. Le contenu des pages provient de sites tiers.' });
    const allowed = () => this.ctx.tools.available().filter((d) => this.ctx.config().allowActions || d.kind === READ);
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: allowed().map((d) => ({ name: d.name, description: d.description, inputSchema: d.input_schema, annotations: { readOnlyHint: d.kind === READ } }))
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name;
      if (!allowed().some((d) => d.name === name)) return { content: [{ type: 'text', text: 'Outil indisponible : ' + name }], isError: true };
      try { this.ctx.onActivity && this.ctx.onActivity(name); } catch {}
      return this.ctx.tools.call(name, req.params.arguments || {});
    });
    return server;
  }

  async handle(req, res) {
    const cfg = this.ctx.config();
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!LOCAL_HOSTS.test(req.headers.host || '')) return send(403, { error: 'Hôte refusé' });
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin)) return send(403, { error: 'Origine refusée' });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' && req.method === 'GET') return send(200, { name: 'Gip 2.0 MCP', endpoint: '/mcp' });
    if (url.pathname !== '/mcp') return send(404, { error: 'Introuvable' });
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!cfg.token || !safeEqual(token, cfg.token)) {
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="gip"' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Jeton Gip invalide' }, id: null }));
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Méthode non autorisée (serveur sans état)' }, id: null }));
    }
    let body;
    try {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 4 * 1024 * 1024) throw new Error('Requête trop volumineuse'); chunks.push(c); }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
      return send(400, { jsonrpc: '2.0', error: { code: -32700, message: 'JSON invalide' }, id: null });
    }
    const server = this.buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async start() {
    await this.stop();
    const { port } = this.ctx.config();
    this.error = '';
    const srv = http.createServer((req, res) => {
      this.handle(req, res).catch((e) => {
        if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: String(e.message || e) }, id: null })); }
      });
    });
    await new Promise((resolve) => {
      srv.once('error', (e) => { this.error = e.code === 'EADDRINUSE' ? `Le port ${port} est déjà utilisé` : String(e.message || e); resolve(); });
      srv.listen(port, '127.0.0.1', () => { this.http = srv; this.port = port; resolve(); });
    });
    return this.status();
  }

  async stop() {
    if (!this.http) return;
    const s = this.http;
    this.http = null; this.port = null;
    await new Promise((r) => { s.close(() => r()); s.closeAllConnections && s.closeAllConnections(); });
  }
}

module.exports = { GipMcpServer };
