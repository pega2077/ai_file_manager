# Agentic File Processing Tool

## Overview

The AI File Manager now includes an intelligent agent system that can understand natural language instructions and automatically execute complex, multi-step tasks using the available file management tools.

## Features

### 🤖 Natural Language Processing
- Users can input vague or complex instructions in natural language (English or Chinese)
- The AI agent analyzes the instruction and plans the necessary steps
- No need to know specific API endpoints or commands

### 🔧 Automatic Tool Selection
The agent can intelligently choose from 11 available tools:
- **File Operations**: Import, list, convert files
- **Tag Management**: Extract and update file tags
- **Image Recognition**: Analyze and describe images
- **Search**: Semantic search and RAG Q&A
- **Directory Management**: List directories and recommend save locations
- **File Details**: Retrieve detailed file information

### 📊 Real-time Progress Tracking
- Server-sent events (SSE) streaming for real-time updates
- Step-by-step execution display
- Shows tool selection, parameters, and results
- Error handling with clear feedback

### 🌍 Bilingual Support
- Full support for English and Chinese
- UI and API responses adapt to user's language preference

## How It Works

1. **User Input**: Enter a vague instruction like "帮我导入这个PDF文件并提取关键标签" (Help me import this PDF file and extract key tags)

2. **Analysis**: The LLM analyzes the instruction and plans the steps needed

3. **Execution**: The agent automatically:
   - Selects the appropriate tools
   - Executes them in sequence
   - Handles errors and retries if needed
   - Provides real-time progress updates

4. **Results**: Shows the final result and complete execution history

## Usage

### Frontend UI

Navigate to `/agent` in the application to access the agent interface:

1. Enter your instruction in the text area
2. Click "Execute" button
3. Watch real-time progress as the agent works
4. View the final results

### API Endpoint

```bash
POST /api/agent/execute

{
  "instruction": "Import and analyze this PDF file",
  "language": "en",
  "stream": true
}
```

See [API.md](../API.md#9-智能代理模块接口) for detailed API documentation.

## Examples

### Example 1: File Import and Tag Extraction
```
Instruction: "帮我导入 /path/to/document.pdf 并提取关键标签"

Agent Actions:
1. Uses import_file tool to import the PDF
2. Uses extract_tags tool to analyze and extract tags
3. Returns the imported file details and extracted tags
```

### Example 2: Semantic Search and Summarization
```
Instruction: "Find all documents about machine learning and summarize the key points"

Agent Actions:
1. Uses semantic_search tool to find relevant documents
2. Uses ask_question tool to summarize the content
3. Returns the summary and source documents
```

### Example 3: Image Analysis
```
Instruction: "Analyze the image at /path/to/image.jpg and tell me what it shows"

Agent Actions:
1. Uses describe_image tool to analyze the image
2. Returns detailed description of the image content
```

## Architecture

### Backend Components

1. **agentController.ts**: Main orchestration logic
   - Handles API requests
   - Manages execution loop
   - Streams progress updates
   - Error handling and recovery

2. **agentTools.ts**: Tool definitions
   - Wraps existing APIs as tools
   - Defines tool schemas and parameters
   - Executes tool calls

### Frontend Components

1. **Agent.tsx**: React UI component
   - Text input for instructions
   - Real-time execution timeline
   - Results display
   - Error handling

### LLM Integration

The agent uses the configured LLM provider to:
- Analyze user instructions
- Plan execution steps
- Decide which tools to use and when
- Generate final summaries

## Limitations

- Maximum 10 iterations per execution (prevents infinite loops)
- Depends on LLM quality for tool selection
- Complex tasks may take longer to complete
- Some tools require specific file formats or conditions

## Future Enhancements

- [ ] Add more tools for advanced operations
- [ ] Support for parallel tool execution
- [ ] Conversation history and context
- [ ] User feedback and learning
- [ ] Custom tool creation by users
- [ ] Workflow templates for common tasks

## Technical Details

### Tool Selection Algorithm

The agent uses a structured JSON response from the LLM to decide actions:

```typescript
{
  "action": "call_tool" | "finish",
  "reasoning": "Why this action was chosen",
  "tool_call": {
    "name": "tool_name",
    "parameters": { ... }
  }
}
```

### Error Handling

- Tool execution errors are captured and logged
- Agent can continue with alternate approaches
- User receives clear error messages
- Failed steps are visible in the execution timeline

### Performance Considerations

- Streaming responses minimize perceived latency
- Tool executions are sequential (not parallel yet)
- LLM calls are the main performance bottleneck
- Typical execution time: 5-30 seconds depending on complexity

## Contributing

To add a new tool:

1. Define the tool schema in `agentTools.ts`
2. Implement the execution function
3. Update the tool descriptions for LLM
4. Test with various instructions

See the existing tools for examples.
