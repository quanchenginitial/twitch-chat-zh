'use strict';

// Local DOM tests use a deterministic fake translator. They never contact a
// translation service and do not prove the accuracy of a real translation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'chat.html'), 'utf8');
const contentScript = path.join(__dirname, '..', 'extension', 'chat-dom.js');
const controllerScript = path.join(__dirname, '..', 'extension', 'content.js');
let browser;

before(async () => {
  // chromium.launch creates a temporary, isolated browser profile. Never use
  // launchPersistentContext or attach these tests to the user's open browser.
  let executablePath = process.env.CHROME_PATH;
  if (!executablePath && !fs.existsSync(chromium.executablePath()) && process.platform === 'win32') {
    const installedChrome = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (fs.existsSync(installedChrome)) executablePath = installedChrome;
  }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});

after(async () => { await browser?.close(); });

async function setup(t, { mode = 'prefix', rows = ['plain'], result } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  t.after(() => context.close());
  // The fixture and script are loaded from disk. Block every network request.
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  await page.setContent(fixture);
  await page.evaluate(({ mode, rows, result }) => {
    for (const row of document.querySelectorAll('#messages > div')) {
      if (!rows.includes(row.id)) row.remove();
    }
    window.mockMode = mode;
    window.mockResult = result;
    window.translateCalls = [];
    window.translationStatuses = [];
    window.pendingTranslations = [];
  }, { mode, rows, result });
  await page.addScriptTag({ path: contentScript });
  await page.evaluate(() => {
    window.controller = TwitchChatDOM.create({
      translate(text) {
        window.translateCalls.push(text);
        if (window.mockMode === 'deferred') {
          return new Promise((resolve, reject) => window.pendingTranslations.push({ text, resolve, reject }));
        }
        if (window.mockMode === 'reject') return Promise.reject(new Error('Fixture service failure'));
        if (window.mockMode === 'constant') return Promise.resolve(window.mockResult);
        return Promise.resolve(`中译：${text}`);
      },
      onStatus(status) { window.translationStatuses.push(status); },
    });
    window.controller.start();
  });
  return page;
}

async function waitText(page, selector, expected) {
  await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent === expected, { selector, expected });
}

async function addMessage(page, { id, text, modern = false, username = 'NewViewer' }) {
  await page.evaluate(({ id, text, modern, username }) => {
    const row = document.createElement('div');
    row.id = id;
    row.className = 'chat-line__message';
    row.setAttribute('data-a-target', 'chat-line-message');
    const author = document.createElement('span');
    author.setAttribute('data-a-target', 'chat-message-username');
    author.textContent = username;
    const body = document.createElement('span');
    if (modern) body.setAttribute('data-a-target', 'chat-message-text');
    else body.className = 'text-fragment';
    body.textContent = text;
    row.append(author, body);
    document.querySelector('#messages').append(row);
  }, { id, text, modern, username });
}

test('translates existing message text while usernames, timestamps and non-chat content stay intact', async t => {
  const page = await setup(t, { rows: ['plain', 'legacy'] });
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  await waitText(page, '#legacy .text-fragment', '中译：Good morning');
  assert.equal(await page.locator('#plain [data-a-target="chat-message-username"]').textContent(), 'Alice_42');
  assert.equal(await page.locator('#legacy [data-a-target="chat-message-username"]').textContent(), 'LegacyName');
  assert.equal(await page.locator('.chat-line__timestamp').textContent(), '12:34');
  assert.equal(await page.locator('.chat-badge').getAttribute('alt'), 'Moderator');
  assert.equal(await page.locator('#outside').textContent(), 'This is not a chat message.');
  assert.deepEqual((await page.evaluate(() => window.translateCalls)).sort(), ['Good morning', 'Hello world']);
});

test('observes new chat messages, including direct modern message text', async t => {
  const page = await setup(t);
  await addMessage(page, { id: 'new-legacy', text: 'A new message' });
  await addMessage(page, { id: 'new-modern', text: 'Another message', modern: true });
  await waitText(page, '#new-legacy .text-fragment', '中译：A new message');
  await waitText(page, '#new-modern [data-a-target="chat-message-text"]', '中译：Another message');
  assert.equal(await page.locator('#new-modern [data-a-target="chat-message-username"]').textContent(), 'NewViewer');
});

test('disabling restores originals; re-enabling resumes translation without duplicating text', async t => {
  const page = await setup(t);
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  await page.evaluate(() => window.controller.setEnabled(false));
  await waitText(page, '#plain .text-fragment', 'Hello world');
  assert.equal(await page.locator('[data-tczh-translated]').count(), 0);
  await addMessage(page, { id: 'while-off', text: 'Posted while off' });
  assert.equal(await page.locator('#while-off .text-fragment').textContent(), 'Posted while off');
  await page.evaluate(() => window.controller.setEnabled(true));
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  await waitText(page, '#while-off .text-fragment', '中译：Posted while off');
  assert.equal(await page.locator('#plain [data-a-target="chat-message-username"]').textContent(), 'Alice_42');
});

test('preserves link, mention and emote nodes, attributes and message order', async t => {
  const page = await setup(t, { mode: 'deferred', rows: ['rich'] });
  const original = await page.evaluate(() => {
    window.richProtectedNodes = [...document.querySelectorAll('#rich a, #rich .mention-fragment, #rich img')];
    return window.richProtectedNodes.map(node => node.outerHTML);
  });
  await page.waitForFunction(() => window.pendingTranslations.length === 2);
  await page.evaluate(() => {
    for (const pending of window.pendingTranslations) pending.resolve(`中译：${pending.text}`);
  });
  await waitText(page, '#rich .text-fragment:first-child', '中译：Look here ');
  await waitText(page, '#rich .text-fragment:last-child', ' 中译：wow');
  const after = await page.evaluate(() => {
    const current = [...document.querySelectorAll('#rich a, #rich .mention-fragment, #rich img')];
    return { html: current.map(node => node.outerHTML), sameNodes: current.every((node, i) => node === window.richProtectedNodes[i]) };
  });
  assert.deepEqual(after.html, original);
  assert.equal(after.sameNodes, true);
  assert.equal(await page.locator('#rich [data-a-target="chat-message-text"]').textContent(), '中译：Look here this link@HelpfulUser 中译：wow');
  assert.deepEqual((await page.evaluate(() => window.translateCalls)).sort(), ['Look here', 'wow']);
});

test('keeps raw @mentions and URLs out of translation requests', async t => {
  const page = await setup(t, { rows: [] });
  await addMessage(page, { id: 'raw', text: 'Hello @Bob_123 visit https://example.invalid/a?q=1 now' });
  await waitText(page, '#raw .text-fragment', '中译：Hello @Bob_123 中译：visit https://example.invalid/a?q=1 中译：now');
  assert.deepEqual(await page.evaluate(() => window.translateCalls), ['Hello', 'visit', 'now']);
});

test('treats translation output as literal text, never HTML', async t => {
  const payload = '<img src=x onerror="window.injected=true"><script>window.injected=true</script>';
  const page = await setup(t, { mode: 'constant', result: payload });
  await waitText(page, '#plain .text-fragment', payload);
  assert.equal(await page.locator('#plain .text-fragment img, #plain .text-fragment script').count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
});

test('ignores an old translation when Twitch recycles a text node for a newer message', async t => {
  const page = await setup(t, { mode: 'deferred' });
  await page.waitForFunction(() => window.pendingTranslations.some(job => job.text === 'Hello world'));
  await page.evaluate(() => { document.querySelector('#plain .text-fragment').firstChild.nodeValue = 'Replacement message'; });
  await page.waitForFunction(() => window.pendingTranslations.some(job => job.text === 'Replacement message'));
  await page.evaluate(() => {
    window.pendingTranslations.find(job => job.text === 'Replacement message').resolve('新的消息');
  });
  await waitText(page, '#plain .text-fragment', '新的消息');
  await page.evaluate(async () => {
    window.pendingTranslations.find(job => job.text === 'Hello world').resolve('过时的消息');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(await page.locator('#plain .text-fragment').textContent(), '新的消息');
  await page.evaluate(() => window.controller.stop());
  await waitText(page, '#plain .text-fragment', 'Replacement message');
});

test('an in-flight result cannot overwrite chat after disabling translation', async t => {
  const page = await setup(t, { mode: 'deferred' });
  await page.waitForFunction(() => window.pendingTranslations.length === 1);
  await page.evaluate(async () => {
    window.controller.stop();
    window.pendingTranslations[0].resolve('不应该出现');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Hello world');
  assert.equal(await page.locator('[data-tczh-translated]').count(), 0);
});

test('restoring never overwrites a newer message edit made by Twitch', async t => {
  const page = await setup(t);
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  await page.evaluate(() => {
    document.querySelector('#plain .text-fragment').firstChild.nodeValue = 'Twitch changed this';
    window.controller.stop();
  });
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Twitch changed this');
});

test('failed translation leaves the original readable and an explicit rescan can retry', async t => {
  const page = await setup(t, { mode: 'reject' });
  await page.waitForFunction(() => window.translationStatuses.some(status => status.type === 'error'));
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Hello world');
  assert.equal(await page.locator('[data-tczh-translated]').count(), 0);
  await page.evaluate(() => {
    window.mockMode = 'prefix';
    window.controller.rescan();
  });
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
});

test('empty translation output preserves original text', async t => {
  const page = await setup(t, { mode: 'constant', result: '   ' });
  await page.waitForFunction(() => window.translationStatuses.some(status => status.type === 'error'));
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Hello world');
});

test('removed messages are not resurrected by late translation results', async t => {
  const page = await setup(t, { mode: 'deferred' });
  await page.waitForFunction(() => window.pendingTranslations.length === 1);
  await page.evaluate(async () => {
    document.querySelector('#plain').remove();
    window.pendingTranslations[0].resolve('已经离开聊天室');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(await page.locator('#messages > div').count(), 0);
  assert.equal(await page.locator('[data-tczh-translated]').count(), 0);
});

test('new nested text inside an existing message is discovered', async t => {
  const page = await setup(t);
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  await page.evaluate(() => {
    const nested = document.createElement('span');
    nested.id = 'nested';
    nested.textContent = 'Added nested content';
    document.querySelector('#plain .text-fragment').append(nested);
  });
  await waitText(page, '#nested', '中译：Added nested content');
});

test('retranslates when Twitch renders the same original over translated text', async t => {
  const page = await setup(t);
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  await page.evaluate(() => { document.querySelector('#plain .text-fragment').firstChild.nodeValue = 'Hello world'; });
  await page.waitForFunction(() => window.translateCalls.length === 2);
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
});

test('an intermediate blank edit invalidates an older translation of the same source', async t => {
  const page = await setup(t, { mode: 'deferred' });
  await page.waitForFunction(() => window.pendingTranslations.length === 1);
  await page.evaluate(async () => {
    const node = document.querySelector('#plain .text-fragment').firstChild;
    node.nodeValue = '';
    // Let MutationObserver process the blank state before Twitch reuses it.
    await new Promise(resolve => setTimeout(resolve, 0));
    node.nodeValue = 'Hello world';
  });
  await page.waitForFunction(() => window.pendingTranslations.length === 2);
  await page.evaluate(() => window.pendingTranslations[1].resolve('当前翻译'));
  await waitText(page, '#plain .text-fragment', '当前翻译');
  await page.evaluate(async () => {
    window.pendingTranslations[0].resolve('旧翻译');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(await page.locator('#plain .text-fragment').textContent(), '当前翻译');
});

test('a result from a previous enable cycle cannot replace the current translation', async t => {
  const page = await setup(t, { mode: 'deferred' });
  await page.waitForFunction(() => window.pendingTranslations.length === 1);
  await page.evaluate(() => {
    window.controller.stop();
    window.controller.start();
  });
  await page.waitForFunction(() => window.pendingTranslations.length === 2);
  await page.evaluate(() => window.pendingTranslations[1].resolve('重新开启后的翻译'));
  await waitText(page, '#plain .text-fragment', '重新开启后的翻译');
  await page.evaluate(async () => {
    window.pendingTranslations[0].resolve('上次开启时的翻译');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(await page.locator('#plain .text-fragment').textContent(), '重新开启后的翻译');
});

async function setupContent(t, options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  t.after(() => context.close());
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  t.after(() => assert.deepEqual(pageErrors, [], 'content script must not throw an uncaught error'));
  await page.setContent(fixture);
  await page.evaluate(options => {
    for (const row of document.querySelectorAll('#messages > div')) if (row.id !== 'plain') row.remove();
    if (options.text) document.querySelector('#plain .text-fragment').textContent = options.text;
    window.integration = {
      readyCalls: [], prepareCalls: [], translateCalls: [], storedWrites: [],
      pendingPrepares: [], runtimeListeners: [], prepared: new Set(),
    };
    window.chrome = {
      storage: { local: {
        get: () => options.deferredStorage
          ? new Promise(resolve => { window.integration.resolveStorage = resolve; })
          : Promise.resolve({ twitchChatZh: options.stored }),
        set: data => { window.integration.storedWrites.push(JSON.parse(JSON.stringify(data))); return Promise.resolve(); },
      } },
      runtime: { onMessage: { addListener: listener => window.integration.runtimeListeners.push(listener) } },
    };
    window.TwitchTranslator = {
      LANGUAGES: { en: '英语', fr: '法语', ja: '日语', zh: '中文', 'zh-Hant': '繁体中文' },
      create({ onStatus }) {
        window.integration.emitStatus = onStatus;
        return {
          async ready(language) {
            window.integration.readyCalls.push(language);
            if (options.deferredReady) {
              return new Promise(resolve => { window.integration.resolveReady = resolve; });
            }
            return options.ready !== false;
          },
          async prepare(language) {
            window.integration.prepareCalls.push({ language, userActivation: navigator.userActivation.isActive });
            if (options.prepareError) throw new Error(options.prepareError);
            if (options.deferredPrepare) {
              await new Promise((resolve, reject) => window.integration.pendingPrepares.push({ language, resolve, reject }));
            }
            window.integration.prepared.add(language);
          },
          async translate(text, source) {
            window.integration.translateCalls.push({ text, source });
            if (options.needsFrench && text === 'Bonjour' && !window.integration.prepared.has('fr')) {
              onStatus({ type: 'needs-model', language: 'fr' });
              throw new Error('Model needs a click to download');
            }
            return `中译：${text}`;
          },
        };
      },
    };
  }, options);
  await page.addScriptTag({ path: contentScript });
  await page.addScriptTag({ path: controllerScript });
  await page.locator('#twitch-chat-zh-control #toggle').waitFor();
  return page;
}

async function openPanel(page) {
  await page.locator('#twitch-chat-zh-control #toggle').click();
  await page.locator('#twitch-chat-zh-control #panel').waitFor({ state: 'visible' });
}

test('controller enables on a user click, saves state, and pause restores original messages', async t => {
  const page = await setupContent(t);
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Hello world');
  assert.deepEqual(await page.evaluate(() => window.integration.prepareCalls), []);
  await openPanel(page);
  await page.locator('#twitch-chat-zh-control #start').click();
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  assert.deepEqual(await page.evaluate(() => window.integration.prepareCalls), [{ language: 'en', userActivation: true }]);
  assert.equal(await page.locator('#plain [data-a-target="chat-message-username"]').textContent(), 'Alice_42');
  assert.equal(await page.locator('#twitch-chat-zh-control #count').textContent(), '本页已翻译 1 段消息');
  assert.equal(await page.locator('#twitch-chat-zh-control #toggle').textContent(), '中 · 翻译中');
  assert.equal(await page.evaluate(() => window.integration.storedWrites.at(-1).twitchChatZh.enabled), true);
  await page.locator('#twitch-chat-zh-control #stop').click();
  await waitText(page, '#plain .text-fragment', 'Hello world');
  assert.equal(await page.locator('#twitch-chat-zh-control #toggle').textContent(), '中 · 聊天汉化');
  assert.equal(await page.evaluate(() => window.integration.storedWrites.at(-1).twitchChatZh.enabled), false);
});

test('controller pause during delayed preparation prevents a later automatic restart', async t => {
  const page = await setupContent(t, { deferredPrepare: true });
  await openPanel(page);
  await page.locator('#twitch-chat-zh-control #start').click();
  await page.waitForFunction(() => window.integration.pendingPrepares.length === 1);
  assert.equal(await page.locator('#twitch-chat-zh-control #start').isDisabled(), true);
  await page.locator('#twitch-chat-zh-control #stop').click();
  await page.evaluate(async () => {
    window.integration.pendingPrepares[0].resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Hello world');
  assert.deepEqual(await page.evaluate(() => window.integration.translateCalls), []);
  assert.equal(await page.locator('#twitch-chat-zh-control #toggle').textContent(), '中 · 聊天汉化');
  assert.equal(await page.locator('#twitch-chat-zh-control #start').isEnabled(), true);
  assert.match(await page.locator('#twitch-chat-zh-control #status').textContent(), /已暂停/);
  assert.equal(await page.evaluate(() => window.integration.storedWrites.at(-1).twitchChatZh.enabled), false);
});

test('controller source change stops translation, restores text, and uses the selected language next time', async t => {
  const page = await setupContent(t);
  await openPanel(page);
  await page.locator('#twitch-chat-zh-control #start').click();
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  await page.locator('#twitch-chat-zh-control #source').selectOption('fr');
  await waitText(page, '#plain .text-fragment', 'Hello world');
  assert.equal(await page.locator('#twitch-chat-zh-control #toggle').textContent(), '中 · 聊天汉化');
  assert.deepEqual(await page.evaluate(() => window.integration.storedWrites.at(-1).twitchChatZh), { enabled: false, source: 'fr' });
  await page.locator('#twitch-chat-zh-control #start').click();
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  assert.equal(await page.evaluate(() => window.integration.prepareCalls.at(-1).language), 'fr');
  assert.equal(await page.evaluate(() => window.integration.translateCalls.at(-1).source), 'fr');
});

test('controller offers a missing-language download button and retries preserved original text after the click', async t => {
  const page = await setupContent(t, { text: 'Bonjour', needsFrench: true });
  await openPanel(page);
  await page.locator('#twitch-chat-zh-control #start').click();
  await page.locator('#twitch-chat-zh-control #download').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Bonjour');
  assert.match(await page.locator('#twitch-chat-zh-control #download').textContent(), /法语/);
  await page.locator('#twitch-chat-zh-control #download').click();
  await waitText(page, '#plain .text-fragment', '中译：Bonjour');
  assert.deepEqual(await page.evaluate(() => window.integration.prepareCalls.map(call => call.language)), ['en', 'fr']);
  assert.equal(await page.locator('#twitch-chat-zh-control #download').isHidden(), true);
  assert.equal(await page.evaluate(() => window.integration.translateCalls.length), 2);
});

test('controller resumes stored enabled state only after readiness check, without requesting a user gesture', async t => {
  const page = await setupContent(t, { stored: { enabled: true, source: 'fr' }, ready: true });
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  assert.deepEqual(await page.evaluate(() => window.integration.readyCalls), ['fr']);
  assert.deepEqual(await page.evaluate(() => window.integration.prepareCalls.map(call => call.language)), ['fr']);
  assert.equal(await page.locator('#twitch-chat-zh-control #panel').isHidden(), true);
  assert.equal(await page.locator('#twitch-chat-zh-control #source').inputValue(), 'fr');
  assert.equal(await page.locator('#twitch-chat-zh-control #toggle').textContent(), '中 · 翻译中');
});

test('controller keeps originals and waits for a click when a saved language is not ready', async t => {
  const page = await setupContent(t, { stored: { enabled: true, source: 'ja' }, ready: false });
  await page.waitForFunction(() => window.integration.readyCalls.length === 1);
  assert.deepEqual(await page.evaluate(() => window.integration.prepareCalls), []);
  assert.deepEqual(await page.evaluate(() => window.integration.translateCalls), []);
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Hello world');
  assert.match(await page.locator('#twitch-chat-zh-control #status').textContent(), /请点击“开启翻译”/);
  assert.equal(await page.locator('#twitch-chat-zh-control #toggle').textContent(), '中 · 聊天汉化');
  await openPanel(page);
  await page.locator('#twitch-chat-zh-control #start').click();
  await waitText(page, '#plain .text-fragment', '中译：Hello world');
  assert.equal(await page.evaluate(() => window.integration.prepareCalls.at(-1).language), 'ja');
});

test('controller shows unavailable-API errors and leaves original messages readable', async t => {
  const errorMessage = '当前 Chrome 不支持本地翻译，请升级 Chrome。';
  const page = await setupContent(t, { prepareError: errorMessage });
  await openPanel(page);
  await page.locator('#twitch-chat-zh-control #start').click();
  assert.equal(await page.locator('#twitch-chat-zh-control #status').textContent(), errorMessage);
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Hello world');
  assert.equal(await page.locator('#twitch-chat-zh-control #start').isEnabled(), true);
  assert.equal(await page.locator('#twitch-chat-zh-control #toggle').textContent(), '中 · 聊天汉化');
  assert.deepEqual(await page.evaluate(() => window.integration.translateCalls), []);
});

test('toolbar runtime message opens the existing settings panel without adding duplicate controls', async t => {
  const page = await setupContent(t);
  assert.equal(await page.locator('#twitch-chat-zh-control #panel').isHidden(), true);
  const reply = await page.evaluate(() => {
    let result;
    window.integration.runtimeListeners[0]({ type: 'TWITCH_ZH_OPEN' }, {}, value => { result = value; });
    return result;
  });
  assert.deepEqual(reply, { ok: true });
  assert.equal(await page.locator('#twitch-chat-zh-control #panel').isVisible(), true);
  await page.addScriptTag({ path: controllerScript });
  assert.equal(await page.locator('#twitch-chat-zh-control').count(), 1);
  assert.equal(await page.evaluate(() => window.integration.runtimeListeners.length), 1);
});

test('a late storage result cannot override the user pause', async t => {
  const page = await setupContent(t, { deferredStorage: true });
  await openPanel(page);
  await page.locator('#twitch-chat-zh-control #stop').click();
  await page.evaluate(async () => {
    window.integration.resolveStorage({ twitchChatZh: { enabled: true, source: 'fr' } });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.deepEqual(await page.evaluate(() => window.integration.readyCalls), []);
  assert.deepEqual(await page.evaluate(() => window.integration.prepareCalls), []);
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Hello world');
  assert.equal(await page.locator('#twitch-chat-zh-control #source').inputValue(), 'auto');
  assert.match(await page.locator('#twitch-chat-zh-control #status').textContent(), /已暂停/);
});

test('a late storage result cannot override a newly chosen source language', async t => {
  const page = await setupContent(t, { deferredStorage: true });
  await openPanel(page);
  await page.locator('#twitch-chat-zh-control #source').selectOption('ja');
  await page.evaluate(async () => {
    window.integration.resolveStorage({ twitchChatZh: { enabled: true, source: 'fr' } });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(await page.locator('#twitch-chat-zh-control #source').inputValue(), 'ja');
  assert.deepEqual(await page.evaluate(() => window.integration.prepareCalls), []);
  assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Hello world');
});

for (const readyResult of [true, false]) {
  test(`pause during a delayed readiness check ignores the later ${readyResult} result`, async t => {
    const page = await setupContent(t, { stored: { enabled: true, source: 'en' }, deferredReady: true });
    await page.waitForFunction(() => typeof window.integration.resolveReady === 'function');
    await openPanel(page);
    await page.locator('#twitch-chat-zh-control #stop').click();
    await page.evaluate(async readyResult => {
      window.integration.resolveReady(readyResult);
      await new Promise(resolve => setTimeout(resolve, 0));
    }, readyResult);
    assert.deepEqual(await page.evaluate(() => window.integration.prepareCalls), []);
    assert.deepEqual(await page.evaluate(() => window.integration.translateCalls), []);
    assert.equal(await page.locator('#plain .text-fragment').textContent(), 'Hello world');
    assert.equal(await page.locator('#twitch-chat-zh-control #start').isEnabled(), true);
    assert.match(await page.locator('#twitch-chat-zh-control #status').textContent(), /已暂停/);
  });
}

test('late model events while paused do not replace the paused status or reveal a download action', async t => {
  const page = await setupContent(t);
  await openPanel(page);
  await page.locator('#twitch-chat-zh-control #stop').click();
  await page.evaluate(() => {
    window.integration.emitStatus({ type: 'progress', language: 'en', progress: 0.5 });
    window.integration.emitStatus({ type: 'needs-model', language: 'fr' });
  });
  assert.match(await page.locator('#twitch-chat-zh-control #status').textContent(), /已暂停/);
  assert.equal(await page.locator('#twitch-chat-zh-control #download').isHidden(), true);
});

test('source-language menu omits Chinese variants that already meet the target language', async t => {
  const page = await setupContent(t);
  assert.equal(await page.locator('#twitch-chat-zh-control #source option[value="zh"]').count(), 0);
  assert.equal(await page.locator('#twitch-chat-zh-control #source option[value="zh-Hant"]').count(), 0);
});
