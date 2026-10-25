(function () {
  var SUGGEST = ["bhagyada lakshmi baramma", "krishna nee begane baro", "jagadoddharana adisidale yashode", "tamburi meetidava"];
  var CACHE_KEY = "sangati-search-v4", LANG_KEY = "sangati-voice-lang", VOTED_KEY = "sangati-voted", TTL = 24 * 3600 * 1000;
  var FEEDBACK_WA = "https://wa.me/919845509006?text=";
  var pendingDeep = null;
  var cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; } catch (e) { cache = {}; }
  function saveCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {} }
  var reqNo = 0;

  // Popular singers, in the order they should appear. Edit this list: one name per line, best-known first.
  // Spelling can be loose ("Vidyabhushan" matches "Sri Vidyabhushana"). Anyone not listed comes after, by views.
  var PRIORITY = [
    "Vidyabhushana",
    "Bhimsen Joshi",
    "Gangubai Hangal",
    "M S Subbulakshmi",
    "Vasundhara Das",
    "Sanjay Subrahmanyan",
    "T M Krishna",
    "Yesudas",                // K J Yesudas
    "Sudha Raghunathan",
    "Venkatesh Kumar",        // Pandit Venkatesh Kumar
    "Trichur Brothers",
    "Abhishek Raghuram",
    "Sai Brothers",
    "Malladi Brothers",
    "Raichur Sheshagiri",     // Raichur Sheshagiri Das
    "Anantha Kulkarni",
    "Mysore Ramachandra",     // Mysore Ramachandrachar
    "Divya Giridhar",
    "Rahul Vellal",
    "Chaya"
  ];
  var HON = ["pandit", "pt", "dr", "smt", "shri", "sri", "sree", "vidwan", "vidushi", "kum", "kumari", "prof", "sangeetha", "kalanidhi", "late"];
  function loose(w) {
    return w.toLowerCase().replace(/(aa|ah)/g, "a").replace(/(ee|ii)/g, "i").replace(/(oo|uu)/g, "u")
      .replace(/([bcdgjkpstv])h/g, "$1").replace(/h/g, "").replace(/w/g, "v").replace(/(.)\1+/g, "$1");
  }
  function nameToks(name) {
    var t = hasKannada(name) ? translit(name) : name;
    return t.split(/[^A-Za-z]+/).filter(function (x) { return x.length > 0 && HON.indexOf(x.toLowerCase()) === -1; }).map(loose);
  }
  function tokMatch(a, b) { return a === b || (a.length >= 5 && b.length >= 5 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)); }
  var PRI = PRIORITY.map(nameToks);
  function rankOf(name) {
    var toks = nameToks(name);
    if (!toks.length) return PRI.length;
    for (var i = 0; i < PRI.length; i++) {
      var p = PRI[i];
      if (p.length && p.every(function (pt) { return toks.some(function (t) { return tokMatch(pt, t); }); })) return i;
    }
    return PRI.length;
  }
  function sortSingers(list) {
    return list.map(function (s, i) { return { s: s, r: rankOf(s.name), i: i }; })
      .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
      .map(function (x) { return x.s; });
  }

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
  function hasKannada(s) { return /[\u0C80-\u0CFF]/.test(s); }

  // ---- Share links: ?q=<song>&s=<singer>&v=<video id> ----
  function shareLink(q, singer, vid) {
    var u = location.href.split(/[?#]/)[0] + "?q=" + encodeURIComponent(q);
    if (singer) u += "&s=" + encodeURIComponent(singer);
    if (vid) u += "&v=" + encodeURIComponent(vid);
    return u;
  }
  function doShare(text, url) {
    if (navigator.share) { navigator.share({ title: "Sangati", text: text, url: url }).catch(function () {}); return; }
    window.open("https://wa.me/?text=" + encodeURIComponent(text + "\n" + url), "_blank", "noopener");
  }

  // ---- Votes ----
  function getVoted() { try { return JSON.parse(localStorage.getItem(VOTED_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function setVoted(id, dir) { var o = getVoted(); o[id] = dir; try { localStorage.setItem(VOTED_KEY, JSON.stringify(o)); } catch (e) {} }
  function postVote(id, dir) {
    return fetch("/api/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id, v: dir }) })
      .then(function (r) { if (!r.ok) throw new Error("vote"); });
  }

  var EXTRA_CSS = ".vctl .vote{font-size:13px}.vctl .vnote{font-size:13px;color:var(--ink-soft,#52645a);align-self:center}" +
    "details.lyr{border:1px solid var(--line,#d3dacd);border-radius:10px;margin:14px 0 0;background:var(--surface,#f8faf5)}" +
    "details.lyr summary{cursor:pointer;padding:12px 14px;font-weight:600;color:var(--accent,#2c6a4d)}" +
    ".lyr-body{padding:0 14px 14px}.lyr-body h3{font-family:var(--display,Georgia,serif);font-weight:400;font-size:20px;margin:4px 0 2px}" +
    ".lyr-body p{margin:6px 0}" +
    ".lyr-note{font-size:12px;color:var(--ink-soft,#52645a)}.lyr-note a{color:var(--accent,#2c6a4d);font-weight:600}";

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
    return fetch("/api/search?q=" + encodeURIComponent(q) + "&v=4").then(function (r) {
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

  function addVote(ctl, v) {
    var already = getVoted()[v.id];
    var good = el("button", { type: "button", class: "ghost vote", text: "👍 Good version" + (v.up ? " (" + v.up + ")" : "") });
    var bad = el("button", { type: "button", class: "ghost vote", text: "👎 Wrong song" });
    var note = el("span", { class: "vnote" });
    function done(msg) { good.disabled = true; bad.disabled = true; note.textContent = msg; }
    if (already) done("Thanks for your vote");
    function cast(dir) {
      done("Saving…");
      postVote(v.id, dir).then(function () {
        setVoted(v.id, dir);
        if (dir === 1) { v.up = (v.up || 0) + 1; good.textContent = "👍 Good version (" + v.up + ")"; }
        note.textContent = "Thanks for your vote";
      }).catch(function () { good.disabled = false; bad.disabled = false; note.textContent = "Could not save. Try again."; });
    }
    good.addEventListener("click", function () { cast(1); });
    bad.addEventListener("click", function () { cast(-1); });
    ctl.appendChild(good); ctl.appendChild(bad); ctl.appendChild(note);
  }

  function renderLyrics(body, j, q) {
    body.textContent = "";
    if (!j.recognised || (!j.meaning && !j.meaningKn)) {
      body.appendChild(el("p", { class: "meta", text: "The meaning of this song could not be prepared with confidence, so nothing is shown." }));
    } else {
      if (j.title) body.appendChild(el("h3", { text: j.title }));
      if (j.composer) body.appendChild(el("p", { class: "meta", text: "Composer: " + j.composer + " (as named in the video titles)" }));
      if (j.meaning) body.appendChild(el("p", {}, [el("strong", { text: "English: " }), document.createTextNode(j.meaning)]));
      if (j.meaningKn) body.appendChild(el("p", { style: "font-family:var(--kn,serif);font-size:17px;line-height:1.8" }, [el("strong", { text: "ಕನ್ನಡ: " }), document.createTextNode(j.meaningKn)]));
    }
    body.appendChild(el("p", { class: "lyr-note" }, [
      document.createTextNode("Prepared by AI and not yet checked by a person, so it may contain mistakes. "),
      el("a", { href: FEEDBACK_WA + encodeURIComponent("Sangati meaning correction for “" + q + "”: "), target: "_blank", rel: "noopener noreferrer", text: "Report a correction" })
    ]));
  }

  function lyricsBlock(q) {
    var d = el("details", { class: "lyr" });
    var body = el("div", { class: "lyr-body" });
    d.appendChild(el("summary", { text: "Meaning · ಅರ್ಥ" }));
    d.appendChild(body);
    var loaded = false;
    d.addEventListener("toggle", function () {
      if (!d.open || loaded) return;
      loaded = true;
      body.textContent = "";
      body.appendChild(el("p", { class: "meta" }, [el("span", { class: "spin" }), document.createTextNode("Preparing the meaning…")]));
      fetch("/api/lyrics?q=" + encodeURIComponent(q)).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (x) {
        if (!x.ok) { var e = new Error(x.j.error || "Could not load the meaning."); e.shown = true; throw e; }
        renderLyrics(body, x.j, q);
      }).catch(function (err) {
        loaded = false;
        body.textContent = "";
        body.appendChild(el("p", { class: "meta", text: err && err.shown ? err.message : "Could not load the meaning. Close this and open it again to retry." }));
      });
    });
    return d;
  }

  function singerRow(s, ctx) {
    var li = el("li", {});
    li.setAttribute("data-singer", s.name);
    var top = el("div", { class: "row-top" });
    var best = s.videos[0];
    top.appendChild(el("span", { class: "name", text: s.name }, [el("small", { class: "vt", text: best.title }), el("small", { text: fmtViews(best.views) + (s.videos.length > 1 ? " · " + s.videos.length + " recordings" : "") })]));
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
      var sh = el("button", { type: "button", class: "ghost", text: "Share" });
      sh.addEventListener("click", function () {
        doShare("🙏 Hear " + s.name + " sing “" + ctx.q + "” on Sangati", shareLink(ctx.q, s.name, v.id));
      });
      ctl.appendChild(sh);
      if (ctx.votesOn) addVote(ctl, v);
      var close = el("button", { type: "button", class: "ghost", text: "Close" });
      close.addEventListener("click", function () { slot.textContent = ""; li.className = ""; btn.hidden = false; });
      ctl.appendChild(close);
      slot.appendChild(frame);
      slot.appendChild(el("p", { class: "vmeta", text: s.name + " · " + v.title + " · " + v.channel + " · " + fmtViews(v.views) }));
      slot.appendChild(ctl);
      btn.hidden = true;
    }
    btn.addEventListener("click", function () { show(0); });
    li._show = show;
    return li;
  }

  function render(q, data, used, deep) {
    var box = document.getElementById("results");
    box.textContent = "";
    var singers = sortSingers(data.singers || []);
    if (!singers.length) {
      box.appendChild(el("div", { class: "empty" }, [
        el("p", { text: "No recordings found for “" + q + "”. Try fewer words or another spelling." }),
        el("a", { href: ytUrl(q), target: "_blank", rel: "noopener noreferrer", text: "Search YouTube yourself ↗" })
      ]));
      return;
    }
    var meta = used && used !== q ? "Searched as “" + used + "”. Pick a singer to play their version." : "Pick a singer to play their version.";
    if (data.relaxed) meta += " Showing recordings that match " + data.matched + " of your " + data.words + " words.";
    var ctx = { q: q, votesOn: !!data.votes };
    var shareSong = el("button", { type: "button", class: "ghost", text: "Share this song" });
    shareSong.addEventListener("click", function () { doShare("🙏 Hear “" + q + "” sung by many singers on Sangati", shareLink(q)); });
    box.appendChild(el("article", { class: "card" }, [
      el("h2", { text: q }),
      el("p", { class: "meta", text: meta }),
      data.lyrics ? lyricsBlock(used || q) : null,
      el("p", { class: "count", text: singers.length + (singers.length === 1 ? " singer" : " singers") }),
      el("ul", { class: "singers" }, singers.map(function (s) { return singerRow(s, ctx); })),
      el("div", { class: "card-foot" }, [el("a", { class: "play", href: ytUrl(q), target: "_blank", rel: "noopener noreferrer", text: "Search YouTube yourself ↗" }), shareSong])
    ]));

    // Opened from a shared link: open that singer's recording
    if (deep && (deep.v || deep.s)) {
      var lis = box.querySelectorAll("ul.singers li"), hitS = -1, hitV = 0;
      singers.forEach(function (s, i) {
        s.videos.forEach(function (v, j) { if (hitS < 0 && deep.v && v.id === deep.v) { hitS = i; hitV = j; } });
      });
      if (hitS < 0 && deep.s) {
        singers.forEach(function (s, i) { if (hitS < 0 && s.name.toLowerCase() === deep.s.toLowerCase()) { hitS = i; hitV = 0; } });
      }
      if (hitS >= 0 && lis[hitS] && lis[hitS]._show) {
        lis[hitS]._show(hitV);
        try { lis[hitS].scrollIntoView({ block: "center" }); } catch (e) {}
      }
    }
  }

  function run(q) {
    q = q.trim();
    var box = document.getElementById("results");
    if (q.length < 3) { box.textContent = ""; box.appendChild(el("div", { class: "empty", text: "Type or say at least a few letters of the first line." })); return; }
    var me = ++reqNo;
    var deep = pendingDeep; pendingDeep = null;
    if (!deep) { try { history.replaceState(null, "", location.pathname + "?q=" + encodeURIComponent(q)); } catch (e) {} }
    var go = document.getElementById("goBtn");
    if (go) go.disabled = true;
    box.textContent = "";
    box.appendChild(el("div", { class: "empty" }, [el("span", { class: "spin" }), document.createTextNode("Searching YouTube for singers…")]));
    searchSmart(q).then(function (res) {
      if (me !== reqNo) return;
      render(q, res.data, res.used, deep);
    }).catch(function (err) {
      if (me !== reqNo) return;
      var msg = err && err.name === "TypeError" ? "Could not reach the server. Check your internet connection and try again." : (err && err.message) || "Search failed. Try again.";
      box.textContent = "";
      box.appendChild(el("div", { class: "empty" }, [
        el("p", { text: msg }),
        el("a", { href: ytUrl(q), target: "_blank", rel: "noopener noreferrer", text: "Search YouTube yourself ↗" })
      ]));
    }).then(function () { if (me === reqNo && go) go.disabled = false; });
  }

  // ---- Voice input ----
  // The mic is built here if the page does not already have one, and it is always shown.
  var MIC_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/></svg>';
  var VOICE_CSS = "[hidden]{display:none!important}.field{position:relative;flex:1 1 220px;min-width:0}.field input{width:100%;padding-right:54px}.mic{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:40px;height:40px;padding:0;display:grid;place-items:center;border-radius:50%;border:0;background:transparent;color:var(--accent,#2c6a4d);cursor:pointer}.mic[aria-pressed=true]{background:var(--accent,#2c6a4d);color:var(--accent-ink,#fff)}.voice{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:13px;color:var(--ink-soft,#52645a);margin-top:-8px}.seg{display:inline-flex;border:1.5px solid var(--line,#d3dacd);border-radius:999px;overflow:hidden}.seg button{border:0;border-radius:0;background:transparent;color:inherit;font:inherit;font-weight:500;font-size:13px;padding:6px 14px;cursor:pointer}.seg button[aria-pressed=true]{background:var(--accent,#2c6a4d);color:var(--accent-ink,#fff)}";

  function setupVoice() {
    var input = document.getElementById("q");
    var form = document.getElementById("searchForm");
    if (!input || !form) return;

    if (!document.getElementById("sangati-voice-css")) {
      var st = document.createElement("style");
      st.id = "sangati-voice-css";
      st.textContent = VOICE_CSS;
      document.head.appendChild(st);
    }

    var micBtn = document.getElementById("micBtn");
    if (!micBtn) {
      micBtn = el("button", { type: "button", id: "micBtn", class: "mic", "aria-label": "Say the first line", "aria-pressed": "false" });
      micBtn.innerHTML = MIC_SVG;
    }
    var wrap = input.parentNode && input.parentNode.classList.contains("field") ? input.parentNode : null;
    if (!wrap) {
      wrap = el("div", { class: "field" });
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }
    if (micBtn.parentNode !== wrap) wrap.appendChild(micBtn);
    micBtn.hidden = false;

    var voiceRow = document.getElementById("voiceRow");
    if (!voiceRow) {
      voiceRow = el("div", { id: "voiceRow", class: "voice" });
      voiceRow.innerHTML = '<div class="seg" id="langSeg" role="group" aria-label="Voice language"><button type="button" id="langKn" aria-pressed="true">ಕನ್ನಡ</button><button type="button" id="langEn" aria-pressed="false">English</button></div><span id="voiceMsg" aria-live="polite"></span>';
      form.parentNode.insertBefore(voiceRow, form.nextSibling);
    }
    voiceRow.hidden = false;

    var voiceMsg = document.getElementById("voiceMsg");
    var langSeg = document.getElementById("langSeg");
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
    setLang(lang);
    langKn.addEventListener("click", function () { setLang("kn-IN"); });
    langEn.addEventListener("click", function () { setLang("en-IN"); });

    var NO_SR = "This browser cannot take voice input. Open the site in Chrome (Android) or Safari (iPhone), or use the microphone key on your keyboard.";
    if (!SR) { langSeg.hidden = true; voiceMsg.textContent = NO_SR; }

    micBtn.addEventListener("click", function () {
      if (!SR) { voiceMsg.textContent = NO_SR; return; }
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

  // ---- Page wiring: search comes first so voice problems can never break it ----
  var input = document.getElementById("q");
  var chips = document.getElementById("chips");
  if (chips) {
    SUGGEST.forEach(function (t) {
      var b = el("button", { type: "button", text: t });
      b.addEventListener("click", function () { input.value = t; run(t); });
      chips.appendChild(b);
    });
  }
  document.getElementById("searchForm").addEventListener("submit", function (e) { e.preventDefault(); run(input.value); });
  document.getElementById("results").appendChild(el("div", { class: "empty", text: "Type a first line above, tap the mic to say it, or tap one of the examples." }));

  var xs = document.createElement("style");
  xs.id = "sangati-extra-css";
  xs.textContent = EXTRA_CSS;
  document.head.appendChild(xs);

  try { setupVoice(); } catch (err) {
    var vm = document.getElementById("voiceMsg");
    if (vm) vm.textContent = "Voice input could not start. You can type the line instead.";
  }

  // Opened from a shared link (?q=...&s=...&v=...): run that search straight away
  try {
    var sp = new URLSearchParams(location.search);
    var dq = (sp.get("q") || "").trim();
    if (dq.length >= 3) {
      input.value = dq;
      pendingDeep = { s: sp.get("s") || "", v: sp.get("v") || "" };
      run(dq);
    }
  } catch (e) {}

  // Small version line at the bottom, so it is easy to see which files are live.
  var ver = document.getElementById("ver");
  if (!ver) {
    ver = el("p", { class: "note", id: "ver" });
    var mainEl = document.querySelector("main");
    if (mainEl) mainEl.appendChild(ver);
  }
  ver.textContent = "Sangati v5 · voice input " + (window.SpeechRecognition || window.webkitSpeechRecognition ? "available" : "not available in this browser");
})();