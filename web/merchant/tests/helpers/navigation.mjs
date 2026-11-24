import { navigationGroups } from "../../src/merchant-navigation.js";

// Select a menu entry the way an owner does: open the mobile menu, then every
// disclosure that contains the entry, with ordinary clicks. Advanced groups sit
// inside the "Ver todas las herramientas" reveal, so two disclosures may open.
// The public demo renders a flat menu without disclosures; nothing opens there.
export async function navigateMerchant(page, name) {
  const menu = page.getByRole("button", { name: "Cambiar sección del negocio", exact: true });
  if (await menu.isVisible()) await menu.click();
  const navigation = page.getByRole("navigation", { name: "Tu negocio" });
  const section = navigationGroups.find(group => group.items.some(item => item.label === name));
  if (section) {
    const disclosures = [];
    if (section.advanced) disclosures.push(navigation.locator("details.merchant-nav-more"));
    disclosures.push(navigation.locator("details.merchant-nav-group", { has: page.locator(`summary:text-is("${section.label}")`) }));
    for (const details of disclosures) {
      if ((await details.count()) === 0) continue;
      if (!(await details.evaluate(node => node.open))) await details.locator(":scope > summary").click();
    }
  }
  await navigation.getByRole("button", { name, exact: true }).click();
}
