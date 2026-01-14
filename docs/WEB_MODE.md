# Web Mode Documentation

## Overview

The ai_file_manager now supports both Electron desktop mode and standalone web server mode. This allows you to deploy the application as a web service without requiring Electron.

## Building for Web Mode

### 1. Build the React Application

```bash
cd client
npm run build:web
```

This command:
- Builds the React frontend to `client/builds/web/`
- Compiles the standalone server to `client/builds/electron/`

### 2. Start the Standalone Server

```bash
cd client
npm run start:web
```

The server will start on `http://127.0.0.1:8000` by default (configurable in `config.json`).

## Configuration

The standalone server uses the same `config.json` file as the Electron app. Create or modify `client/config.json`:

```json
{
  "useLocalService": true,
  "localServicePort": 8000,
  "localServiceHost": "127.0.0.1",
  "llmProvider": "ollama",
  "sqliteDbPath": "database/files.db",
  "fileConvertEndpoint": "https://converter.pegamob.com",
  ...
}
```

## Directory Structure

```
client/
├── builds/
│   ├── web/               # Static React build output
│   │   ├── index.html
│   │   └── assets/
│   └── electron/          # Compiled server code
│       └── electron/
│           └── standaloneServer.js
├── config.json            # Server configuration
├── database/              # SQLite database and FAISS index
│   ├── files.db
│   └── vectors/
└── locales/               # Translation files
    ├── en.json
    └── zh.json
```

## Feature Differences

### Electron Mode (Desktop)
- ✅ Full file system access via native dialogs
- ✅ System tray integration
- ✅ Native notifications
- ✅ Window management
- ✅ Video screenshot capture using BrowserWindow
- ✅ Web page fetching using BrowserWindow

### Web Mode (Standalone Server)
- ✅ Full API functionality
- ✅ File upload via API
- ✅ Document processing and RAG
- ✅ LLM integration
- ⚠️ Limited file system access (upload only)
- ⚠️ No native file dialogs
- ⚠️ Video processing: screenshots not supported (nativeImage unavailable)
- ⚠️ Web page fetching: not supported (BrowserWindow unavailable)

## Deployment

### Production Deployment

1. **Build the application:**
   ```bash
   cd client
   npm run build:web
   ```

2. **Copy files to server:**
   ```bash
   # Copy these directories to your server:
   builds/
   config.json
   locales/
   database/ (optional - will be created if not exists)
   ```

3. **Install dependencies:**
   ```bash
   npm install --production
   ```

4. **Start the server:**
   ```bash
   npm run start:web
   ```

### Using a Process Manager

For production, use a process manager like PM2:

```bash
# Install PM2
npm install -g pm2

# Start the server
pm2 start npm --name "ai-file-manager" -- run start:web

# Save the process list
pm2 save

# Set up auto-start on boot
pm2 startup
```

### Using Docker

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY client/package*.json ./

# Install dependencies
RUN npm install --production

# Copy built files
COPY client/builds ./builds
COPY client/config.json ./
COPY client/locales ./locales

# Create data directory
RUN mkdir -p database/vectors

# Expose port
EXPOSE 8000

# Start server
CMD ["npm", "run", "start:web"]
```

Build and run:

```bash
docker build -t ai-file-manager .
docker run -d -p 8000:8000 -v $(pwd)/data:/app/database ai-file-manager
```

## Reverse Proxy Setup

### Nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Apache

```apache
<VirtualHost *:80>
    ServerName your-domain.com
    
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8000/
    ProxyPassReverse / http://127.0.0.1:8000/
    
    <Location />
        Order allow,deny
        Allow from all
    </Location>
</VirtualHost>
```

## Environment Variables

You can override configuration using environment variables:

- `PORT` - Server port (default: 8000)
- `HOST` - Server host (default: 127.0.0.1)
- `LANG` - System language (default: zh, options: zh, en)

## Troubleshooting

### Server won't start

1. Check if port 8000 is already in use:
   ```bash
   lsof -i :8000
   ```

2. Check config.json exists and is valid JSON

3. Check logs in `client/logs/` directory

### API returns 404

- Ensure all routes start with `/api/`
- Check server logs for errors
- Verify the server started successfully

### Static files not loading

- Ensure `builds/web/` directory exists and contains index.html
- Check the console for path errors
- Verify static file middleware is registered before catch-all route

### Database errors

- Ensure `database/` directory is writable
- Check SQLite database path in config.json
- Verify FAISS index directory exists: `database/vectors/`

## API Endpoints

The standalone server exposes the same API endpoints as the Electron version:

- `POST /api/files/*` - File operations
- `POST /api/chat/*` - Chat/RAG operations
- `POST /api/providers/*` - LLM provider operations
- `GET /api/files/stream` - File streaming
- And more...

See [API.md](../API.md) for complete API documentation.

## Security Considerations

When deploying to production:

1. **Use HTTPS** - Always use SSL/TLS in production
2. **Configure CORS** - Restrict origins if needed
3. **Authentication** - Add authentication middleware if exposing publicly
4. **Rate Limiting** - Implement rate limiting to prevent abuse
5. **Input Validation** - All file uploads are validated by default
6. **Database Backups** - Regularly backup the SQLite database

## Performance Tuning

### For High Traffic

1. **Increase Node.js memory:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm run start:web
   ```

2. **Use a CDN** for static assets

3. **Enable compression:**
   ```javascript
   import compression from 'compression';
   app.use(compression());
   ```

4. **Use a load balancer** for horizontal scaling

### For Large Files

- Adjust the JSON body size limit in `standaloneServer.ts`
- Configure appropriate timeouts for long-running operations
- Consider using cloud storage for very large files

## License

Same as the main project - MIT License
