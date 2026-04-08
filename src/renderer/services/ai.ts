import type { AIConfig } from "@/renderer/hooks/useAIConfig";

export interface APIContext {
  fileTitle?: string;
  sectionTitle?: string;
  subSectionTitle?: string;
  previousContent: string;
}

export interface CompletionResponse {
  continuation: string;
}

export interface ConnectionProbeResult {
  expression: string;
  expected: string;
  actual: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  systemPrompt: string;
  messages: ChatMessage[];
}

export interface ChatResponse {
  content: string;
}

export interface ChatRequestOptions {
  signal?: AbortSignal;
}

const SYSTEM_PROMPT = `你是一个技术文档续写助手。
严格只输出以下 JSON，**不要有任何前缀、后缀、markdown、换行、解释**：

{"continuation": "接下来只写3–35个汉字的自然衔接内容"}
`;

const RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "short_continuation",
    strict: true,
    schema: {
      type: "object",
      properties: {
        continuation: {
          type: "string",
          description: "3–35 个汉字的续写",
          minLength: 2,
          maxLength: 35,
        },
      },
      required: ["continuation"],
      additionalProperties: false,
    },
  },
};

function buildConnectionExpression() {
  const operator = Math.random() < 0.5 ? "+" : "-";
  if (operator === "+") {
    const left = Math.floor(Math.random() * 10);
    const right = Math.floor(Math.random() * (10 - left));
    return {
      expression: `${left}+${right}`,
      expected: String(left + right),
    };
  }

  const left = Math.floor(Math.random() * 10);
  const right = Math.floor(Math.random() * (left + 1));
  return {
    expression: `${left}-${right}`,
    expected: String(left - right),
  };
}

export class AIService {
  private static dedupeModels(models: string[]) {
    return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  }

  private static normalizeBaseUrl(baseUrl: string) {
    return baseUrl.replace(/\/$/, "");
  }

  private static normalizeGeminiBaseUrl(baseUrl: string) {
    return this.normalizeBaseUrl(baseUrl)
      .replace(/\/v1beta$/, "")
      .replace(/\/v1$/, "");
  }

  private static async request(url: string, options: RequestInit): Promise<any> {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        let errorMsg = `HTTP Error: ${response.status}`;
        try {
          const errorBody = await response.json();
          errorMsg += ` - ${JSON.stringify(errorBody)}`;
        } catch {
          errorMsg += ` - ${await response.text()}`;
        }
        throw new Error(errorMsg);
      }
      return await response.json();
    } catch (error: any) {
      console.error("[AI Service] Request failed:", error);
      throw error;
    }
  }

  private static buildPrompt(context: APIContext): string {
    return `上下文：
文章标题：${context.fileTitle || "未知"}
大标题：${context.sectionTitle || "未知"}
本小节标题：${context.subSectionTitle || "未知"}
前面内容（请紧密衔接）：${context.previousContent}`;
  }

  private static fillPromptTemplate(
    template: string,
    values: Record<string, string>,
    fallback: string
  ) {
    const source = template.trim() || fallback;
    return source.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
  }

  private static parseResponse(text: string): CompletionResponse {
    try {
      // 1. Try generic JSON parsing
      // Remove generic markdown code block if present
      const cleanText = text.replace(/```json\n?|\n?```/g, "").trim();
      const json = JSON.parse(cleanText);
      if (json.continuation) {
        return { continuation: json.continuation };
      }
    } catch (e) {
      console.warn("[AI Service] JSON parse failed, trying regex extraction", e);
    }

    // 2. Regex fallback
    const match = text.match(/"continuation"\s*:\s*"([^"]+)"/);
    if (match && match[1]) {
      return { continuation: match[1] };
    }

    // 3. Last resort fallback (if AI just returned text)
    if (text.length < 50 && !text.includes("{")) {
      return { continuation: text.trim() };
    }

    throw new Error("Failed to parse AI response");
  }

  static async testConnection(config: AIConfig): Promise<ConnectionProbeResult> {
    if (!config.baseUrl) throw new Error("Base URL is required");

    const { expression, expected } = buildConnectionExpression();
    const prompt = `请计算：${expression}。只输出结果，不要解释，不要公式，不要标点，不要换行。`;

    let url = "";
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let body: any = {};

    switch (config.provider) {
      case "openai":
      case "custom":
        url = `${this.normalizeBaseUrl(config.baseUrl)}/chat/completions`;
        if (config.apiKey) {
          headers["Authorization"] = `Bearer ${config.apiKey}`;
        }
        body = {
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          stream: false,
        };
        break;

      case "anthropic":
        url = `${this.normalizeBaseUrl(config.baseUrl)}/v1/messages`;
        headers["x-api-key"] = config.apiKey;
        headers["anthropic-version"] = "2023-06-01";
        body = {
          model: config.model,
          max_tokens: 16,
          stream: false,
          messages: [{ role: "user", content: prompt }],
        };
        break;

      case "gemini":
        url = `${this.normalizeGeminiBaseUrl(config.baseUrl)}/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
        body = {
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 16,
          },
        };
        break;

      case "ollama":
        url = `${this.normalizeBaseUrl(config.baseUrl)}/api/chat`;
        body = {
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: {
            temperature: 0,
          },
        };
        break;

      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }

    const response = await this.request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    let content = "";
    if (config.provider === "openai" || config.provider === "custom") {
      content = response.choices?.[0]?.message?.content || "";
    } else if (config.provider === "anthropic") {
      content = response.content?.find((item: any) => item.type === "text")?.text || "";
    } else if (config.provider === "gemini") {
      content = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (config.provider === "ollama") {
      content = response.message?.content || "";
    }

    const actual = content.trim();
    if (!actual) {
      throw new Error("模型未返回内容");
    }

    return {
      expression,
      expected,
      actual,
    };
  }

  static async getModels(config: AIConfig): Promise<string[]> {
    try {
      if (config.provider === "ollama") {
        const res = await this.request(`${this.normalizeBaseUrl(config.baseUrl)}/api/tags`, {
          method: "GET",
        });
        return this.dedupeModels(res.models?.map((m: any) => m.name) || []);
      }

      if (config.provider === "openai" || config.provider === "custom") {
        const res = await this.request(`${this.normalizeBaseUrl(config.baseUrl)}/models`, {
          method: "GET",
          headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        });
        return this.dedupeModels(res.data?.map((model: any) => model.id) || []);
      }

      if (config.provider === "gemini") {
        const baseUrl = this.normalizeGeminiBaseUrl(config.baseUrl);
        const res = await this.request(`${baseUrl}/v1beta/models?key=${config.apiKey}`, {
          method: "GET",
        });
        return this.dedupeModels(
          res.models?.map((model: any) =>
            typeof model.name === "string" ? model.name.replace(/^models\//, "") : ""
          ) || []
        );
      }
    } catch (e) {
      console.error("Failed to fetch models", e);
      return [];
    }

    return [];
  }

  static async chat(
    config: AIConfig,
    request: ChatRequest,
    options: ChatRequestOptions = {}
  ): Promise<ChatResponse> {
    const systemPrompt = request.systemPrompt.trim();
    const messages = request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    let url = "";
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let body: any = {};

    switch (config.provider) {
      case "openai":
      case "custom":
        url = `${this.normalizeBaseUrl(config.baseUrl)}/chat/completions`;
        if (config.apiKey) {
          headers["Authorization"] = `Bearer ${config.apiKey}`;
        }
        body = {
          model: config.model,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          temperature: config.temperature,
          stream: false,
        };
        break;

      case "anthropic":
        url = `${this.normalizeBaseUrl(config.baseUrl)}/v1/messages`;
        headers["x-api-key"] = config.apiKey;
        headers["anthropic-version"] = "2023-06-01";
        body = {
          model: config.model,
          system: systemPrompt,
          messages,
          max_tokens: 4096,
          stream: false,
        };
        break;

      case "gemini":
        url = `${this.normalizeGeminiBaseUrl(config.baseUrl)}/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
        body = {
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            temperature: config.temperature,
            maxOutputTokens: 4096,
          },
        };
        break;

      case "ollama":
        url = `${this.normalizeBaseUrl(config.baseUrl)}/api/chat`;
        body = {
          model: config.model,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: false,
          options: {
            temperature: config.temperature,
          },
        };
        break;

      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }

    const response = await this.request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    let content = "";
    if (config.provider === "openai" || config.provider === "custom") {
      content = response.choices?.[0]?.message?.content || "";
    } else if (config.provider === "anthropic") {
      content =
        response.content
          ?.filter((item: any) => item.type === "text")
          .map((item: any) => item.text)
          .join("\n") || "";
    } else if (config.provider === "gemini") {
      content =
        response.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("\n") ||
        "";
    } else if (config.provider === "ollama") {
      content = response.message?.content || "";
    }

    const normalized = content.trim();
    if (!normalized) {
      throw new Error("模型未返回内容");
    }

    return { content: normalized };
  }

  static async complete(config: AIConfig, context: APIContext): Promise<CompletionResponse> {
    const fallbackPrompt = this.buildPrompt(context);
    const userMessage = this.fillPromptTemplate(
      config.continuationPrompt,
      {
        fileTitle: context.fileTitle || "未知",
        sectionTitle: context.sectionTitle || "未知",
        subSectionTitle: context.subSectionTitle || "未知",
        previousContent: context.previousContent,
      },
      fallbackPrompt
    );

    let url = "";
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let body: any = {};

    switch (config.provider) {
      case "openai":
      case "custom":
        url = `${config.baseUrl}/chat/completions`;
        headers["Authorization"] = `Bearer ${config.apiKey}`;
        body = {
          model: config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          temperature: config.temperature,
          stream: false,
          // OpenAI Structured Outputs
          response_format: RESPONSE_SCHEMA,
        };
        break;

      case "anthropic":
        url = `${config.baseUrl}/v1/messages`;
        headers["x-api-key"] = config.apiKey;
        headers["anthropic-version"] = "2023-06-01";
        // Anthropic doesn't have "response_format" in the same way, but we can stick to prompt engineering
        // OR use tool use if we wanted strict enforcement, but for simple completion, prompt is often enough.
        // However, user asked to use API level restrictions if available.
        // Anthropic specific: prefill assistant message to force JSON, or use tools.
        // Let's use the tool constraint approach which is the "Standard" way for structured output in Claude now.

        const toolSchema = {
          name: "print_continuation",
          description: "Print the continuation text",
          input_schema: {
            type: "object",
            properties: {
              continuation: {
                type: "string",
                description: "3–35 个汉字的续写",
              },
            },
            required: ["continuation"],
          },
        };

        body = {
          model: config.model,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
          max_tokens: 1024,
          stream: false,
          tools: [toolSchema],
          tool_choice: { type: "tool", name: "print_continuation" },
        };
        break;

      case "gemini":
        // Gemini API Structured Output
        url = `${config.baseUrl}/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
        body = {
          contents: [
            {
              parts: [{ text: SYSTEM_PROMPT + "\n" + userMessage }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                continuation: { type: "STRING" },
              },
              required: ["continuation"],
            },
            maxOutputTokens: 1024,
          },
        };
        break;

      case "ollama":
        url = `${config.baseUrl}/api/chat`;
        body = {
          model: config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          // Ollama supports JSON Schema object in 'format' since v0.5.x
          format: RESPONSE_SCHEMA.json_schema.schema,
          stream: false,
          options: {
            temperature: config.temperature,
          },
        };
        break;
    }

    const response = await this.request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    let content = "";

    if (config.provider === "openai" || config.provider === "custom") {
      content = response.choices?.[0]?.message?.content || "";
    } else if (config.provider === "anthropic") {
      // Handle tool use response
      if (response.content) {
        const toolUse = response.content.find((c: any) => c.type === "tool_use");
        if (toolUse && toolUse.input) {
          // Directly return parsed input as it is already JSON object
          if (toolUse.input.continuation) {
            return { continuation: toolUse.input.continuation };
          }
        }
        // Fallback to text if tool wasn't used properly (unlikely with tool_choice forced)
        content = response.content.find((c: any) => c.type === "text")?.text || "";
      }
    } else if (config.provider === "gemini") {
      content = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (config.provider === "ollama") {
      content = response.message?.content || "";
    }

    return this.parseResponse(content);
  }
}
