# AI Document Manager

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

The app now reads shared translations from the new `locales/` directory. React screens load the dictionaries through the `I18nProvider`, and the Python FastAPI backend can access the same JSON files via `python/i18n.py`. Add new languages by creating another JSON file in `locales/`, keeping the key structure in sync, and restart the desktop application.

