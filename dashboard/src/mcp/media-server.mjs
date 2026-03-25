#!/usr/bin/env node
/**
 * MCP Server for Media Generation tools.
 * Provides tools for generating images (DALL-E 3), video (Kling AI), and music (Beatoven.ai).
 * Communicates via stdio (stdin/stdout) using JSON-RPC 2.0.
 *
 * Required env vars: OPENAI_API_KEY, KLING_ACCESS_KEY, KLING_SECRET_KEY, BEATOVEN_API_KEY
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
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data, raw: true });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(120000, () => {
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
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(outputPath);
        return downloadFile(res.headers.location, outputPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(outputPath); });
    }).on("error", (err) => {
      fs.unlinkSync(outputPath);
      reject(err);
    });
  });
}

// ============================================================================
// DALL-E 3 (Image Generation)
// ============================================================================

async function generateImage(prompt, size = "1024x1024", quality = "standard") {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY not set" };

  // Map our sizes to DALL-E supported sizes
  const sizeMap = {
    "1080x1080": "1024x1024",
    "1080x1920": "1024x1792",
    "1080x566": "1792x1024",
    "1024x1024": "1024x1024",
    "1024x1792": "1024x1792",
    "1792x1024": "1792x1024",
  };
  const dalleSize = sizeMap[size] || "1024x1024";

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
        model: "dall-e-3",
        prompt,
        n: 1,
        size: dalleSize,
        quality,
        response_format: "url",
      }
    );

    if (res.status !== 200) {
      return { error: `DALL-E API error: ${res.status}`, details: res.data };
    }

    const imageUrl = res.data.data?.[0]?.url;
    const revisedPrompt = res.data.data?.[0]?.revised_prompt;
    if (!imageUrl) return { error: "No image URL in response" };

    // Download image
    const imageId = `img-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const ext = "png";
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
      dimensions: dalleSize,
      prompt_used: prompt,
      revised_prompt: revisedPrompt,
      format: ext,
      file_size_kb: Math.round(stats.size / 1024),
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
    exp: now + 1800, // 30 min
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

  try {
    // Create video generation task
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
      await new Promise((r) => setTimeout(r, 5000)); // 5 sec intervals

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
          resolution: aspectRatio === "9:16" ? "1080x1920" : "1920x1080",
          format: "mp4",
          file_size_mb: Math.round(stats.size / 1024 / 1024 * 10) / 10,
          prompt_used: prompt,
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
  const apiKey = process.env.BEATOVEN_API_KEY;
  if (!apiKey) return { error: "BEATOVEN_API_KEY not set" };

  try {
    // Create track
    const createRes = await httpRequest(
      "https://api.beatoven.ai/api/v2/tracks",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      {
        title: `${mood}-${genre}-${Date.now()}`,
        duration_ms: duration * 1000,
        tempo: bpm ? { value: bpm } : undefined,
        genre,
        mood,
      }
    );

    if (createRes.status !== 200 && createRes.status !== 201) {
      return { error: `Beatoven API error: ${createRes.status}`, details: createRes.data };
    }

    const trackId = createRes.data?.id || createRes.data?.track_id;
    if (!trackId) return { error: "No track_id in response", details: createRes.data };

    // Compose/render the track
    const composeRes = await httpRequest(
      `https://api.beatoven.ai/api/v2/tracks/${trackId}/compose`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
      {}
    );

    if (composeRes.status !== 200 && composeRes.status !== 202) {
      return { error: `Beatoven compose error: ${composeRes.status}`, details: composeRes.data };
    }

    // Poll for completion (max 3 minutes)
    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const statusRes = await httpRequest(
        `https://api.beatoven.ai/api/v2/tracks/${trackId}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );

      const track = statusRes.data;
      if (track?.status === "composed" || track?.status === "ready" || track?.download_url || track?.url) {
        const audioUrl = track.download_url || track.url || track.audio_url;
        if (!audioUrl) return { error: "Track composed but no download URL", details: track };

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
          source: "beatoven",
        };
      }

      if (track?.status === "failed" || track?.status === "error") {
        return { error: `Music generation failed: ${track.error || "unknown"}` };
      }
    }

    return { error: "Music generation timed out (3 min)" };
  } catch (err) {
    return { error: `Music generation failed: ${err.message}` };
  }
}

// ============================================================================
// MCP Protocol
// ============================================================================

const TOOLS_META = [
  {
    name: "generate_image",
    description: "Сгенерировать изображение через DALL-E 3 по текстовому промпту",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Промпт для генерации (на английском)" },
        size: { type: "string", enum: ["1080x1080", "1080x1920", "1080x566"], description: "Размер изображения" },
        quality: { type: "string", enum: ["standard", "hd"], description: "Качество (hd дороже)" },
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
        prompt: { type: "string", description: "Описание видеосцены (на английском)" },
        duration: { type: "number", enum: [5, 10], description: "Длительность в секундах (5 или 10)" },
        aspect_ratio: { type: "string", enum: ["9:16", "16:9", "1:1"], description: "Соотношение сторон" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_music",
    description: "Сгенерировать фоновую музыку через Beatoven.ai",
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
      return await generateImage(args.prompt, args.size || "1080x1080", args.quality || "standard");
    case "generate_video":
      return await generateVideo(args.prompt, args.duration || 5, args.aspect_ratio || "9:16");
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
          serverInfo: { name: "media-tools", version: "1.0.0" },
        },
      };

    case "notifications/initialized":
      return null;

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS_META } };

    case "tools/call":
      // Return a promise marker — handled async in main loop
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

    if (!response) return; // notification

    if (response._async) {
      // Handle async tool call
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

process.stderr.write(`[media-tools] MCP server started. Output dir: ${OUTPUT_DIR}\n`);
