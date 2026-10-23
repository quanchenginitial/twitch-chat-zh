'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../extension/translator.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(options = {}) {
  const events = [];
  const created = [];
  const calls = [];
  const availability = [];
  const detected = [];
  let currentAvailability = options.availability || 'available';
  const context = {
    AbortController,
    setTimeout: options.timers?.setTimeout || setTimeout,
    clearTimeout: options.timers?.clearTimeout || clearTimeout,
    chrome: { i18n: { async detectLanguage(text) {
      detected.push(text);
      if (options.detect) return options.detect(text);
      return { isReliable: true, languages: [{ language: 'en', percentage: 99 }] };
    } } },
    Translator: options.noAPI ? undefined : {
      async availability(pair) {
        availability.push({ ...pair });
        return typeof currentAvailability === 'function' ? currentAvailability(pair) : currentAvailability;
      },
      create(config) {
        const instance = {
          destroyed: false,
          async translate(text, translateOptions) {
            calls.push({ language: config.sourceLanguage, text });
            return options.translate ? options.translate(text, config.sourceLanguage, translateOptions) : `译文：${text}`;
          },
          destroy() { this.destroyed = true; }
        };
        created.push({ config, instance });
        if (options.create) return options.create(config, instance);
        return Promise.resolve(instance);
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const engine = context.TwitchTranslator.create({ onStatus: (event) => events.push({ ...event }) });
  return { engine, events, created, calls, availability, detected, context,
    setAvailability(value) { currentAvailability = value; } };
}

test('explicit prepare starts create synchronously, targets zh, reports progress', async () => {
  const h = harness({ availability: 'downloadable', create(config, instance) {
    config.monitor({ addEventListener(name, callback) {
      assert.equal(name, 'downloadprogress');
      callback({ loaded: 0.5 });
    } });
    return Promise.resolve(instance);
  } });
  const preparing = h.engine.prepare();
  assert.equal(h.created.length, 1, 'create must be called before click activation can expire');
  assert.equal(h.created[0].config.sourceLanguage, 'en');
  assert.equal(h.created[0].config.targetLanguage, 'zh');
  await preparing;
  assert.equal(h.events.find((event) => event.type === 'progress').progress, 0.5);
  assert.equal(h.events.at(-1).type, 'ready');
  assert.equal(await h.engine.ready('en'), true);
});

test('automatic translation never creates or downloads a missing language pair', async () => {
  for (const availability of ['downloadable', 'downloading']) {
    const h = harness({ availability });
    await assert.rejects(h.engine.translate('Hello everyone'), (error) =>
      error.code === 'NEEDS_MODEL' && error.language === 'en');
    assert.equal(h.created.length, 0);
    assert.deepEqual(h.events, [{ type: 'needs-model', language: 'en' }]);
    await h.engine.prepare('en');
    assert.equal(await h.engine.translate('Hello everyone'), '译文：Hello everyone');
  }
});

test('ready checks availability with matching source and target options', async () => {
  const h = harness({ availability: 'downloadable' });
  assert.equal(await h.engine.ready('pt-BR'), false);
  h.setAvailability('available');
  assert.equal(await h.engine.ready('pt-BR'), true);
  assert.deepEqual(h.availability[0], { sourceLanguage: 'pt', targetLanguage: 'zh' });
  assert.equal(h.created.length, 0);
});

test('translation preserves surrounding whitespace and caches by trimmed source text', async () => {
  const h = harness();
  assert.equal(await h.engine.translate('  Hello\n'), '  译文：Hello\n');
  assert.equal(await h.engine.translate('\tHello  '), '\t译文：Hello  ');
  assert.equal(h.calls.length, 1);
  assert.equal(h.detected.length, 1);
});

test('identical concurrent requests share detection and one translation', async () => {
  const wait = deferred();
  const h = harness({ translate: () => wait.promise });
  const first = h.engine.translate('Hello friends');
  const second = h.engine.translate(' Hello friends ');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.length, 1);
  assert.equal(h.detected.length, 1);
  wait.resolve('大家好');
  assert.equal(await first, '大家好');
  assert.equal(await second, ' 大家好 ');
});

test('numbers, emoji, URLs and Chinese-only messages keep their original text', async () => {
  const h = harness({ noAPI: true });
  for (const text of ['  ', '12345! 🎉', 'https://example.com/a?x=1',
    'www.example.com', '中文消息！', '這是繁體中文。', '中文 123 🎉',
    '中文 https://example.com/path']) {
    assert.equal(await h.engine.translate(text), text);
  }
  assert.equal(h.calls.length, 0);
});

test('reliable CLD detection selects the language and normalizes locale tags', async () => {
  const h = harness({ detect: () => ({ isReliable: true,
    languages: [{ language: 'pt-BR', percentage: 98 }] }) });
  await h.engine.translate('Olá, tudo bem com vocês?');
  assert.equal(h.created[0].config.sourceLanguage, 'pt');
});

test('Japanese kana and Korean Hangul take precedence over uncertain detection', async () => {
  const h = harness();
  await h.engine.translate('今日はいい天気ですね');
  await h.engine.translate('안녕하세요');
  assert.deepEqual(h.created.map(({ config }) => config.sourceLanguage), ['ja', 'ko']);
  assert.equal(h.detected.length, 0);
});

test('low confidence defaults to English; Cyrillic uses Russian/Ukrainian fallback', async () => {
  const h = harness({ detect: () => ({ isReliable: false,
    languages: [{ language: 'fr', percentage: 80 }] }) });
  await h.engine.translate('nice');
  await h.engine.translate('привет');
  await h.engine.translate('привіт');
  assert.deepEqual(h.created.map(({ config }) => config.sourceLanguage), ['en', 'ru', 'uk']);
});

test('explicit language overrides detection and Chinese target sources are skipped', async () => {
  const h = harness();
  await h.engine.translate('Bonjour', 'fr');
  assert.equal(h.created[0].config.sourceLanguage, 'fr');
  assert.equal(h.detected.length, 0);
  assert.equal(await h.engine.translate('中文 mixed text', 'zh-Hans'), '中文 mixed text');
});

test('unsupported detected language is preserved by caller without attempting an English mistranslation', async () => {
  const h = harness({ detect: () => ({ isReliable: true,
    languages: [{ language: 'fa', percentage: 99 }] }) });
  await assert.rejects(h.engine.translate('سلام به همه'), (error) => error.code === 'UNAVAILABLE');
  assert.equal(h.created.length, 0);
});

test('missing browser API produces a clear typed error', async () => {
  const h = harness({ noAPI: true });
  await assert.rejects(h.engine.prepare(), (error) => error.code === 'API_UNAVAILABLE');
  assert.equal(h.events.at(-1).code, 'API_UNAVAILABLE');
});

test('unavailable pair produces an error and never calls create', async () => {
  const h = harness({ availability: 'unavailable' });
  await assert.rejects(h.engine.translate('Hello', 'en'), (error) => error.code === 'UNAVAILABLE');
  assert.equal(h.created.length, 0);
});

test('activation errors are actionable and a fresh prepare can retry', async () => {
  let fail = true;
  const h = harness({ create(config, instance) {
    if (fail) return Promise.reject(Object.assign(new Error('Requires a user gesture'),
      { name: 'NotAllowedError' }));
    return Promise.resolve(instance);
  } });
  await assert.rejects(h.engine.prepare(), (error) => error.code === 'USER_GESTURE_REQUIRED');
  assert.equal(h.events.filter((event) => event.type === 'error').length, 1);
  fail = false;
  await h.engine.prepare();
  assert.equal(h.created.length, 2);
});

test('translation failures do not enter cache; broken idle session is recreated', async () => {
  let fail = true;
  const h = harness({ translate: () => {
    if (fail) throw new Error('native model crashed');
    return '你好';
  } });
  await assert.rejects(h.engine.translate('Hello', 'en'), (error) => error.code === 'TRANSLATION_FAILED');
  assert.equal(h.created[0].instance.destroyed, true);
  fail = false;
  assert.equal(await h.engine.translate('Hello', 'en'), '你好');
  assert.equal(h.created.length, 2);
});

test('empty output is rejected instead of blanking a message', async () => {
  const h = harness({ translate: () => '   ' });
  await assert.rejects(h.engine.translate('Hello', 'en'), (error) => error.code === 'TRANSLATION_FAILED');
});

test('translation cache retains no more than 500 distinct entries', async () => {
  const h = harness();
  for (let index = 0; index <= 500; index += 1) {
    await h.engine.translate(`Message ${index}`, 'en');
  }
  await h.engine.translate('Message 500', 'en');
  assert.equal(h.calls.length, 501);
  await h.engine.translate('Message 0', 'en');
  assert.equal(h.calls.length, 502);
});

test('at most eight translators are kept; least recently used idle one is destroyed', async () => {
  const h = harness();
  for (const language of ['en', 'es', 'fr', 'de', 'ja', 'ko', 'pt', 'ru']) {
    await h.engine.prepare(language);
  }
  await h.engine.translate('Hello', 'en');
  await h.engine.prepare('it');
  assert.equal(h.created[0].instance.destroyed, false);
  assert.equal(h.created[1].instance.destroyed, true);
  assert.equal(h.created.filter(({ instance }) => !instance.destroyed).length, 8);
});

test('busy translators are never evicted and capacity errors can retry', async () => {
  const wait = deferred();
  const h = harness({ translate: () => wait.promise });
  const languages = ['en', 'es', 'fr', 'de', 'ja', 'ko', 'pt', 'ru'];
  const requests = languages.map((language) => h.engine.translate(`Message ${language}`, language));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(h.engine.prepare('it'), (error) => error.code === 'ENGINE_BUSY');
  assert.equal(h.created.some(({ instance }) => instance.destroyed), false);
  wait.resolve('译文');
  await Promise.all(requests);
  await h.engine.prepare('it');
  assert.equal(h.created.length, 9);
});

test('destroy closes native sessions and rejects outstanding translation results', async () => {
  const wait = deferred();
  const h = harness({ translate: () => wait.promise });
  const pending = h.engine.translate('Hello');
  await new Promise((resolve) => setImmediate(resolve));
  h.engine.destroy();
  assert.equal(h.created[0].instance.destroyed, true);
  wait.resolve('你好');
  await assert.rejects(pending, (error) => error.code === 'DESTROYED');
  await assert.rejects(h.engine.translate('Hello'), (error) => error.code === 'DESTROYED');
});

test('destroy during model preparation closes a later arriving native instance', async () => {
  const wait = deferred();
  let instance;
  const h = harness({ create(config, model) { instance = model; return wait.promise; } });
  const pending = h.engine.prepare('en');
  h.engine.destroy();
  wait.resolve(instance);
  await assert.rejects(pending, (error) => error.code === 'DESTROYED');
  assert.equal(instance.destroyed, true);
});

function fakeTimers() {
  let nextId = 0;
  let now = 0;
  const timers = new Map();
  return {
    setTimeout(callback, ms) { const id = ++nextId; timers.set(id, { callback, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now && timers.delete(id)) timer.callback();
      }
    },
    count() { return timers.size; }
  };
}

test('a hung native translation times out even if Chrome ignores abort, then queue can recover', async () => {
  const timers = fakeTimers();
  const wait = deferred();
  let signal;
  let hang = true;
  const h = harness({ timers, translate(_text, _language, options) {
    signal = options.signal;
    return hang ? wait.promise : '恢复正常';
  } });
  const pending = h.engine.translate('Hello', 'en');
  await new Promise((resolve) => setImmediate(resolve));
  timers.advance(20_000);
  await assert.rejects(pending, (error) => error.code === 'TRANSLATION_TIMEOUT');
  assert.equal(signal.aborted, true);
  assert.equal(timers.count(), 0);
  assert.equal(h.created[0].instance.destroyed, true);
  hang = false;
  assert.equal(await h.engine.translate('Hello', 'en'), '恢复正常');
  wait.resolve('迟到的旧翻译');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await h.engine.translate('Hello', 'en'), '恢复正常');
});

test('model download inactivity timeout resets on progress and destroys late completion', async () => {
  const timers = fakeTimers();
  const wait = deferred();
  let progress;
  let signal;
  let instance;
  const h = harness({ timers, create(config, model) {
    instance = model;
    signal = config.signal;
    config.monitor({ addEventListener(_name, callback) { progress = callback; } });
    return wait.promise;
  } });
  const pending = h.engine.prepare();
  timers.advance(100_000);
  progress({ loaded: 0.5 });
  timers.advance(100_000);
  assert.equal(signal.aborted, false);
  timers.advance(20_000);
  await assert.rejects(pending, (error) => error.code === 'MODEL_TIMEOUT');
  assert.equal(signal.aborted, true);
  assert.equal(timers.count(), 0);
  wait.resolve(instance);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(instance.destroyed, true);
});

test('destroy immediately rejects native calls that never respond and removes timers', async () => {
  const timers = fakeTimers();
  const h = harness({ timers, create: () => new Promise(() => {}) });
  const pending = h.engine.prepare();
  h.engine.destroy();
  await assert.rejects(pending, (error) => error.code === 'DESTROYED');
  assert.equal(timers.count(), 0);
});
