// 导入国际化 JSON 文件（合并模式）
import langJSON from "./index.json";

const DEFAULT_LANG = "zh-cn";

(function () {
  const $t = function (key, val, nameSpace) {
    const langPackage = $t[nameSpace];
    return (langPackage || {})[key] || val;
  };

  const $$t = function (val) {
    return val;
  };

  globalThis.$deepScan = function (val) {
    return val;
  };

  globalThis.$iS = function (val, args) {
    if (typeof val !== "string" || !Array.isArray(args)) {
      return val;
    }

    try {
      return val.replace(/\$(?:\{|\｛)(\d+)(?:\}|\｝)/g, (match, index) => {
        const position = parseInt(index, 10);
        return args[position] !== undefined ? String(args[position]) : match;
      });
    } catch (error) {
      console.warn("字符串替换过程出现异常:", error);
      return val;
    }
  };

  $t.locale = function (locale, nameSpace) {
    $t[nameSpace] = locale || {};
  };

  const currentTranslate =
    typeof globalThis.$t === "function" && typeof globalThis.$t.locale === "function"
      ? globalThis.$t
      : $t;

  globalThis.$t = currentTranslate;
  globalThis.$$t = $$t;
  globalThis._getJSONKey = function (key, insertJSONObj = {}) {
    const langObj = {};
    Object.keys(insertJSONObj || {}).forEach((value) => {
      langObj[value] = insertJSONObj[value]?.[key];
    });
    return langObj;
  };
})();

function getLangPackage(langKey, jsonKey = langKey) {
  const injectedLang = globalThis?.lang?.[langKey] || globalThis?.lang?.[jsonKey];
  return injectedLang || globalThis._getJSONKey(jsonKey, langJSON);
}

const langMap = {
  ja: getLangPackage("ja"),
  ko: getLangPackage("ko"),
  ru: getLangPackage("ru"),
  en: getLangPackage("en"),
  fr: getLangPackage("fr"),
  "zh-cn": getLangPackage("zh-cn"),
};
langMap.zhcn = langMap["zh-cn"];

globalThis.langMap = langMap;

function readStorage(key) {
  try {
    return globalThis?.localStorage?.getItem?.(key) || "";
  } catch {
    return "";
  }
}

function normalizeLang(lang) {
  if (lang === "zhcn") return DEFAULT_LANG;
  return langMap[lang] ? lang : DEFAULT_LANG;
}

function setLanguage(lang) {
  const normalizedLang = normalizeLang(lang);
  globalThis.$t.locale(langMap[normalizedLang], "lang");
  return normalizedLang;
}

setLanguage(readStorage("lang") || DEFAULT_LANG);

globalThis.$changeLang = (lang) => {
  return setLanguage(lang);
};
