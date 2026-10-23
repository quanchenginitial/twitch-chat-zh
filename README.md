# Twitch Chat Chinese Translator · Twitch 聊天汉化

[English](#english) | [简体中文](#简体中文)

## English

A lightweight Google Chrome extension that automatically translates Twitch chat messages into Simplified Chinese and displays the translation in place of the original message text.

- **Usernames stay unchanged**, along with badges, emotes, links, and @mentions.
- New messages are processed automatically. Pause translation to restore the original text on the current page.
- Uses Chrome's on-device translation: no API key, subscription, or local server required.
- The first use of a language requires a button click to let Chrome download its language pack.
- Automatically detects the source language, with manual options such as English, Japanese, and Korean. Uncertain short messages generally fall back to English; selecting the chat's language manually can improve results.

The extension's controls are currently in Chinese. The instructions below include the exact labels and their English meanings.

### Installation (Windows / Google Chrome)

You only need **Google Chrome 138 or newer** and an internet connection to download language packs. Node.js, Python, Git, and other development tools are not required to use the extension.

1. Click **Code → Download ZIP** in this repository and extract the archive to a folder you intend to keep.
2. Enter `chrome://extensions` in Chrome's address bar.
3. Turn on **Developer mode** in the upper-right corner.
4. Click **Load unpacked**.
5. Select the extracted **`extension` folder**. It must contain `manifest.json` directly; do not select the outer repository folder or the ZIP file.
6. Open a Twitch stream or refresh an existing Twitch tab.
7. Click **「中 · 聊天汉化」** (Chinese chat translation) near the upper-right corner of the page, choose the message language, and click **「开启翻译」** (Enable translation).
8. Keep the Twitch page open during the first download until the panel reports that translation is running. Previously enabled languages can resume automatically when their models are ready.

You can also click the extension's Chrome toolbar icon and then **「打开本页翻译面板」** (Open this page's translation panel). Language-pack downloads must be started by clicking a button on the Twitch page; the toolbar popup cannot replace that step.

**This extension is not listed in the Chrome Web Store.** It is an unpacked extension with its full source available for inspection. Keep the `extension` folder in place after installation. After updating its files, reload the extension on Chrome's extensions page and refresh Twitch.

### Everyday use

- The output is Simplified Chinese. Replacements affect only your own browser; the extension does not send chat messages or change what other viewers see.
- In automatic mode, messages in a language that has not been enabled remain unchanged. The panel offers a button to prepare that language, one language per click.
- After changing the source language, click **「开启翻译」** (Enable translation). The page first restores the original messages, then translates them using the new setting.
- Click **「暂停并还原」** (Pause and restore) to restore messages on the current page. The enabled state and language preference are saved locally. Other open tabs keep their own running state and read the saved settings when refreshed.
- Designed for standard Twitch live chat, popout chat, and VOD chat with a compatible message structure. Third-party embedded iframes and extensions that replace Twitch's chat structure are not guaranteed to work.

### Privacy and permissions

The manifest's only explicit API permission is `storage`. It also declares content scripts that can read and modify page content on `https://www.twitch.tv/*` and `https://twitch.tv/*` to replace chat text. The extension makes no requests to remote translation services and includes no analytics, account system, API keys, or backend server.

Messages are processed by Chrome's on-device Translator API. Chrome needs a network connection for the initial model download. The extension does not persist chat history: original text and translation caches are kept only in the current page's memory and are released when the page is discarded. `chrome.storage.local` stores only the enabled state and language preference.

### Known limitations and troubleshooting

- **A supported Chrome version does not guarantee that every language pack is available.** Browser policies, region, network access, language support, and available disk space can affect downloads. Errors appear in the panel. Try a regular Chrome window, stay connected to the internet, and click **「开启翻译」** again.
- Gaming slang, abbreviations, mixed-language messages, and very short messages may be mistranslated. You can manually select the source language.
- Link text and @mentions stay unchanged. Text separated by emotes or links is translated in separate segments, which can lose context.
- Busy chats use a bounded queue. Messages beyond processing capacity remain in their original language so chat stays usable.
- Changes to Twitch's page structure may require selector updates. This version does not translate usernames, input fields, video captions, system notices, private messages, or text inside images.
- **No button after installation:** confirm that you loaded the `extension` folder containing `manifest.json`, refresh Twitch, and check that the extension is allowed to run on Twitch.
- **API unavailable:** check your Chrome version and browser management policies. The extension does not silently switch to an undocumented or paid translation service.

### Development and verification

No build step is required to install the extension; `extension/` contains all runtime files. Development tests require Node.js 22+.

```sh
npm install
npx playwright install chromium
npm test
```

`tests/translator.test.cjs` uses a mocked Chrome translation API to check language selection, caching, errors, and resource cleanup. `tests/browser.test.cjs` uses an isolated browser to check message replacement, new messages, protection of usernames/emotes/links, restoration, settings controls, and stale asynchronous results. The tests do not read personal browser profiles or send messages to Twitch.

**Verification status — October 23, 2026:** all 54 automated tests passed. The repository owner also installed the extension in Chrome and confirmed that it works in their Twitch session. This is a user-confirmed functional check, not a claim that every language or chat layout has been tested. Automated tests use simulated translations and do not measure the accuracy of Chrome's language models. See the [manual verification checklist (Chinese)](TESTING.md) for further checks.

### References and license

- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api): on-device translation and on-demand language-pack downloads.
- [Chrome i18n.detectLanguage](https://developer.chrome.com/docs/extensions/reference/api/i18n#method-detectLanguage): source-language detection.
- [Chrome's unpacked extension installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

This project is not affiliated with Twitch or Google. Licensed under the [MIT License](LICENSE).

---

## 简体中文

一个轻量的 Google Chrome 扩展：自动将 Twitch 聊天消息翻译成简体中文，并在原消息位置显示。

- **用户名不翻译**，保留徽章、表情、链接和 @提及。
- 自动处理新消息；点击「暂停并还原」恢复当前页面原文。
- Chrome 本地翻译，不需要 API Key、不需要订阅、不需要运行本地服务器。
- 首次使用某种语言需要由你点击按钮，让 Chrome 下载语言包。
- 自动识别语言，也可指定英语、日语、韩语等。短消息识别不可靠时通常按英语处理；建议按直播间语言手动选择。

扩展界面目前为中文。上方英文说明同时列出了实际中文按钮名称及其英文含义。

### 安装（Windows / Google Chrome）

普通使用者只需要 **Google Chrome 138 或以上版本**和下载语言包时的网络连接。无需安装 Node.js、Python、Git 或其他软件。

1. 在本仓库点击 **Code → Download ZIP**，解压到一个长期保留的文件夹。
2. 在 Chrome 地址栏输入 `chrome://extensions` 并回车。
3. 打开右上角 **开发者模式（Developer mode）**。
4. 点击 **加载已解压的扩展程序（Load unpacked）**。
5. 选择解压后的 **`extension` 文件夹**。这个文件夹内应直接有 `manifest.json`；不要选外层仓库文件夹或 ZIP 文件。
6. 打开 Twitch 直播间，或刷新已经打开的 Twitch 页面。
7. 点击页面右上方的 **「中 · 聊天汉化」**，选好消息语言，点击 **「开启翻译」**。
8. 首次下载请保持该 Twitch 页面打开，直到面板提示正在翻译。以后已启用的语言在模型就绪时可自动恢复。

也可点击 Chrome 工具栏里的扩展图标，再点击「打开本页翻译面板」。模型下载必须在 Twitch 页面里点击按钮启动，工具栏弹窗不能代替这个步骤。

**尚未上架 Chrome 应用商店。** 这是可以检查完整源码的开发者模式版本。安装后不要移动或删除 `extension` 文件夹。更新代码后，在扩展管理页点重新加载，再刷新 Twitch 页面。

### 日常使用

- 默认输出为简体中文，文字替换发生在你自己的浏览器内，不会发送聊天消息，也不会修改其他观众看到的内容。
- 自动模式遇到尚未启用的语言时，消息会保留原文，面板出现该语言的下载按钮。每次点击只准备一种语言。
- 切换消息语言后，点击「开启翻译」应用。当前页面会先恢复原文，再按新语言翻译。
- 点击「暂停并还原」即可恢复当前页面消息。开关和语言偏好会在本机保存；其他已打开的标签页保持各自运行状态，刷新后读取保存的设置。
- 面向标准 Twitch 直播间、独立弹出聊天页面，以及具有兼容消息结构的录像聊天设计。第三方嵌入 iframe 和重写聊天 DOM 的第三方扩展不保证兼容。

### 隐私与权限

扩展在 manifest 中显式声明的 API 权限只有 `storage`，另外通过内容脚本声明在 `https://www.twitch.tv/*` 和 `https://twitch.tv/*` 上读取和修改页面内容，以替换聊天文本。扩展不会请求远程翻译服务，也不包含统计、账号系统、API 密钥或后台服务器。

消息由 Chrome 的本地 Translator API 处理。Chrome 首次下载模型需要网络；扩展不持久保存聊天记录。原文、翻译缓存仅在当前页面内存中存在，页面被释放时一并释放。`chrome.storage.local` 只保存开关和语言设置。

### 已知限制与排查

- **版本符合不代表语言包一定可用。** 浏览器策略、地区/网络、语言支持、磁盘空间等仍可能影响模型下载；错误会在面板显示。请先使用 Chrome 普通窗口、保持联网、重新点击「开启翻译」。
- 游戏俚语、拼写缩写、混合语言和极短消息可能误译，不能保证每一句的语义准确。可手动指定源语言。
- 消息中的链接文字和 @提及会保留原样。表情或链接分隔的正文会分段翻译，可能失去上下文。
- 热门聊天室消息过多时采用有限队列；超出处理能力的消息暂时保留原文，不阻塞聊天。
- Twitch 页面结构改变后可能需要更新选择器。本版本不翻译用户名、输入框、视频字幕、系统通知、私信和图片内容。
- 加载后没有按钮：确认选中了含 `manifest.json` 的 `extension` 文件夹，刷新 Twitch 页面，并检查扩展是否获准在 Twitch 上运行。
- 面板提示 API 不可用：检查 Chrome 版本及浏览器管理策略；本扩展不会自动切换到未公开或收费的翻译接口。

### 开发与验证

安装使用无需构建；`extension/` 即完整扩展源码。仅开发测试需要 Node.js 22+。

```sh
npm install
npx playwright install chromium
npm test
```

`tests/translator.test.cjs` 使用模拟的 Chrome 翻译 API 验证语言选择、缓存、错误和资源回收。`tests/browser.test.cjs` 在隔离浏览器中验证消息替换、动态追加、用户名/表情/链接保护、还原、设置面板及异步结果过期处理。测试不会读取个人浏览器资料，也不会向真实 Twitch 发送消息。

**验证状态（2026 年 10 月 23 日）：** 54 项自动化测试全部通过；仓库所有者也已在 Chrome 中安装扩展，并确认它在自己的 Twitch 使用场景中正常运行。这是用户确认的功能验证，不代表所有语言和聊天布局均已测试。自动化测试中的译文来自测试替身，不衡量 Chrome 语言模型的实际翻译质量。更多检查步骤见 [手动验收清单](TESTING.md)。

### 实现依据与许可证

- [Chrome Translator API 官方文档](https://developer.chrome.com/docs/ai/translator-api)：桌面 Chrome 的本地翻译与按需模型下载。
- [Chrome i18n.detectLanguage](https://developer.chrome.com/docs/extensions/reference/api/i18n#method-detectLanguage)：消息语言识别。
- [Chrome 加载未打包扩展指南](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)。

本项目与 Twitch、Google 无隶属关系。采用 [MIT 许可证](LICENSE)。
