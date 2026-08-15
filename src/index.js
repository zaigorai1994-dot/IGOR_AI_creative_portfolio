const SESSION_COOKIE = "igor_admin_session";
const SESSION_TTL = 24 * 60 * 60;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(
    new RegExp("(^|;\\s*)" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)")
  );
  return match ? decodeURIComponent(match[2]) : null;
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function textBase64url(text) {
  return base64url(new TextEncoder().encode(text));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );

  return base64url(new Uint8Array(signature));
}

async function createSession(env) {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL
  };

  const body = textBase64url(JSON.stringify(payload));
  const signature = await hmac(env.SESSION_SECRET, body);

  return body + "." + signature;
}

async function checkSession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);

  if (!token || !env.SESSION_SECRET) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [body, signature] = parts;
  const expected = await hmac(env.SESSION_SECRET, body);

  if (signature !== expected) return false;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(body.replace(/-/g, "+").replace(/_/g, "/") + "=="), c => c.charCodeAt(0))
      )
    );

    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function cookieHeader(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

function clearCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function safePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\.\./g, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

async function handleLogin(request, env) {
  let password = "";

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json();
    password = body.password || "";
  } else {
    const form = await request.formData();
    password = form.get("password") || "";
  }

  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ ok: false, error: "Неправильний пароль" }, 401);
  }

  const session = await createSession(env);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookieHeader(session),
      "Cache-Control": "no-store"
    }
  });
}

async function handleUpload(request, env) {
  if (!(await checkSession(request, env))) {
    return json({ ok: false, error: "Потрібна авторизація" }, 401);
  }

  const contentType = request.headers.get("content-type") || "";

  let file;
  let name;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    file = form.get("file");
    name = form.get("name") || (file && file.name);
  } else {
    const url = new URL(request.url);
    name = url.searchParams.get("name");
    file = request.body;
  }

  if (!file || !name) {
    return json({ ok: false, error: "Файл не переданий" }, 400);
  }

  name = safePath(name);

  if (!name) {
    return json({ ok: false, error: "Неправильне ім'я файлу" }, 400);
  }

  await env.PORTFOLIO_IMAGES.put(name, file, {
    httpMetadata: {
      contentType:
        file.type ||
        "application/octet-stream"
    }
  });

  return json({
    ok: true,
    name,
    url: `/file/${name}`
  });
}

async function handleFiles(request, env) {
  if (!(await checkSession(request, env))) {
    return json({ ok: false, error: "Потрібна авторизація" }, 401);
  }

  const url = new URL(request.url);
  const prefix = safePath(url.searchParams.get("prefix") || "");

  const listed = await env.PORTFOLIO_IMAGES.list({
    prefix
  });

  return json({
    ok: true,
    files: listed.objects.map(obj => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded
    }))
  });
}

async function handleDelete(request, env) {
  if (!(await checkSession(request, env))) {
    return json({ ok: false, error: "Потрібна авторизація" }, 401);
  }

  const url = new URL(request.url);
  let name = url.searchParams.get("name");

  if (!name && request.method === "POST") {
    try {
      const body = await request.json();
      name = body.name;
    } catch {}
  }

  name = safePath(name);

  if (!name) {
    return json({ ok: false, error: "Не вказано файл" }, 400);
  }

  await env.PORTFOLIO_IMAGES.delete(name);

  return json({
    ok: true,
    deleted: name
  });
}

async function handleFile(request, env) {
  const url = new URL(request.url);
  const name = safePath(
    decodeURIComponent(url.pathname.replace(/^\/file\/?/, ""))
  );

  if (!name) {
    return new Response("File not found", { status: 404 });
  }

  const object = await env.PORTFOLIO_IMAGES.get(name);

  if (!object) {
    return new Response("File not found", { status: 404 });
  }

  const headers = new Headers();

  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, {
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }

      if (path === "/logout") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": clearCookieHeader(),
            "Cache-Control": "no-store"
          }
        });
      }

      if (path === "/check-session") {
        const authorized = await checkSession(request, env);
        return json({ ok: authorized, authorized });
      }

      if (path === "/upload" && request.method === "POST") {
        return await handleUpload(request, env);
      }

      if (path === "/files" && request.method === "GET") {
        return await handleFiles(request, env);
      }

      if (path === "/delete" && (request.method === "POST" || request.method === "DELETE")) {
        return await handleDelete(request, env);
      }

      if (path.startsWith("/file/") && request.method === "GET") {
        return await handleFile(request, env);
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response("Not found", { status: 404 });

    } catch (error) {
      return json({
        ok: false,
        error: error.message || "Server error"
      }, 500);
    }
  }
};
