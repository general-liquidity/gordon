import React from "react";
import { Box } from "ink";
import SurfaceFrame from "../components/workspace/SurfaceFrame.tsx";
import DataTable from "../components/workspace/DataTable.tsx";
import DetailPane from "../components/workspace/DetailPane.tsx";
import type { MarketWorkspaceSurfaceModel } from "../workspaceSurfaces.ts";

interface MarketWorkspaceProps {
  model: MarketWorkspaceSurfaceModel;
  selectedSectionIndex?: number;
}

export function MarketWorkspace({
  model,
  selectedSectionIndex = 0,
}: MarketWorkspaceProps): React.ReactElement {
  const shortlistSelected = selectedSectionIndex === 0;
  const focusSelected = selectedSectionIndex === 1;
  const contextSelected = selectedSectionIndex === 2;

  return (
    <Box flexDirection="column" marginX={1} marginBottom={1}>
      <SurfaceFrame
        eyebrow="Market Mandate"
        title={model.title}
        subtitle={model.subtitle}
        tone="brand"
      />

      <Box marginTop={1} flexDirection="row">
        <Box flexDirection="column" width="62%" paddingRight={1}>
          <SurfaceFrame
            eyebrow="Tape Shortlist"
            title={model.shortlist.title}
            subtitle={model.shortlist.subtitle}
            tone={model.shortlist.tone}
            selected={shortlistSelected}
            actions={model.shortlist.actions}
          >
            <DataTable
              columns={[
                { key: "symbol", label: "Symbol" },
                { key: "price", label: "Price", align: "right" },
                { key: "change24h", label: "24h", align: "right" },
                { key: "bias", label: "Bias" },
                { key: "setup", label: "Setup", align: "right" },
                { key: "risk", label: "Risk" },
              ]}
              rows={model.shortlist.rows.map((row) => ({
                id: row.symbol,
                tone: row.tone,
                values: {
                  symbol: row.symbol,
                  price: row.price,
                  change24h: row.change24h,
                  bias: row.bias,
                  setup: row.setup,
                  risk: row.risk,
                },
                active: row.symbol === model.shortlist.activeSymbol,
              }))}
              emptyTitle={model.shortlist.emptyTitle}
              emptyDetail={model.shortlist.emptyDetail}
            />
          </SurfaceFrame>
        </Box>

        <Box flexDirection="column" width="38%">
          <SurfaceFrame
            eyebrow="Focus Dossier"
            title={model.focus.title}
            subtitle={model.focus.subtitle}
            tone={model.focus.tone}
            selected={focusSelected}
            actions={model.focus.actions}
          >
            <DetailPane rows={model.focus.rows} notes={model.focus.notes} />
          </SurfaceFrame>

          <Box marginTop={1}>
            <SurfaceFrame
              eyebrow="Context Rail"
              title={model.context.title}
              subtitle={model.context.subtitle}
              tone={model.context.tone}
              selected={contextSelected}
              actions={model.context.actions}
            >
              <DetailPane rows={model.context.rows} />
            </SurfaceFrame>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default MarketWorkspace;
