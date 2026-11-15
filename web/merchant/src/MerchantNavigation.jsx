import { useEffect, useRef } from "react";
import { Button, Stack, Text } from "@mantine/core";
import { dailyNavigation, navigationGroups } from "./merchant-navigation.js";

export default function MerchantNavigation({ page, visible, onNavigate }) {
  const navigation = useRef(null);
  useEffect(() => {
    // Native disclosures keep the owner's choices while browsing. Reveal the
    // selected page on history/deep-link changes and each mobile menu entry.
    const selectedGroup = navigation.current?.querySelector('[aria-current="page"]')?.closest("details");
    if (visible && selectedGroup) selectedGroup.open = true;
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

  return (
    <nav ref={navigation} aria-label="Tu negocio" className="merchant-navigation">
      <Text className="merchant-nav-label" size="sm" fw={600}>Día a día</Text>
      {items(dailyNavigation)}
      {navigationGroups.map(group => (
        <details key={group.id} className="merchant-nav-group">
          <summary>{group.label}</summary>
          {items(group.items)}
        </details>
      ))}
    </nav>
  );
}
