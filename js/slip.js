// Oddaroa slip — shared localStorage bet slip for every page.
// A selection: {id, match, market, pick, odd}
(function () {
  const KEY = "oddaroa-slip";
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const set = (s) => { localStorage.setItem(KEY, JSON.stringify(s)); renderBadge(); renderDrawer(); };

  window.OddSlip = {
    all: get,
    has: (id) => get().some((s) => s.id === id),
    toggle(sel) {
      let s = get();
      if (s.some((x) => x.id === sel.id)) s = s.filter((x) => x.id !== sel.id);
      else { s = s.filter((x) => !(x.match === sel.match && x.group === sel.group)); s.push(sel); }
      set(s); return s.some((x) => x.id === sel.id);
    },
    add(sel) {
      let s = get();
      if (!s.some((x) => x.id === sel.id)) {
        s = s.filter((x) => !(x.match === sel.match && x.group === sel.group)); s.push(sel); set(s);
      }
      return get().some((x) => x.id === sel.id);
    },
    remove(id) { set(get().filter((s) => s.id !== id)); },
    clear() { set([]); },
    total() { return get().reduce((a, s) => a * Number(s.odd), 1); },
  };

  function renderBadge() {
    document.querySelectorAll(".slip-count").forEach((el) => { el.textContent = get().length; });
  }
  function money(n) { return "GH₵ " + n.toFixed(2); }

  function renderDrawer() {
    const box = document.getElementById("drawerItems"); if (!box) return;
    const s = get();
    box.innerHTML = s.length ? "" : '<p style="color:var(--muted)">Your slip is empty. Tap any odd to add it.</p>';
    s.forEach((sel) => {
      const d = document.createElement("div"); d.className = "slip-item"; d.style.marginBottom = "8px";
      d.innerHTML = `<div><div class="pick"></div><div class="sub"></div></div>
        <div style="text-align:right"><div class="odd">${Number(sel.odd).toFixed(2)}</div>
        <button class="x-btn" aria-label="Remove">×</button></div>`;
      d.querySelector(".pick").textContent = sel.pick;
      d.querySelector(".sub").textContent = sel.match + " · " + sel.market;
      d.querySelector(".x-btn").onclick = () => { OddSlip.remove(sel.id); document.querySelectorAll(`[data-sel="${sel.id}"]`).forEach(b => b.classList.remove("selected")); };
      box.appendChild(d);
    });
    const t = document.getElementById("drawerTotal");
    if (t) t.textContent = s.length ? OddSlip.total().toFixed(2) : "—";
  }

  // Build the shared drawer + floating button once, on every page.
  document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("slipDrawer")) {
      const scrim = document.createElement("div"); scrim.id = "scrim"; scrim.hidden = true;
      const drawer = document.createElement("aside"); drawer.id = "slipDrawer";
      drawer.innerHTML = `<h2>My Slip <span class="slip-count">0</span></h2>
        <div id="drawerItems"></div>
        <div class="totals"><div class="row"><span>Total odds</span><b id="drawerTotal">—</b></div>
        <a class="btn gold" href="slip.html" style="width:100%">Open slip &amp; stake</a>
        <button class="btn danger" id="drawerClear" style="width:100%;margin-top:8px">Clear slip</button></div>`;
      const fab = document.createElement("button"); fab.id = "fab"; fab.innerHTML = 'Slip <span class="slip-count">0</span>';
      document.body.append(scrim, drawer, fab);
      const open = (o) => { drawer.classList.toggle("open", o); scrim.hidden = !o; if (o) renderDrawer(); };
      fab.onclick = () => open(true); scrim.onclick = () => open(false);
      drawer.querySelector("#drawerClear").onclick = () => { OddSlip.clear(); document.querySelectorAll(".odds-btn.selected").forEach(b => b.classList.remove("selected")); };
    }
    renderBadge(); renderDrawer();
  });
})();
