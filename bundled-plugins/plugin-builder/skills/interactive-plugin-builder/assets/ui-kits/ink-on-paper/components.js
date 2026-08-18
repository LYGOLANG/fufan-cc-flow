(function () {
  "use strict";

  window.inkTheme = function (mode) {
    if (mode === "paper" || mode === "carbon") {
      document.documentElement.setAttribute("data-theme", mode);
    } else {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === "carbon" ? "paper" : "carbon";
      document.documentElement.setAttribute("data-theme", next);
    }
    return document.documentElement.getAttribute("data-theme");
  };

  window.inkToast = function (message, duration) {
    const el = document.createElement("div");
    el.className = "ink-toast";
    el.setAttribute("role", "status");
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, duration || 2600);
  };

  window.inkModal = {
    open: function (id) {
      const el = document.getElementById(id);
      if (el) { el.style.display = "flex"; }
    },
    close: function (id) {
      const el = document.getElementById(id);
      if (el) { el.style.display = "none"; }
    },
  };
})();
