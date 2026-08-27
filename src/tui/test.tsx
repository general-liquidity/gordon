import { render } from "./ink-custom";
import { App } from "./App.js";

const { waitUntilExit } = render(<App />);
await waitUntilExit();
