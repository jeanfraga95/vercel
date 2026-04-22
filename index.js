// api/index.js
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    maxDuration: 60,        // aumente se precisar (máx 60s em Hobby)
  },
};

// Configuração dos servidores
const SERVERS = {
  "/": { host: "163.176.239.220", port: "443" },
  // adicione mais...
};

const DEFAULT_SERVER = { host: "163.176.239.220", port: "443" };

function resolveServer(reqUrl) {
  for (const [prefix, server] of Object.entries(SERVERS)) {
    if (reqUrl === prefix || reqUrl.startsWith(prefix + "/") || reqUrl.startsWith(prefix + "?")) {
      const remaining = reqUrl.slice(prefix.length) || "/";
      return { server, upstreamPath: remaining };
    }
  }
  return { server: DEFAULT_SERVER, upstreamPath: reqUrl };
}

export default async function handler(req, res) {
  const { server, upstreamPath } = resolveServer(req.url || "/");

  const url = `https://${server.host}:${server.port}${upstreamPath}`;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["transfer-encoding"];
  headers.host = server.host;

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      redirect: "manual",
      // duplex: "half" → REMOVA essa linha
    });

    res.status(upstream.status);

    for (const [key, value] of upstream.headers) {
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
    res.status(502).json({
      error: "Bad Gateway",
      server: server.host,
      detail: err.message,
    });
  }
}
