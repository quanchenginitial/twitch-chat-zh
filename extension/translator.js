/* Chrome's on-device Translator API. No network requests or external services. */
(() => {
  'use strict';

  const LANGUAGES = Object.freeze({
    ar: '阿拉伯语', bg: '保加利亚语', bn: '孟加拉语', cs: '捷克语',
    da: '丹麦语', de: '德语', el: '希腊语', en: '英语', es: '西班牙语',
    fi: '芬兰语', fr: '法语', he: '希伯来语', hi: '印地语', hr: '克罗地亚语',
    hu: '匈牙利语', id: '印度尼西亚语', it: '意大利语', ja: '日语',
    kn: '卡纳达语', ko: '韩语', lt: '立陶宛语', mr: '马拉地语',
    nl: '荷兰语', no: '挪威语', pl: '波兰语', pt: '葡萄牙语',
    ro: '罗马尼亚语', ru: '俄语', sk: '斯洛伐克语', sl: '斯洛文尼亚语',
    sv: '瑞典语', ta: '泰米尔语', te: '泰卢固语', th: '泰语',
    tr: '土耳其语', uk: '乌克兰语', vi: '越南语', zh: '简体中文',
    'zh-Hant': '繁体中文'
  });
  const CACHE_LIMIT = 500;
  const TRANSLATOR_LIMIT = 8;
  const TRANSLATION_TIMEOUT_MS = 20_000;
  const DOWNLOAD_INACTIVITY_MS = 120_000;
  const URL = /(?:https?:\/\/|www\.)\S+/giu;
  const LETTER = /\p{L}/u;
  const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const HANGUL = /\p{Script=Hangul}/u;
  const HAN = /\p{Script=Han}/u;
  const NON_HAN_LETTER = /[^\p{Script=Han}\p{N}\p{P}\p{S}\p{Z}\p{M}\p{Cf}\s]/u;
  const CYRILLIC = /\p{Script=Cyrillic}/u;

  function normaliseLanguage(language) {
    if (typeof language !== 'string') return '';
    const value = language.trim().replaceAll('_', '-');
    if (/^zh-(?:hant|tw|hk|mo)(?:-|$)/i.test(value)) return 'zh-Hant';
    if (/^zh(?:-|$)/i.test(value)) return 'zh';
    const base = value.toLowerCase().split('-')[0];
    return ({ iw: 'he', nb: 'no', nn: 'no', in: 'id' })[base] || base;
  }

  function skipText(text) {
    const withoutUrls = text.replace(URL, '').trim();
    if (!LETTER.test(withoutUrls)) return true;
    return HAN.test(withoutUrls) && !KANA.test(withoutUrls) &&
      !HANGUL.test(withoutUrls) && !NON_HAN_LETTER.test(withoutUrls);
  }

  function engineError(code, message, language, cause) {
    const error = new Error(message);
    error.code = code;
    if (language) error.language = language;
    if (cause) error.cause = cause;
    return error;
  }

  function create({ onStatus = () => {} } = {}) {
    const cache = new Map();
    const requests = new Map();
    const translators = new Map();
    const operations = new Set();
    let destroyed = false;
    let clock = 0;

    function status(value) {
      // A UI callback cannot make the translation pipeline fail.
      try { onStatus(value); } catch (_) { /* caller owns the UI */ }
    }

    function assertActive() {
      if (destroyed) throw engineError('DESTROYED', '翻译已停止，请重新启用。');
    }

    function api() {
      assertActive();
      if (!globalThis.Translator ||
          typeof globalThis.Translator.create !== 'function' ||
          typeof globalThis.Translator.availability !== 'function') {
        throw engineError('API_UNAVAILABLE',
          '当前 Chrome 无法使用本地翻译，请更新到桌面版 Chrome 138 或更高版本。');
      }
      return globalThis.Translator;
    }

    function errorStatus(error, language) {
      if (error.reported) return;
      error.reported = true;
      if (error.code === 'NEEDS_MODEL') {
        status({ type: 'needs-model', language });
      } else if (error.code !== 'DESTROYED') {
        status({ type: 'error', code: error.code, message: error.message, language });
      }
    }

    function convertError(error, language, phase) {
      if (error?.code && typeof error.code === 'string') return error;
      if (error?.name === 'NotAllowedError') {
        const policy = /permission.?policy/i.test(error.message || '');
        return engineError(policy ? 'UNAVAILABLE' : 'USER_GESTURE_REQUIRED',
          policy ? '此页面的权限策略不允许使用本地翻译。' :
            '请在 Twitch 页面点击下载语言包按钮，再继续翻译。', language, error);
      }
      if (error?.name === 'NotSupportedError') {
        return engineError('UNAVAILABLE',
          'Chrome 暂时无法使用此语言包，请检查浏览器、网络或稍后重试。', language, error);
      }
      if (error?.name === 'AbortError' && destroyed) {
        return engineError('DESTROYED', '翻译已停止。', language, error);
      }
      return engineError(phase === 'create' ? 'MODEL_FAILED' : 'TRANSLATION_FAILED',
        phase === 'create' ? '语言包准备失败，请检查网络后重试。' :
          '这条消息暂时无法翻译，已保留原文。', language, error);
    }

    function missingModel(language) {
      return engineError('NEEDS_MODEL',
        `请点击下载${LANGUAGES[language] || language}语言包后继续。`, language);
    }

    function runNative(start, { language, download = false, disposeLate } = {}) {
      assertActive();
      const controller = new AbortController();
      let timer;
      let settled = false;
      let cancelled = false;
      let rejectGate;
      const gate = new Promise((_, reject) => { rejectGate = reject; });
      // Cancellation can occur synchronously inside a native monitor callback.
      gate.catch(() => {});
      const cancel = (error) => {
        if (settled || cancelled) return;
        cancelled = true;
        // Race explicitly: some Chrome versions do not complete an aborted call.
        rejectGate(error);
        try { controller.abort(error); } catch (_) { /* race still rejects */ }
      };
      const touch = () => {
        if (settled || cancelled) return;
        clearTimeout(timer);
        timer = setTimeout(() => cancel(engineError(
          download ? 'MODEL_TIMEOUT' : 'TRANSLATION_TIMEOUT',
          download ? '语言包下载两分钟没有进展，请检查网络后重试。' :
            '这条消息翻译超时，已保留原文；后续消息将继续处理。', language)),
        download ? DOWNLOAD_INACTIVITY_MS : TRANSLATION_TIMEOUT_MS);
      };
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        operations.delete(cancel);
      };
      operations.add(cancel);
      touch();
      let nativePromise;
      try {
        // Invoke synchronously so prepare() retains the user's click activation.
        nativePromise = Promise.resolve(start(controller.signal, touch));
      } catch (error) {
        cleanup();
        throw error;
      }
      nativePromise.then((result) => {
        if ((cancelled || destroyed) && disposeLate) {
          try { disposeLate(result); } catch (_) { /* already disposed */ }
        }
      }, () => {});
      return Promise.race([nativePromise, gate]).finally(cleanup);
    }

    function evictIfNeeded() {
      if (translators.size < TRANSLATOR_LIMIT) return;
      let oldest;
      for (const [language, entry] of translators) {
        if (!entry.creating && !entry.busy &&
            (!oldest || entry.used < oldest[1].used)) oldest = [language, entry];
      }
      if (!oldest) {
        throw engineError('ENGINE_BUSY', '翻译引擎正在忙碌，请稍后重试。');
      }
      translators.delete(oldest[0]);
      oldest[1].disposed = true;
      try { oldest[1].translator?.destroy(); } catch (_) { /* already closed */ }
    }

    function getEntry(language, allowDownload) {
      const native = api();
      if (!Object.hasOwn(LANGUAGES, language)) {
        throw engineError('UNAVAILABLE', 'Chrome 尚不支持翻译这种语言。', language);
      }
      const existing = translators.get(language);
      if (existing) {
        existing.used = ++clock;
        existing.allowDownload ||= allowDownload;
        return existing;
      }
      evictIfNeeded();
      const entry = {
        translator: null, promise: null, creating: true, busy: 0,
        allowDownload, used: ++clock, disposed: false
      };
      translators.set(language, entry);
      const options = { sourceLanguage: language, targetLanguage: 'zh' };
      const initialise = async () => {
        if (!entry.allowDownload) {
          const availability = await native.availability(options);
          assertActive();
          if (availability === 'unavailable') {
            throw engineError('UNAVAILABLE', 'Chrome 暂时无法使用此语言包。', language);
          }
          if (availability !== 'available' && !entry.allowDownload) {
            throw missingModel(language);
          }
        }
        assertActive();
        status({ type: 'preparing', language });
        // In prepare(), this call happens before any await, preserving the click.
        const instance = await runNative((signal, touch) => native.create({
          ...options, signal,
          monitor(monitor) {
            monitor.addEventListener('downloadprogress', (event) => {
              if (destroyed || entry.disposed) return;
              const loaded = Number(event.loaded);
              if (!Number.isFinite(loaded)) return;
              touch();
              status({ type: 'progress', language,
                progress: Math.min(1, Math.max(0, loaded)) });
            });
          }
        }), { language, download: true, disposeLate: (model) => model.destroy() });
        if (destroyed || entry.disposed) {
          try { instance.destroy(); } catch (_) { /* already closed */ }
          throw engineError('DESTROYED', '翻译已停止。', language);
        }
        entry.translator = instance;
        entry.used = ++clock;
        status({ type: 'ready', language });
        return instance;
      };
      entry.promise = initialise().catch((error) => {
        entry.disposed = true;
        if (translators.get(language) === entry) translators.delete(language);
        const converted = convertError(error, language, 'create');
        errorStatus(converted, language);
        throw converted;
      }).finally(() => { entry.creating = false; });
      return entry;
    }

    async function detect(text) {
      // These scripts are unambiguous even when CLD rejects a short message.
      if (KANA.test(text)) return 'ja';
      if (HANGUL.test(text)) return 'ko';
      const detector = globalThis.chrome?.i18n?.detectLanguage;
      if (typeof detector === 'function') {
        try {
          const result = await detector.call(globalThis.chrome.i18n, text);
          const first = result?.languages?.[0];
          if (result?.isReliable && first && Number(first.percentage) >= 60) {
            const language = normaliseLanguage(first.language);
            if (language && language !== 'und') return language;
          }
        } catch (_) { /* short chat text can be undecidable; use the fallback */ }
      }
      if (CYRILLIC.test(text)) return /[іїєґ]/iu.test(text) ? 'uk' : 'ru';
      return 'en';
    }

    function remember(key, value) {
      cache.delete(key);
      cache.set(key, value);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }

    async function translateCore(text, source) {
      const language = source === 'auto' ? await detect(text) : source;
      assertActive();
      if (language === 'zh' || language === 'zh-Hant') return text;
      let entry;
      try {
        entry = getEntry(language, false);
      } catch (error) {
        const converted = convertError(error, language, 'create');
        errorStatus(converted, language);
        throw converted;
      }
      entry.busy += 1;
      try {
        const translator = await entry.promise;
        assertActive();
        let result;
        try {
          result = await runNative((signal) => translator.translate(text, { signal }), { language });
        } catch (error) {
          // Discard a broken session so the next message may recreate it.
          if (translators.get(language) === entry && entry.busy === 1) {
            translators.delete(language);
            entry.disposed = true;
            try { entry.translator?.destroy(); } catch (_) { /* already closed */ }
          }
          const converted = convertError(error, language, 'translate');
          errorStatus(converted, language);
          throw converted;
        }
        assertActive();
        if (typeof result !== 'string' || !result.trim()) {
          const error = engineError('TRANSLATION_FAILED',
            '翻译结果为空，已保留原文。', language);
          errorStatus(error, language);
          throw error;
        }
        return result.trim();
      } finally {
        entry.busy -= 1;
        entry.used = ++clock;
      }
    }

    return Object.freeze({
      async prepare(language = 'en') {
        const code = normaliseLanguage(language === 'auto' ? 'en' : language);
        try {
          const entry = getEntry(code, true);
          await entry.promise;
          assertActive();
          return true;
        } catch (error) {
          const converted = convertError(error, code, 'create');
          errorStatus(converted, code);
          throw converted;
        }
      },

      async ready(language = 'en') {
        const code = normaliseLanguage(language === 'auto' ? 'en' : language);
        if (!Object.hasOwn(LANGUAGES, code)) return false;
        const native = api();
        const entry = translators.get(code);
        if (entry?.translator && !entry.disposed) return true;
        return await native.availability({ sourceLanguage: code, targetLanguage: 'zh' }) === 'available';
      },

      async translate(text, source = 'auto') {
        assertActive();
        if (typeof text !== 'string') throw new TypeError('text must be a string');
        const core = text.trim();
        if (!core || skipText(core)) return text;
        const requested = source === 'auto' ? 'auto' : normaliseLanguage(source);
        const leading = text.match(/^\s*/u)[0];
        const trailing = text.match(/\s*$/u)[0];
        const key = `${requested}\u0000${core}`;
        if (cache.has(key)) {
          const value = cache.get(key);
          remember(key, value);
          return leading + value + trailing;
        }
        let pending = requests.get(key);
        if (!pending) {
          pending = translateCore(core, requested).then((result) => {
            assertActive();
            remember(key, result);
            return result;
          }).finally(() => {
            if (requests.get(key) === pending) requests.delete(key);
          });
          requests.set(key, pending);
        }
        return leading + await pending + trailing;
      },

      destroy() {
        if (destroyed) return;
        destroyed = true;
        for (const cancel of operations) {
          cancel(engineError('DESTROYED', '翻译已停止。'));
        }
        for (const entry of translators.values()) {
          entry.disposed = true;
          try { entry.translator?.destroy(); } catch (_) { /* already closed */ }
        }
        translators.clear();
        requests.clear();
        cache.clear();
      }
    });
  }

  globalThis.TwitchTranslator = Object.freeze({ LANGUAGES, create });
})();
