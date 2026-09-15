/**
 * PeerPath - Complete Chat Client
 * --------------------------------
 * Features:
 * - Sign up / Sign in
 * - LocalStorage authentication
 * - WebSocket connection
 * - Random matchmaking
 * - Text chat
 * - WebRTC video/audio
 * - WebRTC data channel
 * - Friends
 * - Report
 * - Mic / camera controls
 * - Reconnect handling
 */

(function () {
  'use strict';

  /* =========================================================
     CONFIGURATION
     ========================================================= */

  var isFile = location.protocol === 'file:';

  /*
   * LOCAL:
   *   http://localhost:3000
   *   -> ws://localhost:3000
   *
   * DEPLOYED:
   *   GitHub Pages
   *   -> wss://YOUR-RENDER-SERVICE.onrender.com
   *
   * CHANGE ONLY THIS URL AFTER DEPLOYING.
   */
  var RENDER_WS_URL = 'https://peer-path-bbh1.onrender.com';

  var isLocal =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';

  var WS_URL = null;

  if (!isFile) {
    if (isLocal) {
      WS_URL =
        (location.protocol === 'https:' ? 'wss://' : 'ws://') +
        location.host;
    } else {
      WS_URL = RENDER_WS_URL;
    }
  }

  /*
   * STUN servers help WebRTC discover a network path
   * between the two users.
   */
  var ICE = {
    iceServers: [
      {
        urls: 'stun:stun.l.google.com:19302'
      },
      {
        urls: 'stun:stun1.l.google.com:19302'
      }
    ]
  };

  /*
   * Basic safety filter.
   */
  var BAD = [
    /\b(sex|porn|nude|naked|fuck|shit|bitch|asshole|dick|pussy|xxx|onlyfans)\b/i,
    /\b(send\s*nudes?|show\s*me|horny|sexy\s*pic)\b/i
  ];

  var COLORS = [
    'from-pink-400 to-rose-500',
    'from-blue-400 to-indigo-500',
    'from-purple-400 to-violet-500',
    'from-emerald-400 to-teal-500',
    'from-amber-400 to-orange-500',
    'from-sky-400 to-blue-600'
  ];


  /* =========================================================
     STATE
     ========================================================= */

  var user = null;

  var ws = null;
  var wsOk = false;

  var myId = null;
  var partnerId = null;

  var partner = {};

  var role = null;
  var mode = 'text';

  var matched = false;
  var searching = false;

  var friends = [];

  /*
   * WebRTC state.
   */
  var pc = null;
  var dc = null;

  var localStream = null;

  /*
   * Signals that arrive before PeerConnection is created.
   */
  var pendingSignals = [];

  /*
   * ICE candidates can arrive before the remote SDP
   * has been applied.
   */
  var pendingIceCandidates = [];

  var micOn = true;
  var camOn = true;


  /* =========================================================
     DOM HELPERS
     ========================================================= */

  function $(id) {
    return document.getElementById(id);
  }


  /* =========================================================
     DOM ELEMENTS
     ========================================================= */

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


  /* =========================================================
     GENERAL HELPERS
     ========================================================= */

  function toast(msg, ms) {
    ms = ms || 3000;

    if (!toastEl) {
      console.log(msg);
      return;
    }

    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');

    clearTimeout(toast._timer);

    toast._timer = setTimeout(function () {
      toastEl.classList.add('hidden');
    }, ms);
  }


  function esc(value) {
    var div = document.createElement('div');

    div.textContent =
      value == null ? '' : String(value);

    return div.innerHTML;
  }


  function colorFor(name) {
    var total = 0;
    var text = name || 'x';

    for (var i = 0; i < text.length; i++) {
      total += text.charCodeAt(i);
    }

    return COLORS[total % COLORS.length];
  }


  function setStatus(state, text) {
    if (!matchStatus) {
      return;
    }

    var colors = {
      idle: 'bg-slate-300',
      matching: 'bg-amber-400 matching-dot',
      connected: 'bg-accent-500'
    };

    matchStatus.innerHTML =
      '<span class="w-2 h-2 rounded-full ' +
      (colors[state] || colors.idle) +
      '"></span>' +
      '<span class="text-slate-600 font-medium">' +
      esc(text) +
      '</span>';
  }


  function sys(message) {
    if (!messagesEl) {
      return;
    }

    var div = document.createElement('div');

    div.className = 'system-msg';
    div.textContent = message;

    messagesEl.appendChild(div);

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }


  function bubble(text, mine) {
    if (!messagesEl) {
      return;
    }

    var row = document.createElement('div');

    row.className =
      'message-row ' +
      (mine ? 'mine' : 'theirs');

    var letter;

    if (mine) {
      letter =
        user && user.name
          ? user.name[0].toUpperCase()
          : 'Y';
    } else {
      letter =
        partner.avatar ||
        (partner.name && partner.name[0]) ||
        '?';
    }

    var color;

    if (mine) {
      color =
        (user && user.color) ||
        'from-slate-400 to-slate-600';
    } else {
      color =
        partner.color ||
        'from-primary-400 to-primary-600';
    }

    row.innerHTML =
      '<div class="message-avatar bg-gradient-to-br ' +
      color +
      '">' +
      esc(letter) +
      '</div>' +
      '<div class="message-bubble">' +
      esc(text) +
      '</div>';

    messagesEl.appendChild(row);

    messagesEl.scrollTop =
      messagesEl.scrollHeight;
  }


  function clearMessages() {
    if (!messagesEl) {
      return;
    }

    Array.prototype
      .slice.call(messagesEl.children)
      .forEach(function (child) {
        if (child.id !== 'empty-state') {
          child.remove();
        }
      });
  }


  /* =========================================================
     LOCAL STORAGE
     ========================================================= */

  function loadAccounts() {
    try {
      return JSON.parse(
        localStorage.getItem('peerpath_accounts') || '{}'
      );
    } catch (e) {
      return {};
    }
  }


  function saveAccounts(accounts) {
    localStorage.setItem(
      'peerpath_accounts',
      JSON.stringify(accounts)
    );
  }


  function loadSession() {
    try {
      return JSON.parse(
        localStorage.getItem('peerpath_session') || 'null'
      );
    } catch (e) {
      return null;
    }
  }


  function saveSession(session) {
    if (session) {
      localStorage.setItem(
        'peerpath_session',
        JSON.stringify(session)
      );
    } else {
      localStorage.removeItem(
        'peerpath_session'
      );
    }
  }


  function loadFriends() {
    if (!user) {
      return [];
    }

    try {
      return JSON.parse(
        localStorage.getItem(
          'peerpath_friends_' +
          user.username
        ) || '[]'
      );
    } catch (e) {
      return [];
    }
  }


  function saveFriends() {
    if (!user) {
      return;
    }

    localStorage.setItem(
      'peerpath_friends_' +
      user.username,
      JSON.stringify(friends)
    );
  }


  /* =========================================================
     FRIEND UI
     ========================================================= */

  function updateFriendsUI() {
    if (!friendsCount || !friendsList) {
      return;
    }

    friendsCount.textContent =
      String(friends.length);

    friendsCount.classList.toggle(
      'hidden',
      friends.length === 0
    );

    if (!friends.length) {
      friendsList.innerHTML =
        '<p class="text-sm text-slate-400 text-center py-8">' +
        'No friends yet.' +
        '</p>';

      return;
    }

    friendsList.innerHTML =
      friends
        .map(function (friend) {
          return (
            '<div class="friend-card">' +

            '<div class="w-10 h-10 rounded-full ' +
            'bg-gradient-to-br ' +
            (friend.color ||
              'from-primary-400 to-primary-600') +
            ' flex items-center justify-center ' +
            'text-white text-sm font-bold">' +

            esc(friend.avatar || '?') +

            '</div>' +

            '<div class="min-w-0 flex-1">' +

            '<div class="font-medium text-slate-900 ' +
            'text-sm truncate">' +
            esc(friend.name) +
            '</div>' +

            '<div class="text-xs text-slate-500 truncate">' +
            esc(friend.region || '') +
            '</div>' +

            '</div>' +

            '</div>'
          );
        })
        .join('');
  }


  /* =========================================================
     USER UI
     ========================================================= */

  function showUserUI() {
    if (!user) {
      return;
    }

    var letter =
      (user.name ||
        user.username ||
        '?')[0].toUpperCase();

    if (userAvatar) {
      userAvatar.textContent = letter;

      userAvatar.className =
        'w-8 h-8 rounded-full bg-gradient-to-br ' +
        (user.color ||
          'from-primary-500 to-primary-700') +
        ' text-white text-xs font-bold ' +
        'flex items-center justify-center';
    }

    if (userDisplayName) {
      userDisplayName.textContent =
        user.name || user.username;
    }

    if (ddName) {
      ddName.textContent =
        user.name || user.username;
    }

    if (ddRegion) {
      ddRegion.textContent =
        '@' +
        user.username +
        (user.region
          ? ' · ' + user.region
          : '');
    }
  }


  /* =========================================================
     APP / AUTH VISIBILITY
     ========================================================= */

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

      setStatus(
        'idle',
        'Not connected'
      );

      if (emptyState) {
        emptyState.classList.remove('hidden');
      }

      if (partnerBar) {
        partnerBar.classList.add('hidden');
      }

      if (inputArea) {
        inputArea.classList.add('hidden');
      }

      hideVideo();

      connectWS();

      toast(
        'Welcome, ' +
        (user.name || user.username) +
        '!'
      );

    } catch (err) {
      console.error(
        'enterApp failed',
        err
      );

      alert(
        'Login UI error: ' +
        err.message +
        '. Please refresh the page.'
      );
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

    if (formSignin) {
      formSignin.reset();
    }

    if (formSignup) {
      formSignup.reset();
    }
  }


  /* =========================================================
     AUTH TABS
     ========================================================= */

  if (tabSignin) {
    tabSignin.addEventListener(
      'click',
      function () {
        tabSignin.className =
          'flex-1 py-2 rounded-lg text-sm font-semibold ' +
          'bg-white shadow text-primary-700 transition';

        if (tabSignup) {
          tabSignup.className =
            'flex-1 py-2 rounded-lg text-sm font-semibold ' +
            'text-slate-500 hover:text-slate-700 transition';
        }

        if (formSignin) {
          formSignin.classList.remove('hidden');
        }

        if (formSignup) {
          formSignup.classList.add('hidden');
        }

        if (signinError) {
          signinError.classList.add('hidden');
        }
      }
    );
  }


  if (tabSignup) {
    tabSignup.addEventListener(
      'click',
      function () {
        tabSignup.className =
          'flex-1 py-2 rounded-lg text-sm font-semibold ' +
          'bg-white shadow text-primary-700 transition';

        if (tabSignin) {
          tabSignin.className =
            'flex-1 py-2 rounded-lg text-sm font-semibold ' +
            'text-slate-500 hover:text-slate-700 transition';
        }

        if (formSignup) {
          formSignup.classList.remove('hidden');
        }

        if (formSignin) {
          formSignin.classList.add('hidden');
        }

        if (signupError) {
          signupError.classList.add('hidden');
        }
      }
    );
  }


  /* =========================================================
     AUTH ERROR UI
     ========================================================= */

  function showSignupErr(message) {
    if (!signupError) {
      alert(message);
      return;
    }

    signupError.textContent = message;
    signupError.classList.remove('hidden');
  }


  function showSigninErr(message) {
    if (!signinError) {
      alert(message);
      return;
    }

    signinError.textContent = message;
    signinError.classList.remove('hidden');
  }


  /* =========================================================
     SIGN UP
     ========================================================= */

  function doSignup(e) {
    if (e) {
      e.preventDefault();
    }

    try {
      if (signupError) {
        signupError.classList.add('hidden');
      }

      var name =
        (($('signup-name') &&
          $('signup-name').value) ||
          '').trim();

      var username =
        (($('signup-user') &&
          $('signup-user').value) ||
          '').trim().toLowerCase();

      var pass =
        ($('signup-pass') &&
          $('signup-pass').value) ||
        '';

      var region =
        (($('signup-region') &&
          $('signup-region').value) ||
          '').trim();

      var ageOk =
        $('signup-age') &&
        $('signup-age').checked;


      if (!name) {
        return showSignupErr(
          'Please enter a display name.'
        );
      }

      if (username.length < 3) {
        return showSignupErr(
          'Username must be at least 3 characters.'
        );
      }

      if (!/^[a-z0-9_]+$/.test(username)) {
        return showSignupErr(
          'Username: only letters, numbers, underscore (no spaces).'
        );
      }

      if (pass.length < 4) {
        return showSignupErr(
          'Password must be at least 4 characters.'
        );
      }

      if (!region) {
        return showSignupErr(
          'Please enter your region / country.'
        );
      }

      if (!ageOk) {
        return showSignupErr(
          'Please confirm you are 18 or older.'
        );
      }


      var accounts = loadAccounts();

      if (accounts[username]) {
        return showSignupErr(
          'Username already taken. Use Sign In.'
        );
      }


      var record = {
        username: username,
        password: pass,
        name: name,
        region: region,
        color: colorFor(name),
        createdAt: Date.now()
      };


      accounts[username] = record;

      saveAccounts(accounts);


      user = {
        username: record.username,
        name: record.name,
        region: record.region,
        color: record.color
      };


      saveSession(user);

      enterApp();

    } catch (err) {
      console.error(err);

      showSignupErr(
        'Signup failed: ' +
        err.message
      );
    }
  }


  /* =========================================================
     SIGN IN
     ========================================================= */

  function doSignin(e) {
    if (e) {
      e.preventDefault();
    }

    try {
      if (signinError) {
        signinError.classList.add('hidden');
      }

      var username =
        (($('signin-user') &&
          $('signin-user').value) ||
          '').trim().toLowerCase();

      var password =
        ($('signin-pass') &&
          $('signin-pass').value) ||
        '';

      var accounts = loadAccounts();

      var account = accounts[username];


      if (
        !account ||
        account.password !== password
      ) {
        return showSigninErr(
          'Invalid username or password.'
        );
      }


      user = {
        username: account.username,
        name: account.name,
        region: account.region,
        color: account.color
      };


      saveSession(user);

      enterApp();

    } catch (err) {
      console.error(err);

      showSigninErr(
        'Sign in failed: ' +
        err.message
      );
    }
  }


  if (formSignup) {
    formSignup.addEventListener(
      'submit',
      doSignup
    );
  }


  if (formSignin) {
    formSignin.addEventListener(
      'submit',
      doSignin
    );
  }


  var btnSignup = $('btn-signup');

  if (btnSignup) {
    btnSignup.addEventListener(
      'click',
      function (e) {
        if (
          formSignup &&
          !formSignup.classList.contains('hidden')
        ) {
          doSignup(e);
        }
      }
    );
  }


  /* =========================================================
     USER MENU
     ========================================================= */

  if (userMenuBtn) {
    userMenuBtn.addEventListener(
      'click',
      function (e) {
        e.stopPropagation();

        if (userDropdown) {
          userDropdown.classList.toggle(
            'hidden'
          );
        }
      }
    );
  }


  document.addEventListener(
    'click',
    function () {
      if (userDropdown) {
        userDropdown.classList.add(
          'hidden'
        );
      }
    }
  );


  if (logoutBtn) {
    logoutBtn.addEventListener(
      'click',
      function () {
        teardown(true);

        saveSession(null);

        user = null;

        showAuth();
      }
    );
  }


  /* =========================================================
     WEBSOCKET CONNECTION
     ========================================================= */

  function connectWS() {
    if (isFile || !WS_URL) {
      if (connStatus) {
        connStatus.textContent =
          'Open http://localhost:3000 after running: node server.js';

        connStatus.className =
          'mt-5 text-xs text-red-500';
      }

      return;
    }


    if (
      ws &&
      (
        ws.readyState === WebSocket.CONNECTING ||
        ws.readyState === WebSocket.OPEN
      )
    ) {
      return;
    }


    if (connStatus) {
      connStatus.textContent =
        'Connecting to server...';

      connStatus.className =
        'mt-5 text-xs text-slate-400';
    }


    try {
      ws = new WebSocket(WS_URL);

    } catch (err) {
      console.error(
        'WebSocket creation error:',
        err
      );

      if (connStatus) {
        connStatus.textContent =
          'Cannot open WebSocket. Is the server running?';
      }

      return;
    }


    ws.onopen = function () {
      wsOk = true;

      if (serverWarning) {
        serverWarning.classList.add(
          'hidden'
        );

        serverWarning.style.display =
          'none';
      }


      if (connStatus) {
        connStatus.textContent =
          'Server connected · Ready to match';

        connStatus.className =
          'mt-5 text-xs text-accent-600';
      }
    };


    ws.onmessage = function (event) {
      try {
        var data =
          JSON.parse(event.data);

        onSignal(data);

      } catch (err) {
        console.error(
          'WebSocket message error:',
          err
        );
      }
    };


    ws.onclose = function () {
      wsOk = false;

      if (connStatus) {
        connStatus.textContent =
          'Disconnected. Reconnecting...';

        connStatus.className =
          'mt-5 text-xs text-red-500';
      }


      setTimeout(
        connectWS,
        2500
      );
    };


    ws.onerror = function () {
      wsOk = false;

      if (connStatus) {
        connStatus.textContent =
          'Server not reachable. Check your Render server.';
        connStatus.className =
          'mt-5 text-xs text-red-500';
      }
    };
  }


  function send(object) {
    if (
      ws &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(
        JSON.stringify(object)
      );

      return true;
    }


    toast(
      'Not connected to server.'
    );

    return false;
  }


  /* =========================================================
     SERVER SIGNAL HANDLER
     ========================================================= */

  function onSignal(data) {
    if (!data || !data.type) {
      return;
    }


    switch (data.type) {

      case 'welcome':

        myId = data.id;

        break;


      case 'searching':

        searching = true;

        setStatus(
          'matching',
          'Looking for someone...'
        );

        break;


      case 'matched':

        searching = false;
        matched = true;

        partnerId =
          data.partnerId;

        role =
          data.role;

        mode =
          data.mode || mode;

        partner =
          data.partner || {};

        onMatched();

        break;


      case 'signal':

        if (
          data.from === partnerId &&
          data.signal
        ) {
          handleRTC(
            data.signal
          );
        }

        break;


      case 'chat':

        if (
          data.from === partnerId &&
          data.text
        ) {
          bubble(
            data.text,
            false
          );
        }

        break;


      case 'partner-left':

        sys(
          data.reason ||
          'Partner left.'
        );

        teardown(false);

        showIdle();

        toast(
          'Partner disconnected'
        );

        break;


      case 'idle':

        teardown(false);

        showIdle();

        break;


      case 'report-ack':

        teardown(false);

        showIdle();

        break;
    }
  }


  /* =========================================================
     WEBRTC - DATA CHANNEL
     ========================================================= */

  function setupDC(channel) {
    if (!channel) {
      return;
    }


    channel.onopen = function () {
      console.log(
        'WebRTC data channel connected'
      );
    };


    channel.onclose = function () {
      console.log(
        'WebRTC data channel closed'
      );
    };


    channel.onerror = function (error) {
      console.error(
        'Data channel error:',
        error
      );
    };


    channel.onmessage = function (event) {
      try {
        var message =
          JSON.parse(event.data);

        if (
          message.type === 'chat' &&
          message.text
        ) {
          bubble(
            message.text,
            false
          );
        }

      } catch (err) {

        if (
          typeof event.data ===
          'string'
        ) {
          bubble(
            event.data,
            false
          );
        }
      }
    };
  }


  /* =========================================================
     WEBRTC - CREATE PEER CONNECTION
     ========================================================= */

  async function createPC() {

    /*
     * Close an old connection first.
     */
    if (pc) {
      try {
        pc.close();
      } catch (e) {}

      pc = null;
    }


    dc = null;


    /*
     * Create new PeerConnection.
     */
    pc = new RTCPeerConnection(
      ICE
    );


    console.log(
      'PeerConnection created. Role:',
      role
    );


    /* -------------------------------------------------------
       ICE CANDIDATE
       ------------------------------------------------------- */

    pc.onicecandidate =
      function (event) {

        if (
          event.candidate &&
          partnerId
        ) {

          send({
            type: 'signal',

            to: partnerId,

            signal: {
              type: 'ice',

              candidate:
                event.candidate
            }
          });
        }
      };


    /* -------------------------------------------------------
       REMOTE TRACK
       ------------------------------------------------------- */

    pc.ontrack =
      function (event) {

        console.log(
          'Remote track received',
          event
        );


        if (
          remoteVideo &&
          event.streams &&
          event.streams[0]
        ) {

          var remoteStream =
            event.streams[0];


          remoteVideo.srcObject =
            remoteStream;


          remoteVideo.classList.remove(
            'hidden'
          );


          if (remotePlaceholder) {
            remotePlaceholder.classList.add(
              'hidden'
            );
          }


          /*
           * Some browsers need play()
           * to be called explicitly.
           */
          remoteVideo
            .play()
            .catch(function () {});
        }
      };


    /* -------------------------------------------------------
       CONNECTION STATE
       ------------------------------------------------------- */

    pc.onconnectionstatechange =
      function () {

        if (!pc) {
          return;
        }


        console.log(
          'WebRTC connection state:',
          pc.connectionState
        );


        if (
          pc.connectionState ===
          'connected'
        ) {

          setStatus(
            'connected',
            'Connected'
          );

          sys(
            'Video connection established.'
          );
        }


        if (
          pc.connectionState ===
          'connecting'
        ) {

          setStatus(
            'matching',
            'Connecting video...'
          );
        }


        if (
          pc.connectionState ===
          'disconnected'
        ) {

          console.warn(
            'WebRTC disconnected'
          );
        }


        if (
          pc.connectionState ===
          'failed'
        ) {

          console.error(
            'WebRTC connection failed'
          );

          sys(
            'Media connection failed — text chat still works.'
          );
        }
      };


    /* -------------------------------------------------------
       ICE CONNECTION STATE
       ------------------------------------------------------- */

    pc.oniceconnectionstatechange =
      function () {

        if (!pc) {
          return;
        }

        console.log(
          'ICE state:',
          pc.iceConnectionState
        );
      };


    /* -------------------------------------------------------
       DATA CHANNEL
       ------------------------------------------------------- */

    if (role === 'offerer') {

      dc =
        pc.createDataChannel(
          'chat',
          {
            ordered: true
          }
        );

      setupDC(dc);

    } else {

      pc.ondatachannel =
        function (event) {

          dc =
            event.channel;

          setupDC(dc);
        };
    }


    /* -------------------------------------------------------
       ADD LOCAL MEDIA TRACKS
       ------------------------------------------------------- */

    if (localStream) {

      localStream
        .getTracks()
        .forEach(function (track) {

          pc.addTrack(
            track,
            localStream
          );
        });
    }


    /* -------------------------------------------------------
       PROCESS SIGNALS THAT ARRIVED
       BEFORE PC WAS READY
       ------------------------------------------------------- */

    if (pendingSignals.length) {

      var queuedSignals =
        pendingSignals.slice();

      pendingSignals = [];


      for (
        var i = 0;
        i < queuedSignals.length;
        i++
      ) {

        await handleRTC(
          queuedSignals[i]
        );
      }
    }
  }


  /* =========================================================
     WEBRTC - HANDLE SIGNAL
     ========================================================= */

  async function handleRTC(signal) {

    if (!signal) {
      return;
    }


    /*
     * If PC doesn't exist yet,
     * save the signal.
     */
    if (!pc) {

      console.log(
        'PC not ready. Queueing signal:',
        signal.type
      );

      pendingSignals.push(
        signal
      );

      return;
    }


    try {

      /* =====================================================
         OFFER
         ===================================================== */

      if (
        signal.type ===
        'offer'
      ) {

        console.log(
          'Received WebRTC offer'
        );


        await pc.setRemoteDescription(
          new RTCSessionDescription(
            signal.sdp
          )
        );


        /*
         * Now ICE candidates can safely
         * be added.
         */
        await flushPendingIce();


        var answer =
          await pc.createAnswer();


        await pc.setLocalDescription(
          answer
        );


        send({
          type: 'signal',

          to: partnerId,

          signal: {
            type: 'answer',

            sdp:
              pc.localDescription
          }
        });


        /*
         * Some ICE candidates may have
         * arrived while the answer was
         * being created.
         */
        await flushPendingIce();

      }


      /* =====================================================
         ANSWER
         ===================================================== */

      else if (
        signal.type ===
        'answer'
      ) {

        console.log(
          'Received WebRTC answer'
        );


        await pc.setRemoteDescription(
          new RTCSessionDescription(
            signal.sdp
          )
        );


        await flushPendingIce();
      }


      /* =====================================================
         ICE CANDIDATE
         ===================================================== */

      else if (
        signal.type === 'ice' &&
        signal.candidate
      ) {

        /*
         * IMPORTANT:
         *
         * addIceCandidate() should not
         * be called before a remote
         * description exists.
         *
         * Therefore we queue it.
         */
        if (
          !pc.remoteDescription
        ) {

          console.log(
            'Queueing ICE candidate'
          );

          pendingIceCandidates.push(
            signal.candidate
          );

          return;
        }


        try {

          await pc.addIceCandidate(
            new RTCIceCandidate(
              signal.candidate
            )
          );

        } catch (iceError) {

          console.warn(
            'ICE candidate error:',
            iceError
          );
        }
      }

    } catch (error) {

      console.error(
        'RTC signal error:',
        error
      );
    }
  }


  /* =========================================================
     WEBRTC - FLUSH ICE QUEUE
     ========================================================= */

  async function flushPendingIce() {

    if (!pc) {
      return;
    }


    if (
      !pc.remoteDescription
    ) {
      return;
    }


    if (
      !pendingIceCandidates.length
    ) {
      return;
    }


    var candidates =
      pendingIceCandidates.slice();

    pendingIceCandidates = [];


    for (
      var i = 0;
      i < candidates.length;
      i++
    ) {

      try {

        await pc.addIceCandidate(
          new RTCIceCandidate(
            candidates[i]
          )
        );

      } catch (error) {

        console.warn(
          'Queued ICE candidate failed:',
          error
        );
      }
    }
  }


  /* =========================================================
     WEBRTC - START OFFER
     ========================================================= */

  async function startOffer() {

    if (
      !pc ||
      role !== 'offerer'
    ) {
      return;
    }


    try {

      console.log(
        'Creating WebRTC offer...'
      );


      var offer =
        await pc.createOffer();


      await pc.setLocalDescription(
        offer
      );


      console.log(
        'Sending WebRTC offer...'
      );


      send({
        type: 'signal',

        to: partnerId,

        signal: {
          type: 'offer',

          sdp:
            pc.localDescription
        }
      });

    } catch (error) {

      console.error(
        'Offer error:',
        error
      );
    }
  }


  /* =========================================================
     MEDIA
     ========================================================= */

  async function startMedia(
    wantVideo
  ) {

    try {

      /*
       * Stop previous stream.
       */
      if (localStream) {

        localStream
          .getTracks()
          .forEach(function (track) {
            track.stop();
          });

        localStream = null;
      }


      localStream =
        await navigator.mediaDevices.getUserMedia({

          audio: true,

          video: wantVideo
            ? {
                facingMode: 'user',

                width: {
                  ideal: 640
                },

                height: {
                  ideal: 480
                }
              }
            : false
        });


      if (localVideo) {

        localVideo.srcObject =
          localStream;

        localVideo
          .play()
          .catch(function () {});
      }


      if (localOff) {
        localOff.classList.add(
          'hidden'
        );
      }


      micOn = true;

      camOn =
        !!(
          wantVideo &&
          localStream.getVideoTracks().length
        );


      updateMediaIcons();


      return true;

    } catch (error) {

      console.warn(
        'getUserMedia:',
        error.name,
        error.message
      );


      var message =
        'Could not access camera/mic.';


      if (
        error.name ===
          'NotAllowedError' ||
        error.name ===
          'PermissionDeniedError'
      ) {

        message =
          'Permission denied. Allow camera & mic, then try again.';

      } else if (
        error.name ===
        'NotFoundError'
      ) {

        message =
          'No camera or microphone found.';

      } else if (
        error.name ===
        'NotReadableError'
      ) {

        message =
          'Camera is busy. Close Zoom/Teams and retry.';
      }


      toast(
        message,
        5000
      );

      sys(message);


      if (localOff) {
        localOff.classList.remove(
          'hidden'
        );
      }


      /*
       * If video failed,
       * try microphone only.
       */
      if (wantVideo) {

        try {

          localStream =
            await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false
            });


          micOn = true;
          camOn = false;

          updateMediaIcons();

          sys(
            'Continuing with microphone only.'
          );

          return true;

        } catch (micError) {

          console.warn(
            'Microphone fallback failed:',
            micError
          );

          return false;
        }
      }


      return false;
    }
  }


  /* =========================================================
     STOP MEDIA
     ========================================================= */

  function stopMedia() {

    if (localStream) {

      localStream
        .getTracks()
        .forEach(function (track) {
          track.stop();
        });

      localStream = null;
    }


    if (localVideo) {
      localVideo.srcObject = null;
    }


    if (remoteVideo) {

      remoteVideo.srcObject =
        null;

      remoteVideo.classList.add(
        'hidden'
      );
    }


    if (localOff) {
      localOff.classList.remove(
        'hidden'
      );
    }


    if (remotePlaceholder) {
      remotePlaceholder.classList.remove(
        'hidden'
      );
    }
  }


  /* =========================================================
     MEDIA CONTROLS UI
     ========================================================= */

  function updateMediaIcons() {

    if (micIcon) {

      micIcon.className =
        micOn
          ? 'fas fa-microphone'
          : 'fas fa-microphone-slash';
    }


    if (toggleMicBtn) {

      toggleMicBtn.classList.toggle(
        'bg-red-600',
        !micOn
      );

      toggleMicBtn.classList.toggle(
        'bg-slate-700',
        micOn
      );
    }


    if (camIcon) {

      camIcon.className =
        camOn
          ? 'fas fa-video'
          : 'fas fa-video-slash';
    }


    if (toggleCamBtn) {

      toggleCamBtn.classList.toggle(
        'bg-red-600',
        !camOn
      );

      toggleCamBtn.classList.toggle(
        'bg-slate-700',
        camOn
      );
    }


    if (localStream) {

      localStream
        .getAudioTracks()
        .forEach(function (track) {
          track.enabled = micOn;
        });


      localStream
        .getVideoTracks()
        .forEach(function (track) {
          track.enabled = camOn;
        });
    }


    if (
      camOn &&
      localStream &&
      localStream
        .getVideoTracks()
        .some(function (track) {
          return track.readyState === 'live';
        })
    ) {

      if (localOff) {
        localOff.classList.add(
          'hidden'
        );
      }

    } else {

      if (localOff) {
        localOff.classList.remove(
          'hidden'
        );
      }
    }
  }


  /* =========================================================
     VIDEO UI
     ========================================================= */

  function showVideo() {

    if (!videoArea) {
      return;
    }


    videoArea.classList.remove(
      'hidden'
    );

    videoArea.style.display =
      'flex';

    videoArea.classList.add(
      'flex'
    );


    if (remoteAvatarBig) {

      remoteAvatarBig.textContent =
        partner.avatar ||
        (
          partner.name &&
          partner.name[0]
        ) ||
        '?';
    }


    if (remoteNameBig) {

      remoteNameBig.textContent =
        partner.name ||
        'Partner';
    }
  }


  function hideVideo() {

    if (!videoArea) {
      return;
    }


    videoArea.classList.add(
      'hidden'
    );

    videoArea.style.display =
      'none';

    videoArea.classList.remove(
      'flex'
    );
  }


  /* =========================================================
     PROFILE
     ========================================================= */

  function myProfile() {

    return {

      name:
        user.name ||
        user.username,

      username:
        user.username,

      region:
        user.region ||
        'Unknown',

      avatar:
        (
          user.name ||
          user.username ||
          '?'
        )[0].toUpperCase(),

      color:
        user.color ||
        colorFor(user.name)
    };
  }


  /* =========================================================
     MATCHMAKING
     ========================================================= */

  async function findMatch(
    wantVideo
  ) {

    if (!user) {

      toast(
        'Please sign in first'
      );

      return;
    }


    if (!wsOk) {

      toast(
        'Server not connected.'
      );

      if (connStatus) {

        connStatus.textContent =
          'Server offline — check your Render server.';
      }

      return;
    }


    if (
      searching ||
      matched
    ) {
      return;
    }


    mode =
      wantVideo
        ? 'video'
        : 'text';


    clearMessages();


    if (emptyState) {
      emptyState.classList.add(
        'hidden'
      );
    }


    if (partnerBar) {
      partnerBar.classList.add(
        'hidden'
      );
    }


    if (inputArea) {
      inputArea.classList.add(
        'hidden'
      );
    }


    hideVideo();

    stopMedia();


    setStatus(
      'matching',
      'Looking for someone...'
    );


    if (wantVideo) {

      showVideo();

      sys(
        'Starting camera...'
      );


      var cameraOk =
        await startMedia(true);


      if (!cameraOk) {

        sys(
          'Camera failed. Try Text Only instead.'
        );

        setStatus(
          'idle',
          'Not connected'
        );

        if (emptyState) {
          emptyState.classList.remove(
            'hidden'
          );
        }

        hideVideo();

        return;
      }


      sys(
        'Camera ready. Waiting for a partner...'
      );

    } else {

      sys(
        'Waiting for a partner...'
      );
    }


    send({

      type: 'find',

      mode: mode,

      profile:
        myProfile()
    });
  }


  /* =========================================================
     MATCHED
     ========================================================= */

  async function onMatched() {

    setStatus(
      'matching',
      'Connecting...'
    );


    if (partnerBar) {
      partnerBar.classList.remove(
        'hidden'
      );
    }


    if (inputArea) {
      inputArea.classList.remove(
        'hidden'
      );
    }


    if (emptyState) {
      emptyState.classList.add(
        'hidden'
      );
    }


    if (partnerNameEl) {

      partnerNameEl.textContent =
        partner.name ||
        'Partner';
    }


    if (partnerMeta) {

      partnerMeta.textContent =
        [
          partner.region,

          partner.username
            ? '@' +
              partner.username
            : ''
        ]
          .filter(Boolean)
          .join(' · ') ||
        'PeerPath user';
    }


    if (partnerAvatar) {

      partnerAvatar.textContent =
        partner.avatar ||
        (
          partner.name &&
          partner.name[0]
        ) ||
        '?';


      partnerAvatar.className =
        'w-9 h-9 rounded-full ' +
        'bg-gradient-to-br ' +
        (
          partner.color ||
          'from-primary-400 to-primary-600'
        ) +
        ' flex items-center justify-center ' +
        'text-white font-bold text-sm shrink-0';
    }


    if (friendBtn) {

      friendBtn.disabled = false;

      friendBtn.innerHTML =
        '<i class="fas fa-user-plus"></i>' +
        '<span class="hidden sm:inline">Friend</span>';

      friendBtn.classList.remove(
        'opacity-50',
        'cursor-not-allowed'
      );
    }


    sys(
      'Matched with ' +
      (
        partner.name ||
        'a partner'
      ) +
      (
        partner.region
          ? ' from ' +
            partner.region
          : ''
      ) +
      '. Be respectful.'
    );


    if (mode === 'video') {

      showVideo();


      if (
        !localStream ||
        !localStream.getVideoTracks().length
      ) {

        await startMedia(true);
      }
    }


    if (modeBadge) {

      modeBadge.classList.remove(
        'hidden'
      );


      if (mode === 'video') {

        modeBadge.innerHTML =
          '<i class="fas fa-video"></i> Video + Text';

        modeBadge.className =
          'hidden sm:inline-flex items-center gap-1 ' +
          'px-2.5 py-1 rounded-lg bg-primary-50 ' +
          'text-primary-700 text-xs font-medium';

      } else {

        modeBadge.innerHTML =
          '<i class="fas fa-comment-dots"></i> Text';

        modeBadge.className =
          'hidden sm:inline-flex items-center gap-1 ' +
          'px-2.5 py-1 rounded-lg bg-slate-100 ' +
          'text-xs font-medium text-slate-600';
      }
    }


    /*
     * IMPORTANT:
     * Create PeerConnection BEFORE
     * starting the offer.
     */
    await createPC();


    if (role === 'offerer') {

      await startOffer();
    }
  }


  /* =========================================================
     TEARDOWN
     ========================================================= */

  function teardown(notify) {

    matched = false;
    searching = false;


    /*
     * Clear WebRTC queues.
     */
    pendingSignals = [];
    pendingIceCandidates = [];


    if (dc) {

      try {
        dc.close();
      } catch (e) {}

      dc = null;
    }


    if (pc) {

      try {
        pc.close();
      } catch (e) {}

      pc = null;
    }


    stopMedia();


    partnerId = null;
    role = null;

    partner = {};


    hideVideo();


    if (notify) {

      send({
        type: 'leave'
      });
    }
  }


  /* =========================================================
     IDLE UI
     ========================================================= */

  function showIdle() {

    if (partnerBar) {
      partnerBar.classList.add(
        'hidden'
      );
    }


    if (inputArea) {
      inputArea.classList.add(
        'hidden'
      );
    }


    hideVideo();


    setStatus(
      'idle',
      'Not connected'
    );


    if (modeBadge) {
      modeBadge.classList.add(
        'hidden'
      );
    }


    setTimeout(
      function () {

        if (emptyState) {

          emptyState.classList.remove(
            'hidden'
          );
        }

      },
      200
    );
  }


  /* =========================================================
     CHAT
     ========================================================= */

  function sendChat(text) {

    if (
      !text ||
      !text.trim() ||
      !matched
    ) {
      return;
    }


    if (
      BAD.some(function (pattern) {
        return pattern.test(text);
      })
    ) {

      toast(
        'Message blocked by safety filter'
      );

      sys(
        'Message blocked. Keep it respectful.'
      );

      return;
    }


    var clean =
      text.trim();


    bubble(
      clean,
      true
    );


    if (messageInput) {

      messageInput.value = '';

      messageInput.style.height =
        'auto';
    }


    /*
     * Prefer WebRTC DataChannel.
     */
    if (
      dc &&
      dc.readyState === 'open'
    ) {

      dc.send(
        JSON.stringify({
          type: 'chat',
          text: clean
        })
      );

    } else {

      /*
       * Fallback to WebSocket.
       */
      send({
        type: 'chat',
        text: clean
      });
    }
  }


  /* =========================================================
     UI EVENTS
     ========================================================= */

  if (startTextBtn) {

    startTextBtn.addEventListener(
      'click',
      function () {
        findMatch(false);
      }
    );
  }


  if (startVideoBtn) {

    startVideoBtn.addEventListener(
      'click',
      function () {
        findMatch(true);
      }
    );
  }


  if (chatForm) {

    chatForm.addEventListener(
      'submit',
      function (event) {

        event.preventDefault();

        sendChat(
          messageInput
            ? messageInput.value
            : ''
        );
      }
    );
  }


  if (messageInput) {

    messageInput.addEventListener(
      'keydown',
      function (event) {

        if (
          event.key === 'Enter' &&
          !event.shiftKey
        ) {

          event.preventDefault();

          sendChat(
            messageInput.value
          );
        }
      }
    );


    messageInput.addEventListener(
      'input',
      function () {

        messageInput.style.height =
          'auto';

        messageInput.style.height =
          Math.min(
            messageInput.scrollHeight,
            112
          ) +
          'px';
      }
    );
  }


  /* =========================================================
     NEXT / END
     ========================================================= */

  if (nextBtn) {

    nextBtn.addEventListener(
      'click',
      function () {

        if (
          !matched &&
          !searching
        ) {

          findMatch(
            mode === 'video'
          );

          return;
        }


        teardown(true);


        sys(
          'You ended the conversation.'
        );


        toast(
          'Conversation ended'
        );


        showIdle();
      }
    );
  }


  /* =========================================================
     FRIEND BUTTON
     ========================================================= */

  if (friendBtn) {

    friendBtn.addEventListener(
      'click',
      function () {

        if (
          !matched ||
          !partner.name
        ) {
          return;
        }


        if (
          friends.some(function (friend) {

            return (
              friend.name ===
                partner.name &&
              friend.region ===
                partner.region
            );
          })
        ) {

          toast(
            'Already in friends'
          );

          return;
        }


        friends.push({

          name:
            partner.name,

          region:
            partner.region,

          avatar:
            partner.avatar,

          color:
            partner.color,

          username:
            partner.username
        });


        saveFriends();

        updateFriendsUI();


        friendBtn.disabled =
          true;


        friendBtn.innerHTML =
          '<i class="fas fa-check"></i>' +
          '<span class="hidden sm:inline">Added</span>';


        friendBtn.classList.add(
          'opacity-50',
          'cursor-not-allowed'
        );


        toast(
          'Added ' +
          partner.name
        );


        sys(
          'You added ' +
          partner.name +
          ' as a friend.'
        );
      }
    );
  }


  /* =========================================================
     REPORT
     ========================================================= */

  if (reportBtn) {

    reportBtn.addEventListener(
      'click',
      function () {

        if (!matched) {
          return;
        }


        if (reportModal) {

          reportModal.classList.remove(
            'hidden'
          );
        }
      }
    );
  }


  function closeRep() {

    if (reportModal) {

      reportModal.classList.add(
        'hidden'
      );
    }


    document
      .querySelectorAll(
        'input[name="report-reason"]'
      )
      .forEach(function (radio) {

        radio.checked = false;
      });
  }


  if (closeReport) {
    closeReport.addEventListener(
      'click',
      closeRep
    );
  }


  if (cancelReport) {
    cancelReport.addEventListener(
      'click',
      closeRep
    );
  }


  if (submitReport) {

    submitReport.addEventListener(
      'click',
      function () {

        var reason =
          document.querySelector(
            'input[name="report-reason"]:checked'
          );


        if (!reason) {

          toast(
            'Select a reason'
          );

          return;
        }


        send({

          type: 'report',

          reason:
            reason.value
        });


        closeRep();


        teardown(false);


        sys(
          'Report submitted. Match ended.'
        );


        toast(
          'Report submitted'
        );


        showIdle();
      }
    );
  }


  /* =========================================================
     FRIENDS PANEL
     ========================================================= */

  if (friendsBtn) {

    friendsBtn.addEventListener(
      'click',
      function () {

        if (!friendsPanel) {
          return;
        }


        friendsPanel.classList.toggle(
          'hidden'
        );

        friendsPanel.classList.toggle(
          'flex'
        );
      }
    );
  }


  /* =========================================================
     MICROPHONE
     ========================================================= */

  if (toggleMicBtn) {

    toggleMicBtn.addEventListener(
      'click',
      function () {

        if (!localStream) {
          return;
        }


        micOn = !micOn;


        updateMediaIcons();


        toast(
          micOn
            ? 'Mic on'
            : 'Mic muted'
        );
      }
    );
  }


  /* =========================================================
     CAMERA
     ========================================================= */

  if (toggleCamBtn) {

    toggleCamBtn.addEventListener(
      'click',
      function () {

        if (!localStream) {
          return;
        }


        var videoTracks =
          localStream.getVideoTracks();


        if (!videoTracks.length) {

          toast(
            'No camera track available.'
          );

          return;
        }


        camOn = !camOn;


        updateMediaIcons();


        toast(
          camOn
            ? 'Camera on'
            : 'Camera off'
        );
      }
    );
  }


  /* =========================================================
     END VIDEO
     ========================================================= */

  if (endVideoBtn) {

    endVideoBtn.addEventListener(
      'click',
      function () {

        if (localStream) {

          localStream
            .getVideoTracks()
            .forEach(function (track) {

              track.enabled =
                false;

              track.stop();
            });
        }


        camOn = false;


        updateMediaIcons();


        hideVideo();


        mode = 'text';


        if (modeBadge) {

          modeBadge.innerHTML =
            '<i class="fas fa-comment-dots"></i> Text';

          modeBadge.className =
            'hidden sm:inline-flex items-center gap-1 ' +
            'px-2.5 py-1 rounded-lg bg-slate-100 ' +
            'text-xs font-medium text-slate-600';
        }


        sys(
          'Video ended. Text continues.'
        );


        toast(
          'Video ended'
        );
      }
    );
  }


  /* =========================================================
     RETRY SERVER
     ========================================================= */

  if (retryServerBtn) {

    retryServerBtn.addEventListener(
      'click',
      function () {

        if (serverWarning) {

          serverWarning.classList.add(
            'hidden'
          );

          serverWarning.style.display =
            'none';
        }


        connectWS();
      }
    );
  }


  /* =========================================================
     BOOT
     ========================================================= */

  try {

    var session =
      loadSession();


    if (
      session &&
      session.username
    ) {

      user = session;

      enterApp();

    }

  } catch (error) {

    console.error(
      'Boot error:',
      error
    );

    showAuth();
  }

})();
