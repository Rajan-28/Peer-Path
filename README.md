# PeerPath

Safe video + text random chat with accounts and real WebRTC.

## Run (required)

```bash
cd peerpath
node server.js
```

Open **http://localhost:3000** in your browser.

Do not open HTML files directly.

## Use

1. Sign Up (display name, username, password, region, 18+ checkbox)
2. After login you see the main Connect screen
3. Open a **second tab**, sign up as another user
4. Both click **Text Only** or **Video + Text**
5. Allow camera if prompted → you get matched

## Fixes in this version

- Blank screen after login (Tailwind hidden/flex conflict) — fixed
- Signup silent validation failures — fixed with clear errors
- Camera permission errors show clear messages
- Server connection status shown on the home screen
