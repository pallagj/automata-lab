import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import { App } from "./ui/App";
import { syncAcrossTabs } from "./state/store";
import "./ui/styles.css";

syncAcrossTabs();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
