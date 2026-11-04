const USER = "robbie";
const ROBOTS = "User-agent: *\nDisallow: /\n";
const enc = new TextEncoder();

const SONG_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DRAFT_KEY_RE = /^lrc-drafts\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(\d{8}-\d{6})\.lrc$/;

async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

function withHeaders(res, extra = {}) {
  const r = new Response(res.body, res);
  r.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  r.headers.set("Cache-Control", "private, no-store");
  r.headers.set("Referrer-Policy", "no-referrer-when-downgrade");
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}

function deny() {
  return withHeaders(new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Private preview", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  }));
}

function json(data, status = 200) {
  return withHeaders(new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  }));
}

function perthStamp(d = new Date()) {
  // Australia/Perth is fixed UTC+8
  const p = new Date(d.getTime() + 8 * 3600 * 1000);
  const y = p.getUTCFullYear();
  const mo = String(p.getUTCMonth() + 1).padStart(2, "0");
  const da = String(p.getUTCDate()).padStart(2, "0");
  const h = String(p.getUTCHours()).padStart(2, "0");
  const mi = String(p.getUTCMinutes()).padStart(2, "0");
  const s = String(p.getUTCSeconds()).padStart(2, "0");
  return `${y}${mo}${da}-${h}${mi}${s}`;
}

function pickMainMp3(keys) {
  const scored = [];
  for (const key of keys) {
    if (!key.toLowerCase().endsWith(".mp3")) continue;
    const name = key.split("/").pop().toLowerCase();
    let score = 10;
    if (/(instrumental|acapella|a\s*cappella|radio\s*edit|clean\s*edit)/i.test(name)) score -= 20;
    scored.push({ key, score });
  }
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return scored.length ? scored[0].key : null;
}

async function resolveR2AudioKey(env, slug) {
  if (!env.AUDIO) return null;
  // Prefer 320 kbps folder, then 320a, then slug root
  for (const prefix of [`downloads/${slug}/320/`, `downloads/${slug}/320a/`, `downloads/${slug}/`]) {
    const keys = [];
    let cursor;
    do {
      const listed = await env.AUDIO.list({ prefix, cursor, limit: 100 });
      for (const obj of listed.objects || []) keys.push(obj.key);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    // Only consider keys directly under this prefix (not deeper unexpected paths for root)
    const direct = keys.filter((k) => {
      const rest = k.slice(prefix.length);
      return rest && !rest.includes("/");
    });
    const picked = pickMainMp3(direct.length ? direct : keys);
    if (picked) return picked;
  }
  return null;
}

async function streamAudioBody(req, obj, sizeHint) {
  const base = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Content-Disposition": "inline",
  };
  const range = req.headers.get("Range");
  const head = req.method === "HEAD";
  const size = sizeHint != null ? sizeHint : (obj.size != null ? obj.size : null);

  if (!range) {
    if (size != null) base["Content-Length"] = String(size);
    return withHeaders(new Response(head ? null : obj.body, { status: 200, headers: base }));
  }

  // For ranged requests, buffer (preview tracks are small enough)
  const buf = await obj.arrayBuffer();
  const sz = buf.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start, end;
  if (m && m[1] !== "") {
    start = +m[1];
    end = m[2] !== "" ? Math.min(+m[2], sz - 1) : sz - 1;
  } else if (m && m[2] !== "") {
    start = Math.max(0, sz - +m[2]);
    end = sz - 1;
  }
  if (!m || start > end || start >= sz) {
    return withHeaders(new Response(null, { status: 416, headers: { "Content-Range": `bytes */${sz}` } }));
  }
  const part = buf.slice(start, end + 1);
  return withHeaders(new Response(head ? null : part, {
    status: 206,
    headers: {
      ...base,
      "Content-Range": `bytes ${start}-${end}/${sz}`,
      "Content-Length": String(part.byteLength),
    },
  }));
}

async function audio(req, env, url) {
  const mPath = /^\/preview-audio\/([a-z0-9-]+)\.mp3$/.exec(url.pathname);
  if (!mPath) {
    return withHeaders(new Response("Not found", { status: 404 }));
  }
  const slug = mPath[1];

  // Freedom: editor uses original 320 from R2 (skip radio-edit Workers Asset)
  if (slug === "freedom") {
    const key = await resolveR2AudioKey(env, slug);
    if (!key) return withHeaders(new Response("Audio not found", { status: 404 }));
    const obj = await env.AUDIO.get(key);
    if (!obj) return withHeaders(new Response("Audio not found", { status: 404 }));
    const res = await streamAudioBody(req, obj, obj.size);
    res.headers.set("X-Audio-Source", `r2:${key}`);
    return res;
  }

  // Prefer Workers Assets copy when present
  const assetRes = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  if (assetRes.ok) {
    const base = {
      "Content-Type": "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Content-Disposition": "inline",
    };
    const range = req.headers.get("Range");
    const head = req.method === "HEAD";
    if (!range) {
      const len = assetRes.headers.get("Content-Length");
      if (len) base["Content-Length"] = len;
      return withHeaders(new Response(head ? null : assetRes.body, { status: 200, headers: base }));
    }
    const buf = await assetRes.arrayBuffer();
    const size = buf.byteLength;
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start, end;
    if (m && m[1] !== "") {
      start = +m[1];
      end = m[2] !== "" ? Math.min(+m[2], size - 1) : size - 1;
    } else if (m && m[2] !== "") {
      start = Math.max(0, size - +m[2]);
      end = size - 1;
    }
    if (!m || start > end || start >= size) {
      return withHeaders(new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } }));
    }
    const part = buf.slice(start, end + 1);
    return withHeaders(new Response(head ? null : part, {
      status: 206,
      headers: {
        ...base,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(part.byteLength),
      },
    }));
  }

  // Fall back to R2 downloads/<slug>/…
  const key = await resolveR2AudioKey(env, slug);
  if (!key) return withHeaders(new Response("Audio not found", { status: 404 }));
  const obj = await env.AUDIO.get(key);
  if (!obj) return withHeaders(new Response("Audio not found", { status: 404 }));
  const res = await streamAudioBody(req, obj, obj.size);
  res.headers.set("X-Audio-Source", `r2:${key}`);
  return res;
}

async function listDraftKeys(env, slug) {
  const prefix = `lrc-drafts/${slug}/`;
  const keys = [];
  let cursor;
  do {
    const listed = await env.AUDIO.list({ prefix, cursor, limit: 1000 });
    for (const obj of listed.objects || []) {
      if (DRAFT_KEY_RE.test(obj.key)) keys.push(obj.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  keys.sort();
  return keys;
}

async function listAllLatestDrafts(env) {
  const prefix = "lrc-drafts/";
  const bySlug = {};
  let cursor;
  do {
    const listed = await env.AUDIO.list({ prefix, cursor, limit: 1000 });
    for (const obj of listed.objects || []) {
      const m = DRAFT_KEY_RE.exec(obj.key);
      if (!m) continue;
      const slug = m[1];
      const stamp = m[2];
      const prev = bySlug[slug];
      if (!prev || stamp > prev.stamp) {
        bySlug[slug] = {
          slug,
          stamp,
          key: obj.key,
          name: `${stamp}.lrc`,
          uploaded: obj.uploaded ? obj.uploaded.toISOString() : null,
          final: true,
        };
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return bySlug;
}

async function handleApi(req, env, url) {
  if (!env.AUDIO) return json({ error: "R2 binding missing" }, 500);

  // GET /api/lrc-drafts  -> latest draft meta per slug (for picker labels)
  if (url.pathname === "/api/lrc-drafts" || url.pathname === "/api/lrc-drafts/") {
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const drafts = await listAllLatestDrafts(env);
    return json({ drafts, note: "Latest draft per song is the final that will be pushed." });
  }

  // GET /api/lrc-drafts/:slug  -> latest draft text + meta
  // POST /api/lrc-drafts/:slug -> save body as new draft
  // DELETE /api/lrc-drafts/:slug/:stamp -> delete one draft (test cleanup)
  const m = url.pathname.match(/^\/api\/lrc-drafts\/([a-z0-9-]+)(?:\/(\d{8}-\d{6}))?\/?$/);
  if (!m) return json({ error: "Not found" }, 404);
  const slug = m[1];
  const stamp = m[2];
  if (!SONG_SLUG_RE.test(slug)) return json({ error: "Bad slug" }, 400);

  if (req.method === "GET" && !stamp) {
    const keys = await listDraftKeys(env, slug);
    if (!keys.length) return json({ draft: null });
    const key = keys[keys.length - 1];
    const obj = await env.AUDIO.get(key);
    if (!obj) return json({ draft: null });
    const text = await obj.text();
    const name = key.split("/").pop();
    return json({
      draft: {
        key,
        name,
        uploaded: obj.uploaded ? obj.uploaded.toISOString() : null,
        text,
        final: true,
      },
      drafts: keys.map((k) => k.split("/").pop()),
      note: "Latest draft is the final that will be pushed.",
    });
  }

  if (req.method === "POST" && !stamp) {
    const ctype = req.headers.get("Content-Type") || "";
    let text = "";
    if (ctype.includes("application/json")) {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.lrc !== "string") return json({ error: "Expected { lrc: string }" }, 400);
      text = body.lrc;
    } else {
      text = await req.text();
    }
    if (!text.length) return json({ error: "Empty LRC" }, 400);
    if (text.length > 500_000) return json({ error: "LRC too large" }, 413);
    // Normalize to LF only; keep trailing newline if present or add one for file consistency
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!text.endsWith("\n")) text += "\n";
    const ts = perthStamp();
    const key = `lrc-drafts/${slug}/${ts}.lrc`;
    await env.AUDIO.put(key, text, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
      customMetadata: { slug, source: "lrc-preview-editor" },
    });
    return json({ ok: true, key, name: `${ts}.lrc`, final: true });
  }

  if (req.method === "DELETE" && stamp) {
    const key = `lrc-drafts/${slug}/${stamp}.lrc`;
    await env.AUDIO.delete(key);
    return json({ ok: true, deleted: key });
  }

  return json({ error: "Method not allowed" }, 405);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/robots.txt") {
      return withHeaders(new Response(ROBOTS, { headers: { "Content-Type": "text/plain; charset=utf-8" } }));
    }
    const pw = env.PREVIEW_PASSWORD;
    if (!pw) return deny();
    const h = req.headers.get("Authorization") || "";
    if (!h.startsWith("Basic ")) return deny();
    let user = "", pass = "";
    try {
      const dec = atob(h.slice(6).trim());
      const i = dec.indexOf(":");
      if (i < 0) return deny();
      user = dec.slice(0, i);
      pass = dec.slice(i + 1);
    } catch {
      return deny();
    }
    const ok = (await safeEqual(user, USER)) & (await safeEqual(pass, pw));
    if (!ok) return deny();

    if (url.pathname === "/api/lrc-drafts" || url.pathname.startsWith("/api/lrc-drafts/")) {
      try {
        return await handleApi(req, env, url);
      } catch (e) {
        return json({ error: String(e && e.message || e), stack: String(e && e.stack || "") }, 500);
      }
    }
    if (url.pathname.startsWith("/preview-audio/")) return audio(req, env, url);
    return withHeaders(await env.ASSETS.fetch(req));
  },
};
