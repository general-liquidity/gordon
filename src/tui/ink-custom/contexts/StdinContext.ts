// StdinContext — owned port of ink/build/components/StdinContext.js.
//
// Exposes the input stream + raw-mode helpers + an internal EventEmitter
// that App's readable-handler emits onto, so useInput-style hooks can
// listen for chunks without re-attaching to the raw stdin stream.

import { EventEmitter } from "node:events";
import process from "node:process";
import { createContext } from "react";

export type Props = {
  readonly stdin: NodeJS.ReadStream;
  readonly setRawMode: (value: boolean) => void;
  readonly isRawModeSupported: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  readonly internal_exitOnCtrlC: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  readonly internal_eventEmitter: EventEmitter;
};

const StdinContext = createContext<Props>({
  stdin: process.stdin,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  internal_eventEmitter: new EventEmitter(),
  setRawMode() {},
  isRawModeSupported: false,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  internal_exitOnCtrlC: true,
});
StdinContext.displayName = "InternalStdinContext";
export default StdinContext;
