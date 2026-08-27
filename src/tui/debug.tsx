// Debug entry — tests each import individually
async function main() {
  console.log("Starting import test...");

  try {
    console.log("1. Importing React...");
    const React = await import("react");
    console.log("   OK");

    console.log("2. Importing Ink...");
    const { render } = await import("ink");
    console.log("   OK");

    console.log("3. Importing AppStateProvider...");
    const asp = await import("./state/AppStateProvider.js");
    console.log("   OK:", Object.keys(asp));

    console.log("4. Importing NotificationsProvider...");
    const np = await import("./state/NotificationsProvider.js");
    console.log("   OK:", Object.keys(np));

    console.log("5. Importing StatsProvider...");
    const sp = await import("./state/StatsProvider.js");
    console.log("   OK:", Object.keys(sp));

    console.log("6. Importing App...");
    const { App } = await import("./App.js");
    console.log("   OK:", typeof App);

    console.log("7. Rendering...");
    const { waitUntilExit } = render(React.createElement(App));
    console.log("   Rendered!");
    await waitUntilExit();
  } catch (e: any) {
    console.error("FAILED:", e.message);
    console.error(e.stack?.split("\n").slice(0, 10).join("\n"));
  }
}

main();
