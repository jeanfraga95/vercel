// api/index.js — Vercel Serverless Function
// Proxy XHTTP/VLESS com suporte a múltiplos VPS por path

import https from "node:https";
import http from "node:http";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

// ─── CONFIGURAÇÃO DOS SERVIDORES ─────────────────────────
// A chave é o path que o cliente vai usar no link VLESS.
// Use port: 443 para HTTPS ou port: 80 para HTTP no VPS.
const SERVERS = {
  "/": { host: "163.176.239.220", port: 443 },
  "/us": { host: "IP-OU-DOMINIO-VPS-US", port: 443 },
  "/jp": { host: "IP-OU-DOMINIO-VPS-JP", port: 443 },
  // "/de": { host: "IP-OU-DOMINIO-VPS-DE", port: 443 },
};

// VPS padrão caso o path não bata com nenhuma rota acima
const DEFAULT_SERVER = { host: "163.176.239.220", port: 443 };
// ─────────────────────────────────────────────────────────

function resolveServer(reqUrl) {
  for (const [prefix, server] of Object.entries(SERVERS)) {
    if (
      reqUrl === prefix ||
      reqUrl.startsWith(prefix + "/") ||
      reqUrl.startsWith(prefix + "?")
    ) {
      const remainingPath = reqUrl.slice(prefix.length) || "/";
      return { server, upstreamPath: remainingPath };
    }
  }
  return { server: DEFAULT_SERVER, upstreamPath: reqUrl };
}

export default function handler(req, res) {
  const { server, upstreamPath } = resolveServer(req.url || "/");

  // Monta os headers, ignorando os que causam problema no proxy
  const forwardHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const k = key.toLowerCase();
    if (k === "host" || k === "connection" || k === "transfer-encoding") continue;
    forwardHeaders[key] = value;
  }
  forwardHeaders["host"] = server.host;

  const options = {
    hostname: server.host,
    port: server.port,
    path: upstreamPath,
    method: req.method,
    headers: forwardHeaders,
    // Aceita certificados auto-assinados (comum em servidores Xray)
    rejectUnauthorized: false,
  };

  // Escolhe http ou https conforme a porta
  const protocol = server.port === 443 ? https : http;

  const proxyReq = protocol.request(options, (proxyRes) => {
    // Filtra headers de resposta problemáticos
    const resHeaders = {};
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      const k = key.toLowerCase();
      if (k === "transfer-encoding" || k === "connection") continue;
      resHeaders[key] = value;
    }

    res.writeHead(proxyRes.statusCode, resHeaders);

    // Pipe direto — não bufferiza, essencial para XHTTP streaming
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error(`[proxy error] ${server.host}:${server.port}`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Bad Gateway",
          server: server.host,
          detail: err.message,
        })
      );
    }
  });

  // Pipe do body da requisição para o VPS
  req.pipe(proxyReq, { end: true });
}
