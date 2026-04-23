// Vite akan bundle CSS ini bersama JS
import "./style.css";

// Tandai body sebagai ready setelah CSS terapply → fade in (anti-FOUC)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(() => document.body.classList.add("km-ready")));
} else {
  requestAnimationFrame(() => document.body.classList.add("km-ready"));
}
