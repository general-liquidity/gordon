import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../theme.ts";
import { BlotterRow } from "../components/desk/BlotterRow.tsx";
import { DeskPanel } from "../components/desk/DeskPanel.tsx";
import { TicketCard } from "../components/desk/TicketCard.tsx";
import {
  clampWorkspaceCardIndex,
  type WorkspaceBoardCardViewModel,
  type WorkspaceBoardViewModel,
} from "../workspaceViewModels.ts";
import { getWorkspaceDefinition } from "../workspaces.ts";

interface WorkspaceBoardProps {
  model: WorkspaceBoardViewModel;
  selectedCardIndex?: number;
}

function renderCard(
  card: WorkspaceBoardCardViewModel,
  options: { showActions?: boolean; selected?: boolean } = {},
): React.ReactElement {
  const rows = card.rows ?? [];
  const notes = card.notes ?? [];
  const showActions = options.showActions ?? true;
  const selected = options.selected ?? false;

  const content = (
    <>
      {rows.length > 0 && (
        <Box flexDirection="column">
          {rows.map((row, index) => (
            <BlotterRow
              key={`${card.title}-${index}`}
              label={row.label}
              value={row.value}
              detail={row.detail}
              tone={row.tone}
            />
          ))}
        </Box>
      )}
      {notes.length > 0 && (
        <Box flexDirection="column" marginTop={rows.length > 0 ? 0 : 1}>
          {notes.map((note, index) => (
            <Text key={`${card.title}-note-${index}`} color={COLORS.DIM}>
              {note}
            </Text>
          ))}
        </Box>
      )}
    </>
  );

  if (card.variant === "panel") {
    return (
      <DeskPanel
        eyebrow={card.eyebrow}
        title={card.title}
        subtitle={card.subtitle}
        tone={card.tone}
        selected={selected}
      >
        {content}
        {showActions && card.actions && card.actions.length > 0 && (
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              {card.actions.join(" · ")}
            </Text>
          </Box>
        )}
      </DeskPanel>
    );
  }

  return (
    <TicketCard
      eyebrow={card.eyebrow}
      title={card.title}
      subtitle={card.subtitle}
      tone={card.tone}
      actions={showActions ? card.actions : undefined}
      selected={selected}
    >
      {content}
    </TicketCard>
  );
}

function collectPrimaryActions(cards: WorkspaceBoardCardViewModel[]): string[] {
  return [...new Set(cards.flatMap((card) => card.actions ?? []))].slice(0, 6);
}

function renderCardStack(
  cards: Array<WorkspaceBoardCardViewModel | undefined>,
  options: { showActions?: boolean; selectedIndexes?: Set<number>; startIndex?: number } = {},
): React.ReactElement {
  let renderIndex = options.startIndex ?? 0;
  return (
    <Box flexDirection="column" width="100%">
      {cards.filter(Boolean).map((card, index, visibleCards) => (
        <Box
          key={`${card?.title ?? "card"}-${index}`}
          flexDirection="column"
          marginBottom={index < visibleCards.length - 1 ? 1 : 0}
        >
          {renderCard(card!, {
            showActions: options.showActions,
            selected: options.selectedIndexes?.has(renderIndex++) ?? false,
          })}
        </Box>
      ))}
    </Box>
  );
}

function renderLeadRail(model: WorkspaceBoardViewModel, selectedCardIndex: number): React.ReactElement {
  const workspace = getWorkspaceDefinition(model.workspace);
  const clampedSelectedCardIndex = clampWorkspaceCardIndex(model, selectedCardIndex);
  const selectedCard = model.cards[clampedSelectedCardIndex];
  const primaryActions = selectedCard?.actions?.slice(0, 4) ?? collectPrimaryActions(model.cards).slice(0, 4);
  const leadCard = model.cards[0];
  const summary = leadCard?.subtitle ?? workspace.cue;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        <Box flexWrap="wrap">
          <Text color={COLORS.BRASS} bold>
            {workspace.label.toUpperCase()}
          </Text>
          <Text color={COLORS.DIM}>
            {" "}· {model.title}
          </Text>
          {summary && (
            <Text color={COLORS.DIM}>
              {" "}· {summary}
            </Text>
          )}
        </Box>
        {selectedCard && (
          <Box marginTop={1} flexWrap="wrap">
            <Text color={COLORS.DIM}>
              Focus:
            </Text>
            <Text color={COLORS.WHITE}>
              {" "}{selectedCard.title}
            </Text>
          </Box>
        )}
        {primaryActions.length > 0 && (
          <Box marginTop={1} flexWrap="wrap">
            <Text color={COLORS.DIM}>
              Next:
            </Text>
            <Text color={COLORS.WHITE}>
              {" "}{primaryActions.join(" · ")}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function renderEmptyWorkspaceNotice(
  title: string,
  subtitle: string,
  actions: string[],
  tone: "brand" | "warning" | "analysis" | "info" | "operate" = "warning",
): React.ReactElement {
  return (
    <DeskPanel eyebrow="Ready" title={title} subtitle={subtitle} tone={tone} compact>
      {actions.length > 0 && (
        <Box flexWrap="wrap">
          <Text color={COLORS.DIM}>
            Next:
          </Text>
          <Text color={COLORS.WHITE}>
            {" "}{actions.join(" · ")}
          </Text>
        </Box>
      )}
    </DeskPanel>
  );
}

function renderRows(rows?: WorkspaceBoardCardViewModel["rows"]): React.ReactElement | null {
  if (!rows || rows.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => (
        <BlotterRow
          key={`${row.label}-${index}`}
          label={row.label}
          value={row.value}
          detail={row.detail}
          tone={row.tone}
        />
      ))}
    </Box>
  );
}

function renderNotes(notes?: string[]): React.ReactElement | null {
  if (!notes || notes.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {notes.map((note, index) => (
        <Text key={`${note}-${index}`} color={COLORS.DIM}>
          {note}
        </Text>
      ))}
    </Box>
  );
}

function renderActionLine(actions?: string[], label: string = "Next"): React.ReactElement | null {
  if (!actions || actions.length === 0) {
    return null;
  }

  return (
    <Box marginTop={1} flexWrap="wrap">
      <Text color={COLORS.DIM}>
        {label}:
      </Text>
      <Text color={COLORS.WHITE}>
        {" "}{actions.join(" · ")}
      </Text>
    </Box>
  );
}

function isPlanWorkspaceEmpty(cards: WorkspaceBoardCardViewModel[]): boolean {
  const ticketCard = cards[0];
  return !ticketCard || ticketCard.title === "Review tickets before action";
}

function isMarketWorkspaceEmpty(cards: WorkspaceBoardCardViewModel[]): boolean {
  const scanCard = cards[0];
  return !scanCard || scanCard.title === "Turn the tape into a shortlist";
}

function isLabWorkspaceEmpty(cards: WorkspaceBoardCardViewModel[]): boolean {
  const focusCard = cards[0];
  return !focusCard || focusCard.title.includes("generated");
}

function isMonitorWorkspaceEmpty(cards: WorkspaceBoardCardViewModel[]): boolean {
  const bookCard = cards[0];
  return !bookCard || bookCard.title === "Supervise capital and exposure";
}

function renderMarketLayout(
  cards: WorkspaceBoardCardViewModel[],
  wide: boolean,
  selectedCardIndex: number,
): React.ReactElement {
  const [scanCard, deepDiveCard, contextCard] = cards;
  const selectedIndexes = new Set([selectedCardIndex]);
  if (isMarketWorkspaceEmpty(cards)) {
    return (
      <Box flexDirection="column">
        {renderEmptyWorkspaceNotice(
          "No shortlist on the tape yet.",
          "Run a scan or push one symbol through a deep read.",
          ["/scan", "/trending", "/analyze BTC", "/regime"],
          "info",
        )}
        <Box marginTop={1}>
          {renderCardStack([contextCard], { showActions: false, selectedIndexes, startIndex: 2 })}
        </Box>
      </Box>
    );
  }

  if (!wide) {
    return (
      <Box flexDirection="column">
        <DeskPanel eyebrow="Tape Shortlist" title={scanCard?.title} subtitle={scanCard?.subtitle} tone={scanCard?.tone} selected={selectedIndexes.has(0)}>
          {renderRows(scanCard?.rows)}
          {selectedIndexes.has(0) ? renderActionLine(scanCard?.actions) : null}
        </DeskPanel>
        <Box marginTop={1}>
          <TicketCard eyebrow="Focus Dossier" title={deepDiveCard?.title ?? "Focus"} subtitle={deepDiveCard?.subtitle} tone={deepDiveCard?.tone} selected={selectedIndexes.has(1)}>
            {renderRows(deepDiveCard?.rows)}
            {selectedIndexes.has(1) ? renderActionLine(deepDiveCard?.actions) : null}
          </TicketCard>
        </Box>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Context Rail" title={contextCard?.title} subtitle={contextCard?.subtitle} tone={contextCard?.tone} compact selected={selectedIndexes.has(2)}>
            {renderRows(contextCard?.rows)}
            {selectedIndexes.has(2) ? renderActionLine(contextCard?.actions, "Route") : null}
          </DeskPanel>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" width="100%">
      <Box flexGrow={2} flexDirection="column" marginRight={1}>
        <DeskPanel eyebrow="Tape Shortlist" title={scanCard?.title} subtitle={scanCard?.subtitle} tone={scanCard?.tone} selected={selectedIndexes.has(0)}>
          {renderRows(scanCard?.rows)}
          {selectedIndexes.has(0) ? renderActionLine(scanCard?.actions) : null}
        </DeskPanel>
        <Box marginTop={1}>
          <TicketCard eyebrow="Focus Dossier" title={deepDiveCard?.title ?? "Focus"} subtitle={deepDiveCard?.subtitle} tone={deepDiveCard?.tone} selected={selectedIndexes.has(1)}>
            {renderRows(deepDiveCard?.rows)}
            {selectedIndexes.has(1) ? renderActionLine(deepDiveCard?.actions, "Drill") : null}
          </TicketCard>
        </Box>
      </Box>
      <Box flexGrow={1} flexDirection="column">
        <DeskPanel eyebrow="Context Rail" title={contextCard?.title} subtitle={contextCard?.subtitle} tone={contextCard?.tone} compact selected={selectedIndexes.has(2)}>
          {renderRows(contextCard?.rows)}
          {selectedIndexes.has(2) ? renderActionLine(contextCard?.actions, "Route") : null}
        </DeskPanel>
      </Box>
    </Box>
  );
}

function renderPlanLayout(
  cards: WorkspaceBoardCardViewModel[],
  wide: boolean,
  selectedCardIndex: number,
): React.ReactElement {
  const [ticketCard, planBookCard, riskCard, approvalCard] = cards;
  const empty = isPlanWorkspaceEmpty(cards);
  const selectedIndexes = new Set([selectedCardIndex]);

  if (empty) {
    return (
      <Box flexDirection="column" width="100%">
        {renderEmptyWorkspaceNotice(
          "No active ticket.",
          "Start with /plan BTC or /grid BTC, then review risk and approvals here.",
          ["/plan BTC", "/grid BTC", "/preview-order"],
          "warning",
        )}
        <Box flexDirection={wide ? "row" : "column"} marginTop={1}>
          <Box flexGrow={2} flexDirection="column" marginRight={wide ? 1 : 0} marginBottom={wide ? 0 : 1}>
            {renderCardStack([approvalCard], { showActions: false, selectedIndexes, startIndex: 3 })}
          </Box>
          <Box flexGrow={1} flexDirection="column">
            {renderCardStack([planBookCard], { showActions: false, selectedIndexes, startIndex: 1 })}
          </Box>
        </Box>
      </Box>
    );
  }

  if (!wide) {
    return (
      <Box flexDirection="column">
        <TicketCard eyebrow="Active Ticket" title={ticketCard?.title ?? "Ticket"} subtitle={ticketCard?.subtitle} tone={ticketCard?.tone}>
          {renderRows(ticketCard?.rows)}
          {renderNotes(ticketCard?.notes)}
          {renderActionLine(ticketCard?.actions)}
        </TicketCard>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Approval Stack" title={approvalCard?.title} subtitle={approvalCard?.subtitle} tone={approvalCard?.tone} compact>
            {renderRows(approvalCard?.rows)}
            {renderActionLine(approvalCard?.actions, "Action")}
          </DeskPanel>
        </Box>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Risk Check" title={riskCard?.title} subtitle={riskCard?.subtitle} tone={riskCard?.tone} compact>
            {renderRows(riskCard?.rows)}
          </DeskPanel>
        </Box>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Plan Book" title={planBookCard?.title} subtitle={planBookCard?.subtitle} tone={planBookCard?.tone} compact>
            {renderRows(planBookCard?.rows)}
            {renderNotes(planBookCard?.notes)}
          </DeskPanel>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="row" marginBottom={1}>
        <Box flexGrow={2} flexDirection="column" marginRight={1}>
          <TicketCard eyebrow="Active Ticket" title={ticketCard?.title ?? "Ticket"} subtitle={ticketCard?.subtitle} tone={ticketCard?.tone} selected={selectedIndexes.has(0)}>
            {renderRows(ticketCard?.rows)}
            {renderNotes(ticketCard?.notes)}
            {selectedIndexes.has(0) ? renderActionLine(ticketCard?.actions) : null}
          </TicketCard>
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <DeskPanel eyebrow="Approval Stack" title={approvalCard?.title} subtitle={approvalCard?.subtitle} tone={approvalCard?.tone} compact selected={selectedIndexes.has(3)}>
            {renderRows(approvalCard?.rows)}
            {selectedIndexes.has(3) ? renderActionLine(approvalCard?.actions, "Action") : null}
          </DeskPanel>
        </Box>
      </Box>
      <Box flexDirection="row">
        <Box flexGrow={2} flexDirection="column" marginRight={1}>
          <DeskPanel eyebrow="Risk Check" title={riskCard?.title} subtitle={riskCard?.subtitle} tone={riskCard?.tone} compact selected={selectedIndexes.has(2)}>
            {renderRows(riskCard?.rows)}
            {selectedIndexes.has(2) ? renderActionLine(riskCard?.actions, "Review") : null}
          </DeskPanel>
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <DeskPanel eyebrow="Plan Book" title={planBookCard?.title} subtitle={planBookCard?.subtitle} tone={planBookCard?.tone} compact selected={selectedIndexes.has(1)}>
            {renderRows(planBookCard?.rows)}
            {renderNotes(planBookCard?.notes)}
            {selectedIndexes.has(1) ? renderActionLine(planBookCard?.actions, "Open") : null}
          </DeskPanel>
        </Box>
      </Box>
    </Box>
  );
}

function renderLabLayout(
  cards: WorkspaceBoardCardViewModel[],
  wide: boolean,
  selectedCardIndex: number,
): React.ReactElement {
  const [focusCard, validationCard, systematicCard, registryCard, queueCard] = cards;
  const selectedIndexes = new Set([selectedCardIndex]);
  if (isLabWorkspaceEmpty(cards)) {
    return (
      <Box flexDirection="column">
        {renderEmptyWorkspaceNotice(
          "No strategy focus loaded.",
          "Generate, compare, or backtest a strategy to wake the lab up.",
          ["/strategies", "/gen trend strategy for ETH", "/workflow backtest-cycle sma_crossover BTCUSDT"],
          "analysis",
        )}
        <Box marginTop={1}>
          {renderCardStack([registryCard, queueCard], { showActions: false, selectedIndexes, startIndex: 3 })}
        </Box>
      </Box>
    );
  }

  if (!wide) {
    return (
      <Box flexDirection="column">
        <TicketCard eyebrow="Bench Focus" title={focusCard?.title ?? "Strategy bench"} subtitle={focusCard?.subtitle} tone={focusCard?.tone} selected={selectedIndexes.has(0)}>
          {renderRows(focusCard?.rows)}
          {selectedIndexes.has(0) ? renderActionLine(focusCard?.actions) : null}
        </TicketCard>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Validation Lane" title={validationCard?.title} subtitle={validationCard?.subtitle} tone={validationCard?.tone} compact selected={selectedIndexes.has(1)}>
            {renderRows(validationCard?.rows)}
            {selectedIndexes.has(1) ? renderActionLine(validationCard?.actions, "Validate") : null}
          </DeskPanel>
        </Box>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Systematic Slate" title={systematicCard?.title} subtitle={systematicCard?.subtitle} tone={systematicCard?.tone} compact selected={selectedIndexes.has(2)}>
            {renderRows(systematicCard?.rows)}
            {renderNotes(systematicCard?.notes)}
            {selectedIndexes.has(2) ? renderActionLine(systematicCard?.actions, "Route") : null}
          </DeskPanel>
        </Box>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Registry Shelf" title={registryCard?.title} subtitle={registryCard?.subtitle} tone={registryCard?.tone} compact selected={selectedIndexes.has(3)}>
            {renderRows(registryCard?.rows)}
            {selectedIndexes.has(3) ? renderActionLine(registryCard?.actions, "Open") : null}
          </DeskPanel>
        </Box>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Research Queue" title={queueCard?.title} subtitle={queueCard?.subtitle} tone={queueCard?.tone} compact selected={selectedIndexes.has(4)}>
            {renderRows(queueCard?.rows)}
            {selectedIndexes.has(4) ? renderActionLine(queueCard?.actions, "Track") : null}
          </DeskPanel>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="row" marginBottom={1}>
        <Box flexGrow={2} flexDirection="column" marginRight={1}>
          <TicketCard eyebrow="Bench Focus" title={focusCard?.title ?? "Strategy bench"} subtitle={focusCard?.subtitle} tone={focusCard?.tone} selected={selectedIndexes.has(0)}>
            {renderRows(focusCard?.rows)}
            {selectedIndexes.has(0) ? renderActionLine(focusCard?.actions) : null}
          </TicketCard>
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <DeskPanel eyebrow="Validation Lane" title={validationCard?.title} subtitle={validationCard?.subtitle} tone={validationCard?.tone} compact selected={selectedIndexes.has(1)}>
            {renderRows(validationCard?.rows)}
            {selectedIndexes.has(1) ? renderActionLine(validationCard?.actions, "Validate") : null}
          </DeskPanel>
        </Box>
      </Box>
      <Box flexDirection="row">
        <Box flexGrow={1} flexDirection="column" marginRight={1}>
          <DeskPanel eyebrow="Systematic Slate" title={systematicCard?.title} subtitle={systematicCard?.subtitle} tone={systematicCard?.tone} compact selected={selectedIndexes.has(2)}>
            {renderRows(systematicCard?.rows)}
            {renderNotes(systematicCard?.notes)}
            {selectedIndexes.has(2) ? renderActionLine(systematicCard?.actions, "Route") : null}
          </DeskPanel>
        </Box>
        <Box flexGrow={1} flexDirection="column" marginRight={1}>
          <DeskPanel eyebrow="Registry Shelf" title={registryCard?.title} subtitle={registryCard?.subtitle} tone={registryCard?.tone} compact selected={selectedIndexes.has(3)}>
            {renderRows(registryCard?.rows)}
            {selectedIndexes.has(3) ? renderActionLine(registryCard?.actions, "Open") : null}
          </DeskPanel>
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <DeskPanel eyebrow="Research Queue" title={queueCard?.title} subtitle={queueCard?.subtitle} tone={queueCard?.tone} compact selected={selectedIndexes.has(4)}>
            {renderRows(queueCard?.rows)}
            {selectedIndexes.has(4) ? renderActionLine(queueCard?.actions, "Track") : null}
          </DeskPanel>
        </Box>
      </Box>
    </Box>
  );
}

function renderMonitorLayout(
  cards: WorkspaceBoardCardViewModel[],
  wide: boolean,
  selectedCardIndex: number,
): React.ReactElement {
  const [bookCard, positionsCard, runtimeCard, alertsCard] = cards;
  const selectedIndexes = new Set([selectedCardIndex]);
  if (isMonitorWorkspaceEmpty(cards)) {
    return (
      <Box flexDirection="column">
        {renderEmptyWorkspaceNotice(
          "No live book snapshot.",
          "Pull portfolio, positions, or health once and the monitor will stay warm.",
          ["/portfolio", "/positions", "/health"],
          "operate",
        )}
        <Box marginTop={1}>
          {renderCardStack([runtimeCard], { showActions: false, selectedIndexes, startIndex: 2 })}
        </Box>
      </Box>
    );
  }

  if (!wide) {
    return (
      <Box flexDirection="column">
        <DeskPanel eyebrow="Book" title={bookCard?.title} subtitle={bookCard?.subtitle} tone={bookCard?.tone} selected={selectedIndexes.has(0)}>
          {renderRows(bookCard?.rows)}
          {selectedIndexes.has(0) ? renderActionLine(bookCard?.actions) : null}
        </DeskPanel>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Runtime Rail" title={runtimeCard?.title} subtitle={runtimeCard?.subtitle} tone={runtimeCard?.tone} compact selected={selectedIndexes.has(2)}>
            {renderRows(runtimeCard?.rows)}
            {selectedIndexes.has(2) ? renderActionLine(runtimeCard?.actions, "Inspect") : null}
          </DeskPanel>
        </Box>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Blotter" title={positionsCard?.title} subtitle={positionsCard?.subtitle} tone={positionsCard?.tone} selected={selectedIndexes.has(1)}>
            {renderRows(positionsCard?.rows)}
            {selectedIndexes.has(1) ? renderActionLine(positionsCard?.actions, "Route") : null}
          </DeskPanel>
        </Box>
        <Box marginTop={1}>
          <DeskPanel eyebrow="Alert Feed" title={alertsCard?.title} subtitle={alertsCard?.subtitle} tone={alertsCard?.tone} compact selected={selectedIndexes.has(3)}>
            {renderRows(alertsCard?.rows)}
            {selectedIndexes.has(3) ? renderActionLine(alertsCard?.actions, "Respond") : null}
          </DeskPanel>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="row" marginBottom={1}>
        <Box flexGrow={1} flexDirection="column" marginRight={1}>
          <DeskPanel eyebrow="Book" title={bookCard?.title} subtitle={bookCard?.subtitle} tone={bookCard?.tone} selected={selectedIndexes.has(0)}>
            {renderRows(bookCard?.rows)}
            {selectedIndexes.has(0) ? renderActionLine(bookCard?.actions) : null}
          </DeskPanel>
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <DeskPanel eyebrow="Runtime Rail" title={runtimeCard?.title} subtitle={runtimeCard?.subtitle} tone={runtimeCard?.tone} compact selected={selectedIndexes.has(2)}>
            {renderRows(runtimeCard?.rows)}
            {selectedIndexes.has(2) ? renderActionLine(runtimeCard?.actions, "Inspect") : null}
          </DeskPanel>
        </Box>
      </Box>
      <Box flexDirection="row">
        <Box flexGrow={2} flexDirection="column" marginRight={1}>
          <DeskPanel eyebrow="Blotter" title={positionsCard?.title} subtitle={positionsCard?.subtitle} tone={positionsCard?.tone} selected={selectedIndexes.has(1)}>
            {renderRows(positionsCard?.rows)}
            {selectedIndexes.has(1) ? renderActionLine(positionsCard?.actions, "Route") : null}
          </DeskPanel>
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <DeskPanel eyebrow="Alert Feed" title={alertsCard?.title} subtitle={alertsCard?.subtitle} tone={alertsCard?.tone} compact selected={selectedIndexes.has(3)}>
            {renderRows(alertsCard?.rows)}
            {selectedIndexes.has(3) ? renderActionLine(alertsCard?.actions, "Respond") : null}
          </DeskPanel>
        </Box>
      </Box>
    </Box>
  );
}

export function WorkspaceBoard({ model, selectedCardIndex = 0 }: WorkspaceBoardProps): React.ReactElement {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 120;
  const wide = columns >= 150;
  const clampedSelectedCardIndex = clampWorkspaceCardIndex(model, selectedCardIndex);
  const interactionHint = model.workspace === "plan"
    ? "↑/↓ focus · Tab stage · Enter sends · Shift+A/D approvals"
    : "↑/↓ focus · Tab stage · Enter sends";

  let boardLayout: React.ReactElement;
  switch (model.workspace) {
    case "market":
      boardLayout = renderMarketLayout(model.cards, wide, clampedSelectedCardIndex);
      break;
    case "plan":
      boardLayout = renderPlanLayout(model.cards, wide, clampedSelectedCardIndex);
      break;
    case "lab":
      boardLayout = renderLabLayout(model.cards, wide, clampedSelectedCardIndex);
      break;
    case "monitor":
      boardLayout = renderMonitorLayout(model.cards, wide, clampedSelectedCardIndex);
      break;
    default:
      boardLayout = renderCardStack(model.cards, {
        selectedIndexes: new Set([clampedSelectedCardIndex]),
      });
      break;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {renderLeadRail(model, clampedSelectedCardIndex)}
      {boardLayout}
      {model.cards.length > 0 && (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>
            {interactionHint}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default WorkspaceBoard;
