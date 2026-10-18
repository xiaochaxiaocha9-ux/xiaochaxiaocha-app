import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./style.css";
import "katex/dist/katex.min.css";
const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new Event("app-update-ready"));
  },
  onOfflineReady() {
    window.dispatchEvent(new Event("app-offline-ready"));
  },
});
window.addEventListener("app-apply-update", () => {
  void updateSW(true);
});
createRoot(document.getElementById("root")!).render(<App />);
