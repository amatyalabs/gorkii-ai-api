import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import ThinkingSpinner from '../components/ThinkingSpinner';
import { colors, fonts, radius, spacing } from '../constants/theme';
import { extractPatient, extractPatientFromVoice, transcribeVoice } from '../lib/api';

const TABS = [
  { key: 'photo', label: 'Photo', icon: 'camera-outline' },
  { key: 'voice', label: 'Voice', icon: 'mic-outline' },
  { key: 'files', label: 'Files', icon: 'document-outline' },
];

// Screen 1 of onboarding: capture patient source material. Photo, Files, and
// Voice are all wired end-to-end (capture/pick/dictate → extraction →
// Confirm). Voice records a dictation, transcribes it, then runs a text-based
// extraction (there's no document photo to run vision extraction on).
export default function PatientCapture() {
  const router = useRouter();
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [tab, setTab] = useState('photo');
  const [pages, setPages] = useState([]); // [{ uri }]
  const [files, setFiles] = useState([]); // [{ uri, name, mimeType }]
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState(null);

  // Voice capture: 'idle' | 'recording' | 'transcribing'. voiceText is the
  // editable transcript the surgeon reviews before extraction.
  const [voiceRecState, setVoiceRecState] = useState('idle');
  const [voiceText, setVoiceText] = useState('');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const micPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (voiceRecState !== 'recording') {
      micPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(micPulse, { toValue: 1.15, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(micPulse, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [voiceRecState, micPulse]);

  // Leaving the Voice tab mid-recording would otherwise leave the recorder
  // session dangling — stop and discard rather than transcribe on tab-away.
  useEffect(() => {
    if (tab !== 'voice' && voiceRecState === 'recording') {
      recorder.stop().catch(() => {});
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      setVoiceRecState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleVoiceRecord = async () => {
    if (voiceRecState === 'transcribing') return;

    if (voiceRecState === 'idle') {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          setError('Microphone access is off — enable it in Settings to dictate.');
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: 'duckOthers' });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setError(null);
        setVoiceRecState('recording');
      } catch {
        setError('Could not start recording. Try again.');
        setVoiceRecState('idle');
      }
      return;
    }

    // recording -> stop, transcribe, drop the text into the editable box.
    setVoiceRecState('transcribing');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording captured');
      const text = await transcribeVoice(uri);
      setVoiceText((prev) => (prev ? `${prev} ${text}`.trim() : text));
      setError(null);
    } catch (e) {
      setError(e.message ?? 'Transcription failed. Try again.');
    } finally {
      setVoiceRecState('idle');
    }
  };

  const hasCaptured = pages.length > 0 || files.length > 0 || voiceText.trim().length > 0;

  const close = () => {
    if (hasCaptured) {
      Alert.alert('Discard this capture?', 'Your captured pages, files, and transcript will be lost.', [
        { text: 'Keep', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  };

  const capture = async () => {
    if (!cameraRef.current || !permission?.granted || extracting) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      setPages((prev) => [...prev, { uri: photo.uri }]);
      setError(null);
    } catch {
      setError('Could not capture the photo. Try again.');
    }
  };

  const removePage = (index) => setPages((prev) => prev.filter((_, i) => i !== index));

  const pickFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    setFiles((prev) => [
      ...prev,
      ...res.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType })),
    ]);
    setError(null);
  };

  const removeFile = (index) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const activeItems = tab === 'photo' ? pages : tab === 'files' ? files : [];
  const canExtract =
    tab === 'voice'
      ? voiceText.trim().length > 0 && voiceRecState === 'idle' && !extracting
      : activeItems.length > 0 && !extracting;

  const extract = async () => {
    if (!canExtract) return;
    setExtracting(true);
    setError(null);
    try {
      const result =
        tab === 'voice'
          ? await extractPatientFromVoice(voiceText.trim())
          : await extractPatient(activeItems);
      router.push({
        pathname: '/patient-confirm',
        params: {
          data: JSON.stringify(result),
          images: JSON.stringify(tab === 'voice' ? [] : activeItems.map((it) => it.uri)),
        },
      });
    } catch (e) {
      setError(e.message ?? 'Extraction failed. Check the connection and try again.');
    } finally {
      setExtracting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top bar: ghost back button (left) + segmented Photo/Voice/Files (right) */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={close}
          hitSlop={8}
          activeOpacity={0.85}
          accessibilityLabel="Back"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.tabs}>
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.tab, active ? styles.tabActive : styles.tabInactive]}
                onPress={() => setTab(t.key)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={t.icon}
                  size={15}
                  color={active ? colors.textPrimary : colors.textSecondary}
                />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
        {tab === 'photo' && (
          <>
            <View style={styles.viewfinder}>
              {permission?.granted ? (
                <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
              ) : (
                <View style={styles.viewfinderIdle}>
                  <Ionicons name="camera-outline" size={30} color={colors.textSecondary} />
                  <Text style={styles.viewfinderText}>Position document in frame</Text>
                  <TouchableOpacity onPress={requestPermission} activeOpacity={0.7}>
                    <Text style={styles.link}>Enable camera</Text>
                  </TouchableOpacity>
                </View>
              )}
              {/* Corner guides for a document-scanner feel */}
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>

            <Text style={styles.hint}>Align the document, then tap to capture</Text>

            <TouchableOpacity
              style={styles.shutter}
              onPress={capture}
              activeOpacity={0.8}
              disabled={!permission?.granted}
              accessibilityLabel="Capture page"
            >
              <View style={styles.shutterInner} />
            </TouchableOpacity>

            {pages.length > 0 && (
              <View style={styles.capturedSection}>
                <Text style={styles.capturedLabel}>
                  {pages.length} page{pages.length === 1 ? '' : 's'} captured
                </Text>
                <View style={styles.thumbRow}>
                  {pages.map((p, i) => (
                    <TouchableOpacity key={i} style={styles.thumb} onPress={() => removePage(i)} activeOpacity={0.8}>
                      <Image source={{ uri: p.uri }} style={styles.thumbImg} />
                      <View style={styles.thumbBadge}>
                        <Ionicons name="checkmark" size={10} color={colors.textPrimary} />
                      </View>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={styles.thumbAdd} onPress={capture} activeOpacity={0.7}>
                    <Ionicons name="add" size={22} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}

        {tab === 'files' && (
          <>
            <TouchableOpacity style={styles.dropZone} onPress={pickFiles} activeOpacity={0.7}>
              <Ionicons name="cloud-upload-outline" size={34} color={colors.textSecondary} />
              <Text style={styles.dropZoneText}>Browse files</Text>
              <Text style={styles.dropZoneCaption}>PDF, JPG, PNG</Text>
            </TouchableOpacity>
            {files.map((f, i) => (
              <View key={i} style={styles.fileChip}>
                <Ionicons name="document-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.fileName} numberOfLines={1}>
                  {f.name}
                </Text>
                <TouchableOpacity onPress={() => removeFile(i)} hitSlop={8}>
                  <Ionicons name="close" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {tab === 'voice' && (
          <View style={styles.voiceWrap}>
            {(voiceRecState !== 'idle' || voiceText.length === 0) && (
              <>
                <TouchableOpacity
                  style={styles.shutter}
                  onPress={handleVoiceRecord}
                  activeOpacity={0.8}
                  disabled={voiceRecState === 'transcribing'}
                  accessibilityLabel={voiceRecState === 'recording' ? 'Stop recording' : 'Start recording'}
                >
                  {voiceRecState === 'transcribing' ? (
                    <ThinkingSpinner size={24} color={colors.textPrimary} />
                  ) : (
                    <Animated.View style={voiceRecState === 'recording' && { transform: [{ scale: micPulse }] }}>
                      <Ionicons
                        name={voiceRecState === 'recording' ? 'stop' : 'mic'}
                        size={26}
                        color={colors.textPrimary}
                      />
                    </Animated.View>
                  )}
                </TouchableOpacity>
                <Text style={styles.hint}>
                  {voiceRecState === 'recording'
                    ? 'Recording — tap to stop'
                    : voiceRecState === 'transcribing'
                    ? 'Transcribing…'
                    : 'Tap to dictate patient details'}
                </Text>
              </>
            )}

            {voiceText.length > 0 && voiceRecState === 'idle' && (
              <View style={styles.transcriptBox}>
                <View style={styles.transcriptHeader}>
                  <Text style={styles.capturedLabel}>Transcript — edit if needed</Text>
                  <TouchableOpacity onPress={() => setVoiceText('')} hitSlop={8}>
                    <Text style={styles.link}>Clear</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.transcriptInput}
                  value={voiceText}
                  onChangeText={setVoiceText}
                  multiline
                  placeholder="Transcript will appear here"
                  placeholderTextColor={colors.textSecondary}
                />
                <TouchableOpacity style={styles.reRecordButton} onPress={handleVoiceRecord} activeOpacity={0.7}>
                  <Ionicons name="mic-outline" size={16} color={colors.primary} />
                  <Text style={styles.reRecordText}>Record more</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>

      {/* Shared Extract Data button (same size across all tabs) */}
      <View style={styles.ctaBar}>
        <TouchableOpacity
          style={[styles.cta, !canExtract && styles.ctaDisabled]}
          onPress={extract}
          disabled={!canExtract}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>{extracting ? 'Extracting…' : 'Extract Data'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base },
  fill: { flex: 1 },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.elevated,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // One rounded rectangle in the header holding three segments (iOS-style).
  tabs: {
    flex: 1,
    flexDirection: 'row',
    marginLeft: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  tabActive: { backgroundColor: colors.primary },
  tabInactive: {},
  tabText: { color: colors.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
  tabTextActive: { color: colors.textPrimary },

  scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg },

  // A4 portrait proportions (210 × 297), sized down to fit without scrolling.
  viewfinder: {
    alignSelf: 'center',
    width: '88%',
    aspectRatio: 210 / 297,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.elevated,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinderIdle: { alignItems: 'center', gap: spacing.xs, padding: spacing.md },
  viewfinderText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 14 },
  link: { color: colors.primary, fontFamily: fonts.semibold, fontSize: 14, marginTop: spacing.xs },

  // Rounded corner guides overlaid on the viewfinder.
  corner: { position: 'absolute', width: 20, height: 20, borderColor: 'rgba(255,255,255,0.65)' },
  cornerTL: { top: 10, left: 10, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 5 },
  cornerTR: { top: 10, right: 10, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 5 },
  cornerBL: { bottom: 10, left: 10, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 5 },
  cornerBR: { bottom: 10, right: 10, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 5 },

  hint: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  capturedSection: { marginTop: spacing.lg },
  capturedLabel: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: {
    width: 50,
    height: 50,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.elevated,
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbAdd: {
    width: 50,
    height: 50,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.elevated,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },

  shutter: {
    alignSelf: 'center',
    marginTop: spacing.md,
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 4,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.textPrimary },

  // Files
  dropZone: {
    borderWidth: 1.5,
    borderColor: colors.elevated,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  dropZoneText: { color: colors.textPrimary, fontFamily: fonts.semibold, fontSize: 16 },
  dropZoneCaption: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13 },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  fileName: { flex: 1, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 14 },

  // Voice
  voiceWrap: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
  transcriptBox: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  transcriptInput: {
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  reRecordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  reRecordText: { color: colors.primary, fontFamily: fonts.semibold, fontSize: 14 },

  errorText: {
    color: colors.risk,
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  // Shared bottom CTA
  ctaBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.textPrimary, fontFamily: fonts.semibold, fontSize: 16 },
});
