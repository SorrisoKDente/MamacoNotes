import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

const isDesktop =
  typeof window !== 'undefined' &&
  !!(window as unknown as { inkfolioDesktop?: unknown }).inkfolioDesktop

const isCapacitor =
  typeof window !== 'undefined' &&
  !!(window as unknown as { Capacitor?: unknown }).Capacitor

if (!isDesktop && !isCapacitor) {
  registerSW({ immediate: true })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
