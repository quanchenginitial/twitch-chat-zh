(() => {
  'use strict';
  if (document.getElementById('twitch-chat-zh-control')) return;
  const host = document.createElement('div');
  host.id = 'twitch-chat-zh-control';
  host.style.cssText = 'position:fixed;right:14px;top:64px;z-index:2147483640;';
  const shadow = host.attachShadow({mode: 'open'});
  // This template is static; chat text and translation results never enter HTML.
  shadow.innerHTML = `<style>
    :host{all:initial;color-scheme:dark}*{box-sizing:border-box}button,select{font:inherit}
    .wrap{font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:#efeff1}
    button{cursor:pointer;border:1px solid #705193;border-radius:8px;padding:7px 11px;background:#30243e;color:#fff}
    button:hover{background:#4e3566}button:focus-visible,select:focus-visible{outline:2px solid #ce9fff;outline-offset:2px}
    button:disabled{opacity:.6;cursor:wait}.pill{box-shadow:0 2px 12px #0005;font-weight:600}
    .panel{margin-top:8px;width:280px;background:#18151e;border:1px solid #574565;border-radius:12px;padding:16px;box-shadow:0 8px 30px #0008}
    [hidden]{display:none!important}h2{font-size:16px;margin:0 0 5px}p{margin:7px 0;color:#beb7c8}
    label{display:block;margin-top:12px}select{display:block;width:100%;margin:5px 0 12px;background:#29222f;color:#fff;border:1px solid #766282;border-radius:6px;padding:7px}
    .actions{display:flex;gap:8px;flex-wrap:wrap}.primary{background:#7240ad}.status{min-height:36px;color:#e7d8fb;overflow-wrap:anywhere}
    .foot{font-size:11px;border-top:1px solid #403447;padding-top:10px;margin-top:12px}.count{color:#a99bb5;font-size:12px}
  </style><div class="wrap">
    <button class="pill" id="toggle" aria-expanded="false" aria-controls="panel">中 · 聊天汉化</button>
    <section class="panel" id="panel" hidden aria-label="Twitch 聊天汉化设置">
      <h2>只翻译聊天消息</h2><p>中文原位显示，用户名和表情保留。</p>
      <label for="source">消息语言</label><select id="source"><option value="auto">自动识别（短句默认英语）</option></select>
      <div class="actions"><button id="start" class="primary">开启翻译</button><button id="stop">暂停并还原</button></div>
      <p id="status" class="status" role="status" aria-live="polite">首次开启会下载所需语言包。</p>
      <button id="download" hidden></button><p id="count" class="count">本页已翻译 0 段消息</p>
      <p class="foot">Chrome 本地翻译 · 不需要 API Key<br>首次下载请保持此页面打开。混合语言或俚语可能误译；可随时暂停还原。</p>
    </section></div>`;
  document.documentElement.append(host);
  const $ = id => shadow.getElementById(id);
  let settings = {enabled:false, source:'auto'};
  let translated = 0, generation = 0, busy = false, interacted = false;
  const pendingLanguages = new Set();
  const names = TwitchTranslator.LANGUAGES;
  for (const [code, name] of Object.entries(names)) {
    if (code.startsWith('zh')) continue;
    const option = document.createElement('option');
    option.value = code; option.textContent = name;
    $('source').append(option);
  }
  function say(text) { $('status').textContent = text; }
  function update() {
    $('toggle').textContent = !settings.enabled ? '中 · 聊天汉化' :
      pendingLanguages.size ? '中 · 有语言待启用' : '中 · 翻译中';
    $('start').disabled = busy;
    $('download').disabled = busy;
    $('source').disabled = busy;
    const next = pendingLanguages.values().next().value;
    $('download').hidden = !next || !settings.enabled;
    if (next) $('download').textContent = `启用${names[next] || next}翻译（下载语言包）`;
  }
  async function save() {
    try { await chrome.storage.local.set({twitchChatZh: settings}); }
    catch { say('设置未能保存。若刚更新插件，请刷新 Twitch 页面。'); }
  }
  const engine = TwitchTranslator.create({onStatus(event) {
    if (!busy && !settings.enabled) return;
    if (event.type === 'needs-model') {
      pendingLanguages.add(event.language);
      say(`遇到${names[event.language] || event.language}消息。点击下方按钮启用该语言。`);
    } else if (event.type === 'progress') {
      const value = event.progress ?? event.loaded ?? 0;
      say(`正在准备${names[event.language] || ''}语言包… ${Math.round(value * 100)}%`);
    }
    update();
  }});
  const chat = TwitchChatDOM.create({
    translate: text => engine.translate(text, settings.source),
    onStatus(event) {
      if (event.type === 'translated' && event.changed) $('count').textContent = `本页已翻译 ${++translated} 段消息`;
      if (event.type === 'error' && !pendingLanguages.size) say('部分消息未能翻译，已保留原文。可点击“开启翻译”重试。');
    }
  });
  async function activate(language, download = true) {
    const current = ++generation;
    busy = true; update();
    say(download ? '正在准备本地翻译；首次使用可能需要下载。' : '正在恢复翻译…');
    try {
      if (!download) {
        const ready = await engine.ready(language);
        if (current !== generation) return;
        if (!ready) {
          say('请点击“开启翻译”准备语言包。');
          return;
        }
      }
      await engine.prepare(language);
      if (current !== generation) return;
      pendingLanguages.delete(language);
      settings.enabled = true;
      chat.start(); chat.rescan();
      say('正在自动翻译新消息。暂停后会还原原文。');
      await save();
    } catch (error) {
      if (current === generation) say(error?.message || '翻译无法启动，请检查 Chrome 版本并重试。');
    } finally {
      if (current === generation) { busy = false; update(); }
    }
  }
  $('toggle').addEventListener('click', () => {
    $('panel').hidden = !$('panel').hidden;
    $('toggle').setAttribute('aria-expanded', String(!$('panel').hidden));
  });
  $('start').addEventListener('click', () => {
    interacted = true;
    activate(settings.source === 'auto' ? 'en' : settings.source);
  });
  $('download').addEventListener('click', () => {
    const language = pendingLanguages.values().next().value;
    if (language) activate(language);
  });
  $('stop').addEventListener('click', async () => {
    interacted = true;
    generation++; busy = false; settings.enabled = false;
    chat.stop(); pendingLanguages.clear(); update();
    say('已暂停，当前页面的消息已还原。'); await save();
  });
  $('source').addEventListener('change', async () => {
    interacted = true;
    generation++; chat.stop(); settings = {enabled:false, source:$('source').value};
    pendingLanguages.clear(); update();
    say('语言已更改，请点击“开启翻译”。'); await save();
  });
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== 'TWITCH_ZH_OPEN') return;
    $('panel').hidden = false;
    $('toggle').setAttribute('aria-expanded','true');
    reply({ok:true});
  });
  chrome.storage.local.get('twitchChatZh').then(async data => {
    if (interacted) return;
    if (data.twitchChatZh) {
      const stored = data.twitchChatZh;
      settings.source = stored.source === 'auto' || names[stored.source] ? stored.source : 'auto';
      $('source').value = settings.source;
      if (stored.enabled) await activate(settings.source === 'auto' ? 'en' : settings.source, false);
    }
    update();
  }).catch(() => say('请刷新 Twitch 页面以重新连接插件。'));
  // Do not destroy on pagehide: Chrome may restore this document from bfcache.
  // Normal document teardown releases the observers, translators and cache.
})();
