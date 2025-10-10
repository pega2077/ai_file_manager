import { HashRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import Directories from './pages/Directories';
import Files from './pages/Files';
import Search from './pages/Search';
import Setup from './pages/Setup';
import Settings from './pages/Settings';
import Bot from './pages/Bot';
import Convert from './pages/Convert';
import PegaAuth from './pages/PegaAuth';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/home" element={<Directories />} />
        <Route path="/files" element={<Files />} />
        <Route path="/search" element={<Search />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/settings" element={<Settings />} />
  <Route path="/settings/pega-auth" element={<PegaAuth />} />
        <Route path="/bot" element={<Bot />} />
        <Route path="/convert" element={<Convert />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
