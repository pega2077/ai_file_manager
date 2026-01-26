import type { Express, Request, Response } from "express";
import { logger } from "../logger";
import { configManager } from "../configManager";
import { generateStructuredJson, getActiveModelName } from "./utils/llm";
import type { ProviderName } from "./utils/llm";
import { normalizeProviderName, isProviderValueProvided, respondWithInvalidProvider } from "./utils/providerHelper";
import { normalizeLanguage, type SupportedLang } from "./utils/promptHelper";
import { agentTools } from "./agentTools";
import type { AgentTool, AgentToolCall, AgentExecutionStep } from "./agentTools";

export function registerAgentRoutes(app: Express) {
  app.post("/api/agent/execute", agentExecuteHandler);
}

type AgentExecuteBody = {
  instruction?: unknown;
  language?: unknown;
  provider?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  stream?: unknown;
};

/**
 * Agent execution handler that:
 * 1. Takes a user instruction
 * 2. Uses LLM to plan and execute tool calls step by step
 * 3. Returns execution progress and results
 */
export async function agentExecuteHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = req.body as AgentExecuteBody | undefined;
    const instruction = typeof body?.instruction === "string" ? body.instruction : "";
    const language: SupportedLang = normalizeLanguage(body?.language);
    const temperature = typeof body?.temperature === "number" ? body.temperature : 0.7;
    const maxTokens = typeof body?.max_tokens === "number" ? body.max_tokens : 2000;
    const stream = typeof body?.stream === "boolean" ? body.stream : false;

    if (!instruction) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "instruction is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const providerInput = body?.provider;
    const provider = normalizeProviderName(providerInput);
    if (isProviderValueProvided(providerInput) && !provider) {
      respondWithInvalidProvider(res, providerInput);
      return;
    }

    logger.info(`Agent execute request: ${instruction}`);

    // For streaming, set up SSE
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }

    const sendProgress = (step: AgentExecutionStep) => {
      if (stream) {
        res.write(`data: ${JSON.stringify(step)}\n\n`);
      }
    };

    try {
      // Execute the agent workflow
      const result = await executeAgentWorkflow(
        instruction,
        language,
        provider || null,
        temperature,
        maxTokens,
        sendProgress
      );

      if (stream) {
        // Send final result
        res.write(`data: ${JSON.stringify({ type: "complete", result })}\n\n`);
        res.end();
      } else {
        res.json({
          success: true,
          message: "agent_execution_complete",
          data: result,
          error: null,
          timestamp: new Date().toISOString(),
          request_id: "",
        });
      }
    } catch (error) {
      logger.error("Agent execution error", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      
      if (stream) {
        res.write(`data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`);
        res.end();
      } else {
        res.status(500).json({
          success: false,
          message: "agent_execution_failed",
          data: null,
          error: {
            code: "EXECUTION_ERROR",
            message: errorMsg,
            details: null,
          },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
      }
    }
  } catch (error) {
    logger.error("Agent handler error", error);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

type AgentWorkflowResult = {
  instruction: string;
  steps: AgentExecutionStep[];
  finalResult: string;
  success: boolean;
};

// Configuration constants
const MAX_AGENT_ITERATIONS = 10;
const MAX_CONTEXT_SIZE = 5000; // characters

/**
 * Truncate large results to prevent memory issues
 */
function truncateResult(result: unknown, maxLength: number = MAX_CONTEXT_SIZE): string {
  if (typeof result === "string") {
    return result.substring(0, maxLength);
  }
  return JSON.stringify(result).substring(0, maxLength);
}

/**
 * Core agent workflow execution logic
 */
async function executeAgentWorkflow(
  instruction: string,
  language: SupportedLang,
  provider: ProviderName | null,
  temperature: number,
  maxTokens: number,
  sendProgress: (step: AgentExecutionStep) => void
): Promise<AgentWorkflowResult> {
  const steps: AgentExecutionStep[] = [];
  let currentContext = instruction;
  let iteration = 0;

  // Send initial planning step
  sendProgress({
    type: "planning",
    message: language === "zh" ? "正在分析任务..." : "Analyzing task...",
    timestamp: new Date().toISOString(),
  });

  while (iteration < MAX_AGENT_ITERATIONS) {
    iteration++;

    // Ask LLM to decide next action
    const decision = await planNextAction(
      instruction,
      currentContext,
      steps,
      language,
      provider,
      temperature,
      maxTokens
    );

    logger.info(`Agent iteration ${iteration}: action=${decision.action}`);

    if (decision.action === "finish") {
      // Task completed
      sendProgress({
        type: "complete",
        message: decision.reasoning || (language === "zh" ? "任务完成" : "Task completed"),
        timestamp: new Date().toISOString(),
      });

      return {
        instruction,
        steps,
        finalResult: decision.result || (language === "zh" ? "任务已完成" : "Task completed"),
        success: true,
      };
    }

    if (decision.action === "call_tool") {
      // Execute tool call
      const toolCall = decision.tool_call;
      if (!toolCall) {
        throw new Error("Tool call decision missing tool_call details");
      }

      const tool = agentTools.find((t) => t.name === toolCall.name);
      if (!tool) {
        throw new Error(`Unknown tool: ${toolCall.name}`);
      }

      // Send tool execution progress
      sendProgress({
        type: "tool_execution",
        message: `${language === "zh" ? "执行工具" : "Executing tool"}: ${tool.display_name[language]}`,
        tool: tool.name,
        timestamp: new Date().toISOString(),
      });

      try {
        // Execute the tool
        const toolResult = await tool.execute(toolCall.parameters);

        // Truncate large results for context to avoid memory issues
        const resultSummary = truncateResult(toolResult);

        const stepRecord: AgentExecutionStep = {
          type: "tool_execution",
          message: `${language === "zh" ? "工具执行成功" : "Tool executed successfully"}: ${tool.display_name[language]}`,
          tool: tool.name,
          parameters: toolCall.parameters,
          result: toolResult,
          timestamp: new Date().toISOString(),
        };
        steps.push(stepRecord);

        sendProgress({
          ...stepRecord,
          message: `${language === "zh" ? "✓ 完成" : "✓ Completed"}: ${tool.display_name[language]}`,
        });

        // Update context with truncated result
        currentContext = `Previous instruction: ${instruction}\n\nLast action: Used ${tool.name}\nResult: ${resultSummary}`;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Tool execution error: ${tool.name}`, error);

        const errorStep: AgentExecutionStep = {
          type: "error",
          message: `${language === "zh" ? "工具执行失败" : "Tool execution failed"}: ${tool.display_name[language]} - ${errorMsg}`,
          tool: tool.name,
          timestamp: new Date().toISOString(),
        };
        steps.push(errorStep);
        sendProgress(errorStep);

        // Continue with error information
        currentContext = `Previous instruction: ${instruction}\n\nLast action failed: ${tool.name}\nError: ${errorMsg}`;
      }
    } else {
      // Unknown action
      throw new Error(`Unknown action: ${decision.action}`);
    }
  }

  // Max iterations reached
  sendProgress({
    type: "error",
    message: language === "zh" ? "达到最大迭代次数" : "Maximum iterations reached",
    timestamp: new Date().toISOString(),
  });

  return {
    instruction,
    steps,
    finalResult: language === "zh" ? "任务未完成（达到最大迭代次数）" : "Task incomplete (max iterations reached)",
    success: false,
  };
}

type AgentDecision = {
  action: "call_tool" | "finish";
  reasoning?: string;
  tool_call?: AgentToolCall;
  result?: string;
};

/**
 * Use LLM to plan the next action
 */
async function planNextAction(
  instruction: string,
  context: string,
  previousSteps: AgentExecutionStep[],
  language: SupportedLang,
  provider: ProviderName | null,
  temperature: number,
  maxTokens: number
): Promise<AgentDecision> {
  const toolDescriptions = agentTools.map((tool) => ({
    name: tool.name,
    display_name: tool.display_name[language],
    description: tool.description[language],
    parameters: tool.parameters,
  }));

  const systemPrompt = language === "zh"
    ? `你是一个智能文件处理助手。用户会给你一个指令，你需要分析并使用可用的工具来完成任务。

可用工具：
${JSON.stringify(toolDescriptions, null, 2)}

你需要决定：
1. 如果任务已完成，返回 action: "finish" 和结果
2. 如果需要使用工具，返回 action: "call_tool" 并指定工具名称和参数

注意：
- 一次只能调用一个工具
- 仔细分析用户指令，选择最合适的工具
- 如果不确定，优先选择能获取更多信息的工具`
    : `You are an intelligent file processing assistant. Users will give you instructions, and you need to analyze and use available tools to complete tasks.

Available tools:
${JSON.stringify(toolDescriptions, null, 2)}

You need to decide:
1. If the task is complete, return action: "finish" with the result
2. If you need to use a tool, return action: "call_tool" with tool name and parameters

Note:
- Only one tool can be called at a time
- Carefully analyze user instructions and choose the most appropriate tool
- If unsure, prioritize tools that can gather more information`;

  const previousStepsText = previousSteps.length > 0
    ? `\n\nPrevious steps:\n${previousSteps.map((s, i) => `${i + 1}. ${s.type}: ${s.message}`).join("\n")}`
    : "";

  const userPrompt = `User instruction: ${instruction}\n\nCurrent context: ${context}${previousStepsText}\n\nWhat should I do next?`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  const responseFormat = {
    json_schema: {
      name: "agent_decision_schema",
      schema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["call_tool", "finish"],
            description: "The action to take: call_tool or finish",
          },
          reasoning: {
            type: "string",
            description: "Explanation of why this action was chosen",
          },
          tool_call: {
            type: "object",
            properties: {
              name: { type: "string" },
              parameters: { type: "object" },
            },
            required: ["name", "parameters"],
            description: "Tool to call (only if action is call_tool)",
          },
          result: {
            type: "string",
            description: "Final result (only if action is finish)",
          },
        },
        required: ["action", "reasoning"],
      },
      strict: true,
    },
  } as const;

  const result = await generateStructuredJson(
    messages,
    responseFormat,
    temperature,
    maxTokens,
    "",
    language,
    provider || undefined
  );

  return result as AgentDecision;
}
