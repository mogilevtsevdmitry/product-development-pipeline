#!/usr/bin/env node
/**
 * MCP Server for Media Generation tools.
 * All media generation through OpenAI API:
 * - Images: GPT-Image-1 (gpt-image-1)
 * - Video: Sora (via responses API)
 * - Music: Beatoven.ai (separate API)
 *
 * Required env vars: OPENAI_API_KEY, BEATOVEN_API_KEY
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
// OpenAI Sora (Video Generation)
// ============================================================================

async function generateVideo(prompt, duration = 5, aspectRatio = "9:16") {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY not set" };

  // Map aspect ratio to resolution
  const resMap = {
    "9:16": "1080x1920",
    "16:9": "1920x1080",
    "1:1": "1080x1080",
  };

  try {
    // Create video generation via responses API
    const res = await httpRequest(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      {
        model: "sora",
        input: prompt,
        tools: [{
          type: "video_generation",
          duration,
          aspect_ratio: aspectRatio,
          resolution: aspectRatio === "9:16" ? "480p" : "480p", // start with 480p for cost
        }],
      }
    );

    if (res.status !== 200) {
      return { error: `Sora API error: ${res.status}`, details: res.data };
    }

    // Check for pending status — poll if needed
    let responseData = res.data;
    const responseId = responseData.id;

    if (responseData.status === "queued" || responseData.status === "in_progress") {
      // Poll for completion (max 5 minutes)
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000));

        const pollRes = await httpRequest(
          `https://api.openai.com/v1/responses/${responseId}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
          }
        );

        if (pollRes.status !== 200) continue;
        responseData = pollRes.data;

        if (responseData.status === "completed") break;
        if (responseData.status === "failed") {
          return { error: `Video generation failed: ${responseData.error || "unknown"}` };
        }
      }
    }

    // Extract video URL from output
    let videoUrl = null;
    const output = responseData.output || [];
    for (const item of output) {
      if (item.type === "video_generation_call" && item.video_url) {
        videoUrl = item.video_url;
        break;
      }
      // Also check nested results
      if (item.generation_id) {
        // Fetch the generation result
        const genRes = await httpRequest(
          `https://api.openai.com/v1/videos/generations/${item.generation_id}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
          }
        );
        if (genRes.data?.url) {
          videoUrl = genRes.data.url;
          break;
        }
      }
    }

    if (!videoUrl) {
      return {
        error: "No video URL in response",
        details: { status: responseData.status, output_types: output.map(o => o.type) },
      };
    }

    // Download video
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
      model: "sora",
    };
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

    // Compose
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

    // Poll for completion (max 3 min)
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
    description: "Сгенерировать короткое видео через OpenAI Sora по текстовому промпту",
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
