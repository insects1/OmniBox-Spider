// @name 茶杯狐
// @author 梦
// @description 影视站：支持首页、分类、详情、刮削、弹幕、播放记录与播放；站点已迁移至 cupfox.in，播放走 /tea 接口直出直链，搜索为站内简单搜索
// @dependencies cheerio
// @version 1.2.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/茶杯狐.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");
const https = require("https");
const http = require("http");

const BASE_URL = "https://www.cupfox.in";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3.1 Mobile/15E148 Safari/604.1";
const LIST_CACHE_TTL = Number(process.env.CUPFOX_LIST_CACHE_TTL || 900);
const DETAIL_CACHE_TTL = Number(process.env.CUPFOX_DETAIL_CACHE_TTL || 1800);
const SEARCH_CACHE_TTL = Number(process.env.CUPFOX_SEARCH_CACHE_TTL || 600);

const CATEGORY_CONFIG = [
  { id: "movie", name: "电影" },
  { id: "tv", name: "剧集" },
  { id: "show", name: "综艺" },
  { id: "anime", name: "动漫" },
];

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

async function requestText(url, options = {}, redirectCount = 0) {
  await OmniBox.log("info", `[茶杯狐][request] ${options.method || "GET"} ${url}`);
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: BASE_URL + "/",
      ...(options.headers || {}),
    },
    body: options.body,
    timeout: options.timeout || 20000,
  });
  const statusCode = Number(res?.statusCode || 0);
  if ([301, 302, 303, 307, 308].includes(statusCode) && redirectCount < 5) {
    const location = res?.headers?.location || res?.headers?.Location || res?.headers?.LOCATION;
    if (location) return requestText(absoluteUrl(location), options, redirectCount + 1);
  }
  if (!res || statusCode !== 200) {
    throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
  }
  return String(res.body || "");
}

async function requestTextNative(url, options = {}) {
  await OmniBox.log("info", `[茶杯狐][native-request] ${options.method || "GET"} ${url}`);
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const body = options.body == null ? "" : String(options.body);
    const headers = {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: BASE_URL + "/",
      ...(options.headers || {}),
    };
    if (body && headers["Content-Length"] == null && headers["content-length"] == null) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const transport = requestUrl.protocol === "http:" ? http : https;
    const req = transport.request({
      protocol: requestUrl.protocol,
      hostname: requestUrl.hostname,
      port: requestUrl.port || (requestUrl.protocol === "http:" ? 80 : 443),
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method: options.method || "GET",
      headers,
      timeout: options.timeout || 20000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode !== 200) {
          reject(new Error(`HTTP ${statusCode} @ ${url}`));
          return;
        }
        resolve({
          body: String(data || ""),
          headers: res.headers || {},
          statusCode,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`timeout @ ${url}`));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getCachedText(cacheKey, ttl, producer, shouldCache = null) {
  try {
    const cached = await OmniBox.getCache(cacheKey);
    if (cached) return String(cached);
  } catch (_) {}
  const value = await producer();
  const textValue = String(value);
  const allowCache = typeof shouldCache === "function" ? shouldCache(textValue) : true;
  if (allowCache) {
    try {
      await OmniBox.setCache(cacheKey, textValue, ttl);
    } catch (_) {}
  }
  return textValue;
}

function absoluteUrl(url) {
  try {
    return new URL(url, BASE_URL).toString();
  } catch (_) {
    return String(url || "");
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return normalizeText(String(value || "").replace(/&nbsp;/gi, " ").replace(/<br\s*\/?>(?=\s*)/gi, " ").replace(/<[^>]+>/g, " "));
}

function cleanDisplayText(value) {
  return normalizeText(
    decodeMaybeGarbled(
      String(value || "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&#160;/gi, " ")
        .replace(/<br\s*\/?>(?=\s*)/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function formatPeopleText(value) {
  const text = cleanDisplayText(value);
  if (!text) return "";
  if (/[\/、，,|]/.test(text)) {
    return text
      .split(/[\/、，,|]+/)
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .join(" / ");
  }
  const parts = text.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  if (parts.length <= 1) return text;
  return parts.join(" / ");
}

function decodeMaybeGarbled(text) {
  const raw = String(text || "");
  if (!/[ÃÂÐÑ]/.test(raw) && !/ç|è|ä|å|æ|é|ê|ë|ï|î|ô|û|ù/.test(raw)) return raw;
  try {
    return Buffer.from(raw, "latin1").toString("utf8");
  } catch (_) {
    return raw;
  }
}

function categoryNameById(categoryId) {
  return CATEGORY_CONFIG.find((item) => item.id === String(categoryId))?.name || "影视";
}

function buildScrapeResourceId(detailUrl) {
  const raw = String(detailUrl || "").trim();
  const match = raw.match(/\/vod-detail\/(\d+)\.html/i);
  return String(match?.[1] || raw);
}

function encodeMeta(obj) {
  try {
    return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
  } catch (_) {
    return "";
  }
}

function decodeMeta(str) {
  try {
    const raw = Buffer.from(String(str || ""), "base64").toString("utf8");
    return JSON.parse(raw || "{}");
  } catch (_) {
    return {};
  }
}

function extractEpisodeNumber(text) {
  const value = cleanDisplayText(text);
  if (!value) return null;
  const match = value.match(/第\s*(\d+)\s*[集话期]/) || value.match(/(?:EP|E)(\d{1,4})/i) || value.match(/^(\d{1,4})$/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function buildDanmakuFileName(vodName, episodeTitle) {
  const title = cleanDisplayText(vodName);
  if (!title) return "";
  const episode = cleanDisplayText(episodeTitle);
  if (!episode || episode === "正片" || episode === "播放") {
    return title;
  }
  const episodeNumber = extractEpisodeNumber(episode);
  if (episodeNumber) {
    return `${title} S01E${String(episodeNumber).padStart(2, "0")}`;
  }
  return title;
}

function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalName;
  }
  const prefix = mapping.episodeNumber ? `第${mapping.episodeNumber}集 ` : "";
  if (mapping.episodeName) {
    return `${prefix}${mapping.episodeName}`.trim();
  }
  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    const hit = scrapeData.episodes.find(
      (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber,
    );
    if (hit?.name) {
      return `${prefix}${hit.name}`.trim();
    }
  }
  return originalName;
}

function buildHistoryEpisode(playId, episodeNumber, episodeName) {
  if (episodeNumber !== undefined && episodeNumber !== null && episodeNumber !== "") {
    return `${playId || ""}@@${episodeNumber}`;
  }
  if (episodeName) {
    return `${playId || ""}@@${episodeName}`;
  }
  return playId || "";
}

function isCupfoxPlaceholderUrl(url) {
  const value = String(url || "").trim();
  if (!value) return true;
  if (!/^https?:\/\//i.test(value) && !/^\/\//.test(value) && !/^magnet:/i.test(value)) return true;
  return /baidu\.com\/404\.mp4/i.test(value)
    || /\/404\.mp4(?:$|[?#])/i.test(value)
    || /(?:^|[?&])code=403(?:$|&)/i.test(value)
    || /forbidden/i.test(value);
}

function mapVideoCard($, el) {
  const node = $(el);
  const href = node.find("a[href]").first().attr("href") || "";
  const title = decodeMaybeGarbled(normalizeText(node.find(".movie-title").first().text() || node.attr("title") || node.text()));
  const pic = node.find("img.movie-post").first().attr("src")
    || node.find(".movie-post-lazyload").first().attr("data-original")
    || node.find("img").first().attr("src")
    || "";
  const year = decodeMaybeGarbled(normalizeText(node.find(".movie-rating").first().text()));
  const remarks = decodeMaybeGarbled(normalizeText(node.find(".movie-item-note").first().text()));
  return {
    vod_id: absoluteUrl(href),
    vod_name: title,
    vod_pic: absoluteUrl(pic),
    vod_year: year,
    vod_remarks: remarks || year,
  };
}

function parseHomeList(htmlText) {
  const $ = cheerio.load(htmlText);
  const cards = $(".movie-list-body .movie-list-item, .movie-list-body2 .movie-list-item").toArray();
  const list = [];
  const seen = new Set();
  for (const el of cards) {
    const item = mapVideoCard($, el);
    if (!item.vod_id || !item.vod_name || seen.has(item.vod_id)) continue;
    seen.add(item.vod_id);
    list.push(item);
  }
  return list;
}

const DETAIL_INFO_KEYS = ["主演", "导演", "别名", "首播", "热度", "简介"];

function parseDetail(htmlText, detailUrl) {
  const $ = cheerio.load(htmlText);
  const resourceId = buildScrapeResourceId(detailUrl);
  let title = cleanDisplayText($(".movie-list-title").first().text());
  if (!title) {
    title = cleanDisplayText(String($("title").first().text() || "").replace(/在线观看.*$/, "").replace(/- 茶杯狐.*$/, ""));
  }
  const pic = absoluteUrl($(".a5-img").first().attr("src") || (resourceId ? `/uimg/${resourceId}.jpg` : ""));

  const infoData = {};
  const typeTags = [];
  const subjects = $(".movie-list-subject").toArray();
  for (const el of subjects) {
    const text = cleanDisplayText($(el).text());
    if (!text) continue;
    const match = text.match(/^(主演|导演|别名|首播|热度|简介)\s*[:：]\s*([\s\S]*)$/);
    if (match) {
      infoData[match[1]] = cleanDisplayText(match[2]);
      continue;
    }
    if (/^评分/.test(text)) continue;
    if (text === "在线播放" || text === "播放线路" || text.length > 10) continue;
    if ($(el).hasClass("play-btn") || $(el).hasClass("pbtn")) continue;
    typeTags.push(text);
  }

  const content = infoData["简介"] || cleanDisplayText($('meta[name="description"]').first().attr("content") || "");

  const episodes = [];
  $("span.play-btn").each((epIdx, el) => {
    const name = cleanDisplayText($(el).text()) || `第${epIdx + 1}集`;
    const slug = normalizeText($(el).attr("ep_slug") || "");
    if (!slug) return;
    const fid = `${resourceId}#${slug}`;
    const meta = {
      sid: detailUrl,
      fid,
      v: title || "",
      e: name,
      t: "在线播放",
      i: epIdx,
    };
    episodes.push({
      name,
      playId: `${detailUrl}|||${encodeMeta(meta)}`,
      _fid: fid,
      _rawName: name,
    });
  });

  const playSources = episodes.length ? [{ name: "在线播放", episodes }] : [];
  const normalizedPlaySources = playSources.map((source) => ({
    name: source.name,
    episodes: (source.episodes || []).map((ep) => ({ name: ep.name, playId: ep.playId })),
  }));

  return {
    list: [{
      vod_id: detailUrl,
      vod_name: title,
      vod_pic: pic,
      type_name: typeTags.join(" / "),
      vod_remarks: cleanDisplayText(infoData["首播"] || ""),
      vod_actor: formatPeopleText(infoData["主演"] || ""),
      vod_director: formatPeopleText(infoData["导演"] || ""),
      vod_content: content,
      vod_play_sources: normalizedPlaySources,
    }],
    _play_sources_for_scrape: playSources,
  };
}

async function home() {
  try {
    const html = await getCachedText("cupfox:home", LIST_CACHE_TTL, () => requestText(BASE_URL + "/"));
    const list = parseHomeList(html).slice(0, 40);
    await OmniBox.log("info", `[茶杯狐][home] list=${list.length}`);
    return {
      class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })),
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[茶杯狐][home] ${e.message}`);
    return { class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })), list: [] };
  }
}

async function category(params = {}) {
  try {
    const categoryId = String(params.categoryId || params.type_id || params.id || "movie");
    const page = Math.max(1, Number(params.page) || 1);
    const url = page === 1
      ? `${BASE_URL}/filter/?type=${encodeURIComponent(categoryId)}`
      : `${BASE_URL}/filter/?type=${encodeURIComponent(categoryId)}&page=${page}`;
    const html = await getCachedText(`cupfox:category:${categoryId}:${page}`, LIST_CACHE_TTL, () => requestText(url));
    const list = parseHomeList(html);
    await OmniBox.log("info", `[茶杯狐][category] category=${categoryId} page=${page} count=${list.length}`);
    return {
      page,
      pagecount: list.length ? page + 1 : page,
      total: page * list.length + (list.length ? 1 : 0),
      list: list.map((item) => ({ ...item, type_name: categoryNameById(categoryId) })),
    };
  } catch (e) {
    await OmniBox.log("error", `[茶杯狐][category] ${e.message}`);
    return { page: Number(params.page) || 1, pagecount: Number(params.page) || 1, total: 0, list: [] };
  }
}

async function detail(params = {}) {
  try {
    const videoId = absoluteUrl(params.videoId || params.id || params.vod_id || "");
    if (!videoId) return { list: [] };
    const html = await getCachedText(`cupfox:detail:${videoId}`, DETAIL_CACHE_TTL, () => requestText(videoId));
    const result = parseDetail(html, videoId);
    const vod = result.list?.[0];
    const resourceId = buildScrapeResourceId(videoId);
    const scrapePlaySources = Array.isArray(result._play_sources_for_scrape) ? result._play_sources_for_scrape : vod?.vod_play_sources || [];
    if (vod && Array.isArray(scrapePlaySources) && scrapePlaySources.length > 0) {
      let scrapeData = null;
      let videoMappings = [];
      const scrapeCandidates = [];
      for (const source of scrapePlaySources) {
        for (const ep of source.episodes || []) {
          const fid = ep._fid || decodeMeta(String(ep.playId || "").split("|||")[1] || "")?.fid || ep.playId;
          if (!fid) continue;
          scrapeCandidates.push({
            fid,
            file_id: fid,
            file_name: ep._rawName || ep.name || "正片",
            name: ep._rawName || ep.name || "正片",
            format_type: "video",
          });
        }
      }

      await OmniBox.log("info", `[茶杯狐][detail] 刮削候选 resourceId=${resourceId} count=${scrapeCandidates.length} preview=${scrapeCandidates.slice(0, 3).map((item) => `${item.fid}=>${item.file_name}`).join(" | ")}`);
      if (scrapeCandidates.length > 0 && typeof OmniBox.processScraping === "function" && typeof OmniBox.getScrapeMetadata === "function") {
        try {
          const scrapeKeyword = cleanDisplayText(vod.vod_name || "");
          const scrapingResult = await OmniBox.processScraping(resourceId, scrapeKeyword, scrapeKeyword, scrapeCandidates);
          await OmniBox.log("info", `[茶杯狐][detail] 刮削完成 resourceId=${resourceId} keyword=${scrapeKeyword} result=${JSON.stringify(scrapingResult || {}).slice(0, 200)}`);
          const metadata = await OmniBox.getScrapeMetadata(resourceId);
          scrapeData = metadata?.scrapeData || null;
          videoMappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
          await OmniBox.log("info", `[茶杯狐][detail] 刮削元数据 resourceId=${resourceId} hasScrapeData=${!!scrapeData} mappings=${videoMappings.length} scrapeType=${metadata?.scrapeType || ""}`);
        } catch (error) {
          await OmniBox.log("warn", `[茶杯狐][detail] 刮削失败 resourceId=${resourceId}: ${error.message}`);
        }
      }

      if (scrapeData) {
        vod.vod_name = scrapeData.title || vod.vod_name;
        if (scrapeData.posterPath) {
          vod.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
        }
        if (scrapeData.overview) {
          vod.vod_content = scrapeData.overview;
        }
      }

      for (const source of vod.vod_play_sources) {
        for (const ep of source.episodes || []) {
          const parts = String(ep.playId || "").split("|||");
          const meta = decodeMeta(parts[1] || "");
          const fid = meta?.fid;
          if (!fid) continue;
          const mapping = videoMappings.find((item) => item?.fileId === fid);
          if (!mapping) continue;
          const oldName = ep.name;
          const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
          if (newName && newName !== oldName) {
            ep.name = newName;
            await OmniBox.log("info", `[茶杯狐][detail] 应用刮削分集名 ${oldName} -> ${newName}`);
          }
          meta.e = ep.name;
          meta.s = mapping.seasonNumber;
          meta.n = mapping.episodeNumber;
          ep.playId = `${parts[0]}|||${encodeMeta(meta)}`;
        }
      }
    }
    await OmniBox.log("info", `[茶杯狐][detail] id=${videoId} sources=${result.list?.[0]?.vod_play_sources?.length || 0}`);
    return result;
  } catch (e) {
    await OmniBox.log("error", `[茶杯狐][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params = {}) {
  try {
    const wd = normalizeText(params.wd || params.keyword || params.key || "");
    const page = Math.max(1, Number(params.page) || 1);
    if (!wd) return { list: [] };
    const html = await getCachedText(
      `cupfox:search:v3:${wd}:${page}`,
      SEARCH_CACHE_TTL,
      () => requestText(`${BASE_URL}/search?q=${encodeURIComponent(wd)}`),
    );
    const list = page === 1 ? parseHomeList(html) : [];
    await OmniBox.log("info", `[茶杯狐][search] wd=${wd} page=${page} count=${list.length}`);
    return {
      page,
      pagecount: page,
      total: list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("warn", `[茶杯狐][search] ${e.message}`);
    return { page: Number(params.page) || 1, pagecount: Number(params.page) || 1, total: 0, list: [] };
  }
}

async function play(params = {}, context = {}) {
  try {
    let rawPlayId = String(params.id || params.playId || "");
    let playMeta = {};
    let vodName = "";
    let episodeName = "";

    if (rawPlayId.includes("|||")) {
      const [mainPlayId, metaB64] = rawPlayId.split("|||");
      rawPlayId = mainPlayId;
      playMeta = decodeMeta(metaB64 || "");
      vodName = playMeta.v || "";
      episodeName = playMeta.e || "";
      await OmniBox.log("info", `[茶杯狐][play] 解析透传信息 vod=${vodName} episode=${episodeName} fid=${playMeta.fid || ""}`);
    }

    const detailPageUrl = absoluteUrl(rawPlayId);
    if (!detailPageUrl) return { parse: 1, url: "", urls: [], header: {} };

    const fidParts = String(playMeta?.fid || "").split("#");
    const videoIdForApi = fidParts[0] || buildScrapeResourceId(detailPageUrl);
    const epSlug = fidParts[1] || "";

    const playInfoPromise = (async () => {
      if (videoIdForApi && epSlug) {
        const teaUrl = `${BASE_URL}/tea/${videoIdForApi}-${epSlug}`;
        try {
          const apiRes = await requestTextNative(teaUrl, {
            headers: {
              "User-Agent": UA,
              Referer: detailPageUrl,
              Accept: "application/json, text/plain, */*",
              "X-Requested-With": "XMLHttpRequest",
            },
          });
          const apiRaw = String(apiRes?.body || "");
          let apiJson = null;
          try {
            apiJson = JSON.parse(apiRaw);
          } catch (parseError) {
            await OmniBox.log("warn", `[茶杯狐][play] tea json parse failed: ${parseError.message} raw=${apiRaw.slice(0, 200)}`);
          }

          const plays = Array.isArray(apiJson?.video_plays) ? apiJson.video_plays : [];
          const urls = plays
            .map((item) => ({
              name: cleanDisplayText(item?.src_site) || "在线播放",
              url: String(item?.play_data || "").trim(),
            }))
            .filter((item) => item.url && !isCupfoxPlaceholderUrl(item.url));

          if (urls.length) {
            const finalHeaders = {
              "User-Agent": UA,
              Referer: detailPageUrl,
            };
            await OmniBox.log("info", `[茶杯狐][play] tea success lines=${urls.length} url=${urls[0].url}`);
            return {
              parse: 0,
              url: urls[0].url,
              urls,
              header: finalHeaders,
              headers: finalHeaders,
            };
          }
          await OmniBox.log("warn", `[茶杯狐][play] tea returned no direct url raw=${apiRaw.slice(0, 500)}`);
        } catch (apiError) {
          await OmniBox.log("warn", `[茶杯狐][play] tea request failed url=${teaUrl}: ${apiError.message}`);
        }
      } else {
        await OmniBox.log("warn", `[茶杯狐][play] 缺少 fid/ep_slug fid=${playMeta?.fid || ""} videoId=${videoIdForApi}`);
      }

      const fallbackHeaders = { "User-Agent": UA, Referer: detailPageUrl };
      return {
        parse: 1,
        url: detailPageUrl,
        urls: [{ name: "播放页", url: detailPageUrl }],
        header: fallbackHeaders,
        headers: fallbackHeaders,
      };
    })();

    const metadataPromise = (async () => {
      const result = {
        danmakuList: [],
        scrapeTitle: "",
        scrapePic: "",
        episodeNumber: playMeta?.n ?? null,
        episodeName: episodeName || "",
      };

      if (!playMeta?.fid || !vodName || typeof OmniBox.getScrapeMetadata !== "function") {
        await OmniBox.log("info", `[茶杯狐][play] 播放增强链路跳过 fid=${playMeta?.fid || ""} vod=${vodName || ""}`);
        return result;
      }

      try {
        const resourceId = buildScrapeResourceId(playMeta.sid || playMeta.fid.split("#")[0] || "");
        const metadata = await OmniBox.getScrapeMetadata(resourceId);
        if (!metadata || !metadata.scrapeData) {
          await OmniBox.log("info", `[茶杯狐][play] 播放增强链路跳过: metadata 不完整 resourceId=${resourceId} sid=${playMeta.sid || ""}`);
          return result;
        }

        result.scrapeTitle = metadata.scrapeData.title || "";
        if (metadata.scrapeData.posterPath) {
          result.scrapePic = `https://image.tmdb.org/t/p/w500${metadata.scrapeData.posterPath}`;
        }

        const mappings = Array.isArray(metadata.videoMappings) ? metadata.videoMappings : [];
        await OmniBox.log("info", `[茶杯狐][play] 播放增强元数据 resourceId=${resourceId} mappings=${mappings.length} fid=${playMeta.fid}`);
        const mapping = mappings.find((m) => m?.fileId === playMeta.fid);
        if (mapping) {
          if (mapping.episodeName) {
            result.episodeName = buildScrapedEpisodeName(metadata.scrapeData, mapping, result.episodeName || episodeName || "");
          }
          if (mapping.episodeNumber !== undefined && mapping.episodeNumber !== null) {
            result.episodeNumber = mapping.episodeNumber;
          }
        } else if (mappings.length > 0) {
          await OmniBox.log("info", `[茶杯狐][play] 播放增强未命中 mapping expected=${playMeta.fid} preview=${mappings.slice(0, 2).map((item) => `${item?.fileId || "<empty>"}=>${item?.episodeName || ""}`).join(" | ")}`);
        }

        vodName = result.scrapeTitle || vodName;
        episodeName = result.episodeName || episodeName;
        const danmakuFileName = buildDanmakuFileName(vodName, episodeName);
        if (danmakuFileName && typeof OmniBox.getDanmakuByFileName === "function") {
          const matchedDanmaku = await OmniBox.getDanmakuByFileName(danmakuFileName);
          const count = Array.isArray(matchedDanmaku) ? matchedDanmaku.length : 0;
          await OmniBox.log("info", `[茶杯狐][play] 弹幕匹配 fileName=${danmakuFileName} count=${count}`);
          if (count > 0) {
            result.danmakuList = matchedDanmaku;
          }
        }
      } catch (error) {
        await OmniBox.log("info", `[茶杯狐][play] 读取刮削元数据失败: ${error.message}`);
      }

      return result;
    })();

    const [playInfoResult, metadataResult] = await Promise.allSettled([playInfoPromise, metadataPromise]);
    if (playInfoResult.status !== "fulfilled") {
      throw playInfoResult.reason || new Error("播放主链路失败");
    }

    const playResult = playInfoResult.value || { urls: [], parse: 0, header: {} };
    let danmakuList = [];
    let scrapeTitle = "";
    let scrapePic = "";
    let episodeNumber = playMeta?.n ?? null;

    if (metadataResult.status === "fulfilled" && metadataResult.value) {
      danmakuList = metadataResult.value.danmakuList || [];
      scrapeTitle = metadataResult.value.scrapeTitle || "";
      scrapePic = metadataResult.value.scrapePic || "";
      if (metadataResult.value.episodeNumber !== undefined && metadataResult.value.episodeNumber !== null) {
        episodeNumber = metadataResult.value.episodeNumber;
      }
      episodeName = metadataResult.value.episodeName || episodeName;
      vodName = scrapeTitle || vodName;
    } else if (metadataResult.status === "rejected") {
      await OmniBox.log("info", `[茶杯狐][play] 播放增强链路失败(不影响播放): ${metadataResult.reason?.message || metadataResult.reason}`);
    }

    if (playMeta?.fid && context?.sourceId && typeof OmniBox.addPlayHistory === "function") {
      const videoIdForScrape = buildScrapeResourceId(playMeta.sid || playMeta.fid.split("#")[0] || "");
      const historyPayload = {
        vodId: videoIdForScrape,
        title: scrapeTitle || vodName || playMeta.v || "茶杯狐视频",
        pic: scrapePic || "",
        episode: buildHistoryEpisode(detailPageUrl, episodeNumber, episodeName),
        sourceId: context.sourceId,
        episodeNumber,
        episodeName: episodeName || "",
      };
      OmniBox.addPlayHistory(historyPayload)
        .then((added) => {
          if (added) {
            OmniBox.log("info", `[茶杯狐][play] 已添加播放记录: ${historyPayload.title}`);
          } else {
            OmniBox.log("info", `[茶杯狐][play] 播放记录已存在，跳过添加: ${historyPayload.title}`);
          }
        })
        .catch((error) => {
          OmniBox.log("info", `[茶杯狐][play] 添加播放记录失败: ${error.message}`);
        });
    } else {
      await OmniBox.log("info", `[茶杯狐][play] 跳过播放记录 sourceId=${context?.sourceId || ""} fid=${playMeta?.fid || ""} hasApi=${typeof OmniBox.addPlayHistory === "function"}`);
    }

    if (danmakuList.length > 0) {
      playResult.danmaku = danmakuList;
    }
    return playResult;
  } catch (e) {
    await OmniBox.log("error", `[茶杯狐][play] ${e.message}`);
    return { parse: 1, url: "", urls: [], header: {} };
  }
}
