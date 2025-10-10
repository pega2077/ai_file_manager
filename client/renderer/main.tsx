import React from 'react'
import ReactDOM from 'react-dom/client'
import { StyleProvider } from '@ant-design/cssinjs'
import App from './App.tsx'
import './index.css'
import { I18nProvider } from './shared/i18n/I18nProvider'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StyleProvider hashPriority="high">
      <I18nProvider>
        <App />
      </I18nProvider>
    </StyleProvider>
  </React.StrictMode>,
)

// // Use contextBridge
// window.ipcRenderer.on('main-process-message', (_event, message) => {
//   console.log(message)
// })

// window.ipcRenderer.on('import-result', (_event, result) => {
//   console.log('Import result:', result)
//   // You could show a notification or update UI here
  
// })
