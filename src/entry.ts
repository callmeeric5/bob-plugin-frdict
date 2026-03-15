import { load, CheerioAPI } from "cheerio";
import { api } from "@bob-plug/core";

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

      query.onCompletion({
        result: {
          toDict: dict,
          raw: { url }
        }
      });
    }
  });
}

function parseHtml(html: string, word: string) {
  const $ = load(html);
  const displayWord = normalizeText(word);

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
      name: "Prononciation",
      value: phoneticLine
    });
  }
  if (defs.length > 0) {
    additions.push({
      name: "Définition",
      value: defs.map((item) => `· ${item}`).join("\n")
    });
  }
  if (constructions.length > 0) {
    additions.push({
      name: "Constructions courantes",
      value: constructions.map((item) => `· ${item}`).join("\n")
    });
  }

  if (!displayWord && additions.length === 0 && phonetics.length === 0) {
    return null;
  }

  return {
    word: displayWord,
    phonetics,
    additions
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
