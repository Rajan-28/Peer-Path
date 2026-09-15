/**
 * PeerPath – complete client (auth + matchmaking + WebRTC)
 * Fixed: post-login blank screen, signup, camera, server checks
 */
(function () {
  'use strict';

  var isFile = location.protocol === 'file:';
  var WS_URL = isFile ? null : ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  var ICE = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };
  var BAD = [
    /\b(sex|porn|nude|naked|fuck|shit|bitch|asshole|dick|pussy|xxx|onlyfans)\b/i,
    /\b(send\s*nudes?|show\s*me|horny|sexy\s*pic)\b/i
  ];
  var COLORS = [
    'from-pink-400 to-rose-500', 'from-blue-400 to-indigo-500',
    'from-purple-400 to-violet-500', 'from-emerald-400 to-teal-500',
    'from-amber-400 to-orange-500', 'from-sky-400 to-blue-600'
  ];

  // State
  var user = null;
  var ws = null;
  var myId = null;
  var partnerId = null;
  var role = null;
  var mode = 'text';
  var pc = null;
  var dc = null;
  var localStream = null;

  var pendingSignals = [];
  var matched = false;
  var searching = false;
  var micOn = true;
  var camOn = true;
  var partner = {};
  var friends = [];
  var wsOk = false;

  function $(id) { return document.getElementById(id); }

  // DOM
  var authModal = $('auth-modal');
  var serverWarning = $('server-warning');
  var app = $('app');
  var tabSignin = $('tab-signin');
  var tabSignup = $('tab-signup');
  var formSignin = $('form-signin');
  var formSignup = $('form-signup');
  var signinError = $('signin-error');
  var signupError = $('signup-error');
  var retryServerBtn = $('retry-server');
  var startTextBtn = $('start-text-btn');
  var startVideoBtn = $('start-video-btn');
  var emptyState = $('empty-state');
  var messagesEl = $('messages');
  var partnerBar = $('partner-bar');
  var inputArea = $('input-area');
  var chatForm = $('chat-form');
  var messageInput = $('message-input');
  var matchStatus = $('match-status');
  var partnerNameEl = $('partner-name');
  var partnerMeta = $('partner-meta');
  var partnerAvatar = $('partner-avatar');
  var friendBtn = $('friend-btn');
  var reportBtn = $('report-btn');
  var nextBtn = $('next-btn');
  var reportModal = $('report-modal');
  var closeReport = $('close-report');
  var cancelReport = $('cancel-report');
  var submitReport = $('submit-report');
  var friendsBtn = $('friends-btn');
  var friendsPanel = $('friends-panel');
  var friendsList = $('friends-list');
  var friendsCount = $('friends-count');
  var toastEl = $('toast');
  var videoArea = $('video-area');
  var localVideo = $('local-video');
  var remoteVideo = $('remote-video');
  var localOff = $('local-off');
  var remotePlaceholder = $('remote-placeholder');
  var remoteAvatarBig = $('remote-avatar-big');
  var remoteNameBig = $('remote-name-big');
  var toggleMicBtn = $('toggle-mic');
  var toggleCamBtn = $('toggle-cam');
  var endVideoBtn = $('end-video-btn');
  var micIcon = $('mic-icon');
  var camIcon = $('cam-icon');
  var modeBadge = $('current-mode-badge');
  var userMenuBtn = $('user-menu-btn');
  var userDropdown = $('user-dropdown');
  var userAvatar = $('user-avatar');
  var userDisplayName = $('user-display-name');
  var ddName = $('dd-name');
  var ddRegion = $('dd-region');
  var logoutBtn = $('logout-btn');
  var connStatus = $('conn-status');

  // ---------- helpers ----------
  function toast(msg, ms) {
    ms = ms || 3000;
    if (!toastEl) { console.log(msg); return; }
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.add('hidden'); }, ms);
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function colorFor(name) {
    var n = 0, s = name || 'x';
    for (var i = 0; i < s.length; i++) n += s.charCodeAt(i);
    return COLORS[n % COLORS.length];
  }

  function setStatus(state, text) {
    if (!matchStatus) return;
    var c = { idle: 'bg-slate-300', matching: 'bg-amber-400 matching-dot', connected: 'bg-accent-500' };
    matchStatus.innerHTML = '<span class="w-2 h-2 rounded-full ' + (c[state] || c.idle) + '"></span><span class="text-slate-600 font-medium">' + esc(text) + '</span>';
  }

  function sys(msg) {
    if (!messagesEl) return;
    var d = document.createElement('div');
    d.className = 'system-msg';
    d.textContent = msg;
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function bubble(text, mine) {
    if (!messagesEl) return;
    var row = document.createElement('div');
    row.className = 'message-row ' + (mine ? 'mine' : 'theirs');
    var letter = mine
      ? ((user && user.name) ? user.name[0].toUpperCase() : 'Y')
      : (partner.avatar || (partner.name && partner.name[0]) || '?');
    var col = mine
      ? ((user && user.color) || 'from-slate-400 to-slate-600')
      : (partner.color || 'from-primary-400 to-primary-600');
    row.innerHTML = '<div class="message-avatar bg-gradient-to-br ' + col + '">' + esc(letter) + '</div><div class="message-bubble">' + esc(text) + '</div>';
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function clearMessages() {
    if (!messagesEl) return;
    Array.prototype.slice.call(messagesEl.children).forEach(function (c) {
      if (c.id !== 'empty-state') c.remove();
    });
  }

  // ---------- storage ----------
  function loadAccounts() {
    try { return JSON.parse(localStorage.getItem('peerpath_accounts') || '{}'); }
    catch (e) { return {}; }
  }
  function saveAccounts(a) {
    localStorage.setItem('peerpath_accounts', JSON.stringify(a));
  }
  function loadSession() {
    try { return JSON.parse(localStorage.getItem('peerpath_session') || 'null'); }
    catch (e) { return null; }
  }
  function saveSession(u) {
    if (u) localStorage.setItem('peerpath_session', JSON.stringify(u));
    else localStorage.removeItem('peerpath_session');
  }
  function loadFriends() {
    if (!user) return [];
    try { return JSON.parse(localStorage.getItem('peerpath_friends_' + user.username) || '[]'); }
    catch (e) { return []; }
  }
  function saveFriends() {
    if (!user) return;
    localStorage.setItem('peerpath_friends_' + user.username, JSON.stringify(friends));
  }

  function updateFriendsUI() {
    if (!friendsCount || !friendsList) return;
    friendsCount.textContent = String(friends.length);
    friendsCount.classList.toggle('hidden', friends.length === 0);
    if (!friends.length) {
      friendsList.innerHTML = '<p class="text-sm text-slate-400 text-center py-8">No friends yet.</p>';
      return;
    }
    friendsList.innerHTML = friends.map(function (f) {
      return '<div class="friend-card"><div class="w-10 h-10 rounded-full bg-gradient-to-br ' + (f.color || 'from-primary-400 to-primary-600') + ' flex items-center justify-center text-white text-sm font-bold">' + esc(f.avatar || '?') + '</div><div class="min-w-0 flex-1"><div class="font-medium text-slate-900 text-sm truncate">' + esc(f.name) + '</div><div class="text-xs text-slate-500 truncate">' + esc(f.region || '') + '</div></div></div>';
    }).join('');
  }

  function showUserUI() {
    if (!user) return;
    var letter = (user.name || user.username || '?')[0].toUpperCase();
    if (userAvatar) {
      userAvatar.textContent = letter;
      userAvatar.className = 'w-8 h-8 rounded-full bg-gradient-to-br ' + (user.color || 'from-primary-500 to-primary-700') + ' text-white text-xs font-bold flex items-center justify-center';
    }
    if (userDisplayName) userDisplayName.textContent = user.name || user.username;
    if (ddName) ddName.textContent = user.name || user.username;
    if (ddRegion) ddRegion.textContent = '@' + user.username + (user.region ? ' · ' + user.region : '');
  }

  // ---------- show / hide app (CRITICAL FIX) ----------
  function enterApp() {
    try {
      if (authModal) {
        authModal.classList.add('hidden');
        authModal.style.display = 'none';
      }
      if (serverWarning) {
        serverWarning.classList.add('hidden');
        serverWarning.style.display = 'none';
      }
      if (app) {
        app.style.display = 'flex';
        app.classList.add('flex');
        app.classList.remove('hidden');
      }
      friends = loadFriends();
      updateFriendsUI();
      showUserUI();
      setStatus('idle', 'Not connected');
      if (emptyState) emptyState.classList.remove('hidden');
      if (partnerBar) partnerBar.classList.add('hidden');
      if (inputArea) inputArea.classList.add('hidden');
      hideVideo();
      connectWS();
      toast('Welcome, ' + (user.name || user.username) + '!');
    } catch (err) {
      console.error('enterApp failed', err);
      alert('Login UI error: ' + err.message + '. Please refresh the page.');
    }
  }

  function showAuth() {
    if (app) {
      app.style.display = 'none';
      app.classList.remove('flex');
    }
    if (authModal) {
      authModal.classList.remove('hidden');
      authModal.style.display = '';
    }
    if (formSignin) formSignin.reset();
    if (formSignup) formSignup.reset();
  }

  // ---------- auth ----------
  if (tabSignin) {
    tabSignin.addEventListener('click', function () {
      tabSignin.className = 'flex-1 py-2 rounded-lg text-sm font-semibold bg-white shadow text-primary-700 transition';
      if (tabSignup) tabSignup.className = 'flex-1 py-2 rounded-lg text-sm font-semibold text-slate-500 hover:text-slate-700 transition';
      if (formSignin) formSignin.classList.remove('hidden');
      if (formSignup) formSignup.classList.add('hidden');
      if (signinError) signinError.classList.add('hidden');
    });
  }
  if (tabSignup) {
    tabSignup.addEventListener('click', function () {
      tabSignup.className = 'flex-1 py-2 rounded-lg text-sm font-semibold bg-white shadow text-primary-700 transition';
      if (tabSignin) tabSignin.className = 'flex-1 py-2 rounded-lg text-sm font-semibold text-slate-500 hover:text-slate-700 transition';
      if (formSignup) formSignup.classList.remove('hidden');
      if (formSignin) formSignin.classList.add('hidden');
      if (signupError) signupError.classList.add('hidden');
    });
  }

  function showSignupErr(m) {
    if (!signupError) { alert(m); return; }
    signupError.textContent = m;
    signupError.classList.remove('hidden');
  }
  function showSigninErr(m) {
    if (!signinError) { alert(m); return; }
    signinError.textContent = m;
    signinError.classList.remove('hidden');
  }

  function doSignup(e) {
    if (e) e.preventDefault();
    try {
      if (signupError) signupError.classList.add('hidden');
      var name = (($('signup-name') && $('signup-name').value) || '').trim();
      var username = (($('signup-user') && $('signup-user').value) || '').trim().toLowerCase();
      var pass = ($('signup-pass') && $('signup-pass').value) || '';
      var region = (($('signup-region') && $('signup-region').value) || '').trim();
      var ageOk = $('signup-age') && $('signup-age').checked;

      if (!name) return showSignupErr('Please enter a display name.');
      if (username.length < 3) return showSignupErr('Username must be at least 3 characters.');
      if (!/^[a-z0-9_]+$/.test(username)) return showSignupErr('Username: only letters, numbers, underscore (no spaces).');
      if (pass.length < 4) return showSignupErr('Password must be at least 4 characters.');
      if (!region) return showSignupErr('Please enter your region / country.');
      if (!ageOk) return showSignupErr('Please confirm you are 18 or older.');

      var accounts = loadAccounts();
      if (accounts[username]) return showSignupErr('Username already taken. Use Sign In.');

      var rec = {
        username: username,
        password: pass,
        name: name,
        region: region,
        color: colorFor(name),
        createdAt: Date.now()
      };
      accounts[username] = rec;
      saveAccounts(accounts);

      user = { username: rec.username, name: rec.name, region: rec.region, color: rec.color };
      saveSession(user);
      enterApp();
    } catch (err) {
      console.error(err);
      showSignupErr('Signup failed: ' + err.message);
    }
  }

  function doSignin(e) {
    if (e) e.preventDefault();
    try {
      if (signinError) signinError.classList.add('hidden');
      var u = (($('signin-user') && $('signin-user').value) || '').trim().toLowerCase();
      var p = ($('signin-pass') && $('signin-pass').value) || '';
      var accounts = loadAccounts();
      var acc = accounts[u];
      if (!acc || acc.password !== p) return showSigninErr('Invalid username or password.');
      user = { username: acc.username, name: acc.name, region: acc.region, color: acc.color };
      saveSession(user);
      enterApp();
    } catch (err) {
      console.error(err);
      showSigninErr('Sign in failed: ' + err.message);
    }
  }

  if (formSignup) formSignup.addEventListener('submit', doSignup);
  if (formSignin) formSignin.addEventListener('submit', doSignin);
  var btnSignup = $('btn-signup');
  if (btnSignup) btnSignup.addEventListener('click', function (e) {
    if (formSignup && !formSignup.classList.contains('hidden')) doSignup(e);
  });

  if (userMenuBtn) {
    userMenuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (userDropdown) userDropdown.classList.toggle('hidden');
    });
  }
  document.addEventListener('click', function () {
    if (userDropdown) userDropdown.classList.add('hidden');
  });
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      teardown(true);
      saveSession(null);
      user = null;
      showAuth();
    });
  }

  // ---------- WebSocket ----------
  function connectWS() {
    if (isFile || !WS_URL) {
      if (connStatus) {
        connStatus.textContent = 'Open http://localhost:3000 after running: node server.js';
        connStatus.className = 'mt-5 text-xs text-red-500';
      }
      return;
    }
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;

    if (connStatus) {
      connStatus.textContent = 'Connecting to server...';
      connStatus.className = 'mt-5 text-xs text-slate-400';
    }

    try { ws = new WebSocket(WS_URL); }
    catch (err) {
      if (connStatus) connStatus.textContent = 'Cannot open WebSocket. Is the server running?';
      return;
    }

    ws.onopen = function () {
      wsOk = true;
      if (serverWarning) {
        serverWarning.classList.add('hidden');
        serverWarning.style.display = 'none';
      }
      if (connStatus) {
        connStatus.textContent = 'Server connected · Ready to match';
        connStatus.className = 'mt-5 text-xs text-accent-600';
      }
    };
    ws.onmessage = function (ev) {
      try { onSignal(JSON.parse(ev.data)); } catch (e) {}
    };
    ws.onclose = function () {
      wsOk = false;
      if (connStatus) {
        connStatus.textContent = 'Disconnected. Reconnecting...';
        connStatus.className = 'mt-5 text-xs text-red-500';
      }
      setTimeout(connectWS, 2500);
    };
    ws.onerror = function () {
      wsOk = false;
      if (connStatus) {
        connStatus.textContent = 'Server not reachable. Run: node server.js';
        connStatus.className = 'mt-5 text-xs text-red-500';
      }
    };
  }

  function send(obj) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    toast('Not connected to server. Run: node server.js');
    return false;
  }

  function onSignal(data) {
    switch (data.type) {
      case 'welcome':
        myId = data.id;
        break;
      case 'searching':
        searching = true;
        setStatus('matching', 'Looking for someone...');
        break;
      case 'matched':
        searching = false;
        matched = true;
        partnerId = data.partnerId;
        role = data.role;
        mode = data.mode || mode;
        partner = data.partner || {};
        onMatched();
        break;
      case 'signal':
        if (data.from === partnerId) handleRTC(data.signal);
        break;
      case 'chat':
        if (data.from === partnerId && data.text) bubble(data.text, false);
        break;
      case 'partner-left':
        sys(data.reason || 'Partner left.');
        teardown(false);
        showIdle();
        toast('Partner disconnected');
        break;
      case 'idle':
      case 'report-ack':
        teardown(false);
        showIdle();
        break;
    }
  }

  // ---------- WebRTC ----------
  async function createPC() {
    if (pc) try { pc.close(); } catch (e) {}
    pc = new RTCPeerConnection(ICE);

    pc.onicecandidate = function (ev) {
      if (ev.candidate && partnerId) {
        send({ type: 'signal', to: partnerId, signal: { type: 'ice', candidate: ev.candidate } });
      }
    };
    pc.ontrack = function (ev) {
      if (remoteVideo && ev.streams && ev.streams[0]) {
        remoteVideo.srcObject = ev.streams[0];
        remoteVideo.classList.remove('hidden');
        if (remotePlaceholder) remotePlaceholder.classList.add('hidden');
      }
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'connected') setStatus('connected', 'Connected');
      if (pc.connectionState === 'failed') sys('Media connection failed — text chat still works.');
    };

    if (role === 'offerer') {
      dc = pc.createDataChannel('chat', { ordered: true });
      setupDC(dc);
    } else {
      pc.ondatachannel = function (ev) {
        dc = ev.channel;
        setupDC(dc);
      };
    }

if (localStream) {
  localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
}
}

// Process any WebRTC signals that arrived
// before the PeerConnection was ready.
if (pendingSignals.length) {
    var queued = pendingSignals.slice();
    pendingSignals = [];

    for (var i = 0; i < queued.length; i++) {
        await handleRTC(queued[i]);
    }
}

  function setupDC(ch) {
    ch.onmessage = function (ev) {
      try {
        var m = JSON.parse(ev.data);
        if (m.type === 'chat' && m.text) bubble(m.text, false);
      } catch (e) {
        if (typeof ev.data === 'string') bubble(ev.data, false);
      }
    };
  }

  async function handleRTC(signal) {

    // If PeerConnection is not ready yet,
    // save the signal and process it later.
    if (!pc) {
        pendingSignals.push(signal);
        return;
    }

    try {
        if (signal.type === 'offer') {

            await pc.setRemoteDescription(
                new RTCSessionDescription(signal.sdp)
            );

            var ans = await pc.createAnswer();

            await pc.setLocalDescription(ans);

            send({
                type: 'signal',
                to: partnerId,
                signal: {
                    type: 'answer',
                    sdp: pc.localDescription
                }
            });

        } else if (signal.type === 'answer') {

            await pc.setRemoteDescription(
                new RTCSessionDescription(signal.sdp)
            );

        } else if (signal.type === 'ice' && signal.candidate) {

            try {
                await pc.addIceCandidate(
                    new RTCIceCandidate(signal.candidate)
                );
            } catch (e) {
                console.warn('ICE candidate error:', e);
            }
        }

    } catch (err) {
        console.error('RTC signal error', err);
    }
}
  async function startOffer() {
    if (!pc || role !== 'offerer') return;
    try {
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'signal', to: partnerId, signal: { type: 'offer', sdp: pc.localDescription } });
    } catch (err) {
      console.error('offer error', err);
    }
  }

  // ---------- media ----------
  async function startMedia(wantVideo) {
    try {
      if (localStream) {
        localStream.getTracks().forEach(function (t) { t.stop(); });
        localStream = null;
      }
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: wantVideo ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
      });
      if (localVideo) {
        localVideo.srcObject = localStream;
        localVideo.play().catch(function () {});
      }
      if (localOff) localOff.classList.add('hidden');
      micOn = true;
      camOn = !!(wantVideo && localStream.getVideoTracks().length);
      updateMediaIcons();
      return true;
    } catch (err) {
      console.warn('getUserMedia', err.name, err.message);
      var msg = 'Could not access camera/mic.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Permission denied. Allow camera & mic, then try again.';
      } else if (err.name === 'NotFoundError') {
        msg = 'No camera or microphone found.';
      } else if (err.name === 'NotReadableError') {
        msg = 'Camera is busy (close Zoom/Teams and retry).';
      }
      toast(msg, 5000);
      sys(msg);
      if (localOff) localOff.classList.remove('hidden');
      if (wantVideo) {
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          micOn = true; camOn = false; updateMediaIcons();
          sys('Continuing with microphone only.');
          return true;
        } catch (e2) { return false; }
      }
      return false;
    }
  }

  function stopMedia() {
    if (localStream) {
      localStream.getTracks().forEach(function (t) { t.stop(); });
      localStream = null;
    }
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) {
      remoteVideo.srcObject = null;
      remoteVideo.classList.add('hidden');
    }
    if (localOff) localOff.classList.remove('hidden');
    if (remotePlaceholder) remotePlaceholder.classList.remove('hidden');
  }

  function updateMediaIcons() {
    if (micIcon) micIcon.className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    if (toggleMicBtn) {
      toggleMicBtn.classList.toggle('bg-red-600', !micOn);
      toggleMicBtn.classList.toggle('bg-slate-700', micOn);
    }
    if (camIcon) camIcon.className = camOn ? 'fas fa-video' : 'fas fa-video-slash';
    if (toggleCamBtn) {
      toggleCamBtn.classList.toggle('bg-red-600', !camOn);
      toggleCamBtn.classList.toggle('bg-slate-700', camOn);
    }
    if (localStream) {
      localStream.getAudioTracks().forEach(function (t) { t.enabled = micOn; });
      localStream.getVideoTracks().forEach(function (t) { t.enabled = camOn; });
    }
    if (camOn && localStream && localStream.getVideoTracks().some(function (t) { return t.readyState === 'live'; })) {
      if (localOff) localOff.classList.add('hidden');
    } else if (localOff) {
      localOff.classList.remove('hidden');
    }
  }

  function showVideo() {
    if (!videoArea) return;
    videoArea.classList.remove('hidden');
    videoArea.style.display = 'flex';
    videoArea.classList.add('flex');
    if (remoteAvatarBig) remoteAvatarBig.textContent = partner.avatar || (partner.name && partner.name[0]) || '?';
    if (remoteNameBig) remoteNameBig.textContent = partner.name || 'Partner';
  }

  function hideVideo() {
    if (!videoArea) return;
    videoArea.classList.add('hidden');
    videoArea.style.display = 'none';
    videoArea.classList.remove('flex');
  }

  // ---------- match ----------
  function myProfile() {
    return {
      name: user.name || user.username,
      username: user.username,
      region: user.region || 'Unknown',
      avatar: (user.name || user.username || '?')[0].toUpperCase(),
      color: user.color || colorFor(user.name)
    };
  }

  async function findMatch(wantVideo) {
    if (!user) { toast('Please sign in first'); return; }
    if (!wsOk) {
      toast('Server not connected. Run: node server.js then open http://localhost:3000');
      if (connStatus) connStatus.textContent = 'Server offline — run node server.js';
      return;
    }
    if (searching || matched) return;

    mode = wantVideo ? 'video' : 'text';
    clearMessages();
    if (emptyState) emptyState.classList.add('hidden');
    if (partnerBar) partnerBar.classList.add('hidden');
    if (inputArea) inputArea.classList.add('hidden');
    hideVideo();
    stopMedia();
    setStatus('matching', 'Looking for someone...');

    if (wantVideo) {
      showVideo();
      sys('Starting camera...');
      var ok = await startMedia(true);
      if (!ok) {
        sys('Camera failed. Try Text Only instead.');
        setStatus('idle', 'Not connected');
        if (emptyState) emptyState.classList.remove('hidden');
        hideVideo();
        return;
      }
      sys('Camera ready. Waiting for a partner (open a second tab to test).');
    } else {
      try { await startMedia(false); } catch (e) {}
      sys('Waiting for a partner… Open a second tab, sign in as another user, click Text Only.');
    }

    send({ type: 'find', mode: mode, profile: myProfile() });
  }

  async function onMatched() {
    setStatus('connected', 'Connecting…');
    if (partnerBar) partnerBar.classList.remove('hidden');
    if (inputArea) inputArea.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');

    if (partnerNameEl) partnerNameEl.textContent = partner.name || 'Partner';
    if (partnerMeta) partnerMeta.textContent = [partner.region, partner.username ? '@' + partner.username : ''].filter(Boolean).join(' · ') || 'PeerPath user';
    if (partnerAvatar) {
      partnerAvatar.textContent = partner.avatar || (partner.name && partner.name[0]) || '?';
      partnerAvatar.className = 'w-9 h-9 rounded-full bg-gradient-to-br ' + (partner.color || 'from-primary-400 to-primary-600') + ' flex items-center justify-center text-white font-bold text-sm shrink-0';
    }
    if (friendBtn) {
      friendBtn.disabled = false;
      friendBtn.innerHTML = '<i class="fas fa-user-plus"></i> <span class="hidden sm:inline">Friend</span>';
      friendBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    sys('Matched with ' + (partner.name || 'a partner') + (partner.region ? ' from ' + partner.region : '') + '. Be respectful.');

    if (mode === 'video') {
      showVideo();
      if (!localStream || !localStream.getVideoTracks().length) await startMedia(true);
    }
    if (modeBadge) {
      modeBadge.classList.remove('hidden');
      if (mode === 'video') {
        modeBadge.innerHTML = '<i class="fas fa-video"></i> Video + Text';
        modeBadge.className = 'hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-50 text-primary-700 text-xs font-medium';
      } else {
        modeBadge.innerHTML = '<i class="fas fa-comment-dots"></i> Text';
        modeBadge.className = 'hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-xs font-medium text-slate-600';
      }
    }

    await createPC();
    if (role === 'offerer') await startOffer();
  }

  function teardown(notify) {
    matched = false;
    searching = false;
    partnerId = null;
    role = null;
    if (dc) { try { dc.close(); } catch (e) {} dc = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    stopMedia();
    hideVideo();
    if (notify) send({ type: 'leave' });
  }

  function showIdle() {
    if (partnerBar) partnerBar.classList.add('hidden');
    if (inputArea) inputArea.classList.add('hidden');
    hideVideo();
    setStatus('idle', 'Not connected');
    if (modeBadge) modeBadge.classList.add('hidden');
    setTimeout(function () {
      if (emptyState) emptyState.classList.remove('hidden');
    }, 200);
  }

  function sendChat(text) {
    if (!text.trim() || !matched) return;
    if (BAD.some(function (p) { return p.test(text); })) {
      toast('Message blocked by safety filter');
      sys('Message blocked. Keep it respectful.');
      return;
    }
    var clean = text.trim();
    bubble(clean, true);
    if (messageInput) {
      messageInput.value = '';
      messageInput.style.height = 'auto';
    }
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify({ type: 'chat', text: clean }));
    } else {
      send({ type: 'chat', text: clean });
    }
  }

  // ---------- UI events ----------
  if (startTextBtn) startTextBtn.addEventListener('click', function () { findMatch(false); });
  if (startVideoBtn) startVideoBtn.addEventListener('click', function () { findMatch(true); });

  if (chatForm) {
    chatForm.addEventListener('submit', function (e) {
      e.preventDefault();
      sendChat(messageInput ? messageInput.value : '');
    });
  }
  if (messageInput) {
    messageInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat(messageInput.value);
      }
    });
    messageInput.addEventListener('input', function () {
      messageInput.style.height = 'auto';
      messageInput.style.height = Math.min(messageInput.scrollHeight, 112) + 'px';
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      if (!matched && !searching) {
        findMatch(mode === 'video');
        return;
      }
      teardown(true);
      sys('You ended the conversation.');
      toast('Conversation ended');
      showIdle();
    });
  }

  if (friendBtn) {
    friendBtn.addEventListener('click', function () {
      if (!matched || !partner.name) return;
      if (friends.some(function (f) { return f.name === partner.name && f.region === partner.region; })) {
        toast('Already in friends');
        return;
      }
      friends.push({
        name: partner.name,
        region: partner.region,
        avatar: partner.avatar,
        color: partner.color,
        username: partner.username
      });
      saveFriends();
      updateFriendsUI();
      friendBtn.disabled = true;
      friendBtn.innerHTML = '<i class="fas fa-check"></i> <span class="hidden sm:inline">Added</span>';
      friendBtn.classList.add('opacity-50', 'cursor-not-allowed');
      toast('Added ' + partner.name);
      sys('You added ' + partner.name + ' as a friend.');
    });
  }

  if (reportBtn) {
    reportBtn.addEventListener('click', function () {
      if (!matched) return;
      if (reportModal) reportModal.classList.remove('hidden');
    });
  }
  function closeRep() {
    if (reportModal) reportModal.classList.add('hidden');
    document.querySelectorAll('input[name="report-reason"]').forEach(function (r) { r.checked = false; });
  }
  if (closeReport) closeReport.addEventListener('click', closeRep);
  if (cancelReport) cancelReport.addEventListener('click', closeRep);
  if (submitReport) {
    submitReport.addEventListener('click', function () {
      var reason = document.querySelector('input[name="report-reason"]:checked');
      if (!reason) { toast('Select a reason'); return; }
      send({ type: 'report', reason: reason.value });
      closeRep();
      teardown(false);
      sys('Report submitted. Match ended.');
      toast('Report submitted');
      showIdle();
    });
  }

  if (friendsBtn) {
    friendsBtn.addEventListener('click', function () {
      if (!friendsPanel) return;
      friendsPanel.classList.toggle('hidden');
      friendsPanel.classList.toggle('flex');
    });
  }

  if (toggleMicBtn) {
    toggleMicBtn.addEventListener('click', function () {
      if (!localStream) return;
      micOn = !micOn;
      updateMediaIcons();
      toast(micOn ? 'Mic on' : 'Mic muted');
    });
  }
  if (toggleCamBtn) {
    toggleCamBtn.addEventListener('click', function () {
      if (!localStream) return;
      camOn = !camOn;
      updateMediaIcons();
      toast(camOn ? 'Camera on' : 'Camera off');
    });
  }
  if (endVideoBtn) {
    endVideoBtn.addEventListener('click', function () {
      if (localStream) {
        localStream.getVideoTracks().forEach(function (t) { t.enabled = false; t.stop(); });
      }
      camOn = false;
      updateMediaIcons();
      hideVideo();
      mode = 'text';
      if (modeBadge) {
        modeBadge.innerHTML = '<i class="fas fa-comment-dots"></i> Text';
        modeBadge.className = 'hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-xs font-medium text-slate-600';
      }
      sys('Video ended. Text continues.');
      toast('Video ended');
    });
  }

  if (retryServerBtn) {
    retryServerBtn.addEventListener('click', function () {
      if (serverWarning) {
        serverWarning.classList.add('hidden');
        serverWarning.style.display = 'none';
      }
      connectWS();
    });
  }

  // ---------- boot ----------
  try {
    var session = loadSession();
    if (session && session.username) {
      user = session;
      enterApp();
    }
    // else stay on auth modal
  } catch (err) {
    console.error('boot error', err);
    showAuth();
  }
})();
