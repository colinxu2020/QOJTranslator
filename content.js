// content.js — 在 QOJ 题目页面上运行（ISOLATED world）
(async function () {
  'use strict';

  // 1. 检查是否在题目页面
  const urlMatch = window.location.pathname.match(/^\/problem\/(\d+)/);
  if (!urlMatch) return;

  const problemId = urlMatch[1];

  // 2. 找到 PDF iframe
  const pdfIframe = document.querySelector('#statements-pdf');
  if (!pdfIframe) return;

  // 3. 获取设置
  const settings = await new Promise((resolve) => {
    chrome.storage.sync.get(['geminiApiKey', 'targetLang'], resolve);
  });

  if (!settings.geminiApiKey) {
    alert('[QOJ翻译] 未设置 API Key，请点击插件图标进行设置。');
    return;
  }

  const targetLang = settings.targetLang || '中文';

  // 4. 注入 KaTeX CSS（通过 <link> 标签，引用扩展内的 CSS 文件）
  //    CSS 不受 script-src CSP 限制，只受 style-src 限制（通常允许）
  injectKatexCSS();

  // 5. 在 iframe 位置插入翻译按钮和容器
  const container = document.createElement('div');
  container.id = 'qoj-translator-container';
  container.innerHTML = `
    <div style="margin: 10px 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
      <button id="qoj-translate-btn" style="
        padding: 8px 20px;
        background: #4285f4;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">🌐 翻译题面</button>
      <button id="qoj-toggle-btn" style="
        padding: 8px 16px;
        background: #f0f0f0;
        color: #333;
        border: 1px solid #ccc;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        display: none;
      ">📄 显示原文 PDF</button>
      <span id="qoj-translate-status" style="font-size: 13px; color: #888;"></span>
    </div>
    <div id="qoj-translated-content" style="display: none;"></div>
  `;

  pdfIframe.parentNode.insertBefore(container, pdfIframe);

  const translateBtn = document.getElementById('qoj-translate-btn');
  const toggleBtn = document.getElementById('qoj-toggle-btn');
  const statusEl = document.getElementById('qoj-translate-status');
  const contentEl = document.getElementById('qoj-translated-content');

  let showingTranslation = false;

  translateBtn.addEventListener('click', async () => {
    translateBtn.disabled = true;
    translateBtn.textContent = '⏳ 翻译中...';
    statusEl.textContent = '正在下载 PDF...';

    try {
      // 6. 下载 PDF 并转为 base64
      const pdfUrl = `https://qoj.ac/download.php?type=statement&id=${problemId}`;
      const pdfResponse = await fetch(pdfUrl);

      if (!pdfResponse.ok) {
        throw new Error(`下载 PDF 失败: ${pdfResponse.status}`);
      }

      const pdfBlob = await pdfResponse.blob();
      const pdfBase64 = await blobToBase64(pdfBlob);

      statusEl.textContent = '正在调用 Gemini API 翻译...（这可能需要 10-30 秒）';

      // 7. 发送给 background.js
      //    background.js 会调用 Gemini API 并用 KaTeX 预渲染公式
      //    返回的 HTML 中公式已经是渲染好的静态 HTML，无需任何 JS 库
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'TRANSLATE_PDF',
            pdfBase64: pdfBase64,
            apiKey: settings.geminiApiKey,
            targetLang: targetLang
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
              resolve(response.html);
            } else {
              reject(new Error(response?.error || '翻译失败'));
            }
          }
        );
      });

      // 8. 显示翻译结果（公式已由 background.js 中的 KaTeX 预渲染）
      contentEl.innerHTML = `
        <div style="
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 24px 32px;
          margin: 10px 0;
          line-height: 1.8;
          font-size: 15px;
          color: #333;
        ">
          <div style="
            display: flex;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 2px solid #4285f4;
            color: #4285f4;
            font-size: 13px;
            font-weight: 500;
          ">🌐 由 Gemini 3 Flash 翻译 · 目标语言: ${targetLang}</div>
          ${result}
        </div>
      `;

      contentEl.style.display = 'block';
      pdfIframe.style.display = 'none';
      showingTranslation = true;

      translateBtn.textContent = '✅ 翻译完成';
      translateBtn.style.background = '#34a853';
      toggleBtn.style.display = 'inline-block';
      statusEl.textContent = '';
    } catch (err) {
      console.error('[QOJ翻译] 错误:', err);
      statusEl.textContent = `❌ 翻译失败: ${err.message}`;
      translateBtn.textContent = '🌐 重新翻译';
      translateBtn.disabled = false;
      translateBtn.style.background = '#4285f4';
    }
  });

  // 切换原文/翻译
  toggleBtn.addEventListener('click', () => {
    showingTranslation = !showingTranslation;
    if (showingTranslation) {
      contentEl.style.display = 'block';
      pdfIframe.style.display = 'none';
      toggleBtn.textContent = '📄 显示原文 PDF';
    } else {
      contentEl.style.display = 'none';
      pdfIframe.style.display = '';
      toggleBtn.textContent = '🌐 显示翻译';
    }
  });

  // ============================================================
  //  辅助函数
  // ============================================================

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 注入 KaTeX CSS。
   * <link> 标签加载 CSS 不受 script-src CSP 限制。
   * 字体文件通过 web_accessible_resources 暴露，
   * CSS 中的 @font-face url() 会正确解析为 chrome-extension:// URL。
   */
  function injectKatexCSS() {
    if (document.getElementById('qoj-katex-css')) return;
    const link = document.createElement('link');
    link.id = 'qoj-katex-css';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('vendor/katex/katex.min.css');
    document.head.appendChild(link);
  }
})();