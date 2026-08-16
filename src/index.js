const CATEGORIES = new Set(["advertising", "brands", "houses", "stories", "characters", "other"]);

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function safeFileName(name) {
  return String(name || "work")
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґ]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "work";
}

async function handleUpload(request, env) {
  const provided = request.headers.get("X-Admin-Key") || "";
  if (!env.ADMIN_KEY || provided !== env.ADMIN_KEY) {
    return json({ error: "Невірний адміністративний ключ." }, 401);
  }

  const form = await request.formData();
  const file = form.get("file") || form.get("photo") || form.get("image");
  const category = String(form.get("category") || "other");
  const title = String(form.get("title") || "Нова робота").trim();

  if (!(file instanceof File)) return json({ error: "Файл не отримано." }, 400);
  if (!CATEGORIES.has(category)) return json({ error: "Неправильна категорія." }, 400);
  if (!file.type.startsWith("image/")) return json({ error: "Дозволені тільки зображення." }, 400);
  if (file.size > 10 * 1024 * 1024) return json({ error: "Максимальний розмір файлу — 10 МБ." }, 400);

  const extMap = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };

  const ext = extMap[file.type];
  if (!ext) return json({ error: "Підтримуються JPG, PNG, WebP та GIF." }, 400);

  const key = `${category}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(title)}.${ext}`;

  await env.PORTFOLIO_IMAGES.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: {
      title: title.slice(0, 120),
      category
    }
  });

  return json({ ok: true, key });
}

async function handleWorks(env) {
  const list = await env.PORTFOLIO_IMAGES.list({ limit: 1000 });

  const works = (list.objects || []).map(o => ({
    key: o.key,
    title: o.customMetadata?.title || o.key.split("/").pop(),
    category: o.customMetadata?.category || o.key.split("/")[0] || "other"
  }));

  return json({ works });
}

async function handleFile(request, env) {
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/files\//, ""));

  if (!key || key.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.PORTFOLIO_IMAGES.get(key);

  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/upload" && request.method === "POST") {
        return await handleUpload(request, env);
      }

      if (url.pathname === "/api/works" && request.method === "GET") {
        return await handleWorks(env);
      }

      if (url.pathname.startsWith("/files/") && request.method === "GET") {
        return await handleFile(request, env);
      }

      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error(error);
      return json({ error: "Внутрішня помилка сервера." }, 500);
    }
  }
};
