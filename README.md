# AiFileManager

A smart file manager powered by AI. It automatically classifies your imported files into the most suitable folders and tags them intelligently based on their content, making future search and retrieval easy. You can also import files into a local knowledge base and use large language models for intelligent Q&A.

## Features

- 📁 **Document Import and Management** - Supports multiple document formats, automatically converts to Markdown format
- 🏷️ **Intelligent Classification** - Automatically classifies and tags documents
- 🔍 **Semantic Search** - Intelligent document retrieval based on vector database
- 💬 **Intelligent Q&A** - Document content Q&A based on RAG technology
- 🗄️ **Local Storage** - All data stored locally, protecting privacy and security
- 🖥️ **Cross-Platform Support** - Supports Windows and macOS systems

## Technical Architecture

- **Frontend Interface**: Electron + React + TypeScript
- **Local Service Layer**: Embedded Node.js (Express) server inside the Electron main process
- **Document Processing**: Remote file conversion via the configurable `fileConvertEndpoint` service (with Node orchestration)
- **Data Storage**: SQLite (document metadata via Sequelize) + Faiss vector index (faiss-node)
- **AI Models**: Pluggable LLM / embedding providers (OpenAI, Azure, OpenRouter, Bailian, Ollama, etc.)

## Project Structure

```
ai_file_manager/
├── client/
│   ├── electron/       # Electron main process + embedded Express APIs
│   ├── renderer/       # React frontend (Vite)
│   ├── public/         # Static assets packaged with the renderer
│   └── package.json    # Client dependencies & scripts
├── database/           # SQLite database and FAISS index files (runtime generated)
├── locales/            # Legacy translation fallback (renderer uses client/locales)
├── temp/               # Temporary converted/imported documents
└── README.md
```

## Main Functional Modules

### 1. File Management
- Document import and format conversion
- Automatic classification and summary generation
- File list and filtering functions

### 2. Intelligent Retrieval
- Semantic-based document search
- Supports keyword and natural language queries
- Relevance-ranked result display

### 3. RAG Q&A
- Intelligent Q&A based on document content
- Provides answer source traceability
- Supports context understanding

### 4. Local Data Management
- SQLite stores document metadata
- Vector database stores document embeddings
- Local model deployment, data not uploaded

## Development Status

🚧 Project under development...

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Tag
Tagged with #ForTheLoveOfCode
## Internationalization

Shared translations now live in `client/locales/`. The React renderer imports JSON via the `@locales` alias, and the Electron main process (`client/electron/languageHelper.ts`) loads the same files with a fallback to the legacy root `locales/` directory. To add a language, create `<lang>.json` in `client/locales/` mirroring the existing structure, then restart the desktop application.

