/* Twitch Chat 中文: edit only message text nodes, leaving Twitch's DOM structure intact. */
(() => {
  'use strict';

  const MESSAGE = '[data-a-target="chat-line-message"], .chat-line__message, .vod-message';
  const FRAGMENT = '.text-fragment, [data-a-target="chat-message-text"]';
  const PROTECTED = [
    'a', 'button', '[role="button"]', 'input', 'textarea', 'select',
    '[contenteditable]', 'script', 'style', 'svg',
    '[data-a-target="chat-message-username"]', '[data-a-target="chat-message-mention"]',
    '.chat-author__display-name', '.chat-author__intl-login', '.chat-line__username',
    '.mention-fragment', '.chat-message-mention', '.chat-badge', '.emote-container',
  ].join(', ');
  const MAX_QUEUE = 160;
  const MAX_RECORDS = 2000;
  const MAX_SOURCE_LENGTH = 2000;
  const CONCURRENCY = 3;

  function create({ translate, onStatus = () => {} } = {}) {
    if (typeof translate !== 'function') throw new TypeError('translate must be a function');

    let running = false;
    let epoch = 0;
    let active = 0;
    let observer = null;
    let scheduled = false;
    let queue = [];
    const records = new Map();
    const markers = new Map();
    const dirty = new Set();

    const status = (type, details = {}) => {
      try { onStatus({ type, ...details }); } catch (_) { /* Status UI must not break chat. */ }
    };

    function eligible(node) {
      if (!node || node.nodeType !== 3 || !node.isConnected || !node.parentElement) return null;
      const fragment = node.parentElement.closest(FRAGMENT);
      if (!fragment || !fragment.closest(MESSAGE) || node.parentElement.closest(PROTECTED)) return null;
      return fragment;
    }

    function unmark(record) {
      if (!record.marker) return;
      const element = record.marker;
      const count = (markers.get(element) || 1) - 1;
      if (count > 0) markers.set(element, count);
      else {
        markers.delete(element);
        element.removeAttribute('data-tczh-translated');
      }
      record.marker = null;
    }

    function restore(record) {
      // Never overwrite a newer Twitch/React edit with an older original.
      if (record.translated !== null && record.node.nodeValue === record.translated) {
        record.node.nodeValue = record.original;
      }
      record.translated = null;
      unmark(record);
    }

    function clean() {
      for (const [node, record] of records) {
        if (!eligible(node)) {
          restore(record);
          record.version++;
          records.delete(node);
        }
      }
    }

    function valid(job) {
      const record = job.record;
      return running && job.epoch === epoch && record.version === job.version &&
        records.get(record.node) === record && eligible(record.node) &&
        record.node.nodeValue === record.original;
    }

    async function translateText(job) {
      // Twitch generally puts one complete message in a text-fragment. Separate
      // fragments are translated separately so links/emotes retain their exact
      // positions. Plain-text URLs and @mentions are protected as well.
      const pieces = job.record.original.split(/(https?:\/\/[^\s<>]+|www\.[^\s<>]+|@[A-Za-z0-9_]{1,25}\b)/g);
      const output = [];
      for (let index = 0; index < pieces.length; index++) {
        const piece = pieces[index];
        if (index % 2 || !/[\p{L}\p{N}]/u.test(piece)) {
          output.push(piece);
          continue;
        }
        if (!valid(job)) return null;
        const content = piece.trim();
        const translated = await translate(content);
        if (!valid(job)) return null;
        if (typeof translated !== 'string' || !translated.trim() || translated.length > 16000) {
          throw new Error('Translation returned no usable text');
        }
        const leading = piece.match(/^\s*/u)[0];
        const trailing = piece.match(/\s*$/u)[0];
        output.push(leading + translated.trim() + trailing);
      }
      return output.join('');
    }

    function pump() {
      if (!running) return;
      while (active < CONCURRENCY && queue.length) {
        const job = queue.shift();
        if (!valid(job)) continue;
        active++;
        translateText(job).then((text) => {
          if (text === null || !valid(job)) return;
          const record = job.record;
          record.failed = false;
          if (text !== record.original) {
            record.translated = text;
            // Assigning nodeValue cannot turn service output into executable HTML.
            record.node.nodeValue = text;
            record.marker = eligible(record.node);
            markers.set(record.marker, (markers.get(record.marker) || 0) + 1);
            record.marker.setAttribute('data-tczh-translated', 'true');
          }
          status('translated', { changed: text !== record.original });
        }).catch(() => {
          if (valid(job)) {
            job.record.failed = true;
            status('error', { reason: 'translation-failed' });
          }
        }).finally(() => {
          active--;
          pump();
        });
      }
    }

    function consider(node) {
      if (!running) return;
      const fragment = eligible(node);
      if (!fragment) return;
      const text = node.nodeValue;
      let record = records.get(node);
      if (!record) {
        if (!text || !/[\p{L}\p{N}]/u.test(text) || text.length > MAX_SOURCE_LENGTH) return;
        if (records.size >= MAX_RECORDS) return;
        record = { node, original: text, translated: null, version: 0, attempted: -1, failed: false, marker: null };
        records.set(node, record);
      } else if (text === record.translated) {
        return; // Mutation caused by our own write.
      } else if (text !== record.original || record.translated !== null) {
        unmark(record);
        record.original = text;
        record.translated = null;
        record.failed = false;
        record.version++;
      }
      if (!text || !/[\p{L}\p{N}]/u.test(text) || text.length > MAX_SOURCE_LENGTH) return;
      if (record.attempted === record.version) return;
      if (queue.length >= MAX_QUEUE) {
        status('skipped', { reason: 'queue-full' });
        return; // Busy chat remains readable in its original language.
      }
      record.attempted = record.version;
      queue.push({ record, version: record.version, epoch });
      pump();
    }

    function scan(root) {
      if (!root || !root.isConnected) return;
      if (root.nodeType === 3) { consider(root); return; }
      if (root.nodeType !== 1) return;
      const fragments = [];
      if (root.matches(FRAGMENT) || root.closest(FRAGMENT)) fragments.push(root);
      fragments.push(...root.querySelectorAll(FRAGMENT));
      for (const fragment of fragments) {
        if (!fragment.closest(MESSAGE) || fragment.closest(PROTECTED)) continue;
        const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) consider(walker.currentNode);
      }
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      const scheduledEpoch = epoch;
      queueMicrotask(() => {
        if (scheduledEpoch !== epoch) return;
        scheduled = false;
        if (!running) return;
        clean();
        const roots = [...dirty];
        dirty.clear();
        for (const root of roots) scan(root);
      });
    }

    function start() {
      if (running) return;
      running = true;
      epoch++;
      const root = document.documentElement;
      if (!root) { running = false; return; }
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') dirty.add(mutation.target);
          else if (mutation.type === 'attributes') dirty.add(mutation.target);
          else {
            for (const added of mutation.addedNodes) dirty.add(added);
          }
        }
        schedule();
      });
      observer.observe(root, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'data-a-target'],
      });
      scan(root);
      status('started');
    }

    function stop() {
      running = false;
      epoch++;
      observer?.disconnect();
      observer = null;
      scheduled = false;
      dirty.clear();
      queue = [];
      for (const record of records.values()) restore(record);
      records.clear();
      markers.clear();
      status('stopped');
    }

    function rescan() {
      if (!running) return;
      clean();
      for (const record of records.values()) {
        if (record.failed) { record.failed = false; record.attempted = -1; }
      }
      scan(document.documentElement);
    }

    return Object.freeze({ start, stop, rescan, setEnabled: (enabled) => enabled ? start() : stop() });
  }

  globalThis.TwitchChatDOM = Object.freeze({ create });
})();
