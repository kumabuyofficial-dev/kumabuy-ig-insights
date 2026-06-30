const state = {
  account: "kumabuy.official",
  report: null
};

const els = {
  form: document.querySelector("#checkerForm"),
  accountInput: document.querySelector("#accountInput"),
  consentInput: document.querySelector("#consentInput"),
  refreshButton: document.querySelector("#refreshButton"),
  connectButton: document.querySelector("#connectButton"),
  exportButton: document.querySelector("#exportButton"),
  sourceLabel: document.querySelector("#sourceLabel"),
  totalReach: document.querySelector("#totalReach"),
  totalEngagement: document.querySelector("#totalEngagement"),
  totalMediaReach: document.querySelector("#totalMediaReach"),
  websiteClicks: document.querySelector("#websiteClicks"),
  reachChange: document.querySelector("#reachChange"),
  engagementRate: document.querySelector("#engagementRate"),
  dateRange: document.querySelector("#dateRange"),
  chart: document.querySelector("#chart"),
  insightsList: document.querySelector("#insightsList"),
  topContent: document.querySelector("#topContent"),
  recommendations: document.querySelector("#recommendations"),
  configBadge: document.querySelector("#configBadge"),
  windsorStatus: document.querySelector("#windsorStatus"),
  metaStatus: document.querySelector("#metaStatus"),
  toast: document.querySelector("#toast")
};

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!els.consentInput.checked) {
    showToast("請先確認只分析你提供或授權的 IG 資料。");
    return;
  }
  state.account = normalizeAccount(els.accountInput.value);
  els.accountInput.value = state.account;
  showToast(`已建立 ${state.account} 的初步檢測。`);
  loadReport();
});

els.refreshButton.addEventListener("click", () => {
  if (!els.consentInput.checked) {
    showToast("請先勾選資料使用同意，再產生報告。");
    return;
  }
  showToast("正在重新產生 IG 洞察報告。");
  loadReport();
});

els.exportButton.addEventListener("click", () => {
  if (!state.report) {
    showToast("報告尚未產生，請先按一次產生報告。");
    return;
  }
  downloadMarkdown(state.report);
});

els.connectButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/connect-instagram");
    const payload = await response.json();
    if (payload.authorizationUrl) {
      window.location.href = payload.authorizationUrl;
      return;
    }
    showToast(payload.message || "尚未設定 Meta OAuth，現在先使用 demo 模式。");
  } catch {
    showToast("本機預覽尚未啟用後端函式，正式部署後可串接 IG 授權。");
  }
});

loadReport();
loadConfigStatus();

async function loadReport() {
  setLoading();

  try {
    const response = await fetch(`/api/report?accountId=${encodeURIComponent(state.account)}`);
    if (!response.ok) throw new Error("API unavailable");
    renderReport(await response.json());
  } catch {
    renderReport(getLocalDemoReport());
    showToast("目前使用前端 demo 數據。部署到 Netlify 後可由後端讀取真實 IG 資料。");
  }
}

function renderReport(report) {
  state.report = report;
  const { summary } = report;
  els.sourceLabel.textContent = report.source === "connected" ? "已連接資料源" : "Demo 模式";
  els.totalReach.textContent = formatNumber(summary.totalReach);
  els.totalEngagement.textContent = formatNumber(summary.totalEngagement);
  els.totalMediaReach.textContent = formatNumber(summary.totalMediaReach);
  els.websiteClicks.textContent = formatNumber(summary.totalWebsiteClicks);
  els.reachChange.textContent = `${summary.reachChange >= 0 ? "+" : ""}${formatPercent(summary.reachChange)} vs 前期`;
  els.engagementRate.textContent = `${formatPercent(summary.engagementRate)} 互動率`;
  els.dateRange.textContent = `${report.dateFrom} - ${report.dateTo}`;

  renderChart(report.chart);
  renderInsights(report.insights);
  renderTopContent(report.topContent);
  renderRecommendations(report.recommendations);
}

async function loadConfigStatus() {
  if (!els.configBadge || !els.windsorStatus || !els.metaStatus) return;

  try {
    const response = await fetch("/api/config-status");
    if (!response.ok) throw new Error("Config status unavailable");
    const status = await response.json();

    els.configBadge.textContent = status.mode === "connected" ? "Connected ready" : "Demo ready";
    els.windsorStatus.textContent = status.windsor.configured
      ? "Configured"
      : "Missing WINDSOR_API_KEY / WINDSOR_API_URL";
    els.metaStatus.textContent = status.meta.configured
      ? "Configured"
      : "Missing META_CLIENT_ID / META_REDIRECT_URI";
  } catch {
    els.configBadge.textContent = "Status unavailable";
    els.windsorStatus.textContent = "Unable to check";
    els.metaStatus.textContent = "Unable to check";
  }
}

function downloadMarkdown(report) {
  const markdown = buildMarkdownReport(report);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${normalizeAccount(report.accountId || state.account)}-ig-report.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("已匯出 Markdown 報告。");
}

function buildMarkdownReport(report) {
  const summary = report.summary;
  const topContent = report.topContent
    .map((item, index) => `${index + 1}. ${item.date} ${item.type} - 觸及 ${formatNumber(item.reach)} / 互動 ${formatNumber(item.engagement)}\n   ${item.permalink}`)
    .join("\n");
  const insights = report.insights.map((item) => `- ${item}`).join("\n");
  const recommendations = report.recommendations.map((item) => `- ${item.title}: ${item.body}`).join("\n");

  return `# ${report.accountId || state.account} IG 數據洞察報告

期間：${report.dateFrom} - ${report.dateTo}
資料來源：${report.source === "connected" ? "已連接資料源" : "Demo / 初步資料"}

## 摘要

- 近 30 天觸及：${formatNumber(summary.totalReach)}
- 內容觸及：${formatNumber(summary.totalMediaReach)}
- 內容互動：${formatNumber(summary.totalEngagement)}
- 互動率：${formatPercent(summary.engagementRate)}
- 網站點擊：${formatNumber(summary.totalWebsiteClicks)}

## 洞察

${insights}

## 最佳內容

${topContent || "尚未取得內容資料。"}

## 建議

${recommendations}
`;
}

function renderChart(rows) {
  const max = Math.max(...rows.map((row) => row.reach), 1);
  els.chart.innerHTML = rows
    .map((row) => {
      const height = Math.max(4, Math.round((row.reach / max) * 100));
      return `<div class="bar" style="height:${height}%" data-label="${escapeHtml(row.date)}：${formatNumber(row.reach)}"></div>`;
    })
    .join("");
}

function renderInsights(items) {
  els.insightsList.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderTopContent(items) {
  els.topContent.innerHTML = items
    .map(
      (item, index) => `
        <article class="content-item">
          <header>
            <strong>#${index + 1} ${escapeHtml(item.type)} · ${escapeHtml(item.date)}</strong>
            <a href="${escapeAttribute(item.permalink)}" target="_blank" rel="noreferrer">開啟</a>
          </header>
          <p>${escapeHtml(trimText(item.caption, 88))}</p>
          <div class="content-stats">
            <span>觸及 ${formatNumber(item.reach)}</span>
            <span>互動 ${formatNumber(item.engagement)}</span>
            <span>收藏 ${formatNumber(item.saves)}</span>
            <span>分享 ${formatNumber(item.shares)}</span>
            <span>留言 ${formatNumber(item.comments)}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderRecommendations(items) {
  els.recommendations.innerHTML = items
    .map(
      (item) => `
        <article class="recommendation">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.body)}</p>
        </article>
      `
    )
    .join("");
}

function setLoading() {
  els.totalReach.textContent = "讀取中";
  els.totalEngagement.textContent = "讀取中";
  els.totalMediaReach.textContent = "讀取中";
  els.websiteClicks.textContent = "讀取中";
}

function normalizeAccount(value) {
  return (value || "kumabuy.official")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 3400);
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-TW").format(Math.round(value || 0));
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 1000) / 10}%`;
}

function trimText(text, length) {
  if (!text) return "尚未取得 caption。";
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function getLocalDemoReport() {
  return {
    generatedAt: new Date().toISOString(),
    source: "demo",
    accountId: state.account,
    dateFrom: "2026-05-30",
    dateTo: "2026-06-29",
    summary: {
      totalReach: 2657,
      totalMediaReach: 2554,
      totalEngagement: 293,
      engagementRate: 0.1147,
      totalProfileViews: 0,
      totalWebsiteClicks: 0,
      reachChange: 2.24
    },
    chart: [
      { date: "05/30", reach: 37 },
      { date: "06/03", reach: 8 },
      { date: "06/07", reach: 24 },
      { date: "06/08", reach: 56 },
      { date: "06/15", reach: 245 },
      { date: "06/17", reach: 890 },
      { date: "06/18", reach: 429 },
      { date: "06/24", reach: 199 },
      { date: "06/25", reach: 607 },
      { date: "06/26", reach: 82 },
      { date: "06/27", reach: 12 },
      { date: "06/28", reach: 5 }
    ],
    insights: [
      "近 30 天累積觸及約 2,657，觸及正在回升。",
      "最佳內容是 2026-06-17 的 REELS，觸及 1,394、互動 164。",
      "內容互動率約 11.5%，代表目前主題有明顯留言或收藏動機。",
      "本期可辨識內容中有 3 支 Reels，可優先用短影音做測試與放大。"
    ],
    topContent: [
      {
        date: "2026-06-17",
        type: "REELS",
        caption: "我們成功做了一套免費腳本生成器啦，做短影音必備 #ai工具應用 #ai行銷",
        permalink: "https://www.instagram.com/reel/DZrz7GlBfy1/",
        reach: 1394,
        engagement: 164,
        saves: 30,
        shares: 18,
        comments: 88,
        likes: 24
      },
      {
        date: "2026-06-25",
        type: "REELS",
        caption: "免費 IG 帳號檢測器測試版，未來會申請 IG 官方審核連動後台數據。",
        permalink: "https://www.instagram.com/reel/DZ_0YU4qxNQ/",
        reach: 857,
        engagement: 101,
        saves: 19,
        shares: 11,
        comments: 55,
        likes: 14
      }
    ],
    recommendations: [
      {
        title: "延伸表現最佳主題",
        body: "把「免費腳本生成器」拆成教學版、案例版、工具清單版，做成 3 支系列短影音。"
      },
      {
        title: "把 CTA 從留言延伸到轉換",
        body: "在個人檔案與貼文 CTA 補上明確下一步，例如免費檢測、腳本模板或私訊關鍵字。"
      },
      {
        title: "每週固定產出數據報告",
        body: "建議每週一自動整理觸及、互動、收藏、分享、留言與最佳內容。"
      }
    ]
  };
}
