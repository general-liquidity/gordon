// StderrContext — owned port of ink/build/components/StderrContext.js.

import process from "node:process";
import { createContext } from "react";

export type Props = {
  readonly stderr: NodeJS.WriteStream;
  readonly write: (data: string) => void;
};

const StderrContext = createContext<Props>({
  stderr: process.stderr,
  write() {},
});
StderrContext.displayName = "InternalStderrContext";
export default StderrContext;
