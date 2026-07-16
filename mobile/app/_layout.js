import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  useFonts,
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import { colors, fonts } from '../constants/theme';

SplashScreen.preventAutoHideAsync();

// Root navigator. expo-router builds the stack from files in /app:
//   index.js            -> the login gate    (headerless)
//   chat.js             -> the chat screen   (custom in-screen header + menu)
//   documents.js        -> the upload flow   (custom in-screen header)
//   audit.js            -> the audit log     (custom in-screen header)
//   patient-capture.js  -> onboarding: capture (camera/voice/files)
//   patient-confirm.js  -> onboarding: QA the extraction, then save
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  // KeyboardProvider (react-native-keyboard-controller) takes over keyboard
  // handling app-wide: it tracks the IME natively on both platforms, which is
  // required on Android since SDK 54's enforced edge-to-edge stops the OS
  // from resizing the window (adjustResize no longer does anything), and it
  // is what lets the chat screen animate frame-synced with the keyboard.
  //
  // The translucent flags matter on Android: this app is already
  // edge-to-edge (mandatory in SDK 54), but the provider can't detect Expo's
  // implementation of it (it looks for the RNEdgeToEdge module, which Expo
  // doesn't use) — without these it "helpfully" re-adds system-bar
  // compensation padding on top of the real insets, and that second inset
  // system applying around keyboard events is visible as a small downward
  // shift right after the keyboard settles.
  return (
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.base },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: fonts.semibold },
          contentStyle: { backgroundColor: colors.base },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="chat" options={{ headerShown: false }} />
        <Stack.Screen name="documents" options={{ headerShown: false }} />
        <Stack.Screen name="audit" options={{ headerShown: false }} />
        <Stack.Screen name="patient-capture" options={{ headerShown: false }} />
        <Stack.Screen name="patient-confirm" options={{ headerShown: false }} />
      </Stack>
    </KeyboardProvider>
  );
}
