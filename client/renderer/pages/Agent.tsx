import React, { useState, useRef, useEffect } from "react";
import { Input, Card, Typography, Space, Timeline, Tag, Spin, Button, message } from "antd";
import { SendOutlined, ThunderboltOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import { apiService } from "../services/api";
import { useTranslation } from "../shared/i18n/I18nProvider";
import "./Agent.css";

const { TextArea } = Input;
const { Title, Text, Paragraph } = Typography;

type ExecutionStep = {
  type: "planning" | "tool_execution" | "complete" | "error";
  message: string;
  tool?: string;
  parameters?: Record<string, unknown>;
  result?: unknown;
  timestamp: string;
};

type AgentResult = {
  instruction: string;
  steps: ExecutionStep[];
  finalResult: string;
  success: boolean;
};

const Agent: React.FC = () => {
  const { t, locale } = useTranslation();
  const [instruction, setInstruction] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when steps update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const handleExecute = async () => {
    if (!instruction.trim()) {
      message.warning(locale === "zh" ? "请输入指令" : "Please enter an instruction");
      return;
    }

    setIsExecuting(true);
    setSteps([]);
    setFinalResult(null);
    setError(null);

    try {
      // Call the agent API with streaming
      const response = await fetch(`${apiService.getBaseUrl()}/api/agent/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instruction,
          language: locale,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.substring(6);
            try {
              const parsed = JSON.parse(data);

              if (parsed.type === "complete") {
                // Final result
                const result = parsed.result as AgentResult;
                setFinalResult(result.finalResult);
              } else if (parsed.type === "error") {
                setError(parsed.message);
              } else {
                // Add step to timeline
                setSteps((prev) => [...prev, parsed as ExecutionStep]);
              }
            } catch (e) {
              console.error("Failed to parse SSE data:", e);
            }
          }
        }
      }
    } catch (err) {
      console.error("Agent execution error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      message.error(locale === "zh" ? "执行失败" : "Execution failed");
    } finally {
      setIsExecuting(false);
    }
  };

  const getStepIcon = (step: ExecutionStep) => {
    switch (step.type) {
      case "planning":
        return <ThunderboltOutlined style={{ color: "#1890ff" }} />;
      case "tool_execution":
        return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
      case "complete":
        return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
      case "error":
        return <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />;
      default:
        return null;
    }
  };

  const getStepColor = (step: ExecutionStep): string => {
    switch (step.type) {
      case "planning":
        return "blue";
      case "tool_execution":
        return "green";
      case "complete":
        return "green";
      case "error":
        return "red";
      default:
        return "default";
    }
  };

  const renderStepContent = (step: ExecutionStep): React.ReactElement => {
    return (
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Text strong>{step.message}</Text>
        {step.tool && (
          <Tag color={getStepColor(step)}>
            {locale === "zh" ? "工具" : "Tool"}: {step.tool}
          </Tag>
        )}
        {step.parameters && Object.keys(step.parameters).length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", color: "#1890ff" }}>
              {locale === "zh" ? "参数" : "Parameters"}
            </summary>
            <pre
              style={{
                background: "#f5f5f5",
                padding: 8,
                borderRadius: 4,
                marginTop: 4,
                fontSize: 12,
              }}
            >
              {JSON.stringify(step.parameters, null, 2)}
            </pre>
          </details>
        )}
        {step.result ? (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", color: "#1890ff" }}>
              {locale === "zh" ? "结果" : "Result"}
            </summary>
            <pre
              style={{
                background: "#f5f5f5",
                padding: 8,
                borderRadius: 4,
                marginTop: 4,
                fontSize: 12,
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {typeof step.result === "string"
                ? step.result
                : JSON.stringify(step.result ?? {}, null, 2)}
            </pre>
          </details>
        ) : null}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(step.timestamp).toLocaleTimeString()}
        </Text>
      </Space>
    );
  };

  return (
    <div className="agent-page">
      <div className="agent-header">
        <Title level={2}>
          <ThunderboltOutlined /> {locale === "zh" ? "智能助手" : "AI Agent"}
        </Title>
        <Paragraph type="secondary">
          {locale === "zh"
            ? "输入模糊指令，AI助手将自动分析并选择合适的工具完成任务"
            : "Enter a vague instruction, and the AI agent will automatically analyze and select appropriate tools to complete the task"}
        </Paragraph>
      </div>

      <Card className="agent-input-card">
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <div>
            <Text strong style={{ marginBottom: 8, display: "block" }}>
              {locale === "zh" ? "输入指令" : "Enter Instruction"}
            </Text>
            <TextArea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={
                locale === "zh"
                  ? "例如: 帮我导入并分析这个PDF文件，提取关键标签..."
                  : "e.g., Import and analyze this PDF file, extract key tags..."
              }
              rows={4}
              disabled={isExecuting}
            />
          </div>
          <Button
            type="primary"
            size="large"
            icon={<SendOutlined />}
            onClick={handleExecute}
            loading={isExecuting}
            block
          >
            {isExecuting
              ? locale === "zh"
                ? "执行中..."
                : "Executing..."
              : locale === "zh"
              ? "执行"
              : "Execute"}
          </Button>
        </Space>
      </Card>

      {(steps.length > 0 || isExecuting) && (
        <Card className="agent-execution-card" title={locale === "zh" ? "执行过程" : "Execution Process"}>
          <Timeline>
            {steps.map((step, index) => (
              <Timeline.Item key={index} dot={getStepIcon(step)}>
                {renderStepContent(step)}
              </Timeline.Item>
            ))}
            {isExecuting && (
              <Timeline.Item dot={<Spin size="small" />}>
                <Text type="secondary">
                  {locale === "zh" ? "处理中..." : "Processing..."}
                </Text>
              </Timeline.Item>
            )}
          </Timeline>
          <div ref={bottomRef} />
        </Card>
      )}

      {finalResult && (
        <Card
          className="agent-result-card"
          title={locale === "zh" ? "执行结果" : "Execution Result"}
          style={{ marginTop: 16 }}
        >
          <Paragraph>{finalResult}</Paragraph>
        </Card>
      )}

      {error && (
        <Card
          className="agent-error-card"
          title={locale === "zh" ? "错误" : "Error"}
          style={{ marginTop: 16, borderColor: "#ff4d4f" }}
        >
          <Text type="danger">{error}</Text>
        </Card>
      )}
    </div>
  );
};

export default Agent;
