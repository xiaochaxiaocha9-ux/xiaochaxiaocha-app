import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./style.css";
import "katex/dist/katex.min.css";
registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new Event("app-update-ready"));
  },
  onOfflineReady() {
    window.dispatchEvent(new Event("app-offline-ready"));
  },
});
createRoot(document.getElementById("root")!).render(<App />);
