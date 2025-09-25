# AiFileManager

A desktop document organization and intelligent search program based on RAG (Retrieval-Augmented Generation) technology.

## Features

- 📁 **Document Import and Management** - Supports multiple document formats, automatically converts to Markdown format
- 🏷️ **Intelligent Classification** - Automatically classifies and tags documents
- 🔍 **Semantic Search** - Intelligent document retrieval based on vector database
- 💬 **Intelligent Q&A** - Document content Q&A based on RAG technology
- 🗄️ **Local Storage** - All data stored locally, protecting privacy and security
- 🖥️ **Cross-Platform Support** - Supports Windows and macOS systems

## Technical Architecture

- **Frontend Interface**: Electron + React + TypeScript
- **Backend Service**: Python FastAPI
- **Document Processing**: Pandoc for Markdown conversion
- **Database**: SQLite (document metadata) + Faiss/Chroma (vector database)
- **AI Models**: Local Embedding models + LLM support

## Project Structure

```
ai_file_manager/
├── electron/           # Electron main process
├── renderer/           # React frontend interface
├── python/            # Python backend service
├── workdir/           # User document workspace
├── database/          # SQLite database files
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

Shared translations now live in `client/locales/`. The React renderer imports JSON via the `@locales` alias, and the Python FastAPI backend (`python/i18n.py`) will look in `client/locales/` first and fall back to the legacy root `locales/` if needed. To add a language, create `<lang>.json` in `client/locales/` mirroring the existing structure, and restart the desktop application.

