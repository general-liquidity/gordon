/**
 * Prompt Management
 * Handles loading and building prompts for the LLM
 */

import { readFile } from "fs/promises";
import { join } from "path";
import type { Message } from "./types.ts";

// Default prompts directory relative to project root
const PROMPTS_DIR = "prompts";

/**
 * Custom error class for prompt loading errors
 */
export class PromptError extends Error {
  public promptName: string;

  constructor(message: string, promptName: string) {
    super(message);
    this.name = "PromptError";
    this.promptName = promptName;
  }
}

/**
 * Get the prompts directory path
 * Resolves relative to the current working directory
 */
function getPromptsDir(): string {
  return join(process.cwd(), PROMPTS_DIR);
}

/**
 * Load a prompt template from the prompts directory
 * @param name - Name of the prompt file (without .md extension)
 * @returns The prompt content as a string
 * @throws PromptError if the prompt file cannot be loaded
 */
export async function loadPrompt(name: string): Promise<string> {
  const promptPath = join(getPromptsDir(), `${name}.md`);

  try {
    const content = await readFile(promptPath, "utf-8");
    return content.trim();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new PromptError(
        `Prompt file not found: ${promptPath}`,
        name
      );
    }
    throw new PromptError(
      `Failed to load prompt "${name}": ${error instanceof Error ? error.message : String(error)}`,
      name
    );
  }
}

/**
 * Inject context variables into a prompt template
 * Replaces {{variable}} placeholders with values from the context object
 * @param template - The prompt template with {{variable}} placeholders
 * @param context - Object containing variable values to inject
 * @returns The template with placeholders replaced
 */
export function injectContext(
  template: string,
  context: Record<string, unknown>
): string {
  let result = template;

  for (const [key, value] of Object.entries(context)) {
    const placeholder = `{{${key}}}`;
    const stringValue =
      typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
    result = result.split(placeholder).join(stringValue);
  }

  return result;
}

/**
 * Build a message array for the LLM
 * @param systemPrompt - The system prompt content
 * @param userMessage - The user's message
 * @param context - Optional context to inject into the system prompt
 * @returns Array of messages ready for the LLM
 */
export function buildMessages(
  systemPrompt: string,
  userMessage: string,
  context?: Record<string, unknown>
): Message[] {
  // Inject context into system prompt if provided
  const finalSystemPrompt = context
    ? injectContext(systemPrompt, context)
    : systemPrompt;

  return [
    {
      role: "system",
      content: finalSystemPrompt,
    },
    {
      role: "user",
      content: userMessage,
    },
  ];
}

/**
 * Build messages with conversation history
 * @param systemPrompt - The system prompt content
 * @param history - Previous messages in the conversation
 * @param userMessage - The current user message
 * @param context - Optional context to inject into the system prompt
 * @returns Array of messages ready for the LLM
 */
export function buildMessagesWithHistory(
  systemPrompt: string,
  history: Message[],
  userMessage: string,
  context?: Record<string, unknown>
): Message[] {
  const finalSystemPrompt = context
    ? injectContext(systemPrompt, context)
    : systemPrompt;

  return [
    {
      role: "system",
      content: finalSystemPrompt,
    },
    ...history,
    {
      role: "user",
      content: userMessage,
    },
  ];
}

/**
 * Load a prompt and build messages in one step
 * @param promptName - Name of the prompt file to load
 * @param userMessage - The user's message
 * @param context - Optional context to inject into the system prompt
 * @returns Array of messages ready for the LLM
 */
export async function loadAndBuildMessages(
  promptName: string,
  userMessage: string,
  context?: Record<string, unknown>
): Promise<Message[]> {
  const systemPrompt = await loadPrompt(promptName);
  return buildMessages(systemPrompt, userMessage, context);
}
