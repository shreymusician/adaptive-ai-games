import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { WardenGame } from './pages/WardenGame';
import { FiveGame } from './pages/FiveGame';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/play/warden" element={<WardenGame />} />
        <Route path="/play/five" element={<FiveGame />} />
      </Routes>
    </Router>
  );
}

export default App;
