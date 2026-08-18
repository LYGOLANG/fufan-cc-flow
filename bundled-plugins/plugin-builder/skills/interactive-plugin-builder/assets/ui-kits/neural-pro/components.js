(function () {
  "use strict";

  window.pkTheme = function (mode) {
    if (mode === "dark" || mode === "light") {
      document.documentElement.setAttribute("data-theme", mode);
    } else {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
    }
    return document.documentElement.getAttribute("data-theme");
  };

  window.pkRand = function (i, k) {
    const x = Math.sin(i * 127.1 + (k === undefined ? 1 : k) * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  window.pkToast = function (message, duration) {
    const el = document.createElement("div");
    el.className = "pk-toast";
    el.setAttribute("role", "status");
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, duration || 2600);
  };

  window.pkModal = {
    open: function (id) {
      const el = document.getElementById(id);
      if (el) { el.style.display = "flex"; }
    },
    close: function (id) {
      const el = document.getElementById(id);
      if (el) { el.style.display = "none"; }
    },
  };

  document.addEventListener("click", function (event) {
    const tab = event.target.closest("[data-pk-tab]");
    if (tab) {
      const group = tab.closest(".pk-tabs");
      if (group) {
        group.querySelectorAll(".pk-tab").forEach(function (t) { t.classList.remove("is-on"); });
        tab.classList.add("is-on");
        const targetId = tab.getAttribute("data-pk-tab");
        document.querySelectorAll("[data-pk-tab-panel]").forEach(function (panel) {
          if (panel.getAttribute("data-pk-tab-panel-group") === group.getAttribute("data-pk-tab-group")) {
            panel.hidden = panel.getAttribute("data-pk-tab-panel") !== targetId;
          }
        });
      }
    }
    const chip = event.target.closest(".pk-chip[data-pk-toggle]");
    if (chip) { chip.classList.toggle("is-on"); }
    const seg = event.target.closest(".pk-seg button");
    if (seg) {
      seg.parentElement.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-selected", b === seg ? "true" : "false");
      });
    }
    const treeRow = event.target.closest(".pk-tree div");
    if (treeRow) {
      treeRow.closest(".pk-tree").querySelectorAll("div").forEach(function (r) {
        r.setAttribute("aria-selected", r === treeRow ? "true" : "false");
      });
    }
    const thumb = event.target.closest(".pk-thumb");
    if (thumb && thumb.parentElement) {
      thumb.parentElement.querySelectorAll(".pk-thumb").forEach(function (t) {
        t.setAttribute("aria-selected", t === thumb ? "true" : "false");
      });
    }
    const backdrop = event.target.closest(".pk-modal-backdrop");
    if (backdrop && event.target === backdrop) { backdrop.style.display = "none"; }
  });

  document.addEventListener("pointerdown", function (event) {
    const label = event.target.closest(".pk-scrub b");
    if (!label) { return; }
    const input = label.parentElement.querySelector("input");
    if (!input) { return; }
    event.preventDefault();
    label.setPointerCapture(event.pointerId);
    const x0 = event.clientX;
    const v0 = parseFloat(input.value) || 0;
    const dec = (String(input.value).split(".")[1] || "").length;
    const step = dec >= 3 ? 0.005 : dec === 2 ? 0.05 : 0.5;
    function move(e) { input.value = (v0 + (e.clientX - x0) * step).toFixed(dec); }
    function up() {
      label.removeEventListener("pointermove", move);
      label.removeEventListener("pointerup", up);
    }
    label.addEventListener("pointermove", move);
    label.addEventListener("pointerup", up);
  });
})();
