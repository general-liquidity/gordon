#!/usr/bin/env bun

import React from "react";
import { render } from "ink";
import { AppWithTheme } from "./app/App.tsx";
import { closeDatabase } from "./infra/storage/database.ts";

// Track if shutdown is in progress to prevent duplicate cleanup
let isShuttingDown = false;

/**
 * Graceful shutdown handler
 * Ensures database connections are closed and resources are cleaned up
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  try {
    // Close database connections
    closeDatabase();
    console.log("Database connections closed.");
  } catch (error) {
    console.error("Error during shutdown:", error);
  }

  process.exit(0);
}

// Register signal handlers for graceful shutdown
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));

// Handle uncaught exceptions gracefully
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  gracefulShutdown("uncaughtException");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  // Don't exit on unhandled rejections, just log them
});

// Render the application with theme support
const { waitUntilExit } = render(<AppWithTheme />);

// Handle graceful shutdown when app exits
waitUntilExit().then(() => {
  gracefulShutdown("exit");
});
