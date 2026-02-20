// background.js (service worker)
// 负责接收 content script 的请求，调用 Gemini API 进行翻译
// 这样做是因为 content script 中可能存在 CORS 限制
importScripts('vendor/katex/katex.min.js');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRANSLATE_PDF') {
    handleTranslation(message.pdfBase64, message.apiKey, message.targetLang)
      .then((result) => sendResponse({ success: true, html: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    // 返回 true 表示异步 sendResponse
    return true;
  }
});

async function handleTranslation(pdfBase64, apiKey, targetLang) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

  const prompt = `你是一个专业的算法竞赛题目翻译者。请将以下 PDF 中的算法竞赛题目完整翻译为${targetLang}。

要求：
1. 输出格式为 HTML 片段（不要包含 <html>/<head>/<body> 等外层标签，只需要内容部分）。
2. 保留题目的结构：题目名称、题目描述、输入格式、输出格式、样例输入输出、数据范围与约束、提示等。
3. 数学公式请使用 LaTeX 格式，用 \\( \\) 包裹行内公式，用 \\[ \\] 包裹行间公式。
4. 代码、变量名、函数名等保持原文不翻译。
5. 样例输入输出用 <pre><code> 标签包裹。
6. 请确保翻译准确、专业，符合算法竞赛的术语习惯。
7. 使用简洁美观的 HTML 排版，适当使用 <h3>、<p>、<ul>、<table> 等标签。`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'application/pdf',
              data: pdfBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens: 65536,
      thinkingConfig: {
        thinkingLevel: "low"
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API 请求失败 (${response.status}): ${errText}`);
  }

  const data = await response.json();

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Gemini API 未返回有效结果');
  }

  let html = data.candidates[0].content.parts
    .map((p) => p.text || '')
    .join('');

  // 清理 markdown 代码块包裹
  html = html.replace(/^```html\s*/i, '').replace(/```\s*$/i, '').trim();

  // 用 KaTeX 预渲染所有 LaTeX 公式为 HTML
  html = renderLatexInHtml(html);

  return html;
}

/**
 * 查找 HTML 字符串中的 LaTeX 公式并用 KaTeX 渲染为 HTML。
 * 支持：
 *   \( ... \)  → 行内公式
 *   \[ ... \]  → 行间公式
 *   $ ... $    → 行内公式（单 $）
 *   $$ ... $$  → 行间公式
 */
function renderLatexInHtml(html) {
  // 先处理 $$ ... $$（行间），再处理 $ ... $（行内），
  // 再处理 \[ ... \] 和 \( ... \)
  // 注意处理顺序很重要：先长匹配再短匹配

  // \[ ... \] → display mode
  html = html.replace(/\\\[([\s\S]*?)\\\]/g, (match, latex) => {
    return renderKatex(latex, true);
  });

  // \( ... \) → inline mode
  html = html.replace(/\\\(([\s\S]*?)\\\)/g, (match, latex) => {
    return renderKatex(latex, false);
  });

  // $$ ... $$ → display mode
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, latex) => {
    return renderKatex(latex, true);
  });

  // $ ... $ → inline mode（不匹配 $$ 和转义的 \$）
  html = html.replace(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+)\$/g, (match, latex) => {
    return renderKatex(latex, false);
  });

  return html;
}

function renderKatex(latex, displayMode) {
  try {
    return katex.renderToString(latex.trim(), {
      displayMode: displayMode,
      throwOnError: false,
      output: 'html',  // 纯 HTML 输出，不依赖 JS
      trust: true
    });
  } catch (e) {
    // 渲染失败时返回原始 LaTeX 文本
    const wrapper = displayMode ? 'div' : 'span';
    return `<${wrapper} style="color:#c00;font-family:monospace;">${escapeHtml(latex)}</${wrapper}>`;
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}