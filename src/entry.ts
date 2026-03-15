import { load, CheerioAPI } from "cheerio";
import { api } from "@bob-plug/core";

const OPTION_FRDIC_TOKEN = "frdic_token";
const OPTION_FRDIC_STUDYLIST_IDS = "frdic_studylist_ids";
const OPTION_FRDIC_ENABLE = "frdic_enable";
const DEFAULT_STUDYLIST_IDS = [0];

function supportLanguages() {
  return [
    "auto",
    "fr",
    "en",
    "zh",
    "zh-Hans",
    "zh-Hant",
    "zh-Hans-CN",
    "zh-Hant-TW",
    "zh-CN",
    "zh-TW",
    "zh-HK",
    "ja",
    "ko",
    "de",
    "es",
    "it",
    "pt",
    "nl",
    "ru",
    "ar",
    "tr",
    "pl",
    "sv",
    "no",
    "da",
    "fi",
    "cs",
    "el",
    "he",
    "hi",
    "th",
    "vi",
    "id"
  ];
}

function parseStudylistIds(raw: string | undefined) {
  if (!raw) {
    return DEFAULT_STUDYLIST_IDS.slice();
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_STUDYLIST_IDS.slice();
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const ids = parsed
          .map((item) => Number(item))
          .filter((num) => Number.isFinite(num) && num >= 0);
        return ids.length > 0 ? ids : DEFAULT_STUDYLIST_IDS.slice();
      }
    } catch (error) {
      api.$log.error(`Failed to parse studylist ids JSON: ${String(error)}`);
    }
  }

  const ids = trimmed
    .split(/[,\s]+/)
    .map((item) => Number(item))
    .filter((num) => Number.isFinite(num) && num >= 0);
  return ids.length > 0 ? ids : DEFAULT_STUDYLIST_IDS.slice();
}

function normalizeToken(token: string) {
  const trimmed = (token || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("NIS ")) {
    return trimmed;
  }
  if (trimmed.startsWith("NIS\t")) {
    return `NIS ${trimmed.slice(3).trim()}`;
  }
  return `NIS ${trimmed}`;
}

function formatHttpBody(resp) {
  const data = resp?.data;
  if (!data) {
    return "";
  }
  if (typeof data === "string") {
    return data;
  }
  if (typeof data?.toUTF8 === "function") {
    return data.toUTF8() || "";
  }
  try {
    return JSON.stringify(data);
  } catch (error) {
    return "";
  }
}

function buildContextLine(dict) {
  if (!dict || !Array.isArray(dict.additions)) {
    return "";
  }
  const definition = dict.additions.find((item) => item.name === "Definition");
  if (!definition || !definition.value) {
    return "";
  }
  const firstLine = String(definition.value)
    .split("\n")
    .map((line) => normalizeText(line.replace(/^·\s*/, "")))
    .find((line) => line);
  return firstLine ? clampLine(firstLine, 120) : "";
}

function isStudylistEnabled() {
  const enabled = api.getOption(OPTION_FRDIC_ENABLE);
  return enabled !== "0";
}

function appendNotice(dict, notice: string) {
  if (!notice) {
    return dict;
  }
  const additions = Array.isArray(dict.additions) ? dict.additions.slice() : [];
  additions.push({
    name: "frdict",
    value: notice
  });
  return { ...dict, additions };
}

function addToStudylist(word: string, dict): Promise<{ notice?: string }> {
  if (!isStudylistEnabled()) {
    return Promise.resolve({});
  }

  const tokenRaw = (api.getOption(OPTION_FRDIC_TOKEN) || "").trim();
  const token = normalizeToken(tokenRaw);
  if (!token) {
    return Promise.resolve({ notice: "Missing authorization token; cannot add to studylist." });
  }
  const ids = parseStudylistIds(api.getOption(OPTION_FRDIC_STUDYLIST_IDS));
  const contextLine = buildContextLine(dict);

  const body: Record<string, any> = {
    language: "fr",
    word,
    star: 2,
    category_ids: ids
  };
  if (contextLine) {
    body.context_line = contextLine;
  }
  const bodyJson = JSON.stringify(body);
  const bodyData = api.$data.fromUTF8(bodyJson);

  return api.$http
    .post({
      url: "https://api.frdic.com/api/open/v1/studylist/word/",
      header: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Authorization: token,
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8"
      },
      body: bodyData,
      timeout: 3000
    })
    .then((resp) => {
      const status = resp?.response?.statusCode;
      const bodyText = formatHttpBody(resp);
      if (status && status >= 400) {
        api.$log.error(`FRDic studylist request failed: ${status}; body: ${bodyText}`);
        if (status === 401 || status === 403) {
          return {
            notice: `failed to add to wordbook (HTTP ${status}). Check that the token includes the "NIS " prefix.`
          };
        }
        return { notice: `failed to add to wordbook (HTTP ${status}).` };
      }
      return { notice: "saved to wordbook" };
    })
    .catch((error) => {
      api.$log.error(`FRDic studylist request error: ${String(error)}`);
      return { notice: "failed to add to wordbook. Please try again later." };
    });

}

function translate(query) {
  const text = (query.text || "").replace(/\s+/g, " ").trim();
  if (!text) {
    query.onCompletion({
      error: {
        type: "param",
        message: "Empty query text."
      }
    });
    return;
  }

  const url = `https://www.le-dictionnaire.com/definition/${encodeURIComponent(text)}`;
  api.$http.get({
    url,
    header: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      Referer: "https://www.le-dictionnaire.com/"
    },
    handler: (resp) => {
      const html = resp.data;
      if (!html || typeof html !== "string") {
        query.onCompletion({
          error: {
            type: "network",
            message: "Empty response."
          }
        });
        return;
      }

      const dict = parseHtml(html, text);
      if (!dict) {
        query.onCompletion({
          error: {
            type: "parse",
            message: "No dictionary content found. The entry may not exist."
          }
        });
        return;
      }

      if (dict._hasEntry === false) {
        query.onCompletion({
          error: {
            type: "notFound",
            message: "word not found"
          }
        });
        return;
      }

      const shouldAddToStudylist = Boolean(dict && dict._hasEntry);

      if (!shouldAddToStudylist) {
        query.onCompletion({
          result: {
            toDict: dict,
            raw: { url }
          }
        });
        return;
      }

      addToStudylist(text, dict)
        .then((result) => {
          let finalDict = dict;
          if (result.notice) {
            finalDict = appendNotice(finalDict, result.notice);
          }
          query.onCompletion({
            result: {
              toDict: finalDict,
              raw: { url }
            }
          });
        })
        .catch((error) => {
          api.$log.error(`FRDic studylist unexpected error: ${String(error)}`);
          query.onCompletion({
            result: {
              toDict: dict,
              raw: { url }
            }
          });
        });
    }
  });
}

function parseHtml(html: string, word: string) {
  const $ = load(html);
  const displayWord = normalizeText(word);

  if (
    html &&
    (html.indexOf("Le mot exact n'a pas été trouvé") !== -1 ||
      html.indexOf("Aucun mot trouvé") !== -1)
  ) {
    return { word: displayWord, phonetics: [], additions: [], _hasEntry: false };
  }

  const phonetic = normalizeText($(".motboxinfo").first().text());
  const motCat = normalizeText($(".motboxcat").first().text());
  const phoneticLine = [phonetic, motCat].filter(Boolean).join(" / ");
  const phonetics = phonetic
    ? [
      {
        type: "fr",
        value: phoneticLine || phonetic
      }
    ]
    : [];

  const defbox = $(".defbox").first();
  const defs = defbox.length ? extractListItems($, defbox, 5) : [];

  const constructions = extractConstructions($, 5);

  const additions = [];
  if (phoneticLine) {
    additions.push({
      name: "Pronunciation",
      value: phoneticLine
    });
  }
  if (defs.length > 0) {
    additions.push({
      name: "Definition",
      value: defs.map((item) => `· ${item}`).join("\n")
    });
  }
  if (constructions.length > 0) {
    additions.push({
      name: "Common constructions",
      value: constructions.map((item) => `· ${item}`).join("\n")
    });
  }

  if (!displayWord && additions.length === 0 && phonetics.length === 0) {
    return null;
  }

  const hasEntry = Boolean(phoneticLine || defs.length > 0 || constructions.length > 0);

  return {
    word: displayWord,
    phonetics,
    additions,
    _hasEntry: hasEntry
  };
}

function extractListItems($: CheerioAPI, container, maxItems: number) {
  const items = container
    .find("li")
    .map((_, el) => normalizeText($(el).text()))
    .get()
    .filter((text) => text);
  if (items.length > 0) {
    return items.slice(0, maxItems);
  }

  const fallback = normalizeText(container.text())
    .split("\n")
    .map((line) => normalizeText(line))
    .filter((line) => line);
  return fallback.slice(0, maxItems);
}

function normalizeText(text: string) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function clampLine(text: string, maxLen: number) {
  if (text.length <= maxLen) {
    return text;
  }
  const clipped = text.slice(0, maxLen);
  const lastDot = clipped.lastIndexOf(".");
  if (lastDot > 60) {
    return clipped.slice(0, lastDot + 1);
  }
  return `${clipped}…`;
}

function extractConstructions($: CheerioAPI, maxItems: number) {
  const titles = $(".ld-motplus-h3")
    .map((_, el) => normalizeText($(el).text()))
    .get();
  const lists = $(".ld-motplus-list")
    .toArray()
    .map((el) => extractListItems($, $(el), maxItems));
  const count = Math.max(titles.length, lists.length);
  for (let i = 0; i < count; i += 1) {
    const title = titles[i] || "";
    if (title.toLowerCase().indexOf("constructions courantes") === -1) {
      continue;
    }
    return lists[i] || [];
  }
  return [];
}

exports.supportLanguages = supportLanguages;
exports.translate = translate;
