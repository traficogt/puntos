import { navigationGroups } from "../../src/merchant-navigation.js";

export async function navigateMerchant(page, name) {
  const menu = page.getByRole("button", { name: "Cambiar sección del negocio", exact: true });
  if (await menu.isVisible()) await menu.click();
  const navigation = page.getByRole("navigation", { name: "Tu negocio" });
  const section = navigationGroups.find(group => group.items.some(item => item.label === name));
  if (section) {
    const details = navigation.locator("details").filter({ has: page.locator("summary", { hasText: section.label }) });
    if (!(await details.evaluate(node => node.open))) await details.locator("summary").click();
  }
  await navigation.getByRole("button", { name, exact: true }).click();
}
