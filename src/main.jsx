import React from 'react';
import { createRoot } from 'react-dom/client';
import ConstructionChatbot from '../App.js';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConstructionChatbot />
  </React.StrictMode>
);
