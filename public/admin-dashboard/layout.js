const PROGRAM_FRAGMENT_PATH = "/admin-dashboard/fragments/program.html";
const TAB_FRAGMENT_PATHS = [
  "/admin-dashboard/fragments/branding.html",
  "/admin-dashboard/fragments/rewards.html",
  "/admin-dashboard/fragments/tiers.html",
  "/admin-dashboard/fragments/branches.html",
  "/admin-dashboard/fragments/staff.html",
  "/admin-dashboard/fragments/giftcards.html",
  "/admin-dashboard/fragments/achievements.html",
  "/admin-dashboard/fragments/challenges.html",
  "/admin-dashboard/fragments/referrals.html",
  "/admin-dashboard/fragments/operations.html",
  "/admin-dashboard/fragments/analytics.html"
];

async function loadFragment(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`No se pudo cargar ${path} (${response.status})`);
  }
  return response.text();
}

function parseFragment(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const fragment = document.createDocumentFragment();
  fragment.append(...doc.body.childNodes);
  return fragment;
}

export async function ensureAdminDashboardLayout() {
  const programHost = document.getElementById("dashboardProgramHost");
  const tabHost = document.getElementById("dashboardTabsHost");
  if (!programHost || !tabHost) return;
  if (programHost.dataset.loaded === "true" && tabHost.dataset.loaded === "true") return;

  const [programHtml, ...tabFragments] = await Promise.all([
    loadFragment(PROGRAM_FRAGMENT_PATH),
    ...TAB_FRAGMENT_PATHS.map((path) => loadFragment(path))
  ]);

  const tabContent = document.createDocumentFragment();
  tabFragments.forEach((html) => {
    tabContent.append(parseFragment(html.trim()));
  });

  programHost.replaceChildren(parseFragment(programHtml.trim()));
  tabHost.replaceChildren(tabContent);
  programHost.dataset.loaded = "true";
  tabHost.dataset.loaded = "true";
}
