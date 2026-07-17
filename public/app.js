const state = {
  account: "kumabuy.official",
  industry: "自媒體行銷顧問",
  report: null
};

const els = {
  form: document.querySelector("#diagnosisForm"),
  accountInput: document.querySelector("#accountInput"),
  industryInput: document.querySelector("#industryInput"),
  consentInput: document.querySelector("#consentInput"),
  connectButton: document.querySelector("#connectButton"),
  exportButton: document.querySelector("#exportButton"),
  sourceLabel: document.querySelector("#sourceLabel"),
  configBadge: document.querySelector("#configBadge"),
  totalReach: document.querySelector("#totalReach"),
  engagementRate: document.querySelector("#engagementRate"),
  saveShareTotal: document.querySelector("#saveShareTotal"),
  websiteClicks: document.querySelector("#websiteClicks"),
  reachChange: document.querySelector("#reachChange"),
  chart: document.querySelector("#chart"),
  issues: document.querySelector("#issues"),
  topContent: document.querySelector("#topContent"),
  recommendations: document.querySelector("#recommendations"),
  toast: document.querySelector("#toast")
};

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!els.consentInput.checked) {
    showToast("請先確認你有權分析這個 Instagram 帳號。");
    return;
  }

  state.account = normalizeAccount(els.accountInput.value);
  state.industry = normalizeIndustry(els.industryInput.value);
  els.accountInput.value = state.account;
  els.industryInput.value = state.industry;
  loadReport();
});

els.connectButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/connect-data-source");
    const payload = await response.json();
    if (payload.authorizationUrl) {
      window.location.href = payload.authorizationUrl;
      return;
    }
    showToast(payload.message || "資料串接尚未開通。請先完成數據連接設定。");
  } catch {
    showToast("資料串接尚未開通。請先完成數據連接設定。");
  }
});

els.exportButton.addEventListener("click", () => {
  if (!state.report) {
    showToast("請先產生診斷報告。");
    return;
  }
  downloadMarkdown(state.report);
});

loadReport();
loadConfigStatus();

async function loadReport() {
  setLoading();

  const params = new URLSearchParams({
    accountId: state.account,
    industry: state.industry
  });

  try {
    const response = await fetch(`/api/report?${params.toString()}`);
    if (!response.ok) throw new Error("API unavailable");
    renderReport(await response.json());
  } catch {
    renderReport(getLocalPreviewReport());
    showToast("目前尚未連接實際數據，畫面顯示預覽報告結構。");
  }
}

async function loadConfigStatus() {
  try {
    const response = await fetch("/api/config-status");
    if (!response.ok) throw new Error("Config unavailable");
    const status = await response.json();
    els.configBadge.textContent = status.mode === "connected" ? "資料已連線" : "未連接數據";
    els.sourceLabel.textContent = status.mode === "connected" ? "已連接數據" : "未連接數據";
  } catch {
    els.configBadge.textContent = "未連接數據";
  }
}

function renderReport(report) {
  state.report = report;
  const { summary } = report;

  els.sourceLabel.textContent = report.source === "connected" ? "已連接數據" : "未連接數據";
  els.totalReach.textContent = formatNumber(summary.totalReach);
  els.engagementRate.textContent = formatPercent(summary.engagementRate);
  els.saveShareTotal.textContent = formatNumber(summary.totalSavesShares || 0);
  els.websiteClicks.textContent = formatNumber(summary.totalWebsiteClicks);
  els.reachChange.textContent = `${summary.reachChange >= 0 ? "+" : ""}${formatPercent(summary.reachChange)} vs 前期`;

  renderChart(report.chart);
  renderIssues(report.issues || []);
  renderTopContent(report.topContent || []);
  renderRecommendations(report.recommendations || []);
}

function renderChart(rows) {
  const cleanRows = rows.length ? rows : [{ date: "無資料", reach: 0 }];
  const max = Math.max(...cleanRows.map((row) => row.reach), 1);
  const points = cleanRows.map((row, index) => {
    const x = cleanRows.length === 1 ? 50 : (index / (cleanRows.length - 1)) * 100;
    const y = 88 - (row.reach / max) * 72;
    return `${x},${y}`;
  });

  const circles = cleanRows
    .map((row, index) => {
      const [x, y] = points[index].split(",");
      return `<circle cx="${x}" cy="${y}" r="1.35"><title>${escapeHtml(row.date)}：${formatNumber(row.reach)}</title></circle>`;
    })
    .join("");

  els.chart.innerHTML = `
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="觸及趨勢圖">
      <polyline fill="none" stroke="#04b8d7" stroke-width="1.2" points="${points.join(" ")}"></polyline>
      <polyline fill="rgba(4,184,215,0.12)" stroke="none" points="0,100 ${points.join(" ")} 100,100"></polyline>
      <g fill="#04b8d7">${circles}</g>
    </svg>
  `;
}

function renderIssues(items) {
  els.issues.innerHTML = items
    .map(
      (item) => `
        <article class="issue-card">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.body)}</p>
          <span class="impact">影響：${escapeHtml(item.impact)}</span>
        </article>
      `
    )
    .join("");
}

function renderTopContent(items) {
  els.topContent.innerHTML = items
    .map(
      (item, index) => `
        <article class="content-item">
          <header>
            <strong>${index + 1}. ${escapeHtml(item.type)} · ${escapeHtml(item.date)}</strong>
            <a href="${escapeAttribute(item.permalink)}" target="_blank" rel="noreferrer">查看</a>
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
  els.engagementRate.textContent = "讀取中";
  els.saveShareTotal.textContent = "讀取中";
  els.websiteClicks.textContent = "讀取中";
}

function downloadMarkdown(report) {
  const markdown = buildMarkdownReport(report);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${normalizeAccount(report.accountId || state.account)}-ig-growth-report.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("已匯出診斷報告。");
}

function buildMarkdownReport(report) {
  const summary = report.summary;
  const issues = report.issues.map((item) => `- ${item.title}: ${item.body}`).join("\n");
  const recommendations = report.recommendations.map((item) => `- ${item.title}: ${item.body}`).join("\n");

  return `# IG 成長診斷報告

帳號：${report.accountId || state.account}
行業別：${report.industry || state.industry}
期間：${report.dateFrom} - ${report.dateTo}

## 摘要

- 觸及：${formatNumber(summary.totalReach)}
- 互動率：${formatPercent(summary.engagementRate)}
- 收藏分享：${formatNumber(summary.totalSavesShares || 0)}
- 網站點擊：${formatNumber(summary.totalWebsiteClicks)}

## 主要問題

${issues}

## 改善建議

${recommendations}
`;
}

function normalizeAccount(value) {
  return (value || "kumabuy.official")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "");
}

function normalizeIndustry(value) {
  return (value || "一般服務業").trim().slice(0, 40);
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

function getLocalPreviewReport() {
  return {
    source: "preview",
    accountId: state.account,
    industry: state.industry,
    dateFrom: "2026-06-17",
    dateTo: "2026-07-17",
    summary: {
      totalReach: 2657,
      totalEngagement: 293,
      totalMediaReach: 2554,
      totalSavesShares: 83,
      engagementRate: 0.1147,
      totalWebsiteClicks: 0,
      reachChange: 2.24
    },
    chart: [
      { date: "06/17", reach: 890 },
      { date: "06/20", reach: 25 },
      { date: "06/24", reach: 199 },
      { date: "06/25", reach: 607 },
      { date: "06/28", reach: 5 },
      { date: "07/02", reach: 316 },
      { date: "07/09", reach: 420 },
      { date: "07/17", reach: 195 }
    ],
    issues: [
      {
        title: "受眾意圖不夠明確",
        body: `${state.industry} 的內容需要更快講清楚「適合誰、解決什麼問題、下一步怎麼做」。目前較像單篇資訊，轉換路徑不足。`,
        impact: "高"
      },
      {
        title: "收藏分享訊號不足",
        body: "需要增加清單、比較表、步驟圖與案例拆解，讓觀眾有保存與轉傳理由。",
        impact: "中"
      },
      {
        title: "導流動線偏弱",
        body: "內容 CTA 應從泛用留言改成明確行動，例如私訊關鍵字、預約表單、LINE 諮詢或案例頁。",
        impact: "高"
      }
    ],
    topContent: [
      {
        date: "2026-06-17",
        type: "REELS",
        caption: "免費腳本生成器，做短影音必備。",
        permalink: "https://www.instagram.com/reel/DZrz7GlBfy1/",
        reach: 1394,
        engagement: 164,
        saves: 30,
        shares: 18,
        comments: 88
      },
      {
        date: "2026-06-25",
        type: "REELS",
        caption: "免費 IG 帳號檢測器測試版。",
        permalink: "https://www.instagram.com/reel/DZ_0YU4qxNQ/",
        reach: 857,
        engagement: 101,
        saves: 19,
        shares: 11,
        comments: 55
      }
    ],
    recommendations: [
      {
        title: "內容主題改成行業問題導向",
        body: `下週先做 3 支「${state.industry} 常見錯誤」系列，開頭直接說痛點，結尾導向一個明確行動。`
      },
      {
        title: "補一個可保存內容格式",
        body: "每週至少 1 篇 checklist、對照表或案例拆解，提高收藏與分享，避免內容只被滑過。"
      },
      {
        title: "把 CTA 改成轉換動作",
        body: "每支 Reels 結尾只放一個 CTA，例如「私訊關鍵字：診斷」或「點 LINE 取得品牌評估」。"
      }
    ]
  };
}
