// Single source of truth for the backend host.
//
// This is your machine's LAN IP — taken from the address Expo printed
// (`Metro: exp://192.168.1.100:8082`), since the phone reaches the backend
// over Wi-Fi, not "localhost". Confirm/replace if your IP changed:
//   - Windows: run `ipconfig`, use the Wi-Fi adapter's IPv4 Address.
// The phone and laptop must be on the same Wi-Fi network.
export const API_BASE_URL = 'http://192.168.0.197:8000';

// Auth isn't built yet. The backend contract says to pass surgeon_id
// explicitly for now. When real auth lands this goes away — the server
// will derive surgeon_id from a token. (See CLAUDE.md.)
export const SURGEON_ID = 1;
