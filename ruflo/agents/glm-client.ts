import OpenAI from "openai";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

export const glmClient = new OpenAI({
  apiKey: process.env.ZAI_API_KEY ?? "",
  baseURL: "https://api.z.ai/api/paas/v4",
});

export const GLM_MODEL = process.env.ZAI_MODEL ?? "glm-4.5-air";

export async function glmChat(
  prompt: string,
  systemPrompt?: string,
  maxTokens = 2000,
  jsonMode = false,
): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await glmClient.chat.completions.create({
    model: GLM_MODEL,
    max_tokens: maxTokens,
    temperature: 0.3,
    messages,
    ...(jsonMode && { response_format: { type: "json_object" } }),  // aktifkan JSON mode
  });

  return response.choices[0]?.message?.content ?? "";
}