import { useEffect, useRef } from "react";
import { Button, Stack, Text } from "@mantine/core";
import { dailyNavigation, navigationGroups } from "./merchant-navigation.js";

export default function MerchantNavigation({ page, visible, onNavigate }) {
  const navigation = useRef(null);
  useEffect(() => {
    // Reveal the selected page on history/deep-link changes and each mobile
    // menu entry: open every disclosure that contains it (its group, and the
    // "ver todas las herramientas" reveal when the group lives inside it).
    const selected = navigation.current?.querySelector('[aria-current="page"]');
    if (!visible || !selected) return;
    let node = selected.closest("details");
    while (node) { node.open = true; node = node.parentElement?.closest("details"); }
  }, [page, visible]);

  const items = entries => (
    <Stack gap={4}>
      {entries.map(item => (
        <Button
          key={item.page}
          className="merchant-nav-item"
          justify="start"
          variant={page === item.page ? "light" : "subtle"}
          color={page === item.page ? "terra" : "gray"}
          aria-current={page === item.page ? "page" : undefined}
          onClick={() => onNavigate(item.page)}
        >
          {item.label}
        </Button>
      ))}
    </Stack>
  );

  const renderGroup = grp => (
    <details key={grp.id} className="merchant-nav-group">
      <summary>{grp.label}</summary>
      {items(grp.items)}
    </details>
  );

  // Everyday groups stay in view; operational and power-user groups move
  // behind one deliberate reveal so the default surface stays small.
  const primary = navigationGroups.filter(group => !group.advanced);
  const advanced = navigationGroups.filter(group => group.advanced);

  return (
    <nav ref={navigation} aria-label="Tu negocio" className="merchant-navigation">
      <Text className="merchant-nav-label" size="sm" fw={600}>Día a día</Text>
      {items(dailyNavigation)}
      {primary.map(renderGroup)}
      {advanced.length > 0 && (
        <details className="merchant-nav-more">
          <summary>Ver todas las herramientas</summary>
          {advanced.map(renderGroup)}
        </details>
      )}
    </nav>
  );
}
