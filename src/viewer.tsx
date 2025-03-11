import React from 'react'
import ReactDOM from 'react-dom/client'
import Viewer from './pages/Viewer'
import './index.css'

// 确保DOM元素存在
const rootElement = document.getElementById('root');
if (!rootElement) {
  const newRoot = document.createElement('div');
  newRoot.id = 'root';
  document.body.appendChild(newRoot);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Viewer />
  </React.StrictMode>,
) 