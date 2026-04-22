// api/index.js — Vercel Serverless Function
// Proxy XHTTP/VLESS com suporte a múltiplos VPS por path

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

// ─── CONFIGURAÇÃO DOS SERVIDORES ─────────────────────────
// Adicione quantos VPS quiser aqui.
// A chave é o path que o cliente vai usar no link VLESS.
const SERVERS = {
  "/": { host: "163.176.239.220", port: "443" },
  "/us": { host: "IP-OU-DOMINIO-VPS-US", port: "443" },
  "/jp": { host: "IP-OU-DOMINIO-VPS-JP", port: "443" },
  // Adicione mais entradas conforme necessário:
  // "/de": { host: "IP-OU-DOMINIO-VPS-DE", port: "443" },
};

// VPS padrão caso o path não bata com nenhuma rota acima
const DEFAULT_SERVER = { host: "IP-OU-DOMINIO-VPS-PADRAO", port: "443" };
// ─────────────────────────────────────────────────────────

function resolveServer(reqUrl) {
  for (const [prefix, server] of Object.entries(SERVERS)) {
    if (reqUrl === prefix || reqUrl.startsWith(prefix + "/") || reqUrl.startsWith(prefix + "?")) {
      const remainingPath = reqUrl.slice(prefix.length) || "/";
      return { server, upstreamPath: remainingPath };
    }
  }
  return { server: DEFAULT_SERVER, upstreamPath: reqUrl };
}

export default async function handler(req, res) {
  const { server, upstreamPath } = resolveServer(req.url || "/");

  const url = `https://${server.host}:${server.port}${upstreamPath}`;

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const k = key.toLowerCase();
    if (k === "host" || k === "connection" || k === "transfer-encoding") continue;
    headers[key] = value;
  }
  headers["host"] = server.host;

  const bodyBuffer = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
      redirect: "manual",
      duplex: "half",
    });

    res.status(upstream.status);

    for (const [key, value] of upstream.headers.entries()) {
      const k = key.toLowerCase();
      if (k === "transfer-encoding" || k === "connection") continue;
      res.setHeader(key, value);
    }

    if (upstream.body) {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }

    res.end();
  } catch (err) {
    console.error(`[proxy error] ${server.host}:${server.port}`, err);
    res.status(502).json({ error: "Bad Gateway", server: server.host, detail: err.message });
  }
}
