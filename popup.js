document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const targetLangInput = document.getElementById('targetLang');
  const saveBtn = document.getElementById('saveBtn');
  const status = document.getElementById('status');

  // 加载已保存的设置
  chrome.storage.sync.get(['geminiApiKey', 'targetLang'], (result) => {
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
    }
    if (result.targetLang) {
      targetLangInput.value = result.targetLang;
    }
  });

  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const targetLang = targetLangInput.value.trim() || '中文';

    if (!apiKey) {
      status.textContent = '❌ 请输入 API Key';
      status.style.color = 'red';
      return;
    }

    chrome.storage.sync.set({ geminiApiKey: apiKey, targetLang }, () => {
      status.textContent = '✅ 设置已保存！刷新 QOJ 题目页面即可生效。';
      status.style.color = 'green';
    });
  });
});