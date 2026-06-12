import React from "react";
import { Box, Text } from "../ink-custom";
import { Pane } from "../design-system/Pane.js";

export interface FundamentalsData {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  marketCap: number;
  peRatio: number;
  forwardPE: number;
  eps: number;
  dividendYield: number;
  beta: number;
  roe: number;
  profitMargin: number;
  revenueGrowth: number;
  earningsGrowth: number;
  currentPrice: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
}

interface Props { data: FundamentalsData; }

function fmtBillions(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function FundamentalsRenderer({ data }: Props) {
  const pricePos = ((data.currentPrice - data.fiftyTwoWeekLow) / (data.fiftyTwoWeekHigh - data.fiftyTwoWeekLow)) * 100;
  const peColor = data.peRatio < 15 ? "green" : data.peRatio < 25 ? "yellow" : "red";
  const growthColor = data.revenueGrowth > 0.1 ? "green" : data.revenueGrowth > 0 ? "yellow" : "red";

  return (
    <Pane title={`${data.symbol} — ${data.companyName}`}>
      <Box flexDirection="column">
        <Text dimColor>{data.sector} · {data.industry}</Text>
        <Text dimColor>Market Cap: {fmtBillions(data.marketCap)}</Text>

        <Box marginTop={1}>
          <Text dimColor bold>VALUATION</Text>
        </Box>
        <Box><Text>P/E (trailing):  </Text><Text color={peColor} bold>{data.peRatio.toFixed(2)}</Text></Box>
        <Box><Text>P/E (forward):   </Text><Text>{data.forwardPE.toFixed(2)}</Text></Box>
        <Box><Text>EPS:             </Text><Text>${data.eps.toFixed(2)}</Text></Box>
        <Box><Text>Beta:            </Text><Text>{data.beta.toFixed(2)}</Text></Box>
        <Box><Text>Div Yield:       </Text><Text>{fmtPct(data.dividendYield)}</Text></Box>

        <Box marginTop={1}>
          <Text dimColor bold>PROFITABILITY</Text>
        </Box>
        <Box><Text>ROE:             </Text><Text>{fmtPct(data.roe)}</Text></Box>
        <Box><Text>Profit Margin:   </Text><Text>{fmtPct(data.profitMargin)}</Text></Box>

        <Box marginTop={1}>
          <Text dimColor bold>GROWTH</Text>
        </Box>
        <Box><Text>Revenue Growth:  </Text><Text color={growthColor}>{fmtPct(data.revenueGrowth)}</Text></Box>
        <Box><Text>Earnings Growth: </Text><Text color={growthColor}>{fmtPct(data.earningsGrowth)}</Text></Box>

        <Box marginTop={1}>
          <Text dimColor bold>52-WEEK RANGE</Text>
        </Box>
        <Box>
          <Text dimColor>${data.fiftyTwoWeekLow.toFixed(2)} </Text>
          <Text>─ ${data.currentPrice.toFixed(2)} ─ </Text>
          <Text dimColor>${data.fiftyTwoWeekHigh.toFixed(2)}</Text>
          <Text dimColor> ({pricePos.toFixed(0)}%)</Text>
        </Box>
      </Box>
    </Pane>
  );
}
