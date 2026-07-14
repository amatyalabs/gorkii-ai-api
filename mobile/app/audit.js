import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../constants/theme';
import { getAuditLog } from '../lib/api';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// SQLite datetime('now') gives "YYYY-MM-DD HH:MM:SS" (UTC). Parse the parts
// directly rather than via Date() — Hermes is inconsistent with space-separated
// date strings — and render "Jul 1, 2026 09:42".
function formatTimestamp(ts) {
  if (!ts) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(ts);
  if (!m) return ts;
  const [, year, mo, day, hour, min] = m;
  const month = MONTHS[parseInt(mo, 10) - 1] ?? mo;
  return `${month} ${parseInt(day, 10)}, ${year} ${hour}:${min}`;
}

// Green for approved/safe, red for rejected/needs_approval (CLAUDE.md colors).
const GREEN_DECISIONS = new Set(['approved', 'safe']);
function decisionColor(decision) {
  return GREEN_DECISIONS.has(decision) ? colors.safe : colors.risk;
}

function humanizeDecision(decision) {
  if (!decision) return '';
  return decision.charAt(0).toUpperCase() + decision.slice(1).replace(/_/g, ' ');
}

// "update_prescription" -> "Update Prescription"
function humanizeActionType(action) {
  if (!action) return '';
  return action
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function AuditCard({ item }) {
  const color = decisionColor(item.decision);
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.cardTop}>
        <Text style={styles.timestamp}>{formatTimestamp(item.timestamp)}</Text>
        <View style={[styles.badge, { backgroundColor: color }]}>
          <Text style={styles.badgeText}>{humanizeDecision(item.decision)}</Text>
        </View>
      </View>
      <Text style={styles.action}>{humanizeActionType(item.action_type)}</Text>
      <Text style={styles.meta}>
        <Text style={styles.metaLabel}>Surgeon: </Text>
        {item.surgeon_name ?? '—'}
      </Text>
      <Text style={styles.meta}>
        <Text style={styles.metaLabel}>Patient: </Text>
        {item.patient_name ?? '—'}
      </Text>
      {item.approved_by_name ? (
        <Text style={styles.meta}>
          <Text style={styles.metaLabel}>Approved by: </Text>
          {item.approved_by_name}
        </Text>
      ) : null}
    </View>
  );
}

export default function Audit() {
  const router = useRouter();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await getAuditLog(50);
      // Newest first. id autoincrements, so it's a reliable chronological key
      // regardless of the order the endpoint returns.
      const sorted = [...data].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      setEntries(sorted);
    } catch (e) {
      setError(e.message ?? 'Could not load the audit log.');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          activeOpacity={0.85}
          accessibilityLabel="Back"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Audit log</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(it) => String(it.id)}
          renderItem={({ item }) => <AuditCard item={item} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.textSecondary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                {error ?? 'No audit entries yet.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.elevated,
  },
  // Ghost icon button — chrome stays neutral; orange is reserved for
  // real actions elsewhere, not navigation.
  backButton: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { width: 34 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 18,
  },

  listContent: { padding: spacing.md, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 15,
    textAlign: 'center',
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  timestamp: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    flex: 1,
    marginRight: spacing.sm,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 12,
  },
  action: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 16,
    marginBottom: spacing.xs,
  },
  meta: {
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  metaLabel: { color: colors.textSecondary },
});
