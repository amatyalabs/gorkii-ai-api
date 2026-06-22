import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { colors, fonts, radius, spacing } from '../constants/theme';
import { postChatStream } from '../lib/api';

const INPUT_ROW_HEIGHT = 44;
const INPUT_LINE_HEIGHT = 20;

// Step 2 — THE product. A message list + input bar. Each send streams from
// POST /chat/stream: "step" events update a transient thinking line in
// place, and the "final" event becomes the agent's message bubble.
// Approval-required replies come back as plain text for now; the dedicated
// red Approve/Reject UI is step 3 (the approvals screen), so no red here.

let counter = 0;
const nextId = () => `${Date.now()}-${counter++}`;

function ThinkingSpinner() {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="sync-outline" size={16} color={colors.textSecondary} />
    </Animated.View>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [stepText, setStepText] = useState(null);
  const listRef = useRef(null);
  const headerHeight = useHeaderHeight();

  const send = () => {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    setInput('');
    setSending(true);
    setStepText('Thinking…');

    postChatStream(text, {
      onStep: (content) => setStepText(content),
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

  const renderItem = ({ item }) => {
    if (item.role === 'error') {
      return (
        <View style={[styles.bubble, styles.bubbleAgent, styles.bubbleError]}>
          <Text style={styles.bubbleErrorText}>{item.text}</Text>
        </View>
      );
    }
    const mine = item.role === 'user';
    return (
      <View style={[styles.bubble, mine ? styles.bubbleUser : styles.bubbleAgent]}>
        {mine ? (
          <Text style={styles.bubbleText}>{item.text}</Text>
        ) : (
          <Markdown style={markdownStyles}>{item.text}</Markdown>
        )}
      </View>
    );
  };

  const canSend = input.trim().length > 0 && !sending;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Ask about a patient or request an action. Anything that changes
              records will be routed for approval before it runs.
            </Text>
          }
        />

        {sending && stepText && (
          <View style={styles.typing}>
            <ThinkingSpinner />
            <Text style={styles.typingText}>{stepText}</Text>
          </View>
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Message the assistant"
            placeholderTextColor={colors.textSecondary}
            value={input}
            onChangeText={setInput}
            multiline
            textAlignVertical="center"
            onSubmitEditing={send}
          />
          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            disabled={!canSend}
            onPress={send}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-up" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base },
  fill: { flex: 1 },
  listContent: { padding: spacing.md, flexGrow: 1 },
  empty: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    lineHeight: 21,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.elevated },
  bubbleAgent: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  bubbleText: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  bubbleError: { backgroundColor: colors.surface },
  bubbleErrorText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 21,
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
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.elevated,
    backgroundColor: colors.base,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: (INPUT_ROW_HEIGHT - INPUT_LINE_HEIGHT) / 2,
    fontSize: 16,
    lineHeight: INPUT_LINE_HEIGHT,
    minHeight: INPUT_ROW_HEIGHT,
    maxHeight: 120,
    marginRight: spacing.sm,
  },
  sendButton: {
    width: INPUT_ROW_HEIGHT,
    height: INPUT_ROW_HEIGHT,
    borderRadius: INPUT_ROW_HEIGHT / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
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
