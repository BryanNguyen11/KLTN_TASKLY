# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## AI scan → Auto-create schedule

This app can read a timetable or event image/PDF and auto-create calendar entries:

- Where: On the Create Event screen, tap "Tạo lịch tự động".
- Sources: Choose "Chọn ảnh từ thư viện" or "Chọn PDF/Tệp".
- Flow: The image/PDF is uploaded to the backend at `/api/events/scan-image` or `/api/events/scan-file`. The server runs OCR (Gemini Vision if configured, fallback to Tesseract) and returns raw text. The app parses weekly blocks (Thứ 2…Chủ nhật, Tiết, Phòng, GV) and shows a preview to select/edit before creating events.

Setup checklist:

- Frontend `.env`: set `EXPO_PUBLIC_API_BASE` to your backend (e.g. `http://<LAN-IP>:5050`). A helper script exists: `npm run update:ip`.
- Backend `.env`: `PORT=5050`, `MONGO_URI=...`, `JWT_SECRET=...` and optionally `GEMINI_API_KEY` for higher OCR quality.
- Restart Expo after changing `.env`.

Troubleshooting:

- If OCR preview is empty: use a clearer image, ensure day headers like `Thứ 2 10/02/2025` exist. You can still fall back to single-event extraction from the same scan.
- iOS photo access Limited: the app will prompt to "Chọn thêm ảnh" or open Settings.
- Device cannot reach backend: run Expo with tunnel or align `EXPO_PUBLIC_API_BASE` with your LAN IP and backend port.
- PDF not recognized: install `pdf-parse` on the backend (already included in package.json). Ensure server logs show `/api/events/scan-file` hit.

Privacy note: Images/files are processed on your backend. If Gemini is configured, an image is sent to Google to obtain OCR text only.

## Voice input (Speech-to-Text)

You can dictate your prompt in Vietnamese or English:

- Where: AI chat screen (TASKLY AI). Tap the mic icon next to the composer.
- Languages: Toggle VI/EN with the language chip. Partial text shows while recording; final text is appended to the input.

Platforms:

- Web: Uses the browser Web Speech API (Chrome recommended). No extra setup.
- iOS/Android: Uses `react-native-voice` and requires a Development Build or EAS build to access native speech APIs.

Native setup checklist:

- iOS: Microphone permission string is set in `app.json > ios.infoPlist.NSMicrophoneUsageDescription`.
- Android: RECORD_AUDIO permission is declared in `app.json > android.permissions`.
- Build a dev client once, then run the app inside it:

```bash
# optional: install deps
cd frontend && npm install
# build dev client (choose your platform)
expo run:ios  # or expo run:android
```

Troubleshooting:

- If the mic button does nothing on native, ensure the dev client contains `react-native-voice` (rebuild after dependency changes).
- On web, if STT doesn't start, try Chrome and check site microphone permissions.

## Branding (App Icon, Splash, Favicon)

To use your custom Taskly logo across the app:

- Replace `assets/images/icon.png` with your square PNG (recommend 1024x1024, no transparency for iOS store uploads).
- Android adaptive icon (optional, already wired):
   - Foreground: `assets/images/android-icon-foreground.png` (transparent background, centered glyph)
   - Background: `assets/images/android-icon-background.png` (solid color or gradient). Config in `app.json > android.adaptiveIcon`.
   - Monochrome (optional): `assets/images/android-icon-monochrome.png` for themed icons on Android 13+.
- Web favicon: replace `assets/images/favicon.png`.
- Splash: replace `assets/images/splash-icon.png` or adjust `expo-splash-screen` plugin config in `app.json`.

After replacing files, restart Expo:

```bash
npm run start:offline
```

If the icon doesn't update on a physical device, uninstall the app first (caches the icon).

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Authentication (Stub)

Added simple in-memory auth flow:

- Screens: `app/auth/login.tsx`, `app/auth/register.tsx`
- Context: `contexts/AuthContext.tsx`
- Validation helpers: `utils/validation.ts`

Flow: If no user -> auth stack. After login/register -> tabs.

Replace fake calls inside `AuthContext` with real API integration (axios to backend) later.
