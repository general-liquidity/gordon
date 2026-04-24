// Direct test — bypasses index.tsx startup chain
import React from "react";
import { render } from "./ink-custom";
import { App } from "./App.js";

const { waitUntilExit } = render(<App />);
await waitUntilExit();
