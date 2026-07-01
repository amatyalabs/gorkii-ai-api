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
import { postChatStream, resolveApproval } from '../lib/api';

const INPUT_ROW_HEIGHT = 44;
const INPUT_LINE_HEIGHT = 20;

// Step 2 — THE product. A message list + input bar. Each send streams from
// POST /chat/stream: "step" events update a transient thinking line in
// place, and the "final" event becomes the agent's message bubble.
// An "approval" event renders a bubble with green Approve / red Reject
// buttons — the one place green/red carry their CLAUDE.md safety meaning.

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

// Approve/Reject bubble. status drives which controls show:
//   pending   -> the two buttons
//   resolving -> a spinner (request in flight)
//   approved/rejected -> a final state line (green / red)
//   error     -> message + buttons re-enabled to retry
function ApprovalBubble({ item, onResolve }) {
  const { approvalId, action, fields, status } = item;
  const settled = status === 'approved' || status === 'rejected';

  return (
    <View style={[styles.bubble, styles.bubbleAgent, styles.approvalBubble]}>
      <Text style={styles.approvalLabel}>Approval required</Text>
      <Text style={styles.approvalAction}>{action}</Text>
      {Object.entries(fields ?? {}).map(([key, value]) => (
        <View key={key} style={styles.approvalFieldRow}>
          <Text style={styles.approvalBullet}>•</Text>
          <Text style={styles.approvalFieldText}>
            {key}: {String(value)}
          </Text>
        </View>
      ))}

      {status === 'resolving' && (
        <View style={styles.approvalResolving}>
          <ThinkingSpinner />
          <Text style={styles.approvalResolvingText}>Submitting…</Text>
        </View>
      )}

      {settled && (
        <Text
          style={[
            styles.approvalOutcome,
            { color: status === 'approved' ? colors.safe : colors.risk },
          ]}
        >
          {status === 'approved' ? '✓ Approved' : '✗ Rejected'}
        </Text>
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
      onContext: (content) => {
        setMessages((prev) => [...prev, { id: nextId(), role: 'agent', text: content }]);
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

  const renderItem = ({ item }) => {
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
  bubbleAgent: { backgroundColor: colors.surface },
  bubbleText: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  bubbleError: { backgroundColor: colors.surface },
  bubbleErrorText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 21,
  },
  approvalBubble: {
    borderWidth: 1,
    borderColor: colors.elevated,
    // Override the 85% cap from styles.bubble and guarantee enough width
    // for the two side-by-side buttons even when field values are short.
    maxWidth: '92%',
    minWidth: 280,
  },
  approvalLabel: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  approvalAction: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 16,
    marginBottom: spacing.xs,
  },
  approvalFieldRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  approvalBullet: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    marginRight: spacing.sm,
  },
  approvalFieldText: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
  },
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
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  approveButton: { backgroundColor: colors.safe },
  rejectButton: { backgroundColor: colors.risk },
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
  approvalOutcome: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    marginTop: spacing.md,
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
