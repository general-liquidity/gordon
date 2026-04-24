// StdoutContext — owned port of ink/build/components/StdoutContext.js.

import process from "node:process";
import { createContext } from "react";

export type Props = {
  readonly stdout: NodeJS.WriteStream;
  readonly write: (data: string) => void;
};

const StdoutContext = createContext<Props>({
  stdout: process.stdout,
  write() {},
});
StdoutContext.displayName = "InternalStdoutContext";
export default StdoutContext;
