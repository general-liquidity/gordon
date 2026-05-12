import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";

/**
 * MarketplaceBrowser — Browse and install from the 47-plugin trading catalog
 *
 * /marketplace opens this dialog:
 *   - Browse by category (data-provider, execution, research, etc.)
 *   - Search by name
 *   - View plugin details (description, tools, pricing, install command)
 *   - One-click install
 */

interface CatalogPlugin {
  id: string;
  name: string;
  description: string;
  category: string;
  transport: string;
  install: string;
  pricing: string;
  pricingNote?: string;
  toolCount: number;
  docsUrl: string;
  installed?: boolean;
}

interface Props {
  plugins: CatalogPlugin[];
  onInstall: (pluginId: string, installCommand: string) => void;
  onCancel: () => void;
}

export function MarketplaceBrowser({ plugins, onInstall, onCancel }: Props) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [detailPlugin, setDetailPlugin] = useState<CatalogPlugin | null>(null);

  const categories = useMemo(() => {
    const cats = new Set(plugins.map((p) => p.category));
    return ["all", ...Array.from(cats)];
  }, [plugins]);

  const filtered = useMemo(() => {
    let list = plugins;
    if (selectedCategory !== "all") list = list.filter((p) => p.category === selectedCategory);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [plugins, selectedCategory, query]);

  useInput((input, key) => {
    if (key.escape) {
      if (detailPlugin) setDetailPlugin(null);
      else if (query) { setQuery(""); setSelectedIdx(0); }
      else if (selectedCategory !== "all") { setSelectedCategory("all"); setSelectedIdx(0); }
      else onCancel();
      return;
    }
    if (detailPlugin) return; // Detail view handles its own input
    if (key.return) {
      const plugin = filtered[selectedIdx];
      if (plugin) setDetailPlugin(plugin);
      return;
    }
    if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    if (key.tab) {
      const idx = categories.indexOf(selectedCategory);
      setSelectedCategory(categories[(idx + 1) % categories.length]!);
      setSelectedIdx(0);
      return;
    }
    if (key.backspace) { setQuery((q) => q.slice(0, -1)); setSelectedIdx(0); return; }
    if (input && !key.ctrl && !key.meta) { setQuery((q) => q + input); setSelectedIdx(0); }
  });

  // ── Detail view ──
  if (detailPlugin) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyanBright">{detailPlugin.name}</Text>
        <Text dimColor>{detailPlugin.description}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Category: {detailPlugin.category}</Text>
          <Text>Transport: {detailPlugin.transport}</Text>
          <Text>Tools: {detailPlugin.toolCount}</Text>
          <Text>Pricing: {detailPlugin.pricing}{detailPlugin.pricingNote ? ` — ${detailPlugin.pricingNote}` : ""}</Text>
          <Text>Docs: {detailPlugin.docsUrl}</Text>
          <Text color="green">Install: {detailPlugin.install}</Text>
        </Box>
        <Box marginTop={1}>
          <Select
            options={[
              { label: `Install ${detailPlugin.name}`, value: "install" },
              { label: "Back to list", value: "back" },
            ]}
            onChange={(v) => {
              if (v === "install") onInstall(detailPlugin.id, detailPlugin.install);
              setDetailPlugin(null);
            }}
          />
        </Box>
        <Box marginTop={1}><Text dimColor>Esc to go back</Text></Box>
      </Box>
    );
  }

  // ── List view ──
  const maxVisible = 12;
  const scrollStart = Math.max(0, selectedIdx - Math.floor(maxVisible / 2));
  const visible = filtered.slice(scrollStart, scrollStart + maxVisible);

  const PRICING_COLORS: Record<string, string> = { free: "green", freemium: "yellow", paid: "red" };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">MARKETPLACE</Text>
        <Text dimColor>  ({filtered.length} of {plugins.length} plugins)</Text>
      </Box>

      {/* Search */}
      <Box>
        <Text color="cyanBright">{"\uD83D\uDD0D"} </Text>
        {query ? <Text>{query}<Text color="cyanBright">{"\u2588"}</Text></Text> : <Text dimColor>Type to search...</Text>}
      </Box>

      {/* Categories */}
      <Box marginTop={1}>
        {categories.map((cat) => (
          <Text key={cat} color={cat === selectedCategory ? "cyanBright" : undefined} dimColor={cat !== selectedCategory}>
            {" "}{cat}{" "}
          </Text>
        ))}
      </Box>

      {/* Plugin list */}
      <Box flexDirection="column" marginTop={1}>
        {visible.map((plugin, i) => {
          const globalIdx = scrollStart + i;
          const isFocused = globalIdx === selectedIdx;
          return (
            <Box key={plugin.id}>
              <Text color={isFocused ? "cyanBright" : undefined}>{isFocused ? " \u25B8" : "  "}</Text>
              <Text color={isFocused ? "cyanBright" : undefined} bold={isFocused}> {plugin.name.padEnd(22)}</Text>
              <Text color={PRICING_COLORS[plugin.pricing] as any}>{plugin.pricing.padEnd(10)}</Text>
              <Text dimColor={!isFocused} wrap="truncate-end">{plugin.description}</Text>
            </Box>
          );
        })}
      </Box>

      {filtered.length > maxVisible && (
        <Text dimColor> {filtered.length - maxVisible} more — scroll or search to find</Text>
      )}

      <Box marginTop={1}>
        <Text dimColor>{"\u2191\u2193"} scroll {"\u00B7"} Tab category {"\u00B7"} Enter details {"\u00B7"} Esc {query ? "clear" : selectedCategory !== "all" ? "all" : "close"}</Text>
      </Box>
    </Box>
  );
}
