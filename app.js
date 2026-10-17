(function () {
  var SUGGEST = ["bhagyada lakshmi baramma", "krishna nee begane baro", "jagadoddharana adisidale yashode", "tamburi meetidava"];
  var CACHE_KEY = "sangati-search-v3", LANG_KEY = "sangati-voice-lang", TTL = 7 * 24 * 3600 * 1000;
  var cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; } catch (e) { cache = {}; }
  function saveCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {} }
  var reqNo = 0;

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") n.textContent = props[k]; else if (k === "class") n.className = props[k]; else n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function fmtViews(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M views";
    if (n >= 1e3) return Math.round(n / 1e3) + "K views";
    return n + " views";
  }
  function ytUrl(q) { return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q + " devaranama"); }
  function hasKannada(s) { return /[\u0c80-\u0cff]/.test(s); }

  // Kannada script to loose Roman spelling, e.g. ಭಾಗ್ಯದ ಲಕ್ಷ್ಮೀ ಬಾರಮ್ಮ -> bhagyada lakshmi baramma
  var CONS = { "ಕ": "k", "ಖ": "kh", "ಗ": "g", "ಘ": "gh", "ಙ": "ng", "ಚ": "ch", "ಛ": "chh", "ಜ": "j", "ಝ": "jh", "ಞ": "nj", "ಟ": "t", "ಠ": "th", "ಡ": "d", "ಢ": "dh", "ಣ": "n", "ತ": "t", "ಥ": "th", "ದ": "d", "ಧ": "dh", "ನ": "n", "ಪ": "p", "ಫ": "ph", "ಬ": "b", "ಭ": "bh", "ಮ": "m", "ಯ": "y", "ರ": "r", "ಱ": "r", "ಲ": "l", "ಳ": "l", "ವ": "v", "ಶ": "sh", "ಷ": "sh", "ಸ": "s", "ಹ": "h" };
  var VOW = { "ಅ": "a", "ಆ": "a", "ಇ": "i", "ಈ": "i", "ಉ": "u", "ಊ": "u", "ಋ": "ri", "ಎ": "e", "ಏ": "e", "ಐ": "ai", "ಒ": "o", "ಓ": "o", "ಔ": "au" };
  var SIGN = { "ಾ": "a", "ಿ": "i", "ೀ": "i", "ು": "u", "ೂ": "u", "ೃ": "ri", "ೆ": "e", "ೇ": "e", "ೈ": "ai", "ೊ": "o", "ೋ": "o", "ೌ": "au" };
  function translit(s) {
    var out = "", i = 0, ch, nx;
    s = s.replace(/[\u200c\u200d]/g, "");
    while (i < s.length) {
      ch = s.charAt(i);
      if (CONS[ch] !== undefined) {
        out += CONS[ch]; nx = s.charAt(i + 1);
        if (nx === "್") { i += 2; continue; }
        if (SIGN[nx] !== undefined) { out += SIGN[nx]; i += 2; continue; }
        out += "a"; i++; continue;
      }
      if (VOW[ch] !== undefined) { out += VOW[ch]; i++; continue; }
      if (ch === "ಂ") { out += "m"; i++; continue; }
      if (ch === "ಃ") { out += "h"; i++; continue; }
      out += ch; i++;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function search(q) {
    var k = q.toLowerCase().replace(/\s+/g, " ").trim();
    var hit = cache[k];
    if (hit && Date.now() - hit.t < TTL) return Promise.resolve(hit.data);
    return fetch("/api/search?q=" + encodeURIComponent(q) + "&v=3").then(function (r) {
      return r.text().then(function (txt) {
        var j = {};
        try { j = JSON.parse(txt); } catch (e) {}
        if (!r.ok) {
          if (r.status === 404 && !j.error) throw new Error("The search function was not found (404). In GitHub, check that api/search.js sits inside a folder named api, then redeploy on Vercel.");
          throw new Error(j.error || "Search failed (HTTP " + r.status + ").");
        }
        if (j.singers && j.singers.length) { cache[k] = { t: Date.now(), data: j }; saveCache(); }
        return j;
      });
    });
  }

  // Kannada query: if it finds few singers, also try the Roman spelling, since many titles are in Roman letters.
  function searchSmart(q) {
    return search(q).then(function (d) {
      if (!hasKannada(q) || (d.singers || []).length >= 3) return { data: d, used: q };
      var roman = translit(q);
      if (!roman || roman === q) return { data: d, used: q };
      return search(roman).then(function (d2) {
        return (d2.singers || []).length > (d.singers || []).length ? { data: d2, used: roman } : { data: d, used: q };
      }).catch(function () { return { data: d, used: q }; });
    });
  }

  function singerRow(s) {
    var li = el("li", {});
    var top = el("div", { class: "row-top" });
    var best = s.videos[0];
    top.appendChild(el("span", { class: "name", text: s.name }, [el("small", { text: fmtViews(best.views) + (s.videos.length > 1 ? " · " + s.videos.length + " recordings" : "") })]));
    var btn = el("button", { type: "button", class: "play-btn", text: "▶ Play" });
    top.appendChild(btn);
    li.appendChild(top);
    var slot = el("div", {});
    li.appendChild(slot);

    function show(idx) {
      var v = s.videos[idx];
      slot.textContent = "";
      li.className = "open";
      var frame = el("iframe", {
        class: "player", title: v.title,
        src: "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(v.id) + "?autoplay=1&rel=0&playsinline=1",
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: "", referrerpolicy: "strict-origin-when-cross-origin"
      });
      var ctl = el("div", { class: "vctl" });
      if (s.videos.length > 1) {
        var nxt = el("button", { type: "button", class: "ghost", text: "Not this one" });
        nxt.addEventListener("click", function () { show((idx + 1) % s.videos.length); });
        ctl.appendChild(nxt);
      }
      var close = el("button", { type: "button", class: "ghost", text: "Close" });
      close.addEventListener("click", function () { slot.textContent = ""; li.className = ""; btn.hidden = false; });
      ctl.appendChild(close);
      slot.appendChild(frame);
      slot.appendChild(el("p", { class: "vmeta", text: v.title + " · " + v.channel + " · " + fmtViews(v.views) }));
      slot.appendChild(ctl);
      btn.hidden = true;
    }
    btn.addEventListener("click", function () { show(0); });
    return li;
  }

  function render(q, data, used) {
    var box = document.getElementById("results");
    box.textContent = "";
    var singers = data.singers || [];
    if (!singers.length) {
      box.appendChild(el("div", { class: "empty" }, [
        el("p", { text: "No recordings found for “" + q + "”. Try fewer words or another spelling." }),
        el("a", { href: ytUrl(q), target: "_blank", rel: "noopener noreferrer", text: "Search YouTube yourself ↗" })
      ]));
      return;
    }
    var meta = used && used !== q ? "Searched as “" + used + "”. Pick a singer to play their version." : "Pick a singer to play their version.";
    if (data.relaxed) meta += " Showing recordings that match " + data.matched + " of your " + data.words + " words.";
    box.appendChild(el("article", { class: "card" }, [
      el("h2", { text: q }),
      el("p", { class: "meta", text: meta }),
      el("p", { class: "count", text: singers.length + (singers.length === 1 ? " singer" : " singers") }),
      el("ul", { class: "singers" }, singers.map(singerRow)),
      el("div", { class: "card-foot" }, [el("a", { class: "play", href: ytUrl(q), target: "_blank", rel: "noopener noreferrer", text: "Search YouTube yourself ↗" })])
    ]));
  }

  function run(q) {
    q = q.trim();
    var box = document.getElementById("results");
    if (q.length < 3) { box.textContent = ""; box.appendChild(el("div", { class: "empty", text: "Type or say at least a few letters of the first line." })); return; }
    var me = ++reqNo;
    var go = document.getElementById("goBtn");
    go.disabled = true;
    box.textContent = "";
    box.appendChild(el("div", { class: "empty" }, [el("span", { class: "spin" }), document.createTextNode("Searching YouTube for singers…")]));
    searchSmart(q).then(function (res) {
      if (me !== reqNo) return;
      render(q, res.data, res.used);
    }).catch(function (err) {
      if (me !== reqNo) return;
      var msg = err && err.name === "TypeError" ? "Could not reach the server. Check your internet connection and try again." : (err && err.message) || "Search failed. Try again.";
      box.textContent = "";
      box.appendChild(el("div", { class: "empty" }, [
        el("p", { text: msg }),
        el("a", { href: ytUrl(q), target: "_blank", rel: "noopener noreferrer", text: "Search YouTube yourself ↗" })
      ]));
    }).then(function () { if (me === reqNo) go.disabled = false; });
  }

  // ---- Voice input (browser speech recognition) ----
  var input = document.getElementById("q");
  var micBtn = document.getElementById("micBtn");
  var voiceRow = document.getElementById("voiceRow");
  var voiceMsg = document.getElementById("voiceMsg");
  var langKn = document.getElementById("langKn");
  var langEn = document.getElementById("langEn");
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var lang = "kn-IN";
  try { lang = localStorage.getItem(LANG_KEY) || "kn-IN"; } catch (e) {}
  var rec = null, listening = false;

  function setLang(l) {
    lang = l;
    try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
    langKn.setAttribute("aria-pressed", String(l === "kn-IN"));
    langEn.setAttribute("aria-pressed", String(l === "en-IN"));
  }

  if (!SR) {
    micBtn.hidden = true;
    voiceRow.hidden = false;
    document.getElementById("langSeg").hidden = true;
    voiceMsg.textContent = "Voice search needs Chrome or Safari. Typing works in every browser.";
  } else {
    micBtn.hidden = false;
    voiceRow.hidden = false;
    setLang(lang);
    langKn.addEventListener("click", function () { setLang("kn-IN"); });
    langEn.addEventListener("click", function () { setLang("en-IN"); });
    micBtn.addEventListener("click", function () {
      if (listening) { try { rec.stop(); } catch (e) {} return; }
      var failed = false;
      rec = new SR();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onstart = function () {
        listening = true;
        micBtn.setAttribute("aria-pressed", "true");
        voiceMsg.textContent = "Listening. Say the first line of the song.";
      };
      rec.onresult = function (e) {
        var t = "";
        for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        input.value = t.trim();
      };
      rec.onerror = function (e) {
        failed = true;
        var m = {
          "not-allowed": "The microphone is blocked. Allow it in your browser's site settings, then tap the mic again.",
          "service-not-allowed": "The microphone is blocked. Allow it in your browser's site settings, then tap the mic again.",
          "no-speech": "I did not hear anything. Tap the mic and try again.",
          "audio-capture": "No microphone was found on this device.",
          "network": "Voice recognition needs an internet connection.",
          "language-not-supported": "This browser cannot recognise " + (lang === "kn-IN" ? "Kannada" : "English") + ". Switch the language or type the line."
        };
        voiceMsg.textContent = m[e.error] || "Voice input stopped (" + e.error + "). You can type the line instead.";
      };
      rec.onend = function () {
        listening = false;
        micBtn.setAttribute("aria-pressed", "false");
        if (failed) return;
        if (input.value.trim().length >= 3) { voiceMsg.textContent = ""; run(input.value); }
        else voiceMsg.textContent = "I did not catch that. Tap the mic and try again.";
      };
      try { rec.start(); } catch (e) { voiceMsg.textContent = "Could not start the microphone. Try again."; }
    });
  }

  var chips = document.getElementById("chips");
  SUGGEST.forEach(function (t) {
    var b = el("button", { type: "button", text: t });
    b.addEventListener("click", function () { input.value = t; run(t); });
    chips.appendChild(b);
  });
  document.getElementById("searchForm").addEventListener("submit", function (e) { e.preventDefault(); run(input.value); });
  document.getElementById("results").appendChild(el("div", { class: "empty", text: "Type a first line above, tap the mic to say it, or tap one of the examples." }));
})();