# Twitch 聊天汉化

一个轻量的 Google Chrome 扩展：自动将 Twitch 聊天消息翻译成简体中文，并在原消息位置显示。

- **用户名不翻译**，保留徽章、表情、链接和 @提及。
- 自动处理新消息；点击「暂停并还原」恢复当前页面原文。
- Chrome 本地翻译，不需要 API Key、不需要订阅、不需要运行本地服务器。
- 首次使用某种语言需要由你点击按钮，让 Chrome 下载语言包。
- 自动识别语言，也可指定英语、日语、韩语等。短消息识别不可靠时默认按英语处理；建议按直播间语言手动选择。

## 安装（Windows / Google Chrome）

普通使用者只需要 **Google Chrome 138 或以上版本**和下载语言包时的网络连接。无需安装 Node.js、Python、Git 或其他软件。

1. 在本仓库点击 **Code → Download ZIP**，解压到一个长期保留的文件夹。
2. 在 Chrome 地址栏输入 `chrome://extensions` 并回车。
3. 打开右上角 **开发者模式（Developer mode）**。
4. 点击 **加载已解压的扩展程序（Load unpacked）**。
5. 选择解压后的 **`extension` 文件夹**。这个文件夹内应直接有 `manifest.json`；不要选外层仓库文件夹或 ZIP 文件。
6. 打开 Twitch 直播间，或刷新已经打开的 Twitch 页面。
7. 点击页面右上方的 **「中 · 聊天汉化」**，选好消息语言，点击 **「开启翻译」**。
8. 首次下载请保持该 Twitch 页面打开，直到面板提示正在翻译。以后已启用的语言可自动恢复。

也可点击 Chrome 工具栏里的扩展图标，再点击「打开本页翻译面板」。模型下载必须在 Twitch 页面里点击按钮启动，工具栏弹窗不能代替这个步骤。

**尚未上架 Chrome 应用商店。** 这是可以检查完整源码的开发者模式版本。安装后不要移动或删除 `extension` 文件夹。更新代码后，在扩展管理页点重新加载，再刷新 Twitch 页面。

## 日常使用

- 默认输出为简体中文，文字替换发生在你自己的浏览器内，不会发送聊天消息，也不会修改其他观众看到的内容。
- 自动模式遇到尚未启用的语言时，消息会保留原文，面板出现该语言的下载按钮。每次点击只准备一种语言。
- 切换消息语言后，点击「开启翻译」应用。当前页面会先恢复原文，再按新语言翻译。
- 点击「暂停并还原」即可恢复当前页面消息。开关和语言偏好会在本机保存；其他已打开的标签页保持各自运行状态，刷新后读取保存的设置。
- 支持标准 Twitch 直播间、独立弹出聊天页面，以及具有兼容消息结构的录像聊天。第三方嵌入 iframe 和重写聊天 DOM 的第三方扩展不保证兼容。

## 隐私与权限

扩展只申请 `storage` 权限，内容脚本只在 `https://www.twitch.tv/*` 和 `https://twitch.tv/*` 运行。没有远程翻译请求、统计、账号、API 密钥或后台服务器。

消息由 Chrome 的本地 Translator API 处理。Chrome 首次下载模型需要网络；扩展不保存聊天记录。原文、翻译缓存仅在当前页面内存中存在，关闭页面即释放。`chrome.storage.local` 只保存开关和语言设置。

## 已知限制与排查

- **版本符合不代表语言包一定可用。** 浏览器策略、地区/网络、语言支持、磁盘空间等仍可能影响模型下载；错误会在面板显示。请先使用 Chrome 普通窗口、保持联网、重新点击「开启翻译」。
- 游戏俚语、拼写缩写、混合语言和极短消息可能误译，不能保证每一句的语义准确。可手动指定源语言。
- 消息中的链接文字和 @提及会保留原样。表情或链接分隔的正文会分段翻译，可能失去上下文。
- 热门聊天室消息过多时采用有限队列；超出处理能力的消息暂时保留原文，不阻塞聊天。
- Twitch 页面结构改变后可能需要更新选择器。本版本不翻译用户名、输入框、视频字幕、系统通知、私信和图片内容。
- 加载后没有按钮：确认选中了含 `manifest.json` 的 `extension` 文件夹，刷新 Twitch 页面，并检查扩展是否获准在 Twitch 上运行。
- 面板提示 API 不可用：检查 Chrome 版本及浏览器管理策略；本扩展不会自动切换到未公开或收费的翻译接口。

## 开发与测试

安装使用无需构建；`extension/` 即完整扩展源码。仅开发测试需要 Node.js 22+。

```sh
npm install
npx playwright install chromium
npm test
```

`tests/translator.test.cjs` 使用模拟的 Chrome 翻译 API 验证语言选择、缓存、错误和资源回收。`tests/browser.test.cjs` 在隔离浏览器中验证消息替换、动态追加、用户名/表情/链接保护、还原及异步结果过期处理。测试不会读取个人浏览器资料，也不会向真实 Twitch 发送消息。

自动化测试中的译文来自测试替身，不代表已验证实际语言模型的翻译质量。真实 Twitch 页面及 Chrome 模型下载仍需安装后的现场验证，详见 [手动验收清单](TESTING.md)。

## 实现依据

- [Chrome Translator API 官方文档](https://developer.chrome.com/docs/ai/translator-api)：桌面 Chrome 的本地翻译与按需模型下载。
- [Chrome i18n.detectLanguage](https://developer.chrome.com/docs/extensions/reference/api/i18n#method-detectLanguage)：消息语言识别。
- [Chrome 加载未打包扩展指南](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)。

本项目与 Twitch、Google 无隶属关系。采用 MIT 许可证。
