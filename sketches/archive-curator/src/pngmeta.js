// Pulls generation metadata out of PNG text chunks — ComfyUI embeds its
// API-format graph as "prompt" (and the editor graph as "workflow");
// A1111/Forge write a single "parameters" string. Read-only.
(function () {
  const C = (window.Curator = window.Curator || {});
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

  function decodeText(bytes) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder("latin1").decode(bytes);
    }
  }

  async function inflate(bytes) {
    const ds = new DecompressionStream("deflate");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Reads chunk by chunk through file.slice() rather than loading the whole
  // file: text chunks normally sit before the image data, so once one has
  // been found, the first IDAT ends the search.
  async function readChunks(file) {
    let buf = new Uint8Array(await file.slice(0, 1 << 18).arrayBuffer());
    let bufStart = 0;
    const bytes = async (pos, len) => {
      if (pos >= bufStart && pos + len <= bufStart + buf.length) return buf.subarray(pos - bufStart, pos - bufStart + len);
      buf = new Uint8Array(await file.slice(pos, pos + Math.max(len, 1 << 12)).arrayBuffer());
      bufStart = pos;
      return buf.subarray(0, len);
    };
    for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) return {};
    const out = {};
    let pos = 8;
    while (pos + 8 <= file.size) {
      const h = await bytes(pos, 8);
      if (h.length < 8) break;
      const len = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
      const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
      const dataPos = pos + 8;
      pos += 12 + len;
      if (type === "IEND") break;
      if (type === "IDAT" && Object.keys(out).length) break;
      if (type !== "tEXt" && type !== "iTXt" && type !== "zTXt") continue;
      const data = (await bytes(dataPos, len)).slice();
      const nul = data.indexOf(0);
      if (nul < 0) continue;
      const key = new TextDecoder("latin1").decode(data.subarray(0, nul));
      try {
        if (type === "tEXt") {
          out[key] = decodeText(data.subarray(nul + 1));
        } else if (type === "zTXt") {
          out[key] = decodeText(await inflate(data.subarray(nul + 2)));
        } else {
          const compressed = data[nul + 1] === 1;
          let p = nul + 3;
          p = data.indexOf(0, p) + 1; // language tag
          p = data.indexOf(0, p) + 1; // translated keyword
          const text = data.subarray(p);
          out[key] = new TextDecoder("utf-8").decode(compressed ? await inflate(text) : text);
        }
      } catch (e) {
        /* skip unreadable chunk */
      }
    }
    return out;
  }

  // Walks a ComfyUI API-format graph backwards from a sampler's
  // positive/negative input, collecting any prompt-ish strings on the way
  // (handles CLIPTextEncode, SDXL encoders, string primitives, combiners...).
  function collectText(graph, link, seen, depth) {
    if (!Array.isArray(link) || depth > 6) return [];
    const id = String(link[0]);
    if (seen.has(id)) return [];
    seen.add(id);
    const node = graph[id];
    if (!node || !node.inputs) return [];
    const texts = [];
    for (const [k, v] of Object.entries(node.inputs)) {
      if (typeof v === "string" && /^(text|text_g|text_l|string|prompt|value|positive|negative)$/i.test(k) && v.trim()) {
        texts.push(v.trim());
      } else if (Array.isArray(v)) {
        texts.push(...collectText(graph, v, seen, depth + 1));
      }
    }
    return texts;
  }

  function summarizeComfy(graph) {
    const nodes = Object.entries(graph);
    const samplers = nodes.filter(([, n]) => n && n.inputs && n.inputs.positive !== undefined);
    const uniq = (arr) => [...new Set(arr)];
    let positive = [];
    let negative = [];
    for (const [, s] of samplers) {
      positive.push(...collectText(graph, s.inputs.positive, new Set(), 0));
      negative.push(...collectText(graph, s.inputs.negative, new Set(), 0));
    }
    if (!samplers.length) {
      positive = nodes
        .filter(([, n]) => n && /CLIPTextEncode/i.test(n.class_type || ""))
        .map(([, n]) => n.inputs && n.inputs.text)
        .filter((t) => typeof t === "string");
    }
    const params = [];
    const s = samplers.length ? samplers[0][1].inputs : null;
    if (s) {
      for (const k of ["seed", "noise_seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"]) {
        if (s[k] !== undefined && !Array.isArray(s[k])) params.push([k, s[k]]);
      }
    }
    const models = [];
    const loras = [];
    for (const [, n] of nodes) {
      const inp = (n && n.inputs) || {};
      for (const k of ["ckpt_name", "unet_name", "model_name"]) if (typeof inp[k] === "string") models.push(inp[k]);
      if (typeof inp.lora_name === "string") loras.push(inp.lora_name + (inp.strength_model !== undefined ? " @ " + inp.strength_model : ""));
    }
    return {
      positive: uniq(positive),
      negative: uniq(negative),
      params,
      models: uniq(models),
      loras: uniq(loras),
    };
  }

  async function read(file) {
    if (!/\.png$/i.test(file.name)) return null;
    const chunks = await readChunks(file);
    const result = { raw: chunks, comfy: null, a1111: chunks.parameters || null };
    if (chunks.prompt) {
      try {
        result.comfy = summarizeComfy(JSON.parse(chunks.prompt));
      } catch (e) {
        /* not JSON */
      }
    }
    return Object.keys(chunks).length ? result : null;
  }

  C.pngmeta = { read };
})();
