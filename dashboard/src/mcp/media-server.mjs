#!/usr/bin/env node
/**
 * MCP Server for Media Generation tools.
 * - Images: OpenAI GPT-Image-1
 * - Video: Kling AI
 * - Music: Beatoven.ai
 * - Product photos: ESSENS Catalog API
 *
 * Required env vars: OPENAI_API_KEY, KLING_ACCESS_KEY, KLING_SECRET_KEY, FAL_KEY, ESSENS_API_TOKEN
 * Optional: OUTPUT_DIR (defaults to cwd)
 */

import fs from "fs";
import path from "path";
import https from "https";
import crypto from "crypto";
import { createInterface } from "readline";

const OUTPUT_DIR = process.env.OUTPUT_DIR || process.cwd();

// ============================================================================
// HTTP helpers
// ============================================================================

function httpRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw.toString()), raw });
        } catch {
          resolve({ status: res.statusCode, data: raw.toString(), raw, isRaw: true });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(300000, () => { // 5 min timeout for video
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (body) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      req.write(payload);
    }
    req.end();
  });
}

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(outputPath); } catch {}
        return downloadFile(res.headers.location, outputPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(outputPath); });
    }).on("error", (err) => {
      try { fs.unlinkSync(outputPath); } catch {}
      reject(err);
    });
  });
}

// ============================================================================
// OpenAI Image Generation (gpt-image-1)
// ============================================================================

async function generateImage(prompt, size = "1024x1024", quality = "medium") {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY not set" };

  // Map our sizes to supported sizes
  const sizeMap = {
    "1080x1080": "1024x1024",
    "1080x1920": "1024x1536",
    "1080x566": "1536x1024",
    "1024x1024": "1024x1024",
    "1024x1536": "1024x1536",
    "1536x1024": "1536x1024",
  };
  const apiSize = sizeMap[size] || "1024x1024";

  try {
    const res = await httpRequest(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      {
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: apiSize,
        quality,
      }
    );

    if (res.status !== 200) {
      return { error: `OpenAI Image API error: ${res.status}`, details: res.data };
    }

    // gpt-image-1 returns base64
    const b64 = res.data.data?.[0]?.b64_json;
    const imageUrl = res.data.data?.[0]?.url;

    const imageId = `img-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const ext = "png";
    const filename = `${imageId}.${ext}`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    if (b64) {
      fs.writeFileSync(outputPath, Buffer.from(b64, "base64"));
    } else if (imageUrl) {
      await downloadFile(imageUrl, outputPath);
    } else {
      return { error: "No image data in response" };
    }

    const stats = fs.statSync(outputPath);

    return {
      success: true,
      image_id: imageId,
      image_path: outputPath,
      filename,
      dimensions: apiSize,
      prompt_used: prompt,
      format: ext,
      file_size_kb: Math.round(stats.size / 1024),
      model: "gpt-image-1",
    };
  } catch (err) {
    return { error: `Image generation failed: ${err.message}` };
  }
}

// ============================================================================
// Kling AI (Video Generation)
// ============================================================================

function generateKlingJWT() {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  if (!accessKey || !secretKey) return null;

  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: accessKey,
    exp: now + 1800,
    nbf: now - 5,
    iat: now,
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

async function generateVideo(prompt, duration = 5, aspectRatio = "9:16") {
  const token = generateKlingJWT();
  if (!token) return { error: "KLING_ACCESS_KEY or KLING_SECRET_KEY not set" };

  const resMap = {
    "9:16": "1080x1920",
    "16:9": "1920x1080",
    "1:1": "1080x1080",
  };

  try {
    const createRes = await httpRequest(
      "https://api.klingai.com/v1/videos/text2video",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
      {
        prompt,
        duration: String(duration),
        aspect_ratio: aspectRatio,
        model_name: "kling-v1",
      }
    );

    if (createRes.status !== 200 || createRes.data?.code !== 0) {
      return { error: `Kling API error: ${createRes.status}`, details: createRes.data };
    }

    const taskId = createRes.data?.data?.task_id;
    if (!taskId) return { error: "No task_id in response" };

    // Poll for completion (max 5 minutes)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const freshToken = generateKlingJWT();
      const statusRes = await httpRequest(
        `https://api.klingai.com/v1/videos/text2video/${taskId}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${freshToken}` },
        }
      );

      const task = statusRes.data?.data;
      if (!task) continue;

      if (task.task_status === "succeed") {
        const videoUrl = task.task_result?.videos?.[0]?.url;
        if (!videoUrl) return { error: "No video URL in result" };

        const videoId = `vid-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
        const filename = `${videoId}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, filename);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        await downloadFile(videoUrl, outputPath);
        const stats = fs.statSync(outputPath);

        return {
          success: true,
          video_id: videoId,
          video_path: outputPath,
          filename,
          duration_sec: duration,
          resolution: resMap[aspectRatio] || "1080x1920",
          aspect_ratio: aspectRatio,
          format: "mp4",
          file_size_mb: Math.round(stats.size / 1024 / 1024 * 10) / 10,
          prompt_used: prompt,
          model: "kling-v1",
        };
      }

      if (task.task_status === "failed") {
        return { error: `Video generation failed: ${task.task_status_msg || "unknown"}` };
      }
    }

    return { error: "Video generation timed out (5 min)" };
  } catch (err) {
    return { error: `Video generation failed: ${err.message}` };
  }
}

// ============================================================================
// Beatoven.ai (Music Generation)
// ============================================================================

async function generateMusic(mood, duration, genre = "ambient", bpm) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) return { error: "FAL_KEY not set" };

  // Build descriptive prompt from parameters
  const bpmStr = bpm ? `, ${bpm} BPM` : "";
  const textPrompt = `${mood} ${genre} instrumental background music, ${duration} seconds long${bpmStr}, no vocals, suitable for beauty brand social media content`;

  try {
    // Submit to fal.ai queue
    const submitRes = await httpRequest(
      "https://queue.fal.run/beatoven/music-generation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${falKey}`,
        },
      },
      {
        prompt: textPrompt,
        duration,
      }
    );

    if (submitRes.status !== 200) {
      return { error: `fal.ai API error: ${submitRes.status}`, details: submitRes.data };
    }

    const requestId = submitRes.data?.request_id;
    if (!requestId) return { error: "No request_id in response", details: submitRes.data };

    // Poll for completion (max 5 min)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const statusRes = await httpRequest(
        `https://queue.fal.run/beatoven/music-generation/requests/${requestId}/status`,
        {
          method: "GET",
          headers: { Authorization: `Key ${falKey}` },
        }
      );

      const status = statusRes.data?.status;

      if (status === "COMPLETED") {
        // Get result
        const resultRes = await httpRequest(
          `https://queue.fal.run/beatoven/music-generation/requests/${requestId}`,
          {
            method: "GET",
            headers: { Authorization: `Key ${falKey}` },
          }
        );

        const audioUrl = resultRes.data?.audio?.url || resultRes.data?.output?.url || resultRes.data?.url;
        if (!audioUrl) return { error: "Completed but no audio URL", details: resultRes.data };

        const musicId = `music-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
        const filename = `${musicId}.mp3`;
        const outputPath = path.join(OUTPUT_DIR, filename);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        await downloadFile(audioUrl, outputPath);
        const stats = fs.statSync(outputPath);

        return {
          success: true,
          track_id: musicId,
          audio_path: outputPath,
          filename,
          duration_sec: duration,
          mood,
          genre,
          bpm: bpm || null,
          format: "mp3",
          file_size_kb: Math.round(stats.size / 1024),
          license: "royalty-free",
          source: "beatoven-via-fal",
          prompt_used: textPrompt,
        };
      }

      if (status === "FAILED") {
        return { error: `Music generation failed`, details: statusRes.data };
      }
      // IN_QUEUE, IN_PROGRESS — keep polling
    }

    return { error: "Music generation timed out (5 min)" };
  } catch (err) {
    return { error: `Music generation failed: ${err.message}` };
  }
}

// ============================================================================
// Product Image from ESSENS Catalog
// ============================================================================

async function getProductImage(productId) {
  const apiToken = process.env.ESSENS_API_TOKEN;
  if (!apiToken) return { error: "ESSENS_API_TOKEN not set" };

  try {
    // Fetch product by ID
    const res = await httpRequest(
      `https://bot.beauty-shop-24.ru/api/admin/catalog/products/${productId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiToken}` },
      }
    );

    if (res.status !== 200) {
      // Try search by name/id
      const searchRes = await httpRequest(
        `https://bot.beauty-shop-24.ru/api/admin/catalog/products?search=${encodeURIComponent(productId)}&limit=1`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiToken}` },
        }
      );

      const products = searchRes.data?.products || searchRes.data?.items || (Array.isArray(searchRes.data) ? searchRes.data : []);
      if (products.length === 0) return { error: `Товар "${productId}" не найден в каталоге` };

      const product = products[0];
      const imageUrl = product.image_url;
      if (!imageUrl) return { error: "У товара нет изображения", product_name: product.name };

      const imageId = `catalog-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      const ext = imageUrl.split(".").pop()?.split("?")[0] || "png";
      const filename = `${imageId}.${ext}`;
      const outputPath = path.join(OUTPUT_DIR, filename);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      await downloadFile(imageUrl, outputPath);
      const stats = fs.statSync(outputPath);

      return {
        success: true,
        image_id: imageId,
        image_path: outputPath,
        filename,
        source: "essens_catalog",
        product_id: product.id || productId,
        product_name: product.name,
        original_url: imageUrl,
        file_size_kb: Math.round(stats.size / 1024),
      };
    }

    const product = res.data;
    const imageUrl = product.image_url;
    if (!imageUrl) return { error: "У товара нет изображения", product_name: product.name };

    const imageId = `catalog-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const ext = imageUrl.split(".").pop()?.split("?")[0] || "png";
    const filename = `${imageId}.${ext}`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    await downloadFile(imageUrl, outputPath);
    const stats = fs.statSync(outputPath);

    return {
      success: true,
      image_id: imageId,
      image_path: outputPath,
      filename,
      source: "essens_catalog",
      product_id: product.id || productId,
      product_name: product.name,
      original_url: imageUrl,
      file_size_kb: Math.round(stats.size / 1024),
    };
  } catch (err) {
    return { error: `Failed to fetch product image: ${err.message}` };
  }
}

// ============================================================================
// MCP Protocol
// ============================================================================

const TOOLS_META = [
  {
    name: "generate_image",
    description: "Сгенерировать изображение через OpenAI (gpt-image-1) по текстовому промпту",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Промпт для генерации (на английском, детальный)" },
        size: { type: "string", enum: ["1080x1080", "1080x1920", "1080x566"], description: "Размер: 1080x1080 (пост), 1080x1920 (story/reel), 1080x566 (telegram preview)" },
        quality: { type: "string", enum: ["low", "medium", "high"], description: "Качество (high дороже, medium по умолчанию)" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_video",
    description: "Сгенерировать короткое видео через Kling AI по текстовому промпту",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Описание видеосцены (на английском, детальное)" },
        duration: { type: "number", enum: [5, 10, 15, 20], description: "Длительность в секундах" },
        aspect_ratio: { type: "string", enum: ["9:16", "16:9", "1:1"], description: "Соотношение сторон (9:16 для reels/shorts)" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "get_product_image",
    description: "Скачать реальное фото товара из каталога ESSENS по product_id. Используй ЭТО вместо генерации, когда нужно изображение конкретного продукта.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "ID товара из каталога или название для поиска" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "generate_music",
    description: "Сгенерировать фоновую музыку через Beatoven.ai по настроению и параметрам",
    inputSchema: {
      type: "object",
      properties: {
        mood: { type: "string", description: "Настроение: calm, energetic, luxurious, inspiring, playful, romantic, confident" },
        duration: { type: "number", description: "Длительность в секундах" },
        genre: { type: "string", description: "Жанр: ambient, electronic, pop, cinematic, acoustic, lo-fi" },
        bpm: { type: "number", description: "Темп (BPM)" },
      },
      required: ["mood", "duration"],
    },
  },
];

async function handleToolCall(name, args) {
  switch (name) {
    case "generate_image":
      return await generateImage(args.prompt, args.size || "1080x1080", args.quality || "medium");
    case "generate_video":
      return await generateVideo(args.prompt, args.duration || 5, args.aspect_ratio || "9:16");
    case "get_product_image":
      return await getProductImage(args.product_id);
    case "generate_music":
      return await generateMusic(args.mood, args.duration, args.genre || "ambient", args.bpm);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "media-tools", version: "2.0.0" },
        },
      };

    case "notifications/initialized":
      return null;

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS_META } };

    case "tools/call":
      return { _async: true, id, name: params?.name, args: params?.arguments || {} };

    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

// ============================================================================
// stdio transport
// ============================================================================

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    const response = handleRequest(msg);

    if (!response) return;

    if (response._async) {
      const result = await handleToolCall(response.name, response.args);
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: response.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      }) + "\n");
    } else {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  } catch (err) {
    process.stderr.write(`MCP parse error: ${err.message}\n`);
  }
});

process.stderr.write(`[media-tools] MCP server v2 started (OpenAI + Beatoven). Output: ${OUTPUT_DIR}\n`);
