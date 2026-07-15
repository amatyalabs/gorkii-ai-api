import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import BrandMark from '../components/BrandMark';
import ThinkingSpinner from '../components/ThinkingSpinner';
import { colors, fonts, radius, spacing } from '../constants/theme';
import { getPatients, postChatStream, resolveApproval, transcribeVoice } from '../lib/api';

const INPUT_ROW_HEIGHT = 44;
const INPUT_LINE_HEIGHT = 20;
const HEADER_HEIGHT = 52;
const PANEL_WIDTH = 280;
// Visual height of the input bar at rest (its own vertical padding + the
// input row), used as static scroll-padding so messages never sit behind it.
const BAR_REST_HEIGHT = INPUT_ROW_HEIGHT + spacing.sm * 2;

// Starter prompts shown under the greeting on the empty chat. Tapping one drops
// it into the input box to edit and send. [patient] is a placeholder to fill in.
const TEMPLATES = [
  { icon: 'medkit-outline', text: 'What are the active medications for [patient]?' },
  { icon: 'alert-circle-outline', text: 'Does [patient] have any allergies?' },
  { icon: 'document-text-outline', text: 'Give a complete in-depth summary of [patient].' },
  { icon: 'checkmark-done-outline', text: 'What actions are pending my approval?' },
];

// Step 2 — THE product. A message list + input bar. Each send streams from
// POST /chat/stream: "step" events update a transient thinking line in
// place, and the "final" event becomes the agent's message bubble.
// An "approval" event renders a bubble with green Approve / red Reject
// buttons — the one place green/red carry their CLAUDE.md safety meaning.

let counter = 0;
const nextId = () => `${Date.now()}-${counter++}`;

// Brand mark, gently pulsing (breathing), shown on the empty chat state.
function ChatLogo() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <View style={logoStyles.box}>
      <Animated.View style={[logoStyles.fill, { transform: [{ scale }] }]}>
        <BrandMark size={72} />
      </Animated.View>
    </View>
  );
}

// Approve/Reject bubble. status drives which controls show:
//   pending   -> the two buttons
//   resolving -> a spinner (request in flight)
//   approved/rejected -> a final state line (green / red)
//   error     -> message + buttons re-enabled to retry
function ApprovalBubble({ item, onResolve }) {
  const { approvalId, action, fields, status } = item;
  const settled = status === 'approved' || status === 'rejected';
  const fieldEntries = Object.entries(fields ?? {});

  return (
    <View style={[styles.bubble, styles.bubbleAgent, styles.approvalBubble]}>
      <View style={styles.approvalHeaderRow}>
        <View style={styles.approvalIconBadge}>
          <Ionicons name="warning-outline" size={15} color={colors.risk} />
        </View>
        <Text style={styles.approvalLabel}>Approval required</Text>
      </View>

      <Text style={styles.approvalAction}>{action}</Text>

      <View style={styles.approvalFields}>
        {fieldEntries.map(([key, value], i) => (
          <View key={key} style={[styles.approvalFieldRow, i === fieldEntries.length - 1 && styles.approvalFieldRowLast]}>
            <Text style={styles.approvalFieldLabel}>{key}</Text>
            <Text style={styles.approvalFieldValue}>{String(value)}</Text>
          </View>
        ))}
      </View>

      {status === 'resolving' && (
        <View style={styles.approvalResolving}>
          <ThinkingSpinner />
          <Text style={styles.approvalResolvingText}>Submitting…</Text>
        </View>
      )}

      {settled && (
        <View style={styles.approvalOutcomeRow}>
          <Ionicons
            name={status === 'approved' ? 'checkmark-circle' : 'close-circle'}
            size={17}
            color={status === 'approved' ? colors.safe : colors.risk}
          />
          <Text
            style={[
              styles.approvalOutcome,
              { color: status === 'approved' ? colors.safe : colors.risk },
            ]}
          >
            {status === 'approved' ? 'Approved' : 'Rejected'}
          </Text>
        </View>
      )}

      {(status === 'pending' || status === 'error') && (
        <>
          {status === 'error' && (
            <Text style={styles.approvalErrorText}>Couldn’t submit — try again.</Text>
          )}
          <View style={styles.approvalActions}>
            <TouchableOpacity
              style={[styles.approvalButton, styles.rejectButton]}
              onPress={() => onResolve(item.id, approvalId, 'rejected')}
              activeOpacity={0.85}
            >
              <Ionicons name="close" size={18} color={colors.textPrimary} />
              <Text style={styles.approvalButtonText} numberOfLines={1}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.approvalButton, styles.approveButton]}
              onPress={() => onResolve(item.id, approvalId, 'approved')}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark" size={18} color={colors.textPrimary} />
              <Text style={styles.approvalButtonText} numberOfLines={1}>Approve</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

// Dropdown menu opened by the header hamburger. A transparent Modal with a
// small popover anchored under the button; it fades/slides down on open, and
// tapping anywhere outside closes it.
function NavMenu({ open, onClose, topInset, items }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 150,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 130,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open, anim]);

  if (!mounted) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] });

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View
        style={[
          styles.dropdown,
          { top: topInset + HEADER_HEIGHT - 6, opacity: anim, transform: [{ translateY }] },
        ]}
      >
        {items.map((it, i) => (
          <TouchableOpacity
            key={it.label}
            style={[styles.dropdownItem, i > 0 && styles.dropdownItemBorder]}
            onPress={it.onPress}
            activeOpacity={0.7}
          >
            <Ionicons name={it.icon} size={18} color={colors.textPrimary} />
            <Text style={styles.dropdownItemText}>{it.label}</Text>
          </TouchableOpacity>
        ))}
      </Animated.View>
    </Modal>
  );
}

// Bottom-sheet patient list, opened from the header's patient button (only
// shown on the empty chat). Selecting a patient fills [patient] in the
// starter-prompt templates with their name.
function PatientPickerModal({
  visible,
  onClose,
  patients,
  loading,
  error,
  onRetry,
  selectedName,
  onSelect,
  onClear,
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.medical_record_number ?? '').toLowerCase().includes(q)
    );
  }, [patients, query]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.pickerBackdrop} onPress={onClose}>
        <Pressable style={styles.pickerSheet} onPress={() => {}}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Choose a patient</Text>
            {selectedName && (
              <TouchableOpacity onPress={onClear} hitSlop={8}>
                <Text style={styles.pickerClear}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.pickerSearchRow}>
            <Ionicons name="search" size={16} color={colors.textSecondary} />
            <TextInput
              style={styles.pickerSearchInput}
              placeholder="Search by name or MRN"
              placeholderTextColor={colors.textSecondary}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />
          </View>
          <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
            {loading ? (
              <View style={styles.pickerState}>
                <ThinkingSpinner />
                <Text style={styles.pickerStateText}>Loading patients…</Text>
              </View>
            ) : error ? (
              <View style={styles.pickerState}>
                <Text style={styles.pickerStateText}>{error}</Text>
                <TouchableOpacity onPress={onRetry}>
                  <Text style={styles.pickerClear}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.pickerState}>
                <Text style={styles.pickerStateText}>No patients match.</Text>
              </View>
            ) : (
              filtered.map((p) => {
                const active = p.name === selectedName;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.pickerRow}
                    onPress={() => onSelect(p)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.flex1}>
                      <Text style={styles.pickerRowName}>{p.name}</Text>
                      <Text style={styles.pickerRowMrn}>{p.medical_record_number ?? '—'}</Text>
                    </View>
                    {active && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [stepText, setStepText] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inputHeight, setInputHeight] = useState(0);
  // Measured height of the whole floating bar (thinking/status row + input).
  // The list reserves exactly this as bottom padding so messages never scroll
  // under the bar — and it grows automatically when the thinking stream or a
  // voice status row appears above the input. Seeded with the resting height.
  const [barHeight, setBarHeight] = useState(BAR_REST_HEIGHT);
  // 'idle' | 'recording' | 'transcribing' — drives the mic/send button and
  // the status row above the input bar.
  const [voiceState, setVoiceState] = useState('idle');
  const [voiceError, setVoiceError] = useState(null);

  // Patient picker (header button, empty-chat only) — selecting a patient
  // fills [patient] in the starter-prompt templates with their name.
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [patients, setPatients] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [patientsError, setPatientsError] = useState(null);
  const [selectedPatientName, setSelectedPatientName] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const baseInputHeight = useRef(0);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const micPulse = useRef(new Animated.Value(1)).current;

  // Gentle pulse on the mic button while actively recording — the only
  // feedback that capture is live, since there's no waveform.
  useEffect(() => {
    if (voiceState !== 'recording') {
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
  }, [voiceState, micPulse]);
  const kbTranslate = useRef(new Animated.Value(0)).current;

  // Slide the floating input bar up/down with the keyboard — iOS only.
  // Android's window natively resizes when the keyboard opens (Expo's
  // default windowSoftInputMode="adjustResize"), which already pushes this
  // absolutely-positioned bar up correctly on its own; adding this transform
  // there double-moves it. iOS doesn't auto-resize, so it still needs the
  // manual slide, native-driven (useNativeDriver: true) so once .start()
  // fires the animation runs entirely on the UI thread.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const slide = (toValue, duration) =>
      Animated.timing(kbTranslate, {
        toValue,
        duration: duration || 250,
        easing: Easing.inOut(Easing.ease), // matches iOS's reported "easeInEaseOut"
        useNativeDriver: true,
      }).start();

    const onShow = (e) => {
      const h = e.endCoordinates?.height ?? 0;
      slide(-Math.max(0, h - insets.bottom), e.duration);
    };
    const onHide = (e) => slide(0, e.duration);

    const showSub = Keyboard.addListener('keyboardWillShow', onShow);
    const hideSub = Keyboard.addListener('keyboardWillHide', onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [insets.bottom, kbTranslate]);

  // Drop a starter prompt into the input, substituting [patient] for the
  // selected patient's name if one was chosen from the header picker.
  const selectTemplate = (template) => {
    const text = selectedPatientName ? template.replace('[patient]', selectedPatientName) : template;
    setInput(text);
    inputRef.current?.focus();
  };

  // Clears the local conversation. There's no server-side "new session"
  // concept yet, so this is just a client-side reset.
  const newChat = () => {
    setMessages([]);
    setInput('');
    setStepText(null);
    setSending(false);
    setMenuOpen(false);
  };

  const openPatientPicker = async () => {
    setPatientPickerOpen(true);
    if (patients.length > 0) return;
    setLoadingPatients(true);
    setPatientsError(null);
    try {
      const data = await getPatients();
      setPatients(Array.isArray(data) ? data : []);
    } catch (e) {
      setPatientsError(e.message ?? 'Could not load patients.');
    } finally {
      setLoadingPatients(false);
    }
  };

  const selectPatientForTemplates = (patient) => {
    setSelectedPatientName(patient.name);
    setPatientPickerOpen(false);
  };

  const menuItems = [
    {
      label: 'New patient',
      icon: 'person-add-outline',
      onPress: () => {
        setMenuOpen(false);
        router.push('/patient-capture');
      },
    },
    {
      label: 'Document upload',
      icon: 'document-text-outline',
      onPress: () => {
        setMenuOpen(false);
        router.push('/documents');
      },
    },
    {
      label: 'Audit log',
      icon: 'receipt-outline',
      onPress: () => {
        setMenuOpen(false);
        router.push('/audit');
      },
    },
  ];

  const send = () => {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    setInput('');
    setSending(true);
    setStepText('Thinking…');

    postChatStream(text, {
      onStep: (content) => setStepText(content),
      onContext: (content) => {
        // Tagged 'context' (not 'agent') so a context event that lands right
        // before an approval can be styled as the flag's reasoning trace. When
        // no approval follows, it renders as a normal agent bubble.
        setMessages((prev) => [...prev, { id: nextId(), role: 'context', text: content }]);
      },
      onApproval: (ev) => {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'approval',
            approvalId: ev.approval_id,
            action: ev.action,
            fields: ev.fields,
            status: 'pending',
          },
        ]);
        // The backend closes the stream right after an "approval" event —
        // no "final" follows for this request, so clear the typing state
        // here too or it stays pinned on the last step's label forever.
        setStepText(null);
        setSending(false);
      },
      onFinal: (content) => {
        setMessages((prev) => [...prev, { id: nextId(), role: 'agent', text: content }]);
        setStepText(null);
        setSending(false);
      },
      onError: () => {
        // Never crash on a failed request — surface it as a message bubble.
        // Kept neutral (not red): a network failure isn't a clinical safety
        // state, and red is reserved for that (CLAUDE.md).
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'error',
            text: 'Connection failed — couldn’t reach the assistant. Check that the backend is running and the IP in config is correct, then try again.',
          },
        ]);
        setStepText(null);
        setSending(false);
      },
    });
  };

  const setMessageStatus = (messageId, status) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, status } : m))
    );

  const handleResolve = async (messageId, approvalId, status) => {
    setMessageStatus(messageId, 'resolving');
    try {
      await resolveApproval(approvalId, status);
      setMessageStatus(messageId, status); // 'approved' | 'rejected'
    } catch {
      setMessageStatus(messageId, 'error');
    }
  };

  const renderItem = ({ item, index }) => {
    if (item.role === 'approval') {
      return <ApprovalBubble item={item} onResolve={handleResolve} />;
    }
    if (item.role === 'error') {
      return (
        <View style={[styles.bubble, styles.bubbleAgent, styles.bubbleError]}>
          <Text style={styles.bubbleErrorText}>{item.text}</Text>
        </View>
      );
    }
    // Context = Claude's plain-text reasoning that arrives alongside a tool
    // call. When the very next message is an approval, this text IS the "why
    // was this flagged" trace, so give it a labeled, muted treatment tying it
    // to the card below. Otherwise it's just a normal agent message.
    if (item.role === 'context') {
      const flagged = messages[index + 1]?.role === 'approval';
      if (flagged) {
        return (
          <View style={[styles.bubble, styles.bubbleAgent, styles.contextFlag]}>
            <View style={styles.contextFlagHeader}>
              <Ionicons name="information-circle-outline" size={14} color={colors.risk} />
              <Text style={styles.contextFlagLabel}>Flagged reasoning</Text>
            </View>
            <Markdown style={contextMarkdownStyles}>{item.text}</Markdown>
          </View>
        );
      }
      return (
        <View style={[styles.bubble, styles.bubbleAgent]}>
          <Markdown style={markdownStyles}>{item.text}</Markdown>
        </View>
      );
    }
    if (item.role === 'user') {
      return (
        <View style={[styles.bubble, styles.bubbleUser]}>
          <Text style={styles.bubbleText}>{item.text}</Text>
        </View>
      );
    }
    // Agent — shown with a small brand-mark avatar for identity.
    return (
      <View style={styles.agentRow}>
        <View style={styles.agentAvatar}>
          <BrandMark size={26} barColor={colors.textPrimary} />
        </View>
        <View style={[styles.bubble, styles.bubbleAgent, styles.agentBubble]}>
          <Markdown style={markdownStyles}>{item.text}</Markdown>
        </View>
      </View>
    );
  };

  const hasText = input.trim().length > 0;

  // Empty box shows a mic; typing swaps it to send. Tap to start recording,
  // tap again (now a stop icon) to finish — the transcript is dropped into
  // the input box for the surgeon to review/edit, never auto-sent.
  const handleMic = async () => {
    if (voiceState === 'transcribing') return;

    if (voiceState === 'idle') {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          setVoiceError('Microphone access is off — enable it in Settings to dictate.');
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: 'duckOthers' });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setVoiceError(null);
        setVoiceState('recording');
      } catch {
        setVoiceError('Could not start recording. Try again.');
        setVoiceState('idle');
      }
      return;
    }

    // recording -> stop, transcribe, drop the text into the input box.
    setVoiceState('transcribing');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording captured');
      const text = await transcribeVoice(uri);
      setInput((prev) => (prev ? `${prev} ${text}`.trim() : text));
      inputRef.current?.focus();
    } catch (e) {
      setVoiceError(e.message ?? 'Transcription failed. Try again.');
    } finally {
      setVoiceState('idle');
    }
  };

  // Line count, derived from the measured content height vs. the first
  // (single-line) measurement — robust to whether padding is included. The
  // send/mic button centers on a single line, then sticks to the bottom-right
  // corner once the box wraps to a second line.
  const lineCount = baseInputHeight.current
    ? Math.round((inputHeight - baseInputHeight.current) / INPUT_LINE_HEIGHT) + 1
    : 1;
  const stickBottom = lineCount > 1;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Native header off — its iOS 26 "Liquid Glass" bar-button background
          can't be removed per-button, so we draw our own header row instead. */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => setMenuOpen(true)}
          hitSlop={8}
          activeOpacity={0.85}
          accessibilityLabel="Menu"
          style={styles.headerButton}
        >
          <Ionicons name="menu" size={22} color={menuOpen ? colors.primary : colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerWordmark}>Doctors Nepal</Text>
        {messages.length > 0 ? (
          <TouchableOpacity
            onPress={newChat}
            hitSlop={8}
            activeOpacity={0.85}
            accessibilityLabel="New chat"
            style={styles.headerButton}
          >
            <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={openPatientPicker}
            hitSlop={8}
            activeOpacity={0.85}
            accessibilityLabel="Choose a patient"
            style={styles.headerButton}
          >
            <Ionicons
              name="person-outline"
              size={20}
              color={patientPickerOpen ? colors.primary : colors.textPrimary}
            />
          </TouchableOpacity>
        )}
      </View>
      <NavMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        topInset={insets.top}
        items={menuItems}
      />
      <PatientPickerModal
        visible={patientPickerOpen}
        onClose={() => setPatientPickerOpen(false)}
        patients={patients}
        loading={loadingPatients}
        error={patientsError}
        onRetry={openPatientPicker}
        selectedName={selectedPatientName}
        onSelect={selectPatientForTemplates}
        onClear={() => setSelectedPatientName(null)}
      />
      <View style={styles.fill}>
        <FlatList
          ref={listRef}
          style={styles.fill}
          data={messages}
          extraData={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          // Reserve the floating bar's real (measured) height plus a small gap
          // so messages always clear it — including when the thinking stream or
          // a voice status row grows the bar above the input.
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: barHeight + insets.bottom + spacing.sm },
          ]}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <ChatLogo />
              <Text style={styles.prompt}>What can I help you with?</Text>
              <View style={styles.templates}>
                {TEMPLATES.map((t) => (
                  <TouchableOpacity
                    key={t.text}
                    style={styles.templateCard}
                    onPress={() => selectTemplate(t.text)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.templateIconWrap}>
                      <Ionicons name={t.icon} size={17} color={colors.primary} />
                    </View>
                    <Text style={styles.templateText}>
                      {selectedPatientName ? t.text.replace('[patient]', selectedPatientName) : t.text}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          }
        />

        {/* Absolutely positioned, translated by kbTranslate — the list above
            it never reflows; only this bar moves. onLayout feeds its real
            height back so the list reserves the right amount of space. */}
        <Animated.View
          onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
          style={[
            styles.floatingBar,
            { bottom: insets.bottom, transform: [{ translateY: kbTranslate }] },
          ]}
        >
          {sending && stepText && (
            <View style={styles.typing}>
              <ThinkingSpinner />
              <Text style={styles.typingText}>{stepText}</Text>
            </View>
          )}
          {voiceState === 'recording' && (
            <View style={styles.typing}>
              <View style={styles.recordingDot} />
              <Text style={styles.typingText}>Recording — tap to stop</Text>
            </View>
          )}
          {voiceState === 'transcribing' && (
            <View style={styles.typing}>
              <ThinkingSpinner />
              <Text style={styles.typingText}>Transcribing…</Text>
            </View>
          )}
          {voiceState === 'idle' && voiceError && (
            <View style={styles.typing}>
              <Text style={styles.voiceErrorText}>{voiceError}</Text>
            </View>
          )}
          <View style={styles.inputBar}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Message the assistant"
              placeholderTextColor={colors.textSecondary}
              value={input}
              onChangeText={setInput}
              multiline
              textAlignVertical="center"
              onSubmitEditing={send}
              onContentSizeChange={(e) => {
                const h = e.nativeEvent.contentSize.height;
                if (!baseInputHeight.current) baseInputHeight.current = h;
                setInputHeight(h);
              }}
            />
            <View
              style={[styles.sendWrap, stickBottom && styles.sendWrapBottom]}
              pointerEvents="box-none"
            >
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (sending || voiceState === 'transcribing') && styles.sendButtonDisabled,
                ]}
                disabled={sending || voiceState === 'transcribing'}
                onPress={hasText ? send : handleMic}
                activeOpacity={0.85}
                accessibilityLabel={
                  hasText ? 'Send' : voiceState === 'recording' ? 'Stop recording' : 'Voice input'
                }
              >
                {voiceState === 'transcribing' ? (
                  <ThinkingSpinner />
                ) : (
                  <Animated.View style={voiceState === 'recording' && { transform: [{ scale: micPulse }] }}>
                    <Ionicons
                      name={hasText ? 'arrow-up' : voiceState === 'recording' ? 'stop' : 'mic'}
                      size={20}
                      color={colors.textPrimary}
                    />
                  </Animated.View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base },
  fill: { flex: 1 },
  // Hamburger left, wordmark centered, "new chat" right — all ghost buttons;
  // orange stays reserved for Send.
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.elevated,
  },
  headerButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  headerWordmark: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  // Extra bottom padding so the last message scrolls clear of the floating input.
  listContent: { padding: spacing.md, flexGrow: 1 },
  // Fills the (flexGrow:1) list area so the empty text sits centered in the chat.
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  prompt: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 21,
    textAlign: 'center',
    marginBottom: spacing.lg + spacing.xs,
  },
  promptSub: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13.5,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg + spacing.xs,
    maxWidth: 280,
  },
  templates: {
    width: '100%',
    maxWidth: 340,
    gap: spacing.sm - 1,
  },
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderRadius: radius.lg - 2,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md - 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.elevated,
  },
  templateIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateText: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 19,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.lg + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.elevated,
    borderBottomRightRadius: 5,
  },
  bubbleAgent: { backgroundColor: colors.surface, borderBottomLeftRadius: 5 },
  bubbleText: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },

  // Agent row: small brand-mark avatar + bubble, for identity/hierarchy.
  agentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm - 2,
    maxWidth: '92%',
    marginBottom: spacing.sm,
  },
  // Fixed square so the avatar is always the same size and position,
  // top-aligned with the first line of the reply.
  agentAvatar: { width: 26, height: 26, marginTop: 3 },
  agentBubble: { marginBottom: 0, flexShrink: 1 },

  // Context bubble that precedes an approval — labeled + muted so it reads
  // as the flag's reasoning trace rather than a direct answer.
  contextFlag: {
    borderLeftWidth: 3,
    borderLeftColor: colors.risk,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
  contextFlagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  contextFlagLabel: {
    color: colors.risk,
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  contextFlagText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },

  bubbleError: { backgroundColor: colors.surface },
  bubbleErrorText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 21,
  },

  // Approval card — most-elevated surface, top accent bar, icon badge,
  // label/value field grid, bigger action buttons.
  approvalBubble: {
    backgroundColor: colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    maxWidth: '92%',
    minWidth: 280,
    paddingTop: spacing.md,
  },
  approvalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
    marginBottom: spacing.sm,
  },
  approvalIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(237,66,69,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalLabel: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 11.5,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  approvalAction: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 17,
    marginBottom: spacing.sm,
  },
  approvalFields: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  approvalFieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  approvalFieldRowLast: { borderBottomWidth: 0 },
  approvalFieldLabel: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13 },
  approvalFieldValue: { color: colors.textPrimary, fontFamily: fonts.medium, fontSize: 14, textAlign: 'right' },

  approvalActions: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  approvalButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  approveButton: { backgroundColor: colors.safe },
  rejectButton: { backgroundColor: 'rgba(237,66,69,0.14)' },
  approvalButtonText: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  approvalResolving: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  approvalResolvingText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginLeft: spacing.sm,
  },
  approvalOutcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  approvalOutcome: {
    fontFamily: fonts.semibold,
    fontSize: 14.5,
  },
  approvalErrorText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontStyle: 'italic',
    fontSize: 13,
    marginTop: spacing.sm,
  },
  typing: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  typingText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    marginLeft: spacing.sm,
    fontSize: 13,
    lineHeight: 18,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    backgroundColor: colors.primary,
  },
  voiceErrorText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontStyle: 'italic',
    fontSize: 13,
    lineHeight: 18,
  },
  // Floats over the message list; kbTranslate slides it up with the
  // keyboard, so the list underneath never reflows.
  floatingBar: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  inputBar: {
    padding: spacing.sm,
    backgroundColor: colors.base,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    // Fully rounded — a pill on a single line.
    borderRadius: INPUT_ROW_HEIGHT / 2,
    paddingLeft: spacing.lg,
    // Extra right padding reserves space for the send button so typed text
    // never runs underneath it.
    paddingRight: 48,
    paddingVertical: (INPUT_ROW_HEIGHT - INPUT_LINE_HEIGHT) / 2,
    fontSize: 16,
    lineHeight: INPUT_LINE_HEIGHT,
    minHeight: INPUT_ROW_HEIGHT,
    maxHeight: 120,
  },
  // Spans the input's height (inset by the bar's padding) and centers the
  // button vertically inside the box, on the right.
  sendWrap: {
    position: 'absolute',
    right: spacing.sm + 6,
    top: spacing.sm,
    bottom: spacing.sm,
    justifyContent: 'center',
  },
  // >2 lines: drop the button to the bottom-right corner (6px up off the edge).
  sendWrapBottom: {
    justifyContent: 'flex-end',
    paddingBottom: 6,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },

  // Dropdown menu (opened by the header hamburger), anchored under the button.
  dropdown: {
    position: 'absolute',
    left: spacing.md,
    minWidth: 220,
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  dropdownItemBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surface,
  },
  dropdownItemText: {
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 15,
  },

  flex1: { flex: 1 },

  // Patient picker — bottom sheet (same shape as the doc-type picker on the
  // Documents screen) with a search box and a scrollable list.
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    maxHeight: '75%',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  pickerTitle: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickerClear: {
    color: colors.primary,
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  pickerSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  pickerSearchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingVertical: spacing.sm + 2,
  },
  pickerList: { flexGrow: 0 },
  pickerState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    justifyContent: 'center',
  },
  pickerStateText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.elevated,
  },
  pickerRowName: {
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  pickerRowMrn: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: 1,
  },
});

const logoStyles = StyleSheet.create({
  box: { width: 96, height: 96, marginBottom: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  fill: { alignItems: 'center', justifyContent: 'center' },
});

const markdownStyles = StyleSheet.create({
  body: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  heading1: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 22, marginTop: spacing.sm, marginBottom: spacing.xs },
  heading2: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 19, marginTop: spacing.sm, marginBottom: spacing.xs },
  heading3: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 17, marginTop: spacing.sm, marginBottom: spacing.xs },
  strong: { fontFamily: fonts.bold, color: colors.textPrimary },
  em: { fontFamily: fonts.regular, fontStyle: 'italic', color: colors.textPrimary },
  bullet_list: { marginVertical: spacing.xs },
  ordered_list: { marginVertical: spacing.xs },
  list_item: { color: colors.textPrimary, fontFamily: fonts.regular, marginBottom: spacing.xs },
  blockquote: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.elevated,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginVertical: spacing.xs,
  },
  code_inline: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
  },
  fence: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  code_block: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
});

// Muted markdown for the "Flagged reasoning" context bubble — smaller and in
// secondary grey so it reads as supporting context, but still honors bold /
// bullets / etc. (bold stays primary so key facts pop).
const contextMarkdownStyles = StyleSheet.create({
  body: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  strong: { fontFamily: fonts.bold, color: colors.textPrimary },
  em: { fontFamily: fonts.regular, fontStyle: 'italic', color: colors.textSecondary },
  bullet_list: { marginVertical: 2 },
  ordered_list: { marginVertical: 2 },
  list_item: { color: colors.textSecondary, fontFamily: fonts.regular, marginBottom: 2 },
});
