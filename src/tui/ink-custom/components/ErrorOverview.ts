// ErrorOverview — owned port of ink/build/components/ErrorOverview.js.
//
// Renders a fall-back error card when App's error boundary catches a
// throw. We reuse our own Box/Text components so the painted output goes
// through the custom renderer (Yoga + cell buffer) rather than vanilla ink.

import * as fs from "node:fs";
import { cwd } from "node:process";
import React from "react";
// stack-utils ships no .d.ts and no @types entry. Using `any` here is a
// deliberate, narrow exception — the alternative is to vendor a stub typeroot.
// @ts-expect-error — no type declarations available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import StackUtils from "stack-utils";
import codeExcerpt from "code-excerpt";
import Box from "./Box.ts";
import Text from "./Text.ts";

// Error's source file is reported as file:///home/user/file.js
// This function removes the file://[cwd] part.
const cleanupPath = (path: string | undefined): string | undefined => {
  return path?.replace(`file://${cwd()}/`, "");
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stackUtils: any = new (StackUtils as any)({
  cwd: cwd(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  internals: (StackUtils as any).nodeInternals(),
});

type ParsedStackLine = {
  file?: string;
  line?: number;
  column?: number;
  function?: string;
};

type Props = {
  readonly error: Error;
};

export default function ErrorOverview({ error }: Props): React.JSX.Element {
  const stack = error.stack ? error.stack.split("\n").slice(1) : undefined;
  const origin: ParsedStackLine | undefined = stack ? stackUtils.parseLine(stack[0]) : undefined;
  const filePath = cleanupPath(origin?.file);
  let excerpt: ReturnType<typeof codeExcerpt> | undefined;
  let lineWidth = 0;
  if (filePath && origin?.line && fs.existsSync(filePath)) {
    const sourceCode = fs.readFileSync(filePath, "utf8");
    excerpt = codeExcerpt(sourceCode, origin.line);
    if (excerpt) {
      for (const { line } of excerpt) {
        lineWidth = Math.max(lineWidth, String(line).length);
      }
    }
  }
  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1 },
    React.createElement(
      Box,
      null,
      React.createElement(Text, { backgroundColor: "red", color: "white" }, " ", "ERROR", " "),
      React.createElement(Text, null, " ", error.message),
    ),
    origin &&
      filePath &&
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(
          Text,
          { dimColor: true },
          filePath,
          ":",
          origin.line,
          ":",
          origin.column,
        ),
      ),
    origin &&
      excerpt &&
      React.createElement(
        Box,
        { marginTop: 1, flexDirection: "column" },
        excerpt.map(({ line, value }) =>
          React.createElement(
            Box,
            { key: line },
            React.createElement(
              Box,
              { width: lineWidth + 1 },
              React.createElement(
                Text,
                {
                  dimColor: line !== origin.line,
                  backgroundColor: line === origin.line ? "red" : undefined,
                  color: line === origin.line ? "white" : undefined,
                  "aria-label": line === origin.line ? `Line ${line}, error` : `Line ${line}`,
                },
                String(line).padStart(lineWidth, " "),
                ":",
              ),
            ),
            React.createElement(
              Text,
              {
                key: line,
                backgroundColor: line === origin.line ? "red" : undefined,
                color: line === origin.line ? "white" : undefined,
              },
              ` ${value}`,
            ),
          ),
        ),
      ),
    error.stack &&
      React.createElement(
        Box,
        { marginTop: 1, flexDirection: "column" },
        error.stack
          .split("\n")
          .slice(1)
          // Key by position, not line text — recursive frames (e.g. React's
          // commit-phase traversal) repeat verbatim and would collide.
          .map((line, index) => {
            const parsedLine: ParsedStackLine | undefined = stackUtils.parseLine(line);
            // If the line from the stack cannot be parsed, we print out the
            // unparsed line.
            if (!parsedLine) {
              return React.createElement(
                Box,
                { key: index },
                React.createElement(Text, { dimColor: true }, "- "),
                React.createElement(Text, { dimColor: true, bold: true }, line, "\\t", " "),
              );
            }
            return React.createElement(
              Box,
              { key: index },
              React.createElement(Text, { dimColor: true }, "- "),
              React.createElement(Text, { dimColor: true, bold: true }, parsedLine.function),
              React.createElement(
                Text,
                {
                  dimColor: true,
                  color: "gray",
                  "aria-label": `at ${
                    cleanupPath(parsedLine.file) ?? ""
                  } line ${parsedLine.line} column ${parsedLine.column}`,
                },
                " ",
                "(",
                cleanupPath(parsedLine.file) ?? "",
                ":",
                parsedLine.line,
                ":",
                parsedLine.column,
                ")",
              ),
            );
          }),
      ),
  );
}
