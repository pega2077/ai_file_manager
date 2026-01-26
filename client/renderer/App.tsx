import { useEffect } from 'react';
import type { IpcRenderer, IpcRendererEvent } from 'electron';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { ThemeProvider } from './shared/theme';
import Landing from './pages/Landing';
import Directories from './pages/Directories';
import Files from './pages/Files';
import Search from './pages/Search';
import Setup from './pages/Setup';
import LLMSetup from './pages/LLMSetup';
import Settings from './pages/Settings';
import Bot from './pages/Bot';
import Convert from './pages/Convert';
import Agent from './pages/Agent';
import PegaAuth from './pages/PegaAuth';
import OllamaConfig from './pages/providers/OllamaConfig';
import OpenAIConfig from './pages/providers/OpenAIConfig';
import OpenRouterConfig from './pages/providers/OpenRouterConfig';
import BailianConfig from './pages/providers/BailianConfig';
import LlamaCppConfig from './pages/providers/LlamaCppConfig';

type NavigationPayload = {
  route?: string;
  refreshFiles?: boolean;
};

const NavigationBridge = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const ipcRenderer = (window as Window & typeof globalThis & { ipcRenderer?: IpcRenderer }).ipcRenderer;

    if (!ipcRenderer?.on || !ipcRenderer?.off) {
      return undefined;
    }

    const handler = (_event: IpcRendererEvent, payload?: NavigationPayload) => {
      if (payload?.route) {
        navigate(payload.route);
      }
      if (payload?.refreshFiles) {
        window.dispatchEvent(new CustomEvent('files:refresh'));
      }
    };

    ipcRenderer.on('renderer:navigate', handler);

    return () => {
      ipcRenderer.off('renderer:navigate', handler);
    };
  }, [navigate]);

  return null;
};

function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <NavigationBridge />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/home" element={<Directories />} />
          <Route path="/files" element={<Files />} />
          <Route path="/search" element={<Search />} />
          <Route path="/agent" element={<Agent />} />
          <Route path="/llm-setup" element={<LLMSetup />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/pega-auth" element={<PegaAuth />} />
          <Route path="/settings/providers/ollama" element={<OllamaConfig />} />
          <Route path="/settings/providers/openai" element={<OpenAIConfig />} />
          <Route path="/settings/providers/openrouter" element={<OpenRouterConfig />} />
          <Route path="/settings/providers/bailian" element={<BailianConfig />} />
          <Route path="/settings/providers/llamacpp" element={<LlamaCppConfig />} />
          <Route path="/bot" element={<Bot />} />
          <Route path="/convert" element={<Convert />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;
