import { Box, Text } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

export interface CalibrationBucket {
  confidence: number;
  totalPredictions: number;
  accuracy: number;
  expectedAccuracy: number;
  calibrationError: number;
}

interface Props {
  buckets: CalibrationBucket[];
  isWellCalibrated: boolean;
  overconfidenceScore: number;
  totalPredictions: number;
  overallAccuracy: number;
}

// Render a simple bar chart: confidence 1-10 on y-axis, bar = accuracy
export function CalibrationCurve({
  buckets,
  isWellCalibrated,
  overconfidenceScore,
  totalPredictions,
  overallAccuracy,
}: Props) {
  const status = isWellCalibrated
    ? "WELL CALIBRATED"
    : overconfidenceScore > 0.1
      ? "OVERCONFIDENT"
      : overconfidenceScore < -0.1
        ? "UNDERCONFIDENT"
        : "CALIBRATING";
  const statusColor = isWellCalibrated ? "green" : "yellow";

  return (
    <Pane title="CONFIDENCE CALIBRATION">
      <Box flexDirection="column">
        <Box>
          <Text>Status: </Text>
          <Text color={statusColor} bold>
            {status}
          </Text>
          <Text dimColor>
            {" "}
            {"\u00B7"} Overall accuracy: {(overallAccuracy * 100).toFixed(1)}%
          </Text>
          <Text dimColor>
            {" "}
            {"\u00B7"} N={totalPredictions}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text dimColor bold>
              {"CONF".padEnd(6)}
            </Text>
            <Text dimColor bold>
              {"ACTUAL".padEnd(10)}
            </Text>
            <Text dimColor bold>
              {"EXPECTED".padEnd(10)}
            </Text>
            <Text dimColor bold>
              {"N".padEnd(6)}
            </Text>
            <Text dimColor bold>
              DELTA
            </Text>
          </Box>
          {buckets.map((b) => {
            const delta = b.accuracy - b.expectedAccuracy;
            const deltaColor =
              Math.abs(delta) < 0.1 ? "green" : Math.abs(delta) < 0.2 ? "yellow" : "red";
            return (
              <Box key={b.confidence}>
                <Text>{b.confidence.toString().padEnd(6)}</Text>
                <Text>{(b.accuracy * 100).toFixed(1).padEnd(8)}% </Text>
                <Text dimColor>{(b.expectedAccuracy * 100).toFixed(1).padEnd(8)}% </Text>
                <Text dimColor>{b.totalPredictions.toString().padEnd(6)}</Text>
                <Text color={deltaColor}>
                  {delta >= 0 ? "+" : ""}
                  {(delta * 100).toFixed(1)}%
                </Text>
              </Box>
            );
          })}
        </Box>
        {!isWellCalibrated && (
          <Box marginTop={1}>
            <Text dimColor italic>
              {overconfidenceScore > 0.1
                ? "Model is overconfident — reduce confidence thresholds or retrain"
                : overconfidenceScore < -0.1
                  ? "Model is underconfident — can trust higher-confidence signals more"
                  : "Need more predictions (30+) for reliable calibration"}
            </Text>
          </Box>
        )}
      </Box>
    </Pane>
  );
}
