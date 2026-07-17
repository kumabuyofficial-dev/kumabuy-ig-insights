const state = {
  account: "",
  industry: "",
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
  if (!state.account) {
    showToast("請先填寫 Instagram 帳號。");
    return;
  }
  state.industry = normalizeIndustry(els.industryInput.value);
  if (!state.industry) {
    showToast("請先選擇行業別 / 服務性質。");
    return;
  }
  els.accountInput.value = state.account;
  els.industryInput.value = state.industry;
  loadReport();
});

els.connectButton.addEventListener("click", async () => {
  state.account = normalizeAccount(els.accountInput.value);
  state.industry = normalizeIndustry(els.industryInput.value);
  if (!state.account) {
    showToast("請先填寫 Instagram 帳號。");
    return;
  }
  if (!state.industry) {
    showToast("請先選擇行業別 / 服務性質。");
    return;
  }

  try {
    const params = new URLSearchParams({
      accountId: state.account,
      industry: state.industry
    });
    const response = await fetch(`/api/connect-data-source?${params.toString()}`);
    const payload = await response.json();
    if (payload.authorizationUrl) {
      window.location.href = payload.authorizationUrl;
      return;
    }
    showToast(payload.message || "資料串接尚未開通，請先完成後台環境變數設定。");
  } catch {
    showToast("資料串接尚未開通，請先完成後台環境變數設定。");
  }
});

els.exportButton.addEventListener("click", () => {
  if (!state.report) {
    showToast("請先產生診斷報告。");
    return;
  }
  downloadMarkdown(state.report);
});

renderEmptyReportState();
loadConfigStatus();

async function loadReport() {
  setLoading();

  const params = new URLSearchParams({
    accountId: state.account,
    industry: state.industry
  });

  try {
    const response = await fetch(`/api/report?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) {
      renderDisconnectedState(payload.message || "目前尚未連接實際 Instagram 數據，請先完成數據連接設定。");
      return;
    }
    renderReport(payload);
  } catch {
    renderDisconnectedState("目前無法讀取 Instagram 數據，請確認數據連接與後台設定。");
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

function renderDisconnectedState(message) {
  state.report = null;
  els.sourceLabel.textContent = "未連接數據";
  els.configBadge.textContent = "未連接數據";
  els.totalReach.textContent = "未連接";
  els.engagementRate.textContent = "未連接";
  els.saveShareTotal.textContent = "未連接";
  els.websiteClicks.textContent = "未連接";
  els.reachChange.textContent = "完成數據連接後才會分析";
  els.chart.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  els.issues.innerHTML = `
    <article class="issue-card empty-card">
      <strong>尚未取得帳號實際數據</strong>
      <p>主要問題與改善方向必須依照該 Instagram 帳號的觸及、互動、收藏、分享、留言與導流資料產生。完成數據連接後，系統才會輸出診斷。</p>
      <span class="impact">狀態：待連接</span>
    </article>
  `;
  els.topContent.innerHTML = `
    <article class="content-item empty-card">
      <strong>尚未取得內容成效排行</strong>
      <p>連接 Instagram 數據後，這裡會依實際貼文或 Reels 的觸及、互動、收藏、分享與留言排序。</p>
    </article>
  `;
  els.recommendations.innerHTML = `
    <article class="recommendation empty-card">
      <strong>尚未產生下週行動清單</strong>
      <p>行動清單會在取得帳號資料後，依照業主行業別、內容表現與導流狀況產生，不使用預設示範內容。</p>
    </article>
  `;
  showToast(message);
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

function renderEmptyReportState() {
  els.totalReach.textContent = "尚未產生";
  els.engagementRate.textContent = "尚未產生";
  els.saveShareTotal.textContent = "尚未產生";
  els.websiteClicks.textContent = "尚未產生";
  els.reachChange.textContent = "請先選擇行業並產生診斷";
  els.chart.innerHTML = `<div class="empty-state">請填寫 Instagram 帳號、選擇行業別，並完成數據連接後產生診斷。</div>`;
  els.issues.innerHTML = `
    <article class="issue-card empty-card">
      <strong>尚未產生診斷</strong>
      <p>這裡只會顯示該帳號實際數據分析後的主要問題，不顯示預設示範內容。</p>
      <span class="impact">狀態：待分析</span>
    </article>
  `;
  els.topContent.innerHTML = `
    <article class="content-item empty-card">
      <strong>尚未取得內容排行</strong>
      <p>完成數據連接後，會列出該帳號近 30 天表現最好的內容。</p>
    </article>
  `;
  els.recommendations.innerHTML = `
    <article class="recommendation empty-card">
      <strong>尚未產生行動清單</strong>
      <p>產生診斷後，會依帳號實際表現與所選行業給出下週改善動作。</p>
    </article>
  `;
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
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "");
}

function normalizeIndustry(value) {
  return String(value || "").trim().slice(0, 40);
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
