'use strict';
document.getElementById('open').addEventListener('click', async () => {
  const status = document.getElementById('status');
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id) throw new Error('no-tab');
    await chrome.tabs.sendMessage(tab.id, {type:'TWITCH_ZH_OPEN'});
    window.close();
  } catch {
    status.textContent = '请先打开 Twitch 直播间并刷新页面，再点击此按钮。';
  }
});
