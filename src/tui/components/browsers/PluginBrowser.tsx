import { useState } from "react";
import { Box, Text } from "../../ink-custom";
import { useRoutedInput, FOCUS_PRIORITY } from "../../input/InputRouterContext.tsx";

// ============================================================================
// PluginBrowser — Browse, install, enable/disable trading plugins
// ============================================================================

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  installed: boolean;
  enabled: boolean;
  author?: string;
}
interface Props {
  plugins: Plugin[];
  onInstall?: (id: string) => void;
  onToggle?: (id: string) => void;
  onClose: () => void;
}

export function PluginBrowser({ plugins, onInstall, onToggle, onClose }: Props) {
  const [selected, setSelected] = useState(0);

  useRoutedInput(
    (input, key) => {
      if (key.escape) onClose();
      else if (key.return && plugins[selected]) {
        if (plugins[selected]!.installed) onToggle?.(plugins[selected]!.id);
        else onInstall?.(plugins[selected]!.id);
      } else if (input === "i" && plugins[selected] && !plugins[selected]!.installed)
        onInstall?.(plugins[selected]!.id);
      else if (key.upArrow) setSelected((p) => Math.max(0, p - 1));
      else if (key.downArrow) setSelected((p) => Math.min(plugins.length - 1, p + 1));
    },
    { id: "pluginBrowser", priority: FOCUS_PRIORITY.DIALOG },
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">
        PLUGINS
      </Text>
      {plugins.map((p, i) => (
        <Box key={p.id}>
          <Text color={i === selected ? "cyanBright" : undefined}>
            {i === selected ? "\u25B8 " : "  "}
          </Text>
          <Text color={p.enabled ? "green" : p.installed ? "gray" : "cyan"}>
            {p.enabled ? "\u25CF" : p.installed ? "\u25CB" : "\u25C7"}{" "}
          </Text>
          <Text bold={i === selected}>{p.name}</Text>
          <Text dimColor> v{p.version}</Text>
          {p.author ? <Text dimColor> by {p.author}</Text> : null}
        </Box>
      ))}
      <Text dimColor>
        Enter to toggle {"\u00B7"} i to install {"\u00B7"} Esc to close
      </Text>
    </Box>
  );
}
