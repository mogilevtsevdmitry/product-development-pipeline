import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KLING_ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const KLING_SECRET_KEY = process.env.KLING_SECRET_KEY;
const BEATOVEN_API_KEY = process.env.BEATOVEN_API_KEY;
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./output";

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const log = (...args) => process.stderr.write(args.join(" ") + "\n");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueName(prefix, ext) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}_${ts}${ext}`;
}

function fileSizeHuman(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** HS256 JWT — no external deps */
function createJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64url");
  const segments = [encode(header), encode(payload)];
  const signature = crypto
    .createHmac("sha256", secret)
    .update(segments.join("."))
    .digest("base64url");
  segments.push(signature);
  return segments.join(".");
}

/** Poll a URL until predicate returns truthy or timeout. */
async function poll(url, headers, predicate, { interval = 5000, timeout = 180_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const res = await fetch(url, { headers });
    const json = await res.json();
    const result = predicate(json);
    if (result) return result;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("Превышено время ожидания (polling timeout)");
}

/** Download a URL and save to disk. */
async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ошибка загрузки файла: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function generateImage({ prompt, size, style, filename }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY не задан");

  log(`[generate_image] prompt="${prompt}", size=${size}, style=${style}`);

  const body = {
    model: "gpt-image-1",
    prompt,
    n: 1,
    size,
    output_format: "png",
  };

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API ошибка ${res.status}: ${err}`);
  }

  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("Нет данных изображения в ответе API");

  const buf = Buffer.from(b64, "base64");
  const fname = (filename || uniqueName("image", "")) + ".png";
  const filePath = path.resolve(OUTPUT_DIR, fname);
  fs.writeFileSync(filePath, buf);

  log(`[generate_image] saved ${filePath} (${fileSizeHuman(buf.length)})`);

  return {
    success: true,
    file_path: filePath,
    file_size: fileSizeHuman(buf.length),
    metadata: { prompt, size, style, format: "png" },
  };
}

async function generateVideo({ prompt, duration, aspect_ratio, filename }) {
  if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY)
    throw new Error("KLING_ACCESS_KEY / KLING_SECRET_KEY не заданы");

  log(`[generate_video] prompt="${prompt}", duration=${duration}, aspect=${aspect_ratio}`);

  const now = Math.floor(Date.now() / 1000);
  const jwt = createJwt(
    { iss: KLING_ACCESS_KEY, exp: now + 1800, nbf: now - 5, iat: now },
    KLING_SECRET_KEY,
  );
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${jwt}`,
  };

  // 1. Create task
  const createRes = await fetch("https://api.klingai.com/v1/videos/text2video", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      model_name: "kling-v1",
      prompt,
      duration,
      aspect_ratio,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Kling API ошибка ${createRes.status}: ${err}`);
  }

  const createJson = await createRes.json();
  if (createJson.code !== 0) throw new Error(`Kling API ошибка: ${JSON.stringify(createJson)}`);

  const taskId = createJson.data?.task_id;
  if (!taskId) throw new Error("Нет task_id в ответе Kling API");
  log(`[generate_video] task_id=${taskId}, polling...`);

  // 2. Poll
  const pollUrl = `https://api.klingai.com/v1/videos/text2video/${taskId}`;
  const result = await poll(
    pollUrl,
    { Authorization: `Bearer ${jwt}` },
    (json) => {
      const status = json.data?.task_status;
      log(`[generate_video] status=${status}`);
      if (status === "failed") throw new Error(`Генерация видео не удалась: ${JSON.stringify(json.data)}`);
      if (status === "succeed") {
        const videoUrl = json.data?.task_result?.videos?.[0]?.url;
        if (!videoUrl) throw new Error("Нет URL видео в результате");
        return videoUrl;
      }
      return null;
    },
    { interval: 10_000, timeout: 300_000 },
  );

  // 3. Download
  const fname = (filename || uniqueName("video", "")) + ".mp4";
  const filePath = path.resolve(OUTPUT_DIR, fname);
  const bytes = await downloadFile(result, filePath);

  log(`[generate_video] saved ${filePath} (${fileSizeHuman(bytes)})`);

  return {
    success: true,
    file_path: filePath,
    file_size: fileSizeHuman(bytes),
    metadata: { prompt, duration, aspect_ratio, format: "mp4", task_id: taskId },
  };
}

async function generateMusic({ prompt, duration, filename }) {
  if (!BEATOVEN_API_KEY) throw new Error("BEATOVEN_API_KEY не задан");

  log(`[generate_music] prompt="${prompt}", duration=${duration}s`);

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${BEATOVEN_API_KEY}`,
  };

  // 1. Create track
  const createRes = await fetch("https://api.beatoven.ai/api/v2/tracks", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      prompt: { text: prompt },
      format: "mp3",
      duration,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Beatoven API ошибка ${createRes.status}: ${err}`);
  }

  const createJson = await createRes.json();
  const trackId = createJson.id;
  if (!trackId) throw new Error("Нет id трека в ответе Beatoven API");
  log(`[generate_music] track_id=${trackId}, polling...`);

  // 2. Poll
  const pollUrl = `https://api.beatoven.ai/api/v2/tracks/${trackId}`;
  const downloadUrl = await poll(
    pollUrl,
    { Authorization: `Bearer ${BEATOVEN_API_KEY}` },
    (json) => {
      log(`[generate_music] status=${json.status}`);
      if (json.status === "failed") throw new Error("Генерация музыки не удалась");
      if (json.status === "composed") {
        if (!json.download_url) throw new Error("Нет download_url в ответе");
        return json.download_url;
      }
      return null;
    },
    { interval: 5000, timeout: 180_000 },
  );

  // 3. Download
  const fname = (filename || uniqueName("music", "")) + ".mp3";
  const filePath = path.resolve(OUTPUT_DIR, fname);
  const bytes = await downloadFile(downloadUrl, filePath);

  log(`[generate_music] saved ${filePath} (${fileSizeHuman(bytes)})`);

  return {
    success: true,
    file_path: filePath,
    file_size: fileSizeHuman(bytes),
    metadata: { prompt, duration, format: "mp3", track_id: trackId },
  };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "media-generator",
  version: "1.0.0",
});

server.tool(
  "generate_image",
  "Генерация изображения по текстовому описанию (OpenAI gpt-image-1). Возвращает путь к PNG-файлу.",
  {
    prompt: z.string().describe("Описание изображения на английском языке"),
    size: z
      .enum(["1024x1024", "1024x1536", "1536x1024"])
      .optional()
      .default("1024x1024")
      .describe("Размер изображения"),
    style: z
      .enum(["natural", "vivid"])
      .optional()
      .default("natural")
      .describe("Стиль: natural — реалистичный, vivid — яркий и контрастный"),
    filename: z
      .string()
      .optional()
      .describe("Имя файла без расширения (если не указано — генерируется автоматически)"),
  },
  async (params) => {
    try {
      const result = await generateImage(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      log(`[generate_image] ERROR: ${e.message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }],
        isError: true,
      };
    }
  },
);

server.tool(
  "generate_video",
  "Генерация видео по текстовому описанию (Kling AI). Возвращает путь к MP4-файлу.",
  {
    prompt: z.string().describe("Описание видео на английском языке"),
    duration: z
      .enum(["5", "10"])
      .optional()
      .default("5")
      .describe("Длительность видео в секундах"),
    aspect_ratio: z
      .enum(["16:9", "9:16", "1:1"])
      .optional()
      .default("9:16")
      .describe("Соотношение сторон видео"),
    filename: z
      .string()
      .optional()
      .describe("Имя файла без расширения (если не указано — генерируется автоматически)"),
  },
  async (params) => {
    try {
      const result = await generateVideo(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      log(`[generate_video] ERROR: ${e.message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }],
        isError: true,
      };
    }
  },
);

server.tool(
  "generate_music",
  "Генерация музыки по текстовому описанию (Beatoven.ai). Возвращает путь к MP3-файлу.",
  {
    prompt: z.string().describe("Описание желаемой музыки: настроение, жанр, инструменты"),
    duration: z
      .number()
      .optional()
      .default(30)
      .describe("Длительность трека в секундах"),
    filename: z
      .string()
      .optional()
      .describe("Имя файла без расширения (если не указано — генерируется автоматически)"),
  },
  async (params) => {
    try {
      const result = await generateMusic(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      log(`[generate_music] ERROR: ${e.message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("[media-generator] MCP server started");
}

main().catch((e) => {
  log(`[media-generator] Fatal error: ${e.message}`);
  process.exit(1);
});
