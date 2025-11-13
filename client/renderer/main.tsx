import React from 'react'
import ReactDOM from 'react-dom/client'
import { StyleProvider } from '@ant-design/cssinjs'
import App from './App.tsx'
import './index.css'
import { I18nProvider } from './shared/i18n/I18nProvider'
import { initializeSentry } from './shared/utils/sentryClient'

const renderApp = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <StyleProvider hashPriority="high">
        <I18nProvider>
          <App />
        </I18nProvider>
      </StyleProvider>
    </React.StrictMode>,
  )
}

void (async () => {
  try {
    await initializeSentry()
  } catch (error) {
    console.error('Failed to initialize Sentry client before rendering', error)
  } finally {
    renderApp()
  }
})()

// // Use contextBridge
// window.ipcRenderer.on('main-process-message', (_event, message) => {
//   console.log(message)
// })

// window.ipcRenderer.on('import-result', (_event, result) => {
//   console.log('Import result:', result)
//   // You could show a notification or update UI here
  
// })
